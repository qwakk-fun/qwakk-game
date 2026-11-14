/**
 * Duck Pass in the menu without a browser: QoreX detection, every wallet stop
 * mapped to a fixed reason (never raw text), the link flow end to end against
 * a fake QoreX and a fake server, polling while the chain has not indexed
 * the hash, and the fee shown in QOR from integer uqor.
 */
import { describe, expect, it } from 'vitest';
import { QorexIntegrationError } from '@qorechain/qorex-types';
import type { DuckPassChallenge, DuckPassVerifyResult } from '@qwakk/shared/duck-pass';
import { ApiError } from '../../src/ui/menu/api.ts';
import { checkProof, linkWallet, POLL_TRIES, qorexState, uqorToQor, walletStop, type FlowDeps, type FlowStep } from '../../src/ui/menu/account/duckPassFlow.ts';

const ADDRESS = 'qor14ehcaykvenjcyqudrac5jhfev8a40m9g5r3tzf';
const HASH = 'AB'.repeat(32);
const CHALLENGE: DuckPassChallenge = {
  chainId: 'qorechain-diana',
  memo: 'qwakk-duck-pass:v1:s1:4821:AbCdEfGhIjKlMnOp',
  messages: [{ typeUrl: '/cosmos.bank.v1beta1.MsgSend', value: 'Cip=' }],
  gasLimit: '250000',
  feeUqor: 37_500,
  expiresAt: 0,
};
const PASS = { address: ADDRESS, txHash: HASH, season: 's1', linkedAt: '2026-11-14T10:25:25.000Z' };

describe('QoreX detection', () => {
  it('needs the signAndBroadcast capability (QoreX 0.3.5 or newer)', () => {
    expect(qorexState(undefined)).toBe('missing');
    expect(qorexState({ capabilities: [], signAndBroadcast: async () => ({ txHash: '', code: 0, shield: 'shielded' }) })).toBe('outdated');
    expect(qorexState({ capabilities: ['signAndBroadcast'] } as never)).toBe('outdated');
    expect(qorexState({ capabilities: ['listAccounts', 'signAndBroadcast'], signAndBroadcast: async () => ({ txHash: '', code: 0, shield: 'shielded' }) })).toBe('ready');
  });
});

describe('wallet stops', () => {
  it('map QoreX errors to fixed reasons', () => {
    const cases: [unknown, string][] = [
      [new QorexIntegrationError('QOREX_NOT_INSTALLED', 'x'), 'missing'],
      [new QorexIntegrationError('QOREX_NOT_SUPPORTED_YET', 'x'), 'outdated'],
      [new Error('QoreX: signature rejected'), 'declined'],
      [new Error('QoreX: connection rejected'), 'declined'],
      [new Error('QoreX: wallet is locked'), 'locked'],
      [new Error('QoreX: a request from this site is already waiting for your answer.'), 'pending'],
      [new Error('QoreX: the wallet or account changed while this request was waiting. Nothing was signed.'), 'account'],
      [new Error('QoreX: chainId qorechain-diana is not the active network'), 'network'],
      [new Error('QoreX: unsupported chain cosmoshub-4'), 'network'],
      [new Error('Transaction rejected by the network (sdk 5): insufficient funds'), 'funds'],
      [new Error('Transaction rejected by the network (sdk 32): account sequence mismatch'), 'busy'],
      [new Error('Transaction rejected by the network (pqc 3): bad layer'), 'pqc'],
      [new Error('Transaction rejected by the network (bank 7): nope'), 'chain'],
      [new Error('Transaction failed on-chain (code 11).'), 'onchain'],
      [new Error('QoreX: PQC key registration failed'), 'pqc'],
      [new Error('something odd <script>'), 'other'],
      ['string thrown', 'other'],
    ];
    for (const [err, reason] of cases) expect(walletStop(err), String(err)).toBe(reason);
  });
});

function deps(over: Partial<FlowDeps> & { sign?: () => Promise<unknown>; key?: () => Promise<unknown>; answers?: (DuckPassVerifyResult | Error)[] } = {}) {
  const steps: FlowStep[] = [];
  const sent: unknown[] = [];
  const answers = over.answers ?? [{ status: 'linked', duckPass: PASS }];
  let n = 0;
  const d: FlowDeps = {
    native: {
      getKey: (over.key ?? (async () => ({ bech32Address: ADDRESS }))) as never,
      signAndBroadcast: (async (req: unknown) => {
        sent.push(req);
        return over.sign ? over.sign() : { txHash: HASH.toLowerCase(), code: 0, shield: 'shielded' };
      }) as never,
    },
    challenge: over.challenge ?? (async () => CHALLENGE),
    verify: async () => {
      const a = answers[Math.min(n++, answers.length - 1)]!;
      if (a instanceof Error) throw a;
      return a;
    },
    onStep: (s) => steps.push(s),
    sleep: async () => {},
  };
  return { d, steps, sent, calls: () => n };
}

describe('link flow', () => {
  it('connects, gets the challenge, has QoreX sign and broadcast it, then the server links it', async () => {
    const { d, steps, sent } = deps({ answers: [{ status: 'pending' }, { status: 'pending' }, { status: 'linked', duckPass: PASS }] });
    expect(await linkWallet(d)).toEqual({ kind: 'linked', duckPass: PASS, shield: 'shielded' });
    expect(steps).toEqual(['connecting', 'preparing', 'signing', 'checking']);
    // QoreX gets exactly the server's request: testnet, the memo, the one message, the gas.
    expect(sent).toEqual([{ chainId: 'qorechain-diana', messages: CHALLENGE.messages, memo: CHALLENGE.memo, gasLimit: '250000' }]);
  });

  it('stops with a fixed reason when QoreX declines or is on the wrong network', async () => {
    expect(await linkWallet(deps({ sign: async () => Promise.reject(new Error('QoreX: signature rejected')) }).d)).toEqual({ kind: 'stopped', reason: 'declined' });
    expect(await linkWallet(deps({ key: async () => Promise.reject(new Error('QoreX: wallet is locked')) }).d)).toEqual({ kind: 'stopped', reason: 'locked' });
    expect(await linkWallet(deps({ sign: async () => Promise.reject(new Error('QoreX: chainId qorechain-diana is not the active network')) }).d)).toEqual({ kind: 'stopped', reason: 'network' });
    expect(await linkWallet(deps({ key: async () => ({ bech32Address: '0xabc' }) }).d)).toEqual({ kind: 'stopped', reason: 'other' });
  });

  it('keeps the hash when the transaction failed on chain', async () => {
    const { d } = deps({ sign: async () => ({ txHash: HASH, code: 11, shield: 'classical' }) });
    expect(await linkWallet(d)).toEqual({ kind: 'stopped', reason: 'onchain', txHash: HASH });
  });

  it('passes server refusals through as their codes', async () => {
    const { d, sent } = deps({ challenge: async () => Promise.reject(new ApiError('qorex_taken', 409)) });
    expect(await linkWallet(d)).toEqual({ kind: 'stopped', reason: 'qorex_taken' });
    expect(sent).toEqual([]);
    const v = deps({ answers: [new ApiError('qorex_no_hybrid', 422)] });
    expect(await linkWallet(v.d)).toEqual({ kind: 'stopped', reason: 'qorex_no_hybrid', txHash: HASH });
  });

  it('waits with the hash when the chain is slow or unreachable', async () => {
    const slow = deps({ answers: [{ status: 'pending' }] });
    expect(await checkProof(slow.d, HASH)).toEqual({ kind: 'waiting', txHash: HASH });
    expect(slow.calls()).toBe(POLL_TRIES);
    const down = deps({ answers: [new ApiError('chain_unreachable', 503)] });
    expect(await checkProof(down.d, HASH)).toEqual({ kind: 'waiting', txHash: HASH });
  });
});

describe('fee display', () => {
  it('turns integer uqor into QOR without floats', () => {
    expect(uqorToQor(37_500)).toBe('0.0375');
    expect(uqorToQor(1)).toBe('0.000001');
    expect(uqorToQor(1_000_000)).toBe('1');
    expect(uqorToQor(2_500_000)).toBe('2.5');
  });
});

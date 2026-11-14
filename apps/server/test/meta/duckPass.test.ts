/**
 * Duck Pass without a database: the signer address derivation, the chain
 * read (404, code 5, outages) and the service rules (challenge, nonce bound
 * to the account and wallet, expiry, single use, pending, every refusal,
 * limits) against a fake store and a fake chain. Nothing reaches Diana.
 */
import { createECDH, createHash } from 'node:crypto';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it } from 'vitest';
import { DUCK_PASS_CHALLENGE_MS, DUCK_PASS_CHAIN_ID, parseDuckPassMemo, type DuckPassChallenge, type DuckPassView } from '@qwakk/shared/duck-pass';
import { addressOfPubKey, bech32Encode } from '../../src/meta/duckPass/address.ts';
import { fetchTx, type ChainFetch } from '../../src/meta/duckPass/chain.ts';
import { DUCK_PASS_LIMITS, DuckPassService } from '../../src/meta/duckPass/service.ts';
import type { DuckPassStore, LinkResult } from '../../src/meta/duckPass/store.ts';
import { proofTx, TEST_ADDRESS, TEST_PUBKEY } from '../../../../packages/shared/test/duckPassFixture.ts';

const ACC = '11111111-1111-4111-8111-111111111111';
const OTHER_ACC = '33333333-3333-4333-8333-333333333333';
const DUCK = '22222222-2222-4222-8222-222222222222';
const HASH = 'C0FFEE'.padEnd(64, '0');
const OTHER_WALLET = `qor1${'q'.repeat(38)}`;
const db = {} as Sql;

/** Another valid compressed secp256k1 key (not the test wallet's). */
function otherKey(): string {
  const e = createECDH('secp256k1');
  e.setPrivateKey(createHash('sha256').update('another duck').digest());
  return e.getPublicKey(null, 'compressed').toString('base64');
}

describe('signer address', () => {
  it('derives qor1 addresses like @qorechain/sdk and Diana', () => {
    // The pair checked against the official SDK (packages/shared/test/duckPassFixture.ts).
    expect(addressOfPubKey(TEST_PUBKEY)).toBe(TEST_ADDRESS);
  });

  it('refuses keys that are not compressed secp256k1', () => {
    expect(addressOfPubKey('')).toBeNull();
    expect(addressOfPubKey(Buffer.alloc(33, 4).toString('base64'))).toBeNull();
    expect(addressOfPubKey(Buffer.alloc(65, 4).toString('base64'))).toBeNull();
  });

  it('encodes bech32 per BIP-173', () => {
    // BIP-173 test vector: hrp "a", no data.
    expect(bech32Encode('a', new Uint8Array())).toBe('a12uel5l');
  });
});

function fakeChain(answer: () => { status: number; body: unknown } | 'down'): ChainFetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const a = answer();
    if (a === 'down') throw new Error('ECONNREFUSED');
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body };
  }) as unknown as ChainFetch & { calls: string[] };
  f.calls = calls;
  return f;
}

describe('chain read', () => {
  it('reads one tx by upper-case hash from the REST path', async () => {
    const chain = fakeChain(() => ({ status: 200, body: { ok: 1 } }));
    expect(await fetchTx(HASH.toLowerCase(), chain, 'https://rest.example')).toEqual({ kind: 'found', body: { ok: 1 } });
    expect(chain.calls).toEqual([`https://rest.example/cosmos/tx/v1beta1/txs/${HASH}`]);
  });

  it('tells "not indexed yet" from an outage', async () => {
    expect(await fetchTx(HASH, fakeChain(() => ({ status: 404, body: { code: 5, message: 'tx not found' } })))).toEqual({ kind: 'not_found' });
    expect(await fetchTx(HASH, fakeChain(() => ({ status: 400, body: { code: 5 } })))).toEqual({ kind: 'not_found' });
    expect(await fetchTx(HASH, fakeChain(() => ({ status: 502, body: null })))).toEqual({ kind: 'unreachable' });
    expect(await fetchTx(HASH, fakeChain(() => 'down'))).toEqual({ kind: 'unreachable' });
  });
});

class FakeStore implements DuckPassStore {
  passes = new Map<string, DuckPassView>();
  owners = new Map<string, string>();
  linkCalls: unknown[][] = [];
  async duckPassOf(_db: Sql, accountId: string) {
    return this.passes.get(accountId) ?? null;
  }
  async walletOwner(_db: Sql, address: string) {
    return this.owners.get(address) ?? null;
  }
  async duckTag(_db: Sql, accountId: string, duckId: string) {
    return accountId === ACC && duckId === DUCK ? '4821' : null;
  }
  async season() {
    return 's1';
  }
  async link(_db: Sql, accountId: string, address: string, txHash: string, season: string): Promise<LinkResult> {
    this.linkCalls.push([accountId, address, txHash, season]);
    if (this.owners.has(address)) return 'taken';
    this.owners.set(address, accountId);
    this.passes.set(accountId, { address, txHash, season, linkedAt: '2026-11-14T10:25:25.000Z' });
    return 'ok';
  }
  async unlink(_db: Sql, accountId: string) {
    const p = this.passes.get(accountId);
    if (p) this.owners.delete(p.address);
    return this.passes.delete(accountId);
  }
}

describe('Duck Pass service', () => {
  let store: FakeStore;
  let now: number;
  let chainAnswer: () => { status: number; body: unknown } | 'down';
  let svc: DuckPassService;

  beforeEach(() => {
    store = new FakeStore();
    now = 1_790_000_000_000;
    chainAnswer = () => ({ status: 404, body: { code: 5 } });
    svc = new DuckPassService({ store, fetch: fakeChain(() => chainAnswer()), now: () => now });
  });

  async function challenge(address = TEST_ADDRESS): Promise<DuckPassChallenge> {
    const r = await svc.challenge(db, ACC, { address, duckId: DUCK });
    expect(r.status).toBe(200);
    return r.body as DuckPassChallenge;
  }
  /** The chain answers with a proof of `memo` (and any overrides). */
  function chainHas(memo: string, over: Parameters<typeof proofTx>[0] = {}): void {
    chainAnswer = () => ({ status: 200, body: proofTx({ memo, hash: HASH, ...over }) });
  }

  it('hands out the exact QoreX request: 1 uqor to self, the memo, testnet, gas', async () => {
    const c = await challenge();
    expect(c.chainId).toBe(DUCK_PASS_CHAIN_ID);
    expect(c.gasLimit).toBe('250000');
    expect(c.feeUqor).toBe(37_500);
    expect(c.expiresAt).toBe(now + DUCK_PASS_CHALLENGE_MS);
    expect(c.messages).toEqual([{ typeUrl: '/cosmos.bank.v1beta1.MsgSend', value: 'Cipxb3IxNGVoY2F5a3ZlbmpjeXF1ZHJhYzVqaGZldjhhNDBtOWc1cjN0emYSKnFvcjE0ZWhjYXlrdmVuamN5cXVkcmFjNWpoZmV2OGE0MG05ZzVyM3R6ZhoJCgR1cW9yEgEx' }]);
    const memo = parseDuckPassMemo(c.memo);
    expect(memo).toMatchObject({ season: 's1', tag: '4821' });
    // A fresh random nonce every time.
    const again = await challenge();
    expect(parseDuckPassMemo(again.memo)!.nonce).not.toBe(memo!.nonce);
  });

  it('refuses bad input, someone else\'s duck, a linked account and a wallet another account holds', async () => {
    expect((await svc.challenge(db, ACC, { address: 'qor1nope', duckId: DUCK })).body).toEqual({ error: 'qorex_address' });
    expect((await svc.challenge(db, ACC, { address: TEST_ADDRESS, duckId: 'x' })).body).toEqual({ error: 'bad_request' });
    expect((await svc.challenge(db, OTHER_ACC, { address: TEST_ADDRESS, duckId: DUCK })).status).toBe(404);
    store.owners.set(TEST_ADDRESS, OTHER_ACC);
    expect((await svc.challenge(db, ACC, { address: TEST_ADDRESS, duckId: DUCK })).body).toEqual({ error: 'qorex_taken' });
    store.passes.set(ACC, { address: OTHER_WALLET, txHash: HASH, season: 's1', linkedAt: '' });
    expect((await svc.challenge(db, ACC, { address: TEST_ADDRESS, duckId: DUCK })).body).toEqual({ error: 'qorex_linked' });
  });

  it('links after the chain shows a valid hybrid proof, once', async () => {
    const c = await challenge();
    expect(await svc.verify(db, ACC, { txHash: HASH })).toEqual({ status: 202, body: { status: 'pending' } });
    chainHas(c.memo);
    const r = await svc.verify(db, ACC, { txHash: HASH.toLowerCase() });
    expect(r).toEqual({ status: 200, body: { status: 'linked', duckPass: { address: TEST_ADDRESS, txHash: HASH, season: 's1', linkedAt: '2026-11-14T10:25:25.000Z' } } });
    expect(store.linkCalls).toEqual([[ACC, TEST_ADDRESS, HASH, 's1']]);
    // Single use: the same proof again finds no open challenge.
    expect((await svc.verify(db, ACC, { txHash: HASH })).body).toEqual({ error: 'qorex_expired' });
  });

  it('expires challenges', async () => {
    const c = await challenge();
    chainHas(c.memo);
    now += DUCK_PASS_CHALLENGE_MS;
    expect(await svc.verify(db, ACC, { txHash: HASH })).toEqual({ status: 410, body: { error: 'qorex_expired' } });
  });

  it('binds the nonce to this account: another account cannot use the proof', async () => {
    const c = await challenge();
    chainHas(c.memo);
    expect((await svc.verify(db, OTHER_ACC, { txHash: HASH })).body).toEqual({ error: 'qorex_expired' });
    expect(store.linkCalls).toEqual([]);
  });

  it('refuses a proof whose memo, wallet, result or hybrid layer is wrong, and ends the challenge', async () => {
    const cases: [Parameters<typeof proofTx>[0] | 'memo', string][] = [
      ['memo', 'qorex_memo_mismatch'],
      [{ code: 11 }, 'qorex_tx_failed'],
      [{ ext: false }, 'qorex_no_hybrid'],
      [{ hybrid: 'failed' }, 'qorex_no_hybrid'],
      [{ from: OTHER_WALLET }, 'qorex_signer_mismatch'],
      [{ to: OTHER_WALLET }, 'qorex_not_self_send'],
    ];
    for (const [over, error] of cases) {
      now += 150_000; // past the per-account challenge limit's refill
      const c = await challenge();
      if (over === 'memo') chainHas(c.memo.replace(/:[^:]+$/, ':ZZZZZZZZZZZZZZZZ'));
      else chainHas(c.memo, over);
      expect((await svc.verify(db, ACC, { txHash: HASH })).body, error).toEqual({ error });
      expect((await svc.verify(db, ACC, { txHash: HASH })).body, `${error} ends it`).toEqual({ error: 'qorex_expired' });
    }
    expect(store.linkCalls).toEqual([]);
  });

  it('refuses a body that names the wallet but was signed by another key', async () => {
    const c = await challenge();
    chainAnswer = () => {
      const tx = proofTx({ memo: c.memo, hash: HASH });
      tx.tx.auth_info.signer_infos[0]!.public_key.key = otherKey();
      return { status: 200, body: tx };
    };
    expect((await svc.verify(db, ACC, { txHash: HASH })).body).toEqual({ error: 'qorex_signer_mismatch' });
    expect(store.linkCalls).toEqual([]);
  });

  it('keeps the challenge through a chain outage', async () => {
    const c = await challenge();
    chainAnswer = () => 'down';
    expect(await svc.verify(db, ACC, { txHash: HASH })).toEqual({ status: 503, body: { error: 'chain_unreachable' } });
    chainHas(c.memo);
    expect((await svc.verify(db, ACC, { txHash: HASH })).status).toBe(200);
  });

  it('answers a wallet taken meanwhile with qorex_taken', async () => {
    const c = await challenge();
    chainHas(c.memo);
    store.owners.set(TEST_ADDRESS, OTHER_ACC);
    expect((await svc.verify(db, ACC, { txHash: HASH })).body).toEqual({ error: 'qorex_taken' });
  });

  it('checks the hash shape before anything else', async () => {
    expect((await svc.verify(db, ACC, { txHash: 'nope' })).body).toEqual({ error: 'bad_request' });
    expect((await svc.verify(db, ACC, {})).body).toEqual({ error: 'bad_request' });
  });

  it('rate-limits challenges per account', async () => {
    for (let i = 0; i < DUCK_PASS_LIMITS.challenge.capacity; i++) await challenge();
    const r = await svc.challenge(db, ACC, { address: TEST_ADDRESS, duckId: DUCK });
    expect(r.status).toBe(429);
    expect(r.headers?.['Retry-After']).toBeDefined();
  });

  it('unlinks: the wallet can be linked again later', async () => {
    const c = await challenge();
    chainHas(c.memo);
    await svc.verify(db, ACC, { txHash: HASH });
    expect(await svc.unlink(db, ACC)).toEqual({ status: 200, body: { ok: true } });
    expect(store.passes.size).toBe(0);
    expect((await svc.challenge(db, ACC, { address: TEST_ADDRESS, duckId: DUCK })).status).toBe(200);
  });
});

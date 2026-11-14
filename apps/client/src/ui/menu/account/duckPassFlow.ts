/**
 * Duck Pass in the menu, without the DOM: find QoreX, run the link flow and
 * turn every wallet or server stop into a fixed reason the card has copy for.
 * Raw wallet or chain text never reaches the screen.
 *
 * The flow: QoreX `getKey` (connects the site if needed) for the wallet
 * address, the server's challenge for that address and the active duck, then
 * QoreX `signAndBroadcast` (QoreX 0.3.5 or newer: it shows the transaction,
 * adds its ML-DSA-87 layer, signs and broadcasts; the page never sees a key
 * or a signature), then the server checks the hash on chain, polling while
 * the transaction is not indexed yet.
 *
 * Wallet error texts are QoreX's, as recorded in qwakk-app
 * `lib/qwakk-tx-copy.ts` (QoreX 0.3.5 to 0.3.9); `@qorechain/qorex-types`
 * 0.1.0 throws `QorexIntegrationError` codes for a missing or old QoreX.
 */
import {
  getQorexNative,
  hasCapability,
  isQorexIntegrationError,
  qorexSignAndBroadcast,
  type QorexNativeProvider,
  type QorexShieldState,
} from '@qorechain/qorex-types';
import { DUCK_PASS_CHAIN_ID, isQorAddress, isTxHash, type DuckPassChallenge, type DuckPassVerifyResult, type DuckPassView } from '@qwakk/shared/duck-pass';
import { ApiError } from '../api.ts';

/** Why the flow stopped; each has a line in `COPY.duckPass.errors`, server codes included. */
export type WalletStop = 'missing' | 'outdated' | 'network' | 'declined' | 'locked' | 'pending' | 'account' | 'funds' | 'chain' | 'onchain' | 'pqc' | 'busy' | 'other';

/** QoreX here, and new enough for Duck Pass? */
export function qorexState(native: Pick<QorexNativeProvider, 'capabilities' | 'signAndBroadcast'> | undefined = getQorexNative()): 'missing' | 'outdated' | 'ready' {
  if (!native) return 'missing';
  return hasCapability(native, 'signAndBroadcast') && typeof native.signAndBroadcast === 'function' ? 'ready' : 'outdated';
}

/** Map a QoreX error to a fixed reason. Only the reason leaves this function. */
export function walletStop(error: unknown): WalletStop {
  if (isQorexIntegrationError(error, 'QOREX_NOT_INSTALLED')) return 'missing';
  if (isQorexIntegrationError(error, 'QOREX_NOT_SUPPORTED_YET')) return 'outdated';
  const raw = error instanceof Error ? error.message : String(error);
  const m = raw.toLowerCase();
  // CheckTx refusal: "Transaction rejected by the network (<codespace> <code>): <log>".
  const refused = /rejected by the network \(([a-z0-9_]+) (\d+)\)/i.exec(raw);
  if (refused) {
    const space = refused[1]!.toLowerCase();
    const code = Number(refused[2]);
    if (space === 'sdk' && code === 5) return 'funds';
    if (space === 'sdk' && code === 32) return 'busy';
    if (space === 'pqc') return 'pqc';
    return 'chain';
  }
  if (m.includes('failed on-chain')) return 'onchain';
  if (m.includes('rejected')) return 'declined';
  if (/(?<!un)locked/.test(m)) return 'locked';
  if (m.includes('already waiting for your answer') || m.includes('requests are waiting')) return 'pending';
  if (m.includes('changed while this request was waiting') || m.includes('refusing to sign') || m.includes('unknown signer')) return 'account';
  if (m.includes('active network') || m.includes('unsupported chain')) return 'network';
  if (m.includes('requires an updated wallet')) return 'outdated';
  if (m.includes('pqc key registration failed')) return 'pqc';
  if (m.includes('too many transactions')) return 'busy';
  if (m.includes('insufficient funds')) return 'funds';
  return 'other';
}

/** 37,500 uqor as "0.0375": integer uqor to a decimal QOR string, QOR has 6 decimals. */
export function uqorToQor(uqor: number): string {
  const whole = Math.floor(uqor / 1_000_000);
  const frac = String(uqor % 1_000_000).padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

export type FlowStep = 'connecting' | 'preparing' | 'signing' | 'checking';

export type FlowResult =
  | { kind: 'linked'; duckPass: DuckPassView; shield: QorexShieldState | string | null }
  /** The chain has not shown the transaction yet; check again with the hash. */
  | { kind: 'waiting'; txHash: string }
  /** `reason` is a WalletStop or a server error code; `txHash` when a transaction went out. */
  | { kind: 'stopped'; reason: string; txHash?: string };

export interface FlowDeps {
  native: Pick<QorexNativeProvider, 'getKey' | 'signAndBroadcast'>;
  challenge(address: string): Promise<DuckPassChallenge>;
  verify(txHash: string): Promise<DuckPassVerifyResult>;
  onStep(step: FlowStep): void;
  sleep?(ms: number): Promise<void>;
}

/** Poll the server while the chain has not indexed the transaction: every 2.5 s for about a minute. */
export const POLL_MS = 2500;
export const POLL_TRIES = 24;

const sleeper = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const apiStop = (err: unknown): string => (err instanceof ApiError ? err.code : 'generic');

/** Ask the server about `txHash` until it is linked, refused, or the tries run out. */
export async function checkProof(deps: Pick<FlowDeps, 'verify' | 'sleep'>, txHash: string, shield: QorexShieldState | string | null = null): Promise<FlowResult> {
  const sleep = deps.sleep ?? sleeper;
  for (let i = 0; i < POLL_TRIES; i++) {
    let r: DuckPassVerifyResult;
    try {
      r = await deps.verify(txHash);
    } catch (err) {
      // An outage is not the player's fault: keep the hash so they can check again.
      if (err instanceof ApiError && (err.code === 'chain_unreachable' || err.code === 'unreachable' || err.code === 'rate_limited')) return { kind: 'waiting', txHash };
      return { kind: 'stopped', reason: apiStop(err), txHash };
    }
    if (r.status === 'linked') return { kind: 'linked', duckPass: r.duckPass, shield };
    await sleep(POLL_MS);
  }
  return { kind: 'waiting', txHash };
}

/** The whole link flow. Never throws: every stop comes back as a result. */
export async function linkWallet(deps: FlowDeps): Promise<FlowResult> {
  deps.onStep('connecting');
  let address: string;
  try {
    const key = await deps.native.getKey(DUCK_PASS_CHAIN_ID);
    address = typeof key?.bech32Address === 'string' ? key.bech32Address.trim() : '';
  } catch (err) {
    return { kind: 'stopped', reason: walletStop(err) };
  }
  if (!isQorAddress(address)) return { kind: 'stopped', reason: 'other' };

  deps.onStep('preparing');
  let ch: DuckPassChallenge;
  try {
    ch = await deps.challenge(address);
  } catch (err) {
    return { kind: 'stopped', reason: apiStop(err) };
  }

  deps.onStep('signing');
  let txHash: string;
  let shield: string | null;
  try {
    const r = await qorexSignAndBroadcast({ chainId: ch.chainId, messages: ch.messages, memo: ch.memo, gasLimit: ch.gasLimit }, { native: deps.native });
    txHash = typeof r?.txHash === 'string' ? r.txHash.toUpperCase() : '';
    shield = typeof r?.shield === 'string' ? r.shield : null;
    if (!isTxHash(txHash)) return { kind: 'stopped', reason: 'other' };
    if (r.code !== 0) return { kind: 'stopped', reason: 'onchain', txHash };
  } catch (err) {
    return { kind: 'stopped', reason: walletStop(err) };
  }

  deps.onStep('checking');
  return checkProof(deps, txHash, shield);
}

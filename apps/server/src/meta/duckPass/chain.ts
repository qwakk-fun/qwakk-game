/**
 * Reads one transaction from Diana's public REST
 * (`GET /cosmos/tx/v1beta1/txs/{hash}`). Only this path and only GET: the
 * server never broadcasts, never signs and holds no key. Tests pass a fake
 * fetch and never reach the chain.
 */
import { DUCK_PASS_REST_URL } from '@qwakk/shared/duck-pass';

export type ChainFetch = (url: string, init: { method: 'GET'; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type TxLookup = { kind: 'found'; body: unknown } | { kind: 'not_found' } | { kind: 'unreachable' };

const TIMEOUT_MS = 8000;

/** `not_found` while the node has not indexed the hash yet (404, or the SDK's code 5 answer). */
export async function fetchTx(hash: string, fetchImpl: ChainFetch = fetch as unknown as ChainFetch, restUrl = DUCK_PASS_REST_URL): Promise<TxLookup> {
  let res: Awaited<ReturnType<ChainFetch>>;
  try {
    res = await fetchImpl(`${restUrl}/cosmos/tx/v1beta1/txs/${hash.toUpperCase()}`, { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { kind: 'unreachable' };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    return { kind: 'unreachable' };
  }
  if (res.ok) return { kind: 'found', body };
  const code = body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined;
  if (res.status === 404 || code === 5) return { kind: 'not_found' };
  return { kind: 'unreachable' };
}

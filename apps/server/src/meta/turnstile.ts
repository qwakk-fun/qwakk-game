/**
 * Cloudflare Turnstile check for guest creation. Only runs when
 * TURNSTILE_SECRET is set; tests pass a fake `fetch` and never reach Cloudflare.
 */
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export type FetchLike = (url: string, init: { method: string; body: URLSearchParams; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export async function verifyTurnstile(secret: string, token: unknown, ip: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<boolean> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip && ip !== 'unknown') body.set('remoteip', ip);
  try {
    const res = await fetchImpl(SITEVERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: unknown };
    return data.success === true;
  } catch (err) {
    console.error('[meta] turnstile verify failed:', err instanceof Error ? err.message : err);
    return false;
  }
}

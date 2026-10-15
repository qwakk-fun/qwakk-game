/**
 * Points for one match, the same formula as the server's
 * `apps/server/src/meta/score.ts` (a test keeps them equal). Used to show
 * "+N points" right away from the game's summary, instead of waiting for the
 * server to record the match.
 */
export function matchPoints(mode: 'br' | 'dm', placement: number, field: number, kills: number): number {
  const n = Math.max(2, Math.floor(field));
  const place = Math.min(n, Math.max(1, Math.floor(placement)));
  const placePts = Math.round((50 * (n - place)) / (n - 1));
  const win = place === 1 ? 50 : 0;
  const killPts = 10 * Math.min(20, Math.max(0, Math.floor(kills)));
  return Math.round((placePts + win + killPts) * (mode === 'br' ? 1 : 0.5));
}

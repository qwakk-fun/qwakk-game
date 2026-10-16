/**
 * Leaderboard points for one match. Stored per player in match_players.points
 * (with the raw stats, so a new formula can be recomputed later); the season
 * score is the sum.
 *
 *   field     = everyone in the match, bots included (at least 2); in a team
 *               battle royale the teams in the match (8 duos, 4 squads)
 *   placement = 50 * (field - place) / (field - 1), rounded   (winner 50, last 0);
 *               team modes: the team's place, the same for every member
 *   win bonus = 50 for first place
 *   kills     = 10 per kill, counting at most 20 kills per match
 *   points    = (placement + win bonus + kills) * mode weight
 *   weight    = 1 for battle royale, 0.5 for deathmatch (warm-up mode)
 *
 * Example: winning a 32-duck royale with 6 kills = 50 + 50 + 60 = 160 points.
 * A duo that wins with 3 kills of your own: 50 + 50 + 30 = 130 points each
 * (kills count per duck).
 * Bots never score (they are stored but excluded from the leaderboard).
 */
export const SCORE = {
  placementMax: 50,
  winBonus: 50,
  perKill: 10,
  killCap: 20,
  weight: { br: 1, dm: 0.5 },
} as const;

export function matchPoints(mode: 'br' | 'dm', placement: number, field: number, kills: number): number {
  const n = Math.max(2, Math.floor(field));
  const place = Math.min(n, Math.max(1, Math.floor(placement)));
  const placePts = Math.round((SCORE.placementMax * (n - place)) / (n - 1));
  const win = place === 1 ? SCORE.winBonus : 0;
  const killPts = SCORE.perKill * Math.min(SCORE.killCap, Math.max(0, Math.floor(kills)));
  return Math.round((placePts + win + killPts) * SCORE.weight[mode]);
}

/** Kills per death, with deaths floored at 1 (a flawless run counts its kills). */
export function kdRatio(kills: number, deaths: number): number {
  return Math.round((kills / Math.max(1, deaths)) * 100) / 100;
}

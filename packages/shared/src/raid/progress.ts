/**
 * Duck progress: XP and levels. Hunt Season is the mode that gives XP; the
 * game server grants it at the end of a run (never from a client message) and
 * stores it on the duck (`players.xp`, `players.level`). Levels are
 * cosmetic progress only: they never give power in any mode (CLAUDE.md
 * product rule), so the deathmatch and the battle royale stay fair.
 *
 * Pure: the menu reads this module (`@qwakk/shared/progress`) for the level
 * bar, the server for the grant.
 */

/** Highest level for now. */
export const LEVEL_CAP = 50;

/** XP needed to go from `level` to the next one: 100 * level^1.5, rounded. */
export function xpToNext(level: number): number {
  const n = Math.max(1, Math.floor(level));
  return Math.round(100 * n ** 1.5);
}

/** Total XP a duck needs to be at `level` (level 1 needs none). */
export function xpForLevel(level: number): number {
  const L = Math.max(1, Math.min(LEVEL_CAP, Math.floor(level)));
  let sum = 0;
  for (let n = 1; n < L; n++) sum += xpToNext(n);
  return sum;
}

/** The level a total XP is worth (1 to LEVEL_CAP). */
export function levelOfXp(xp: number): number {
  const total = Math.max(0, Math.floor(Number.isFinite(xp) ? xp : 0));
  let level = 1;
  let need = 0;
  while (level < LEVEL_CAP) {
    need += xpToNext(level);
    if (total < need) break;
    level++;
  }
  return level;
}

/** Where a total XP stands: its level, XP into that level, the XP the level needs (0 at the cap) and the share done. */
export function levelProgress(xp: number): { level: number; into: number; need: number; share: number } {
  const level = levelOfXp(xp);
  if (level >= LEVEL_CAP) return { level, into: 0, need: 0, share: 1 };
  const into = Math.max(0, Math.floor(xp) - xpForLevel(level));
  const need = xpToNext(level);
  return { level, into, need, share: Math.min(1, into / need) };
}

/**
 * Hunt Season XP for one duck's run. Tuned for Pond Keep (v2: 10 short
 * waves, about 8 to 10 minutes): a full solo win with every hunter bagged is
 * about 2,450 XP, as much as a 15 wave v1 win (about 2,400 in 12 to 18
 * minutes), so a minute of hunting is worth more than before.
 */
export const RAID_XP = {
  /** Every wave cleared while the duck was in the run. */
  perWave: 60,
  /** Later waves are worth more: this much extra per wave number (wave 10 gives 60 + 9 * 8). */
  perWaveStep: 8,
  perKill: 4,
  /** A boss down, for every duck that hit it. */
  perBossKill: 150,
  /** A knocked duck brought back up. */
  perRevive: 15,
  /** All 10 waves held. */
  win: 400,
  /** Most XP one run can give (a sanity cap; a full four-duck win is far below it). */
  maxPerRun: 5000,
} as const;

export interface RaidXpInput {
  /** Waves the duck saw through to the end (in order: the wave numbers 1..n). */
  wavesCleared: number;
  /** The first wave the duck was there for (late joiners: wave 1 for everyone so far). */
  firstWave?: number;
  kills: number;
  bossKills: number;
  revives: number;
  won: boolean;
}

/** XP for one duck's run (server only grants it; the client shows the same number back). */
export function raidXp(r: RaidXpInput): number {
  const first = Math.max(1, Math.floor(r.firstWave ?? 1));
  const cleared = Math.max(0, Math.floor(r.wavesCleared));
  let xp = 0;
  for (let w = first; w < first + cleared; w++) xp += RAID_XP.perWave + RAID_XP.perWaveStep * (w - 1);
  xp += RAID_XP.perKill * Math.max(0, Math.floor(r.kills));
  xp += RAID_XP.perBossKill * Math.max(0, Math.floor(r.bossKills));
  xp += RAID_XP.perRevive * Math.max(0, Math.floor(r.revives));
  if (r.won) xp += RAID_XP.win;
  return Math.min(RAID_XP.maxPerRun, xp);
}

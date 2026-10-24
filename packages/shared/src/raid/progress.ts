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
 * Hunt Season XP for one duck's run (v3, the push: four objectives, about
 * 10 to 12 minutes solo). A full solo win (every objective, a couple of
 * hundred minions, a few dozen elites, the Big Hunter, a decent combo) is
 * about 2,400 XP, like a v2 win.
 */
export const RAID_XP = {
  /** Objective n (1-based) cleared while the duck was in the run: perObjective + perObjectiveStep * (n - 1). */
  perObjective: 150,
  perObjectiveStep: 50,
  /** An elite or any other hunter bagged (not a minion). */
  perKill: 5,
  /** A minion bagged (Beater, Recruit). */
  perMinion: 2,
  /** The Big Hunter down, for every duck that hit him. */
  perBossKill: 200,
  /** A knocked duck brought back up. */
  perRevive: 15,
  /** All four objectives taken. */
  win: 500,
  /** The combo bonus is at most this much of the kill XP it rode on (the server adds it up as `comboXp`). */
  comboMax: 0.5,
  /** Most XP one run can give (a sanity cap). */
  maxPerRun: 5000,
} as const;

export interface RaidXpInput {
  /** Objectives the duck saw through (in order: 1..n). The database calls them waves (v2). */
  wavesCleared: number;
  /** The first objective the duck was there for (1 for everyone so far: the room locks at the start). */
  firstWave?: number;
  /** Hunters bagged that are not minions (elites, snipers, dogs). */
  kills: number;
  /** Minions bagged. */
  minionKills?: number;
  bossKills: number;
  revives: number;
  /** The combo bonus the server added up kill by kill (comboBonus), at most comboMax of the kill XP. */
  comboXp?: number;
  won: boolean;
}

/** The combo multiplier on a kill's XP at a combo count: 1% a hit, at most +50%. */
export function comboBonus(killXp: number, combo: number): number {
  return killXp * Math.min(RAID_XP.comboMax, Math.max(0, Math.floor(combo)) * 0.01);
}

/** XP for one duck's run (the server grants it, from its own numbers; the client shows the same number back). */
export function raidXp(r: RaidXpInput): number {
  const first = Math.max(1, Math.floor(r.firstWave ?? 1));
  const cleared = Math.max(0, Math.floor(r.wavesCleared));
  let xp = 0;
  for (let w = first; w < first + cleared; w++) xp += RAID_XP.perObjective + RAID_XP.perObjectiveStep * (w - 1);
  const kills = RAID_XP.perKill * Math.max(0, Math.floor(r.kills)) + RAID_XP.perMinion * Math.max(0, Math.floor(r.minionKills ?? 0));
  xp += kills;
  xp += Math.min(Math.round(kills * RAID_XP.comboMax), Math.max(0, Math.floor(r.comboXp ?? 0)));
  xp += RAID_XP.perBossKill * Math.max(0, Math.floor(r.bossKills));
  xp += RAID_XP.perRevive * Math.max(0, Math.floor(r.revives));
  if (r.won) xp += RAID_XP.win;
  return Math.min(RAID_XP.maxPerRun, xp);
}

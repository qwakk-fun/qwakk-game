/**
 * The wave director's math: how many hunters of each kind a wave sends, how
 * tough they are, and how the run scales with the number of ducks. Pure
 * (unit tested); the server's director (apps/server/src/raid/hunts.ts)
 * spawns from it.
 *
 * Hunt Season v2 (Pond Keep): 10 short waves of many light hunters, the Big
 * Hunter on waves 3, 6 and 10, snipers from wave 2.
 */
import { HunterKind } from './hunters.ts';
import { isBossWave, RAID } from './constants.ts';

export interface WaveComposition {
  rifleman: number;
  trapper: number;
  decoy: number;
  /** Dogs come in packs of three. */
  dog: number;
  /** Long rifles on the watchtowers and hills (at most MAX_SNIPERS a wave; the server also caps them by free perches). */
  sniper: number;
  boss: number;
}

/** Most snipers one wave sends. */
export const MAX_SNIPERS = 4;

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(v)));

/** Count scale for the number of ducks: one duck 1, four ducks 2.5. */
export function duckCountScale(ducks: number): number {
  return 1 + 0.5 * (clampInt(ducks, 1, RAID.maxDucks) - 1);
}

/**
 * Hunters per kind for wave `wave` (1 to 10) and `ducks` ducks (1 to 4).
 * Riflemen from wave 1, dog packs and snipers from wave 2, trappers from 3,
 * decoy throwers from 4; a boss wave sends 65% of the rest plus the Big
 * Hunter.
 */
export function waveComposition(wave: number, ducks: number): WaveComposition {
  const w = clampInt(wave, 1, RAID.waves);
  const k = duckCountScale(ducks) * (isBossWave(w) ? 0.65 : 1);
  const r = (v: number): number => Math.max(0, Math.round(v * k));
  return {
    rifleman: Math.max(1, r(3 + 0.9 * w)),
    dog: w >= 2 ? 3 * Math.max(1, r(0.6 + (w - 2) * 0.3)) : 0,
    trapper: w >= 3 ? Math.max(1, r(0.7 + (w - 3) * 0.35)) : 0,
    decoy: w >= 4 ? Math.max(1, r(0.7 + (w - 4) * 0.3)) : 0,
    sniper: w >= 2 ? Math.min(MAX_SNIPERS, Math.max(1, r(0.5 + (w - 2) * 0.3))) : 0,
    boss: isBossWave(w) ? 1 : 0,
  };
}

export function waveTotal(c: WaveComposition): number {
  return c.rifleman + c.trapper + c.decoy + c.dog + c.sniper + c.boss;
}

/** Base health per kind (wave 1, one duck): lighter than v1, there are more of them. The admin setting `raid.hunterHpScale` scales it. */
export const HUNTER_HP: Record<number, number> = {
  [HunterKind.Rifleman]: 60,
  [HunterKind.Trapper]: 85,
  [HunterKind.Decoy]: 55,
  [HunterKind.Dog]: 32,
  [HunterKind.Boss]: 1100,
  [HunterKind.Sniper]: 50,
};

/** Health multiplier: tougher by wave (6% each) and with more ducks (12% each; the boss 35% each). */
export function hunterHpScale(wave: number, ducks: number, kind: number): number {
  const w = clampInt(wave, 1, RAID.waves);
  const n = clampInt(ducks, 1, RAID.maxDucks);
  const perDuck = kind === HunterKind.Boss ? 0.35 : 0.12;
  return (1 + 0.06 * (w - 1)) * (1 + perDuck * (n - 1));
}

/** Seconds between two spawns of a wave (a dog pack counts as one): quicker in later waves. */
export function spawnGapSeconds(wave: number): number {
  const w = clampInt(wave, 1, RAID.waves);
  return Math.max(0.6, 1.8 - 0.12 * w);
}

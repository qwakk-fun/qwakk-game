/**
 * The wave director's math: how many hunters of each kind a wave sends, how
 * tough they are, and how the run scales with the number of ducks. Pure
 * (unit tested); the server's director (apps/server/src/raid/director.ts)
 * spawns from it.
 */
import { HunterKind } from './hunters.ts';
import { isBossWave, RAID } from './constants.ts';

export interface WaveComposition {
  rifleman: number;
  trapper: number;
  decoy: number;
  /** Dogs come in packs of three. */
  dog: number;
  boss: number;
}

const clampInt = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.floor(v)));

/** Count scale for the number of ducks: one duck 1, four ducks 2.5. */
export function duckCountScale(ducks: number): number {
  return 1 + 0.5 * (clampInt(ducks, 1, RAID.maxDucks) - 1);
}

/**
 * Hunters per kind for wave `wave` (1 to 15) and `ducks` ducks (1 to 4).
 * Riflemen from wave 1, dog packs from wave 2, trappers from 3, decoy
 * throwers from 4; a boss wave sends 60% of the rest plus the Big Hunter.
 */
export function waveComposition(wave: number, ducks: number): WaveComposition {
  const w = clampInt(wave, 1, RAID.waves);
  const k = duckCountScale(ducks) * (isBossWave(w) ? 0.6 : 1);
  const r = (v: number): number => Math.max(0, Math.round(v * k));
  return {
    rifleman: Math.max(1, r(2 + 0.6 * w)),
    dog: w >= 2 ? 3 * Math.max(1, r(0.5 + (w - 1) * 0.22)) : 0,
    trapper: w >= 3 ? Math.max(1, r(0.6 + (w - 3) * 0.3)) : 0,
    decoy: w >= 4 ? Math.max(1, r(0.6 + (w - 4) * 0.25)) : 0,
    boss: isBossWave(w) ? 1 : 0,
  };
}

export function waveTotal(c: WaveComposition): number {
  return c.rifleman + c.trapper + c.decoy + c.dog + c.boss;
}

/** Base health per kind (wave 1, one duck). The admin setting `raid.hunterHpScale` scales it. */
export const HUNTER_HP: Record<number, number> = {
  [HunterKind.Rifleman]: 90,
  [HunterKind.Trapper]: 120,
  [HunterKind.Decoy]: 80,
  [HunterKind.Dog]: 45,
  [HunterKind.Boss]: 1400,
};

/** Health multiplier: tougher by wave (4.5% each) and with more ducks (12% each; the boss 35% each). */
export function hunterHpScale(wave: number, ducks: number, kind: number): number {
  const w = clampInt(wave, 1, RAID.waves);
  const n = clampInt(ducks, 1, RAID.maxDucks);
  const perDuck = kind === HunterKind.Boss ? 0.35 : 0.12;
  return (1 + 0.045 * (w - 1)) * (1 + perDuck * (n - 1));
}

/** Seconds between two spawns of a wave (a dog pack counts as one): quicker in later waves. */
export function spawnGapSeconds(wave: number): number {
  const w = clampInt(wave, 1, RAID.waves);
  return Math.max(0.7, 2.2 - 0.1 * w);
}

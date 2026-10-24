/**
 * Hunt Season v3, the push: the run's objectives and the horde's math. Pure
 * (unit tested); the server's director (apps/server/src/raid/push.ts) places
 * the objectives on Pond Keep from the map's markup and spawns from these
 * numbers. The castle is the start: the ducks cut their way out across the
 * drawbridge and the field, one objective at a time, while packs of minions
 * charge them with tougher hunters (elites) among them.
 *
 *   1  the south-east trench: bag enough hunters in and around it
 *   2  the supply crates at the dugouts: smash them all
 *   3  the two southern watchtowers: take out their snipers
 *   4  the Big Hunter's camp at the end of the hunters' road: bring him down
 */
import type { HitShape } from '../hitbox.ts';
import { HunterKind } from './hunters.ts';
import { RAID } from './constants.ts';

export const Goal = {
  Trench: 1,
  Crates: 2,
  Towers: 3,
  Camp: 4,
} as const;

/** The objectives in run order (`RaidState.wave` is the 1-based index into this). */
export const GOALS: readonly number[] = [Goal.Trench, Goal.Crates, Goal.Towers, Goal.Camp];

export function goalAt(index: number): number {
  return GOALS[Math.max(0, Math.min(GOALS.length, Math.floor(index)) - 1)] ?? Goal.Trench;
}

/** Defaults of the server-only push numbers (admin settings `raid.push.*`). */
export const PUSH = {
  /** Hunters to bag around the trench (one duck; times duckScale). */
  trenchKills: 28,
  /** Kills count within this distance of the objective (m). */
  zoneRadius: 38,
  /** Supply crates and their health (one duck; health times 1 + 0.35 per extra duck). */
  crates: 3,
  crateHp: 150,
  /** Snipers on each southern watchtower, and the towers taken. */
  snipersPerTower: 2,
  towers: 2,
  /** Seconds between packs (one per objective), and packs alive at once at most. */
  packGap: [9, 7.5, 6.5, 6] as readonly number[],
  /** Minions per pack at the first objective and per later one (one duck; times duckScale), plus up to `packSpread` more. */
  packBase: 6,
  packStep: 0.7,
  packSpread: 3,
  /** Elites (the old hunter kinds, tougher, ringed) that escort a pack: chance of the first, of a second. */
  eliteFirst: 0.75,
  eliteSecond: 0.3,
} as const;

/** Count scale for the number of ducks: one duck 1, four ducks 2.5. */
export function duckScale(ducks: number): number {
  return 1 + 0.5 * (Math.max(1, Math.min(RAID.maxDucks, Math.floor(ducks))) - 1);
}

/** Minions in one pack for objective `goal` (1-based) and `ducks` ducks; `roll` in [0, 1). */
export function packSize(goal: number, ducks: number, roll: number): number {
  const g = Math.max(1, Math.min(GOALS.length, Math.floor(goal)));
  const base = (PUSH.packBase + PUSH.packStep * (g - 1)) * (1 + 0.35 * (Math.max(1, Math.min(RAID.maxDucks, ducks)) - 1));
  return Math.max(4, Math.min(16, Math.round(base + PUSH.packSpread * Math.max(0, Math.min(0.999, roll)))));
}

/** Elites escorting a pack (0 to 2, more with more ducks); `a`, `b` in [0, 1). */
export function packElites(goal: number, ducks: number, a: number, b: number): number {
  const extra = ducks >= 3 ? 1 : 0;
  // The first objective eases a solo duck in: fewer escorts.
  const first = PUSH.eliteFirst - (goal <= 1 && ducks <= 1 ? 0.25 : 0);
  return (a < first ? 1 : 0) + (b < PUSH.eliteSecond + 0.1 * (goal - 1) ? 1 : 0) + extra;
}

/** Which elite kinds an objective sends (the old hunters, in order of appearance). */
export function eliteKinds(goal: number): readonly number[] {
  if (goal <= 1) return [HunterKind.Rifleman, HunterKind.Dog];
  if (goal === 2) return [HunterKind.Rifleman, HunterKind.Trapper, HunterKind.Dog];
  return [HunterKind.Rifleman, HunterKind.Trapper, HunterKind.Decoy, HunterKind.Dog];
}

/** Base health per kind (the first objective, one duck). Minions fall to one or two light cuts; elites take a few. Admin setting `raid.hunterHpScale` scales it. */
export const HUNTER_HP: Record<number, number> = {
  [HunterKind.Rifleman]: 110,
  [HunterKind.Trapper]: 140,
  [HunterKind.Decoy]: 100,
  [HunterKind.Dog]: 55,
  [HunterKind.Boss]: 1800,
  [HunterKind.Sniper]: 70,
  [HunterKind.Beater]: 40,
  [HunterKind.Recruit]: 20,
};

/** Health multiplier: tougher with each objective (8%) and with more ducks (12% each; the boss 40% each). */
export function hunterHpScale(goal: number, ducks: number, kind: number): number {
  const g = Math.max(1, Math.min(GOALS.length, Math.floor(goal)));
  const n = Math.max(1, Math.min(RAID.maxDucks, Math.floor(ducks)));
  const perDuck = kind === HunterKind.Boss ? 0.4 : 0.12;
  return (1 + 0.08 * (g - 1)) * (1 + perDuck * (n - 1));
}

/** Kills the trench needs, crates and the crate health for `ducks` ducks. */
export function trenchKillsFor(ducks: number, base: number = PUSH.trenchKills): number {
  return Math.round(base * duckScale(ducks));
}

export function crateHpFor(ducks: number, base: number = PUSH.crateHp): number {
  return Math.round(base * (1 + 0.35 * (Math.max(1, Math.min(RAID.maxDucks, ducks)) - 1)));
}

/** A supply crate as a cut or a bullet sees it (and the client draws it): a squat box (RaidTarget kind 1). */
export const CRATE_SHAPE: HitShape = { head: [0, 0.95, 0.35], body: [0, 0.2, 0, 0.75, 0.6] };

/** `RaidTarget.kind` on the wire: a supply crate, a watchtower, the Big Hunter's camp. */
export const TargetKind = {
  Crate: 1,
  Tower: 2,
  Camp: 3,
} as const;

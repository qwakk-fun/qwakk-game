/**
 * Hunt Season progression, part 4: a duck's kit for one run (its level, the
 * gear it wears, its skill tree) and the numbers it adds up to, plus the Tüy
 * (Feathers) a run earns and the gentle difficulty scaling for strong ducks.
 *
 * The game server builds a kit from the database when a duck joins a Hunt
 * Season room (never from a client message) and applies `kitStats` in its
 * hit and damage paths. The deathmatch and the battle royale never build or
 * read a kit: levels, gear and the tree give no power there.
 *
 * Tüy is an in-game soft currency earned only by playing Hunt Season. It is
 * never sold for real money, never tradeable and never a token.
 */
import { gearById, STARTER_KATANA } from './gear.ts';
import { RAID_XP } from './progress.ts';
import { cleanTree, type TreeAlloc } from './tree.ts';
import { ALL_SKILLS, unlockBits } from './unlocks.ts';

export interface DuckKit {
  level: number;
  /** Equipped item ids (null: none). */
  katana: string;
  armor: string | null;
  tree: TreeAlloc;
  /** Unlock bits (unlocks.ts); normally `unlockBits(level)`. */
  unlocks: number;
}

/** A fresh duck: level 1, the bokken, no armor, no points spent. */
export function freshKit(level = 1): DuckKit {
  return { level, katana: STARTER_KATANA, armor: null, tree: {}, unlocks: unlockBits(level) };
}

/**
 * Bot ducks (tests, the benchmark) and dev identities without a token
 * (non-production only): every move, no gear, no tree, below the level
 * scaling. What Hunt Season was before progression.
 */
export function devKit(): DuckKit {
  return { level: 8, katana: STARTER_KATANA, armor: null, tree: {}, unlocks: ALL_SKILLS };
}

/** A kit from stored rows: unknown or wrong-slot items fall back, the tree is re-checked against the level. */
export function kitFrom(level: number, katana: string | null, armor: string | null, tree: TreeAlloc): DuckKit {
  const L = Math.max(1, Math.floor(level));
  const k = gearById(katana);
  const a = gearById(armor);
  const katanaOk = k && k.slot === 'katana' ? k.id : STARTER_KATANA;
  return { level: L, katana: katanaOk, armor: a && a.slot === 'armor' ? a.id : null, tree: cleanTree(tree, L), unlocks: unlockBits(L) };
}

/** What a kit adds up to (server-only numbers; 1 or 0 is "nothing"). */
export interface KitStats {
  /** Katana cuts (slashes, the heavy, storm pulses, the dash's cut): damage multiplier. */
  blade: number;
  /** Chance (0..1) that a katana cut that is not already a crit crits. */
  critChance: number;
  /** Added to the crit multiplier (raid.blade.crit). */
  critBonus: number;
  /** The server's sweep of a swing: reach multiplier. */
  reach: number;
  /** Slash 3 and the heavy spin: damage multiplier. */
  finisher: number;
  /** Extra max health. */
  hp: number;
  /** Hunter damage taken: multiplier (armor and the tree, multiplied). */
  taken: number;
  /** Chance (0..1) a hunter's hit misses the duck entirely. */
  dodge: number;
  /** The dash's cut: damage multiplier. */
  dash: number;
  /** Once per objective a knock-down blow leaves the duck at 1 health instead. */
  lastStand: boolean;
  /** The quack: radius, damage and stagger multipliers. */
  quackReach: number;
  quackDamage: number;
  quackStagger: number;
  /** Blade Storm: meter gain and pulse damage multipliers. */
  meter: number;
  storm: number;
  /** The quack heals the duck and every friend in its ring this much (0: no). */
  rally: number;
}

export const BASE_KIT_STATS: Readonly<KitStats> = { blade: 1, critChance: 0, critBonus: 0, reach: 1, finisher: 1, hp: 0, taken: 1, dodge: 0, dash: 1, lastStand: false, quackReach: 1, quackDamage: 1, quackStagger: 1, meter: 1, storm: 1, rally: 0 };

export function kitStats(kit: DuckKit): KitStats {
  const r = (id: string): number => Math.max(0, Math.floor(kit.tree[id] ?? 0));
  const k = gearById(kit.katana);
  const a = gearById(kit.armor);
  const blade = (k?.blade ?? 1) * (1 + 0.03 * r('edge'));
  const guard = a?.guard ?? 0;
  return {
    blade,
    critChance: (k?.crit ?? 0) + 0.02 * r('lucky'),
    critBonus: 0.25 * r('iaido'),
    reach: 1 + 0.04 * r('reach'),
    finisher: 1 + 0.1 * r('finisher'),
    hp: (a?.hp ?? 0) + 5 * r('feathers'),
    taken: (1 - guard) * (1 - 0.03 * r('tough')),
    dodge: 0.03 * r('sidestep'),
    dash: 1 + 0.25 * r('strike'),
    lastStand: r('laststand') > 0,
    quackReach: 1 + 0.08 * r('loud'),
    quackDamage: 1 + 0.2 * r('loud'),
    quackStagger: 1 + 0.3 * r('stun'),
    meter: 1 + 0.1 * r('heart'),
    storm: 1 + 0.15 * r('eye'),
    rally: r('rally') > 0 ? 10 : 0,
  };
}

/**
 * A rough single number for the balance doc and tests: effective damage
 * (light combo, front cuts, crits counted) and effective health (health over
 * damage taken, dodges counted) against a fresh duck's 1 and 1.
 */
export function kitPower(kit: DuckKit, critMult = 1.6): { damage: number; health: number; power: number } {
  const s = kitStats(kit);
  // The light combo: 24, 24 and a 42 finisher (raid.blade.slash defaults).
  const combo = (24 + 24 + 42 * s.finisher) / 90;
  const damage = s.blade * combo * (1 + s.critChance * (critMult + s.critBonus - 1));
  const health = (100 + s.hp) / 100 / s.taken / (1 - s.dodge);
  return { damage, health, power: Math.sqrt(damage * health) };
}

/** The `Msg.RaidKit` payload (to the duck itself): level, unlock bits, katana and armor tier, then the numbers its HUD shows. */
export function kitWire(kit: DuckKit, katanaTier: number, armorTier: number): number[] {
  const s = kitStats(kit);
  return [kit.level, kit.unlocks, katanaTier, armorTier, Math.round((s.blade - 1) * 100), Math.round(s.critChance * 100), s.hp, Math.round((1 - s.taken) * 100)];
}

// ---- Tüy (Feathers) -----------------------------------------------------------

/** What a Hunt Season run earns in Tüy (granted by the game server at the run's end, once per run id). */
export const FEATHERS = {
  /** Objective n (1-based) taken: perObjective + perObjectiveStep * (n - 1). */
  perObjective: 25,
  perObjectiveStep: 5,
  /** One Tüy for every this many minions bagged. */
  minionsPer: 5,
  /** An elite (or any hunter that is not a minion) bagged. */
  perKill: 1,
  /** The Big Hunter down (every duck that hit him). */
  perBoss: 25,
  /** All four objectives taken. */
  win: 50,
  /** The first run of the day (UTC) that took at least one objective. */
  daily: 50,
  /** Most one run can give (the daily bonus on top). */
  maxPerRun: 400,
} as const;

export interface FeatherInput {
  wavesCleared: number;
  firstWave?: number;
  kills: number;
  minionKills?: number;
  bossKills: number;
  won: boolean;
}

/** Tüy for one duck's run, without the daily bonus (the database adds it). */
export function raidFeathers(r: FeatherInput): number {
  const first = Math.max(1, Math.floor(r.firstWave ?? 1));
  const cleared = Math.max(0, Math.floor(r.wavesCleared));
  let f = 0;
  for (let w = first; w < first + cleared; w++) f += FEATHERS.perObjective + FEATHERS.perObjectiveStep * (w - 1);
  f += Math.floor(Math.max(0, Math.floor(r.minionKills ?? 0)) / FEATHERS.minionsPer);
  f += FEATHERS.perKill * Math.max(0, Math.floor(r.kills));
  f += FEATHERS.perBoss * Math.max(0, Math.floor(r.bossKills));
  if (r.won) f += FEATHERS.win;
  return Math.min(FEATHERS.maxPerRun, f);
}

// ---- difficulty for strong ducks ---------------------------------------------------

/**
 * Hunter health and damage grow gently with the party's average level above
 * level 10 (a fresh duck's runs are exactly as before): +1% health and +0.5%
 * damage per level, at most +25% and +12.5% (level 35). Admin settings
 * `raid.levelHpPercent` and `raid.levelDamagePercent` change the per-level
 * steps; the caps stay.
 */
export const LEVEL_SCALE = { from: 10, hpPercent: 1, damagePercent: 0.5, hpCap: 0.25, damageCap: 0.125 } as const;

export function levelScale(avgLevel: number, hpPercent: number = LEVEL_SCALE.hpPercent, damagePercent: number = LEVEL_SCALE.damagePercent): { hp: number; damage: number } {
  const over = Math.max(0, (Number.isFinite(avgLevel) ? avgLevel : 1) - LEVEL_SCALE.from);
  return { hp: 1 + Math.min(LEVEL_SCALE.hpCap, (over * Math.max(0, hpPercent)) / 100), damage: 1 + Math.min(LEVEL_SCALE.damageCap, (over * Math.max(0, damagePercent)) / 100) };
}

/** Re-exported so the menu needs one module for the end screen. */
export const XP_MAX_PER_RUN = RAID_XP.maxPerRun;

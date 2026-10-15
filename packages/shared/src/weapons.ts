/**
 * Every weapon number in one place. Shared by client (prediction, HUD,
 * crosshair) and server (authority). Angles in radians, times in ticks
 * (30 per second) unless the name says otherwise.
 */
import { TICK_RATE } from './constants.ts';

export const WeaponId = {
  Rifle: 0,
  Pistol: 1,
} as const;
export type WeaponId = (typeof WeaponId)[keyof typeof WeaponId];

export const WEAPON_COUNT = 2;

const deg = (d: number): number => (d * 3.141592653589793) / 180;
const ticks = (seconds: number): number => Math.round(seconds * TICK_RATE);

export interface WeaponStats {
  id: WeaponId;
  name: string;
  automatic: boolean;
  /** Ticks between shots (rifle: 3 ticks = 100 ms = 600 RPM). */
  fireTicks: number;
  magSize: number;
  reserve: number;
  reloadTicks: number;
  equipTicks: number;
  /** Body damage before falloff. */
  damage: number;
  headMultiplier: number;
  /** Full damage up to this range (m), then multiplied by `falloffPer10m` for every 10 m beyond. */
  fullDamageRange: number;
  falloffPer10m: number;
  minDamageScale: number;
  /** Inaccuracy (spread cone radius) standing still. First shots are this accurate. */
  spreadStand: number;
  spreadCrouch: number;
  /** Added at full run speed; scales from 0 at the accurate speed (counter-strafe payoff). */
  spreadMove: number;
  /** Added while airborne. */
  spreadAir: number;
  /** Added per shot of the current spray, capped by `spreadFireMax`. */
  spreadPerShot: number;
  spreadFireMax: number;
  /** Spray pattern: cumulative [pitchUp, yawRight] offset per shot index (rad). */
  pattern: readonly (readonly [number, number])[];
  /** Spray index recovered per tick without firing (recoil reset). */
  sprayRecoveryPerTick: number;
  /** Visual camera kick per shot (rad), client only. */
  viewKick: number;
}

/**
 * Rifle pattern, AK style and learnable: straight up for the first shots, then
 * a drift left, back right and left again. Cumulative degrees [up, right].
 */
const RIFLE_PATTERN_DEG: readonly (readonly [number, number])[] = [
  [0, 0], [0.35, 0.02], [0.85, 0.05], [1.45, 0.02], [2.1, -0.05],
  [2.7, -0.2], [3.2, -0.45], [3.55, -0.85], [3.8, -1.3], [3.95, -1.6],
  [4.05, -1.75], [4.1, -1.6], [4.15, -1.2], [4.2, -0.7], [4.25, -0.15],
  [4.3, 0.4], [4.33, 0.9], [4.36, 1.3], [4.38, 1.55], [4.4, 1.65],
  [4.42, 1.5], [4.44, 1.15], [4.46, 0.7], [4.47, 0.25], [4.48, -0.2],
  [4.49, -0.6], [4.5, -0.9], [4.5, -1.1], [4.5, -1.2], [4.5, -1.25],
];

/** Pistol: a small, steady climb. */
const PISTOL_PATTERN_DEG: readonly (readonly [number, number])[] = [
  [0, 0], [0.55, 0.05], [1.0, -0.05], [1.4, 0.08], [1.7, -0.05], [1.95, 0.05], [2.15, 0], [2.3, 0.05],
  [2.4, -0.05], [2.5, 0.05], [2.55, 0], [2.6, 0],
];

const toRad = (p: readonly (readonly [number, number])[]) => p.map(([a, b]) => [deg(a), deg(b)] as const);

export const WEAPONS: readonly WeaponStats[] = [
  {
    id: WeaponId.Rifle,
    name: 'Rifle',
    automatic: true,
    fireTicks: 3,
    magSize: 30,
    reserve: 90,
    reloadTicks: ticks(2.3),
    equipTicks: ticks(0.6),
    damage: 24,
    headMultiplier: 3.6,
    fullDamageRange: 40,
    falloffPer10m: 0.97,
    minDamageScale: 0.7,
    spreadStand: deg(0.2),
    spreadCrouch: deg(0.1),
    spreadMove: deg(4.5),
    spreadAir: deg(9),
    spreadPerShot: deg(0.12),
    spreadFireMax: deg(1.6),
    pattern: toRad(RIFLE_PATTERN_DEG),
    sprayRecoveryPerTick: 0.6,
    viewKick: deg(0.45),
  },
  {
    id: WeaponId.Pistol,
    name: 'Pistol',
    automatic: false,
    fireTicks: 6,
    magSize: 12,
    reserve: 48,
    reloadTicks: ticks(1.6),
    equipTicks: ticks(0.35),
    damage: 26,
    headMultiplier: 4,
    fullDamageRange: 15,
    falloffPer10m: 0.9,
    minDamageScale: 0.5,
    spreadStand: deg(0.15),
    spreadCrouch: deg(0.08),
    spreadMove: deg(2.6),
    spreadAir: deg(6),
    spreadPerShot: deg(0.25),
    spreadFireMax: deg(1.2),
    pattern: toRad(PISTOL_PATTERN_DEG),
    sprayRecoveryPerTick: 0.35,
    viewKick: deg(0.9),
  },
];

export function weaponStats(id: number): WeaponStats {
  return WEAPONS[id] ?? (WEAPONS[0] as WeaponStats);
}

export const COMBAT = {
  maxHp: 100,
  /** Respawn delay after death. */
  respawnTicks: ticks(3),
  /** Spawn protection: no damage taken; ends early when the player fires. */
  protectTicks: ticks(1.5),
  /** Below this fraction of run speed movement adds no inaccuracy (counter-strafe payoff). */
  accurateSpeedFraction: 0.34,
  /** Max range of a hitscan shot (m). */
  maxRange: 250,
  /** Lag compensation rewind cap (ms). */
  maxRewindMs: 230,
  /**
   * The rewind a player may claim is also bounded by what the SERVER measures:
   * half its round trip (WebSocket ping/pong, answered by the browser itself)
   * plus the interpolation delay plus this margin.
   */
  rewindMarginMs: 40,
  /** Ticks after a spawn during which the turn-rate clamp is off (the camera snaps to the spawn yaw). */
  spawnTurnGraceTicks: 15,
} as const;

/** Damage for a hit at `distance` meters. */
export function damageAt(w: WeaponStats, distance: number, head: boolean): number {
  const beyond = Math.max(0, distance - w.fullDamageRange);
  let scale = 1;
  // Exponent by repeated multiply keeps it exact and deterministic.
  const steps = beyond / 10;
  const whole = Math.floor(steps);
  for (let i = 0; i < whole; i++) scale *= w.falloffPer10m;
  scale *= 1 - (1 - w.falloffPer10m) * (steps - whole);
  scale = Math.max(scale, w.minDamageScale);
  return Math.round(w.damage * scale * (head ? w.headMultiplier : 1));
}

/** Shots needed to kill from full HP at short range. */
export function shotsToKill(w: WeaponStats, head: boolean): number {
  return Math.ceil(COMBAT.maxHp / damageAt(w, 0, head));
}

/** Time to kill in seconds (first shot at t = 0). */
export function timeToKill(w: WeaponStats, head: boolean): number {
  return ((shotsToKill(w, head) - 1) * w.fireTicks) / TICK_RATE;
}

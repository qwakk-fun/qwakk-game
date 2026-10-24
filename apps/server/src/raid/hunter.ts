/**
 * One hunter or dog on the server: its body, health, what it is doing and
 * the memory its brain keeps (brain.ts). Plus the per-kind numbers of how it
 * moves, sees and fights. Server only.
 */
import { HunterAct, HunterKind } from '@qwakk/shared';
import type { P3 } from '../nav/botNav.ts';
import { HunterMover } from './hunterMover.ts';

/** A raft ride across the moat (the drawbridge is up): from the lane's bank to the island, `t` meters along. */
export interface RaftRide {
  from: P3;
  to: P3;
  water: number;
  len: number;
  t: number;
}

export interface HunterAgent {
  id: string;
  serial: number;
  kind: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  maxHp: number;
  act: number;
  /** Brain phase and ticks left in it. */
  phase: 'advance' | 'move' | 'kneel' | 'aim' | 'fire' | 'reload' | 'throw' | 'tell' | 'whistle' | 'hammer';
  phaseTicks: number;
  mover: HunterMover;
  /** The duck it fights (seat id), or null. */
  targetId: string | null;
  /** Ticks since it last saw its target. */
  lostTicks: number;
  lastSeen: { x: number; y: number; z: number } | null;
  /** Aim: the point it tracks (lags the target), its error (settles while aiming), and a frozen yaw/pitch for the last moment of a telegraph. */
  aimAt: { x: number; y: number; z: number };
  errYaw: number;
  errPitch: number;
  reaction: number;
  shotsSinceMove: number;
  shotsSinceReload: number;
  /** Second barrel (boss) ticks, trap and throw cooldowns, the boss whistle. */
  barrel: number;
  trapCd: number;
  throwCd: number;
  whistleCd: number;
  /** Where it stands around the core (an angle), and its rifleman cover spot. */
  slot: number;
  cover: { x: number; y: number; z: number } | null;
  /** Defeated: ticks until the entry goes away. */
  downTicks: number;
  /** Seat ids that hurt it (boss kill XP) and the last one. */
  hurtBy: Set<string>;
  lastHitBy: string | null;
  bornTick: number;
  /** Ticks spent hammering the gate or the core. */
  hammerTicks: number;
  /** Ticks the Fire act stays up after a shot (the animation and the muzzle flash). */
  flash: number;
  /** Whistled up by the Big Hunter: worth no kill XP and drops nothing (no farming the boss's helpers). */
  helper: boolean;
  /** Paddling across the moat, or null. */
  raft: RaftRide | null;
  /** Knockback (m/s) from a bread loaf, fading out. */
  kx: number;
  kz: number;
  /** Ticks left dunked in the moat (the Big Hunter when the bridge rose under him): no brain meanwhile. */
  swim: number;
  /** Sniper: the perch it holds (index into the markup), -1 for none yet, -2 when none was free. */
  perch: number;
  /** A goal found out of reach (behind the gate, over a raised bridge) and the tick to try it again. */
  barred: { x: number; z: number; until: number } | null;
  /** Where it was at the last progress check and when it last got anywhere or fought (stuck hunters give up, hunts.ts). */
  checkX: number;
  checkZ: number;
  busyTick: number;
}

export interface KindNumbers {
  /** Advancing and running speed (m/s). */
  walk: number;
  run: number;
  /** Sight range (m), and the range it notices a duck whichever way it faces. */
  view: number;
  hear: number;
  /** Half angle of its view (cos). */
  fovCos: number;
  /** It fights a duck it sees within this range (m). */
  engage: number;
  /** It closes in to this range before firing (m). */
  close: number;
}

const cos = (deg: number): number => Math.cos((deg * Math.PI) / 180);

export const KIND: Record<number, KindNumbers> = {
  [HunterKind.Rifleman]: { walk: 3.0, run: 4.4, view: 70, hear: 8, fovCos: cos(70), engage: 60, close: 60 },
  [HunterKind.Trapper]: { walk: 3.4, run: 4.6, view: 40, hear: 8, fovCos: cos(70), engage: 22, close: 9 },
  [HunterKind.Decoy]: { walk: 3.1, run: 4.2, view: 45, hear: 8, fovCos: cos(70), engage: 26, close: 18 },
  [HunterKind.Dog]: { walk: 5.2, run: 6.4, view: 30, hear: 12, fovCos: cos(90), engage: 30, close: 1.6 },
  [HunterKind.Boss]: { walk: 2.6, run: 2.9, view: 45, hear: 10, fovCos: cos(80), engage: 36, close: 13 },
  [HunterKind.Sniper]: { walk: 3.0, run: 4.3, view: 160, hear: 10, fovCos: cos(85), engage: 150, close: 150 },
};

/** A gun's telegraph and shot (server only; damage before the admin scale). */
export interface GunNumbers {
  /** Aim (laser or wind-up) ticks before the shot, and the last ticks of it the aim stops tracking (a dodge window). */
  aimTicks: number;
  lockTicks: number;
  pellets: number;
  /** Pellet spread cone (rad), on top of the aim error and the rules' spread. */
  cone: number;
  damage: number;
  headMult: number;
  /** Full damage up to `near` (m), falling to `minScale` at `far`, nothing past `range`. */
  near: number;
  far: number;
  minScale: number;
  range: number;
  /** Ticks between shots (kneeling or idle) and the reload. */
  gap: [number, number];
  reloadEvery: number;
  reloadTicks: number;
  /** Boss: the second barrel follows this many ticks after the first. */
  second: number;
  /** Sniper: extra aim (telegraph) ticks per meter to the target: a longer wind-up at range. */
  aimPerMeter?: number;
}

export const GUN: Record<number, GunNumbers> = {
  [HunterKind.Rifleman]: { aimTicks: 27, lockTicks: 8, pellets: 1, cone: 0.006, damage: 13, headMult: 1.6, near: 40, far: 90, minScale: 0.6, range: 100, gap: [28, 52], reloadEvery: 5, reloadTicks: 54, second: 0 },
  [HunterKind.Trapper]: { aimTicks: 14, lockTicks: 5, pellets: 7, cone: 0.08, damage: 5, headMult: 1.2, near: 7, far: 20, minScale: 0, range: 22, gap: [34, 48], reloadEvery: 4, reloadTicks: 45, second: 0 },
  [HunterKind.Boss]: { aimTicks: 33, lockTicks: 10, pellets: 9, cone: 0.075, damage: 7, headMult: 1.2, near: 10, far: 32, minScale: 0, range: 34, gap: [18, 30], reloadEvery: 1, reloadTicks: 66, second: 8 },
  // 90 m: 30 + 23 = 53 ticks (1.8 s) of laser and glint, 140 m: 65 ticks (2.2 s); the last 12 frozen.
  [HunterKind.Sniper]: { aimTicks: 30, aimPerMeter: 0.25, lockTicks: 12, pellets: 1, cone: 0.003, damage: 26, headMult: 1.6, near: 170, far: 200, minScale: 1, range: 175, gap: [70, 100], reloadEvery: 4, reloadTicks: 70, second: 0 },
};

/** Dog bite: the lunge tell (ticks), reach (m), damage, cooldown (ticks). */
export const BITE = { tell: 8, reach: 2.1, damage: 8, cooldown: 27 };
/** Decoy throw: wind-up and cooldown (ticks). Pop: fuse (ticks), radius, damage at the center. */
export const DECOY = { windup: 15, cooldown: 135, fuse: 66, radius: 3.4, inner: 0.8, damage: 32 };
/** Trapper's trap: wind-up, cooldown (ticks), arming time (ticks), catch radius (m), damage when it snaps, lifetime (s). */
export const TRAP = { windup: 15, cooldown: 240, arm: 20, radius: 0.8, damage: 6, lifeSeconds: 30, perTrapper: 2, max: 10, hp: 30 };
/** Boss whistle: how long it whistles (ticks), how often (ticks; faster on wave 15), how many helpers may stand at once, and no more whistles this long into the wave (no endless helpers to farm). */
export const WHISTLE = { ticks: 48, every: 480, everyLast: 330, maxHelpers: 4, stopAfterTicks: 150 * 30 };

export function newHunter(id: string, serial: number, kind: number, x: number, y: number, z: number, yaw: number, hp: number, tick: number): HunterAgent {
  return {
    id, serial, kind, x, y, z, yaw, pitch: 0, hp, maxHp: hp, act: HunterAct.Walk, phase: 'advance', phaseTicks: 0,
    mover: new HunterMover(), targetId: null, lostTicks: 0, lastSeen: null, aimAt: { x, y, z }, errYaw: 0, errPitch: 0, reaction: 0,
    shotsSinceMove: 0, shotsSinceReload: 0, barrel: 0, trapCd: 60 + Math.floor(Math.random() * 90), throwCd: 45 + Math.floor(Math.random() * 60),
    whistleCd: 240, slot: Math.random() * Math.PI * 2, cover: null, downTicks: 0, hurtBy: new Set(), lastHitBy: null, bornTick: tick, hammerTicks: 0, flash: 0, helper: false,
    raft: null, kx: 0, kz: 0, swim: 0, perch: -1, barred: null, checkX: x, checkZ: z, busyTick: tick,
  };
}

/**
 * Deathmatch explosives in the shared sim: the grenade throw and the rocket
 * launcher slot, stepped once per tick right after the heal and before the
 * gun (sim.ts), on the client (prediction) and on the server (authority).
 * Like the guns, the counts and the fire-rate gates live here so a client can
 * only ask; the server's copy decides. What flies afterwards (the arc, the
 * fuse, the blast, damage, knockback) is server only (projectiles.ts has the
 * pure flight math, apps/server/src/dmExplosives.ts runs it).
 *
 * - Grenade (Button.Grenade, held): holding it only shows the arc preview on
 *   the client; letting go throws, when one is left and the throw gate is
 *   open. Cook-free: the fuse starts at the throw. Releasing is the edge, so
 *   a stand-in step (which holds the button where it was, see gameRoom.ts)
 *   can never throw.
 * - Rocket launcher (Button.Slot3): a temporary third slot while rockets
 *   last. With the launcher up the gun does not step; a fresh Fire press
 *   launches one rocket through the launcher's own gate. The last rocket puts
 *   the launcher away by itself; Slot1 or Slot2 do it any time.
 *
 * All of it is packed into the one sim field `ex` (integers, so it stays
 * exact and deterministic): the player schema has a hard limit of 64 fields
 * and only a few are left. Layout, low bits first:
 *   nades 3 bits | rockets 4 bits | launcher up 1 bit | throw gate 5 bits | launcher gate 6 bits
 * The battle royale never fills it (always 0), so none of this ever acts there.
 */
import { EXPLOSIVE } from './constants.ts';
import { Button, type InputFrame } from './input.ts';
import { hasWeapon } from './combat.ts';
import { weaponStats } from './weapons.ts';
import type { PlayerSim } from './sim.ts';

/** What flies (wire code in projectile messages). */
export const ExplosiveKind = {
  None: 0,
  Grenade: 1,
  Rocket: 2,
} as const;

/** Largest values the packed `ex` field holds. */
export const EX_MAX = { nades: 7, rockets: 15, nadeCd: 31, rocketCd: 63 } as const;

/** The unpacked explosive state of a duck. */
export interface ExState {
  nades: number;
  rockets: number;
  /** 1 while the rocket launcher is the slot in hand. */
  out: number;
  nadeCd: number;
  rocketCd: number;
}

const clampInt = (v: number, max: number): number => Math.max(0, Math.min(max, Math.floor(v)));

export function packEx(e: ExState): number {
  return (
    clampInt(e.nades, EX_MAX.nades) |
    (clampInt(e.rockets, EX_MAX.rockets) << 3) |
    ((e.out ? 1 : 0) << 7) |
    (clampInt(e.nadeCd, EX_MAX.nadeCd) << 8) |
    (clampInt(e.rocketCd, EX_MAX.rocketCd) << 13)
  );
}

export function unpackEx(ex: number, out: ExState = { nades: 0, rockets: 0, out: 0, nadeCd: 0, rocketCd: 0 }): ExState {
  const v = ex | 0;
  out.nades = v & 7;
  out.rockets = (v >>> 3) & 15;
  out.out = (v >>> 7) & 1;
  out.nadeCd = (v >>> 8) & 31;
  out.rocketCd = (v >>> 13) & 63;
  return out;
}

export const exNades = (s: { ex: number }): number => s.ex & 7;
export const exRockets = (s: { ex: number }): number => (s.ex >>> 3) & 15;
/** 1 while the rocket launcher is the slot in hand. */
export const exLauncher = (s: { ex: number }): number => (s.ex >>> 7) & 1;

/** Server: set the grenades carried (a new life). */
export function setNades(s: { ex: number }, n: number): void {
  const e = unpackEx(s.ex);
  e.nades = n;
  s.ex = packEx(e);
}

/** Server: set the rockets left (the launcher pickup; 0 also puts the launcher away). */
export function setRockets(s: { ex: number }, n: number): void {
  const e = unpackEx(s.ex);
  e.rockets = n;
  if (e.rockets <= 0) e.out = 0;
  s.ex = packEx(e);
}

/**
 * What the last stepPlayer threw or launched (ExplosiveKind). A reused
 * object like the gun's shot: read it right after the step. stepPlayer
 * clears it at the start of every step.
 */
export const lastExplosive = { kind: 0 as number };

const pressed = (b: number, prev: number, bit: number): boolean => (b & bit) !== 0 && (prev & bit) === 0;
const released = (b: number, prev: number, bit: number): boolean => (b & bit) === 0 && (prev & bit) !== 0;
const scratch: ExState = { nades: 0, rockets: 0, out: 0, nadeCd: 0, rocketCd: 0 };

/** Put the launcher away and bring the gun back up (equip time like a switch). */
function holster(s: PlayerSim, e: ExState, want: number): void {
  e.out = 0;
  if (want >= 0 && hasWeapon(s, want)) s.weapon = want;
  s.equip = weaponStats(s.weapon).equipTicks;
  s.cooldown = 0;
  s.reload = 0;
  s.spray = 0;
}

/** One tick of the throw and the launcher. Returns the ExplosiveKind fired (also in `lastExplosive`). */
export function stepExplosives(s: PlayerSim, input: InputFrame): number {
  if (s.ex === 0) return ExplosiveKind.None;
  const b = input.buttons | 0;
  const prev = s.prevButtons | 0;
  const e = unpackEx(s.ex, scratch);
  if (e.nadeCd > 0) e.nadeCd -= 1;
  if (e.rocketCd > 0) e.rocketCd -= 1;
  if (e.out && e.rockets <= 0) holster(s, e, -1);

  // Slots: 3 raises the launcher, 1 or 2 put it away.
  if (!e.out && e.rockets > 0 && pressed(b, prev, Button.Slot3)) {
    e.out = 1;
    e.rocketCd = Math.max(e.rocketCd, EXPLOSIVE.rocket.equipTicks);
    s.reload = 0;
    s.spray = 0;
  } else if (e.out) {
    const want = pressed(b, prev, Button.Slot1) ? 0 : pressed(b, prev, Button.Slot2) ? 1 : -1;
    if (want >= 0) holster(s, e, want);
  }

  let kind: number = ExplosiveKind.None;
  // Grenade on release, never while healing.
  if (released(b, prev, Button.Grenade) && e.nades > 0 && e.nadeCd === 0 && s.heal === 0) {
    e.nades -= 1;
    e.nadeCd = EXPLOSIVE.grenade.throwTicks;
    if (e.out) e.rocketCd = Math.max(e.rocketCd, EXPLOSIVE.grenade.busyTicks);
    else s.cooldown = Math.max(s.cooldown, EXPLOSIVE.grenade.busyTicks);
    kind = ExplosiveKind.Grenade;
  } else if (e.out && pressed(b, prev, Button.Fire) && e.rocketCd === 0 && e.rockets > 0 && s.heal === 0) {
    e.rockets -= 1;
    e.rocketCd = EXPLOSIVE.rocket.fireTicks;
    kind = ExplosiveKind.Rocket;
    if (e.rockets === 0) holster(s, e, -1);
  }
  s.ex = packEx(e);
  lastExplosive.kind = kind;
  return kind;
}

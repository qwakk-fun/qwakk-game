/**
 * Hunt Season keep state inside the duck sim (Pond Keep), packed into fields
 * the player schema already has (it has no fields left):
 *
 * - Manning a bread cannon: `ex` bits 25..27 hold the cannon index + 1. The
 *   sim itself mans a cannon on a Use press within reach of its stand spot
 *   (static map data) and leaves it on a Use or Jump press, knocked or
 *   dead; while manned the duck cannot walk, jump, shoot, throw or heal
 *   (it still turns and aims: the camera aims the cannon). Being input
 *   driven, the owner predicts it exactly.
 * - The cannons other ducks man: `ex` bits 28..31, one per cannon. The
 *   server writes them into every duck when they change, so the sim never
 *   mans a taken cannon (two ducks pressing Use at one cannon in the same
 *   tick: the server keeps one and clears the other).
 * - The drawbridge closed: `dmBuff` bit 4 (KEEP_CLOSED), which the deathmatch
 *   never uses (nor bit 5, KEEP_GATE_OPEN: the gate is broken). The server sets it on every duck from the tick the bridge
 *   starts rising until it is fully down; the sim then refuses a step onto
 *   the deck (raid/keep.ts onDeck), the same on both sides from that tick
 *   on, like the trap root. No collider changes.
 *
 * Cannon fire is not here: the Fire button while manning is read by the
 * server, which owns the loaves (raid/keep.ts cannonAim, stepBread).
 */
import { Button, type InputFrame } from '../input.ts';
import type { SimWorld } from '../physics.ts';
import type { PlayerSim } from '../sim.ts';
import { KEEP, cannonInReach, onDeck } from './keep.ts';
import { exRoot } from './root.ts';

const MAN_SHIFT = 25;
const MAN_MASK = 7;
const OCC_SHIFT = 28;
const OCC_MASK = 15;

/** `dmBuff` bit: the drawbridge is not down (ducks keep off the deck). */
export const KEEP_CLOSED = 0x10;
/**
 * `dmBuff` bit: the main gate is broken. The duck's movement queries then
 * leave out the duck-only colliders (the gate's leaves beside its wicket),
 * so the whole opening is free: a per-duck query filter from sim state, the
 * same on both sides, never a collider switched on or off.
 */
export const KEEP_GATE_OPEN = 0x20;

/** The cannon this duck mans, as index + 1 (0: none). */
export function exMan(s: { ex: number }): number {
  return ((s.ex | 0) >>> MAN_SHIFT) & MAN_MASK;
}

/** Cannons manned by other ducks (bit per cannon). */
export function exOcc(s: { ex: number }): number {
  return ((s.ex | 0) >>> OCC_SHIFT) & OCC_MASK;
}

/** Set the manned cannon (index + 1, 0 to leave). */
export function setMan(s: { ex: number }, v: number): void {
  s.ex = (((s.ex | 0) & ~(MAN_MASK << MAN_SHIFT)) | ((Math.max(0, Math.floor(v)) & MAN_MASK) << MAN_SHIFT)) >>> 0;
}

/** Server: the cannons other ducks man. */
export function setOcc(s: { ex: number }, mask: number): void {
  s.ex = (((s.ex | 0) & ~(OCC_MASK << OCC_SHIFT)) | ((mask & OCC_MASK) << OCC_SHIFT)) >>> 0;
}

/** Server: the gate broken (or holding) for this duck. */
export function setGateOpen(s: { dmBuff: number }, on: boolean): void {
  s.dmBuff = on ? s.dmBuff | KEEP_GATE_OPEN : s.dmBuff & ~KEEP_GATE_OPEN;
}

export function keepClosed(s: { dmBuff: number }): boolean {
  return (s.dmBuff & KEEP_CLOSED) !== 0;
}

/** Server: the drawbridge closed (or open) for this duck. */
export function setKeepClosed(s: { dmBuff: number }, on: boolean): void {
  s.dmBuff = on ? s.dmBuff | KEEP_CLOSED : s.dmBuff & ~KEEP_CLOSED;
}

const pressed = (b: number, prev: number, bit: number): boolean => (b & bit) !== 0 && (prev & bit) === 0;

/**
 * One sim step of the cannon controls, before the movement (stepPlayer):
 * leave on Use or Jump (or when knocked, dead or off the ground mode), man
 * the nearest free cannon in reach on a Use press. Maps without a keep do
 * nothing.
 */
export function stepManning(sim: SimWorld, s: PlayerSim, input: InputFrame): void {
  const g = sim.map.raid;
  if (!g) return;
  const b = input.buttons | 0;
  // Mode 0 is Mode.Ground (sim.ts; not imported to keep the import graph flat).
  const able = s.alive === 1 && s.down === 0 && s.mode === 0;
  if (exMan(s) > 0) {
    if (!able || pressed(b, s.prevButtons, Button.Use) || pressed(b, s.prevButtons, Button.Jump)) setMan(s, 0);
    return;
  }
  if (!able || s.grounded !== 1 || !pressed(b, s.prevButtons, Button.Use) || exRoot(s) > 0) return;
  const i = cannonInReach(g, s.x, s.y, s.z);
  if (i < 0 || (exOcc(s) & (1 << i)) !== 0) return;
  setMan(s, i + 1);
  s.vx = 0;
  s.vz = 0;
}

/**
 * The drawbridge rule after a movement step: with the bridge closed, a step
 * that would put the duck on the deck is taken back (the duck stays where it
 * was). Exact float tests on static map data.
 */
export function keepDeckRule(sim: SimWorld, s: PlayerSim, x0: number, y0: number, z0: number): boolean {
  const g = sim.map.raid;
  if (!g || (s.dmBuff & KEEP_CLOSED) === 0) return false;
  if (!onDeck(g, s.x, s.z, KEEP.bridgeMargin) || onDeck(g, x0, z0, KEEP.bridgeMargin)) return false;
  s.x = x0;
  s.y = y0;
  s.z = z0;
  s.vx = 0;
  s.vz = 0;
  return true;
}

/**
 * Deathmatch kill stacks, server rules: a kill adds one (up to
 * KILL_STACKS.max) while `dm.killStacks` is on, a death clears them (and the
 * respawn's fresh sim starts at zero). The stack count lives in the sim's
 * `dmBuff` field (dmBuffs.ts), where the shared step reads the speed bonus;
 * the damage bonus is applied here, on the server only.
 */
import { KILL_STACKS, killStacks, setKillStacks } from '@qwakk/shared';
import type { Seat } from './arena.ts';
import { dmKillStacksOn, stackDamageScale } from './settings/index.ts';

/** A kill: one more stack. Returns the new count when it went up, else 0. */
export function addKillStack(seat: Seat): number {
  if (!dmKillStacksOn()) return 0;
  const before = killStacks(seat.sim);
  if (before >= KILL_STACKS.max) return 0;
  setKillStacks(seat.sim, before + 1);
  return before + 1;
}

export function clearKillStacks(seat: Seat): void {
  setKillStacks(seat.sim, 0);
}

/** Bullet damage with the shooter's stack bonus (before the victim's armor). */
export function stackedDamage(shooter: Seat, raw: number): number {
  const n = killStacks(shooter.sim);
  return n > 0 ? raw * stackDamageScale(n) : raw;
}

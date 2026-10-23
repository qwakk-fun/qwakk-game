/**
 * Caped hero flight (deathmatch), a part of the shared sim so the client
 * predicts it exactly: stepMovement calls these for a duck with the hero bit
 * (dmBuffs.ts) instead of plain gravity.
 *
 * - Thrust: Jump held while in the air (not on the jump's own tick) with
 *   energy left. The vertical speed eases toward HERO_FLIGHT.climbSpeed, and
 *   toward 0 near HERO_FLIGHT.maxHeight above the ground below (hover).
 * - Glide: in the air without thrust, gravity pulls but the fall speed is
 *   capped at HERO_FLIGHT.glideFallSpeed.
 * - Energy (`PlayerSim.dmEnergy`, ticks): thrust spends one per tick, standing
 *   on the ground refills HERO_FLIGHT.rechargePerTick per tick.
 *
 * Pure: one downward ray against the static world (the same Rapier query on
 * both sides), integer energy, float32 rounding by the caller.
 */
import { HERO_FLIGHT, MOVE } from './constants.ts';
import { Button } from './input.ts';
import { castWorldRay, PLAYER_QUERY_GROUPS, type SimWorld } from './physics.ts';

interface FlightState {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: number;
  down: number;
  dmEnergy: number;
}

/** Does the hero thrust this step? `jumped`: the step started a ground jump (that tick is a plain jump). */
export function heroThrust(s: FlightState, buttons: number, jumped: boolean): boolean {
  return !jumped && s.grounded === 0 && s.down === 0 && s.dmEnergy > 0 && (buttons & Button.Jump) !== 0;
}

/** Height of the feet above the ground below (m), up to the probe length; Infinity when nothing is below. */
export function heightAboveGround(sim: SimWorld, s: FlightState): number {
  const probe = HERO_FLIGHT.maxHeight + 2;
  const hit = castWorldRay(sim, s.x, s.y + 0.05, s.z, 0, -1, 0, probe, PLAYER_QUERY_GROUPS);
  return hit === null ? Infinity : hit - 0.05;
}

/** The vertical part of a hero's step: thrust, glide or (on the ground) plain gravity. Replaces the gravity line. */
export function stepHeroVertical(sim: SimWorld, s: FlightState, thrust: boolean, dt: number): void {
  if (thrust) {
    const h = heightAboveGround(sim, s);
    // Full climb speed until 2 m below the ceiling height, then ease to a hover.
    const room = Math.max(0, Math.min(1, (HERO_FLIGHT.maxHeight - h) / 2));
    const target = HERO_FLIGHT.climbSpeed * room;
    s.vy += (target - s.vy) * Math.min(1, HERO_FLIGHT.climbEase * dt);
    return;
  }
  s.vy -= MOVE.gravity * dt;
  if (s.grounded === 0 && s.vy < -HERO_FLIGHT.glideFallSpeed) s.vy = -HERO_FLIGHT.glideFallSpeed;
  if (s.vy < -MOVE.maxFallSpeed) s.vy = -MOVE.maxFallSpeed;
}

/** Spend energy on thrust, refill it on the ground (after the move). */
export function stepHeroEnergy(s: FlightState, thrust: boolean): void {
  if (thrust) s.dmEnergy = Math.max(0, s.dmEnergy - 1);
  else if (s.grounded === 1) s.dmEnergy = Math.min(HERO_FLIGHT.energyTicks, s.dmEnergy + HERO_FLIGHT.rechargePerTick);
}

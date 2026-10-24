/**
 * The hub duck in the shared sim: the same movement step as a match
 * (stepPlayer: run, sprint, crouch, jump, wade), with no weapon and only the
 * movement buttons. Both sides mask the buttons the same way (the server's
 * `defineInput({ sanitize })` and the client before it predicts), so every
 * field outside HUB_SIM_FIELDS keeps its starting value on both sides and
 * the reconciler only has to carry the movement state.
 */
import { Button, sanitizeInputFields, type InputFields } from '../input.ts';
import { createPlayerSim, type PlayerSim } from '../sim.ts';
import type { SimWorld } from '../physics.ts';
import { HUB } from './constants.ts';

/** The only buttons a hub duck sends: no fire, aim, reload, slots, use, heals or grenades. */
export const HUB_BUTTONS = Button.Jump | Button.Sprint | Button.Crouch | Button.Walk;

/** The sim fields a hub step changes (the owner's reconcile list, in schema order). */
export const HUB_SIM_FIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'pitch', 'crouch', 'grounded', 'air', 'jumpBuf', 'prevButtons'] as const satisfies readonly (keyof PlayerSim)[];

/** Clamp an untrusted hub input in place (the match sanitizer, then only the movement buttons). */
export function sanitizeHubInput(f: InputFields): void {
  sanitizeInputFields(f);
  f.buttons &= HUB_BUTTONS;
}

/** A hub duck: alive, on the ground, unarmed (no weapon owned), nothing carried. */
export function createHubSim(x: number, y: number, z: number, yaw = 0): PlayerSim {
  const s = createPlayerSim(x, y, z, yaw);
  s.arms = 0;
  s.mag0 = 0;
  s.mag1 = 0;
  s.res0 = 0;
  s.res1 = 0;
  return s;
}

/** Copy the reconciled hub fields from `from` into a full sim state. */
export function applyHubFields(from: Readonly<Record<(typeof HUB_SIM_FIELDS)[number], number>>, to: PlayerSim): PlayerSim {
  for (const f of HUB_SIM_FIELDS) to[f] = from[f];
  return to;
}

/**
 * Make a world the plaza's: its ducks move HUB.moveScale times faster on the
 * ground. The server's hub room and the client's prediction both call this
 * on their world before the first step, so both step the same sim.
 */
export function applyHubMovement(sim: SimWorld): SimWorld {
  sim.moveScale = HUB.moveScale;
  return sim;
}

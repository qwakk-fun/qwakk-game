/**
 * The keep's bullet and sight shields (raid/keep.ts keepShapes: the closed
 * gate, the raised drawbridge) switched to match the keep's state. The
 * server switches them as things happen (keepWorld.ts); the client mirrors
 * the room state into its own world with this, so its predicted tracers and
 * hit markers, the drawn loaves and grenades and the cannon's aim arc meet
 * the same shields. Movement never sees them (Bullet and Sight bits only).
 */
import { setToggle, type SimWorld } from '../physics.ts';
import { BridgeState, GateState } from './constants.ts';
import { KEEP_TOGGLE } from './keep.ts';

/** Switch the shields for this drawbridge state and gate look (BridgeState, GateState). */
export function syncKeepShields(sim: SimWorld, bridge: number, gate: number): void {
  setToggle(sim, KEEP_TOGGLE.bridgeUp, bridge !== BridgeState.Down);
  setToggle(sim, KEEP_TOGGLE.gate, gate !== GateState.Broken);
}

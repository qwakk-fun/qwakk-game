/**
 * Cross-runtime determinism probe: runs a fixed scenario and returns a hash of
 * the resulting player states. The server (Node) and the client (browser)
 * must print the same value; the e2e test checks this.
 */
import { createRng } from './rng.ts';
import { Button, sanitizeInputFields, type InputFrame } from './input.ts';
import { generateMap } from './map.ts';
import { createSimWorld } from './physics.ts';
import { createPlayerSim, PLAYER_SIM_FIELDS, stepPlayer } from './sim.ts';

export function simSelfTestHash(seed = 1337, ticks = 600): string {
  const sim = createSimWorld(generateMap(seed));
  const rng = createRng(4242);
  const players = sim.map.spawns.slice(0, 6).map(([x, y, z]) => createPlayerSim(x, y, z));
  const frame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0 };
  for (let t = 0; t < ticks; t++) {
    for (const p of players) {
      frame.mx = rng() * 2 - 1;
      frame.mz = rng() * 2 - 1;
      frame.buttons = rng() < 0.1 ? Button.Jump : rng() < 0.3 ? Button.Sprint : 0;
      frame.yaw = p.yaw + (rng() - 0.5) * 0.2;
      frame.pitch = 0;
      sanitizeInputFields(frame);
      stepPlayer(sim, p, frame);
    }
  }
  const out = new Float64Array(players.length * PLAYER_SIM_FIELDS.length);
  players.forEach((p, i) => PLAYER_SIM_FIELDS.forEach((f, j) => (out[i * PLAYER_SIM_FIELDS.length + j] = p[f])));
  const bytes = new Uint8Array(out.buffer);
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  sim.dispose();
  return (h >>> 0).toString(16) + ':' + players.map((p) => p.y.toFixed(4)).join(',');
}

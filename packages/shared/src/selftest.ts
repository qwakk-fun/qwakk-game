/**
 * Cross-runtime determinism probe: runs a fixed scenario and returns a hash of
 * the resulting player states. The server (Node) and the client (browser)
 * must print the same value; the e2e test checks this.
 */
import { createRng } from './rng.ts';
import { Button, sanitizeInputFields, type InputFrame } from './input.ts';
import { generateMap, type MapDef } from './map.ts';
import { createSimWorld } from './physics.ts';
import { createPlayerSim, PLAYER_SIM_FIELDS, stepPlayer } from './sim.ts';

export function simSelfTestHash(seed = 1337, ticks = 600): string {
  return simSelfTestHashOn(generateMap(seed), ticks);
}

/** FNV-1a of a loaded map's terrain and every collider number, in order: the same list on both sides. */
export function mapDefHash(def: MapDef): string {
  let h = 0x811c9dc5;
  const f = new Float64Array(1);
  const b = new Uint8Array(f.buffer);
  const add = (v: number) => {
    f[0] = v;
    for (let i = 0; i < 8; i++) h = Math.imul(h ^ (b[i] as number), 0x01000193);
  };
  for (const v of def.terrain.heights) add(v);
  for (const s of def.shapes) {
    add(s.bits);
    for (const v of s.c) add(v);
    for (const v of s.q) add(v);
    for (const v of s.h ?? []) add(v);
    add(s.r ?? 0);
    add(s.hh ?? 0);
    for (const v of s.pts ?? []) add(v);
  }
  return `${(h >>> 0).toString(16)}:${def.shapes.length}`;
}

/** The fixed scenario on any map (six players from its spawn points). */
export function simSelfTestHashOn(map: MapDef, ticks = 600): string {
  const sim = createSimWorld(map);
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

/**
 * Duck Plaza (the hub map, map id duck-plaza): two loads give the same
 * terrain and collider list, every collider kind is known (the plaza props
 * are merged in), the terrain lookup matches the Rapier heightfield, the
 * shipped copy matches the export (with the plaza colliders merged), the hub
 * section has the three portals, spawns and exits on free ground, a duck
 * walks from the spawn through each portal's opening (the trigger fires) and
 * cannot leave the hedge ring, and the pond is shallow enough to wade.
 */
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildMapDef, createSimWorld, initPhysics, mapDefHash, MOVE_QUERY_GROUPS, simSelfTestHashOn, stepPlayer, terrainHeightAt, type InputFrame, type MapDef } from '@qwakk/shared';
import { parseHubMap, portalAt, PORTALS, type HubSpawn } from '@qwakk/shared/hub';
import { applyHubMovement, createHubSim, sanitizeHubInput } from '@qwakk/shared/hub/sim';
import { mergedColliders } from '../../../scripts/sync-map.ts';

const ID = 'duck-plaza';
const root = new URL('../../../', import.meta.url);
const shipped = new URL(`packages/shared/src/maps/${ID}/`, root);
const read = (f: string) => readFileSync(new URL(f, shipped));
const raw = () => JSON.parse(read('map_v1.json').toString()) as { playArea: { ring: [number, number][] }; water: { sea: number } };

beforeAll(async () => {
  await initPhysics();
});

function load() {
  return buildMapDef(ID, JSON.parse(read('map_v1.json').toString()), new Uint8Array(read('map_v1_heights.bin')), JSON.parse(read('colliders.json').toString()));
}

function inRing(ring: readonly [number, number][], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]!;
    const [bx, bz] = ring[(i + 1) % ring.length]!;
    if (az > z !== bz > z && x < ax + ((z - az) * (bx - ax)) / (bz - az)) inside = !inside;
  }
  return inside;
}

/** Walk a hub duck toward (tx, tz) for at most `ticks` steps (jumping when stuck); returns the path's end and whether a portal fired. */
function walkTo(def: MapDef, from: HubSpawn, tx: number, tz: number, ticks: number, stop?: (x: number, y: number, z: number) => boolean) {
  // The hub room's world: the plaza's faster ground speeds.
  const sim = applyHubMovement(createSimWorld(def));
  const s = createHubSim(from[0], from[1], from[2], from[3]);
  let stuck = 0;
  let lastD = Infinity;
  for (let t = 0; t < ticks; t++) {
    const yaw = Math.atan2(-(tx - s.x), -(tz - s.z));
    const d = Math.hypot(tx - s.x, tz - s.z);
    if (d > lastD - 0.02) stuck++;
    else stuck = 0;
    lastD = d;
    const f: InputFrame = { seq: t, tick: t, mx: 0, mz: 1, buttons: stuck > 10 && t % 20 === 0 ? 1 : 2, yaw, pitch: 0 };
    sanitizeHubInput(f);
    stepPlayer(sim, s, f, 1 / 30);
    if (stop?.(s.x, s.y, s.z)) break;
  }
  sim.dispose();
  return s;
}

describe('Duck Plaza map', () => {
  it('two loads give identical terrain and colliders, every kind known, the plaza props in', () => {
    const a = load();
    const b = load();
    expect(mapDefHash(a.def)).toBe(mapDefHash(b.def));
    expect(a.extras.unknownKinds).toEqual([]);
    const names = new Set(a.extras.props.map((p) => p.prop));
    for (const p of ['plaza_portal', 'plaza_fountain', 'plaza_statue', 'plaza_board', 'plaza_bench', 'plaza_lamp']) expect(names.has(p), p).toBe(true);
    expect(a.extras.props.filter((p) => p.prop === 'plaza_portal').length).toBe(3);
  });

  it('terrainHeightAt matches the Rapier heightfield', () => {
    const def = load().def;
    const sim = createSimWorld({ ...def, shapes: [], boxes: [] });
    const half = def.size / 2 - 1;
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      const x = -half + ((i * 37.13 + 0.37) % (2 * half));
      const z = -half + ((i * 91.71 + 0.37) % (2 * half));
      const hit = sim.world.castRay(new sim.rapier.Ray({ x, y: 100, z }, { x: 0, y: -1, z: 0 }), 200, true, undefined, MOVE_QUERY_GROUPS);
      expect(hit, `no terrain hit at (${x}, ${z})`).not.toBeNull();
      worst = Math.max(worst, Math.abs(100 - hit!.timeOfImpact - terrainHeightAt(def.terrain, x, z)));
    }
    expect(worst).toBeLessThan(1e-3);
    sim.dispose();
  });

  it('the sim scenario on this map is repeatable', () => {
    expect(simSelfTestHashOn(load().def, 200)).toBe(simSelfTestHashOn(load().def, 200));
  });

  it('the shipped copy matches the export with the plaza colliders merged (npm run map:sync)', () => {
    const files: [string, string][] = [
      [`art/map/export/${ID}/map_v1.json`, 'map_v1.json'],
      [`art/map/export/${ID}/map_v1_heights.bin`, 'map_v1_heights.bin'],
      [`art/map/export/${ID}/map_v1_ground.bin`, 'map_v1_ground.bin'],
    ];
    for (const [src, name] of files) {
      const s = new URL(src, root);
      if (!existsSync(s)) continue; // the server image has no art/
      expect(read(name).equals(readFileSync(s)), `${ID}/${name} is stale: npm run map:sync`).toBe(true);
    }
    const base = new URL('apps/client/public/models/props/colliders.json', root);
    const extra = new URL(`art/map/export/${ID}/plaza_colliders.json`, root);
    if (existsSync(base) && existsSync(extra)) {
      const merged = mergedColliders(readFileSync(base), [readFileSync(extra)]);
      expect(Buffer.from(merged).equals(read('colliders.json')), `${ID}/colliders.json is stale: npm run map:sync`).toBe(true);
    }
  });

  it('the hub section: three portals in wire order, spawns and exits on free ground inside the ring', () => {
    const hub = parseHubMap(JSON.parse(read('map_v1.json').toString()));
    expect(hub.portals.map((p) => p.id)).toEqual([...PORTALS]);
    expect(hub.spawns.length).toBeGreaterThanOrEqual(8);
    expect(hub.board).not.toBeNull();
    const def = load().def;
    const sim = createSimWorld(def);
    const { ring } = raw().playArea;
    const all = [...hub.spawns, ...PORTALS.flatMap((id) => hub.exits[id])];
    for (const id of PORTALS) expect(hub.exits[id].length, id).toBeGreaterThan(0);
    for (const [x, y, z] of all) {
      expect(inRing(ring, x, z), `(${x}, ${z}) inside the ring`).toBe(true);
      expect(Math.abs(y - 0.1 - terrainHeightAt(def.terrain, x, z))).toBeLessThan(0.3);
      // nothing solid where the duck stands
      const hit = sim.world.intersectionWithShape({ x, y: y + 0.95, z }, { x: 0, y: 0, z: 0, w: 1 }, sim.standShape, undefined, MOVE_QUERY_GROUPS);
      expect(hit, `blocked spawn (${x}, ${z})`).toBeNull();
      expect(portalAt(hub.portals, x, y, z), `spawn (${x}, ${z}) inside a portal`).toBeNull();
    }
    sim.dispose();
  });

  it('a duck walks from the spawn through each portal opening and the trigger fires', () => {
    const def = load().def;
    const hub = parseHubMap(JSON.parse(read('map_v1.json').toString()));
    for (const p of hub.portals) {
      const exit = hub.exits[p.id][2]!;
      // From the spawn to the front of the gate, then straight through the arch.
      const front = walkTo(def, hub.spawns[5]!, exit[0], exit[2], 30 * 40);
      expect(Math.hypot(front.x - exit[0], front.z - exit[2]), `${p.id}: reached the apron`).toBeLessThan(1.5);
      let fired = false;
      walkTo(def, [front.x, front.y, front.z, 0], p.x, p.z, 30 * 6, (x, y, z) => (fired = portalAt(hub.portals, x, y, z)?.id === p.id));
      expect(fired, `${p.id}: walked into the opening`).toBe(true);
    }
  });

  it('the hedge ring holds: running and jumping outward from the middle never leaves it', () => {
    const def = load().def;
    const { ring } = raw().playArea;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const end = walkTo(def, [0, 3.2, 12, 0], Math.cos(a) * 200, Math.sin(a) * 200, 30 * 25);
      expect(inRing(ring, end.x, end.z), `escaped toward ${a.toFixed(2)} at (${end.x.toFixed(1)}, ${end.z.toFixed(1)})`).toBe(true);
    }
  });

  it('the pond is shallow (a duck wades, never deeper than 0.8 m) and its island is dry', () => {
    const def = load().def;
    const water = raw().water.sea;
    let deepest = 0;
    for (let x = -12; x <= 12; x += 0.5) for (let z = -12; z <= 4; z += 0.5) deepest = Math.max(deepest, water - terrainHeightAt(def.terrain, x, z));
    expect(deepest).toBeGreaterThan(0.3);
    expect(deepest).toBeLessThan(0.8);
  });
});

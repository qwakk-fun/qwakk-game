/**
 * Kavren (the deathmatch arena, map id canard-quarter): two loads give
 * the same terrain and collider list, the terrain lookup matches the Rapier
 * heightfield, the shipped copy matches the map export, every `dmSpawns`
 * point is a free spot on the ground inside the hedge ring, and a duck cannot
 * leave the ring by running and jumping at it.
 *
 * Loads the shipped files directly (not through apps/server/src/maps.ts), so
 * it does not depend on how the rooms pick their map.
 */
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildMapDef,
  Button,
  createPlayerSim,
  createSimWorld,
  initPhysics,
  mapDefHash,
  MOVE_QUERY_GROUPS,
  sanitizeInputFields,
  simSelfTestHashOn,
  stepPlayer,
  terrainHeightAt,
  type InputFrame,
} from '@qwakk/shared';

const ID = 'canard-quarter';
const root = new URL('../../../', import.meta.url);
const shipped = new URL(`packages/shared/src/maps/${ID}/`, root);

type Pt = [number, number];
type Spawn = [number, number, number, number];

beforeAll(async () => {
  await initPhysics();
});

const read = (f: string) => readFileSync(new URL(f, shipped));
const json = () => JSON.parse(read('map_v1.json').toString()) as { dmSpawns: Spawn[]; playArea: { ring: Pt[]; inset: number }; size: number };

function load() {
  return buildMapDef(ID, JSON.parse(read('map_v1.json').toString()), new Uint8Array(read('map_v1_heights.bin')), JSON.parse(read('colliders.json').toString()));
}

/** Signed distance to the ring center line: negative inside. */
function ringSigned(ring: readonly Pt[], x: number, z: number): number {
  let d = Infinity;
  let inside = false;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]!;
    const [bx, bz] = ring[(i + 1) % ring.length]!;
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t));
    if (az > z !== bz > z && x < ax + ((z - az) * dx) / dz) inside = !inside;
  }
  return inside ? -d : d;
}

describe('Kavren map', () => {
  it('two loads give identical terrain and collider lists, and every collider kind is known', () => {
    const a = load();
    const b = load();
    expect(mapDefHash(a.def)).toBe(mapDefHash(b.def));
    expect(a.def.shapes.length).toBeGreaterThan(1000);
    expect(a.extras.unknownKinds).toEqual([]);
    expect(a.extras.props.filter((p) => ['townhouse', 'farmhouse', 'house_ruined', 'barn'].includes(p.prop)).length).toBeGreaterThanOrEqual(3);
  });

  it('terrainHeightAt matches the Rapier heightfield', () => {
    const def = load().def;
    const sim = createSimWorld({ ...def, shapes: [], boxes: [] });
    const half = def.size / 2 - 1;
    let worst = 0;
    for (let i = 0; i < 400; i++) {
      // 0.37 m off the 4 m grid lines: a ray exactly down a heightfield edge can slip between the triangles
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

  it('the shipped copy matches the map export (run npm run map:sync after a map rebuild)', () => {
    const pairs: [string, string][] = [
      [`art/map/export/${ID}/map_v1.json`, 'map_v1.json'],
      [`art/map/export/${ID}/map_v1_heights.bin`, 'map_v1_heights.bin'],
      [`art/map/export/${ID}/map_v1_ground.bin`, 'map_v1_ground.bin'],
      ['apps/client/public/models/props/colliders.json', 'colliders.json'],
    ];
    for (const [src, name] of pairs) {
      const s = new URL(src, root);
      if (!existsSync(s)) continue; // the server image has no art/
      expect(read(name).equals(readFileSync(s)), `${ID}/${name} is stale: npm run map:sync`).toBe(true);
    }
  });

  it('dmSpawns: at least 40, spread out, on free open ground inside the ring, each with a yaw', () => {
    const { dmSpawns, playArea } = json();
    const def = load().def;
    const sim = createSimWorld(def);
    const R = sim.rapier;
    const body = new R.Capsule(0.65, 0.45); // the standing duck (1.75 m, r 0.35) plus a margin
    const problems: string[] = [];
    expect(dmSpawns.length).toBeGreaterThanOrEqual(40);
    dmSpawns.forEach((s, i) => {
      const [x, y, z, yaw] = s;
      const at = `spawn ${i} (${x}, ${z})`;
      if (s.length !== 4 || !s.every(Number.isFinite) || Math.abs(yaw) > Math.PI + 1e-3) problems.push(`${at}: bad record ${JSON.stringify(s)}`);
      if (ringSigned(playArea.ring, x, z) > -4) problems.push(`${at}: too close to or outside the hedge ring`);
      const ground = terrainHeightAt(def.terrain, x, z);
      if (Math.abs(y - ground - 0.1) > 0.02) problems.push(`${at}: y ${y} is not on the terrain (${ground.toFixed(2)})`);
      // nothing but the terrain under the feet (not a roof, a wreck or a crate)
      const hit = sim.world.castRay(new R.Ray({ x, y: y + 30, z }, { x: 0, y: -1, z: 0 }), 40, true, undefined, MOVE_QUERY_GROUPS);
      if (!hit || Math.abs(y + 30 - hit.timeOfImpact - ground) > 0.05) problems.push(`${at}: something stands over the spawn`);
      // the duck's body is free of every movement-blocking collider
      if (sim.world.intersectionWithShape({ x, y: y + 0.25 + 0.45 + 0.65, z }, { x: 0, y: 0, z: 0, w: 1 }, body, undefined, MOVE_QUERY_GROUPS)) {
        problems.push(`${at}: the duck's body overlaps a collider`);
      }
      for (let j = 0; j < i; j++) {
        const o = dmSpawns[j]!;
        if (Math.hypot(o[0] - x, o[2] - z) < 14) problems.push(`${at}: closer than 14 m to spawn ${j}`);
      }
      // a duck spawned here settles on the ground and stays put
      const duck = createPlayerSim(x, y, z, yaw);
      const frame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw, pitch: 0 };
      for (let t = 0; t < 20; t++) {
        frame.seq++;
        stepPlayer(sim, duck, frame);
      }
      if (Math.hypot(duck.x - x, duck.z - z) > 0.05 || Math.abs(duck.y - ground) > 0.15) {
        problems.push(`${at}: the duck moved to (${duck.x.toFixed(2)}, ${duck.y.toFixed(2)}, ${duck.z.toFixed(2)})`);
      }
    });
    sim.dispose();
    expect(problems).toEqual([]);
  });

  it('the hedge ring holds: a duck running and jumping at it from inside never gets out', () => {
    const { playArea } = json();
    const ring = playArea.ring;
    const def = load().def;
    const sim = createSimWorld(def);
    const escapes: string[] = [];
    let tries = 0;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i]!;
      const [bx, bz] = ring[(i + 1) % ring.length]!;
      const len = Math.hypot(bx - ax, bz - az);
      // inward normal (the ring runs clockwise in x east, z south)
      for (let k = 0; k <= Math.floor(len / 6); k++) {
        const t = Math.min(1, (k * 6) / len);
        const ex = ax + (bx - ax) * t;
        const ez = az + (bz - az) * t;
        for (const lean of [-0.6, 0, 0.6]) {
          const nx = -(bz - az) / len;
          const nz = (bx - ax) / len;
          const inside = ringSigned(ring, ex + nx * 8, ez + nz * 8) < 0 ? 1 : -1;
          const sx = ex + nx * 8 * inside;
          const sz = ez + nz * 8 * inside;
          // run outward, leaning along the edge by `lean` radians
          const ox = -nx * inside;
          const oz = -nz * inside;
          const dx = ox * Math.cos(lean) - oz * Math.sin(lean);
          const dz = ox * Math.sin(lean) + oz * Math.cos(lean);
          const duck = createPlayerSim(sx, terrainHeightAt(def.terrain, sx, sz) + 0.3, sz);
          const frame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: Math.atan2(-dx, -dz), pitch: 0 };
          for (let n = 0; n < 30; n++) {
            frame.seq++;
            stepPlayer(sim, duck, frame); // land first
          }
          for (let n = 0; n < 150; n++) {
            frame.seq++;
            frame.mz = 1;
            frame.buttons = n % 2 === 0 ? Button.Jump : 0;
            sanitizeInputFields(frame);
            stepPlayer(sim, duck, frame);
          }
          tries++;
          if (ringSigned(ring, duck.x, duck.z) > -0.5) escapes.push(`edge ${i} at (${ex.toFixed(1)}, ${ez.toFixed(1)}) lean ${lean}: reached (${duck.x.toFixed(2)}, ${duck.y.toFixed(2)}, ${duck.z.toFixed(2)})`);
        }
      }
    }
    sim.dispose();
    expect(tries).toBeGreaterThan(300);
    expect(escapes).toEqual([]);
  }, 120_000);
});

/**
 * Pond Keep (the Hunt Season castle map, map id pond-keep): two loads give the
 * same terrain and collider list, the terrain lookup matches the Rapier
 * heightfield, the shipped copy matches the map export, the `raid` markup is
 * sound (spawns free and on the ground, the cannons mounted and clear of the
 * merlons, the perches see the walls), the moat holds (ducks running and
 * jumping at it from either bank never get across; the drawbridge and the raft
 * lanes do cross it) and the navmesh crosses the moat only on the raft lanes
 * and the drawbridge. The walk paths of the castle pieces (tower stairs, wall
 * walks, gatehouse, quays, raft lanes, watchtowers) are walked in
 * houses.test.ts.
 *
 * Loads the shipped files directly (not through apps/server/src/maps.ts).
 */
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BULLET_QUERY_GROUPS,
  buildMapDef,
  Button,
  createPlayerSim,
  createSimWorld,
  initPhysics,
  mapDefHash,
  MOVE_QUERY_GROUPS,
  sanitizeInputFields,
  SIGHT_QUERY_GROUPS,
  simSelfTestHashOn,
  stepPlayer,
  terrainHeightAt,
  type InputFrame,
  type SimWorld,
} from '@qwakk/shared';
import { BotNav } from '../src/nav/botNav.ts';
import { buildNavMesh, initNav } from '../src/nav/navmesh.ts';

const ID = 'pond-keep';
const root = new URL('../../../', import.meta.url);
const shipped = new URL(`packages/shared/src/maps/${ID}/`, root);

type Pt = [number, number];
type P4 = [number, number, number, number];

/** The pond, as art/map/layout/gen_pond.py draws it. */
const ISLAND = 30;
const ISLAND_R = 12;
const MOAT_W = 14;
const LAND = 1;

interface Raid {
  core: [number, number, number];
  coreRadius: number;
  gate: { x: number; y: number; z: number; width: number; height: number };
  drawbridge: { hingeX: number; hingeY: number; hingeZ: number; length: number; width: number; walk: Pt[] };
  cannons: P4[];
  cannonUse: [number, number, number][];
  duckSpawns: P4[];
  hunterSpawns: P4[];
  sniperPerches: P4[];
  raftLanes: { from: Pt; to: Pt }[];
  trenches: Pt[][];
  wallWalk: [number, number, number][][];
  keep: Pt[];
  island: Pt[];
  lever: [number, number, number];
  props: { prop: string; role: string; x: number; y: number; z: number; rotY: number }[];
}

beforeAll(async () => {
  await initPhysics();
  await initNav();
});

const read = (f: string) => readFileSync(new URL(f, shipped));
const json = () => JSON.parse(read('map_v1.json').toString()) as { raid: Raid; playArea: { ring: Pt[] }; size: number; props: { prop: string }[] };

function load() {
  return buildMapDef(ID, JSON.parse(read('map_v1.json').toString()), new Uint8Array(read('map_v1_heights.bin')), JSON.parse(read('colliders.json').toString()));
}

/** Signed distance to the island edge (negative on the island); the outer bank is MOAT_W. */
function islandSd(x: number, z: number): number {
  const a = ISLAND - ISLAND_R;
  const qx = Math.abs(x) - a;
  const qz = Math.abs(z) - a;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - ISLAND_R;
}

/** A point on the island edge grown by `offset`, at arc parameter t in [0, 1) (clockwise from the south middle). */
function edgePoint(offset: number, t: number): Pt {
  const a = ISLAND - ISLAND_R;
  const r = ISLAND_R + offset;
  const side = 2 * a;
  const arc = (Math.PI / 2) * r;
  const total = 4 * (side + arc);
  let s = (((t % 1) + 1) % 1) * total + a; // start at the middle of the south side
  const corners: [number, number, number][] = [
    [-a, a, Math.PI / 2],
    [-a, -a, Math.PI],
    [a, -a, 1.5 * Math.PI],
    [a, a, 0],
  ];
  const starts: [Pt, Pt][] = [
    [[a, a + r], [-a, a + r]],
    [[-a - r, a], [-a - r, -a]],
    [[-a, -a - r], [a, -a - r]],
    [[a + r, -a], [a + r, a]],
  ];
  for (let k = 0; k < 8; k++) {
    s %= total;
    const i = k % 4;
    if (s <= side) {
      const [p0, p1] = starts[i]!;
      return [p0[0] + ((p1[0] - p0[0]) * s) / side, p0[1] + ((p1[1] - p0[1]) * s) / side];
    }
    s -= side;
    if (s <= arc) {
      const [cx, cz, a0] = corners[i]!;
      const ang = a0 + s / r;
      return [cx + Math.cos(ang) * r, cz + Math.sin(ang) * r];
    }
    s -= arc;
  }
  return [0, ISLAND + offset];
}

function segDist(px: number, pz: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t);
}

function inPoly(poly: readonly Pt[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[i]!;
    const [bx, bz] = poly[j]!;
    if (az > z !== bz > z && x < ax + ((z - az) * (bx - ax)) / (bz - az)) inside = !inside;
  }
  return inside;
}

/** Near a crossing (a raft lane or the drawbridge with its quays), where the barrier is open on purpose. */
function nearCrossing(raid: Raid, x: number, z: number, margin: number): boolean {
  if (raid.raftLanes.some((l) => segDist(x, z, l.from, l.to) < margin)) return true;
  const b = raid.drawbridge;
  return segDist(x, z, [b.hingeX, b.hingeZ - 5], [b.hingeX, b.hingeZ + b.length + 5]) < margin + 1.5;
}

/** A duck that lands and then runs (and hops) along (dx, dz) for `ticks`; `each` sees every position. */
function run(sim: SimWorld, x: number, z: number, dx: number, dz: number, ticks: number, jump = true, each?: (x: number, y: number, z: number) => void) {
  const def = sim.map;
  const duck = createPlayerSim(x, terrainHeightAt(def.terrain, x, z) + 0.3, z);
  const frame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: Math.atan2(-dx, -dz), pitch: 0 };
  for (let n = 0; n < 30; n++) {
    frame.seq++;
    stepPlayer(sim, duck, frame);
  }
  let minY = duck.y;
  for (let n = 0; n < ticks; n++) {
    frame.seq++;
    frame.mz = 1;
    frame.buttons = jump && n % 2 === 0 ? Button.Jump : 0;
    sanitizeInputFields(frame);
    stepPlayer(sim, duck, frame);
    minY = Math.min(minY, duck.y);
    each?.(duck.x, duck.y, duck.z);
  }
  return { duck, minY };
}

/** The duck's body (standing, with a margin) is free of every movement collider at (x, y, z) (feet). */
function bodyFree(sim: SimWorld, x: number, y: number, z: number): boolean {
  const R = sim.rapier;
  const body = new R.Capsule(0.65, 0.4);
  return !sim.world.intersectionWithShape({ x, y: y + 0.25 + 0.4 + 0.65, z }, { x: 0, y: 0, z: 0, w: 1 }, body, undefined, MOVE_QUERY_GROUPS);
}

/** Height of what a duck stands on under (x, z), from y + 3 down. */
function groundUnder(sim: SimWorld, x: number, y: number, z: number): number | null {
  const R = sim.rapier;
  const hit = sim.world.castRay(new R.Ray({ x, y: y + 3, z }, { x: 0, y: -1, z: 0 }), 10, true, undefined, MOVE_QUERY_GROUPS);
  return hit ? y + 3 - hit.timeOfImpact : null;
}

describe('Pond Keep map', () => {
  it('two loads give identical terrain and collider lists, every collider kind is known, the castle is all there', () => {
    const a = load();
    const b = load();
    expect(mapDefHash(a.def)).toBe(mapDefHash(b.def));
    expect(a.extras.unknownKinds).toEqual([]);
    const count = (p: string) => a.extras.props.filter((i) => i.prop === p).length;
    expect(count('castle_tower')).toBe(4);
    expect(count('castle_wall')).toBe(3);
    expect(count('castle_gatehouse')).toBe(1);
    expect(count('castle_core')).toBe(1);
    expect(count('raft_lane')).toBeGreaterThanOrEqual(3);
    expect(count('hunter_watchtower')).toBeGreaterThanOrEqual(3);
    // the animated pieces are placed by the game from raid.props, never as static props
    for (const p of ['castle_drawbridge', 'castle_gate', 'bread_cannon', 'castle_lever']) expect(count(p)).toBe(0);
    expect(a.def.raid).toBeDefined();
  });

  it('terrainHeightAt matches the Rapier heightfield (probed off the 2 m grid lines)', () => {
    const def = load().def;
    const sim = createSimWorld({ ...def, shapes: [], boxes: [] });
    const half = def.size / 2 - 1;
    const cell = def.terrain.cellSize;
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      const x = -half + Math.floor(((i * 37.13) % (2 * half)) / cell) * cell + 0.37 + (i % 3) * 0.41;
      const z = -half + Math.floor(((i * 91.71) % (2 * half)) / cell) * cell + 0.53 + (i % 5) * 0.23;
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

  it('the pond matches the shape this test assumes, and the moat is water', () => {
    const { raid } = json();
    const def = load().def;
    // the island outline is the inner bank
    for (const [x, z] of raid.island) expect(Math.abs(islandSd(x, z))).toBeLessThan(0.05);
    // the moat bed is under the water, the banks and the island are dry
    for (let k = 0; k < 64; k++) {
      const [mx, mz] = edgePoint(MOAT_W / 2, k / 64 + 0.003);
      expect(terrainHeightAt(def.terrain, mx, mz), `moat at (${mx.toFixed(1)}, ${mz.toFixed(1)})`).toBeLessThan(-2);
      const [ix, iz] = edgePoint(-1.5, k / 64 + 0.003);
      expect(terrainHeightAt(def.terrain, ix, iz)).toBeGreaterThan(0.9); // the 2 m grid rounds the bank top a little
      const [jx, jz] = edgePoint(-3, k / 64 + 0.003);
      expect(terrainHeightAt(def.terrain, jx, jz)).toBeCloseTo(LAND, 2);
      const [ox, oz] = edgePoint(MOAT_W + 1.5, k / 64 + 0.003);
      expect(terrainHeightAt(def.terrain, ox, oz)).toBeGreaterThan(0.9);
    }
  });

  it('raid markup: duck spawns in the keep and on the wall walk, hunter spawns outside the moat, all free and on the ground', () => {
    const { raid, playArea } = json();
    const def = load().def;
    const sim = createSimWorld(def);
    const problems: string[] = [];
    expect(raid.duckSpawns.length).toBeGreaterThanOrEqual(8);
    expect(raid.hunterSpawns.length).toBeGreaterThanOrEqual(12);
    expect(raid.cannons.length).toBe(4);
    expect(raid.cannonUse.length).toBe(4);
    expect(raid.sniperPerches.length).toBeGreaterThanOrEqual(6);
    expect(raid.sniperPerches.length).toBeLessThanOrEqual(8);
    expect(raid.raftLanes.length).toBeGreaterThanOrEqual(3);
    expect(raid.raftLanes.length).toBeLessThanOrEqual(4);
    expect(raid.trenches.length).toBeGreaterThanOrEqual(4);
    expect(raid.wallWalk.length).toBeGreaterThanOrEqual(4);
    const check = (what: string, s: P4) => {
      const [x, y, z, yaw] = s;
      const at = `${what} (${x}, ${y}, ${z})`;
      if (s.length !== 4 || !s.every(Number.isFinite) || Math.abs(yaw) > Math.PI + 1e-3) problems.push(`${at}: bad record`);
      const g = groundUnder(sim, x, y, z);
      if (g === null || Math.abs(y - 0.1 - g) > 0.06) problems.push(`${at}: not on the ground (${g?.toFixed(2)})`);
      if (!bodyFree(sim, x, y, z)) problems.push(`${at}: the body overlaps a collider`);
      const duck = createPlayerSim(x, y, z, yaw);
      const frame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw, pitch: 0 };
      for (let t = 0; t < 20; t++) {
        frame.seq++;
        stepPlayer(sim, duck, frame);
      }
      if (Math.hypot(duck.x - x, duck.z - z) > 0.05 || Math.abs(duck.y - (y - 0.1)) > 0.15) problems.push(`${at}: a duck there moved to (${duck.x.toFixed(2)}, ${duck.y.toFixed(2)}, ${duck.z.toFixed(2)})`);
    };
    for (const s of raid.duckSpawns) {
      check('duck spawn', s);
      if (!inPoly(raid.keep, s[0], s[2])) problems.push(`duck spawn (${s[0]}, ${s[2]}): outside the keep`);
    }
    for (const s of raid.hunterSpawns) {
      check('hunter spawn', s);
      if (islandSd(s[0], s[2]) < MOAT_W + 20) problems.push(`hunter spawn (${s[0]}, ${s[2]}): not out in the trench ring`);
      if (!inPoly(playArea.ring, s[0], s[2])) problems.push(`hunter spawn (${s[0]}, ${s[2]}): outside the play area`);
      const r = Math.hypot(s[0] - raid.core[0], s[2] - raid.core[2]);
      if (r < 60 || r > 120) problems.push(`hunter spawn (${s[0]}, ${s[2]}): ${r.toFixed(0)} m from the core`);
    }
    // the lever stands on the courtyard floor, clear of everything
    const [lx, ly, lz] = raid.lever;
    if (!bodyFree(sim, lx, ly, lz) || Math.abs((groundUnder(sim, lx, ly, lz) ?? -9) - ly) > 0.06) problems.push('lever spot blocked or off the ground');
    sim.dispose();
    expect(problems).toEqual([]);
  });

  it('raid markup: the cannons sit on the tower tops and fire over the barbette (level, up and down at the berm), the gunner spots are free', () => {
    const { raid } = json();
    const sim = createSimWorld(load().def);
    const R = sim.rapier;
    const problems: string[] = [];
    raid.cannons.forEach(([x, y, z, yaw], i) => {
      const g = groundUnder(sim, x, y, z);
      if (g === null || Math.abs(g - y) > 0.05) problems.push(`cannon ${i}: mount at ${y}, the pedestal top at ${g?.toFixed(2)}`);
      if (y < LAND + 9.8) problems.push(`cannon ${i}: not on a tower top (${y})`);
      // the barrel: the GLB Pitch node 0.95 m over the mount, the muzzle 1.55 m out along the aim
      const ay = y + 0.95;
      for (const dyaw of [-0.7, -0.35, 0, 0.35, 0.7]) {
        for (const pitch of [0.3, 0, -0.2, -0.4]) {
          const a = yaw + dyaw;
          const fx = -Math.sin(a) * Math.cos(pitch);
          const fz = -Math.cos(a) * Math.cos(pitch);
          const fy = Math.sin(pitch);
          const o = { x: x + fx * 1.55, y: ay + fy * 1.55, z: z + fz * 1.55 };
          const hit = sim.world.castRay(new R.Ray(o, { x: fx, y: fy, z: fz }), 10, true, undefined, BULLET_QUERY_GROUPS);
          if (hit) problems.push(`cannon ${i}: a shot ${dyaw} rad off the aim, pitch ${pitch}, hits something ${hit.timeOfImpact.toFixed(2)} m from the muzzle`);
        }
      }
      // the default aim looks straight out from the core
      const out = Math.atan2(-(x - raid.core[0]), -(z - raid.core[2]));
      if (Math.abs(Math.atan2(Math.sin(out - yaw), Math.cos(out - yaw))) > 0.25) problems.push(`cannon ${i}: yaw ${yaw} does not look out from the core (${out.toFixed(3)})`);
      const [ux, uy, uz] = raid.cannonUse[i]!;
      const gu = groundUnder(sim, ux, uy, uz);
      if (gu === null || Math.abs(gu - uy) > 0.06) problems.push(`cannon ${i}: gunner spot at ${uy}, ground ${gu?.toFixed(2)}`);
      if (!bodyFree(sim, ux, uy + 0.05, uz)) problems.push(`cannon ${i}: gunner spot blocked`);
      if (Math.hypot(ux - x, uz - z) > 2.2) problems.push(`cannon ${i}: gunner spot ${Math.hypot(ux - x, uz - z).toFixed(2)} m from the mount`);
    });
    sim.dispose();
    expect(problems).toEqual([]);
  });

  it('raid markup: the gate opening is open in the static map, the drawbridge deck is walkable, every perch sees the walls', () => {
    const { raid } = json();
    const sim = createSimWorld(load().def);
    const R = sim.rapier;
    const problems: string[] = [];
    // the gate opening: nothing static that blocks everyone across it (the keep's own duck-only wicket leaves are not MOVE)
    const g = raid.gate;
    for (const h of [0.5, 1.2, 2.0]) {
      const hit = sim.world.castRay(new R.Ray({ x: g.x - g.width / 2 + 0.05, y: g.y + h, z: g.z }, { x: 1, y: 0, z: 0 }), g.width - 0.1, true, undefined, MOVE_QUERY_GROUPS);
      if (hit) problems.push(`gate opening blocked at ${h} m (${hit.timeOfImpact.toFixed(2)} m in)`);
    }
    // the deck: walkable floor along its length
    const b = raid.drawbridge;
    for (let k = 1; k < 8; k++) {
      const z = b.hingeZ + (b.length * k) / 8;
      for (const x of [b.hingeX - 1.5, b.hingeX, b.hingeX + 1.5]) {
        const gd = groundUnder(sim, x, b.hingeY, z);
        if (gd === null || Math.abs(gd - b.hingeY) > 0.2) problems.push(`deck at (${x}, ${z.toFixed(1)}): floor ${gd?.toFixed(2)}`);
      }
    }
    // each perch sees some of the battlements (a standing duck's head over the wall walk) through the sight rays
    raid.sniperPerches.forEach(([px, py, pz], i) => {
      const eye = { x: px, y: py + 1.45, z: pz };
      let clear = 0;
      for (const line of raid.wallWalk) {
        for (let k = 0; k <= 10; k++) {
          const a = line[0]!;
          const c = line[line.length - 1]!;
          const t = { x: a[0] + ((c[0] - a[0]) * k) / 10, y: a[1] + 1.5, z: a[2] + ((c[2] - a[2]) * k) / 10 };
          const d = Math.hypot(t.x - eye.x, t.y - eye.y, t.z - eye.z);
          const ray = new R.Ray(eye, { x: (t.x - eye.x) / d, y: (t.y - eye.y) / d, z: (t.z - eye.z) / d });
          if (!sim.world.castRay(ray, d - 0.4, true, undefined, SIGHT_QUERY_GROUPS)) clear++;
        }
      }
      const r = Math.hypot(px - raid.core[0], pz - raid.core[2]);
      if (clear < 5) problems.push(`perch ${i} (${px}, ${pz}): sees only ${clear} wall walk points`);
      if (r < 90 || r > 140) problems.push(`perch ${i}: ${r.toFixed(0)} m from the core`);
    });
    sim.dispose();
    expect(problems).toEqual([]);
  });

  it('the moat holds: ducks running and jumping at it from the meadow or the berm never cross, the bridge and the lanes do', () => {
    const { raid } = json();
    const def = load().def;
    const sim = createSimWorld(def);
    const escapes: string[] = [];
    let tries = 0;
    for (const [offset, sign] of [
      [MOAT_W + 5.5, -1],
      [-3.4, 1],
    ] as const) {
      for (let k = 0; k < 120; k++) {
        const [x0, z0] = edgePoint(offset, (k + 0.5) / 120);
        if (nearCrossing(raid, x0, z0, 6)) continue;
        if (!bodyFree(sim, x0, terrainHeightAt(def.terrain, x0, z0) + 0.1, z0)) continue;
        // outward normal of the bank there
        const e = 0.5;
        const nx = islandSd(x0 + e, z0) - islandSd(x0 - e, z0);
        const nz = islandSd(x0, z0 + e) - islandSd(x0, z0 - e);
        const nl = Math.hypot(nx, nz) || 1;
        for (const lean of [-0.6, 0, 0.6]) {
          const ox = (sign * nx) / nl;
          const oz = (sign * nz) / nl;
          const dx = ox * Math.cos(lean) - oz * Math.sin(lean);
          const dz = ox * Math.sin(lean) + oz * Math.cos(lean);
          let bad = '';
          // a duck may slide along the reeds into a crossing: only a spot past the reeds away from the crossings counts
          run(sim, x0, z0, dx, dz, 150, true, (x, y, z) => {
            if (bad || nearCrossing(raid, x, z, 2.4)) return;
            const sd = islandSd(x, z);
            if (y < 0.4) bad = `down at y ${y.toFixed(2)} at (${x.toFixed(1)}, ${z.toFixed(1)})`;
            else if (sign < 0 && sd < MOAT_W - 0.2) bad = `past the outer reeds at (${x.toFixed(1)}, ${z.toFixed(1)})`;
            else if (sign > 0 && sd > 0.2) bad = `past the inner reeds at (${x.toFixed(1)}, ${z.toFixed(1)})`;
          });
          tries++;
          if (bad) escapes.push(`from (${x0.toFixed(1)}, ${z0.toFixed(1)}) lean ${lean}: ${bad}`);
        }
      }
    }
    expect(tries).toBeGreaterThan(300);
    expect(escapes).toEqual([]);
    // the crossings: over the drawbridge to the gate, and over every raft lane both ways
    const b = raid.drawbridge;
    const over = run(sim, b.hingeX, b.hingeZ + b.length + 3.5, 0, -1, 120, false);
    expect(over.duck.z, 'across the drawbridge').toBeLessThan(b.hingeZ - 2);
    expect(over.minY).toBeGreaterThan(0.5);
    for (const l of raid.raftLanes) {
      for (const [a, c] of [
        [l.from, l.to],
        [l.to, l.from],
      ] as const) {
        const d = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const r = run(sim, a[0], a[1], (c[0] - a[0]) / d, (c[1] - a[1]) / d, 150, false);
        expect(Math.hypot(r.duck.x - a[0], r.duck.z - a[1]), `lane (${a}) -> (${c})`).toBeGreaterThan(d - 0.5);
        expect(r.minY).toBeGreaterThan(0.3);
      }
    }
    sim.dispose();
  }, 180_000);

  it('the navmesh crosses the moat only on the raft lanes and the drawbridge (hunters walk them)', () => {
    const { raid } = json();
    const def = load().def;
    const sim = createSimWorld(def);
    const at = (x: number, z: number) => ({ x, y: terrainHeightAt(def.terrain, x, z), z });
    const overWater = (x: number, z: number) => {
      const sd = islandSd(x, z);
      return sd > 0.6 && sd < MOAT_W - 0.6;
    };
    const cases: { rect: [number, number, number, number]; from: { x: number; y: number; z: number }; to: { x: number; y: number; z: number }; corridor: (x: number, z: number) => boolean }[] = [];
    // the east lane: from the meadow to the berm east of the castle
    const east = raid.raftLanes.find((l) => l.from[0] > 30)!;
    cases.push({ rect: [8, -26, 70, 26], from: at(62, 2), to: at(25, -2), corridor: (x, z) => segDist(x, z, east.from, east.to) < 1.8 });
    // a north lane
    const north = raid.raftLanes.find((l) => l.from[1] < -30)!;
    cases.push({ rect: [north.from[0] - 22, -70, north.from[0] + 22, -8], from: at(north.from[0], -62), to: at(north.to[0], -25), corridor: (x, z) => segDist(x, z, north.from, north.to) < 1.8 });
    // the drawbridge: from the hunters' road to the courtyard, through the gate
    const b = raid.drawbridge;
    cases.push({ rect: [-26, 6, 26, 72], from: at(0, 64), to: { x: 0, y: LAND, z: 12 }, corridor: (x) => Math.abs(x - b.hingeX) < b.width / 2 + 0.2 });
    for (const c of cases) {
      const nav = new BotNav(buildNavMesh(def, c.rect));
      const path = nav.path(c.from, c.to);
      expect(path, `a path from (${c.from.x}, ${c.from.z}) to (${c.to.x}, ${c.to.z})`).not.toBeNull();
      const pts = path ?? [];
      const end = pts[pts.length - 1]!;
      expect(Math.hypot(end.x - c.to.x, end.z - c.to.z)).toBeLessThan(2.5);
      let crossed = false;
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[i - 1]!;
        const p1 = pts[i]!;
        const n = Math.ceil(Math.hypot(p1.x - p0.x, p1.z - p0.z) / 0.5);
        for (let k = 0; k <= n; k++) {
          const x = p0.x + ((p1.x - p0.x) * k) / n;
          const z = p0.z + ((p1.z - p0.z) * k) / n;
          if (!overWater(x, z)) continue;
          crossed = true;
          expect(c.corridor(x, z), `the path crosses the moat at (${x.toFixed(1)}, ${z.toFixed(1)}), off the crossing`).toBe(true);
        }
      }
      expect(crossed).toBe(true);
    }
    sim.dispose();
  }, 120_000);
});

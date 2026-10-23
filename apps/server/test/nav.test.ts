import { beforeAll, describe, expect, it } from 'vitest';
import { createSimWorld, groundHeightAt, initPhysics } from '@qwakk/shared';
import { exportNavMesh } from 'recast-navigation';
import { hullTriangles } from '../src/nav/geometry.ts';
import { BotNav } from '../src/nav/botNav.ts';
import { buildNavMesh, initNav } from '../src/nav/navmesh.ts';
import { loadMapV1, loadSainteCanard } from '../src/maps.ts';

beforeAll(async () => {
  await initPhysics();
  await initNav();
});

describe('convex hull triangulation', () => {
  it('gives the 12 outward faces of a cube', () => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 8; i++) pts.push([i & 1 ? 1 : -1, i & 2 ? 1 : -1, i & 4 ? 1 : -1]);
    const tris = hullTriangles(pts);
    // Coplanar quads yield 4 triangles each (all triples of the face): 6 faces x 4.
    expect(tris.length).toBe(24);
    for (const [a, b, c] of tris) {
      const [pa, pb, pc] = [pts[a]!, pts[b]!, pts[c]!];
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const center = [(pa[0] + pb[0] + pc[0]) / 3, (pa[1] + pb[1] + pc[1]) / 3, (pa[2] + pb[2] + pc[2]) / 3];
      // Outward: the normal points away from the cube center (the origin).
      expect(n[0]! * center[0]! + n[1]! * center[1]! + n[2]! * center[2]!).toBeGreaterThan(0);
    }
  });
});

describe('bot navmesh on Yelova', () => {
  // The village square to the crossroads: a rectangle of the map, built twice.
  const RECT: [number, number, number, number] = [-80, -260, 140, 120];

  it('builds deterministically and finds a walkable path from the village square to the crossroads', () => {
    const map = loadSainteCanard().def;
    const a = buildNavMesh(map, RECT);
    const b = buildNavMesh(map, RECT);
    const bytesA = exportNavMesh(a);
    expect(bytesA.length).toBeGreaterThan(1000);
    expect(Buffer.from(bytesA).equals(Buffer.from(exportNavMesh(b)))).toBe(true);

    const nav = new BotNav(a);
    const path = nav.path({ x: 40, y: 8.5, z: -192 }, { x: 22, y: 8, z: 62 });
    expect(path).not.toBeNull();
    const pts = path ?? [];
    const end = pts[pts.length - 1]!;
    expect(Math.hypot(end.x - 22, end.z - 62)).toBeLessThan(3);
    // Every corner is on ground a duck can stand on (a Rapier ground probe from above lands near it).
    const sim = createSimWorld(map);
    for (const p of pts) {
      const g = groundHeightAt(sim, p.x, p.y + 1.5, p.z);
      expect(Math.abs(g - p.y)).toBeLessThan(0.8);
    }
    sim.dispose();
  }, 120_000);
});

describe('bot navmesh on Kavren', () => {
  it('routes bots around and through the QoreChain Tower in the middle of the square, never through its core', () => {
    const map = loadMapV1('canard-quarter');
    const tower = map.loaded!.extras.props.find((p) => p.prop === 'qorechain_tower')!;
    expect(tower).toBeDefined();
    const nav = new BotNav(buildNavMesh(map.def, [tower.x - 45, tower.z - 45, tower.x + 45, tower.z + 45]));
    const sim = createSimWorld(map.def);
    // the core (4 x 4 m) and the arcade piers: no path segment may cross the solid parts (the arches,
    // 3 m wide at -4.5, 0 and 4.5 m along every face, are the way in)
    const inCore = (p: { x: number; z: number }) => Math.abs(p.x - tower.x) < 2.2 && Math.abs(p.z - tower.z) < 2.2;
    const inWall = (p: { x: number; z: number }) => {
      const ax = Math.abs(p.x - tower.x);
      const az = Math.abs(p.z - tower.z);
      const along = ax > az ? az : ax;
      return Math.max(ax, az) > 7.3 && Math.max(ax, az) < 8.1 && ![0, 4.5].some((c) => Math.abs(along - c) < 1.5);
    };
    const legs: [number, number, number, number][] = [
      [0, 14, 0, -14], // south of the tower to north of it
      [-11, 0, 10.5, 0], // west to east (the tank wreck stands at +14)
      [-4.5, 14, 4.5, 3.4], // from the street into the hall, to the corridor behind the core
    ];
    for (const [ax, az, bx, bz] of legs) {
      const a = { x: tower.x + ax, y: tower.y + 0.2, z: tower.z + az };
      const b = { x: tower.x + bx, y: tower.y + 0.2, z: tower.z + bz };
      const path = nav.path(a, b);
      expect(path, `no path ${JSON.stringify([ax, az, bx, bz])}`).not.toBeNull();
      const pts = path!;
      const end = pts[pts.length - 1]!;
      expect(Math.hypot(end.x - b.x, end.z - b.z), `leg ${JSON.stringify([ax, az, bx, bz])} ends at (${end.x.toFixed(2)}, ${end.y.toFixed(2)}, ${end.z.toFixed(2)})`).toBeLessThan(1.5);
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1]!;
        const q = pts[i]!;
        for (let k = 0; k <= 10; k++) {
          const m = { x: p.x + ((q.x - p.x) * k) / 10, z: p.z + ((q.z - p.z) * k) / 10 };
          expect(inCore(m) || inWall(m), `path ${JSON.stringify([ax, az, bx, bz])} crosses the tower at (${m.x.toFixed(1)}, ${m.z.toFixed(1)})`).toBe(false);
        }
        // probe from 0.8 m up: a standing capsule from higher would start inside an arch top over a corner in an arch
        const g = groundHeightAt(sim, q.x, q.y + 0.8, q.z);
        expect(Math.abs(g - q.y), `corner (${q.x.toFixed(2)}, ${q.y.toFixed(2)}, ${q.z.toFixed(2)}) ground ${g.toFixed(2)}`).toBeLessThan(0.8);
      }
    }
    sim.dispose();
  }, 120_000);
});

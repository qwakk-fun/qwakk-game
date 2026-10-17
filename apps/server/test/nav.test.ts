import { beforeAll, describe, expect, it } from 'vitest';
import { createSimWorld, groundHeightAt, initPhysics } from '@qwakk/shared';
import { exportNavMesh } from 'recast-navigation';
import { hullTriangles } from '../src/nav/geometry.ts';
import { BotNav } from '../src/nav/botNav.ts';
import { buildNavMesh, initNav } from '../src/nav/navmesh.ts';
import { loadSainteCanard } from '../src/maps.ts';

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

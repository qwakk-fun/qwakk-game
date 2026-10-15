/**
 * Triangle soup for the navmesh: the terrain heightfield (same triangle split
 * as terrainHeightAt and Rapier) plus every static collider that blocks
 * movement (walls, floors, stairs, hedges, wire...). Bushes (foliage) do not
 * block movement, so they are left out. Deep sea is left out too, so bots
 * never path through it.
 */
import { CG, type MapDef, type Quat, type ShapeDef, type Vec3 } from '@qwakk/shared';

/** Terrain cells whose highest corner is below this are deep water: not walkable. */
const DEEP_WATER = -1.2;
/** Sides of the prism that stands in for capsules and cylinders. */
const PRISM_SIDES = 8;

export interface TriSoup {
  positions: Float32Array;
  indices: Uint32Array;
}

class Soup {
  readonly pos: number[] = [];
  readonly idx: number[] = [];

  vert(x: number, y: number, z: number): number {
    this.pos.push(x, y, z);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
}

function rotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  // v + 2 w (q x v) + 2 q x (q x v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}

function addTerrain(map: MapDef, s: Soup): void {
  const t = map.terrain;
  const n = t.cells;
  const w = n + 1;
  const half = (n * t.cellSize) / 2;
  const base = s.pos.length / 3;
  for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) s.vert(-half + c * t.cellSize, t.heights[r * w + c] ?? 0, -half + r * t.cellSize);
  const h = (i: number): number => t.heights[i] ?? 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const a = r * w + c;
      const b = a + 1;
      const d = a + w;
      const e = d + 1;
      if (Math.max(h(a), h(b), h(d), h(e)) < DEEP_WATER) continue;
      // Diagonal from (r, c + 1) to (r + 1, c), like the Rapier heightfield; normals up.
      s.tri(base + a, base + d, base + b);
      s.tri(base + b, base + d, base + e);
    }
  }
}

/** Box from center, half extents and rotation, faces wound outward. */
function addBox(c: Vec3, h: Vec3, q: Quat, s: Soup): void {
  const v: number[] = [];
  for (let i = 0; i < 8; i++) {
    const p = rotate(q, [i & 1 ? h[0] : -h[0], i & 2 ? h[1] : -h[1], i & 4 ? h[2] : -h[2]]);
    v.push(s.vert(c[0] + p[0], c[1] + p[1], c[2] + p[2]));
  }
  const quads = [
    [2, 6, 7, 3], // +y (top)
    [0, 1, 5, 4], // -y
    [1, 3, 7, 5], // +x
    [0, 4, 6, 2], // -x
    [4, 5, 7, 6], // +z
    [0, 2, 3, 1], // -z
  ];
  for (const [a, b, cc, d] of quads) {
    s.tri(v[a!]!, v[b!]!, v[cc!]!);
    s.tri(v[a!]!, v[cc!]!, v[d!]!);
  }
}

/** Capsule or cylinder as a prism along local +Y. */
function addPrism(c: Vec3, r: number, hh: number, q: Quat, s: Soup): void {
  const top: number[] = [];
  const bot: number[] = [];
  for (let i = 0; i < PRISM_SIDES; i++) {
    const a = (i / PRISM_SIDES) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const pt = rotate(q, [x, hh, z]);
    const pb = rotate(q, [x, -hh, z]);
    top.push(s.vert(c[0] + pt[0], c[1] + pt[1], c[2] + pt[2]));
    bot.push(s.vert(c[0] + pb[0], c[1] + pb[1], c[2] + pb[2]));
  }
  for (let i = 0; i < PRISM_SIDES; i++) {
    const j = (i + 1) % PRISM_SIDES;
    s.tri(bot[i]!, top[i]!, top[j]!);
    s.tri(bot[i]!, top[j]!, bot[j]!);
    if (i > 0 && j > 0) {
      s.tri(top[0]!, top[j]!, top[i]!);
      s.tri(bot[0]!, bot[i]!, bot[j]!);
    }
  }
}

/** Convex hull faces of a small point set (brute force: fine for a few dozen points). */
export function hullTriangles(pts: readonly Vec3[]): [number, number, number][] {
  const n = pts.length;
  const out: [number, number, number][] = [];
  const eps = 1e-6;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const a = pts[i]!;
        const b = pts[j]!;
        const c = pts[k]!;
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        const len = Math.hypot(nx, ny, nz);
        if (len < eps) continue;
        let pos = 0;
        let neg = 0;
        for (let m = 0; m < n; m++) {
          if (m === i || m === j || m === k) continue;
          const p = pts[m]!;
          const d = ((p[0] - a[0]) * nx + (p[1] - a[1]) * ny + (p[2] - a[2]) * nz) / len;
          if (d > eps) pos++;
          else if (d < -eps) neg++;
          if (pos && neg) break;
        }
        if (pos && neg) continue;
        // Outward: the other points lie behind the face.
        out.push(pos > 0 ? [i, k, j] : [i, j, k]);
      }
    }
  }
  return out;
}

function addShape(sh: ShapeDef, s: Soup): void {
  if (sh.type === 'box' && sh.h) addBox(sh.c, sh.h, sh.q, s);
  else if (sh.type === 'capsule') addPrism(sh.c, sh.r ?? 0.1, (sh.hh ?? 0) + (sh.r ?? 0.1), sh.q, s);
  else if (sh.type === 'cylinder') addPrism(sh.c, sh.r ?? 0.1, sh.hh ?? 0, sh.q, s);
  else if (sh.type === 'hull' && sh.pts) {
    const pts: Vec3[] = [];
    for (let i = 0; i + 2 < sh.pts.length; i += 3) pts.push([sh.pts[i]!, sh.pts[i + 1]!, sh.pts[i + 2]!]);
    const ids = pts.map((p) => s.vert(p[0], p[1], p[2]));
    for (const [a, b, c] of hullTriangles(pts)) s.tri(ids[a]!, ids[b]!, ids[c]!);
  }
}

export function navGeometry(map: MapDef): TriSoup {
  const s = new Soup();
  addTerrain(map, s);
  for (const b of map.boxes) addBox(b.c, b.h, b.q, s);
  for (const r of map.rocks) addPrism(r.c, r.r, r.r, [0, 0, 0, 1], s);
  for (const sh of map.shapes) if (sh.bits & CG.Move) addShape(sh, s);
  return { positions: Float32Array.from(s.pos), indices: Uint32Array.from(s.idx) };
}

/**
 * Deathmatch spawn points on loaded maps (map_v1). A map can list its own in
 * the optional top-level `dmSpawns` field, `[[x, y, z, yaw], ...]` (yaw in
 * radians, three.js convention: 0 faces -z). A map without them gets points
 * derived on open ground within MATCH.derivedSpawnRadius of its plaza (or its
 * center): a grid that skips prop footprints, water and steep ground, thinned
 * out to well spread points. Pure and deterministic, like the rest of the map
 * loader (the server is the only user today, but both sides could build it).
 */
import type { WaterDef } from './brMapData.ts';
import { waterSurfaceAt } from './brMapData.ts';
import { MATCH } from './constants.ts';
import type { ShapeDef, TerrainDef, Vec3 } from './map.ts';
import { terrainHeightAt } from './map.ts';

export interface DmSpawns {
  points: Vec3[];
  /** Facing per point, or null (face the arena center). */
  yaws: number[] | null;
  /** The play area: bots roam inside it, the autopilot heads for its center. */
  arena: { x: number; z: number; radius: number };
}

/**
 * The optional `playArea.ring` ([[x, z], ...], the closed hedge's center
 * line): bots keep their goals inside it. Null when missing.
 */
export function parsePlayRing(raw: unknown): [number, number][] | null {
  if (!raw || typeof raw !== 'object') return null;
  const ring = (raw as { ring?: unknown }).ring;
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const out: [number, number][] = [];
  for (const p of ring) {
    if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number' || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    out.push([p[0], p[1]]);
  }
  return out;
}

/** Parse the optional `dmSpawns` field. Null when it is missing or empty. */
export function parseDmSpawns(raw: unknown): { points: Vec3[]; yaws: number[] } | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const points: Vec3[] = [];
  const yaws: number[] = [];
  raw.forEach((p, i) => {
    if (!Array.isArray(p) || p.length < 3) throw new Error(`map_v1: dmSpawns[${i}] must be [x, y, z, yaw]`);
    const v = p.slice(0, 4).map((n) => (typeof n === 'number' && Number.isFinite(n) ? n : Number.NaN));
    if (v.slice(0, 3).some((n) => Number.isNaN(n))) throw new Error(`map_v1: dmSpawns[${i}] must hold numbers`);
    points.push([v[0] as number, v[1] as number, v[2] as number]);
    yaws.push(Number.isNaN(v[3] ?? Number.NaN) ? 0 : (v[3] as number));
  });
  return { points, yaws };
}

/** The bounding circle of a point set (center of the bounds), plus a margin. */
export function arenaAround(points: readonly Vec3[], margin: number): { x: number; z: number; radius: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p[0]);
    x1 = Math.max(x1, p[0]);
    z0 = Math.min(z0, p[2]);
    z1 = Math.max(z1, p[2]);
  }
  const x = (x0 + x1) / 2;
  const z = (z0 + z1) / 2;
  let r = 0;
  for (const p of points) r = Math.max(r, Math.hypot(p[0] - x, p[2] - z));
  return { x, z, radius: r + margin };
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

/** World-space bounds of one collider (rotated boxes exactly, round shapes generously). */
function boundsOf(s: ShapeDef): Box {
  if (s.type === 'hull' && s.pts && s.pts.length >= 3) {
    const b: Box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
    for (let i = 0; i + 2 < s.pts.length; i += 3) {
      const x = s.pts[i] as number;
      const y = s.pts[i + 1] as number;
      const z = s.pts[i + 2] as number;
      b.x0 = Math.min(b.x0, x);
      b.x1 = Math.max(b.x1, x);
      b.y0 = Math.min(b.y0, y);
      b.y1 = Math.max(b.y1, y);
      b.z0 = Math.min(b.z0, z);
      b.z1 = Math.max(b.z1, z);
    }
    return b;
  }
  const [cx, cy, cz] = s.c;
  let ex: number;
  let ey: number;
  let ez: number;
  if (s.type === 'box' && s.h) {
    // Extent of a rotated box: |R| * h.
    const [qx, qy, qz, qw] = s.q;
    const r = [
      [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
      [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
      [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
    ] as const;
    const [hx, hy, hz] = s.h;
    const ext = (row: readonly number[]): number => Math.abs(row[0] as number) * hx + Math.abs(row[1] as number) * hy + Math.abs(row[2] as number) * hz;
    ex = ext(r[0]);
    ey = ext(r[1]);
    ez = ext(r[2]);
  } else {
    const e = (s.r ?? 0.5) + (s.hh ?? 0);
    ex = e;
    ey = e;
    ez = e;
  }
  return { x0: cx - ex, x1: cx + ex, y0: cy - ey, y1: cy + ey, z0: cz - ez, z1: cz + ez };
}

/** Clearance around a spawn from any prop footprint (m). */
const CLEAR = 1.0;

/**
 * Spawn points on open ground within `radius` of (cx, cz): grid points every
 * `step` meters off any collider's footprint (near the ground), out of the
 * water and off steep ground, then thinned to at most `max` points by
 * farthest-point sampling (first point: the one nearest the center).
 */
export function deriveDmSpawns(
  terrain: TerrainDef,
  shapes: readonly ShapeDef[],
  water: WaterDef | null,
  cx: number,
  cz: number,
  radius: number = MATCH.derivedSpawnRadius,
  step: number = MATCH.derivedSpawnStep,
  max: number = MATCH.derivedSpawnMax,
): Vec3[] {
  const near: Box[] = [];
  for (const s of shapes) {
    const b = boundsOf(s);
    if (b.x1 < cx - radius - CLEAR || b.x0 > cx + radius + CLEAR || b.z1 < cz - radius - CLEAR || b.z0 > cz + radius + CLEAR) continue;
    near.push(b);
  }
  const half = (terrain.cells * terrain.cellSize) / 2 - 12;
  const free: Vec3[] = [];
  const n = Math.floor(radius / step);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const x = cx + i * step;
      const z = cz + j * step;
      if (Math.hypot(x - cx, z - cz) > radius || Math.abs(x) > half || Math.abs(z) > half) continue;
      const g = terrainHeightAt(terrain, x, z);
      if (water && waterSurfaceAt(water, x, z) > g - 0.1) continue;
      const slope = Math.max(Math.abs(terrainHeightAt(terrain, x + 1, z) - g), Math.abs(terrainHeightAt(terrain, x, z + 1) - g), Math.abs(terrainHeightAt(terrain, x - 1, z) - g), Math.abs(terrainHeightAt(terrain, x, z - 1) - g));
      if (slope > 0.6) continue;
      let blocked = false;
      for (const b of near) {
        if (x < b.x0 - CLEAR || x > b.x1 + CLEAR || z < b.z0 - CLEAR || z > b.z1 + CLEAR) continue;
        // Anything from just under the ground to above the head blocks (floors, walls, roofs over a doorway).
        if (b.y1 < g - 0.3 || b.y0 > g + 2.4) continue;
        blocked = true;
        break;
      }
      if (!blocked) free.push([x, g + 0.5, z]);
    }
  }
  if (free.length <= max) return free;
  // Farthest-point sampling: well spread, deterministic.
  let first = 0;
  for (let i = 1; i < free.length; i++) {
    const a = free[i] as Vec3;
    const b = free[first] as Vec3;
    if (Math.hypot(a[0] - cx, a[2] - cz) < Math.hypot(b[0] - cx, b[2] - cz)) first = i;
  }
  const out: Vec3[] = [free[first] as Vec3];
  const dist = free.map((p) => Math.hypot(p[0] - (out[0] as Vec3)[0], p[2] - (out[0] as Vec3)[2]));
  while (out.length < max) {
    let best = -1;
    for (let i = 0; i < free.length; i++) if (best < 0 || (dist[i] as number) > (dist[best] as number)) best = i;
    const p = free[best] as Vec3;
    out.push(p);
    for (let i = 0; i < free.length; i++) dist[i] = Math.min(dist[i] as number, Math.hypot((free[i] as Vec3)[0] - p[0], (free[i] as Vec3)[2] - p[2]));
  }
  return out;
}

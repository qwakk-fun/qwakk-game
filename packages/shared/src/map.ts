/**
 * Deterministic greybox island. The same seed gives bit-identical data on the
 * client and the server, so both build identical Rapier colliders.
 *
 * Coordinates: x east, y up, z south. The island is centered at the origin and
 * the sea surface is y = 0.
 */
import type { KeepGeometry } from './raid/keep.ts';
import { dcos, dsin, clamp } from './math.ts';
import { createRng, fbm } from './rng.ts';
import type { BrMapData, WaterDef } from './brMapData.ts';

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export type BoxKind = 'foundation' | 'wall' | 'floor' | 'roof' | 'stairs' | 'ramp' | 'crate' | 'cover' | 'block' | 'boundary';

export interface BoxDef {
  kind: BoxKind;
  /** Center. */
  c: Vec3;
  /** Half extents. */
  h: Vec3;
  /** Rotation quaternion (x, y, z, w). */
  q: Quat;
}

export interface RockDef {
  c: Vec3;
  r: number;
}

export interface TerrainDef {
  /** Cells per side. The heights grid has (cells + 1)^2 samples. */
  cells: number;
  cellSize: number;
  /** Row-major heights: index = row * (cells + 1) + col, row along z, col along x. */
  heights: Float32Array;
}

/** A static collider of a loaded map (map_v1 props), already in world space. */
export interface ShapeDef {
  type: 'box' | 'capsule' | 'cylinder' | 'hull';
  /** Membership bits (collision.ts CG): what this shape blocks. */
  bits: number;
  /** The collider kind from colliders.json (wall, hedge, foliage...). */
  kind: string;
  /** Center and rotation (x, y, z, w). Hulls use the origin and identity: their points are in world space. */
  c: Vec3;
  q: Quat;
  /** Box half extents. */
  h?: Vec3;
  /** Capsule and cylinder radius and half height of the straight part (along local +Y). */
  r?: number;
  hh?: number;
  /**
   * Hunt Season keep (raid/keep.ts): a collider the server switches on and
   * off by this name (bullets and sight only, never movement). Both sides
   * build it so the collider lists match.
   */
  toggle?: string;
  /** Hull points, flat x, y, z in world space. */
  pts?: number[];
}

export interface MapDef {
  /** 'greybox' (generated from the seed) or a loaded map id such as 'sainte-canard'. */
  id: string;
  seed: number;
  /** Side length in meters. */
  size: number;
  seaLevel: number;
  terrain: TerrainDef;
  boxes: BoxDef[];
  rocks: RockDef[];
  spawns: Vec3[];
  /** Deathmatch arena: a town ring around the center. */
  arena: { x: number; z: number; radius: number };
  /** Deathmatch spawn points inside the arena, on open ground. */
  arenaSpawns: Vec3[];
  /** Facing per arena spawn (map_v1 `dmSpawns`); missing: face the arena center. */
  arenaYaws?: number[];
  /** Deathmatch play area outline ([x, z], map_v1 `playArea.ring`); bots keep their goals inside it. */
  playRing?: [number, number][];
  /** Loaded maps: prop colliders (empty for the greybox). */
  shapes: ShapeDef[];
  /** Water surfaces for the wading rule (null: no water slow-down). */
  water: WaterDef | null;
  /** Battle royale data (loot points, flight paths, circle hints); null for the greybox. */
  br: BrMapData | null;
  /** Hunt Season castle (map_v1 `raid` markup, raid/keep.ts); absent on maps without one. */
  raid?: KeepGeometry;
}

/** Deathmatch arena radius around the island center (m). */
export const ARENA_RADIUS = 75;

export const MAP_SIZE = 840;
const CELL_SIZE = 4;
const SEA_FLOOR = -4;

const IDENTITY: Quat = [0, 0, 0, 1];

function yawQuat(yaw: number): Quat {
  return [0, dsin(yaw * 0.5), 0, dcos(yaw * 0.5)];
}

/** Rotation by yaw (around y) after pitch (around local x). */
function yawPitchQuat(yaw: number, pitch: number): Quat {
  const sy = dsin(yaw * 0.5);
  const cy = dcos(yaw * 0.5);
  const sp = dsin(pitch * 0.5);
  const cp = dcos(pitch * 0.5);
  return [cy * sp, cp * sy, -sy * sp, cy * cp];
}

/** Raw island height before any flattening. */
function islandHeight(x: number, z: number, seed: number): number {
  const half = MAP_SIZE / 2;
  const nx = x / half;
  const nz = z / half;
  const d = Math.sqrt(nx * nx + nz * nz);
  const coast = 0.8 + 0.2 * (fbm(x * 0.005 + 100, z * 0.005 - 50, seed + 7, 3) - 0.5);
  const t = clamp((d - (coast - 0.16)) / 0.16, 0, 1);
  const land = 1 - t * t * (3 - 2 * t);
  const hills = fbm(x * 0.007, z * 0.007, seed, 4);
  const ridges = hills * hills * 26;
  return land * (1.5 + ridges) + (1 - land) * SEA_FLOOR;
}

interface Pad {
  x: number;
  z: number;
  /** Half extents of the flat area, in the pad's local frame. */
  hx: number;
  hz: number;
  yaw: number;
  y: number;
  /** Blend distance outside the flat area. */
  falloff: number;
}

/** Signed distance outside a rotated rectangle (0 inside). */
function rectDistance(p: Pad, x: number, z: number): number {
  const c = dcos(p.yaw);
  const s = dsin(p.yaw);
  const dx = x - p.x;
  const dz = z - p.z;
  // Inverse rotation into the pad frame (three.js yaw convention).
  const lx = c * dx - s * dz;
  const lz = s * dx + c * dz;
  const ox = Math.max(Math.abs(lx) - p.hx, 0);
  const oz = Math.max(Math.abs(lz) - p.hz, 0);
  return Math.sqrt(ox * ox + oz * oz);
}

/** Local offset (lx, lz) rotated by yaw, matching three.js Object3D yaw. */
function rotateXZ(lx: number, lz: number, yaw: number): [number, number] {
  const c = dcos(yaw);
  const s = dsin(yaw);
  return [c * lx + s * lz, -s * lx + c * lz];
}

class Builder {
  boxes: BoxDef[] = [];

  /** Add a box given in a local frame placed at (ox, oy, oz) with yaw. */
  local(kind: BoxKind, ox: number, oy: number, oz: number, yaw: number, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): void {
    const [rx, rz] = rotateXZ(cx, cz, yaw);
    this.boxes.push({ kind, c: [ox + rx, oy + cy, oz + rz], h: [hx, hy, hz], q: yawQuat(yaw) });
  }

  /** Box from min/max corners in the local frame. */
  localMinMax(kind: BoxKind, ox: number, oy: number, oz: number, yaw: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    this.local(kind, ox, oy, oz, yaw, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2);
  }
}

interface Opening {
  /** Center along the wall (local coordinate from -len/2 to len/2). */
  at: number;
  width: number;
  bottom: number;
  top: number;
}

/**
 * A wall along local x from -len/2 to len/2 (thickness t, centered at z = wz),
 * with rectangular openings. Emits columns between openings plus sills and lintels.
 */
function wallX(b: Builder, ox: number, oy: number, oz: number, yaw: number, wz: number, len: number, height: number, t: number, openings: Opening[]): void {
  const sorted = [...openings].sort((a, c) => a.at - c.at);
  let cursor = -len / 2;
  for (const o of sorted) {
    const o0 = o.at - o.width / 2;
    const o1 = o.at + o.width / 2;
    if (o0 > cursor) b.localMinMax('wall', ox, oy, oz, yaw, cursor, 0, wz - t / 2, o0, height, wz + t / 2);
    if (o.bottom > 0) b.localMinMax('wall', ox, oy, oz, yaw, o0, 0, wz - t / 2, o1, o.bottom, wz + t / 2);
    if (o.top < height) b.localMinMax('wall', ox, oy, oz, yaw, o0, o.top, wz - t / 2, o1, height, wz + t / 2);
    cursor = o1;
  }
  if (cursor < len / 2) b.localMinMax('wall', ox, oy, oz, yaw, cursor, 0, wz - t / 2, len / 2, height, wz + t / 2);
}

/** Same as wallX but along local z, centered at x = wx. */
function wallZ(b: Builder, ox: number, oy: number, oz: number, yaw: number, wx: number, len: number, height: number, t: number, openings: Opening[]): void {
  const sorted = [...openings].sort((a, c) => a.at - c.at);
  let cursor = -len / 2;
  for (const o of sorted) {
    const o0 = o.at - o.width / 2;
    const o1 = o.at + o.width / 2;
    if (o0 > cursor) b.localMinMax('wall', ox, oy, oz, yaw, wx - t / 2, 0, cursor, wx + t / 2, height, o0);
    if (o.bottom > 0) b.localMinMax('wall', ox, oy, oz, yaw, wx - t / 2, 0, o0, wx + t / 2, o.bottom, o1);
    if (o.top < height) b.localMinMax('wall', ox, oy, oz, yaw, wx - t / 2, o.top, o0, wx + t / 2, height, o1);
    cursor = o1;
  }
  if (cursor < len / 2) b.localMinMax('wall', ox, oy, oz, yaw, wx - t / 2, 0, cursor, wx + t / 2, height, len / 2);
}

export const BUILDING = {
  width: 12,
  depth: 9,
  story: 3.2,
  wall: 0.3,
  slab: 0.25,
  stepRise: 0.25,
  stepRun: 0.32,
  stairWidth: 1.4,
} as const;

/** Two-story house with doors, windows, inner stairs and a stairwell. */
function addBuilding(b: Builder, ox: number, oy: number, oz: number, yaw: number): void {
  const { width: W, depth: D, story: S, wall: t, slab, stepRise, stepRun, stairWidth } = BUILDING;
  const H = S * 2 + slab;
  const door = { width: 1.5, bottom: 0, top: 2.3 };
  const win = (at: number, width = 1.6): Opening => ({ at, width, bottom: S + 1.0, top: S + 2.2 });

  // Foundation slab hides small terrain bumps. Top at y = 0.15.
  b.localMinMax('foundation', ox, oy, oz, yaw, -W / 2 - 0.3, -2, -D / 2 - 0.3, W / 2 + 0.3, 0.15, D / 2 + 0.3);

  // Outer walls: front (+z) and back (-z) with doors, sides with windows.
  wallX(b, ox, oy, oz, yaw, D / 2 - t / 2, W, H, t, [{ at: 2, ...door }, win(-3)]);
  wallX(b, ox, oy, oz, yaw, -D / 2 + t / 2, W, H, t, [{ at: -2.5, ...door }, win(2.5)]);
  wallZ(b, ox, oy, oz, yaw, W / 2 - t / 2, D - 2 * t, H, t, [win(0, 2.2)]);
  wallZ(b, ox, oy, oz, yaw, -W / 2 + t / 2, D - 2 * t, H, t, [win(1.5, 1.2)]);

  // Interior extents.
  const ix0 = -W / 2 + t;
  const ix1 = W / 2 - t;
  const iz0 = -D / 2 + t;
  const iz1 = D / 2 - t;

  // Stairs along the inner +x wall, climbing toward -z, ending at the second floor.
  const steps = Math.ceil(S / stepRise);
  const rise = S / steps;
  const sx0 = ix1 - stairWidth;
  const stairStartZ = iz1 - 0.6;
  for (let i = 0; i < steps; i++) {
    const z1 = stairStartZ - i * stepRun;
    const z0 = z1 - stepRun;
    b.localMinMax('stairs', ox, oy, oz, yaw, sx0, 0, z0, ix1, 0.15 + (i + 1) * rise, z1);
  }
  const stairEndZ = stairStartZ - steps * stepRun;

  // Second floor slab with a stairwell hole over the stairs (plus head room).
  const holeZ0 = stairEndZ;
  const holeZ1 = stairStartZ;
  const fy0 = 0.15 + S - slab;
  const fy1 = 0.15 + S;
  b.localMinMax('floor', ox, oy, oz, yaw, ix0, fy0, iz0, sx0, fy1, iz1);
  b.localMinMax('floor', ox, oy, oz, yaw, sx0, fy0, iz0, ix1, fy1, holeZ0);
  if (holeZ1 < iz1) b.localMinMax('floor', ox, oy, oz, yaw, sx0, fy0, holeZ1, ix1, fy1, iz1);
  // Low rail along the stairwell so the hole reads clearly.
  b.localMinMax('cover', ox, oy, oz, yaw, sx0 - 0.12, fy1, holeZ0 + 1.2, sx0, fy1 + 0.95, holeZ1);

  // Interior divider on the ground floor with a doorway, gives close-quarters cover.
  wallX(b, ox, oy, oz, yaw, 0.5, W - 2 * t - stairWidth - 0.2, S - slab, 0.2, [{ at: -1.5, width: 1.3, bottom: 0, top: 2.2 }]);

  // Roof.
  b.localMinMax('roof', ox, oy, oz, yaw, -W / 2 - 0.2, H, -D / 2 - 0.2, W / 2 + 0.2, H + 0.3, D / 2 + 0.2);
}

/** Movement test course: ramps at several slopes, step blocks and jump platforms. */
function addPlayground(b: Builder, ox: number, oy: number, oz: number): void {
  const slopes = [15, 30, 40, 45, 50, 60];
  const len = 10;
  for (let i = 0; i < slopes.length; i++) {
    const deg = slopes[i] ?? 0;
    const pitch = (deg / 180) * 3.141592653589793;
    const sp = dsin(pitch);
    const cp = dcos(pitch);
    const x = ox - 18 + i * 6;
    // Ramp is a thin box tilted around x; its top surface rises toward -z.
    const hz = len / 2;
    const hy = 0.25;
    const cy = oy + sp * hz - cp * hy;
    const cz = oz - 12;
    b.boxes.push({ kind: 'ramp', c: [x, cy, cz - cp * hz + hz], h: [2.4, hy, hz], q: yawPitchQuat(0, pitch) });
  }
  // Step test blocks: 0.2, 0.35, 0.45 (max climbable), 0.55 (too high).
  const stepHeights = [0.2, 0.35, 0.45, 0.55];
  for (let i = 0; i < stepHeights.length; i++) {
    const h = stepHeights[i] ?? 0;
    b.boxes.push({ kind: 'block', c: [ox - 16 + i * 5, oy + h / 2, oz + 8], h: [1.8, h / 2, 1.8], q: IDENTITY });
  }
  // Jump platforms: 0.9 m (jumpable), 1.3 m (not), plus a staircase of crates.
  b.boxes.push({ kind: 'block', c: [ox + 6, oy + 0.45, oz + 8], h: [2, 0.45, 2], q: IDENTITY });
  b.boxes.push({ kind: 'block', c: [ox + 12, oy + 0.65, oz + 8], h: [2, 0.65, 2], q: IDENTITY });
  for (let i = 0; i < 5; i++) {
    b.boxes.push({ kind: 'crate', c: [ox + 18 + i * 2.6, oy + 0.4 + i * 0.4, oz + 4], h: [1, 0.4 + i * 0.4, 1], q: IDENTITY });
  }
  // A long corridor for strafe testing.
  b.boxes.push({ kind: 'cover', c: [ox, oy + 1.25, oz + 18], h: [14, 1.25, 0.2], q: IDENTITY });
  b.boxes.push({ kind: 'cover', c: [ox, oy + 1.25, oz + 22], h: [14, 1.25, 0.2], q: IDENTITY });
}

/** Bilinear height lookup on the generated terrain grid (approximate on cell triangles). */
export function terrainHeightAt(t: TerrainDef, x: number, z: number): number {
  const n = t.cells;
  const half = (n * t.cellSize) / 2;
  const fx = clamp((x + half) / t.cellSize, 0, n - 1e-6);
  const fz = clamp((z + half) / t.cellSize, 0, n - 1e-6);
  const c = Math.floor(fx);
  const r = Math.floor(fz);
  const u = fx - c;
  const v = fz - r;
  const w = n + 1;
  const h00 = t.heights[r * w + c] ?? 0;
  const h01 = t.heights[r * w + c + 1] ?? 0;
  const h10 = t.heights[(r + 1) * w + c] ?? 0;
  const h11 = t.heights[(r + 1) * w + c + 1] ?? 0;
  // Same triangle split as the Rapier heightfield: the diagonal runs from
  // (r, c + 1) to (r + 1, c). Verified against Rapier ray casts in tests.
  if (u + v <= 1) return h00 + (h01 - h00) * u + (h10 - h00) * v;
  return h11 + (h10 - h11) * (1 - u) + (h01 - h11) * (1 - v);
}

export function generateMap(seed: number): MapDef {
  const rng = createRng(seed);
  const cells = MAP_SIZE / CELL_SIZE;
  const w = cells + 1;
  const half = MAP_SIZE / 2;

  // 1. Pick flat pads: the playground at the center, then buildings on dry, gentle land.
  const pads: Pad[] = [];
  const playY = Math.max(islandHeight(0, 0, seed), 2);
  pads.push({ x: 0, z: 0, hx: 26, hz: 26, yaw: 0, y: playY, falloff: 24 });

  const buildingSpots: Pad[] = [];
  // The deathmatch town: a ring of houses around the playground, doors facing in.
  const TOWN = 7;
  for (let i = 0; i < TOWN; i++) {
    const a = (i / TOWN) * 6.283185307179586 + 0.3;
    const r = i % 2 === 0 ? 46 : 58;
    const x = dsin(a) * r;
    const z = dcos(a) * r;
    // Front door (+z local) points back toward the center.
    const yaw = a + 3.141592653589793;
    const pad: Pad = { x, z, hx: BUILDING.width / 2 + 3, hz: BUILDING.depth / 2 + 3, yaw, y: Math.max(islandHeight(x, z, seed), 2), falloff: 12 };
    pads.push(pad);
    buildingSpots.push(pad);
  }
  const wantBuildings = 14 + TOWN;
  for (let tries = 0; tries < 2000 && buildingSpots.length < wantBuildings; tries++) {
    const x = (rng() - 0.5) * MAP_SIZE * 0.72;
    const z = (rng() - 0.5) * MAP_SIZE * 0.72;
    const h = islandHeight(x, z, seed);
    if (h < 2.5) continue;
    // Reject steep spots.
    const dx = islandHeight(x + 8, z, seed) - islandHeight(x - 8, z, seed);
    const dz = islandHeight(x, z + 8, seed) - islandHeight(x, z - 8, seed);
    if (Math.abs(dx) > 4 || Math.abs(dz) > 4) continue;
    let ok = true;
    for (const p of pads) {
      const ddx = p.x - x;
      const ddz = p.z - z;
      if (ddx * ddx + ddz * ddz < 40 * 40) ok = false;
    }
    if (!ok) continue;
    // Cluster yaws on a few angles so towns read as streets, with some variety.
    const yaw = Math.floor(rng() * 8) * (3.141592653589793 / 4);
    const pad: Pad = { x, z, hx: BUILDING.width / 2 + 3, hz: BUILDING.depth / 2 + 3, yaw, y: h, falloff: 12 };
    pads.push(pad);
    buildingSpots.push(pad);
  }

  // 2. Heights with pads blended in.
  const heights = new Float32Array(w * w);
  for (let r = 0; r < w; r++) {
    const z = -half + r * CELL_SIZE;
    for (let c = 0; c < w; c++) {
      const x = -half + c * CELL_SIZE;
      let hgt = islandHeight(x, z, seed);
      for (const p of pads) {
        const d = rectDistance(p, x, z);
        if (d >= p.falloff) continue;
        const k = 1 - d / p.falloff;
        const s = k * k * (3 - 2 * k);
        hgt = hgt + (p.y - hgt) * s;
      }
      heights[r * w + c] = hgt;
    }
  }
  const terrain: TerrainDef = { cells, cellSize: CELL_SIZE, heights };

  // 3. Structures.
  const b = new Builder();
  addPlayground(b, 0, playY, 0);
  for (const p of buildingSpots) addBuilding(b, p.x, p.y, p.z, p.yaw);

  // Crates and low cover walls around buildings and in the open.
  const rocks: RockDef[] = [];
  const nearPad = (x: number, z: number, margin: number): boolean => {
    for (const p of pads) if (rectDistance(p, x, z) < margin) return true;
    return false;
  };
  for (let i = 0; i < 90; i++) {
    const anchor = buildingSpots[i % Math.max(1, buildingSpots.length)];
    let x: number;
    let z: number;
    if (anchor && i < 60) {
      x = anchor.x + (rng() - 0.5) * 40;
      z = anchor.z + (rng() - 0.5) * 40;
    } else {
      x = (rng() - 0.5) * MAP_SIZE * 0.7;
      z = (rng() - 0.5) * MAP_SIZE * 0.7;
    }
    const y = terrainHeightAt(terrain, x, z);
    if (y < 1 || rectDistance(pads[0] as Pad, x, z) < 2) continue;
    let inside = false;
    for (const p of buildingSpots) if (rectDistance({ ...p, hx: BUILDING.width / 2 + 1, hz: BUILDING.depth / 2 + 1 }, x, z) === 0) inside = true;
    if (inside) continue;
    const yaw = rng() * 6.283185307179586;
    if (rng() < 0.6) {
      const s = 0.55 + rng() * 0.25;
      b.boxes.push({ kind: 'crate', c: [x, y + s - 0.1, z], h: [s, s, s], q: yawQuat(yaw) });
    } else {
      b.boxes.push({ kind: 'cover', c: [x, y + 0.45, z], h: [2 + rng() * 1.5, 0.6, 0.35], q: yawQuat(yaw) });
    }
  }

  // Rocks: partially buried spheres, kept off pads.
  for (let tries = 0; tries < 400 && rocks.length < 70; tries++) {
    const x = (rng() - 0.5) * MAP_SIZE * 0.8;
    const z = (rng() - 0.5) * MAP_SIZE * 0.8;
    const y = terrainHeightAt(terrain, x, z);
    if (y < 0.5 || nearPad(x, z, 6)) continue;
    const r = 0.8 + rng() * rng() * 3.2;
    rocks.push({ c: [x, y - r * 0.35, z], r });
  }

  // Invisible boundary walls just inside the map edge.
  const edge = half - 6;
  b.boxes.push({ kind: 'boundary', c: [edge + 1, 20, 0], h: [1, 40, half], q: IDENTITY });
  b.boxes.push({ kind: 'boundary', c: [-edge - 1, 20, 0], h: [1, 40, half], q: IDENTITY });
  b.boxes.push({ kind: 'boundary', c: [0, 20, edge + 1], h: [half, 40, 1], q: IDENTITY });
  b.boxes.push({ kind: 'boundary', c: [0, 20, -edge - 1], h: [half, 40, 1], q: IDENTITY });

  // Arena cover: crates and low walls scattered between the houses.
  for (let i = 0; i < 40; i++) {
    const a = rng() * 6.283185307179586;
    const r = 18 + rng() * (ARENA_RADIUS - 22);
    const x = dsin(a) * r;
    const z = dcos(a) * r;
    if (nearPad(x, z, 2.5)) continue;
    const y = terrainHeightAt(terrain, x, z);
    const yaw = rng() * 6.283185307179586;
    if (rng() < 0.55) {
      const sz = 0.6 + rng() * 0.25;
      b.boxes.push({ kind: 'crate', c: [x, y + sz - 0.1, z], h: [sz, sz, sz], q: yawQuat(yaw) });
    } else {
      b.boxes.push({ kind: 'cover', c: [x, y + 0.5, z], h: [1.8 + rng() * 1.2, 0.65, 0.3], q: yawQuat(yaw) });
    }
  }

  // Deathmatch spawns: open ground spread around the arena, away from props.
  const arenaSpawns: Vec3[] = [];
  const clearOfBoxes = (x: number, z: number): boolean => {
    for (const bx of b.boxes) {
      if (bx.kind === 'boundary') continue;
      const dx = bx.c[0] - x;
      const dz = bx.c[2] - z;
      const reach = Math.max(bx.h[0], bx.h[2]) + 1.5;
      if (dx * dx + dz * dz < reach * reach) return false;
    }
    for (const rk of rocks) {
      const dx = rk.c[0] - x;
      const dz = rk.c[2] - z;
      if (dx * dx + dz * dz < (rk.r + 1.5) * (rk.r + 1.5)) return false;
    }
    return true;
  };
  for (let i = 0; i < 400 && arenaSpawns.length < 24; i++) {
    const a = rng() * 6.283185307179586;
    const r = 8 + rng() * (ARENA_RADIUS - 12);
    const x = dsin(a) * r;
    const z = dcos(a) * r;
    if (nearPad(x, z, 1) && rectDistance(pads[0] as Pad, x, z) > 0) continue;
    if (!clearOfBoxes(x, z)) continue;
    arenaSpawns.push([x, terrainHeightAt(terrain, x, z) + 0.2, z]);
  }

  // 4. Spawn points: on the playground edge plus near each building's front door.
  const spawns: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * 6.283185307179586;
    spawns.push([dcos(a) * 6, playY + 0.2, dsin(a) * 6 - 2]);
  }
  for (const p of buildingSpots) {
    const [rx, rz] = rotateXZ(2, BUILDING.depth / 2 + 3, p.yaw);
    spawns.push([p.x + rx, p.y + 0.4, p.z + rz]);
  }

  return { id: 'greybox', seed, size: MAP_SIZE, seaLevel: 0, terrain, boxes: b.boxes, rocks, spawns, arena: { x: 0, z: 0, radius: ARENA_RADIUS }, arenaSpawns, shapes: [], water: null, br: null };
}

/**
 * Battle royale data that comes with a loaded map (map_v1): loot points,
 * flight paths, final circle candidates, named zones and water. Pure data
 * plus small deterministic lookups.
 */

export type Vec2 = [number, number];

export const Container = {
  None: 0,
  Small: 1,
  Large: 2,
  Ammo: 3,
} as const;

export interface LootPoint {
  /** Stable id from the map file. */
  id: number;
  /** building, container, ground, bunker, trench or vehicle. */
  kind: string;
  x: number;
  y: number;
  z: number;
  /** 1 (low) to 4 (best). */
  tier: number;
  /** Index into BrMapData.zones. */
  zone: number;
  /** Container (Container.*): the point is the top of a crate prop. */
  container: number;
}

export interface MapZone {
  id: string;
  name: string;
  tier: number;
  drop: 'hot' | 'medium' | 'quiet';
  /** [x, z] outline; empty for the catch-all countryside. */
  poly: Vec2[];
}

export interface FlightPath {
  from: Vec2;
  to: Vec2;
}

export interface CircleCandidate {
  name: string;
  x: number;
  z: number;
  r: number;
  weight: number;
}

/** One circle phase from the map (circle.phases); constants.ts can override. */
export interface CirclePhase {
  waitS: number;
  shrinkS: number;
  radius: number;
  dps: number;
}

export interface BrMapData {
  name: string;
  phases: CirclePhase[];
  /** Fallback spawns on open land (late joins, tests without the plane). */
  groundSpawns: [number, number, number][];
  flight: { altitude: number; speed: number; paths: FlightPath[] };
  finalCandidates: CircleCandidate[];
  zones: MapZone[];
  loot: LootPoint[];
}

export interface RiverPoint {
  x: number;
  z: number;
  bed: number;
  water: number;
}

export interface WaterDef {
  /** Sea surface height. */
  sea: number;
  river: RiverPoint[];
  riverHalfWidth: number;
}

/**
 * Water surface height at (x, z), or -Infinity where there is no water above
 * the ground. Exact float math only (the sim uses it for the wading rule).
 */
export function waterSurfaceAt(w: WaterDef, x: number, z: number): number {
  let best = w.sea;
  const pts = w.river;
  const hw2 = w.riverHalfWidth * w.riverHalfWidth;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i] as RiverPoint;
    const b = pts[i + 1] as RiverPoint;
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    if (len2 <= 0) continue;
    let t = ((x - a.x) * abx + (z - a.z) * abz) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = a.x + abx * t - x;
    const pz = a.z + abz * t - z;
    if (px * px + pz * pz > hw2) continue;
    const h = a.water + (b.water - a.water) * t;
    if (h > best) best = h;
  }
  return best;
}

/** Point in polygon (even-odd), [x, z] pairs. */
export function insidePoly(poly: readonly Vec2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i] as Vec2;
    const [xj, zj] = poly[j] as Vec2;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Index of the named zone containing (x, z); the catch-all (no polygon) otherwise. */
export function mapZoneAt(br: BrMapData, x: number, z: number): number {
  let fallback = -1;
  for (let i = 0; i < br.zones.length; i++) {
    const zn = br.zones[i] as MapZone;
    if (zn.poly.length < 3) {
      if (fallback < 0) fallback = i;
      continue;
    }
    if (insidePoly(zn.poly, x, z)) return i;
  }
  return fallback;
}

/**
 * The drop plane: a straight path from the map's flight paths. The server
 * picks the path that passes closest to the first circle (by seed among the
 * nearest few, `planePathIndex`) and sends its index; the sea before the
 * island is cut off and the plane flies faster than the map's speed
 * (`DROP.planeLeadIn`, `DROP.planeSpeedScale`), so the ride is short. Pure, so
 * the server (ejection) and the client (drawing it) agree on where it is.
 */
import { DROP } from './constants.ts';
import type { MapDef } from './map.ts';
import { terrainHeightAt } from './map.ts';
import type { Circle } from './zone.ts';

export interface PlaneRoute {
  index: number;
  fromX: number;
  fromZ: number;
  dirX: number;
  dirZ: number;
  length: number;
  speed: number;
  altitude: number;
  /** Plane yaw (three.js: forward is -z at yaw 0). */
  yaw: number;
  /**
   * Seconds after the start when everyone still aboard is ejected (before the
   * coast). The server may move it earlier for the match (`ejectForCircle`)
   * and sends its own value (`planeEnd`).
   */
  ejectS: number;
}

export function planeRoute(map: MapDef, index: number): PlaneRoute | null {
  const br = map.br;
  const paths = br?.flight.paths ?? [];
  if (!br || paths.length === 0) return null;
  const i = ((index % paths.length) + paths.length) % paths.length;
  const p = paths[i] as { from: [number, number]; to: [number, number] };
  const dx = p.to[0] - p.from[0];
  const dz = p.to[1] - p.from[1];
  const full = Math.sqrt(dx * dx + dz * dz);
  const dirX = dx / full;
  const dirZ = dz / full;
  // First and last point over land along the map's path.
  let firstLand = -1;
  let lastLand = -1;
  for (let d = 0; d <= full; d += 5) {
    if (terrainHeightAt(map.terrain, p.from[0] + dirX * d, p.from[1] + dirZ * d) > DROP.minLandHeight) {
      if (firstLand < 0) firstLand = d;
      lastLand = d;
    }
  }
  // Cut off the sea before the island (the plane still flies in from there while boarding).
  const cut = firstLand > DROP.planeLeadIn ? firstLand - DROP.planeLeadIn : 0;
  const speed = br.flight.speed * DROP.planeSpeedScale;
  const length = full - cut;
  const route: PlaneRoute = {
    index: i,
    fromX: p.from[0] + dirX * cut,
    fromZ: p.from[1] + dirZ * cut,
    dirX,
    dirZ,
    length,
    speed,
    altitude: br.flight.altitude,
    yaw: Math.atan2(-dx, -dz),
    ejectS: length / speed,
  };
  // Last point over land, minus a margin so the last ducks glide inland.
  if (lastLand > 0) route.ejectS = Math.max(1, (lastLand - cut - DROP.autoEjectBeforeCoast) / speed);
  return route;
}

/** Distance (m) along the route to the point closest to (x, z), clamped to the route. */
export function alongRoute(r: PlaneRoute, x: number, z: number): number {
  return Math.max(0, Math.min(r.length, (x - r.fromX) * r.dirX + (z - r.fromZ) * r.dirZ));
}

/**
 * Path index for a match: the path whose line passes closest to the first
 * circle's center, picked by the seed among the `DROP.planePathChoices`
 * nearest, so the plane flies over the circle and the ducks meet soon.
 * Without a circle: seed mod path count (the map's rule).
 */
export function planePathIndex(map: MapDef, seed: number, toward?: Circle): number {
  const paths = map.br?.flight.paths ?? [];
  const n = paths.length;
  if (n === 0) return 0;
  if (!toward) return (seed >>> 0) % n;
  const byDist = paths
    .map((p, i) => {
      const dx = p.to[0] - p.from[0];
      const dz = p.to[1] - p.from[1];
      const len = Math.sqrt(dx * dx + dz * dz);
      // Distance from the circle's center to the path's line, worse when the center is near the path's start.
      const side = Math.abs((toward.x - p.from[0]) * dz - (toward.z - p.from[1]) * dx) / len;
      const r = planeRoute(map, i);
      const along = r ? (toward.x - r.fromX) * r.dirX + (toward.z - r.fromZ) * r.dirZ : DROP.planeCircleMinAlong;
      return { i, d: side + Math.max(0, DROP.planeCircleMinAlong - along) * 0.5 };
    })
    .sort((a, b) => a.d - b.d || a.i - b.i);
  const k = Math.max(1, Math.min(n, DROP.planePathChoices));
  return (byDist[(seed >>> 0) % k] as { i: number }).i;
}

/**
 * Auto-eject time for a match: before the coast (`route.ejectS`) or at the
 * first circle's far edge, whichever comes first, so nobody rides the plane
 * far beyond the circle (but not before `DROP.minEjectS`). Never where the
 * plane is over the sea.
 */
export function ejectForCircle(map: MapDef, r: PlaneRoute, c: Circle): number {
  const past = alongRoute(r, c.x, c.z) + c.r * DROP.autoEjectPastCircle;
  let t = Math.min(r.ejectS, Math.max(DROP.minEjectS, past / r.speed));
  for (let k = 0; k < 80 && t < r.ejectS; k++) {
    const p = planeAt(r, t);
    if (overLand(map, p.x, p.z)) break;
    t = Math.min(r.ejectS, t + 0.25);
  }
  return Math.max(1, t);
}

export function planeAt(r: PlaneRoute, tS: number, out = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
  const d = r.speed * tS;
  out.x = r.fromX + r.dirX * d;
  out.y = r.altitude;
  out.z = r.fromZ + r.dirZ * d;
  return out;
}

/** May a duck jump here (over land)? */
export function overLand(map: MapDef, x: number, z: number): boolean {
  return terrainHeightAt(map.terrain, x, z) > DROP.minLandHeight;
}

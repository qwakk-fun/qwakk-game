/**
 * The drop plane: a straight path from the map's flight paths, picked with
 * the match seed (index = seed mod path count, the map's rule). Pure, so the
 * server (ejection) and the client (drawing it) agree on where it is.
 */
import { DROP } from './constants.ts';
import type { MapDef } from './map.ts';
import { terrainHeightAt } from './map.ts';

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
  /** Seconds after the start when everyone still aboard is ejected (before the coast). */
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
  const length = Math.sqrt(dx * dx + dz * dz);
  const route: PlaneRoute = {
    index: i,
    fromX: p.from[0],
    fromZ: p.from[1],
    dirX: dx / length,
    dirZ: dz / length,
    length,
    speed: br.flight.speed,
    altitude: br.flight.altitude,
    yaw: Math.atan2(-dx, -dz),
    ejectS: length / br.flight.speed,
  };
  // Last point over land along the path, minus a margin so the last ducks glide inland.
  let lastLand = -1;
  for (let d = 0; d <= length; d += 5) {
    if (terrainHeightAt(map.terrain, route.fromX + route.dirX * d, route.fromZ + route.dirZ * d) > DROP.minLandHeight) lastLand = d;
  }
  if (lastLand > 0) route.ejectS = Math.max(1, (lastLand - DROP.autoEjectBeforeCoast) / route.speed);
  return route;
}

/** Path index for a match seed. */
export function planePathIndex(map: MapDef, seed: number): number {
  const n = map.br?.flight.paths.length ?? 0;
  return n > 0 ? (seed >>> 0) % n : 0;
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

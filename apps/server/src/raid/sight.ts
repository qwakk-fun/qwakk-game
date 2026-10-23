/**
 * What a hunter can see: line of sight from its eye to a duck's chest or head
 * through SIGHT_QUERY_GROUPS (walls, hedges and bushes hide a duck, exactly as
 * for the bots), within its view range and field of view (or close enough to
 * notice whichever way it faces). Hunters get no wallhack. Server only.
 */
import { HUNTER_EYE, SIGHT_QUERY_GROUPS, type HunterKindId, type SimWorld } from '@qwakk/shared';
import type { HunterAgent, KindNumbers } from './hunter.ts';

export interface DuckTarget {
  id: string;
  pid: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  crouch: number;
  /** Alive and not knocked: hunters leave knocked ducks alone (their friends can revive them). */
  standing: boolean;
}

/** Rays cast for sight (stats). */
export const sightStats = { rays: 0 };

/** A clear sight line between two points (SIGHT groups: bushes count). */
export function clearSight(sim: SimWorld, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.05) return true;
  sightStats.rays++;
  const hit = sim.world.castRay(new sim.rapier.Ray({ x: ax, y: ay, z: az }, { x: dx / d, y: dy / d, z: dz / d }), d, true, undefined, SIGHT_QUERY_GROUPS);
  return !hit || hit.timeOfImpact > d - 0.35;
}

/** Can this hunter see this duck now (range, field of view, line of sight to chest or head)? */
export function sees(sim: SimWorld, h: HunterAgent, k: KindNumbers, duck: DuckTarget): boolean {
  const ey = h.y + HUNTER_EYE[h.kind as HunterKindId];
  const dx = duck.x - h.x;
  const dz = duck.z - h.z;
  const flat = Math.hypot(dx, dz);
  if (flat > k.view) return false;
  if (flat > k.hear) {
    const facing = (dx * -Math.sin(h.yaw) + dz * -Math.cos(h.yaw)) / Math.max(0.01, flat);
    if (facing < k.fovCos) return false;
  }
  if (clearSight(sim, h.x, ey, h.z, duck.x, duck.y + 0.9, duck.z)) return true;
  return clearSight(sim, h.x, ey, h.z, duck.x, duck.y + (duck.crouch ? 1.04 : 1.36), duck.z);
}

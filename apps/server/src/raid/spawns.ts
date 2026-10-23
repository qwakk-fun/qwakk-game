/**
 * Where hunters come from and where they go: the edge spawns at the ends of
 * Kavren's roads (just inside the hedge ring), the tower and the spots around
 * it, and the ducks' spawn points near the tower. Read once from the map per
 * room. Server only.
 */
import { groundHeightAt, insidePoly, RAID, type SimWorld } from '@qwakk/shared';
import type { ServerMap } from '../maps.ts';
import type { BotNav, P3 } from '../nav/botNav.ts';

export interface TowerInfo {
  x: number;
  z: number;
  half: number;
  reach: number;
}

/** The tower from the map's qorechain_tower prop (else the constant). */
export function towerOf(map: ServerMap): TowerInfo {
  const props = (map.loaded?.extras.props ?? []) as { prop?: string; x?: number; z?: number }[];
  const p = props.find((q) => q.prop === 'qorechain_tower');
  const t = RAID.tower;
  return { x: typeof p?.x === 'number' ? p.x : t.x, z: typeof p?.z === 'number' ? p.z : t.z, half: t.half, reach: t.reach };
}

/** Distance from (x, z) to the tower's walls (0 inside). */
export function towerDistance(t: TowerInfo, x: number, z: number): number {
  const dx = Math.max(0, Math.abs(x - t.x) - t.half);
  const dz = Math.max(0, Math.abs(z - t.z) - t.half);
  return Math.hypot(dx, dz);
}

/**
 * Edge spawns: every road end near the hedge ring and at least 40 m from the
 * tower, pulled 7 m in toward the middle onto open ground. Falls back to the
 * deathmatch spawn points farthest from the tower.
 */
export function edgeSpawns(sim: SimWorld, map: ServerMap, tower: TowerInfo): P3[] {
  const def = map.def;
  const ring = def.playRing;
  const half = def.size / 2;
  const out: P3[] = [];
  for (const road of map.loaded?.extras.roads ?? []) {
    const pts = road.pts;
    for (const end of [pts[0], pts[pts.length - 1]]) {
      if (!end) continue;
      const [x0, z0] = end;
      if (Math.hypot(x0 - tower.x, z0 - tower.z) < 40) continue;
      // Near the edge: within 12 m of the play area's bounding box.
      const edge = Math.max(Math.abs(x0), Math.abs(z0)) > (ring ? Math.max(...ring.map(([a, b]) => Math.max(Math.abs(a), Math.abs(b)))) : half) - 12;
      if (!edge) continue;
      const len = Math.hypot(x0 - tower.x, z0 - tower.z);
      const x = x0 - ((x0 - tower.x) / len) * 7;
      const z = z0 - ((z0 - tower.z) / len) * 7;
      if (ring && !insidePoly(ring, x, z)) continue;
      out.push({ x, y: groundHeightAt(sim, x, 40, z), z });
    }
  }
  if (out.length >= 2) return out;
  const far = [...def.arenaSpawns].sort((a, b) => Math.hypot(b[0] - tower.x, b[2] - tower.z) - Math.hypot(a[0] - tower.x, a[2] - tower.z)).slice(0, 6);
  return far.map(([x, y, z]) => ({ x, y, z }));
}

/** The duck spawns: deathmatch spawn points within 30 m of the tower and outside it, nearest first. */
export function duckSpawns(map: ServerMap, tower: TowerInfo): { x: number; y: number; z: number; yaw: number }[] {
  const pts = map.def.arenaSpawns
    .map((p, i) => ({ x: p[0], y: p[1], z: p[2], yaw: map.def.arenaYaws?.[i] ?? 0 }))
    .filter((p) => towerDistance(tower, p.x, p.z) > 1.5 && Math.hypot(p.x - tower.x, p.z - tower.z) < 32)
    .sort((a, b) => Math.hypot(a.x - tower.x, a.z - tower.z) - Math.hypot(b.x - tower.x, b.z - tower.z));
  // Facing away from the tower, out toward where the hunters come from.
  for (const p of pts) p.yaw = Math.atan2(p.x - tower.x, p.z - tower.z);
  return pts.length > 0 ? pts.slice(0, 8) : [{ x: tower.x, y: 10, z: tower.z + tower.half + 4, yaw: Math.PI }];
}

/** A spot by the tower wall at this angle (on the navmesh when it is ready). */
export function towerSpot(tower: TowerInfo, angle: number, nav: BotNav | null, y: number): P3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = (tower.half + 1.1) / Math.max(Math.abs(c), Math.abs(s));
  const p = { x: tower.x + c * t, y, z: tower.z + s * t };
  return nav?.closest(p, { x: 3, y: 8, z: 3 }) ?? p;
}

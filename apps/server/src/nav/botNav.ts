/**
 * Navmesh queries for bots: paths, closest walkable point, random walkable
 * points in a circle, and a small path follower. One query object is shared
 * by every room in the process (rooms tick one after another).
 */
import { NavMeshQuery, type NavMesh } from 'recast-navigation';

export interface P3 {
  x: number;
  y: number;
  z: number;
}

const NEAR = { x: 2, y: 4, z: 2 };
const WIDE = { x: 24, y: 60, z: 24 };

export class BotNav {
  readonly query: NavMeshQuery;
  /** Path queries so far (stats). */
  queries = 0;

  constructor(navMesh: NavMesh) {
    this.query = new NavMeshQuery(navMesh);
  }

  /** Straight path (corner points) from a to b, or null when there is none. */
  path(a: P3, b: P3): P3[] | null {
    this.queries++;
    const from = this.closest(a, NEAR) ?? this.closest(a, WIDE);
    const to = this.closest(b, NEAR) ?? this.closest(b, WIDE);
    if (!from || !to) return null;
    const r = this.query.computePath(from, to, { halfExtents: NEAR, maxPathPolys: 512, maxStraightPathPoints: 128 });
    if (!r.success || r.path.length === 0) return null;
    return r.path.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  }

  /** Nearest point on the navmesh within the search box, or null. */
  closest(p: P3, halfExtents: P3 = NEAR): P3 | null {
    const r = this.query.findClosestPoint(p, { halfExtents });
    if (!r.success || !r.polyRef) return null;
    return { x: r.point.x, y: r.point.y, z: r.point.z };
  }

  /** A random walkable point within `r` of (x, z) (y is searched widely), or null. */
  randomInCircle(x: number, y: number, z: number, r: number): P3 | null {
    const c = this.closest({ x, y, z }, { x: Math.min(60, r + 5), y: 60, z: Math.min(60, r + 5) });
    if (!c) return null;
    const res = this.query.findRandomPointAroundCircle(c, r, { halfExtents: WIDE });
    if (!res.success) return c;
    return { x: res.randomPoint.x, y: res.randomPoint.y, z: res.randomPoint.z };
  }
}

/** Walks a list of corner points: the current waypoint, advanced when reached. */
export class PathFollower {
  points: P3[] = [];
  index = 0;

  /** New path from (x, z). The first corner is the start projected onto the navmesh: skipped when the duck is already on it. */
  set(points: P3[] | null, x: number, z: number): void {
    this.points = points ?? [];
    const first = this.points[0];
    this.index = this.points.length > 1 && first && Math.hypot(first.x - x, first.z - z) < 0.6 ? 1 : 0;
  }

  clear(): void {
    this.points = [];
    this.index = 0;
  }

  get active(): boolean {
    return this.index < this.points.length;
  }

  get end(): P3 | null {
    return this.points[this.points.length - 1] ?? null;
  }

  /** The waypoint to steer to from (x, z), or null when the path is done. */
  next(x: number, z: number, reach = 0.9): P3 | null {
    while (this.index < this.points.length) {
      const p = this.points[this.index] as P3;
      const last = this.index === this.points.length - 1;
      if (Math.hypot(p.x - x, p.z - z) > (last ? reach : reach + 0.4)) return p;
      this.index++;
    }
    return null;
  }

  /** Distance from (x, z) to the current waypoint's segment (off-path check). */
  offPath(x: number, z: number): number {
    const b = this.points[this.index];
    const a = this.points[this.index - 1];
    if (!b) return 0;
    if (!a) return Math.hypot(b.x - x, b.z - z);
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2));
    return Math.hypot(a.x + abx * t - x, a.z + abz * t - z);
  }
}

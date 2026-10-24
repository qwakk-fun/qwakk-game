/**
 * How a hunter walks: a kinematic mover along navmesh paths (nav/), not the
 * duck's physics step. Hunters are server-only AI actors: nothing about their
 * movement is predicted by a client, so they need no character controller,
 * only paths around the houses, a wall check on every step and the ground
 * under their feet. Much cheaper than a duck, which keeps a full run (4
 * ducks, 30 hunters) light. Server only, so Math.* is fine.
 */
import { MOVE_QUERY_GROUPS, type SimWorld } from '@qwakk/shared';
import { PathFollower, type BotNav, type P3 } from '../nav/botNav.ts';

/** Re-plan at most this often while the goal stays put (ticks). */
const REPATH_TICKS = 75;
/** The goal moved this far (m): plan again soon. */
const GOAL_MOVED = 3;
/** No meter of progress in this many ticks: skip to the next corner (a hunter must never stay stuck). */
const STUCK_TICKS = 120;

/** Is a step from (x0, z0) to (x1, z1), ending at height y1, barred for hunters right now (the closed gate, a raised drawbridge, the moat)? */
export type Barrier = (x0: number, z0: number, x1: number, z1: number, y1: number) => boolean;

const open: Barrier = () => false;

export interface MoverBody {
  x: number;
  y: number;
  z: number;
  /** Facing (sim yaw: forward is (-sin, -cos)). */
  yaw: number;
}

export class HunterMover {
  private readonly follow = new PathFollower();
  private goal: P3 | null = null;
  private pathAge = REPATH_TICKS;
  private best = Infinity;
  private stuck = 0;
  /** The last plan to the goal crossed a barrier (behind the closed gate, over a raised bridge): the goal is out of reach for now. */
  barred = false;
  /** Distance left to the goal after the last step (m). */
  left = 0;
  /** Last step's ground speed (m/s), for the walk or run animation. */
  speed = 0;

  get target(): P3 | null {
    return this.goal;
  }

  setGoal(p: P3 | null): void {
    if (p && this.goal && Math.hypot(p.x - this.goal.x, p.z - this.goal.z) < GOAL_MOVED) {
      this.goal = p;
      return;
    }
    this.goal = p;
    this.barred = false;
    this.follow.clear();
    this.pathAge = REPATH_TICKS;
    this.best = Infinity;
    this.stuck = 0;
  }

  /**
   * One tick toward the goal at `speed` m/s, steering away from `avoid`
   * (other hunters and the ducks: hunters never push a duck, so a duck's
   * predicted movement stays exact), never through a `barrier` (the keep's
   * gate and drawbridge, which the navmesh does not know about). Returns
   * true while still on the way.
   */
  step(sim: SimWorld, nav: BotNav | null, b: MoverBody, speed: number, dt: number, arrive: number, avoid: readonly { x: number; z: number }[], turnRate = 0.35, barrier: Barrier = open): boolean {
    this.speed = 0;
    const g = this.goal;
    if (!g) return false;
    this.left = Math.hypot(g.x - b.x, g.z - b.z);
    if (this.left < arrive) return false;
    if (++this.pathAge >= REPATH_TICKS || (!this.follow.active && this.pathAge > 10)) {
      this.pathAge = 0;
      const path = nav?.path(b, g) ?? [{ x: b.x, y: b.y, z: b.z }, g];
      this.barred = barrier !== open && crosses(path, barrier);
      if (this.barred) {
        this.follow.clear();
        return false;
      }
      this.follow.set(path, b.x, b.z);
    }
    if (this.barred) return false;
    let wp = this.follow.next(b.x, b.z, 0.8) ?? g;
    // Steer: toward the corner, away from crowding neighbours.
    let dx = wp.x - b.x;
    let dz = wp.z - b.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    let sx = 0;
    let sz = 0;
    for (const o of avoid) {
      const ox = b.x - o.x;
      const oz = b.z - o.z;
      const od = Math.hypot(ox, oz);
      if (od > 1.3 || od < 1e-4) continue;
      const push = (1.3 - od) / 1.3;
      sx += (ox / od) * push;
      sz += (oz / od) * push;
    }
    dx += sx * 1.4;
    dz += sz * 1.4;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    // Turn toward the walking direction at a human rate.
    const want = Math.atan2(-dx, -dz);
    const turn = wrap(want - b.yaw);
    b.yaw = wrap(b.yaw + Math.max(-turnRate, Math.min(turnRate, turn)));
    const stepLen = Math.min(speed * dt, this.left);
    const moved = this.tryMove(sim, b, dx * stepLen, dz * stepLen, barrier) || this.tryMove(sim, b, dx * stepLen * 0.6 - dz * stepLen * 0.5, dz * stepLen * 0.6 + dx * stepLen * 0.5, barrier) || this.tryMove(sim, b, dx * stepLen * 0.6 + dz * stepLen * 0.5, dz * stepLen * 0.6 - dx * stepLen * 0.5, barrier);
    if (moved) this.speed = speed;
    // Progress check: no meter gained in a while, skip ahead to the next corner (on the navmesh, so it is a valid spot);
    // stuck in a pocket the navmesh does not join up (a trench it stepped into), scramble out toward the goal.
    if (this.left < this.best - 1) {
      this.best = this.left;
      this.stuck = 0;
    } else if (++this.stuck >= STUCK_TICKS) {
      this.stuck = 0;
      this.best = this.left;
      const next = this.follow.next(b.x, b.z, 0.8);
      if (next && !barrier(b.x, b.z, next.x, next.z, next.y) && Math.hypot(next.x - b.x, next.z - b.z) > 0.8) {
        b.x = next.x;
        b.z = next.z;
        b.y = next.y;
        this.follow.index++;
      } else if (nav && this.anchor) this.scramble(nav, b, g, barrier, this.anchor);
      this.pathAge = REPATH_TICKS;
    }
    return true;
  }

  /** A spot well inside the walkable map (the keep's gate front): a scramble only lands where a path to it leads. */
  anchor: P3 | null = null;

  /** Out of a pocket: onto the navmesh a few meters toward the goal, where a path to the goal and to the anchor really leads (a hunter climbing out). */
  private scramble(nav: BotNav, b: MoverBody, g: P3, barrier: Barrier, anchor: P3): void {
    const dx = g.x - b.x;
    const dz = g.z - b.z;
    const d = Math.hypot(dx, dz) || 1;
    for (const reach of [3, 5, 8]) {
      const p = nav.closest({ x: b.x + (dx / d) * reach, y: b.y, z: b.z + (dz / d) * reach }, { x: 2.5, y: 3, z: 2.5 });
      if (!p || Math.hypot(p.x - b.x, p.z - b.z) < 1 || barrier(b.x, b.z, p.x, p.z, p.y)) continue;
      const path = nav.path(p, g);
      const end = path?.[path.length - 1];
      if (!end || Math.hypot(end.x - g.x, end.z - g.z) > 2) continue;
      const home = nav.path(p, anchor);
      const back = home?.[home.length - 1];
      if (!back || Math.hypot(back.x - anchor.x, back.z - anchor.z) > 2) continue;
      b.x = p.x;
      b.y = p.y;
      b.z = p.z;
      this.follow.clear();
      return;
    }
  }

  /** A shove (a bread loaf's knockback): the same wall, ground and barrier checks as a step. */
  push(sim: SimWorld, b: MoverBody, dx: number, dz: number, barrier: Barrier = open): boolean {
    return this.tryMove(sim, b, dx, dz, barrier);
  }

  /** Forget the path (a raft ride or a dunk moved the hunter): plan again on the next step. */
  reset(): void {
    this.setGoal(null);
  }

  /** Move by (dx, dz) unless a wall is in the way at knee or chest height or a barrier bars it, then settle on the ground. */
  private tryMove(sim: SimWorld, b: MoverBody, dx: number, dz: number, barrier: Barrier): boolean {
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) return false;
    const dir = { x: dx / len, y: 0, z: dz / len };
    for (const h of [0.5, 1.2]) {
      const hit = sim.world.castRay(new sim.rapier.Ray({ x: b.x, y: b.y + h, z: b.z }, dir), len + 0.35, true, undefined, MOVE_QUERY_GROUPS);
      if (hit) return false;
    }
    const nx = b.x + dx;
    const nz = b.z + dz;
    // The ground under the new spot: from a step above, down to a little below (steps and slopes).
    const down = sim.world.castRay(new sim.rapier.Ray({ x: nx, y: b.y + 0.9, z: nz }, { x: 0, y: -1, z: 0 }), 2.2, true, undefined, MOVE_QUERY_GROUPS);
    if (!down) return false;
    const ny = b.y + 0.9 - down.timeOfImpact;
    // Never a drop deeper than a stair (a trench or a ledge it could not climb back out of).
    if (ny < b.y - 0.7) return false;
    if (barrier(b.x, b.z, nx, nz, ny)) return false;
    b.x = nx;
    b.z = nz;
    b.y = ny;
    return true;
  }
}

/** Does a planned path cross a barrier anywhere (corner to corner)? */
function crosses(path: readonly P3[], barrier: Barrier): boolean {
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!;
    const b = path[i + 1]!;
    if (barrier(a.x, a.z, b.x, b.z, b.y)) return true;
  }
  return false;
}

function wrap(a: number): number {
  return a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
}

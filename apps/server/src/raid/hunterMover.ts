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
    this.follow.clear();
    this.pathAge = REPATH_TICKS;
    this.best = Infinity;
    this.stuck = 0;
  }

  /**
   * One tick toward the goal at `speed` m/s, steering away from `avoid`
   * (other hunters and the ducks: hunters never push a duck, so a duck's
   * predicted movement stays exact). Returns true while still on the way.
   */
  step(sim: SimWorld, nav: BotNav | null, b: MoverBody, speed: number, dt: number, arrive: number, avoid: readonly { x: number; z: number }[], turnRate = 0.35): boolean {
    this.speed = 0;
    const g = this.goal;
    if (!g) return false;
    this.left = Math.hypot(g.x - b.x, g.z - b.z);
    if (this.left < arrive) return false;
    if (++this.pathAge >= REPATH_TICKS || (!this.follow.active && this.pathAge > 10)) {
      this.pathAge = 0;
      this.follow.set(nav?.path(b, g) ?? [{ x: b.x, y: b.y, z: b.z }, g], b.x, b.z);
    }
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
    const moved = this.tryMove(sim, b, dx * stepLen, dz * stepLen) || this.tryMove(sim, b, dx * stepLen * 0.6 - dz * stepLen * 0.5, dz * stepLen * 0.6 + dx * stepLen * 0.5) || this.tryMove(sim, b, dx * stepLen * 0.6 + dz * stepLen * 0.5, dz * stepLen * 0.6 - dx * stepLen * 0.5);
    if (moved) this.speed = speed;
    // Progress check: no meter gained in a while, skip ahead to the next corner (on the navmesh, so it is a valid spot).
    if (this.left < this.best - 1) {
      this.best = this.left;
      this.stuck = 0;
    } else if (++this.stuck >= STUCK_TICKS) {
      this.stuck = 0;
      this.best = this.left;
      const next = this.follow.next(b.x, b.z, 0.8);
      if (next) {
        b.x = next.x;
        b.z = next.z;
        b.y = next.y;
        this.follow.index++;
      }
      this.pathAge = REPATH_TICKS;
    }
    return true;
  }

  /** Move by (dx, dz) unless a wall is in the way at knee or chest height, then settle on the ground. */
  private tryMove(sim: SimWorld, b: MoverBody, dx: number, dz: number): boolean {
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
    b.x = nx;
    b.z = nz;
    b.y = b.y + 0.9 - down.timeOfImpact;
    return true;
  }
}

function wrap(a: number): number {
  return a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));
}

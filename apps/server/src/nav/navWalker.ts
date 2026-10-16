/**
 * Walks a bot to a goal along navmesh paths: plans a path when the goal
 * changes and again every few seconds, follows its corners, and handles
 * getting stuck by progress toward the goal (no meter gained in 1.5 s: hop
 * and re-plan; none in 5 s, or the time given: give up). It only says where to look and whether
 * to go on; the bot turns at its own rate and writes its own input frame.
 * Server only.
 */
import { PathFollower, type BotNav, type P3 } from './botNav.ts';

/** Re-plan at most this often while the goal stays the same (ticks). */
const REPATH_TICKS = 90;
const STUCK_TICKS = 45;
/** Default: give a goal up after 5 s without progress. */
const GIVE_UP_TICKS = 150;

export type WalkState = 'arrived' | 'walking' | 'gaveUp';

export interface WalkStep {
  state: WalkState;
  /** Where to look and walk (yaw, three.js convention) while walking. */
  yaw: number;
  /** Distance left to the goal (m). */
  left: number;
  /** Press jump this tick (stuck hop). */
  hop: boolean;
}

export class NavWalker {
  private readonly follow = new PathFollower();
  private target: P3 | null = null;
  private pathAge = REPATH_TICKS;
  private progress = { best: Infinity, ticks: 0 };
  private hopCooldown = 0;
  private readonly out: WalkStep = { state: 'arrived', yaw: 0, left: 0, hop: false };
  private readonly giveUpTicks: number;

  constructor(giveUpTicks = GIVE_UP_TICKS) {
    this.giveUpTicks = giveUpTicks;
  }

  get goal(): P3 | null {
    return this.target;
  }

  /** A new goal (null: none). Plans on the next step. */
  setGoal(p: P3 | null): void {
    this.target = p;
    this.follow.clear();
    this.pathAge = REPATH_TICKS;
    this.progress = { best: Infinity, ticks: 0 };
  }

  /** Plan again on the next step (the bot was pushed off its path, by a fight for example). */
  replan(): void {
    this.pathAge = REPATH_TICKS;
    this.progress = { best: Infinity, ticks: 0 };
  }

  step(nav: BotNav | null, self: P3, arrive = 2): WalkStep {
    const o = this.out;
    o.hop = false;
    if (this.hopCooldown > 0) this.hopCooldown--;
    const g = this.target;
    if (!g) {
      o.state = 'arrived';
      o.left = 0;
      return o;
    }
    o.left = Math.hypot(g.x - self.x, g.z - self.z);
    if (o.left < arrive) {
      o.state = 'arrived';
      this.follow.clear();
      return o;
    }
    if (++this.pathAge >= REPATH_TICKS || (!this.follow.active && this.pathAge > 15) || this.follow.offPath(self.x, self.z) > 4) {
      this.pathAge = 0;
      this.follow.set(nav?.path(self, g) ?? [{ x: self.x, y: self.y, z: self.z }, g], self.x, self.z);
    }
    let wp = this.follow.next(self.x, self.z);
    if (!wp) {
      // The path ends short of the goal (the goal is off the navmesh): give up.
      const end = this.follow.end;
      if (end && Math.hypot(end.x - g.x, end.z - g.z) > arrive) {
        o.state = 'gaveUp';
        return o;
      }
      wp = g;
    }
    o.yaw = Math.atan2(-(wp.x - self.x), -(wp.z - self.z));
    o.state = 'walking';
    const p = this.progress;
    if (o.left < p.best - 1) {
      p.best = o.left;
      p.ticks = 0;
      return o;
    }
    p.ticks++;
    if (p.ticks % STUCK_TICKS === 0 && p.ticks < this.giveUpTicks) {
      if (this.hopCooldown === 0) {
        o.hop = true;
        this.hopCooldown = 20;
      }
      this.pathAge = REPATH_TICKS;
    }
    if (p.ticks >= this.giveUpTicks) o.state = 'gaveUp';
    return o;
  }
}

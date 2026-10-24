/**
 * A bot duck for Hunt Season tests and the benchmark (never in a real room:
 * runs are humans only). v3: a katana fighter through the human input path.
 * It walks (navmesh) to the objective's ground, runs at the nearest hunter
 * it can see, cuts with light combos (taps), spins a heavy into a crowd,
 * dashes to close in, quacks when surrounded and lets the Blade Storm go
 * when the meter is full. It sees only what is in line of sight.
 */
import { Button, dashTimer, quackTimer, SIGHT_QUERY_GROUPS, stormMeter, STORM, type InputFrame, type PlayerSim, type SimWorld } from '@qwakk/shared';
import type { BotLike, BotTarget } from '../arena.ts';
import type { BotNav, P3 } from '../nav/botNav.ts';
import { NavWalker } from '../nav/navWalker.ts';

const wrap = (a: number): number => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

export class RaidDuckBot implements BotLike {
  private readonly walker = new NavWalker(120);
  private readonly frame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0 };
  private readonly sim: SimWorld;
  private readonly nav: () => BotNav | null;
  private readonly goal: () => P3;
  private yaw = 0;
  private t = 0;
  private holding = 0;
  private lastGoal: P3 | null = null;

  /** `goal`: where to go with no hunter in sight (the objective's public marker, or a guard spot). */
  constructor(sim: SimWorld, nav: () => BotNav | null, goal: P3 | (() => P3)) {
    this.sim = sim;
    this.nav = nav;
    this.goal = typeof goal === 'function' ? goal : () => goal;
  }

  respawned(self: PlayerSim): void {
    this.yaw = self.yaw;
    this.walker.setGoal(null);
    this.lastGoal = null;
  }

  damagedFrom(x: number, z: number): void {
    void x;
    void z;
  }

  private sees(self: PlayerSim, t: BotTarget): boolean {
    const dx = t.x - self.x;
    const dy = t.y + 1 - (self.y + 1.2);
    const dz = t.z - self.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.5) return true;
    const hit = this.sim.world.castRay(new this.sim.rapier.Ray({ x: self.x, y: self.y + 1.2, z: self.z }, { x: dx / d, y: dy / d, z: dz / d }), d, true, undefined, SIGHT_QUERY_GROUPS);
    return !hit || hit.timeOfImpact > d - 0.5;
  }

  think(self: PlayerSim, others: readonly BotTarget[], tick: number): InputFrame {
    this.t++;
    const f = this.frame;
    f.buttons = 0;
    f.mx = 0;
    f.mz = 0;
    f.pitch = -0.05;
    let best: BotTarget | null = null;
    let bestD = 30;
    let near = 0;
    for (const o of others) {
      if (!o.alive) continue;
      const d = Math.hypot(o.x - self.x, o.z - self.z);
      if (d < 3.2) near++;
      if (d < bestD && Math.abs(o.y - self.y) < 4 && (d < 6 || (tick + o.life) % 6 === 0 || o.id === this.target) && this.sees(self, o)) {
        best = o;
        bestD = d;
      }
    }
    this.target = best?.id ?? null;
    if (best) {
      const want = Math.atan2(-(best.x - self.x), -(best.z - self.z));
      this.yaw = wrap(this.yaw + Math.max(-0.35, Math.min(0.35, wrap(want - this.yaw))));
      f.mz = bestD > 1.8 ? 1 : 0;
      if (bestD > 4 && bestD < 9 && dashTimer(self) === 0 && this.t % 7 === 0) f.buttons |= Button.Dash;
      if (near >= 4 && quackTimer(self) === 0) f.buttons |= Button.Quack;
      if (stormMeter(self) >= STORM.meterFull && near >= 2) f.buttons |= Button.Storm;
      if (bestD < 2.8) {
        if (near >= 3 && this.holding === 0 && this.t % 40 === 0) this.holding = 30;
        if (this.holding > 0) {
          this.holding--;
          f.buttons |= Button.Fire;
        } else if (this.t % 3 === 0) f.buttons |= Button.Fire;
      }
    } else {
      const g = this.goal();
      if (!this.lastGoal || Math.hypot(g.x - this.lastGoal.x, g.z - this.lastGoal.z) > 2) {
        this.walker.setGoal(g);
        this.lastGoal = g;
      }
      const step = this.walker.step(this.nav(), self, 3);
      if (step.state === 'walking') {
        this.yaw = wrap(this.yaw + Math.max(-0.3, Math.min(0.3, wrap(step.yaw - this.yaw))));
        f.mz = 1;
        f.buttons |= Button.Sprint;
        if (step.hop) f.buttons |= Button.Jump;
      } else {
        this.yaw = wrap(this.yaw + 0.04);
        if (step.state === 'gaveUp') this.walker.setGoal(null);
      }
    }
    f.yaw = this.yaw;
    return f;
  }

  private target: string | null = null;
}

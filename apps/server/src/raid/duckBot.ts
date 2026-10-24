/**
 * A bot duck for Hunt Season tests and the benchmark (never in a real room:
 * runs are humans only). It fights what it sees with the deathmatch brain
 * (bots.ts: line of sight, reaction, aim error), through the human input
 * path, and otherwise walks back to a guard spot (on the wall walk), like a player
 * defending it.
 */
import { Button, type InputFrame, type PlayerSim, type SimWorld } from '@qwakk/shared';
import type { BotLike, BotTarget } from '../arena.ts';
import { BotBrain, SKILL, type BotSkill } from '../bots.ts';

/** A sharper duck than the deathmatch bots (a player who came to hold the keep). */
const DEFENDER: BotSkill = { ...SKILL, reactionTicks: [8, 14], yawError: 0.12, pitchError: 0.05, errorSettlePerTick: 0.92, trackRate: 0.6, turnRatePerTick: 0.2, recoilControl: 0.7, viewRange: 90, fovCos: Math.cos((70 * Math.PI) / 180), hearRange: 10, burstShots: [3, 6], longBurstShots: [2, 4], burstPauseTicks: [5, 10] };
import type { BotNav } from '../nav/botNav.ts';
import { NavWalker } from '../nav/navWalker.ts';

export class RaidDuckBot implements BotLike {
  private readonly fighter: BotBrain;
  private readonly walker = new NavWalker(120);
  private readonly frame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0 };
  private readonly guard: { x: number; y: number; z: number };
  private readonly nav: () => BotNav | null;
  private yaw = 0;

  constructor(sim: SimWorld, nav: () => BotNav | null, guard: { x: number; y: number; z: number }) {
    this.fighter = new BotBrain(sim, DEFENDER);
    this.nav = nav;
    this.guard = guard;
  }

  respawned(self: PlayerSim): void {
    this.fighter.respawned(self);
    this.yaw = self.yaw;
  }

  damagedFrom(x: number, z: number): void {
    this.fighter.damagedFrom(x, z);
  }

  think(self: PlayerSim, others: readonly BotTarget[], tick: number): InputFrame {
    if (this.fighter.engage(self, others, tick)) {
      Object.assign(this.frame, this.fighter.output);
      this.yaw = this.frame.yaw;
      return this.frame;
    }
    const f = this.frame;
    f.buttons = this.fighter.output.buttons & (Button.Reload | Button.Slot1 | Button.Slot2);
    f.mx = 0;
    f.mz = 0;
    if (!this.walker.goal) this.walker.setGoal(this.guard);
    const step = this.walker.step(this.nav(), self, 3);
    if (step.state === 'walking') {
      const t = this.fighter.turnTo(step.yaw, -0.05);
      this.yaw = t.yaw;
      f.mz = 1;
      if (step.hop) f.buttons |= Button.Jump;
    } else {
      // At the guard spot: look around slowly.
      const t = this.fighter.turnTo(this.yaw + 0.04, -0.05);
      this.yaw = t.yaw;
      if (step.state === 'gaveUp') this.walker.setGoal(null);
    }
    f.yaw = this.yaw;
    f.pitch = -0.05;
    this.fighter.lookAt(f.yaw, f.pitch);
    return f;
  }
}

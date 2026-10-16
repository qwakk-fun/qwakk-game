/**
 * Deathmatch bot for map_v1 maps: the deathmatch brain (bots.ts) fights what
 * it sees, and between fights the bot walks navmesh paths (nav/) instead of
 * steering by ray casts, so it finds its way round houses and through doors
 * instead of getting stuck in them. In order: fight what it sees, chase the
 * last sighting, else roam between spawn points and random walkable spots in
 * the play area, pausing now and then to look around.
 *
 * Same rules as every bot: one input frame per tick through the player's
 * path, line of sight only (SIGHT_QUERY_GROUPS), no wallhack, no aimbot.
 * Without a navmesh (still building) it falls back to the steering brain.
 * Server only, so Math.random and Math.atan2 are fine here.
 */
import { Button, insidePoly, PLAYER_QUERY_GROUPS, type InputFrame, type MapDef, type PlayerSim, type SimWorld } from '@qwakk/shared';
import type { BotLike, BotTarget } from './arena.ts';
import { BotBrain, SKILL, type BotSkill } from './bots.ts';
import type { BotNav, P3 } from './nav/botNav.ts';
import { NavWalker } from './nav/navWalker.ts';

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** Chases end past this distance (m); the play area is small, a sighting farther off is stale. */
const CHASE_RANGE = 60;

export class DmBot implements BotLike {
  private readonly fighter: BotBrain;
  private readonly sim: SimWorld;
  private readonly map: MapDef;
  private readonly navOf: () => BotNav | null;
  /** Gives up a goal after 3 s without progress (the play area is small; a new goal is close). */
  private readonly walker = new NavWalker(90);
  private readonly frame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0 };
  private goal: 'none' | 'chase' | 'roam' = 'none';
  private yaw = 0;
  private pitch = 0;
  private holdTicks = 0;
  private holdYaw = 0;
  private wasFighting = false;
  private readonly here: P3 = { x: 0, y: 0, z: 0 };
  /** Where the current goal was set from (an unreachable goal from the same spot means stuck off the navmesh). */
  private goalFrom = { x: 0, z: 0 };
  /** Stuck (on furniture, in a corner off the navmesh): walk a free direction for a moment. */
  private wiggleTicks = 0;
  private wiggleYaw = 0;
  /** What it did last tick (tests and tuning). */
  doing: 'fight' | 'hold' | 'walk' | 'idle' = 'idle';

  constructor(sim: SimWorld, nav: () => BotNav | null, skill: BotSkill = SKILL) {
    this.fighter = new BotBrain(sim, skill);
    this.sim = sim;
    this.map = sim.map;
    this.navOf = nav;
  }

  respawned(self: PlayerSim): void {
    this.fighter.respawned(self);
    this.yaw = self.yaw;
    this.pitch = 0;
    this.goal = 'none';
    this.walker.setGoal(null);
    // Look around for a moment after spawning, like a player getting their bearings.
    this.holdTicks = Math.round(rand(5, 25));
    this.holdYaw = self.yaw;
  }

  damagedFrom(x: number, z: number): void {
    this.fighter.damagedFrom(x, z);
    this.holdTicks = 0;
  }

  think(self: PlayerSim, others: readonly BotTarget[], tick: number): InputFrame {
    const nav = this.navOf();
    if (!nav) return this.fighter.think(self, others, tick);
    const f = this.frame;
    f.mx = 0;
    f.mz = 0;
    f.buttons = 0;
    if (!self.alive) {
      f.yaw = this.yaw;
      f.pitch = this.pitch;
      return f;
    }
    if (this.fighter.engage(self, others, tick)) {
      Object.assign(f, this.fighter.output);
      this.yaw = f.yaw;
      this.pitch = f.pitch;
      this.wasFighting = true;
      this.doing = 'fight';
      return f;
    }
    f.buttons = this.fighter.output.buttons & (Button.Reload | Button.Slot1 | Button.Slot2);
    if (this.wasFighting) {
      // Pushed around by the fight: plan the path again from here.
      this.wasFighting = false;
      this.walker.replan();
    }
    const here = this.here;
    here.x = self.x;
    here.y = self.y;
    here.z = self.z;

    // Chase the last sighting (or where a shot came from).
    const seen = this.fighter.takeLastSeen();
    if (seen && Math.hypot(seen.x - self.x, seen.z - self.z) < CHASE_RANGE) {
      const g = this.walker.goal;
      if (this.goal !== 'chase' || !g || Math.hypot(g.x - seen.x, g.z - seen.z) > 4) {
        this.goal = 'chase';
        this.walker.setGoal({ x: seen.x, y: self.y, z: seen.z });
      }
      this.holdTicks = 0;
    } else if (seen) this.fighter.clearLastSeen();
    else if (this.goal === 'chase') this.goal = 'none';

    if (this.wiggleTicks > 0) {
      this.wiggleTicks--;
      this.look(this.wiggleYaw, -0.05);
      f.mz = 1;
      if (this.wiggleTicks === 12) f.buttons |= Button.Jump;
      this.doing = 'walk';
      return this.face(f);
    }
    if (this.goal !== 'chase' && this.holdTicks > 0) {
      this.holdTicks--;
      if (tick % 40 === 0) this.holdYaw = this.yaw + rand(-1.4, 1.4);
      this.look(this.holdYaw, -0.05);
      this.doing = 'hold';
      return this.face(f);
    }
    if (this.goal === 'none') {
      this.goal = 'roam';
      this.walker.setGoal(this.roamPoint(self, nav));
      this.goalFrom = { x: self.x, z: self.z };
    } else if (this.goal === 'chase' && !this.walker.goal) this.goalFrom = { x: self.x, z: self.z };
    const step = this.walker.step(nav, here, this.goal === 'chase' ? 2.5 : 2);
    if (step.state !== 'walking') {
      if (this.goal === 'chase') this.fighter.clearLastSeen();
      // Arrived at a roam spot: sometimes hold it for a moment; either way pick the next one.
      if (step.state === 'arrived' && this.goal === 'roam' && Math.random() < 0.35) {
        this.holdTicks = Math.round(rand(20, 70));
        this.holdYaw = this.yaw;
      }
      // Gave up without getting anywhere: off the navmesh (on furniture, behind a wall from its
      // nearest polygon). Walk off in a free direction, then plan again.
      if (step.state === 'gaveUp' && Math.hypot(self.x - this.goalFrom.x, self.z - this.goalFrom.z) < 3) this.startWiggle(self);
      this.goal = 'none';
      this.doing = 'idle';
      return this.face(f);
    }
    this.doing = 'walk';
    this.look(step.yaw, -0.05);
    f.mz = 1;
    const turnLeft = Math.atan2(Math.sin(step.yaw - this.yaw), Math.cos(step.yaw - this.yaw));
    if (step.left > 8 && Math.abs(turnLeft) < 0.5) f.buttons |= Button.Sprint;
    if (step.hop) f.buttons |= Button.Jump;
    return this.face(f);
  }

  /**
   * Walk off toward the most open direction (the longest free ray at knee and
   * chest height): out of a small room through its door, off a table.
   */
  private startWiggle(self: PlayerSim): void {
    let best = 0;
    let bestYaw = rand(-Math.PI, Math.PI);
    for (let i = 0; i < 16; i++) {
      const yaw = (i / 16) * Math.PI * 2 + rand(-0.1, 0.1);
      const d = Math.min(this.freeDistance(self, yaw, 0.4), this.freeDistance(self, yaw, 1.2)) + Math.random() * 0.3;
      if (d > best) {
        best = d;
        bestYaw = yaw;
      }
    }
    this.wiggleYaw = bestYaw;
    this.wiggleTicks = Math.round(Math.min(35, 8 + (best / 5) * 30));
  }

  /** Free walking distance in this direction at this height above the feet (up to 6 m). */
  private freeDistance(self: PlayerSim, yaw: number, height: number): number {
    const ray = new this.sim.rapier.Ray({ x: self.x, y: self.y + height, z: self.z }, { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) });
    return this.sim.world.castRay(ray, 6, true, undefined, PLAYER_QUERY_GROUPS)?.timeOfImpact ?? 6;
  }

  /** Somewhere in the play area: a spawn point not right here (mostly), else a random walkable spot. */
  private roamPoint(self: PlayerSim, nav: BotNav): P3 {
    const pts = this.map.arenaSpawns;
    if (pts.length > 0 && Math.random() < 0.6) {
      for (let i = 0; i < 6; i++) {
        const p = pts[Math.floor(Math.random() * pts.length)];
        if (p && Math.hypot(p[0] - self.x, p[2] - self.z) > 15) return { x: p[0], y: p[1], z: p[2] };
      }
    }
    const a = this.map.arena;
    const ring = this.map.playRing;
    for (let i = 0; i < 6; i++) {
      const p = nav.randomInCircle(a.x, self.y, a.z, Math.max(10, a.radius * 0.85));
      if (p && (!ring || insidePoly(ring, p.x, p.z))) return p;
    }
    const s = pts[Math.floor(Math.random() * pts.length)];
    return s ? { x: s[0], y: s[1], z: s[2] } : { x: a.x, y: self.y, z: a.z };
  }

  private look(yaw: number, pitch: number): void {
    const t = this.fighter.turnTo(yaw, pitch);
    this.yaw = t.yaw;
    this.pitch = t.pitch;
  }

  private face(f: InputFrame): InputFrame {
    f.yaw = this.yaw;
    f.pitch = this.pitch;
    this.fighter.lookAt(this.yaw, this.pitch);
    return f;
  }
}

/** Deathmatch bot factory for the room: navmesh bots on map_v1 maps, the steering brain on the greybox. */
export function createDmBot(sim: SimWorld, nav: () => BotNav | null): BotLike {
  return sim.map.id === 'greybox' ? new BotBrain(sim) : new DmBot(sim, nav);
}

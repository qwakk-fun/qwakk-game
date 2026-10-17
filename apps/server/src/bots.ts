/**
 * Server-side bots. A bot is a brain that writes one input frame per tick;
 * the room feeds it through exactly the same step, weapon and hit-validation
 * path as a human's input. Bots get no extra information: they only shoot at
 * players they can see (line of sight against the world), react with a human
 * delay, start with aim error that settles over time, and only partly control
 * recoil.
 *
 * Bots run only on the server, so this file may use Math.random and Math.atan2.
 */
import {
  aimOrigin,
  Button,
  DM_BOT,
  PLAYER_QUERY_GROUPS,
  SIGHT_QUERY_GROUPS,
  WeaponId,
  weaponStats,
  type InputFrame,
  type MapDef,
  type PlayerSim,
  type SimWorld,
} from '@qwakk/shared';

import type { BotLike, BotTarget } from './arena.ts';

export type { BotTarget } from './arena.ts';

/** Enough names for a full 32-duck deathmatch room without repeats. */
export const BOT_NAMES = [
  'Quackers', 'Puddles', 'Waddles', 'Bill', 'Feathers', 'Drake', 'Mallard', 'Ducky', 'Paddle', 'Splash', 'Nugget', 'Dabble',
  'Pintail', 'Teal', 'Wigeon', 'Muscovy', 'Pekin', 'Eider', 'Scoter', 'Gadwall', 'Bufflehead', 'Goldeneye', 'Ruddy', 'Mandarin',
  'Pebble', 'Biscuit', 'Noodle', 'Pickles', 'Waffles', 'Sprout', 'Bubbles', 'Ripple', 'Marsh', 'Reed', 'Lily', 'Breezy',
];

const TAU = Math.PI * 2;
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const wrap = (a: number): number => a - TAU * Math.floor((a + Math.PI) / TAU);

/**
 * Skill knobs (deathmatch defaults from `DM_BOT` in constants.ts; other modes
 * pass their own). Lower reaction and error means a harder bot.
 */
export interface BotSkill {
  reactionTicks: readonly [number, number];
  yawError: number;
  pitchError: number;
  errorSettlePerTick: number;
  /** Aim error rolled at each burst start that does not settle (rad, up to this either way). */
  burstYawError: number;
  burstPitchError: number;
  /** Share of the gap to the target the aim point closes per tick (1: aims at where the target is now). */
  trackRate: number;
  turnRatePerTick: number;
  recoilControl: number;
  headChance: number;
  viewRange: number;
  fovCos: number;
  hearRange: number;
  /** Automatic weapons: shots per burst (close, and past 28 m), ticks of pause after a burst. */
  burstShots: readonly [number, number];
  longBurstShots: readonly [number, number];
  burstPauseTicks: readonly [number, number];
  /** Semi-automatic weapons: pause after each trigger pull (ticks). */
  semiPauseTicks: readonly [number, number];
}

export const SKILL: BotSkill = {
  reactionTicks: DM_BOT.reactionTicks,
  yawError: DM_BOT.yawError,
  pitchError: DM_BOT.pitchError,
  errorSettlePerTick: DM_BOT.errorSettlePerTick,
  burstYawError: DM_BOT.burstYawError,
  burstPitchError: DM_BOT.burstPitchError,
  trackRate: DM_BOT.trackRate,
  turnRatePerTick: DM_BOT.turnRatePerTick,
  recoilControl: DM_BOT.recoilControl,
  headChance: DM_BOT.headChance,
  viewRange: DM_BOT.viewRange,
  fovCos: Math.cos((DM_BOT.fovHalfAngleDeg * Math.PI) / 180),
  hearRange: DM_BOT.hearRange,
  burstShots: DM_BOT.burstShots,
  longBurstShots: DM_BOT.longBurstShots,
  burstPauseTicks: DM_BOT.burstPauseTicks,
  semiPauseTicks: DM_BOT.semiPauseTicks,
};

export class BotBrain implements BotLike {
  private readonly frame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0 };
  private yaw = 0;
  private pitch = 0;
  private targetId = '';
  /** The target's life when it was picked: a duck that died and respawned is a new target (fresh reaction). */
  private targetLife = -1;
  private reaction = 0;
  private yawErr = 0;
  private pitchErr = 0;
  private aimHead = false;
  /** Where it aims on the target (lags behind a moving target by `trackRate`), and the error of the current burst. */
  private readonly aimAt = { x: 0, y: 0, z: 0 };
  private burstYaw = 0;
  private burstPitch = 0;
  private strafe = 1;
  private strafeTicks = 0;
  private burstLeft = 0;
  private pauseTicks = 0;
  private lastSeen: { x: number; z: number; ticks: number } | null = null;
  private goal: { x: number; z: number } | null = null;
  private stuckCheck = { x: 0, z: 0, ticks: 0 };
  private jumpCooldown = 0;
  private holdFire = false;
  private crouching = false;
  private readonly map: MapDef;
  private readonly sim: SimWorld;
  private readonly tmp = { x: 0, y: 0, z: 0 };

  private readonly skill: BotSkill;

  constructor(sim: SimWorld, skill: BotSkill = SKILL) {
    this.sim = sim;
    this.map = sim.map;
    this.skill = skill;
  }

  /** Id of the duck it is fighting, '' for none. */
  get targetIdNow(): string {
    return this.targetId;
  }

  /** Has a target it is fighting right now. */
  get busy(): boolean {
    return this.targetId !== '';
  }

  /** Reset after a respawn. */
  respawned(self: PlayerSim): void {
    this.yaw = self.yaw;
    this.pitch = 0;
    this.targetId = '';
    this.targetLife = -1;
    this.lastSeen = null;
    this.goal = null;
    this.burstLeft = 0;
  }

  /** Told by the room when the bot is hit, so it turns toward the shooter like a player reading the damage indicator. */
  damagedFrom(x: number, z: number): void {
    if (!this.targetId) this.lastSeen = { x, z, ticks: 90 };
  }

  think(self: PlayerSim, others: readonly BotTarget[], tick: number): InputFrame {
    const f = this.frame;
    f.mx = 0;
    f.mz = 0;
    f.buttons = 0;
    if (!self.alive) {
      f.yaw = this.yaw;
      f.pitch = this.pitch;
      return f;
    }
    if (tick % 3 === 0) this.perceive(self, others);
    const target = this.current(others);

    if (target) this.fight(self, target);
    else this.roam(self);

    this.weaponChores(self, !!target);
    if (this.crouching && target) f.buttons |= Button.Crouch;
    if (this.jumpCooldown > 0) this.jumpCooldown--;
    f.yaw = wrap(this.yaw);
    f.pitch = Math.max(-1.3, Math.min(1.4, this.pitch));
    return f;
  }

  /**
   * Battle royale: perception and fighting only, no roaming. Returns true
   * while the bot fights (the frame then holds movement, aim and fire);
   * false when nothing is in sight (the frame holds only weapon chores, and
   * the caller steers). Same line-of-sight and aim rules as think().
   */
  engage(self: PlayerSim, others: readonly BotTarget[], tick: number): boolean {
    const f = this.frame;
    f.mx = 0;
    f.mz = 0;
    f.buttons = 0;
    if (!self.alive) return false;
    if (tick % 3 === 0) this.perceive(self, others);
    const target = this.current(others);
    if (target) this.fight(self, target);
    else {
      this.burstLeft = 0;
      this.holdFire = false;
    }
    this.weaponChores(self, !!target);
    if (this.crouching && target) f.buttons |= Button.Crouch;
    if (this.jumpCooldown > 0) this.jumpCooldown--;
    f.yaw = wrap(this.yaw);
    f.pitch = Math.max(-1.3, Math.min(1.4, this.pitch));
    return !!target;
  }

  /** The duck it fights, if still a fair target: alive, the same life, not spawn protected. */
  private current(others: readonly BotTarget[]): BotTarget | undefined {
    if (!this.targetId) return undefined;
    const t = others.find((o) => o.id === this.targetId);
    if (t && t.alive && !t.protect && t.life === this.targetLife) return t;
    this.targetId = '';
    return undefined;
  }

  /** The frame engage() wrote. */
  get output(): InputFrame {
    return this.frame;
  }

  /** Where the last fight target was seen (still fresh), or null. Counts down like think()'s chase. */
  takeLastSeen(): { x: number; z: number } | null {
    const l = this.lastSeen;
    if (!l) return null;
    if (l.ticks-- <= 0) {
      this.lastSeen = null;
      return null;
    }
    return { x: l.x, z: l.z };
  }

  /** Forget the last sighting (reached it, nothing there). */
  clearLastSeen(): void {
    this.lastSeen = null;
  }

  /** Keep the fighter's facing in sync when another brain steers (its field of view follows the look). */
  lookAt(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  /** Turn toward a yaw and pitch at the bot turn rate; returns the new facing. */
  turnTo(yaw: number, pitch: number): { yaw: number; pitch: number } {
    this.turnToward(yaw, pitch);
    return { yaw: wrap(this.yaw), pitch: Math.max(-1.3, Math.min(1.4, this.pitch)) };
  }

  private eye(self: PlayerSim): { x: number; y: number; z: number } {
    return aimOrigin(this.sim, self, 1, this.tmp);
  }

  private visible(self: PlayerSim, o: BotTarget): boolean {
    const e = { x: self.x, y: self.y + (self.crouch ? 1.0 : 1.55), z: self.z };
    const dx = o.x - e.x;
    const dy = o.y + 1.1 - e.y;
    const dz = o.z - e.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > this.skill.viewRange || d < 0.01) return false;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const facing = (dx * fx + dz * fz) / Math.max(0.01, Math.hypot(dx, dz));
    if (facing < this.skill.fovCos && d > this.skill.hearRange) return false;
    const ray = new this.sim.rapier.Ray(e, { x: dx / d, y: dy / d, z: dz / d });
    // Sight: walls, hedges and bushes hide players (bots get no wallhack).
    const hit = this.sim.world.castRay(ray, d, true, undefined, SIGHT_QUERY_GROUPS);
    return !hit || hit.timeOfImpact > d - 0.4;
  }

  private perceive(self: PlayerSim, others: readonly BotTarget[]): void {
    let best: BotTarget | null = null;
    let bestD = Infinity;
    for (const o of others) {
      // A spawn-protected duck blinks (public) and cannot be hurt: not worth a shot.
      if (!o.alive || o.protect) continue;
      const d = Math.hypot(o.x - self.x, o.z - self.z);
      if (d >= bestD) continue;
      if (!this.visible(self, o)) continue;
      best = o;
      bestD = d;
    }
    if (best) {
      if (best.id !== this.targetId || best.life !== this.targetLife) {
        // New target (or the same duck back from a respawn): a human-like reaction delay and a fresh aim error.
        this.targetId = best.id;
        this.targetLife = best.life;
        this.reaction = Math.round(rand(this.skill.reactionTicks[0], this.skill.reactionTicks[1]));
        this.yawErr = rand(-1, 1) * this.skill.yawError;
        this.pitchErr = rand(-1, 1) * this.skill.pitchError;
        this.burstYaw = 0;
        this.burstPitch = 0;
        this.aimAt.x = best.x;
        this.aimAt.y = best.y;
        this.aimAt.z = best.z;
        this.aimHead = Math.random() < this.skill.headChance;
        this.crouching = bestD > 30 && Math.random() < 0.25;
      }
      this.lastSeen = { x: best.x, z: best.z, ticks: 240 };
    } else if (this.targetId) {
      this.targetId = '';
    }
  }

  private fight(self: PlayerSim, t: BotTarget): void {
    const f = this.frame;
    const e = this.eye(self);
    // Follow the target with a lag, like a hand tracking a strafing duck.
    const a = this.aimAt;
    const k = this.skill.trackRate;
    a.x += (t.x - a.x) * k;
    a.y += (t.y - a.y) * k;
    a.z += (t.z - a.z) * k;
    // Aim at the belly so the spray climbs through the chest, like a decent player.
    const aimY = a.y + (this.aimHead ? 1.36 : 0.8);
    const dx = a.x - e.x;
    const dy = aimY - e.y;
    const dz = a.z - e.z;
    const horiz = Math.hypot(dx, dz);
    const dist = Math.hypot(horiz, dy);
    const w = weaponStats(self.weapon);
    const pattern = w.pattern[Math.min(Math.floor(self.spray), w.pattern.length - 1)] ?? [0, 0];

    // Aim error settles toward zero, with a little hand tremor.
    this.yawErr = this.yawErr * this.skill.errorSettlePerTick + rand(-1, 1) * 0.003;
    this.pitchErr = this.pitchErr * this.skill.errorSettlePerTick + rand(-1, 1) * 0.002;
    const wantYaw = Math.atan2(-dx, -dz) + this.yawErr + this.burstYaw + pattern[1] * this.skill.recoilControl;
    const wantPitch = Math.atan2(dy, horiz) + this.pitchErr + this.burstPitch - pattern[0] * this.skill.recoilControl;
    this.turnToward(wantYaw, wantPitch);

    // Movement: strafe, keep a fighting distance, stand still for long-range bursts.
    if (--this.strafeTicks <= 0) {
      this.strafe = Math.random() < 0.5 ? -1 : 1;
      this.strafeTicks = Math.round(rand(10, 30));
    }
    const longRange = dist > 28;
    const firing = this.burstLeft > 0;
    if (!(longRange && firing)) f.mx = this.strafe;
    if (dist > 30) f.mz = 0.6;
    else if (dist < 7) f.mz = -0.6;

    // Fire once the reaction time is over and the aim is close enough.
    if (this.reaction > 0) {
      this.reaction--;
      return;
    }
    const aimOff = Math.hypot(wrap(this.yaw - wantYaw), this.pitch - wantPitch);
    const tolerance = Math.max(0.025, Math.atan2(0.45, dist));
    if (this.pauseTicks > 0) {
      this.pauseTicks--;
      this.holdFire = false;
      return;
    }
    if (aimOff > tolerance * 2.5 && this.burstLeft === 0) return;
    const s = this.skill;
    if (w.automatic) {
      if (this.burstLeft === 0) {
        const shots = longRange ? s.longBurstShots : s.burstShots;
        this.burstLeft = Math.round(rand(shots[0], shots[1])) * w.fireTicks;
        this.rollBurstError();
      }
      f.buttons |= Button.Fire;
      if (--this.burstLeft <= 0) this.pauseTicks = Math.round(rand(s.burstPauseTicks[0], s.burstPauseTicks[1]));
    } else {
      // Semi-auto: press, release, press.
      this.holdFire = !this.holdFire;
      if (this.holdFire) f.buttons |= Button.Fire;
      else {
        this.pauseTicks = Math.round(rand(s.semiPauseTicks[0], s.semiPauseTicks[1]));
        this.rollBurstError();
      }
    }
  }

  /** A fresh error for the next burst (or trigger pull) that does not settle. */
  private rollBurstError(): void {
    this.burstYaw = rand(-1, 1) * this.skill.burstYawError;
    this.burstPitch = rand(-1, 1) * this.skill.burstPitchError;
  }

  private roam(self: PlayerSim): void {
    const f = this.frame;
    this.burstLeft = 0;
    this.holdFire = false;
    if (this.lastSeen && this.lastSeen.ticks-- > 0) this.goal = { x: this.lastSeen.x, z: this.lastSeen.z };
    else this.lastSeen = null;
    if (!this.goal || Math.hypot(this.goal.x - self.x, this.goal.z - self.z) < 3) this.pickGoal(self);
    const g = this.goal as { x: number; z: number };
    let dir = Math.atan2(-(g.x - self.x), -(g.z - self.z));

    // Steer around obstacles: probe ahead at knee and chest height.
    const blocked = (a: number, h: number): boolean => this.rayAhead(self, a, h, 2.6);
    if (blocked(dir, 1.2)) {
      const alt = [0.7, -0.7, 1.4, -1.4, 2.2, -2.2].map((o) => dir + o).find((a) => !blocked(a, 1.2));
      dir = alt ?? dir + Math.PI;
    } else if (blocked(dir, 0.45) && this.jumpCooldown === 0) {
      f.buttons |= Button.Jump;
      this.jumpCooldown = 20;
    }
    this.turnToward(dir, -0.05);
    f.mz = 1;
    if (Math.hypot(g.x - self.x, g.z - self.z) > 15) f.buttons |= Button.Sprint;

    // Stuck: no progress for a second, pick a new goal and hop.
    if (++this.stuckCheck.ticks >= 30) {
      const moved = Math.hypot(self.x - this.stuckCheck.x, self.z - this.stuckCheck.z);
      if (moved < 1) {
        this.pickGoal(self);
        if (this.jumpCooldown === 0) {
          f.buttons |= Button.Jump;
          this.jumpCooldown = 20;
        }
      }
      this.stuckCheck = { x: self.x, z: self.z, ticks: 0 };
    }
  }

  private pickGoal(self: PlayerSim): void {
    const pts = this.map.arenaSpawns;
    if (pts.length === 0) {
      this.goal = { x: rand(-40, 40), z: rand(-40, 40) };
      return;
    }
    // Prefer a point that is not right next to us.
    for (let i = 0; i < 6; i++) {
      const p = pts[Math.floor(Math.random() * pts.length)];
      if (p && Math.hypot(p[0] - self.x, p[2] - self.z) > 15) {
        this.goal = { x: p[0], z: p[2] };
        return;
      }
    }
    const p = pts[0] as [number, number, number];
    this.goal = { x: p[0], z: p[2] };
  }

  private rayAhead(self: PlayerSim, yaw: number, height: number, dist: number): boolean {
    const o = { x: self.x, y: self.y + height, z: self.z };
    const d = { x: -Math.sin(yaw), y: 0, z: -Math.cos(yaw) };
    const hit = this.sim.world.castRay(new this.sim.rapier.Ray(o, d), dist, true, undefined, PLAYER_QUERY_GROUPS);
    return hit !== null;
  }

  private turnToward(yaw: number, pitch: number): void {
    const dy = wrap(yaw - this.yaw);
    const step = this.skill.turnRatePerTick;
    this.yaw += Math.max(-step, Math.min(step, dy));
    this.pitch += Math.max(-step, Math.min(step, pitch - this.pitch));
  }

  private weaponChores(self: PlayerSim, fighting: boolean): void {
    const f = this.frame;
    const mag = self.weapon === WeaponId.Rifle ? self.mag0 : self.mag1;
    const res = self.weapon === WeaponId.Rifle ? self.res0 : self.res1;
    const w = weaponStats(self.weapon);
    if (self.weapon === WeaponId.Rifle && mag === 0 && res === 0) f.buttons |= Button.Slot2;
    else if (self.weapon === WeaponId.Pistol && self.res0 + self.mag0 > 0 && !fighting) f.buttons |= Button.Slot1;
    else if (self.reload === 0 && mag === 0 && res > 0) f.buttons |= Button.Reload;
    else if (!fighting && self.reload === 0 && mag < w.magSize * 0.4 && res > 0) f.buttons |= Button.Reload;
    // Slot and reload buttons act on the press edge; release them on alternate ticks.
    if ((f.buttons & (Button.Reload | Button.Slot1 | Button.Slot2)) && self.prevButtons & (Button.Reload | Button.Slot1 | Button.Slot2)) {
      f.buttons &= ~(Button.Reload | Button.Slot1 | Button.Slot2);
    }
  }
}

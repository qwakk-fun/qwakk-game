/**
 * Deathmatch bots and explosives, kept modest: a wrapper around any bot brain
 * that now and then throws a grenade at the enemy it is already fighting (in
 * front of it, in line of sight, within throwing range), raises the rocket
 * launcher when it has one, and walks to a launcher pickup it can see when
 * it is not fighting.
 *
 * Same rules as every bot: everything goes out as an input frame through the
 * player's path (hold G, let go; the slot 3 key; the trigger), it acts only
 * on what is in line of sight (SIGHT_QUERY_GROUPS) and the pickup is a public
 * map objective. Server only, so Math.random and Math.atan2 are fine here.
 */
import { Button, EXPLOSIVE, Mode, SIGHT_QUERY_GROUPS, unpackEx, type InputFrame, type PlayerSim, type SimWorld } from '@qwakk/shared';
import type { BotLike, BotTarget } from './arena.ts';
import type { RocketPickup } from './dmExplosives.ts';

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export const BOT_EXPLOSIVES = {
  /** Chance per fighting tick to start a throw, once the cooldown is over. */
  throwChance: 0.012,
  /** Ticks between two throw attempts. */
  throwCooldown: [240, 480] as const,
  /** Ticks G is held before the release (time to raise the aim). */
  holdTicks: 9,
  /** Throws only at targets this far (m) and within this angle of where it looks (rad). */
  minRange: 7,
  maxRange: 19,
  aheadAngle: 0.35,
  /** Walks to a launcher pickup it sees within this range (m), giving up after this many ticks. */
  pickupRange: 30,
  pickupGiveUp: 150,
};

/** Pitch to throw at so the arc lands about `d` meters away and `h` meters higher, or null if out of reach. */
export function throwPitch(d: number, h: number): number | null {
  const v = EXPLOSIVE.grenade.speed;
  const g = EXPLOSIVE.grenade.gravity;
  const disc = v ** 4 - g * (g * d * d + 2 * h * v * v);
  if (disc < 0 || d < 0.5) return null;
  // The flat (low) solution: a quick lob.
  return Math.atan((v * v - Math.sqrt(disc)) / (g * d)) - EXPLOSIVE.grenade.upBias;
}

/**
 * Give a bot brain the explosive habits. The brain object stays itself (its
 * class and fields, which tests and tuning read): only its `think` and
 * `respawned` are chained on this instance, so every frame still comes from
 * the brain and then passes through BotExplosives.after.
 */
export function attachBotExplosives<B extends BotLike>(sim: SimWorld, bot: B, pickup: () => RocketPickup | null): B {
  const ex = new BotExplosives(sim, pickup);
  const think = bot.think.bind(bot);
  const respawned = bot.respawned.bind(bot);
  bot.think = (self, others, tick) => ex.after(think(self, others, tick), self, others);
  bot.respawned = (self) => {
    ex.respawned();
    respawned(self);
  };
  return bot;
}

export class BotExplosives {
  private readonly sim: SimWorld;
  private readonly pickup: () => RocketPickup | null;
  private hold = 0;
  private pitch = 0;
  private cooldown = Math.round(rand(...BOT_EXPLOSIVES.throwCooldown));
  private seekTicks = 0;
  private seekId = '';

  constructor(sim: SimWorld, pickup: () => RocketPickup | null) {
    this.sim = sim;
    this.pickup = pickup;
  }

  respawned(): void {
    this.hold = 0;
    this.seekTicks = 0;
  }

  /** The brain's frame for this tick, with a throw, the launcher or a walk to the pickup added. */
  after(f: InputFrame, self: PlayerSim, others: readonly BotTarget[]): InputFrame {
    if (!self.alive || self.mode !== Mode.Ground || self.down) {
      this.hold = 0;
      return f;
    }
    if (this.cooldown > 0) this.cooldown--;
    // A throw in progress: hold G while the aim comes up, let go on the last tick.
    if (this.hold > 0) {
      this.hold--;
      f.buttons &= ~Button.Fire;
      if (this.hold > 0) f.buttons |= Button.Grenade;
      f.pitch = this.pitch;
      return f;
    }
    const fighting = (f.buttons & Button.Fire) !== 0;
    const ex = unpackEx(self.ex);
    // Look for a target (line-of-sight rays) only when it would be used: a throw roll that came up, or raising the launcher.
    const throwNow = fighting && ex.nades > 0 && ex.nadeCd === 0 && this.cooldown === 0 && !ex.out && Math.random() < BOT_EXPLOSIVES.throwChance;
    const raise = fighting && ex.rockets > 0 && !ex.out && !(self.prevButtons & Button.Slot3);
    const target = throwNow || raise ? this.targetAhead(self, others) : null;
    if (target && throwNow) {
      const d = Math.hypot(target.x - self.x, target.z - self.z);
      const p = d >= BOT_EXPLOSIVES.minRange && d <= BOT_EXPLOSIVES.maxRange ? throwPitch(d, target.y - self.y - EXPLOSIVE.grenade.handUp) : null;
      if (p !== null) {
        this.pitch = p;
        this.hold = BOT_EXPLOSIVES.holdTicks;
        this.cooldown = Math.round(rand(...BOT_EXPLOSIVES.throwCooldown));
        f.buttons = (f.buttons & ~Button.Fire) | Button.Grenade;
        f.pitch = p;
        return f;
      }
    }
    if (ex.rockets > 0) {
      if (raise && target) f.buttons |= Button.Slot3;
      // The launcher is semi-automatic: let go of the trigger every other tick so each press counts.
      if (ex.out && fighting) {
        if (self.prevButtons & Button.Fire) f.buttons &= ~Button.Fire;
        f.pitch -= 0.03; // toward the feet: the splash still lands on a near miss
      }
      return f;
    }
    if (!fighting) this.seek(self, f);
    return f;
  }

  /** Walk to a launcher pickup in sight (a public objective), for a few seconds at most. */
  private seek(self: PlayerSim, f: InputFrame): void {
    const p = this.pickup();
    if (!p) {
      this.seekId = '';
      return;
    }
    if (p.id !== this.seekId) {
      this.seekId = p.id;
      this.seekTicks = 0;
    }
    const d = Math.hypot(p.x - self.x, p.z - self.z);
    if (d > BOT_EXPLOSIVES.pickupRange || this.seekTicks > BOT_EXPLOSIVES.pickupGiveUp) return;
    if (!this.clear(self, p.x, p.y, p.z)) return;
    this.seekTicks++;
    f.yaw = Math.atan2(-(p.x - self.x), -(p.z - self.z));
    f.mx = 0;
    f.mz = 1;
    if (d > 8) f.buttons |= Button.Sprint;
  }

  /** The nearest enemy in front of the bot that it can see. */
  private targetAhead(self: PlayerSim, others: readonly BotTarget[]): BotTarget | null {
    let best: BotTarget | null = null;
    let bestD = Infinity;
    for (const o of others) {
      if (!o.alive || o.protect) continue;
      const d = Math.hypot(o.x - self.x, o.z - self.z);
      if (d > BOT_EXPLOSIVES.maxRange || d >= bestD) continue;
      const yaw = Math.atan2(-(o.x - self.x), -(o.z - self.z));
      const off = Math.abs(Math.atan2(Math.sin(yaw - self.yaw), Math.cos(yaw - self.yaw)));
      if (off > BOT_EXPLOSIVES.aheadAngle || !this.clear(self, o.x, o.y + 1.2, o.z)) continue;
      best = o;
      bestD = d;
    }
    return best;
  }

  private clear(self: PlayerSim, x: number, y: number, z: number): boolean {
    const from = { x: self.x, y: self.y + 1.5, z: self.z };
    const dx = x - from.x;
    const dy = y - from.y;
    const dz = z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.1) return true;
    const hit = this.sim.world.castRay(new this.sim.rapier.Ray(from, { x: dx / d, y: dy / d, z: dz / d }), d, true, undefined, SIGHT_QUERY_GROUPS);
    return !hit || hit.timeOfImpact >= d - 0.3;
  }
}

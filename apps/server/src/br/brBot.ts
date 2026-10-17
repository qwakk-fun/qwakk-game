/**
 * Battle royale bot. One input frame per tick through the same path as a
 * player (applyInput), and the same line-of-sight rules: it fights only what
 * the deathmatch brain (bots.ts) sees, and loots only items its eye can see.
 *
 *   plane    pick a landing spot near the route, jump when the plane is close
 *   drop     freefall, open the glider when the spot is far, glide, brake over it
 *   ground   in order: fight what it sees, revive a knocked teammate when no
 *            fight is on (team modes), get back into the zone, heal when
 *            safe, loot what it sees, chase the last sighting, rotate into the
 *            announced circle early, else roam between loot spots in the zone
 *   knocked  stays put, low, and waits for a teammate
 *
 * Movement follows navmesh paths (recast), re-planned only on a new goal or
 * every few seconds, with stuck detection (hop, re-plan, new goal).
 * Server only, so Math.random and Math.atan2 are fine here.
 */
import { Button, Item, KNOCK, Mode, planeAt, type InputFrame, type PlayerSim } from '@qwakk/shared';
import type { BotLike, BotTarget } from '../arena.ts';
import { BotBrain, type BotSkill } from '../bots.ts';
import { PathFollower, type BotNav, type P3 } from '../nav/botNav.ts';
import { dropSteer, planLanding, type LandingPlan } from './botLanding.ts';
import { entityScore, geared, pickItem } from './botLoot.ts';
import type { BrBotContext } from './context.ts';
import type { LootEntity } from './loot.ts';

/** Counters for tests and tuning. */
export const BOT_STATS = { skipUse: 0, skipArrived: 0, skipGiveUp: 0, uses: 0 };

type Goal = 'none' | 'loot' | 'zone' | 'chase' | 'roam' | 'assist';

/** Re-plan a path at most this often while the goal stays the same (ticks). */
const REPATH_TICKS = 90;
const STUCK_TICKS = 45;
const GIVE_UP_TICKS = 150;

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/**
 * Battle royale bot skill: slow to react, loose first aim, a short view. They
 * are the lobby filler; a match should be winnable and last, not end in a
 * three-minute bloodbath. Every knob is spelled out, so tuning the deathmatch
 * bots (`DM_BOT` in constants.ts) leaves these alone.
 */
/** Landing spots chosen per match (keyed by the match's bot context), so bots spread out. */
const landings = new WeakMap<object, { route: unknown; spots: { x: number; z: number }[] }>();

export const BR_SKILL: BotSkill = {
  reactionTicks: [14, 26],
  yawError: 0.17,
  pitchError: 0.08,
  errorSettlePerTick: 0.93,
  recoilControl: 0.6,
  viewRange: 50,
  // The values the deathmatch bots had before they were softened (both modes used to share them).
  burstYawError: 0,
  burstPitchError: 0,
  trackRate: 1,
  turnRatePerTick: 0.22,
  headChance: 0.1,
  fovCos: Math.cos((75 * Math.PI) / 180),
  hearRange: 9,
  burstShots: [3, 6],
  longBurstShots: [2, 4],
  burstPauseTicks: [5, 12],
  semiPauseTicks: [3, 7],
};

export class BrBot implements BotLike {
  private readonly ctx: BrBotContext;
  private readonly seatId: string;
  private readonly navOf: () => BotNav | null;
  private readonly fighter: BotBrain;
  private readonly frame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0 };
  private readonly follow = new PathFollower();
  private plan: LandingPlan = { x: 0, z: 0, jumpAt: 1 };
  private goal: Goal = 'none';
  private goalPos: P3 | null = null;
  private pathAge = 0;
  private item: LootEntity | null = null;
  private readonly skipItems = new Set<string>();
  private itemTicks = 0;
  private lastFightTick = -1000;
  private progress = { best: Infinity, ticks: 0 };
  private hop = 0;
  private yaw = 0;
  private pitch = 0;
  /** Stays this many ticks after landing before thinking about the zone (looting time). */
  private tick = 0;

  constructor(ctx: BrBotContext, seatId: string, nav: BotNav | null | (() => BotNav | null)) {
    this.ctx = ctx;
    this.seatId = seatId;
    this.navOf = typeof nav === 'function' ? nav : () => nav;
    this.fighter = new BotBrain(ctx.sim, BR_SKILL);
  }

  respawned(self: PlayerSim): void {
    this.fighter.respawned(self);
    this.yaw = self.yaw;
    this.pitch = 0;
    const route = this.ctx.route();
    let reg = landings.get(this.ctx);
    if (!reg || reg.route !== route) landings.set(this.ctx, (reg = { route, spots: [] }));
    this.plan = planLanding(this.ctx.map, route, reg.spots);
    this.goal = 'none';
    this.goalPos = null;
    this.follow.clear();
    this.item = null;
    this.skipItems.clear();
  }

  damagedFrom(x: number, z: number): void {
    this.fighter.damagedFrom(x, z);
  }

  think(self: PlayerSim, others: readonly BotTarget[], tick: number): InputFrame {
    this.tick = tick;
    const f = this.frame;
    f.mx = 0;
    f.mz = 0;
    f.buttons = 0;
    if (!self.alive) {
      f.yaw = this.yaw;
      f.pitch = this.pitch;
      return f;
    }
    if (self.mode === Mode.Plane) return this.inPlane(f);
    if (self.mode === Mode.Freefall || self.mode === Mode.Glide) return this.inAir(self, f);
    return this.onGround(self, others, f);
  }

  private look(yaw: number, pitch: number): void {
    const t = this.fighter.turnTo(yaw, pitch);
    this.yaw = t.yaw;
    this.pitch = t.pitch;
  }

  private inPlane(f: InputFrame): InputFrame {
    const r = this.ctx.route();
    const t = this.ctx.planeTime();
    if (r && t >= 0) {
      // Look toward the landing spot from the plane (players do too).
      const p = planeAt(r, t);
      this.look(Math.atan2(-(this.plan.x - p.x), -(this.plan.z - p.z)), -0.4);
      if (t >= this.plan.jumpAt && this.tick % 2 === 0) f.buttons = Button.Deploy;
    }
    f.yaw = this.yaw;
    f.pitch = this.pitch;
    return f;
  }

  private inAir(self: PlayerSim, f: InputFrame): InputFrame {
    const want = Math.atan2(-(this.plan.x - self.x), -(this.plan.z - self.z));
    this.look(want, -0.5);
    const s = dropSteer(this.ctx.map, self, this.plan.x, this.plan.z, this.tick);
    f.mz = s.mz;
    f.buttons = s.buttons;
    f.yaw = this.yaw;
    f.pitch = this.pitch;
    return f;
  }

  private onGround(self: PlayerSim, others: readonly BotTarget[], f: InputFrame): InputFrame {
    // Knocked: it cannot fight or loot; it stays where it fell and waits for a teammate.
    if (self.down) return this.face(f);
    const armed = (self.arms & 3) !== 0;
    const fighting = this.fighter.engage(self, others, this.tick);
    const out = this.fighter.output;
    if (fighting) this.lastFightTick = this.tick;
    // Under-geared bots keep looting instead of taking a long-range fight they would lose.
    let engageNow = fighting && armed;
    if (engageNow && !geared(self, this.ctx.armorOf(this.seatId)) && self.res0 + self.mag0 + self.res1 + self.mag1 < 40) {
      const t = others.find((o) => o.id === this.fighter.targetIdNow);
      if (t && Math.hypot(t.x - self.x, t.z - self.z) > 30) engageNow = false;
    }
    if (engageNow) {
      // Fight: the deathmatch brain's frame (aim, strafe, fire). Keep the path for later.
      Object.assign(f, out);
      // No charging across open fields in a battle royale: hold the distance past 25 m.
      const t = others.find((o) => o.id === this.fighter.targetIdNow);
      if (t && f.mz > 0 && Math.hypot(t.x - self.x, t.z - self.z) > 25) f.mz = 0;
      this.yaw = f.yaw;
      this.pitch = f.pitch;
      return f;
    }
    // Unarmed and seen an enemy close by: run away for a few seconds, then back to looting.
    if (fighting && !armed) {
      const t = others.find((o) => o.id === this.fighter.targetIdNow);
      if (t && t.id !== this.fleeFrom) {
        this.fleeFrom = t.id;
        this.fleeTicks = 120;
      }
      if (t && this.fleeTicks > 0 && Math.hypot(t.x - self.x, t.z - self.z) < 45 && !this.outsideZone(self)) {
        this.fleeTicks--;
        this.look(Math.atan2(self.x - t.x, self.z - t.z), -0.05);
        f.mz = 1;
        f.buttons |= Button.Sprint;
        return this.face(f);
      }
    }
    const chores = out.buttons & (Button.Reload | Button.Slot1 | Button.Slot2);
    f.buttons = chores;

    // A knocked teammate nearby and no fight for a moment: go to it and hold Use, like a player.
    const mate = this.tick - this.lastFightTick > 60 ? this.ctx.downedMate(this.seatId, 40) : null;
    if (mate) {
      if (Math.hypot(mate.x - self.x, mate.y - self.y, mate.z - self.z) < KNOCK.reviveRange - 0.6) {
        this.look(Math.atan2(-(mate.x - self.x), -(mate.z - self.z)), -0.4);
        f.buttons |= Button.Use;
        return this.face(f);
      }
      if (this.goal !== 'assist' || !this.goalPos || Math.hypot(this.goalPos.x - mate.x, this.goalPos.z - mate.z) > 2) this.setGoal(self, 'assist', { x: mate.x, y: mate.y, z: mate.z });
      return this.move(self, f, 'assist', 1.2);
    }

    const zone = this.ctx.zone();
    const now = zone.now;
    const dNow = Math.hypot(self.x - now.x, self.z - now.z);
    const outside = now.r < 2000 && dNow > now.r - 4;
    const safe = this.tick - this.lastFightTick > 90;

    // Healing: stand (or crouch) still until done.
    if (self.heal > 0) {
      if (outside && zone.dps >= 4) return this.move(self, f, 'zone');
      f.buttons |= Button.Crouch;
      return this.face(f);
    }
    if (!outside || zone.dps <= 2) {
      if (safe && this.wantsHeal(self) && this.tick % 2 === 0) {
        f.buttons |= self.medkits > 0 && self.hp < 45 ? Button.Heal2 : self.bandages > 0 && self.hp < 75 ? Button.Heal1 : Button.Heal2;
        return this.face(f);
      }
    }
    if (outside) return this.move(self, f, 'zone');

    // Loot what it can see; less detouring once geared.
    const armor = this.ctx.armorOf(this.seatId);
    if (--this.itemTicks <= 0 || (this.item && !this.ctx.itemsNear(this.item.x, this.item.z, 0.05).includes(this.item))) {
      this.itemTicks = 15;
      const radius = geared(self, armor) ? 10 : armed ? 22 : 40;
      const next = pickItem(this.ctx.sim, self, armor, this.ctx.itemsNear(self.x, self.z, radius), radius, this.skipItems);
      if (next !== this.item) {
        this.item = next;
        if (next) this.setGoal(self, 'loot', { x: next.x, y: next.y, z: next.z });
      }
    }
    // Nothing in it for us any more (taken, emptied, or it no longer fits): drop it.
    if (this.item && entityScore(self, armor, this.item) <= 0) {
      this.skipItems.add(this.item.id);
      this.item = null;
      this.itemUses = 0;
    }
    if (this.item) {
      const it = this.item;
      const d3 = Math.hypot(it.x - self.x, it.y + 0.15 - (self.y + 0.9), it.z - self.z);
      if (d3 < 2.2 && this.ctx.canReach(self, it)) {
        // Look at it and press Use (one press edge). A crate it just opened: wait for the lid first.
        const dx = it.x - self.x;
        const dz = it.z - self.z;
        this.look(Math.atan2(-dx, -dz), Math.atan2(it.y - (self.y + 1.5), Math.max(0.3, Math.hypot(dx, dz))));
        const opening = it.kind === Item.Crate && it.open && !this.ctx.lootable(it);
        if (!opening && this.tick % 2 === 0) {
          f.buttons |= Button.Use;
          BOT_STATS.uses++;
          // If it is still there after a few presses, it does not fit: skip it.
          this.itemUses++;
          if (this.itemUses > 3) {
            this.skipItems.add(it.id);
            BOT_STATS.skipUse++;
            this.item = null;
            this.itemUses = 0;
          }
        }
        return this.face(f);
      }
      this.itemUses = 0;
      if (this.goal !== 'loot') this.setGoal(self, 'loot', { x: it.x, y: it.y, z: it.z });
      return this.move(self, f, 'loot', 1.0);
    }

    // Chase the last sighting when armed.
    // Chase only when healthy and armored: an under-geared bot lets a fight go.
    const seen = armed && self.hp > 60 && armor.vest > 0 ? this.fighter.takeLastSeen() : null;
    if (!seen && armed && (self.hp <= 60 || armor.vest === 0)) this.fighter.clearLastSeen();
    if (seen && Math.hypot(seen.x - self.x, seen.z - self.z) > 50) this.fighter.clearLastSeen();
    else if (seen && Math.hypot(seen.x - self.x, seen.z - self.z) > 3) {
      if (this.goal !== 'chase' || !this.goalPos || Math.hypot(this.goalPos.x - seen.x, this.goalPos.z - seen.z) > 6) this.setGoal(self, 'chase', { x: seen.x, y: self.y, z: seen.z });
      return this.move(self, f, 'chase');
    } else if (seen) this.fighter.clearLastSeen();

    // Rotate early into the announced circle.
    const next = zone.next;
    if (next && Math.hypot(self.x - next.x, self.z - next.z) > next.r * 0.85) return this.move(self, f, 'zone');

    // Hold a spot for a while (watch, crouch, look around), then move on to another nearby.
    if (this.holdTicks > 0) {
      this.holdTicks--;
      if (this.tick % 45 === 0) this.holdYaw = this.yaw + rand(-1.6, 1.6);
      this.look(this.holdYaw, -0.05);
      if (this.holdCrouch) f.buttons |= Button.Crouch;
      return this.face(f);
    }
    return this.move(self, f, 'roam');
  }

  private itemUses = 0;
  private fleeFrom = '';
  private fleeTicks = 0;

  private outsideZone(self: PlayerSim): boolean {
    const now = this.ctx.zone().now;
    return now.r < 2000 && Math.hypot(self.x - now.x, self.z - now.z) > now.r - 4;
  }
  private holdTicks = 0;
  private holdYaw = 0;
  private holdCrouch = false;

  private wantsHeal(s: PlayerSim): boolean {
    return (s.hp < 70 && s.bandages > 0) || (s.hp < 50 && s.medkits > 0);
  }

  private face(f: InputFrame): InputFrame {
    f.yaw = this.yaw;
    f.pitch = this.pitch;
    this.fighter.lookAt(this.yaw, this.pitch);
    return f;
  }

  private setGoal(self: PlayerSim, goal: Goal, pos: P3 | null): void {
    this.goal = goal;
    this.goalPos = pos;
    this.pathAge = REPATH_TICKS;
    this.follow.clear();
    this.progress = { best: Infinity, ticks: 0 };
  }

  /** A goal position for zone and roam goals. */
  private pickGoalPos(self: PlayerSim, goal: Goal): P3 | null {
    const z = this.ctx.zone();
    const c = goal === 'zone' ? (z.next ?? z.now) : z.next && z.next.r < z.now.r ? z.next : z.now;
    const r = Math.min(c.r, 2000);
    if (goal === 'zone') {
      const p = this.navOf()?.randomInCircle(c.x, self.y, c.z, Math.max(5, r * 0.5));
      return p ?? { x: c.x, y: self.y, z: c.z };
    }
    // Roam: a loot spot inside the safe circle, not too far, not right here.
    const loot = this.ctx.map.br?.loot ?? [];
    for (let i = 0; i < 12; i++) {
      const p = loot[Math.floor(Math.random() * loot.length)];
      if (!p) break;
      const d = Math.hypot(p.x - self.x, p.z - self.z);
      if (d < 15 || d > 70) continue;
      if (Math.hypot(p.x - c.x, p.z - c.z) > r * 0.8) continue;
      return { x: p.x, y: p.y, z: p.z };
    }
    const p = this.navOf()?.randomInCircle(c.x, self.y, c.z, Math.max(5, r * 0.6));
    return p ?? { x: c.x + rand(-20, 20), y: self.y, z: c.z + rand(-20, 20) };
  }

  /** Move toward the current goal along a navmesh path. */
  private move(self: PlayerSim, f: InputFrame, goal: Goal, arrive = 2): InputFrame {
    if (this.goal !== goal || !this.goalPos) this.setGoal(self, goal, goal === 'zone' || goal === 'roam' ? this.pickGoalPos(self, goal) : this.goalPos);
    const g = this.goalPos;
    if (!g) return this.face(f);
    const dGoal = Math.hypot(g.x - self.x, g.z - self.z);
    if (dGoal < arrive) {
      if (goal === 'chase') this.fighter.clearLastSeen();
      // At the item but it is out of reach (a floor or a wall in between): give it up.
      if (goal === 'loot' && this.item) {
        this.skipItems.add(this.item.id);
        BOT_STATS.skipArrived++;
        this.item = null;
      }
      if (goal === 'roam') {
        // Arrived at a spot: hold it for a while, like a player waiting in a house.
        this.holdTicks = Math.round(rand(40, 110) * 30);
        this.holdYaw = this.yaw;
        this.holdCrouch = Math.random() < 0.5;
      }
      if (goal === 'roam' || goal === 'zone' || goal === 'chase') this.goalPos = goal === 'chase' ? null : this.pickGoalPos(self, goal);
      this.follow.clear();
      return this.face(f);
    }
    // Plan (or re-plan) the path.
    if (++this.pathAge >= REPATH_TICKS || (!this.follow.active && this.pathAge > 15) || this.follow.offPath(self.x, self.z) > 4) {
      this.pathAge = 0;
      this.follow.set(this.navOf()?.path({ x: self.x, y: self.y, z: self.z }, g) ?? [{ x: self.x, y: self.y, z: self.z }, g], self.x, self.z);
    }
    let wp = this.follow.next(self.x, self.z);
    if (!wp) {
      // Path walked but the goal is still away: the path ends short of it (the goal is off the navmesh).
      const end = this.follow.end;
      if (end && Math.hypot(end.x - g.x, end.z - g.z) > arrive) {
        this.giveUp(self);
        return this.face(f);
      }
      wp = g;
    }
    this.look(Math.atan2(-(wp.x - self.x), -(wp.z - self.z)), -0.05);
    f.mz = 1;
    const urgent = goal === 'zone' || goal === 'chase' || goal === 'assist' || (goal === 'roam' && dGoal > 30);
    if (urgent && dGoal > 8 && Math.abs(this.turnLeft(wp, self)) < 0.5) f.buttons |= Button.Sprint;
    this.unstick(self, f, dGoal);
    return this.face(f);
  }

  private turnLeft(wp: P3, self: PlayerSim): number {
    const want = Math.atan2(-(wp.x - self.x), -(wp.z - self.z));
    return Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
  }

  /**
   * Stuck detection by progress toward the goal: no meter gained in 1.5 s,
   * hop and re-plan; none in 5 s, give the goal up (skip the item, pick a new spot).
   */
  private unstick(self: PlayerSim, f: InputFrame, dGoal: number): void {
    if (this.hop > 0) this.hop--;
    const p = this.progress;
    if (dGoal < p.best - 1) {
      p.best = dGoal;
      p.ticks = 0;
      return;
    }
    p.ticks++;
    if (p.ticks % STUCK_TICKS === 0 && p.ticks < GIVE_UP_TICKS) {
      if (this.hop === 0) {
        f.buttons |= Button.Jump;
        this.hop = 20;
      }
      this.pathAge = REPATH_TICKS;
    }
    if (p.ticks >= GIVE_UP_TICKS) this.giveUp(self);
  }

  /** Drop the current goal: skip an item, or pick a new spot. */
  private giveUp(self: PlayerSim): void {
    if (this.goal === 'loot' && this.item) {
      this.skipItems.add(this.item.id);
      BOT_STATS.skipGiveUp++;
    }
    this.item = null;
    if (this.goal === 'chase') this.fighter.clearLastSeen();
    const g = this.goal;
    this.setGoal(self, g, g === 'zone' || g === 'roam' ? this.pickGoalPos(self, g) : null);
  }
}

/** `nav` may be a getter: the server's navmesh can finish building after the first match starts. */
export function createBrBot(ctx: BrBotContext, seatId: string, nav: BotNav | null | (() => BotNav | null) = null): BotLike {
  return new BrBot(ctx, seatId, nav);
}

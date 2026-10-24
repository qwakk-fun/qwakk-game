/**
 * Hunter brains, one tick at a time. Fair by design (CLAUDE.md bot rules,
 * applied to hunters): they see only what is in line of sight (sight.ts),
 * react with a delay, telegraph every shot (the rifleman's laser and glint,
 * the boss's wind-up, the dog's lunge) and stop tracking just before the shot
 * so a duck that moves on the warning dodges it, aim with an error that
 * settles, and never shoot through walls (gun.ts).
 *
 *   rifleman  mid and long range: finds half cover, kneels, stands to aim
 *             (laser), fires one shot, moves to new cover every two shots
 *   trapper   closes in with a shotgun and sets traps ahead of ducks
 *   decoy     lobs a wooden decoy duck that pops after a fuse
 *   dog       fast packs, bite after a short lunge
 *   boss      the Big Hunter: double barrel after a long wind-up, whistles
 *             for help
 *   sniper    walks to a free perch (a watchtower or a hill, 90 to 140 m
 *             out) and fires one long shot after a long, readable laser
 *             and glint (longer the farther the duck)
 *
 * Without a duck in sight every hunter goes for its objective on Pond Keep
 * (travel.ts): the gate while the drawbridge is down (it hammers it), the
 * QoreChain core once the gate is broken, the island's bank by the bridge
 * while it is up (paddling a raft across). Server only (Math.random,
 * Math.atan2).
 */
import { HunterAct, HunterKind, isMinion } from '@qwakk/shared';
import type { P3 } from '../nav/botNav.ts';
import { BITE, DECOY, GUN, KIND, SWING, TRAP, WHISTLE, type GunNumbers, type HunterAgent } from './hunter.ts';
import { hunterMuzzle } from './gun.ts';
import { clearSight, sees, type DuckTarget } from './sight.ts';
import type { RaidRules } from './rules.ts';
import { stepKnock, stepRaft, travel, type TravelContext } from './travel.ts';

export interface HuntContext extends TravelContext {
  tick: number;
  rules: RaidRules;
  ducks: readonly DuckTarget[];
  lastWave: boolean;
  /**
   * The wave is down to its last few hunters (or drags on): they stop
   * sniping from afar and push for the keep, fighting only what is close.
   */
  push: boolean;
  /** At its objective (the gate or the core) close enough to hammer it. */
  atObjective(h: HunterAgent, hammer: 1 | 2): boolean;
  /** Trench points riflemen take cover in. */
  trench: readonly P3[];
  /** A sniper's perch (claimed once, kept while it lives), or null when none is free. */
  perch(h: HunterAgent): P3 | null;
  fire(h: HunterAgent, gun: GunNumbers, yaw: number, pitch: number): void;
  bite(h: HunterAgent, duck: DuckTarget): void;
  placeTrap(h: HunterAgent, x: number, y: number, z: number): void;
  throwDecoy(h: HunterAgent, x: number, y: number, z: number): void;
  whistle(h: HunterAgent): void;
  /** A minion's swing lands on a duck. */
  swing(h: HunterAgent, duck: DuckTarget): void;
  /** Minions winding up a swing at this duck right now (at most SWING.maxAttackers at once: a horde, not a blender). */
  attackers(duckId: string): number;
  hammer(h: HunterAgent, what: 1 | 2): void;
  /** Reinforcements a boss whistled up that are still standing. */
  helpers(): number;
  /** The boss may still whistle this wave (stops WHISTLE.stopAfterTicks into it). */
  whistleOpen: boolean;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const wrap = (a: number): number => a - Math.PI * 2 * Math.floor((a + Math.PI) / (Math.PI * 2));

function turnToward(h: HunterAgent, yaw: number, rate: number): void {
  const d = wrap(yaw - h.yaw);
  h.yaw = wrap(h.yaw + Math.max(-rate, Math.min(rate, d)));
}

function faceDuck(h: HunterAgent, d: { x: number; z: number }, rate = 0.25): void {
  turnToward(h, Math.atan2(-(d.x - h.x), -(d.z - h.z)), rate);
}

const lookList: { d: DuckTarget; dist: number }[] = [];

/** Look around for a target every third tick (staggered), keep the one it has while it stays in sight. */
function perceive(h: HunterAgent, ctx: HuntContext): void {
  const k = KIND[h.kind]!;
  const cur = h.targetId ? ctx.ducks.find((d) => d.id === h.targetId && d.standing) : undefined;
  if (h.targetId && !cur) {
    h.targetId = null;
    h.lastSeen = null;
  }
  // Pushing in, gunners fight only what is close (they come at the ducks); minions and placed snipers use their whole range.
  const range = ctx.push && !h.perchFixed && !isMinion(h.kind) ? Math.min(k.engage, 22) : k.engage;
  if (cur && ctx.push && Math.hypot(cur.x - h.x, cur.z - h.z) > range + 4) {
    h.targetId = null;
    h.lastSeen = null;
  } else if (cur) {
    if (sees(ctx.sim, h, k, cur)) {
      h.lostTicks = 0;
      h.lastSeen = { x: cur.x, y: cur.y, z: cur.z };
      return;
    }
    h.lostTicks += 3;
    if (h.lostTicks <= 75) return;
    h.targetId = null;
  }
  // Look at no more than two ducks in range per look-around (the nearest first, then turn by turn through
  // the rest): with snipers seeing 160 m most of them are behind the walls, and every look costs rays.
  const near = lookList;
  near.length = 0;
  for (const d of ctx.ducks) {
    if (!d.standing) continue;
    const dist = Math.hypot(d.x - h.x, d.z - h.z);
    if (dist <= range) near.push({ d, dist });
  }
  if (near.length === 0) return;
  near.sort((a, b) => a.dist - b.dist);
  let best: DuckTarget | null = null;
  const turn = Math.floor(ctx.tick / 3) + h.serial;
  for (let i = 0; i < Math.min(2, near.length) && !best; i++) {
    const c = near[i === 0 ? 0 : 1 + (turn % Math.max(1, near.length - 1))]!;
    if (sees(ctx.sim, h, k, c.d)) best = c.d;
  }
  if (!best) return;
  h.targetId = best.id;
  h.lostTicks = 0;
  h.lastSeen = { x: best.x, y: best.y, z: best.z };
  h.aimAt = { x: best.x, y: best.y, z: best.z };
  const [r0, r1] = ctx.rules.reactionTicks;
  h.reaction = Math.round(rand(r0, r1));
  h.errYaw = rand(-1, 1) * ctx.rules.aimError;
  h.errPitch = rand(-1, 1) * ctx.rules.aimError * 0.4;
  if (h.phase === 'advance' || h.phase === 'hammer') {
    h.phase = 'move';
    h.cover = null;
  }
}

/** Walk (or run) toward a point by the keep's route rules (travel.ts); the act follows the speed. Returns true while still on the way. */
function go(h: HunterAgent, ctx: HuntContext, p: P3, speed: number, arrive: number): boolean {
  const on = travel(h, ctx, p, speed, arrive);
  if (h.raft) return true;
  const k = KIND[h.kind]!;
  h.act = !on || h.mover.speed === 0 ? HunterAct.Idle : speed >= k.run - 0.01 ? HunterAct.Run : HunterAct.Walk;
  return on;
}

/**
 * Rifleman cover: a nearby spot where a wall (a trench parapet, a sandbag
 * line) hides a kneeling hunter from the duck but standing up clears it.
 * Trench points first, then random walkable points, bounding toward the keep.
 */
function pickCover(h: HunterAgent, ctx: HuntContext, d: DuckTarget): P3 | null {
  const nav = ctx.nav;
  const core = ctx.keep.core;
  const tx = core.x - h.x;
  const tz = core.z - h.z;
  const tl = Math.hypot(tx, tz) || 1;
  const step = Math.min(7, Math.max(0, tl - 30));
  const bx = h.x + (tx / tl) * step;
  const bz = h.z + (tz / tl) * step;
  const cands: P3[] = [];
  for (const p of ctx.trench) if (Math.abs(p.x - bx) < 12 && Math.abs(p.z - bz) < 12) cands.push(p);
  cands.sort((a, b) => Math.hypot(a.x - bx, a.z - bz) - Math.hypot(b.x - bx, b.z - bz));
  cands.length = Math.min(cands.length, 6);
  if (nav) for (let i = 0; i < 5; i++) {
    const c = nav.randomInCircle(bx, h.y, bz, 8);
    if (c) cands.push(c);
  }
  const good: { c: P3; d: number }[] = [];
  for (const c of cands) {
    const dd = Math.hypot(c.x - d.x, c.z - d.z);
    if (dd < 12 || dd > KIND[HunterKind.Rifleman]!.engage) continue;
    if (clearSight(ctx.sim, c.x, c.y + 0.9, c.z, d.x, d.y + 0.9, d.z)) continue;
    if (!clearSight(ctx.sim, c.x, c.y + 1.6, c.z, d.x, d.y + 1.0, d.z)) continue;
    good.push({ c, d: Math.hypot(c.x - h.x, c.z - h.z) });
  }
  good.sort((a, b) => a.d - b.d);
  // Only a spot the hunter can really walk to (a trench the navmesh does not join up is a trap).
  for (const { c } of good.slice(0, 3)) {
    if (!nav) return c;
    const path = nav.path(h, c);
    const end = path?.[path.length - 1];
    if (end && Math.hypot(end.x - c.x, end.z - c.z) < 1.2) return c;
  }
  return null;
}

/** Aim at the tracked point (chest), from the muzzle: yaw and pitch of the line. */
function aimLine(ctx: HuntContext, h: HunterAgent): { yaw: number; pitch: number } {
  const m = hunterMuzzle(ctx.sim, h);
  const dx = h.aimAt.x - m.x;
  const dy = h.aimAt.y + 0.85 - m.y;
  const dz = h.aimAt.z - m.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/**
 * The gun cycle shared by the rifleman, the trapper and the boss: aim (the
 * telegraph, tracking with a lag, frozen for the last `lockTicks`), fire,
 * then a gap (kneeling for the rifleman) or a reload.
 */
function gunCycle(h: HunterAgent, ctx: HuntContext, target: DuckTarget, g: GunNumbers): void {
  if (h.phase === 'aim') {
    h.act = HunterAct.Aim;
    if (h.phaseTicks > g.lockTicks) {
      const k = 0.3;
      h.aimAt.x += (target.x - h.aimAt.x) * k;
      h.aimAt.y += (target.y - h.aimAt.y) * k;
      h.aimAt.z += (target.z - h.aimAt.z) * k;
      h.errYaw *= 0.93;
      h.errPitch *= 0.93;
      const a = aimLine(ctx, h);
      turnToward(h, a.yaw, 0.3);
      h.pitch = Math.max(-1.2, Math.min(1.2, a.pitch));
    }
    if (--h.phaseTicks > 0) return;
    // The shot needs a clear line right now: no shooting at a duck that just stepped behind a wall.
    const visible = seesNow(h, ctx, target.id);
    if (visible) {
      ctx.fire(h, g, h.yaw + h.errYaw, h.pitch + h.errPitch);
      h.flash = 6;
      h.shotsSinceMove++;
      h.shotsSinceReload++;
    }
    if (visible && g.second > 0) {
      h.phase = 'fire';
      h.phaseTicks = g.second;
      return;
    }
    endShot(h, g);
    return;
  }
  if (h.phase === 'fire') {
    h.act = HunterAct.Fire;
    if (--h.phaseTicks > 0) return;
    // The second barrel checks the line again: a duck that ducked behind a wall after the first is safe.
    if (seesNow(h, ctx, target.id)) {
      ctx.fire(h, g, h.yaw + h.errYaw * 0.5, h.pitch + h.errPitch * 0.5);
      h.flash = 6;
    }
    endShot(h, g);
    return;
  }
  if (h.phase === 'reload') {
    h.act = HunterAct.Reload;
    if (--h.phaseTicks > 0) return;
    h.shotsSinceReload = 0;
    if (h.kind === HunterKind.Rifleman && h.shotsSinceMove >= 2) {
      h.shotsSinceMove = 0;
      h.cover = null;
      h.phase = 'move';
    } else {
      h.phase = 'kneel';
      h.phaseTicks = 6;
    }
  }
}

function endShot(h: HunterAgent, g: GunNumbers): void {
  // A rifleman moves to new cover (a bound toward the keep) every two shots.
  if (h.kind === HunterKind.Rifleman && h.shotsSinceMove >= 2 && h.shotsSinceReload < g.reloadEvery) {
    h.shotsSinceMove = 0;
    h.cover = null;
    h.phase = 'move';
    return;
  }
  if (h.shotsSinceReload >= g.reloadEvery) {
    h.phase = 'reload';
    h.phaseTicks = g.reloadTicks;
  } else {
    h.phase = 'kneel';
    h.phaseTicks = Math.round(rand(g.gap[0], g.gap[1]));
  }
}

function startAim(h: HunterAgent, g: GunNumbers, dist = 0): void {
  h.phase = 'aim';
  // The first shot at a new target waits out the reaction too; a sniper's wind-up grows with the range.
  h.phaseTicks = g.aimTicks + Math.round(dist * (g.aimPerMeter ?? 0)) + h.reaction;
  h.reaction = 0;
}

/** No target: go for the objective (travel.ts), and hammer it once there. */
function advance(h: HunterAgent, ctx: HuntContext): void {
  const k = KIND[h.kind]!;
  const o = ctx.objective(h);
  if (o.hammer !== 0 && ctx.atObjective(h, o.hammer)) {
    h.phase = 'hammer';
    h.act = HunterAct.Hammer;
    const face = o.hammer === 1 ? ctx.keep.gate : ctx.keep.core;
    faceDuck(h, face, 0.2);
    ctx.hammer(h, o.hammer);
    return;
  }
  h.phase = 'advance';
  // They charge the keep: running while far from it, walking the last stretch.
  const far = Math.hypot(o.spot.x - h.x, o.spot.z - h.z) > 22;
  if (!go(h, ctx, o.spot, far ? k.run : k.walk, o.hammer === 0 ? 1.2 : 0.6) && o.hammer === 0) {
    // Waiting on the bank for the drawbridge: face the keep.
    h.act = HunterAct.Idle;
    faceDuck(h, ctx.keep.core, 0.1);
  }
}

function chaseOrAdvance(h: HunterAgent, ctx: HuntContext, run: boolean): void {
  const k = KIND[h.kind]!;
  if (h.lastSeen && h.lostTicks < 120) {
    // The chase runs out after a while (the last seen point may be out of reach).
    h.lostTicks++;
    if (!go(h, ctx, h.lastSeen, run ? k.run : k.walk, 1.2)) h.lastSeen = null;
    return;
  }
  h.lastSeen = null;
  advance(h, ctx);
}

function thinkGunner(h: HunterAgent, ctx: HuntContext, target: DuckTarget | undefined): void {
  const g = GUN[h.kind]!;
  const k = KIND[h.kind]!;
  if (h.phase === 'aim' || h.phase === 'fire' || h.phase === 'reload') {
    if (target || h.phase === 'reload') {
      gunCycle(h, ctx, (target ?? ctx.ducks[0]) as DuckTarget, g);
      return;
    }
    h.phase = 'move';
  }
  if (h.phase === 'throw') {
    // Trapper: setting a trap.
    h.act = HunterAct.Throw;
    if (--h.phaseTicks > 0) return;
    if (target) {
      const lead = Math.min(4, Math.hypot(target.vx, target.vz) * 0.8);
      const sp = Math.hypot(target.vx, target.vz) || 1;
      ctx.placeTrap(h, target.x + (target.vx / sp) * lead, target.y, target.z + (target.vz / sp) * lead);
    } else ctx.placeTrap(h, h.x - Math.sin(h.yaw) * 2, h.y, h.z - Math.cos(h.yaw) * 2);
    h.trapCd = TRAP.cooldown;
    h.phase = 'kneel';
    h.phaseTicks = 10;
    return;
  }
  if (h.phase === 'whistle') {
    h.act = HunterAct.Whistle;
    if (--h.phaseTicks > 0) return;
    ctx.whistle(h);
    h.whistleCd = ctx.lastWave ? WHISTLE.everyLast : WHISTLE.every;
    h.phase = target ? 'kneel' : 'advance';
    h.phaseTicks = 6;
    return;
  }
  if (h.kind === HunterKind.Boss && h.whistleCd <= 0 && ctx.whistleOpen && ctx.helpers() < WHISTLE.maxHelpers) {
    h.phase = 'whistle';
    h.phaseTicks = WHISTLE.ticks;
    return;
  }
  if (!target) {
    if (h.kind === HunterKind.Trapper && h.trapCd <= 0 && Math.hypot(h.x - ctx.keep.gate.x, h.z - ctx.keep.gate.z) < 16) {
      h.phase = 'throw';
      h.phaseTicks = TRAP.windup;
      return;
    }
    chaseOrAdvance(h, ctx, h.kind === HunterKind.Trapper);
    return;
  }
  const dist = Math.hypot(target.x - h.x, target.z - h.z);
  if (h.kind === HunterKind.Trapper && h.trapCd <= 0 && dist < 13 && h.lostTicks === 0) {
    h.phase = 'throw';
    h.phaseTicks = TRAP.windup;
    faceDuck(h, target, 0.4);
    return;
  }
  if (h.kind === HunterKind.Rifleman && !ctx.push) {
    if (h.phase === 'move') {
      h.cover ??= pickCover(h, ctx, target) ?? { x: h.x, y: h.y, z: h.z };
      if (go(h, ctx, h.cover, k.run, 0.5)) return;
      h.phase = 'kneel';
      h.phaseTicks = Math.round(rand(8, 20));
    }
    // Kneeling between shots (or waiting out the reaction), then up to aim.
    h.act = h.flash > 0 ? HunterAct.Fire : HunterAct.Kneel;
    faceDuck(h, target, 0.2);
    if (--h.phaseTicks > 0) return;
    if (h.lostTicks === 0) startAim(h, g, dist);
    else if (h.lostTicks > 45) {
      h.cover = null;
      h.phase = 'move';
    }
    return;
  }
  // Trapper and boss (and a pushing rifleman): close in, then fire from there.
  const close = h.kind === HunterKind.Rifleman ? 14 : k.close;
  if (dist > close || h.lostTicks > 0) {
    h.phase = 'move';
    go(h, ctx, { x: target.x, y: target.y, z: target.z }, h.kind === HunterKind.Trapper ? k.run : k.walk, close * 0.8);
    if (h.flash > 0) h.act = HunterAct.Fire;
    if (dist <= close * 1.15 && h.lostTicks === 0 && h.phaseTicks <= 0) startAim(h, g, dist);
    else if (h.phaseTicks > 0) h.phaseTicks--;
    return;
  }
  h.act = h.flash > 0 ? HunterAct.Fire : HunterAct.Idle;
  faceDuck(h, target, 0.25);
  if (h.phase !== 'kneel') {
    h.phase = 'kneel';
    h.phaseTicks = Math.min(h.phaseTicks, 6);
  }
  if (--h.phaseTicks <= 0) startAim(h, g, dist);
}

function thinkDecoy(h: HunterAgent, ctx: HuntContext, target: DuckTarget | undefined): void {
  const k = KIND[h.kind]!;
  if (h.phase === 'throw') {
    h.act = HunterAct.Throw;
    if (target) faceDuck(h, target, 0.3);
    if (--h.phaseTicks > 0) return;
    if (target) ctx.throwDecoy(h, target.x + target.vx * 0.5, target.y, target.z + target.vz * 0.5);
    h.throwCd = DECOY.cooldown;
    h.phase = 'kneel';
    h.phaseTicks = 12;
    return;
  }
  if (!target) {
    chaseOrAdvance(h, ctx, false);
    return;
  }
  const dist = Math.hypot(target.x - h.x, target.z - h.z);
  if (dist > k.close || h.lostTicks > 0) go(h, ctx, { x: target.x, y: target.y, z: target.z }, k.walk, k.close * 0.8);
  else {
    h.act = HunterAct.Idle;
    faceDuck(h, target, 0.25);
  }
  if (h.throwCd <= 0 && h.lostTicks === 0 && dist <= k.engage) {
    h.phase = 'throw';
    h.phaseTicks = DECOY.windup + h.reaction;
    h.reaction = 0;
  }
}

function thinkDog(h: HunterAgent, ctx: HuntContext, target: DuckTarget | undefined): void {
  const k = KIND[h.kind]!;
  if (h.phase === 'tell') {
    h.act = HunterAct.Bite;
    if (target) faceDuck(h, target, 0.5);
    if (--h.phaseTicks > 0) return;
    if (target && seesNow(h, ctx, target.id) && Math.hypot(target.x - h.x, target.z - h.z) < BITE.reach && Math.abs(target.y - h.y) < 1.4) ctx.bite(h, target);
    h.phase = 'kneel';
    h.phaseTicks = BITE.cooldown;
    return;
  }
  if (h.phase === 'kneel' && h.phaseTicks > 0) h.phaseTicks--;
  if (!target) {
    chaseOrAdvance(h, ctx, true);
    return;
  }
  const dist = Math.hypot(target.x - h.x, target.z - h.z);
  if (dist > k.close) go(h, ctx, { x: target.x, y: target.y, z: target.z }, k.run, k.close);
  else {
    h.act = HunterAct.Idle;
    faceDuck(h, target, 0.5);
  }
  if (dist < k.close + 0.3 && h.phaseTicks <= 0 && h.reaction <= 0) {
    h.phase = 'tell';
    h.phaseTicks = BITE.tell;
  } else if (h.reaction > 0) h.reaction -= 1;
}

/**
 * A minion (Beater, Recruit): charges the duck it knows of, and swings once
 * in reach after a short, readable wind-up (the tell: the club goes up); the
 * hit needs the duck still in reach and in sight when the club lands. No duck
 * in mind: it runs for its pack's rally point (the objective's ground).
 */
function thinkMinion(h: HunterAgent, ctx: HuntContext, target: DuckTarget | undefined): void {
  const k = KIND[h.kind]!;
  if (h.phase === 'tell') {
    h.act = HunterAct.Swing;
    if (target) faceDuck(h, target, 0.35);
    if (--h.phaseTicks > 0) return;
    if (target && seesNow(h, ctx, target.id) && Math.hypot(target.x - h.x, target.z - h.z) < SWING.reach && Math.abs(target.y - h.y) < 1.4) ctx.swing(h, target);
    h.phase = 'kneel';
    h.phaseTicks = SWING.cooldown;
    return;
  }
  if (h.phase === 'kneel' && h.phaseTicks > 0) h.phaseTicks--;
  if (!target) {
    chaseOrAdvance(h, ctx, true);
    if (h.act === HunterAct.Run) h.act = HunterAct.Charge;
    return;
  }
  const dist = Math.hypot(target.x - h.x, target.z - h.z);
  if (dist > k.close) {
    go(h, ctx, { x: target.x, y: target.y, z: target.z }, k.run, k.close);
    if (h.act === HunterAct.Run) h.act = HunterAct.Charge;
  } else {
    h.act = HunterAct.Idle;
    faceDuck(h, target, 0.4);
  }
  if (h.reaction > 0) h.reaction -= 2;
  if (dist < k.close + 0.6 && h.phaseTicks <= 0 && h.reaction <= 0 && ctx.attackers(target.id) < SWING.maxAttackers) {
    h.phase = 'tell';
    h.phaseTicks = SWING.tell;
  }
}

/** Does this hunter see this duck (the real one, where it is now) at this moment? */
function seesNow(h: HunterAgent, ctx: HuntContext, id: string): boolean {
  if (h.lostTicks !== 0) return false;
  const real = ctx.ducks.find((d) => d.id === id && d.standing);
  return !!real && sees(ctx.sim, h, KIND[h.kind]!, real);
}

/**
 * The duck as this hunter knows it: where it is while in sight, its last seen
 * point (standing still) once it is out of sight. A hunter never tracks a
 * hidden duck's live position.
 */
export function knownTarget(h: HunterAgent, ctx: HuntContext): DuckTarget | undefined {
  const live = h.targetId ? ctx.ducks.find((d) => d.id === h.targetId && d.standing) : undefined;
  if (!live || h.lostTicks === 0 || !h.lastSeen) return live;
  return { ...live, x: h.lastSeen.x, y: h.lastSeen.y, z: h.lastSeen.z, vx: 0, vz: 0 };
}

/**
 * A sniper: to a free perch, then long shots from there (the laser and glint
 * wind up longer the farther the duck). Without a perch, or once the wave is
 * down to its last few, it fights like a rifleman pushing in.
 */
function thinkSniper(h: HunterAgent, ctx: HuntContext, target: DuckTarget | undefined): void {
  const perch = ctx.push && !h.perchFixed ? null : ctx.perch(h);
  if (!perch) {
    thinkGunner(h, ctx, target);
    return;
  }
  const g = GUN[h.kind]!;
  const k = KIND[h.kind]!;
  if (h.phase === 'aim' || h.phase === 'fire' || h.phase === 'reload') {
    if (target || h.phase === 'reload') {
      gunCycle(h, ctx, (target ?? ctx.ducks[0]) as DuckTarget, g);
      return;
    }
    h.phase = 'kneel';
    h.phaseTicks = 10;
  }
  // At the perch: on it, or as close as the walk gets (the platform's middle may be off the navmesh).
  const off = Math.hypot(perch.x - h.x, perch.z - h.z);
  if (off > 1.4 && !(off < 4 && Math.abs(perch.y - h.y) < 1.5 && h.phase !== 'move')) {
    h.phase = 'move';
    if (!go(h, ctx, perch, k.run, 0.8) && off < 4 && Math.abs(perch.y - h.y) < 1.5) h.phase = 'kneel';
    return;
  }
  h.act = h.flash > 0 ? HunterAct.Fire : HunterAct.Kneel;
  if (!target) {
    faceDuck(h, ctx.keep.core, 0.08);
    return;
  }
  faceDuck(h, target, 0.15);
  if (h.phase !== 'kneel') {
    h.phase = 'kneel';
    h.phaseTicks = Math.round(rand(10, 25));
  }
  if (--h.phaseTicks > 0) return;
  if (h.lostTicks === 0) startAim(h, g, Math.hypot(target.x - h.x, target.z - h.z));
}

/** One tick of one hunter. */
export function thinkHunter(h: HunterAgent, ctx: HuntContext): void {
  if (h.trapCd > 0) h.trapCd--;
  if (h.throwCd > 0) h.throwCd--;
  if (h.whistleCd > 0) h.whistleCd--;
  if (h.flash > 0) h.flash--;
  // On a raft: paddling, nothing else. Dunked in the moat: climbing out.
  if (h.raft) {
    stepRaft(ctx.sim, h, ctx.rules.raftSpeed);
    return;
  }
  if (h.swim > 0) {
    h.swim--;
    h.act = HunterAct.Swim;
    return;
  }
  stepKnock(h, ctx);
  // Reeling from a cut, or knocked off its feet: no thinking until it recovers.
  if (h.stun > 0) {
    h.stun--;
    h.act = h.stunAct;
    if (h.phase === 'aim' || h.phase === 'fire' || h.phase === 'tell' || h.phase === 'throw') {
      h.phase = 'kneel';
      h.phaseTicks = 4;
    }
    return;
  }
  if ((ctx.tick + h.serial) % 3 === 0) perceive(h, ctx);
  const target = knownTarget(h, ctx);
  if (isMinion(h.kind)) thinkMinion(h, ctx, target);
  else if (h.kind === HunterKind.Dog) thinkDog(h, ctx, target);
  else if (h.kind === HunterKind.Decoy) thinkDecoy(h, ctx, target);
  else if (h.kind === HunterKind.Sniper) thinkSniper(h, ctx, target);
  else thinkGunner(h, ctx, target);
  if (h.act !== HunterAct.Aim && h.act !== HunterAct.Fire) h.pitch *= 0.85;
}

/** A hit turns an idle hunter toward where the shot came from, roughly (like a damage indicator). */
export function hunterHurtFrom(h: HunterAgent, x: number, z: number): void {
  if (h.targetId) return;
  const yaw = Math.atan2(-(x - h.x), -(z - h.z)) + rand(-0.3, 0.3);
  h.yaw = wrap(yaw);
}


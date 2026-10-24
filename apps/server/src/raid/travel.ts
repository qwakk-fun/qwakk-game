/**
 * How a hunter gets anywhere on Pond Keep: the navmesh does not know the
 * keep's moving parts, so the route rules live here. Server only.
 *
 *   - Inside the walls only through the gate, and only once it is broken;
 *     a hunter that wants a duck on the walls or in the courtyard goes for
 *     the gate (or the core once inside) instead.
 *   - Across the moat over the drawbridge while it is down. While it is up
 *     (or moving) the gateway is barred and hunters bound for the island
 *     paddle across on a raft lane: slow, in the open, no shooting.
 *   - A bread loaf's knockback shoves a hunter (walls, ground and the
 *     barriers still hold), and the Big Hunter dunked in the moat climbs out
 *     after a while.
 */
import { DT, groundHeightAt, HunterAct, inKeep, onIsland, type KeepGeometry, type SimWorld } from '@qwakk/shared';
import type { BotNav, P3 } from '../nav/botNav.ts';
import type { HunterAgent } from './hunter.ts';
import type { Barrier } from './hunterMover.ts';

/** What a hunter is after when no duck holds its attention. */
export interface Objective {
  spot: P3;
  /** 0: wait there, 1: hammer the gate, 2: hammer the core. */
  hammer: 0 | 1 | 2;
}

export interface TravelContext {
  sim: SimWorld;
  tick: number;
  nav: BotNav | null;
  keep: KeepGeometry;
  bridgeDown: boolean;
  gateOpen: boolean;
  lanes: readonly { from: P3; to: P3; water: number }[];
  avoid: readonly { x: number; z: number }[];
  raftSpeed: number;
  barrier: Barrier;
  objective(h: HunterAgent): Objective;
}

/** Where the hunter can really head for `want`: the point, or its objective when walls it cannot pass are in between. */
export function reachableGoal(h: HunterAgent, ctx: TravelContext, want: P3): P3 {
  const g = ctx.keep;
  const meIn = inKeep(g, h.x, h.z);
  const wantIn = inKeep(g, want.x, want.z);
  if (meIn === wantIn) return want;
  // In or out through the gateway only: the gate broken and the bridge down (a raised bridge covers the gateway).
  if (!ctx.gateOpen || !ctx.bridgeDown) return ctx.objective(h).spot;
  return want;
}

/**
 * One tick toward `want` at `speed`: the route rules, then the mover.
 * Returns true while still on the way (false once there, or stuck waiting).
 */
export function travel(h: HunterAgent, ctx: TravelContext, want: P3, speed: number, arrive: number): boolean {
  let goal = reachableGoal(h, ctx, want);
  if (!ctx.bridgeDown) {
    const g = ctx.keep;
    const meOn = onIsland(g, h.x, h.z);
    const goalOn = onIsland(g, goal.x, goal.z);
    if (!meOn && goalOn) {
      const lane = nearestLane(h, ctx, goal);
      if (lane) {
        if (Math.hypot(lane.from.x - h.x, lane.from.z - h.z) < 1.8) {
          startRaft(h, lane);
          return true;
        }
        goal = lane.from;
      } else goal = { x: g.bridge.x + g.bridge.dx * (g.bridge.len + 3), y: h.y, z: g.bridge.z + g.bridge.dz * (g.bridge.len + 3) };
    } else if (meOn && !goalOn) goal = ctx.objective(h).spot;
  }
  // A goal the last plan found behind a barrier: the objective instead, until it is worth another try.
  const bar = h.barred;
  if (bar && ctx.tick < bar.until && Math.hypot(goal.x - bar.x, goal.z - bar.z) < 3) goal = ctx.objective(h).spot;
  h.mover.setGoal(goal);
  const on = h.mover.step(ctx.sim, ctx.nav, h, speed, DT, arrive, ctx.avoid, undefined, ctx.barrier);
  if (!h.mover.barred) return on;
  h.barred = { x: goal.x, z: goal.z, until: ctx.tick + 90 };
  const o = ctx.objective(h).spot;
  if (Math.hypot(o.x - goal.x, o.z - goal.z) < 1) return false;
  h.mover.setGoal(o);
  return h.mover.step(ctx.sim, ctx.nav, h, speed, DT, arrive, ctx.avoid, undefined, ctx.barrier);
}

function nearestLane(h: HunterAgent, ctx: TravelContext, goal: P3): TravelContext['lanes'][number] | null {
  let best: TravelContext['lanes'][number] | null = null;
  let bestD = Infinity;
  for (const l of ctx.lanes) {
    const d = Math.hypot(l.from.x - h.x, l.from.z - h.z) + Math.hypot(l.to.x - goal.x, l.to.z - goal.z);
    if (d < bestD) {
      best = l;
      bestD = d;
    }
  }
  return best;
}

function startRaft(h: HunterAgent, lane: TravelContext['lanes'][number]): void {
  const len = Math.max(0.5, Math.hypot(lane.to.x - lane.from.x, lane.to.z - lane.from.z));
  h.raft = { from: { ...lane.from }, to: { ...lane.to }, water: lane.water, len, t: 0 };
  h.yaw = Math.atan2(-(lane.to.x - lane.from.x), -(lane.to.z - lane.from.z));
  h.mover.reset();
}

/**
 * One tick on a raft lane: slowly along it, standing on whatever floats there
 * (Pond Keep's lashed raft decks; on a lane without a deck, on the water),
 * down from the bank and up again over the first and last meters.
 */
export function stepRaft(sim: SimWorld, h: HunterAgent, speed: number): void {
  const r = h.raft;
  if (!r) return;
  r.t = Math.min(r.len, r.t + speed * DT);
  const k = r.t / r.len;
  h.x = r.from.x + (r.to.x - r.from.x) * k;
  h.z = r.from.z + (r.to.z - r.from.z) * k;
  const deck = groundHeightAt(sim, h.x, r.water + 2, h.z);
  const ride = Math.max(r.water, deck);
  const edge = Math.min(1.5, r.len / 3);
  h.y = r.t < edge ? r.from.y + (ride - r.from.y) * (r.t / edge) : r.len - r.t < edge ? r.to.y + (ride - r.to.y) * ((r.len - r.t) / edge) : ride;
  h.act = HunterAct.Raft;
  if (r.t >= r.len) {
    h.y = r.to.y;
    h.raft = null;
    h.mover.reset();
  }
}

/** A loaf's shove, fading out (walls, ground and barriers hold it like a step). */
export function stepKnock(h: HunterAgent, ctx: TravelContext): void {
  if (Math.abs(h.kx) + Math.abs(h.kz) < 0.15) {
    h.kx = 0;
    h.kz = 0;
    return;
  }
  h.mover.push(ctx.sim, h, h.kx * DT, h.kz * DT, ctx.barrier);
  h.kx *= 0.86;
  h.kz *= 0.86;
}

/**
 * Barriers for the hunters' mover from the keep's state: the closed gate's
 * line, the gateway of a bridge that is not down, and deep water (the moat
 * is crossed on the bridge or on a raft, never on foot).
 */
export function keepBarrier(g: KeepGeometry, state: { bridgeDown: boolean; gateOpen: boolean }, inGateway: (x: number, z: number) => boolean, deep: (x: number, y: number, z: number) => boolean): Barrier {
  const gt = g.gate;
  return (x0, z0, x1, z1, y1) => {
    if (deep(x1, y1, z1)) return true;
    if (!state.bridgeDown && inGateway(x1, z1) && !inGateway(x0, z0)) return true;
    if (state.gateOpen) return false;
    const a0 = (x0 - gt.x) * gt.nx + (z0 - gt.z) * gt.nz;
    const a1 = (x1 - gt.x) * gt.nx + (z1 - gt.z) * gt.nz;
    if (a0 >= 0 === a1 >= 0) return false;
    const t = a0 / (a0 - a1);
    const l0 = (x0 - gt.x) * gt.tx + (z0 - gt.z) * gt.tz;
    const l1 = (x1 - gt.x) * gt.tx + (z1 - gt.z) * gt.tz;
    return Math.abs(l0 + (l1 - l0) * t) <= gt.halfW + 0.4;
  };
}

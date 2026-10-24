/**
 * The hunters' side of a run: the wave director (spawns from the shared wave
 * math at the keep's trench exits), every hunter's tick (brain.ts, with the
 * keep's route rules in travel.ts), their health and defeat (shot, splashed
 * into the moat by the drawbridge, or burst by a bread loaf), the trapper's
 * traps, the decoys in flight and the drops they leave. Network free; the
 * raid (raid.ts) owns the ducks and the keep and tells the room what
 * happened through the host. Server only.
 */
import {
  blastFalloff,
  blastReach,
  DT,
  emptyFlight,
  ExplosiveKind,
  groundHeightAt,
  HUNTER_HP,
  HunterAct,
  HunterKind,
  hunterHpScale,
  hunterShape,
  inGateway,
  isMinion,
  inKeep,
  MOVE_QUERY_GROUPS,
  RAID,
  stepGrenade,
  TRAP_SHAPE,
  TICK_RATE,
  waterSurfaceAt,
  type Flight,
  type HitTarget,
  type KeepGeometry,
  type SimWorld,
} from '@qwakk/shared';
import { RaidDrop, RaidKillHow } from '@qwakk/shared/net';
import type { BotNav, P3 } from '../nav/botNav.ts';
import { thinkHunter, hunterHurtFrom, type HuntContext } from './brain.ts';
import { fireHunterGun, type ShotTrace } from './gun.ts';
import { BITE, DECOY, KIND, newHunter, TRAP, WHISTLE, type GunNumbers, type HunterAgent } from './hunter.ts';
import { HunterHistory } from './hunterHistory.ts';
import type { RaidRules } from './rules.ts';
import type { DuckTarget } from './sight.ts';
import { atCore, atGate, gateSpot, holdSpot, raftLanes, trenchPoints } from './spawns.ts';
import { keepBarrier, type Objective } from './travel.ts';
import type { Barrier } from './hunterMover.ts';

export interface TrapState {
  id: string;
  x: number;
  y: number;
  z: number;
  /** 0 setting, 1 armed, 2 sprung (holds a duck, then breaks). */
  state: number;
  armAt: number;
  until: number;
  hp: number;
  owner: string;
}

export interface DecoyState {
  id: number;
  flight: Flight;
  fuse: number;
}

export interface DropState {
  id: string;
  kind: number;
  x: number;
  y: number;
  z: number;
  until: number;
}

/** What the hunts need from the raid. */
export interface HuntHost {
  readonly sim: SimWorld;
  nav(): BotNav | null;
  readonly rules: RaidRules;
  /** Every duck in the world (alive or not; `standing` says who can be hunted). */
  ducks(): readonly DuckTarget[];
  hurtDuck(duckId: string, amount: number, fromX: number, fromZ: number, kind: number, head: boolean): void;
  rootDuck(duckId: string): void;
  /** The keep now: the drawbridge down (walkable), the gate broken (hunters pass). */
  bridgeDown(): boolean;
  gateOpen(): boolean;
  damageGate(amount: number, h: HunterAgent): void;
  damageCore(amount: number, h: HunterAgent): void;
  shotFx(h: HunterAgent, traces: readonly ShotTrace[], weapon: number): void;
  /** `how`: RaidKillHow (shot, splashed into the moat, a bread loaf). */
  hunterDown(h: HunterAgent, killerId: string | null, head: boolean, how: number): void;
  whistle(h: HunterAgent): void;
  /** A minion's swing hit a duck (its kind's damage, the rules' scale). */
  swingHit(h: HunterAgent, duckId: string): void;
  decoyLaunched(d: DecoyState): void;
  decoyBoom(d: DecoyState, x: number, y: number, z: number): void;
}

/** A hunter stuck this long without moving or fighting regroups at a trench exit (checkStuck). */
const GIVE_UP_TICKS = 20 * TICK_RATE;

export class HuntWorld {
  readonly hunters = new Map<string, HunterAgent>();
  readonly traps = new Map<string, TrapState>();
  readonly decoys = new Map<number, DecoyState>();
  readonly drops = new Map<string, DropState>();
  readonly history = new HunterHistory();
  /** Hunters a boss whistled up (still standing ones count against its next whistle). */
  private readonly helperIds = new Set<string>();
  private serial = 0;
  /** The objective in play (1-based) and the ducks in the run: how tough new hunters are. */
  private goal = 1;
  private ducksInRun = 1;
  private tick = 0;
  /** Where packs head for while no duck holds their attention (the objective's ground; the push director sets it). */
  rally: P3 | null = null;
  /** From this tick on, ducks hiding in the castle bring the hunters to its gate (slow ducks get raided; the push director sets it). */
  castleRaidFrom = 0;
  private readonly host: HuntHost;
  readonly keep: KeepGeometry;
  private readonly spawns: P3[];
  private readonly lanes: { from: P3; to: P3; water: number }[];
  private readonly trench: P3[];
  /** Sniper perches and who holds each (hunter id). */
  private readonly perches: P3[];
  private readonly perchedBy: (string | null)[];
  private readonly barrier: Barrier;
  private readonly keepState = { bridgeDown: true, gateOpen: false };
  /** A point well inside the walkable map (in front of the gate): where scrambling hunters must still be able to walk to. */
  private readonly anchor: P3;

  constructor(host: HuntHost, keep: KeepGeometry, spawns: P3[]) {
    this.host = host;
    this.keep = keep;
    this.spawns = spawns;
    this.lanes = raftLanes(host.sim, keep);
    this.trench = trenchPoints(host.sim, keep);
    this.perches = keep.mark.sniperPerches.map(([x, y, z]) => ({ x, y: groundHeightAt(host.sim, x, y + 2, z), z }));
    this.perchedBy = this.perches.map(() => null);
    const gt = keep.gate;
    this.anchor = { x: gt.x + gt.nx * 1.5, y: gt.y, z: gt.z + gt.nz * 1.5 };
    const water = host.sim.map.water;
    this.barrier = keepBarrier(keep, this.keepState, (x, z) => inGateway(keep, x, z, 0.4), (x, y, z) => !!water && y < waterSurfaceAt(water, x, z) - 0.6);
  }

  get alive(): number {
    let n = 0;
    for (const h of this.hunters.values()) if (h.downTicks === 0) n++;
    return n;
  }

  get boss(): HunterAgent | null {
    for (const h of this.hunters.values()) if (h.kind === HunterKind.Boss && h.downTicks === 0) return h;
    return null;
  }

  /** The server tick now (set at the start of every tick, so hunters spawned between steps know when they were born). */
  setTick(tick: number): void {
    this.tick = tick;
  }

  /** Most hunters alive at once for this run: `raid.maxLive` for four ducks, fewer for fewer (solo about half). */
  get liveCap(): number {
    return Math.max(6, Math.round(this.host.rules.maxLive * (0.55 + 0.15 * (Math.min(RAID.maxDucks, this.ducksInRun) - 1))));
  }

  /** A new objective: how tough the hunters it sends are. */
  setStage(goal: number, ducks: number): void {
    this.goal = Math.max(1, goal);
    this.ducksInRun = Math.max(1, ducks);
    this.helperIds.clear();
  }

  /** Spawn points (trench exits, dugout doors) within `range` of a spot and away from standing ducks, nearest first. */
  spawnsNear(x: number, z: number, range: number, minFromDucks = 25): P3[] {
    const ducks = this.host.ducks().filter((d) => d.standing);
    return this.spawns
      .filter((p) => Math.hypot(p.x - x, p.z - z) <= range && ducks.every((d) => Math.hypot(d.x - p.x, d.z - p.z) > minFromDucks))
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
  }

  /**
   * A pack: `count` hunters of `kind` around a spot (a loose blob), heading
   * for `rally`. Returns them. Never past `raid.maxLive` alive.
   */
  spawnGroup(kind: number, count: number, at: P3, rally: P3 | null, spread = 1.3, force = false): HunterAgent[] {
    const out: HunterAgent[] = [];
    const room = force ? count : Math.max(0, this.liveCap - this.alive);
    const n = Math.min(count, room);
    const baseHp = HUNTER_HP[kind] ?? 90;
    const hp = Math.round(baseHp * hunterHpScale(this.goal, this.ducksInRun, kind) * this.host.rules.hunterHpScale);
    const sim = this.host.sim;
    for (let i = 0; i < n; i++) {
      const id = `h${++this.serial}`;
      // A sunflower: packs come out as a crowd, not a line.
      const a = i * 2.39996;
      const r = n > 1 ? spread * Math.sqrt(i + 0.5) : 0;
      let x = at.x + Math.cos(a) * r;
      let z = at.z + Math.sin(a) * r;
      const nav = this.host.nav();
      const p = nav?.closest({ x, y: at.y, z }, { x: 2, y: 3, z: 2 });
      if (p && Math.hypot(p.x - x, p.z - z) < 2.5) {
        x = p.x;
        z = p.z;
      }
      const y = groundHeightAt(sim, x, at.y + 2, z);
      const yaw = rally ? Math.atan2(x - rally.x, z - rally.z) : Math.atan2(x - this.keep.core.x, z - this.keep.core.z);
      const h = newHunter(id, this.serial, kind, x, y, z, yaw, hp, this.tick);
      h.rally = rally;
      this.hunters.set(id, h);
      out.push(h);
    }
    return out;
  }

  /** Everything gone (the run ended or a test reset). */
  clear(): void {
    this.hunters.clear();
    this.traps.clear();
    this.decoys.clear();
    this.drops.clear();
    this.history.clear();
    this.helperIds.clear();
  }

  /** Tests and the e2e (test hooks): beat every hunter standing now. */
  defeatAll(killerId: string | null): void {
    for (const h of this.hunters.values()) if (h.downTicks === 0) this.defeat(h, killerId, false);
  }

  /** An objective was taken: the hunters still standing flee the field (gone without a kill or a drop). */
  scatter(): number {
    let n = 0;
    for (const h of [...this.hunters.values()]) {
      if (h.downTicks > 0) continue;
      this.hunters.delete(h.id);
      n++;
    }
    for (const t of [...this.traps.values()]) this.traps.delete(t.id);
    this.decoys.clear();
    return n;
  }

  /** The Big Hunter's whistled helpers: next to the spawn point nearest to him. They give no kill XP and drop nothing. */
  private spawnHelpers(kind: number, count: number, near: P3): void {
    for (const h of this.spawnGroup(kind, count, near, this.rally)) {
      this.helperIds.add(h.id);
      h.helper = true;
    }
  }

  private helpers(): number {
    let n = 0;
    for (const id of this.helperIds) {
      const h = this.hunters.get(id);
      if (h && h.downTicks === 0) n++;
      else this.helperIds.delete(id);
    }
    return n;
  }

  /** One tick: spawns, every hunter, traps, decoys, drops, the lag history. */
  step(tick: number, nowMs: number, live: boolean): void {
    this.tick = tick;
    this.keepState.bridgeDown = this.host.bridgeDown();
    this.keepState.gateOpen = this.host.gateOpen();
    for (let i = 0; i < this.perchedBy.length; i++) {
      const id = this.perchedBy[i];
      if (id && !(this.hunters.get(id)?.downTicks === 0)) this.perchedBy[i] = null;
    }
    const ducks = this.host.ducks();
    const avoid: { x: number; z: number }[] = [];
    for (const h of this.hunters.values()) if (h.downTicks === 0) avoid.push(h);
    for (const d of ducks) if (d.standing) avoid.push(d);
    const ctx = this.context(tick, ducks, avoid);
    for (const h of [...this.hunters.values()]) {
      if (h.downTicks > 0) {
        if (--h.downTicks === 0) this.hunters.delete(h.id);
        continue;
      }
      if (!live) {
        h.act = HunterAct.Idle;
        continue;
      }
      if (h.mover.anchor === null) h.mover.anchor = this.anchor;
      // Bleeding (the bleed card): a little damage every half second, credited to the duck that cut it.
      if (h.bleedTicks > 0) {
        h.bleedTicks--;
        if (h.bleedTicks % 15 === 0 && this.hurt(h.id, h.bleedDps / 2, h.bleedBy, false, h.x, h.z, RaidKillHow.Skill)) continue;
      }
      thinkHunter(h, ctx);
      this.checkStuck(h, tick, ctx.push);
    }
    this.stepTraps(tick, ducks);
    this.stepDecoys(ducks);
    this.history.record(nowMs, [...this.hunters.values()].map((h) => ({ id: h.id, x: h.x, y: h.y, z: h.z, yaw: h.yaw, kind: h.kind, act: h.act, alive: h.downTicks === 0 })));
  }

  /**
   * What a hunter is after with no duck in mind (travel.ts rules). The push:
   * its pack's rally point on the objective's ground. The castle is the
   * ducks' fallback: while ducks hide inside, hunters outside go for the gate
   * (hammering it while the drawbridge is down), or wait on the bank while it
   * is up; inside, they go for the ducks' ground.
   */
  objective(h: HunterAgent): Objective {
    const g = this.keep;
    const nav = this.host.nav();
    const meIn = inKeep(g, h.x, h.z);
    let hiding = false;
    if (this.tick >= this.castleRaidFrom) for (const d of this.host.ducks()) if (d.standing && inKeep(g, d.x, d.z)) hiding = true;
    if (hiding && !meIn) {
      if (!this.keepState.bridgeDown) return { spot: holdSpot(g, h.x, h.z, h.serial, nav), hammer: 0 };
      if (!this.keepState.gateOpen) return { spot: gateSpot(g, h.serial), hammer: 1 };
      return { spot: { x: g.core.x, y: g.core.y, z: g.core.z }, hammer: 0 };
    }
    const r = h.rally ?? this.rally;
    if (r && !meIn) return { spot: r, hammer: 0 };
    return { spot: { x: g.core.x, y: g.core.y, z: g.core.z }, hammer: 0 };
  }

  private context(tick: number, ducks: readonly DuckTarget[], avoid: { x: number; z: number }[]): HuntContext {
    const host = this.host;
    const nav = host.nav();
    const g = this.keep;
    return {
      sim: host.sim,
      nav,
      keep: g,
      bridgeDown: this.keepState.bridgeDown,
      gateOpen: this.keepState.gateOpen,
      lanes: this.lanes,
      raftSpeed: host.rules.raftSpeed,
      barrier: this.barrier,
      trench: this.trench,
      tick,
      rules: host.rules,
      ducks,
      avoid,
      lastWave: this.goal >= RAID.objectives,
      // v3: hunters come at the ducks (no cover, no sniping from afar), except snipers the director placed on a perch.
      push: true,
      objective: (h) => this.objective(h),
      atObjective: (h, what) => (what === 1 ? atGate(g, h.x, h.y, h.z) : atCore(g, h.x, h.y, h.z, RAID.coreReach)),
      perch: (h) => this.perchOf(h),
      fire: (h, gun, yaw, pitch) => this.fire(h, gun, yaw, pitch, ducks),
      bite: (h, d) => host.hurtDuck(d.id, BITE.damage * host.rules.hunterDamageScale, h.x, h.z, h.kind, false),
      placeTrap: (h, x, y, z) => this.placeTrap(h, x, y, z, tick),
      throwDecoy: (h, x, y, z) => this.throwDecoy(h, x, y, z),
      whistle: (h) => {
        host.whistle(h);
        const near = this.spawns.slice().sort((a, b) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z))[0];
        // The same cap as the wave's own spawns: never more than raid.maxLive alive.
        const max = this.liveCap;
        if (!near) return;
        if (this.alive + 3 <= max) this.spawnHelpers(HunterKind.Dog, 3, near);
        if (this.alive + 4 <= max) this.spawnHelpers(HunterKind.Beater, 4, near);
      },
      whistleOpen: this.helperIds.size < 24,
      swing: (h, d) => host.swingHit(h, d.id),
      attackers: (id) => {
        let n = 0;
        for (const o of this.hunters.values()) if (o.phase === 'tell' && o.targetId === id && o.downTicks === 0 && isMinion(o.kind)) n++;
        return n;
      },
      hammer: (h, what) => {
        h.hammerTicks++;
        if (what === 1) host.damageGate(((RAID.gateDps[h.kind] ?? 4) * host.rules.gateDamageScale) / TICK_RATE, h);
        else host.damageCore(((RAID.coreDps[h.kind] ?? 4) * host.rules.coreDamageScale) / TICK_RATE, h);
      },
      helpers: () => this.helpers(),
    };
  }

  /**
   * A safety net: while the wave pushes in, a hunter that has neither moved
   * 2 m nor fought nor hammered for 20 s (wedged in a pocket of the map)
   * regroups: it goes back to a trench exit (its health kept) and comes
   * again. It is never defeated by this, so it never clears a wave, gives XP
   * or drops anything. Waiting for the drawbridge (the bridge not down) and
   * riding a raft count as busy.
   */
  private checkStuck(h: HunterAgent, tick: number, push: boolean): void {
    if (h.downTicks > 0) return;
    const busy = h.stun > 0 || h.targetId !== null || h.act === HunterAct.Hammer || h.act === HunterAct.Aim || h.act === HunterAct.Fire || h.raft !== null || h.swim > 0 || !this.keepState.bridgeDown;
    if (busy || Math.hypot(h.x - h.checkX, h.z - h.checkZ) > 2) {
      h.checkX = h.x;
      h.checkZ = h.z;
      h.busyTick = tick;
      return;
    }
    if (!push || tick - h.busyTick < GIVE_UP_TICKS) return;
    this.regroup(h, tick);
  }

  /** Back to the trench exit nearest to it (away from standing ducks), to come again. */
  private regroup(h: HunterAgent, tick: number): void {
    this.regrouped++;
    const ducks = this.host.ducks().filter((d) => d.standing);
    const pts = this.spawns.filter((p) => ducks.every((d) => Math.hypot(d.x - p.x, d.z - p.z) > 25));
    const list = pts.length > 0 ? pts : this.spawns;
    let at = list[0];
    for (const p of list) if (at && Math.hypot(p.x - h.x, p.z - h.z) < Math.hypot(at.x - h.x, at.z - h.z)) at = p;
    if (!at) return;
    h.x = at.x;
    h.y = groundHeightAt(this.host.sim, at.x, at.y + 2, at.z);
    h.z = at.z;
    h.targetId = null;
    h.lastSeen = null;
    h.cover = null;
    h.barred = null;
    if (h.perch >= 0 && this.perchedBy[h.perch] === h.id) this.perchedBy[h.perch] = null;
    h.perch = -1;
    h.phase = 'advance';
    h.kx = 0;
    h.kz = 0;
    h.mover.reset();
    h.checkX = h.x;
    h.checkZ = h.z;
    h.busyTick = tick;
  }

  /** Hunters that regrouped after being stuck somewhere (stats, tests). */
  regrouped = 0;

  /** A sniper's perch: the one it holds, else the free one nearest to it (null when none is free). */
  private perchOf(h: HunterAgent): P3 | null {
    if (h.perch >= 0) return this.perches[h.perch] ?? null;
    if (h.perch === -2) return null;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.perches.length; i++) {
      if (this.perchedBy[i]) continue;
      const p = this.perches[i]!;
      const d = Math.hypot(p.x - h.x, p.z - h.z);
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    }
    h.perch = best >= 0 ? best : -2;
    if (best < 0) return null;
    this.perchedBy[best] = h.id;
    return this.perches[best]!;
  }

  private fire(h: HunterAgent, g: GunNumbers, yaw: number, pitch: number, ducks: readonly DuckTarget[]): void {
    const r = fireHunterGun(this.host.sim, h, g, yaw, pitch, this.host.rules.spread, this.host.rules.hunterDamageScale, ducks);
    // One weapon code per sound: the rifle crack (0) for riflemen, the pistol slot (1) stands for a shotgun boom.
    this.host.shotFx(h, r.traces, h.kind === HunterKind.Rifleman ? 0 : 1);
    const sum = new Map<string, { dmg: number; head: boolean }>();
    for (const p of r.hits) {
      const e = sum.get(p.duck.id) ?? { dmg: 0, head: false };
      e.dmg += p.damage;
      e.head ||= p.head;
      sum.set(p.duck.id, e);
    }
    for (const [id, e] of sum) this.host.hurtDuck(id, e.dmg, h.x, h.z, h.kind, e.head);
  }

  // ---- damage to hunters ----------------------------------------------------

  /** A duck's shot, blast or loaf hurt a hunter. Returns true when it was defeated. */
  hurt(id: string, amount: number, byId: string | null, head: boolean, fromX: number, fromZ: number, how: number = RaidKillHow.Shot): boolean {
    const h = this.hunters.get(id);
    if (!h || h.downTicks > 0 || amount <= 0) return false;
    h.hp -= amount;
    if (byId) {
      h.hurtBy.add(byId);
      h.lastHitBy = byId;
    }
    hunterHurtFrom(h, fromX, fromZ);
    if (h.hp > 0) return false;
    this.defeat(h, byId, head, how);
    return true;
  }

  private defeat(h: HunterAgent, killerId: string | null, head: boolean, how: number = RaidKillHow.Shot): void {
    h.hp = 0;
    h.act = HunterAct.Down;
    h.raft = null;
    h.downTicks = Math.round(1.6 * TICK_RATE);
    this.host.hunterDown(h, killerId, head, how);
    // A splashed hunter's drop would sink in the moat.
    if (how !== RaidKillHow.Splash) this.maybeDrop(h);
  }

  /**
   * The drawbridge starts to rise: every hunter in the gateway or on the
   * deck goes into the moat (out of the fight, a toony splash, credited to
   * the duck at the lever); the Big Hunter is dunked instead and climbs out
   * on the far bank. Traps there go too. Returns how many went in.
   */
  splashGateway(byId: string | null): number {
    const g = this.keep;
    let n = 0;
    for (const h of [...this.hunters.values()]) {
      if (h.downTicks > 0 || h.raft || !inGateway(g, h.x, h.z, 0.6) || Math.abs(h.y - g.bridge.y) > 2.5) continue;
      n++;
      if (h.kind === HunterKind.Boss) {
        const b = g.bridge;
        h.x = b.x + b.dx * (b.len + 2.5);
        h.z = b.z + b.dz * (b.len + 2.5);
        h.y = groundHeightAt(this.host.sim, h.x, b.y + 4, h.z);
        h.swim = Math.round(3 * TICK_RATE);
        h.hp = Math.max(1, h.hp - h.maxHp * 0.08);
        if (byId) h.hurtBy.add(byId);
        h.mover.reset();
        continue;
      }
      if (byId) h.hurtBy.add(byId);
      this.defeat(h, byId, false, RaidKillHow.Splash);
    }
    for (const t of [...this.traps.values()]) if (inGateway(g, t.x, t.z, 0.6)) this.traps.delete(t.id);
    return n;
  }

  /**
   * A bread loaf bursts: damage with falloff (a quarter at the edge) through
   * what stops a bullet, and a shove away from the burst (dogs fly further,
   * the Big Hunter hardly moves). Returns the hunters it hit and how hard
   * (for the shooter's hit markers).
   */
  blastBread(x: number, y: number, z: number, radius: number, damage: number, knock: number, byId: string | null, directId: string): { id: string; dealt: number; killed: boolean }[] {
    const out: { id: string; dealt: number; killed: boolean }[] = [];
    for (const h of [...this.hunters.values()]) {
      if (h.downTicks > 0) continue;
      if (Math.abs(h.x - x) > radius + 1 || Math.abs(h.z - z) > radius + 1) continue;
      const d = h.id === directId ? 0 : blastReach(this.host.sim, x, y, z, h.x, h.y, h.z, 0, radius);
      if (d < 0) continue;
      const k = blastFalloff(d, 0.8, radius, 0.25);
      if (k <= 0) continue;
      const before = h.hp;
      const killed = this.hurt(h.id, damage * k, byId, false, x, z, RaidKillHow.Bread);
      out.push({ id: h.id, dealt: Math.round(before - Math.max(0, h.hp)), killed });
      if (killed || h.raft) continue;
      const dx = h.x - x;
      const dz = h.z - z;
      const dl = Math.hypot(dx, dz) || 1;
      const mass = h.kind === HunterKind.Dog ? 1.6 : h.kind === HunterKind.Boss ? 0.35 : 1;
      h.kx += (dx / dl) * knock * k * mass;
      h.kz += (dz / dl) * knock * k * mass;
    }
    for (const t of [...this.traps.values()]) if (Math.hypot(t.x - x, t.z - z) < radius) this.traps.delete(t.id);
    return out;
  }

  private maybeDrop(h: HunterAgent): void {
    if (h.helper) return;
    const r = this.host.rules;
    const roll = Math.random() * 100;
    let kind = 0;
    // Minions fall by the dozen: a third of the chance each (the field would be full of drops), heals before ammo.
    const k = isMinion(h.kind) ? 1 / 3 : 1;
    if (h.kind === HunterKind.Boss) kind = RaidDrop.Heal;
    else if (roll < r.dropHealPercent * k) kind = RaidDrop.Heal;
    else if (roll < (r.dropHealPercent + r.dropAmmoPercent) * k) kind = RaidDrop.Ammo;
    if (!kind) return;
    const add = (k: number, ox: number): void => {
      const id = `d${++this.serial}`;
      this.drops.set(id, { id, kind: k, x: h.x + ox, y: h.y + 0.5, z: h.z, until: this.tick + 25 * TICK_RATE });
    };
    add(kind, 0);
    if (h.kind === HunterKind.Boss) add(RaidDrop.Ammo, 1.2);
  }

  /** Blast damage to hunters and traps (a duck's grenade or rocket): falloff through what stops a bullet. */
  blast(x: number, y: number, z: number, radius: number, inner: number, edge: number, damage: number, byId: string | null, directId: string | null, directBonus: number): number {
    let defeated = 0;
    for (const h of [...this.hunters.values()]) {
      if (h.downTicks > 0) continue;
      if (Math.abs(h.x - x) > radius + 1 || Math.abs(h.z - z) > radius + 1) continue;
      const d = h.id === directId ? 0 : blastReach(this.host.sim, x, y, z, h.x, h.y, h.z, 0, radius);
      if (d < 0) continue;
      const k = blastFalloff(d, inner, radius, edge);
      const amount = damage * k + (h.id === directId ? directBonus : 0);
      if (amount > 0 && this.hurt(h.id, amount, byId, false, x, z)) defeated++;
    }
    for (const t of [...this.traps.values()]) if (Math.hypot(t.x - x, t.z - z) < radius) this.traps.delete(t.id);
    return defeated;
  }

  /** Hunter and trap hitboxes for a shot taken at `viewTime` (hunters lag compensated; traps do not move). */
  targets(viewTime: number): HitTarget[] {
    const out = this.history.sample(viewTime);
    for (const t of this.traps.values()) if (t.state !== 2) out.push({ id: t.id, x: t.x, y: t.y, z: t.z, crouch: 0, yaw: 0, shape: TRAP_SHAPE });
    return out;
  }

  /** Hunters now (rockets fly through the present). */
  current(): HitTarget[] {
    const out: HitTarget[] = [];
    for (const h of this.hunters.values()) {
      if (h.downTicks > 0) continue;
      out.push({ id: h.id, x: h.x, y: h.y, z: h.z, crouch: 0, yaw: h.yaw, shape: hunterShape(h.kind, h.act) });
    }
    return out;
  }

  /** A shot at a trap: it breaks once its health is gone. */
  hurtTrap(id: string, amount: number): boolean {
    const t = this.traps.get(id);
    if (!t) return false;
    t.hp -= amount;
    if (t.hp > 0) return false;
    this.traps.delete(id);
    return true;
  }

  // ---- traps, decoys, drops ---------------------------------------------------

  private placeTrap(h: HunterAgent, x: number, y: number, z: number, tick: number): void {
    let mine = 0;
    for (const t of this.traps.values()) if (t.owner === h.id) mine++;
    if (mine >= TRAP.perTrapper || this.traps.size >= TRAP.max) return;
    // On open ground only: a clear line from the hunter's hands to the spot.
    const from = { x: h.x, y: h.y + 1.0, z: h.z };
    const dx = x - from.x;
    const dz = z - from.z;
    const d = Math.hypot(dx, dz);
    const sim = this.host.sim;
    if (d > 0.2) {
      const hit = sim.world.castRay(new sim.rapier.Ray(from, { x: dx / d, y: 0, z: dz / d }), d, true, undefined, MOVE_QUERY_GROUPS);
      if (hit) {
        x = from.x + (dx / d) * Math.max(0, hit.timeOfImpact - 0.6);
        z = from.z + (dz / d) * Math.max(0, hit.timeOfImpact - 0.6);
      }
    }
    const gy = groundHeightAt(sim, x, Math.max(y, h.y) + 1.5, z);
    const id = `t${++this.serial}`;
    this.traps.set(id, { id, x, y: gy, z, state: 0, armAt: tick + TRAP.arm, until: tick + TRAP.lifeSeconds * TICK_RATE, hp: TRAP.hp, owner: h.id });
  }

  private stepTraps(tick: number, ducks: readonly DuckTarget[]): void {
    for (const t of [...this.traps.values()]) {
      if (tick >= t.until) {
        this.traps.delete(t.id);
        continue;
      }
      if (t.state === 0 && tick >= t.armAt) t.state = 1;
      if (t.state !== 1) continue;
      for (const d of ducks) {
        if (!d.standing || Math.hypot(d.x - t.x, d.z - t.z) > TRAP.radius || Math.abs(d.y - t.y) > 1) continue;
        t.state = 2;
        // Sprung: it holds the duck, then breaks shortly after the root ends.
        t.until = tick + RAID.rootTicks + 15;
        this.host.rootDuck(d.id);
        this.host.hurtDuck(d.id, TRAP.damage * this.host.rules.hunterDamageScale, t.x, t.z, HunterKind.Trapper, false);
        break;
      }
    }
  }

  private throwDecoy(h: HunterAgent, x: number, y: number, z: number): void {
    const f = emptyFlight(ExplosiveKind.Decoy);
    f.x = h.x - Math.sin(h.yaw) * 0.4;
    f.y = h.y + 1.6;
    f.z = h.z - Math.cos(h.yaw) * 0.4;
    // A lob that lands on the spot: flight time from the distance, then the launch velocity under the grenade's gravity (18 m/s²).
    const dx = x - f.x;
    const dz = z - f.z;
    const dist = Math.hypot(dx, dz);
    const T = Math.max(0.6, Math.min(1.4, dist / 13));
    f.vx = dx / T;
    f.vz = dz / T;
    f.vy = (y + 0.2 - f.y + 0.5 * 18 * T * T) / T;
    const d: DecoyState = { id: ++this.serial, flight: f, fuse: DECOY.fuse };
    this.decoys.set(d.id, d);
    this.host.decoyLaunched(d);
  }

  private stepDecoys(ducks: readonly DuckTarget[]): void {
    for (const d of [...this.decoys.values()]) {
      stepGrenade(this.host.sim, d.flight, DT);
      if (--d.fuse > 0 && d.flight.y > -40) continue;
      this.decoys.delete(d.id);
      const f = d.flight;
      this.host.decoyBoom(d, f.x, f.y, f.z);
      for (const duck of ducks) {
        if (!duck.standing) continue;
        const reach = blastReach(this.host.sim, f.x, f.y + 0.25, f.z, duck.x, duck.y, duck.z, duck.crouch, DECOY.radius);
        if (reach < 0) continue;
        const k = blastFalloff(reach, DECOY.inner, DECOY.radius, 0.2);
        if (k > 0) this.host.hurtDuck(duck.id, DECOY.damage * k * this.host.rules.hunterDamageScale, f.x, f.z, HunterKind.Decoy, false);
      }
    }
  }

  /** Drops: expire, and a standing duck that touches one takes it (`take` says whether it could use it). */
  stepDrops(tick: number, take: (duckId: string, kind: number) => boolean): void {
    const ducks = this.host.ducks();
    for (const d of [...this.drops.values()]) {
      if (tick >= d.until) {
        this.drops.delete(d.id);
        continue;
      }
      for (const duck of ducks) {
        if (!duck.standing || Math.hypot(duck.x - d.x, duck.z - d.z) > 1.4 || Math.abs(duck.y + 0.5 - d.y) > 1.6) continue;
        if (take(duck.id, d.kind)) {
          this.drops.delete(d.id);
          break;
        }
      }
    }
  }

  /** Tests: spawn one hunter of a kind at a point. */
  spawnForTest(kind: number, x: number, z: number): HunterAgent {
    const before = new Set(this.hunters.keys());
    this.spawnGroup(kind, 1, { x, y: groundHeightAt(this.host.sim, x, 40, z), z }, this.rally, 0, true);
    const id = [...this.hunters.keys()].find((k) => !before.has(k))!;
    return this.hunters.get(id)!;
  }

  /** The kind numbers (tests). */
  static kind(k: number) {
    return KIND[k];
  }
}

/**
 * Battle royale rules on top of the shared combat core (arena.ts):
 *
 *   warm-up  humans run around the village square (damage off) while the
 *            countdown runs; the room locks when it ends
 *   playing  bots fill the seats, everyone boards the plane, jumps (F) or is
 *            ejected before the coast, loots, the zone shrinks, last duck wins
 *   ended    results are up; the room closes after a while
 *
 * Headless and network free like the deathmatch; the room mirrors it into
 * the schema and sends the messages.
 */
import {
  absorbDamage,
  BR,
  circleAt,
  createPlayerSim,
  dropsOf,
  groundHeightAt,
  Mode,
  outsideCircle,
  overLand,
  planCircles,
  planeAt,
  planePathIndex,
  planeRoute,
  TICK_RATE,
  Button,
  WeaponId,
  weaponStats,
  zoneAt,
  type Armor,
  type Circle,
  type InputFrame,
  type PlaneRoute,
  type SimWorld,
  ZONE,
  type ZoneNow,
  type ZonePhase,
} from '@qwakk/shared';
import { Arena, randomSecret, type ArenaEvents, type ArenaOptions, type BotLike, type Seat } from '../arena.ts';
import { BOT_NAMES } from '../bots.ts';
import type { BrBotContext } from './context.ts';
import { LootWorld, type LootEntity, type LootEvents } from './loot.ts';

export interface BrEvents extends ArenaEvents {
  /** The pickup went through: what the duck got. */
  picked(seat: Seat, got: { kind: number; amount: number }[]): void;
  /** A duck is out (or won): its final place. */
  result(seat: Seat, placement: number): void;
  /** The room locked and the match started (plane boarding). */
  started(): void;
  ended(winner: Seat | null): void;
  loot: LootEvents;
}

export interface BrOptions extends ArenaOptions {
  bots: boolean;
  players: number;
  warmupSeconds: number;
  warmupFullSeconds: number;
  warmupFullHumans: number;
  endSeconds: number;
  /** Match seed (plane path, circles, loot). Random when unset. */
  seed?: number;
  /** Makes the brain for a bot seat. */
  createBot: (ctx: BrBotContext, seatId: string) => BotLike;
  /** Zone timeline speed-up for tests (0.2: five times faster). Default 1. */
  zoneTimeScale?: number;
}

export const DEFAULT_BR: Omit<BrOptions, 'bots' | 'createBot'> = {
  players: BR.players,
  warmupSeconds: BR.warmupSeconds,
  warmupFullSeconds: BR.warmupFullSeconds,
  warmupFullHumans: BR.warmupFullHumans,
  endSeconds: BR.endSeconds,
};

/** Kill event "weapon" for a duck that left the match (the zone is -1). */
export const KILL_LEFT = -2;

/** Seconds of boarding before the plane reaches its path start. */
const BOARDING_S = 3;

export class BattleRoyale extends Arena {
  phase: 'warmup' | 'playing' | 'ended' = 'warmup';
  /** Warm-up ticks left (-1: waiting for the first human). */
  warmupTicks = -1;
  endTicks = 0;
  readonly seed: number;
  readonly loot: LootWorld;
  readonly armor = new Map<string, Armor>();
  /** Final places; the winner has 1. */
  readonly placement = new Map<string, number>();
  /** When each duck went out (ms since the match start). */
  readonly outAtMs = new Map<string, number>();
  route: PlaneRoute | null = null;
  /** Server time (ms) the plane is at its path start; the match clock starts here too. */
  startMs = 0;
  plan: Circle[] = [];
  zone: ZoneNow | null = null;
  winner: Seat | null = null;
  /** When each duck last went outside the zone (ms since the match start). */
  private readonly outsideSince = new Map<string, number>();
  /** The zone phases this match runs (ZONE.phases, maybe sped up for tests). */
  readonly phases: ZonePhase[];
  private botCount = 0;
  private readonly o: BrOptions;
  private readonly bev: BrEvents;
  readonly botContext: BrBotContext;

  constructor(sim: SimWorld, options: BrOptions, events: BrEvents) {
    super(sim, options, events);
    this.o = options;
    this.bev = events;
    this.seed = (options.seed ?? randomSecret()) >>> 0;
    this.loot = new LootWorld(sim, events.loot);
    const k = options.zoneTimeScale ?? 1;
    this.phases = ZONE.phases.map((p) => ({ ...p, waitS: p.waitS * k, shrinkS: p.shrinkS * k }));
    this.botContext = {
      sim,
      map: sim.map,
      route: () => this.route,
      planeTime: () => this.planeTime(),
      zone: () => this.zoneInfo(),
      itemsNear: (x, z, r) => this.loot.near(x, z, r, []),
      canReach: (s, e) => this.loot.reachable(s, e) && Math.hypot(e.x - s.x, e.y - s.y - 0.9, e.z - s.z) < 2.6,
      armorOf: (id) => this.armorFor(id),
    };
  }

  protected damageOn(): boolean {
    return this.phase === 'playing';
  }

  armorFor(id: string): Armor {
    let a = this.armor.get(id);
    if (!a) this.armor.set(id, (a = { vest: 0, vestDur: 0, helmet: 0, helmetDur: 0 }));
    return a;
  }

  protected override adjustDamage(victim: Seat, raw: number, head: boolean): number {
    return absorbDamage(this.armorFor(victim.id), raw, head);
  }

  /** Seconds since the plane started its path (negative while boarding). */
  planeTime(): number {
    return this.startMs > 0 ? (this.now - this.startMs) / 1000 : -1;
  }

  /** Ms since the match clock started (the zone timeline). */
  matchMs(): number {
    return this.startMs > 0 ? Math.max(0, this.now - this.startMs) : 0;
  }

  zoneInfo(): { now: Circle; next: Circle | null; dps: number } {
    const z = this.zone;
    if (!z) return { now: { x: 0, z: 0, r: 10000 }, next: null, dps: 0 };
    return { now: circleAt(z, this.matchMs()), next: z.shown ? z.to : null, dps: z.dps };
  }

  get alive(): number {
    let n = 0;
    for (const s of this.seats.values()) if (s.sim.alive) n++;
    return n;
  }

  get locked(): boolean {
    return this.phase !== 'warmup';
  }

  /** A human joins: only during the warm-up (the room is locked after). */
  addHuman(id: string, name: string): Seat | null {
    if (this.phase !== 'warmup') return null;
    const seat = this.makeSeat(id, name, null, createPlayerSim(0, -100, 0));
    this.armorFor(id);
    this.spawnWarmup(seat);
    if (this.warmupTicks < 0) this.warmupTicks = this.o.warmupSeconds * TICK_RATE;
    if (this.humans >= this.o.warmupFullHumans) this.warmupTicks = Math.min(this.warmupTicks, this.o.warmupFullSeconds * TICK_RATE);
    return seat;
  }

  /** A human left. In the warm-up the seat goes; in a match the duck is out (its loot drops). */
  remove(id: string): void {
    const seat = this.seats.get(id);
    if (!seat) return;
    if (this.phase === 'warmup') {
      this.seats.delete(id);
      this.armor.delete(id);
      if (this.humans === 0) this.warmupTicks = -1;
      return;
    }
    // After the end nobody is out any more: a winner leaving the results stays the winner.
    if (this.phase === 'ended') return;
    if (seat.sim.alive) this.kill(null, seat, KILL_LEFT, false);
  }

  private spawnWarmup(seat: Seat): void {
    const pts = this.sim.map.spawns;
    const p = pts[Math.floor(Math.random() * pts.length)] ?? [0, 10, 0];
    const y = groundHeightAt(this.sim, p[0], p[1] + 3, p[2]);
    const arena = this.sim.map.arena;
    const yaw = Math.atan2(p[0] - arena.x, p[2] - arena.z);
    Object.assign(seat.sim, createPlayerSim(p[0], y, p[2], yaw));
    seat.protect = 0;
    seat.life++;
    seat.spawnYaw = yaw;
    seat.spawnTick = this.tick;
  }

  /** End of the warm-up: fill with bots, roll the loot, plan the zone, everyone boards the plane. */
  lock(): void {
    if (this.phase !== 'warmup') return;
    this.phase = 'playing';
    this.secret = randomSecret();
    if (this.o.bots) {
      while (this.seats.size < this.o.players) {
        this.botCount++;
        const id = `bot-${this.botCount}`;
        const name = `${BOT_NAMES[(this.botCount - 1) % BOT_NAMES.length]} (bot)`;
        this.makeSeat(id, name, this.o.createBot(this.botContext, id), createPlayerSim(0, -100, 0));
      }
    }
    this.route = planeRoute(this.sim.map, planePathIndex(this.sim.map, this.seed));
    this.plan = planCircles(this.sim.map, this.seed);
    this.startMs = this.now + BOARDING_S * 1000;
    this.zone = zoneAt(this.plan, 0, this.phases);
    this.loot.clear();
    this.loot.spawnMatchLoot(this.seed);
    for (const s of this.seats.values()) this.board(s);
    this.bev.started();
  }

  /** Into the plane: no gear, full health, out of the world. */
  private board(seat: Seat): void {
    const fresh = createPlayerSim(0, -50, 0, this.route?.yaw ?? 0);
    fresh.mode = Mode.Plane;
    fresh.arms = 0;
    fresh.mag0 = 0;
    fresh.mag1 = 0;
    fresh.res0 = 0;
    fresh.res1 = 0;
    Object.assign(seat.sim, fresh);
    Object.assign(this.armorFor(seat.id), { vest: 0, vestDur: 0, helmet: 0, helmetDur: 0 });
    seat.kills = 0;
    seat.deaths = 0;
    seat.dealt = 0;
    seat.protect = 0;
    seat.life++;
    seat.spawnYaw = fresh.yaw;
    seat.spawnTick = this.tick;
    seat.bot?.respawned(seat.sim);
  }

  /** Out of the plane at its current position. */
  eject(seat: Seat): void {
    const r = this.route;
    if (!r || seat.sim.mode !== Mode.Plane || !seat.sim.alive) return;
    const p = planeAt(r, Math.max(0, this.planeTime()));
    const s = seat.sim;
    // Spread the jumpers a little so they do not stack.
    const side = (Math.random() - 0.5) * 6;
    s.x = p.x - r.dirZ * side;
    s.z = p.z + r.dirX * side;
    s.y = p.y - 4;
    s.vx = r.dirX * 8;
    s.vz = r.dirZ * 8;
    s.vy = 0;
    s.mode = Mode.Freefall;
    s.air = 0;
    s.grounded = 0;
    seat.spawnTick = this.tick;
  }

  /** The Use button's press edge for the seat being stepped (prevButtons is overwritten by the step). */
  private useEdge = false;

  protected override beforeStep(seat: Seat, f: InputFrame): void {
    this.useEdge = (f.buttons & Button.Use) !== 0 && (seat.sim.prevButtons & Button.Use) === 0;
    if (seat.sim.mode !== Mode.Plane || this.phase !== 'playing') return;
    const t = this.planeTime();
    const r = this.route;
    if (!r || t < 0) return;
    const pressed = (f.buttons & Button.Deploy) !== 0 && (seat.sim.prevButtons & Button.Deploy) === 0;
    if (!pressed) return;
    const p = planeAt(r, t);
    if (overLand(this.sim.map, p.x, p.z)) this.eject(seat);
  }

  protected override afterStep(seat: Seat, _f: InputFrame): void {
    if (!this.useEdge || !seat.sim.alive || seat.sim.mode !== Mode.Ground || this.phase !== 'playing') return;
    const got = this.loot.tryPickup(seat.sim, this.armorFor(seat.id));
    if (got) this.bev.picked(seat, got);
  }

  protected onKilled(killer: Seat | null, victim: Seat): void {
    if (this.phase !== 'playing') return;
    const place = this.alive + 1;
    this.placement.set(victim.id, place);
    this.outAtMs.set(victim.id, this.matchMs());
    const s = victim.sim;
    if (s.mode !== Mode.Plane) {
      const y = s.mode === Mode.Ground ? s.y : groundHeightAt(this.sim, s.x, s.y, s.z);
      this.loot.dropCrate(s.x, y + 0.05, s.z, dropsOf(s, this.armorFor(victim.id)));
    }
    s.mode = Mode.Ground;
    this.bev.result(victim, place);
    void killer;
    this.checkEnd();
  }

  private checkEnd(): void {
    if (this.phase !== 'playing') return;
    const alive = [...this.seats.values()].filter((s) => s.sim.alive);
    if (alive.length > 1) return;
    const winner = alive[0] ?? null;
    this.phase = 'ended';
    this.endTicks = this.o.endSeconds * TICK_RATE;
    this.winner = winner;
    if (winner) {
      this.placement.set(winner.id, 1);
      this.outAtMs.set(winner.id, this.matchMs());
      this.bev.result(winner, 1);
    }
    this.bev.ended(winner);
  }

  /** End of a tick: bots, warm-up clock, auto-eject, zone damage, separation, lag history. */
  endTick(): void {
    if (this.phase === 'warmup') {
      for (const s of this.seats.values()) {
        if (s.sim.y < -30 || !s.sim.alive) this.spawnWarmup(s);
        // Endless ammo in the warm-up: it is for warming up.
        if (s.sim.res0 < 60) s.sim.res0 = weaponStats(WeaponId.Rifle).reserve;
        if (s.sim.res1 < 24) s.sim.res1 = weaponStats(WeaponId.Pistol).reserve;
      }
      if (this.warmupTicks > 0 && --this.warmupTicks === 0) this.lock();
    } else if (this.phase === 'playing') {
      this.thinkBots();
      const t = this.planeTime();
      if (this.route && t >= this.route.ejectS) for (const s of this.seats.values()) if (s.sim.mode === Mode.Plane && s.sim.alive) this.eject(s);
      this.zone = zoneAt(this.plan, this.matchMs(), this.phases);
      if (this.tick % TICK_RATE === 0 && this.zone.dps > 0) {
        const c = circleAt(this.zone, this.matchMs());
        const now = this.matchMs();
        const outside: Seat[] = [];
        for (const s of this.seats.values()) {
          if (!s.sim.alive || s.sim.mode === Mode.Plane) continue;
          if (!outsideCircle(c, s.sim.x, s.sim.z)) {
            this.outsideSince.delete(s.id);
            continue;
          }
          if (!this.outsideSince.has(s.id)) this.outsideSince.set(s.id, now);
          outside.push(s);
        }
        // Who was outside longest takes the damage first, so when the last ducks
        // would all fall on the same tick, the one who stayed in longest wins
        // (then the lower player id: deterministic, never seat order).
        outside.sort((a, b) => (this.outsideSince.get(a.id) ?? 0) - (this.outsideSince.get(b.id) ?? 0) || a.pid - b.pid);
        for (const s of outside) {
          if (this.phase !== 'playing') break; // the match just ended: the winner takes no more damage
          this.worldDamage(s, this.zone.dps);
        }
      }
      for (const s of this.seats.values()) {
        // Fell out of the world (should not happen): back onto the ground nearby.
        if (s.sim.alive && s.sim.mode !== Mode.Plane && s.sim.y < -30) s.sim.y = groundHeightAt(this.sim, s.sim.x, 60, s.sim.z);
      }
    } else {
      this.thinkBots();
      if (this.endTicks > 0) this.endTicks--;
    }
    this.separate();
    this.recordHistory();
  }

  /** Seconds until the next thing happens (warm-up end, zone wait or shrink end). */
  get secondsLeft(): number {
    if (this.phase === 'warmup') return this.warmupTicks > 0 ? Math.ceil(this.warmupTicks / TICK_RATE) : 0;
    if (this.phase === 'ended') return Math.ceil(this.endTicks / TICK_RATE);
    const z = this.zone;
    if (!z) return 0;
    const t = this.matchMs();
    const next = t < z.t0 ? z.t0 : z.t1;
    return Math.max(0, Math.ceil((next - t) / 1000));
  }

  /** Damage dealt, kills and survival for the results screen and the leaderboard. */
  resultOf(seat: Seat): { placement: number; kills: number; dealt: number; survivedMs: number } {
    return {
      placement: this.placement.get(seat.id) ?? 0,
      kills: seat.kills,
      dealt: seat.dealt,
      survivedMs: this.outAtMs.get(seat.id) ?? this.matchMs(),
    };
  }
}

export type { LootEntity };

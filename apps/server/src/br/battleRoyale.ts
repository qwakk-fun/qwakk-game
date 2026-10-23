/**
 * Battle royale rules on top of the shared combat core (arena.ts):
 *
 *   warm-up  the lobby room: humans run around the village square (damage
 *            off). With bots enabled, the first human starts a 30-second
 *            countdown, with 15 s added per later arrival; at zero the room locks
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
  Deny,
  dropsOf,
  groundHeightAt,
  LOOT,
  takeOut,
  Mode,
  outsideCircle,
  overLand,
  planCircles,
  ejectForCircle,
  planeAt,
  planePathIndex,
  planeRoute,
  TICK_RATE,
  Button,
  Item,
  KNOCK,
  PARTY,
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
import { Arena, KILL_BLEED, randomSecret, type ArenaEvents, type ArenaOptions, type BotLike, type Seat } from '../arena.ts';
import { BOT_NAMES } from '../bots.ts';
import type { BrBotContext } from './context.ts';
import { isEmptyCrate, LootWorld, type LootEntity, type LootEvents, type LootResult } from './loot.ts';
import { TeamBook, type TeamGroup, type TeamRefusal } from './teams.ts';

export interface BrEvents extends ArenaEvents {
  /** The pickup went through: what the duck got. */
  picked(seat: Seat, got: { kind: number; amount: number }[]): void;
  /** A Use press or an inventory request did nothing (Deny.*), about this item kind. */
  denied?(seat: Seat, reason: number, kind: number): void;
  /** A duck changed the loot around it (opened a crate, took or dropped something). */
  looted?(seat: Seat): void;
  /** A duck is out (or won): its final place (team modes: the team's, once the team is out or won). */
  result(seat: Seat, placement: number): void;
  /** A knocked duck is back up, thanks to `by`. */
  revived?(seat: Seat, by: Seat): void;
  /** The room locked and the match started (plane boarding). */
  started(): void;
  ended(winner: Seat | null): void;
  loot: LootEvents;
}

export interface BrOptions extends ArenaOptions {
  bots: boolean;
  players: number;
  /** Humans needed for the configured countdown (bot rooms also have a 30 s fallback). */
  minHumans: number;
  countdownSeconds: number;
  /** Countdown cap once the room is full of humans. */
  fullCountdownSeconds: number;
  endSeconds: number;
  /** Match seed (plane path, circles, loot). Random when unset. */
  seed?: number;
  /** Makes the brain for a bot seat. */
  createBot: (ctx: BrBotContext, seatId: string) => BotLike;
  /** Zone timeline scale: waits and shrinks times this (0.2: five times faster; the `br.zoneTimeScale` setting, tests). Default 1. */
  zoneTimeScale?: number;
  /** Zone damage scale: damage per second outside times this, rounded, at least 1 after the drop (`br.zoneDamageScale`). Default 1. */
  zoneDamageScale?: number;
  /** First circle radius (m) instead of ZONE.phases[0] (`br.firstCircleRadius`); kept above the second circle. */
  firstCircleRadius?: number;
  /** Ducks per team: 1 solo (default), 2 duo, 4 squad. */
  teamSize?: number;
}

/** The zone phases a match runs: ZONE.phases with the time and damage scales and the first radius applied. */
export function zonePhases(o: { zoneTimeScale?: number; zoneDamageScale?: number; firstCircleRadius?: number }): ZonePhase[] {
  const k = o.zoneTimeScale ?? 1;
  const dmg = o.zoneDamageScale ?? 1;
  const phases: ZonePhase[] = ZONE.phases.map((p, i) => ({
    waitS: p.waitS * k,
    shrinkS: p.shrinkS * k,
    radius: p.radius,
    // Whole numbers (the wire carries a uint8), never 0 after the drop.
    dps: i === 0 ? 0 : Math.max(1, Math.min(255, Math.round(p.dps * dmg))),
  }));
  const p0 = phases[0];
  const p1 = phases[1];
  if (p0 && o.firstCircleRadius !== undefined) p0.radius = Math.max((p1?.radius ?? 0) + 20, o.firstCircleRadius);
  return phases;
}

export const DEFAULT_BR: Omit<BrOptions, 'bots' | 'createBot'> = {
  players: BR.players,
  minHumans: BR.minHumans,
  countdownSeconds: BR.countdownSeconds,
  fullCountdownSeconds: BR.fullCountdownSeconds,
  endSeconds: BR.endSeconds,
};

/** Kill event "weapon" for a duck that left the match (the zone is -1). */
export const KILL_LEFT = -2;

/** Seconds of boarding before the plane reaches its path start. */
const BOARDING_S = 3;
/** A knocked duck loses one point of its bleed meter every this many ticks (KNOCK.hp over KNOCK.bleedSeconds). */
const BLEED_EVERY = Math.max(1, Math.round((KNOCK.bleedSeconds * TICK_RATE) / KNOCK.hp));
const REVIVE_TICKS = Math.round(KNOCK.reviveSeconds * TICK_RATE);
/** Chest height above the feet, standing (revive reach is measured chest to chest, the knocked duck lies low). */
const CHEST = 0.9;

export class BattleRoyale extends Arena {
  phase: 'warmup' | 'playing' | 'ended' = 'warmup';
  /** Countdown ticks left (-1: empty, or waiting for humans with bots disabled). */
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
  /** Teams (solo is teams of one) and the seats held for party members on their way in. */
  readonly teams: TeamBook;
  /** Teams that are out (nobody standing), and how many teams the match started with. */
  private readonly teamsOut = new Set<number>();
  field = 0;

  constructor(sim: SimWorld, options: BrOptions, events: BrEvents) {
    super(sim, options, events);
    this.o = options;
    this.bev = events;
    this.seed = (options.seed ?? randomSecret()) >>> 0;
    this.teams = new TeamBook(options.players, options.teamSize ?? 1);
    this.loot = new LootWorld(sim, events.loot, () => this.tick);
    this.phases = zonePhases(options);
    this.botContext = {
      sim,
      map: sim.map,
      route: () => this.route,
      planeTime: () => this.planeTime(),
      zone: () => this.zoneInfo(),
      itemsNear: (x, z, r) => this.loot.near(x, z, r, []),
      canReach: (s, e) => this.loot.reachable(s, e) && Math.hypot(e.x - s.x, e.y - s.y - 0.9, e.z - s.z) < 2.6,
      lootable: (e) => e.kind !== Item.Crate || (this.loot.lootable(e) && !isEmptyCrate(e)),
      armorOf: (id) => this.armorFor(id),
      downedMate: (id, range) => this.downedMateOf(id, range),
      holdsGun: (id) => ((this.seats.get(id)?.sim.arms ?? 0) & 3) !== 0,
    };
  }

  /** Ducks per team (1: solo). */
  get teamSize(): number {
    return this.teams.size;
  }

  /** The nearest knocked teammate of a seat within `range` (bots revive their own, like players do). */
  private downedMateOf(seatId: string, range: number): { id: string; x: number; y: number; z: number } | null {
    const me = this.seats.get(seatId);
    if (!me || me.team === 0) return null;
    let best: Seat | null = null;
    let bestD = range;
    for (const s of this.seats.values()) {
      if (!this.allies(me, s) || !s.sim.alive || !s.sim.down) continue;
      const d = Math.hypot(s.sim.x - me.sim.x, s.sim.z - me.sim.z);
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best ? { id: best.id, x: best.sim.x, y: best.sim.y, z: best.sim.z } : null;
  }

  /** Is anyone on this team standing (alive and not knocked)? */
  private standing(team: number, except?: Seat): boolean {
    for (const s of this.seats.values()) if (s !== except && s.team === team && s.sim.alive && !s.sim.down) return true;
    return false;
  }

  /** Teams still in the match (someone standing). */
  get teamsIn(): number {
    const t = new Set<number>();
    for (const s of this.seats.values()) if (s.sim.alive && !s.sim.down && !this.teamsOut.has(s.team)) t.add(s.team);
    return t.size;
  }

  /** Team modes: a duck at 0 health is knocked while a teammate still stands. Solo: never. */
  protected override canKnock(victim: Seat): boolean {
    return this.teams.size > 1 && this.phase === 'playing' && victim.sim.mode === Mode.Ground && this.standing(victim.team, victim);
  }

  protected damageOn(): boolean {
    return this.phase === 'playing';
  }

  armorFor(id: string): Armor {
    let a = this.armor.get(id);
    if (!a) this.armor.set(id, (a = { vest: 0, vestDur: 0, helmet: 0, helmetDur: 0, pack: 0 }));
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

  /** Could this group (a duck, or a party's first arrival) get a seat now? The team, or why not. */
  admit(g: TeamGroup | null): number | TeamRefusal {
    if (this.phase !== 'warmup') return 'no-team';
    return this.teams.place(g ?? { playerId: null, partyId: null, followers: [] }, this.tick);
  }

  /** A human joins: only during the warm-up (the room is locked after), on a team with room for its party. */
  addHuman(id: string, name: string, g: TeamGroup | null = null, character?: number): Seat | null {
    if (this.phase !== 'warmup' || this.seats.has(id)) return null;
    const team = this.admit(g);
    if (typeof team !== 'number') return null;
    const seat = this.makeSeat(id, name, null, createPlayerSim(0, -100, 0), team, character);
    this.teams.assign(id, team, g, this.tick + PARTY.reserveSeconds * TICK_RATE);
    this.armorFor(id);
    this.spawnWarmup(seat);
    this.updateCountdown(true);
    return seat;
  }

  /** More humans needed before the countdown starts (0 once it runs or after the start). */
  get waitingFor(): number {
    return this.phase === 'warmup' && !this.countingDown ? Math.max(0, this.o.minHumans - this.humans) : 0;
  }

  /** True while the start countdown runs. */
  get countingDown(): boolean {
    return this.phase === 'warmup' && this.warmupTicks > 0;
  }

  /**
   * The first human starts the bot-fill countdown; each later arrival adds
   * 15 seconds to the remaining time, including when the human target is met.
   * Departures keep the timer unless the room empties. Without bots, keep the human gate.
   */
  private updateCountdown(joined = false): void {
    if (this.phase !== 'warmup') return;
    const humans = this.humans;
    const enoughHumans = humans >= Math.max(1, this.o.minHumans);
    if (humans === 0 || (!this.o.bots && !enoughHumans)) {
      this.warmupTicks = -1;
      return;
    }
    const countdown = Math.max(1, Math.round(this.o.countdownSeconds * TICK_RATE));
    if (this.o.bots) {
      if (this.warmupTicks < 0) {
        this.warmupTicks = BR.initialWaitSeconds * TICK_RATE;
        if (enoughHumans) this.warmupTicks = Math.min(this.warmupTicks, countdown);
      } else if (joined) {
        this.warmupTicks += BR.joinExtraSeconds * TICK_RATE;
      }
      return;
    }
    if (this.warmupTicks < 0) this.warmupTicks = countdown;
    if (humans >= this.o.players) this.warmupTicks = Math.min(this.warmupTicks, Math.max(1, Math.round(this.o.fullCountdownSeconds * TICK_RATE)));
  }

  /** A human left. In the warm-up the seat goes; in a match the duck is out (its loot drops). */
  remove(id: string): void {
    const seat = this.seats.get(id);
    if (!seat) return;
    if (this.phase === 'warmup') {
      this.seats.delete(id);
      this.armor.delete(id);
      this.teams.remove(id);
      this.updateCountdown();
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
    this.rollSecret();
    this.teams.expire(this.tick, true);
    if (this.o.bots) {
      // Bots fill every empty seat: the humans' teams first, then whole bot teams.
      for (let team = 1; team <= this.teams.count; team++) {
        while (this.teams.members(team).length < this.teams.size && this.seats.size < this.o.players) {
          this.botCount++;
          const id = `bot-${this.botCount}`;
          const name = `${BOT_NAMES[(this.botCount - 1) % BOT_NAMES.length]} (bot)`;
          this.makeSeat(id, name, this.o.createBot(this.botContext, id), createPlayerSim(0, -100, 0), team);
          this.teams.assign(id, team, null, 0);
        }
      }
    }
    this.field = this.teams.used;
    // The circles first: the plane takes the path over the first circle and ejects soon after it.
    this.plan = planCircles(this.sim.map, this.seed, this.phases);
    const first = this.plan[0];
    this.route = planeRoute(this.sim.map, planePathIndex(this.sim.map, this.seed, first));
    if (this.route && first) this.route.ejectS = ejectForCircle(this.sim.map, this.route, first);
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
    Object.assign(this.armorFor(seat.id), { vest: 0, vestDur: 0, helmet: 0, helmetDur: 0, pack: 0 });
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

  protected override afterStep(seat: Seat, f: InputFrame): void {
    if (this.teams.size > 1) this.stepRevive(seat, f);
    // A Use press next to a knocked teammate is a revive, not a pickup.
    if (!this.useEdge || seat.reviveOf || !seat.sim.alive || seat.sim.down || seat.sim.mode !== Mode.Ground || this.phase !== 'playing') return;
    const r = this.loot.tryPickup(seat.sim, this.armorFor(seat.id));
    if (r) this.report(seat, r);
  }

  /**
   * Reviving: hold Use within KNOCK.reviveRange of a knocked teammate for
   * KNOCK.reviveSeconds. Letting go, moving away, firing, being knocked
   * yourself or a stalled connection (stand-in steps drop Use) start it over.
   */
  private stepRevive(seat: Seat, f: InputFrame): void {
    const s = seat.sim;
    const holding = (f.buttons & Button.Use) !== 0 && (f.buttons & Button.Fire) === 0 && s.alive === 1 && s.down === 0 && s.mode === Mode.Ground && this.phase === 'playing';
    let target = holding && seat.reviveOf ? (this.seats.get(seat.reviveOf) ?? null) : null;
    if (target && !this.inReviveReach(seat, target)) target = null;
    if (!target && holding) {
      for (const o of this.seats.values()) {
        if (this.inReviveReach(seat, o)) {
          target = o;
          break;
        }
      }
    }
    if (!target) {
      seat.reviveOf = null;
      seat.reviveTicks = 0;
      return;
    }
    if (seat.reviveOf !== target.id) {
      seat.reviveOf = target.id;
      seat.reviveTicks = 0;
    }
    if (++seat.reviveTicks < REVIVE_TICKS) return;
    seat.reviveOf = null;
    seat.reviveTicks = 0;
    this.revive(target);
    this.bev.revived?.(target, seat);
  }

  private inReviveReach(seat: Seat, o: Seat): boolean {
    if (!this.allies(seat, o) || !o.sim.alive || !o.sim.down) return false;
    const a = seat.sim;
    const b = o.sim;
    if (Math.hypot(b.x - a.x, b.y + CHEST * 0.5 - (a.y + CHEST), b.z - a.z) > KNOCK.reviveRange) return false;
    // Same sight rule as a pickup: no reviving through a wall or a fence.
    return this.loot.clearLine(a, b.x, b.y + CHEST * 0.5, b.z);
  }

  /** Revive progress on a knocked duck (0..1) and who is reviving it (the furthest along). */
  reviveProgress(seat: Seat): { progress: number; by: Seat | null } {
    let best: Seat | null = null;
    for (const o of this.seats.values()) if (o.reviveOf === seat.id && (!best || o.reviveTicks > best.reviveTicks)) best = o;
    return { progress: best ? best.reviveTicks / REVIVE_TICKS : 0, by: best };
  }

  private report(seat: Seat, r: LootResult): void {
    if (r.got.length > 0) this.bev.picked(seat, r.got);
    if (r.deny !== Deny.None) this.bev.denied?.(seat, r.deny, r.denyKind);
    if (r.got.length > 0 || r.opened) this.bev.looted?.(seat);
  }

  /** Inventory requests left per seat this second (rate limit), and the second they count for. */
  private readonly invBudget = new Map<string, { left: number; second: number }>();

  /**
   * An inventory request from a client (the inventory screen): drop an item
   * from the inventory onto the ground, or take one item (or a crate's
   * content at `index`) that is in reach and in sight. Same rules as the Use
   * button; the server decides. Returns false when refused outright.
   */
  inventoryOp(seatId: string, op: 'drop' | 'take', a: number, b: number, c: number): boolean {
    const seat = this.seats.get(seatId);
    if (!seat || !seat.sim.alive || seat.sim.down || seat.sim.mode !== Mode.Ground || this.phase !== 'playing') return false;
    const second = Math.floor(this.tick / TICK_RATE);
    let budget = this.invBudget.get(seatId);
    if (!budget || budget.second !== second) this.invBudget.set(seatId, (budget = { left: LOOT.invOpsPerSecond, second }));
    if (budget.left <= 0) return false;
    budget.left--;
    const armor = this.armorFor(seatId);
    if (op === 'drop') {
      const out = takeOut(seat.sim, armor, a, b);
      if (!out.item) {
        this.bev.denied?.(seat, out.deny, a);
        return false;
      }
      this.loot.dropAt(seat.sim, out.item);
      this.bev.looted?.(seat);
      return true;
    }
    const e = this.loot.items.get(`i${a}`);
    // A closed crate answers nothing at all (no probing its contents by guessing kinds).
    if (!e || (e.kind === Item.Crate && !e.open) || !this.loot.inReach(seat.sim, e)) return false;
    if (b >= 0 ? e.kind !== Item.Crate || e.contents?.[b]?.kind !== c : e.kind !== c || e.kind === Item.Crate) return false;
    this.report(seat, this.loot.take(seat.sim, armor, e, b));
    return true;
  }

  protected onKilled(killer: Seat | null, victim: Seat): void {
    if (this.phase !== 'playing') return;
    this.outAtMs.set(victim.id, this.matchMs());
    const s = victim.sim;
    if (s.mode !== Mode.Plane) {
      const y = s.mode === Mode.Ground ? s.y : groundHeightAt(this.sim, s.x, s.y, s.z);
      this.loot.dropCrate(s.x, y + 0.05, s.z, dropsOf(s, this.armorFor(victim.id)));
    }
    s.mode = Mode.Ground;
    for (const o of this.seats.values()) if (o.reviveOf === victim.id) o.reviveOf = null;
    void killer;
    // The team is out once nobody on it stands (solo: right away). Its ducks share the place.
    if (!this.standing(victim.team)) this.eliminate(victim.team);
  }

  /**
   * A team has nobody standing: its knocked ducks are out too (nobody can
   * revive them), and every duck on it gets the team's place.
   */
  private eliminate(team: number): void {
    if (this.teamsOut.has(team) || this.phase !== 'playing') return;
    this.teamsOut.add(team);
    const mates = [...this.seats.values()].filter((o) => o.team === team);
    for (const o of mates) if (o.sim.alive) this.kill(this.seats.get(o.knockedBy ?? '') ?? null, o, KILL_BLEED, false);
    const place = this.teamsIn + 1;
    for (const o of mates) {
      this.placement.set(o.id, place);
      this.bev.result(o, place);
    }
    this.checkEnd();
  }

  private checkEnd(): void {
    if (this.phase !== 'playing') return;
    const standing = new Map<number, Seat>();
    for (const s of this.seats.values()) if (s.sim.alive && !s.sim.down && !this.teamsOut.has(s.team) && !standing.has(s.team)) standing.set(s.team, s);
    if (standing.size > 1) return;
    const winner = [...standing.values()][0] ?? null;
    this.phase = 'ended';
    this.endTicks = this.o.endSeconds * TICK_RATE;
    this.winner = winner;
    if (winner) {
      // The whole team wins, the fallen too.
      for (const o of this.seats.values()) {
        if (o.team !== winner.team) continue;
        this.placement.set(o.id, 1);
        if (!this.outAtMs.has(o.id)) this.outAtMs.set(o.id, this.matchMs());
        this.bev.result(o, 1);
      }
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
      // Seats held for party members who never came free up again.
      if (this.tick % TICK_RATE === 0) this.teams.expire(this.tick);
      if (this.warmupTicks > 0 && --this.warmupTicks === 0) this.lock();
    } else if (this.phase === 'playing') {
      this.thinkBots();
      this.bleed();
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

  /** Knocked ducks bleed out over KNOCK.bleedSeconds (the knocker gets the kill). */
  private bleed(): void {
    for (const s of this.seats.values()) {
      if (!s.sim.alive || !s.sim.down || (this.tick - s.downTick) % BLEED_EVERY !== 0 || this.tick === s.downTick) continue;
      s.sim.hp = Math.max(0, s.sim.hp - 1);
      if (s.sim.hp <= 0) this.kill(this.seats.get(s.knockedBy ?? '') ?? null, s, KILL_BLEED, false);
      if (this.phase !== 'playing') return;
    }
  }

  /** Seconds until the next thing happens (countdown end, zone wait or shrink end); 0 while waiting for players. */
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

/**
 * Hunt Season rules on top of the shared combat core (arena.ts), on Pond
 * Keep (the duck castle on a pond island):
 *
 *   lobby  ducks gather in the courtyard (no damage); the first one starts
 *          a short countdown, later ones add a few seconds, a full room
 *          starts soon; at zero the room locks
 *   wave   the director sends the wave's hunters (hunts.ts) from the
 *          trenches; they go for the gate, then the QoreChain core. The
 *          ducks fight from the walls, man the bread cannons, pull the
 *          drawbridge lever and repair the gate (keepWorld.ts). Knocked
 *          ducks crawl and bleed (the battle royale knock, revive by holding
 *          Use); the dead wait for the break
 *   break  every duck picks one of three upgrades (a timer picks at random),
 *          the fallen come back, then the next wave
 *   won / lost  after wave 10, or when the core falls or no duck stands
 *
 * Every duck is on team 1: no friendly fire, always in each other's view.
 * Headless and network free like the other modes; the room mirrors it into
 * the schema and sends the messages. Server only.
 */
import {
  BODY,
  BridgeState,
  Button,
  COMBAT,
  createPlayerSim,
  damageAt,
  exMan,
  groundHeightAt,
  HunterKind,
  isBossWave,
  isUpgradeId,
  KNOCK,
  leverInReach,
  Mode,
  nudgePlayer,
  OPAQUE_QUERY_GROUPS,
  RAID,
  RaidEndReason,
  RaidStage,
  rollOffer,
  setMan,
  setNades,
  setRoot,
  TICK_RATE,
  Upgrade,
  WeaponId,
  weaponStats,
  type HitTarget,
  type InputFrame,
  type KeepGeometry,
  type ShotResult,
  type SimWorld,
  type UpgradeId,
} from '@qwakk/shared';
import { KillWeapon, RaidDrop } from '@qwakk/shared/net';
import { Arena, KILL_BLEED, type ArenaEvents, type ArenaOptions, type BotLike, type BotTarget, type Seat } from '../arena.ts';
import { DmExplosives, type ExplosiveEvents } from '../dmExplosives.ts';
import type { ServerMap } from '../maps.ts';
import type { BotNav } from '../nav/botNav.ts';
import { rocketPickupRules, serverWeapon, type BlastRules } from '../settings/index.ts';
import { HuntWorld, type DecoyState } from './hunts.ts';
import type { HunterAgent } from './hunter.ts';
import type { ShotTrace } from './gun.ts';
import { KeepWorld, type Loaf } from './keepWorld.ts';
import type { RaidRules } from './rules.ts';
import type { DuckTarget } from './sight.ts';
import { duckSpawns, hunterSpawns } from './spawns.ts';
import { DuckUpgrades, duckStats, upgradeValue, type DuckStats } from './upgrades.ts';

/** One duck's run: upgrades, numbers for the XP, the open card offer. Kept after the duck leaves (results). */
export interface RaidDuck {
  seatId: string;
  name: string;
  upgrades: DuckUpgrades;
  stats: DuckStats;
  kills: number;
  bossKills: number;
  revives: number;
  wavesCleared: number;
  firstWave: number;
  left: boolean;
  hurtTick: number;
  offer: { cards: UpgradeId[]; picked: boolean } | null;
  /** A lone duck's second wind: knocked with nobody to revive it, it may get up by itself once a wave (hold Use). */
  secondWind: number;
}

export interface RaidEvents extends ArenaEvents {
  started(): void;
  ended(reason: number): void;
  waveStart(wave: number, boss: boolean): void;
  waveClear(wave: number): void;
  /** Cards for a duck ([id, value] pairs), or null to close them. */
  offer(seat: Seat, cards: [number, number][] | null, deadlineMs: number): void;
  /** A duck's own run numbers changed (upgrades, max health, kills). */
  self(seat: Seat): void;
  /** A duck hurt by a hunter, trap or decoy: the direction toward it (never a duck's position). */
  hurtFrom(victim: Seat, damage: number, x: number, z: number): void;
  hunterHit(shooter: Seat, h: HunterAgent, damage: number, head: boolean, killed: boolean, blast: boolean): void;
  /** `how`: RaidKillHow (shot, splashed into the moat, a bread loaf). */
  hunterDown(h: HunterAgent, killer: Seat | null, head: boolean, how: number): void;
  hunterShot(h: HunterAgent, traces: readonly ShotTrace[], weapon: number): void;
  whistle(h: HunterAgent): void;
  coreHit(hp: number): void;
  coreRepaired(): void;
  gateHit(hp: number, state: number): void;
  gateBroken(): void;
  gateFixed(by: Seat | null): void;
  /** The drawbridge starts to move (Raising or Lowering), by a duck at the lever or by itself. */
  bridge(state: number, by: Seat | null): void;
  /** Hunters on the deck went into the moat as it rose. */
  splash(count: number, by: Seat | null): void;
  /** The lever did not move for this duck (LeverDenied), with the seconds of cooldown left. */
  leverDenied(seat: Seat, reason: number, seconds: number): void;
  overheat(seat: Seat, cannon: number): void;
  loafLaunched(l: Loaf, owner: Seat | null): void;
  loafBoom(l: Loaf, x: number, y: number, z: number): void;
  trapped(seat: Seat): void;
  revived?(seat: Seat, by: Seat): void;
  decoyLaunched(d: DecoyState): void;
  decoyBoom(d: DecoyState, x: number, y: number, z: number): void;
  dropTaken(seat: Seat, kind: number): void;
  explosives?: ExplosiveEvents;
}

export interface RaidOptions extends ArenaOptions {
  map: ServerMap;
  nav: () => BotNav | null;
  rules: RaidRules;
  /** Results time after the end before the room closes (s). */
  endSeconds?: number;
}

const BLEED_EVERY = Math.max(1, Math.round((KNOCK.bleedSeconds * TICK_RATE) / KNOCK.hp));
const REVIVE_TICKS = Math.round(KNOCK.reviveSeconds * TICK_RATE);
/** A lone duck getting up on its own (second wind) takes longer than a friend's revive. */
export const SELF_REVIVE_TICKS = Math.round(KNOCK.reviveSeconds * 1.6 * TICK_RATE);
const CHEST = 0.9;

export class Raid extends Arena {
  stage: number = RaidStage.Lobby;
  wave = 0;
  /** Ticks left in the lobby countdown or the break (-1: nobody here yet); the end screen after the run. */
  stageTicks = -1;
  endTicks = 0;
  endReason = 0;
  startTick = 0;
  /** Tick the last wave was cleared (the personal best time). */
  lastClearTick = 0;
  waveStartTick = 0;
  /** Hunters bagged by the whole team. */
  teamKills = 0;
  /** Tick the lobby countdown first started: it never runs past RAID.lobbyMaxSeconds after it, however ducks come and go. */
  private lobbyStartTick = -1;
  /** Test servers only (the benchmark's `dev:raid` hold): ducks take no damage. */
  hold = false;
  readonly ducks = new Map<string, RaidDuck>();
  readonly hunts: HuntWorld;
  readonly explosives: DmExplosives;
  /** The keep's moving parts: core, gate, drawbridge, cannons and loaves. */
  readonly keep: KeepWorld;
  readonly geometry: KeepGeometry;
  readonly rules: RaidRules;
  private readonly spawnPts: { x: number; y: number; z: number; yaw: number }[];
  private readonly o: RaidOptions;
  private readonly rev: RaidEvents;
  private botCount = 0;
  private readonly duckView: DuckTarget[] = [];
  /** Each duck's buttons of its last step (Use presses: the lever). */
  private readonly lastButtons = new Map<string, number>();

  constructor(sim: SimWorld, options: RaidOptions, events: RaidEvents) {
    super(sim, options, events);
    this.o = options;
    this.rev = events;
    this.rules = options.rules;
    const g = options.map.def.raid;
    if (!g) throw new Error(`Hunt Season needs a castle map: ${options.map.def.id} has no raid markup`);
    this.geometry = g;
    this.spawnPts = duckSpawns(g);
    this.explosives = new DmExplosives(sim, this);
    this.explosives.timedPickups = false;
    if (events.explosives) this.explosives.events = events.explosives;
    this.keep = new KeepWorld(sim, g, options.rules, this.keepEvents());
    this.hunts = new HuntWorld(this.huntHost(), g, hunterSpawns(sim, g));
  }

  get coreHp(): number {
    return this.keep.coreHp;
  }

  get coreMax(): number {
    return this.keep.coreMax;
  }

  // ---- seats ------------------------------------------------------------------

  get locked(): boolean {
    return this.stage !== RaidStage.Lobby;
  }

  /** Ducks seated now (humans and test bots). */
  get duckCount(): number {
    return this.seats.size;
  }

  /** A duck joins the lobby (the room refuses joins once the run started). */
  addDuck(id: string, name: string, character?: number, bot: BotLike | null = null): Seat | null {
    if (this.stage !== RaidStage.Lobby || this.seats.has(id) || this.seats.size >= RAID.maxDucks) return null;
    const seat = this.makeSeat(id, name, bot, createPlayerSim(0, -100, 0), 1, character);
    const d: RaidDuck = { seatId: id, name, upgrades: new DuckUpgrades(), stats: duckStats(new DuckUpgrades(), this.rules.upgrade), kills: 0, bossKills: 0, revives: 0, wavesCleared: 0, firstWave: 1, left: false, hurtTick: 0, offer: null, secondWind: 0 };
    this.ducks.set(id, d);
    this.spawnDuck(seat, 1);
    const lobby = Math.max(1, Math.round(this.rules.lobbySeconds * TICK_RATE));
    const cap = Math.max(lobby, RAID.lobbyMaxSeconds * TICK_RATE);
    if (this.stageTicks < 0) {
      // The first duck starts it (and a duck who comes back to an emptied lobby starts it again).
      if (this.lobbyStartTick < 0) this.lobbyStartTick = this.tick;
      this.stageTicks = Math.max(1, Math.min(lobby, this.lobbyStartTick + cap - this.tick));
    } else {
      // Later ducks add a few seconds, never past the deadline from the first start: leaving and joining again cannot hold the hunt off.
      this.stageTicks = Math.max(1, Math.min(this.stageTicks + RAID.joinExtraSeconds * TICK_RATE, this.lobbyStartTick + cap - this.tick));
    }
    if (this.seats.size >= RAID.maxDucks) this.stageTicks = Math.min(this.stageTicks, RAID.fullLobbySeconds * TICK_RATE);
    return seat;
  }

  /** Tests and the benchmark: a duck driven by a bot brain (shoots hunters through the same input path). */
  addBotDuck(bot: BotLike): Seat | null {
    this.botCount++;
    return this.addDuck(`duckbot-${this.botCount}`, `Duckbot ${this.botCount}`, undefined, bot);
  }

  /** A duck left: in the lobby the seat goes; in a run its numbers stay for the results. */
  remove(id: string): void {
    const seat = this.seats.get(id);
    if (!seat) return;
    if (this.stage === RaidStage.Lobby) {
      this.seats.delete(id);
      this.ducks.delete(id);
      if (this.seats.size === 0) {
        this.stageTicks = -1;
        this.lobbyStartTick = -1;
      }
      return;
    }
    const d = this.ducks.get(id);
    if (d) d.left = true;
    for (const o of this.seats.values()) if (o.reviveOf === id) o.reviveOf = null;
    this.seats.delete(id);
    this.keep.duckLeft(id);
    this.lastButtons.delete(id);
    if (this.stage === RaidStage.Wave) this.checkFail();
  }

  /** On its feet at a spawn in the courtyard, with `share` of its full health. */
  private spawnDuck(seat: Seat, share: number): void {
    const n = this.spawnPts.length;
    const p = this.spawnPts[(seat.pid - 1 + n) % n] ?? this.spawnPts[0]!;
    const y = groundHeightAt(this.sim, p.x, p.y + 0.3, p.z);
    const fresh = createPlayerSim(p.x, y, p.z, p.yaw);
    const ex = seat.sim.ex;
    const buff = seat.sim.dmBuff;
    Object.assign(seat.sim, fresh);
    seat.sim.ex = ex;
    // The keep's bits stay (the drawbridge closed); a fresh duck mans nothing.
    seat.sim.dmBuff = buff;
    setMan(seat.sim, 0);
    const d = this.ducks.get(seat.id);
    seat.sim.hp = Math.max(1, Math.round((d?.stats.maxHp ?? COMBAT.maxHp) * share));
    seat.protect = 0;
    seat.respawnAt = -1;
    seat.knockedBy = null;
    seat.reviveOf = null;
    seat.reviveTicks = 0;
    seat.life++;
    seat.spawnYaw = fresh.yaw;
    seat.spawnTick = this.tick;
    seat.bot?.respawned(seat.sim);
  }

  maxHpOf(seat: Seat): number {
    return this.ducks.get(seat.id)?.stats.maxHp ?? COMBAT.maxHp;
  }

  // ---- arena hooks --------------------------------------------------------------

  protected damageOn(): boolean {
    return this.stage === RaidStage.Wave;
  }

  protected override canKnock(victim: Seat): boolean {
    return this.stage === RaidStage.Wave && victim.sim.mode === Mode.Ground;
  }

  protected override extraTargets(_shooter: Seat, viewTime: number): HitTarget[] {
    return this.hunts.targets(viewTime);
  }

  /** A duck's bullet hit a hunter or a trap: the server's damage numbers, the duck's upgrades. */
  protected override hitOther(shooter: Seat, r: ShotResult, weapon: number): void {
    const head = r.outcome === 3;
    const st = this.ducks.get(shooter.id)?.stats;
    const raw = damageAt(serverWeapon(weapon), r.distance, head) * (st?.damage ?? 1) * (head ? (st?.headshot ?? 1) : 1);
    if (r.targetId.startsWith('t')) {
      this.hunts.hurtTrap(r.targetId, raw);
      return;
    }
    const h = this.hunts.hunters.get(r.targetId);
    if (!h || h.downTicks > 0) return;
    const dmg = Math.min(h.hp, raw);
    shooter.dealt += Math.round(dmg);
    const killed = this.hunts.hurt(h.id, raw, shooter.id, head, shooter.sim.x, shooter.sim.z);
    this.rev.hunterHit(shooter, h, Math.round(dmg), head, killed, false);
  }

  /**
   * After a duck's step: a manning duck holding Fire fires its cannon (the
   * server owns the loaves); otherwise a Use press at the lever pulls it,
   * holding Use revives a knocked friend in reach, or else repairs the gate.
   */
  protected override afterStep(seat: Seat, f: InputFrame): void {
    this.explosives.afterStep(seat, this.stage === RaidStage.Wave);
    const prev = this.lastButtons.get(seat.id) ?? 0;
    this.lastButtons.set(seat.id, f.buttons);
    const s = seat.sim;
    if (exMan(s) > 0) {
      if (f.buttons & Button.Fire) this.keep.fire(seat, seat.side, this.tick);
      seat.reviveOf = null;
      seat.reviveTicks = 0;
      this.keep.stepRepair(seat, false);
      return;
    }
    if ((f.buttons & Button.Use) !== 0 && (prev & Button.Use) === 0 && s.alive === 1 && s.down === 0 && leverInReach(this.geometry, s.x, s.y, s.z)) {
      this.pullLever(seat);
      return;
    }
    this.stepRevive(seat, f);
    this.keep.stepRepair(seat, !seat.reviveOf && (f.buttons & Button.Use) !== 0 && (f.buttons & Button.Fire) === 0);
  }

  /** A duck pulls the drawbridge lever (or the lever says why not). */
  pullLever(seat: Seat | null): number {
    const r = this.keep.pullLever(seat, this.tick, this.keep.deckBusy(this.seats.values()));
    if (r && seat) this.rev.leverDenied(seat, r, this.keep.leverSeconds(this.tick));
    return r;
  }

  /** Ducks never get pushed off a cannon they man: the other duck takes the whole push (server only, like the arena's). */
  protected override separate(): void {
    const list = [...this.seats.values()].filter((s) => s.sim.alive && s.sim.mode === Mode.Ground);
    const min = BODY.radius * 2;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!.sim;
        const b = list[j]!.sim;
        if (Math.abs(a.y - b.y) > 1.6) continue;
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= min) continue;
        if (d < 1e-4) {
          dx = 1;
          dz = 0;
        } else {
          dx /= d;
          dz /= d;
        }
        const fixA = exMan(a) > 0;
        const fixB = exMan(b) > 0;
        if (fixA && fixB) continue;
        const push = (min - d) / (fixA || fixB ? 1 : 2);
        if (!fixA) nudgePlayer(this.sim, a, -dx * push, -dz * push);
        if (!fixB) nudgePlayer(this.sim, b, dx * push, dz * push);
      }
    }
  }

  /** Bot ducks (tests, the benchmark) see the hunters as their targets; the input path is the human one. */
  private thinkDucks(): void {
    let view: BotTarget[] | null = null;
    for (const s of this.seats.values()) {
      if (!s.bot) continue;
      view ??= [...this.hunts.hunters.values()].map((h) => ({ id: h.id, x: h.x, y: h.y, z: h.z, alive: h.downTicks === 0, team: 2, protect: false, life: h.serial }));
      this.applyInput(s, s.bot.think(s.sim, view, this.tick), this.now);
    }
  }

  // ---- ducks getting hurt ------------------------------------------------------

  /** Damage to a duck from a hunter, a trap or a decoy (armor upgrade, the knock, the bleed meter). */
  hurtDuck(id: string, amount: number, fromX: number, fromZ: number, kind: number, head: boolean): void {
    const seat = this.seats.get(id);
    if (!seat || !seat.sim.alive || this.stage !== RaidStage.Wave || this.hold) return;
    const d = this.ducks.get(id);
    const down = seat.sim.down === 1;
    const dmg = Math.min(seat.sim.hp, Math.max(1, Math.round(amount * (d?.stats.taken ?? 1) * (down ? KNOCK.damageScale : 1))));
    seat.sim.hp -= dmg;
    if (d) d.hurtTick = this.tick;
    this.keep.duckHurt(seat.id);
    this.rev.hurtFrom(seat, dmg, fromX, fromZ);
    seat.bot?.damagedFrom(fromX, fromZ);
    if (seat.sim.hp > 0) return;
    const weapon = KillWeapon.HunterBase + kind;
    if (down) this.kill(null, seat, weapon, head);
    else this.knock(null, seat, weapon, head);
    this.checkFail();
  }

  /** A duck's own grenade or rocket (its self share): the same path as other damage to it. */
  explosionDamage(_attacker: Seat | null, victim: Seat, amount: number, weapon: number, x: number, z: number): void {
    if (!victim.sim.alive || this.stage !== RaidStage.Wave) return;
    const d = this.ducks.get(victim.id);
    const down = victim.sim.down === 1;
    const dmg = Math.min(victim.sim.hp, Math.round(amount * (d?.stats.taken ?? 1) * (down ? KNOCK.damageScale : 1)));
    if (dmg <= 0) return;
    victim.sim.hp -= dmg;
    this.rev.hurtFrom(victim, dmg, x, z);
    if (victim.sim.hp > 0) return;
    if (down) this.kill(null, victim, weapon, false);
    else this.knock(null, victim, weapon, false);
    this.checkFail();
  }

  /** Hunters a rocket can hit on the way (current positions). */
  rocketTargets(): HitTarget[] {
    return this.stage === RaidStage.Wave ? this.hunts.current() : [];
  }

  /** A duck's blast hurts hunters (the thrower's damage upgrade applies; ducks are never hurt by a friend's blast). */
  blastOthers(attacker: Seat | null, x: number, y: number, z: number, r: BlastRules, kind: number, directId: string | null): void {
    if (this.stage !== RaidStage.Wave) return;
    const mult = attacker ? (this.ducks.get(attacker.id)?.stats.damage ?? 1) : 1;
    const direct = kind === 2 ? (r as BlastRules & { directDamage?: number }).directDamage ?? 0 : 0;
    const before = new Map([...this.hunts.hunters.values()].filter((h) => h.downTicks === 0).map((h) => [h.id, h.hp] as const));
    this.hunts.blast(x, y, z, r.blastRadius, r.innerRadius, r.edgeScale, r.damage * mult, attacker?.id ?? null, directId, direct * mult);
    if (!attacker) return;
    for (const [id, hp] of before) {
      const h = this.hunts.hunters.get(id);
      if (!h || h.hp === hp) continue;
      this.rev.hunterHit(attacker, h, Math.round(hp - Math.max(0, h.hp)), false, h.downTicks > 0, true);
      attacker.dealt += Math.round(hp - Math.max(0, h.hp));
    }
  }

  protected onKilled(_killer: Seat | null, victim: Seat): void {
    // Out until the next break.
    victim.respawnAt = -1;
    victim.sim.mode = Mode.Ground;
    for (const o of this.seats.values()) if (o.reviveOf === victim.id) o.reviveOf = null;
  }

  /** Nobody standing, or the core down: the run is lost. */
  private checkFail(): void {
    if (this.stage !== RaidStage.Wave) return;
    if (this.keep.coreHp <= 0) return this.end(RaidEndReason.CoreFell);
    let standing = 0;
    for (const s of this.seats.values()) if (s.sim.alive && (!s.sim.down || this.canSelfRevive(s))) standing++;
    if (standing === 0) this.end(RaidEndReason.AllDown);
  }

  /** Alone in the run, knocked, with its second wind left: still in it. */
  private canSelfRevive(seat: Seat): boolean {
    return this.seats.size === 1 && seat.sim.alive === 1 && seat.sim.down === 1 && (this.ducks.get(seat.id)?.secondWind ?? 0) > 0;
  }

  // ---- revive ------------------------------------------------------------------

  /** Hold Use next to a knocked friend (KNOCK numbers; the reviver's upgrade makes it quicker). */
  private stepRevive(seat: Seat, f: InputFrame): void {
    const s = seat.sim;
    // Second wind: a lone knocked duck holds Use to get up by itself (once a wave).
    if (s.down === 1 && this.canSelfRevive(seat)) {
      if ((f.buttons & Button.Use) === 0 || this.stage !== RaidStage.Wave) {
        seat.reviveOf = null;
        seat.reviveTicks = 0;
        return;
      }
      seat.reviveOf = seat.id;
      if (++seat.reviveTicks < SELF_REVIVE_TICKS) return;
      seat.reviveOf = null;
      seat.reviveTicks = 0;
      const d = this.ducks.get(seat.id);
      if (d) d.secondWind--;
      this.revive(seat);
      this.rev.revived?.(seat, seat);
      return;
    }
    const holding = (f.buttons & Button.Use) !== 0 && (f.buttons & Button.Fire) === 0 && s.alive === 1 && s.down === 0 && s.mode === Mode.Ground && this.stage === RaidStage.Wave;
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
    if (++seat.reviveTicks < this.reviveTicksFor(seat)) return;
    seat.reviveOf = null;
    seat.reviveTicks = 0;
    this.revive(target);
    const d = this.ducks.get(seat.id);
    if (d) d.revives++;
    this.rev.revived?.(target, seat);
  }

  private reviveTicksFor(seat: Seat): number {
    return Math.max(1, Math.round(REVIVE_TICKS * (this.ducks.get(seat.id)?.stats.reviveTime ?? 1)));
  }

  private inReviveReach(seat: Seat, o: Seat): boolean {
    if (!this.allies(seat, o) || !o.sim.alive || !o.sim.down) return false;
    const a = seat.sim;
    const b = o.sim;
    if (Math.hypot(b.x - a.x, b.y + CHEST * 0.5 - (a.y + CHEST), b.z - a.z) > KNOCK.reviveRange) return false;
    const from = { x: a.x, y: a.y + CHEST, z: a.z };
    const dx = b.x - from.x;
    const dy = b.y + CHEST * 0.5 - from.y;
    const dz = b.z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.05) return true;
    const hit = this.sim.world.castRay(new this.sim.rapier.Ray(from, { x: dx / d, y: dy / d, z: dz / d }), d, true, undefined, OPAQUE_QUERY_GROUPS);
    return !hit || hit.timeOfImpact >= d - 0.1;
  }

  /** Revive progress on a knocked duck (0..1) and who is reviving it. */
  reviveProgress(seat: Seat): { progress: number; by: Seat | null } {
    let best: Seat | null = null;
    for (const o of this.seats.values()) if (o.reviveOf === seat.id && (!best || o.reviveTicks > best.reviveTicks)) best = o;
    if (best === seat) return { progress: seat.reviveTicks / SELF_REVIVE_TICKS, by: seat };
    return { progress: best ? best.reviveTicks / this.reviveTicksFor(best) : 0, by: best };
  }

  // ---- stages --------------------------------------------------------------------

  /** End of the lobby: lock, and the first wave goes. */
  start(): void {
    if (this.stage !== RaidStage.Lobby) return;
    this.rollSecret();
    this.startTick = this.tick;
    for (const s of this.seats.values()) {
      s.kills = 0;
      s.deaths = 0;
      s.dealt = 0;
    }
    this.rev.started();
    this.beginWave(1);
  }

  private beginWave(w: number): void {
    this.stage = RaidStage.Wave;
    this.wave = w;
    this.stageTicks = 0;
    this.waveStartTick = this.tick;
    this.hunts.startWave(w, Math.max(1, this.seats.size), this.tick);
    for (const s of this.seats.values()) {
      const d = this.ducks.get(s.id);
      setNades(s.sim, RAID.grenadesPerWave + (d?.stats.extraGrenades ?? 0));
      if (d) d.secondWind = this.seats.size === 1 ? 1 : 0;
    }
    if (isBossWave(w) && rocketPickupRules().rockets > 0) {
      const p = this.spawnPts[this.spawnPts.length - 1] ?? this.spawnPts[0];
      if (p) this.explosives.placeRocket(p.x, groundHeightAt(this.sim, p.x, p.y + 0.3, p.z) + 0.8, p.z, this.tick, 90);
    }
    this.rev.waveStart(w, isBossWave(w));
  }

  private clearWave(): void {
    const w = this.wave;
    this.lastClearTick = this.tick;
    for (const s of this.seats.values()) {
      const d = this.ducks.get(s.id);
      if (d) d.wavesCleared++;
    }
    this.rev.waveClear(w);
    if (w >= RAID.waves) return this.end(RaidEndReason.Won);
    this.beginBreak();
  }

  private beginBreak(): void {
    this.stage = RaidStage.Break;
    this.stageTicks = Math.max(1, Math.round(this.rules.breakSeconds * TICK_RATE));
    this.explosives.reset(this.tick);
    this.keep.breakRepair();
    const deadline = this.now + (this.stageTicks / TICK_RATE) * 1000;
    for (const s of this.seats.values()) {
      const d = this.ducks.get(s.id);
      if (!d) continue;
      const max = d.stats.maxHp;
      if (!s.sim.alive) this.spawnDuck(s, 0.6);
      else if (s.sim.down) {
        this.revive(s);
        s.sim.hp = Math.round(max * 0.5);
      } else s.sim.hp = Math.min(max, s.sim.hp + max * 0.25);
      // Fresh ammo for the next wave.
      s.sim.res0 = weaponStats(WeaponId.Rifle).reserve;
      s.sim.res1 = weaponStats(WeaponId.Pistol).reserve;
      setRoot(s.sim, 0);
      const cards = rollOffer(Math.random, { maxed: d.upgrades.maxed(), coreHurt: this.keep.coreHp < this.keep.coreMax - 1 });
      d.offer = { cards, picked: false };
      this.rev.offer(s, cards.map((id) => [id, upgradeValue(id, this.rules.upgrade)]), deadline);
    }
  }

  /** A duck picks a card (client message, checked here): index into its offer. */
  pick(seatId: string, index: unknown): boolean {
    const seat = this.seats.get(seatId);
    const d = this.ducks.get(seatId);
    if (!seat || !d || this.stage !== RaidStage.Break || !d.offer || d.offer.picked) return false;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= d.offer.cards.length) return false;
    const id = d.offer.cards[index]!;
    if (!isUpgradeId(id)) return false;
    this.apply(seat, d, id);
    return true;
  }

  private apply(seat: Seat, d: RaidDuck, id: UpgradeId): void {
    if (d.offer) d.offer.picked = true;
    const before = d.stats.maxHp;
    d.upgrades.add(id);
    d.stats = duckStats(d.upgrades, this.rules.upgrade);
    if (d.stats.maxHp > before && seat.sim.alive) seat.sim.hp = Math.min(d.stats.maxHp, seat.sim.hp + (d.stats.maxHp - before));
    if (id === Upgrade.Repair) {
      this.keep.repairCore(this.rules.upgrade.repair);
      this.rev.coreRepaired();
    }
    this.rev.offer(seat, null, 0);
    this.rev.self(seat);
  }

  private endBreak(): void {
    // Whoever did not pick gets a random card of the three.
    for (const s of this.seats.values()) {
      const d = this.ducks.get(s.id);
      if (d?.offer && !d.offer.picked && d.offer.cards.length > 0) this.apply(s, d, d.offer.cards[Math.floor(Math.random() * d.offer.cards.length)]!);
      if (d) d.offer = null;
    }
    this.beginWave(this.wave + 1);
  }

  private end(reason: number): void {
    if (this.stage === RaidStage.Won || this.stage === RaidStage.Lost) return;
    this.stage = reason === RaidEndReason.Won ? RaidStage.Won : RaidStage.Lost;
    this.endReason = reason;
    this.endTicks = (this.o.endSeconds ?? RAID.endSeconds) * TICK_RATE;
    this.rev.ended(reason);
  }

  // ---- the tick ------------------------------------------------------------------

  /** The keep each tick: the drawbridge, who mans which cannon, the loaves. */
  private stepKeep(): void {
    const seats = [...this.seats.values()];
    this.keep.step(this.tick, seats);
    this.keep.syncManning(seats);
    this.keep.stepLoaves(this.stage === RaidStage.Wave ? this.hunts.current() : []);
  }

  /** End of a tick: the stage clock, bot ducks, the keep, hunters, drops, regen, the bleed, the lag history. */
  endTick(): void {
    if (this.stage === RaidStage.Lobby) {
      for (const s of this.seats.values()) {
        if (s.sim.y < -30 || !s.sim.alive) this.spawnDuck(s, 1);
        if (s.sim.res0 < 60) s.sim.res0 = weaponStats(WeaponId.Rifle).reserve;
        if (s.sim.res1 < 24) s.sim.res1 = weaponStats(WeaponId.Pistol).reserve;
      }
      this.thinkDucks();
      this.stepKeep();
      if (this.stageTicks > 0 && --this.stageTicks === 0) this.start();
    } else if (this.stage === RaidStage.Wave) {
      this.thinkDucks();
      this.stepKeep();
      this.hunts.step(this.tick, this.now, true);
      this.explosives.step(this.tick);
      this.hunts.stepDrops(this.tick, (id, kind) => this.takeDrop(id, kind));
      this.regen();
      this.bleed();
      if (this.stage === RaidStage.Wave && this.hunts.cleared) this.clearWave();
    } else if (this.stage === RaidStage.Break) {
      this.thinkDucks();
      this.stepKeep();
      this.hunts.step(this.tick, this.now, false);
      this.regen();
      if (--this.stageTicks <= 0) this.endBreak();
    } else {
      this.stepKeep();
      this.hunts.step(this.tick, this.now, false);
      if (this.endTicks > 0) this.endTicks--;
    }
    for (const s of this.seats.values()) if (s.sim.alive && s.sim.y < -30) s.sim.y = groundHeightAt(this.sim, s.sim.x, 60, s.sim.z);
    this.separate();
    this.recordHistory();
  }

  private takeDrop(id: string, kind: number): boolean {
    const seat = this.seats.get(id);
    if (!seat) return false;
    const s = seat.sim;
    if (kind === RaidDrop.Heal) {
      const max = this.maxHpOf(seat);
      if (s.hp >= max) return false;
      s.hp = Math.min(max, s.hp + this.rules.healAmount);
    } else {
      const rifle = weaponStats(WeaponId.Rifle);
      const pistol = weaponStats(WeaponId.Pistol);
      if (s.res0 >= rifle.reserve && s.res1 >= pistol.reserve) return false;
      s.res0 = Math.min(rifle.reserve, s.res0 + rifle.magSize * 1.5);
      s.res1 = Math.min(pistol.reserve, s.res1 + pistol.magSize * 2);
    }
    this.rev.dropTaken(seat, kind);
    return true;
  }

  /** The regen upgrade: health back while not hurt for 3 s. */
  private regen(): void {
    for (const s of this.seats.values()) {
      const d = this.ducks.get(s.id);
      if (!d || d.stats.regenPerSecond <= 0 || !s.sim.alive || s.sim.down || this.tick - d.hurtTick < 3 * TICK_RATE) continue;
      s.sim.hp = Math.min(d.stats.maxHp, s.sim.hp + d.stats.regenPerSecond / TICK_RATE);
    }
  }

  private bleed(): void {
    for (const s of this.seats.values()) {
      if (!s.sim.alive || !s.sim.down || (this.tick - s.downTick) % BLEED_EVERY !== 0 || this.tick === s.downTick) continue;
      s.sim.hp = Math.max(0, s.sim.hp - 1);
      if (s.sim.hp <= 0) {
        this.kill(null, s, KILL_BLEED, false);
        this.checkFail();
      }
      if (this.stage !== RaidStage.Wave) return;
    }
  }

  // ---- what the hunts need ---------------------------------------------------------

  private huntHost() {
    return {
      sim: this.sim,
      nav: () => this.o.nav(),
      rules: this.rules,
      ducks: (): readonly DuckTarget[] => {
        const v = this.duckView;
        v.length = 0;
        for (const s of this.seats.values()) {
          const p = s.sim;
          v.push({ id: s.id, pid: s.pid, x: p.x, y: p.y, z: p.z, vx: p.vx, vz: p.vz, crouch: p.crouch, standing: p.alive === 1 && p.down === 0 && p.mode === Mode.Ground });
        }
        return v;
      },
      hurtDuck: (id: string, amount: number, x: number, z: number, kind: number, head: boolean) => this.hurtDuck(id, amount, x, z, kind, head),
      rootDuck: (id: string) => {
        const seat = this.seats.get(id);
        if (!seat) return;
        setRoot(seat.sim, RAID.rootTicks);
        this.rev.trapped(seat);
      },
      bridgeDown: () => this.keep.bridgeDown,
      gateOpen: () => this.keep.gateBroken,
      damageGate: (amount: number) => {
        if (this.stage === RaidStage.Wave) this.keep.damageGate(amount);
      },
      damageCore: (amount: number) => {
        if (this.stage !== RaidStage.Wave) return;
        this.keep.damageCore(amount);
        if (this.keep.coreHp <= 0) this.checkFail();
      },
      shotFx: (h: HunterAgent, traces: readonly ShotTrace[], weapon: number) => this.rev.hunterShot(h, traces, weapon),
      hunterDown: (h: HunterAgent, killerId: string | null, head: boolean, how: number) => {
        this.teamKills++;
        const killer = killerId ? (this.seats.get(killerId) ?? null) : null;
        const kd = killerId ? this.ducks.get(killerId) : undefined;
        // A boss's whistled helpers give no kill XP (the lifesteal still works).
        if (kd && !h.helper) kd.kills++;
        if (kd) {
          if (killer) {
            if (!h.helper) killer.kills++;
            if (killer.sim.alive && !killer.sim.down && kd.stats.lifesteal > 0) killer.sim.hp = Math.min(kd.stats.maxHp, killer.sim.hp + kd.stats.lifesteal);
          }
        }
        if (h.kind === HunterKind.Boss) for (const id of h.hurtBy) {
          const d = this.ducks.get(id);
          if (d) d.bossKills++;
        }
        this.rev.hunterDown(h, killer, head, how);
        if (killer) this.rev.self(killer);
      },
      whistle: (h: HunterAgent) => this.rev.whistle(h),
      decoyLaunched: (d: DecoyState) => this.rev.decoyLaunched(d),
      decoyBoom: (d: DecoyState, x: number, y: number, z: number) => this.rev.decoyBoom(d, x, y, z),
    };
  }

  /** The keep's events: most go to the room as they are; a rising bridge splashes the hunters on it, a loaf bursts on the hunters. */
  private keepEvents() {
    return {
      coreHit: (hp: number) => this.rev.coreHit(hp),
      gateHit: (hp: number, state: number) => this.rev.gateHit(hp, state),
      gateBroken: () => this.rev.gateBroken(),
      gateFixed: (by: Seat | null) => this.rev.gateFixed(by),
      bridgeMoving: (state: number, by: Seat | null) => {
        this.rev.bridge(state, by);
        if (state !== BridgeState.Raising) return;
        const n = this.hunts.splashGateway(by?.id ?? null);
        if (n > 0) this.rev.splash(n, by);
      },
      overheat: (seat: Seat, i: number) => this.rev.overheat(seat, i),
      loafLaunched: (l: Loaf) => this.rev.loafLaunched(l, this.seats.get(l.owner) ?? null),
      loafBoom: (l: Loaf, x: number, y: number, z: number, hitId: string) => {
        this.rev.loafBoom(l, x, y, z);
        if (this.stage !== RaidStage.Wave) return;
        const owner = this.seats.get(l.owner) ?? null;
        const r = this.rules.cannon;
        const mult = this.ducks.get(l.owner)?.stats.damage ?? 1;
        for (const hit of this.hunts.blastBread(x, y, z, r.radius, r.damage * mult, r.knockback, l.owner, hitId)) {
          const h = this.hunts.hunters.get(hit.id);
          if (!owner || !h || hit.dealt <= 0) continue;
          owner.dealt += hit.dealt;
          this.rev.hunterHit(owner, h, hit.dealt, false, hit.killed, true);
        }
      },
    };
  }

  // ---- reads for the room and the HUD ------------------------------------------------

  get secondsLeft(): number {
    if (this.stage === RaidStage.Won || this.stage === RaidStage.Lost) return Math.ceil(this.endTicks / TICK_RATE);
    return this.stageTicks > 0 ? Math.ceil(this.stageTicks / TICK_RATE) : 0;
  }

  /** Server time (ms) the lobby countdown or the break ends, 0 when nothing counts down. */
  get stageEndsMs(): number {
    return (this.stage === RaidStage.Lobby || this.stage === RaidStage.Break) && this.stageTicks > 0 ? this.now + (this.stageTicks / TICK_RATE) * 1000 : 0;
  }

  get over(): boolean {
    return this.stage === RaidStage.Won || this.stage === RaidStage.Lost;
  }

  /** Run length so far, or at the end (ms). */
  runMs(): number {
    return Math.max(0, Math.round(((this.tick - this.startTick) / TICK_RATE) * 1000));
  }

  /** Tests and the e2e (test hooks): jump to a wave now (5, 10, 15: a boss wave). */
  skipTo(wave: number): void {
    if (this.stage === RaidStage.Lobby) this.start();
    if (this.over) return;
    this.hunts.clear();
    this.beginWave(Math.max(1, Math.min(RAID.waves, Math.floor(wave))));
  }

  /** Tests and the e2e (test hooks): beat every hunter of this wave now (the wave then clears as usual). */
  defeatWave(): void {
    if (this.stage !== RaidStage.Wave) return;
    const by = [...this.seats.values()].find((s) => !s.bot)?.id ?? null;
    this.hunts.defeatAll(by);
  }

  /**
   * Tests and the e2e (test hooks): move a duck to a keep spot (1 to 4: a
   * cannon's stand spot, 5: the lever, 6: inside the gate, 7: the wall walk
   * near the gate, 8: outside at the far end of the bridge). The client gets
   * the jump as a correction.
   */
  moveForTest(seat: Seat, where: number): void {
    const g = this.geometry;
    const gt = g.gate;
    let p: { x: number; y: number; z: number } | null = null;
    if (where >= 1 && where <= g.cannons.length) {
      const c = g.cannons[where - 1]!;
      p = { x: c.ux, y: c.uy, z: c.uz };
    } else if (where === 5) p = { x: g.lever[0], y: g.lever[1], z: g.lever[2] };
    else if (where === 6) p = { x: gt.x - gt.nx * 2.2, y: gt.y, z: gt.z - gt.nz * 2.2 };
    else if (where === 7) p = this.wallSpotNearGate();
    else if (where === 8) {
      const b = g.bridge;
      p = { x: b.x + b.dx * (b.len + 2), y: b.y, z: b.z + b.dz * (b.len + 2) };
    }
    if (!p) return;
    const s = seat.sim;
    s.x = p.x;
    s.z = p.z;
    s.y = groundHeightAt(this.sim, p.x, p.y + 1.5, p.z);
    s.vx = 0;
    s.vy = 0;
    s.vz = 0;
    setMan(s, 0);
  }

  /** A wall walk spot about 9 m from the gate (the markup's wall walk; above the gate when it has none). */
  private wallSpotNearGate(): { x: number; y: number; z: number } {
    const g = this.geometry;
    const gt = g.gate;
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (const line of g.mark.wallWalk) {
      for (let i = 0; i + 1 < line.length; i++) {
        const [ax, az] = line[i]!;
        const [bx, bz] = line[i + 1]!;
        const k = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az)));
        for (let j = 0; j <= k; j++) {
          const x = ax + ((bx - ax) * j) / k;
          const z = az + ((bz - az) * j) / k;
          const d = Math.abs(Math.hypot(x - gt.x, z - gt.z) - 9);
          if (d < bestD) {
            best = { x, z };
            bestD = d;
          }
        }
      }
    }
    if (!best) return { x: gt.x + gt.tx * (gt.halfW + 1.5), y: gt.y + 12, z: gt.z + gt.tz * (gt.halfW + 1.5) };
    return { x: best.x, y: gt.y + 7, z: best.z };
  }

  /** Tests and the e2e (test hooks): `n` riflemen right in front of the gate (they hammer it). */
  huntersAtGate(n: number): void {
    const g = this.geometry;
    for (let i = 0; i < n; i++) {
      const gt = g.gate;
      const along = (i - (n - 1) / 2) * 0.9;
      const h = this.hunts.spawnForTest(HunterKind.Rifleman, gt.x + gt.nx * 1.4 + gt.tx * along, gt.z + gt.nz * 1.4 + gt.tz * along);
      // In the gate passage, under the gatehouse (not on its roof).
      h.y = groundHeightAt(this.sim, h.x, gt.y + 1.5, h.z);
      h.yaw = Math.atan2(gt.nx, gt.nz);
    }
  }

  /** Tests: the remaining break, now. */
  endBreakNow(): void {
    if (this.stage === RaidStage.Break) this.stageTicks = 1;
  }
}

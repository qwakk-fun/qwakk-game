/**
 * Hunt Season rules on top of the shared combat core (arena.ts), on Pond
 * Keep (the duck castle on a pond island). v3, the push: every duck carries
 * a katana (its swings, dash, quack and storm are in the shared sim; the
 * hits are decided here, blade.ts) and a pistol, and the run is a string of
 * objectives across the field (push.ts):
 *
 *   lobby  ducks gather in the courtyard (no damage); the first one starts
 *          a short countdown, later ones add a few seconds, a full room
 *          starts soon; at zero the room locks
 *   fight  an objective is in play (the trench, the crates, the towers, the
 *          Big Hunter's camp); packs of minions with elites charge the
 *          ducks. The castle (gate, drawbridge, cannons) is the start and
 *          the fallback. Knocked ducks crawl and bleed (the battle royale
 *          knock, revive by holding Use); the dead wait for the break
 *   break  the objective is taken, the rest of the hunters flee; every duck
 *          picks one of three cards (a timer picks at random), the fallen
 *          come back beside a friend, then the next objective
 *   won / lost  after the camp falls, or when no duck stands
 *
 * Every duck is on team 1: no friendly fire, always in each other's view.
 * Headless and network free like the other modes; the room mirrors it into
 * the schema and sends the messages. Server only.
 */
import {
  armBlade,
  BladeEvent,
  BODY,
  BridgeState,
  Button,
  COMBAT,
  createPlayerSim,
  damageAt,
  dashImmune,
  EX_HEAVY_LOCK,
  devKit,
  hasSkill,
  kitStats,
  levelScale,
  lockedButtonsOf,
  ALL_SKILLS,
  type DuckKit,
  exMan,
  groundHeightAt,
  hasHeadroom,
  PLAYER_QUERY_GROUPS,
  HunterKind,
  isUpgradeId,
  KNOCK,
  lastBlade,
  hasBladeEvent,
  leverInReach,
  Mode,
  nudgePlayer,
  OPAQUE_QUERY_GROUPS,
  RAID,
  RaidEndReason,
  RaidStage,
  rollOffer,
  setMan,
  setRoot,
  setStormMeter,
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
import { KillWeapon, LeverDenied, RaidDrop, RaidKillHow } from '@qwakk/shared/net';
import { Arena, KILL_BLEED, type ArenaEvents, type ArenaOptions, type BotLike, type BotTarget, type Seat } from '../arena.ts';
import type { ServerMap } from '../maps.ts';
import type { BotNav } from '../nav/botNav.ts';
import { serverWeapon } from '../settings/index.ts';
import { BladeWorld } from './blade.ts';
import { HuntWorld, type DecoyState } from './hunts.ts';
import { PushDirector, type PushTarget } from './push.ts';
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
  /** What the duck brought (level, gear, tree; from the database at join, never from the client). */
  kit: DuckKit;
  /** The skill buttons its level does not allow yet: masked off every input before the step (lockedButtonsOf). */
  locked: number;
  /** Its level does not allow the Blade Storm yet: the meter stays empty. */
  noStorm: boolean;
  /** The tree's Last Stand was used this objective. */
  lastStandUsed: boolean;
  upgrades: DuckUpgrades;
  stats: DuckStats;
  /** Hunters bagged that are not minions (elites, snipers, dogs). */
  kills: number;
  /** Minions bagged (Beaters, Recruits). */
  minionKills: number;
  /** The combo's XP bonus, added up kill by kill (blade.ts; capped by the shared formula). */
  comboXp: number;
  /** The Blade Storm meter as the server counts it (0 to 100). */
  meter: number;
  bossKills: number;
  revives: number;
  /** Objectives cleared while the duck was in the run (the database's waves). */
  wavesCleared: number;
  firstWave: number;
  left: boolean;
  hurtTick: number;
  offer: { cards: UpgradeId[]; picked: boolean } | null;
  /** A lone duck's second wind: knocked with nobody to revive it, it may get up by itself once an objective (hold Use). */
  secondWind: number;
}

export interface RaidEvents extends ArenaEvents {
  started(): void;
  ended(reason: number): void;
  /** An objective starts (its 1-based number and Goal), is taken. */
  goalStart(index: number, goal: number): void;
  goalClear(index: number): void;
  /** An objective marker was taken (a crate smashed, a tower's snipers down). */
  targetDone(t: PushTarget): void;
  /** Kills in quick succession by one duck (a call-out). */
  streak(seat: Seat, kills: number): void;
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
  /** Tick the last objective was taken (the personal best time). */
  lastClearTick = 0;
  /** Tick the objective in play started (the HUD's timer). */
  waveStartTick = 0;
  /** Hunters bagged by the whole team. */
  teamKills = 0;
  /** Tick the lobby countdown first started: it never runs past RAID.lobbyMaxSeconds after it, however ducks come and go. */
  private lobbyStartTick = -1;
  /** Test servers only (the benchmark's `dev:raid` hold): ducks take no damage. */
  hold = false;
  /** The rules' hunter health and damage scales before the party's level scales them at the start. */
  private readonly baseHpScale: number;
  private readonly baseDamageScale: number;
  /** The dodge roll (tests replace it). */
  rand: () => number = Math.random;
  readonly ducks = new Map<string, RaidDuck>();
  readonly hunts: HuntWorld;
  /** The objectives and the packs. */
  readonly push: PushDirector;
  /** The katana's hits (the sim says when a swing lands; this decides what it cut). */
  readonly blade: BladeWorld;
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
  /** Where each duck stood before its step (a dash's path). */
  private readonly stepFrom = new Map<string, { x: number; z: number }>();

  constructor(sim: SimWorld, options: RaidOptions, events: RaidEvents) {
    super(sim, options, events);
    this.o = options;
    this.rev = events;
    // Our own copy: the start scales hunter health and damage with the party's level.
    this.rules = { ...options.rules };
    this.baseHpScale = this.rules.hunterHpScale;
    this.baseDamageScale = this.rules.hunterDamageScale;
    const g = options.map.def.raid;
    if (!g) throw new Error(`Hunt Season needs a castle map: ${options.map.def.id} has no raid markup`);
    this.geometry = g;
    this.spawnPts = duckSpawns(g);
    this.keep = new KeepWorld(sim, g, this.rules, this.keepEvents());
    this.hunts = new HuntWorld(this.huntHost(), g, hunterSpawns(sim, g));
    this.push = new PushDirector(sim, g, this.hunts, this.rules, options.nav, {
      started: (i, goal) => this.rev.goalStart(i, goal),
      cleared: (i) => this.rev.goalClear(i),
      targetDone: (t) => this.rev.targetDone(t),
    });
    this.blade = new BladeWorld({
      sim,
      rules: this.rules,
      hunts: this.hunts,
      duck: (id) => this.ducks.get(id),
      crates: () => (this.stage === RaidStage.Fight ? this.push.crateTargets() : []),
      hitCrate: (id, dmg, by) => this.hitCrate(id, dmg, by),
      live: () => this.stage === RaidStage.Fight,
      maxHp: (seat) => this.maxHpOf(seat),
      streak: (seat, n) => this.rev.streak(seat, n),
    });
  }

  get coreHp(): number {
    return this.keep.coreHp;
  }

  override beginTick(tick: number, nowMs: number): void {
    super.beginTick(tick, nowMs);
    this.blade.beginTick(tick);
    this.hunts.setTick(tick);
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

  /**
   * A duck joins the lobby (the room refuses joins once the run started).
   * `kit`: its level, gear and tree from the database (RaidRoom); without one
   * (bot ducks, tests) every move and no gear (devKit).
   */
  addDuck(id: string, name: string, character?: number, bot: BotLike | null = null, kit: DuckKit = devKit()): Seat | null {
    if (this.stage !== RaidStage.Lobby || this.seats.has(id) || this.seats.size >= RAID.maxDucks) return null;
    const seat = this.makeSeat(id, name, bot, createPlayerSim(0, -100, 0), 1, character);
    const upgrades = new DuckUpgrades();
    const d: RaidDuck = { seatId: id, name, kit, locked: lockedButtonsOf(kit.unlocks), noStorm: !hasSkill(kit.unlocks, 'storm'), lastStandUsed: false, upgrades, stats: duckStats(upgrades, this.rules.upgrade, kitStats(kit)), kills: 0, minionKills: 0, comboXp: 0, meter: 0, bossKills: 0, revives: 0, wavesCleared: 0, firstWave: 1, left: false, hurtTick: 0, offer: null, secondWind: 0 };
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
    this.stepFrom.delete(id);
    this.blade.forget(id);
    if (this.stage === RaidStage.Fight) this.checkFail();
  }

  /**
   * On its feet with `share` of its full health, the katana in hand: at a
   * spawn in the courtyard, or (`near`) beside a friend still standing.
   */
  private spawnDuck(seat: Seat, share: number, near: Seat | null = null): void {
    const n = this.spawnPts.length;
    let p = this.spawnPts[(seat.pid - 1 + n) % n] ?? this.spawnPts[0]!;
    let y = NaN;
    if (near) {
      const spot = this.besideFriend(seat, near.sim);
      if (spot) {
        p = spot;
        y = spot.y;
      }
    }
    if (!(y === y)) y = groundHeightAt(this.sim, p.x, p.y + 0.3, p.z);
    const fresh = createPlayerSim(p.x, y, p.z, p.yaw);
    const ex = seat.sim.ex;
    const buff = seat.sim.dmBuff;
    Object.assign(seat.sim, fresh);
    seat.sim.ex = ex;
    // The keep's bits stay (the drawbridge closed); a fresh duck mans nothing.
    seat.sim.dmBuff = buff;
    setMan(seat.sim, 0);
    setRoot(seat.sim, 0);
    const d = this.ducks.get(seat.id);
    // Hunt Season v3: the katana in hand and the pistol, no rifle or grenades (raid/blade.ts); the storm meter carries on.
    // What the duck's level allows (unlocks.ts): no pistol before its level, and the heavy's lock bit.
    const bits = d?.kit.unlocks ?? ALL_SKILLS;
    armBlade(seat.sim, d?.meter ?? 0, { pistol: hasSkill(bits, 'pistol'), heavy: hasSkill(bits, 'heavy') });
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

  /**
   * A free spot beside a friend for a duck coming back at a break: a few
   * offsets around it (its usual place in the line first), each on ground
   * within a step of the friend's, with room for a standing duck's capsule
   * and no wall between them (never inside a wall, a tree or across a
   * parapet); the friend's own spot last (ducks do not collide in the sim).
   * Null when even that does not fit (then a courtyard spawn).
   */
  besideFriend(seat: Seat, a: { x: number; y: number; z: number; yaw: number }): { x: number; y: number; z: number; yaw: number } | null {
    const side = ((seat.pid % 4) - 1.5) * 1.6;
    // (right, back) offsets in the friend's frame: right is (cos yaw, -sin yaw), back is (sin yaw, cos yaw).
    const tries: readonly (readonly [number, number])[] = [[side, 0], [-side, 0], [0, 1.4], [0, -1.4], [1, 1], [-1, 1], [0.8, 0], [-0.8, 0], [0, 0]];
    const cy = Math.cos(a.yaw);
    const sy = Math.sin(a.yaw);
    for (const [r, b] of tries) {
      const x = a.x + cy * r + sy * b;
      const z = a.z - sy * r + cy * b;
      const y = groundHeightAt(this.sim, x, a.y + 0.6, z);
      if (!(Math.abs(y - a.y) < 0.8)) continue;
      if (!hasHeadroom(this.sim, x, y, z)) continue;
      // Ground under its middle too, not only under the capsule's rim (the edge of a merlon or a ledge).
      const under = this.sim.world.castRay(new this.sim.rapier.Ray({ x, y: y + 0.5, z }, { x: 0, y: -1, z: 0 }), 0.8, true, undefined, PLAYER_QUERY_GROUPS);
      if (!under) continue;
      const dx = x - a.x;
      const dz = z - a.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 0.05) {
        const hit = this.sim.world.castRay(new this.sim.rapier.Ray({ x: a.x, y: a.y + 0.9, z: a.z }, { x: dx / dist, y: 0, z: dz / dist }), dist + 0.35, true, undefined, PLAYER_QUERY_GROUPS);
        if (hit) continue;
      }
      return { x, y, z, yaw: a.yaw };
    }
    return null;
  }

  maxHpOf(seat: Seat): number {
    return this.ducks.get(seat.id)?.stats.maxHp ?? COMBAT.maxHp;
  }

  // ---- arena hooks --------------------------------------------------------------

  protected damageOn(): boolean {
    return this.stage === RaidStage.Fight;
  }

  protected override canKnock(victim: Seat): boolean {
    return this.stage === RaidStage.Fight && victim.sim.mode === Mode.Ground;
  }

  protected override extraTargets(_shooter: Seat, viewTime: number): HitTarget[] {
    const t = this.hunts.targets(viewTime);
    return this.stage === RaidStage.Fight ? t.concat(this.push.crateTargets()) : t;
  }

  /** A duck's bullet (the pistol) hit a hunter, a trap or a crate: the server's damage numbers, the duck's cards. */
  protected override hitOther(shooter: Seat, r: ShotResult, weapon: number): void {
    const head = r.outcome === 3;
    const d = this.ducks.get(shooter.id);
    const raw = damageAt(serverWeapon(weapon), r.distance, head) * (d?.stats.damage ?? 1);
    if (r.targetId.startsWith('t')) {
      this.hunts.hurtTrap(r.targetId, raw);
      return;
    }
    if (r.targetId.startsWith('c')) {
      const t = this.push.targets.get(r.targetId);
      const broke = this.hitCrate(r.targetId, raw, shooter);
      if (d && t) this.blade.bulletHit(shooter, d, Math.round(raw), broke, false, t.x, t.y + 0.8, t.z, true);
      return;
    }
    const h = this.hunts.hunters.get(r.targetId);
    if (!h || h.downTicks > 0) return;
    const dmg = Math.min(h.hp, raw);
    shooter.dealt += Math.round(dmg);
    const killed = this.hunts.hurt(h.id, raw, shooter.id, head, shooter.sim.x, shooter.sim.z);
    this.rev.hunterHit(shooter, h, Math.round(dmg), head, killed, false);
    if (d) this.blade.bulletHit(shooter, d, Math.round(dmg), killed, h.elite, h.x, h.y + 1.4, h.z);
  }

  /** A cut or a bullet on a supply crate. */
  private hitCrate(id: string, dmg: number, _by: Seat): boolean {
    if (this.stage !== RaidStage.Fight) return false;
    return this.push.hitCrate(id, dmg);
  }

  protected override beforeStep(seat: Seat, f: InputFrame): void {
    // The skill buttons the duck's level does not allow: off before the step (the client masks the same bits before it predicts).
    const d = this.ducks.get(seat.id);
    if (d && d.locked !== 0) f.buttons &= ~d.locked;
    let p = this.stepFrom.get(seat.id);
    if (!p) this.stepFrom.set(seat.id, (p = { x: 0, z: 0 }));
    p.x = seat.sim.x;
    p.z = seat.sim.z;
  }

  /**
   * After a duck's step: what its katana did (blade.ts: the swing that
   * landed this step, swept at the step's lag compensated view time); then a
   * manning duck holding Fire fires its cannon (the server owns the loaves);
   * otherwise a Use press at the lever pulls it, holding Use revives a
   * knocked friend in reach, or else repairs the gate.
   */
  protected override afterStep(seat: Seat, f: InputFrame, viewTime: number): void {
    if (lastBlade.n > 0) {
      if (hasBladeEvent(BladeEvent.StormStart)) {
        const d = this.ducks.get(seat.id);
        if (d) this.blade.stormStarted(seat.id, d);
      }
      const from = this.stepFrom.get(seat.id) ?? seat.sim;
      for (let i = 0; i < lastBlade.n; i++) this.blade.afterStep(seat, viewTime, from.x, from.z, lastBlade.kind[i]!, lastBlade.step[i]!, lastBlade.charge[i]!);
      if (hasBladeEvent(BladeEvent.Quack)) this.rally(seat);
    }
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

  /** The tree's Rallying Quack: the quack heals the duck and every friend standing in its ring. */
  private rally(seat: Seat): void {
    const d = this.ducks.get(seat.id);
    if (!d || d.stats.rally <= 0 || this.stage !== RaidStage.Fight) return;
    const r = 5.5 * d.stats.quackReach;
    for (const o of this.seats.values()) {
      const s = o.sim;
      if (!s.alive || s.down || Math.hypot(s.x - seat.sim.x, s.z - seat.sim.z) > r || Math.abs(s.y - seat.sim.y) > 2.5) continue;
      s.hp = Math.min(this.maxHpOf(o), s.hp + d.stats.rally);
    }
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
    if (!seat || !seat.sim.alive || this.stage !== RaidStage.Fight || this.hold) return;
    // The dash's first ticks: nothing touches the duck (shared raid/blade.ts dashImmune).
    if (dashImmune(seat.sim)) return;
    const d = this.ducks.get(id);
    const down = seat.sim.down === 1;
    // The tree's Sidestep: a hit may miss the duck altogether (on its feet only).
    if (!down && d && d.stats.dodge > 0 && this.rand() < d.stats.dodge) return;
    let dmg = Math.min(seat.sim.hp, Math.max(1, Math.round(amount * (d?.stats.taken ?? 1) * (down ? KNOCK.damageScale : 1))));
    // The tree's Last Stand: once an objective, the blow that would knock the duck leaves it at 1 health.
    if (!down && d && d.stats.lastStand && !d.lastStandUsed && dmg >= seat.sim.hp && seat.sim.hp > 1) {
      d.lastStandUsed = true;
      dmg = seat.sim.hp - 1;
    }
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

  protected onKilled(_killer: Seat | null, victim: Seat): void {
    // Out until the next break.
    victim.respawnAt = -1;
    victim.sim.mode = Mode.Ground;
    for (const o of this.seats.values()) if (o.reviveOf === victim.id) o.reviveOf = null;
  }

  /** Nobody standing: the run is lost (v3: the core no longer ends a run). */
  private checkFail(): void {
    if (this.stage !== RaidStage.Fight) return;
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
      if ((f.buttons & Button.Use) === 0 || this.stage !== RaidStage.Fight) {
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
    const holding = (f.buttons & Button.Use) !== 0 && (f.buttons & Button.Fire) === 0 && s.alive === 1 && s.down === 0 && s.mode === Mode.Ground && this.stage === RaidStage.Fight;
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

  /** End of the lobby: lock, and the first objective goes. */
  start(): void {
    if (this.stage !== RaidStage.Lobby) return;
    this.rollSecret();
    this.startTick = this.tick;
    // Strong ducks: hunters a little tougher with the party's average level above 10 (kit.ts levelScale; a fresh party plays as before).
    const levels = [...this.ducks.values()].map((d) => d.kit.level);
    const avg = levels.length > 0 ? levels.reduce((a, b) => a + b, 0) / levels.length : 1;
    const sc = levelScale(avg, this.rules.levelHpPercent, this.rules.levelDamagePercent);
    this.rules.hunterHpScale = this.baseHpScale * sc.hp;
    this.rules.hunterDamageScale = this.baseDamageScale * sc.damage;
    for (const s of this.seats.values()) {
      s.kills = 0;
      s.deaths = 0;
      s.dealt = 0;
    }
    this.rev.started();
    this.beginObjective(1);
  }

  /** Objective `w` (1-based) in play: its markers and placed hunters (push.ts), the packs start coming. */
  private beginObjective(w: number): void {
    this.stage = RaidStage.Fight;
    this.wave = w;
    this.stageTicks = 0;
    this.waveStartTick = this.tick;
    for (const s of this.seats.values()) {
      const d = this.ducks.get(s.id);
      if (d) {
        d.secondWind = this.seats.size === 1 ? 1 : 0;
        d.lastStandUsed = false;
      }
    }
    this.push.start(w, Math.max(1, this.seats.size), this.tick);
  }

  /** The objective is taken: the rest of the hunters flee; the last one wins the run, else a break. */
  private clearObjective(): void {
    const w = this.wave;
    this.lastClearTick = this.tick;
    for (const s of this.seats.values()) {
      const d = this.ducks.get(s.id);
      if (d) d.wavesCleared++;
    }
    this.hunts.scatter();
    this.rev.goalClear(w);
    if (w >= RAID.objectives) return this.end(RaidEndReason.Won);
    this.beginBreak();
  }

  private beginBreak(): void {
    this.stage = RaidStage.Break;
    this.stageTicks = Math.max(1, Math.round(this.rules.breakSeconds * TICK_RATE));
    this.keep.breakRepair();
    const deadline = this.now + (this.stageTicks / TICK_RATE) * 1000;
    const standing = [...this.seats.values()].filter((s) => s.sim.alive && !s.sim.down);
    for (const s of this.seats.values()) {
      const d = this.ducks.get(s.id);
      if (!d) continue;
      const max = d.stats.maxHp;
      // The fallen come back beside a friend still standing (the push goes on from there), else in the castle.
      if (!s.sim.alive) this.spawnDuck(s, 0.6, standing.find((o) => o !== s) ?? null);
      else if (s.sim.down) {
        this.revive(s);
        s.sim.hp = Math.round(max * 0.5);
      } else s.sim.hp = Math.min(max, s.sim.hp + max * 0.25);
      // Fresh pistol ammo for the next objective.
      s.sim.res1 = weaponStats(WeaponId.Pistol).reserve;
      setRoot(s.sim, 0);
      const cards = rollOffer(Math.random, { maxed: d.upgrades.maxed(), team: this.seats.size > 1 });
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
    d.stats = duckStats(d.upgrades, this.rules.upgrade, kitStats(d.kit));
    if (d.stats.maxHp > before && seat.sim.alive) seat.sim.hp = Math.min(d.stats.maxHp, seat.sim.hp + (d.stats.maxHp - before));
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
    this.beginObjective(this.wave + 1);
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
    this.keep.stepLoaves(this.stage === RaidStage.Fight ? this.hunts.current() : []);
  }

  /** End of a tick: the stage clock, bot ducks, the keep, hunters, drops, regen, the bleed, the lag history. */
  endTick(): void {
    if (this.stage === RaidStage.Lobby) {
      for (const s of this.seats.values()) {
        if (s.sim.y < -30 || !s.sim.alive) this.spawnDuck(s, 1);
        if (s.sim.res1 < 24) s.sim.res1 = weaponStats(WeaponId.Pistol).reserve;
      }
      this.thinkDucks();
      this.stepKeep();
      if (this.stageTicks > 0 && --this.stageTicks === 0) this.start();
    } else if (this.stage === RaidStage.Fight) {
      this.thinkDucks();
      this.stepKeep();
      this.push.step(this.tick);
      this.hunts.step(this.tick, this.now, true);
      this.hunts.stepDrops(this.tick, (id, kind) => this.takeDrop(id, kind));
      this.regen();
      this.bleed();
      if (this.stage === RaidStage.Fight && this.push.complete) this.clearObjective();
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
      // The pistol's reserve only: a katana duck's rifle slot holds its blade state (raid/blade.ts). No pistol yet: nothing to take.
      if ((s.arms & (1 << WeaponId.Pistol)) === 0) return false;
      const pistol = weaponStats(WeaponId.Pistol);
      if (s.res1 >= pistol.reserve) return false;
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
      if (this.stage !== RaidStage.Fight) return;
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
        if (this.stage === RaidStage.Fight) this.keep.damageGate(amount);
      },
      damageCore: (amount: number) => {
        if (this.stage !== RaidStage.Fight) return;
        this.keep.damageCore(amount);
        if (this.keep.coreHp <= 0) this.checkFail();
      },
      shotFx: (h: HunterAgent, traces: readonly ShotTrace[], weapon: number) => this.rev.hunterShot(h, traces, weapon),
      hunterDown: (h: HunterAgent, killerId: string | null, head: boolean, how: number) => {
        this.teamKills++;
        const killer = killerId ? (this.seats.get(killerId) ?? null) : null;
        const kd = killerId ? this.ducks.get(killerId) : undefined;
        // XP counts (minions apart, a boss's whistled helpers give none), the combo bonus, the storm meter, streaks: blade.ts.
        if (kd && killer) {
          this.blade.onKill(killer, kd, h);
          if (!h.helper) killer.kills++;
        }
        this.push.hunterDown(h);
        // Boss XP only for a real defeat by a duck (never for one that left without a killer).
        if (h.kind === HunterKind.Boss && killerId) for (const id of h.hurtBy) {
          const d = this.ducks.get(id);
          if (d) d.bossKills++;
        }
        this.rev.hunterDown(h, killer, head, how);
        if (killer) this.rev.self(killer);
      },
      whistle: (h: HunterAgent) => this.rev.whistle(h),
      swingHit: (h: HunterAgent, id: string) => this.hurtDuck(id, (h.kind === HunterKind.Beater ? this.rules.blade.beaterDamage : this.rules.blade.recruitDamage) * this.rules.hunterDamageScale, h.x, h.z, h.kind, false),
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
      raiseRefused: (by: Seat | null) => {
        if (by && this.seats.has(by.id)) this.rev.leverDenied(by, LeverDenied.DuckOnBridge, 0);
      },
      overheat: (seat: Seat, i: number) => this.rev.overheat(seat, i),
      loafLaunched: (l: Loaf) => this.rev.loafLaunched(l, this.seats.get(l.owner) ?? null),
      loafBoom: (l: Loaf, x: number, y: number, z: number, hitId: string) => {
        this.rev.loafBoom(l, x, y, z);
        if (this.stage !== RaidStage.Fight) return;
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
    this.beginObjective(Math.max(1, Math.min(RAID.objectives, Math.floor(wave))));
  }

  /** Tests and the e2e (test hooks): take the objective in play now (it then clears as usual). */
  defeatWave(): void {
    if (this.stage !== RaidStage.Fight) return;
    this.push.completeNow();
  }

  /** Tests and the e2e (test hooks): every move for this duck for the rest of this run (in memory only; its stored level is untouched). */
  unlockAll(seat: Seat): void {
    const d = this.ducks.get(seat.id);
    if (!d) return;
    d.kit = { ...d.kit, unlocks: ALL_SKILLS };
    d.locked = 0;
    d.noStorm = false;
    const s = seat.sim;
    s.arms |= 1 << WeaponId.Pistol;
    if (s.mag1 <= 0 && s.res1 <= 0) {
      s.mag1 = weaponStats(WeaponId.Pistol).magSize;
      s.res1 = weaponStats(WeaponId.Pistol).reserve;
    }
    s.ex = ((s.ex | 0) & ~EX_HEAVY_LOCK) >>> 0;
  }

  /** Tests and the e2e (test hooks): fill a duck's Blade Storm meter. */
  fillMeter(seat: Seat): void {
    const d = this.ducks.get(seat.id);
    if (!d || d.noStorm) return;
    d.meter = 100;
    setStormMeter(seat.sim, 100);
  }

  /** Tests and the e2e (test hooks): move a duck to `short` meters before the objective's marker (on the way from the drawbridge), facing it. */
  moveToGoal(seat: Seat, short: number): void {
    const r = this.push.rally;
    const b = this.geometry.bridge;
    const g = { x: b.x + b.dx * (b.len + 3), z: b.z + b.dz * (b.len + 3) };
    const dx = g.x - r.x;
    const dz = g.z - r.z;
    const d = Math.hypot(dx, dz) || 1;
    const x = r.x + (dx / d) * Math.min(short, d);
    const z = r.z + (dz / d) * Math.min(short, d);
    const nav = this.o.nav();
    const p = nav?.closest({ x, y: r.y + 1, z }, { x: 3, y: 6, z: 3 }) ?? { x, y: r.y, z };
    const s = seat.sim;
    s.x = p.x;
    s.z = p.z;
    s.y = groundHeightAt(this.sim, p.x, p.y + 2, p.z);
    s.vx = 0;
    s.vy = 0;
    s.vz = 0;
    s.yaw = Math.atan2(-(r.x - p.x), -(r.z - p.z));
    setMan(s, 0);
  }

  /** Tests and the performance check (test hooks): `n` hunters in packs around a duck (a fifth of them elites), past the live cap. */
  hordeAround(seat: Seat, n: number): void {
    const me = { x: seat.sim.x, y: seat.sim.y, z: seat.sim.z };
    const kinds = [HunterKind.Beater, HunterKind.Recruit, HunterKind.Beater, HunterKind.Recruit, HunterKind.Rifleman];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 14 + (i % 3) * 5;
      const at = { x: me.x + Math.cos(a) * r, y: me.y, z: me.z + Math.sin(a) * r };
      this.hunts.spawnGroup(kinds[i % kinds.length]!, 1, at, me, 0, true);
    }
  }

  /** Tests and the e2e (test hooks): a pack of `n` minions (and its elites) a few meters in front of a duck, charging it. */
  packAt(seat: Seat, n: number, dist = 9): void {
    const fx = -Math.sin(seat.sim.yaw);
    const fz = -Math.cos(seat.sim.yaw);
    const at = { x: seat.sim.x + fx * dist, y: seat.sim.y, z: seat.sim.z + fz * dist };
    const me = { x: seat.sim.x, y: seat.sim.y, z: seat.sim.z };
    const pack = this.hunts.spawnGroup(HunterKind.Beater, Math.ceil(n / 2), at, me, 1.0).concat(this.hunts.spawnGroup(HunterKind.Recruit, Math.floor(n / 2), { x: at.x + fz, y: at.y, z: at.z - fx }, me, 1.0));
    for (const h of pack) h.yaw = Math.atan2(fx, fz);
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

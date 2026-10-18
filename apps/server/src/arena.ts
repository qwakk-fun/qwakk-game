/**
 * The authoritative combat core shared by every mode (deathmatch, battle
 * royale): seats, one input path for humans and bots, shot validation with
 * lag compensation, damage, player separation and the hitbox history. Free
 * of any networking, so it runs (and is tested) headless.
 */
import {
  clampAngleRate,
  COMBAT,
  damageAt,
  Mode,
  nudgePlayer,
  resolveShot,
  ShotOutcome,
  sanitizeInputFields,
  spreadSeed,
  stepPlayer,
  NET,
  Button,
  DT,
  DEFAULT_CHARACTER,
  KNOCK,
  pickBotCharacter,
  type InputFrame,
  type PlayerSim,
  type ShotResult,
  type SimWorld,
} from '@qwakk/shared';
import { LagHistory } from './lagComp.ts';
import { serverWeapon } from './settings/weapons.ts';

export interface BotTarget {
  id: string;
  x: number;
  y: number;
  z: number;
  alive: boolean;
  /** Team number (0: none). A bot is never handed its own teammates as targets. */
  team: number;
  /** Spawn protected right now (public: the duck blinks). Bots do not shoot at it. */
  protect: boolean;
  /** Respawn counter: a new life is a new target for a bot (fresh reaction time). */
  life: number;
}

/** What drives a bot seat: one input frame per tick, through the same path as a human's. */
export interface BotLike {
  think(self: PlayerSim, others: readonly BotTarget[], tick: number): InputFrame;
  respawned(self: PlayerSim): void;
  /** Hit by someone: roughly where the shot came from (like a damage indicator). */
  damagedFrom(x: number, z: number): void;
}

export interface Seat {
  id: string;
  pid: number;
  name: string;
  bot: BotLike | null;
  sim: PlayerSim;
  kills: number;
  deaths: number;
  /** Damage dealt (battle royale results). */
  dealt: number;
  /** Spawn protection ticks left. */
  protect: number;
  /** Tick to respawn at, or -1 while alive. */
  respawnAt: number;
  /** Shoulder side of the last input (+1 right, -1 left). */
  side: number;
  /** How far behind the server clock this player renders others (ms), from its last real input. */
  viewLagMs: number;
  /** Round trip measured by the server (WebSocket ping/pong), or -1 before the first sample. Bounds the rewind. */
  rttMs: number;
  /** Respawn counter and the yaw the duck spawned facing (the client turns its camera to it). */
  life: number;
  spawnYaw: number;
  spawnTick: number;
  /** Team (battle royale) or party ally group (deathmatch); 0: none. Same nonzero team: no damage, always in view. */
  team: number;
  /** The duck it looks like (`characters.ts` id): the human's validated pick, or balanced for bots. Looks only. */
  character: number;
  /** Knocked: who knocked it (the kill is theirs if it bleeds out) and the tick it went down. */
  knockedBy: string | null;
  downTick: number;
  /** The knocked teammate this duck is reviving (holding Use), and for how many ticks. */
  reviveOf: string | null;
  reviveTicks: number;
}

/** Everything the room needs to tell clients. */
export interface ArenaEvents {
  shot(shooter: Seat, weapon: number, r: ShotResult): void;
  hit(shooter: Seat, victim: Seat, damage: number, head: boolean, killed: boolean, knocked: boolean): void;
  /** A duck was knocked (team modes). `by` null: the zone. */
  knock?(by: Seat | null, victim: Seat, weapon: number, head: boolean): void;
  /** `from` is null for zone damage. */
  damaged(victim: Seat, from: Seat | null, damage: number): void;
  /** `killer` is null for the zone (or a duck that left). */
  kill(killer: Seat | null, victim: Seat, weapon: number, head: boolean): void;
}

export interface ArenaOptions {
  /** True when `targetId` was drawn from the far (10 Hz, later) timeline by `viewerId` at the time its shot was taken. */
  isFar?: (viewerId: string, targetId: string, nowMs: number, rttMs: number) => boolean;
  farExtraDelayMs?: number;
  /** Fixed spread secret (tests only, so shots land the same every run). Random per round otherwise. */
  secret?: number;
}

const PLAYER_RADIUS = 0.35;

/** Kill event "weapon" for a knocked duck that bled out or whose team has nobody standing. */
export const KILL_BLEED = -3;

export function randomSecret(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] as number;
}

export abstract class Arena {
  readonly seats = new Map<string, Seat>();
  readonly history = new LagHistory(12);
  /** Kills in total (stats for tests and the HUD). */
  totalKills = 0;
  protected nextPid = 1;
  /** Per-round secret mixed into every shot's spread seed; never sent to clients. */
  protected secret = randomSecret();
  protected now = 0;
  protected tick = 0;
  protected readonly sim: SimWorld;
  protected readonly ev: ArenaEvents;
  private readonly ao: ArenaOptions;
  private readonly botView: BotTarget[] = [];

  constructor(sim: SimWorld, options: ArenaOptions, events: ArenaEvents) {
    this.sim = sim;
    this.ao = options;
    this.ev = events;
    if (options.secret !== undefined) this.secret = options.secret;
  }

  get world(): SimWorld {
    return this.sim;
  }

  get currentTick(): number {
    return this.tick;
  }

  get nowMs(): number {
    return this.now;
  }

  get humans(): number {
    let n = 0;
    for (const s of this.seats.values()) if (!s.bot) n++;
    return n;
  }

  /** Can damage be dealt right now (round running, not warm-up)? */
  protected abstract damageOn(): boolean;
  /** A duck died (hp reached 0). `killer` null: the zone. */
  protected abstract onKilled(killer: Seat | null, victim: Seat, weapon: number, head: boolean): void;

  /** Damage after armor and other mode rules. Deathmatch: unchanged. */
  protected adjustDamage(_victim: Seat, raw: number, _head: boolean): number {
    return raw;
  }

  /** May this duck be knocked instead of killed right now? Only the battle royale team modes say yes. */
  protected canKnock(_victim: Seat): boolean {
    return false;
  }

  /** Teammates (the same nonzero team), never yourself. Teammates cannot hurt each other and always see each other. */
  allies(a: Seat, b: Seat): boolean {
    return a !== b && a.team > 0 && a.team === b.team;
  }

  /** Spawn protected right now (deathmatch): takes no damage, shots pass through it. */
  isProtected(id: string): boolean {
    return (this.seats.get(id)?.protect ?? 0) > 0;
  }

  private anyProtected(): boolean {
    for (const s of this.seats.values()) if (s.protect > 0) return true;
    return false;
  }

  alliesById(a: string, b: string): boolean {
    const sa = this.seats.get(a);
    const sb = this.seats.get(b);
    return !!sa && !!sb && this.allies(sa, sb);
  }

  /** `character`: a human's pick, already validated (characterFromOption). Bots get the duck the room has fewest of. */
  protected makeSeat(id: string, name: string, bot: BotLike | null, sim: PlayerSim, team = 0, character = DEFAULT_CHARACTER): Seat {
    const pid = this.nextPid++;
    if (bot) character = pickBotCharacter([...this.seats.values()].map((s) => s.character), pid);
    const seat: Seat = {
      id, pid, name, bot, sim, kills: 0, deaths: 0, dealt: 0, protect: 0, respawnAt: -1, side: 1, viewLagMs: 0, rttMs: -1, life: 0, spawnYaw: 0, spawnTick: 0,
      team, character, knockedBy: null, downTick: 0, reviveOf: null, reviveTicks: 0,
    };
    this.seats.set(id, seat);
    return seat;
  }

  /** Start of a tick: remember the server time for shots in this tick. */
  beginTick(tick: number, nowMs: number): void {
    this.tick = tick;
    this.now = nowMs;
  }

  /**
   * One input for one player: step movement and weapon, then validate any shot
   * against the targets as this player saw them (`viewTimeMs`, server clock).
   */
  applyInput(seat: Seat, f: InputFrame, viewTimeMs: number): void {
    // Same path for everyone. Human input was already sanitized on decode by
    // this same function (defineInput); running it twice could shift a
    // normalized axis by a float ulp and break prediction, so only bots here.
    // Then the turn-rate cap, except right after a spawn while the client
    // turns its camera to the spawn yaw.
    if (seat.bot) sanitizeInputFields(f);
    if (this.tick - seat.spawnTick >= COMBAT.spawnTurnGraceTicks) clampAngleRate(seat.sim.yaw, seat.sim.pitch, f);
    seat.side = f.buttons & Button.ShoulderLeft ? -1 : 1;
    // The fire button ends spawn protection at once, before the step, so the shot this input fires counts
    // normally (a protected duck never deals damage: it has to drop its protection to shoot). Stand-in
    // steps never carry fire, and moving, reloading or switching weapons keep it.
    if (f.buttons & Button.Fire) seat.protect = 0;
    if (!seat.bot) seat.viewLagMs = Math.max(0, Math.min(COMBAT.maxRewindMs, this.now - viewTimeMs));
    this.beforeStep(seat, f);
    const shot = stepPlayer(this.sim, seat.sim, f, DT);
    this.afterStep(seat, f);
    if (!shot) return;
    const viewTime = Math.max(this.now - this.maxRewindFor(seat), Math.min(this.now, viewTimeMs));
    const isFar = this.ao.isFar;
    const extra = this.ao.farExtraDelayMs ?? 0;
    const rtt = Math.max(0, seat.rttMs);
    let targets = this.history.sample(viewTime, isFar ? (id, t) => (isFar(seat.id, id, this.now, rtt) ? Math.max(this.now - COMBAT.maxRewindMs, t - extra) : t) : undefined);
    // No friendly fire: shots pass through teammates; and through spawn-protected ducks, which take no
    // damage (the client predicts the same for both, so tracers and hit markers match).
    if (seat.team > 0 || this.anyProtected()) targets = targets.filter((t) => !this.alliesById(seat.id, t.id) && !this.isProtected(t.id));
    const r = resolveShot(this.sim, seat.sim, seat.id, seat.side, shot, spreadSeed(this.secret, seat.pid), targets);
    this.onShot(seat);
    this.ev.shot(seat, shot.weapon, r);
    if (r.outcome !== ShotOutcome.Body && r.outcome !== ShotOutcome.Head) return;
    const victim = this.seats.get(r.targetId);
    if (!victim || !victim.sim.alive || victim.protect > 0 || seat.protect > 0 || !this.damageOn() || this.allies(seat, victim)) return;
    const head = r.outcome === ShotOutcome.Head;
    // Damage numbers are server only (the admin settings may change them): settings/weapons.ts.
    const raw = damageAt(serverWeapon(shot.weapon), r.distance, head);
    const down = victim.sim.down === 1;
    // A knocked duck has no armor left to speak of: its bleed meter takes the raw hit, scaled.
    const dmg = Math.min(victim.sim.hp, down ? raw * KNOCK.damageScale : this.adjustDamage(victim, raw, head));
    victim.sim.hp -= dmg;
    seat.dealt += dmg;
    const out = victim.sim.hp <= 0;
    const knocked = out && !down && this.canKnock(victim);
    const killed = out && !knocked;
    this.onHit(seat, victim, head, killed);
    this.ev.hit(seat, victim, dmg, head, killed, knocked);
    this.ev.damaged(victim, seat, dmg);
    // Bots read the damage indicator: a rough direction, not the exact spot.
    victim.bot?.damagedFrom(seat.sim.x + (Math.random() - 0.5) * 8, seat.sim.z + (Math.random() - 0.5) * 8);
    if (knocked) this.knock(seat, victim, shot.weapon, head);
    else if (killed) this.kill(seat, victim, shot.weapon, head);
  }

  /**
   * Knock a duck down instead of killing it (team modes): it crawls with a
   * bleed meter as its health until a teammate revives it, it bleeds out, or
   * it is finished. Server rule; the sim only reads `down` for the crawl.
   */
  protected knock(by: Seat | null, victim: Seat, weapon: number, head: boolean): void {
    const s = victim.sim;
    s.down = 1;
    s.hp = KNOCK.hp;
    s.heal = 0;
    s.healKind = 0;
    s.reload = 0;
    s.aim = 0;
    victim.knockedBy = by?.id ?? null;
    victim.downTick = this.tick;
    victim.reviveOf = null;
    victim.reviveTicks = 0;
    this.ev.knock?.(by, victim, weapon, head);
  }

  /** Back up from a knock with a little health. */
  protected revive(seat: Seat): void {
    seat.sim.down = 0;
    seat.sim.hp = KNOCK.reviveHp;
    seat.knockedBy = null;
  }

  /** Mode-specific statistics, only for actual shots and validated damaging hits. */
  protected onShot(_seat: Seat): void {}
  protected onHit(_shooter: Seat, _victim: Seat, _head: boolean, _killed: boolean): void {}

  /** Hooks around the sim step (battle royale: plane ejection before, pickups after). */
  protected beforeStep(_seat: Seat, _f: InputFrame): void {}
  protected afterStep(_seat: Seat, _f: InputFrame): void {}

  /** Damage from the world (the zone): no armor, no attacker. */
  worldDamage(victim: Seat, amount: number): void {
    if (!victim.sim.alive || amount <= 0) return;
    const down = victim.sim.down === 1;
    const dmg = Math.min(victim.sim.hp, amount);
    victim.sim.hp -= dmg;
    this.ev.damaged(victim, null, dmg);
    if (victim.sim.hp > 0) return;
    if (down) this.kill(this.seats.get(victim.knockedBy ?? '') ?? null, victim, KILL_BLEED, false);
    else if (this.canKnock(victim)) this.knock(null, victim, -1, false);
    else this.kill(null, victim, -1, false);
  }

  protected kill(killer: Seat | null, victim: Seat, weapon: number, head: boolean): void {
    victim.sim.alive = 0;
    victim.sim.hp = 0;
    victim.sim.down = 0;
    victim.reviveOf = null;
    victim.reviveTicks = 0;
    victim.sim.heal = 0;
    victim.sim.healKind = 0;
    victim.deaths++;
    if (killer && killer !== victim) killer.kills++;
    this.totalKills++;
    this.ev.kill(killer, victim, weapon, head);
    this.onKilled(killer, victim, weapon, head);
  }

  /**
   * How far back this player's shots may be judged (ms). The client claims a
   * view time; the server only accepts what its own round-trip measurement
   * explains: half the RTT, the interpolation delay and its output spring, a
   * margin, never more than the hard cap. Bots never rewind.
   */
  maxRewindFor(seat: Seat): number {
    if (seat.bot) return 0;
    const rtt = seat.rttMs >= 0 ? seat.rttMs : 100;
    return Math.min(COMBAT.maxRewindMs, rtt / 2 + NET.interpDelayMs + NET.remoteSmoothMs + COMBAT.rewindMarginMs);
  }

  /** The view time to use for a stand-in step (no fresh input): the last known lag. */
  standInViewTime(seat: Seat): number {
    return this.now - seat.viewLagMs;
  }

  /** Every bot thinks once and acts through applyInput. Bots see everyone's position but act only on what is in line of sight (bots.ts). */
  protected thinkBots(): void {
    const view = this.botView;
    view.length = 0;
    for (const s of this.seats.values()) {
      view.push({ id: s.id, x: s.sim.x, y: s.sim.y, z: s.sim.z, alive: s.sim.alive === 1 && s.sim.mode !== Mode.Plane, team: s.team, protect: s.protect > 0, life: s.life });
    }
    for (const s of this.seats.values()) {
      if (!s.bot) continue;
      // Teammates are never targets.
      const others = view.filter((o) => o.id !== s.id && (s.team === 0 || o.team !== s.team));
      this.applyInput(s, s.bot.think(s.sim, others, this.tick), this.now);
    }
  }

  /** Push overlapping players apart (server only, not predicted; corrections are small and smoothed). */
  protected separate(): void {
    const list = [...this.seats.values()].filter((s) => s.sim.alive && s.sim.mode === Mode.Ground);
    const min = PLAYER_RADIUS * 2;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = (list[i] as Seat).sim;
        const b = (list[j] as Seat).sim;
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
        const push = (min - d) / 2;
        nudgePlayer(this.sim, a, -dx * push, -dz * push);
        nudgePlayer(this.sim, b, dx * push, dz * push);
      }
    }
  }

  /** Hitbox history for lag compensation: ducks in the plane are not in the world. */
  protected recordHistory(): void {
    this.history.record(
      this.now,
      [...this.seats.values()].map((s) => ({ id: s.id, x: s.sim.x, y: s.sim.y, z: s.sim.z, crouch: s.sim.crouch, alive: s.sim.alive && s.sim.mode !== Mode.Plane ? 1 : 0 })),
    );
  }
}

/**
 * Deathmatch rules and the authoritative combat loop, free of any networking
 * so it runs (and is tested) headless. The room feeds it human inputs; bots
 * think here and go through the very same `applyInput` path.
 */
import {
  clampAngleRate,
  COMBAT,
  createPlayerSim,
  damageAt,
  groundHeightAt,
  MATCH,
  nudgePlayer,
  resolveShot,
  ShotOutcome,
  sanitizeInputFields,
  spreadSeed,
  stepPlayer,
  NET,
  Button,
  DT,
  TICK_RATE,
  weaponStats,
  type InputFrame,
  type PlayerSim,
  type ShotResult,
  type SimWorld,
} from '@qwakk/shared';
import { BOT_NAMES, BotBrain, type BotTarget } from './bots.ts';
import { LagHistory } from './lagComp.ts';

export interface Seat {
  id: string;
  pid: number;
  name: string;
  bot: BotBrain | null;
  sim: PlayerSim;
  hp: number;
  kills: number;
  deaths: number;
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
}

/** Everything the room needs to tell clients. */
export interface DeathmatchEvents {
  shot(shooter: Seat, weapon: number, r: ShotResult): void;
  hit(shooter: Seat, victim: Seat, damage: number, head: boolean, killed: boolean): void;
  damaged(victim: Seat, from: Seat, damage: number): void;
  kill(killer: Seat, victim: Seat, weapon: number, head: boolean): void;
  roundEnd(winner: Seat | null): void;
  roundStart(): void;
}

export interface DeathmatchOptions {
  bots: boolean;
  players: number;
  scoreLimit: number;
  roundSeconds: number;
  intermissionSeconds: number;
  /** True when `targetId` was drawn from the far (10 Hz, later) timeline by `viewerId` at the time its shot was taken. */
  isFar?: (viewerId: string, targetId: string, nowMs: number, rttMs: number) => boolean;
  farExtraDelayMs?: number;
}

const PLAYER_RADIUS = 0.35;

function randomSecret(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] as number;
}

export class Deathmatch {
  readonly seats = new Map<string, Seat>();
  readonly history = new LagHistory(12);
  phase: 'playing' | 'intermission' = 'playing';
  ticksLeft: number;
  winner = '';
  /** Kills this round and in total (stats for tests and the HUD). */
  totalKills = 0;
  private nextPid = 1;
  /** Per-round secret mixed into every shot's spread seed; never sent to clients. */
  private secret = randomSecret();
  private botCount = 0;
  private now = 0;
  private tick = 0;
  private readonly sim: SimWorld;
  private readonly o: DeathmatchOptions;
  private readonly ev: DeathmatchEvents;

  constructor(sim: SimWorld, options: DeathmatchOptions, events: DeathmatchEvents) {
    this.sim = sim;
    this.o = options;
    this.ev = events;
    this.ticksLeft = options.roundSeconds * TICK_RATE;
  }

  get humans(): number {
    let n = 0;
    for (const s of this.seats.values()) if (!s.bot) n++;
    return n;
  }

  addHuman(id: string, name: string): Seat {
    const seat = this.makeSeat(id, name, null);
    this.fillBots();
    return seat;
  }

  remove(id: string): void {
    this.seats.delete(id);
    this.fillBots();
  }

  /** Keep humans plus bots at the configured player count. */
  fillBots(): void {
    if (!this.o.bots) return;
    const humans = this.humans;
    let total = this.seats.size;
    // Bots only exist while at least one human is playing or watching.
    const want = humans > 0 || this.allowBotsAlone ? this.o.players : 0;
    while (total > want) {
      const bot = [...this.seats.values()].find((s) => s.bot);
      if (!bot) break;
      this.seats.delete(bot.id);
      total--;
    }
    while (total < want) {
      this.botCount++;
      const name = `${BOT_NAMES[(this.botCount - 1) % BOT_NAMES.length]} (bot)`;
      this.makeSeat(`bot-${this.botCount}`, name, new BotBrain(this.sim));
      total++;
    }
  }

  /** Spectators count as watchers, so bots keep playing for them. */
  allowBotsAlone = false;

  private makeSeat(id: string, name: string, bot: BotBrain | null): Seat {
    const sim = createPlayerSim(0, -100, 0);
    const seat: Seat = { id, pid: this.nextPid++, name, bot, sim, hp: COMBAT.maxHp, kills: 0, deaths: 0, protect: 0, respawnAt: -1, side: 1, viewLagMs: 0, rttMs: -1, life: 0, spawnYaw: 0, spawnTick: 0 };
    this.seats.set(id, seat);
    this.spawn(seat);
    return seat;
  }

  /** Spawn at the arena point farthest from living enemies (random among the best few). */
  spawn(seat: Seat): void {
    const pts = this.sim.map.arenaSpawns.length > 0 ? this.sim.map.arenaSpawns : this.sim.map.spawns;
    const enemies = [...this.seats.values()].filter((s) => s !== seat && s.sim.alive && s.respawnAt < 0);
    const scored = pts.map((p) => {
      let d = Infinity;
      for (const e of enemies) d = Math.min(d, Math.hypot(e.sim.x - p[0], e.sim.z - p[2]));
      return { p, d };
    });
    scored.sort((a, b) => b.d - a.d);
    const pick = scored[Math.floor(Math.random() * Math.min(3, scored.length))]?.p ?? [0, 10, 0];
    const y = groundHeightAt(this.sim, pick[0], pick[1] + 3, pick[2]);
    // Face the arena center.
    const yaw = Math.atan2(pick[0], pick[2]);
    const fresh = createPlayerSim(pick[0], y, pick[2], yaw);
    Object.assign(seat.sim, fresh);
    seat.hp = COMBAT.maxHp;
    seat.protect = COMBAT.protectTicks;
    seat.respawnAt = -1;
    seat.life++;
    seat.spawnYaw = fresh.yaw;
    seat.spawnTick = this.tick;
    seat.bot?.respawned(seat.sim);
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
    if (!seat.bot) seat.viewLagMs = Math.max(0, Math.min(COMBAT.maxRewindMs, this.now - viewTimeMs));
    const shot = stepPlayer(this.sim, seat.sim, f, DT);
    if (!shot) return;
    seat.protect = 0; // firing ends spawn protection
    const viewTime = Math.max(this.now - this.maxRewindFor(seat), Math.min(this.now, viewTimeMs));
    const isFar = this.o.isFar;
    const extra = this.o.farExtraDelayMs ?? 0;
    const rtt = Math.max(0, seat.rttMs);
    const targets = this.history.sample(viewTime, isFar ? (id, t) => (isFar(seat.id, id, this.now, rtt) ? Math.max(this.now - COMBAT.maxRewindMs, t - extra) : t) : undefined);
    const r = resolveShot(this.sim, seat.sim, seat.id, seat.side, shot, spreadSeed(this.secret, seat.pid), targets);
    this.ev.shot(seat, shot.weapon, r);
    if (r.outcome !== ShotOutcome.Body && r.outcome !== ShotOutcome.Head) return;
    const victim = this.seats.get(r.targetId);
    if (!victim || !victim.sim.alive || victim.protect > 0 || this.phase !== 'playing') return;
    const head = r.outcome === ShotOutcome.Head;
    const dmg = Math.min(victim.hp, damageAt(weaponStats(shot.weapon), r.distance, head));
    victim.hp -= dmg;
    const killed = victim.hp <= 0;
    this.ev.hit(seat, victim, dmg, head, killed);
    this.ev.damaged(victim, seat, dmg);
    victim.bot?.damagedFrom(seat.sim.x, seat.sim.z);
    if (killed) this.killed(seat, victim, shot.weapon, head);
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

  private killed(killer: Seat, victim: Seat, weapon: number, head: boolean): void {
    victim.sim.alive = 0;
    victim.hp = 0;
    victim.deaths++;
    victim.respawnAt = this.tick + COMBAT.respawnTicks;
    if (killer !== victim) killer.kills++;
    this.totalKills++;
    this.ev.kill(killer, victim, weapon, head);
    if (killer.kills >= this.o.scoreLimit) this.endRound(killer);
  }

  /** End of a tick: bots, timers, respawns, player separation, round clock, lag history. */
  endTick(): void {
    const others: BotTarget[] = [];
    for (const s of this.seats.values()) others.push({ id: s.id, x: s.sim.x, y: s.sim.y, z: s.sim.z, alive: s.sim.alive === 1 });
    for (const s of this.seats.values()) {
      if (!s.bot) continue;
      const view = others.filter((o) => o.id !== s.id);
      this.applyInput(s, s.bot.think(s.sim, view, this.tick), this.now);
    }

    for (const s of this.seats.values()) {
      if (s.protect > 0) s.protect--;
      if (s.respawnAt >= 0 && this.tick >= s.respawnAt) this.spawn(s);
      if (s.sim.alive && s.sim.y < -30) this.spawn(s);
    }
    this.separate();

    this.ticksLeft--;
    if (this.ticksLeft <= 0) {
      if (this.phase === 'playing') this.endRound(this.leader());
      else this.startRound();
    }

    this.history.record(
      this.now,
      [...this.seats.values()].map((s) => ({ id: s.id, x: s.sim.x, y: s.sim.y, z: s.sim.z, crouch: s.sim.crouch, alive: s.sim.alive })),
    );
  }

  private leader(): Seat | null {
    let best: Seat | null = null;
    for (const s of this.seats.values()) if (!best || s.kills > best.kills) best = s;
    return best;
  }

  private endRound(winner: Seat | null): void {
    this.phase = 'intermission';
    this.winner = winner?.name ?? '';
    this.ticksLeft = this.o.intermissionSeconds * TICK_RATE;
    this.ev.roundEnd(winner);
  }

  private startRound(): void {
    this.phase = 'playing';
    this.secret = randomSecret();
    this.winner = '';
    this.ticksLeft = this.o.roundSeconds * TICK_RATE;
    for (const s of this.seats.values()) {
      s.kills = 0;
      s.deaths = 0;
    }
    for (const s of this.seats.values()) this.spawn(s);
    this.ev.roundStart();
  }

  /** Push overlapping players apart (server only, not predicted; corrections are small and smoothed). */
  private separate(): void {
    const list = [...this.seats.values()].filter((s) => s.sim.alive);
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

  get secondsLeft(): number {
    return Math.max(0, Math.ceil(this.ticksLeft / TICK_RATE));
  }
}

export const DEFAULT_DM: Omit<DeathmatchOptions, 'bots'> = {
  players: MATCH.players,
  scoreLimit: MATCH.scoreLimit,
  roundSeconds: MATCH.roundSeconds,
  intermissionSeconds: MATCH.intermissionSeconds,
};

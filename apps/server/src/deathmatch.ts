/**
 * Deathmatch rules on top of the shared combat core (arena.ts): spawns,
 * respawns, rounds and the score limit. The room feeds it human inputs;
 * bots think here and go through the very same `applyInput` path.
 *
 * Seats: humans plus bots are always `players` (24) while anyone plays or
 * watches. A joining human takes a bot's seat (a dead bot first, else the bot
 * farthest from every human, so nobody sees a duck vanish mid-fight); a
 * leaving human's seat goes back to a new bot. With no humans and no
 * spectators the room holds no seats at all and its clock stands still
 * (idle: no bots think, nothing is simulated); the next human starts a fresh
 * round.
 */
import { COMBAT, createPlayerSim, groundHeightAt, MATCH, OPAQUE_QUERY_GROUPS, TICK_RATE, type SimWorld, type Vec3 } from '@qwakk/shared';
import { Arena, randomSecret, type ArenaEvents, type ArenaOptions, type BotLike, type Seat } from './arena.ts';
import { BOT_NAMES, BotBrain } from './bots.ts';

export type { BotTarget, Seat } from './arena.ts';

/** Everything the room needs to tell clients. */
export interface DeathmatchEvents extends ArenaEvents {
  roundEnd(winner: Seat | null): void;
  roundStart(): void;
}

export interface DeathmatchOptions extends ArenaOptions {
  bots: boolean;
  players: number;
  scoreLimit: number;
  roundSeconds: number;
  intermissionSeconds: number;
  /** Bot brain factory (the server passes navmesh bots on map_v1 maps); default: the steering brain. */
  createBot?: (sim: SimWorld, seatId: string) => BotLike;
}

export class Deathmatch extends Arena {
  phase: 'playing' | 'intermission' = 'playing';
  ticksLeft: number;
  winner = '';
  private botCount = 0;
  private readonly o: DeathmatchOptions;
  private readonly dev: DeathmatchEvents;
  /** Spawn points used lately (index to tick), so two ducks do not spawn on the same spot. */
  private readonly usedSpawns = new Map<number, number>();

  constructor(sim: SimWorld, options: DeathmatchOptions, events: DeathmatchEvents) {
    super(sim, options, events);
    this.o = options;
    this.dev = events;
    this.ticksLeft = options.roundSeconds * TICK_RATE;
  }

  protected damageOn(): boolean {
    return this.phase === 'playing';
  }

  /** No seats: nobody plays or watches, the room idles. */
  get idle(): boolean {
    return this.seats.size === 0;
  }

  /** A human takes a seat; `team` makes party members allies (no damage between them, always in view). */
  addHuman(id: string, name: string, team = 0): Seat {
    if (this.idle) this.freshRound();
    const seat = this.addSeat(id, name, null, team);
    this.fillBots();
    return seat;
  }

  remove(id: string): void {
    this.seats.delete(id);
    this.fillBots();
  }

  /** Keep humans plus bots at the configured player count (none at all without a human or spectator). */
  fillBots(): void {
    const humans = this.humans;
    const want = !this.o.bots ? humans : humans > 0 || this.allowBotsAlone ? Math.max(humans, this.o.players) : 0;
    if (this.idle && want > 0) this.freshRound();
    while (this.seats.size > want) {
      const bot = this.botToRemove();
      if (!bot) break;
      this.seats.delete(bot.id);
    }
    while (this.seats.size < want) {
      this.botCount++;
      const id = `bot-${this.botCount}`;
      this.addSeat(id, this.botName(), this.o.createBot ? this.o.createBot(this.sim, id) : new BotBrain(this.sim));
    }
  }

  /** Spectators count as watchers, so bots keep playing for them. */
  allowBotsAlone = false;

  /**
   * The bot whose seat a joining human takes: a dead one (it is off screen
   * anyway), else the one farthest from every human.
   */
  private botToRemove(): Seat | null {
    let best: Seat | null = null;
    let bestScore = -Infinity;
    const humans = [...this.seats.values()].filter((s) => !s.bot && s.sim.alive);
    for (const s of this.seats.values()) {
      if (!s.bot) continue;
      let d = 1e6;
      for (const h of humans) d = Math.min(d, Math.hypot(h.sim.x - s.sim.x, h.sim.z - s.sim.z));
      const score = (s.sim.alive ? 0 : 2e6) + d;
      if (score > bestScore) {
        best = s;
        bestScore = score;
      }
    }
    return best;
  }

  /** A bot name nobody in the room uses right now. */
  private botName(): string {
    const used = new Set([...this.seats.values()].map((s) => s.name));
    for (let i = 0; i < BOT_NAMES.length; i++) {
      const name = `${BOT_NAMES[(this.botCount - 1 + i) % BOT_NAMES.length]} (bot)`;
      if (!used.has(name)) return name;
    }
    return `Duck ${this.botCount} (bot)`;
  }

  private addSeat(id: string, name: string, bot: BotLike | null, team = 0): Seat {
    const seat = this.makeSeat(id, name, bot, createPlayerSim(0, -100, 0), team);
    this.spawn(seat);
    return seat;
  }

  /**
   * Respawn at a point far from living enemies and out of their sight: going
   * from the point farthest from the nearest enemy down (a point used in the
   * last spawnReuseTicks counts as taken), keep up to MATCH.spawnCandidates
   * points at least spawnMinEnemyDistance from every enemy that no enemy
   * within spawnSightRange has a clear line of sight to, testing at most
   * spawnScanMax points; pick one of those at random. If none qualifies, a
   * random one of the three farthest. Then spawn protection
   * (SPAWN_PROTECTION) covers the first moments.
   */
  spawn(seat: Seat): void {
    const map = this.sim.map;
    const fromArena = map.arenaSpawns.length > 0;
    const pts = fromArena ? map.arenaSpawns : map.spawns;
    const enemies = [...this.seats.values()].filter((s) => s !== seat && s.sim.alive && s.respawnAt < 0 && !this.allies(seat, s));
    for (const [i, t] of this.usedSpawns) if (this.tick - t > MATCH.spawnReuseTicks || t > this.tick) this.usedSpawns.delete(i);
    const scored = pts.map((p, i) => {
      let d = Infinity;
      for (const e of enemies) d = Math.min(d, Math.hypot(e.sim.x - p[0], e.sim.z - p[2]));
      if (this.usedSpawns.has(i)) d = Math.min(d, 0.5);
      return { p, i, d };
    });
    scored.sort((a, b) => b.d - a.d);
    const unseen: typeof scored = [];
    for (let i = 0; i < Math.min(scored.length, MATCH.spawnScanMax) && unseen.length < MATCH.spawnCandidates; i++) {
      const c = scored[i] as (typeof scored)[number];
      if (c.d < MATCH.spawnMinEnemyDistance) break;
      if (!this.seenByEnemy(c.p, enemies)) unseen.push(c);
    }
    const pool = unseen.length > 0 ? unseen : scored.slice(0, 3);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const p: Vec3 = pick?.p ?? [0, 10, 0];
    if (pick) this.usedSpawns.set(pick.i, this.tick);
    // Greybox spawns are open ground (cast from above); map spawns can be under a roof, so cast from just above.
    const y = groundHeightAt(this.sim, p[0], p[1] + (map.id === 'greybox' ? 3 : 0.3), p[2]);
    const arena = map.arena;
    const given = fromArena && pick ? map.arenaYaws?.[pick.i] : undefined;
    const yaw = given ?? Math.atan2(p[0] - arena.x, p[2] - arena.z);
    const fresh = createPlayerSim(p[0], y, p[2], yaw);
    Object.assign(seat.sim, fresh);
    seat.protect = COMBAT.protectTicks;
    seat.respawnAt = -1;
    seat.life++;
    seat.spawnYaw = fresh.yaw;
    seat.spawnTick = this.tick;
    seat.bot?.respawned(seat.sim);
  }

  /** Does a living enemy within MATCH.spawnSightRange have a clear line of sight to this spawn point? */
  private seenByEnemy(p: Vec3, enemies: readonly Seat[]): boolean {
    const r2 = MATCH.spawnSightRange * MATCH.spawnSightRange;
    for (const e of enemies) {
      const dx = p[0] - e.sim.x;
      const dz = p[2] - e.sim.z;
      if (dx * dx + dz * dz > r2) continue;
      const ey = e.sim.y + 1.55;
      const dy = p[1] + 0.9 - ey;
      const d = Math.hypot(dx, dy, dz);
      if (d < 0.5) return true;
      const ray = new this.sim.rapier.Ray({ x: e.sim.x, y: ey, z: e.sim.z }, { x: dx / d, y: dy / d, z: dz / d });
      const hit = this.sim.world.castRay(ray, d, true, undefined, OPAQUE_QUERY_GROUPS);
      if (!hit || hit.timeOfImpact > d - 0.3) return true;
    }
    return false;
  }

  protected onKilled(killer: Seat | null, victim: Seat): void {
    victim.respawnAt = this.tick + COMBAT.respawnTicks;
    if (killer && killer.kills >= this.o.scoreLimit) this.endRound(killer);
  }

  /** End of a tick: bots, timers, respawns, player separation, round clock, lag history. Nothing while idle. */
  endTick(): void {
    if (this.idle) return;
    this.thinkBots();

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
    this.recordHistory();
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
    this.dev.roundEnd(winner);
  }

  private startRound(): void {
    this.freshRound();
    for (const s of this.seats.values()) {
      s.kills = 0;
      s.deaths = 0;
    }
    for (const s of this.seats.values()) this.spawn(s);
  }

  /** A new round clock and spread secret (after the intermission, or when an idle room wakes up). */
  private freshRound(): void {
    this.phase = 'playing';
    this.secret = randomSecret();
    this.winner = '';
    this.ticksLeft = this.o.roundSeconds * TICK_RATE;
    this.usedSpawns.clear();
    this.dev.roundStart();
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

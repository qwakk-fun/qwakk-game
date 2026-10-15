/**
 * Deathmatch rules on top of the shared combat core (arena.ts): spawns,
 * respawns, rounds and the score limit. The room feeds it human inputs;
 * bots think here and go through the very same `applyInput` path.
 */
import { COMBAT, createPlayerSim, groundHeightAt, MATCH, TICK_RATE, type SimWorld } from '@qwakk/shared';
import { Arena, randomSecret, type ArenaEvents, type ArenaOptions, type Seat } from './arena.ts';
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
}

export class Deathmatch extends Arena {
  phase: 'playing' | 'intermission' = 'playing';
  ticksLeft: number;
  winner = '';
  private botCount = 0;
  private readonly o: DeathmatchOptions;
  private readonly dev: DeathmatchEvents;

  constructor(sim: SimWorld, options: DeathmatchOptions, events: DeathmatchEvents) {
    super(sim, options, events);
    this.o = options;
    this.dev = events;
    this.ticksLeft = options.roundSeconds * TICK_RATE;
  }

  protected damageOn(): boolean {
    return this.phase === 'playing';
  }

  addHuman(id: string, name: string): Seat {
    const seat = this.addSeat(id, name, null);
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
      this.addSeat(`bot-${this.botCount}`, name, new BotBrain(this.sim));
      total++;
    }
  }

  /** Spectators count as watchers, so bots keep playing for them. */
  allowBotsAlone = false;

  private addSeat(id: string, name: string, bot: BotBrain | null): Seat {
    const seat = this.makeSeat(id, name, bot, createPlayerSim(0, -100, 0));
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
    const arena = this.sim.map.arena;
    const yaw = Math.atan2(pick[0] - arena.x, pick[2] - arena.z);
    const fresh = createPlayerSim(pick[0], y, pick[2], yaw);
    Object.assign(seat.sim, fresh);
    seat.protect = COMBAT.protectTicks;
    seat.respawnAt = -1;
    seat.life++;
    seat.spawnYaw = fresh.yaw;
    seat.spawnTick = this.tick;
    seat.bot?.respawned(seat.sim);
  }

  protected onKilled(killer: Seat | null, victim: Seat): void {
    victim.respawnAt = this.tick + COMBAT.respawnTicks;
    if (killer && killer.kills >= this.o.scoreLimit) this.endRound(killer);
  }

  /** End of a tick: bots, timers, respawns, player separation, round clock, lag history. */
  endTick(): void {
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
    this.phase = 'playing';
    this.secret = randomSecret();
    this.winner = '';
    this.ticksLeft = this.o.roundSeconds * TICK_RATE;
    for (const s of this.seats.values()) {
      s.kills = 0;
      s.deaths = 0;
    }
    for (const s of this.seats.values()) this.spawn(s);
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

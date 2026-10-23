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
import { DM, DmPower, freshDmStats, compareDmResults, weaponStats, WeaponId, type DmStats, type DmReward, type DmResult, COMBAT, createPlayerSim, groundHeightAt, MATCH, OPAQUE_QUERY_GROUPS, TICK_RATE, Button, type InputFrame, type SimWorld, type Vec3 } from '@qwakk/shared';
import { Arena, randomSecret, type ArenaEvents, type ArenaOptions, type BotLike, type Seat } from './arena.ts';
import { BOT_NAMES, BotBrain } from './bots.ts';
import { DmReplayHistory } from './dmReplay.ts';
import { DmPowerups } from './dmPowerups.ts';
import { dmHeroRules, spawnProtectTicks } from './settings/index.ts';
import { DmHero } from './dmHero.ts';
import { HeroPilot } from './dmHeroPilot.ts';
import { addKillStack, clearKillStacks, stackedDamage } from './dmStacks.ts';
import { DmExplosives, type ExplosiveEvents } from './dmExplosives.ts';

export type { BotTarget, Seat } from './arena.ts';

/** Everything the room needs to tell clients. */
export interface DeathmatchEvents extends ArenaEvents {
  roundEnd(winner: Seat | null): void;
  roundStart(): void;
  reward?(seat: Seat, reward: DmReward): void;
  powerup?(seat: Seat, kind: number): void;
  /** The caped hero (dmHero.ts): chosen, took the cape, or lost it. */
  hero?(event: number, hero: Seat, other: Seat | null): void;
  /** The coarse hero ping (grid meters), for everyone but the hero. */
  heroPing?(hero: Seat, x: number, z: number): void;
  /** Grenades, rockets, blasts and the launcher pickup (dmExplosives.ts). */
  explosives?: ExplosiveEvents;
}

export interface DeathmatchOptions extends ArenaOptions {
  bots: boolean;
  players: number;
  scoreLimit: number;
  roundSeconds: number;
  intermissionSeconds: number;
  /** Bot brain factory (the server passes navmesh bots on map_v1 maps); default: the steering brain. */
  createBot?: (sim: SimWorld, seatId: string) => BotLike;
  /** Round rules read at the start of every round (the admin settings); unset: the numbers above. */
  rules?: () => Pick<DeathmatchOptions, 'scoreLimit' | 'roundSeconds' | 'intermissionSeconds'>;
}

export class Deathmatch extends Arena {
  phase: 'playing' | 'intermission' = 'playing';
  ticksLeft: number;
  winner = '';
  readonly stats = new Map<string, DmStats>();
  readonly powerups: DmPowerups;
  readonly explosives: DmExplosives;
  readonly replay = new DmReplayHistory();
  readonly hero: DmHero;
  /** Per bot seat: how it flies while it wears the cape. */
  private readonly pilots = new Map<string, HeroPilot>();
  results: DmResult[] = [];
  rotationWeapon: number = WeaponId.Rifle;
  private rotationAt = 0;
  private botCount = 0;
  private readonly o: DeathmatchOptions;
  private readonly dev: DeathmatchEvents;
  /** Spawn points used lately (index to tick), so two ducks do not spawn on the same spot. */
  private readonly usedSpawns = new Map<number, number>();

  constructor(sim: SimWorld, options: DeathmatchOptions, events: DeathmatchEvents) {
    super(sim, options, events);
    this.o = options;
    this.dev = events;
    this.powerups = new DmPowerups(sim);
    this.hero = new DmHero({
      hero: (event, hero, other) => this.dev.hero?.(event, hero, other),
      ping: (hero, x, z) => this.dev.heroPing?.(hero, x, z),
      award: (hero, points) => {
        const stats = this.stats.get(hero.id);
        if (stats && this.phase === 'playing') stats.points += points;
      },
    });
    this.explosives = new DmExplosives(sim, this);
    if (events.explosives) this.explosives.events = events.explosives;
    this.ticksLeft = options.roundSeconds * TICK_RATE;
  }

  protected damageOn(): boolean {
    return this.phase === 'playing';
  }

  /** No seats: nobody plays or watches, the room idles. */
  get idle(): boolean {
    return this.seats.size === 0;
  }

  /** A human takes a seat; `team` makes party members allies (no damage between them, always in view). `character`: its validated pick. */
  addHuman(id: string, name: string, team = 0, character?: number): Seat {
    if (this.idle) this.freshRound();
    const seat = this.addSeat(id, name, null, team, character);
    this.fillBots();
    return seat;
  }

  remove(id: string): void {
    this.forgetSeat(id);
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
      this.forgetSeat(bot.id);
    }
    while (this.seats.size < want) {
      this.botCount++;
      const id = `bot-${this.botCount}`;
      this.addSeat(id, this.botName(), this.explosives.wrapBot(this.o.createBot ? this.o.createBot(this.sim, id) : new BotBrain(this.sim)));
    }
  }

  private forgetSeat(id: string): void {
    const seat = this.seats.get(id);
    if (seat) this.hero.forget(seat);
    this.pilots.delete(id);
    this.seats.delete(id);
    this.replay.remove(id);
    this.stats.delete(id);
    for (const st of this.stats.values()) if (st.lastKiller === id) st.lastKiller = null;
    if (this.idle) {
      this.powerups.reset(this.tick);
      this.explosives.reset(this.tick);
      this.results = [];
    }
  }

  /** Spectators count as watchers, so bots keep playing for them. */
  allowBotsAlone = false;

  /** Humans plus bots per room, changed live (admin settings): bots join or leave at once. */
  setPlayers(n: number): void {
    this.o.players = n;
    this.fillBots();
  }

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

  private addSeat(id: string, name: string, bot: BotLike | null, team = 0, character?: number): Seat {
    const seat = this.makeSeat(id, name, bot, createPlayerSim(0, -100, 0), team, character);
    this.stats.set(id, freshDmStats());
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
    this.equipRotation(seat, true);
    this.explosives.onSpawn(seat);
    seat.protect = spawnProtectTicks();
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

  protected override onShot(seat: Seat): void {
    if (this.phase === 'playing') this.stats.get(seat.id)!.shots++;
  }

  protected override onHit(shooter: Seat, _victim: Seat, head: boolean, killed: boolean): void {
    if (this.phase !== 'playing') return;
    const stats = this.stats.get(shooter.id)!;
    stats.hits++;
    if (head && !killed) {
      stats.points += DM.headHitPoints;
      this.dev.reward?.(shooter, { points: DM.headHitPoints, total: stats.points, streak: stats.streak, milestone: 0, head: true, revenge: false, kill: false });
    }
  }

  /** Kill stacks add damage on the shooter's side (server only). */
  protected override attackerDamage(shooter: Seat, raw: number): number {
    return stackedDamage(shooter, raw);
  }

  /** A bot wearing the cape flies in short hops (dmHeroPilot.ts), through its input frame. */
  protected override botFrame(seat: Seat, f: InputFrame): InputFrame {
    if (!this.hero.heroId && this.pilots.size === 0) return f;
    let pilot = this.pilots.get(seat.id);
    if (!pilot) this.pilots.set(seat.id, (pilot = new HeroPilot()));
    return pilot.apply(seat.sim, f, (f.buttons & Button.Fire) !== 0);
  }

  protected override adjustDamage(victim: Seat, raw: number, _head: boolean): number {
    const sim = victim.sim;
    if (sim.dmPower !== DmPower.Armor || sim.dmPowerTicks <= 0) return raw;
    const absorbed = Math.min(sim.dmShield, raw * DM.armorReduction);
    sim.dmShield = Math.max(0, sim.dmShield - absorbed);
    if (sim.dmShield === 0) { sim.dmPower = 0; sim.dmPowerTicks = 0; }
    return raw - absorbed;
  }

  /** A grenade or rocket of this step becomes a flight (dmExplosives.ts). */
  protected override afterStep(seat: Seat): void {
    this.explosives.afterStep(seat, this.phase === 'playing');
  }

  /**
   * Explosive damage (dmExplosives.ts decides who and how much): armor, the
   * attacker's hit marker, a damage arc toward the blast, kills and points as
   * for a shot. Not counted as a hit for accuracy (throws are not shots).
   */
  explosionDamage(attacker: Seat | null, victim: Seat, amount: number, weapon: number, x: number, z: number): void {
    if (!victim.sim.alive || victim.protect > 0 || !this.damageOn()) return;
    const dmg = Math.min(victim.sim.hp, Math.round(this.adjustDamage(victim, this.blastAttackerDamage(attacker, victim, amount), false)));
    if (dmg <= 0) return;
    victim.sim.hp -= dmg;
    if (attacker && attacker !== victim) attacker.dealt += dmg;
    const killed = victim.sim.hp <= 0;
    if (attacker && attacker !== victim) this.dev.explosives?.blastHit?.(attacker, victim, dmg, killed);
    this.dev.explosives?.blastDamaged?.(victim, dmg, x, z);
    victim.bot?.damagedFrom(x + (Math.random() - 0.5) * 6, z + (Math.random() - 0.5) * 6);
    if (killed) this.kill(attacker, victim, weapon, false);
  }

  /**
   * The one place an explosion's damage gets the attacker's modifiers, before
   * the victim's armor: the attacker's kill-stack damage bonus. The thrower's
   * own blast and a thrower who left get none.
   */
  protected blastAttackerDamage(attacker: Seat | null, victim: Seat, amount: number): number {
    return attacker && attacker !== victim ? stackedDamage(attacker, amount) : amount;
  }

  protected onKilled(killer: Seat | null, victim: Seat, _weapon: number, head: boolean): void {
    victim.respawnAt = this.tick + COMBAT.respawnTicks;
    victim.sim.ex = 0;
    victim.sim.dmPower = 0;
    victim.sim.dmPowerTicks = 0;
    victim.sim.dmShield = 0;
    clearKillStacks(victim);
    const enemies = !!killer && killer !== victim && !this.allies(killer, victim);
    // The hero's cape goes to its killer (dmHero.ts) or is free until the next pick.
    const heroKill = this.phase === 'playing' && this.hero.killed(this.tick, killer, victim, enemies);
    const lost = this.stats.get(victim.id)!;
    lost.streak = 0;
    lost.lastKiller = killer && killer !== victim ? killer.id : null;
    if (this.phase !== 'playing' || !killer || killer === victim || this.allies(killer, victim)) return;
    const stats = this.stats.get(killer.id)!;
    stats.streak++;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
    const revenge = stats.lastKiller === victim.id;
    if (revenge) stats.lastKiller = null;
    const bonus = DM.streakPoints[stats.streak] ?? 0;
    const heroBonus = heroKill ? dmHeroRules().killPoints : 0;
    const points = DM.killPoints + (head ? DM.headKillPoints : 0) + (revenge ? DM.revengePoints : 0) + bonus + heroBonus;
    stats.points += points;
    this.dev.reward?.(killer, { points, total: stats.points, streak: stats.streak, milestone: bonus ? stats.streak : 0, head, revenge, kill: true, ...(heroKill ? { hero: true } : {}) });
    // One more kill stack (the owner's state carries it; the client shows the toast).
    if (killer.sim.alive === 1) addKillStack(killer);
    if (killer.kills >= this.o.scoreLimit) this.endRound(killer);
  }

  /** The same single-weapon loadout for humans, bots, late joins and respawns. */
  private equipRotation(seat: Seat, ready = false): void {
    const s = seat.sim;
    s.weapon = this.rotationWeapon;
    s.arms = 1 << this.rotationWeapon;
    s.mag0 = weaponStats(WeaponId.Rifle).magSize;
    s.mag1 = weaponStats(WeaponId.Pistol).magSize;
    s.res0 = weaponStats(WeaponId.Rifle).reserve;
    s.res1 = weaponStats(WeaponId.Pistol).reserve;
    s.reload = 0;
    s.cooldown = 0;
    s.spray = 0;
    s.equip = ready ? 0 : weaponStats(this.rotationWeapon).equipTicks;
  }

  get rotationSecondsLeft(): number {
    return this.phase === 'playing' && !this.idle ? Math.max(0, Math.ceil((this.rotationAt - this.tick) / TICK_RATE)) : 0;
  }

  /** Rotate before either human inputs or bot inputs run, on the same authoritative tick. */
  override beginTick(tick: number, nowMs: number): void {
    super.beginTick(tick, nowMs);
    if (this.idle) return;
    if (this.phase === 'playing' && this.tick >= this.rotationAt) {
      this.rotationWeapon = this.rotationWeapon === WeaponId.Rifle ? WeaponId.Pistol : WeaponId.Rifle;
      this.rotationAt = this.tick + DM.rotationSeconds * TICK_RATE;
      for (const seat of this.seats.values()) this.equipRotation(seat);
    }
  }

  /** End of a tick: bots, timers, respawns, player separation, round clock, lag history. Nothing while idle. */
  endTick(): void {
    if (this.idle) return;
    this.thinkBots();
    if (this.phase === 'playing') this.powerups.step(this.tick, this.seats.values(), (seat, kind) => this.dev.powerup?.(seat, kind));
    if (this.phase === 'playing') this.hero.step(this.tick, this.seats);
    if (this.phase === 'playing') this.explosives.step(this.tick);

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
    if (this.phase === 'playing') this.replay.record(this.tick, this.seats.values());
  }

  private leader(): Seat | null {
    let best: Seat | null = null;
    for (const s of this.seats.values()) if (!best || s.kills > best.kills) best = s;
    return best;
  }

  private endRound(winner: Seat | null): void {
    if (this.phase !== 'playing') return;
    this.results = [...this.seats.values()].map((s) => {
      const st = this.stats.get(s.id)!;
      return { pid: s.pid, name: s.name, kills: s.kills, deaths: s.deaths, points: st.points, bestStreak: st.bestStreak, shots: st.shots, hits: st.hits };
    }).sort(compareDmResults);
    this.powerups.reset(this.tick);
    this.explosives.reset(this.tick);
    for (const seat of this.seats.values()) {
      seat.sim.dmPower = 0; seat.sim.dmPowerTicks = 0; seat.sim.dmShield = 0;
      seat.sim.ex = 0;
      clearKillStacks(seat);
    }
    this.hero.clear(this.seats.values());
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
      s.dealt = 0;
      this.stats.set(s.id, freshDmStats());
    }
    for (const s of this.seats.values()) this.spawn(s);
  }

  /** A new round clock and spread secret (after the intermission, or when an idle room wakes up). */
  private freshRound(): void {
    if (this.o.rules) Object.assign(this.o, this.o.rules());
    this.phase = 'playing';
    this.secret = randomSecret();
    this.winner = '';
    this.ticksLeft = this.o.roundSeconds * TICK_RATE;
    this.usedSpawns.clear();
    this.replay.clear();
    this.results = [];
    this.rotationWeapon = WeaponId.Rifle;
    this.rotationAt = this.tick + DM.rotationSeconds * TICK_RATE;
    this.powerups.reset(this.tick);
    this.hero.reset(this.tick, this.seats.values());
    this.explosives.reset(this.tick);
    this.dev.roundStart();
  }

  /** The kill limit of the current round. */
  get scoreLimit(): number {
    return this.o.scoreLimit;
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

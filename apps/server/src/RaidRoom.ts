/**
 * The Hunt Season room: networking glue (gameRoom.ts) around the Raid rules
 * (raid/raid.ts) on Pond Keep. Signed-in ducks only (the matchmaking guard and
 * checkAdmission both refuse guests, like the battle royale). Quick Play
 * joins an open lobby (joinOrCreate), a party leader opens a fresh one
 * (create) and the party follows by room id; the room holds seats for the
 * leader's party for a while. Rooms are not listed in the lobby; they lock
 * when the run starts and close a minute after it ends.
 *
 * Visibility: every duck in a run is an ally (team 1), so ducks always get
 * each other's poses; hunters, traps and drops are public room state sent to
 * everyone (the CLAUDE.md Hunt Season rule: AI enemies of a co-op mode, so
 * seeing them gives no human an edge over another). Each duck's own run
 * numbers (upgrades, cards, XP) go to that duck only, as messages.
 *
 * XP: granted by this server only, at the run end, through recordRaid (the
 * meta layer), never from anything a client says.
 */
import { ServerError, type Client } from '@colyseus/core';
import { BridgeState, ExplosiveKind, PARTY, RAID, RaidStage, TICK_RATE, raidXp, type InputFrame } from '@qwakk/shared';
import { DmPickup, GameMode, Hunter, MatchPhase, Msg, RaidCannon, RaidEvent, RaidTrap, type PlayerState } from '@qwakk/shared/net';
import { ACCOUNT_ERROR } from '@qwakk/shared/accounts';
import type { BotLike, Seat } from './arena.ts';
import { angleMilli, cm, GameRoom, type GameRoomOptions, type JoinAuth } from './gameRoom.ts';
import { ExplosivesNet } from './dmExplosivesNet.ts';
import { loadMapV1, type ServerMap } from './maps.ts';
import { recordRaid, type RaidRunResult } from './meta/index.ts';
import type { BotNav } from './nav/botNav.ts';
import { parties } from './party/registry.ts';
import { Raid } from './raid/raid.ts';
import { raidRules, type RaidRules } from './raid/rules.ts';

export interface RaidRoomOptions extends GameRoomOptions {
  /** The navmesh of the map (the server entry passes the shared one). */
  nav?: () => BotNav | null;
  /** Rules override (tests); default: the admin settings now. */
  rules?: Partial<RaidRules>;
  /** Results time before the room closes (s). */
  endSeconds?: number;
  /** Tests and benchmarks: this many bot ducks join the lobby with the first human. */
  botDucks?: number;
  createDuckBot?: () => BotLike;
  /** Tests only (QWAKK_TEST_HOOKS=1, never in production): skip to a wave, beat a wave (`dev:raid`). */
  testHooks?: boolean;
}

/** Loaf projectile ids on the wire start here (decoys and the deathmatch explosives use small ids of their own). */
const LOAF_IDS = 1_000_000;

/** Join refusals of a raid room (onAuth). */
export const RAID_ERROR = {
  /** The run already started, or no seat is free (party seats included). */
  full: 4414,
} as const;

export class RaidRoom extends GameRoom<Raid> {
  override maxClients: number = RAID.maxDucks;
  private startedAt = Date.now();
  private recorded = false;
  private closeTimer: NodeJS.Timeout | null = null;
  private explosivesNet: ExplosivesNet | null = null;
  /** Seats held for a party leader's friends on their way in: party id to seats and the time they expire. */
  private readonly held = new Map<string, { seats: number; until: number }>();
  /** Throttles for the core and gate hit events (ms). */
  private lastCoreEvent = 0;
  private lastGateEvent = 0;
  private opts: RaidRoomOptions = {};

  protected loadMap(): ServerMap {
    return loadMapV1(RAID.mapId);
  }

  protected override cullHidden(): boolean {
    return false;
  }

  /** Nobody connected: nothing to simulate (the room disposes once its last client is gone). */
  protected override idleWhenEmpty(): boolean {
    return true;
  }

  protected createMatch(options: RaidRoomOptions): Raid {
    this.state.mode = GameMode.Raid;
    this.state.phase = MatchPhase.Warmup;
    this.state.raid.waves = RAID.waves;
    const rules: RaidRules = { ...raidRules(), ...(options.rules ?? {}) };
    this.state.raid.coreMax = rules.coreHp;
    this.state.raid.coreHp = rules.coreHp;
    this.state.raid.gateMax = rules.gateHp;
    this.state.raid.gateHp = rules.gateHp;
    const net = new ExplosivesNet({
      viewers: () => this.clients,
      viewpoint: (id) => this.viewpointOf(id),
      sees: () => true,
      seesSpot: () => true,
    });
    this.explosivesNet = net;
    const send = (seat: Seat, type: string, msg: unknown): void => this.clients.getById(seat.id)?.send(type, msg);
    return new Raid(
      this.sim,
      { map: this.loadMap(), nav: options.nav ?? (() => null), rules, endSeconds: options.endSeconds },
      {
        shot: (shooter, weapon, r) => this.queueShot(shooter, weapon, r),
        hit: (shooter, victim, damage, head, killed, knocked) => send(shooter, Msg.HitConfirm, [victim.pid, damage, head ? 1 : 0, killed ? 1 : 0, knocked ? 1 : 0]),
        damaged: (victim, from, damage) => this.sendDamaged(victim, from, damage),
        kill: (killer, victim, weapon, head) => this.sendKill(killer, victim, weapon, head),
        knock: (by, victim, weapon, head) => this.sendKnock(by, victim, weapon, head),
        hurtFrom: (victim, damage, x, z) => send(victim, Msg.Damaged, [angleMilli(victim.sim.x, victim.sim.z, x, z), damage, 0]),
        hunterHit: (shooter, _h, damage, head, killed, blast) => send(shooter, Msg.HitConfirm, [0, damage, head ? 1 : 0, killed ? 1 : 0, 0, blast ? 1 : 0]),
        hunterDown: (h, killer, head, how) => this.broadcast(Msg.RaidKill, [h.kind, killer?.pid ?? 0, head ? 1 : 0, cm(h.x), cm(h.y), cm(h.z), how]),
        hunterShot: (h, traces, weapon) => {
          for (const t of traces) this.queueShotFx(h.id, weapon, h.x, h.z, t.outcome, t.from, t.to);
        },
        whistle: (h) => this.broadcast(Msg.RaidEvent, [RaidEvent.Whistle, Math.round(h.x), Math.round(h.z)]),
        coreHit: (hp) => {
          const now = Date.now();
          if (now - this.lastCoreEvent < 900 && hp > 0) return;
          this.lastCoreEvent = now;
          this.broadcast(Msg.RaidEvent, [RaidEvent.CoreHit, hp, 0]);
        },
        coreRepaired: () => this.broadcast(Msg.RaidEvent, [RaidEvent.CoreRepaired, 0, 0]),
        gateHit: (hp, state) => {
          const now = Date.now();
          if (now - this.lastGateEvent < 900) return;
          this.lastGateEvent = now;
          this.broadcast(Msg.RaidEvent, [RaidEvent.GateHit, hp, state]);
        },
        gateBroken: () => this.broadcast(Msg.RaidEvent, [RaidEvent.GateBroken, 0, 0]),
        gateFixed: (by) => this.broadcast(Msg.RaidEvent, [RaidEvent.GateFixed, by?.pid ?? 0, 0]),
        bridge: (state, by) => this.broadcast(Msg.RaidEvent, [RaidEvent.Bridge, state, by?.pid ?? 0]),
        splash: (n, by) => this.broadcast(Msg.RaidEvent, [RaidEvent.Splash, n, by?.pid ?? 0]),
        leverDenied: (seat, reason, secs) => send(seat, Msg.RaidEvent, [RaidEvent.LeverDenied, reason, secs]),
        overheat: (seat, i) => send(seat, Msg.RaidEvent, [RaidEvent.Overheat, i, 0]),
        loafLaunched: (l, owner) => {
          const f = l.flight;
          this.broadcast(Msg.Proj, [l.id + LOAF_IDS, ExplosiveKind.Bread, owner?.pid ?? 0, cm(f.x), cm(f.y), cm(f.z), cm(f.vx), cm(f.vy), cm(f.vz)]);
        },
        loafBoom: (l, x, y, z) => this.broadcast(Msg.Boom, [l.id + LOAF_IDS, ExplosiveKind.Bread, cm(x), cm(y), cm(z)]),
        trapped: (seat) => this.broadcast(Msg.RaidEvent, [RaidEvent.Trapped, seat.pid, 0]),
        offer: (seat, cards, deadline) => send(seat, Msg.RaidOffer, cards ? [Math.round(deadline), ...cards.flat()] : []),
        self: (seat) => this.sendSelf(seat),
        waveStart: (wave, boss) => {
          this.broadcast(Msg.RaidEvent, [RaidEvent.WaveStart, wave, boss ? 1 : 0]);
          for (const s of this.match.seats.values()) this.sendSelf(s);
        },
        waveClear: (wave) => this.broadcast(Msg.RaidEvent, [RaidEvent.WaveClear, wave, 0]),
        decoyLaunched: (d) => {
          const f = d.flight;
          this.broadcast(Msg.Proj, [d.id, ExplosiveKind.Decoy, 0, cm(f.x), cm(f.y), cm(f.z), cm(f.vx), cm(f.vy), cm(f.vz)]);
        },
        decoyBoom: (d, x, y, z) => this.broadcast(Msg.Boom, [d.id, ExplosiveKind.Decoy, cm(x), cm(y), cm(z)]),
        dropTaken: (seat, kind) => send(seat, Msg.Picked, [100 + kind, 1]),
        started: () => this.onStarted(),
        ended: () => this.onEnded(),
        explosives: {
          launched: (f, owner) => net.launched(f, owner),
          rested: (f) => net.rested(f),
          boom: (b) => net.boom(b),
          rocketPicked: (seat, rockets) => send(seat, Msg.DmRocket, rockets),
        },
      },
    );
  }

  override async onCreate(options: RaidRoomOptions = {}): Promise<void> {
    this.opts = options;
    this.onMessage(Msg.RaidPick, (client, index: unknown) => {
      if (this.match.pick(client.sessionId, index)) this.sendSelf(this.match.seats.get(client.sessionId)!);
    });
    if (options.testHooks && process.env.NODE_ENV !== 'production') {
      this.onMessage('dev:raid', (client, msg: unknown) => {
        if (!msg || typeof msg !== 'object') return;
        const m = msg as { op?: unknown; wave?: unknown };
        // Screenshots: one hunter of a kind (`wave` carries the kind) 8 m in front of the asking duck.
        const seat = this.match.seats.get(client.sessionId);
        if (m.op === 'spawn' && seat && typeof m.wave === 'number' && m.wave >= 1 && m.wave <= 6) {
          const n = this.match.hunts.hunters.size;
          const side = ((n % 5) - 2) * 2.2;
          const fx = -Math.sin(seat.sim.yaw);
          const fz = -Math.cos(seat.sim.yaw);
          const h = this.match.hunts.spawnForTest(m.wave, seat.sim.x + fx * 8 - fz * side, seat.sim.z + fz * 8 + fx * side);
          h.yaw = Math.atan2(fx, fz);
          return;
        }
        // The keep: the gate's health (`wave` carries it), the bridge straight up or down, the lever as if pulled, and a duck moved to a keep spot.
        if (m.op === 'gate' && typeof m.wave === 'number') return this.match.keep.setGate(m.wave);
        if (m.op === 'bridge' && typeof m.wave === 'number') return this.match.keep.forceBridge(m.wave === 2 ? BridgeState.Up : BridgeState.Down, this.match.currentTick);
        if (m.op === 'lever') return void this.match.pullLever(seat ?? null);
        if (m.op === 'tp' && seat && typeof m.wave === 'number') return this.match.moveForTest(seat, m.wave);
        if (m.op === 'gatehunters' && typeof m.wave === 'number') return this.match.huntersAtGate(Math.max(1, Math.min(8, Math.floor(m.wave))));
        if (m.op === 'skip' && typeof m.wave === 'number') this.match.skipTo(m.wave);
        else if (m.op === 'clear') this.match.defeatWave();
        else if (m.op === 'start') this.match.start();
        else if (m.op === 'break') this.match.endBreakNow();
        // The benchmark: ducks take no damage, so a full wave keeps running.
        else if (m.op === 'hold') this.match.hold = true;
      });
    }
    await super.onCreate(options);
  }

  protected override roomStatus(): { kind: 'dm' | 'br' | 'raid'; mode: string; phase: string; secondsLeft: number } {
    const m = this.match;
    const phase = ['lobby', 'break', 'wave', 'won', 'lost'][m.stage] ?? '';
    return { kind: 'raid', mode: `Hunt Season, wave ${m.wave}`, phase, secondsLeft: m.secondsLeft };
  }

  /**
   * Signed-in ducks only: a guest, or a party with a guest, is refused (the
   * same codes as the battle royale). Then the run must not have started, and
   * a seat must be free for the joiner's whole party (seats held for another
   * party do not count as free).
   */
  protected override checkAdmission(auth: JoinAuth): void {
    if (!auth.account) throw new ServerError(ACCOUNT_ERROR.roomNeedsAccount, 'hunt season needs an account');
    if (parties.partyHasGuest(auth.playerId)) throw new ServerError(ACCOUNT_ERROR.roomPartyHasGuest, 'your party has a guest; guests play deathmatch only');
    if (this.match.locked) throw new ServerError(RAID_ERROR.full, 'this hunt already started');
    const party = parties.partyOf(auth.playerId);
    this.expireHolds();
    const mine = party ? this.held.get(party.id) : undefined;
    const heldOthers = [...this.held.entries()].filter(([id]) => id !== party?.id).reduce((n, [, h]) => n + h.seats, 0);
    const free = RAID.maxDucks - this.match.duckCount - heldOthers;
    const need = mine ? 1 : party ? 1 + party.members.filter((m) => m !== auth.playerId && !parties.isPlaying(m)).length : 1;
    if (need > free) throw new ServerError(RAID_ERROR.full, 'no room for your party in this hunt');
  }

  private expireHolds(): void {
    const now = Date.now();
    for (const [id, h] of this.held) if (h.until < now || h.seats <= 0) this.held.delete(id);
  }

  protected addHuman(client: Client, name: string, auth: JoinAuth | undefined, character: number): Seat | null {
    const seat = this.match.addDuck(client.sessionId, name, character);
    if (!seat) return null;
    // Hold seats for this duck's party friends who are still in the menu (they follow the leader in).
    const party = parties.partyOf(auth?.playerId);
    if (party) {
      const h = this.held.get(party.id);
      if (h) h.seats = Math.max(0, h.seats - 1);
      else {
        const friends = party.members.filter((m) => m !== auth?.playerId && !parties.isPlaying(m)).length;
        if (friends > 0) this.held.set(party.id, { seats: friends, until: Date.now() + PARTY.reserveSeconds * 1000 });
      }
    }
    if (this.opts.botDucks && this.opts.createDuckBot && this.match.humans === 1) {
      for (let i = 0; i < this.opts.botDucks; i++) this.match.addBotDuck(this.opts.createDuckBot());
      this.syncSeats();
    }
    this.sendSelf(seat);
    return seat;
  }

  protected removeHuman(id: string): void {
    this.match.remove(id);
  }

  protected override reviveOf(seat: Seat): { progress: number; by: Seat | null } {
    return this.match.reviveProgress(seat);
  }

  protected matchEndTick(): void {
    this.match.endTick();
  }

  private onStarted(): void {
    void this.lock();
    this.startedAt = Date.now();
    this.held.clear();
  }

  private onEnded(): void {
    this.recordResult();
    this.closeTimer = setTimeout(() => void this.disconnect(), (this.opts.endSeconds ?? RAID.endSeconds) * 1000);
  }

  override onDispose(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    // Everyone left mid-run: the run counts as it stands (what was cleared, nothing more).
    if (this.match && this.match.stage !== RaidStage.Lobby) this.recordResult();
    super.onDispose();
  }

  /** A duck's own numbers: max health, upgrade effects, kills, XP so far, the cards taken. */
  private sendSelf(seat: Seat): void {
    const client = this.clients.getById(seat.id);
    const d = this.match.ducks.get(seat.id);
    if (!client || !d) return;
    const st = d.stats;
    const xp = raidXp({ wavesCleared: d.wavesCleared, firstWave: d.firstWave, kills: d.kills, bossKills: d.bossKills, revives: d.revives, won: false });
    client.send(Msg.RaidSelf, [st.maxHp, Math.round((st.damage - 1) * 100), Math.round((1 - st.taken) * 100), st.regenPerSecond, Math.round((1 - st.reviveTime) * 100), Math.round((st.headshot - 1) * 100), st.lifesteal, d.kills, xp, ...d.upgrades.list()]);
  }

  /**
   * The run is over (or everyone left): every human duck's XP, from what the
   * server saw. Sent at once (granted 0), then again with the stored numbers
   * once the database has them (granted 1). Never twice into the database:
   * the run id is unique there.
   */
  private recordResult(): void {
    if (this.recorded) return;
    this.recorded = true;
    const m = this.match;
    const won = m.stage === RaidStage.Won;
    const runMs = m.runMs();
    const bestMs = m.lastClearTick > m.startTick ? Math.round(((m.lastClearTick - m.startTick) / TICK_RATE) * 1000) : runMs;
    const players: RaidRunResult['players'] = [];
    const bySeat = new Map<string, RaidRunResult['players'][number]>();
    for (const d of m.ducks.values()) {
      const playerId = this.seatPlayerIds.get(d.seatId) ?? null;
      if (d.seatId.startsWith('duckbot-')) continue;
      // A duck that left before the end keeps the XP for what it did while it was there, but not the win.
      const stayed = won && !d.left;
      const xp = raidXp({ wavesCleared: d.wavesCleared, firstWave: d.firstWave, kills: d.kills, bossKills: d.bossKills, revives: d.revives, won: stayed });
      const row = { playerId, name: d.name, wavesCleared: d.wavesCleared, kills: d.kills, bossKills: d.bossKills, revives: d.revives, xp, won: stayed };
      players.push(row);
      bySeat.set(d.seatId, row);
    }
    if (players.length === 0) return;
    const reason = m.endReason;
    const waves = Math.max(0, ...players.map((p) => p.wavesCleared));
    /** `granted` null: the first, immediate message (0) or, after the write, "could not be saved" (2). */
    const sendEnd = (granted: Map<string, { xpBefore: number; xpAfter: number; levelBefore: number; levelAfter: number; bestWave: number; bestMs: number; newBest: boolean }> | null, failed = false): void => {
      for (const [seatId, row] of bySeat) {
        const client = this.clients.getById(seatId);
        if (!client) continue;
        const g = row.playerId ? granted?.get(row.playerId) : undefined;
        client.send(Msg.RaidEnd, [reason, row.wavesCleared, row.kills, row.bossKills, row.revives, row.xp, g?.xpBefore ?? -1, g?.xpAfter ?? -1, g?.levelBefore ?? 0, g?.levelAfter ?? 0, runMs, g?.bestWave ?? 0, g?.bestMs ?? 0, g?.newBest ? 1 : 0, g ? 1 : failed ? 2 : 0]);
      }
    };
    sendEnd(null);
    // Always a second answer: the stored grant, or "not saved" (no database, or the write failed).
    void recordRaid({ runId: this.roomId, mapId: this.state.mapId, startedAt: this.startedAt, endedAt: Date.now(), wavesCleared: waves, won, bestMs, players }).then(
      (granted) => (granted && granted.size > 0 ? sendEnd(granted) : sendEnd(null, true)),
      () => sendEnd(null, true),
    );
  }

  protected writeMatchState(): void {
    const m = this.match;
    const st = this.state;
    const r = st.raid;
    const phase = m.stage === RaidStage.Lobby ? MatchPhase.Warmup : m.over ? MatchPhase.Ended : MatchPhase.Playing;
    if (st.phase !== phase) st.phase = phase;
    if (st.timeLeft !== m.secondsLeft) st.timeLeft = m.secondsLeft;
    if (r.stage !== m.stage) r.stage = m.stage;
    if (r.wave !== m.wave) r.wave = m.wave;
    // Schema numbers start undefined: write them the first time, then only real changes (40 ms of slack).
    const ends = Math.round(m.stageEndsMs);
    if (r.ends === undefined || Math.abs(r.ends - ends) > 40) r.ends = ends;
    const waveAt = Math.max(0, Math.round(m.nowMs - ((m.currentTick - m.waveStartTick) / TICK_RATE) * 1000));
    if (r.waveAt === undefined || (m.stage === RaidStage.Wave && Math.abs(r.waveAt - waveAt) > 40)) r.waveAt = waveAt;
    this.writeKeep();
    const left = m.hunts.left;
    if (r.left !== left) r.left = left;
    const boss = m.hunts.boss;
    const bossHp = boss ? Math.ceil(Math.max(0, boss.hp)) : 0;
    if (r.bossHp !== bossHp) r.bossHp = bossHp;
    const bossMax = boss ? Math.ceil(boss.maxHp) : 0;
    if (r.bossMax !== bossMax) r.bossMax = bossMax;
    if (r.ducks !== m.duckCount) r.ducks = m.duckCount;
    if (r.kills !== m.teamKills) r.kills = m.teamKills;
    this.writeHunters();
    this.writeTraps();
    this.writeDrops();
    this.writeRocket();
  }

  /** The core, the gate, the drawbridge and the cannons (server times in ms since the room started, like `ends`). */
  private writeKeep(): void {
    const k = this.match.keep;
    const r = this.state.raid;
    const tickMs = (tick: number): number => Math.max(0, Math.round(this.match.nowMs + ((tick - this.match.currentTick) / TICK_RATE) * 1000));
    const core = Math.ceil(k.coreHp);
    if (r.coreHp !== core) r.coreHp = core;
    if (r.coreMax !== k.coreMax) r.coreMax = k.coreMax;
    const gate = Math.ceil(k.gateHp);
    if (r.gateHp !== gate) r.gateHp = gate;
    if (r.gateMax !== k.gateMax) r.gateMax = k.gateMax;
    if (r.gate !== k.gateState) r.gate = k.gateState;
    if (r.bridge !== k.bridge) r.bridge = k.bridge;
    const at = tickMs(k.bridgeStart);
    if (r.bridgeAt === undefined || Math.abs(r.bridgeAt - at) > 40) r.bridgeAt = at;
    const ends = tickMs(k.bridgeEnd);
    if (r.bridgeEnds === undefined || Math.abs(r.bridgeEnds - ends) > 40) r.bridgeEnds = ends;
    const ready = k.leverReady > this.match.currentTick ? tickMs(k.leverReady) : 0;
    if (r.leverReady === undefined || Math.abs(r.leverReady - ready) > 40) r.leverReady = ready;
    const down = k.bridge === BridgeState.Up ? tickMs(k.autoDown) : 0;
    if (r.bridgeDown === undefined || Math.abs(r.bridgeDown - down) > 40) r.bridgeDown = down;
    k.cannons.forEach((c, i) => {
      const key = String(i);
      let e = r.cannons.get(key);
      if (!e) {
        e = new RaidCannon();
        r.cannons.set(key, e);
      }
      if (e.pid !== c.pid) e.pid = c.pid;
      e.yaw = c.yaw;
      e.pitch = c.pitch;
      const heat = Math.max(0, Math.min(255, Math.round((c.heat / 100) * 255)));
      if (e.heat !== heat) e.heat = heat;
      const hot = c.hot ? 1 : 0;
      if (e.hot !== hot) e.hot = hot;
      const cr = c.ready > this.match.currentTick ? tickMs(c.ready) : 0;
      if (e.ready === undefined || Math.abs(e.ready - cr) > 40) e.ready = cr;
    });
  }

  private writeHunters(): void {
    const map = this.state.hunters;
    const hunters = this.match.hunts.hunters;
    for (const id of [...map.keys()]) if (!hunters.has(id)) map.delete(id);
    for (const h of hunters.values()) {
      let e = map.get(h.id);
      if (!e) {
        e = new Hunter();
        e.kind = h.kind;
        map.set(h.id, e);
      }
      e.x = h.x;
      e.y = h.y;
      e.z = h.z;
      e.yaw = h.yaw;
      e.pitch = h.pitch;
      if (e.act !== h.act) e.act = h.act;
      const hp = Math.max(0, Math.min(255, Math.ceil((Math.max(0, h.hp) / Math.max(1, h.maxHp)) * 255)));
      if (e.hp !== hp) e.hp = hp;
    }
  }

  private writeTraps(): void {
    const map = this.state.traps;
    const traps = this.match.hunts.traps;
    for (const id of [...map.keys()]) if (!traps.has(id)) map.delete(id);
    for (const t of traps.values()) {
      let e = map.get(t.id);
      if (!e) {
        e = new RaidTrap({ x: t.x, y: t.y, z: t.z, state: t.state });
        map.set(t.id, e);
      }
      if (e.state !== t.state) e.state = t.state;
    }
  }

  private writeDrops(): void {
    const map = this.state.raidDrops;
    const drops = this.match.hunts.drops;
    for (const id of [...map.keys()]) if (!drops.has(id)) map.delete(id);
    for (const d of drops.values()) if (!map.has(d.id)) map.set(d.id, new DmPickup({ kind: d.kind, x: d.x, y: d.y, z: d.z }));
  }

  /** The boss wave's rocket launcher pickup, drawn by the deathmatch explosives view. */
  private writeRocket(): void {
    const st = this.state;
    const p = this.match.explosives.rocket;
    for (const id of st.dmRockets.keys()) if (p?.id !== id) st.dmRockets.delete(id);
    if (p && !st.dmRockets.has(p.id)) st.dmRockets.set(p.id, new DmPickup({ kind: 0, x: p.x, y: p.y, z: p.z }));
  }

  protected override writeSeatExtras(seat: Seat, st: PlayerState): void {
    // A dead duck watches a living friend (its camera follows that duck's pose, which allies always get).
    let pid = 0;
    if (!seat.sim.alive) for (const s of this.match.seats.values()) if (s !== seat && s.sim.alive) {
      pid = s.pid;
      break;
    }
    if (st.watch !== pid) st.watch = pid;
  }

  protected override extraStats(): Record<string, number> {
    return { ...super.extraStats(), hunters: this.match.hunts.alive };
  }

  /** Tests. */
  get raid(): Raid {
    return this.match;
  }

  /** Tests: one input frame for a seat, as a client would send it. */
  applyFor(id: string, f: InputFrame): void {
    const seat = this.match.seats.get(id);
    if (seat) this.match.applyInput(seat, f, this.match.nowMs);
  }
}



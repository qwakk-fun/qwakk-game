/**
 * The battle royale room on Sainte-Canard: networking glue (gameRoom.ts)
 * around the BattleRoyale rules. Players pick a room from the lobby list
 * (joinById), create one, or Quick Play (joinOrCreate). The countdown starts
 * at `BR.minHumans` humans; when it ends the room locks and bots fill the
 * empty seats. The room's listing (label, humans, stage, countdown) is its
 * Colyseus metadata, pushed to menus by the lobby (lobby.ts).
 *
 * Owner-only state (inventory, ammo, armor durability, hp) uses `.view()`
 * fields; enemy poses are culled by line of sight (interest.ts); loot items
 * are sent per viewer, only near ones (StateView).
 */
import type { Client } from '@colyseus/core';
import { BR, INTEREST, Mode, planeAt, TICK_RATE } from '@qwakk/shared';
import { GameMode, InvOp, MatchPhase, Msg, type PlayerState } from '@qwakk/shared/net';
import type { BotLike, Seat } from './arena.ts';
import { BattleRoyale, DEFAULT_BR } from './br/battleRoyale.ts';
import type { BrBotContext } from './br/context.ts';
import { ItemViews } from './br/itemViews.ts';
import { brResults } from './br/results.ts';
import { GameRoom, type GameRoomOptions } from './gameRoom.ts';
import type { ViewerPoint } from './interest.ts';
import { loadSainteCanard, type ServerMap } from './maps.ts';
import { recordMatch } from './meta/index.ts';
import { roomLabel, type RoomListing, type RoomStage } from '@qwakk/shared/lobby';

export interface BrRoomOptions extends GameRoomOptions {
  /** Start countdown length override (s), for tests. */
  countdownSeconds?: number;
  /** Humans needed before the countdown starts (tests and benchmarks use fewer). */
  minHumans?: number;
  /** Results screen time before the room closes (s). */
  endSeconds?: number;
  /** Zone timeline speed-up (tests). */
  zoneTimeScale?: number;
  /** Bot brain factory (the server entry passes the navmesh bots). */
  createBot?: (ctx: BrBotContext, seatId: string) => BotLike;
}

/** Item views are brought up to date every this many ticks. */
const ITEM_EVERY_TICKS = 10;
/** Joins close this many seconds before the countdown ends, so nobody is seated into a match that just started. */
const LOCK_AHEAD_S = 2;

export class BrRoom extends GameRoom<BattleRoyale> {
  override maxClients: number = BR.players;
  /** Loot per viewer, line-of-sight gated (br/itemViews.ts). */
  private items!: ItemViews;
  /** Who each dead player watches (seat ids). */
  private readonly watching = new Map<string, string>();
  private startedAt = Date.now();
  private recorded = false;
  private closeTimer: NodeJS.Timeout | null = null;
  /** The listing last sent to the lobby (only changes are published). */
  private listingKey = '';
  /** Joins closed by us for the last seconds of the countdown. */
  private lockedAhead = false;
  private countdownTicks = 1;
  /** A human changed the loot near it: refresh the item views on the next tick, not in up to 10. */
  private itemsDirty = false;

  protected loadMap(): ServerMap {
    return loadSainteCanard();
  }

  protected override cullHidden(): boolean {
    return true;
  }

  protected createMatch(options: BrRoomOptions): BattleRoyale {
    this.countdownTicks = Math.max(1, Math.round((options.countdownSeconds ?? DEFAULT_BR.countdownSeconds) * TICK_RATE));
    this.state.mode = GameMode.BattleRoyale;
    this.state.phase = MatchPhase.Warmup;
    this.items = new ItemViews(this.state.items as never, this.vis, () => this.match.loot);
    const createBot = options.createBot ?? (() => {
      throw new Error('BrRoom needs a createBot option');
    });
    return new BattleRoyale(
      this.sim,
      {
        ...DEFAULT_BR,
        countdownSeconds: this.countdownTicks / TICK_RATE,
        minHumans: options.minHumans ?? DEFAULT_BR.minHumans,
        endSeconds: options.endSeconds ?? DEFAULT_BR.endSeconds,
        bots: options.bots !== false,
        seed: options.seed,
        createBot,
        zoneTimeScale: options.zoneTimeScale,
        isFar: (viewer, target, now, rtt) => this.interest.isFarAt(viewer, target, now, rtt),
        farExtraDelayMs: INTEREST.farExtraDelayMs,
      },
      {
        shot: (shooter, weapon, r) => this.queueShot(shooter, weapon, r),
        hit: (shooter, victim, damage, head, killed) => this.clients.getById(shooter.id)?.send(Msg.HitConfirm, [victim.pid, damage, head ? 1 : 0, killed ? 1 : 0]),
        damaged: (victim, from, damage) => this.sendDamaged(victim, from, damage),
        kill: (killer, victim, weapon, head) => this.onKill(killer, victim, weapon, head),
        picked: (seat, got) => {
          const c = this.clients.getById(seat.id);
          for (const g of got) c?.send(Msg.Picked, [g.kind, g.amount]);
        },
        denied: (seat, reason, kind) => this.clients.getById(seat.id)?.send(Msg.Denied, [reason, kind]),
        looted: (seat) => {
          if (!seat.bot) this.itemsDirty = true;
        },
        result: (seat, placement) => {
          const r = this.match.resultOf(seat);
          this.clients.getById(seat.id)?.send(Msg.Result, [placement, this.match.seats.size, r.kills, r.dealt, r.survivedMs]);
        },
        started: () => this.onStarted(),
        ended: () => this.onEnded(),
        loot: {
          added: (e) => this.items.added(e),
          changed: (e) => this.items.changed(e),
          removed: (e) => this.items.removed(e),
        },
      },
    );
  }

  override async onCreate(options: BrRoomOptions = {}): Promise<void> {
    this.onMessage(Msg.Spectate, (client, dir: unknown) => this.cycleWatch(client.sessionId, dir === -1 ? -1 : 1));
    this.onMessage(Msg.Inv, (client, msg: unknown) => this.inventoryRequest(client.sessionId, msg));
    await super.onCreate(options);
    this.state.label = roomLabel(this.roomId);
    // Not persisted here: the matchmaker records the room (with this metadata) once onCreate returns.
    void this.setMetadata(this.listing(), false);
  }

  /** What the lobby list shows for this room. Public: no names, ids or addresses. */
  listing(): RoomListing {
    const m = this.match;
    const stage: RoomStage = m.phase === 'warmup' ? (m.countingDown ? 'countdown' : 'waiting') : m.phase;
    const humans = m.phase === 'warmup' ? m.humans : Math.max(0, this.clients.length - this.spectators.size);
    return { label: this.state.label, stage, humans, cap: this.maxClients, need: m.waitingFor, left: stage === 'countdown' ? m.secondsLeft : 0 };
  }

  /** Publish the listing when it changed (at most once a second during the countdown), and close joins just before the start. */
  private updateListing(): void {
    const m = this.match;
    if (m.phase === 'warmup') {
      const ahead = Math.min(LOCK_AHEAD_S * TICK_RATE, Math.round(this.countdownTicks / 4));
      const closing = m.countingDown && m.warmupTicks <= ahead;
      if (closing && !this.lockedAhead) {
        this.lockedAhead = true;
        void this.lock();
      } else if (!closing && this.lockedAhead) {
        // Players left and the countdown went back to waiting: open the room again.
        this.lockedAhead = false;
        void this.unlock();
      }
    }
    const l = this.listing();
    const key = `${l.stage}|${l.humans}|${l.need}|${l.left}`;
    if (key === this.listingKey) return;
    this.listingKey = key;
    this.setMetadata(l).catch((err: unknown) => console.error('[lobby] listing update failed:', err));
  }

  protected addHuman(client: Client, name: string): Seat | null {
    const seat = this.match.addHuman(client.sessionId, name);
    if (seat) this.items.addViewer(client.sessionId);
    return seat;
  }

  protected removeHuman(id: string): void {
    this.match.remove(id);
    this.items.removeViewer(id);
    this.watching.delete(id);
  }

  /**
   * An inventory request (Msg.Inv): [InvOp.Drop, kind, amount] or
   * [InvOp.Take, entity, index, kind]. Untrusted: anything malformed is
   * ignored; the match checks reach, sight and the inventory rules.
   */
  private inventoryRequest(id: string, msg: unknown): void {
    if (!Array.isArray(msg) || msg.length < 3 || msg.length > 4) return;
    const n = msg.map((v) => (typeof v === 'number' && Number.isInteger(v) ? v : Number.NaN));
    if (n.some((v) => !Number.isFinite(v) || Math.abs(v) > 1_000_000)) return;
    const [op, a, b, c] = n as [number, number, number, number | undefined];
    if (op === InvOp.Drop && msg.length === 3 && a > 0 && b > 0) this.match.inventoryOp(id, 'drop', a, b, 0);
    else if (op === InvOp.Take && msg.length === 4 && a > 0 && b >= -1 && c !== undefined) this.match.inventoryOp(id, 'take', a, b, c);
  }

  protected matchEndTick(): void {
    this.match.endTick();
  }

  private onStarted(): void {
    void this.lock();
    this.startedAt = Date.now();
    this.syncSeats();
    const m = this.match;
    const st = this.state;
    st.planePath = m.route?.index ?? 0;
    st.planeT0 = Math.round(m.startMs);
    st.planeEnd = Math.round(m.startMs + (m.route?.ejectS ?? 0) * 1000);
    st.total = m.seats.size;
  }

  private onKill(killer: Seat | null, victim: Seat, weapon: number, head: boolean): void {
    this.sendKill(killer, victim, weapon, head);
    // The fallen duck watches its killer; anyone watching the fallen one moves on too.
    const next = killer && killer.sim.alive ? killer.id : null;
    for (const [viewer, watched] of [...this.watching]) if (watched === victim.id) this.setWatch(viewer, next ?? this.nextAlive(viewer, 1));
    if (!victim.bot) this.setWatch(victim.id, next ?? this.nextAlive(victim.id, 1));
  }

  private onEnded(): void {
    this.recordResult();
    const secs = this.match.phase === 'ended' ? this.match.secondsLeft : BR.endSeconds;
    this.closeTimer = setTimeout(() => void this.disconnect(), secs * 1000);
  }

  override onDispose(): void {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    // The last human left before the end: record the match as it stands. Every
    // human who left is already out with the place they had then (BattleRoyale.remove).
    if (this.match && this.match.phase !== 'warmup') this.recordResult();
    super.onDispose();
  }

  private recordResult(): void {
    if (this.recorded) return;
    this.recorded = true;
    const m = this.match;
    const seats = [...m.seats.values()];
    if (!seats.some((s) => !s.bot)) return;
    void recordMatch({
      matchId: this.roomId,
      mode: 'br',
      mapId: this.state.mapId,
      startedAt: this.startedAt,
      endedAt: Date.now(),
      players: brResults(m).map((r) => ({
        playerId: r.seat.bot ? null : (this.seatPlayerIds.get(r.seat.id) ?? null),
        name: r.seat.name,
        isBot: r.seat.bot !== null,
        placement: r.placement,
        kills: r.kills,
        damage: r.damage,
        survivedMs: r.survivedMs,
      })),
    });
  }

  private nextAlive(viewerId: string, dir: number): string | null {
    const alive = [...this.match.seats.values()].filter((s) => s.sim.alive && s.id !== viewerId);
    if (alive.length === 0) return null;
    const cur = this.watching.get(viewerId);
    const i = alive.findIndex((s) => s.id === cur);
    const n = alive.length;
    return (alive[((i < 0 ? 0 : i + dir) % n + n) % n] as Seat).id;
  }

  private setWatch(viewerId: string, watchedId: string | null): void {
    if (watchedId) this.watching.set(viewerId, watchedId);
    else this.watching.delete(viewerId);
  }

  private cycleWatch(viewerId: string, dir: number): void {
    const me = this.match.seats.get(viewerId);
    if (!me || me.sim.alive) return;
    this.setWatch(viewerId, this.nextAlive(viewerId, dir));
  }

  protected override viewpointOf(viewerId: string): ViewerPoint | null {
    const me = this.match.seats.get(viewerId);
    if (!me) return null;
    const watchId = !me.sim.alive ? (this.watching.get(viewerId) ?? null) : null;
    const src = watchId ? (this.match.seats.get(watchId) ?? me) : me;
    const p = src.sim;
    const half = Math.max(0, me.rttMs) / 2;
    if (p.mode === Mode.Plane && this.match.route) {
      const pp = planeAt(this.match.route, Math.max(0, this.match.planeTime()));
      return { x: pp.x, y: pp.y, z: pp.z, vx: 0, vz: 0, yaw: p.yaw, crouch: 0, watchId, halfRttMs: half };
    }
    return { x: p.x, y: p.y, z: p.z, vx: p.vx, vz: p.vz, yaw: p.yaw, crouch: p.crouch, watchId, halfRttMs: half };
  }

  protected override writeSeatExtras(seat: Seat, st: PlayerState): void {
    const a = this.match.armorFor(seat.id);
    if (st.vest !== a.vest) st.vest = a.vest;
    if (st.helmet !== a.helmet) st.helmet = a.helmet;
    const pack = a.pack ?? 0;
    if (st.pack !== pack) st.pack = pack;
    const vd = Math.ceil(a.vestDur);
    const hd = Math.ceil(a.helmetDur);
    if (st.vestDur !== vd) st.vestDur = Math.min(255, vd);
    if (st.helmetDur !== hd) st.helmetDur = Math.min(255, hd);
    const place = this.match.placement.get(seat.id) ?? 0;
    if (st.placement !== place) st.placement = place;
    const w = this.watching.get(seat.id);
    const pid = w ? (this.match.seats.get(w)?.pid ?? 0) : 0;
    if (st.watch !== pid) st.watch = pid;
  }

  protected writeMatchState(tick: number): void {
    const m = this.match;
    const st = this.state;
    const phase = m.phase === 'warmup' ? MatchPhase.Warmup : m.phase === 'ended' ? MatchPhase.Ended : MatchPhase.Playing;
    if (st.phase !== phase) st.phase = phase;
    const left = m.secondsLeft;
    if (st.timeLeft !== left) st.timeLeft = left;
    const alive = m.alive;
    if (st.alive !== alive) st.alive = alive;
    if (m.phase === 'warmup' && st.total !== m.seats.size) st.total = m.seats.size;
    const need = m.waitingFor;
    if (st.need !== need) st.need = need;
    this.updateListing();
    const winner = m.winner?.name ?? '';
    if (st.winner !== winner) st.winner = winner;
    const z = m.zone;
    if (z) {
      const zs = st.zone;
      const t0 = Math.round(m.startMs + z.t0);
      const t1 = Math.round(m.startMs + z.t1);
      if (zs.phase !== z.phase || zs.t0 !== t0 || zs.shown !== (z.shown ? 1 : 0) || zs.t1 !== t1) {
        zs.phase = z.phase;
        zs.cx = z.from.x;
        zs.cz = z.from.z;
        zs.r = z.from.r;
        // Not announced yet: the target is the current circle (nothing to draw).
        const to = z.shown ? z.to : z.from;
        zs.tx = to.x;
        zs.tz = to.z;
        zs.tr = to.r;
        zs.t0 = t0;
        zs.t1 = z.shown ? t1 : t0;
        zs.shown = z.shown ? 1 : 0;
        zs.dps = z.dps;
      }
    }
    if (tick % ITEM_EVERY_TICKS === 0 || this.itemsDirty) {
      this.itemsDirty = false;
      this.updateItemViews();
    }
  }

  /** Bring every viewer's loot up to date (visible items only, see br/itemViews.ts). */
  private updateItemViews(): void {
    const viewers = [];
    for (const client of this.clients) {
      const point = this.viewpointOf(client.sessionId);
      if (point && client.view) viewers.push({ id: client.sessionId, view: client.view, point });
    }
    this.items.update(viewers);
  }

  /** Test hook: item entry keys a client holds. */
  itemKeysOf(sessionId: string): string[] {
    return this.items.heldBy(sessionId);
  }

  /** Test hook. */
  get br(): BattleRoyale {
    return this.match;
  }
}

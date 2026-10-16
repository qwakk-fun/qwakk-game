/**
 * A deathmatch room: networking glue (gameRoom.ts) around the Deathmatch
 * rules. The server opens one room per DM_ROOMS entry at start (index.ts,
 * `dmRoom` option), with the entry's id as the room id; clients never create
 * one (matchmaking.ts) and the rooms never close (autoDispose off). Each room
 * is listed in the lobby with its name and live human count (RoomListing).
 *
 * The map is MATCH.mapId (QWAKK_DM_MAP overrides it): a map_v1 map with
 * navmesh bots and line-of-sight culling of enemy poses, as in the battle
 * royale, or the seeded greybox (ray-steering bots, no culling).
 */
import type { Client } from '@colyseus/core';
import { INTEREST, ROOM } from '@qwakk/shared';
import { DM_ROOM_CATALOG, type RoomListing } from '@qwakk/shared/lobby';
import { recordMatch } from './meta/index.ts';
import { GameMode, MatchPhase, Msg } from '@qwakk/shared/net';
import type { BotLike } from './arena.ts';
import { Deathmatch, DEFAULT_DM, type Seat } from './deathmatch.ts';
import { GameRoom, type GameRoomOptions } from './gameRoom.ts';
import { dmMapId, GREYBOX, loadMap, type ServerMap } from './maps.ts';
import type { SimWorld } from '@qwakk/shared';

export interface IslandRoomOptions extends GameRoomOptions {
  /** Static room id from DM_ROOMS (set by the server at start). Without it: a plain room (tests, tools). */
  dmRoom?: string;
  /** Map id (default: dmMapId()). */
  mapId?: string;
  /** Bot brain factory (the server entry passes the navmesh bots). */
  createBot?: (sim: SimWorld, seatId: string) => BotLike;
  /** Tests: spawn only within this many meters of the arena center (QWAKK_DM_SPAWN_RADIUS). */
  spawnRadius?: number;
}

export class IslandRoom extends GameRoom<Deathmatch> {
  override maxClients: number = ROOM.maxClients;
  private roundStartedAt = Date.now();
  /** The listing last sent to the lobby (only changes are published). */
  private listingKey = '';

  protected loadMap(options: IslandRoomOptions): ServerMap {
    const map = loadMap(options.mapId ?? dmMapId(), options.seed ?? ROOM.defaultSeed);
    const r = options.spawnRadius;
    if (!r || r <= 0) return map;
    // Tests: only the spawns near the arena center (a copy; the loaded map is shared with other rooms).
    const { arena, arenaSpawns, arenaYaws } = map.def;
    const keep = arenaSpawns.map((p, i) => ({ p, i, d: Math.hypot(p[0] - arena.x, p[2] - arena.z) })).sort((a, b) => a.d - b.d);
    const near = keep.filter((k) => k.d <= r);
    const picked = near.length >= 2 ? near : keep.slice(0, 2);
    return { ...map, def: { ...map.def, arenaSpawns: picked.map((k) => k.p), ...(arenaYaws ? { arenaYaws: picked.map((k) => arenaYaws[k.i] ?? 0) } : {}) } };
  }

  /** Anti-wallhack culling on real maps (houses, hedges); the open greybox arena keeps everyone in view. */
  protected override cullHidden(): boolean {
    return this.sim.map.id !== GREYBOX;
  }

  override async onCreate(options: IslandRoomOptions = {}): Promise<void> {
    const entry = DM_ROOM_CATALOG.find((r) => r.id === options.dmRoom);
    if (entry) {
      // Our own id (only settable during creation), so the room is joinable by a stable id.
      this.roomId = entry.id;
      this.autoDispose = false;
    }
    await super.onCreate(options);
    this.state.label = entry?.label ?? '';
    // Not persisted here: the matchmaker records the room (with this metadata) once onCreate returns.
    void this.setMetadata(this.listing(), false);
  }

  /** What the lobby list shows for this room. Public: a name and counts, no player names, ids or addresses. */
  listing(): RoomListing {
    const humans = this.match.humans;
    return { mode: 'dm', label: this.state.label, stage: 'playing', humans, cap: this.maxClients, need: 0, left: 0 };
  }

  /** An empty room (no seats: no humans, no spectators, so no bots) sleeps until someone joins. */
  protected override idleWhenEmpty(): boolean {
    return this.match.idle;
  }

  /** Seats change on joins and leaves: list the new count at once (the tick loop may be asleep after the last leave). */
  protected override syncSeats(): void {
    super.syncSeats();
    this.updateListing();
  }

  /** Publish the listing when the human count changed. */
  private updateListing(): void {
    const l = this.listing();
    const key = `${l.humans}|${l.cap}`;
    if (key === this.listingKey) return;
    this.listingKey = key;
    this.setMetadata(l).catch((err: unknown) => console.error('[lobby] listing update failed:', err));
  }

  protected createMatch(options: IslandRoomOptions): Deathmatch {
    this.state.mode = GameMode.Deathmatch;
    this.state.scoreLimit = DEFAULT_DM.scoreLimit;
    return new Deathmatch(
      this.sim,
      {
        ...DEFAULT_DM,
        bots: options.bots !== false,
        createBot: options.createBot,
        isFar: (viewer, target, now, rtt) => this.interest.isFarAt(viewer, target, now, rtt),
        farExtraDelayMs: INTEREST.farExtraDelayMs,
      },
      {
        shot: (shooter, weapon, r) => this.queueShot(shooter, weapon, r),
        hit: (shooter, victim, damage, head, killed) => this.clients.getById(shooter.id)?.send(Msg.HitConfirm, [victim.pid, damage, head ? 1 : 0, killed ? 1 : 0]),
        damaged: (victim, from, damage) => this.sendDamaged(victim, from, damage),
        kill: (killer, victim, weapon, head) => this.sendKill(killer, victim, weapon, head),
        roundEnd: () => this.recordRound(),
        roundStart: () => (this.roundStartedAt = Date.now()),
      },
    );
  }

  protected addHuman(client: Client, name: string): Seat {
    return this.match.addHuman(client.sessionId, name);
  }

  protected removeHuman(id: string): void {
    this.match.remove(id);
  }

  protected override onSpectatorJoin(): void {
    this.match.allowBotsAlone = true;
    this.match.fillBots();
  }

  protected override onSpectatorLeave(): void {
    this.match.allowBotsAlone = this.spectators.size > 0;
    this.match.fillBots();
  }

  protected matchEndTick(): void {
    this.match.endTick();
  }

  protected writeMatchState(): void {
    const st = this.state;
    const dm = this.match;
    st.phase = dm.phase === 'playing' ? MatchPhase.Playing : MatchPhase.Intermission;
    st.timeLeft = dm.secondsLeft;
    if (st.winner !== dm.winner) st.winner = dm.winner;
    this.updateListing();
  }

  /** A deathmatch round counts for the leaderboard too (placement by kills). */
  private recordRound(): void {
    const seats = [...this.match.seats.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    if (!seats.some((s) => !s.bot)) return;
    void recordMatch({
      matchId: `${this.roomId}-${this.roundStartedAt}`,
      mode: 'dm',
      mapId: this.state.mapId,
      startedAt: this.roundStartedAt,
      endedAt: Date.now(),
      players: seats.map((s, i) => ({
        playerId: s.bot ? null : (this.seatPlayerIds.get(s.id) ?? null),
        name: s.name,
        isBot: s.bot !== null,
        placement: i + 1,
        kills: s.kills,
        damage: s.dealt,
        survivedMs: Date.now() - this.roundStartedAt,
        deaths: s.deaths,
      })),
    });
  }

  /** Test hook. */
  get dm(): Deathmatch {
    return this.match;
  }
}

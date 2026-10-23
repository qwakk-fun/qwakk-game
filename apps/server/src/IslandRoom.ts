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
import { eyeHeight, INTEREST, OPAQUE_QUERY_GROUPS, ROOM } from '@qwakk/shared';
import { DM_ROOM_CATALOG, type RoomListing } from '@qwakk/shared/lobby';
import { recordMatch } from './meta/index.ts';
import { DmPickup, DmRoundRow, GameMode, KillWeapon, MatchPhase, Msg, type PlayerState } from '@qwakk/shared/net';
import type { BotLike } from './arena.ts';
import { Deathmatch, DEFAULT_DM, type Seat } from './deathmatch.ts';
import { angleMilli, GameRoom, type GameRoomOptions, type JoinAuth } from './gameRoom.ts';
import type { ExplosiveEvents } from './dmExplosives.ts';
import { ExplosivesNet } from './dmExplosivesNet.ts';
import { dmMapId, GREYBOX, loadMap, type ServerMap } from './maps.ts';
import { parties } from './party/registry.ts';
import type { SimWorld } from '@qwakk/shared';
import { dmMaxHumans, dmPlayers, dmRoundRules, settings } from './settings/index.ts';

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
  /** Stops following the admin settings (on dispose). */
  private unwatch: (() => void) | null = null;
  /** Humans per room came from the server options (QWAKK_MAX_CLIENTS), not the settings. */
  private fixedCap = false;

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
    this.fixedCap = Boolean(options.maxClients);
    if (!this.fixedCap) this.maxClients = dmMaxHumans();
    // Admin settings that apply at once: ducks per room and humans per room.
    this.unwatch = settings.onChange((key) => this.settingChanged(key));
    this.state.label = entry?.label ?? '';
    // Not persisted here: the matchmaker records the room (with this metadata) once onCreate returns.
    void this.setMetadata(this.listing(), false);
  }

  private settingChanged(key: string): void {
    if (key === 'dm.players') {
      this.match.setPlayers(dmPlayers());
      this.syncSeats();
    } else if (key === 'dm.maxHumans' && !this.fixedCap) {
      this.maxClients = dmMaxHumans();
      if (this.locked && this.clients.length < this.maxClients) void this.unlock();
      this.updateListing();
    }
  }

  override onDispose(): void {
    this.unwatch?.();
    super.onDispose();
  }

  protected override roomStatus(): { kind: 'dm' | 'br'; mode: string; phase: string; secondsLeft: number } {
    const dm = this.match;
    return { kind: 'dm', mode: 'Free for all', phase: dm.idle ? 'idle' : dm.phase, secondsLeft: dm.idle ? 0 : dm.secondsLeft };
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
    const rules = dmRoundRules();
    this.state.scoreLimit = rules.scoreLimit;
    return new Deathmatch(
      this.sim,
      {
        ...DEFAULT_DM,
        ...rules,
        players: dmPlayers(),
        // Kill limit, round time and break: read again at every round start (admin settings).
        rules: dmRoundRules,
        bots: options.bots !== false,
        createBot: options.createBot,
        isFar: (viewer, target, now, rtt) => this.interest.isFarAt(viewer, target, now, rtt),
        farExtraDelayMs: INTEREST.farExtraDelayMs,
      },
      {
        shot: (shooter, weapon, r) => this.queueShot(shooter, weapon, r),
        hit: (shooter, victim, damage, head, killed) => this.clients.getById(shooter.id)?.send(Msg.HitConfirm, [victim.pid, damage, head ? 1 : 0, killed ? 1 : 0, 0]),
        damaged: (victim, from, damage) => this.sendDamaged(victim, from, damage),
        kill: (killer, victim, weapon, head) => {
          this.sendKill(killer, victim, weapon, head);
          const client = this.clients.getById(victim.id);
          // No killcam for a blast: a grenade over a wall or splash round a corner does not need a clear line, so the thrower's pose would leak.
          if (client && weapon !== KillWeapon.Grenade && weapon !== KillWeapon.Rocket) {
            const replay = this.match.replay.forDeath(this.match.currentTick, killer, victim);
            if (replay) client.send(Msg.DmKillcam, replay);
          }
        },
        reward: (seat, reward) => this.clients.getById(seat.id)?.send(Msg.DmReward, reward),
        powerup: (seat, kind) => this.clients.getById(seat.id)?.send(Msg.DmPower, kind),
        hero: (event, hero, other) => this.broadcast(Msg.DmHero, [event, hero.pid, other?.pid ?? 0]),
        // The coarse hero ping (dmHero.ts, the CLAUDE.md exception): grid meters, everyone but the hero.
        heroPing: (hero, x, z) => {
          for (const client of this.clients) if (client.sessionId !== hero.id) client.send(Msg.DmHeroPing, [hero.pid, x, z]);
        },
        explosives: this.explosiveEvents(),
        roundEnd: () => this.recordRound(),
        roundStart: () => {
          this.roundStartedAt = Date.now();
          this.explosivesNet?.clear();
          if (this.match) this.state.scoreLimit = this.match.scoreLimit;
        },
      },
    );
  }

  private explosivesNet: ExplosivesNet | null = null;

  /** Grenades, rockets and blasts to messages (who may hear what: dmExplosivesNet.ts), and their HUD feedback. */
  private explosiveEvents(): ExplosiveEvents {
    const net = new ExplosivesNet({
      viewers: () => this.clients,
      viewpoint: (id) => this.viewpointOf(id),
      sees: (viewer, target) => this.viewerSees(viewer, target),
      seesSpot: (viewer, x, y, z) => this.seesSpot(viewer, x, y, z),
    });
    this.explosivesNet = net;
    return {
      launched: (f, owner) => net.launched(f, owner),
      rested: (f) => net.rested(f),
      boom: (b) => net.boom(b),
      rocketPicked: (seat, rockets) => this.clients.getById(seat.id)?.send(Msg.DmRocket, rockets),
      // The hit marker (explosive flag set) and a damage arc toward the blast, never toward the thrower's position.
      blastHit: (attacker, victim, damage, killed) => this.clients.getById(attacker.id)?.send(Msg.HitConfirm, [victim.pid, damage, 0, killed ? 1 : 0, 0, 1]),
      blastDamaged: (victim, damage, x, z) => this.clients.getById(victim.id)?.send(Msg.Damaged, [angleMilli(victim.sim.x, victim.sim.z, x, z), damage, 0]),
    };
  }

  /** A clear opaque line from the viewer's eye to a point (a resting grenade). Spectators without a seat see it. */
  private seesSpot(viewerId: string, x: number, y: number, z: number): boolean {
    const vp = this.viewpointOf(viewerId);
    if (!vp) return true;
    const from = { x: vp.x, y: vp.y + eyeHeight(vp.crouch), z: vp.z };
    const dx = x - from.x;
    const dy = y - from.y;
    const dz = z - from.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < 0.05) return true;
    const hit = this.sim.world.castRay(new this.sim.rapier.Ray(from, { x: dx / d, y: dy / d, z: dz / d }), d, true, undefined, OPAQUE_QUERY_GROUPS);
    return !hit || hit.timeOfImpact >= d - 0.15;
  }

  /** The launcher pickup into the public state (at most one entry). */
  private writeRocketPickup(): void {
    const st = this.state;
    const p = this.match.explosives.rocket;
    for (const id of st.dmRockets.keys()) if (p?.id !== id) st.dmRockets.delete(id);
    if (p && !st.dmRockets.has(p.id)) st.dmRockets.set(p.id, new DmPickup({ kind: 0, x: p.x, y: p.y, z: p.z }));
  }

  /** Party id to its ally group in this room (the seats' `team`). */
  private readonly partyTeams = new Map<string, number>();

  /**
   * Free for all, except a party: its members (by verified player id, from
   * the party registry) share an ally group, so they cannot hurt each other
   * and always see each other.
   */
  protected addHuman(client: Client, name: string, auth: JoinAuth | undefined, character: number): Seat {
    const party = parties.partyOf(auth?.playerId);
    let team = 0;
    if (party) {
      team = this.partyTeams.get(party.id) ?? 0;
      if (team === 0) {
        // The smallest group number no seat or party holds now: a counter would
        // wrap in a room that never closes and ally two unrelated parties.
        const used = new Set([...this.partyTeams.values(), ...[...this.match.seats.values()].map((s) => s.team)]);
        team = 1;
        while (used.has(team)) team++;
        this.partyTeams.set(party.id, team);
      }
    }
    return this.match.addHuman(client.sessionId, name, team, character);
  }

  protected removeHuman(id: string): void {
    this.match.remove(id);
    // Forget ally groups nobody in the room belongs to any more.
    const used = new Set([...this.match.seats.values()].map((s) => s.team));
    for (const [party, team] of this.partyTeams) if (!used.has(team)) this.partyTeams.delete(party);
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

  protected override writeSeatExtras(seat: Seat, st: PlayerState): void {
    const stats = this.match.stats.get(seat.id);
    st.dmPoints = stats?.points ?? 0;
    st.dmStreak = stats?.streak ?? 0;
    st.dmBestStreak = stats?.bestStreak ?? 0;
  }

  protected writeMatchState(): void {
    const st = this.state;
    const dm = this.match;
    st.phase = dm.phase === 'playing' ? MatchPhase.Playing : MatchPhase.Intermission;
    st.timeLeft = dm.secondsLeft;
    if (st.winner !== dm.winner) st.winner = dm.winner;
    st.dmWeapon = dm.rotationWeapon;
    st.dmRotationLeft = dm.rotationSecondsLeft;
    if (st.dmHeroHp !== dm.hero.health) st.dmHeroHp = dm.hero.health;
    for (const id of st.dmPickups.keys()) if (!dm.powerups.pickups.has(id)) st.dmPickups.delete(id);
    for (const [id, p] of dm.powerups.pickups) {
      if (!st.dmPickups.has(id)) st.dmPickups.set(id, new DmPickup({ kind: p.kind, x: p.x, y: p.y, z: p.z }));
    }
    this.writeRocketPickup();
    if (dm.phase === 'playing') st.dmResults.clear();
    else for (const result of dm.results) {
      if (!st.dmResults.has(String(result.pid))) st.dmResults.set(String(result.pid), new DmRoundRow(result));
    }
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

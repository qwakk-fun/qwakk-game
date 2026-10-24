/**
 * Duck Plaza: the shared 3D square players walk around in between matches.
 * No combat at all: ducks walk, sprint, crouch and jump with the match
 * movement (the shared sim with only the movement buttons, predicted by the
 * owner), chat in speech bubbles, quack and dance, invite each other into a
 * team (a party, party/PartyRoom.ts) and walk through the portals into the
 * game modes.
 *
 * Netcode and anti-cheat (CLAUDE.md): clients send inputs only, sanitized
 * with the movement buttons only (sanitizeHubInput); the server owns every
 * position. Identity comes from verifySession, the level from the database;
 * a client never sends a player id, name, tag, level or account flag.
 * Invites, answers and emotes are rate-limited requests the server checks;
 * party codes go only to the two ducks of an accepted invite. Portals are
 * decided on the server's position: the client is told "go" and joins that
 * mode like the menu did. Nothing here sends a player id, token or address.
 */
import { matchMaker, Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import { Button, characterFromOption, clampAngleRate, COMBAT, createSimWorld, DT, emptyInput, initPhysics, isCharacterId, NET, PARTY, stepPlayer, TICK_RATE, type InputFrame, type PlayerSim, type SimWorld } from '@qwakk/shared';
import { Msg, PlayerInput } from '@qwakk/shared/net';
import { CLOSE_CODE, LOBBY_ERROR } from '@qwakk/shared/lobby';
import { ACCOUNT_PORTALS, HUB, HubEmote, HubMsg, HubNote, isPortalId, portalAt, PORTALS, type HubSpawn, type PortalId } from '@qwakk/shared/hub';
import { createHubSim, HUB_SIM_FIELDS, sanitizeHubInput } from '@qwakk/shared/hub/sim';
import { HubDuck, HubPose, HubState } from '@qwakk/shared/hub/schema';
import { InputPacer } from '../inputPacer.ts';
import { TickLoop } from '../tickLoop.ts';
import { RoomStats } from '../stats.ts';
import { ChatLimiter } from '../chat.ts';
import { cleanName } from '../gameRoom.ts';
import { allowJoin, joinIp, playerLevel, verifySession } from '../meta/index.ts';
import { isIpBlocked } from '../ops/ipBlocks.ts';
import { liveRooms, type LiveRoom, type RoomInfo, type RoomPlayer } from '../ops/rooms.ts';
import { maintenanceOn } from '../settings/index.ts';
import { parties } from '../party/registry.ts';
import { filterHubChat } from './chatFilter.ts';
import { HubInterest } from './interest.ts';
import { InviteBook, Limiter } from './invites.ts';
import { HubTeams } from './teams.ts';
import { loadHubMap, type ServerHubMap } from './hubMap.ts';

/** Close code for the older connection when the same duck opens the plaza again (another tab). */
export const HUB_ELSEWHERE = 4409;

export interface HubRoomOptions {
  /** The hub map (default HUB.mapId). */
  mapId?: string;
  /** Print timing stats every this many ms (0 or unset: off). */
  statsMs?: number;
  /** Ducks per room (default HUB.maxClients; the benchmark may raise it). */
  maxClients?: number;
  /** Open a party room for an accepted invite and return its code (default: matchMaker.createRoom). */
  createParty?: () => Promise<string>;
}

interface HubAuth {
  playerId: string;
  name: string;
  tag: string;
  signed: boolean;
  account: boolean;
  look?: number;
  /** Account level, 0 for a guest. */
  level: number;
  /** Memory only (admin IP blocks), never stored or sent. */
  ip: string;
}

interface HubJoinOptions {
  token?: unknown;
  character?: unknown;
  /** Back from a mode: appear in front of its portal. */
  portal?: unknown;
}

interface Seat {
  id: string;
  pid: number;
  auth: HubAuth;
  sim: PlayerSim;
  duck: HubDuck;
  pose: HubPose;
  farPose: HubPose;
  pacer: InputPacer<PlayerInput>;
  frame: InputFrame;
  idle: InputFrame;
  spawnTick: number;
  /** No portal answer before this time (ms room clock). */
  portalQuiet: number;
  /** Dancing until (ms room clock), 0: not. */
  danceUntil: number;
}

export class HubRoom extends Room<{ state: HubState; input: PlayerInput }> implements LiveRoom {
  override maxClients: number = HUB.maxClients;
  override maxMessagesPerSecond = NET.maxMessagesPerSecond;

  override inputs = this.defineInput(PlayerInput, {
    bufferMaxSize: NET.maxInputBuffer,
    sanitize: (f) => sanitizeHubInput(f),
    stepSeconds: DT,
  });

  private map!: ServerHubMap;
  private sim!: SimWorld;
  private loop: TickLoop | null = null;
  private stats!: RoomStats;
  private tickNo = 0;
  private readonly seats = new Map<string, Seat>();
  private readonly interest = new HubInterest();
  private readonly invites = new InviteBook();
  private readonly emotes = new Limiter(HUB.emote.burst, HUB.emote.refillMs);
  private readonly chat = new ChatLimiter();
  private readonly teams = new HubTeams(parties);
  /** Leaders whose new party is being opened right now, and the ducks waiting for it. */
  private readonly opening = new Map<string, { sessionId: string; playerId: string }[]>();
  private createParty: () => Promise<string> = async () => (await matchMaker.createRoom(PARTY.roomName, {})).roomId;
  private readonly createdAt = Date.now();
  private patchFromLoop = false;

  override async onAuth(_client: Client, options: HubJoinOptions = {}, context?: AuthContext): Promise<HubAuth> {
    const ip = joinIp(context as never);
    if (isIpBlocked(ip) || !allowJoin(ip)) throw new Error('too many joins, try again in a moment');
    if (maintenanceOn()) throw new ServerError(LOBBY_ERROR.maintenance, 'the server is under maintenance');
    const token = typeof options.token === 'string' ? options.token : undefined;
    const who = await verifySession(token);
    if (!who) throw new Error('invalid session');
    const level = who.account ? Math.max(1, Math.min(255, (await playerLevel(who.playerId)) ?? 1)) : 0;
    return { playerId: who.playerId, name: who.name, tag: who.tag, signed: token !== undefined && token !== '', account: who.account, ...(who.look !== undefined ? { look: who.look } : {}), level, ip };
  }

  override async onCreate(options: HubRoomOptions = {}): Promise<void> {
    await initPhysics();
    this.map = loadHubMap(options.mapId ?? HUB.mapId);
    this.sim = createSimWorld(this.map.def);
    if (options.maxClients) this.maxClients = options.maxClients;
    if (options.createParty) this.createParty = options.createParty;
    const state = new HubState();
    state.mapId = this.map.def.id;
    state.mapHash = this.map.hash;
    state.seed = this.map.def.seed;
    this.state = state;

    this.onMessage(Msg.Chat, (client, raw: unknown) => this.onChat(client, raw));
    this.onMessage(HubMsg.Invite, (client, raw: unknown) => this.onInvite(client, raw));
    this.onMessage(HubMsg.Answer, (client, raw: unknown) => void this.onAnswer(client, raw));
    this.onMessage(HubMsg.Emote, (client, raw: unknown) => this.onEmote(client, raw));

    // The same fixed-rate loop and one patch per tick as the game rooms (tickLoop.ts, gameRoom.ts).
    this.patchRate = 1000 / TICK_RATE;
    this.loop = new TickLoop(TICK_RATE, (first, count) => {
      this.clock.tick();
      for (let i = 0; i < count; i++) this.tick(first + i);
      this.patchFromLoop = true;
      try {
        this.broadcastPatch();
      } finally {
        this.patchFromLoop = false;
      }
    });
    this.loop.start();
    this.stats = new RoomStats(this.roomId, () => this.seats.size);
    liveRooms.add(this);
    if (options.statsMs && options.statsMs > 0) this.stats.start(options.statsMs, (s) => console.log(`[stats] ${JSON.stringify({ ...s, hubPairs: this.takePairs() })}`));
  }

  private takePairs(): number {
    const n = this.interest.pairs;
    this.interest.pairs = 0;
    return n;
  }

  /** The framework's patch timer calls this too; only the tick loop's call sends. */
  override broadcastPatch(): boolean {
    if (!this.patchFromLoop) return false;
    const t0 = performance.now();
    const sent = super.broadcastPatch();
    this.stats?.recordPatch(performance.now() - t0);
    return sent;
  }

  override onJoin(client: Client, options: HubJoinOptions = {}, auth?: HubAuth): void {
    if (!auth) {
      client.leave(4401, 'invalid session');
      return;
    }
    // The same duck again (another tab, or a reload before the old socket closed): the newest one stays.
    for (const s of this.seats.values()) if (s.auth.playerId === auth.playerId) this.clients.getById(s.id)?.leave(HUB_ELSEWHERE, 'opened elsewhere');
    const [x, y, z, yaw] = this.spawnPoint(isPortalId(options.portal) ? options.portal : null);
    const sim = createHubSim(x, y, z, yaw);
    const duck = new HubDuck();
    duck.name = cleanName(auth.name, 'Duck');
    duck.tag = auth.signed ? auth.tag : '';
    duck.pid = this.freePid();
    duck.character = auth.look !== undefined && isCharacterId(auth.look) ? auth.look : characterFromOption(options.character);
    duck.level = auth.level;
    duck.team = this.teams.markerOf(auth.playerId);
    const seat: Seat = {
      id: client.sessionId,
      pid: duck.pid,
      auth,
      sim,
      duck,
      pose: new HubPose(),
      farPose: new HubPose(),
      pacer: new InputPacer<PlayerInput>({
        stepMs: 1000 / TICK_RATE,
        creditCap: NET.maxInputCredit,
        graceTicks: NET.starveGraceTicks,
        repeatTicks: NET.standInRepeatTicks,
        maxDebt: NET.maxStandInDebt,
        lateMarginMs: NET.lateMarginMs,
      }),
      frame: emptyInput(),
      idle: emptyInput(),
      spawnTick: this.tickNo,
      portalQuiet: this.clock.elapsedTime + HUB.portalCooldownMs,
      danceUntil: 0,
    };
    this.seats.set(seat.id, seat);
    this.writeDuck(seat, true);
    this.state.ducks.set(seat.id, duck);
    this.state.poses.set(seat.id, seat.pose);
    this.state.farPoses.set(seat.id, seat.farPose);
    client.view = new StateView();
    // Owner-only movement state reaches this client and nobody else.
    client.view.add(duck);
    this.interest.addViewer(seat.id, client.view);
    this.updateInterest();
  }

  override onLeave(client: Client): void {
    const id = client.sessionId;
    this.interest.removeViewer(id);
    this.interest.forget(id);
    this.invites.forget(id);
    this.emotes.forget(id);
    this.chat.forget(id);
    this.teams.forget(id);
    if (!this.seats.delete(id)) return;
    this.state.ducks.delete(id);
    this.state.poses.delete(id);
    this.state.farPoses.delete(id);
  }

  override onDispose(): void {
    liveRooms.delete(this);
    this.loop?.stop();
    this.stats?.stop();
    this.sim?.dispose();
  }

  // ---- spawning --------------------------------------------------------------

  private spawnPoint(portal: PortalId | null): HubSpawn {
    const list = (portal && this.map.hub.exits[portal].length > 0 ? this.map.hub.exits[portal] : this.map.hub.spawns) as HubSpawn[];
    const base = list[Math.floor(Math.random() * list.length)] as HubSpawn;
    // A little scatter, so a group coming back together does not stack in one spot.
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 1.2;
    return [base[0] + Math.cos(a) * r, base[1] + 0.2, base[2] + Math.sin(a) * r, base[3]];
  }

  private freePid(): number {
    const used = new Set([...this.seats.values()].map((s) => s.pid));
    for (let p = 1; p < 65535; p++) if (!used.has(p)) return p;
    return 65535;
  }

  private seatByPid(pid: unknown): Seat | null {
    if (typeof pid !== 'number' || !Number.isInteger(pid)) return null;
    for (const s of this.seats.values()) if (s.pid === pid) return s;
    return null;
  }

  // ---- the tick --------------------------------------------------------------

  private tick(tick: number): void {
    const t0 = performance.now();
    this.tickNo = tick;
    const now = this.clock.elapsedTime;
    for (const seat of this.seats.values()) {
      seat.pacer.tick(
        this.inputs.get(seat.id),
        now,
        (input) => {
          const f = seat.frame;
          f.mx = input.mx;
          f.mz = input.mz;
          f.buttons = input.buttons;
          f.yaw = input.yaw;
          f.pitch = input.pitch;
          f.tick = input.tick;
          this.step(seat, f);
        },
        (kind) => {
          // Late inputs (a stall): keep the duck simulated, as the game rooms do (inputPacer.ts).
          const f = seat.idle;
          if (kind === 'repeat') Object.assign(f, seat.frame);
          else {
            f.mx = 0;
            f.mz = 0;
            f.yaw = seat.sim.yaw;
            f.pitch = seat.sim.pitch;
            f.buttons = 0;
          }
          f.buttons &= ~Button.Jump | (seat.sim.prevButtons & Button.Jump);
          this.step(seat, f);
        },
      );
      this.afterStep(seat, now);
    }
    const far = tick % HUB.farEveryTicks === 0;
    for (const seat of this.seats.values()) this.writeDuck(seat, far);
    if (tick % HUB.interestEveryTicks === 0) this.updateInterest();
    if (tick % HUB.teamEveryTicks === 0) this.refreshTeams();
    if (tick % 5 === 0) this.pollLinks(now);
    if (tick % 30 === 0) for (const inv of this.invites.expire(now)) this.note(inv.from, HubNote.Expired, this.seats.get(inv.to)?.pid ?? 0);
    this.state.tick = tick;
    this.stats.recordTick(performance.now() - t0);
  }

  private step(seat: Seat, f: InputFrame): void {
    // The turn-rate cap of the game rooms, after the short spawn grace.
    if (this.tickNo - seat.spawnTick >= COMBAT.spawnTurnGraceTicks) clampAngleRate(seat.sim.yaw, seat.sim.pitch, f);
    stepPlayer(this.sim, seat.sim, f, DT);
  }

  private afterStep(seat: Seat, now: number): void {
    const s = seat.sim;
    const half = this.map.def.size / 2;
    // Fell through or out of the square (it should not happen): back to a spawn, the client snaps there.
    if (s.y < HUB.minY || Math.abs(s.x) > half || Math.abs(s.z) > half) {
      const [x, y, z, yaw] = this.spawnPoint(null);
      Object.assign(s, createHubSim(x, y, z, yaw));
      seat.spawnTick = this.tickNo;
    }
    if (seat.danceUntil > 0 && (now > seat.danceUntil || Math.hypot(s.vx, s.vz) > HUB.emote.danceStopSpeed)) seat.danceUntil = 0;
    if (now < seat.portalQuiet) return;
    const portal = portalAt(this.map.hub.portals, s.x, s.y, s.z);
    if (portal) this.enterPortal(seat, portal.id, now);
  }

  /** A duck walked into a portal: go, or say why not (a guest, a team member, a team with a guest). */
  private enterPortal(seat: Seat, id: PortalId, now: number): void {
    seat.portalQuiet = now + HUB.portalCooldownMs;
    const index = PORTALS.indexOf(id);
    const accountOnly = ACCOUNT_PORTALS.includes(id);
    const me = seat.auth.playerId;
    if (accountOnly && !seat.auth.account) return this.note(seat.id, HubNote.Locked, 0, index);
    const party = parties.partyOf(me);
    if (party && party.members.length > 1 && party.leaderId !== me) return this.note(seat.id, HubNote.LeaderPicks, 0, index);
    if (accountOnly && parties.partyHasGuest(me)) return this.note(seat.id, HubNote.PartyGuest, 0, index);
    seat.portalQuiet = now + HUB.portalLeaveMs;
    this.clients.getById(seat.id)?.send(HubMsg.Portal, [index]);
  }

  /** Copy a duck into its schema entries (only changed fields go out). */
  private writeDuck(seat: Seat, writeFar: boolean): void {
    const s = seat.sim;
    const d = seat.duck as unknown as Record<string, number>;
    for (const f of HUB_SIM_FIELDS) if (d[f] !== s[f]) d[f] = s[f];
    const emote = seat.danceUntil > 0 ? HubEmote.Dance : 0;
    writePose(seat.pose, s, emote);
    if (writeFar) writePose(seat.farPose, s, emote);
  }

  private updateInterest(): void {
    const list = [...this.seats.values()].map((s) => ({ id: s.id, x: s.sim.x, z: s.sim.z, pose: s.pose, farPose: s.farPose }));
    this.interest.update(list);
  }

  private refreshTeams(): void {
    const ids = [...this.seats.values()].map((s) => s.auth.playerId);
    this.teams.sweep(ids);
    for (const s of this.seats.values()) {
      const m = this.teams.markerOf(s.auth.playerId);
      if (s.duck.team !== m) s.duck.team = m;
    }
  }

  // ---- messages --------------------------------------------------------------

  private note(sessionId: string, kind: number, pid = 0, portal = 0): void {
    this.clients.getById(sessionId)?.send(HubMsg.Note, [kind, pid, portal]);
  }

  private onChat(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    const text = filterHubChat(raw);
    if (!text) return;
    if (!this.chat.allow(seat.id, this.clock.elapsedTime)) {
      client.send(Msg.ChatLimited);
      return;
    }
    this.broadcast(Msg.Chat, { pid: seat.pid, name: seat.duck.name, tag: seat.duck.tag, text });
  }

  private onEmote(client: Client, raw: unknown): void {
    const seat = this.seats.get(client.sessionId);
    const kind = Array.isArray(raw) ? raw[0] : raw;
    if (!seat || (kind !== HubEmote.Quack && kind !== HubEmote.Dance)) return;
    const now = this.clock.elapsedTime;
    if (!this.emotes.allow(seat.id, now)) return this.note(seat.id, HubNote.Limited);
    if (kind === HubEmote.Dance) {
      seat.danceUntil = seat.danceUntil > 0 ? 0 : now + HUB.emote.danceMs;
      return;
    }
    // The quack: to the duck itself and to every duck that receives its pose.
    for (const c of this.clients) if (c.sessionId === seat.id || this.interest.sees(c.sessionId, seat.id)) c.send(HubMsg.Quack, [seat.pid]);
  }

  private onInvite(client: Client, raw: unknown): void {
    const from = this.seats.get(client.sessionId);
    const to = this.seatByPid(Array.isArray(raw) ? raw[0] : raw);
    if (!from || !to || to === from) return;
    const now = this.clock.elapsedTime;
    if (Math.hypot(to.sim.x - from.sim.x, to.sim.z - from.sim.z) > HUB.invite.maxDistance) return this.note(from.id, HubNote.TooFar, to.pid);
    const mine = parties.partyOf(from.auth.playerId);
    if (mine?.members.includes(to.auth.playerId)) return this.note(from.id, HubNote.Teammates, to.pid);
    if (mine && mine.members.length >= PARTY.maxSize) return this.note(from.id, HubNote.TeamFull, to.pid);
    // Leaving through a portal right now.
    if (to.portalQuiet - now > HUB.portalCooldownMs) return this.note(from.id, HubNote.Busy, to.pid);
    const r = this.invites.invite(from.id, to.id, now);
    if (r === 'limited') return this.note(from.id, HubNote.Limited, to.pid);
    if (r === 'busy') return this.note(from.id, HubNote.Busy, to.pid);
    if (r !== 'ok') return;
    this.clients.getById(to.id)?.send(HubMsg.Invited, [from.pid, from.duck.name, from.duck.tag]);
    this.note(from.id, HubNote.InviteSent, to.pid);
  }

  private async onAnswer(client: Client, raw: unknown): Promise<void> {
    const me = this.seats.get(client.sessionId);
    if (!me || !Array.isArray(raw)) return;
    const from = this.seatByPid(raw[0]);
    if (!from) return;
    const inv = this.invites.answer(me.id, from.id, this.clock.elapsedTime);
    if (!inv) return this.note(me.id, HubNote.Expired, from.pid);
    if (raw[1] !== 1) return this.note(from.id, HubNote.Declined, me.pid);
    const leader = from.auth.playerId;
    const plan = this.teams.plan(leader, me.auth.playerId, me.id);
    if (plan?.kind === 'teammates') return this.note(from.id, HubNote.Teammates, me.pid);
    if (plan?.kind === 'full') {
      this.note(from.id, HubNote.TeamFull, me.pid);
      return this.note(me.id, HubNote.TeamFull, from.pid);
    }
    if (plan) {
      for (const sid of plan.to) this.sendParty(sid, plan.code);
      if (plan.to.length > 0) this.note(from.id, HubNote.Joined, me.pid);
      return;
    }
    // No party yet: open one. Ducks accepting while it opens wait for the same one.
    const waiting = this.opening.get(leader);
    const entry = { sessionId: me.id, playerId: me.auth.playerId };
    if (waiting) {
      if (waiting.length + 1 >= PARTY.maxSize) return this.note(me.id, HubNote.TeamFull, from.pid);
      waiting.push(entry);
      return;
    }
    this.opening.set(leader, [entry]);
    let code: string;
    try {
      code = await this.createParty();
    } catch (err) {
      console.warn('[hub] could not open a party:', err instanceof Error ? err.message : err);
      for (const w of this.opening.get(leader) ?? []) this.note(w.sessionId, HubNote.Failed, from.pid);
      this.note(from.id, HubNote.Failed, me.pid);
      this.opening.delete(leader);
      return;
    }
    const members = this.opening.get(leader) ?? [];
    this.opening.delete(leader);
    this.teams.opened(code, leader, members, this.clock.elapsedTime);
    // The leader joins first (the first member of a party leads), the others once it is in (pollLinks).
    if (this.seats.has(from.id)) this.sendParty(from.id, code);
  }

  private sendParty(sessionId: string, code: string): void {
    this.clients.getById(sessionId)?.send(HubMsg.Party, { code });
  }

  private pollLinks(now: number): void {
    const { ready, failed } = this.teams.poll(now);
    for (const r of ready) {
      for (const sid of r.to) this.sendParty(sid, r.code);
      const leader = [...this.seats.values()].find((s) => s.auth.playerId === r.leaderId);
      for (const sid of r.to) if (leader) this.note(leader.id, HubNote.Joined, this.seats.get(sid)?.pid ?? 0);
    }
    for (const f of failed) {
      for (const sid of f.to) this.note(sid, HubNote.Failed);
      const leader = [...this.seats.values()].find((s) => s.auth.playerId === f.leaderId);
      if (leader) this.note(leader.id, HubNote.Failed);
    }
  }

  // ---- admin panel (ops/rooms.ts) ---------------------------------------------

  roomInfo(): RoomInfo {
    return {
      roomId: this.roomId,
      kind: 'hub',
      label: 'Duck Plaza',
      mode: '',
      mapId: this.state?.mapId ?? '',
      humans: this.seats.size,
      bots: 0,
      spectators: 0,
      phase: 'open',
      secondsLeft: 0,
      locked: this.locked,
      maxHumans: this.maxClients,
      tick: this.stats?.recent() ?? { avg: 0, p95: 0, max: 0, samples: 0 },
      createdAt: this.createdAt,
    };
  }

  roomPlayers(): RoomPlayer[] {
    return [...this.seats.values()]
      .map((s) => ({ sessionId: s.id, name: s.duck.name, tag: s.duck.tag, playerId: s.auth.playerId, bot: false, spectator: false, alive: true, kills: 0, deaths: 0, team: s.duck.team, pingMs: 0 }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  removePlayer(sessionId: string): boolean {
    const client = this.clients.getById(sessionId);
    if (!client) return false;
    client.leave(CLOSE_CODE.removed, 'removed');
    return true;
  }

  removePlayerId(playerId: string): number {
    let n = 0;
    for (const s of [...this.seats.values()]) if (s.auth.playerId === playerId && this.removePlayer(s.id)) n++;
    return n;
  }

  ipOf(sessionId: string): string | null {
    return this.seats.get(sessionId)?.auth.ip ?? null;
  }

  notice(text: string): void {
    this.broadcast(Msg.Notice, text);
  }

  close(): Promise<unknown> {
    return this.disconnect(CLOSE_CODE.roomClosed);
  }

  /** Tests and tools. */
  get currentTick(): number {
    return this.tickNo;
  }

  /** Tests: a duck's server position by pid. */
  positionOf(pid: number): { x: number; y: number; z: number } | null {
    const s = this.seatByPid(pid);
    return s ? { x: s.sim.x, y: s.sim.y, z: s.sim.z } : null;
  }

  /** Tests: put a duck somewhere (as if it walked there). */
  placeForTest(pid: number, x: number, y: number, z: number): void {
    const s = this.seatByPid(pid);
    if (!s) return;
    s.sim.x = Math.fround(x);
    s.sim.y = Math.fround(y);
    s.sim.z = Math.fround(z);
    s.portalQuiet = 0;
  }
}

function writePose(p: HubPose, s: PlayerSim, emote: number): void {
  p.x = s.x;
  p.y = s.y;
  p.z = s.z;
  p.yaw = s.yaw;
  p.pitch = s.pitch;
  if (p.crouch !== s.crouch) p.crouch = s.crouch;
  if (p.grounded !== s.grounded) p.grounded = s.grounded;
  if (p.emote !== emote) p.emote = emote;
}

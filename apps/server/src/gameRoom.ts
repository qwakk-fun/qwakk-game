/**
 * Networking glue shared by the deathmatch and battle royale rooms.
 *
 * Netcode rules (see CLAUDE.md): clients send inputs only. The server owns
 * position, velocity, ammo, inventory, hits and damage, sanitizes every
 * input, caps the input buffer and the rate inputs are consumed at,
 * validates every shot with lag compensation, and broadcasts state at the
 * tick rate. Subclasses own the rules (a match object built on arena.ts).
 */
import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import {
  actionOf,
  Button,
  characterFromOption,
  createSimWorld,
  hasWeapon,
  emptyInput,
  initPhysics,
  INTEREST,
  Mode,
  NET,
  PLAYER_SIM_FIELDS,
  sanitizeInputFields,
  DT,
  TICK_RATE,
  VIS,
  type InputFrame,
  type ShotResult,
  type SimWorld,
} from '@qwakk/shared';
import { IslandState, KillWeapon, Msg, PlayerInput, PlayerState, Pose, TeamMate } from '@qwakk/shared/net';
import { KILL_BLEED, type Arena, type Seat } from './arena.ts';
import { parties } from './party/registry.ts';
import { RoomStats } from './stats.ts';
import { InputPacer } from './inputPacer.ts';
import { TickLoop } from './tickLoop.ts';
import { Interest, type ViewerPoint } from './interest.ts';
import { RttProbe } from './rttProbe.ts';
import { Visibility } from './visibility.ts';
import type { ServerMap } from './maps.ts';
import { allowJoin, joinIp, verifySession } from './meta/index.ts';
import { CLOSE_CODE, LOBBY_ERROR } from '@qwakk/shared/lobby';
import { isIpBlocked } from './ops/ipBlocks.ts';
import { liveRooms, type LiveRoom, type RoomInfo, type RoomPlayer } from './ops/rooms.ts';
import { maintenanceOn } from './settings/index.ts';
import { ChatLimiter, cleanChat } from './chat.ts';

/** Join refusal codes the client understands (onAuth errors). */
export const JOIN_ERROR = {
  /** This identity already has a seat in the match (another tab). */
  alreadyInMatch: 4409,
} as const;

export interface GameRoomOptions {
  seed?: number;
  /** Print timing stats every this many ms (0 or unset: off). */
  statsMs?: number;
  /** Fill the room with bots (default on). */
  bots?: boolean;
  /** Human clients per room. */
  maxClients?: number;
  /** Interest management (near and far poses). Off sends every player every tick. */
  interest?: boolean;
  /** Allow `{ spectate: true }` joins (tests and tools). */
  spectators?: boolean;
}

export interface JoinOptions {
  name?: unknown;
  spectate?: unknown;
  token?: unknown;
  /** The picked duck (`characters.ts` id); unknown or missing: the classic duck. */
  character?: unknown;
}

/** Who joined, from onAuth (meta verifySession). */
export interface JoinAuth {
  playerId: string | null;
  name: string;
  /** Guest #tag (shown in the waiting room and lists). */
  tag: string;
  /** True when the identity came from a session token (its name wins over the join options). */
  signed: boolean;
  /** The address it joined from: memory only (admin IP blocks), never stored or sent. */
  ip?: string;
}

/** Network side of a seat. */
export interface NetSeat {
  state: PlayerState;
  pose: Pose;
  farPose: Pose;
  /** Humans only. */
  pacer: InputPacer<PlayerInput> | null;
  /** The last input actually simulated; 'repeat' stand-in steps reuse it. */
  frame: InputFrame;
  /** Scratch frame for stand-in steps (a repeat without the trigger, or idle). */
  idle: InputFrame;
  /** The teammate entry (HUD health, knocked, revive) its allies get; null without a team. */
  mate: TeamMate | null;
}

interface ShotFx {
  pid: number;
  shooterId: string;
  weapon: number;
  /** Shooter position (m) for the direction hint. */
  sx: number;
  sz: number;
  data: number[];
}

export function cleanName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const name = raw.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
  return name.length > 0 ? name : fallback;
}

export const cm = (v: number): number => Math.round(v * 100);

/** World angle (three.js yaw convention) from (fx, fz) toward (tx, tz), in milliradians. */
export function angleMilli(fx: number, fz: number, tx: number, tz: number): number {
  return Math.round(Math.atan2(-(tx - fx), -(tz - fz)) * 1000);
}

export abstract class GameRoom<M extends Arena> extends Room<{ state: IslandState; input: PlayerInput }> implements LiveRoom {
  /** Inputs arrive at 30 Hz; the headroom lets a backlog flush after a network stall. */
  override maxMessagesPerSecond = NET.maxMessagesPerSecond;

  override inputs = this.defineInput(PlayerInput, {
    bufferMaxSize: NET.maxInputBuffer,
    sanitize: (f) => sanitizeInputFields(f),
    // Advertised to clients in the join handshake: they predict at exactly this dt.
    stepSeconds: DT,
  });

  protected sim!: SimWorld;
  protected match!: M;
  protected interest!: Interest;
  protected vis!: Visibility;
  protected readonly net = new Map<string, NetSeat>();
  protected readonly spectators = new Set<string>();
  protected allowSpectators = false;
  protected joinCount = 0;
  protected stats!: RoomStats;
  private loop: TickLoop | null = null;
  private shotFx: ShotFx[] = [];
  private rttTimer: NodeJS.Timeout | null = null;
  private readonly rtt = new RttProbe();
  private tickNo = 0;
  /** Meta identity per session (null playerId: guest without a token in dev). */
  protected readonly auths = new Map<string, JoinAuth>();
  private readonly chat = new ChatLimiter();

  /** The map for this room. */
  protected abstract loadMap(options: GameRoomOptions): ServerMap;
  /** The rules object (deathmatch or battle royale). */
  protected abstract createMatch(options: GameRoomOptions): M;
  /** Seat for a joining human (wearing `character`, already validated), or null when the match does not take players now. */
  protected abstract addHuman(client: Client, name: string, auth: JoinAuth | undefined, character: number): Seat | null;
  protected abstract removeHuman(id: string): void;
  /** Run the match's end of tick (bots, timers). */
  protected abstract matchEndTick(): void;
  /**
   * Refuse a join before it takes a seat (onAuth), with a ServerError the
   * menu explains: battle royale teams that cannot take the player's party.
   */
  protected checkAdmission(_auth: JoinAuth): void {}
  /** Revive progress shown on a teammate's HUD entry (0..1) and who revives it. */
  protected reviveOf(_seat: Seat): { progress: number; by: Seat | null } {
    return { progress: 0, by: null };
  }
  /** Mirror match-level state (phase, timers, zone) into the schema after each tick. */
  protected abstract writeMatchState(tick: number): void;
  /** Per-seat extras beyond the sim fields. */
  protected writeSeatExtras(_seat: Seat, _st: PlayerState): void {}
  /** Line-of-sight culling of enemy poses (anti-wallhack). */
  protected cullHidden(): boolean {
    return false;
  }
  /** Where a viewer looks from (spectating dead players look through the duck they watch). */
  protected viewpointOf(viewerId: string): ViewerPoint | null {
    const s = this.match.seats.get(viewerId);
    if (!s) return null;
    const p = s.sim;
    return { x: p.x, y: p.y, z: p.z, vx: p.vx, vz: p.vz, yaw: p.yaw, crouch: p.crouch, watchId: null, halfRttMs: Math.max(0, s.rttMs) / 2 };
  }

  override async onAuth(client: Client, options: JoinOptions = {}, context?: AuthContext): Promise<JoinAuth> {
    const ip = joinIp(context as never);
    if (isIpBlocked(ip) || !allowJoin(ip)) throw new Error('too many joins, try again in a moment');
    // Maintenance: no new players; the ones already in play on (reconnects do not pass here).
    if (maintenanceOn() && options.spectate !== true) throw new ServerError(LOBBY_ERROR.maintenance, 'the server is under maintenance');
    const token = typeof options.token === 'string' ? options.token : undefined;
    const who = await verifySession(token);
    if (!who) throw new Error('invalid session');
    const signed = token !== undefined && token !== '';
    const auth: JoinAuth = { playerId: who.playerId, name: who.name, tag: who.tag, signed, ip };
    if (options.spectate !== true) this.checkAdmission(auth);
    // One seat per identity: a second tab with the same session is refused.
    if (signed) {
      const held = this.seatedIds.get(who.playerId);
      if (held && (this.clients.getById(held.sessionId) || Date.now() - held.at < 15_000)) {
        throw new ServerError(JOIN_ERROR.alreadyInMatch, 'already in this match');
      }
      this.seatedIds.set(who.playerId, { sessionId: client.sessionId, at: Date.now() });
    }
    return auth;
  }

  /** Signed identities holding (or about to take) a seat here: playerId to session. */
  private readonly seatedIds = new Map<string, { sessionId: string; at: number }>();
  /** Every seat's player id, kept after the player leaves (match results). */
  protected readonly seatPlayerIds = new Map<string, string | null>();

  override async onCreate(options: GameRoomOptions = {}): Promise<void> {
    await initPhysics();
    const map = this.loadMap(options);
    this.sim = createSimWorld(map.def);
    if (options.maxClients) this.maxClients = options.maxClients;
    this.allowSpectators = options.spectators === true;

    const state = new IslandState();
    state.seed = map.def.seed;
    state.mapId = map.def.id;
    state.mapHash = map.hash;
    this.state = state;

    this.vis = new Visibility(this.sim);
    // Allies always get each other's pose (markers through walls); enemies stay culled.
    this.interest = new Interest({ enabled: options.interest !== false, cull: this.cullHidden(), ally: (a, b) => this.match.alliesById(a, b) }, this.vis);
    this.match = this.createMatch(options);

    this.onMessage(Msg.Chat, (client, raw: unknown) => {
      const seat = this.match.seats.get(client.sessionId);
      const state = this.net.get(client.sessionId)?.state;
      if (!seat || seat.bot || !state || this.spectators.has(client.sessionId)) return;
      const text = cleanChat(raw);
      if (!text) return;
      if (!this.chat.allow(client.sessionId, this.clock.elapsedTime)) {
        client.send(Msg.ChatLimited);
        return;
      }
      this.broadcast(Msg.Chat, { pid: seat.pid, name: state.name, tag: state.tag, text });
    });

    // Our own fixed-rate loop (see tickLoop.ts for why not setFixedTimestep).
    // Patches go out from the loop, right after each tick, instead of from the
    // framework's free-running patch timer, which drifts against the ticks.
    // patchRate stays at the real cadence because it is advertised to clients
    // (they size their input replay ring from it); the timer's own calls are
    // ignored in broadcastPatch(). Do not set it to null: without a Colyseus
    // simulation interval that starts a hidden 60 Hz clock ticker.
    this.patchRate = 1000 / TICK_RATE;
    this.loop = new TickLoop(TICK_RATE, (first, count) => {
      // Nobody here and nothing to simulate (an empty static room): stop waking up until someone joins.
      if (this.clients.length === 0 && this.idleWhenEmpty()) {
        this.loop?.stop();
        return;
      }
      this.clock.tick(); // fresh server time for input ages
      for (let i = 0; i < count; i++) this.tick(first + i);
      this.flushShots();
      this.afterTicks();
      this.sendPatch();
    });
    this.loop.start();
    this.rttTimer = setInterval(() => this.probeRtt(), 1000);

    this.stats = new RoomStats(this.roomId, () => this.match.seats.size);
    liveRooms.add(this);
    if (options.statsMs && options.statsMs > 0) {
      this.stats.start(options.statsMs, (s) => console.log(`[stats] ${JSON.stringify({ ...s, ...this.extraStats() })}`));
    }
  }

  /** May the tick loop sleep while no client is connected (the match holds no seats)? */
  protected idleWhenEmpty(): boolean {
    return false;
  }

  /** Extra numbers for the stats line. */
  protected extraStats(): Record<string, number> {
    const c = this.interest.counts;
    const out = { visPairs: c.pairs, visRays: this.vis.rays };
    c.pairs = 0;
    c.visible = 0;
    c.predicted = 0;
    this.vis.rays = 0;
    return out;
  }

  /** After the ticks of one wake-up, before the patch (messages, item views). */
  protected afterTicks(): void {}

  private patchFromLoop = false;

  /** The framework's patch timer calls this too; only the tick loop's call sends. */
  override broadcastPatch(): boolean {
    if (!this.patchFromLoop) return false;
    const t0 = performance.now();
    const sent = super.broadcastPatch();
    this.stats?.recordPatch(performance.now() - t0);
    return sent;
  }

  private sendPatch(): void {
    this.patchFromLoop = true;
    try {
      this.broadcastPatch();
    } finally {
      this.patchFromLoop = false;
    }
  }

  override onJoin(client: Client, options: JoinOptions = {}, auth?: JoinAuth): void {
    this.loop?.resume();
    client.view = new StateView();
    this.interest.addViewer(client.sessionId, client.view);
    if (auth) this.auths.set(client.sessionId, auth);
    this.seatPlayerIds.set(client.sessionId, auth?.playerId ?? null);
    if (options.spectate === true && this.allowSpectators) {
      this.spectators.add(client.sessionId);
      this.onSpectatorJoin();
      this.syncSeats();
      return;
    }
    this.joinCount += 1;
    // A signed-in name wins over the one in the join options.
    const name = auth?.signed ? cleanName(auth.name, `Duck ${this.joinCount}`) : cleanName(options.name, auth?.name ?? `Duck ${this.joinCount}`);
    // The pick is looks only and checked against the catalog (anything else is the classic duck).
    const seat = this.addHuman(client, name, auth, characterFromOption(options.character));
    if (!seat) {
      client.leave(4000, 'match already started');
      return;
    }
    // The party sees this member as in a match (and the leader's next room does not pull it).
    parties.setPlaying(auth?.playerId, this.roomId, true);
    this.syncSeats();
    // Owner-only fields (exact sim state, ammo, hp, inventory) reach this client and nobody else.
    const ns = this.net.get(seat.id);
    if (ns) client.view.add(ns.state);
  }

  protected onSpectatorJoin(): void {}
  protected onSpectatorLeave(): void {}

  override onLeave(client: Client): void {
    this.chat.forget(client.sessionId);
    this.interest.removeViewer(client.sessionId);
    const auth = this.auths.get(client.sessionId);
    if (auth && this.seatedIds.get(auth.playerId ?? '')?.sessionId === client.sessionId) this.seatedIds.delete(auth.playerId ?? '');
    this.auths.delete(client.sessionId);
    this.mateViews.delete(client.sessionId);
    if (this.spectators.delete(client.sessionId)) this.onSpectatorLeave();
    else {
      if (this.match.seats.has(client.sessionId)) parties.setPlaying(auth?.playerId, this.roomId, false);
      this.removeHuman(client.sessionId);
    }
    this.syncSeats();
  }

  override onDispose(): void {
    liveRooms.delete(this);
    if (this.rttTimer) clearInterval(this.rttTimer);
    this.loop?.stop();
    this.stats?.stop();
    this.sim?.dispose();
  }

  /** Mirror the match's seats into state entries (bots come and go with humans). */
  protected syncSeats(): void {
    for (const [id, seat] of this.match.seats) {
      if (this.net.has(id)) continue;
      const state = new PlayerState();
      const pose = new Pose();
      const farPose = new Pose();
      state.name = seat.name;
      const auth = seat.bot ? undefined : this.auths.get(id);
      state.tag = auth?.signed ? auth.tag : '';
      state.pid = seat.pid;
      state.bot = seat.bot !== null;
      this.state.players.set(id, state);
      this.state.poses.set(id, pose);
      this.state.farPoses.set(id, farPose);
      const pacer = seat.bot
        ? null
        : new InputPacer<PlayerInput>({
            stepMs: 1000 / TICK_RATE,
            creditCap: NET.maxInputCredit,
            graceTicks: NET.starveGraceTicks,
            repeatTicks: NET.standInRepeatTicks,
            maxDebt: NET.maxStandInDebt,
            lateMarginMs: NET.lateMarginMs,
          });
      state.team = seat.team;
      state.character = seat.character;
      let mate: TeamMate | null = null;
      if (seat.team > 0) {
        mate = new TeamMate();
        mate.pid = seat.pid;
        this.state.mates.set(id, mate);
      }
      const ns: NetSeat = { state, pose, farPose, pacer, frame: emptyInput(), idle: emptyInput(), mate };
      this.net.set(id, ns);
      this.writeSeat(seat, ns, true);
    }
    for (const id of [...this.net.keys()]) {
      if (this.match.seats.has(id)) continue;
      this.net.delete(id);
      this.state.players.delete(id);
      this.state.poses.delete(id);
      this.state.farPoses.delete(id);
      this.state.mates.delete(id);
      this.interest.forget(id);
      for (const set of this.mateViews.values()) set.delete(id);
    }
    this.syncMateViews();
    this.updateInterest();
  }

  /** Teammate entries each viewer holds (seat ids). */
  private readonly mateViews = new Map<string, Set<string>>();

  /** Every human gets its teammates' HUD entries (and its own: revive progress), and nobody else's. */
  private syncMateViews(): void {
    for (const client of this.clients) {
      const me = this.match.seats.get(client.sessionId);
      if (!me || me.team === 0 || !client.view) continue;
      let held = this.mateViews.get(client.sessionId);
      if (!held) this.mateViews.set(client.sessionId, (held = new Set()));
      for (const [id, ns] of this.net) {
        if (!ns.mate || held.has(id)) continue;
        const other = this.match.seats.get(id);
        if (!other || (other !== me && !this.match.allies(me, other))) continue;
        client.view.add(ns.mate);
        held.add(id);
      }
    }
  }

  /**
   * Measure each human's round trip with WebSocket ping frames. The browser
   * answers pings itself, so page script cannot fake a lower or steadier
   * latency through them. The result bounds how far back that player's shots
   * may be rewound (Arena.maxRewindFor).
   */
  private probeRtt(): void {
    for (const client of this.clients) {
      const seat = this.match.seats.get(client.sessionId);
      if (!seat || seat.bot) continue;
      this.rtt.ping(client, (ms) => (seat.rttMs = ms));
    }
  }

  /** Re-classify every viewer's pairs, or only one share of the viewers (`part`, staggered culling). */
  protected updateInterest(part?: { index: number; of: number }): void {
    const seats = [...this.match.seats.values()].map((s) => {
      const ns = this.net.get(s.id) as NetSeat;
      const p = s.sim;
      return { id: s.id, x: p.x, y: p.y, z: p.z, vx: p.vx, vz: p.vz, yaw: p.yaw, crouch: p.crouch, inWorld: p.mode !== Mode.Plane, pose: ns.pose, farPose: ns.farPose };
    });
    this.interest.update(seats, this.clock.elapsedTime, (viewerId) => this.viewpointOf(viewerId), part);
  }

  private tick(tick: number): void {
    const t0 = performance.now();
    const now = this.clock.elapsedTime;
    this.tickNo = tick;
    const m = this.match;
    m.beginTick(tick, now);
    for (const [id, ns] of this.net) {
      const seat = m.seats.get(id);
      if (!seat || !ns.pacer) continue;
      ns.pacer.tick(
        this.inputs.get(id),
        now,
        (input) => {
          const f = ns.frame;
          f.mx = input.mx;
          f.mz = input.mz;
          f.buttons = input.buttons;
          f.yaw = input.yaw;
          f.pitch = input.pitch;
          f.tick = input.tick;
          m.applyInput(seat, f, input.vt);
        },
        (kind) => {
          // Inputs are late (packet loss, lag spike, hidden tab or a lag switch).
          // Keep the player simulated so it can neither hang in mid-air nor
          // teleport later. See inputPacer.ts for how late inputs are matched.
          // Stand-ins never fire, pick up, heal or jump out of the plane.
          const f = ns.idle;
          if (kind === 'repeat') Object.assign(f, ns.frame);
          else {
            f.mx = 0;
            f.mz = 0;
            f.yaw = seat.sim.yaw;
            f.pitch = seat.sim.pitch;
          }
          const once = Button.Fire | Button.Reload | Button.Slot1 | Button.Slot2 | Button.Use | Button.Heal1 | Button.Heal2 | Button.Deploy;
          f.buttons = kind === 'repeat' ? ns.frame.buttons & ~once : 0;
          m.applyInput(seat, f, m.standInViewTime(seat));
        },
      );
    }
    this.matchEndTick();

    const far = tick % INTEREST.farEveryTicks === 0;
    for (const [id, ns] of this.net) {
      const seat = m.seats.get(id);
      if (seat) this.writeSeat(seat, ns, far);
    }
    // With culling every viewer is re-tested every VIS.retestTicks, a third of them
    // each tick: the same work as all at once, without a ray-cast spike every third
    // tick (32 humans in one room cost about 1,000 pairs per round).
    if (this.cullHidden()) this.updateInterest({ index: tick % VIS.retestTicks, of: VIS.retestTicks });
    else if (tick % INTEREST.updateEveryTicks === 0) this.updateInterest();

    this.state.tick = tick;
    this.writeMatchState(tick);
    this.stats.recordTick(performance.now() - t0);
  }

  /** Copy a seat into its schema entries, touching only fields that changed. */
  private writeSeat(seat: Seat, ns: NetSeat, writeFar: boolean): void {
    const sim = seat.sim;
    const target = ns.state as unknown as Record<string, number>;
    for (const f of PLAYER_SIM_FIELDS) {
      const v = sim[f];
      if (target[f] !== v) target[f] = v;
    }
    const st = ns.state;
    if (st.life !== seat.life) {
      st.life = seat.life;
      st.spawnYaw = seat.spawnYaw;
    }
    if (st.kills !== seat.kills) st.kills = seat.kills;
    if (st.deaths !== seat.deaths) st.deaths = seat.deaths;
    if (st.dealt !== seat.dealt) st.dealt = Math.min(65535, seat.dealt);
    const protect = seat.protect > 0 ? 1 : 0;
    if (st.protect !== protect) st.protect = protect;
    const armed = hasWeapon(sim, sim.weapon) ? 1 : 0;
    if (st.armed !== armed) st.armed = armed;
    this.writeSeatExtras(seat, st);
    const mate = ns.mate;
    if (mate) {
      const hp = Math.max(0, Math.min(255, Math.ceil(sim.hp)));
      if (mate.hp !== hp) mate.hp = hp;
      if (mate.alive !== sim.alive) mate.alive = sim.alive;
      if (mate.down !== sim.down) mate.down = sim.down;
      const r = sim.down ? this.reviveOf(seat) : { progress: 0, by: null };
      const rev = Math.round(Math.min(1, r.progress) * 255);
      if (mate.rev !== rev) mate.rev = rev;
      const rby = r.by?.pid ?? 0;
      if (mate.rby !== rby) mate.rby = rby;
    }
    const act = actionOf(sim);
    writePose(ns.pose, sim, act);
    if (writeFar) writePose(ns.farPose, sim, act);
  }

  /** Called by the match's shot event. */
  protected queueShot(shooter: Seat, weapon: number, r: ShotResult): void {
    this.shotFx.push({
      pid: shooter.pid,
      shooterId: shooter.id,
      weapon,
      sx: shooter.sim.x,
      sz: shooter.sim.z,
      data: [shooter.pid, weapon, r.outcome, cm(r.muzzle.x), cm(r.muzzle.y), cm(r.muzzle.z), cm(r.end.x), cm(r.end.y), cm(r.end.z)],
    });
  }

  /** Can this viewer see that seat (it receives its pose)? Spectators without a seat see all. */
  protected viewerSees(viewerId: string, targetId: string): boolean {
    if (!this.cullHidden()) return true;
    return this.interest.sees(viewerId, targetId);
  }

  /**
   * Send this iteration's shot effects. Full effects (tracer, muzzle, impact)
   * go to viewers near either end of the tracer, and with culling on only to
   * viewers who can see the shooter; everyone else in earshot gets a
   * direction-only hint for the sound, never a position.
   */
  private flushShots(): void {
    if (this.shotFx.length === 0) return;
    const r2 = (INTEREST.shotFxRadius * 100) ** 2;
    const hear2 = 400 * 400;
    for (const client of this.clients) {
      const me = this.match.seats.get(client.sessionId);
      const vp = this.viewpointOf(client.sessionId);
      const list: number[][] = [];
      const hints: number[][] = [];
      for (const fx of this.shotFx) {
        if (me && fx.pid === me.pid) continue;
        if (vp) {
          const [, , , mx, , mz, ex, , ez] = fx.data as [number, number, number, number, number, number, number, number, number];
          const px = cm(vp.x);
          const pz = cm(vp.z);
          const near = (mx - px) ** 2 + (mz - pz) ** 2 <= r2 || (ex - px) ** 2 + (ez - pz) ** 2 <= r2;
          if (near && this.viewerSees(client.sessionId, fx.shooterId)) {
            list.push(fx.data);
            continue;
          }
          const d2 = (fx.sx - vp.x) ** 2 + (fx.sz - vp.z) ** 2;
          if (d2 > hear2) continue;
          const loud = d2 < 40 * 40 ? 2 : d2 < 120 * 120 ? 1 : 0;
          hints.push([fx.weapon, angleMilli(vp.x, vp.z, fx.sx, fx.sz), loud]);
          continue;
        }
        list.push(fx.data);
      }
      if (list.length > 0) client.send(Msg.Shots, list);
      if (hints.length > 0) client.send(Msg.ShotHint, hints);
    }
    this.shotFx = [];
  }

  /** Kill event: the victim's position only to viewers who could see the victim. */
  protected sendKill(killer: Seat | null, victim: Seat, weapon: number, head: boolean): void {
    const s = victim.sim;
    // Weapon codes on the wire: 0 rifle, 1 pistol, KillWeapon.Zone, KillWeapon.Left, KillWeapon.Bleed.
    const w = weapon >= 0 ? weapon : weapon === -2 ? KillWeapon.Left : weapon === KILL_BLEED ? KillWeapon.Bleed : KillWeapon.Zone;
    const withPos = [killer?.pid ?? 0, victim.pid, w, head ? 1 : 0, 1, cm(s.x), cm(s.y), cm(s.z)];
    const noPos = [killer?.pid ?? 0, victim.pid, w, head ? 1 : 0, 0, 0, 0, 0];
    for (const client of this.clients) {
      const id = client.sessionId;
      const sees = id === victim.id || this.viewerSees(id, victim.id);
      client.send(Msg.Kill, sees ? withPos : noPos);
    }
  }

  /** A duck was knocked (team modes): who, by whom, how. No position (the pose action shows it to those who see it). */
  protected sendKnock(by: Seat | null, victim: Seat, weapon: number, head: boolean): void {
    const w = weapon >= 0 ? weapon : KillWeapon.Zone;
    this.broadcast(Msg.Knock, [by?.pid ?? 0, victim.pid, w, head ? 1 : 0]);
  }

  /** Damage taken: a direction toward the attacker, never its position. */
  protected sendDamaged(victim: Seat, from: Seat | null, damage: number): void {
    const client = this.clients.getById(victim.id);
    if (!client) return;
    if (!from) client.send(Msg.Damaged, [0, damage, 1]);
    else client.send(Msg.Damaged, [angleMilli(victim.sim.x, victim.sim.z, from.sim.x, from.sim.z), damage, 0]);
  }

  /** Test and tooling hook: the current tick number. */
  get currentTick(): number {
    return this.tickNo;
  }

  // ---- admin panel (ops/rooms.ts): read by the authenticated admin only ----

  private createdAt = Date.now();

  /** Mode, phase and clock for the admin dashboard. */
  protected roomStatus(): { kind: 'dm' | 'br'; mode: string; phase: string; secondsLeft: number } {
    return { kind: 'dm', mode: '', phase: '', secondsLeft: 0 };
  }

  roomInfo(): RoomInfo {
    let humans = 0;
    let bots = 0;
    for (const s of this.match?.seats.values() ?? []) {
      if (s.bot) bots++;
      else humans++;
    }
    const st = this.roomStatus();
    return {
      roomId: this.roomId,
      kind: st.kind,
      label: this.state?.label ?? '',
      mode: st.mode,
      mapId: this.state?.mapId ?? '',
      humans,
      bots,
      spectators: this.spectators.size,
      phase: st.phase,
      secondsLeft: st.secondsLeft,
      locked: this.locked,
      maxHumans: this.maxClients,
      tick: this.stats?.recent() ?? { avg: 0, p95: 0, max: 0, samples: 0 },
      createdAt: this.createdAt,
    };
  }

  /** The humans and spectators connected now (bots are counted in roomInfo). */
  roomPlayers(): RoomPlayer[] {
    const out: RoomPlayer[] = [];
    for (const client of this.clients) {
      const id = client.sessionId;
      const auth = this.auths.get(id);
      const seat = this.match.seats.get(id);
      out.push({
        sessionId: id,
        name: seat?.name ?? auth?.name ?? '',
        tag: auth?.signed ? auth.tag : '',
        playerId: auth?.playerId ?? null,
        bot: false,
        spectator: this.spectators.has(id),
        alive: seat?.sim.alive === 1,
        kills: seat?.kills ?? 0,
        deaths: seat?.deaths ?? 0,
        team: seat?.team ?? 0,
        pingMs: Math.max(0, Math.round(seat?.rttMs ?? 0)),
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  removePlayer(sessionId: string): boolean {
    const client = this.clients.getById(sessionId);
    if (!client) return false;
    client.leave(CLOSE_CODE.removed, 'removed');
    return true;
  }

  removePlayerId(playerId: string): number {
    let n = 0;
    for (const [sessionId, auth] of this.auths) if (auth.playerId === playerId && this.removePlayer(sessionId)) n++;
    return n;
  }

  ipOf(sessionId: string): string | null {
    return this.auths.get(sessionId)?.ip ?? null;
  }

  notice(text: string): void {
    this.broadcast(Msg.Notice, text);
  }

  close(): Promise<unknown> {
    return this.disconnect(CLOSE_CODE.roomClosed);
  }
}

function writePose(p: Pose, s: { x: number; y: number; z: number; yaw: number; pitch: number; crouch: number; grounded: number; mode: number }, act: number): void {
  // Quantized fields store their dequantized value, so compare in that domain via assignment only on change.
  p.x = s.x;
  p.y = s.y;
  p.z = s.z;
  p.yaw = s.yaw;
  p.pitch = s.pitch;
  if (p.crouch !== s.crouch) p.crouch = s.crouch;
  if (p.grounded !== s.grounded) p.grounded = s.grounded;
  if (p.fly !== s.mode) p.fly = s.mode;
  if (p.act !== act) p.act = act;
}

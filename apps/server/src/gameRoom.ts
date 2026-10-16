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
import { IslandState, KillWeapon, Msg, PlayerInput, PlayerState, Pose } from '@qwakk/shared/net';
import type { Arena, Seat } from './arena.ts';
import { RoomStats } from './stats.ts';
import { InputPacer } from './inputPacer.ts';
import { TickLoop } from './tickLoop.ts';
import { Interest, type ViewerPoint } from './interest.ts';
import { RttProbe } from './rttProbe.ts';
import { Visibility } from './visibility.ts';
import type { ServerMap } from './maps.ts';
import { allowJoin, joinIp, verifySession } from './meta/index.ts';

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
}

/** Who joined, from onAuth (meta verifySession). */
export interface JoinAuth {
  playerId: string | null;
  name: string;
  /** Guest #tag (shown in the waiting room and lists). */
  tag: string;
  /** True when the identity came from a session token (its name wins over the join options). */
  signed: boolean;
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

export abstract class GameRoom<M extends Arena> extends Room<{ state: IslandState; input: PlayerInput }> {
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

  /** The map for this room. */
  protected abstract loadMap(options: GameRoomOptions): ServerMap;
  /** The rules object (deathmatch or battle royale). */
  protected abstract createMatch(options: GameRoomOptions): M;
  /** Seat for a joining human, or null when the match does not take players now. */
  protected abstract addHuman(client: Client, name: string): Seat | null;
  protected abstract removeHuman(id: string): void;
  /** Run the match's end of tick (bots, timers). */
  protected abstract matchEndTick(): void;
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
    if (!allowJoin(ip)) throw new Error('too many joins, try again in a moment');
    const token = typeof options.token === 'string' ? options.token : undefined;
    const who = await verifySession(token);
    if (!who) throw new Error('invalid session');
    const signed = token !== undefined && token !== '';
    // One seat per identity: a second tab with the same session is refused.
    if (signed) {
      const held = this.seatedIds.get(who.playerId);
      if (held && (this.clients.getById(held.sessionId) || Date.now() - held.at < 15_000)) {
        throw new ServerError(JOIN_ERROR.alreadyInMatch, 'already in this match');
      }
      this.seatedIds.set(who.playerId, { sessionId: client.sessionId, at: Date.now() });
    }
    return { playerId: who.playerId, name: who.name, tag: who.tag, signed };
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
    this.interest = new Interest({ enabled: options.interest !== false, cull: this.cullHidden() }, this.vis);
    this.match = this.createMatch(options);

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
    const seat = this.addHuman(client, name);
    if (!seat) {
      client.leave(4000, 'match already started');
      return;
    }
    this.syncSeats();
    // Owner-only fields (exact sim state, ammo, hp, inventory) reach this client and nobody else.
    const ns = this.net.get(seat.id);
    if (ns) client.view.add(ns.state);
  }

  protected onSpectatorJoin(): void {}
  protected onSpectatorLeave(): void {}

  override onLeave(client: Client): void {
    this.interest.removeViewer(client.sessionId);
    const auth = this.auths.get(client.sessionId);
    if (auth && this.seatedIds.get(auth.playerId ?? '')?.sessionId === client.sessionId) this.seatedIds.delete(auth.playerId ?? '');
    this.auths.delete(client.sessionId);
    if (this.spectators.delete(client.sessionId)) this.onSpectatorLeave();
    else this.removeHuman(client.sessionId);
    this.syncSeats();
  }

  override onDispose(): void {
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
      const ns: NetSeat = { state, pose, farPose, pacer, frame: emptyInput(), idle: emptyInput() };
      this.net.set(id, ns);
      this.writeSeat(seat, ns, true);
    }
    for (const id of [...this.net.keys()]) {
      if (this.match.seats.has(id)) continue;
      this.net.delete(id);
      this.state.players.delete(id);
      this.state.poses.delete(id);
      this.state.farPoses.delete(id);
      this.interest.forget(id);
    }
    this.updateInterest();
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
    // Weapon codes on the wire: 0 rifle, 1 pistol, KillWeapon.Zone, KillWeapon.Left.
    const w = weapon >= 0 ? weapon : weapon === -2 ? KillWeapon.Left : KillWeapon.Zone;
    const withPos = [killer?.pid ?? 0, victim.pid, w, head ? 1 : 0, 1, cm(s.x), cm(s.y), cm(s.z)];
    const noPos = [killer?.pid ?? 0, victim.pid, w, head ? 1 : 0, 0, 0, 0, 0];
    for (const client of this.clients) {
      const id = client.sessionId;
      const sees = id === victim.id || this.viewerSees(id, victim.id);
      client.send(Msg.Kill, sees ? withPos : noPos);
    }
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

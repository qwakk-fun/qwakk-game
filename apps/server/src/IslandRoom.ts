/**
 * The authoritative island room: networking glue around the Deathmatch.
 *
 * Netcode rules (see CLAUDE.md): clients send inputs only. The server owns
 * position, velocity, ammo, hits and damage, sanitizes every input, caps the
 * input buffer and the rate inputs are consumed at, validates every shot with
 * lag compensation, and broadcasts state at the tick rate.
 */
import { Room, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import {
  Button,
  createSimWorld,
  emptyInput,
  generateMap,
  initPhysics,
  INTEREST,
  NET,
  PLAYER_SIM_FIELDS,
  ROOM,
  sanitizeInputFields,
  DT,
  TICK_RATE,
  type InputFrame,
  type ShotResult,
  type SimWorld,
} from '@qwakk/shared';
import { IslandState, MatchPhase, Msg, PlayerInput, PlayerState, Pose } from '@qwakk/shared/net';
import { RoomStats } from './stats.ts';
import { InputPacer } from './inputPacer.ts';
import { TickLoop } from './tickLoop.ts';
import { Deathmatch, DEFAULT_DM, type Seat } from './deathmatch.ts';
import { Interest } from './interest.ts';
import { RttProbe } from './rttProbe.ts';

export interface IslandRoomOptions {
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

interface JoinOptions {
  name?: unknown;
  spectate?: unknown;
}

/** Network side of a seat. */
interface NetSeat {
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
  data: number[];
}

function cleanName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const name = raw.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
  return name.length > 0 ? name : fallback;
}

const cm = (v: number): number => Math.round(v * 100);

export class IslandRoom extends Room<{ state: IslandState; input: PlayerInput }> {
  override maxClients: number = ROOM.maxClients;
  /** Inputs arrive at 30 Hz; the headroom lets a backlog flush after a network stall. */
  override maxMessagesPerSecond = NET.maxMessagesPerSecond;

  override inputs = this.defineInput(PlayerInput, {
    bufferMaxSize: NET.maxInputBuffer,
    sanitize: (f) => sanitizeInputFields(f),
    // Advertised to clients in the join handshake: they predict at exactly this dt.
    stepSeconds: DT,
  });

  private sim!: SimWorld;
  private dm!: Deathmatch;
  private interest!: Interest;
  private readonly net = new Map<string, NetSeat>();
  private readonly spectators = new Set<string>();
  private allowSpectators = false;
  private joinCount = 0;
  private stats!: RoomStats;
  private loop: TickLoop | null = null;
  private shotFx: ShotFx[] = [];
  private rttTimer: NodeJS.Timeout | null = null;
  private readonly rtt = new RttProbe();
  private tickNo = 0;

  override async onCreate(options: IslandRoomOptions = {}): Promise<void> {
    await initPhysics();
    const seed = (options.seed ?? ROOM.defaultSeed) >>> 0;
    this.sim = createSimWorld(generateMap(seed));
    if (options.maxClients) this.maxClients = options.maxClients;
    this.allowSpectators = options.spectators === true;

    const state = new IslandState();
    state.seed = seed;
    state.scoreLimit = DEFAULT_DM.scoreLimit;
    this.state = state;

    this.interest = new Interest(options.interest !== false);
    this.dm = new Deathmatch(
      this.sim,
      {
        ...DEFAULT_DM,
        bots: options.bots !== false,
        isFar: (viewer, target, now, rtt) => this.interest.isFarAt(viewer, target, now, rtt),
        farExtraDelayMs: INTEREST.farExtraDelayMs,
      },
      {
        shot: (shooter, weapon, r) => this.queueShot(shooter, weapon, r),
        hit: (shooter, victim, damage, head, killed) => this.clients.getById(shooter.id)?.send(Msg.HitConfirm, [victim.pid, damage, head ? 1 : 0, killed ? 1 : 0]),
        damaged: (victim, from, damage) => this.clients.getById(victim.id)?.send(Msg.Damaged, [cm(from.sim.x), cm(from.sim.z), damage]),
        kill: (killer, victim, weapon, head) => this.broadcast(Msg.Kill, [killer.pid, victim.pid, weapon, head ? 1 : 0, cm(victim.sim.x), cm(victim.sim.y), cm(victim.sim.z)]),
        roundEnd: () => undefined,
        roundStart: () => undefined,
      },
    );

    // Our own fixed-rate loop (see tickLoop.ts for why not setFixedTimestep).
    // Patches go out from the loop, right after each tick, instead of from the
    // framework's free-running patch timer, which drifts against the ticks.
    // patchRate stays at the real cadence because it is advertised to clients
    // (they size their input replay ring from it); the timer's own calls are
    // ignored in broadcastPatch(). Do not set it to null: without a Colyseus
    // simulation interval that starts a hidden 60 Hz clock ticker.
    this.patchRate = 1000 / TICK_RATE;
    this.loop = new TickLoop(TICK_RATE, (first, count) => {
      this.clock.tick(); // fresh server time for input ages
      for (let i = 0; i < count; i++) this.tick(first + i);
      this.flushShots();
      this.sendPatch();
    });
    this.loop.start();
    this.rttTimer = setInterval(() => this.probeRtt(), 1000);

    this.stats = new RoomStats(this.roomId, () => this.dm.seats.size);
    if (options.statsMs && options.statsMs > 0) {
      this.stats.start(options.statsMs, (s) => console.log(`[stats] ${JSON.stringify(s)}`));
    }
  }

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

  override onJoin(client: Client, options: JoinOptions = {}): void {
    client.view = new StateView();
    this.interest.addViewer(client.sessionId, client.view);
    if (options.spectate === true && this.allowSpectators) {
      this.spectators.add(client.sessionId);
      this.dm.allowBotsAlone = true;
      this.dm.fillBots();
      this.syncSeats();
      return;
    }
    this.joinCount += 1;
    const seat = this.dm.addHuman(client.sessionId, cleanName(options.name, `Duck ${this.joinCount}`));
    this.syncSeats();
    // Owner-only fields (exact sim state, ammo, hp) reach this client and nobody else.
    const ns = this.net.get(seat.id);
    if (ns) client.view.add(ns.state);
  }

  override onLeave(client: Client): void {
    this.interest.removeViewer(client.sessionId);
    if (this.spectators.delete(client.sessionId)) {
      this.dm.allowBotsAlone = this.spectators.size > 0;
      this.dm.fillBots();
    } else {
      this.dm.remove(client.sessionId);
    }
    this.syncSeats();
  }

  override onDispose(): void {
    if (this.rttTimer) clearInterval(this.rttTimer);
    this.loop?.stop();
    this.stats?.stop();
    this.sim?.dispose();
  }

  /** Mirror the Deathmatch's seats into state entries (bots come and go with humans). */
  private syncSeats(): void {
    for (const [id, seat] of this.dm.seats) {
      if (this.net.has(id)) continue;
      const state = new PlayerState();
      const pose = new Pose();
      const farPose = new Pose();
      state.name = seat.name;
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
      if (this.dm.seats.has(id)) continue;
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
   * may be rewound (Deathmatch.maxRewindFor).
   */
  private probeRtt(): void {
    for (const client of this.clients) {
      const seat = this.dm.seats.get(client.sessionId);
      if (!seat || seat.bot) continue;
      this.rtt.ping(client, (ms) => (seat.rttMs = ms));
    }
  }

  private updateInterest(): void {
    const seats = [...this.dm.seats.values()].map((s) => {
      const ns = this.net.get(s.id) as NetSeat;
      return { id: s.id, x: s.sim.x, z: s.sim.z, pose: ns.pose, farPose: ns.farPose };
    });
    this.interest.update(seats, this.clock.elapsedTime, (viewerId) => {
      const s = this.dm.seats.get(viewerId);
      return s ? { x: s.sim.x, z: s.sim.z } : null;
    });
  }

  private tick(tick: number): void {
    const t0 = performance.now();
    const now = this.clock.elapsedTime;
    this.tickNo = tick;
    this.dm.beginTick(tick, now);
    for (const [id, ns] of this.net) {
      const seat = this.dm.seats.get(id);
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
          this.dm.applyInput(seat, f, input.vt);
        },
        (kind) => {
          // Inputs are late (packet loss, lag spike, hidden tab or a lag switch).
          // Keep the player simulated so it can neither hang in mid-air nor
          // teleport later. See inputPacer.ts for how late inputs are matched.
          // Stand-ins never fire: a stalled player must not shoot phantom bullets.
          const f = ns.idle;
          if (kind === 'repeat') Object.assign(f, ns.frame);
          else {
            f.mx = 0;
            f.mz = 0;
            f.yaw = seat.sim.yaw;
            f.pitch = seat.sim.pitch;
          }
          f.buttons = kind === 'repeat' ? ns.frame.buttons & ~(Button.Fire | Button.Reload | Button.Slot1 | Button.Slot2) : 0;
          this.dm.applyInput(seat, f, this.dm.standInViewTime(seat));
        },
      );
    }
    this.dm.endTick();

    const far = tick % INTEREST.farEveryTicks === 0;
    for (const [id, ns] of this.net) {
      const seat = this.dm.seats.get(id);
      if (seat) this.writeSeat(seat, ns, far);
    }
    if (tick % INTEREST.updateEveryTicks === 0) this.updateInterest();

    const st = this.state;
    st.tick = tick;
    st.phase = this.dm.phase === 'playing' ? MatchPhase.Playing : MatchPhase.Intermission;
    st.timeLeft = this.dm.secondsLeft;
    if (st.winner !== this.dm.winner) st.winner = this.dm.winner;
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
    if (st.hp !== seat.hp) st.hp = seat.hp;
    if (st.life !== seat.life) {
      st.life = seat.life;
      st.spawnYaw = seat.spawnYaw;
    }
    if (st.kills !== seat.kills) st.kills = seat.kills;
    if (st.deaths !== seat.deaths) st.deaths = seat.deaths;
    const protect = seat.protect > 0 ? 1 : 0;
    if (st.protect !== protect) st.protect = protect;
    const act = sim.reload > 0 ? 1 : sim.equip > 0 ? 2 : 0;
    if (st.act !== act) st.act = act;
    writePose(ns.pose, sim);
    if (writeFar) writePose(ns.farPose, sim);
  }

  private queueShot(shooter: Seat, weapon: number, r: ShotResult): void {
    this.shotFx.push({
      pid: shooter.pid,
      data: [shooter.pid, weapon, r.outcome, cm(r.muzzle.x), cm(r.muzzle.y), cm(r.muzzle.z), cm(r.end.x), cm(r.end.y), cm(r.end.z)],
    });
  }

  /** Send this iteration's shot effects to every client near either end of the tracer, except the shooter. */
  private flushShots(): void {
    if (this.shotFx.length === 0) return;
    const r2 = (INTEREST.shotFxRadius * 100) ** 2;
    for (const client of this.clients) {
      const me = this.dm.seats.get(client.sessionId);
      const list: number[][] = [];
      for (const fx of this.shotFx) {
        if (me && fx.pid === me.pid) continue;
        if (me) {
          const [, , , mx, , mz, ex, , ez] = fx.data as [number, number, number, number, number, number, number, number, number];
          const px = cm(me.sim.x);
          const pz = cm(me.sim.z);
          if ((mx - px) ** 2 + (mz - pz) ** 2 > r2 && (ex - px) ** 2 + (ez - pz) ** 2 > r2) continue;
        }
        list.push(fx.data);
      }
      if (list.length > 0) client.send(Msg.Shots, list);
    }
    this.shotFx = [];
  }

  /** Test and tooling hook: the current tick number. */
  get currentTick(): number {
    return this.tickNo;
  }
}

function writePose(p: Pose, s: { x: number; y: number; z: number; yaw: number; pitch: number; crouch: number; grounded: number }): void {
  // Quantized fields store their dequantized value, so compare in that domain via assignment only on change.
  p.x = s.x;
  p.y = s.y;
  p.z = s.z;
  p.yaw = s.yaw;
  p.pitch = s.pitch;
  if (p.crouch !== s.crouch) p.crouch = s.crouch;
  if (p.grounded !== s.grounded) p.grounded = s.grounded;
}

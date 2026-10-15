/**
 * The authoritative island room.
 *
 * Netcode rules (see CLAUDE.md): clients send inputs only. The server owns
 * position and velocity, sanitizes every input, caps the input buffer and the
 * rate inputs are consumed at, and broadcasts state at the tick rate.
 */
import { Room, type Client } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import {
  clampAngleRate,
  createPlayerSim,
  createSimWorld,
  emptyInput,
  generateMap,
  groundHeightAt,
  initPhysics,
  NET,
  PLAYER_SIM_FIELDS,
  ROOM,
  sanitizeInputFields,
  stepPlayer,
  DT,
  TICK_RATE,
  type InputFrame,
  type MapDef,
  type PlayerSim,
  type SimWorld,
} from '@qwakk/shared';
import { IslandState, PlayerInput, PlayerState } from '@qwakk/shared/net';
import { RoomStats } from './stats.ts';
import { InputPacer } from './inputPacer.ts';
import { TickLoop } from './tickLoop.ts';

export interface IslandRoomOptions {
  seed?: number;
  /** Print timing stats every this many ms (0 or unset: off). */
  statsMs?: number;
}

interface JoinOptions {
  name?: unknown;
}

/** Server-side bookkeeping per player, never sent to clients. */
interface Seat {
  sim: PlayerSim;
  state: PlayerState;
  /** Decides which steps run each tick: real inputs, stand-ins, late inputs to skip. */
  pacer: InputPacer<PlayerInput>;
  /** The last input actually simulated; 'repeat' stand-in steps reuse it. */
  frame: InputFrame;
  /** Zero-input frame for 'idle' stand-in steps (keeps the last look angles). */
  idle: InputFrame;
}

/** Players who fall below this height (sea floor is about -4) are respawned. */
const KILL_Y = -30;

function cleanName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const name = raw.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
  return name.length > 0 ? name : fallback;
}

export class IslandRoom extends Room<{ state: IslandState; input: PlayerInput }> {
  override maxClients = ROOM.maxClients;
  /** Inputs arrive at 30 Hz; the headroom lets a backlog flush after a network stall. */
  override maxMessagesPerSecond = NET.maxMessagesPerSecond;

  override inputs = this.defineInput(PlayerInput, {
    bufferMaxSize: NET.maxInputBuffer,
    sanitize: (f) => sanitizeInputFields(f),
    // Advertised to clients in the join handshake: they predict at exactly this dt.
    stepSeconds: DT,
  });

  private map!: MapDef;
  private sim!: SimWorld;
  private seats = new Map<string, Seat>();
  private spawnCursor = 0;
  private joinCount = 0;
  private stats!: RoomStats;
  private loop: TickLoop | null = null;

  override async onCreate(options: IslandRoomOptions = {}): Promise<void> {
    await initPhysics();
    const seed = (options.seed ?? ROOM.defaultSeed) >>> 0;
    this.map = generateMap(seed);
    this.sim = createSimWorld(this.map);

    const state = new IslandState();
    state.seed = seed;
    this.state = state;

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
      for (let i = 0; i < count; i++) this.tick(first + i, DT);
      this.sendPatch();
    });
    this.loop.start();

    this.stats = new RoomStats(this.roomId, () => this.seats.size);
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
    this.joinCount += 1;
    const [x, y, z] = this.nextSpawn();
    const sim = createPlayerSim(x, y, z);
    const state = new PlayerState();
    state.name = cleanName(options.name, `Duck ${this.joinCount}`);
    this.writeState(sim, state);
    this.state.players.set(client.sessionId, state);

    // Owner-only fields (velocity, sim timers) reach this client and nobody else.
    client.view = new StateView();
    client.view.add(state);

    const pacer = new InputPacer<PlayerInput>({
      stepMs: 1000 / TICK_RATE,
      creditCap: NET.maxInputCredit,
      graceTicks: NET.starveGraceTicks,
      repeatTicks: NET.standInRepeatTicks,
      maxDebt: NET.maxStandInDebt,
      lateMarginMs: NET.lateMarginMs,
    });
    this.seats.set(client.sessionId, { sim, state, pacer, frame: emptyInput(), idle: emptyInput() });
  }

  override onLeave(client: Client): void {
    this.seats.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
  }

  override onDispose(): void {
    this.loop?.stop();
    this.stats?.stop();
    this.sim?.dispose();
  }

  /** Next spawn point, standing on the ground so the first step does not fall. */
  private nextSpawn(): [number, number, number] {
    const spawns = this.map.spawns;
    const s = spawns[this.spawnCursor % spawns.length] ?? [0, 10, 0];
    this.spawnCursor += 1;
    return [s[0], groundHeightAt(this.sim, s[0], s[1] + 3, s[2]), s[2]];
  }

  private tick(tick: number, dt: number): void {
    const t0 = performance.now();
    const now = this.clock.elapsedTime;
    for (const [sessionId, seat] of this.seats) {
      seat.pacer.tick(
        this.inputs.get(sessionId),
        now,
        (input) => {
          const f = seat.frame;
          f.mx = input.mx;
          f.mz = input.mz;
          f.buttons = input.buttons;
          f.yaw = input.yaw;
          f.pitch = input.pitch;
          f.tick = input.tick;
          clampAngleRate(seat.sim.yaw, seat.sim.pitch, f);
          stepPlayer(this.sim, seat.sim, f, dt);
        },
        (kind) => {
          // Inputs are late (packet loss, lag spike, hidden tab or a lag switch).
          // Keep the player simulated so it can neither hang in mid-air nor
          // teleport later. See inputPacer.ts for how late inputs are matched.
          let f = seat.frame;
          if (kind === 'idle') {
            f = seat.idle;
            f.yaw = seat.sim.yaw;
            f.pitch = seat.sim.pitch;
          }
          stepPlayer(this.sim, seat.sim, f, dt);
        },
      );
      if (seat.sim.y < KILL_Y) this.respawn(seat);
      this.writeState(seat.sim, seat.state);
    }
    this.state.tick = tick;
    this.stats.recordTick(performance.now() - t0);
  }

  private respawn(seat: Seat): void {
    const [x, y, z] = this.nextSpawn();
    Object.assign(seat.sim, createPlayerSim(x, y, z, seat.sim.yaw));
  }

  /** Copy the sim into the schema, touching only fields that changed. */
  private writeState(sim: PlayerSim, state: PlayerState): void {
    const target = state as unknown as Record<string, number>;
    for (const f of PLAYER_SIM_FIELDS) {
      const v = sim[f];
      if (target[f] !== v) target[f] = v;
    }
  }
}

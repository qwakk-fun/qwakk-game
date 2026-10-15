/**
 * Network session: joins the island room and wires the Colyseus 0.18
 * prediction stack.
 *
 * - Local player: `predict.reconciler` (client-side prediction with server
 *   reconciliation). Every input is stepped immediately with the shared sim,
 *   then rewound to the server's state and replayed when an ack arrives. Any
 *   correction is spread over a few frames so it never pops.
 * - Remote players: `predict.attachAll(..., { mode: 'lerp' })`, snapshot
 *   interpolation about 100 ms in the past.
 * - Inputs go through `room.input()`: the framework numbers them, the server
 *   sanitizes and acks them.
 */
import { Callbacks, Client, Predict, type InputHandle, type Reconciler, type Room } from '@colyseus/sdk';
import { NET, PLAYER_SIM_FIELDS, ROOM, sanitizeInputFields, stepPlayer, type InputFrame, type PlayerSim, type SimWorld } from '@qwakk/shared';
import { IslandState, PlayerInput, type PlayerState } from '@qwakk/shared/net';
import { config } from '../config.ts';
import { NetSim, type NetSimSettings } from './netsim.ts';

export interface PredictionStats {
  reconciles: number;
  /** Reconciles whose position correction was above 1 mm. */
  corrected: number;
  lastErrM: number;
  maxErrM: number;
  sumErrM: number;
}

export class Session {
  readonly room: Room<any, IslandState>;
  readonly predict: Predict<IslandState>;
  readonly input: InputHandle<PlayerInput>;
  readonly netsim: NetSim;
  me: Reconciler<PlayerState, any> | null = null;
  readonly remotes = new Map<string, PlayerState>();
  readonly prediction: PredictionStats = { reconciles: 0, corrected: 0, lastErrM: 0, maxErrM: 0, sumErrM: 0 };
  /** Round trip measured with room.ping every second (includes the fake-network delay). */
  pingMs = 0;
  private lastReconcileSeq = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /** Scratch frames: one for staging sends, one for the reconciler step. */
  private readonly sendFrame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0 };
  private readonly stepFrame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0 };

  private constructor(room: Room<any, IslandState>, netsim: NetSim) {
    this.room = room;
    this.netsim = netsim;
    this.predict = Predict.get(room, { mode: 'lerp', delay: NET.interpDelayMs, tickInterval: 1000 / NET.patchRateHz });
    this.input = room.input({ type: PlayerInput, mode: 'reliable' });
  }

  static async join(endpoint: string, name: string, net: NetSimSettings): Promise<Session> {
    const client = new Client(endpoint);
    const room = await client.joinOrCreate<IslandState>(ROOM.name, { name }, IslandState);
    const netsim = new NetSim(net);
    netsim.attach(room);
    const session = new Session(room, netsim);
    await session.firstState();
    return session;
  }

  get sessionId(): string {
    return this.room.sessionId;
  }

  get seed(): number {
    return this.room.state.seed;
  }

  /**
   * Resolve once the full state has been decoded. The state object exists (with
   * default values) before that, so checking it would read seed 0 and build the
   * wrong island. Patches arrive every tick, so waiting for one is cheap.
   */
  private firstState(): Promise<void> {
    return new Promise((resolve) => this.room.onStateChange.once(() => resolve()));
  }

  /** Start tracking players. Needs the local sim world for prediction. */
  start(sim: SimWorld, onAdd: (id: string, p: PlayerState, local: boolean) => void, onRemove: (id: string) => void): void {
    // Remote players: interpolate position, stance and look ~100 ms behind.
    this.predict.attachAll('players', { mode: 'lerp', fields: ['x', 'y', 'z', 'crouch'], snap: 8, smoothMs: config.lerpSmoothMs });
    this.predict.attachAll('players', { mode: 'lerp', fields: ['yaw', 'pitch'], angle: true, smoothMs: config.lerpSmoothMs });

    const ping = () => this.room.ping((ms) => (this.pingMs = ms));
    ping();
    this.pingTimer = setInterval(ping, 1000);

    const callbacks = Callbacks.get(this.room);
    callbacks.onAdd('players', (player: PlayerState, id: string) => {
      const local = id === this.room.sessionId;
      if (local) this.createReconciler(sim, player);
      else this.remotes.set(id, player);
      onAdd(id, player, local);
    });
    callbacks.onRemove('players', (_player: PlayerState, id: string) => {
      this.remotes.delete(id);
      onRemove(id);
    });
  }

  private createReconciler(sim: SimWorld, player: PlayerState): void {
    const frame = this.stepFrame;
    this.me = this.predict.reconciler(player, {
      input: this.input,
      fields: PLAYER_SIM_FIELDS,
      // Corrections fade over about two patches; jumps past 4 m are teleports (respawn).
      smoothMs: 70,
      snap: 4,
      // Also turns on the reconciler's correction telemetry (lastCorrection, drift)
      // that the HUD reads. Warns in the console only past 30 cm of drift.
      warnOnDivergence: 0.3,
      step: (ctx, state, cmd) => {
        // Same order as the server: take the value the wire delivers (float32),
        // sanitize it, then step. The handle replays the staged value, which is
        // not rounded to float32, so round it here; otherwise prediction is off
        // by float noise, enough to flip the controller's grounded test.
        frame.tick = cmd.tick;
        frame.mx = Math.fround(cmd.mx);
        frame.mz = Math.fround(cmd.mz);
        frame.buttons = cmd.buttons;
        frame.yaw = Math.fround(cmd.yaw);
        frame.pitch = Math.fround(cmd.pitch);
        sanitizeInputFields(frame);
        stepPlayer(sim, state as unknown as PlayerSim, frame, ctx.dt);
      },
    });
  }

  /**
   * Advance the prediction stack for this frame and send the inputs it asks
   * for. Call once per rendered frame, before reading any positions.
   */
  pump(now: number, sample: () => { mx: number; mz: number; buttons: number; yaw: number; pitch: number }): number {
    const due = this.predict.tick(now);
    const stepMs = this.input.stepMs ?? 1000 / 30;
    for (let i = 0; i < due; i++) {
      const s = sample();
      const d = this.input.data;
      // Stage values already sanitized so prediction and server agree exactly.
      const f = this.sendFrame;
      f.mx = s.mx;
      f.mz = s.mz;
      f.buttons = s.buttons;
      f.yaw = s.yaw;
      f.pitch = s.pitch;
      sanitizeInputFields(f);
      d.tick = Math.max(0, Math.floor(this.room.clock.serverNow() / stepMs));
      d.mx = f.mx;
      d.mz = f.mz;
      d.buttons = f.buttons;
      d.yaw = f.yaw;
      d.pitch = f.pitch;
      this.input.send();
    }
    this.trackCorrections();
    return due;
  }

  private trackCorrections(): void {
    const me = this.me;
    if (!me || me.reconcileSeq === this.lastReconcileSeq) return;
    this.lastReconcileSeq = me.reconcileSeq;
    const c = me.lastCorrection;
    const err = Math.hypot(c.x ?? 0, c.y ?? 0, c.z ?? 0);
    const p = this.prediction;
    p.reconciles += 1;
    p.lastErrM = err;
    p.sumErrM += err;
    if (err > 0.001) p.corrected += 1;
    if (err > p.maxErrM) p.maxErrM = err;
  }

  /** Smoothed render value for any player field (remote: interpolated, local: predicted). */
  value(player: PlayerState, field: 'x' | 'y' | 'z' | 'yaw' | 'pitch' | 'crouch'): number {
    return this.predict.value(player, field);
  }

  leave(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    void this.room.leave(true);
  }
}

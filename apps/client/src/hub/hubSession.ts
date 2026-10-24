/**
 * The hub room connection (Duck Plaza): join, predict the own duck with the
 * shared sim (the Colyseus reconciler over the hub movement fields, exactly
 * like a match), interpolate the other ducks (near poses 100 ms behind
 * through Predict, far poses through our own buffer, farInterp.ts) and hand
 * the hub messages to the scene. Inputs only: what goes up is the input
 * frame (movement buttons only) and the small hub requests (invite, answer,
 * emote, chat), never a position, id or name.
 */
import { Callbacks, Client, Predict, type InputHandle, type Reconciler, type Room } from '@colyseus/sdk';
import { INTEREST, NET, stepPlayer, type InputFrame, type PlayerSim, type SimWorld } from '@qwakk/shared';
import { Msg, PlayerInput, type ChatMessage } from '@qwakk/shared/net';
import { HUB, HubMsg, type PortalId } from '@qwakk/shared/hub';
import { applyHubFields, createHubSim, HUB_SIM_FIELDS, sanitizeHubInput } from '@qwakk/shared/hub/sim';
import { HubState, type HubDuck, type HubPose } from '@qwakk/shared/hub/schema';
import { config } from '../config.ts';
import { FarInterp } from '../net/farInterp.ts';
import type { PredictionStats } from '../net/session.ts';

export interface HubHandlers {
  chat(m: ChatMessage): void;
  chatLimited(): void;
  /** [HubNote, pid, portal index]. */
  note(kind: number, pid: number, portal: number): void;
  invited(fromPid: number, name: string, tag: string): void;
  party(code: string): void;
  quack(pid: number): void;
  portal(index: number): void;
  notice(text: string): void;
}

export interface HubRemotePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouch: number;
  grounded: boolean;
  emote: number;
  far: boolean;
}

const NEAR_DELAY = NET.interpDelayMs;
const FAR_DELAY = NET.interpDelayMs + config.lerpSmoothMs + INTEREST.farExtraDelayMs;

export class HubSession {
  readonly room: Room<any, HubState>;
  readonly predict: Predict<HubState>;
  readonly input: InputHandle<PlayerInput>;
  me: Reconciler<HubDuck, any> | null = null;
  readonly prediction: PredictionStats = { reconciles: 0, corrected: 0, lastErrM: 0, maxErrM: 0, sumErrM: 0 };
  pingMs = 0;
  private lastReconcileSeq = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly far = new Map<string, FarInterp>();
  private readonly out: HubRemotePose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: 0, grounded: true, emote: 0, far: false };
  private readonly blends = new Map<string, { far: boolean; ox: number; oy: number; oz: number; x: number; y: number; z: number; t: number }>();
  private readonly sendFrame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0 };
  private readonly stepFrame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0 };
  /** The full sim state the step runs on: the hub fields come from the reconciler, the rest never changes. */
  private readonly scratch: PlayerSim = createHubSim(0, 0, 0);

  private constructor(room: Room<any, HubState>) {
    this.room = room;
    this.predict = Predict.get(room, { mode: 'lerp', delay: NEAR_DELAY, tickInterval: 1000 / NET.patchRateHz });
    this.input = room.input({ type: PlayerInput, mode: 'reliable' });
  }

  /** Join the fullest open plaza (or open one). `portal`: back from that mode, appear at its gate. */
  static async join(endpoint: string, opts: { token?: string; character?: number; portal?: PortalId | null }): Promise<HubSession> {
    const client = new Client(endpoint);
    const room = await client.joinOrCreate<HubState>(HUB.roomName, { token: opts.token, ...(opts.character !== undefined ? { character: opts.character } : {}), ...(opts.portal ? { portal: opts.portal } : {}) }, HubState);
    const s = new HubSession(room);
    await new Promise<void>((resolve) => room.onStateChange.once(() => resolve()));
    return s;
  }

  get sessionId(): string {
    return this.room.sessionId;
  }

  /** The own duck's public entry (pid, name, level, team). */
  get mine(): HubDuck | undefined {
    return this.room.state.ducks.get(this.room.sessionId);
  }

  start(sim: SimWorld, handlers: HubHandlers, onAdd: (id: string, d: HubDuck, local: boolean) => void, onRemove: (id: string) => void): void {
    const smooth = config.lerpSmoothMs;
    const near = 1000 / NET.patchRateHz;
    const lin = { mode: 'lerp' as const, delay: NEAR_DELAY, smoothMs: smooth, tickInterval: near, snap: 8 };
    const ang = { mode: 'lerp' as const, delay: NEAR_DELAY, smoothMs: smooth, tickInterval: near, angle: true };
    this.predict.attachAll('poses', { x: lin, y: lin, z: lin, crouch: lin, yaw: ang, pitch: ang });
    const ping = () => this.room.ping((ms) => (this.pingMs = ms));
    ping();
    this.pingTimer = setInterval(ping, 1000);

    const cb = Callbacks.get(this.room);
    cb.onAdd('ducks', (d: HubDuck, id: string) => {
      const local = id === this.room.sessionId;
      if (local) this.createReconciler(sim, d);
      onAdd(id, d, local);
    });
    cb.onRemove('ducks', (_d: HubDuck, id: string) => {
      this.blends.delete(id);
      onRemove(id);
    });
    cb.onAdd('farPoses', (pose: HubPose, id: string) => {
      const interp = new FarInterp();
      this.far.set(id, interp);
      cb.onChange(pose, () => interp.push(this.room.clock.lastServerTime(), pose));
    });
    cb.onRemove('farPoses', (_p: HubPose, id: string) => void this.far.delete(id));

    this.room.onMessage(Msg.Chat, (m: ChatMessage) => {
      if (m && typeof m.text === 'string') handlers.chat(m);
    });
    this.room.onMessage(Msg.ChatLimited, () => handlers.chatLimited());
    this.room.onMessage(Msg.Notice, (text: unknown) => typeof text === 'string' && text && handlers.notice(text.slice(0, 200)));
    this.room.onMessage(HubMsg.Note, (d: number[]) => Array.isArray(d) && handlers.note(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0));
    this.room.onMessage(HubMsg.Invited, (d: unknown[]) => {
      if (Array.isArray(d) && typeof d[0] === 'number') handlers.invited(d[0], String(d[1] ?? '').slice(0, 32), String(d[2] ?? '').slice(0, 8));
    });
    this.room.onMessage(HubMsg.Party, (m: { code?: unknown }) => typeof m?.code === 'string' && handlers.party(m.code));
    this.room.onMessage(HubMsg.Quack, (d: number[]) => Array.isArray(d) && handlers.quack(d[0] ?? 0));
    this.room.onMessage(HubMsg.Portal, (d: number[]) => Array.isArray(d) && handlers.portal(d[0] ?? -1));
  }

  private createReconciler(sim: SimWorld, duck: HubDuck): void {
    const frame = this.stepFrame;
    const scratch = this.scratch;
    this.me = this.predict.reconciler(duck, {
      input: this.input,
      fields: HUB_SIM_FIELDS,
      smoothMs: 70,
      snap: 4,
      warnOnDivergence: 0.3,
      step: (_ctx, state, cmd) => {
        // As in a match (session.ts): the wire values (float32), sanitized the hub way, then the shared step.
        frame.tick = cmd.tick;
        frame.mx = Math.fround(cmd.mx);
        frame.mz = Math.fround(cmd.mz);
        frame.buttons = cmd.buttons;
        frame.yaw = Math.fround(cmd.yaw);
        frame.pitch = Math.fround(cmd.pitch);
        sanitizeHubInput(frame);
        const st = state as unknown as Record<(typeof HUB_SIM_FIELDS)[number], number>;
        applyHubFields(st, scratch);
        stepPlayer(sim, scratch, frame, _ctx.dt);
        for (const f of HUB_SIM_FIELDS) st[f] = scratch[f];
      },
    });
  }

  /** Advance prediction and send the inputs it asks for. Once per rendered frame. */
  pump(now: number, sample: () => { mx: number; mz: number; buttons: number; yaw: number; pitch: number }): number {
    const due = this.predict.tick(now);
    const stepMs = this.input.stepMs ?? 1000 / 30;
    for (let i = 0; i < due; i++) {
      const s = sample();
      const f = this.sendFrame;
      f.mx = s.mx;
      f.mz = s.mz;
      f.buttons = s.buttons;
      f.yaw = s.yaw;
      f.pitch = s.pitch;
      sanitizeHubInput(f);
      const d = this.input.data;
      d.tick = Math.max(0, Math.floor(this.room.clock.serverNow() / stepMs));
      d.vt = 0;
      d.mx = f.mx;
      d.mz = f.mz;
      d.buttons = f.buttons;
      d.yaw = f.yaw;
      d.pitch = f.pitch;
      this.input.send();
    }
    const me = this.me;
    if (me && me.reconcileSeq !== this.lastReconcileSeq) {
      this.lastReconcileSeq = me.reconcileSeq;
      const c = me.lastCorrection;
      const err = Math.hypot(c.x ?? 0, c.y ?? 0, c.z ?? 0);
      const p = this.prediction;
      p.reconciles++;
      p.lastErrM = err;
      p.sumErrM += err;
      if (err > 0.001) p.corrected++;
      p.maxErrM = Math.max(p.maxErrM, err);
    }
    return due;
  }

  /** Another duck as drawn now (near if we get its near pose, else far), or null. Reused object. */
  pose(id: string): HubRemotePose | null {
    const st = this.room.state;
    const o = this.out;
    const near = st.poses.get(id);
    const fi = this.far.get(id);
    let isFar: boolean;
    if (near && !(near.x === 0 && near.y === 0 && near.z === 0)) {
      o.x = this.predict.value(near, 'x');
      o.y = this.predict.value(near, 'y');
      o.z = this.predict.value(near, 'z');
      o.yaw = this.predict.value(near, 'yaw');
      o.pitch = this.predict.value(near, 'pitch');
      o.crouch = this.predict.value(near, 'crouch');
      o.grounded = near.grounded === 1;
      o.emote = near.emote;
      isFar = false;
    } else if (fi && !fi.empty) {
      const c = this.room.clock;
      fi.sample(c.serverNow() - FAR_DELAY - c.smoothedRtt() / 2, o as never);
      const fp = st.farPoses.get(id);
      o.grounded = fp?.grounded === 1;
      o.emote = fp?.emote ?? 0;
      isFar = true;
    } else return null;
    o.far = isFar;
    const now = performance.now();
    let b = this.blends.get(id);
    if (!b) this.blends.set(id, (b = { far: isFar, ox: 0, oy: 0, oz: 0, x: o.x, y: o.y, z: o.z, t: now }));
    if (b.far !== isFar && Math.hypot(b.x - o.x, b.z - o.z) < 8) {
      b.ox = b.x - o.x;
      b.oy = b.y - o.y;
      b.oz = b.z - o.z;
    }
    b.far = isFar;
    const k = Math.exp(-Math.max(0, now - b.t) / 150);
    b.ox *= k;
    b.oy *= k;
    b.oz *= k;
    o.x += b.ox;
    o.y += b.oy;
    o.z += b.oz;
    b.x = o.x;
    b.y = o.y;
    b.z = o.z;
    b.t = now;
    return o;
  }

  sendChat(text: string): void {
    this.room.send(Msg.Chat, text);
  }

  invite(pid: number): void {
    this.room.send(HubMsg.Invite, [pid]);
  }

  answer(fromPid: number, accept: boolean): void {
    this.room.send(HubMsg.Answer, [fromPid, accept ? 1 : 0]);
  }

  emote(kind: number): void {
    this.room.send(HubMsg.Emote, [kind]);
  }

  /** Session id of the duck with this pid. */
  idOfPid(pid: number): string | null {
    for (const [id, d] of this.room.state.ducks) if (d.pid === pid) return id;
    return null;
  }

  leave(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    void this.room.leave(true).catch(() => undefined);
  }
}

/**
 * Network session: joins the island room and wires the Colyseus 0.18
 * prediction stack.
 *
 * - Local player: `predict.reconciler` (client-side prediction with server
 *   reconciliation) over the full sim state, weapon included. Every input is
 *   stepped immediately with the shared sim, so shots, ammo and recoil are
 *   instant; the server's copy decides and corrections blend in.
 * - Other players: quantized poses from `poses` (every tick, near) or
 *   `farPoses` (10 Hz, far). Near players: `Predict` lerp 100 ms behind plus a
 *   30 ms output spring. Far players: our own buffer (farInterp.ts) 180 ms behind.
 * - Inputs go through `room.input()`: the framework numbers them, the server
 *   sanitizes and acks them. Each input carries the view time (`vt`) the
 *   server rewinds to when it checks this player's shots.
 */
import { Callbacks, Client, Predict, type InputHandle, type Reconciler, type Room } from '@colyseus/sdk';
import {
  BR,
  INTEREST,
  RAID,
  lastExplosive,
  NET,
  PLAYER_SIM_FIELDS,
  ROOM,
  sanitizeInputFields,
  stepPlayer,
  type InputFrame,
  type DmReward,
  type DmKillcam,
  type PlayerSim,
  type ShotFired,
  type SimWorld,
} from '@qwakk/shared';
import { IslandState, Msg, PlayerInput, type ChatMessage, type LootItem, type PlayerState, type Pose, type TeamMate } from '@qwakk/shared/net';
import { config } from '../config.ts';
import { FarInterp } from './farInterp.ts';
import { NetSim, type NetSimSettings } from './netsim.ts';

export interface PredictionStats {
  reconciles: number;
  /** Reconciles whose position correction was above 1 mm. */
  corrected: number;
  lastErrM: number;
  maxErrM: number;
  sumErrM: number;
}

/** Server messages, decoded. */
export interface SessionHandlers {
  /** Another player's shot: shooter pid, weapon, outcome, muzzle and end points (m). */
  shots(list: { pid: number; weapon: number; outcome: number; from: [number, number, number]; to: [number, number, number] }[]): void;
  hitConfirm(victimPid: number, damage: number, head: boolean, killed: boolean, knocked: boolean, explosive?: boolean): void;
  /** Damage taken: world angle toward the attacker (null: the zone) and the amount. */
  damaged(angle: number | null, damage: number): void;
  /** `at` is null when the server did not tell us where (we could not see the victim). killerPid 0: the zone. */
  kill(killerPid: number, victimPid: number, weapon: number, head: boolean, at: [number, number, number] | null): void;
  /** A duck was knocked (team modes): attacker pid (0: the zone), victim pid, weapon, headshot. */
  knock(byPid: number, victimPid: number, weapon: number, head: boolean): void;
  /** A shot we cannot see: weapon, world angle toward it, loudness 0..2. */
  shotHint(weapon: number, angle: number, loud: number): void;
  /** Our pickup went through. */
  picked(kind: number, amount: number): void;
  /** A pickup or an inventory request did nothing: the reason (Deny.*) and the item kind. */
  denied(reason: number, kind: number): void;
  /** We are out (or won): placement, players (teams in team modes) in the match, kills, damage, survived ms, team size. */
  result(placement: number, total: number, kills: number, damage: number, survivedMs: number, teamSize: number): void;
  /** The local sim fired (live step only, never on replay). `state` is the post-step state. */
  localShot(shot: ShotFired, state: PlayerSim, buttons: number): void;
  /** A short notice from the server operators (plain text, shown as a toast). */
  notice?(text: string): void;
  chat?(message: ChatMessage): void;
  chatLimited?(): void;
  dmReward?(reward: DmReward): void;
  dmKillcam?(replay: DmKillcam): void;
  dmPower?(kind: number): void;
  /** Caped hero news: DmHeroEvent, hero pid, the other pid (old hero for a take). */
  dmHero?(event: number, heroPid: number, otherPid: number): void;
  /** The coarse public hero ping: hero pid and its grid position (m). */
  dmHeroPing?(heroPid: number, x: number, z: number): void;
  /** Deathmatch explosives: a grenade or rocket we may draw (ownerPid 0: a resting grenade, thrower unknown). Meters, m/s. */
  projectile?(id: number, kind: number, ownerPid: number, at: [number, number, number], vel: [number, number, number]): void;
  /** An explosion (kind ExplosiveKind) and the projectile id it ends. */
  boom?(id: number, kind: number, at: [number, number, number]): void;
  /** We picked up the rocket launcher with this many rockets. */
  dmRocket?(rockets: number): void;
  /** The local sim threw a grenade or launched a rocket (live step only). `state` is the post-step state. */
  localExplosive?(kind: number, state: PlayerSim, buttons: number): void;
  /** Hunt Season: our upgrade cards ([id, value] pairs, empty: closed) and when they close (server ms). */
  raidOffer?(cards: [number, number][], deadlineMs: number): void;
  /** Hunt Season: our own run numbers (Msg.RaidSelf). */
  raidSelf?(data: number[]): void;
  /** Hunt Season: a hunter bagged (kind, by pid 0: nobody), at (m). */
  raidKill?(kind: number, killerPid: number, head: boolean, at: [number, number, number]): void;
  /** Hunt Season: RaidEvent and its two numbers. */
  raidEvent?(event: number, a: number, b: number): void;
  /** Hunt Season: the run is over for us (Msg.RaidEnd fields). */
  raidEnd?(data: number[]): void;
}

/** A hunter as drawn (interpolated like a near duck), reused object. */
export interface HunterPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

export interface RemotePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouch: number;
  grounded: boolean;
  far: boolean;
  /** Movement mode (glider) and action (reload, equip, heal), from the pose entry. */
  fly: number;
  act: number;
  /** 1 while it holds the deathmatch rocket launcher (pose entry). */
  lnch: number;
}

const NEAR_DELAY = NET.interpDelayMs;
/** Far players are drawn this far behind: the near timeline (incl. its output spring) plus the server's far offset, so lag compensation lines up. */
const FAR_DELAY = NET.interpDelayMs + config.lerpSmoothMs + INTEREST.farExtraDelayMs;

export class Session {
  readonly room: Room<any, IslandState>;
  readonly predict: Predict<IslandState>;
  readonly input: InputHandle<PlayerInput>;
  readonly netsim: NetSim;
  me: Reconciler<PlayerState, any> | null = null;
  /** Every player but the local one, keyed by session id. */
  readonly remotes = new Map<string, PlayerState>();
  readonly prediction: PredictionStats = { reconciles: 0, corrected: 0, lastErrM: 0, maxErrM: 0, sumErrM: 0 };
  /** Round trip measured with room.ping every second (includes the fake-network delay). */
  pingMs = 0;
  private handlers: SessionHandlers | null = null;
  private lastReconcileSeq = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  /** Scratch frames: one for staging sends, one for the reconciler step. */
  private readonly sendFrame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0 };
  private readonly stepFrame: InputFrame = { seq: 0, tick: 0, mx: 0, mz: 0, buttons: 0, yaw: 0, pitch: 0 };
  private readonly poseOut: RemotePose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: 0, grounded: true, far: false, fly: 0, act: 0, lnch: 0 };
  private readonly far = new Map<string, FarInterp>();
  /** Per player: which source was drawn last and the offset that hides a near/far switch. */
  private readonly blends = new Map<string, { far: boolean; ox: number; oy: number; oz: number; x: number; y: number; z: number; t: number }>();

  private constructor(room: Room<any, IslandState>, netsim: NetSim) {
    this.room = room;
    this.netsim = netsim;
    this.predict = Predict.get(room, { mode: 'lerp', delay: NEAR_DELAY, tickInterval: 1000 / NET.patchRateHz });
    this.input = room.input({ type: PlayerInput, mode: 'reliable' });
  }

  /**
   * Join a match. `roomId` joins that room from the lobby list (battle
   * royale or one of the static deathmatch rooms). Battle royale: `create`
   * opens a new room, neither is Quick Play (the server picks the open room
   * with the most players, or opens one). Deathmatch Quick Play joins the open
   * room with the most humans; deathmatch rooms are never created by a client.
   */
  static async join(endpoint: string, opts: { mode: 'br' | 'dm' | 'raid'; roomId?: string; create?: boolean; team?: number; name?: string; token?: string; character?: number }, net: NetSimSettings, spectate = false): Promise<Session> {
    const client = new Client(endpoint);
    const roomName = opts.mode === 'br' ? BR.roomName : opts.mode === 'raid' ? RAID.roomName : ROOM.name;
    // `team`: the battle royale team size a new room gets (the server ignores it when joining).
    // `character`: the picked duck (looks only; the server keeps catalog ids and nothing else).
    const joinOpts = { name: opts.name ?? '', token: opts.token, spectate, ...(opts.mode === 'br' && opts.team ? { team: opts.team } : {}), ...(opts.character !== undefined ? { character: opts.character } : {}) };
    const room = opts.roomId
      ? await client.joinById<IslandState>(opts.roomId, joinOpts, IslandState)
      : (opts.mode === 'br' || opts.mode === 'raid') && opts.create
        ? await client.create<IslandState>(roomName, joinOpts, IslandState)
        : opts.mode === 'dm'
          ? await client.join<IslandState>(roomName, joinOpts, IslandState)
          : await client.joinOrCreate<IslandState>(roomName, joinOpts, IslandState);
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

  /** The local player's public state (score, hp), once it exists. */
  get mine(): PlayerState | undefined {
    return this.room.state.players.get(this.room.sessionId);
  }

  /**
   * Resolve once the full state has been decoded. The state object exists (with
   * default values) before that, so checking it would read seed 0 and build the
   * wrong island. Patches arrive every tick, so waiting for one is cheap.
   */
  private firstState(): Promise<void> {
    return new Promise((resolve) => this.room.onStateChange.once(() => resolve()));
  }

  /** Start tracking players and messages. Needs the local sim world for prediction. */
  start(sim: SimWorld, handlers: SessionHandlers, onAdd: (id: string, p: PlayerState, local: boolean) => void, onRemove: (id: string) => void): void {
    this.handlers = handlers;
    const smooth = config.lerpSmoothMs;
    const lin = (delay: number, tick: number) => ({ mode: 'lerp' as const, delay, smoothMs: smooth, tickInterval: tick, snap: 8 });
    const ang = (delay: number, tick: number) => ({ mode: 'lerp' as const, delay, smoothMs: smooth, tickInterval: tick, angle: true });
    const near = 1000 / NET.patchRateHz;
    this.predict.attachAll('poses', { x: lin(NEAR_DELAY, near), y: lin(NEAR_DELAY, near), z: lin(NEAR_DELAY, near), crouch: lin(NEAR_DELAY, near), yaw: ang(NEAR_DELAY, near), pitch: ang(NEAR_DELAY, near) });
    // Hunt Season hunters: drawn on the near timeline, so a shot's rewind (the server's hunter history) matches.
    this.predict.attachAll('hunters', { x: lin(NEAR_DELAY, near), y: lin(NEAR_DELAY, near), z: lin(NEAR_DELAY, near), yaw: ang(NEAR_DELAY, near), pitch: ang(NEAR_DELAY, near) });

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
      this.blends.delete(id);
      onRemove(id);
    });
    // Far players (10 Hz): our own interpolation buffer, see farInterp.ts.
    callbacks.onAdd('farPoses', (pose: Pose, id: string) => {
      const interp = new FarInterp();
      this.far.set(id, interp);
      callbacks.onChange(pose, () => interp.push(this.room.clock.lastServerTime(), pose));
    });
    callbacks.onRemove('farPoses', (_pose: Pose, id: string) => {
      this.far.delete(id);
    });

    const m = (v: number) => v / 100;
    this.room.onMessage(Msg.Shots, (list: number[][]) => {
      handlers.shots(
        list.map((d) => ({
          pid: d[0] ?? 0,
          weapon: d[1] ?? 0,
          outcome: d[2] ?? 0,
          from: [m(d[3] ?? 0), m(d[4] ?? 0), m(d[5] ?? 0)],
          to: [m(d[6] ?? 0), m(d[7] ?? 0), m(d[8] ?? 0)],
        })),
      );
    });
    this.room.onMessage(Msg.HitConfirm, (d: number[]) => handlers.hitConfirm(d[0] ?? 0, d[1] ?? 0, d[2] === 1, d[3] === 1, d[4] === 1, d[5] === 1));
    this.room.onMessage(Msg.Knock, (d: number[]) => handlers.knock(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] === 1));
    this.room.onMessage(Msg.Damaged, (d: number[]) => handlers.damaged(d[2] === 1 ? null : (d[0] ?? 0) / 1000, d[1] ?? 0));
    this.room.onMessage(Msg.Kill, (d: number[]) => handlers.kill(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] === 1, d[4] === 1 ? [m(d[5] ?? 0), m(d[6] ?? 0), m(d[7] ?? 0)] : null));
    this.room.onMessage(Msg.ShotHint, (list: number[][]) => {
      for (const d of list) handlers.shotHint(d[0] ?? 0, (d[1] ?? 0) / 1000, d[2] ?? 0);
    });
    this.room.onMessage(Msg.Picked, (d: number[]) => handlers.picked(d[0] ?? 0, d[1] ?? 0));
    this.room.onMessage(Msg.Denied, (d: number[]) => handlers.denied(d[0] ?? 0, d[1] ?? 0));
    this.room.onMessage(Msg.Result, (d: number[]) => handlers.result(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0, d[4] ?? 0, d[5] ?? 1));
    this.room.onMessage(Msg.Notice, (text: unknown) => {
      if (typeof text === 'string' && text) handlers.notice?.(text.slice(0, 200));
    });
    this.room.onMessage(Msg.Chat, (message: ChatMessage) => handlers.chat?.(message));
    this.room.onMessage(Msg.ChatLimited, () => handlers.chatLimited?.());
    this.room.onMessage(Msg.DmKillcam, (replay: DmKillcam) => handlers.dmKillcam?.(replay));
    this.room.onMessage(Msg.DmReward, (reward: DmReward) => handlers.dmReward?.(reward));
    this.room.onMessage(Msg.DmPower, (kind: number) => handlers.dmPower?.(kind));
    this.room.onMessage(Msg.DmHero, (d: number[]) => handlers.dmHero?.(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0));
    this.room.onMessage(Msg.DmHeroPing, (d: number[]) => handlers.dmHeroPing?.(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0));
    this.room.onMessage(Msg.Proj, (d: number[]) => handlers.projectile?.(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, [m(d[3] ?? 0), m(d[4] ?? 0), m(d[5] ?? 0)], [m(d[6] ?? 0), m(d[7] ?? 0), m(d[8] ?? 0)]));
    this.room.onMessage(Msg.Boom, (d: number[]) => handlers.boom?.(d[0] ?? 0, d[1] ?? 0, [m(d[2] ?? 0), m(d[3] ?? 0), m(d[4] ?? 0)]));
    this.room.onMessage(Msg.DmRocket, (n: number) => handlers.dmRocket?.(typeof n === 'number' ? n : 0));
    this.room.onMessage(Msg.RaidOffer, (d: number[]) => {
      const cards: [number, number][] = [];
      for (let i = 1; i + 1 < d.length; i += 2) cards.push([d[i] ?? 0, d[i + 1] ?? 0]);
      handlers.raidOffer?.(cards, d[0] ?? 0);
    });
    this.room.onMessage(Msg.RaidSelf, (d: number[]) => handlers.raidSelf?.(Array.isArray(d) ? d : []));
    this.room.onMessage(Msg.RaidKill, (d: number[]) => handlers.raidKill?.(d[0] ?? 0, d[1] ?? 0, d[2] === 1, [m(d[3] ?? 0), m(d[4] ?? 0), m(d[5] ?? 0)]));
    this.room.onMessage(Msg.RaidEvent, (d: number[]) => handlers.raidEvent?.(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0));
    this.room.onMessage(Msg.RaidEnd, (d: number[]) => handlers.raidEnd?.(Array.isArray(d) ? d : []));
  }

  sendChat(text: string): void {
    this.room.send(Msg.Chat, text);
  }

  /** Loot items in our view (battle royale): added, changed (amount), removed. */
  watchItems(onAdd: (id: string, it: LootItem) => void, onRemove: (id: string) => void): void {
    const callbacks = Callbacks.get(this.room);
    callbacks.onAdd('items', (it: LootItem, id: string) => onAdd(id, it));
    callbacks.onRemove('items', (_it: LootItem, id: string) => onRemove(id));
  }

  /** While dead: watch the next (1) or previous (-1) living duck. */
  /** An inventory request (Msg.Inv); the server checks it and answers through the state, Picked or Denied. */
  inventory(msg: number[]): void {
    this.room.send(Msg.Inv, msg);
  }

  spectate(dir: 1 | -1): void {
    this.room.send(Msg.Spectate, dir);
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
        const s = state as unknown as PlayerSim;
        const shot = stepPlayer(sim, s, frame, ctx.dt);
        // Effects only for live steps: a replay re-runs inputs whose shots were already shown.
        if (shot && !ctx.isReplay) this.handlers?.localShot(shot, s, frame.buttons);
        if (lastExplosive.kind && !ctx.isReplay) this.handlers?.localExplosive?.(lastExplosive.kind, s, frame.buttons);
      },
    });
  }

  /** Server time (ms) at which this client is drawing near players: the rewind target for its shots. */
  viewTime(): number {
    const c = this.room.clock;
    return Math.max(0, Math.round(c.serverNow() - NEAR_DELAY - c.smoothedRtt() / 2 - config.lerpSmoothMs));
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
      d.vt = this.viewTime();
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

  /** The drawn pose of another player (near if available, else far), or null. Reused object. */
  pose(id: string): RemotePose | null {
    const st = this.room.state;
    const o = this.poseOut;
    const near = st.poses.get(id);
    const farInterp = this.far.get(id);
    let isFar: boolean;
    if (near && !(near.x === 0 && near.y === 0 && near.z === 0)) {
      o.x = this.predict.value(near, 'x');
      o.y = this.predict.value(near, 'y');
      o.z = this.predict.value(near, 'z');
      o.yaw = this.predict.value(near, 'yaw');
      o.pitch = this.predict.value(near, 'pitch');
      o.crouch = this.predict.value(near, 'crouch');
      o.grounded = near.grounded === 1;
      o.fly = near.fly;
      o.act = near.act;
      o.lnch = near.lnch;
      isFar = false;
    } else if (farInterp && !farInterp.empty) {
      const c = this.room.clock;
      farInterp.sample(c.serverNow() - FAR_DELAY - c.smoothedRtt() / 2, o);
      const fp = st.farPoses.get(id);
      o.grounded = fp?.grounded === 1;
      o.fly = fp?.fly ?? 0;
      o.act = fp?.act ?? 0;
      o.lnch = fp?.lnch ?? 0;
      isFar = true;
    } else return null;
    o.far = isFar;

    // A near/far switch changes the timeline (about 130 vs 180 ms behind): ease the jump out.
    const now = performance.now();
    let b = this.blends.get(id);
    if (!b) {
      b = { far: isFar, ox: 0, oy: 0, oz: 0, x: o.x, y: o.y, z: o.z, t: now };
      this.blends.set(id, b);
    }
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

  private readonly hunterOut: HunterPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

  /** A Hunt Season hunter as drawn now (interpolated 100 ms behind like near ducks), or null. Reused object. */
  hunterPose(id: string): HunterPose | null {
    const h = this.room.state.hunters.get(id);
    if (!h) return null;
    const o = this.hunterOut;
    o.x = this.predict.value(h, 'x');
    o.y = this.predict.value(h, 'y');
    o.z = this.predict.value(h, 'z');
    o.yaw = this.predict.value(h, 'yaw');
    o.pitch = this.predict.value(h, 'pitch');
    return o;
  }

  /** Hunt Season: pick upgrade card `index` (the server checks it against our offer). */
  raidPick(index: number): void {
    this.room.send(Msg.RaidPick, index);
  }

  /** Our team (0: none). */
  get myTeam(): number {
    return this.mine?.team ?? 0;
  }

  /** Is this player on our side (same nonzero team)? */
  isAlly(id: string): boolean {
    const t = this.myTeam;
    return t > 0 && id !== this.room.sessionId && this.room.state.players.get(id)?.team === t;
  }

  /** A teammate's HUD entry (health, knocked, revive), only ever sent for our own team. */
  mate(id: string): TeamMate | undefined {
    return this.room.state.mates.get(id);
  }

  /** Session id for a player's pid. */
  idOfPid(pid: number): string | null {
    for (const [id, p] of this.room.state.players) if (p.pid === pid) return id;
    return null;
  }

  playerByPid(pid: number): PlayerState | null {
    for (const p of this.room.state.players.values()) if (p.pid === pid) return p;
    return null;
  }

  leave(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    void this.room.leave(true);
  }
}


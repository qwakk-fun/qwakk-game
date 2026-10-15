/**
 * The game loop. Rendering runs at the display refresh rate; the sim runs at a
 * fixed 30 Hz inside the Colyseus prediction stack. Each frame:
 *   1. pump: the prediction stack says how many fixed steps are due, we sample
 *      input and send that many (each one is predicted on send);
 *   2. read interpolated poses (local: predicted, remote: ~100 ms behind);
 *   3. place the camera from the latest mouse angles, then render.
 */
import * as THREE from 'three/webgpu';
import { Button, createSimWorld, generateMap, MOVE, simSelfTestHash, type SimWorld } from '@qwakk/shared';
import type { PlayerState } from '@qwakk/shared/net';
import { TpsCamera } from './camera/tpsCamera.ts';
import { config } from './config.ts';
import { Hud } from './hud/hud.ts';
import { Controls } from './input/controls.ts';
import type { Session } from './net/session.ts';
import { Avatar } from './player/avatar.ts';
import { loadDuckGlb } from './player/duckModel.ts';
import type { RenderContext } from './render/renderer.ts';
import { createEnvironment, type Environment } from './world/environment.ts';
import { createPropsGroup } from './world/propsMesh.ts';
import { createTerrainMesh } from './world/terrainMesh.ts';

const LAG_PRESETS = [0, 60, 120, 150, 250];

interface RemoteView {
  state: PlayerState;
  avatar: Avatar;
  motion: MotionProbe;
}

/** Rolling frame-time window for the HUD and the test hook. */
class FrameTimer {
  private samples: number[] = [];
  private last = 0;
  fps = 0;
  avg = 0;
  max = 0;
  private acc = 0;

  frame(now: number): number {
    const dt = this.last === 0 ? 16.7 : now - this.last;
    this.last = now;
    this.samples.push(dt);
    this.acc += dt;
    if (this.acc >= 500) {
      const sum = this.samples.reduce((a, b) => a + b, 0);
      this.avg = sum / this.samples.length;
      this.max = Math.max(...this.samples);
      this.fps = 1000 / this.avg;
      this.samples = [];
      this.acc = 0;
    }
    return Math.min(dt, 100) / 1000;
  }
}

/**
 * Smoothness probe: the horizontal speed of what is actually drawn. A visible
 * snap shows up as a frame whose drawn speed is far above any real move speed.
 */
class MotionProbe {
  maxSpeed = 0;
  snapFrames = 0;
  frames = 0;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;

  sample(x: number, z: number, dt: number): void {
    if (!Number.isNaN(this.lastX) && dt > 0) {
      const v = Math.hypot(x - this.lastX, z - this.lastZ) / dt;
      if (v < 50) {
        this.frames += 1;
        if (v > this.maxSpeed) this.maxSpeed = v;
        if (v > MOVE.sprintSpeed * 1.6) this.snapFrames += 1;
      }
    }
    this.lastX = x;
    this.lastZ = z;
  }

  reset(): void {
    this.maxSpeed = 0;
    this.snapFrames = 0;
    this.frames = 0;
  }
}

export class Game {
  private readonly ctx: RenderContext;
  private readonly session: Session;
  private readonly sim: SimWorld;
  private readonly controls: Controls;
  private readonly cam: TpsCamera;
  private readonly hud: Hud;
  private readonly env: Environment;
  private readonly timer = new FrameTimer();
  private readonly localAvatar = new Avatar();
  private readonly remotes = new Map<string, RemoteView>();
  private readonly localMotion = new MotionProbe();
  private lastSprint = false;
  private hudClock = 0;
  private autopilotT = 0;
  private lagIndex = 0;
  private duckGlb: THREE.Object3D | null = null;

  constructor(ctx: RenderContext, session: Session, canvas: HTMLCanvasElement, hudEl: HTMLElement) {
    this.ctx = ctx;
    this.session = session;
    const map = generateMap(session.seed);
    this.sim = createSimWorld(map);

    const { scene } = ctx;
    scene.add(createTerrainMesh(map.terrain));
    scene.add(createPropsGroup(map));
    this.env = createEnvironment(scene, config.shadows);
    scene.add(this.localAvatar.object);
    this.localAvatar.object.visible = false;

    this.controls = new Controls(canvas);
    this.cam = new TpsCamera(ctx.camera, this.sim);
    this.hud = new Hud(hudEl, config.hud);
    this.lagIndex = Math.max(0, LAG_PRESETS.indexOf(config.latencyMs));

    this.controls.onAction((a) => {
      const ns = this.session.netsim.settings;
      if (a === 'shoulder') this.cam.swapShoulder();
      if (a === 'hud') this.hud.toggle();
      if (!config.devtools && (a === 'lag' || a === 'jitter' || a === 'loss')) return;
      if (a === 'lag') {
        this.lagIndex = (this.lagIndex + 1) % LAG_PRESETS.length;
        ns.latencyMs = LAG_PRESETS[this.lagIndex] ?? 0;
      }
      if (a === 'jitter') ns.jitterMs = ns.jitterMs > 0 ? 0 : 20;
      if (a === 'loss') ns.loss = ns.loss > 0 ? 0 : 0.02;
    });

    session.start(
      this.sim,
      (id, state, local) => {
        if (local) {
          this.localAvatar.object.visible = true;
          this.controls.yaw = state.yaw;
          return;
        }
        const avatar = new Avatar();
        if (this.duckGlb) avatar.setModel(this.duckGlb);
        scene.add(avatar.object);
        this.remotes.set(id, { state, avatar, motion: new MotionProbe() });
      },
      (id) => {
        this.remotes.get(id)?.avatar.dispose();
        this.remotes.delete(id);
      },
    );

    if (!config.placeholderDuck) void loadDuckGlb().then((glb) => {
      if (!glb) return;
      this.duckGlb = glb;
      this.localAvatar.setModel(glb);
      for (const r of this.remotes.values()) r.avatar.setModel(glb);
    });

    if (config.devtools) this.exposeTestHook();
  }

  get controlsRef(): Controls {
    return this.controls;
  }

  start(): void {
    void this.ctx.renderer.setAnimationLoop((time: number) => this.frame(time));
  }

  stop(): void {
    void this.ctx.renderer.setAnimationLoop(null);
  }

  /** Input for one fixed step: keyboard and mouse, or the autopilot. */
  private sampleInput = (): { mx: number; mz: number; buttons: number; yaw: number; pitch: number } => {
    if (config.autopilot) {
      // Walk in wide circles, sprint in bursts and hop now and then.
      this.autopilotT += 1;
      const t = this.autopilotT;
      this.controls.yaw += 0.025;
      const sprint = Math.floor(t / 90) % 2 === 0 ? Button.Sprint : 0;
      const jump = t % 70 === 0 ? Button.Jump : 0;
      return { mx: Math.sin(t / 50) * 0.4, mz: 1, buttons: sprint | jump, yaw: this.controls.yaw, pitch: this.controls.pitch };
    }
    const s = this.controls.sample();
    this.lastSprint = (s.buttons & Button.Sprint) !== 0 && s.mz > 0;
    return { ...s, yaw: this.controls.yaw, pitch: this.controls.pitch };
  };

  private frame(now: number): void {
    const dt = this.timer.frame(now);
    const session = this.session;
    session.pump(now, this.sampleInput);

    // Local player: predicted pose, interpolated between fixed steps.
    const me = session.me;
    if (me) {
      const x = me.value('x');
      const y = me.value('y');
      const z = me.value('z');
      const crouch = me.state.crouch;
      // The duck faces the camera right away, not one tick later.
      this.localAvatar.update({ x, y, z, yaw: this.controls.yaw, crouch, grounded: me.state.grounded === 1 }, dt);
      this.localMotion.sample(x, z, dt);
      this.cam.update(dt, x, y, z, this.smoothCrouch(crouch, dt), this.controls.yaw, this.controls.pitch, this.lastSprint || config.autopilot);
      this.env.follow(this.cam.pivotPoint);
    }

    // Remote players: interpolated about 100 ms in the past.
    for (const r of this.remotes.values()) {
      const s = r.state;
      const x = session.value(s, 'x');
      const z = session.value(s, 'z');
      r.avatar.update({ x, y: session.value(s, 'y'), z, yaw: session.value(s, 'yaw'), crouch: session.value(s, 'crouch'), grounded: s.grounded === 1 }, dt);
      r.motion.sample(x, z, dt);
    }

    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);

    this.hudClock += dt;
    if (this.hudClock > 0.2) {
      this.hudClock = 0;
      this.renderHud();
    }
  }

  private crouchBlend = 0;
  private smoothCrouch(target: number, dt: number): number {
    this.crouchBlend += (target - this.crouchBlend) * (1 - Math.exp(-dt * 16));
    return this.crouchBlend;
  }

  private renderHud(): void {
    const s = this.session;
    const me = s.me;
    const ns = s.netsim.settings;
    const net = s.netsim.active ? `${ns.latencyMs} ms rtt, +/-${ns.jitterMs / 2} ms, ${(ns.loss * 100).toFixed(0)}% loss` : 'off';
    this.hud.render({
      fps: this.timer.fps,
      frameMsAvg: this.timer.avg,
      frameMsMax: this.timer.max,
      pingMs: s.pingMs,
      jitterMs: s.room.clock.jitter(),
      serverTick: s.room.state.tick,
      players: s.room.state.players.size,
      backend: this.ctx.backend,
      predErrorM: s.prediction.lastErrM,
      driftEma: me?.drift.ema ?? 0,
      driftPeak: me?.drift.peak ?? 0,
      reconciles: s.prediction.reconciles,
      pendingInputs: me?.pendingCount ?? 0,
      speed: me ? Math.hypot(me.state.vx, me.state.vz) : 0,
      grounded: me ? me.state.grounded === 1 : true,
      netsim: net,
      sensitivity: this.controls.sensitivity,
      pos: me ? [me.state.x, me.state.y, me.state.z] : [0, 0, 0],
    });
  }

  /** Read-only numbers for automated browser tests (Playwright). */
  private exposeTestHook(): void {
    (window as unknown as { __qwakk: unknown }).__qwakk = {
      snapshot: () => {
        const s = this.session;
        const me = s.me;
        const remotes: Record<string, { x: number; y: number; z: number; drawnMaxSpeed: number; snapFrames: number; frames: number }> = {};
        for (const [id, r] of this.remotes) {
          remotes[id] = { x: r.state.x, y: r.state.y, z: r.state.z, drawnMaxSpeed: r.motion.maxSpeed, snapFrames: r.motion.snapFrames, frames: r.motion.frames };
        }
        return {
          sessionId: s.sessionId,
          backend: this.ctx.backend,
          fps: this.timer.fps,
          frameMsAvg: this.timer.avg,
          frameMsMax: this.timer.max,
          pingMs: s.pingMs,
          serverTick: s.room.state.tick,
          players: s.room.state.players.size,
          me: me ? { x: me.state.x, y: me.state.y, z: me.state.z, grounded: me.state.grounded } : null,
          remotes,
          prediction: { ...s.prediction, avgErrM: s.prediction.reconciles ? s.prediction.sumErrM / s.prediction.reconciles : 0, driftEma: me?.drift.ema ?? 0, driftPeak: me?.drift.peak ?? 0 },
          pendingInputs: me?.pendingCount ?? 0,
          localMotion: { drawnMaxSpeed: this.localMotion.maxSpeed, snapFrames: this.localMotion.snapFrames, frames: this.localMotion.frames },
          netsim: { ...s.netsim.settings },
        };
      },
      simSelfTestHash: () => simSelfTestHash(),
      resetStats: () => {
        Object.assign(this.session.prediction, { reconciles: 0, corrected: 0, lastErrM: 0, maxErrM: 0, sumErrM: 0 });
        this.localMotion.reset();
        for (const r of this.remotes.values()) r.motion.reset();
      },
      setNet: (latencyMs: number, jitterMs: number, loss: number) => {
        Object.assign(this.session.netsim.settings, { latencyMs, jitterMs, loss });
      },
    };
  }
}

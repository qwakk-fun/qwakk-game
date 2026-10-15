/**
 * The game loop. Rendering runs at the display refresh rate; the sim runs at a
 * fixed 30 Hz inside the Colyseus prediction stack. Each frame:
 *   1. pump: the prediction stack says how many fixed steps are due, we sample
 *      input and send that many (each is predicted on send, shots included);
 *   2. read interpolated poses (local: predicted, others: 100 to 150 ms behind);
 *   3. animate, place the camera from the latest mouse angles, then render;
 *   4. HUD.
 */
import * as THREE from 'three/webgpu';
import { Button, COMBAT, createSimWorld, generateMap, inaccuracy, terrainHeightAt, weaponStats, type SimWorld } from '@qwakk/shared';
import { MatchPhase, type PlayerState } from '@qwakk/shared/net';
import { Sound } from './audio/sound.ts';
import { TpsCamera } from './camera/tpsCamera.ts';
import { config, DEVTOOLS } from './config.ts';
import { Effects } from './fx/effects.ts';
import type { Autopilot } from './game/autopilot.ts';
import { CombatFeedback } from './game/combatFeedback.ts';
import { FrameTimer, MotionProbe } from './game/metrics.ts';
import { GameHud, type ScoreRow } from './hud/gameHud.ts';
import { Hud } from './hud/hud.ts';
import { Controls } from './input/controls.ts';
import type { Session } from './net/session.ts';
import { loadClips } from './player/animations.ts';
import { Avatar } from './player/avatar.ts';
import { loadDuckGlb } from './player/duckModel.ts';
import { hasWeaponArt, loadWeaponLibrary } from './player/weaponModel.ts';
import type { RenderContext } from './render/renderer.ts';
import { createEnvironment, type Environment } from './world/environment.ts';
import { createPropsGroup } from './world/propsMesh.ts';
import { createTerrainMesh } from './world/terrainMesh.ts';

const LAG_PRESETS = [0, 60, 120, 150, 250];

interface RemoteView {
  state: PlayerState;
  avatar: Avatar;
  motion: MotionProbe;
  lastAct: number;
}

export class Game {
  private readonly ctx: RenderContext;
  private readonly session: Session;
  private readonly sim: SimWorld;
  private readonly controls: Controls;
  private readonly cam: TpsCamera;
  private readonly hud: Hud;
  private readonly ghud: GameHud;
  private readonly env: Environment;
  private readonly fx: Effects;
  readonly sound = new Sound();
  private readonly combat: CombatFeedback;
  /** Dev builds only (loaded on demand, absent from public bundles). */
  private autopilot: Autopilot | null = null;
  private readonly timer = new FrameTimer();
  private readonly localAvatar = new Avatar();
  private readonly remotes = new Map<string, RemoteView>();
  private readonly localMotion = new MotionProbe();
  private readonly myPos = new THREE.Vector3();
  private lastSprint = false;
  private hudClock = 0;
  private lagIndex = 0;
  private duckGlb: THREE.Object3D | null = null;
  private showBoard = false;
  private crouchBlend = 0;
  private spectateIndex = 0;
  private lastLife = -1;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

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
    this.fx = new Effects(scene, (x, _y, z) => terrainHeightAt(map.terrain, x, z));

    this.controls = new Controls(canvas);
    this.cam = new TpsCamera(ctx.camera, this.sim);
    this.hud = new Hud(hudEl, config.hud);
    this.ghud = new GameHud(document.getElementById('app') as HTMLElement);
    // The condition is spelled out (not the DEVTOOLS import) so the bundler folds it to a constant here and drops the import from public builds.
    if ((import.meta.env.DEV || import.meta.env.VITE_DEVTOOLS === '1') && config.autopilot) void import('./game/autopilot.ts').then((m) => (this.autopilot = new m.Autopilot(this.sim)));
    this.lagIndex = Math.max(0, LAG_PRESETS.indexOf(config.latencyMs));

    this.combat = new CombatFeedback(session, this.sim, this.fx, this.sound, this.ghud, this.cam, {
      localAvatar: this.localAvatar,
      remoteAvatar: (id) => this.remotes.get(id)?.avatar ?? null,
      myPosition: () => this.myPos,
    });

    this.controls.onAction((a) => {
      const ns = this.session.netsim.settings;
      if (a === 'shoulder') this.cam.swapShoulder();
      if (a === 'hud') this.hud.toggle();
      if (a === 'scoreboard-on') this.showBoard = true;
      if (a === 'scoreboard-off') this.showBoard = false;
      if (!DEVTOOLS && (a === 'lag' || a === 'jitter' || a === 'loss')) return;
      if (a === 'lag') {
        this.lagIndex = (this.lagIndex + 1) % LAG_PRESETS.length;
        ns.latencyMs = LAG_PRESETS[this.lagIndex] ?? 0;
      }
      if (a === 'jitter') ns.jitterMs = ns.jitterMs > 0 ? 0 : 20;
      if (a === 'loss') ns.loss = ns.loss > 0 ? 0 : 0.02;
    });
    canvas.addEventListener('mousedown', () => {
      if (config.spectate) this.spectateIndex++;
    });

    session.start(
      this.sim,
      this.combat.handlers(),
      (id, state, local) => {
        if (local) {
          this.localAvatar.object.visible = true;
          this.controls.yaw = state.spawnYaw;
          return;
        }
        const avatar = new Avatar();
        if (this.duckGlb) avatar.setModel(this.duckGlb);
        scene.add(avatar.object);
        this.remotes.set(id, { state, avatar, motion: new MotionProbe(), lastAct: 0 });
      },
      (id) => {
        this.remotes.get(id)?.avatar.dispose();
        this.remotes.delete(id);
      },
    );

    void (async () => {
      await Promise.all([loadClips(), loadWeaponLibrary()]);
      const all = () => [this.localAvatar, ...[...this.remotes.values()].map((r) => r.avatar)];
      if (hasWeaponArt(0) || hasWeaponArt(1)) for (const a of all()) a.refreshWeapons();
      const glb = config.placeholderDuck ? null : await loadDuckGlb();
      if (!glb) return;
      this.duckGlb = glb;
      for (const a of all()) a.setModel(glb);
    })();

    if (import.meta.env.DEV || import.meta.env.VITE_DEVTOOLS === '1') void import('./game/testHook.ts').then((m) => m.exposeTestHook(this.testView()));
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
    const me = this.session.me;
    let s: { mx: number; mz: number; buttons: number };
    const ap = this.autopilot;
    if (DEVTOOLS && ap && config.autopilot === 'fight' && me) {
      const ducks = [];
      for (const [id, r] of this.remotes) {
        if (!r.state.alive || r.state.protect) continue;
        const p = this.session.pose(id);
        if (p) ducks.push({ id, x: p.x, y: p.y, z: p.z });
      }
      s = ap.fight(me.state as never, this.controls, ducks);
    } else if (DEVTOOLS && ap && config.autopilot === '1') {
      s = ap.circle(this.controls);
    } else {
      s = this.controls.sample();
    }
    this.lastSprint = (s.buttons & Button.Sprint) !== 0 && s.mz > 0 && !(s.buttons & Button.Fire);
    if (this.controls.leftShoulder) s.buttons |= Button.ShoulderLeft;
    return { ...s, yaw: this.controls.yaw, pitch: this.controls.pitch };
  };

  private frame(now: number): void {
    const dt = this.timer.frame(now);
    const session = this.session;
    session.pump(now, this.sampleInput);

    // Local player: predicted pose, interpolated between fixed steps.
    const me = session.me;
    const mine = session.mine;
    if (me && mine) {
      const st = me.state;
      const x = me.value('x');
      const y = me.value('y');
      const z = me.value('z');
      this.myPos.set(x, y, z);
      this.controls.currentSlot = st.weapon;
      // New life: turn the camera to the spawn facing the server chose.
      if (mine.life !== this.lastLife) {
        if (this.lastLife >= 0) {
          this.controls.yaw = mine.spawnYaw;
          this.controls.pitch = -0.1;
        }
        this.lastLife = mine.life;
      }
      const alive = st.alive === 1;
      // The duck faces the camera right away, not one tick later.
      this.localAvatar.update(
        { x, y, z, yaw: this.controls.yaw, pitch: this.controls.pitch, crouch: st.crouch, grounded: st.grounded === 1, alive, weapon: st.weapon, act: st.reload > 0 ? 1 : st.equip > 0 ? 2 : 0 },
        dt,
      );
      this.localMotion.sample(x, z, dt);
      this.crouchBlend += (st.crouch - this.crouchBlend) * (1 - Math.exp(-dt * 16));
      if (alive) {
        this.cam.update(dt, x, y, z, this.crouchBlend, this.controls.yaw, this.controls.pitch, this.lastSprint);
      } else {
        const t = this.combat.diedAt > 0 ? (performance.now() - this.combat.diedAt) / 1000 : 0;
        const killer = this.combat.killerId ? this.remotes.get(this.combat.killerId)?.avatar.object.position ?? null : null;
        this.cam.deathView(dt, this.myPos, killer, t);
      }
      this.env.follow(this.myPos);
    } else if (config.spectate) {
      this.spectate(dt);
    }

    // Other players: interpolated poses.
    for (const [id, r] of this.remotes) {
      const s = r.state;
      const p = session.pose(id);
      r.avatar.object.visible = p !== null;
      if (!p) continue;
      r.avatar.update({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, crouch: p.crouch, grounded: p.grounded, alive: s.alive === 1, weapon: s.weapon, act: s.act }, dt);
      r.motion.sample(p.x, p.z, dt);
      // Their reload, heard in 3D.
      if (s.act === 1 && r.lastAct !== 1) this.sound.reload(weaponStats(s.weapon).reloadTicks / 30, r.avatar.object.position);
      r.lastAct = s.act;
    }

    this.fx.update(dt, this.ctx.camera);
    this.sound.listen(this.ctx.camera);
    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
    this.updateGameHud(dt);

    this.hudClock += dt;
    if (this.hudClock > 0.2) {
      this.hudClock = 0;
      this.renderHud();
    }
  }

  /** Spectator camera: follow a living duck (click to switch). */
  private spectate(dt: number): void {
    const ids = [...this.remotes.keys()].filter((id) => this.remotes.get(id)?.state.alive);
    if (ids.length === 0) return;
    const id = ids[this.spectateIndex % ids.length] as string;
    const p = this.session.pose(id);
    if (!p) return;
    this.myPos.set(p.x, p.y, p.z);
    this.cam.update(dt, p.x, p.y, p.z, p.crouch, p.yaw, p.pitch, false);
    this.env.follow(this.myPos);
  }

  private updateGameHud(dt: number): void {
    const g = this.ghud;
    const st = this.session.room.state;
    const me = this.session.me;
    const mine = this.session.mine;
    g.update(dt, this.controls.yaw);
    if (me && mine) {
      const s = me.state;
      const w = weaponStats(s.weapon);
      g.health(mine.hp, COMBAT.maxHp);
      const mag = s.weapon === 0 ? s.mag0 : s.mag1;
      const res = s.weapon === 0 ? s.res0 : s.res1;
      g.ammoInfo(w.name, mag, res, s.reload > 0 ? 1 - s.reload / w.reloadTicks : 0);
      g.crosshair(inaccuracy(w, s as never, Math.floor(s.spray)), this.ctx.camera.fov, window.innerHeight);
      g.protection(mine.protect === 1);
      g.crosshairVisible(mine.alive === 1);
    }
    let leader = '';
    let leaderKills = -1;
    const rows: ScoreRow[] = [];
    for (const [id, p] of st.players) {
      rows.push({ name: p.name, kills: p.kills, deaths: p.deaths, bot: p.bot, me: id === this.session.sessionId });
      if (p.kills > leaderKills) {
        leaderKills = p.kills;
        leader = p.name;
      }
    }
    g.round(st.timeLeft, mine?.kills ?? 0, st.scoreLimit, leader, Math.max(0, leaderKills));
    const intermission = st.phase === MatchPhase.Intermission;
    g.scoreboard(this.showBoard || intermission ? rows : null);
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    if (intermission) {
      g.message(`<div class="big">Round over</div><div>${st.winner ? `${esc(st.winner)} wins` : 'Time is up'}. Next round in ${st.timeLeft}</div>`);
    } else if (mine && mine.alive === 0) {
      const left = Math.max(0, COMBAT.respawnTicks / 30 - (performance.now() - this.combat.diedAt) / 1000);
      g.message(`<div class="big">Plucked</div><div>${this.combat.killerName ? `by ${esc(this.combat.killerName)}. ` : ''}Back in ${Math.ceil(left)}</div>`);
    } else {
      g.message(null);
    }
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

  /** What the dev-only test hook may read (see game/testHook.ts). */
  private testView() {
    return {
      session: this.session,
      backend: this.ctx.backend,
      timer: this.timer,
      remotes: this.remotes,
      localMotion: this.localMotion,
      combat: this.combat,
    };
  }
}


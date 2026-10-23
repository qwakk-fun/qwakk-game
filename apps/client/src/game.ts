import { t as translate } from './i18n/game.ts';
/**
 * The game loop. Rendering runs at the display refresh rate; the sim runs at a
 * fixed 30 Hz inside the Colyseus prediction stack. Each frame:
 *   1. pump: the prediction stack says how many fixed steps are due, we sample
 *      input and send that many (each is predicted on send, shots included);
 *   2. read interpolated poses (local: predicted, others: 100 to 150 ms behind);
 *   3. animate, place the camera from the latest mouse angles, then render;
 *   4. HUD.
 * Battle royale specifics (plane, drop, loot, zone, spectating, results) live
 * in game/brClient.ts.
 */
import * as THREE from 'three/webgpu';
import { Act, actionOf, aimBlend, Button, COMBAT, exLauncher, exNades, exRockets, hasWeapon, inaccuracy, Mode, SPAWN_PROTECTION, weaponStats } from '@qwakk/shared';
import { GameMode, MatchPhase, type PlayerState } from '@qwakk/shared/net';
import { Sound } from './audio/sound.ts';
import { TpsCamera } from './camera/tpsCamera.ts';
import { config, DEVTOOLS } from './config.ts';
import { Effects } from './fx/effects.ts';
import type { Autopilot } from './game/autopilot.ts';
import { DmClient } from './game/dmClient.ts';
import type { BuffDuck } from './game/dmBuffsView.ts';
import { ExplosivesClient } from './game/explosivesClient.ts';
import { BrClient } from './game/brClient.ts';
import { CombatFeedback } from './game/combatFeedback.ts';
import { FrameTimer, MotionProbe } from './game/metrics.ts';
import { NameTags, type TagDuck } from './game/nameTags.ts';
import { GameHud, type ScoreRow } from './hud/gameHud.ts';
import { TeamPanel, type MateRow } from './hud/teamPanel.ts';
import { Hud } from './hud/hud.ts';
import { ChatPanel } from './hud/chatPanel.ts';
import { Controls } from './input/controls.ts';
import { hasTouch } from './input/touch/device.ts';
import { TouchControls, type TouchFrame, type TouchHooks } from './input/touch/touchControls.ts';
import type { Session } from './net/session.ts';
import { loadClips } from './player/animations.ts';
import { Avatar, type AvatarPose } from './player/avatar.ts';
import { loadDuckGlb } from './player/duckModel.ts';
import { hasWeaponArt, loadWeaponLibrary, magTimeline } from './player/weaponModel.ts';
import type { RenderContext } from './render/renderer.ts';
import type { WorldHandle } from './world/worldHandle.ts';

const LAG_PRESETS = [0, 60, 120, 150, 250];

/** removed: the server took this player out; closed: the room was closed. */
export type ExitReason = 'ended' | 'left' | 'disconnected' | 'removed' | 'closed';

export interface ExitSummary {
  mode: 'br' | 'dm';
  placement?: number;
  players?: number;
  kills?: number;
}

export interface GameOptions {
  mode: 'br' | 'dm';
  settings: { sensitivity: number; adsSensitivity?: number; touchSensitivity?: number; fov: number; volume: number };
  /** The player chose to leave (results screen or the pause card). */
  exit(reason: ExitReason, summary: ExitSummary): void;
  /** Touch screens: the pause button and a switch to the mouse (play.ts shows the pause card). */
  touch?: TouchHooks;
}

interface RemoteView {
  state: PlayerState;
  avatar: Avatar;
  motion: MotionProbe;
  lastAct: number;
}

export class Game {
  private readonly ctx: RenderContext;
  private readonly session: Session;
  private readonly world: WorldHandle;
  private readonly controls: Controls;
  /** Touch controls on devices with a touch screen (shown only while touch play is on). */
  readonly touch: TouchControls | null;
  private readonly touchFrame: TouchFrame = { alive: false, down: false, mode: 0, br: false, spectating: false, promptKey: '', bandages: 0, medkits: 0, armed: false, otherWeapon: '', modal: false, mapOpen: false, canBag: false };
  private readonly cam: TpsCamera;
  private readonly hud: Hud;
  private readonly ghud: GameHud;
  readonly chat: ChatPanel;
  private readonly fx: Effects;
  readonly sound = new Sound();
  private readonly combat: CombatFeedback;
  readonly br: BrClient | null;
  readonly dm: DmClient | null;
  /** Deathmatch grenades, rockets and blasts (null in the battle royale). */
  readonly explosives: ExplosivesClient | null;
  /** Faint names over nearby ducks and the team panel. */
  readonly tags: NameTags;
  private readonly teamPanel: TeamPanel;
  private readonly tagList: TagDuck[] = [];
  private readonly opts: GameOptions;
  /** Dev builds only (loaded on demand, absent from public bundles). */
  private autopilot: Autopilot | null = null;
  private readonly timer = new FrameTimer();
  private readonly localAvatar = new Avatar();
  private readonly remotes = new Map<string, RemoteView>();
  private readonly localMotion = new MotionProbe();
  private readonly myPos = new THREE.Vector3();
  private lastSprint = false;
  /** Look speed multiplier while aiming down sights (settings). */
  private readonly adsSensitivity: number;
  private hudClock = 0;
  private lagIndex = 0;
  /** Loaded duck models by character id, the ones loading, and which character each avatar wears and shows. */
  private readonly models = new Map<number, THREE.Object3D>();
  private readonly loading = new Set<number>();
  private readonly modelRetryAt = new Map<number, number>();
  private readonly wears = new Map<Avatar, number>();
  private readonly shown = new WeakMap<Avatar, number>();
  /** Clips and weapons are in (models load from then on), unless `?duck=placeholder`. */
  private modelsOn = false;
  private showBoard = false;
  /** The explosives drawn were dropped for this intermission (dropped once per round end). */
  private explosivesOver = false;
  private crouchBlend = 0;
  private spectateIndex = 0;
  private lastLife = -1;
  private running = false;
  /** Dev test hook: autopilot paused until then (performance.now ms). */
  holdUntil = 0;
  /** Dev test hook: buttons held down until then (screenshots of aiming and reloads). */
  private forced = 0;
  private forcedMz = 0;
  private forcedUntil = 0;
  private readonly pose: AvatarPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: 0, grounded: true, alive: true, weapon: 0, act: 0, fly: 0, vest: 0, helmet: 0, pack: 0, down: false };

  constructor(ctx: RenderContext, session: Session, world: WorldHandle, canvas: HTMLCanvasElement, hudEl: HTMLElement, opts: GameOptions) {
    this.ctx = ctx;
    this.session = session;
    this.world = world;
    this.opts = opts;
    const sim = world.sim;

    const { scene } = ctx;
    scene.add(this.localAvatar.object);
    this.localAvatar.onMagEvent = (e) => this.sound.magClick(e);
    this.localAvatar.object.visible = false;
    this.fx = new Effects(scene, (x, _y, z) => world.groundAt(x, z));

    this.controls = new Controls(canvas);
    this.controls.sensitivity = opts.settings.sensitivity;
    if (opts.settings.touchSensitivity) this.controls.touchRadPerPx = opts.settings.touchSensitivity;
    this.adsSensitivity = opts.settings.adsSensitivity ?? 0.8;
    this.cam = new TpsCamera(ctx.camera, sim);
    this.cam.setBaseFov(opts.settings.fov);
    this.sound.setVolume(opts.settings.volume);
    this.hud = new Hud(hudEl, config.hud);
    const app = document.getElementById('app') as HTMLElement;
    this.ghud = new GameHud(app);
    this.tags = new NameTags(app, sim);
    this.teamPanel = new TeamPanel(app);
    this.touch = hasTouch() && opts.touch ? new TouchControls(app, this.controls, opts.touch) : null;
    // The condition is spelled out (not the DEVTOOLS import) so the bundler folds it to a constant here and drops the import from public builds.
    if ((import.meta.env.DEV || import.meta.env.VITE_DEVTOOLS === '1') && config.autopilot) void import('./game/autopilot.ts').then((m) => (this.autopilot = new m.Autopilot(sim)));
    this.lagIndex = Math.max(0, LAG_PRESETS.indexOf(config.latencyMs));

    const isBr = session.room.state.mode === GameMode.BattleRoyale;
    this.ghud.setMode(isBr ? 'br' : 'dm');
    this.br = isBr
      ? new BrClient({
          ctx,
          session,
          world,
          controls: this.controls,
          cam: this.cam,
          sound: this.sound,
          ghud: this.ghud,
          remoteAvatar: (id) => this.remotes.get(id)?.avatar ?? null,
          exit: (summary) => opts.exit('ended', summary),
          killerName: () => this.combat?.killerName ?? '',
        })
      : null;

    this.dm = isBr ? null : new DmClient(session, this.sound, this.ghud, scene, sim);

    this.combat = new CombatFeedback(session, sim, this.fx, this.sound, this.ghud, this.cam, {
      localAvatar: this.localAvatar,
      remoteAvatar: (id) => this.remotes.get(id)?.avatar ?? null,
      myPosition: () => this.myPos,
    });
    this.explosives = isBr
      ? null
      : new ExplosivesClient({
          session, sim, scene, effects: this.fx, sound: this.sound, cam: this.cam, controls: this.controls, hudRoot: this.ghud.element,
          groundAt: (x, _y, z) => world.groundAt(x, z),
          views: { localAvatar: this.localAvatar, remoteAvatar: (id) => this.remotes.get(id)?.avatar ?? null, myPosition: () => this.myPos },
        });

    this.chat = new ChatPanel(app, this.controls, (text) => session.sendChat(text), () => {
      if (config.spectate || this.br?.resultOpen) return false;
      this.br?.closeInventory(false);
      if (this.br?.touchState().mapOpen) this.br.toggleMap();
      this.showBoard = false;
      return true;
    });

    this.controls.onAction((a) => {
      const ns = this.session.netsim.settings;
      if (a === 'chat') this.chat.open();
      if (a === 'shoulder') this.cam.swapShoulder();
      if (a === 'hud') this.hud.toggle();
      if (a === 'scoreboard-on') this.showBoard = true;
      if (a === 'scoreboard-off') this.showBoard = false;
      if (a === 'map') this.br?.toggleMap();
      if (a === 'inventory') this.br?.toggleInventory();
      if (a === 'inventory-close') this.br?.closeInventory(false);
      if (a === 'spectate-next') this.br?.spectate(1);
      if (a === 'spectate-prev') this.br?.spectate(-1);
      if (!DEVTOOLS && (a === 'lag' || a === 'jitter' || a === 'loss')) return;
      if (a === 'lag') {
        this.lagIndex = (this.lagIndex + 1) % LAG_PRESETS.length;
        ns.latencyMs = LAG_PRESETS[this.lagIndex] ?? 0;
      }
      if (a === 'jitter') ns.jitterMs = ns.jitterMs > 0 ? 0 : 20;
      if (a === 'loss') ns.loss = ns.loss > 0 ? 0 : 0.02;
    });
    canvas.addEventListener('mousedown', this.onSpectatorClick);

    const handlers = this.combat.handlers();
    session.start(
      sim,
      {
        ...handlers,
        dmKillcam: (replay) => this.dm?.killcam(replay),
        dmReward: (reward) => this.dm?.reward(reward),
        dmPower: (kind) => this.dm?.power(kind),
        dmHero: (event, heroPid, otherPid) => this.dm?.heroEvent(event, heroPid, otherPid),
        dmHeroPing: (heroPid, x, z) => this.dm?.heroPing(heroPid, x, z),
        projectile: (id, kind, owner, at, vel) => this.explosives?.projectile(id, kind, owner, at, vel),
        boom: (id, kind, at) => this.explosives?.boom(id, kind, at),
        dmRocket: (rockets) => this.explosives?.rocketPicked(rockets),
        localExplosive: (kind, state, buttons) => this.explosives?.localExplosive(kind, state, buttons),
        shotHint: (weapon, angle, loud) => {
          this.br?.shotHint(weapon, angle, loud, this.myPos);
          this.explosives?.hint(weapon, angle, loud);
        },
        picked: (kind, amount) => this.br?.picked(kind, amount),
        denied: (reason, kind) => this.br?.denied(reason, kind),
        result: (placement, total, kills, damage, survivedMs, teamSize) => {
          this.chat.close(false);
          this.br?.result(placement, total, kills, damage, survivedMs, teamSize);
        },
        notice: (text) => this.ghud.notice(text),
        chat: (message) => this.chat.receive(message, message.pid === session.mine?.pid),
        chatLimited: () => this.chat.limited(),
      },
      (id, state, local) => {
        if (local) {
          this.localAvatar.object.visible = true;
          this.controls.yaw = state.spawnYaw;
          // The duck the server seated us as (our pick if it is in the catalog).
          this.dress(this.localAvatar, state.character);
          return;
        }
        const avatar = new Avatar();
        avatar.onMagEvent = (e, at) => this.sound.magClick(e, at);
        this.dress(avatar, state.character);
        scene.add(avatar.object);
        this.remotes.set(id, { state, avatar, motion: new MotionProbe(), lastAct: 0 });
      },
      (id) => {
        const r = this.remotes.get(id);
        if (r) {
          r.avatar.dispose();
          this.wears.delete(r.avatar);
        }
        this.remotes.delete(id);
      },
    );
    this.br?.attach();

    void (async () => {
      await Promise.all([loadClips(), loadWeaponLibrary()]);
      const all = () => [this.localAvatar, ...[...this.remotes.values()].map((r) => r.avatar)];
      if (hasWeaponArt(0) || hasWeaponArt(1)) for (const a of all()) a.refreshWeapons();
      if (config.placeholderDuck || !this.running) return;
      // Models load per character, each once, when a duck wearing it is in the match.
      this.modelsOn = true;
      for (const c of new Set(this.wears.values())) this.loadModel(c);
    })();

    if (import.meta.env.DEV || import.meta.env.VITE_DEVTOOLS === '1') void import('./game/testHook.ts').then((m) => m.exposeTestHook(this.testView()));
  }

  /** Put an avatar in its character's model (now if loaded, else once it is). */
  private dress(avatar: Avatar, character: number): void {
    this.wears.set(avatar, character);
    const glb = this.models.get(character);
    if (glb) {
      avatar.setModel(glb);
      this.shown.set(avatar, character);
    } else if (this.modelsOn) this.loadModel(character);
  }

  private loadModel(character: number): void {
    if (this.loading.has(character) || (this.modelRetryAt.get(character) ?? 0) > performance.now()) return;
    this.loading.add(character);
    void loadDuckGlb(character).then((glb) => {
      if (!glb) {
        this.modelRetryAt.set(character, performance.now() + 5000);
        return;
      }
      if (!this.running) return;
      this.models.set(character, glb);
      for (const [avatar, c] of this.wears) {
        if (c !== character || this.shown.get(avatar) === c) continue;
        avatar.setModel(glb);
        this.shown.set(avatar, c);
      }
    }).finally(() => this.loading.delete(character));
  }

  private readonly onSpectatorClick = (): void => {
    if (config.spectate) this.spectateIndex++;
  };

  get controlsRef(): Controls {
    return this.controls;
  }

  start(): void {
    this.running = true;
    void this.ctx.renderer.setAnimationLoop((time: number) => this.frame(time));
  }

  stop(): void {
    this.running = false;
    void this.ctx.renderer.setAnimationLoop(null);
  }

  /** Stop and remove everything this game added (the next game gets a fresh scene). */
  dispose(): void {
    this.stop();
    this.chat.dispose();
    this.touch?.dispose();
    this.controls.dispose();
    this.ctx.renderer.domElement.removeEventListener('mousedown', this.onSpectatorClick);
    this.br?.dispose();
    this.dm?.dispose();
    this.explosives?.dispose();
    this.tags.dispose();
    this.teamPanel.dispose();
    this.ghud.dispose();
    this.hud.dispose();
    for (const r of this.remotes.values()) r.avatar.dispose();
    this.remotes.clear();
    this.localAvatar.dispose();
    this.world.dispose();
    this.sound.close();
  }

  /** Input for one fixed step: keyboard and mouse, or the autopilot. */
  private sampleInput = (): { mx: number; mz: number; buttons: number; yaw: number; pitch: number } => {
    if (this.controls.typing) return { ...this.controls.sample(), yaw: this.controls.yaw, pitch: this.controls.pitch };
    const me = this.session.me;
    let s: { mx: number; mz: number; buttons: number };
    // Dev test hook: hold still facing a point (screenshots).
    const ap = DEVTOOLS && performance.now() < this.holdUntil ? null : this.autopilot;
    if (DEVTOOLS && ap && config.autopilot === 'fight' && me) {
      const ducks = [];
      for (const [id, r] of this.remotes) {
        if (!r.state.alive || r.state.protect) continue;
        const p = this.session.pose(id);
        if (p) ducks.push({ id, x: p.x, y: p.y, z: p.z });
      }
      s = ap.fight(me.state as never, this.controls, ducks);
    } else if (DEVTOOLS && ap && config.autopilot === 'br' && me && this.br) {
      s = ap.br(me.state as never, this.controls, this.br.autopilotView(), config.apTarget);
    } else if (DEVTOOLS && ap && config.autopilot === '1') {
      s = ap.circle(this.controls);
    } else {
      s = this.controls.sample();
    }
    if (DEVTOOLS && performance.now() < this.forcedUntil) {
      s.buttons |= this.forced;
      if (this.forcedMz !== 0) s = { ...s, mz: this.forcedMz };
    }
    this.lastSprint = (s.buttons & Button.Sprint) !== 0 && s.mz > 0 && !(s.buttons & (Button.Fire | Button.Aim));
    if (this.controls.leftShoulder) s.buttons |= Button.ShoulderLeft;
    return { ...s, yaw: this.controls.yaw, pitch: this.controls.pitch };
  };

  private frame(now: number): void {
    const t0 = performance.now();
    const dt = this.timer.frame(now);
    const session = this.session;
    session.pump(now, this.sampleInput);
    // Spawn protection blink: a protected duck (the server's flag, never a guess) is hidden in the off part of each blink.
    const phase = (now / 1000) * SPAWN_PROTECTION.blinkHz;
    const blinkOff = phase - Math.floor(phase) >= SPAWN_PROTECTION.blinkOnShare;

    // Local player: predicted pose, interpolated between fixed steps.
    const me = session.me;
    const mine = session.mine;
    this.dm?.replay.syncLife(mine?.life ?? -1);
    if (me && mine) {
      const st = me.state;
      const x = me.value('x');
      const y = me.value('y');
      const z = me.value('z');
      const alive = st.alive === 1;
      const mode = st.mode;
      if (mode !== Mode.Plane || !alive) this.myPos.set(x, y, z);
      this.controls.currentSlot = st.weapon;
      // New life: turn the camera to the facing the server chose.
      if (mine.life !== this.lastLife) {
        if (this.lastLife >= 0) {
          this.controls.yaw = mine.spawnYaw;
          this.controls.pitch = -0.1;
        }
        this.lastLife = mine.life;
      }
      const p = this.pose;
      p.x = x;
      p.y = y;
      p.z = z;
      // The duck faces the camera right away, not one tick later.
      p.yaw = this.controls.yaw;
      p.pitch = this.controls.pitch;
      p.crouch = st.crouch;
      p.grounded = st.grounded === 1;
      p.alive = alive;
      // Knocked: no gun up, crawling low.
      p.down = st.down === 1;
      // The rocket launcher rides the rifle's place in the hands (Avatar.setLauncher).
      const launcher = exLauncher(st) === 1;
      p.weapon = mine.armed && !p.down ? (launcher ? 0 : st.weapon) : 2;
      this.localAvatar.setLauncher(launcher && !p.down);
      p.act = actionOf(st as never);
      p.fly = mode;
      p.vest = mine.vest;
      p.helmet = mine.helmet;
      p.pack = mine.pack;
      p.aim = this.cam.aimBlend;
      this.localAvatar.object.visible = mode !== Mode.Plane && !(mine.protect === 1 && blinkOff);
      this.localAvatar.update(p, dt);
      this.localMotion.sample(x, z, dt);
      this.crouchBlend += (st.crouch - this.crouchBlend) * (1 - Math.exp(-dt * 16));
      this.controls.spectating = !alive && this.br !== null;
      if (this.br?.placeCamera(dt, this.myPos)) {
        // Plane orbit or spectating: placed by the battle royale view.
      } else if (alive) {
        this.cam.setAirborne(mode === Mode.Freefall || mode === Mode.Glide);
        this.cam.setAim(mode === Mode.Ground && mine.armed ? aimBlend(st as never) : 0, st.weapon);
        this.cam.update(dt, x, y, z, this.crouchBlend, this.controls.yaw, this.controls.pitch, this.lastSprint);
      } else {
        const t = this.combat.diedAt > 0 ? (performance.now() - this.combat.diedAt) / 1000 : 0;
        const killer = this.combat.killerId ? (this.remotes.get(this.combat.killerId)?.avatar.object.position ?? null) : null;
        this.cam.deathView(dt, this.myPos, killer, t);
      }
      this.controls.lookScale = 1 + (this.adsSensitivity - 1) * this.cam.aimBlend;
      this.ghud.aimFocus(alive ? this.cam.aimBlend : 0);
      this.world.follow(this.myPos);
    } else if (config.spectate) {
      this.spectate(dt);
    }

    // Other players: interpolated poses.
    const camPos = this.ctx.camera.position;
    const tags = this.tagList;
    tags.length = 0;
    for (const [id, r] of this.remotes) {
      const s = r.state;
      const p = session.pose(id);
      r.avatar.object.visible = p !== null && !(s.protect === 1 && blinkOff);
      if (!p) {
        r.motion.gap();
        continue;
      }
      const ally = session.isAlly(id);
      const down = p.act === Act.Down;
      tags.push({ id, name: s.name, ally, alive: s.alive === 1, down: ally ? session.mate(id)?.down === 1 || down : down, x: p.x, y: p.y, z: p.z, crouch: p.crouch });
      const a = this.pose;
      a.x = p.x;
      a.y = p.y;
      a.z = p.z;
      a.yaw = p.yaw;
      a.pitch = p.pitch;
      a.crouch = p.crouch;
      a.grounded = p.grounded;
      a.alive = s.alive === 1;
      a.down = down;
      a.weapon = s.armed && !down ? (p.lnch ? 0 : s.weapon) : 2;
      r.avatar.setLauncher(p.lnch === 1 && !down);
      a.act = p.act;
      a.aim = undefined;
      a.fly = p.fly;
      a.vest = s.vest;
      a.helmet = s.helmet;
      a.pack = s.pack;
      r.avatar.update(a, dt);
      r.avatar.setDetail(camPos.distanceTo(r.avatar.object.position));
      r.motion.sample(p.x, p.z, dt);
      // Their reload, heard in 3D (with the art's timeline the avatar's magazine events click instead).
      if (p.act === 1 && r.lastAct !== 1 && !magTimeline(s.weapon)) this.sound.reload(weaponStats(s.weapon).reloadTicks / 30, r.avatar.object.position);
      r.lastAct = p.act;
    }

    this.dm?.frame(now);
    if (this.dm) this.dm.buffs(dt, this.buffDucks(), this.ctx.camera);
    this.explosives?.frame(dt, now);
    this.tags.update(this.ctx.camera, this.dm?.replay.active ? [] : tags, this.myPos);
    this.br?.frame(dt, this.myPos);
    const replaying = this.dm?.replay.active ? this.dm.replay.draw(now, this.ctx.camera, [[session.sessionId, this.localAvatar], ...[...this.remotes].map(([id, r]): [string, Avatar] => [id, r.avatar])], dt) : false;
    this.world.update(this.ctx.camera, dt);
    this.fx.update(dt, this.ctx.camera);
    this.sound.listen(this.ctx.camera);
    const restoreEffects = replaying ? this.fx.hideForReplay() : null;
    const restoreExplosives = replaying ? (this.explosives?.hideForReplay() ?? null) : null;
    this.ctx.renderer.render(this.ctx.scene, this.ctx.camera);
    restoreEffects?.();
    restoreExplosives?.();
    this.dm?.replay.restoreCamera();
    this.updateGameHud(dt);

    this.hudClock += dt;
    if (this.hudClock > 0.2) {
      this.hudClock = 0;
      if (this.modelsOn) for (const c of new Set(this.wears.values())) if (!this.models.has(c)) this.loadModel(c);
      this.renderHud();
    }
    this.timer.cpuSample(performance.now() - t0);
  }

  private readonly buffList: BuffDuck[] = [];

  /** Ducks for the deathmatch aura and cape (each rides its avatar, hidden with it). */
  private buffDucks(): BuffDuck[] {
    const list = this.buffList;
    list.length = 0;
    const me = this.session.me;
    const mine = this.session.mine;
    if (me && mine) list.push({ id: this.session.sessionId, avatar: this.localAvatar, state: mine, grounded: me.state.grounded === 1, local: true });
    const st = this.session.room.state;
    for (const [id, r] of this.remotes) {
      // The pose entry's flag (session.pose() interpolates and keeps blend state: called once per frame above).
      const near = st.poses.get(id);
      const pose = near && !(near.x === 0 && near.y === 0 && near.z === 0) ? near : st.farPoses.get(id);
      list.push({ id, avatar: r.avatar, state: r.state, grounded: (pose?.grounded ?? 1) === 1, local: false });
    }
    return list;
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
    this.world.follow(this.myPos);
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
      g.health(s.hp, this.dm?.maxHp(mine) ?? COMBAT.maxHp);
      const armed = mine.armed === 1;
      const mag = s.weapon === 0 ? s.mag0 : s.mag1;
      const res = s.weapon === 0 ? s.res0 : s.res1;
      if (exLauncher(s)) g.ammoInfo(translate('Rocket launcher'), exRockets(s), 0, 0);
      else if (armed) g.ammoInfo(translate(w.name), mag, res, s.reload > 0 ? 1 - s.reload / w.reloadTicks : 0);
      else g.ammoInfo('Unarmed', 0, 0, 0);
      g.crosshair(inaccuracy(w, s as never, Math.floor(s.spray)), this.ctx.camera.fov, window.innerHeight);
      g.protection(mine.protect === 1);
      g.crosshairVisible(mine.alive === 1 && s.mode === Mode.Ground && s.down === 0);
      g.knocked(s.down === 1 && mine.alive === 1);
    }
    this.teamPanel.update(this.mateRows());
    this.updateTouch();
    if (this.br) {
      this.br.hud(dt, this.showBoard);
      return;
    }
    let leader = '';
    let leaderKills = -1;
    const rows: ScoreRow[] = [];
    for (const [id, p] of st.players) {
      rows.push({ name: p.name, kills: p.kills, deaths: p.deaths, bot: p.bot, me: id === this.session.sessionId, points: p.dmPoints });
      if (p.kills > leaderKills) {
        leaderKills = p.kills;
        leader = p.name;
      }
    }
    g.round(st.timeLeft, mine?.kills ?? 0, st.scoreLimit, leader, Math.max(0, leaderKills));
    const intermission = st.phase === MatchPhase.Intermission;
    if (intermission && !this.explosivesOver) this.explosives?.roundOver();
    this.explosivesOver = intermission;
    g.scoreboard(this.showBoard ? rows : null);
    this.dm?.hudFrame(this.controls.yaw);
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    if (intermission && this.dm) {
      g.message(null);
    } else if (intermission) {
      g.message(`<div class="big">${translate('Round over')}</div><div>${st.winner ? translate('{name} wins', { name: esc(st.winner) }) : translate('Time is up')}. ${translate('Next round in {n}', { n: st.timeLeft })}</div>`);
    } else if (mine && mine.alive === 0) {
      const left = Math.max(0, COMBAT.respawnTicks / 30 - (performance.now() - this.combat.diedAt) / 1000);
      g.message(`<div class="big">${translate('Plucked')}</div><div>${this.combat.killerName ? translate('by {name}. ', { name: esc(this.combat.killerName) }) : ''}${translate('Back in {n}', { n: Math.ceil(left) })}</div>`);
    } else {
      g.message(null);
    }
  }

  /** The touch layer's buttons for this frame (which show, heal counts, the other weapon). */
  private updateTouch(): void {
    const touch = this.touch;
    if (!touch?.active) return;
    const f = this.touchFrame;
    const me = this.session.me;
    const mine = this.session.mine;
    const s = me?.state;
    f.alive = !!s && mine?.alive === 1;
    f.down = s?.down === 1;
    f.mode = s?.mode ?? Mode.Ground;
    f.br = this.br !== null;
    f.armed = mine?.armed === 1;
    const other = s && s.weapon === 0 ? 1 : 0;
    f.otherWeapon = s && mine?.armed === 1 && hasWeapon(s as never, other) ? translate(weaponStats(other).name) : '';
    f.nades = s ? exNades(s) : 0;
    f.rockets = s ? exRockets(s) : 0;
    f.rocketOut = s ? exLauncher(s) === 1 : false;
    if (this.br) Object.assign(f, this.br.touchState());
    else {
      f.promptKey = '';
      f.bandages = 0;
      f.medkits = 0;
      f.modal = this.session.room.state.phase === MatchPhase.Intermission || (this.dm?.replay.active ?? false);
      f.mapOpen = false;
      f.canBag = false;
      f.spectating = false;
    }
    f.modal ||= this.chat.isOpen;
    touch.update(f);
  }

  /** Teammates for the team panel (the server sends only our own team's entries). */
  private mateRows(): MateRow[] {
    const st = this.session.room.state;
    const rows: MateRow[] = [];
    for (const [id, m] of st.mates) {
      if (id === this.session.sessionId) continue;
      const p = st.players.get(id);
      if (!p) continue;
      rows.push({ name: p.name, hp: m.hp, alive: m.alive === 1, down: m.down === 1, revive: m.rev / 255 });
    }
    return rows;
  }

  private renderHud(): void {
    const s = this.session;
    const me = s.me;
    const ns = s.netsim.settings;
    const net = s.netsim.active ? `${ns.latencyMs} ms rtt, +/-${ns.jitterMs / 2} ms, ${(ns.loss * 100).toFixed(0)}% loss` : 'off';
    const info = this.ctx.renderer.info.render as unknown as { drawCalls?: number; calls?: number; triangles?: number };
    this.hud.render({
      fps: this.timer.fps,
      frameMsAvg: this.timer.avg,
      frameMsMax: this.timer.max,
      pingMs: s.pingMs,
      jitterMs: s.room.clock.jitter(),
      serverTick: s.room.state.tick,
      players: s.room.state.players.size,
      backend: `${this.ctx.backend}  calls ${info.drawCalls ?? info.calls ?? 0}  tris ${Math.round((info.triangles ?? 0) / 1000)}k`,
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
      br: this.br,
      renderer: this.ctx.renderer,
      world: this.world,
      controls: this.controls,
      localAvatar: this.localAvatar,
      hold: (ms: number) => (this.holdUntil = performance.now() + ms),
      press: (buttons: number, ms: number, mz = 0) => {
        this.forced = buttons;
        this.forcedMz = mz;
        this.forcedUntil = performance.now() + ms;
      },
      camera: this.cam,
      tags: this.tags,
      explosives: this.explosives,
    };
  }
}

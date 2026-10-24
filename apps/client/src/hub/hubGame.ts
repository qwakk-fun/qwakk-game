/**
 * Duck Plaza's loop: the same frame recipe as a match (game.ts), without
 * any combat. Each frame: pump the prediction stack (inputs out, own duck
 * predicted), draw the own duck and the camera, the other ducks at their
 * interpolated poses (dancing, quacking), the labels and bubbles, the
 * portal swirls, the sounds, then render.
 *
 * Clicking a duck (the crosshair dot while the mouse is locked, the cursor
 * when it is free, a tap on touch) opens its little bubble. Q quacks, B
 * dances, T chats, Esc opens the menu sheet (the menu owns it).
 */
import * as THREE from 'three/webgpu';
import { Button, NET, type SimWorld } from '@qwakk/shared';
import type { ChatMessage } from '@qwakk/shared/net';
import { ACCOUNT_PORTALS, HUB, HubEmote, HubNote, PORTALS, shopAt, type HubMapData, type PortalId, type ShopId } from '@qwakk/shared/hub';
import type { HubDuck } from '@qwakk/shared/hub/schema';
import { TpsCamera } from '../camera/tpsCamera.ts';
import { config } from '../config.ts';
import { ChatPanel } from '../hud/chatPanel.ts';
import { Controls } from '../input/controls.ts';
import { hasTouch, isTouchOnly } from '../input/touch/device.ts';
import { TouchControls, type TouchFrame } from '../input/touch/touchControls.ts';
import { FrameTimer } from '../game/metrics.ts';
import { loadClips } from '../player/animations.ts';
import { Avatar, type AvatarPose } from '../player/avatar.ts';
import { loadDuckGlb } from '../player/duckModel.ts';
import type { RenderContext } from '../render/renderer.ts';
import { COPY } from '../ui/menu/copy.ts';
import { fetchLeaderboard } from '../ui/menu/api.ts';
import type { WorldHandle } from '../world/worldHandle.ts';
import { HubAudio } from './hubAudio.ts';
import { HubDecor } from './decor.ts';
import { HubLabels, type LabelDuck } from './labels.ts';
import type { HubSession } from './hubSession.ts';
import { HubUi, type DuckTarget } from './hubUi.ts';

/** The camera arm in the plaza (a match uses 3.1 m): a little more of the square in view. */
const HUB_ARM = 4.2;

export interface TeamMember {
  name: string;
  tag: string;
  leader: boolean;
  you: boolean;
  busy: boolean;
}

export interface HubGameHooks {
  /** The server said this duck walked into a portal it may take. */
  portal(id: PortalId): void;
  /** Join this party (an accepted invite). */
  party(code: string): void;
  leaveTeam(): void;
  signIn(): void;
  /** Open the menu sheet (Esc, the touch pause button). */
  pause(): void;
  /** Open a market stall's shop (signed-in ducks; E or a tap at the stall). */
  shop?(id: ShopId): void;
}

export interface HubGameOptions {
  settings: { sensitivity: number; touchSensitivity?: number; fov: number; volume: number };
  hub: HubMapData;
  pond: { x: number; z: number; rx: number; rz: number; water: number } | null;
  fountain: { x: number; y: number; z: number } | null;
  /** Signed in: every portal opens (guests: Deathmatch only). */
  account: boolean;
  hooks: HubGameHooks;
}

interface Remote {
  duck: HubDuck;
  avatar: Avatar;
  quackAt: number;
  x: number;
  y: number;
  z: number;
  crouch: number;
  emote: number;
  seen: boolean;
}

const _v = new THREE.Vector3();

export class HubGame {
  readonly controls: Controls;
  readonly touch: TouchControls | null;
  readonly chat: ChatPanel;
  readonly ui: HubUi;
  readonly audio = new HubAudio();
  readonly labels: HubLabels;
  readonly decor: HubDecor;
  readonly timer = new FrameTimer();
  readonly ctx: RenderContext;
  readonly session: HubSession;
  private readonly world: WorldHandle;
  readonly sim: SimWorld;
  private readonly cam: TpsCamera;
  private readonly opts: HubGameOptions;
  private readonly local = new Avatar();
  readonly remotes = new Map<string, Remote>();
  private readonly models = new Map<number, THREE.Object3D>();
  private readonly loading = new Set<number>();
  private readonly wears = new Map<Avatar, number>();
  private modelsOn = false;
  readonly myPos = new THREE.Vector3();
  private crouchBlend = 0;
  private running = false;
  private paused = false;
  /** The cursor was freed for a bubble (not Esc): no menu sheet then. */
  private freeing = false;
  /** Walked into a portal: no more input, the menu takes over. */
  leaving = false;
  /** The duck pointed at (crosshair or cursor), by session id. */
  private hot: string | null = null;
  private mouse = { x: -1, y: -1 };
  private team: TeamMember[] = [];
  private danceUntil = 0;
  private hintUntil = 0;
  private boardAt = 0;
  private lastSprint = false;
  private lastUse = false;
  private readonly pose: AvatarPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, crouch: 0, grounded: true, alive: true, weapon: 2, act: 0, fly: 0 };
  private readonly labelList: LabelDuck[] = [];
  private readonly abort = new AbortController();
  /** Dev test hook: walk toward a point (screenshots and the e2e), or hold still. */
  autoWalk: { x: number; z: number; until: number; best?: number; stuck?: number; side?: number } | null = null;
  /** Dev test hook: turn toward this view (a little per step, like a mouse would). */
  turnTo: { yaw: number; pitch: number } | null = null;

  /** Turn the view toward a yaw by at most `max` radians (dev helpers stay under the server's turn-rate cap). */
  private turn(yaw: number, max = 0.6): void {
    let d = yaw - this.controls.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.controls.yaw += Math.max(-max, Math.min(max, d));
  }

  constructor(ctx: RenderContext, session: HubSession, world: WorldHandle, canvas: HTMLCanvasElement, opts: HubGameOptions) {
    this.ctx = ctx;
    this.session = session;
    this.world = world;
    this.sim = world.sim;
    this.opts = opts;
    // Plaza ducks move faster (HUB.moveScale): the walk, run and sprint gaits follow.
    this.local.locoScale = HUB.moveScale;
    const app = document.getElementById('app') as HTMLElement;
    ctx.scene.add(this.local.object);
    this.local.object.visible = false;
    this.controls = new Controls(canvas);
    this.controls.sensitivity = opts.settings.sensitivity;
    if (opts.settings.touchSensitivity) this.controls.touchRadPerPx = opts.settings.touchSensitivity;
    this.cam = new TpsCamera(ctx.camera, this.sim);
    this.cam.setBaseFov(opts.settings.fov);
    this.cam.setArmLength(HUB_ARM);
    this.audio.setVolume(opts.settings.volume);
    this.labels = new HubLabels(app, this.sim);
    this.decor = new HubDecor(ctx.scene, opts.hub, opts.pond);
    if (!opts.account) this.decor.setLocked(ACCOUNT_PORTALS);
    for (const p of opts.hub.portals) this.audio.addSpot(new THREE.Vector3(p.x, p.y + 2.5, p.z), 'portal', p.id === 'dm' ? 1 : p.id === 'br' ? 1.12 : 0.9);
    if (opts.fountain) this.audio.addSpot(new THREE.Vector3(opts.fountain.x, opts.fountain.y + 1.2, opts.fountain.z), 'fountain');
    this.ui = new HubUi(app, {
      invite: (t) => session.invite(t.pid),
      quack: () => this.emote(HubEmote.Quack),
      dance: () => this.emote(HubEmote.Dance),
      leaveTeam: () => opts.hooks.leaveTeam(),
      answer: (accept) => this.answer(accept),
      freeCursor: () => {
        if (!document.pointerLockElement) return;
        this.freeing = true;
        document.exitPointerLock();
      },
      shop: (id) => this.openShop(id),
    });
    this.touch = hasTouch()
      ? new TouchControls(app, this.controls, {
          pause: () => opts.hooks.pause(),
          mouse: () => {
            if (isTouchOnly()) return;
            this.touch?.setActive(false);
            this.ui.setTouch(false);
            this.controls.requestLock();
          },
          tap: (x, y) => this.pickAndOpen(x, y),
        })
      : null;
    this.chat = new ChatPanel(app, this.controls, (text) => session.sendChat(text), () => !this.paused && !this.leaving);
    this.controls.onAction((a) => {
      if (a === 'chat' && !this.paused) this.chat.open();
      if (a === 'shoulder') this.cam.swapShoulder();
    });
    this.wireInput(canvas);
    this.hintUntil = performance.now() + 14000;

    session.start(
      this.sim,
      {
        chat: (m) => this.onChat(m),
        chatLimited: () => this.chat.limited(),
        note: (k, pid, portal) => this.onNote(k, pid, portal),
        invited: (pid, name, tag) => {
          this.audio.pop(true);
          this.ui.showInvite(pid, name, tag, this.touch?.active ?? false, HUB.invite.ttlMs);
        },
        party: (code) => opts.hooks.party(code),
        quack: (pid) => this.onQuack(pid),
        portal: (index) => this.onPortal(index),
        notice: (text) => this.ui.toast(text),
      },
      (id, duck, local) => {
        if (local) {
          this.local.object.visible = true;
          this.controls.yaw = duck.yaw;
          this.controls.pitch = -0.12;
          this.dress(this.local, duck.character);
          return;
        }
        const avatar = new Avatar();
        avatar.locoScale = HUB.moveScale;
        this.dress(avatar, duck.character);
        ctx.scene.add(avatar.object);
        avatar.object.visible = false;
        this.remotes.set(id, { duck, avatar, quackAt: 0, x: 0, y: 0, z: 0, crouch: 0, emote: 0, seen: false });
      },
      (id) => {
        const r = this.remotes.get(id);
        if (r) {
          r.avatar.dispose();
          this.wears.delete(r.avatar);
        }
        this.remotes.delete(id);
        if (this.ui.target?.id === id) this.ui.closeDuck();
      },
    );
    void loadClips().then(() => {
      if (config.placeholderDuck || !this.running) return;
      this.modelsOn = true;
      for (const c of new Set(this.wears.values())) this.loadModel(c);
    });
    void this.loadBoard();
    void document.fonts?.ready.then(() => this.running && this.decor.redrawSigns());
    if (import.meta.env.DEV || import.meta.env.VITE_DEVTOOLS === '1') void import('./hubTestHook.ts').then((m) => m.exposeHubTestHook(this));
  }

  // ---- models ------------------------------------------------------------------

  private dress(avatar: Avatar, character: number): void {
    this.wears.set(avatar, character);
    const glb = this.models.get(character);
    if (glb) avatar.setModel(glb);
    else if (this.modelsOn) this.loadModel(character);
  }

  private loadModel(character: number): void {
    if (this.loading.has(character) || this.models.has(character)) return;
    this.loading.add(character);
    void loadDuckGlb(character)
      .then((glb) => {
        if (!glb || !this.running) return;
        this.models.set(character, glb);
        for (const [avatar, c] of this.wears) if (c === character) avatar.setModel(glb);
      })
      .finally(() => this.loading.delete(character));
  }

  private async loadBoard(): Promise<void> {
    this.boardAt = performance.now();
    try {
      const data = await fetchLeaderboard('all', 'score');
      if (!this.disposed) this.decor.setBoard(data);
    } catch {
      if (!this.disposed) this.decor.setBoard(null, true);
    }
  }

  // ---- input -------------------------------------------------------------------

  private wireInput(canvas: HTMLCanvasElement): void {
    const opts = { signal: this.abort.signal };
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || this.paused || this.leaving) return;
      this.audio.unlock();
      if (this.controls.locked) {
        const id = this.pick(window.innerWidth / 2, window.innerHeight / 2);
        if (id) this.openBubble(id);
        return;
      }
      if (this.touch?.active) return;
      const id = this.pick(e.clientX, e.clientY);
      if (id) {
        this.openBubble(id);
        return;
      }
      this.ui.closeDuck();
      this.controls.requestLock();
    }, opts);
    canvas.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    }, opts);
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (locked) {
        this.freeing = false;
        this.ui.closeDuck();
        return;
      }
      if (this.freeing || this.chat.isOpen || this.paused || this.leaving || this.touch?.active) {
        this.freeing = false;
        return;
      }
      // Esc: the menu sheet.
      this.opts.hooks.pause();
    }, opts);
    window.addEventListener('keydown', (e) => {
      if (this.paused || this.leaving || this.controls.typing || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (e.code === 'KeyQ') this.emote(HubEmote.Quack);
      else if (e.code === 'KeyB') this.emote(HubEmote.Dance);
      else if (e.code === 'KeyE' && this.ui.shopOpen) this.openShop(this.ui.shopOpen);
      else if (e.code === 'KeyY' && this.ui.invite) this.answer(true);
      else if (e.code === 'KeyN' && this.ui.invite) this.answer(false);
      else if (e.code === 'Escape' && !this.controls.locked) {
        if (this.ui.duckOpen) this.ui.closeDuck();
        else this.opts.hooks.pause();
      }
    }, opts);
  }

  /** The duck nearest to a screen point (CSS px), within reach, or null. Your own duck counts. */
  pick(sx: number, sy: number): string | null {
    const cam = this.ctx.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    let best: string | null = null;
    let bestScore = Infinity;
    const test = (id: string, x: number, y: number, z: number) => {
      const dist = Math.hypot(x - this.myPos.x, z - this.myPos.z);
      if (dist > HUB.pickRange) return;
      _v.set(x, y + 0.95, z).project(cam);
      if (_v.z > 1 || _v.z < -1) return;
      const px = (_v.x * 0.5 + 0.5) * w;
      const py = (-_v.y * 0.5 + 0.5) * h;
      const camDist = cam.position.distanceTo(_v.set(x, y + 0.95, z));
      const radius = Math.max(26, Math.min(110, 340 / Math.max(1, camDist)));
      const d = Math.hypot(px - sx, py - sy) / radius;
      if (d < 1 && d < bestScore) {
        bestScore = d;
        best = id;
      }
    };
    for (const [id, r] of this.remotes) if (r.seen) test(id, r.x, r.y, r.z);
    test(this.session.sessionId, this.myPos.x, this.myPos.y, this.myPos.z);
    return best;
  }

  private pickAndOpen(x: number, y: number): void {
    if (this.paused || this.leaving) return;
    const id = this.pick(x, y);
    if (id) this.openBubble(id);
    else this.ui.closeDuck();
  }

  private targetOf(id: string): DuckTarget | null {
    const self = id === this.session.sessionId;
    const d = self ? this.session.mine : this.remotes.get(id)?.duck;
    if (!d) return null;
    const myTeam = this.session.mine?.team ?? 0;
    return { id, pid: d.pid, name: d.name, tag: d.tag, level: d.level, self, teammate: !self && myTeam > 0 && d.team === myTeam };
  }

  openBubble(id: string): void {
    const t = this.targetOf(id);
    if (!t) return;
    this.audio.pop();
    const inTeam = this.team.length > 1;
    this.ui.openDuck(t, inTeam, this.team.length >= 4);
  }

  /** At a stall: the menu opens its shop (the plaza pauses like for the sheet). Guests only see a sign-in note. */
  openShop(id: ShopId): void {
    if (this.paused || this.leaving) return;
    this.audio.pop();
    if (!this.opts.account) {
      this.ui.toast(COPY.duck.shop.needsAccount, { label: COPY.hub.signInAction, run: () => this.opts.hooks.signIn() });
      return;
    }
    this.opts.hooks.shop?.(id);
  }

  private emote(kind: number): void {
    if (this.leaving) return;
    this.audio.unlock();
    this.session.emote(kind);
    if (kind === HubEmote.Dance) this.danceUntil = this.danceUntil > performance.now() ? 0 : performance.now() + HUB.emote.danceMs;
  }

  private answer(accept: boolean): void {
    const inv = this.ui.invite;
    if (!inv) return;
    this.session.answer(inv.pid, accept);
    this.ui.clearInvite();
    if (!accept) this.ui.toast(COPY.hub.notes.youDeclined(inv.name));
  }

  // ---- server messages -------------------------------------------------------------

  private nameOf(pid: number): string {
    const id = this.session.idOfPid(pid);
    const d = id ? this.session.room.state.ducks.get(id) : undefined;
    return d?.name ?? '';
  }

  private onChat(m: ChatMessage): void {
    const id = this.session.idOfPid(m.pid);
    this.chat.receive(m, m.pid === this.session.mine?.pid);
    if (id) this.labels.say(id, m.text);
  }

  private onQuack(pid: number): void {
    const id = this.session.idOfPid(pid);
    if (!id) return;
    if (id === this.session.sessionId) {
      this.local.quack();
      this.audio.quack();
      return;
    }
    const r = this.remotes.get(id);
    if (!r) return;
    r.avatar.quack();
    r.quackAt = performance.now();
    this.audio.quack(_v.set(r.x, r.y + 1.2, r.z));
  }

  private onNote(kind: number, pid: number, portal: number): void {
    const N = COPY.hub.notes;
    const name = this.nameOf(pid);
    const id = PORTALS[portal] ?? 'dm';
    switch (kind) {
      case HubNote.InviteSent: return this.ui.toast(N.sent(name));
      case HubNote.Declined: return this.ui.toast(N.declined(name));
      case HubNote.Expired: return this.ui.toast(N.expired);
      case HubNote.TeamFull: return this.ui.toast(N.teamFull);
      case HubNote.Busy: return this.ui.toast(N.busy(name));
      case HubNote.Limited: return this.ui.toast(N.limited);
      case HubNote.Teammates: return this.ui.toast(N.teammates(name));
      case HubNote.Locked: return this.ui.toast(N.locked(COPY.hub.portals[id].name), { label: COPY.hub.signInAction, run: () => this.opts.hooks.signIn() });
      case HubNote.LeaderPicks: return this.ui.toast(N.leaderPicks);
      case HubNote.PartyGuest: return this.ui.toast(N.partyGuest);
      case HubNote.Joined: return this.ui.toast(N.joined(name));
      case HubNote.Failed: return this.ui.toast(N.failed);
      case HubNote.TooFar: return this.ui.toast(N.tooFar(name));
    }
  }

  private onPortal(index: number): void {
    const id = PORTALS[index];
    if (!id || this.leaving) return;
    this.leaving = true;
    this.ui.closeDuck();
    this.chat.close(false);
    this.audio.whoosh();
    const color = id === 'dm' ? '#ff8a3d' : id === 'br' ? '#ffd43b' : '#7be08a';
    this.ui.warp(COPY.hub.entering(COPY.hub.portals[id].name), color);
    this.opts.hooks.portal(id);
  }

  // ---- team and pause (from the menu) -------------------------------------------------

  setTeam(members: TeamMember[]): void {
    this.team = members;
    this.ui.setTeam(members);
  }

  /** New settings from the menu sheet: mouse and touch look speed, field of view, volume. */
  applySettings(s: { sensitivity: number; touchSensitivity?: number; fov: number; volume: number }): void {
    this.controls.sensitivity = s.sensitivity;
    if (s.touchSensitivity) this.controls.touchRadPerPx = s.touchSensitivity;
    this.cam.setBaseFov(s.fov);
    this.audio.setVolume(s.volume);
  }

  /** The menu sheet opened (or closed). */
  setPaused(on: boolean): void {
    this.paused = on;
    if (on) {
      this.ui.closeDuck();
      this.chat.close(false);
      if (document.pointerLockElement) {
        this.freeing = true;
        document.exitPointerLock();
      }
      this.touch?.setActive(false, true);
    }
  }

  /** Back from the sheet (called from a click or tap, so the lock may be taken). */
  resume(touch: boolean): void {
    this.paused = false;
    this.audio.unlock();
    if (touch && this.touch) {
      this.touch.setActive(true);
      this.ui.setTouch(true);
      return;
    }
    this.controls.requestLock();
  }

  // ---- the loop -------------------------------------------------------------------

  start(): void {
    this.running = true;
    void this.ctx.renderer.setAnimationLoop((t: number) => this.frame(t));
  }

  private disposed = false;

  private sample = (): { mx: number; mz: number; buttons: number; yaw: number; pitch: number } => {
    if (this.leaving || this.paused) return { mx: 0, mz: 0, buttons: 0, yaw: this.controls.yaw, pitch: this.controls.pitch };
    const s = this.controls.sample();
    const tt = this.turnTo;
    if (tt && (import.meta.env.DEV || import.meta.env.VITE_DEVTOOLS === '1')) {
      this.turn(tt.yaw);
      this.controls.pitch = tt.pitch;
      if (Math.abs(Math.atan2(Math.sin(tt.yaw - this.controls.yaw), Math.cos(tt.yaw - this.controls.yaw))) < 1e-4) this.turnTo = null;
    }
    const aw = this.autoWalk;
    if (aw && (import.meta.env.DEV || import.meta.env.VITE_DEVTOOLS === '1')) {
      if (performance.now() > aw.until) this.autoWalk = null;
      else {
        const dx = aw.x - this.myPos.x;
        const dz = aw.z - this.myPos.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.4) return { mx: 0, mz: 0, buttons: 0, yaw: this.controls.yaw, pitch: this.controls.pitch };
        this.turn(Math.atan2(-dx, -dz));
        // Stuck on a lamp or a bench: side-step and hop for a moment, then head on.
        if (d < (aw.best ?? Infinity) - 0.05) {
          aw.best = d;
          aw.stuck = 0;
        } else aw.stuck = (aw.stuck ?? 0) + 1;
        if ((aw.stuck ?? 0) > 12) {
          aw.side = aw.side ?? 18;
          if (--aw.side <= 0) {
            aw.side = undefined;
            aw.stuck = 0;
            aw.best = d;
          }
          return { mx: 1, mz: 0.4, buttons: Button.Jump, yaw: this.controls.yaw, pitch: this.controls.pitch };
        }
        return { mx: 0, mz: 1, buttons: Button.Sprint, yaw: this.controls.yaw, pitch: this.controls.pitch };
      }
    }
    this.lastSprint = (s.buttons & Button.Sprint) !== 0 && s.mz > 0;
    // At a gear stall: Use (the touch Use button; E on a keyboard opens it on keydown) opens its shop.
    const use = (s.buttons & Button.Use) !== 0;
    if (use && !this.lastUse && this.ui.shopOpen) this.openShop(this.ui.shopOpen);
    this.lastUse = use;
    return { ...s, yaw: this.controls.yaw, pitch: this.controls.pitch };
  };

  private frame(now: number): void {
    const t0 = performance.now();
    const dt = this.timer.frame(now);
    const session = this.session;
    session.pump(now, this.sample);
    const me = session.me;
    const camera = this.ctx.camera;
    if (me) {
      const st = me.state;
      const x = me.value('x');
      const y = me.value('y');
      const z = me.value('z');
      this.myPos.set(x, y, z);
      const p = this.pose;
      p.x = x;
      p.y = y;
      p.z = z;
      p.yaw = this.controls.yaw;
      p.pitch = this.controls.pitch * 0.4;
      p.crouch = st.crouch;
      p.grounded = st.grounded === 1;
      if (this.danceUntil > 0 && (now > this.danceUntil || Math.hypot(st.vx, st.vz) > HUB.emote.danceStopSpeed)) this.danceUntil = 0;
      this.local.update(p, dt);
      if (this.danceUntil > 0) this.dance(this.local, now, 0);
      this.crouchBlend += (st.crouch - this.crouchBlend) * (1 - Math.exp(-dt * 16));
      this.cam.update(dt, x, y, z, this.crouchBlend, this.controls.yaw, this.controls.pitch, this.lastSprint);
      this.world.follow(this.myPos);
    }

    const labels = this.labelList;
    labels.length = 0;
    const myTeam = session.mine?.team ?? 0;
    const rings: { id: string; x: number; y: number; z: number; kind: 'mate' | 'hot' }[] = [];
    for (const [id, r] of this.remotes) {
      const p = session.pose(id);
      r.seen = p !== null;
      r.avatar.object.visible = p !== null;
      if (!p) continue;
      r.x = p.x;
      r.y = p.y;
      r.z = p.z;
      r.crouch = p.crouch;
      r.emote = p.emote;
      const a = this.pose;
      a.x = p.x;
      a.y = p.y;
      a.z = p.z;
      a.yaw = p.yaw;
      a.pitch = p.pitch * 0.4;
      a.crouch = p.crouch;
      a.grounded = p.grounded;
      r.avatar.update(a, dt);
      if (p.emote === HubEmote.Dance) this.dance(r.avatar, now, r.duck.pid);
      r.avatar.setDetail(camera.position.distanceTo(r.avatar.object.position));
      const mate = myTeam > 0 && r.duck.team === myTeam;
      if (mate) rings.push({ id, x: p.x, y: p.y, z: p.z, kind: 'mate' });
      labels.push({ id, name: r.duck.name, tag: r.duck.tag, level: r.duck.level, x: p.x, y: p.y, z: p.z, crouch: p.crouch, self: false, teammate: mate, hot: this.hot === id });
    }
    const mine = session.mine;
    if (mine && me) labels.push({ id: session.sessionId, name: mine.name, tag: mine.tag, level: mine.level, x: this.myPos.x, y: this.myPos.y, z: this.myPos.z, crouch: me.state.crouch, self: true, teammate: false, hot: false });

    // The duck pointed at: the crosshair dot while locked, the cursor when free (desktop).
    const locked = this.controls.locked;
    const pointing = locked ? this.pick(window.innerWidth / 2, window.innerHeight / 2) : !this.touch?.active && this.mouse.x >= 0 ? this.pick(this.mouse.x, this.mouse.y) : null;
    this.hot = pointing && pointing !== session.sessionId ? pointing : null;
    const hotR = this.hot ? this.remotes.get(this.hot) : null;
    if (hotR) rings.push({ id: this.hot as string, x: hotR.x, y: hotR.y, z: hotR.z, kind: 'hot' });
    this.decor.setRings(rings);

    this.labels.update(camera, labels, this.myPos);
    const target = this.ui.target;
    let duckAt: { x: number; y: number } | null = null;
    if (target) {
      const r = target.self ? null : this.remotes.get(target.id);
      if (!target.self && (!r || !r.seen || Math.hypot(r.x - this.myPos.x, r.z - this.myPos.z) > HUB.pickRange + 5)) this.ui.closeDuck();
      else duckAt = this.labels.anchor(camera, r ? r.x : this.myPos.x, r ? r.y : this.myPos.y, r ? r.z : this.myPos.z);
    }
    const selfAt = me ? this.labels.anchor(camera, this.myPos.x, this.myPos.y, this.myPos.z) : null;
    this.ui.place(duckAt, selfAt);
    const touchOn = this.touch?.active ?? false;
    this.ui.setPointer(locked && !this.paused, !locked && !touchOn && !this.paused && !this.leaving && !this.ui.duckOpen && !this.chat.isOpen);
    this.ui.showHint(now < this.hintUntil && !this.paused && (locked || touchOn));
    // A market stall that sells Hunt Season gear: its prompt while the duck stands at the counter.
    this.ui.shopPrompt(me && !this.paused && !this.leaving && this.opts.hooks.shop ? shopAt(this.myPos.x, this.myPos.z) : null, touchOn);
    this.updateTouch();

    this.decor.update(dt);
    this.world.update(camera, dt);
    this.audio.listen(camera);
    this.audio.tick(this.myPos);
    this.ctx.renderer.render(this.ctx.scene, camera);
    // The board refreshes every couple of minutes while the plaza is open.
    if (now - this.boardAt > 120_000) void this.loadBoard();
    this.timer.cpuSample(performance.now() - t0);
  }

  /** A little dance on top of the drawn pose: a bob and a wiggle (each duck in its own phase). */
  private dance(avatar: Avatar, now: number, seed: number): void {
    const t = now / 1000 + seed * 0.37;
    avatar.object.position.y += Math.abs(Math.sin(t * 7)) * 0.14;
    avatar.object.rotation.y += Math.sin(t * 3.5) * 0.6;
    avatar.object.rotation.z = Math.sin(t * 7) * 0.12;
  }

  private readonly touchFrame: TouchFrame = { alive: true, down: false, mode: 0, br: false, spectating: false, promptKey: '', bandages: 0, medkits: 0, armed: false, otherWeapon: '', modal: false, mapOpen: false, canBag: false, hub: true };

  private updateTouch(): void {
    const t = this.touch;
    if (!t?.active) return;
    this.touchFrame.modal = this.chat.isOpen || this.paused || this.leaving;
    this.touchFrame.promptKey = this.ui.shopOpen ? 'E' : '';
    t.update(this.touchFrame);
  }

  /** Stop and remove everything this plaza added. */
  dispose(): void {
    this.disposed = true;
    this.running = false;
    void this.ctx.renderer.setAnimationLoop(null);
    this.abort.abort();
    this.chat.dispose();
    this.touch?.dispose();
    this.controls.dispose();
    this.ui.dispose();
    this.labels.dispose();
    this.decor.dispose();
    for (const r of this.remotes.values()) r.avatar.dispose();
    this.remotes.clear();
    this.local.dispose();
    this.world.dispose();
    this.audio.close();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Numbers for the dev test hook. */
  get stats(): { fps: number; ping: number; corrected: number; reconciles: number; maxErr: number } {
    const p = this.session.prediction;
    return { fps: this.timer.fps, ping: this.session.pingMs, corrected: p.corrected, reconciles: p.reconciles, maxErr: p.maxErrM };
  }

  /** NET re-export for the hook (interp delay in the snapshot). */
  static readonly interpDelayMs = NET.interpDelayMs;
}

/**
 * Touch controls: a layer over the canvas that turns fingers into the same
 * input state the keyboard and mouse feed (Controls). Left side: a floating
 * stick (it appears where the thumb lands; at the edge and forward it
 * sprints). Right side: drag anywhere to look. Buttons: Fire (hold; drag it
 * to aim while shooting), a second Fire on the left, Aim and Duck toggles,
 * Jump, Reload, Swap, a contextual Use (tap to pick up, hold to revive) and
 * Jump out / Glide, heals, spectate arrows, and a top row for pause, scores,
 * map and bag. Pointer events with capture, so every finger is tracked on
 * its own (stick, look and fire at once). No network messages of its own:
 * everything goes out in the normal input frame or as the same actions the
 * keys emit.
 */
import { Button, Mode } from '@qwakk/shared';
import { COPY } from '../../ui/menu/copy.ts';
import type { Controls } from '../controls.ts';
import { TOUCH } from './constants.ts';
import { buildLayout, type ButtonId, type TouchLayout } from './layout.ts';
import { setTouchUi } from './mode.ts';
import { FingerTracker, pickRole, type Finger } from './pointers.ts';
import { followCenter, stickVector } from './stick.ts';

/** What the touch layer needs to know each frame to show the right buttons. */
export interface TouchFrame {
  alive: boolean;
  /** Knocked: crawl only. */
  down: boolean;
  /** Movement mode (Mode.Ground, Plane, Freefall, Glide). */
  mode: number;
  br: boolean;
  /** Dead in a battle royale and watching: the spectate arrows. */
  spectating: boolean;
  /** The battle royale prompt key ('E' use, 'F' jump out, 'Space' glider), or ''. */
  promptKey: string;
  bandages: number;
  medkits: number;
  /** A gun in hand (Fire, Aim and Reload show only then). */
  armed: boolean;
  /** The other weapon's name for the Swap badge ('' hides Swap). */
  otherWeapon: string;
  /** A screen that takes the taps is open (inventory, results). */
  modal: boolean;
  /** The big map is open: taps on it close it. */
  mapOpen: boolean;
  /** The inventory screen can open now (alive on the ground in a battle royale match). */
  canBag: boolean;
  /** Deathmatch explosives: grenades left, rockets left, the launcher in hand. Unset: none. */
  nades?: number;
  rockets?: number;
  rocketOut?: boolean;
}

export interface TouchHooks {
  /** The pause button: free the controls and show the pause card. */
  pause(): void;
  /** A mouse click on the layer (a touch laptop): switch to mouse play. */
  mouse(): void;
}

// Jump is held (a tap still latches one press): the deathmatch hero flies while it is held.
const HOLD: Partial<Record<ButtonId, number>> = { fire: Button.Fire, fireL: Button.Fire, use: Button.Use, jump: Button.Jump, grenade: Button.Grenade };
const TAP: Partial<Record<ButtonId, number>> = { reload: Button.Reload, deploy: Button.Deploy, heal1: Button.Heal1, heal2: Button.Heal2 };
const TOGGLE: Partial<Record<ButtonId, number>> = { aim: Button.Aim, crouch: Button.Crouch };

export class TouchControls {
  private readonly controls: Controls;
  private readonly hooks: TouchHooks;
  private readonly ui: TouchLayout;
  private readonly fingers = new FingerTracker();
  private stickCenter = { x: 0, y: 0 };
  private activeOn = false;
  private boardOn = false;
  private lastShown = '';
  private lastBadges = '';
  /** The launcher is in hand (the rocket button then puts it away). */
  private rocketOut = false;
  /** A button that opens a screen (pause, map, bag) acts on touch down; the click the same tap makes later must not land on that screen. */
  private swallowClicksUntil = 0;
  private readonly abort = new AbortController();

  constructor(parent: HTMLElement, controls: Controls, hooks: TouchHooks) {
    this.controls = controls;
    this.hooks = hooks;
    this.ui = buildLayout(parent);
    const opts = { signal: this.abort.signal };
    const root = this.ui.root;
    root.addEventListener('pointerdown', (e) => this.onDown(e), opts);
    root.addEventListener('pointermove', (e) => this.onMove(e), opts);
    root.addEventListener('pointerup', (e) => this.onUp(e), opts);
    root.addEventListener('pointercancel', (e) => this.onUp(e), opts);
    root.addEventListener('lostpointercapture', (e) => this.onUp(e), opts);
    // No long-press menu, no synthetic clicks reaching the canvas.
    root.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    root.addEventListener('click', (e) => e.stopPropagation(), opts);
    window.addEventListener(
      'click',
      (e) => {
        if (performance.now() >= this.swallowClicksUntil) return;
        e.stopPropagation();
        e.preventDefault();
      },
      { capture: true, signal: this.abort.signal },
    );
    document.addEventListener('visibilitychange', () => document.hidden && this.releaseAll(), opts);
    window.addEventListener('blur', () => this.releaseAll(), opts);
  }

  get active(): boolean {
    return this.activeOn;
  }

  /**
   * Touch play on or off (the pause card, a switch to the mouse, the end of
   * the game). `keepLayout` keeps the compact HUD under the pause card, so the
   * screen does not jump around.
   */
  setActive(on: boolean, keepLayout = false): void {
    setTouchUi(on || keepLayout);
    if (on === this.activeOn) return;
    this.activeOn = on;
    this.controls.touchActive = on;
    if (!on) this.releaseAll();
    this.ui.root.hidden = !on;
    this.lastShown = '';
  }

  dispose(): void {
    this.setActive(false);
    this.abort.abort();
    this.ui.root.remove();
  }

  /** Let go of every finger and everything they held (toggles too). */
  private releaseAll(): void {
    for (const f of this.fingers.clear()) this.release(f);
    this.controls.clearTouch();
    this.ui.base.classList.remove('on');
    for (const b of this.ui.buttons.values()) b.classList.remove('on');
    if (this.boardOn) {
      this.boardOn = false;
      this.controls.action('scoreboard-off');
    }
  }

  private onDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse') {
      this.hooks.mouse();
      return;
    }
    e.preventDefault(); // no compatibility mouse events, no text selection
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-b]');
    const id = (target && !target.hidden ? target.dataset.b : null) as ButtonId | null;
    // With the stick hidden (plane, spectating) the left side looks too.
    const noStick = this.fingers.holding('stick') !== undefined || this.ui.root.classList.contains('tc-nostick');
    const role = pickRole(id, e.clientX, window.innerWidth, noStick, TOUCH.moveZoneShare);
    // One finger per button: a second finger on a held button just looks.
    const taken = id !== null && this.fingers.holding(role) !== undefined;
    const f = this.fingers.down(e.pointerId, taken ? 'look' : role, e.clientX, e.clientY, performance.now());
    try {
      this.ui.root.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events (tests) have no active pointer */
    }
    if (f.role === 'stick') {
      this.stickCenter = { x: e.clientX, y: e.clientY };
      this.ui.base.classList.add('on');
      this.placeStick(0, 0);
    } else if (f.role.startsWith('btn:')) this.press(f.role.slice(4) as ButtonId);
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerType === 'mouse') return;
    const m = this.fingers.move(e.pointerId, e.clientX, e.clientY);
    if (!m) return;
    const f = m.finger;
    if (f.role === 'stick') {
      const c = followCenter(this.stickCenter.x, this.stickCenter.y, e.clientX, e.clientY);
      this.stickCenter = { x: c.cx, y: c.cy };
      this.placeStick(e.clientX - c.cx, e.clientY - c.cy);
    } else if (f.role === 'look') {
      if (f.travel > TOUCH.lookSlop) this.controls.lookBy(m.dx, m.dy);
    } else if (f.role === 'btn:fire') {
      // Fire is also an aim pad: drag it to keep the crosshair on target while shooting.
      if (f.travel > TOUCH.lookSlop) this.controls.lookBy(m.dx, m.dy, TOUCH.fireDragLook);
    }
  }

  private onUp(e: PointerEvent): void {
    const f = this.fingers.up(e.pointerId);
    if (f) this.release(f);
  }

  /** Stick offset from its center: axes and sprint into Controls, and the knob drawn. */
  private placeStick(dx: number, dy: number): void {
    const s = stickVector(dx, dy);
    this.controls.setTouchMove(s.mx, s.mz);
    this.controls.setTouchHeld(Button.Sprint, s.sprint);
    const base = this.ui.base;
    base.style.transform = `translate(${this.stickCenter.x}px, ${this.stickCenter.y}px)`;
    this.ui.knob.style.transform = `translate(${s.knobX}px, ${s.knobY}px)`;
    base.classList.toggle('sprint', s.sprint);
  }

  private press(id: ButtonId): void {
    const c = this.controls;
    const el = this.ui.buttons.get(id);
    el?.classList.add('on');
    const hold = HOLD[id];
    if (hold !== undefined) return c.setTouchHeld(hold, true);
    const tap = TAP[id];
    if (tap !== undefined) return c.tapTouch(tap);
    const toggle = TOGGLE[id];
    if (toggle !== undefined) return c.setTouchHeld(toggle, !c.touchHeldHas(toggle));
    if (id === 'pause' || id === 'map' || id === 'bag') this.swallowClicksUntil = performance.now() + TOUCH.clickGuardMs;
    if (id === 'rocket') c.selectSlot(this.rocketOut ? c.currentSlot : 2);
    else if (id === 'swap') c.swapWeapon();
    else if (id === 'pause') this.hooks.pause();
    else if (id === 'map') c.action('map');
    else if (id === 'bag') c.action('inventory');
    else if (id === 'next') c.action('spectate-next');
    else if (id === 'prev') c.action('spectate-prev');
    else if (id === 'board') {
      this.boardOn = !this.boardOn;
      c.action(this.boardOn ? 'scoreboard-on' : 'scoreboard-off');
    }
  }

  private release(f: Finger): void {
    if (f.role === 'stick') {
      this.controls.setTouchMove(0, 0);
      this.controls.setTouchHeld(Button.Sprint, false);
      this.ui.base.classList.remove('on', 'sprint');
      // Back to the resting spot the CSS gives it.
      this.ui.base.style.transform = '';
      this.ui.knob.style.transform = '';
      return;
    }
    if (!f.role.startsWith('btn:')) return;
    const id = f.role.slice(4) as ButtonId;
    const hold = HOLD[id];
    // The other Fire may still be down.
    if (hold !== undefined && !(hold === Button.Fire && this.fingers.holding(id === 'fire' ? 'btn:fireL' : 'btn:fire'))) this.controls.setTouchHeld(hold, false);
    const el = this.ui.buttons.get(id);
    if (el && TOGGLE[id] === undefined && id !== 'board') {
      const left = TOUCH.pressFlashMs - (performance.now() - f.t0);
      if (left > 0) setTimeout(() => el.classList.remove('on'), left);
      else el.classList.remove('on');
    }
  }

  /** Per frame: which buttons show, toggle states, badges. Writes the DOM only when something changed. */
  update(t: TouchFrame): void {
    if (!this.activeOn) return;
    const c = this.controls;
    const ground = t.alive && !t.down && t.mode === Mode.Ground;
    // Toggles end with the state that allowed them (death, the plane, a knock).
    if (!ground) {
      for (const bits of [Button.Aim, Button.Crouch]) if (c.touchHeldHas(bits)) c.setTouchHeld(bits, false);
    }
    const show = new Set<ButtonId>(['pause']);
    if (t.mapOpen) show.add('map');
    else if (!t.modal) {
      show.add('board');
      if (t.br) show.add('map');
      if (t.canBag) show.add('bag');
      if (ground) {
        show.add('jump');
        show.add('crouch');
        if (t.armed) for (const id of ['fire', 'fireL', 'aim', 'reload'] as const) show.add(id);
        if (t.otherWeapon) show.add('swap');
        if (t.bandages > 0) show.add('heal1');
        if (t.medkits > 0) show.add('heal2');
        if ((t.nades ?? 0) > 0 || this.fingers.holding('btn:grenade')) show.add('grenade');
        if ((t.rockets ?? 0) > 0) show.add('rocket');
      }
      // A revive in progress drops the prompt, but the thumb on Use must keep holding.
      if (t.alive && (t.promptKey === 'E' || (ground && this.fingers.holding('btn:use')))) show.add('use');
      if (t.alive && (t.promptKey === 'F' || t.promptKey === 'Space')) show.add('deploy');
      if (t.spectating) {
        show.add('next');
        show.add('prev');
      }
    }
    const modal = t.modal || t.mapOpen;
    const stick = !modal && t.alive && t.mode !== Mode.Plane;
    const key = `${[...show].join(',')}|${stick ? 1 : 0}|${modal ? 1 : 0}|${t.promptKey}`;
    if (key !== this.lastShown) {
      this.lastShown = key;
      for (const [id, el] of this.ui.buttons) {
        const on = show.has(id);
        if (el.hidden === on) el.hidden = !on;
        // A button that went away lets go of what it held.
        if (!on) {
          const f = this.fingers.holding(`btn:${id}`);
          if (f) {
            this.fingers.up(f.id);
            this.release(f);
          }
        }
      }
      const deploy = this.ui.buttons.get('deploy')!.firstElementChild as HTMLElement;
      deploy.textContent = t.promptKey === 'Space' ? COPY.touch.buttons.glider : COPY.touch.buttons.deploy;
      this.ui.root.classList.toggle('tc-modal', modal);
      // A screen opened under the fingers: let go of the look and the stick too.
      if (modal) for (const f of this.fingers.clear()) this.release(f);
      this.ui.root.classList.toggle('tc-nostick', !stick);
      if (!stick && this.fingers.holding('stick')) this.release(this.fingers.up(this.fingers.holding('stick')!.id)!);
    }
    for (const [id, bits] of Object.entries(TOGGLE) as [ButtonId, number][]) this.ui.buttons.get(id)!.classList.toggle('on', c.touchHeldHas(bits));
    this.ui.buttons.get('board')!.classList.toggle('on', this.boardOn);
    this.rocketOut = t.rocketOut === true;
    this.ui.buttons.get('rocket')!.classList.toggle('on', this.rocketOut);
    const badges = `${t.bandages}|${t.medkits}|${t.otherWeapon}|${t.nades ?? 0}|${t.rockets ?? 0}`;
    if (badges !== this.lastBadges) {
      this.lastBadges = badges;
      this.ui.badges.get('grenade')!.textContent = String(t.nades ?? 0);
      this.ui.badges.get('rocket')!.textContent = String(t.rockets ?? 0);
      this.ui.badges.get('heal1')!.textContent = String(t.bandages);
      this.ui.badges.get('heal2')!.textContent = String(t.medkits);
      this.ui.badges.get('swap')!.textContent = t.otherWeapon;
    }
  }
}

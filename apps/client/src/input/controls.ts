/**
 * Keyboard and mouse: pointer lock, mouse look and the move/button state the
 * game samples once per fixed step. Look angles update on every mouse event,
 * so the camera (and the crosshair) never wait for the sim.
 *
 * Touch controls (input/touch) feed the same state: stick axes, held and
 * latched buttons and look drags, merged in sample(). They are an input
 * device only; the frame sent is the same as from the keys.
 */
import { Button, NET, wrapAngle } from '@qwakk/shared';
import { TOUCH } from './touch/constants.ts';
import { applyLook } from './touch/stick.ts';

const SENS_KEY = 'qwakk.sensitivity';
const DEFAULT_SENS = 0.0022; // rad per mouse count

function loadSensitivity(): number {
  try {
    const v = Number(localStorage.getItem(SENS_KEY));
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_SENS;
  } catch {
    return DEFAULT_SENS;
  }
}

export type ControlAction = 'shoulder' | 'hud' | 'lag' | 'jitter' | 'loss' | 'scoreboard-on' | 'scoreboard-off' | 'map' | 'spectate-next' | 'spectate-prev' | 'inventory' | 'inventory-close' | 'chat';

export class Controls {
  yaw = 0;
  pitch = -0.1;
  sensitivity = loadSensitivity();
  locked = false;
  private readonly keys = new Set<string>();
  private readonly element: HTMLElement;
  private readonly listeners = new Set<(a: ControlAction) => void>();
  /** Presses between two samples, so a tap shorter than a tick still counts. */
  private jumpLatch = false;
  private fireLatch = false;
  private fireHeld = false;
  /** Right mouse held: aim down sights. */
  private aimHeld = false;
  /**
   * Look speed multiplier on top of `sensitivity`, set by the game every frame
   * (the aiming sensitivity setting, blended in with the aim).
   */
  lookScale = 1;
  private reloadLatch = false;
  private useLatch = false;
  private deployLatch = false;
  private heal1Latch = false;
  private heal2Latch = false;
  /** Weapon slot asked for since the last sample (-1 none). */
  private slotLatch = -1;
  /** Which slot the player is on, for the mouse wheel toggle. */
  currentSlot = 0;
  /** Camera over the left shoulder (V toggles). Sent as an input bit for the server's aim ray. */
  leftShoulder = false;
  /** Dead in a battle royale: clicks cycle the duck being watched instead of firing. */
  spectating = false;
  /**
   * A game screen that needs the mouse is open (the inventory): the pointer is
   * free, but movement and action keys still count, so a duck can walk away
   * from a fight with its inventory open. Mouse look and the trigger do not.
   */
  uiOpen = false;
  /** A text composer is open: no movement, look or action input. */
  typing = false;
  /**
   * Touch controls are driving (input/touch): there is no pointer lock, the
   * touch layer feeds the state below and requestLock() does nothing.
   */
  touchActive = false;
  /** Touch: radians of look per CSS pixel of drag (the touch sensitivity setting). */
  touchRadPerPx: number = TOUCH.lookRadPerPx;
  /** Touch stick axes, used when no movement key is down. */
  private touchMx = 0;
  private touchMz = 0;
  /** Touch: buttons held down (fire, aim, crouch, use, sprint from the stick). */
  private touchHeld = 0;
  /** Touch: buttons tapped since the last sample, so a tap shorter than a tick still counts. */
  private touchLatched = 0;
  private readonly abort = new AbortController();

  /** Remove every listener (the game ends; a new game makes new controls). */
  dispose(): void {
    this.abort.abort();
    this.listeners.clear();
  }

  constructor(element: HTMLElement) {
    this.element = element;
    const opts = { signal: this.abort.signal };
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === element;
      if (!this.locked) {
        this.keys.clear();
        this.fireHeld = false;
        this.aimHeld = false;
      }
    }, opts);
    document.addEventListener('mousedown', (e) => {
      if (!this.locked || this.typing) return;
      if (this.spectating) {
        this.emit(e.button === 2 ? 'spectate-prev' : 'spectate-next');
        return;
      }
      if (e.button === 2) {
        this.aimHeld = true;
        return;
      }
      if (e.button !== 0) return;
      this.fireHeld = true;
      this.fireLatch = true;
    }, opts);
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2) this.aimHeld = false;
    }, opts);
    // Right click aims: no browser menu while playing.
    document.addEventListener('contextmenu', (e) => {
      if (this.locked || this.uiOpen || this.touchActive) e.preventDefault();
    }, opts);
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked || this.typing || e.deltaY === 0) return;
        this.slotLatch = this.currentSlot === 0 ? 1 : 0;
      },
      { passive: true, signal: this.abort.signal },
    );
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || this.typing) return;
      const k = this.sensitivity * this.lookScale;
      this.yaw = wrapAngle(this.yaw - e.movementX * k);
      this.pitch = Math.max(NET.minPitch, Math.min(NET.maxPitch, this.pitch - e.movementY * k));
    }, opts);
    window.addEventListener('keydown', (e) => this.onKey(e, true), opts);
    window.addEventListener('keyup', (e) => this.onKey(e, false), opts);
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.fireHeld = false;
      this.aimHeld = false;
    }, opts);
  }

  requestLock(): void {
    if (this.touchActive || this.typing) return;
    const el = this.element as HTMLElement & { requestPointerLock(options?: { unadjustedMovement?: boolean }): Promise<void> | void };
    // Raw mouse input where supported (no OS acceleration), plain lock otherwise.
    try {
      const r = el.requestPointerLock({ unadjustedMovement: true });
      if (r instanceof Promise) r.catch(() => el.requestPointerLock());
    } catch {
      el.requestPointerLock();
    }
  }

  onAction(fn: (a: ControlAction) => void): void {
    this.listeners.add(fn);
  }

  private emit(a: ControlAction): void {
    for (const fn of this.listeners) fn(a);
  }

  /** A touch button that maps to an action (map, inventory, scoreboard, spectate). */
  action(a: ControlAction): void {
    this.emit(a);
  }

  /** Touch stick axes (-1..1 each; the server normalizes the length too). */
  setTouchMove(mx: number, mz: number): void {
    this.touchMx = Number.isFinite(mx) ? Math.max(-1, Math.min(1, mx)) : 0;
    this.touchMz = Number.isFinite(mz) ? Math.max(-1, Math.min(1, mz)) : 0;
  }

  /** Hold or release touch buttons (Button bits). A press also latches, so it counts even if released before the next tick. */
  setTouchHeld(bits: number, on: boolean): void {
    if (on) {
      this.touchHeld |= bits;
      this.touchLatched |= bits;
    } else this.touchHeld &= ~bits;
  }

  /** Is this touch button held (toggles like crouch and aim read their state from here)? */
  touchHeldHas(bits: number): boolean {
    return (this.touchHeld & bits) !== 0;
  }

  /** A tap on a touch button: the bits go out with the next fixed step. */
  tapTouch(bits: number): void {
    this.touchLatched |= bits;
  }

  /** Touch weapon swap: the other slot. */
  swapWeapon(): void {
    this.slotLatch = this.currentSlot === 0 ? 1 : 0;
  }

  /** Touch look: a drag of (dx, dy) CSS pixels, scaled like the mouse by `lookScale` (aiming). */
  lookBy(dx: number, dy: number, share = 1): void {
    if (this.typing) return;
    const r = applyLook(this.yaw, this.pitch, dx, dy, this.touchRadPerPx * share, this.lookScale);
    this.yaw = r.yaw;
    this.pitch = r.pitch;
  }

  /** Let go of everything touch holds (pause, a screen opened, the page hidden). */
  clearTouch(): void {
    this.touchMx = 0;
    this.touchMz = 0;
    this.touchHeld = 0;
  }

  setTyping(on: boolean): void {
    this.typing = on;
    this.keys.clear();
    this.clearTouch();
    this.touchLatched = 0;
    this.fireHeld = this.aimHeld = this.fireLatch = this.jumpLatch = false;
    this.reloadLatch = this.useLatch = this.deployLatch = false;
    this.heal1Latch = this.heal2Latch = false;
    this.slotLatch = -1;
    this.emit('scoreboard-off');
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const code = e.code;
    const target = e.target as HTMLElement | null;
    if (this.typing || target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '')) {
      if (!down) this.keys.delete(code);
      return;
    }
    if (down && !e.repeat && code === 'KeyT' && (this.locked || this.uiOpen || this.touchActive)) {
      e.preventDefault();
      this.emit('chat');
      return;
    }
    if (code === 'AltLeft' || code === 'AltRight' || code === 'Space' || code === 'Tab') e.preventDefault();
    // Playing: the mouse is locked, or a game screen (the inventory) is open.
    const live = this.locked || this.uiOpen || this.touchActive;
    if (down && !e.repeat) {
      if (code === 'KeyI') this.emit('inventory');
      if (code === 'Escape' && this.uiOpen) this.emit('inventory-close');
      if (code === 'Space' && live) this.jumpLatch = true;
      if (code === 'KeyV') {
        this.leftShoulder = !this.leftShoulder;
        this.emit('shoulder');
      }
      if (code === 'KeyR' && live) this.reloadLatch = true;
      if (code === 'Digit1' && live) this.slotLatch = 0;
      if (code === 'Digit2' && live) this.slotLatch = 1;
      if (code === 'KeyE' && live) this.useLatch = true;
      if (code === 'KeyF' && live) this.deployLatch = true;
      if (code === 'Digit4' && live) this.heal1Latch = true;
      if (code === 'Digit5' && live) this.heal2Latch = true;
      if (code === 'KeyM') this.emit('map');
      if (code === 'Tab') this.emit('scoreboard-on');
      if (code === 'KeyH') this.emit('hud');
      if (code === 'KeyN') this.emit('lag');
      if (code === 'KeyJ') this.emit('jitter');
      if (code === 'KeyL') this.emit('loss');
      if (code === 'Minus') this.setSensitivity(this.sensitivity / 1.1);
      if (code === 'Equal') this.setSensitivity(this.sensitivity * 1.1);
    }
    // Movement keys only count while playing (pointer locked), so typing or
    // clicking around the page never moves the duck. Releases always count.
    if (!down && code === 'Tab') this.emit('scoreboard-off');
    if (down && live) this.keys.add(code);
    else if (!down) this.keys.delete(code);
  }

  setSensitivity(v: number): void {
    this.sensitivity = Math.max(0.0002, Math.min(0.02, v));
    try {
      localStorage.setItem(SENS_KEY, String(this.sensitivity));
    } catch {
      /* storage blocked: keep it for this session only */
    }
  }

  /** Move axes and buttons for one fixed step. */
  sample(): { mx: number; mz: number; buttons: number } {
    if (this.typing) return { mx: 0, mz: 0, buttons: this.leftShoulder ? Button.ShoulderLeft : 0 };
    const k = this.keys;
    const kx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const kz = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    // Keys win over the touch stick when both are in use (a touch laptop).
    const keyed = kx !== 0 || kz !== 0;
    const mx = keyed ? kx : this.touchMx;
    const mz = keyed ? kz : this.touchMz;
    let buttons = this.touchHeld | this.touchLatched;
    this.touchLatched = 0;
    if (k.has('Space') || this.jumpLatch) buttons |= Button.Jump;
    if (k.has('ShiftLeft') || k.has('ShiftRight')) buttons |= Button.Sprint;
    if (k.has('KeyC')) buttons |= Button.Crouch;
    if (k.has('AltLeft') || k.has('AltRight')) buttons |= Button.Walk;
    if (this.fireHeld || this.fireLatch) buttons |= Button.Fire;
    if (this.aimHeld) buttons |= Button.Aim;
    if (this.reloadLatch) buttons |= Button.Reload;
    if (this.slotLatch === 0) buttons |= Button.Slot1;
    if (this.slotLatch === 1) buttons |= Button.Slot2;
    if (this.leftShoulder) buttons |= Button.ShoulderLeft;
    if (this.useLatch || k.has('KeyE')) buttons |= Button.Use;
    if (this.deployLatch || k.has('KeyF')) buttons |= Button.Deploy;
    if (this.heal1Latch) buttons |= Button.Heal1;
    if (this.heal2Latch) buttons |= Button.Heal2;
    this.jumpLatch = false;
    this.fireLatch = false;
    this.reloadLatch = false;
    this.slotLatch = -1;
    this.useLatch = false;
    this.deployLatch = false;
    this.heal1Latch = false;
    this.heal2Latch = false;
    return { mx, mz, buttons };
  }
}

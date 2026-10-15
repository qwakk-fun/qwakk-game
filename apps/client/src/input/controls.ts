/**
 * Keyboard and mouse: pointer lock, mouse look and the move/button state the
 * game samples once per fixed step. Look angles update on every mouse event,
 * so the camera (and the crosshair) never wait for the sim.
 */
import { Button, NET, wrapAngle } from '@qwakk/shared';

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

export type ControlAction = 'shoulder' | 'hud' | 'lag' | 'jitter' | 'loss' | 'scoreboard-on' | 'scoreboard-off' | 'map' | 'spectate-next' | 'spectate-prev';

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
      }
    }, opts);
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (this.spectating) {
        this.emit(e.button === 2 ? 'spectate-prev' : 'spectate-next');
        return;
      }
      if (e.button !== 0) return;
      this.fireHeld = true;
      this.fireLatch = true;
    }, opts);
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
    }, opts);
    document.addEventListener(
      'wheel',
      (e) => {
        if (!this.locked || e.deltaY === 0) return;
        this.slotLatch = this.currentSlot === 0 ? 1 : 0;
      },
      { passive: true, signal: this.abort.signal },
    );
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw = wrapAngle(this.yaw - e.movementX * this.sensitivity);
      this.pitch = Math.max(NET.minPitch, Math.min(NET.maxPitch, this.pitch - e.movementY * this.sensitivity));
    }, opts);
    window.addEventListener('keydown', (e) => this.onKey(e, true), opts);
    window.addEventListener('keyup', (e) => this.onKey(e, false), opts);
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.fireHeld = false;
    }, opts);
  }

  requestLock(): void {
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

  private onKey(e: KeyboardEvent, down: boolean): void {
    const code = e.code;
    if (code === 'AltLeft' || code === 'AltRight' || code === 'Space' || code === 'Tab') e.preventDefault();
    if (down && !e.repeat) {
      if (code === 'Space' && this.locked) this.jumpLatch = true;
      if (code === 'KeyV') {
        this.leftShoulder = !this.leftShoulder;
        this.emit('shoulder');
      }
      if (code === 'KeyR' && this.locked) this.reloadLatch = true;
      if (code === 'Digit1' && this.locked) this.slotLatch = 0;
      if (code === 'Digit2' && this.locked) this.slotLatch = 1;
      if (code === 'KeyE' && this.locked) this.useLatch = true;
      if (code === 'KeyF' && this.locked) this.deployLatch = true;
      if (code === 'Digit4' && this.locked) this.heal1Latch = true;
      if (code === 'Digit5' && this.locked) this.heal2Latch = true;
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
    if (down && this.locked) this.keys.add(code);
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
    const k = this.keys;
    const mx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const mz = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    let buttons = 0;
    if (k.has('Space') || this.jumpLatch) buttons |= Button.Jump;
    if (k.has('ShiftLeft') || k.has('ShiftRight')) buttons |= Button.Sprint;
    if (k.has('KeyC')) buttons |= Button.Crouch;
    if (k.has('AltLeft') || k.has('AltRight')) buttons |= Button.Walk;
    if (this.fireHeld || this.fireLatch) buttons |= Button.Fire;
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

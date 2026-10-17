/**
 * The menu's hero duck in 3D, aiming at the cursor. Loaded by the menu with a
 * dynamic import after it has painted (main.ts passes the loader), so the
 * menu chunk never carries Three.js; it shares the Three.js chunk with the game.
 *
 * The static image stays underneath as the first paint and the fallback: the
 * canvas fades in over it after its first frame, and any failure (no WebGL2,
 * a load error, a lost context) leaves or puts the image back.
 *
 *   mouse        the duck turns its head, body and rifle toward the cursor and
 *                relaxes back to the authored pose when the cursor leaves the window
 *   touch        a lazy glance now and then; a tap holds its look for a moment
 *   click/tap    on the duck: a small recoil and a quack of the bill
 *
 * Light by design: a small WebGL2 canvas (pixel ratio at most 1.5), a frame
 * only while something moves, nothing while the tab is hidden or the Play tab
 * is not shown, and `dispose()` frees the renderer, geometry and textures
 * before the game starts.
 */
import * as THREE from 'three/webgpu';
import { AIM, settled, stepSpring, type Spring } from './aim.ts';
import { HeroDuck } from './heroDuck.ts';

export interface HeroHandle {
  /** Draw only while the Play tab (and so the duck) is shown. */
  setActive(on: boolean): void;
  /** Show another character (menu catalog id): its model loads, then replaces the current one. */
  setCharacter(id: string): void;
  /** Stop and free everything; the image shows again. Safe to call twice. */
  dispose(): void;
}

export interface HeroOptions {
  /** Called when the 3D duck gives up after mounting (lost context); the image is back by then. */
  onLost?: () => void;
  /** True once the menu no longer wants this mount (Play pressed while loading): stop before compiling. */
  cancelled?: () => boolean;
  /** The picked duck (menu catalog id, default classic). */
  character?: string;
}

const MAX_PIXEL_RATIO = 1.5;

/** Mount the 3D duck into `host` (the element around the menu image). Rejects when 3D is not available. */
export async function mountHero(host: HTMLElement, opts: HeroOptions = {}): Promise<HeroHandle> {
  const canvas = document.createElement('canvas');
  canvas.className = 'qm-hero3d';
  host.append(canvas);
  // WebGL2 on purpose: quick to start, and no second WebGPU device next to the game's.
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true, forceWebGL: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  let duck: HeroDuck;
  let ticker: { start(): void; stop(): void } | undefined;
  try {
    const [, loaded] = await Promise.all([renderer.init(), HeroDuck.load(opts.character)]);
    if (opts.cancelled?.()) throw new Error('menu hero cancelled');
    // The renderer runs its own requestAnimationFrame ticker from init() on, even
    // with no animation loop set. It is stopped here and runs only while the duck moves.
    ticker = (renderer as unknown as { _animation?: { start(): void; stop(): void } })._animation;
    ticker?.stop();
    duck = loaded;
    renderer.toneMapping = THREE.NoToneMapping;
    resize();
    duck.pose(0, 0, 0, -1);
    await renderer.compileAsync(duck.scene, duck.camera);
    if (opts.cancelled?.()) throw new Error('menu hero cancelled');
  } catch (err) {
    // Only an initialized renderer has anything to free (dispose() on a failed
    // init would start a second init and leave its rejection unhandled).
    if ((renderer as unknown as { _initialized?: boolean })._initialized) renderer.dispose().catch(() => {});
    canvas.remove();
    throw err;
  }

  const touchOnly = !matchMedia('(any-pointer: fine)').matches;
  const yaw: Spring = { x: 0, v: 0 };
  const pitch: Spring = { x: 0, v: 0 };
  const target = { yaw: 0, pitch: 0 };
  /** Last mouse position on the page, or null while the cursor is outside the window. */
  let pointer: { x: number; y: number } | null = null;
  let recoil = 0;
  let quackT = -1;
  let active = true;
  let disposed = false;
  /** The character shown, and the one wanted (a swap loads the new model, then replaces the old). */
  let shownCharacter = opts.character ?? 'classic';
  let wantedCharacter = shownCharacter;
  let swapping = false;
  let running = false;
  let last = 0;
  let glanceTimer = 0;

  function resize(): boolean {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(w, h, false);
    return true;
  }

  const wake = (): void => {
    if (running || !active || disposed || document.hidden) return;
    running = true;
    last = performance.now();
    ticker?.start();
    void renderer.setAnimationLoop(frame);
  };
  const rest = (): void => {
    if (!running) return;
    running = false;
    void renderer.setAnimationLoop(null);
    ticker?.stop();
  };

  function frame(now: number): void {
    if (disposed || !active) return rest();
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (pointer) {
      const t = duck.aimAt(pointer.x, pointer.y, canvas.getBoundingClientRect());
      target.yaw = t.yaw;
      target.pitch = t.pitch;
    }
    stepSpring(yaw, target.yaw, AIM.omega, dt);
    stepSpring(pitch, target.pitch, AIM.omega, dt);
    recoil = Math.max(0, recoil - dt * AIM.recoilFade);
    if (quackT >= 0) {
      quackT += dt;
      if (quackT > duck.quackSeconds) quackT = -1;
    }
    duck.pose(yaw.x, pitch.x, recoil, quackT);
    renderer.render(duck.scene, duck.camera);
    const moving = !settled(yaw, target.yaw) || !settled(pitch, target.pitch) || recoil > 0 || quackT >= 0;
    if (!moving) rest();
  }

  const look = (yawTo: number, pitchTo: number): void => {
    target.yaw = yawTo;
    target.pitch = pitchTo;
    wake();
  };

  /** Touch screens: a lazy glance now and then, sometimes back to the pose. */
  const scheduleGlance = (delay?: number): void => {
    clearTimeout(glanceTimer);
    if (!touchOnly || disposed || !active || document.hidden) return;
    const [lo, hi] = AIM.glanceHold;
    glanceTimer = window.setTimeout(() => {
      const relax = Math.random() < 0.4;
      look(relax ? 0 : (Math.random() * 2 - 1) * AIM.glanceYaw, relax ? 0 : (Math.random() * 2 - 1) * AIM.glancePitch);
      scheduleGlance();
    }, (delay ?? lo + Math.random() * (hi - lo)) * 1000);
  };

  const onMove = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') return;
    pointer = { x: e.clientX, y: e.clientY };
    wake();
  };
  const onLeave = (): void => {
    pointer = null;
    look(0, 0);
  };
  const onOut = (e: MouseEvent): void => {
    if (!e.relatedTarget) onLeave();
  };
  const onDown = (e: PointerEvent): void => {
    if (!e.isPrimary) return;
    const rect = canvas.getBoundingClientRect();
    if (e.pointerType === 'touch') {
      const t = duck.aimAt(e.clientX, e.clientY, rect);
      look(t.yaw, t.pitch);
      scheduleGlance(AIM.tapHold);
    }
    if (duck.hit(e.clientX, e.clientY, rect)) {
      recoil = 1;
      if (duck.quackSeconds > 0) quackT = 0;
      renderer.render(duck.scene, duck.camera);
      wake();
    }
  };
  const onVisibility = (): void => {
    if (document.hidden) {
      rest();
      clearTimeout(glanceTimer);
    } else {
      wake();
      scheduleGlance();
    }
  };
  const onLost = (e: Event): void => {
    e.preventDefault();
    handle.dispose();
    opts.onLost?.();
  };
  const ro = new ResizeObserver(() => {
    if (resize()) wake();
  });

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('blur', onLeave);
  document.addEventListener('mouseout', onOut);
  document.addEventListener('visibilitychange', onVisibility);
  canvas.addEventListener('webglcontextlost', onLost);
  ro.observe(canvas);

  /** Load the wanted character, compile it, then swap it in and free the old duck (one swap at a time). */
  const swap = async (): Promise<void> => {
    if (swapping || disposed) return;
    if (wantedCharacter === shownCharacter) {
      host.classList.add('is-3d');
      return;
    }
    swapping = true;
    const id = wantedCharacter;
    let next: HeroDuck | undefined;
    // The static portrait already matches the card. Show it until the new
    // model is ready, including on a failed load.
    host.classList.remove('is-3d');
    try {
      next = await HeroDuck.load(id);
      if (disposed) return next.dispose();
      next.pose(yaw.x, pitch.x, 0, -1);
      await renderer.compileAsync(next.scene, next.camera);
      if (disposed) return next.dispose();
      const old = duck;
      duck = next;
      next = undefined;
      shownCharacter = id;
      old.dispose();
      recoil = 0;
      quackT = -1;
      // A short quack says hello (the frame loop runs while it plays).
      if (duck.quackSeconds > 0) quackT = 0;
      wake();
      if (wantedCharacter === shownCharacter) host.classList.add('is-3d');
    } catch (err) {
      next?.dispose();
      console.warn('[menu] could not load that duck in 3D', err);
      // Keep the selected card and its portrait; a later pick retries.
      // A newer pick made during this request still gets its own attempt.
      if (wantedCharacter !== id) queueMicrotask(() => void swap());
      return;
    } finally {
      swapping = false;
    }
    if (wantedCharacter !== shownCharacter) void swap();
  };

  const handle: HeroHandle = {
    setCharacter(id) {
      if (disposed) return;
      wantedCharacter = id;
      void swap();
    },
    setActive(on) {
      if (on === active || disposed) return;
      active = on;
      if (on) {
        wake();
        scheduleGlance();
      } else {
        rest();
        clearTimeout(glanceTimer);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rest();
      clearTimeout(glanceTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      ro.disconnect();
      host.classList.remove('is-3d');
      duck.dispose();
      renderer.dispose().catch(() => {});
      canvas.remove();
    },
  };

  // First frame, then fade from the image to the canvas once it is on screen.
  wake();
  requestAnimationFrame(() => requestAnimationFrame(() => !disposed && wantedCharacter === shownCharacter && host.classList.add('is-3d')));
  scheduleGlance(1.2);
  return handle;
}

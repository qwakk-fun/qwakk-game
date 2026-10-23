/**
 * The character select's ducks in 3D: up to four HeroDucks (the menu duck,
 * same models, framing and toon look) on one small WebGL2 renderer. Each
 * slot has its own 2D canvas in the page; a frame renders every duck in
 * turn and copies it into its slot's canvas, so the page lays the slots out
 * (a row on desktop, a grid on phones) and one GPU context serves them all.
 * One model per look: two ducks wearing the same look share it, posed in turn.
 *
 * The picked duck turns to face the viewer (a spring) and quacks; the others
 * stand at the menu's three-quarter angle. Frames run only while something
 * moves; nothing runs while the tab is hidden. `dispose()` frees it all.
 */
import * as THREE from 'three/webgpu';
import { settled, stepSpring, type Spring } from './aim.ts';
import { FACE_CAMERA, HeroDuck } from './heroDuck.ts';

export interface RosterSlot {
  /** The slot's 2D canvas (square). */
  canvas: HTMLCanvasElement;
  /** Menu catalog id (classic, mallard). */
  character: string;
}

export interface RosterHandle {
  /** The slots in order (null: an empty nest). Ducks load on demand; a slot's canvas gets `data-ready` once drawn. */
  set(slots: (RosterSlot | null)[]): void;
  /** Turn this slot's duck toward the viewer (-1: none). */
  select(index: number): void;
  dispose(): void;
}

const MAX_PIXEL_RATIO = 1.5;
/** Spring stiffness of the turn (1/s). */
const OMEGA = 7;

interface SlotState {
  slot: RosterSlot;
  spin: Spring;
  quackT: number;
  ctx: CanvasRenderingContext2D | null;
}

export async function mountRoster(opts: { cancelled?: () => boolean } = {}): Promise<RosterHandle> {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true, forceWebGL: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  try {
    await renderer.init();
    if (opts.cancelled?.()) throw new Error('roster cancelled');
  } catch (err) {
    if ((renderer as unknown as { _initialized?: boolean })._initialized) renderer.dispose().catch(() => {});
    throw err;
  }
  renderer.toneMapping = THREE.NoToneMapping;
  // The renderer's own frame ticker: stopped, the roster runs its own frames.
  (renderer as unknown as { _animation?: { stop(): void } })._animation?.stop();

  const models = new Map<string, Promise<HeroDuck>>();
  const ready = new Map<string, HeroDuck>();
  let slots: (SlotState | null)[] = [];
  let selected = -1;
  let disposed = false;
  let raf = 0;
  let last = 0;
  const ro = new ResizeObserver(() => wake());

  const model = (id: string): void => {
    if (models.has(id)) return;
    const p = HeroDuck.load(id);
    models.set(id, p);
    p.then(
      async (duck) => {
        if (disposed) return duck.dispose();
        duck.pose(0, 0, 0, -1);
        await renderer.compileAsync(duck.scene, duck.camera);
        if (disposed) return duck.dispose();
        ready.set(id, duck);
        wake();
      },
      (err: unknown) => console.warn('[menu] roster duck unavailable, keeping the portrait', err),
    );
  };

  const pixelRatio = (): number => Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);

  function draw(dt: number): boolean {
    let moving = false;
    const pr = pixelRatio();
    slots.forEach((s, i) => {
      if (!s) return;
      const duck = ready.get(s.slot.character);
      if (!duck) return;
      const target = i === selected ? FACE_CAMERA : 0;
      stepSpring(s.spin, target, OMEGA, dt);
      if (s.quackT >= 0) {
        s.quackT += dt;
        if (s.quackT > duck.quackSeconds) s.quackT = -1;
      }
      if (!settled(s.spin, target) || s.quackT >= 0) moving = true;
      const c = s.slot.canvas;
      const w = Math.round(c.clientWidth * pr);
      const hgt = Math.round(c.clientHeight * pr);
      if (w === 0 || hgt === 0) return;
      if (c.width !== w || c.height !== hgt) {
        c.width = w;
        c.height = hgt;
      }
      const size = renderer.getSize(new THREE.Vector2());
      if (size.x !== c.clientWidth || size.y !== c.clientHeight || renderer.getPixelRatio() !== pr) {
        renderer.setPixelRatio(pr);
        renderer.setSize(c.clientWidth, c.clientHeight, false);
      }
      duck.camera.aspect = c.clientWidth / c.clientHeight;
      duck.camera.updateProjectionMatrix();
      duck.pose(0, 0, 0, s.quackT, s.spin.x);
      renderer.render(duck.scene, duck.camera);
      s.ctx ??= c.getContext('2d');
      if (!s.ctx) return;
      s.ctx.clearRect(0, 0, w, hgt);
      s.ctx.drawImage(canvas, 0, 0, w, hgt);
      c.dataset.ready = '1';
    });
    return moving;
  }

  function frame(now: number): void {
    raf = 0;
    if (disposed || document.hidden) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (draw(dt)) raf = requestAnimationFrame(frame);
  }

  function wake(): void {
    if (disposed || raf || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  const onVisibility = (): void => {
    if (!document.hidden) wake();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const onLost = (e: Event): void => {
    e.preventDefault();
    handle.dispose();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  const handle: RosterHandle = {
    set(next) {
      if (disposed) return;
      ro.disconnect();
      slots = next.map((slot, i) => {
        if (!slot) return null;
        model(slot.character);
        ro.observe(slot.canvas);
        const old = slots[i];
        // The same canvas and duck keep their turn; a new one starts at the menu angle.
        return old && old.slot.canvas === slot.canvas && old.slot.character === slot.character ? { ...old, slot } : { slot, spin: { x: 0, v: 0 }, quackT: -1, ctx: null };
      });
      wake();
    },
    select(index) {
      if (disposed || index === selected) return;
      selected = index;
      const s = slots[index];
      const duck = s ? ready.get(s.slot.character) : undefined;
      if (s && duck && duck.quackSeconds > 0) s.quackT = 0;
      wake();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      for (const s of slots) if (s) delete s.slot.canvas.dataset.ready;
      for (const d of ready.values()) d.dispose();
      ready.clear();
      renderer.dispose().catch(() => {});
    },
  };
  return handle;
}

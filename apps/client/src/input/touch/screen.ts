/**
 * The phone screen around a touch match: fullscreen and a landscape lock on
 * the first tap into play (where the browser allows it), the "turn your
 * phone" screen in portrait, and the page guards (no pinch zoom, no long
 * press menus, no text selection, no scrolling). iPhone Safari has no
 * fullscreen API for pages and no orientation lock: there the rotate screen
 * and the guards do the work, and nothing throws.
 */
import { COPY } from '../../ui/menu/copy.ts';

type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type LockableOrientation = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };

let rotateEl: HTMLElement | null = null;
let entered = false;
let guardsOn = false;

function fullscreenElement(): Element | null {
  const d = document as FsDocument;
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

/** Fullscreen and landscape lock, from a tap (both need a user gesture). Never throws. */
export async function enterPlayScreen(): Promise<void> {
  const root = document.documentElement as FsElement;
  try {
    if (!fullscreenElement()) {
      if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
      else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen();
      entered = fullscreenElement() !== null;
    }
  } catch {
    /* refused (iPhone, embedded browsers): play in the page */
  }
  try {
    const o = screen.orientation as LockableOrientation | undefined;
    if (o?.lock) await o.lock('landscape');
  } catch {
    /* no lock outside fullscreen or on this browser: the rotate screen covers portrait */
  }
}

/** Leave fullscreen we entered and drop the orientation lock (back to the menu). */
export function leavePlayScreen(): void {
  try {
    (screen.orientation as LockableOrientation | undefined)?.unlock?.();
  } catch {
    /* nothing locked */
  }
  if (!entered) return;
  entered = false;
  const d = document as FsDocument;
  try {
    if (!fullscreenElement()) return;
    if (d.exitFullscreen) void d.exitFullscreen().catch(() => {});
    else void d.webkitExitFullscreen?.();
  } catch {
    /* already out */
  }
}

/**
 * A touch match is on screen: show the rotate screen in portrait (CSS does
 * the orientation test) and block the page gestures; off again for the menu.
 */
export function setTouchGame(on: boolean): void {
  document.body.classList.toggle('touch-game', on);
  if (on && !rotateEl) {
    rotateEl = document.createElement('div');
    rotateEl.id = 'rotate';
    rotateEl.setAttribute('role', 'alert');
    const phone = document.createElement('div');
    phone.className = 'rotate-phone';
    phone.setAttribute('aria-hidden', 'true');
    const title = document.createElement('div');
    title.className = 'rotate-title';
    title.textContent = COPY.touch.rotateTitle;
    const sub = document.createElement('div');
    sub.className = 'rotate-sub';
    sub.textContent = COPY.touch.rotateSub;
    rotateEl.append(phone, title, sub);
    document.body.append(rotateEl);
  }
  if (on) installGuards();
}

/** Safari ignores touch-action for pinch on some versions; these stop zoom, callouts and selection in a match. */
function installGuards(): void {
  if (guardsOn) return;
  guardsOn = true;
  const inGame = (): boolean => document.body.classList.contains('touch-game');
  const stop = (e: Event): void => {
    if (inGame()) e.preventDefault();
  };
  // iOS pinch gestures (non-standard events).
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('selectstart', (e) => {
    if (inGame() && !(e.target instanceof HTMLInputElement)) e.preventDefault();
  });
  // Two-finger page zoom and scroll: the game owns every touch while it runs, except inside scrollable game screens.
  document.addEventListener(
    'touchmove',
    (e) => {
      if (!inGame() || !e.cancelable) return;
      const t = e.target as Element | null;
      if (t?.closest?.('.br-invscreen, .tc-scroll')) return;
      e.preventDefault();
    },
    { passive: false },
  );
}

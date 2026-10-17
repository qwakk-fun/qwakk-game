import { t as translate } from './i18n/game.ts';
/**
 * Game entry for the menu (ui/menu) and for direct starts in dev:
 *
 *   startGame({ mode, token, name, settings })  join, load the map, play; resolves once in the game
 *   onGameExit(cb)                              called with 'ended', 'left' or 'disconnected'
 *
 * One renderer for the page; every game gets a fresh scene, controls and HUD,
 * and disposes them when it ends.
 */
import { CloseCode } from '@colyseus/sdk';
import { initPhysics } from '@qwakk/shared';
import { MatchPhase } from '@qwakk/shared/net';
import { CLOSE_CODE } from '@qwakk/shared/lobby';
import { config } from './config.ts';
import { Game, type ExitReason, type ExitSummary } from './game.ts';
import { coarsePointer, isTouchOnly } from './input/touch/device.ts';
import { enterPlayScreen, leavePlayScreen, setTouchGame } from './input/touch/screen.ts';
import { COPY } from './ui/menu/copy.ts';
import { Session } from './net/session.ts';
import { createRenderer, freshScene, type RenderContext } from './render/renderer.ts';
import { buildWorld, MapMismatchError } from './world/worldHandle.ts';

export type { ExitReason, ExitSummary } from './game.ts';

export interface StartGameOptions {
  mode: 'br' | 'dm';
  /** A room from the lobby list (battle royale or deathmatch), or a new battle royale room; neither is Quick Play. */
  roomId?: string;
  create?: boolean;
  /** Battle royale team size for a new room or Quick Play (1 solo, 2 duo, 4 squad). */
  team?: number;
  token?: string;
  name?: string;
  /** The picked duck (shared catalog id); the server checks it and falls back to the classic duck. */
  character?: number;
  settings: { sensitivity: number; adsSensitivity?: number; touchSensitivity?: number; fov: number; volume: number; quality?: 'low' | 'medium' | 'high' };
}

type ExitCallback = (reason: ExitReason, summary?: ExitSummary) => void;

/** Join refusal code: this player already has a seat in the match (server gameRoom.ts JOIN_ERROR). */
const ALREADY_IN_MATCH = 4409;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;
const hudEl = document.getElementById('hud') as HTMLElement;
const reconnect = document.getElementById('reconnect') as HTMLButtonElement;

let ctxPromise: Promise<RenderContext> | null = null;
let exitCallback: ExitCallback | null = null;
let current: { game: Game; session: Session; mode: 'br' | 'dm'; ended: boolean } | null = null;
let leaveButton: HTMLButtonElement | null = null;
/** The last pointer that touched the pause card: a finger starts touch play, a mouse locks the pointer. */
let overlayPointer = '';

export function onGameExit(cb: ExitCallback): void {
  exitCallback = cb;
}

function renderer(): Promise<RenderContext> {
  ctxPromise ??= createRenderer(canvas, config);
  return ctxPromise;
}

function setOverlay(text: string, opts: { stopped?: boolean; leave?: boolean } = {}): void {
  overlay.classList.remove('hidden');
  overlay.dataset.stopped = opts.stopped ? '1' : '';
  status.textContent = text;
  reconnect.hidden = !opts.stopped || exitCallback !== null;
  if (leaveButton) leaveButton.hidden = !opts.leave;
}

/** End the current game and tell the menu. */
function finish(reason: ExitReason, summary?: ExitSummary): void {
  const cur = current;
  current = null;
  if (!cur) return;
  if (document.pointerLockElement) document.exitPointerLock();
  cur.game.dispose();
  cur.session.leave();
  leavePlayScreen();
  setTouchGame(false);
  if (exitCallback) {
    overlay.classList.add('hidden');
    exitCallback(reason, summary ?? cur.game.br?.summary() ?? { mode: cur.mode });
  } else if (reason === 'disconnected') {
    setOverlay(translate('Disconnected from the island. Check your connection and reconnect.'), { stopped: true });
  } else {
    setOverlay(translate('Thanks for playing! Reload to drop in again.'), { stopped: true });
    reconnect.hidden = false;
    reconnect.textContent = translate('Play again');
  }
}

function ensureLeaveButton(): void {
  if (leaveButton) return;
  leaveButton = document.createElement('button');
  leaveButton.type = 'button';
  leaveButton.id = 'leave';
  leaveButton.textContent = translate('Leave the match');
  leaveButton.hidden = true;
  leaveButton.addEventListener('click', (e) => {
    e.stopPropagation();
    finish('left');
  });
  reconnect.insertAdjacentElement('afterend', leaveButton);
}

let wired = false;
function wireOnce(): void {
  if (wired) return;
  wired = true;
  if (config.devtools) for (const el of document.querySelectorAll<HTMLElement>('.devonly')) el.hidden = false;
  reconnect.addEventListener('click', (e) => {
    e.stopPropagation();
    location.reload();
  });
  ensureLeaveButton();
  overlay.addEventListener('pointerdown', (e) => (overlayPointer = e.pointerType));
  overlay.addEventListener('click', () => {
    const cur = current;
    if (!cur || overlay.dataset.stopped === '1') return;
    cur.game.sound.unlock();
    if (cur.game.touch && (overlayPointer === 'touch' || overlayPointer === 'pen' || isTouchOnly())) startTouchPlay(cur.game);
    else {
      // A mouse on a touch laptop: the desktop layout and pointer lock.
      cur.game.touch?.setActive(false);
      if (!isTouchOnly()) setTouchGame(false);
      cur.game.controlsRef.requestLock();
    }
  });
  canvas.addEventListener('click', () => {
    const cur = current;
    if (!cur) return;
    cur.game.sound.unlock();
    // A click outside the inventory screen closes it and goes back to play.
    if (cur.game.br?.inventoryOpen) cur.game.br.closeInventory(false);
    if (!cur.game.controlsRef.locked && !config.spectate && !cur.game.br?.resultOpen) cur.game.controlsRef.requestLock();
  });
  document.addEventListener('pointerlockchange', () => {
    const cur = current;
    if (!cur || overlay.dataset.stopped === '1') return;
    const locked = document.pointerLockElement === canvas;
    // Touch play shows its own pause card (the pause button); the mouse is not locked then.
    if (cur.game.touch?.active) return;
    if (locked || config.autopilot !== '' || config.spectate || cur.game.br?.resultOpen || cur.game.br?.inventoryOpen) overlay.classList.add('hidden');
    else setOverlay(translate('Click to play'), { leave: true });
  });
  window.addEventListener('beforeunload', () => current?.session.leave());
}

/** Touch play on: the touch layer, fullscreen and the landscape lock where the browser allows them (this runs in the tap). */
function startTouchPlay(game: Game): void {
  overlay.classList.add('hidden');
  setTouchGame(true);
  game.touch?.setActive(true);
  void enterPlayScreen();
}

/** Join a match and play. Resolves once the game is running, with the room joined (the party leader passes it on). */
export async function startGame(opts: StartGameOptions): Promise<{ roomId: string }> {
  try {
    return await joinAndPlay(opts);
  } catch (err) {
    // Back to the menu: no rotate screen over it.
    if (!current) setTouchGame(false);
    throw err;
  }
}

async function joinAndPlay(opts: StartGameOptions): Promise<{ roomId: string }> {
  wireOnce();
  if (current) finish('left');
  // Phones: the rotate screen covers portrait from the loading screen on.
  setTouchGame(isTouchOnly());
  setOverlay(translate('Loading the island...'));
  const ctx = await renderer();
  await initPhysics();
  ctx.scene = freshScene();
  setOverlay(config.devtools ? `Joining ${config.server} ...` : opts.mode === 'br' ? translate('Finding a match...') : translate('Joining the island...'));
  let session: Session;
  try {
    session = await Session.join(config.server, { mode: opts.mode, roomId: opts.roomId, create: opts.create, team: opts.team, name: opts.name, token: opts.token, character: opts.character }, { latencyMs: config.latencyMs, jitterMs: config.jitterMs, loss: config.loss }, config.spectate);
  } catch (err) {
    // The server refuses a second seat for the same player (another tab).
    if ((err as { code?: number }).code === ALREADY_IN_MATCH) {
      setOverlay(translate('You are already in this match in another tab or window.'), { stopped: true });
      throw Object.assign(new Error(translate('You are already in this match in another tab or window.')), { code: ALREADY_IN_MATCH });
    }
    throw err;
  }
  const st = session.room.state;
  // The menu's setting wins; `?quality=` only applies when the game starts without one.
  const quality = opts.settings.quality ? (opts.settings.quality === 'low' ? 'low' : 'high') : config.quality;
  let world;
  try {
    world = await buildWorld(ctx, st.mapId || 'greybox', st.seed, st.mapHash, {
      quality,
      // Phones on the low preset skip the shadow map (every lit pixel samples it).
      shadows: config.shadows && !(quality === 'low' && coarsePointer()),
      onProgress: (t) => setOverlay(t),
    });
  } catch (err) {
    session.leave();
    if (err instanceof MapMismatchError) {
      setOverlay(translate('This page is out of date with the game server. Reload to get the latest island.'), { stopped: true });
      reconnect.hidden = false;
    }
    throw err;
  }
  const game = new Game(ctx, session, world, canvas, hudEl, {
    mode: opts.mode,
    settings: opts.settings,
    exit: (reason, summary) => finish(reason, summary),
    touch: {
      pause: () => {
        game.touch?.setActive(false, true);
        setOverlay(COPY.touch.paused, { leave: true });
      },
      // A touch laptop's mouse clicked the touch layer: back to mouse play.
      mouse: () => {
        // A phone has no real mouse (some styluses report one): keep touch play.
        if (isTouchOnly()) return;
        game.touch?.setActive(false);
        setTouchGame(false);
        game.controlsRef.requestLock();
      },
    },
  });
  const entry = { game, session, mode: opts.mode, ended: false };
  current = entry;
  game.start();
  setOverlay(isTouchOnly() ? COPY.touch.tapToPlay : translate('Click to play'), { leave: true });
  if (config.autopilot || config.spectate) overlay.classList.add('hidden');

  // Server closed the connection: a finished battle royale ends normally, anything else is a disconnect.
  session.room.onLeave((code) => {
    if (current !== entry) return;
    if (code === CloseCode.CONSENTED) return;
    // The server took this player out, or closed the room (the menu says which).
    if (code === CLOSE_CODE.removed) return finish('removed');
    if (code === CLOSE_CODE.roomClosed && !game.br?.resultOpen) return finish('closed');
    if (session.room.state.phase === MatchPhase.Ended || game.br?.resultOpen) {
      // The results card stays up; its button returns to the menu.
      entry.ended = true;
      game.br?.serverClosed();
      return;
    }
    finish('disconnected');
  });
  session.room.onError((code, message) => console.error('[room] error', code, message));
  return { roomId: session.room.roomId };
}

/** Show a startup failure on the overlay (direct start without the menu). */
export function showStartError(err: unknown): void {
  console.error(err);
  if (overlay.dataset.stopped === '1') return;
  const detail = err instanceof Error ? err.message : String(err);
  setOverlay(
    import.meta.env.DEV ? `Could not start: ${detail}. Is the game server running (npm run dev)?` : translate('Could not reach the island right now. Please try again in a moment.'),
    { stopped: true },
  );
  reconnect.hidden = false;
}

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
import { config } from './config.ts';
import { Game, type ExitReason, type ExitSummary } from './game.ts';
import { Session } from './net/session.ts';
import { createRenderer, freshScene, type RenderContext } from './render/renderer.ts';
import { buildWorld, MapMismatchError } from './world/worldHandle.ts';

export type { ExitReason, ExitSummary } from './game.ts';

export interface StartGameOptions {
  mode: 'br' | 'dm';
  /** Battle royale: a room from the lobby list, or a new room; neither is Quick Play. */
  roomId?: string;
  create?: boolean;
  token?: string;
  name?: string;
  settings: { sensitivity: number; adsSensitivity?: number; fov: number; volume: number; quality?: 'low' | 'medium' | 'high' };
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
  if (exitCallback) {
    overlay.classList.add('hidden');
    exitCallback(reason, summary ?? cur.game.br?.summary() ?? { mode: cur.mode });
  } else if (reason === 'disconnected') {
    setOverlay('Disconnected from the island. Check your connection and reconnect.', { stopped: true });
  } else {
    setOverlay('Thanks for playing! Reload to drop in again.', { stopped: true });
    reconnect.hidden = false;
    reconnect.textContent = 'Play again';
  }
}

function ensureLeaveButton(): void {
  if (leaveButton) return;
  leaveButton = document.createElement('button');
  leaveButton.type = 'button';
  leaveButton.id = 'leave';
  leaveButton.textContent = 'Leave the match';
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
  overlay.addEventListener('click', () => {
    const cur = current;
    if (!cur || overlay.dataset.stopped === '1') return;
    cur.game.sound.unlock();
    cur.game.controlsRef.requestLock();
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
    if (locked || config.autopilot !== '' || config.spectate || cur.game.br?.resultOpen || cur.game.br?.inventoryOpen) overlay.classList.add('hidden');
    else setOverlay('Click to play', { leave: true });
  });
  window.addEventListener('beforeunload', () => current?.session.leave());
}

/** Join a match and play. Resolves once the game is running. */
export async function startGame(opts: StartGameOptions): Promise<void> {
  wireOnce();
  if (current) finish('left');
  setOverlay('Loading the island...');
  const ctx = await renderer();
  await initPhysics();
  ctx.scene = freshScene();
  setOverlay(config.devtools ? `Joining ${config.server} ...` : opts.mode === 'br' ? 'Finding a match...' : 'Joining the island...');
  let session: Session;
  try {
    session = await Session.join(config.server, { mode: opts.mode, roomId: opts.roomId, create: opts.create, name: opts.name, token: opts.token }, { latencyMs: config.latencyMs, jitterMs: config.jitterMs, loss: config.loss }, config.spectate);
  } catch (err) {
    // The server refuses a second seat for the same player (another tab).
    if ((err as { code?: number }).code === ALREADY_IN_MATCH) {
      setOverlay('You are already in this match in another tab or window.', { stopped: true });
      throw Object.assign(new Error('You are already in this match in another tab or window.'), { code: ALREADY_IN_MATCH });
    }
    throw err;
  }
  const st = session.room.state;
  let world;
  try {
    world = await buildWorld(ctx, st.mapId || 'greybox', st.seed, st.mapHash, {
      // The menu's setting wins; `?quality=` only applies when the game starts without one.
      quality: opts.settings.quality ? (opts.settings.quality === 'low' ? 'low' : 'high') : config.quality,
      shadows: config.shadows,
      onProgress: (t) => setOverlay(t),
    });
  } catch (err) {
    session.leave();
    if (err instanceof MapMismatchError) {
      setOverlay('This page is out of date with the game server. Reload to get the latest island.', { stopped: true });
      reconnect.hidden = false;
    }
    throw err;
  }
  const game = new Game(ctx, session, world, canvas, hudEl, {
    mode: opts.mode,
    settings: opts.settings,
    exit: (reason, summary) => finish(reason, summary),
  });
  const entry = { game, session, mode: opts.mode, ended: false };
  current = entry;
  game.start();
  setOverlay('Click to play', { leave: true });
  if (config.autopilot || config.spectate) overlay.classList.add('hidden');

  // Server closed the connection: a finished battle royale ends normally, anything else is a disconnect.
  session.room.onLeave((code) => {
    if (current !== entry) return;
    if (code === CloseCode.CONSENTED) return;
    if (session.room.state.phase === MatchPhase.Ended || game.br?.resultOpen) {
      // The results card stays up; its button returns to the menu.
      entry.ended = true;
      game.br?.serverClosed();
      return;
    }
    finish('disconnected');
  });
  session.room.onError((code, message) => console.error('[room] error', code, message));
}

/** Show a startup failure on the overlay (direct start without the menu). */
export function showStartError(err: unknown): void {
  console.error(err);
  if (overlay.dataset.stopped === '1') return;
  const detail = err instanceof Error ? err.message : String(err);
  setOverlay(
    import.meta.env.DEV ? `Could not start: ${detail}. Is the game server running (npm run dev)?` : 'Could not reach the island right now. Please try again in a moment.',
    { stopped: true },
  );
  reconnect.hidden = false;
}

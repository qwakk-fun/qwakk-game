/**
 * Entry: start the renderer and physics, join the room, build the island from
 * the server's seed, then hand over to the game loop.
 */
import { CloseCode } from '@colyseus/sdk';
import { initPhysics } from '@qwakk/shared';
import { config } from './config.ts';
import { Game } from './game.ts';
import { Session } from './net/session.ts';
import { createRenderer } from './render/renderer.ts';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;
const hudEl = document.getElementById('hud') as HTMLElement;
const reconnect = document.getElementById('reconnect') as HTMLButtonElement;

if (config.devtools) for (const el of document.querySelectorAll<HTMLElement>('.devonly')) el.hidden = false;

reconnect.addEventListener('click', (e) => {
  e.stopPropagation();
  location.reload();
});

/** Stop the game and show the overlay with a message and the Reconnect button. */
function showStopped(message: string): void {
  if (document.pointerLockElement) document.exitPointerLock();
  overlay.classList.remove('hidden');
  overlay.dataset.stopped = '1';
  status.textContent = message;
  reconnect.hidden = false;
}

async function boot(): Promise<void> {
  const [ctx] = await Promise.all([createRenderer(canvas, config), initPhysics()]);
  status.textContent = config.devtools ? `Joining ${config.server} ...` : 'Joining the island...';
  const session = await Session.join(config.server, config.name, { latencyMs: config.latencyMs, jitterMs: config.jitterMs, loss: config.loss });
  status.textContent = 'Click to play';

  const game = new Game(ctx, session, canvas, hudEl);
  game.start();

  // Server closed the connection (kicked, restart, network gone): say so instead of freezing.
  session.room.onLeave((code) => {
    if (code === CloseCode.CONSENTED) return; // we left on purpose (page unload)
    game.stop();
    showStopped('Disconnected from the island. Check your connection and reconnect.');
  });
  session.room.onError((code, message) => console.error('[room] error', code, message));

  const controls = game.controlsRef;
  overlay.addEventListener('click', () => {
    if (overlay.dataset.stopped !== '1') controls.requestLock();
  });
  canvas.addEventListener('click', () => {
    if (!controls.locked) controls.requestLock();
  });
  document.addEventListener('pointerlockchange', () => {
    if (overlay.dataset.stopped === '1') return;
    overlay.classList.toggle('hidden', document.pointerLockElement === canvas || config.autopilot);
  });
  if (config.autopilot) overlay.classList.add('hidden');
  window.addEventListener('beforeunload', () => session.leave());
}

boot().catch((err: unknown) => {
  console.error(err);
  const detail = err instanceof Error ? err.message : String(err);
  showStopped(
    import.meta.env.DEV
      ? `Could not start: ${detail}. Is the game server running (npm run dev)?`
      : 'Could not reach the island right now. Please try again in a moment.',
  );
});

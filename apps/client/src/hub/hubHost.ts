/**
 * Duck Plaza for the menu (ui/menu): enter the plaza as the picked duck
 * (join the hub room, load the map, start the loop) and get a handle to
 * steer it (team, pause sheet, toasts) and to leave it before a match. Part
 * of the game bundle (a dynamic import from the menu, like play.ts), so the
 * menu itself never loads Three.js.
 */
import { CloseCode } from '@colyseus/sdk';
import { initPhysics } from '@qwakk/shared';
import { parseHubMap, type PortalId } from '@qwakk/shared/hub';
import { config } from '../config.ts';
import { coarsePointer, isTouchOnly } from '../input/touch/device.ts';
import { enterPlayScreen, leavePlayScreen, setTouchGame } from '../input/touch/screen.ts';
import { freshScene } from '../render/renderer.ts';
import { sharedRenderer } from '../render/shared.ts';
import { COPY } from '../ui/menu/copy.ts';
import { buildWorld, MapMismatchError } from '../world/worldHandle.ts';
import { HubGame, type HubGameHooks, type TeamMember } from './hubGame.ts';
import { HubSession } from './hubSession.ts';

export interface EnterHubOptions {
  token?: string;
  character?: number;
  /** Signed in (every portal opens) or a guest (Deathmatch only). */
  account: boolean;
  /** Back from this mode: appear in front of its portal. */
  portal?: PortalId | null;
  settings: { sensitivity: number; touchSensitivity?: number; fov: number; volume: number; quality?: 'low' | 'medium' | 'high' };
  hooks: HubGameHooks & {
    /** The plaza connection closed by itself (`code`: the close code). */
    closed(code: number): void;
  };
}

export interface HubHandle {
  /** Leave the plaza (before a match, a sign-out, the duck select). */
  leave(): void;
  setTeam(members: TeamMember[]): void;
  /** The menu sheet opened or closed. `resume` must run inside a click or tap. */
  setPaused(on: boolean): void;
  resume(): void;
  applySettings(settings: EnterHubOptions['settings']): void;
  toast(text: string, action?: { label: string; run: () => void }): void;
  /** Touch play is on (the sheet then resumes into touch play). */
  readonly touch: boolean;
  readonly roomId: string;
}

const overlay = (): HTMLElement => document.getElementById('overlay') as HTMLElement;
const status = (): HTMLElement => document.getElementById('status') as HTMLElement;

function veil(text: string | null): void {
  const o = overlay();
  o.dataset.hub = '1';
  o.dataset.stopped = '';
  if (text === null) {
    o.classList.add('hidden');
    return;
  }
  o.classList.remove('hidden');
  status().textContent = text;
  (document.getElementById('reconnect') as HTMLElement).hidden = true;
  const leave = document.getElementById('leave');
  if (leave) leave.hidden = true;
}

let current: { game: HubGame; session: HubSession; closing: boolean } | null = null;

export async function enterHub(opts: EnterHubOptions): Promise<HubHandle> {
  current?.game.dispose();
  current?.session.leave();
  current = null;
  const touchOnly = isTouchOnly();
  setTouchGame(touchOnly);
  veil(COPY.hub.loading);
  try {
    const ctx = await sharedRenderer();
    await initPhysics();
    ctx.scene = freshScene();
    const session = await HubSession.join(config.server, { token: opts.token, character: opts.character, portal: opts.portal ?? null });
    const st = session.room.state;
    const quality = opts.settings.quality ? (opts.settings.quality === 'low' ? 'low' : 'high') : config.quality;
    let world;
    try {
      world = await buildWorld(ctx, st.mapId, st.seed, st.mapHash, { quality, shadows: config.shadows && !(quality === 'low' && coarsePointer()), onProgress: () => undefined });
    } catch (err) {
      session.leave();
      if (err instanceof MapMismatchError) throw Object.assign(new Error('map mismatch'), { code: 'map_mismatch' });
      throw err;
    }
    const raw = world.assets?.raw as { hub?: { pond?: unknown; fountain?: unknown } } | undefined;
    const hub = parseHubMap(raw);
    const pond = (raw?.hub?.pond ?? null) as { x: number; z: number; rx: number; rz: number; water: number } | null;
    const fountain = (raw?.hub?.fountain ?? null) as { x: number; y: number; z: number } | null;
    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const game = new HubGame(ctx, session, world, canvas, { settings: opts.settings, hub, pond, fountain, account: opts.account, hooks: opts.hooks });
    const entry = { game, session, closing: false };
    current = entry;
    document.body.classList.add('in-hub');
    game.start();
    veil(null);
    // Touch: the first tap goes fullscreen and landscape where the browser allows it, and turns the touch layer on.
    if (game.touch) {
      const startTouch = (e: PointerEvent): void => {
        if (e.pointerType === 'mouse' || game.touch?.active || entry.closing) return;
        game.touch?.setActive(true);
        game.ui.setTouch(true);
        game.audio.unlock();
        setTouchGame(true);
        void enterPlayScreen();
      };
      canvas.addEventListener('pointerdown', startTouch);
      game.ui.root.addEventListener('pointerdown', startTouch);
    }
    session.room.onLeave((code) => {
      if (entry.closing || current !== entry) return;
      if (code === CloseCode.CONSENTED) return;
      entry.closing = true;
      game.dispose();
      current = null;
      document.body.classList.remove('in-hub');
      opts.hooks.closed(code);
    });
    return {
      leave() {
        if (entry.closing) return;
        entry.closing = true;
        game.dispose();
        session.leave();
        document.body.classList.remove('in-hub');
        if (current === entry) current = null;
        if (!game.leaving) leavePlayScreen();
      },
      setTeam: (m) => game.setTeam(m),
      setPaused: (on) => game.setPaused(on),
      applySettings: (s) => game.applySettings(s),
      resume: () => game.resume(game.touch !== null && (touchOnly || game.touch.active || document.body.classList.contains('touch-ui'))),
      toast: (text, action) => game.ui.toast(text, action),
      get touch() {
        return game.touch?.active ?? false;
      },
      roomId: session.room.roomId,
    };
  } catch (err) {
    veil(null);
    throw err;
  }
}

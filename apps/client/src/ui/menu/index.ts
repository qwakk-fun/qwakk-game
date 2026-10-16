/**
 * Menu entry used by main.ts. The game module (Three.js, Rapier, Colyseus) is
 * loaded with a dynamic import: the menu paints first, the game bundle warms
 * up in the background, and Play awaits it.
 */
import { loadSettings, toGameSettings, type GameSettings } from '../../settings.ts';
import type { HeroModule } from './heroSlot.ts';
import { Menu, type ExitReason, type GameMode, type MatchSummary, type StartOptions } from './menu.ts';

export type { ExitReason, GameMode, MatchSummary, StartOptions } from './menu.ts';

/** What the game module exports (game.ts / play.ts). */
export interface GameEntry {
  startGame(opts: { mode: GameMode; roomId?: string; create?: boolean; team?: number; token?: string; name?: string; settings: GameSettings }): Promise<{ roomId: string } | void>;
  onGameExit(cb: (reason: ExitReason, summary?: MatchSummary) => void): void;
}

/**
 * Dev and test builds can skip the menu: `?mode=br` or `?mode=dm` (`&room=paris`
 * picks a room by id), and the
 * dev tools (`?autopilot=`, `?spectate=1`) start the game directly, as the
 * e2e scripts expect, unless `?menu=1` asks for the menu. Public builds always show the menu.
 */
export function directStart(devtools: boolean, search = location.search): StartOptions | null {
  if (!devtools) return null;
  const p = new URLSearchParams(search);
  // `?menu=1` keeps the menu even with dev tools in the URL (the party e2e plays through it with an autopilot).
  if (p.has('menu')) return null;
  const mode = p.get('mode');
  const tool = p.has('autopilot') || (p.get('spectate') ?? '0') !== '0';
  if (mode !== 'br' && mode !== 'dm' && !tool) return null;
  return { mode: mode === 'br' ? 'br' : 'dm', roomId: p.get('room') ?? undefined, name: p.get('name') ?? undefined, settings: toGameSettings(loadSettings()) };
}

/**
 * Show the menu; Play loads the game module on demand. `hero` loads the 3D
 * duck for the Play tab after the menu has painted (optional: the image stays).
 */
export function bootMenu(load: () => Promise<GameEntry>, hero?: () => Promise<HeroModule>): Menu {
  let entry: Promise<GameEntry> | null = null;
  let hooked = false;
  const get = (): Promise<GameEntry> => {
    entry ??= load().catch((err: unknown) => {
      entry = null;
      throw err;
    });
    return entry;
  };
  const menu = new Menu({
    async start(opts) {
      const game = await get();
      if (!hooked) {
        hooked = true;
        game.onGameExit((reason, summary) => menu.show({ reason, summary }));
      }
      return game.startGame(opts);
    },
    prefetch: () => void get().catch(() => {}),
    showQuality: true,
    hero,
  });
  menu.show();
  return menu;
}

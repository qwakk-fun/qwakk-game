/**
 * Menu entry used by main.ts. The game module (Three.js, Rapier, Colyseus) is
 * loaded with a dynamic import: the menu paints first, the game bundle warms
 * up in the background, and Play awaits it.
 */
import { loadSettings, toGameSettings, type GameSettings } from '../../settings.ts';
import { Menu, type ExitReason, type GameMode, type MatchSummary, type StartOptions } from './menu.ts';

export type { ExitReason, GameMode, MatchSummary, StartOptions } from './menu.ts';

/** What the game module exports (game.ts / play.ts). */
export interface GameEntry {
  startGame(opts: { mode: GameMode; roomId?: string; create?: boolean; token?: string; name?: string; settings: GameSettings }): Promise<void>;
  onGameExit(cb: (reason: ExitReason, summary?: MatchSummary) => void): void;
}

/**
 * Dev and test builds can skip the menu: `?mode=br` or `?mode=dm` (`&room=paris`
 * picks a room by id), and the
 * dev tools (`?autopilot=`, `?spectate=1`) start the game directly, as the
 * e2e scripts expect. Public builds always show the menu.
 */
export function directStart(devtools: boolean, search = location.search): StartOptions | null {
  if (!devtools) return null;
  const p = new URLSearchParams(search);
  const mode = p.get('mode');
  const tool = p.has('autopilot') || (p.get('spectate') ?? '0') !== '0';
  if (mode !== 'br' && mode !== 'dm' && !tool) return null;
  return { mode: mode === 'br' ? 'br' : 'dm', roomId: p.get('room') ?? undefined, name: p.get('name') ?? undefined, settings: toGameSettings(loadSettings()) };
}

/** Show the menu; Play loads the game module on demand. */
export function bootMenu(load: () => Promise<GameEntry>): Menu {
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
      await game.startGame(opts);
    },
    prefetch: () => void get().catch(() => {}),
    showQuality: true,
  });
  menu.show();
  return menu;
}

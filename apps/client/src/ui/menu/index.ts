/**
 * Menu entry used by main.ts. The game module (Three.js, Rapier, Colyseus) is
 * loaded with a dynamic import: the menu paints first, the game bundle warms
 * up in the background, and Play awaits it.
 */
import { loadSettings, toGameSettings, type GameSettings } from '../../settings.ts';
import type { HeroModule } from './heroSlot.ts';
import { characterById, gameId, loadCharacter } from './characters.ts';
import { Menu } from './menu.ts';
import type { EnterHubOptions, ExitReason, GameMode, HubHandleLike, MatchSummary, StartOptions } from './types.ts';

export type { ExitReason, GameMode, MatchSummary, StartOptions } from './types.ts';

/** What the game module exports (game.ts / play.ts). */
export interface GameEntry {
  startGame(opts: { mode: GameMode; roomId?: string; create?: boolean; team?: number; token?: string; name?: string; character?: number; settings: GameSettings }): Promise<{ roomId: string } | void>;
  onGameExit(cb: (reason: ExitReason, summary?: MatchSummary) => void): void;
  /** Duck Plaza, the hub between matches (src/hub/hubHost.ts). */
  enterHub(opts: EnterHubOptions): Promise<HubHandleLike>;
}

/**
 * Dev and test builds can skip the menu: `?mode=br` or `?mode=dm` (`&room=paris`
 * picks a room by id, `&character=mallard` a duck, else the remembered pick), and the
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
  if (mode !== 'br' && mode !== 'dm' && mode !== 'raid' && !tool) return null;
  const character = gameId(characterById(p.get('character'))?.id ?? loadCharacter());
  return { mode: mode === 'br' ? 'br' : mode === 'raid' ? 'raid' : 'dm', roomId: p.get('room') ?? undefined, name: p.get('name') ?? undefined, character, settings: toGameSettings(loadSettings()) };
}

/**
 * Show the menu (sign in, the character select); then Duck Plaza and the
 * matches load from the game module on demand. `hero` loads the 3D ducks of
 * the character select after the menu has painted (optional: the images stay).
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
  const hook = (game: GameEntry): GameEntry => {
    if (!hooked) {
      hooked = true;
      game.onGameExit((reason, summary) => menu.show({ reason, summary }));
    }
    return game;
  };
  const menu = new Menu({
    async start(opts) {
      return hook(await get()).startGame(opts);
    },
    load: async () => hook(await get()),
    prefetch: () => void get().catch(() => {}),
    showQuality: true,
    hero,
  });
  menu.show();
  return menu;
}

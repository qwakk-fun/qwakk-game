/** The menu's contract with the game module (play.ts) and main.ts. Types only. */
import type { GameSettings } from '../../settings.ts';
import type { HeroModule } from './heroSlot.ts';

export type GameMode = 'br' | 'dm' | 'raid';
/** removed: the server took the player out of the match; closed: the room was closed. */
export type ExitReason = 'ended' | 'left' | 'disconnected' | 'removed' | 'closed';

/** Optional numbers the game may hand back with onGameExit. */
export interface MatchSummary {
  mode?: GameMode;
  placement?: number;
  players?: number;
  kills?: number;
  points?: number;
  /** Hunt Season: waves held, XP gained, and "Play again" from the end screen. */
  waves?: number;
  xp?: number;
  again?: boolean;
}

export interface StartOptions {
  mode: GameMode;
  /** Join this room from the list (joinById; battle royale or deathmatch) ... */
  roomId?: string;
  /** ... or open a new room (create). Neither: Quick Play (joinOrCreate). */
  create?: boolean;
  /** Battle royale team size for a room we create or Quick Play into (1 solo, 2 duo, 4 squad). */
  team?: number;
  token?: string;
  name?: string;
  /** The picked duck (shared catalog id, `@qwakk/shared/characters`), sent as a join option. */
  character?: number;
  settings: GameSettings;
}

/** Where a Play press goes: a listed room, a new room, or Quick Play (neither). */
export interface PlayTarget {
  roomId?: string;
  create?: boolean;
  team?: number;
}

export interface MenuHooks {
  /** Load the game and join; resolves once the player is in, with the room joined. */
  start(opts: StartOptions): Promise<{ roomId: string } | void>;
  /** Warm the game bundle in the background after the menu has painted. */
  prefetch?(): void;
  /** Show the graphics preset (only when the game applies it). */
  showQuality?: boolean;
  /** Load the 3D duck for the Play tab (src/menuHero); without it the image stays. */
  hero?(): Promise<HeroModule>;
}

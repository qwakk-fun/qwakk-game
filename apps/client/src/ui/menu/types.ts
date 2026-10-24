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

/** A member of the team as the plaza shows it (the party view: names and tags only). */
export interface HubTeamMember {
  name: string;
  tag: string;
  leader: boolean;
  you: boolean;
  busy: boolean;
}

/** What the plaza (src/hub/hubHost.ts) takes to start. Types only, so the menu never imports the game. */
export interface EnterHubOptions {
  token?: string;
  character?: number;
  account: boolean;
  portal?: GameMode | null;
  settings: GameSettings;
  hooks: {
    portal(mode: GameMode): void;
    party(code: string): void;
    leaveTeam(): void;
    signIn(): void;
    pause(): void;
    /** At a market stall (E or a tap): open its shop (the Blacksmith, the Armorer). */
    shop?(id: 'smith' | 'armorer'): void;
    closed(code: number): void;
  };
}

/** The menu's handle on the plaza while it is open. */
export interface HubHandleLike {
  leave(): void;
  setTeam(members: HubTeamMember[]): void;
  setPaused(on: boolean): void;
  resume(): void;
  applySettings(settings: GameSettings): void;
  toast(text: string, action?: { label: string; run: () => void }): void;
  readonly touch: boolean;
  readonly roomId: string;
}

export interface MenuHooks {
  /** Load the game and join; resolves once the player is in, with the room joined. */
  start(opts: StartOptions): Promise<{ roomId: string } | void>;
  /** The game bundle (it holds the plaza too). */
  load(): Promise<{ enterHub(opts: EnterHubOptions): Promise<HubHandleLike> }>;
  /** Warm the game bundle in the background after the menu has painted. */
  prefetch?(): void;
  /** Show the graphics preset (only when the game applies it). */
  showQuality?: boolean;
  /** Load the 3D duck for the Play tab (src/menuHero); without it the image stays. */
  hero?(): Promise<HeroModule>;
}

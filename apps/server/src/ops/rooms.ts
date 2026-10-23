/**
 * The game rooms of this process (deathmatch and battle royale), for the
 * admin panel: every GameRoom adds itself on create and removes itself on
 * dispose. One server instance only, so this is every game room there is.
 * The info is for the authenticated admin only; nothing here goes to players.
 */

export interface RoomInfo {
  roomId: string;
  kind: 'dm' | 'br' | 'raid';
  label: string;
  /** Free for all (deathmatch), Solo, Duo or Squad. */
  mode: string;
  mapId: string;
  humans: number;
  bots: number;
  spectators: number;
  /** Warmup, countdown, playing, intermission, ended, idle. */
  phase: string;
  secondsLeft: number;
  locked: boolean;
  maxHumans: number;
  /** Tick time over the last few seconds (ms). */
  tick: { avg: number; p95: number; max: number; samples: number };
  createdAt: number;
}

export interface RoomPlayer {
  sessionId: string;
  name: string;
  tag: string;
  playerId: string | null;
  bot: boolean;
  spectator: boolean;
  alive: boolean;
  kills: number;
  deaths: number;
  team: number;
  pingMs: number;
}

export interface LiveRoom {
  readonly roomId: string;
  roomInfo(): RoomInfo;
  roomPlayers(): RoomPlayer[];
  /** Take a connected player out (it goes back to the menu with a message). */
  removePlayer(sessionId: string): boolean;
  /** Take out every seat of this player id; returns how many. */
  removePlayerId(playerId: string): number;
  /** The address a connected player joined from (memory only, never stored). */
  ipOf(sessionId: string): string | null;
  /** Show a short notice in every player's HUD. */
  notice(text: string): void;
  /** Close the room: everyone in it goes back to the menu. */
  close(): Promise<unknown>;
}

export const liveRooms = new Set<LiveRoom>();

export function findRoom(roomId: string): LiveRoom | null {
  for (const r of liveRooms) if (r.roomId === roomId) return r;
  return null;
}

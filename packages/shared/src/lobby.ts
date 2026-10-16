/**
 * Lobby rooms: what the menu's live room list shows for each battle royale
 * room, shared by the server (room metadata) and the menu.
 *
 * Pure data and string helpers (only constants.ts, which imports nothing),
 * so the menu can load it (`@qwakk/shared/lobby`) without Rapier or the sim.
 */
import { BR } from './constants.ts';

/** The default start rule, for the menu's explanation (a server may run other numbers in tests). */
export const START_RULE = { minHumans: BR.minHumans, countdownSeconds: BR.countdownSeconds, players: BR.players } as const;

/** Colyseus room name of the lobby (the built-in LobbyRoom, filtered to battle royale rooms). */
export const LOBBY_ROOM = 'lobby';

/** A room's stage in the list. */
export type RoomStage = 'waiting' | 'countdown' | 'playing' | 'ended';

/**
 * Room metadata the lobby sends to every menu. Public by design: a label,
 * counts and the stage. Never player ids, names, IPs or tokens.
 */
export interface RoomListing {
  /** Friendly room name, derived from the room id (roomLabel). */
  label: string;
  stage: RoomStage;
  /** Real players in the room (bots and spectators not counted). */
  humans: number;
  /** Most humans the room takes. */
  cap: number;
  /** More humans needed before the countdown starts (0 once it runs). */
  need: number;
  /** Countdown seconds left (stage 'countdown'), else 0. */
  left: number;
}

/**
 * Matchmaking refusals for room creation (HTTP status and error code of the
 * matchmake request, so they must be valid HTTP statuses).
 */
export const LOBBY_ERROR = {
  /** This address created too many rooms recently. */
  createLimited: 529,
  /** The server already runs its most rooms. */
  roomsFull: 530,
} as const;

const ADJ = ['Muddy', 'Sunny', 'Foggy', 'Breezy', 'Misty', 'Golden', 'Quiet', 'Rowdy', 'Salty', 'Sleepy', 'Windy', 'Lucky', 'Mossy', 'Rainy', 'Crispy', 'Bubbly'];
const PLACE = ['Pond', 'Marsh', 'Creek', 'Harbor', 'Meadow', 'Orchard', 'Lagoon', 'Puddle', 'Mill', 'Dock', 'Bay', 'Reeds'];

/** A stable, friendly name for a room id, for example "Misty Harbor". */
export function roomLabel(roomId: string): string {
  let h = 2166136261;
  for (let i = 0; i < roomId.length; i++) h = Math.imul(h ^ roomId.charCodeAt(i), 16777619) >>> 0;
  return `${ADJ[h % ADJ.length]} ${PLACE[(h >>> 8) % PLACE.length]}`;
}

/** Short room id shown next to the label, so two rooms with the same label still differ. */
export function shortRoomId(roomId: string): string {
  return roomId.slice(0, 4).toUpperCase();
}

/** Lobby list order: rooms you can join first (closest to starting first), then the rest. */
export function compareListings(a: RoomListing, b: RoomListing): number {
  const rank = (r: RoomListing): number => (r.stage === 'countdown' ? 0 : r.stage === 'waiting' ? 1 : r.stage === 'playing' ? 2 : 3);
  return rank(a) - rank(b) || b.humans - a.humans;
}

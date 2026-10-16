/**
 * Lobby rooms: what the menu's live room list shows for each battle royale
 * room and each of the static deathmatch rooms, shared by the server (room
 * metadata) and the menu.
 *
 * Pure data and string helpers (only constants.ts, which imports nothing),
 * so the menu can load it (`@qwakk/shared/lobby`) without Rapier or the sim.
 */
import { BR, MATCH, ROOM } from './constants.ts';

/** The default start rule, for the menu's explanation (a server may run other numbers in tests). */
export const START_RULE = { minHumans: BR.minHumans, countdownSeconds: BR.countdownSeconds, players: BR.players } as const;

/** Battle royale rooms one server opens at once (the default; QWAKK_BR_MAX_ROOMS can change it on the server). */
export const BR_ROOM_CAP: number = BR.maxRooms;

/** Colyseus room name of the lobby (the built-in LobbyRoom, filtered to our game rooms). */
export const LOBBY_ROOM = 'lobby';

/**
 * The deathmatch rooms: always open, created by the server at start (never by
 * a client) and never closed. `id` is the Colyseus room id (joinById), `label`
 * the name the menu shows. Ids stay lowercase a to z.
 */
export const DM_ROOM_CATALOG = [
  { id: 'istanbul', label: 'Istanbul' },
  { id: 'paris', label: 'Paris' },
  { id: 'hongkong', label: 'Hong Kong' },
] as const;

/** Deathmatch rooms open at launch: the first entries of the catalog. Raise to open Paris, then Hong Kong. */
export const DM_OPEN_ROOMS = 1;

/** The open deathmatch rooms (server and menu both read this list). */
export const DM_ROOMS: readonly (typeof DM_ROOM_CATALOG)[number][] = DM_ROOM_CATALOG.slice(0, DM_OPEN_ROOMS);

/** Deathmatch room size for the menu (humans plus bots). */
export const DM_RULE = { players: MATCH.players, cap: ROOM.maxClients } as const;

/** Is this a static deathmatch room id? */
export function isDmRoomId(id: string): boolean {
  return DM_ROOMS.some((r) => r.id === id);
}

/** A room's stage in the list. */
export type RoomStage = 'waiting' | 'countdown' | 'playing' | 'ended';

/**
 * Room metadata the lobby sends to every menu. Public by design: a label,
 * counts and the stage. Never player ids, names, IPs or tokens.
 */
export interface RoomListing {
  /** Battle royale (default when missing) or a static deathmatch room. */
  mode?: 'br' | 'dm';
  /** Friendly room name: derived from the room id (roomLabel), or the deathmatch room's name. */
  label: string;
  stage: RoomStage;
  /** Real players in the room (bots and spectators not counted). Deathmatch: bots fill the rest of the 32 seats. */
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

/** Deathmatch rooms in their fixed order (DM_ROOMS). */
export function compareDmRooms(a: string, b: string): number {
  const i = (id: string): number => {
    const k = DM_ROOMS.findIndex((r) => r.id === id);
    return k < 0 ? DM_ROOMS.length : k;
  };
  return i(a) - i(b) || a.localeCompare(b);
}

/** Lobby list order: rooms you can join first (closest to starting first), then the rest. */
export function compareListings(a: RoomListing, b: RoomListing): number {
  const rank = (r: RoomListing): number => (r.stage === 'countdown' ? 0 : r.stage === 'waiting' ? 1 : r.stage === 'playing' ? 2 : 3);
  return rank(a) - rank(b) || b.humans - a.humans;
}

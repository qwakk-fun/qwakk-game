/**
 * Lobby rooms: what the menu's live room list shows for each battle royale
 * room and each of the static deathmatch rooms, shared by the server (room
 * metadata) and the menu.
 *
 * Pure data and string helpers (only constants.ts, which imports nothing),
 * so the menu can load it (`@qwakk/shared/lobby`) without Rapier or the sim.
 */
import { BR, MATCH, PARTY, ROOM, TEAM_SIZES } from './constants.ts';

/** Party and team numbers for the menu (which must not import the sim). */
export { PARTY, TEAM_SIZES };

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
  /** Real players in the room (bots and spectators not counted). Deathmatch: bots fill the rest of the `MATCH.players` seats. */
  humans: number;
  /** Most humans the room takes. */
  cap: number;
  /** More humans needed before the countdown starts (0 once it runs). */
  need: number;
  /** Countdown seconds left (stage 'countdown'), else 0. */
  left: number;
  /** Battle royale: ducks per team (1 solo, 2 duo, 4 squad; missing: solo). */
  team?: number;
  /** Battle royale: the most ducks one team can still take (a party needs at least its size). */
  fit?: number;
}

/** A battle royale team size from untrusted input (join options, a listing): 1, 2 or 4, else solo. */
export function teamSizeOf(v: unknown): number {
  return typeof v === 'number' && (TEAM_SIZES as readonly number[]).includes(v) ? v : 1;
}

/** The team mode a party of this size needs (solo, duo, squad). */
export function teamSizeFor(partySize: number): number {
  return TEAM_SIZES.find((t) => t >= partySize) ?? TEAM_SIZES[TEAM_SIZES.length - 1]!;
}

/**
 * Quick Play for a battle royale from the live list: the open room (waiting
 * or counting down, not locked) whose teams fit the whole party (`want`: a
 * team size to insist on, else any that fits), most humans first. Null:
 * create one.
 */
export function pickQuickRoom<T extends { roomId: string; locked: boolean; listing: RoomListing }>(rooms: readonly T[], partySize: number, want?: number): T | null {
  const open = rooms.filter((r) => {
    const l = r.listing;
    if (l.mode === 'dm' || r.locked || (l.stage !== 'waiting' && l.stage !== 'countdown') || l.humans >= l.cap) return false;
    const team = teamSizeOf(l.team);
    if (want !== undefined && team !== want) return false;
    return team >= partySize && (l.fit ?? team) >= partySize;
  });
  open.sort((a, b) => compareListings(a.listing, b.listing) || a.roomId.localeCompare(b.roomId));
  return open[0] ?? null;
}

/** Messages of the party room (apps/server/src/party/PartyRoom.ts). */
export const PartyMsg = {
  /** Server to client: the party as this member sees it (PartyView). */
  View: 'party',
  /**
   * Client to server, the leader only: { mode, roomId } of the game room it
   * just joined (the server checks it is seated there). Server to client: the
   * same, to every member in the menu, who then joins that room.
   */
  Go: 'go',
} as const;

/** One member as the party shows it. Names and tags only: no player ids, no tokens. */
export interface PartyMemberView {
  name: string;
  tag: string;
  leader: boolean;
  /** In a match right now (the leader's next room does not pull it). */
  busy: boolean;
  /** This is you. */
  you: boolean;
}

export interface PartyView {
  code: string;
  members: PartyMemberView[];
}

export interface PartyGo {
  mode: 'br' | 'dm';
  roomId: string;
}

/** Game room join refusals about parties and teams (onAuth errors, see gameRoom.ts JOIN_ERROR). */
export const TEAM_ERROR = {
  /** The party is bigger than this room's teams. */
  partyTooBig: 4410,
  /** No team in this room has room for the party (or for one more duck). */
  noTeam: 4411,
} as const;

const CODE_RE = new RegExp(`^[${PARTY.codeAlphabet}]{${PARTY.codeLength}}$`);

/** A party code from what someone typed or pasted (a link works too), or null. */
export function partyCodeOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  const m = /[?&]party=([^&#\s]+)/i.exec(s);
  if (m) s = m[1] ?? '';
  s = s.toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(s) ? s : null;
}

/** Is this string shaped like a party code (the matchmaking guard rate-limits joins by code)? */
export function isPartyCode(s: string): boolean {
  return CODE_RE.test(s);
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
  /** This address tried too many party codes recently. */
  joinLimited: 531,
  /** Parties are joined by code only (no join or Quick Play into a party). */
  codeOnly: 532,
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

/**
 * Guard around Colyseus' HTTP matchmaking (POST /matchmake/:method/:room).
 *
 * Colyseus 0.18 has no hook for "a client is about to create a room": a
 * room's static onAuth runs for every method alike and onCreate never sees
 * the caller. So we wrap `matchMaker.controller.invokeMethod`, the one entry
 * every matchmaking request goes through, and:
 *
 *   - keep only the client options a room reads (name, token, spectate,
 *     team, character, the hub portal; the lobby takes none). Everything else a client sends would otherwise reach
 *     onCreate merged over nothing (seat counts, seeds, timers);
 *   - refuse `create` on rooms that are not player-creatable (the lobby);
 *   - never create a join-only room (the static deathmatch rooms, opened by
 *     the server at start): `create` is refused and Quick Play's
 *     `joinOrCreate` becomes a plain `join` (the open room with the most
 *     players, by the room type's sort; an error when every one is full);
 *   - limit new rooms per IP (`create`, or a joinOrCreate that finds no open
 *     room) and cap the rooms open per room type (BR.maxRooms);
 *   - parties (party/PartyRoom.ts): created under their own per-IP limit,
 *     joined by code only (`joinById`, rate-limited per IP so codes cannot be
 *     guessed quickly), never by `join` or Quick Play;
 *   - account-only rooms (battle royale): a guest session, or a player whose
 *     party has a guest, is refused before any room opens (the room's onAuth
 *     checks the same again for every join).

 *
 * The IP comes from the AuthContext, whose X-Real-IP the meta layer rewrites
 * on every request (guardJoinIps), so it is our own answer, not the client's.
 */
import { ServerError } from '@colyseus/core';
import { isCharacterId, TEAM_SIZES } from '@qwakk/shared';
import { isPartyCode, LOBBY_ERROR } from '@qwakk/shared/lobby';
import { ACCOUNT_ERROR } from '@qwakk/shared/accounts';
import { isPortalId } from '@qwakk/shared/hub';

/** The part of `matchMaker.controller` we wrap (A: Colyseus' AuthContext). */
export interface MatchmakingController<A extends { ip?: string | undefined }> {
  invokeMethod(method: string, roomName: string, clientOptions?: unknown, authOptions?: A): Promise<unknown>;
}

export interface GuardOptions {
  /** Most rooms open at once per room name; rooms not listed are not capped. */
  maxRooms: Record<string, number>;
  /** Room names a client may never `create` (they are joined with joinOrCreate only). */
  noCreate: string[];
  /** Room names a client never creates in any way (static rooms): joinOrCreate becomes join. */
  joinOnly?: string[];
  /** Rooms currently open with this name. */
  countRooms(roomName: string): Promise<number>;
  /** Is there an open room a joinOrCreate would join (so nothing new gets created)? */
  hasOpenRoom(roomName: string): Promise<boolean>;
  /** Per-IP limit on new rooms (meta allowCreateRoom). */
  allowCreate(ip: string): boolean;
  /** IP from the auth context (meta joinIp). */
  ipOf(auth: { ip?: string | undefined } | undefined): string;
  /** Party rooms: their name and per-IP limits for creating one and for joining by code. */
  party?: { roomName: string; allowCreate(ip: string): boolean; allowJoin(ip: string): boolean };
  /**
   * Server policy for a game room a request would open (maintenance, a team
   * mode switched off; the admin settings): throws a ServerError to refuse.
   */
  beforeCreate?(roomName: string, options: Record<string, unknown>): void;
  /** Does this room name take `{ spectate: true }` joins (QWAKK_SPECTATORS, tests)? Default: none does. */
  spectators?(roomName: string): boolean;
  /** Rooms only signed-in players may join or open (battle royale), and how to tell. */
  accountOnly?: {
    rooms: string[];
    /** The verified identity behind a session token (meta verifySession), or null. */
    identify(token: string | undefined): Promise<{ playerId: string; account: boolean } | null>;
    /** Has this player's party a guest in it (party registry)? */
    partyHasGuest(playerId: string): boolean;
    /** The room name of an open room by id (joinById), or undefined. */
    roomNameOf(roomId: string): string | undefined;
  };
}

/**
 * Refuse a guest (or a party with a guest) a room of an account-only kind.
 * An invalid or missing token passes here: the room's onAuth refuses it.
 */
export async function checkAccount(method: string, roomName: string, options: Record<string, unknown>, o: Pick<GuardOptions, 'accountOnly'>): Promise<void> {
  const a = o.accountOnly;
  if (!a || options.spectate === true) return;
  const name = method === 'joinById' ? a.roomNameOf(roomName) : roomName;
  if (!name || !a.rooms.includes(name)) return;
  const who = await a.identify(typeof options.token === 'string' ? options.token : undefined);
  if (!who) return;
  if (!who.account) throw new ServerError(ACCOUNT_ERROR.needsAccount, 'this mode needs an account, sign in first');
  if (a.partyHasGuest(who.playerId)) throw new ServerError(ACCOUNT_ERROR.partyHasGuest, 'your party has a guest; guests play deathmatch only');
}

/**
 * The join options rooms read; anything else is dropped. `spectate` is kept
 * only for a room that really takes spectators (`spectators`, tests and
 * tools): everywhere else it would skip the maintenance, account and team
 * checks of a join that then takes a normal seat.
 */
export function cleanClientOptions(roomName: string, lobbyName: string, raw: unknown, spectators = false): Record<string, unknown> {
  if (roomName === lobbyName || !raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof o.name === 'string') out.name = o.name.slice(0, 32);
  if (typeof o.token === 'string') out.token = o.token.slice(0, 1024);
  if (o.spectate === true && spectators) out.spectate = true;
  // Battle royale team size at creation (solo, duo, squad); other rooms ignore it.
  if (typeof o.team === 'number' && (TEAM_SIZES as readonly number[]).includes(o.team)) out.team = o.team;
  // The picked duck (looks only): a catalog id or nothing (the room falls back to the classic duck).
  if (isCharacterId(o.character)) out.character = o.character;
  // The hub: back from this mode, appear in front of its portal (a portal id or nothing).
  if (isPortalId(o.portal)) out.portal = o.portal;
  return out;
}

/**
 * Decide whether a matchmaking call may go ahead. Throws a ServerError with a
 * LOBBY_ERROR code when it would open a room over a limit.
 */
export async function checkCreate(method: string, roomName: string, ip: string, o: GuardOptions, options: Record<string, unknown> = {}): Promise<void> {
  if (o.party) {
    // joinById names a room id: a party code is limited per IP (no guessing codes at speed).
    if (method === 'joinById' && isPartyCode(roomName) && !o.party.allowJoin(ip)) throw new ServerError(LOBBY_ERROR.joinLimited, 'too many party codes tried, wait a moment');
    if (roomName === o.party.roomName) {
      if (method === 'join' || method === 'joinOrCreate') throw new ServerError(LOBBY_ERROR.codeOnly, 'parties are joined by code');
      if (method === 'create' && !o.party.allowCreate(ip)) throw new ServerError(LOBBY_ERROR.createLimited, 'too many new parties, try again in a minute');
      return;
    }
  }
  if (method !== 'create' && method !== 'joinOrCreate') return;
  if (o.joinOnly?.includes(roomName)) {
    if (method === 'create') throw new ServerError(LOBBY_ERROR.roomsFull, 'rooms of this kind cannot be created');
    return; // joinOrCreate runs as join (matchmakingMethod)
  }
  if (method === 'create' && o.noCreate.includes(roomName)) throw new ServerError(LOBBY_ERROR.roomsFull, 'rooms of this kind cannot be created');
  // joinOrCreate only opens a room when none is open; joining is limited elsewhere (allowJoin).
  if (method === 'joinOrCreate' && (o.noCreate.includes(roomName) || (await o.hasOpenRoom(roomName)))) return;
  o.beforeCreate?.(roomName, options);
  const cap = o.maxRooms[roomName];
  if (cap !== undefined && (await o.countRooms(roomName)) >= cap) throw new ServerError(LOBBY_ERROR.roomsFull, 'every room is taken, join one of the open rooms');
  if (!o.allowCreate(ip)) throw new ServerError(LOBBY_ERROR.createLimited, 'too many new rooms, join one or try again in a minute');
}

/** The matchmaking method actually run: Quick Play on a join-only room only joins. */
export function matchmakingMethod(method: string, roomName: string, o: Pick<GuardOptions, 'joinOnly'>): string {
  return method === 'joinOrCreate' && o.joinOnly?.includes(roomName) ? 'join' : method;
}

/** Wrap the controller's invokeMethod with the option filter and the creation limits. */
export function installMatchmakingGuard<A extends { ip?: string | undefined }>(controller: MatchmakingController<A>, lobbyName: string, o: GuardOptions): void {
  const inner = controller.invokeMethod.bind(controller);
  controller.invokeMethod = async (method: string, roomName: string, clientOptions?: unknown, authOptions?: A) => {
    // Reconnection carries its own token and nothing a room reads at creation.
    if (method === 'reconnect') return inner(method, roomName, clientOptions, authOptions);
    // joinById names a room id: a spectate flag is only honoured for known rooms that take spectators.
    const name = method === 'joinById' ? (o.accountOnly?.roomNameOf(roomName) ?? '') : roomName;
    const options = cleanClientOptions(roomName, lobbyName, clientOptions, o.spectators?.(name) === true);
    // Before the creation limits, so a refused guest does not use up its IP's room budget.
    await checkAccount(method, roomName, options, o);
    await checkCreate(method, roomName, o.ipOf(authOptions), o, options);
    return inner(matchmakingMethod(method, roomName, o), roomName, options, authOptions);
  };
}

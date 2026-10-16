/**
 * Guard around Colyseus' HTTP matchmaking (POST /matchmake/:method/:room).
 *
 * Colyseus 0.18 has no hook for "a client is about to create a room": a
 * room's static onAuth runs for every method alike and onCreate never sees
 * the caller. So we wrap `matchMaker.controller.invokeMethod`, the one entry
 * every matchmaking request goes through, and:
 *
 *   - keep only the client options a room reads (name, token, spectate; the
 *     lobby takes none). Everything else a client sends would otherwise reach
 *     onCreate merged over nothing (seat counts, seeds, timers);
 *   - refuse `create` on rooms that are not player-creatable (the lobby);
 *   - never create a join-only room (the static deathmatch rooms, opened by
 *     the server at start): `create` is refused and Quick Play's
 *     `joinOrCreate` becomes a plain `join` (the open room with the most
 *     players, by the room type's sort; an error when every one is full);
 *   - limit new rooms per IP (`create`, or a joinOrCreate that finds no open
 *     room) and cap the rooms open per room type (BR.maxRooms).
 *
 * The IP comes from the AuthContext, whose X-Real-IP the meta layer rewrites
 * on every request (guardJoinIps), so it is our own answer, not the client's.
 */
import { ServerError } from '@colyseus/core';
import { LOBBY_ERROR } from '@qwakk/shared/lobby';

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
}

/** The join options rooms read; anything else is dropped. */
export function cleanClientOptions(roomName: string, lobbyName: string, raw: unknown): Record<string, unknown> {
  if (roomName === lobbyName || !raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof o.name === 'string') out.name = o.name.slice(0, 32);
  if (typeof o.token === 'string') out.token = o.token.slice(0, 1024);
  if (o.spectate === true) out.spectate = true;
  return out;
}

/**
 * Decide whether a matchmaking call may go ahead. Throws a ServerError with a
 * LOBBY_ERROR code when it would open a room over a limit.
 */
export async function checkCreate(method: string, roomName: string, ip: string, o: GuardOptions): Promise<void> {
  if (method !== 'create' && method !== 'joinOrCreate') return;
  if (o.joinOnly?.includes(roomName)) {
    if (method === 'create') throw new ServerError(LOBBY_ERROR.roomsFull, 'rooms of this kind cannot be created');
    return; // joinOrCreate runs as join (matchmakingMethod)
  }
  if (method === 'create' && o.noCreate.includes(roomName)) throw new ServerError(LOBBY_ERROR.roomsFull, 'rooms of this kind cannot be created');
  // joinOrCreate only opens a room when none is open; joining is limited elsewhere (allowJoin).
  if (method === 'joinOrCreate' && (o.noCreate.includes(roomName) || (await o.hasOpenRoom(roomName)))) return;
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
    await checkCreate(method, roomName, o.ipOf(authOptions), o);
    return inner(matchmakingMethod(method, roomName, o), roomName, cleanClientOptions(roomName, lobbyName, clientOptions), authOptions);
  };
}

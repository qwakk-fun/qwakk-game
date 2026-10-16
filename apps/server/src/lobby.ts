/**
 * The lobby: Colyseus' built-in LobbyRoom (0.18) with realtime listing on the
 * battle royale and deathmatch room types. It sends every menu the full list
 * on join, then `+` (added or changed) and `-` (removed) messages as rooms are created,
 * fill up, count down, start and close. Each entry is the room's IRoomCache:
 * room id, name, client counts, locked, process id, created at, and our
 * metadata (RoomListing: label, stage, humans, need, countdown). No IPs,
 * names or tokens are in it.
 *
 * Changes from the stock room, kept small:
 *   - only battle royale and the static deathmatch rooms are listed, whatever
 *     filter a client sends (the stock room trusts the client's filter and would list every room);
 *   - a per-IP connection limit (meta allowLobby), since the stock room has no auth.
 */
import { LobbyRoom, type AuthContext, type Client } from '@colyseus/core';
import { BR, ROOM } from '@qwakk/shared';
import { allowLobby, joinIp } from './meta/index.ts';

/** Menus connected at once (each one is a WebSocket and a list copy). */
const MAX_LOBBY_CLIENTS = 2000;

export class QwakkLobby extends LobbyRoom {
  override maxClients = MAX_LOBBY_CLIENTS;
  // Every filter message is answered with the full list: cap them.
  override maxMessagesPerSecond = 5;

  override onAuth(_client: Client, _options: unknown, context?: AuthContext): boolean {
    if (!allowLobby(joinIp(context as never))) throw new Error('too many connections, try again in a moment');
    return true;
  }

  protected override filterItemForClient(room: { name: string }): boolean {
    return room.name === BR.roomName || room.name === ROOM.name;
  }

  protected override filterItemsForClient(): typeof this.rooms {
    return this.rooms.filter((room) => this.filterItemForClient(room));
  }
}

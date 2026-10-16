/**
 * Live battle royale room list: a connection to the server's lobby room
 * (Colyseus' built-in LobbyRoom, see apps/server/src/lobby.ts). The server
 * sends the full list on join, then `+` (added or changed) and `-` (removed).
 *
 * Loaded with a dynamic import by the rooms panel, so the Colyseus SDK is not
 * in the menu's first chunk.
 */
import { Client } from '@colyseus/sdk';
import { compareListings, LOBBY_ROOM, type RoomListing } from '@qwakk/shared/lobby';

export interface LobbyEntry {
  roomId: string;
  /** Locked rooms (started, or about to) cannot be joined. */
  locked: boolean;
  listing: RoomListing;
}

export interface LobbyConnection {
  close(): void;
}

interface CacheRow {
  roomId?: unknown;
  locked?: unknown;
  metadata?: unknown;
}

function toEntry(roomId: string, row: CacheRow): LobbyEntry | null {
  const m = row.metadata as Partial<RoomListing> | undefined;
  if (!m || typeof m.stage !== 'string' || typeof m.humans !== 'number') return null;
  const listing: RoomListing = {
    label: String(m.label ?? ''),
    stage: m.stage,
    humans: m.humans,
    cap: Number(m.cap ?? 16),
    need: Number(m.need ?? 0),
    left: Number(m.left ?? 0),
  };
  return { roomId, locked: row.locked === true, listing };
}

/**
 * Join the lobby. `onRooms` gets the sorted list after every change; `onDrop`
 * is called once if the connection closes without `close()`.
 */
export async function connectLobby(endpoint: string, onRooms: (rooms: LobbyEntry[]) => void, onDrop: () => void): Promise<LobbyConnection> {
  const room = await new Client(endpoint).joinOrCreate(LOBBY_ROOM);
  const rooms = new Map<string, LobbyEntry>();
  let closed = false;
  const emit = (): void => onRooms([...rooms.values()].sort((a, b) => compareListings(a.listing, b.listing) || a.roomId.localeCompare(b.roomId)));
  const put = (id: string, row: CacheRow): void => {
    const e = toEntry(id, row);
    if (e) rooms.set(id, e);
    else rooms.delete(id);
  };
  room.onMessage('rooms', (list: CacheRow[]) => {
    rooms.clear();
    for (const row of Array.isArray(list) ? list : []) if (typeof row.roomId === 'string') put(row.roomId, row);
    emit();
  });
  room.onMessage('+', (msg: [string, CacheRow]) => {
    if (!Array.isArray(msg) || typeof msg[0] !== 'string') return;
    put(msg[0], msg[1] ?? {});
    emit();
  });
  room.onMessage('-', (id: string) => {
    rooms.delete(id);
    emit();
  });
  room.onLeave(() => {
    if (!closed) onDrop();
  });
  return {
    close() {
      closed = true;
      void room.leave(true).catch(() => {});
    },
  };
}

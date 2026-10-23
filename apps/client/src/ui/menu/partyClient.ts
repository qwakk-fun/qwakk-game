/**
 * The party connection (apps/server/src/party/PartyRoom.ts): create a party
 * or join one by code, get the party as messages (names, tags, leader, who
 * is in a match), tell it which room the leader went to, and hear where the
 * leader went. Loaded with a dynamic import, like the lobby client, so the
 * Colyseus SDK stays out of the menu's first chunk. The connection stays open
 * while you play, so the party is still there after the match.
 */
import { Client, type Room } from '@colyseus/sdk';
import { PARTY, PartyMsg, type PartyGo, type PartyView } from '@qwakk/shared/lobby';

/** Close code: the server dropped us because the same player joined another party (PartyRoom.PARTY_KICKED). */
export const PARTY_KICKED = 4001;

export interface PartyHooks {
  view(v: PartyView): void;
  /** The leader went to a room: follow it. */
  go(g: PartyGo): void;
  /** The connection closed without leave() (`code`: the close code). */
  dropped(code: number): void;
}

export interface PartyConnection {
  readonly code: string;
  /** Leader only: the game room we just joined, for the members to follow. */
  went(g: PartyGo): void;
  leave(): void;
}

function wire(room: Room, hooks: PartyHooks): PartyConnection {
  let left = false;
  room.onMessage(PartyMsg.View, (v: PartyView) => {
    if (v && Array.isArray(v.members)) hooks.view(v);
  });
  room.onMessage(PartyMsg.Go, (g: PartyGo) => {
    if (g && (g.mode === 'br' || g.mode === 'dm' || g.mode === 'raid') && typeof g.roomId === 'string') hooks.go(g);
  });
  room.onLeave((code) => {
    if (!left) hooks.dropped(code);
  });
  return {
    code: room.roomId,
    went(g) {
      room.send(PartyMsg.Go, g);
    },
    leave() {
      left = true;
      void room.leave(true).catch(() => {});
    },
  };
}

export async function createParty(endpoint: string, token: string | undefined, hooks: PartyHooks): Promise<PartyConnection> {
  return wire(await new Client(endpoint).create(PARTY.roomName, { token }), hooks);
}

export async function joinParty(endpoint: string, code: string, token: string | undefined, hooks: PartyHooks): Promise<PartyConnection> {
  return wire(await new Client(endpoint).joinById(code, { token }), hooks);
}

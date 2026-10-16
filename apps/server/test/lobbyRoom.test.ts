/**
 * Lobby rooms over real WebSockets (in-process server, meta mocked): the
 * lobby lists battle royale rooms live; two humans join one room from the
 * list, the countdown starts, resets when one leaves, and when it ends bots
 * fill the seats and the match starts; a room in progress cannot be joined;
 * creation is limited per IP and capped; join options cannot tune a room.
 * The static deathmatch rooms are listed with their names and live human
 * counts, Quick Play joins the busiest one, nobody can create one, and they
 * stay open (and idle, without bots) when everyone has left.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { matchMaker, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from '@colyseus/sdk';
import { BR, emptyInput, initPhysics, MATCH, ROOM } from '@qwakk/shared';
import { DM_ROOMS, LOBBY_ERROR, LOBBY_ROOM, type RoomListing } from '@qwakk/shared/lobby';
import { IslandState, MatchPhase } from '@qwakk/shared/net';

let createAllowed = true;
vi.mock('../src/meta/index.ts', () => ({
  verifySession: async (token: string | undefined) => {
    const m = /^tok-(\d+)$/.exec(token ?? '');
    return m ? { playerId: `00000000-0000-4000-8000-0000000000${m[1]!.padStart(2, '0')}`, name: `Duck${m[1]}`, tag: `${1000 + Number(m[1])}` } : null;
  },
  allowJoin: () => true,
  allowLobby: () => true,
  allowCreateRoom: () => createAllowed,
  joinIp: () => '10.0.0.1',
  recordMatch: async () => undefined,
}));

const { BrRoom } = await import('../src/BrRoom.ts');
const { IslandRoom } = await import('../src/IslandRoom.ts');
const { QwakkLobby } = await import('../src/lobby.ts');
const { installMatchmakingGuard } = await import('../src/matchmaking.ts');

const COUNTDOWN_S = 2;
const MAX_ROOMS = 3;
let server: Server;
let url = '';

const idleBot = () => {
  const f = emptyInput();
  return { think: () => f, respawned: () => undefined, damagedFrom: () => undefined };
};

beforeAll(async () => {
  await initPhysics();
  const http = createServer();
  server = new Server({ transport: new WebSocketTransport({ server: http }) });
  server.define(BR.roomName, BrRoom, { countdownSeconds: COUNTDOWN_S, seed: 3, createBot: idleBot }).enableRealtimeListing().sortBy({ clients: -1 });
  server.define(ROOM.name, IslandRoom, { mapId: 'greybox' }).enableRealtimeListing().sortBy({ 'metadata.humans': -1, clients: -1 });
  server.define(LOBBY_ROOM, QwakkLobby);
  installMatchmakingGuard(matchMaker.controller, LOBBY_ROOM, {
    maxRooms: { [BR.roomName]: MAX_ROOMS },
    noCreate: [LOBBY_ROOM],
    joinOnly: [ROOM.name],
    countRooms: async (name) => (await matchMaker.query({ name })).length,
    hasOpenRoom: async (name) => Boolean(await matchMaker.findOneRoomAvailable(name, {})),
    allowCreate: () => createAllowed,
    ipOf: () => '10.0.0.1',
  });
  await server.listen(0);
  for (const r of DM_ROOMS) await matchMaker.createRoom(ROOM.name, { dmRoom: r.id });
  url = `ws://localhost:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(label: string, test: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await sleep(25);
  }
}

/** A menu's view of the lobby: room id to listing. */
async function openLobby(): Promise<{ room: Room; rooms: Map<string, { locked?: boolean; metadata: RoomListing; name: string }> }> {
  const room = await new Client(url).joinOrCreate(LOBBY_ROOM, { filter: { name: 'island' } });
  const rooms = new Map<string, { locked?: boolean; metadata: RoomListing; name: string }>();
  room.onMessage('rooms', (list: { roomId: string; locked?: boolean; metadata: RoomListing; name: string }[]) => {
    rooms.clear();
    for (const r of list) rooms.set(r.roomId, r);
  });
  room.onMessage('+', ([id, r]: [string, { locked?: boolean; metadata: RoomListing; name: string }]) => rooms.set(id, r));
  room.onMessage('-', (id: string) => rooms.delete(id));
  return { room, rooms };
}

const join = (roomId: string, n: number) => new Client(url).joinById<IslandState>(roomId, { token: `tok-${n}` }, IslandState);
const failCode = async (p: Promise<{ leave(c?: boolean): Promise<unknown> }>): Promise<number> => {
  try {
    const r = await p;
    await r.leave(true);
    return 0;
  } catch (err) {
    return (err as { code?: number }).code ?? -1;
  }
};

describe('lobby rooms', () => {
  it('two humans from the list start the countdown; a leave resets it; then bots fill and the match starts', async () => {
    const lobby = await openLobby();
    const a = await new Client(url).create<IslandState>(BR.roomName, { token: 'tok-1' }, IslandState);
    const id = a.roomId;
    const listing = () => lobby.rooms.get(id)?.metadata;
    await waitUntil('listed, waiting for 1', () => listing()?.stage === 'waiting' && listing()?.need === 1 && listing()?.humans === 1);
    expect(listing()?.label).toBeTruthy();
    expect(listing()?.cap).toBe(BR.players);
    // Nothing private in the listing.
    expect(JSON.stringify(lobby.rooms.get(id))).not.toMatch(/tok-|Duck1|10\.0\.0\.1|0000-4000/);
    await waitUntil('room state says need 1', () => a.state.need === 1 && a.state.phase === MatchPhase.Warmup);
    expect(a.state.timeLeft).toBe(0);
    await sleep(COUNTDOWN_S * 1000 + 300);
    expect(listing()?.stage).toBe('waiting');

    const b = await join(id, 2);
    await waitUntil('countdown', () => listing()?.stage === 'countdown' && listing()?.need === 0);
    expect(b.state.need).toBe(0);
    // Names and tags are in the room state for the waiting room panel.
    await waitUntil('roster', () => b.state.players.size === 2);
    expect([...b.state.players.values()].map((p) => `${p.name}#${p.tag}`).sort()).toEqual(['Duck1#1001', 'Duck2#1002']);

    await b.leave(true);
    await waitUntil('reset to waiting', () => listing()?.stage === 'waiting' && listing()?.need === 1);
    await sleep(COUNTDOWN_S * 1000 + 300);
    expect(a.state.phase).toBe(MatchPhase.Warmup);

    const b2 = await join(id, 3);
    await waitUntil('countdown again', () => listing()?.stage === 'countdown');
    await waitUntil('match started', () => a.state.phase === MatchPhase.Playing, COUNTDOWN_S * 1000 + 3000);
    await waitUntil('bots fill the seats', () => a.state.total === BR.players && a.state.players.size === BR.players);
    expect([...a.state.players.values()].filter((p) => !p.bot).length).toBe(2);
    await waitUntil('listed as in progress', () => listing()?.stage === 'playing' && lobby.rooms.get(id)?.locked === true);

    // In progress: not joinable.
    expect(await failCode(join(id, 5))).not.toBe(0);
    // Quick Play does not land in it either: it opens a new room.
    const q = await new Client(url).joinOrCreate<IslandState>(BR.roomName, { token: 'tok-6' }, IslandState);
    expect(q.roomId).not.toBe(id);

    for (const r of [a, b2, q, lobby.room]) await r.leave(true);
  }, 40_000);

  it('join options cannot tune a room', async () => {
    const r = await new Client(url).create<IslandState>(BR.roomName, { token: 'tok-7', maxClients: 99, countdownSeconds: 0, minHumans: 1 }, IslandState);
    const listing = (await matchMaker.query({ roomId: r.roomId }))[0];
    expect(listing?.maxClients).toBe(BR.players);
    await sleep(500);
    await waitUntil('state', () => r.state.need === BR.minHumans - 1);
    expect(r.state.phase).toBe(MatchPhase.Warmup);
    await r.leave(true);
  }, 20_000);

  it('limits room creation per IP and caps the rooms open; never creates lobbies', async () => {
    const open: Room[] = [];
    // Fill up to the cap (rooms from the earlier tests may still be closing).
    for (let i = 0; i < MAX_ROOMS; i++) {
      try {
        open.push(await new Client(url).create(BR.roomName, { token: `tok-${10 + i}` }, IslandState));
      } catch {
        break;
      }
    }
    expect(await failCode(new Client(url).create(BR.roomName, { token: 'tok-20' }, IslandState))).toBe(LOBBY_ERROR.roomsFull);
    for (const r of open) await r.leave(true);
    createAllowed = false;
    expect(await failCode(new Client(url).create(BR.roomName, { token: 'tok-21' }, IslandState))).toBe(LOBBY_ERROR.createLimited);
    createAllowed = true;
    expect(await failCode(new Client(url).create(LOBBY_ROOM, {}))).toBe(LOBBY_ERROR.roomsFull);
  }, 20_000);

  it('lists the open deathmatch rooms; Quick Play joins the busiest, bots fill to 32, nobody creates one', async () => {
    const lobby = await openLobby();
    await waitUntil('the deathmatch rooms listed', () => [...lobby.rooms.values()].filter((r) => r.name === ROOM.name).length === DM_ROOMS.length);
    for (const r of DM_ROOMS) {
      const l = lobby.rooms.get(r.id)?.metadata;
      expect(l).toEqual({ mode: 'dm', label: r.label, stage: 'playing', humans: 0, cap: ROOM.maxClients, need: 0, left: 0 });
    }
    const dmRoom = (id: string) => matchMaker.getLocalRoomById(id) as unknown as { dm: { seats: Map<string, { bot: unknown }> } };
    expect(dmRoom(DM_ROOMS[0]!.id).dm.seats.size).toBe(0); // idle: no bots without players

    const a = await new Client(url).joinOrCreate<IslandState>(ROOM.name, { token: 'tok-30' }, IslandState);
    expect(DM_ROOMS.some((r) => r.id === a.roomId)).toBe(true);
    await waitUntil('bots fill the room', () => a.state.players.size === MATCH.players);
    expect([...a.state.players.values()].filter((p) => p.bot).length).toBe(MATCH.players - 1);
    await waitUntil('listed with 1 human', () => lobby.rooms.get(a.roomId)?.metadata.humans === 1);

    // Quick Play again: the room with the most humans.
    const b = await new Client(url).joinOrCreate<IslandState>(ROOM.name, { token: 'tok-31' }, IslandState);
    expect(b.roomId).toBe(a.roomId);
    await waitUntil('2 humans, the rest bots', () => [...b.state.players.values()].filter((p) => p.bot).length === MATCH.players - 2 && b.state.players.size === MATCH.players);
    await waitUntil('listed with 2 humans', () => lobby.rooms.get(a.roomId)?.metadata.humans === 2);

    // A pick from the list by id.
    const other = DM_ROOMS.find((r) => r.id !== a.roomId) ?? DM_ROOMS[0]!;
    const already = other.id === a.roomId ? 2 : 0;
    const c = await new Client(url).joinById<IslandState>(other.id, { token: 'tok-32' }, IslandState);
    await waitUntil('the picked room lists one more human', () => lobby.rooms.get(other.id)?.metadata.humans === already + 1);
    expect(JSON.stringify([...lobby.rooms.values()])).not.toMatch(/tok-|Duck3|10\.0\.0\.1|0000-4000/);

    // Nobody creates a deathmatch room, not even through Quick Play.
    expect(await failCode(new Client(url).create(ROOM.name, { token: 'tok-33' }))).toBe(LOBBY_ERROR.roomsFull);

    for (const r of [a, b, c]) await r.leave(true);
    await waitUntil('everyone gone, listed with 0', () => DM_ROOMS.every((r) => lobby.rooms.get(r.id)?.metadata.humans === 0));
    await sleep(300);
    // The rooms stay open, idle without bots.
    expect((await matchMaker.query({ name: ROOM.name })).length).toBe(DM_ROOMS.length);
    expect(dmRoom(a.roomId).dm.seats.size).toBe(0);
    await lobby.room.leave(true);
  }, 30_000);
});

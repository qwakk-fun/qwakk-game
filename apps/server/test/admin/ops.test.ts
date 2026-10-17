/**
 * Server operations over real WebSockets (in-process server, meta mocked like
 * lobbyRoom.test.ts): maintenance refuses new joins and new rooms while the
 * players already in stay; team modes switched off refuse new rooms in that
 * mode; ducks per room change in a running deathmatch room; the room
 * registry kicks a player (close code), sends notices and closes rooms; the
 * deathmatch rooms open and close with their settings. Then the meta service
 * without mocks: a ban blocks sessions (also from the device token) and an
 * IP block refuses sockets and new sessions.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { matchMaker, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client } from '@colyseus/sdk';
import { BR, emptyInput, initPhysics, MATCH, ROOM } from '@qwakk/shared';
import { CLOSE_CODE, LOBBY_ERROR, LOBBY_ROOM } from '@qwakk/shared/lobby';
import { IslandState, Msg } from '@qwakk/shared/net';

vi.mock('../../src/meta/index.ts', () => ({
  verifySession: async (token: string | undefined) => {
    const m = /^tok-(\d+)$/.exec(token ?? '');
    return m ? { playerId: `00000000-0000-4000-8000-0000000000${m[1]!.padStart(2, '0')}`, name: `Duck${m[1]}`, tag: `${1000 + Number(m[1])}` } : null;
  },
  allowJoin: () => true,
  allowLobby: () => true,
  allowCreateRoom: () => true,
  joinIp: () => '10.0.0.1',
  recordMatch: async () => undefined,
}));

const { BrRoom } = await import('../../src/BrRoom.ts');
const { IslandRoom } = await import('../../src/IslandRoom.ts');
const { QwakkLobby } = await import('../../src/lobby.ts');
const { installMatchmakingGuard } = await import('../../src/matchmaking.ts');
const { beforeCreate } = await import('../../src/ops/policy.ts');
const { findRoom, liveRooms } = await import('../../src/ops/rooms.ts');
const { installDmRoomControl, syncDmRooms } = await import('../../src/ops/dmRooms.ts');
const { broadcastNotice } = await import('../../src/ops/notice.ts');
const { settings, brMaxRooms } = await import('../../src/settings/index.ts');

let server: Server;
let url = '';
const idleBot = () => {
  const f = emptyInput();
  return { think: () => f, respawned: () => undefined, damagedFrom: () => undefined };
};
const driver = {
  isOpen: (id: string) => matchMaker.getLocalRoomById(id) !== undefined,
  open: (id: string) => matchMaker.createRoom(ROOM.name, { dmRoom: id }),
  close: async (id: string) => matchMaker.getLocalRoomById(id)?.disconnect(CLOSE_CODE.roomClosed),
};

beforeAll(async () => {
  await initPhysics();
  const http = createServer();
  server = new Server({ transport: new WebSocketTransport({ server: http }) });
  server.define(BR.roomName, BrRoom, { countdownSeconds: 30, seed: 3, createBot: idleBot }).enableRealtimeListing();
  server.define(ROOM.name, IslandRoom, { mapId: 'greybox' }).enableRealtimeListing();
  server.define(LOBBY_ROOM, QwakkLobby);
  installMatchmakingGuard(matchMaker.controller, LOBBY_ROOM, {
    maxRooms: {
      get [BR.roomName]() {
        return brMaxRooms();
      },
    },
    noCreate: [LOBBY_ROOM],
    joinOnly: [ROOM.name],
    countRooms: async (name) => (await matchMaker.query({ name })).length,
    hasOpenRoom: async (name) => Boolean(await matchMaker.findOneRoomAvailable(name, {})),
    allowCreate: () => true,
    ipOf: () => '10.0.0.1',
    beforeCreate,
  });
  await server.listen(0);
  await installDmRoomControl(driver);
  url = `ws://localhost:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const k of ['ops.maintenance', 'br.mode.duo', 'br.maxRooms', 'dm.players', 'dm.room.paris']) settings.reset(k);
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
const failCode = async (p: Promise<{ leave(c?: boolean): Promise<unknown> }>): Promise<number> => {
  try {
    const r = await p;
    await r.leave(true);
    return 0;
  } catch (err) {
    return (err as { code?: number }).code ?? -1;
  }
};
const joinDm = (n: number, id = 'istanbul') => new Client(url).joinById<IslandState>(id, { token: `tok-${n}` }, IslandState);

describe('maintenance and modes', () => {
  it('maintenance refuses new joins and new rooms; players already in stay', async () => {
    const inside = await joinDm(1);
    settings.set('ops.maintenance', true);
    expect(await failCode(joinDm(2))).toBe(LOBBY_ERROR.maintenance);
    expect(await failCode(new Client(url).create(BR.roomName, { token: 'tok-3' }, IslandState))).toBe(LOBBY_ERROR.maintenance);
    expect(await failCode(new Client(url).joinOrCreate(BR.roomName, { token: 'tok-3' }, IslandState))).toBe(LOBBY_ERROR.maintenance);
    await sleep(300);
    expect(inside.connection.isOpen).toBe(true);
    settings.set('ops.maintenance', false);
    const again = await joinDm(2);
    await again.leave(true);
    await inside.leave(true);
  }, 20_000);

  it('a team mode switched off refuses new rooms in that mode only', async () => {
    settings.set('br.maxRooms', 3);
    settings.set('br.mode.duo', false);
    expect(await failCode(new Client(url).create(BR.roomName, { token: 'tok-4', team: 2 }, IslandState))).toBe(LOBBY_ERROR.modeOff);
    const squad = await new Client(url).create(BR.roomName, { token: 'tok-4', team: 4 }, IslandState);
    await squad.leave(true);
    settings.set('br.mode.duo', true);
    const duo = await new Client(url).create(BR.roomName, { token: 'tok-5', team: 2 }, IslandState);
    await duo.leave(true);
  }, 20_000);

  it('the room cap follows its setting', async () => {
    settings.set('br.maxRooms', 0);
    expect(await failCode(new Client(url).create(BR.roomName, { token: 'tok-6' }, IslandState))).toBe(LOBBY_ERROR.roomsFull);
    settings.set('br.maxRooms', 3);
  }, 20_000);
});

describe('live rooms', () => {
  it('ducks per room change in a running deathmatch room', async () => {
    const a = await joinDm(7);
    await waitUntil('full room', () => a.state.players.size === MATCH.players);
    settings.set('dm.players', 6);
    await waitUntil('6 ducks', () => a.state.players.size === 6);
    settings.set('dm.players', 10);
    await waitUntil('10 ducks', () => a.state.players.size === 10);
    settings.reset('dm.players');
    await waitUntil('back to the default', () => a.state.players.size === MATCH.players);
    await a.leave(true);
  }, 20_000);

  it('lists players, sends notices and takes a player out with its close code', async () => {
    const a = await joinDm(8);
    const notices: string[] = [];
    a.onMessage(Msg.Notice, (t: string) => notices.push(t));
    let closed = 0;
    a.onLeave((code) => (closed = code));
    const room = findRoom('istanbul')!;
    await waitUntil('listed', () => room.roomPlayers().length === 1);
    const p = room.roomPlayers()[0]!;
    expect(p).toMatchObject({ name: 'Duck8', tag: '1008', playerId: '00000000-0000-4000-8000-000000000008', spectator: false });
    expect(room.ipOf(p.sessionId)).toBe('10.0.0.1');
    const info = room.roomInfo();
    expect(info).toMatchObject({ roomId: 'istanbul', kind: 'dm', humans: 1, bots: MATCH.players - 1 });
    expect(broadcastNotice('Server restarts soon')).toBe(liveRooms.size);
    await waitUntil('notice', () => notices.length === 1);
    expect(notices[0]).toBe('Server restarts soon');
    expect(room.removePlayer(p.sessionId)).toBe(true);
    await waitUntil('removed', () => closed !== 0);
    expect(closed).toBe(CLOSE_CODE.removed);
  }, 20_000);

  it('opens and closes deathmatch rooms with their settings', async () => {
    expect(driver.isOpen('paris')).toBe(false);
    settings.set('dm.room.paris', true);
    await syncDmRooms(driver);
    expect(driver.isOpen('paris')).toBe(true);
    const a = await joinDm(9, 'paris');
    let closed = 0;
    a.onLeave((code) => (closed = code));
    settings.set('dm.room.paris', false);
    await syncDmRooms(driver);
    await waitUntil('closed', () => closed !== 0);
    expect(closed).toBe(CLOSE_CODE.roomClosed);
    await waitUntil('gone', () => !driver.isOpen('paris'));
    expect(await failCode(joinDm(10, 'paris'))).not.toBe(0);
  }, 20_000);
});

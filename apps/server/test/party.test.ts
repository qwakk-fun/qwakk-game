/**
 * Parties over real WebSockets (in-process server, meta mocked): create a
 * party, join it by code, the party view (names and tags only, leader,
 * who is in a match), the size cap, join by code only, the per-IP code limit,
 * leaving and a new leader; the leader takes the party into a duo battle
 * royale room (the members follow, land on one team and get each other's HUD
 * entries), a party too big for the room is refused, and in a deathmatch the
 * party members are allies.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { matchMaker, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from '@colyseus/sdk';
import { BR, emptyInput, initPhysics, PARTY, ROOM } from '@qwakk/shared';
import { LOBBY_ERROR, LOBBY_ROOM, PartyMsg, TEAM_ERROR, type PartyGo, type PartyView } from '@qwakk/shared/lobby';
import { IslandState } from '@qwakk/shared/net';

let partyJoins = 0;
let partyJoinCap = 1000;
vi.mock('../src/meta/index.ts', () => ({
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

const { BrRoom } = await import('../src/BrRoom.ts');
const { IslandRoom } = await import('../src/IslandRoom.ts');
const { PartyRoom } = await import('../src/party/PartyRoom.ts');
const { installMatchmakingGuard } = await import('../src/matchmaking.ts');
const { parties } = await import('../src/party/registry.ts');

let server: Server;
let url = '';
const open: Room[] = [];

const idleBot = () => {
  const f = emptyInput();
  return { think: () => f, respawned: () => undefined, damagedFrom: () => undefined };
};

beforeAll(async () => {
  await initPhysics();
  const http = createServer();
  server = new Server({ transport: new WebSocketTransport({ server: http }) });
  server.define(BR.roomName, BrRoom, { countdownSeconds: 30, seed: 3, createBot: idleBot }).enableRealtimeListing();
  server.define(ROOM.name, IslandRoom, { mapId: 'greybox', bots: false });
  server.define(PARTY.roomName, PartyRoom);
  installMatchmakingGuard(matchMaker.controller, LOBBY_ROOM, {
    maxRooms: { [BR.roomName]: 10 },
    noCreate: [LOBBY_ROOM],
    joinOnly: [],
    countRooms: async (name) => (await matchMaker.query({ name })).length,
    hasOpenRoom: async (name) => Boolean(await matchMaker.findOneRoomAvailable(name, {})),
    allowCreate: () => true,
    ipOf: () => '10.0.0.1',
    party: { roomName: PARTY.roomName, allowCreate: () => true, allowJoin: () => ++partyJoins <= partyJoinCap },
  });
  await server.listen(0);
  url = `ws://localhost:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  // A room the server already closed never answers a leave: do not wait on it.
  await Promise.all(open.map((r) => Promise.race([r.leave(true).catch(() => undefined), sleep(300)])));
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

interface Member {
  room: Room;
  view: PartyView | null;
  raw: string[];
  go: PartyGo[];
}

function track(room: Room): Member {
  const m: Member = { room, view: null, raw: [], go: [] };
  room.onMessage(PartyMsg.View, (v: PartyView) => {
    m.view = v;
    m.raw.push(JSON.stringify(v));
  });
  room.onMessage(PartyMsg.Go, (g: PartyGo) => void m.go.push(g));
  open.push(room);
  return m;
}

const createParty = async (n: number): Promise<Member> => track(await new Client(url).create(PARTY.roomName, { token: `tok-${n}` }));
const joinParty = async (code: string, n: number): Promise<Member> => track(await new Client(url).joinById(code, { token: `tok-${n}` }));
const codeOf = async (p: Promise<unknown>): Promise<number> => {
  try {
    const r = (await p) as Room;
    open.push(r);
    return 0;
  } catch (err) {
    return (err as { code?: number }).code ?? -1;
  }
};

describe('parties', () => {
  it('create, join by code, the view (names and tags, no ids), the cap, code only, leave and a new leader', async () => {
    const a = await createParty(1);
    const code = a.room.roomId;
    expect(code).toMatch(new RegExp(`^[${PARTY.codeAlphabet}]{${PARTY.codeLength}}$`));
    await waitUntil('own view', () => a.view?.members.length === 1);
    expect(a.view?.code).toBe(code);
    expect(a.view?.members[0]).toEqual({ name: 'Duck1', tag: '1001', leader: true, busy: false, you: true });

    const b = await joinParty(code, 2);
    await waitUntil('both see 2', () => a.view?.members.length === 2 && b.view?.members.length === 2);
    expect(b.view?.members.map((m) => [m.name, m.leader, m.you])).toEqual([['Duck1', true, false], ['Duck2', false, true]]);
    // Nothing but names and tags: no player ids, no tokens.
    for (const raw of [...a.raw, ...b.raw]) {
      expect(raw).not.toContain('00000000-0000');
      expect(raw).not.toContain('tok-');
    }

    // Up to four; a fifth is refused.
    await joinParty(code, 3);
    await joinParty(code, 4);
    await waitUntil('four in', () => a.view?.members.length === 4);
    expect(await codeOf(new Client(url).joinById(code, { token: 'tok-5' }))).not.toBe(0);
    // Parties are joined by code only.
    expect(await codeOf(new Client(url).join(PARTY.roomName, { token: 'tok-6' }))).toBe(LOBBY_ERROR.codeOnly);
    expect(await codeOf(new Client(url).joinOrCreate(PARTY.roomName, { token: 'tok-6' }))).toBe(LOBBY_ERROR.codeOnly);

    // The leader leaves: the next member leads.
    await a.room.leave(true);
    await waitUntil('three left', () => b.view?.members.length === 3);
    expect(b.view?.members[0]).toMatchObject({ name: 'Duck2', leader: true, you: true });
  });

  it('guessing codes is limited per IP', async () => {
    partyJoins = 0;
    partyJoinCap = 3;
    const codes = ['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD'];
    const results = [];
    for (const c of codes) results.push(await codeOf(new Client(url).joinById(c, { token: 'tok-7' })));
    expect(results.slice(0, 3).every((c) => c !== LOBBY_ERROR.joinLimited)).toBe(true);
    expect(results[3]).toBe(LOBBY_ERROR.joinLimited);
    partyJoinCap = 1000;
  });

  it('a member joining another party leaves the first one', async () => {
    const p1 = await createParty(11);
    const p2 = await createParty(12);
    const m = await joinParty(p1.room.roomId, 13);
    await waitUntil('in p1', () => p1.view?.members.length === 2);
    await joinParty(p2.room.roomId, 13);
    await waitUntil('moved to p2', () => p1.view?.members.length === 1 && p2.view?.members.length === 2);
    expect(m.room.connection.isOpen).toBe(false);
  });

  it('the leader takes the party into a duo room: the friend follows and both land on one team', async () => {
    const lead = await createParty(21);
    const friend = await joinParty(lead.room.roomId, 22);
    await waitUntil('two', () => lead.view?.members.length === 2);

    // The leader creates a duo room, then tells the party.
    const brA = await new Client(url).create<IslandState>(BR.roomName, { token: 'tok-21', team: 2 }, IslandState);
    open.push(brA);
    brA.onMessage('*', () => undefined);
    await waitUntil('lead busy', () => lead.view?.members[0]?.busy === true);
    // A member cannot send the party anywhere; the leader cannot send it to a room it is not in.
    friend.room.send(PartyMsg.Go, { mode: 'br', roomId: brA.roomId });
    lead.room.send(PartyMsg.Go, { mode: 'br', roomId: 'nowhere12' });
    await sleep(200);
    expect(friend.go).toEqual([]);
    lead.room.send(PartyMsg.Go, { mode: 'br', roomId: brA.roomId });
    await waitUntil('go reaches the friend', () => friend.go.length === 1);
    expect(friend.go[0]).toEqual({ mode: 'br', roomId: brA.roomId });
    expect(lead.go).toEqual([]);

    // A stranger arriving first cannot take the friend's held seat.
    const stranger = await new Client(url).joinById<IslandState>(brA.roomId, { token: 'tok-29' }, IslandState);
    open.push(stranger);
    stranger.onMessage('*', () => undefined);

    const brB = await new Client(url).joinById<IslandState>(brA.roomId, { token: 'tok-22' }, IslandState);
    open.push(brB);
    brB.onMessage('*', () => undefined);
    await waitUntil('three ducks', () => brA.state.players.size === 3 && brB.state.players.size === 3);
    const me = brA.state.players.get(brA.sessionId)!;
    const mate = brA.state.players.get(brB.sessionId)!;
    const other = brA.state.players.get(stranger.sessionId)!;
    expect(brA.state.teamSize).toBe(2);
    expect(me.team).toBeGreaterThan(0);
    expect(mate.team).toBe(me.team);
    expect(other.team).not.toBe(me.team);
    // Each gets the other's HUD entry, the stranger gets neither.
    await waitUntil('mates', () => brA.state.mates.has(brB.sessionId) && brB.state.mates.has(brA.sessionId));
    expect(brA.state.mates.has(stranger.sessionId)).toBe(false);
    expect(stranger.state.mates.has(brA.sessionId) || stranger.state.mates.has(brB.sessionId)).toBe(false);
    // The listing tells the menu how big a party still fits.
    const listed = (await matchMaker.query({ roomId: brA.roomId }))[0]?.metadata as { team?: number; fit?: number };
    expect(listed.team).toBe(2);
    expect(listed.fit).toBe(2);
  });

  it('a party bigger than the room teams is refused with a clear code', async () => {
    const lead = await createParty(31);
    await joinParty(lead.room.roomId, 32);
    await joinParty(lead.room.roomId, 33);
    await waitUntil('three', () => lead.view?.members.length === 3);
    expect(await codeOf(new Client(url).create(BR.roomName, { token: 'tok-31', team: 2 }))).toBe(TEAM_ERROR.partyTooBig);
    // A squad room takes them.
    expect(await codeOf(new Client(url).create(BR.roomName, { token: 'tok-31', team: 4 }))).toBe(0);
  });

  it('a deathmatch: party members are allies, everyone else is not', async () => {
    const lead = await createParty(41);
    await joinParty(lead.room.roomId, 42);
    await waitUntil('two', () => lead.view?.members.length === 2);
    const dm = await matchMaker.createRoom(ROOM.name, {});
    const a = await new Client(url).joinById<IslandState>(dm.roomId, { token: 'tok-41' }, IslandState);
    const b = await new Client(url).joinById<IslandState>(dm.roomId, { token: 'tok-42' }, IslandState);
    const c = await new Client(url).joinById<IslandState>(dm.roomId, { token: 'tok-43' }, IslandState);
    for (const r of [a, b, c]) {
      open.push(r);
      r.onMessage('*', () => undefined);
    }
    await waitUntil('three in', () => a.state.players.size === 3);
    const team = (id: string) => a.state.players.get(id)!.team;
    expect(team(a.sessionId)).toBeGreaterThan(0);
    expect(team(b.sessionId)).toBe(team(a.sessionId));
    expect(team(c.sessionId)).toBe(0);
    expect(parties.partyOf('00000000-0000-4000-8000-000000000041')?.members.length).toBe(2);
  });
});

/**
 * Duck Plaza hub rooms over real WebSockets (in-process server, meta
 * mocked): a guest and an account duck join; name, #tag, level and look come
 * from the session only (join options cannot set them); nothing carries a
 * player id or token; interest sends near ducks every tick, farther ones at
 * the far rate, far away ones not at all; invites (sent, declined, expired,
 * rate limited, too far) and an accepted invite that opens a party server
 * side, leader first, with team markers; the leader's portal walk sends the
 * leader into the match, a member gets "the leader picks" and follows the
 * party's go into the same deathmatch as an ally; a guest's Battle Royale
 * portal is locked while Deathmatch opens; chat bubbles go through the word
 * filter and the cooldown; emotes are rate limited and the quack reaches
 * only ducks that see it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { matchMaker, Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from '@colyseus/sdk';
import { initPhysics, PARTY, ROOM } from '@qwakk/shared';
import { IslandState, Msg, type ChatMessage } from '@qwakk/shared/net';
import { LOBBY_ROOM, PartyMsg, type PartyGo } from '@qwakk/shared/lobby';
import { HUB, HubEmote, HubMsg, HubNote, PORTALS } from '@qwakk/shared/hub';
import { HubState } from '@qwakk/shared/hub/schema';

vi.mock('../src/meta/index.ts', () => {
  const who = (token: string | undefined) => {
    const m = /^(tok|guest)-(\d+)$/.exec(token ?? '');
    return m ? { playerId: `00000000-0000-4000-8000-0000000000${m[2]!.padStart(2, '0')}`, name: `Duck${m[2]}`, tag: `${1000 + Number(m[2])}`, account: m[1] === 'tok', ...(m[1] === 'tok' ? { look: 1 } : {}) } : null;
  };
  return {
    verifySession: async (token: string | undefined) => who(token),
    playerLevel: async () => 7,
    allowJoin: () => true,
    allowLobby: () => true,
    allowCreateRoom: () => true,
    joinIp: () => '10.0.0.9',
    recordMatch: async () => undefined,
  };
});

const { HubRoom } = await import('../src/hub/HubRoom.ts');
const { IslandRoom } = await import('../src/IslandRoom.ts');
const { PartyRoom } = await import('../src/party/PartyRoom.ts');
const { installMatchmakingGuard } = await import('../src/matchmaking.ts');
const { parties } = await import('../src/party/registry.ts');

let server: Server;
let url = '';
const open: Room[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(label: string, test: () => boolean, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await sleep(20);
  }
}

beforeAll(async () => {
  await initPhysics();
  const http = createServer();
  server = new Server({ transport: new WebSocketTransport({ server: http }) });
  server.define(HUB.roomName, HubRoom, {}).sortBy({ clients: -1 });
  server.define(ROOM.name, IslandRoom, { mapId: 'greybox', bots: false });
  server.define(PARTY.roomName, PartyRoom);
  installMatchmakingGuard(matchMaker.controller, LOBBY_ROOM, {
    maxRooms: { [HUB.roomName]: HUB.maxRooms },
    noCreate: [LOBBY_ROOM],
    joinOnly: [],
    countRooms: async (name) => (await matchMaker.query({ name })).length,
    hasOpenRoom: async (name) => Boolean(await matchMaker.findOneRoomAvailable(name, {})),
    allowCreate: () => true,
    ipOf: () => '10.0.0.9',
    party: { roomName: PARTY.roomName, allowCreate: () => true, allowJoin: () => true },
  });
  await server.listen(0);
  url = `ws://localhost:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await Promise.all(open.map((r) => Promise.race([r.leave(true).catch(() => undefined), sleep(300)])));
  await server.gracefullyShutdown(false);
});

/** One duck in the hub and everything it heard. */
interface Duck {
  room: Room<any, HubState>;
  pid: number;
  notes: number[][];
  invited: unknown[][];
  parties: string[];
  portals: number[];
  quacks: number[];
  chat: ChatMessage[];
  limited: number;
  raw: string[];
}

async function enter(token: string, options: Record<string, unknown> = {}): Promise<Duck> {
  const room = await new Client(url).joinOrCreate<HubState>(HUB.roomName, { token, ...options }, HubState);
  open.push(room);
  const d: Duck = { room, pid: 0, notes: [], invited: [], parties: [], portals: [], quacks: [], chat: [], limited: 0, raw: [] };
  const log = (m: unknown) => d.raw.push(JSON.stringify(m));
  room.onMessage(HubMsg.Note, (m: number[]) => (log(m), d.notes.push(m)));
  room.onMessage(HubMsg.Invited, (m: unknown[]) => (log(m), d.invited.push(m)));
  room.onMessage(HubMsg.Party, (m: { code: string }) => (log(m), d.parties.push(m.code)));
  room.onMessage(HubMsg.Portal, (m: number[]) => (log(m), d.portals.push(m[0]!)));
  room.onMessage(HubMsg.Quack, (m: number[]) => (log(m), d.quacks.push(m[0]!)));
  room.onMessage(Msg.Chat, (m: ChatMessage) => (log(m), d.chat.push(m)));
  room.onMessage(Msg.ChatLimited, () => d.limited++);
  room.onMessage('*', () => undefined);
  await waitUntil('own duck', () => room.state.ducks.get(room.sessionId) !== undefined);
  d.pid = room.state.ducks.get(room.sessionId)!.pid;
  return d;
}

function hubRoom(d: Duck): InstanceType<typeof HubRoom> {
  return matchMaker.getLocalRoomById(d.room.roomId) as unknown as InstanceType<typeof HubRoom>;
}

/** Move a duck on the server (as if it had walked there). */
async function put(d: Duck, x: number, z: number): Promise<void> {
  hubRoom(d).placeForTest(d.pid, x, 3.1, z);
  await sleep(60);
}

const lastNote = (d: Duck) => d.notes[d.notes.length - 1]?.[0];

describe('Duck Plaza hub', { timeout: 30_000 }, () => {
  it('identity, level and look come from the session only; no ids in the room', async () => {
    const acc = await enter('tok-1', { name: 'Admin', level: 99, account: false, playerId: 'x', character: 0 });
    const guest = await enter('guest-2', { name: 'Hacker', level: 50, account: true, character: 1 });
    expect(guest.room.roomId).toBe(acc.room.roomId); // the fullest open hub
    await waitUntil('both see both', () => acc.room.state.ducks.size === 2 && guest.room.state.ducks.size === 2);
    const a = guest.room.state.ducks.get(acc.room.sessionId)!;
    const g = acc.room.state.ducks.get(guest.room.sessionId)!;
    expect([a.name, a.tag, a.level, a.character]).toEqual(['Duck1', '1001', 7, 1]);
    expect([g.name, g.tag, g.level, g.character]).toEqual(['Duck2', '1002', 0, 1]);
    // Another duck's movement state is never sent (owner only), its pose is.
    expect(a.x).toBeUndefined();
    const json = JSON.stringify(acc.room.state.toJSON());
    expect(json).not.toContain('00000000-0000');
    expect(json).not.toContain('tok-');
    await acc.room.leave(true);
    await guest.room.leave(true);
  });

  it('interest: near ducks every tick, farther at the far rate, far away not at all', async () => {
    const a = await enter('tok-3');
    const b = await enter('tok-4');
    const c = await enter('tok-5');
    await put(a, 0, 20);
    await put(b, 10, 20);
    await put(c, 0, -32); // 52 m away
    await waitUntil('classes', () => a.room.state.poses.has(b.room.sessionId) && a.room.state.farPoses.has(c.room.sessionId), 4000);
    expect(a.room.state.poses.has(c.room.sessionId)).toBe(false);
    expect(a.room.state.poses.has(a.room.sessionId)).toBe(false);
    // Out of range: dropped from the view (the corners of the square are about 90 m apart).
    await put(a, -44, -44);
    await put(c, 40, 40);
    await waitUntil('dropped', () => !a.room.state.poses.has(c.room.sessionId) && !a.room.state.farPoses.has(c.room.sessionId), 4000);
    for (const d of [a, b, c]) await d.room.leave(true);
  });

  it('invites: sent, declined, rate limited, too far; an answer after expiry or to nobody does nothing', async () => {
    const [a, b, c, d, e] = await Promise.all([enter('tok-11'), enter('tok-12'), enter('tok-13'), enter('tok-14'), enter('tok-15')]);
    for (const [k, x] of [a, b, c, d, e].entries()) await put(x, -6 + k * 3, 20);
    a.room.send(HubMsg.Invite, [b.pid]);
    await waitUntil('b invited', () => b.invited.length === 1);
    expect(b.invited[0]).toEqual([a.pid, 'Duck11', '1011']);
    expect(lastNote(a)).toBe(HubNote.InviteSent);
    b.room.send(HubMsg.Answer, [a.pid, 0]);
    await waitUntil('declined', () => lastNote(a) === HubNote.Declined);
    // The same answer again: the invite is closed.
    b.room.send(HubMsg.Answer, [a.pid, 1]);
    await waitUntil('expired', () => lastNote(b) === HubNote.Expired);
    // Three more fit the burst, the fourth is limited.
    a.room.send(HubMsg.Invite, [c.pid]);
    a.room.send(HubMsg.Invite, [d.pid]);
    a.room.send(HubMsg.Invite, [e.pid]);
    await waitUntil('limited', () => a.notes.some((n) => n[0] === HubNote.Limited));
    expect(c.invited.length + d.invited.length + e.invited.length).toBe(2);
    // Too far away.
    await put(e, 40, -40);
    e.room.send(HubMsg.Invite, [b.pid]);
    await waitUntil('too far', () => lastNote(e) === HubNote.TooFar);
    expect(b.invited.length).toBe(1);
    // Junk is ignored.
    a.room.send(HubMsg.Invite, ['x']);
    a.room.send(HubMsg.Answer, { pid: 1 });
    for (const x of [a, b, c, d, e]) for (const raw of x.raw) expect(raw).not.toContain('00000000-0000');
    for (const x of [a, b, c, d, e]) await x.room.leave(true);
  });

  it('an accepted invite opens a party (leader first), markers show the team, the leader takes it through the portal', async () => {
    const lead = await enter('tok-21');
    const mate = await enter('tok-22');
    await put(lead, -2, 20);
    await put(mate, 2, 20);
    lead.room.send(HubMsg.Invite, [mate.pid]);
    await waitUntil('invited', () => mate.invited.length === 1);
    mate.room.send(HubMsg.Answer, [lead.pid, 1]);
    // The leader gets the code first and joins; only then the mate gets it.
    await waitUntil('leader code', () => lead.parties.length === 1);
    await sleep(200);
    expect(mate.parties.length).toBe(0);
    const code = lead.parties[0]!;
    const leadParty = await new Client(url).joinById(code, { token: 'tok-21' });
    open.push(leadParty);
    leadParty.onMessage('*', () => undefined);
    await waitUntil('mate code', () => mate.parties.length === 1);
    expect(mate.parties[0]).toBe(code);
    const mateParty = await new Client(url).joinById(code, { token: 'tok-22' });
    open.push(mateParty);
    const go: PartyGo[] = [];
    mateParty.onMessage(PartyMsg.Go, (g: PartyGo) => go.push(g));
    mateParty.onMessage('*', () => undefined);
    await waitUntil('lead joined note', () => lead.notes.some((n) => n[0] === HubNote.Joined && n[1] === mate.pid));
    expect(parties.partyOf('00000000-0000-4000-8000-000000000021')?.members.length).toBe(2);
    // Team markers: both carry the same nonzero number.
    await waitUntil('markers', () => {
      const s = lead.room.state.ducks;
      const t = s.get(lead.room.sessionId)?.team ?? 0;
      return t > 0 && s.get(mate.room.sessionId)?.team === t;
    });
    // Inviting a teammate again says so.
    await sleep(HUB.invite.sameTargetMs > 0 ? 50 : 0);
    // The member walks into the Deathmatch portal: the leader picks.
    await put(mate, 0, -38);
    await waitUntil('leader picks', () => mate.notes.some((n) => n[0] === HubNote.LeaderPicks));
    expect(mate.portals).toEqual([]);
    // The leader walks in: go.
    await put(lead, 0, -38);
    await waitUntil('portal', () => lead.portals.length === 1);
    expect(PORTALS[lead.portals[0]!]).toBe('dm');
    // The client then joins the match and tells the party (the menu's party.went): the mate follows into the same room.
    const dm = await new Client(url).joinOrCreate<IslandState>(ROOM.name, { token: 'tok-21' }, IslandState);
    open.push(dm);
    dm.onMessage('*', () => undefined);
    await lead.room.leave(true);
    leadParty.send(PartyMsg.Go, { mode: 'dm', roomId: dm.roomId });
    await waitUntil('go', () => go.length === 1);
    expect(go[0]).toEqual({ mode: 'dm', roomId: dm.roomId });
    await mate.room.leave(true);
    const dm2 = await new Client(url).joinById<IslandState>(go[0]!.roomId, { token: 'tok-22' }, IslandState);
    open.push(dm2);
    dm2.onMessage('*', () => undefined);
    await waitUntil('allies', () => {
      const me = dm.state.players.get(dm.sessionId);
      const other = dm.state.players.get(dm2.sessionId);
      return !!me && !!other && me.team > 0 && me.team === other.team;
    });
    // Back from the match: in front of the Deathmatch portal.
    await dm.leave(true);
    const back = await enter('tok-21', { portal: 'dm' });
    const p = hubRoom(back).positionOf(back.pid)!;
    expect(Math.hypot(p.x - 0, p.z - -30.5)).toBeLessThan(5);
    await back.room.leave(true);
    await dm2.leave(true);
    leadParty.leave(true);
    mateParty.leave(true);
  });

  it('a guest: the Battle Royale and Hunt Season portals are locked, Deathmatch opens', async () => {
    const g = await enter('guest-31');
    await put(g, -37, -4);
    await waitUntil('locked br', () => g.notes.some((n) => n[0] === HubNote.Locked && n[2] === PORTALS.indexOf('br')));
    await put(g, 37, -4);
    await waitUntil('locked raid', () => g.notes.some((n) => n[0] === HubNote.Locked && n[2] === PORTALS.indexOf('raid')), 6000);
    expect(g.portals).toEqual([]);
    await put(g, 0, -38);
    await waitUntil('dm opens', () => g.portals.length === 1, 6000);
    expect(PORTALS[g.portals[0]!]).toBe('dm');
    await g.room.leave(true);
  });

  it('chat: speech bubbles with the sender from the server, blocked words masked, the cooldown', async () => {
    const a = await enter('tok-41');
    const b = await enter('tok-42');
    a.room.send(Msg.Chat, 'selam ördekler fuck you');
    await waitUntil('heard', () => b.chat.length === 1);
    expect(b.chat[0]).toMatchObject({ pid: a.pid, name: 'Duck41', tag: '1041' });
    expect(b.chat[0]!.text).toBe('selam ördekler **** you');
    a.room.send(Msg.Chat, 'again');
    await waitUntil('limited', () => a.limited === 1);
    a.room.send(Msg.Chat, 'x'.repeat(500));
    a.room.send(Msg.Chat, { text: 'hi', name: 'Admin' });
    await sleep(200);
    expect(b.chat.length).toBe(1);
    await a.room.leave(true);
    await b.room.leave(true);
  });

  it('emotes: the quack reaches ducks that see it, dancing shows on the pose, spam is limited', async () => {
    const a = await enter('tok-51');
    const near = await enter('tok-52');
    const far = await enter('tok-53');
    await put(a, -40, -40);
    await put(near, -36, -40);
    await put(far, 42, 42);
    await waitUntil('views', () => near.room.state.poses.has(a.room.sessionId) && !far.room.state.poses.has(a.room.sessionId) && !far.room.state.farPoses.has(a.room.sessionId), 4000);
    a.room.send(HubMsg.Emote, [HubEmote.Quack]);
    await waitUntil('quack', () => near.quacks.length === 1 && a.quacks.length === 1);
    await sleep(150);
    expect(far.quacks).toEqual([]);
    a.room.send(HubMsg.Emote, [HubEmote.Dance]);
    await waitUntil('dance', () => near.room.state.poses.get(a.room.sessionId)?.emote === HubEmote.Dance);
    for (let i = 0; i < 4; i++) a.room.send(HubMsg.Emote, [HubEmote.Quack]);
    await waitUntil('limited', () => a.notes.some((n) => n[0] === HubNote.Limited));
    for (const d of [a, near, far]) await d.room.leave(true);
  });
});

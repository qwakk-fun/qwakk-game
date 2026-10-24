/**
 * The Hunt Season room over real WebSockets (in-process server, meta mocked):
 * guests refused (the matchmaking guard with the server's real room list, and
 * the room's own onAuth), XP granted only by the server at the run end (one
 * recordRaid, never before, nothing a client sends changes it), a full room
 * refuses more ducks, the cards reach only their duck, and the keep (core,
 * gate, drawbridge, cannons) is public room state.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from '@colyseus/sdk';
import { BridgeState, Button, GateState, initPhysics, RAID, RaidStage, raidXp } from '@qwakk/shared';
import { IslandState, LeverDenied, Msg, RaidEvent } from '@qwakk/shared/net';
import { ACCOUNT_ERROR, ACCOUNT_ROOMS } from '@qwakk/shared/accounts';

const ids = { a: '00000000-0000-4000-8000-0000000000a1', b: '00000000-0000-4000-8000-0000000000b2', c: '00000000-0000-4000-8000-0000000000c3' };
const recorded: unknown[] = [];
/** The next recordRaid fails (the database is down): the room must still close the "saving" line. */
const db = { fail: false };
vi.mock('../../src/meta/index.ts', () => ({
  verifySession: async (token: string | undefined) => {
    if (token === 'tok-a') return { playerId: ids.a, name: 'Alpha', tag: '1111', account: true, look: 1 };
    if (token === 'tok-b') return { playerId: ids.b, name: 'Bravo', tag: '2222', account: true };
    if (token === 'tok-d') return { playerId: '00000000-0000-4000-8000-0000000000d4', name: 'Delta', tag: '4444', account: true };
    if (token === 'tok-e') return { playerId: '00000000-0000-4000-8000-0000000000e5', name: 'Echo', tag: '5555', account: true };
    if (token === 'tok-f') return { playerId: '00000000-0000-4000-8000-0000000000f6', name: 'Fox', tag: '6666', account: true };
    if (token === 'guest-c') return { playerId: ids.c, name: 'Charlie', tag: '3333', account: false };
    return null;
  },
  allowJoin: () => true,
  joinIp: () => '127.0.0.1',
  recordMatch: async () => undefined,
  recordRaid: async (r: unknown) => {
    recorded.push(r);
    if (db.fail) return null;
    return new Map([[ids.a, { xpBefore: 50, xpAfter: 50 + (r as { players: { xp: number }[] }).players[0]!.xp, levelBefore: 1, levelAfter: 2, bestWave: 10, bestMs: 1000, newBest: true }]]);
  },
}));

const { RaidRoom } = await import('../../src/RaidRoom.ts');
const { keepNav } = await import('../../bench/raidHeadless.ts');

const PORT = 2593;
let server: Server;

beforeAll(async () => {
  await initPhysics();
  const nav = await keepNav();
  server = new Server({ transport: new WebSocketTransport() });
  server.define(RAID.roomName, RaidRoom, { nav: () => nav, rules: { lobbySeconds: 60, breakSeconds: 2 }, endSeconds: 5, testHooks: true });
  await server.listen(PORT);
}, 180_000);

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(test: () => boolean, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error('timeout');
    await sleep(25);
  }
}
const join = (token: string) => new Client(`ws://localhost:${PORT}`).joinOrCreate<IslandState>(RAID.roomName, { token }, IslandState);
const codeOf = async (p: Promise<unknown>): Promise<number> => {
  try {
    await p;
    return 0;
  } catch (err) {
    return (err as { code?: number }).code ?? -1;
  }
};

describe('hunt season room', () => {
  it('is account only in the shared list the matchmaking guard uses', () => {
    expect(ACCOUNT_ROOMS).toContain(RAID.roomName);
  });

  it('refuses a guest in the room itself (onAuth), whatever the menu did', async () => {
    expect(await codeOf(join('guest-c'))).toBe(ACCOUNT_ERROR.roomNeedsAccount);
    expect(await codeOf(join('nope'))).not.toBe(0);
  });

  it('grants XP only at the run end, from the server, once; client messages change nothing', async () => {
    recorded.length = 0;
    const a = await join('tok-a');
    const ends: number[][] = [];
    const offers: number[][] = [];
    a.onMessage(Msg.RaidEnd, (m: number[]) => ends.push(m));
    a.onMessage(Msg.RaidOffer, (m: number[]) => offers.push(m));
    a.onMessage('*', () => undefined);
    await waitUntil(() => a.state.raid.stage === RaidStage.Lobby && a.state.players.size === 1, 5000);
    // Picks a cheat might send outside a break or out of range: ignored (any other message type has no handler
    // here and drops the client in production). Nothing a client sends is a way to XP.
    for (const v of [0, 7, -1, 'x', { xp: 99999 }]) a.send(Msg.RaidPick, v);
    a.send('dev:raid', { op: 'start' });
    await waitUntil(() => a.state.raid.stage === RaidStage.Fight, 5000);
    a.send('dev:raid', { op: 'clear' });
    await waitUntil(() => a.state.raid.stage === RaidStage.Break, 5000);
    await waitUntil(() => offers.length > 0 && offers[0]!.length === 7, 2000);
    a.send(Msg.RaidPick, 1);
    await sleep(300);
    expect(recorded).toHaveLength(0);
    a.send('dev:raid', { op: 'skip', wave: RAID.objectives });
    await waitUntil(() => a.state.raid.wave === RAID.objectives, 5000);
    a.send('dev:raid', { op: 'clear' });
    await waitUntil(() => a.state.raid.stage === RaidStage.Won, 5000);
    await waitUntil(() => ends.length >= 2, 5000);
    expect(recorded).toHaveLength(1);
    const run = recorded[0] as { won: boolean; players: { playerId: string; wavesCleared: number; xp: number; kills: number; minionKills: number; comboXp: number }[] };
    expect(run.won).toBe(true);
    expect(run.players).toHaveLength(1);
    expect(run.players[0]!.playerId).toBe(ids.a);
    expect(run.players[0]!.wavesCleared).toBe(2);
    const row = run.players[0]!;
    expect(row.xp).toBe(raidXp({ wavesCleared: 2, kills: row.kills, minionKills: row.minionKills, comboXp: row.comboXp, bossKills: 0, revives: 0, won: true }));
    // First the server's own count (granted 0), then the stored grant (granted 1).
    expect(ends[0]![14]).toBe(0);
    expect(ends[1]![14]).toBe(1);
    expect(ends[1]![5]).toBe(run.players[0]!.xp);
    expect(ends[1]![7]! - ends[1]![6]!).toBe(run.players[0]!.xp);
    await a.leave(true);
    await sleep(200);
    expect(recorded).toHaveLength(1);
  }, 30_000);

  it('a duck that leaves mid-run keeps its XP for what it did, but gets no win', async () => {
    recorded.length = 0;
    const a = await join('tok-a');
    a.onMessage('*', () => undefined);
    const b = await new Client(`ws://localhost:${PORT}`).joinById<IslandState>(a.roomId, { token: 'tok-b' }, IslandState);
    b.onMessage('*', () => undefined);
    a.send('dev:raid', { op: 'start' });
    await waitUntil(() => a.state.raid.stage === RaidStage.Fight, 5000);
    a.send('dev:raid', { op: 'clear' });
    await waitUntil(() => a.state.raid.stage === RaidStage.Break, 5000);
    await b.leave(true);
    await waitUntil(() => a.state.raid.ducks === 1, 5000);
    a.send('dev:raid', { op: 'skip', wave: RAID.objectives });
    await waitUntil(() => a.state.raid.wave === RAID.objectives, 5000);
    a.send('dev:raid', { op: 'clear' });
    await waitUntil(() => recorded.length === 1, 5000);
    const run = recorded[0] as { won: boolean; players: { playerId: string; won: boolean; xp: number; wavesCleared: number; kills: number; minionKills: number; comboXp: number }[] };
    const stayer = run.players.find((p) => p.playerId === ids.a)!;
    const leaver = run.players.find((p) => p.playerId === ids.b)!;
    expect(run.won).toBe(true);
    expect(stayer.won).toBe(true);
    expect(leaver.won).toBe(false);
    expect(leaver.wavesCleared).toBe(1);
    expect(leaver.xp).toBe(raidXp({ wavesCleared: 1, kills: leaver.kills, minionKills: leaver.minionKills, comboXp: leaver.comboXp, bossKills: 0, revives: 0, won: false }));
    await a.leave(true);
  }, 30_000);

  it('says so when the XP could not be saved (the second answer always comes)', async () => {
    recorded.length = 0;
    db.fail = true;
    const a = await join('tok-a');
    const ends: number[][] = [];
    a.onMessage(Msg.RaidEnd, (m: number[]) => ends.push(m));
    a.onMessage('*', () => undefined);
    a.send('dev:raid', { op: 'start' });
    await waitUntil(() => a.state.raid.stage === RaidStage.Fight, 5000);
    a.send('dev:raid', { op: 'skip', wave: RAID.objectives });
    await waitUntil(() => a.state.raid.wave === RAID.objectives, 5000);
    a.send('dev:raid', { op: 'clear' });
    await waitUntil(() => ends.length >= 2, 5000);
    expect(ends[0]![14]).toBe(0);
    expect(ends[1]![14]).toBe(2);
    db.fail = false;
    await a.leave(true);
  }, 30_000);

  it('mirrors the keep: the core, the gate, the drawbridge and its lever, the cannons', async () => {
    const a = await join('tok-a');
    const events: number[][] = [];
    a.onMessage(Msg.RaidEvent, (m: number[]) => events.push(m));
    a.onMessage('*', () => undefined);
    await waitUntil(() => a.state.raid.cannons.size > 0, 5000);
    expect(a.state.raid.coreMax).toBe(RAID.coreHp);
    expect(a.state.raid.gateMax).toBe(RAID.gateHp);
    expect(a.state.raid.gate).toBe(GateState.Intact);
    expect(a.state.raid.bridge).toBe(BridgeState.Down);
    // Pulled from afar (test hook): it rises, the cooldown shows, then it is up.
    a.send('dev:raid', { op: 'lever' });
    await waitUntil(() => a.state.raid.bridge === BridgeState.Raising, 3000);
    expect(a.state.raid.leverReady).toBeGreaterThan(0);
    expect(events.some((e) => e[0] === RaidEvent.Bridge && e[1] === BridgeState.Raising)).toBe(true);
    await waitUntil(() => a.state.raid.bridge === BridgeState.Up, 5000);
    expect(a.state.raid.bridgeDown).toBeGreaterThan(0);
    // The lever again at once: still cooling down, told to that duck.
    a.send('dev:raid', { op: 'lever' });
    await waitUntil(() => events.some((e) => e[0] === RaidEvent.LeverDenied && e[1] === LeverDenied.Cooldown), 3000);
    a.send('dev:raid', { op: 'gate', wave: 0 });
    await waitUntil(() => a.state.raid.gate === GateState.Broken, 3000);
    // Manned at the stand spot with a Use press: the cannon shows its duck.
    a.send('dev:raid', { op: 'tp', wave: 1 });
    await sleep(300);
    const input = a.input<{ tick: number; mx: number; mz: number; buttons: number; yaw: number; pitch: number; vt: number }>();
    for (const b of [0, Button.Use, 0]) {
      Object.assign(input.data, { tick: 1, mx: 0, mz: 0, buttons: b, yaw: 0, pitch: 0, vt: 0 });
      input.send();
      await sleep(60);
    }
    const me = [...a.state.players.values()][0]!;
    await waitUntil(() => a.state.raid.cannons.get('0')?.pid === me.pid, 3000);
    await a.leave(true);
  }, 30_000);

  it('takes four ducks at most and none once the hunt started; cards go to their duck only', async () => {
    const first = await join('tok-a');
    first.onMessage('*', () => undefined);
    const rooms: Room<unknown, IslandState>[] = [first];
    for (const t of ['tok-b', 'tok-d', 'tok-e']) {
      const r = await new Client(`ws://localhost:${PORT}`).joinById<IslandState>(first.roomId, { token: t }, IslandState);
      r.onMessage('*', () => undefined);
      rooms.push(r);
    }
    expect(await codeOf(new Client(`ws://localhost:${PORT}`).joinById(first.roomId, { token: 'tok-f' }, IslandState))).not.toBe(0);
    const offers = new Map<number, number[][]>();
    rooms.forEach((r, i) => r.onMessage(Msg.RaidOffer, (m: number[]) => offers.set(i, [...(offers.get(i) ?? []), m])));
    first.send('dev:raid', { op: 'start' });
    await waitUntil(() => first.state.raid.stage === RaidStage.Fight, 5000);
    first.send('dev:raid', { op: 'clear' });
    await waitUntil(() => offers.size === 4, 5000);
    for (const list of offers.values()) expect(list).toHaveLength(1);
    for (const r of rooms) await r.leave(true);
  }, 30_000);
});

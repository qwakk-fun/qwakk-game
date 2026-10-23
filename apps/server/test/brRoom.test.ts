/**
 * The battle royale room over real WebSockets (in-process server, meta mocked):
 * - the match is recorded when the last human leaves before the end, with the
 *   place the human had when it left;
 * - one identity cannot take two seats in the same room;
 * - a guest session is refused (battle royale needs an account) and an
 *   account character wears its stored look, whatever the join option says;
 * - `spectate: true` in a room without spectators skips nothing: a guest is
 *   still refused, and so is anyone during maintenance.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client } from '@colyseus/sdk';
import { BR, emptyInput, initPhysics } from '@qwakk/shared';
import { IslandState, MatchPhase } from '@qwakk/shared/net';

const recorded: unknown[] = [];
vi.mock('../src/meta/index.ts', () => ({
  verifySession: async (token: string | undefined) => {
    if (token === 'tok-a') return { playerId: '00000000-0000-4000-8000-00000000000a', name: 'Alpha', tag: '1111', account: true, look: 1 };
    if (token === 'tok-b') return { playerId: '00000000-0000-4000-8000-00000000000b', name: 'Bravo', tag: '2222', account: true };
    if (token === 'guest-c') return { playerId: '00000000-0000-4000-8000-00000000000c', name: 'Charlie', tag: '3333', account: false };
    return token ? null : { playerId: 'dev-guest', name: 'Guest', tag: '0000', account: true };
  },
  allowJoin: () => true,
  joinIp: () => '127.0.0.1',
  recordMatch: async (r: unknown) => void recorded.push(r),
}));

const { BrRoom } = await import('../src/BrRoom.ts');
const { JOIN_ERROR } = await import('../src/gameRoom.ts');
const { ACCOUNT_ERROR } = await import('@qwakk/shared/accounts');
const { LOBBY_ERROR } = await import('@qwakk/shared/lobby');
const { settings } = await import('../src/settings/index.ts');

const PORT = 2591;
let server: Server;

const idleBot = () => {
  const f = emptyInput();
  return { think: () => f, respawned: () => undefined, damagedFrom: () => undefined };
};

beforeAll(async () => {
  await initPhysics();
  server = new Server({ transport: new WebSocketTransport() });
  server.define(BR.roomName, BrRoom, { countdownSeconds: 1, minHumans: 1, seed: 3, createBot: idleBot });
  await server.listen(PORT);
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitUntil(test: () => boolean, ms: number): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error('timeout');
    await sleep(50);
  }
}

describe('battle royale room', () => {
  it('records the match when the last human leaves mid-match, with the place it had then', async () => {
    recorded.length = 0;
    const room = await new Client(`ws://localhost:${PORT}`).joinOrCreate(BR.roomName, { token: 'tok-a' }, IslandState);
    await waitUntil(() => room.state.phase === MatchPhase.Playing && room.state.alive === BR.players, 10_000);
    await room.leave(true);
    // The room disposes once the last client is gone, and records on the way out.
    await waitUntil(() => recorded.length > 0, 10_000);
    const r = recorded[0] as { mode: string; players: { playerId: string | null; placement: number; isBot: boolean }[] };
    expect(r.mode).toBe('br');
    const me = r.players.find((p) => !p.isBot);
    expect(me?.playerId).toBe('00000000-0000-4000-8000-00000000000a');
    // Out first of 16: last place, and nobody else got a missing place.
    expect(me?.placement).toBe(BR.players);
    expect(r.players.map((p) => p.placement).sort((a, b) => a - b)).toEqual(Array.from({ length: BR.players }, (_, i) => i + 1));
  }, 30_000);

  it('refuses a second seat for an identity that is already in the match', async () => {
    const first = await new Client(`ws://localhost:${PORT}`).joinOrCreate(BR.roomName, { token: 'tok-b' }, IslandState);
    let code = 0;
    try {
      const second = await new Client(`ws://localhost:${PORT}`).join(BR.roomName, { token: 'tok-b' }, IslandState);
      await second.leave(true);
    } catch (err) {
      code = (err as { code?: number }).code ?? -1;
    }
    expect(code).toBe(JOIN_ERROR.alreadyInMatch);
    await first.leave(true);
  }, 30_000);

  it('refuses a guest session: battle royale needs an account', async () => {
    let code = 0;
    try {
      const r = await new Client(`ws://localhost:${PORT}`).joinOrCreate(BR.roomName, { token: 'guest-c' }, IslandState);
      await r.leave(true);
    } catch (err) {
      code = (err as { code?: number }).code ?? -1;
    }
    expect(code).toBe(ACCOUNT_ERROR.roomNeedsAccount);
  }, 30_000);

  it('seats an account character in its stored look, not the join option', async () => {
    const room = await new Client(`ws://localhost:${PORT}`).joinOrCreate(BR.roomName, { token: 'tok-a', character: 0 }, IslandState);
    await waitUntil(() => [...room.state.players.values()].some((p) => !p.bot), 10_000);
    const me = [...room.state.players.values()].find((p) => !p.bot && p.name === 'Alpha');
    expect(me?.character).toBe(1);
    await room.leave(true);
  }, 30_000);

  const codeOf = async (options: Record<string, unknown>): Promise<number> => {
    try {
      const r = await new Client(`ws://localhost:${PORT}`).joinOrCreate(BR.roomName, options, IslandState);
      await r.leave(true);
      return 0;
    } catch (err) {
      return (err as { code?: number }).code ?? -1;
    }
  };

  it('a spectate flag does not let a guest in (this room takes no spectators)', async () => {
    expect(await codeOf({ token: 'guest-c', spectate: true })).toBe(ACCOUNT_ERROR.roomNeedsAccount);
  }, 30_000);

  it('a spectate flag does not get past maintenance', async () => {
    settings.set('ops.maintenance', true);
    try {
      expect(await codeOf({ token: 'tok-a', spectate: true })).toBe(LOBBY_ERROR.maintenance);
      expect(await codeOf({ token: 'guest-c', spectate: true })).toBe(LOBBY_ERROR.maintenance);
    } finally {
      settings.reset('ops.maintenance');
    }
  }, 30_000);
});

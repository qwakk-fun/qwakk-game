/**
 * Game server entry. Runs directly on Node 24 (native TypeScript type stripping).
 *
 * Env:
 *   PORT              listen port (default 2567)
 *   QWAKK_SEED        island seed (default 1337)
 *   QWAKK_STATS=1     print tick/patch timing and CPU (every QWAKK_STATS_MS, default 5000)
 *   QWAKK_BOTS=0      no bots (tests that need a quiet room)
 *   QWAKK_MAX_CLIENTS human clients per room (default 8; the benchmark raises it)
 *   QWAKK_INTEREST=0  turn interest management off (benchmark baseline)
 *   QWAKK_SPECTATORS=1 allow { spectate: true } joins (tests)
 *   COLYSEUS_LATENCY  Colyseus built-in simulated round-trip latency in ms (dev only)
 */
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { NET, ROOM } from '@qwakk/shared';
import { IslandRoom, type IslandRoomOptions } from './IslandRoom.ts';

const port = Number(process.env.PORT ?? 2567);
const roomOptions: IslandRoomOptions = {
  seed: Number(process.env.QWAKK_SEED ?? ROOM.defaultSeed),
  statsMs: process.env.QWAKK_STATS === '1' ? Number(process.env.QWAKK_STATS_MS ?? 5000) : 0,
  bots: process.env.QWAKK_BOTS !== '0',
  maxClients: Number(process.env.QWAKK_MAX_CLIENTS ?? ROOM.maxClients),
  interest: process.env.QWAKK_INTEREST !== '0',
  spectators: process.env.QWAKK_SPECTATORS === '1',
};

const server = new Server({
  transport: new WebSocketTransport({
    // Hard cap on any single client frame. Inputs are a few dozen bytes.
    maxPayload: NET.maxMessageBytes,
  }),
});

server.define(ROOM.name, IslandRoom, roomOptions);

await server.listen(port);
console.log(`[qwakk-game] server listening on ws://localhost:${port} (room "${ROOM.name}", seed ${roomOptions.seed})`);

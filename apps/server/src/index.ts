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
 *   QWAKK_BR_COUNTDOWN battle royale start countdown seconds (default 30; tests use less)
 *   QWAKK_BR_MIN_HUMANS humans a room needs before the countdown starts (default 3;
 *                     e2e and benchmarks with fewer browsers use 1 or 2)
 *   QWAKK_BR_SEED     battle royale match seed (default: random per match)
 *   QWAKK_ZONE_SCALE  zone timeline speed-up for tests (0.2 = five times faster)
 *   COLYSEUS_LATENCY  Colyseus built-in simulated round-trip latency in ms (dev only)
 *   Meta layer (identity, leaderboard, limits): DATABASE_URL, SESSION_SECRET,
 *   TURNSTILE_SECRET, TRUST_PROXY, ALLOWED_ORIGINS (see src/meta/config.ts)
 */
import { matchMaker, Server } from '@colyseus/core';
import { createServer } from 'node:http';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { BR, NET, ROOM } from '@qwakk/shared';
import { IslandRoom, type IslandRoomOptions } from './IslandRoom.ts';
import { BrRoom, type BrRoomOptions } from './BrRoom.ts';
import { createBrBot } from './br/brBot.ts';
import { BotNav } from './nav/botNav.ts';
import { loadOrBuildInBackground } from './nav/navmesh.ts';
import { loadSainteCanard } from './maps.ts';
import { allowCreateRoom, applyMatchmakingCors, checkUpgradeOrigin, guardJoinIps, joinIp, metaHttpHandler, startMeta } from './meta/index.ts';
import { QwakkLobby } from './lobby.ts';
import { installMatchmakingGuard } from './matchmaking.ts';
import { LOBBY_ROOM } from '@qwakk/shared/lobby';

const port = Number(process.env.PORT ?? 2567);
const envNumber = (name: string): number | undefined => (process.env[name] ? Number(process.env[name]) : undefined);
const roomOptions: IslandRoomOptions = {
  seed: Number(process.env.QWAKK_SEED ?? ROOM.defaultSeed),
  statsMs: process.env.QWAKK_STATS === '1' ? Number(process.env.QWAKK_STATS_MS ?? 5000) : 0,
  bots: process.env.QWAKK_BOTS !== '0',
  maxClients: Number(process.env.QWAKK_MAX_CLIENTS ?? ROOM.maxClients),
  interest: process.env.QWAKK_INTEREST !== '0',
  spectators: process.env.QWAKK_SPECTATORS === '1',
};

// Our own HTTP server, so the meta layer can sanitize client IP headers on
// upgrades before Colyseus reads them (per-IP join limits).
const httpServer = createServer();
const server = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    // Hard cap on any single client frame. Inputs are a few dozen bytes.
    maxPayload: NET.maxMessageBytes,
    // Meta: refuse browser upgrades from origins outside ALLOWED_ORIGINS (when set).
    beforeUpgrade: checkUpgradeOrigin,
  }),
  // Meta: /health and /api/* (session, leaderboard, me) on the same port.
  express: (app) => {
    app.disable('x-powered-by');
    app.use(['/api', '/health'], metaHttpHandler);
  },
});
// Meta: matchmaking CORS follows ALLOWED_ORIGINS (when set); then connect and migrate the database.
guardJoinIps(httpServer);
applyMatchmakingCors(matchMaker.controller);
await startMeta();

server.define(ROOM.name, IslandRoom, roomOptions);

// Bot navmesh for Sainte-Canard: from the cache (fast), or built on a worker
// thread (about a minute) while the server already runs; bots steer without
// paths until it is ready.
let botNav: BotNav | null = null;
const sainte = loadSainteCanard();
void loadOrBuildInBackground(sainte.def, sainte.hash).then(
  (r) => {
    botNav = new BotNav(r.navMesh);
    console.log(`[nav] navmesh ready: ${r.source} in ${Math.round(r.ms)} ms${r.file ? ` (${r.file})` : ''}`);
  },
  (err: unknown) => console.error('[nav] navmesh failed, bots steer without paths:', err),
);

const brOptions: BrRoomOptions = {
  statsMs: roomOptions.statsMs,
  bots: roomOptions.bots,
  interest: roomOptions.interest,
  // QWAKK_BR_WARMUP: the old name, still read so existing scripts keep working.
  countdownSeconds: envNumber('QWAKK_BR_COUNTDOWN') ?? envNumber('QWAKK_BR_WARMUP'),
  minHumans: envNumber('QWAKK_BR_MIN_HUMANS'),
  seed: process.env.QWAKK_BR_SEED ? Number(process.env.QWAKK_BR_SEED) : undefined,
  zoneTimeScale: process.env.QWAKK_ZONE_SCALE ? Number(process.env.QWAKK_ZONE_SCALE) : undefined,
  createBot: (ctx, id) => createBrBot(ctx, id, () => botNav),
};
// Lobby rooms: the built-in LobbyRoom lists battle royale rooms live (lobby.ts);
// Quick Play (joinOrCreate) picks the open room with the most players.
server.define(BR.roomName, BrRoom, brOptions).enableRealtimeListing().sortBy({ clients: -1 });
server.define(LOBBY_ROOM, QwakkLobby);
// Room creation limits and join option filtering on every matchmaking request (matchmaking.ts).
installMatchmakingGuard(matchMaker.controller, LOBBY_ROOM, {
  maxRooms: { [BR.roomName]: BR.maxRooms },
  noCreate: [LOBBY_ROOM],
  countRooms: async (name) => (await matchMaker.query({ name })).length,
  hasOpenRoom: async (name) => Boolean(await matchMaker.findOneRoomAvailable(name, {})),
  allowCreate: allowCreateRoom,
  ipOf: (auth) => joinIp(auth),
});

await server.listen(port);
console.log(`[qwakk-game] server listening on ws://localhost:${port} (rooms "${ROOM.name}" deathmatch seed ${roomOptions.seed}, "${BR.roomName}" battle royale)`);

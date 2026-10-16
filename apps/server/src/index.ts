/**
 * Game server entry. Runs directly on Node 24 (native TypeScript type stripping).
 *
 * Env:
 *   PORT              listen port (default 2567)
 *   QWAKK_SEED        greybox seed (default 1337)
 *   QWAKK_DM_MAP      deathmatch map id for this run (default MATCH.mapId; 'greybox' works too)
 *   QWAKK_DM_SPAWN_RADIUS deathmatch spawns only within this many meters of the arena center (tests)
 *   QWAKK_STATS=1     print tick/patch timing and CPU (every QWAKK_STATS_MS, default 5000)
 *   QWAKK_BOTS=0      no bots (tests that need a quiet room)
 *   QWAKK_MAX_CLIENTS human clients per deathmatch room (default 32; the benchmark raises it)
 *   QWAKK_INTEREST=0  turn interest management off (benchmark baseline)
 *   QWAKK_SPECTATORS=1 allow { spectate: true } joins (tests)
 *   QWAKK_BR_COUNTDOWN battle royale start countdown seconds (default 30; tests use less)
 *   QWAKK_BR_MIN_HUMANS humans a room needs before the countdown starts (default 3;
 *                     e2e and benchmarks with fewer browsers use 1 or 2)
 *   QWAKK_BR_SEED     battle royale match seed (default: random per match)
 *   QWAKK_ZONE_SCALE  zone timeline speed-up for tests (0.2 = five times faster)
 *   COLYSEUS_LATENCY  Colyseus built-in simulated round-trip latency in ms (dev only)
 *   QWAKK_CLIENT_DIR  serve the built client from this folder on the same port
 *                     (the server image sets it; unset in dev, where Vite serves it)
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
import { dmMapId, GREYBOX, loadMapV1, SAINTE_CANARD } from './maps.ts';
import { createDmBot } from './dmBot.ts';
import { allowCreateRoom, applyMatchmakingCors, checkUpgradeOrigin, guardJoinIps, joinIp, metaHttpHandler, startMeta } from './meta/index.ts';
import { QwakkLobby } from './lobby.ts';
import { installMatchmakingGuard } from './matchmaking.ts';
import { DM_OPEN_ROOMS, DM_ROOM_CATALOG, LOBBY_ROOM } from '@qwakk/shared/lobby';
import { createClientHandler } from './staticClient.ts';

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

const clientDir = process.env.QWAKK_CLIENT_DIR?.trim() || null;

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
  // Then the built client, when QWAKK_CLIENT_DIR is set (one origin for page, matchmaking and WebSocket).
  express: (app) => {
    app.disable('x-powered-by');
    app.use(['/api', '/health'], metaHttpHandler);
    if (clientDir) app.use(createClientHandler(clientDir));
  },
});
// Meta: matchmaking CORS follows ALLOWED_ORIGINS (when set); then connect and migrate the database.
guardJoinIps(httpServer);
applyMatchmakingCors(matchMaker.controller);
await startMeta();

// Bot navmeshes for the map_v1 maps in play (Sainte-Canard for the battle
// royale, the deathmatch map): from the cache (fast), or built on a worker
// thread (about a minute for Sainte-Canard) while the server already runs;
// bots steer without paths until theirs is ready.
const navs = new Map<string, BotNav | null>();
function startNav(id: string): void {
  if (id === GREYBOX || navs.has(id)) return;
  navs.set(id, null);
  const map = loadMapV1(id);
  void loadOrBuildInBackground(map.def, map.hash).then(
    (r) => {
      navs.set(id, new BotNav(r.navMesh));
      console.log(`[nav] ${id} navmesh ready: ${r.source} in ${Math.round(r.ms)} ms${r.file ? ` (${r.file})` : ''}`);
    },
    (err: unknown) => console.error(`[nav] ${id} navmesh failed, bots steer without paths:`, err),
  );
}
const navOf = (id: string) => () => navs.get(id) ?? null;
const dmMap = dmMapId();
startNav(SAINTE_CANARD);
startNav(dmMap);

// Deathmatch rooms: static (DM_ROOMS), opened below, never by a client.
// QWAKK_DM_ROOMS opens more of the catalog for the benchmark only: the menu lists DM_ROOMS.
const dmRooms = DM_ROOM_CATALOG.slice(0, envNumber('QWAKK_DM_ROOMS') ?? DM_OPEN_ROOMS);
// Quick Play joins the open one with the most humans (matchmaking guard: join only).
const spawnRadius = envNumber('QWAKK_DM_SPAWN_RADIUS');
server
  .define(ROOM.name, IslandRoom, { ...roomOptions, mapId: dmMap, spawnRadius, createBot: (sim, _id) => createDmBot(sim, navOf(dmMap)) })
  .enableRealtimeListing()
  .sortBy({ 'metadata.humans': -1, clients: -1 });

const brOptions: BrRoomOptions = {
  statsMs: roomOptions.statsMs,
  bots: roomOptions.bots,
  interest: roomOptions.interest,
  // QWAKK_BR_WARMUP: the old name, still read so existing scripts keep working.
  countdownSeconds: envNumber('QWAKK_BR_COUNTDOWN') ?? envNumber('QWAKK_BR_WARMUP'),
  minHumans: envNumber('QWAKK_BR_MIN_HUMANS'),
  seed: process.env.QWAKK_BR_SEED ? Number(process.env.QWAKK_BR_SEED) : undefined,
  zoneTimeScale: process.env.QWAKK_ZONE_SCALE ? Number(process.env.QWAKK_ZONE_SCALE) : undefined,
  createBot: (ctx, id) => createBrBot(ctx, id, navOf(SAINTE_CANARD)),
};
// Lobby rooms: the built-in LobbyRoom lists battle royale and deathmatch rooms live (lobby.ts);
// battle royale Quick Play (joinOrCreate) picks the open room with the most players.
server.define(BR.roomName, BrRoom, brOptions).enableRealtimeListing().sortBy({ clients: -1 });
server.define(LOBBY_ROOM, QwakkLobby);
// Room creation limits and join option filtering on every matchmaking request (matchmaking.ts).
installMatchmakingGuard(matchMaker.controller, LOBBY_ROOM, {
  maxRooms: { [BR.roomName]: envNumber('QWAKK_BR_MAX_ROOMS') ?? BR.maxRooms },
  noCreate: [LOBBY_ROOM],
  joinOnly: [ROOM.name],
  countRooms: async (name) => (await matchMaker.query({ name })).length,
  hasOpenRoom: async (name) => Boolean(await matchMaker.findOneRoomAvailable(name, {})),
  allowCreate: allowCreateRoom,
  ipOf: (auth) => joinIp(auth),
});

await server.listen(port);
for (const r of dmRooms) await matchMaker.createRoom(ROOM.name, { dmRoom: r.id });
console.log(`[qwakk-game] server listening on ws://localhost:${port} (deathmatch rooms ${dmRooms.map((r) => r.id).join(', ')} on ${dmMap}, "${BR.roomName}" battle royale)`);

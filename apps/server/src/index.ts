/**
 * Game server entry. Runs directly on Node 24 (native TypeScript type stripping).
 *
 * Env:
 *   PORT              listen port (default 2567)
 *   QWAKK_SEED        greybox seed (default 1337)
 *   QWAKK_DM_MAP      deathmatch map id for this run (default MATCH.mapId; 'greybox' works too)
 *   QWAKK_DM_SPAWN_RADIUS deathmatch spawns only within this many meters of the arena center (tests)
 *   QWAKK_DM_HERO=0   no caped hero in the deathmatch (tests that check health; the admin setting dm.hero)
 *   QWAKK_STATS=1     print tick/patch timing and CPU (every QWAKK_STATS_MS, default 5000)
 *   QWAKK_BOTS=0      no bots (tests that need a quiet room)
 *   QWAKK_MAX_CLIENTS human clients per deathmatch room (default 32; the benchmark raises it)
 *   QWAKK_INTEREST=0  turn interest management off (benchmark baseline)
 *   QWAKK_SPECTATORS=1 allow { spectate: true } joins (tests)
 *   QWAKK_BR_COUNTDOWN battle royale start countdown seconds (default 30; tests use less)
 *   QWAKK_BR_MIN_HUMANS humans a room needs before the countdown starts (default 2;
 *                     e2e and benchmarks with fewer browsers use 1 or 2)
 *   QWAKK_BR_SEED     battle royale match seed (default: random per match)
 *   QWAKK_ZONE_SCALE  zone timeline speed-up for tests (0.2 = five times faster)
 *   QWAKK_TEST_HOOKS=1 tests only, refused in production: a client may hurt its own
 *                     battle royale duck (the party e2e knocks a duck to revive it), and
 *                     the dev mail sink's codes are readable at GET /api/test/mail
 *   Accounts (email sign-in codes): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
 *                     MAIL_FROM (see src/meta/config.ts; unset in dev: a local mail sink)
 *   COLYSEUS_LATENCY  Colyseus built-in simulated round-trip latency in ms (dev only)
 *   QWAKK_CLIENT_DIR  serve the built client from this folder on the same port
 *                     (the server image sets it; unset in dev, where Vite serves it)
 *   Meta layer (identity, leaderboard, limits): DATABASE_URL, SESSION_SECRET,
 *   TURNSTILE_SECRET, TRUST_PROXY, ALLOWED_ORIGINS (see src/meta/config.ts)
 *   Admin panel at /admin: ADMIN_PASSWORD_HASH, ADMIN_TOTP_SECRET (both, or the
 *   panel is off), QWAKK_ADMIN_DIR (see src/admin/config.ts). The runtime
 *   settings it changes are in src/settings/ (the constants are the defaults).
 */
import { matchMaker, Server } from '@colyseus/core';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { BR, NET, PARTY, ROOM } from '@qwakk/shared';
import { IslandRoom, type IslandRoomOptions } from './IslandRoom.ts';
import { BrRoom, type BrRoomOptions } from './BrRoom.ts';
import { createBrBot } from './br/brBot.ts';
import { BotNav } from './nav/botNav.ts';
import { loadOrBuildInBackground } from './nav/navmesh.ts';
import { dmMapId, GREYBOX, loadMapV1, SAINTE_CANARD } from './maps.ts';
import { createDmBot } from './dmBot.ts';
import { allowCreateRoom, allowPartyCreate, allowPartyJoin, applyMatchmakingCors, checkUpgradeOrigin, guardJoinIps, joinIp, metaHttpHandler, startMeta, verifySession } from './meta/index.ts';
import { parties } from './party/registry.ts';
import { PartyRoom } from './party/PartyRoom.ts';
import { QwakkLobby } from './lobby.ts';
import { installMatchmakingGuard } from './matchmaking.ts';
import { CLOSE_CODE, LOBBY_ROOM } from '@qwakk/shared/lobby';
import { createClientHandler } from './staticClient.ts';
import { brMaxRooms, openDmRooms } from './settings/index.ts';
import { startAdmin } from './admin/index.ts';
import { createAdminHandler, type AdminHandler } from './admin/http.ts';
import { installDmRoomControl } from './ops/dmRooms.ts';
import { beforeCreate } from './ops/policy.ts';

const port = Number(process.env.PORT ?? 2567);
const envNumber = (name: string): number | undefined => (process.env[name] ? Number(process.env[name]) : undefined);
const roomOptions: IslandRoomOptions = {
  seed: Number(process.env.QWAKK_SEED ?? ROOM.defaultSeed),
  statsMs: process.env.QWAKK_STATS === '1' ? Number(process.env.QWAKK_STATS_MS ?? 5000) : 0,
  bots: process.env.QWAKK_BOTS !== '0',
  // Unset: humans per deathmatch room from the admin settings (dm.maxHumans, default ROOM.maxClients).
  maxClients: envNumber('QWAKK_MAX_CLIENTS'),
  interest: process.env.QWAKK_INTEREST !== '0',
  spectators: process.env.QWAKK_SPECTATORS === '1',
};

const clientDir = process.env.QWAKK_CLIENT_DIR?.trim() || null;
// The /admin handler (a plain 404 until the admin module has started, and for good when it is off).
let adminHandler: AdminHandler = createAdminHandler(null);

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
    // Admin panel: before the client files; its app bundle is served from its own folder, never the public one.
    app.use((req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => adminHandler(req, res, next));
    if (clientDir) app.use(createClientHandler(clientDir));
  },
});
// Meta: matchmaking CORS follows ALLOWED_ORIGINS (when set); then connect and migrate the database.
guardJoinIps(httpServer);
applyMatchmakingCors(matchMaker.controller);
await startMeta();
// Stored admin state (runtime settings, bans, blocked words), then the /admin handler.
adminHandler = (await startAdmin()).handler;

// Bot navmeshes for the map_v1 maps in play (Yelova for the battle
// royale, the deathmatch map): from the cache (fast), or built on a worker
// thread (about a minute for Yelova) while the server already runs;
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

// Deathmatch rooms: static, opened below by the server (never by a client) as the
// `dm.room.*` settings say (default: DM_OPEN_ROOMS of the catalog), and opened or
// closed live from the admin panel. QWAKK_DM_ROOMS opens the first N (benchmark).
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
  testHooks: process.env.QWAKK_TEST_HOOKS === '1' && process.env.NODE_ENV !== 'production',
};
// Lobby rooms: the built-in LobbyRoom lists battle royale and deathmatch rooms live (lobby.ts);
// battle royale Quick Play (joinOrCreate) picks the open room with the most players.
server.define(BR.roomName, BrRoom, brOptions).enableRealtimeListing().sortBy({ clients: -1 });
server.define(LOBBY_ROOM, QwakkLobby);
// Parties: private rooms joined by code (party/PartyRoom.ts); never listed.
server.define(PARTY.roomName, PartyRoom);
// Room creation limits and join option filtering on every matchmaking request (matchmaking.ts).
installMatchmakingGuard(matchMaker.controller, LOBBY_ROOM, {
  // Read on every request: the admin settings (br.maxRooms; QWAKK_BR_MAX_ROOMS overrides).
  maxRooms: {
    get [BR.roomName]() {
      return brMaxRooms();
    },
  },
  // Maintenance and the team modes switched off (admin settings).
  beforeCreate,
  noCreate: [LOBBY_ROOM],
  joinOnly: [ROOM.name],
  countRooms: async (name) => (await matchMaker.query({ name })).length,
  hasOpenRoom: async (name) => Boolean(await matchMaker.findOneRoomAvailable(name, {})),
  allowCreate: allowCreateRoom,
  ipOf: (auth) => joinIp(auth),
  party: { roomName: PARTY.roomName, allowCreate: allowPartyCreate, allowJoin: allowPartyJoin },
  // `{ spectate: true }` only where spectators are on (QWAKK_SPECTATORS=1, the deathmatch rooms).
  spectators: (name) => roomOptions.spectators === true && name === ROOM.name,
  // Guests play deathmatch only: battle royale needs an account (and a party without guests).
  accountOnly: {
    rooms: [BR.roomName],
    identify: verifySession,
    partyHasGuest: (id) => parties.partyHasGuest(id),
    roomNameOf: (id) => matchMaker.getLocalRoomById(id)?.roomName,
  },
});

await server.listen(port);
await installDmRoomControl({
  isOpen: (id) => matchMaker.getLocalRoomById(id) !== undefined,
  open: (id) => matchMaker.createRoom(ROOM.name, { dmRoom: id }),
  close: async (id) => matchMaker.getLocalRoomById(id)?.disconnect(CLOSE_CODE.roomClosed),
});
console.log(`[qwakk-game] server listening on ws://localhost:${port} (deathmatch rooms ${openDmRooms().join(', ') || 'none'} on ${dmMap}, "${BR.roomName}" battle royale)`);

# Qwakk game

A browser third-person shooter with ducks, planned to live at `qwakk.fun/game`. This repo is at **Phase 2**: a 16-duck battle royale on **Sainte-Canard**, a Normandy-style coastal village in toon style. Ducks board a plane, jump, glide down, loot guns, armor and heals, and fight inside a shrinking zone until one duck is left; server bots on a navmesh fill the empty seats. The Phase 1 deathmatch (8 ducks on the greybox island) is still there. Both modes share CS-style gunplay, server-authoritative hits with lag compensation, client-side prediction of movement and shooting, and toon ducks from the art workstream.

Phase 0 (the foundation: sim, netcode, camera) is described in the netcode section below.

The full plan (stack, netcode rules, roadmap) is in `../GAME_PLAN.md` in the workspace.

## Layout

```
qwakk-game/
  packages/shared/   Pure TypeScript sim used by client and server (no DOM, no network)
    src/constants.ts   Every feel and netcode number, in one place
    src/sim.ts         stepPlayer(): one fixed step of a player on a Rapier character controller
    src/map.ts         Island generated from a seed (heightfield, houses, ramps, rocks, cover)
    src/physics.ts     Rapier world built from the map (identical on client and server)
    src/input.ts       Input frame type and the sanitizer the server applies
    src/math.ts        Deterministic sin/cos and helpers
    src/rng.ts         Seeded RNG and value noise
    src/weapons.ts     Every weapon number: damage, fire rate, ammo, spread, spray patterns
    src/combat.ts      Weapon state machine (fire rate, ammo, reload, switching), stepped with movement
    src/shot.ts        Hitscan: camera ray finds the aim point, muzzle trace decides (TPS rule)
    src/hitbox.ts      Head sphere and body capsule per stance, analytic ray tests
    src/net/schema.ts  Colyseus Schema 5 state, quantized poses, zone, loot items, input and message ids
    src/collision.ts   Collision groups: what each collider blocks (move, bullets, sight, opaque)
    src/mapV1.ts       Loader for the map_v1 files (Sainte-Canard): terrain, prop colliders, BR data
    src/maps/          The shipped map files (npm run map:sync copies them from the map workstream)
    src/drop.ts        Freefall and glider (stepped in the sim, predicted)
    src/heal.ts        Bandages and medkits: timed, slow you down, interruptible (in the sim)
    src/items.ts       Item kinds, loot tables, pickup rules, armor math
    src/zone.ts        Circle plan (final circle first, from the map's candidates) and timeline
    src/plane.ts       The drop plane's route from the map's flight paths
    test/              Vitest: determinism, movement feel, weapons, hitscan, loot, armor, heals, drop, zone
  apps/server/       Colyseus 0.18 game server (Node 24, runs the .ts sources directly)
    src/gameRoom.ts    Networking glue for both modes: auth, joins, inputs, patches, views, messages
    src/IslandRoom.ts  The deathmatch room (greybox island)
    src/BrRoom.ts      The battle royale room (Sainte-Canard): lock, plane, zone, loot views, spectating, results
    src/arena.ts       Authoritative combat core: one input path, shots, damage, separation, history
    src/deathmatch.ts  Deathmatch rules: spawns, respawns, rounds, score limit
    src/br/            Battle royale rules, loot in the world, results, bots (landing, looting, fighting)
    src/nav/           Recast navmesh from the map colliders (cached), paths for the bots
    src/visibility.ts  Line-of-sight check for the anti-wallhack culling
    src/maps.ts        Map loading and the map hash
    src/lagComp.ts     Hitbox history for lag compensation (rewind capped at 230 ms)
    src/bots.ts        Server bots: same input path as players, line of sight only
    src/interest.ts    Per-viewer near (30 Hz), far (10 Hz) or no pose entry (anti-wallhack)
    src/tickLoop.ts    Fixed-rate loop with exact tick deadlines
    src/inputPacer.ts  Which steps run each tick: real inputs, stand-ins, late inputs (unit tested)
    test/              Vitest: input pacer, rewind hit/miss, fire spam, headless matches, map, navmesh, culling, placements
    bench/             Headless bots, the benchmark runners (deathmatch and battle royale)
  apps/client/       Vite + Three.js (three/webgpu, WebGL2 fallback), plain game loop
    src/play.ts        Game entry for the menu: startGame(), onGameExit()
    src/game.ts        Frame loop: pump inputs, read predicted and interpolated poses, render
    src/net/           Session (prediction, poses, messages), far-pose interpolation, fake network
    src/game/          Combat feedback, the battle royale client (brClient.ts), autopilot, metrics
    src/fx/            Particles: feathers, dust, cartoon splats; tracers and muzzle flashes
    src/audio/         Synthesized sounds (WebAudio), 3D for other players
    src/hud/           Game HUD, battle royale HUD (hud/br: minimap, map, inventory, results) and the debug HUD
    src/camera/        Over-the-shoulder spring-arm camera, recoil kick, shake, death camera
    src/player/        Duck avatar: clips, procedural layers, hand IK, weapons
    src/world/         Greybox terrain and props; world/sainte: the Sainte-Canard world (instanced props with LODs, terrain, water, sky, plane, zone wall, loot)
    public/models/     Art from the art workstream (duck, animations, weapons)
  e2e/two-clients.ts Two real headless browsers in one deathmatch room
  e2e/br-two-clients.ts Two real headless browsers in one battle royale (plane, drop, loot, culling, victory)
  e2e/br-perf.ts     Frame time and draw calls in a full battle royale (one browser, 15 bots)
  e2e/map-perf.ts    Frame time and draw calls of the map alone (dev map viewer, mapview.html)
  e2e/pause-resume.ts Node client: input pauses and network stalls, must recover within 1 s
  e2e/firefight-shots.ts Screenshots of a firefight in headless Chrome
  scripts/dev.ts     Runs server and client together
  scripts/sync-map.ts Copies the map workstream's export into packages/shared/src/maps (npm run map:sync)
  art/               Blender scripts and renders for the ducks (separate workstream)
```

## Requirements

- Node 24 or newer (the server runs TypeScript directly with Node's type stripping).
- npm 11.
- For the e2e test: Google Chrome installed (or run `npx playwright install chromium` and set `E2E_BROWSER=chromium`).

## Run it

```sh
npm install
npm run dev          # game server on :2567 and client on http://localhost:5173/game/
```

Open http://localhost:5173/game/: the menu starts a battle royale or a deathmatch. In dev you can skip the menu with `?mode=br` or `?mode=dm`.

- **Battle royale** (`br` room, up to 16 humans): joinOrCreate puts you in a warm-up on the village square (45 s, 15 s once 8 humans are in; damage off). Then the room locks, bots fill the seats to 16 ducks and everyone boards the plane. Jump with F over land (or be thrown out before the coast), fall, open the glider (Space or F, or it opens by itself 45 m above the ground), glide about 3 m forward per meter down (W dives, S brakes), land, loot, survive the zone. The last duck standing wins; dead ducks watch their killer or any duck still alive.
- **Deathmatch** (`island` room): bots fill the room up to 8 ducks; every human who joins replaces a bot. First to 25 kills or the most kills after 5 minutes wins the round, then a new round starts after 8 seconds. Played on the greybox island (kept: simpler, and the Phase 1 tests and benchmark stay comparable).

| Key | Action |
| --- | --- |
| Click | Lock the mouse and play (Esc to release) |
| WASD | Move |
| Shift | Sprint (forward) |
| Alt | Walk |
| C | Crouch (hold) |
| Space | Jump |
| Left mouse | Shoot (rifle: hold for full auto; pistol: one shot per click) |
| R | Reload (a trigger pull with rounds left cancels it) |
| 1 / 2 / mouse wheel | Rifle / pistol (switching cancels a reload) |
| E | Pick up (the item in front of you, shown in the prompt) |
| F | Jump out of the plane; open the glider |
| 4 / 5 | Bandage / medkit |
| M | Full-screen map |
| Tab | Scoreboard (battle royale: your gear and every duck) |
| Click while dead | Watch the next duck (battle royale) |
| V | Swap shoulder |
| - / = | Mouse sensitivity (saved in the browser) |
| H | Toggle the debug HUD |
| N / J / L | Fake network: cycle latency (0, 60, 120, 150, 250 ms), toggle jitter, toggle 2% loss |

### URL options

Add these to the client URL, for example `http://localhost:5173/game/?lat=120&jit=20`.

| Option | Meaning |
| --- | --- |
| `lat=120` | Fake round-trip latency in ms (dev only) |
| `jit=20` | Fake jitter, +/- half of this per direction |
| `loss=0.02` | Fake loss. On TCP this means a late resend that holds back later messages |
| `webgl=1` | Force the WebGL2 backend |
| `autopilot=1` | The duck runs in circles by itself (headless tests, phone frame-time checks) |
| `autopilot=fight` | The duck hunts and shoots the nearest visible duck (screenshots, tests) |
| `autopilot=br` | Battle royale: jumps out over land, glides, lands, walks to visible items and picks them up |
| `aptarget=40,-192` | With `autopilot=br`: jump and glide toward this point (x, z) |
| `mode=br` / `mode=dm` | Skip the menu and start a battle royale or a deathmatch (dev tools only) |
| `quality=low` | Shorter prop draw distances (the menu's quality setting wins when it starts the game) |
| `spectate=1` | Watch without playing; click to switch duck (server needs `QWAKK_SPECTATORS=1`) |
| `server=ws://host:2567` | Game server address (dev tools only; default: the page host on port 2567) |
| `pr=1` | Render scale cap (default 2 on desktop, 1.5 on touch devices) |
| `shadows=0` | Turn shadows off |
| `hud=0` | Start with the HUD hidden |
| `duck=placeholder` | Ignore `duck.glb` and use the primitive duck |
| `lerpsmooth=30` | Output smoothing for remote players in ms (dev tools only; lag compensation assumes 30) |

The fake network options, the N / J / L keys, `?server=`, `autopilot`, `spectate` and the `window.__qwakk` test hook are dev tools, decided at build time: on in `npm run dev` and in the test bundle (`npm run build:test`, built with `VITE_DEVTOOLS=1` into `apps/client/dist-test`), and compiled out of the public bundle (`npm run build`). The public bundle does not contain the autopilot or the test hook at all.

Fake latency set in the URL is applied from the first message, which is how latency should be tested. Toggling it in the middle of a session (N key) works for feel, but the Colyseus clock treats a sudden jump in round trip as an outlier, so the HUD ping is the reliable number then.

The server also has Colyseus' own latency simulation: `COLYSEUS_LATENCY=120 npm start` (round trip, no jitter).

### Phone on the LAN

```sh
npm run dev:lan
```

Vite prints a `Network:` URL. Open it on a phone on the same Wi-Fi, with `/game/?autopilot=1` so the duck moves without touch controls, and read the frame time in the HUD. macOS may ask to allow incoming connections for Node. The client connects to the game server on the same host, port 2567.

## Check it

```sh
npm run typecheck    # all workspaces plus scripts and e2e
npm test             # Vitest: shared sim, server (pacer, hits, bots) and client (far interpolation)
npm run build        # typecheck, then the client production build in apps/client/dist
npm run build:test   # the same client with dev tools, for the browser tests (apps/client/dist-test)
npm run e2e          # two headless Chrome clients in a deathmatch, then in a battle royale (build:test first)
npm run e2e:br -- DIR # only the battle royale e2e; saves its screenshots to DIR
npm run test:net     # pause and stall recovery against the real server
npm run test:br      # headless 16-bot battle royale (server workspace)
npm run bench        # server benchmark at 8, 16 and 32 bots (npm run bench -- 4 64 for other counts)
npm run bench:br     # battle royale benchmark: network clients plus bots, bandwidth, CPU, culling
npm run shots -- DIR # screenshots of a deathmatch firefight (build:test first)
npm run perf:br -- DIR # battle royale frame time, CPU per frame and draw calls in headless Chrome
npm run perf:map -- DIR # the map alone in the dev map viewer
npm run map:sync     # copy the map workstream's export into packages/shared/src/maps
```

Server environment switches: `QWAKK_BOTS=0` (no bots), `QWAKK_MAX_CLIENTS` (humans per deathmatch room, default 8), `QWAKK_INTEREST=0` (every player at full rate), `QWAKK_SPECTATORS=1` (allow spectators), `QWAKK_BR_WARMUP` (battle royale warm-up seconds), `QWAKK_BR_SEED` (fixed match seed: plane path, circles, loot), `QWAKK_ZONE_SCALE` (zone timeline speed-up for tests, 0.25 is four times faster), `QWAKK_NAV_CACHE` (navmesh cache folder).

## Meta: identity, leaderboard, menu

The menu is the first screen at `/game/`. Guests pick a nickname, the server gives them a `#1234` tag and a signed identity, and finished matches feed a per-season leaderboard. The leaderboard is in-game stats only (no prizes, no tokens) and only the game server writes it. Data handling for the privacy page: `docs/privacy-notes.md`.

### Code

- `apps/server/src/meta/`: `index.ts` (the contract the rooms use), `service.ts` (sessions, limits, recording, reads), `http.ts` (routes), `token.ts` (HMAC tokens), `names.ts` with `blocked-names.json` (name rules and word filter), `rateLimit.ts`, `ip.ts`, `turnstile.ts`, `score.ts`, `matches.ts`, `leaderboard.ts`, `players.ts`, `migrate.ts`, `config.ts`.
- `apps/server/db/migrations/`: plain SQL, applied in order at server start.
- `apps/client/src/ui/menu/`: the menu (pure DOM, no game imports, so it paints before the game bundle loads), `apps/client/src/settings.ts` (saved settings), `apps/client/public/ui/` (menu art).

### Contract for the game rooms (`apps/server/src/meta/index.ts`)

| Function | Behavior |
| --- | --- |
| `verifySession(token)` | `{ playerId, name, tag }` for a valid session token, else `null`. No token: a random guest in dev, `null` when `NODE_ENV=production` |
| `allowJoin(ip)` | Per-IP join limit: a burst of 10, then one join every 4 s (IPv6 counted per /64). Loopback is exempt outside production, for the benchmark and e2e |
| `joinIp(context)` | The client IP from a Colyseus `AuthContext`. Colyseus fills `context.ip` from client-controlled headers, so `guardJoinIps(httpServer)` (installed in `index.ts`) rewrites `X-Real-IP` on every upgrade first: the socket address, or with `TRUST_PROXY` the entry our proxy appended to `X-Forwarded-For` |
| `recordMatch(result)` | Writes a finished match. No-op without `DATABASE_URL`, never throws, yields before any work so the tick is not held up, ignores a repeated `matchId`, queues up to 200 results while the database is down. Optional per-player `deaths` (default: royale 1 unless the player won, deathmatch 0; pass it for deathmatch so K/D is right) |

The client side calls the game module's `startGame({ mode, token, name, settings })` and `onGameExit(cb)`; `settings.sensitivity` is in radians per mouse count (the `Controls` unit). In dev and test builds, `?mode=br`, `?mode=dm`, `?autopilot=` and `?spectate=1` skip the menu.

### HTTP endpoints (same port as the game server)

| Route | What |
| --- | --- |
| `GET /health` | `{ ok: true, db: 'off' or 'starting' or 'up' or 'down' }`, no database query |
| `POST /api/session` | Body `{ name, deviceToken?, turnstileToken? }` (JSON, max 4 KB). Returns `{ token, expiresAt, deviceToken, playerId, name, tag }`. Without a valid device token this creates a new guest, which needs Turnstile when `TURNSTILE_SECRET` is set. A rename keeps the player id (and the tag when it is free under the new name). Limit: a burst of 8, then one every 20 s per IP |
| `GET /api/leaderboard?season=&mode=&sort=` | Top 100. `season`: id or empty for the current one. `mode`: `all`, `br`, `dm`. `sort`: `score`, `wins`, `kills`, `kd`, `matches`, `avgPlace` (the last two ratio sorts need 5 matches). Cached 30 s |
| `GET /api/me?season=&mode=` | With `Authorization: Bearer <session>`: your identity, rank (by score) and stats |

Errors are JSON `{ error }`: `name_format`, `name_blocked`, `name_reserved`, `name_full`, `turnstile_failed`, `rate_limited` (with `Retry-After`), `unauthorized`, `unavailable` (no database), `origin_not_allowed`, `bad_request`.

### Score

Per match: placement points `round(50 * (field - place) / (field - 1))` (field = everyone in the match, bots included), plus 50 for first place, plus 10 per kill counting at most 20 kills, times 1 for battle royale and 0.5 for deathmatch. Season score is the sum. Winning a 32-duck royale with 6 kills is 160. Rank is the position by score (ties: wins, then kills). K/D floors deaths at 1. Bots are stored but never ranked. Numbers live in `apps/server/src/meta/score.ts`.

### Environment

Server:

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL. Unset: no leaderboard, matches not recorded, sessions still work |
| `SESSION_SECRET` | HMAC key for session and device tokens, 32 characters or more. Required in production (the server refuses to start without it); a dev default is used otherwise. Rotating it resets every guest identity |
| `TURNSTILE_SECRET` | Cloudflare Turnstile secret. Unset: new guests are not challenged |
| `TRUST_PROXY` | Number of reverse proxies in front (CapRover: `1`). Only then is `X-Forwarded-For` read, from the right |
| `ALLOWED_ORIGINS` | Comma-separated browser origins, for example `https://qwakk.fun`. Applies to `/api`, Colyseus matchmaking CORS and WebSocket upgrades. Unset: all three are same-origin only in production (a client served from another host cannot join; the server logs a loud warning at startup) and open in dev |

Client (build time): `VITE_API_BASE` (API origin; default: derived from `VITE_GAME_SERVER`, else the page host on port 2567), `VITE_TURNSTILE_SITEKEY` (shows the Turnstile check for new guests; unset: no widget and no request to Cloudflare).

### Database setup

```sh
docker compose up -d postgres     # PostgreSQL 17 on 127.0.0.1:5439
DATABASE_URL=postgres://qwakk_game:qwakk_game_local@localhost:5439/qwakk_game npm run dev
docker compose down               # keeps the data volume
```

Migrations run at server start (one transaction under an advisory lock, recorded in `schema_migrations`). Never edit an applied migration; add `002_*.sql`. Tables: `seasons` (season 1 starts when the first migration runs), `players`, `matches`, `match_players`, and the view `leaderboard_stats`. A new season: insert a row in `seasons` with a later `starts_at` and set the old one's `ends_at`.

### Tests

`npm test` runs the meta unit tests (names and word filter, tokens and tampering, rate limits, IPs, score, settings, menu entry) and the PostgreSQL tests (migration runner, `recordMatch`, the session to leaderboard flow). The PostgreSQL tests use a throwaway database on `localhost:5439` (`TEST_DATABASE_URL` overrides) and are skipped with a message when it is not reachable.

Menu in headless Chrome (needs the local PostgreSQL; uses ports 2591 and 5181):

```sh
node --disable-warning=ExperimentalWarning apps/client/test/menu/browser-check.ts DIR
```

It seeds a throwaway database, checks render, the name filter message, the leaderboard, settings persistence across a reload, keyboard tabs, that Play calls the game entry with the session and settings, the result card, and the phone layout, and saves screenshots to `DIR`.

## Battle royale

### Match flow

| Stage | What happens |
| --- | --- |
| Warm-up | joinOrCreate on the `br` room. 45 s from the first human (15 s once 8 humans are in), on the village square, both guns, damage off |
| Lock | The room locks, bots fill to 16, loot is rolled, the zone is planned, everyone boards the plane with no gear |
| Plane | One of the map's 8 flight paths (match seed mod 8), 180 m up at 55 m/s. F jumps (only over land); everyone still aboard is ejected 70 m before the last land point |
| Drop | Freefall (32 m/s down, W dives to 46 m/s, 10 m/s steering), then the glider: Space or F, or by itself 45 m above the terrain. Gliding: 13 m/s forward, 4.3 m/s down (about 1:3); W dives (19 / 7.5), S brakes (6 / 3) |
| Loot | 618 loot points: each floor point holds an item 70% of the time, crates always; tables by tier (1 to 4), better in hot zones and upstairs; every gun comes with an ammo stack |
| Zone | 7 phases (table below), final circle picked first from the map's weighted candidates, then grown outward so every circle contains the next and keeps at least 70% land |
| End | The last duck standing wins; every duck gets a place (a duck that leaves mid-match is out with the place it had then; a winner who leaves the results screen stays the winner). Results go to the leaderboard through `recordMatch`, also when the last human leaves before the end (the room records the match as it stands). One identity holds at most one seat per room. The room closes 20 s later |

| Phase | Wait (s) | Shrink (s) | End radius (m) | Damage per second outside |
| --- | --- | --- | --- | --- |
| 0 (drop and loot) | 90 | snap | 380 (shown at 60 s) | 0 |
| 1 | 90 | 60 | 260 | 1 |
| 2 | 60 | 45 | 170 | 2 |
| 3 | 50 | 40 | 105 | 4 |
| 4 | 40 | 30 | 60 | 7 |
| 5 | 30 | 25 | 30 | 11 |
| 6 | 20 | 20 | 0 | 18 |

All of it is in `constants.ts` (`BR`, `DROP`, `HEAL`, `ZONE`, `VIS`, `WATER`) and `items.ts` (`LOOT`, `ARMOR`, loot tables).

### Items

| Item | Rule |
| --- | --- |
| Rifle, pistol | One slot each (1 and 2). The first one comes with a full magazine and is equipped if you are unarmed; a gun you already have becomes reserve ammo |
| Rifle ammo (30), pistol ammo (24) | Up to 180 rifle and 96 pistol rounds in reserve; what does not fit stays on the ground |
| Vest level 1 / 2 | 30% / 40% less body damage, 100 / 150 durability; each hit wears 0.75 per point of raw damage; taken only as an upgrade |
| Helmet level 1 / 2 | 30% / 40% less head damage, 80 / 120 durability |
| Bandage | 4 s, +15 health up to 75; up to 10 |
| Medkit | 7 s, full health; up to 3 |

Heals slow you to 2.2 m/s and stop when you fire, reload, switch or jump (the item is kept). A dead duck drops a crate with its guns (with the rounds still in them), reserve ammo, armor (with its durability) and heals; E on the crate takes everything that fits. Nothing is created on the way.

Pickups are server decisions: E is an input button, and the server checks reach (2.6 m from the chest) and line of sight before it moves anything into the inventory. Inventory, ammo, armor durability and health are owner-only (`.view()`); other players only see the armor levels (drawn on the duck), the held gun and the glider.

### The map: Sainte-Canard

The map workstream exports `map_v1` (format v2) to `art/map/export/` and the prop kit to `apps/client/public/models/props/`. `npm run map:sync` copies `map_v1.json`, `map_v1_heights.bin`, `map_v1_ground.bin` and `colliders.json` into `packages/shared/src/maps/sainte-canard/`: the server reads them from there and the client bundles the same files, so both build the same 6,702 colliders. `npm test` fails when the copy is stale. The room sends the map id and a hash of the three files the sim uses; a client with different files refuses to play.

Collider kinds follow the map's table: `wire` and `fence` block movement only, `hedge` blocks movement and sight but not bullets, `foliage` (bushes) only hides. The river and the shallow sea slow you down (70% when the water is over 25 cm, 45% over 1 m).

The client draws the props as instanced meshes per prop type and LOD level, refilled from the visible chunks with per-instance LOD by distance (`manifest.json` switch distances, 0.6 times on the low quality setting), terrain with the ground paint, river and sea, and a sky and fog that hide the cull distance. Ducks past 35 m drop their outline and shadow.

### Anti-wallhack

The server sends an enemy's pose only when the viewer could plausibly see it: within 10 m always, otherwise within 320 m and with a clear line through opaque geometry from the viewer's eye or either camera shoulder to the target's head, chest, feet or sides (a 0.6 m margin), tested every 3 ticks, also at the positions both will have 150 ms plus half a round trip later (so a duck coming round a corner is already there), and kept for 1 s after it was last visible. A hidden enemy is removed from the client's state, so the client has nothing to reveal. Shots from a duck you cannot see arrive as a direction and a loudness only (for the sound); kill messages carry the victim's position only to viewers who saw it; damage indicators carry a direction, never the attacker's position. A duck's movement mode (plane, freefall, glider) and action (reload, heal) ride on its pose entry, so they are culled with it. Loot is sent within 100 m and only once its spot is in sight (or within 10 m): a death crate behind a wall shows up when you see it, and an item taken behind a wall stays as a stale copy until you see that spot again (pressing E on it does nothing, the server decides pickups on its own list).

### Bots

Battle royale bots run on a tiled recast navmesh built from the map colliders (`recast-navigation` 0.43.1, MIT): cell 0.2 m, about 64 s to build, cached in `apps/server/.navcache/` by map hash (under a second to load), built on a worker thread at server start when the cache is cold (bots steer directly until it is ready). They pick a landing spot by zone heat and tier along the plane's route, jump at the right moment, dive or glide there, loot what they see, heal when safe, rotate into the announced circle and fight with the deathmatch brain (same input path, same line-of-sight rules, softer skill: reaction 14 to 26 ticks, 50 m view range).

## How the netcode works

- The client sends inputs only: move axes, buttons (including fire, reload, weapon slot and shoulder side), yaw, pitch, its tick estimate and the server time it is drawing other players at (`vt`, the rewind target). Colyseus numbers them (`room.input()`), the server acks them.
- The server owns position and velocity. Every input is sanitized (`sanitizeInputFields`: NaN, ranges, diagonal speed, unknown buttons, angles), turn rate is capped, the input buffer is capped (10), and an input credit (one per tick, burst of 8, spent by every simulated step) means a client can never run faster than the tick rate. WebSocket frames are capped at 1 KB and a client may send at most 300 messages per second, enough for the backlog after a stall of several seconds (inputs are one message per tick).
- The server runs at 30 Hz on its own loop with exact tick deadlines (`tickLoop.ts`) and sends one state patch right after each tick.
- The local player is predicted with the Colyseus 0.18 `Reconciler`: each input is simulated immediately with the shared sim, then checked against the server state when its ack arrives. The sim is bit-for-bit deterministic between Node and the browser (states are float32 on both sides, deterministic trig, inputs rounded to float32 before stepping), so in normal play the prediction never needs correcting. When a correction is needed, it is blended out over about 70 ms.
- Other players are sent as quantized poses (16-bit position and yaw, 8-bit pitch: about 9 bytes per update), and in the battle royale only when the viewer can see them (Anti-wallhack above). Players within 35 m get the near entry every tick and are drawn 100 ms in the past with Colyseus `Predict` lerp plus a 30 ms output spring. Players beyond 42 m get the far entry at 10 Hz, drawn 180 ms behind with our own buffer (`farInterp.ts`: Predict's lerp treats a 100 ms cadence as idle gaps and stutters; the buffer handles real idle gaps itself, so a far duck that stood still starts moving when it does instead of gliding). A near/far switch is eased out over about 150 ms. The server decides per viewer which entry, if any, each client receives (StateView).
- If a client's inputs stop arriving for more than 6 ticks (a TCP stall, a hidden tab, a lag switch), the server keeps simulating that player with stand-in steps: its last input for 10 ticks, then standing still. Nobody can freeze in mid-air by holding back packets. When inputs return, late ones (made during the stall, recognized by their tick stamp) are acked without a step because a stand-in already took their place; the first fresh input clears the rest. Recovery is immediate and always converges (`inputPacer.ts`, covered by `npm test` and `npm run test:net`).
- If the connection drops or the server kicks the client, the page shows "Disconnected" with a Reconnect button.
- Owner-only fields (velocity, sim timers) are tagged `.view()` in the schema, so other clients never receive them.
- Players collide with each other on the server only: overlapping capsules are pushed apart through the character controller after every tick. This is not predicted, so bumping into someone gives a small, smoothed correction. Predicting it would need other players' present positions, which the client does not have.
- Stand-in steps never fire, so a stalled player cannot shoot phantom bullets.

## How shooting works

- The weapon (fire rate, ammo, reload, switching, spray index, spread) is part of the shared sim, stepped right after movement on both sides. The client's shot is therefore predicted exactly: muzzle flash, tracer, sound, recoil and the hit marker play on the same frame as the click. The server's copy decides; a client can only ask.
- The spray pattern is deterministic (learnable, and predicted exactly). The random part of the spread is seeded on the server with a per-round secret the client never sees, so a cheat cannot predict or cancel it. The client draws its own tracer with a local guess for that random part; the server's result decides hits and is what other players see. With first-shot accuracy (0.2 degrees) the guess is close; in a running spray the predicted tracer can differ from the real one.
- TPS hit rule (`shot.ts`): the camera ray (from the shoulder point, which is on the camera's line) finds the aim point; then the server traces from the gun muzzle to that point. A wall between the muzzle and the aim point stops the shot, so you cannot shoot from behind cover just because the camera sees past it.
- Lag compensation: the server keeps 12 ticks of hitbox history and checks each shot against the targets at the shooter's view time (`vt`). The client chooses `vt`, so the server bounds it with its own measurement: half the round trip from WebSocket ping frames (answered by the browser, not page script), plus the 100 ms interpolation delay, the 30 ms output spring and a 40 ms margin, never more than 230 ms. A 10 ms player can rewind about 175 ms, not 230. Far targets are rewound 50 ms further, using the near or far class the shooter was actually drawing (a switch counts once it has reached the client).
- Hitboxes are a head sphere and a body capsule per stance. They follow the visual duck (head top at 1.62 m standing, 1.30 m crouched; the tuft is excluded), not the movement capsule, which is 1.15 m tall when crouched so ducks fit under low cover.
- Crouching behind the 1.15 m arena cover is fair both ways: the crouched muzzle sits at 1.2 m, so a crouched duck can shoot over the cover its head peeks over, and that peeking head (above 1.15 m) can be hit while the body behind the cover cannot.
- Damage, kills and the kill feed come only from the server: hit confirmations (damage, headshot, kill) to the shooter, a damage direction to the victim, kills to everyone. No predicted kills.

## Weapons

All in `packages/shared/src/weapons.ts`. Spread values are the cone radius.

| | Rifle | Pistol |
| --- | --- | --- |
| Fire | Full auto, 600 RPM (3 ticks) | Semi-auto, max 300 RPM (6 ticks) |
| Damage body / head | 24 / 86 (x3.6) | 26 / 104 (x4) |
| Time to kill (100 HP) | Body 5 shots, 0.40 s; head 2 shots, 0.10 s | Body 4 shots, 0.60 s; head 1 shot |
| Falloff | Full to 40 m, then x0.97 per 10 m (floor 70%) | Full to 15 m, then x0.9 per 10 m (floor 50%) |
| Magazine / reserve | 30 / 90 | 12 / 48 |
| Reload / equip | 2.3 s / 0.6 s | 1.6 s / 0.35 s |
| Spread standing / crouched | 0.20 / 0.10 degrees | 0.15 / 0.08 degrees |
| Moving / airborne adds | up to 4.5 / 9 degrees | up to 2.6 / 6 degrees |
| Spray | 30-shot learnable pattern: up first, then left, right, left; plus 0.12 degrees per shot (cap 1.6) | small climb, 0.25 degrees per shot (cap 1.2) |
| Recoil reset | 0.6 pattern steps per tick after the gun is ready | 0.35 steps per tick |

Movement below 34% of run speed adds no inaccuracy, which a counter-strafe reaches in 2 ticks. Firing stops sprinting. A trigger pull on an empty magazine starts the reload. Spawn protection lasts 1.5 s or until you fire (no predicted hit markers on protected ducks or during the round break); respawn takes 3 s, at the arena spawn point farthest from living enemies, and the camera turns to the spawn facing.

## Measured results

### Two clients in real browsers (e2e)

Two headless Chrome pages (WebGPU backend, 1280x720) on the same machine as the server (bots off), both on autopilot, 15 s per phase:

| Condition | Predicted local player | Remote player drawn | Corrections |
| --- | --- | --- | --- |
| No added latency | max drawn speed 7.3 m/s, 0 snap frames | max 8.2 to 9.1 m/s, 0 snap frames | 0 of about 450 reconciles |
| 120 ms round trip, +/- 10 ms jitter | max 7.3 m/s, 0 snap frames | max 7.8 to 8.2 m/s, 0 snap frames | 0 of about 450 reconciles |
| 150 ms, +/- 15 ms, 2% loss (stress) | 0 snap frames | 6 to 7 snap frames (TCP stalls) | 0 of about 320 |

The test also runs a fixed 600-tick, 6-player scenario in Node and in Chrome: the resulting state hashes are identical.

"Drawn speed" is the speed of what is actually rendered, sampled every frame. Sprint speed is 7 m/s, so a frame drawn above 11.2 m/s counts as a snap. Both pages held 60 fps (16.7 ms frames, vsync capped in headless Chrome, so this is not a GPU benchmark). The WebGL2 fallback was also rendered and checked with `?webgl=1`.

### Deathmatch with bots

- Headless (`apps/server/test/combat.test.ts`, and a 3-minute run of the same code): 8 bots, 143 kills in 3 minutes (48 per minute), 2,658 shots, 19.8% hit rate, 18% of hits on the head. The bot brains and the sim cost 0.16 ms per tick for 8 bots.
- In the browser (`npm run shots`, one autopilot player and 7 bots, about 45 s): 36 kills, deaths and respawns on the local player, hit markers and kill confirmations from the server.

### Server benchmark

`npm run bench` on an Apple M4 Pro (Node 24.12), network bots on the same machine (server bots off), 30 s per run. Each bot sends 30 inputs per second with random movement, sprint, crouch and jumps, and fires a third of the time (so shot effects are in the numbers).

| Bots | Tick avg / p95 / max (ms) | Patch avg / p95 / max (ms) | Server CPU (% of 1 core) | RSS (MB) | Down per client (KB/s) | Up per client (KB/s) | Messages/s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 8 | 1.054 / 1.984 / 3.48 | 0.452 / 0.700 / 1.59 | 7.8 | 248 | 3.56 | 0.63 | 34.6 |
| 16 | 2.085 / 4.407 / 7.51 | 0.567 / 1.047 / 1.55 | 12.1 | 261 | 5.57 | 0.63 | 34.7 |
| 32 | 2.556 / 5.061 / 6.25 | 1.005 / 2.018 / 3.56 | 15.6 | 281 | 9.89 | 0.63 | 38.4 |

Down bandwidth per client, before and after interest management:

| Bots | Phase 0 (float32 positions, every player every tick, no shooting) | Quantized poses, everyone near (`--no-interest`) | Quantized poses with near/far (default) |
| --- | --- | --- | --- |
| 8 | 7.19 KB/s | 5.03 KB/s | 3.56 KB/s |
| 16 | 13.64 KB/s | 8.56 KB/s | 5.57 KB/s |
| 32 | 26.31 KB/s | 15.97 KB/s | 9.89 KB/s |

- Bandwidth is WebSocket payload only (no TCP/IP overhead). The 10 KB/s per client target is met at 8 to 32 players.
- One tick has 33 ms; a 32-player room uses about 2.6 ms of it. A CPU profile at 32 bots (Phase 0) showed the process idle 82% of the time, with socket writes and Rapier as the largest costs.
- Phone frame time is not measured yet; use `npm run dev:lan` and `?autopilot=1`.

### Battle royale

Measured on an Apple M4 Pro, Node 24.12, headless Chrome (WebGPU) at 1280x720. Headless Chrome is vsync capped at 60 fps, so every frame time below is 16.7 ms; the CPU time of our own frame (input, sim, scene update and render submit) is the useful number.

Two browsers in one battle royale (`npm run e2e:br`, no bots): map hash `8b3549ce` with 6,702 colliders and the sim scenario on the map are identical in Node and Chrome; neither client gets the other's pose while in the plane; both jump, glide to the village, land, see each other, pick up 1 to 4 items; when B leaves, A gets the victory card.

A full match in the browser (`npm run perf:br`: one autopilot client aimed at the village, 15 navmesh bots, the client was knocked out on foot and then watched):

| Stage | CPU per frame avg / p95 (ms) | Draw calls avg / max | Triangles avg / max | Enemy ducks drawn avg / max |
| --- | --- | --- | --- | --- |
| Plane | 2.33 / 4.80 | 96 / 102 | 118k / 167k | 0.3 / 2 |
| Freefall | 2.48 / 4.80 | 119 / 126 | 162k / 177k | 5.8 / 8 |
| Glide | 3.01 / 5.90 | 157 / 172 | 241k / 280k | 10.6 / 11 |
| On foot | 2.98 / 3.90 | 119 / 156 | 197k / 300k | 8.4 / 10 |
| Watching (dead) | 2.76 / 5.90 | 114 / 145 | 196k / 302k | 6.8 / 9 |

The map alone (`npm run perf:map`, no ducks) draws 83 to 117 calls and 104k to 159k triangles at 1.4 to 2.0 ms CPU per frame; the rest is ducks (about 9k triangles and 3 to 7 calls each near the camera). The glide over the village with ten gliders in view is the heaviest moment, a little over the 150-call target.

Headless 16-bot matches (`apps/server/bench/brHeadless.ts`, the test in `apps/server/test/br.test.ts` runs seed 7):

| Seed | Duration (s) | Gun kills | Zone deaths | Pickups | Tick avg / p95 (ms) | ms per bot per tick |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 311 | 14 | 1 | 125 | 0.185 / 0.509 | 0.0116 |
| 2 | 284 | 15 | 0 | 137 | 0.143 / 0.427 | 0.0089 |
| 3 | 387 | 15 | 0 | 112 | 0.121 / 0.409 | 0.0076 |
| 4 | 459 | 14 | 1 | 114 | 0.145 / 0.368 | 0.0090 |
| 5 | 501 | 15 | 0 | 133 | 0.118 / 0.356 | 0.0074 |
| 6 | 531 | 15 | 0 | 139 | 0.084 / 0.350 | 0.0053 |
| 7 | 368 | 14 | 1 | 124 | 0.215 / 0.509 | 0.0134 |
| 8 | 419 | 15 | 0 | 140 | 0.135 / 0.385 | 0.0084 |

Every match had exactly one winner and unique places 1 to 16, nobody landed in the sea. Bot thinking costs about 0.01 ms per bot per tick (the tick time includes all 16 sims).

Server benchmark (`npm run bench:br`: 4 network clients plus 12 bots, 60 s after the drop):

| Clients + bots | Tick avg / p95 / max (ms) | Patch avg / p95 (ms) | Server CPU (% of 1 core) | RSS (MB) | Down per client (KB/s) | Up per client (KB/s) | Enemy poses received / enemies in the world | Visibility pairs / rays per second |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4 + 12 | 1.908 / 6.032 / 7.10 | 0.146 / 0.401 | 8.1 | 364 | 1.63 | 0.56 | 3.3 / 11.1 | 584 / 3162 |

With the culling a client receives on average 3.3 of the 11 enemies alive, so a 16-duck battle royale costs 1.6 KB/s down per client (the deathmatch with 16 players: 5.6 KB/s). The visibility checks cost about 3,200 ray casts per second (about 2 microseconds each on this map).

## Feel tuning

All in `packages/shared/src/constants.ts` (`MOVE`, `BODY`, `NET`) and `apps/client/src/camera/tpsCamera.ts` (`CAMERA`).

| Value | Setting |
| --- | --- |
| Walk / run / sprint / crouch | 2.6 / 5.2 / 7.0 / 2.3 m/s |
| Ground accel, friction, stop speed | 10, 8, 2.5 m/s: full run speed in about 5 ticks (170 ms), counter-strafe below 34% speed in 2 ticks (67 ms) |
| Air control | accel 12 with a 0.9 m/s wish-speed cap (CS style) |
| Gravity, jump | 20 m/s2, 6.6 m/s: about 1.0 m jump, 0.6 s in the air |
| Coyote time, jump buffer | 100 ms, 120 ms |
| Step height, max slope | 0.45 m, 46 degrees |
| Capsule | 1.75 m standing, 1.15 m crouched, radius 0.35 m |
| Camera | arm 3.1 m, shoulder 0.75 m right and 0.32 m up, FOV 75 (81 sprinting), mouse look applied every frame |

## Art and animation

The art workstream (`art/`) publishes into `apps/client/public/models/`; the game picks the files up when they exist and falls back to greybox otherwise (`?duck=placeholder` forces the primitive duck):

- `duck.glb`: skinned toon duck, used at its authored size (meters), turned to face -z. It gets the art's toon recipe in the engine: two-band toon shading with the shadow tint `#d9a6a0`, and a 7.5 mm inverted-hull outline in `#151619` that follows the skinning.
- `duck_anims.glb`: the clips. Locomotion clips drive the hips and legs (8-way blend of walk and run by the direction of travel, sprint, crouch, jump, fall, land) with `timeScale = speed / authored speed`. The upper body (Spine and everything below it) plays `Rifle_Aim` or `Pistol_Aim`, or the reload or `Equip` while they run. `Death_A` or `Death_B` take over the whole body. `Quack` opens the bill on a kill. Then procedural layers: spine, neck and head follow the camera pitch, a recoil kick on each shot, and two-bone IK puts the left hand on the gun's `Support` node.
- `weapons/rifle.glb`, `weapons/pistol.glb`, `weapons/attach.json`: the gun rides the `RightHand` bone at the attach pose; tracers and flashes start at its `Muzzle` node. Guns get toon shading but no outline hull (hard edges would crack it).

Without clips, a procedural pose takes over (leg swing, crouch, both hands on the gun by IK). Every sound is synthesized in code (`LICENSES.md`).

## Known issues

- Player collision is server-only (see above), so bumping into another duck gives a small correction.
- Deathmatch bots navigate by steering and ray casts, not a navmesh; they can get stuck on complex geometry for a moment (they pick a new goal after a second). Battle royale bots use the navmesh; on a cold cache (first start after a map change) they steer directly for about a minute while it builds.
- Battle royale bots do not use vertical cover on purpose and can bump into each other while looting. Matches with 16 bots last 5 to 9 minutes, a little short of the 8 to 12 minute plan, because many fights happen right after landing.
- Loot crates on the map are not opened: their items lie on top of them, ready to pick up (simpler and faster to loot).
- The anti-wallhack culling has no field-of-view test (a fast 180 degree turn would show pop-in), and a duck you cannot see can still be heard (direction only). Bushes do not count as walls for the culling (a duck in a bush is sent; it is hidden by the bush itself).
- LOD switches on props are hard cuts; far hedgerows look chunky from the plane.
- The zone timer text for the first circle uses the default timings (wrong when `QWAKK_ZONE_SCALE` is set for tests).
- Going back to the menu and starting a new game keeps a few GPU buffers of the previous one (the scene is replaced, not every geometry is disposed).
- The shot effects of other players use their drawn gun as the start point, so a tracer can start a few centimeters off the server's line.
- Crouched ducks' heads reach 1.30 m but the crouched movement capsule is 1.15 m, so under a low overhang the head can clip into the geometry (the hitbox still follows the visual head).
- Under packet loss on WebSocket (TCP), downstream stalls make remote players hitch (the interpolation buffer runs dry). WebTransport with unreliable delivery, or an adaptive interpolation delay, is the planned fix.
- After a pause longer than about 0.2 s (a hidden tab), the server's stand-in steps differ from what the client predicted, so the duck gets one smoothed correction on return.
- The client bundle is about 2 MB gzip, mostly Rapier (its WASM is inlined as base64 in the compat build) and Three.js.
- Rapier's character controller sometimes refuses to move off the ground it rests on; the sim retries from 4 mm up (see `sim.ts`), which fixed every case seen in a 12,000-step scan.
- No touch controls yet.
- The deathmatch stays on the greybox island; it does not use Sainte-Canard yet.

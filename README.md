# Qwakk game

A browser third-person shooter with ducks, live at `play.qwakk.fun` (one CapRover container serves the page and the game server; the runbook is `docs/deploy.md`). This repo is at **Phase 2**: a 16-duck battle royale on **Yelova**, a Normandy-style coastal village in toon style. Ducks board a plane, jump, glide down, loot guns, armor and heals, and fight inside a shrinking zone until one duck (or one team) is left; server bots on a navmesh fill the empty seats. Rooms play Solo, Duo or Squad; friends group up in a party in the menu (a code and a share link) and land together on one team, with name tags, ally markers through walls, knocks and revives. Next to it run always-on deathmatch rooms of 24 ducks each (at launch one, Kavren; Kumra and Tanoba are ready in the catalog) on **Kavren**, a compact village quarter from the same kit; bots fill every seat a human does not take. **Hunt Season** (Av Sezonu) is the co-op PvE mode on **Pond Keep**, a duck castle on a pond island (`docs/pond-keep.md`): 1 to 4 signed-in ducks draw katanas and push out of the castle across the field through hordes of duck hunters (packs of Beaters and Recruits with riflemen, trappers, decoy throwers and dogs as elites, snipers on the watchtowers), taking four objectives in turn (the trench, the supply crates, the watchtowers, the Big Hunter's camp) with light combos, a charged heavy spin, a dash, the "VAK!" quack shockwave and the Blade Storm, a pistol for range, bread cannons on the towers, a drawbridge and a gate to fall back on; they pick upgrade cards between objectives and earn XP, levels and Tüy for their duck: levels unlock the katana's moves and skill points, Tüy buys katanas and armor at Duck Plaza's Blacksmith and Armorer (`docs/hunt-season.md`, `docs/progression.md`; none of it counts in the deathmatch or the battle royale). All modes share CS-style gunplay, server-authoritative hits with lag compensation, client-side prediction of movement and shooting, and toon ducks from the art workstream. It plays on desktop (keyboard and mouse) and on phones and tablets in landscape with touch controls (see Touch controls); both join the same rooms and parties.

Phase 0 (the foundation: sim, netcode, camera) is described in the netcode section below.

The full plan (stack, netcode rules, roadmap) is in `../GAME_PLAN.md` in the workspace.

## Build Before Q-Day

Qwakk Island (this game) is our entry for QoreChain's "Build Before Q-Day" fest, Quantum Pass category, with **Duck Pass**. The game existed before the fest started on 4 November 2026, so the old and the new work are listed apart here. The commit history shows the same split.

**Before the fest (15 to 26 October 2026, commits `794ca1d` to `ab90dce`).** The game itself, live at play.qwakk.fun since October: the shared TypeScript simulation, the Colyseus server (30 ticks per second, lag-compensated hits, anti-wallhack culling, navmesh bots), the Three.js client with touch controls for phones, deathmatch, battle royale, Hunt Season, Duck Plaza, email accounts, the admin panel, and every model, map and sound, made by our own scripts.

**During the fest (from 4 November 2026):**

- 14 November: the repository went public under the MIT license (`4e20cae`).
- 14 November: Duck Pass (`2238356`), deployed to play.qwakk.fun the same day. A signed-in player links a QoreX wallet to the account with one hybrid-signed (secp256k1 + ML-DSA-87) transaction on the QoreChain testnet: 1 uqor from the wallet to itself, with a single-use code in the memo. The player's QoreX signs and broadcasts it. The server only prepares the request and reads the committed transaction (memo code, signer key, the chain's `pqc_hybrid_verify` event); it never signs, broadcasts or holds keys. The same commit adds the standalone Duck Pass checker (`duck-pass/`, started from create-qorechain-dapp), the tests and the updated privacy policy and terms. Details: [Duck Pass](#duck-pass-qorechain-quantum-pass) below and `docs/accounts.md`.
- 15 November: the brand and art notice (`9c00299`, [NOTICE.md](NOTICE.md)).

Identity only: no tokens, no prizes, no money flows. A linked wallet never touches Tüy, XP, rewards or the leaderboard.

- Demo: https://play.qwakk.fun
- Video: [pending]
- QoreChain testnet address used for the demo link, and its proof transaction: [pending]
- How AI was used: [AI_USAGE.md](AI_USAGE.md)
- Sister project: the Qwakk DEX at https://app.qwakk.fun (its own repo).

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
    src/ads.ts         Aim down sights: the aim ramp, its spread, recoil and speed scaling, the pose action
    src/characters.ts  The playable ducks (CHARACTERS: numeric ids and keys), the join option check, the bots' balanced pick
    src/shot.ts        Hitscan: camera ray finds the aim point, muzzle trace decides (TPS rule)
    src/hitbox.ts      Head sphere and body capsule per stance, analytic ray tests
    src/net/schema.ts  Colyseus Schema 5 state, quantized poses, zone, loot items, input and message ids
    src/collision.ts   Collision groups: what each collider blocks (move, bullets, sight, opaque)
    src/mapV1.ts       Loader for the map_v1 files (Yelova, Kavren): terrain, prop colliders, BR data
    src/dmSpawns.ts    Deathmatch spawns on map_v1 maps: the map's `dmSpawns`, or derived on open ground; the play area ring
    src/lobby.ts       Room list data for the menu: RoomListing, the static deathmatch rooms (DM_ROOMS), party protocol and codes, team sizes, Quick Play's pick
    src/maps/          The shipped map files (npm run map:sync copies them from the map workstream)
    src/drop.ts        Freefall and glider (stepped in the sim, predicted)
    src/heal.ts        Bandages and medkits: timed, slow you down, interruptible (in the sim)
    src/items.ts       Item kinds, loot tables, LOOT, PACK (capacity and weights) and ARMOR numbers, armor math
    src/inventory.ts   Inventory rules: carrying capacity, pickups and why one is refused, drops, crate contents on the wire
    src/zone.ts        Circle plan (final circle first, from the map's candidates) and timeline
    src/plane.ts       The drop plane's route from the map's flight paths
    src/hub/           Duck Plaza, the hub between matches: constants and messages, the map's hub data and portal triggers, the hub duck in the sim, the hub schema
    test/              Vitest: determinism, movement feel, weapons, hitscan, loot, armor, heals, drop, zone
  apps/server/       Colyseus 0.18 game server (Node 24, runs the .ts sources directly)
    src/gameRoom.ts    Networking glue for both modes: auth, joins, inputs, patches, views, messages
    src/IslandRoom.ts  A deathmatch room: static id and name (DM_ROOMS), never closes, lobby listing, map by id, culling
    src/BrRoom.ts      The battle royale room (Yelova): lock, plane, zone, loot views, spectating, results
    src/arena.ts       Authoritative combat core: one input path, shots, damage, separation, history
    src/deathmatch.ts  Deathmatch rules: 24 seats (humans take bots' seats), idle when empty, spawns away from enemies, rounds
    src/dmBot.ts       Deathmatch bot on map_v1 maps: the fighting brain plus navmesh walking (nav/navWalker.ts)
    src/br/            Battle royale rules, teams (teams.ts), loot in the world, results, bots (landing, looting, fighting, reviving)
    src/party/         Parties: the party room (joined by code) and the registry the game rooms read by verified player id
    src/hub/           Duck Plaza: the hub room (no combat, portals, invites into parties, chat bubbles, emotes), its interest, invites, teams, chat filter and map
    src/admin/         Admin panel: login (scrypt password, TOTP, lockout, signed session cookie), the /admin routes and JSON API, the dashboard, the store (settings, audit log, bans)
    src/settings/      Runtime settings: definitions with ranges and defaults (the constants), validation, the live bot skills, server weapon damage, typed reads for the rooms
    src/ops/           What the panel acts on: the live room registry, notices and the menu status, bans, IP blocks (memory only), deathmatch rooms opening and closing, the room creation policy
    src/nav/           Recast navmesh from the map colliders (cached), paths for the bots
    src/visibility.ts  Line-of-sight check for the anti-wallhack culling
    src/maps.ts        Map loading by id (greybox or map_v1 folder) and the map hash; the deathmatch map id
    src/matchmaking.ts Matchmaking guard: join options filter, room creation limits, join-only static rooms
    src/lobby.ts       The lobby (LobbyRoom): battle royale and deathmatch rooms, listed live
    src/lagComp.ts     Hitbox history for lag compensation (rewind capped at 230 ms)
    src/bots.ts        Server bots: same input path as players, line of sight only
    src/interest.ts    Per-viewer near (30 Hz), far (10 Hz) or no pose entry (anti-wallhack)
    src/tickLoop.ts    Fixed-rate loop with exact tick deadlines
    src/inputPacer.ts  Which steps run each tick: real inputs, stand-ins, late inputs (unit tested)
    test/              Vitest: input pacer, rewind hit/miss, fire spam, headless matches, map, navmesh, culling, placements
    bench/             Headless bots, the benchmark runners (deathmatch and battle royale)
  apps/admin/        The admin UI (plain TypeScript and DOM, its own Vite build into apps/admin/dist, never in the public client; not an npm workspace)
  apps/client/       Vite + Three.js (three/webgpu, WebGL2 fallback), plain game loop
    src/play.ts        Game entry for the menu: startGame(), onGameExit()
    src/game.ts        Frame loop: pump inputs, read predicted and interpolated poses, render
    src/net/           Session (prediction, poses, messages), far-pose interpolation, fake network
    src/game/          Combat feedback, the battle royale client (brClient.ts), name tags (nameTags.ts), autopilot, metrics
    src/fx/            Particles: feathers, dust, cartoon splats; tracers and muzzle flashes
    src/audio/         Synthesized sounds (WebAudio), 3D for other players
    src/input/         Keyboard and mouse (controls.ts); input/touch: the touch controls (stick and look math, finger roles, the button layer, fullscreen and the rotate screen, numbers in constants.ts)
    src/hud/           Game HUD, the team panel (teamPanel.ts), battle royale HUD (hud/br: minimap, map, inventory, results) and the debug HUD
    src/camera/        Over-the-shoulder spring-arm camera, recoil kick, shake, death camera
    src/player/        Duck avatar: clips, procedural layers, hand IK, weapons, the reload's magazine (reloadMag.ts)
    src/world/         Greybox terrain and props; world/sainte: the map_v1 world by map id (instanced props with LODs, terrain, water, sky, plane, zone wall, loot)
    src/ui/menu/       The menu: sign in and the character select (account/), a guest's name and look (guestCard.ts), then the sheet over Duck Plaza (hubSheet.ts: Play list of the modes and live room lists, Team, Leaderboard, Settings, How to play, Account), parties (partyController.ts, partyPanel.ts, partyClient.ts), the last round card; styles in styles/
    src/hub/           Duck Plaza on the client: the plaza scene, its session and labels (a dynamic import, in the game bundle)
    src/menuHero/      The character select's 3D duck that aims at the cursor (its own chunk, loaded after the menu paints)
    public/models/     Art from the art workstream (duck, animations, weapons, props, openable crates)
  e2e/two-clients.ts Two real headless browsers in one deathmatch room (map hash, prediction, culling)
  e2e/br-two-clients.ts Two real headless browsers in one battle royale (plane, drop, loot, culling, victory)
  e2e/br-lobby.ts    Lobby rooms: Chrome joins a room from the menu's live list, two Node players, countdown, bot fill; the deathmatch rooms listed and joined from the menu
  e2e/party-duo.ts   Parties: two Chrome players form a party in the menu, play a deathmatch as allies (tags, no damage), then a Duo battle royale on one team (tags, knock, revive)
  e2e/mobile-touch.ts Touch controls on an emulated phone: menu, deathmatch (stick, look, fire, reload), rotate screen, battle royale jump and glide, map and bag
  e2e/mobile-perf.ts Phone frame time under emulation (landscape, touch, CPU throttled 4x): deathmatch and battle royale stages
  e2e/br-perf.ts     Frame time and draw calls in a full battle royale (one browser, 15 bots)
  e2e/map-perf.ts    Frame time and draw calls of the map alone (dev map viewer, mapview.html)
  e2e/pause-resume.ts Node client: input pauses and network stalls, must recover within 1 s
  e2e/firefight-shots.ts Screenshots of a firefight in headless Chrome
  e2e/menu-shots.ts  Screenshots of the menu at desktop, tablet, phone upright and phone on its side (no sideways scroll, 44 px touch targets)
  scripts/dev.ts     Runs server and client together
  scripts/admin-setup.ts npm run admin:setup: the admin password hash and TOTP secret, with a terminal QR code (scripts/qr.ts)
  scripts/sync-map.ts Copies the map workstream's export into packages/shared/src/maps (npm run map:sync)
  art/               Blender scripts and renders for the ducks (separate workstream)
  duck-pass/         Duck Pass checker: a standalone Vite + React page scaffolded with create-qorechain-dapp (not an npm workspace, its own lockfile)
```

Display names use the Qwakk world: **Qwakk** is character `0` (`classic`), **Toski** is `1` (`mallard`), **Yelova** is map `sainte-canard`, and **Kavren** is `canard-quarter`. Technical ids and saved selections remain compatible. Place labels come from `art/map/layout/`, then the canonical exports are copied with `npm run map:sync`.

## Requirements

- Node 24 or newer (the server runs TypeScript directly with Node's type stripping).
- npm 11.
- For the e2e test: Google Chrome installed (or run `npx playwright install chromium` and set `E2E_BROWSER=chromium`).

## Run it

```sh
npm install
npm run dev          # local PostgreSQL, server, client and watched admin build
```

Open http://localhost:5173/game/ yourself; `npm run dev` never opens a browser automatically. It starts local PostgreSQL, the game server, Vite client and watched admin build. A running Docker engine (Docker Desktop or OrbStack) is needed unless `DATABASE_URL` is explicitly supplied. `Ctrl+C` stops its development processes; the database data is kept. Run this command in one terminal only; occupied ports are reported before startup.

Use `npm run dev -- --host` for the client on the LAN. The optional `npm run dev -- --open` explicitly requests a Chrome preview with game and authenticated admin tabs using temporary credentials. The menu starts a battle royale or a deathmatch. In dev you can skip the menu with `?mode=br` or `?mode=dm`.

- **Battle royale** (`br` rooms, up to 16 humans each): the menu lists every room live (name, ducks in, waiting / countdown / in progress). Join one, create one, or Quick Play (the open room with the most players, or a new one). You wait on the village square (damage off) with the room's roster on screen. Once 2 humans are in, a 30 s countdown starts (10 s when the room is full of humans); if they drop below 2 it goes back to waiting. When it ends, the room locks, bots fill the seats to 16 ducks and everyone boards the plane, which flies over the first circle (shown from the start, 220 m). Jump with F over land (or be thrown out past the circle), fall, open the glider (Space or F, or it opens by itself 45 m above the ground), glide about 3 m forward per meter down (W dives, S brakes), land, loot, survive the zone (it closes about 5.5 minutes after the plane starts). The last duck standing wins; dead ducks watch their killer or any duck still alive.
- **Parties**: Create party in the menu gives a 6 letter code and a share link (`https://play.qwakk.fun/?party=CODE`); friends open the link or type the code. Up to 4. The menu lists the members (name#tag, the leader, who is in a match). The leader picks a room (or Quick Play, or Deathmatch); once the leader is in, the members still in the menu follow into the same room. Members cannot start a match while in a party (leave it to play alone); when the leader leaves, the next member leads. Parties live in server memory (`apps/server/src/party/`): a private Colyseus room per party with the code as its id, joined by code only, with per-IP limits on creating parties and on joins by code. The party sends names and tags only, never player ids or tokens, and game rooms find a player's party by the player id from its verified session, never from a client message.
- **Team modes** (battle royale): each room is Solo, Duo or Squad (16 ducks: 16 teams of 1, 8 of 2, 4 of 4), chosen by whoever creates it (the menu's mode picker) and shown in the room list. A party joins as one team: its first member to arrive takes a team with room for everyone who may follow and holds their seats for 30 s (`PARTY.reserveSeconds`). A party bigger than the room's teams, or a room with no team that fits it, is refused with a clear message, and the room list greys such rooms out. A duck on its own fills the fullest team with a free seat. Bots fill every empty seat. Teammates cannot hurt each other (shots pass through them), receive each other's poses and team state (nearby name tags, map and minimap dots, the team panel with health and state) and spectate each other first after death. At 0 health a duck with a standing teammate is knocked: it crawls (1 m/s), cannot shoot, aim, heal or jump, and bleeds out in 30 s; damage finishes it faster (x2, no armor). A teammate holding E within 2.2 m for 5 s revives it with 25 health. A team is out when nobody on it stands (its knocked ducks go with it); every member gets the team's place and the last team standing wins. Solo plays exactly as before (no knocks). Numbers in `KNOCK`, `PARTY` and `TEAM_SIZES` (`constants.ts`).
- **Name tags**: small, faint names only within 12 m of the player, fading from 6 m to zero at 12 m. No self name or label boxes. Allies are green and keep nearby wall markers; enemies require a received pose and a clear camera line to the real head or chest. The distance limit applies to both allies and enemies; the team panel still identifies teammates at any range.
- **Deathmatch** (`island` room type): static rooms from `DM_ROOM_CATALOG` in `packages/shared/src/lobby.ts` (Kavren, Kumra and Tanoba, room ids `istanbul`, `paris`, `hongkong`); the first `DM_OPEN_ROOMS` of them (launch: 1, Kavren) are `DM_ROOMS`, opened by the server at start and never closed; clients cannot create one. The menu lists them live with their human count ("Kumra 3/32") and joins one by click; the Deathmatch button (Quick Play) joins the open room with the most humans. A room holds 24 ducks (`MATCH.players`): 1 human plays with 23 bots, 2 with 22, and so on; up to 32 humans can join (`ROOM.maxClients`), with no bots past 24. A joining human takes a bot's seat (a dead bot first, else the bot farthest from every human), a leaving one gives it back to a new bot. With nobody in it a room keeps no seats and its tick loop sleeps until someone joins (the next human starts a fresh round). First to 50 kills or the most kills after 10 minutes wins the round, then a new round starts after 10 seconds. Free for all, except a party: its members share an ally group (no damage between them, always in view, green tags and the team panel); there are no knocks in a deathmatch. Respawns go to a spawn point at least 18 m from every living enemy that no enemy within 80 m can see (one of the 6 farthest such points), else to one of the 3 farthest. A fresh duck has 2 s of spawn protection: it blinks for everyone, takes no damage (shots pass through it) and bots do not target it; pressing fire ends it at once and that shot counts (moving, reloading and switching weapons keep it). Numbers in `MATCH` and `SPAWN_PROTECTION`. Played on Kavren (`MATCH.mapId`), with navmesh bots and the same line-of-sight culling as the battle royale.
- **Characters**: two ducks, Qwakk (the yellow brand duck) and Toski (a turquoise-headed duck with a bright yellow field cap and body), both with the rifle and the pistol. The player names the duck, picks one in the menu (remembered in the browser), then plays. The pick is the `character` join option (a catalog id from `packages/shared/src/characters.ts`); the matchmaking guard keeps it only when it is a catalog id and the room falls back to the classic duck for anything else, stores it on the seat and puts it on the public player state (`PlayerState.character`), so every client draws that duck with its model. Bots wear the duck the room has fewest of. Characters are looks only: one skeleton, the same clips, weapons and attach pose, and one hitbox table (`hitbox.ts` takes no character); `npm test` checks that both models share the skeleton and stay inside the classic duck's silhouette, and that a shot does the same to either duck.
- **Version badge**: the root `package.json` version shows in the top right corner with a BETA tag on the menu and in the game (`apps/client/src/ui/buildBadge.ts`). Bump it for each release.

| Key | Action |
| --- | --- |
| Click | Lock the mouse and play (Esc to release) |
| WASD | Move |
| Shift | Sprint (forward) |
| Alt | Walk |
| C | Crouch (hold) |
| Space | Jump |
| Left mouse | Shoot (rifle: hold for full auto; pistol: one shot per click) |
| Right mouse (hold) | Aim down sights: the camera moves in over the shoulder and zooms, tighter spread, less recoil and shake, slower moves, no sprint |
| R | Reload (a trigger pull with rounds left cancels it) |
| 1 / 2 / mouse wheel | Rifle / pistol (switching cancels a reload) |
| E | Pick up the item in front of you (shown in the prompt). On a closed crate: open it; on an open crate: take everything that fits. Hold next to a knocked teammate for 5 s to revive it |
| I | Inventory screen (battle royale): drop items, take single items from a crate or the ground. The mouse is free while it is open, W A S D still move; I, Esc or a click outside closes it |
| F | Jump out of the plane; open the glider |
| Hunt Season | Left mouse: slash (keep tapping for the three-cut combo; hold and let go: the heavy spin). X: dash. Q: the "VAK!" shockwave. F: the Blade Storm (meter full). 1 / 2: katana / pistol. Shift still only sprints |
| 4 / 5 | Bandage / medkit |
| M | Full-screen map |
| Tab | Scoreboard (battle royale: your gear and every duck) |
| T | Room text chat. Enter sends, Esc closes; movement and actions stop while typing |
| Click while dead | Watch the next duck (battle royale) |
| V | Swap shoulder |
| - / = | Mouse sensitivity (saved in the browser; the menu also has an aiming sensitivity, a multiplier while aiming down sights) |
| H | Toggle the debug HUD |
| N / J / L | Fake network: cycle latency (0, 60, 120, 150, 250 ms), toggle jitter, toggle 2% loss |

### Touch controls

Room chat sits at the lower left in both modes. Tap its button on a phone, type, then tap Send or × to close. Messages reach only the current room, show the server-assigned name and tag, and fade after 12 seconds; opening chat shows the last 40 received messages. The server accepts up to 200 characters once every 1.2 seconds. `npm run e2e:chat` checks desktop keys, safe text rendering, idle controls while typing and mobile send/close.

Phones and tablets play in landscape (portrait shows a "turn your phone" screen). The first tap on "Tap to play" goes fullscreen and locks landscape where the browser allows it (Android Chrome; iPhone Safari has neither for pages, so the game plays in the page and the rotate screen covers portrait). The touch layer (`apps/client/src/input/touch/`) is an input device only: it feeds the same `Controls` state as the keys and mouse, so the input frame, the server checks and the netcode are unchanged.

| Touch | Input |
| --- | --- |
| Left side: drag anywhere (a floating stick) | Move axes `mx`, `mz` (analog: a short push walks slower). At the edge and pushed forward: Sprint |
| Right side: drag anywhere | Look (yaw, pitch), with its own Touch sensitivity setting; aiming down sights slows it like the mouse |
| Fire (right, big; drag it to aim while shooting) and Fire (left, above the stick) | Fire held (a tap shorter than a tick still fires: presses latch until the next fixed step) |
| Aim, Duck | Aim and Crouch, toggled (tap again to stop) |
| Jump, Reload, Swap | Jump, Reload, the other weapon slot |
| Use (shows next to loot, crates and knocked teammates) | Use held: tap to pick up or open, hold to revive |
| Jump out, Glide (in the plane and in freefall) | Deploy |
| Band, Med (with their counts) | Heal1, Heal2 |
| Pause, Scores, Map, Bag | The pause card (Leave the match), scoreboard toggle, map (tap the map to close), inventory screen (its buttons are touch sized) |
| Prev, Next (watching after death) | Spectate the previous or next duck |

Several fingers at once are tracked by pointer id (stick, look and fire together); a finger keeps the role it started with. Touch laptops keep mouse play; a touch on the pause card turns the touch layer on, a mouse click turns it off and locks the pointer. Every number (stick radius, dead zone, sprint threshold, look speed) is in `input/touch/constants.ts`. Phones start on the Low graphics preset, which on a coarse pointer also turns the shadow map off; the render scale stays capped at 1.5.

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
| `mode=br` / `mode=dm` | Skip the menu and start a battle royale or a deathmatch (dev tools only); `room=paris` joins that room by id |
| `party=CODE` | Join that party once the menu shows (the share link; the menu then removes it from the address) |
| `menu=1` | Show the menu even with dev tools in the URL (the party e2e plays through the menu with an autopilot) |
| `quality=low` | Shorter prop draw distances (the menu's quality setting wins when it starts the game) |
| `spectate=1` | Watch without playing; click to switch duck (server needs `QWAKK_SPECTATORS=1`) |
| `server=ws://host:2567` | Game server address (dev tools only; default: the page host on port 2567) |
| `pr=1` | Render scale cap (default 2 on desktop, 1.5 on touch devices) |
| `shadows=0` | Turn shadows off |
| `hud=0` | Start with the HUD hidden |
| `duck=placeholder` | Ignore `duck.glb` and use the primitive duck |
| `character=mallard` | With `mode=` or a dev tool: play this duck (`classic`, `mallard`); without it the menu's remembered pick (dev tools only) |
| `lerpsmooth=30` | Output smoothing for remote players in ms (dev tools only; lag compensation assumes 30) |

The fake network options, the N / J / L keys, `?server=`, `autopilot`, `spectate` and the `window.__qwakk` test hook are dev tools, decided at build time: on in `npm run dev` and in the test bundle (`npm run build:test`, built with `VITE_DEVTOOLS=1` into `apps/client/dist-test`), and compiled out of the public bundle (`npm run build`). The public bundle does not contain the autopilot or the test hook at all.

Fake latency set in the URL is applied from the first message, which is how latency should be tested. Toggling it in the middle of a session (N key) works for feel, but the Colyseus clock treats a sudden jump in round trip as an outlier, so the HUD ping is the reliable number then.

The server also has Colyseus' own latency simulation: `COLYSEUS_LATENCY=120 npm start` (round trip, no jitter).

### Phone on the LAN

```sh
npm run dev:lan
```

Vite prints a `Network:` URL. Open `/game/` on a phone on the same Wi-Fi and play with the touch controls (add `?hud=1` for the frame time), or `/game/?autopilot=1` for a hands-free frame-time check. macOS may ask to allow incoming connections for Node. The client connects to the game server on the same host, port 2567.

## Check it

```sh
npm run typecheck    # all workspaces plus scripts and e2e
npm test             # Vitest: shared sim, server (pacer, hits, bots) and client (far interpolation, avatar pose)
npm run build        # typecheck, then the client production build in apps/client/dist and the admin UI in apps/admin/dist
npm run build:admin  # only the admin UI (apps/admin/dist), served by the server at /admin to a logged-in admin
npm run admin:setup  # make ADMIN_PASSWORD_HASH and ADMIN_TOTP_SECRET (prints them and a QR code, writes nothing)
npm run build:test   # the same client with dev tools, for the browser tests (apps/client/dist-test)
npm run e2e          # two headless Chrome clients in a deathmatch, then in a battle royale (build:test first)
npm run e2e:br -- DIR # only the battle royale e2e; saves its screenshots to DIR
npm run e2e:lobby -- DIR # lobby rooms: room list, join from the list, countdown, bot fill; screenshots to DIR
npm run e2e:mobile -- DIR # touch controls on an emulated phone (landscape, multi-touch), screenshots to DIR (port 2567)
npm run perf:mobile -- DIR # phone frame time under emulation, CPU throttled 4x (THROTTLE=6 for more)
npm run e2e:party -- DIR # parties: menu party, deathmatch allies, Duo battle royale team, knock and revive (always on port 2567)
npm run e2e:accounts -- DIR # accounts: guest locks, email sign-up with the dev mail sink, two ducks, battle royale, log out and in, phone shots
npm run e2e:hub -- DIR # Duck Plaza: two ducks meet, invite, team up, walk into the Deathmatch portal together and come back; a guest's locked portal; a phone (port 2567, local PostgreSQL)
npm run e2e:raid -- DIR # Hunt Season on Pond Keep: a fresh duck's locked moves, a solo run through the plaza portal on the dev autopilot (several hunters cut by one swing, dashes, the quack, the Blade Storm, no prediction corrections, the trench taken), then the other objectives with test hooks, XP, Tüy and the best stored, the level-up; the Blacksmith (buy and equip a katana), My Duck (a tree point) and a second run with Dash unlocked and the new damage; then a party run with a phone's skill buttons and a geared veteran (port 2567, local PostgreSQL)
npm run anim:raid -- DIR # Hunt Season animation smoothness: the local duck's bones traced every frame while it runs, runs and slashes, stands and slashes, sprints and slashes; pops per second, a frame sequence (DEV=1, THROTTLE=4)
npm run perf:raid -- DIR # Hunt Season frame pacing in headless Chrome: frame times, long tasks, patches, tick jitter, corrections, hunter smoothness, the opening and a 44-hunter peak (THROTTLE=4, DEV=1, PROFILE=1)
npm run test:net     # pause and stall recovery against the real server
npm run test:br      # headless 16-bot battle royale (server workspace)
npm run bench        # deathmatch benchmark: 32 clients, or 1 client and 31 server bots, in one and in all three catalog rooms, opened with QWAKK_DM_ROOMS=3 (npm run bench -- 4 64 for client counts in one room)
npm run bench:br     # battle royale benchmark: network clients plus bots, bandwidth, CPU, culling (npm run bench:br -- 4 60 2 for Duo)
npm run bench:raid   # Hunt Season benchmark: four headless katana bots pushing through the objectives and 50 hunters at once, then 4 network clients cutting a 44-hunter horde alone and next to a full deathmatch room (port 2597)
npm run bench:hub    # Duck Plaza benchmark: one plaza of 40 network clients walking, jumping, quacking and chatting, crowded and spread (port 2594)
npm run shots:menu -- DIR # the menu at 1440x900, 1024x768, 390x844 and 844x390 with every tab (build:test first, port 2567)
npm run shots -- DIR # screenshots of a deathmatch firefight, then hip vs aim down sights and the reloads (two ducks in a battle royale warm-up; build:test first)
npm run perf:br -- DIR # battle royale frame time, CPU per frame and draw calls in headless Chrome
npm run perf:map -- DIR # the map alone in the dev map viewer
npm run map:sync     # copy the map workstream's export into packages/shared/src/maps
```

The e2e scripts use ports 2567 and 5173 by default. The menu-driven ones (`br-lobby`, `party-duo`, `mobile-touch`, `accounts`, `raid`, `hub`) also need the local PostgreSQL (`npm run db:up`): battle royale needs an account, so they sign up through the dev mail sink on a throwaway database. While `npm run dev` holds the ports, build a test bundle that calls another port and point the scripts at it:

```sh
cd apps/client && VITE_DEVTOOLS=1 VITE_SERVER_PORT=2577 npx vite build --outDir /tmp/dist-test-2577 --emptyOutDir && cd ../..
E2E_SERVER_PORT=2577 E2E_WEB_PORT=5174 E2E_DIST=/tmp/dist-test-2577 npm run e2e
```

Server environment switches: `QWAKK_BOTS=0` (no bots), `QWAKK_MAX_CLIENTS` (humans per deathmatch room, default 32), `QWAKK_DM_MAP` (deathmatch map id for one run, `greybox` works too; default `MATCH.mapId`), `QWAKK_DM_SPAWN_RADIUS` (deathmatch spawns only within this many meters of the arena center, the e2e uses it), `QWAKK_DM_HERO=0` (no caped hero; the party e2e checks health), `QWAKK_INTEREST=0` (every player at full rate), `QWAKK_SPECTATORS=1` (allow spectators), `QWAKK_BR_COUNTDOWN` (battle royale start countdown seconds, default 30), `QWAKK_BR_MIN_HUMANS` (humans a room needs before the countdown starts, default 3; the e2e and benchmark scripts lower it), `QWAKK_BR_SEED` (fixed match seed: plane path, circles, loot), `QWAKK_ZONE_SCALE` (zone timeline speed-up for tests, 0.25 is four times faster), `QWAKK_NAV_CACHE` (navmesh cache folder), `QWAKK_CLIENT_DIR` (serve the built client from this folder on the server's port; the image sets it), `QWAKK_BR_MAX_ROOMS` (battle royale rooms open at once, default `BR.maxRooms`), `QWAKK_RAID_COUNTDOWN` (Hunt Season lobby countdown seconds, default 15), `QWAKK_RAID_MAX_ROOMS` (Hunt Season rooms at once, default 3), `QWAKK_TEST_HOOKS=1` (tests only, refused in production: a client may hurt its own battle royale duck, so the party e2e can knock one and revive it, and skip or take Hunt Season objectives, spawn packs and hordes, fill the storm meter, unlock every move for one run).

## Meta: identity, leaderboard, menu

The menu is the first screen. Players sign in by email (a 6-digit code, no passwords) and pick one of up to four ducks on a character select, or play as a guest: a nickname, a server-given `#1234` tag and a signed identity, Deathmatch only. Then they walk into Duck Plaza, the shared 3D square between matches, and enter a mode through its portal (`docs/duck-plaza.md`); everything else the menu offers is in the plaza's sheet (Esc). Battle royale needs an account. Accounts, their data model, routes and the QoreX plug-in point: `docs/accounts.md`. Finished matches feed a per-season leaderboard, per duck. The leaderboard is in-game stats only (no prizes, no tokens) and only the game server writes it. Data handling for the privacy page: `docs/privacy-notes.md`.

### Code

- `apps/server/src/meta/`: `index.ts` (the contract the rooms use), `service.ts` (sessions, limits, recording, reads), `http.ts` (routes), `token.ts` (HMAC tokens), `names.ts` with `blocked-names.json` (name rules and word filter), `rateLimit.ts`, `ip.ts`, `turnstile.ts`, `score.ts`, `matches.ts`, `leaderboard.ts`, `players.ts`, `migrate.ts`, `config.ts`.
- `apps/server/db/migrations/`: plain SQL, applied in order at server start.
- `apps/client/src/ui/menu/`: the menu (pure DOM, no game imports, so it paints before the game bundle loads), `apps/client/src/settings.ts` (saved settings), `apps/client/public/ui/` (menu art). `menu.ts` owns the flow: the entry screens (`account/`: sign in, the character select), a guest's name and look the first time (`guestCard.ts`: `nameStep.ts` and `characterStep.ts` over the catalog in `characters.ts`: Qwakk and Toski, remembered in the browser as `qwakk.character` and sent as the `character` join option), then Duck Plaza (`src/hub/`, from the game bundle) and the sheet over it (`hubSheet.ts`, Esc or the touch Pause button): Play (the three modes as a plain list, with the guest locks and the party rules of the portals, and the live room lists, `roomsPanel.ts`), Team (`partyPanel.ts`), Leaderboard, Settings and the language, How to play, Account. Back from a match the plaza shows the last round (`resultCard.ts`) for a few seconds. The old main menu modules (`playStep.ts`, `stage.ts`, `tabs.ts`, `teamPicker.ts`) are no longer imported. Touch targets are at least 44 px and the page keeps clear of notches (safe area insets). Every string is in `copy.ts`.
- `apps/client/src/menuHero/`: the Play tab's duck in 3D. The picked duck's portrait (`public/ui/duck-rifle.webp`, `duck-mallard-rifle.webp`) paints with the menu and stays as the fallback; after paint, `main.ts` hands the menu a dynamic import of this module (`ui/menu/heroSlot.ts` runs it, so the menu chunk carries no Three.js; it shares the Three.js chunk with the game). It renders the picked duck's model (`duck.glb` or `duck_<key>.glb`; a new pick loads and compiles the other model, then swaps it in with a quack) with the rifle in `Rifle_Aim` (legs from `Idle`), framed, shaded and outlined like the image (the art's `hold_rifle_three_quarter` render recipe) on a transparent canvas (the stage's glow shows through), and fades in over the image after its first frame. The duck turns its body, head and rifle toward the cursor within natural limits (`AIM` in `aim.ts`, critically damped easing), relaxes back to the image pose when the cursor leaves the window, and gives a small recoil and a quack when clicked. Touch screens get a lazy glance now and then and follow a tap. It stays on the image with reduced motion, data saver, no WebGL2 or a load error. Light: WebGL2 at a pixel ratio of at most 1.5, frames only while something moves, nothing on other tabs or a hidden page, and it frees its renderer, geometry and textures before the game starts (it comes back on the menu after the round).

### Contract for the game rooms (`apps/server/src/meta/index.ts`)

| Function | Behavior |
| --- | --- |
| `verifySession(token)` | `{ playerId, name, tag, account, look? }` for a valid session token, else `null` (also for a banned, deleted or claimed one). `account`: an account duck (battle royale needs it), `look` its stored character. No token: a random dev identity (counted as signed in) in dev, `null` when `NODE_ENV=production` |
| `allowJoin(ip)` | Per-IP join limit: a burst of 10, then one join every 4 s (IPv6 counted per /64). Loopback is exempt outside production, for the benchmark and e2e |
| `allowCreateRoom(ip)` | Per-IP limit on new game rooms (`create`, or a Quick Play that has to open one): a burst of 3, then one a minute. Checked by the matchmaking guard (`apps/server/src/matchmaking.ts`), which also caps open battle royale rooms at `BR.maxRooms` (1 at launch, `QWAKK_BR_MAX_ROOMS` overrides; while that room plays, new players wait for the next one) and drops every join option except `name`, `token`, `spectate`, `team` (a valid team size) and `character` (a catalog id). Loopback exempt outside production |
| `allowLobby(ip)` | Per-IP limit on lobby (room list) connections: a burst of 20, then one every 3 s. Loopback exempt outside production |
| `allowPartyCreate(ip)`, `allowPartyJoin(ip)` | Per-IP limits on new parties (a burst of 4, then one every 30 s) and on party joins by code, right or wrong (a burst of 8, then one every 5 s: about 887 million codes cannot be guessed). Applied by the matchmaking guard, which also refuses `join` and Quick Play into a party. Loopback exempt outside production |
| `guardJoinIps(httpServer)` | Also caps open WebSockets per IP (game rooms and lobby together) at `CONNECTIONS_PER_IP` (16, IPv6 per /64, `rateLimit.ts`): an upgrade over the cap gets HTTP 429 before Colyseus sees it, and the slot comes back when the socket closes. Loopback exempt outside production |
| `joinIp(context)` | The client IP from a Colyseus `AuthContext`. Colyseus fills `context.ip` from client-controlled headers, so `guardJoinIps(httpServer)` (installed in `index.ts`) rewrites `X-Real-IP` on every upgrade first: the socket address, or with `TRUST_PROXY` the entry our proxy appended to `X-Forwarded-For` |
| `recordMatch(result)` | Writes a finished match. No-op without `DATABASE_URL`, never throws, yields before any work so the tick is not held up, ignores a repeated `matchId`, queues up to 200 results while the database is down. Optional per-player `deaths` (default: royale 1 unless the player won, deathmatch 0; pass it for deathmatch so K/D is right) |

The client side calls the game module's `startGame({ mode, token, name, character, settings })` and `onGameExit(cb)`; `settings.sensitivity` is in radians per mouse count (the `Controls` unit). In dev and test builds, `?mode=br`, `?mode=dm`, `?autopilot=` and `?spectate=1` skip the menu.

### HTTP endpoints (same port as the game server)

| Route | What |
| --- | --- |
| `GET /health` | `{ ok: true, db: 'off' or 'starting' or 'up' or 'down' }`, no database query |
| `POST /api/session` | Body `{ name, deviceToken?, turnstileToken? }` (JSON, max 4 KB). Returns `{ token, expiresAt, deviceToken, playerId, name, tag }`. Without a valid device token this creates a new guest, which needs Turnstile when `TURNSTILE_SECRET` is set. A rename keeps the player id (and the tag when it is free under the new name). Limit: a burst of 8, then one every 20 s per IP |
| `GET /api/leaderboard?season=&mode=&sort=` | Top 100. `season`: id or empty for the current one. `mode`: `all`, `br`, `dm`. `sort`: `score`, `wins`, `kills`, `kd`, `matches`, `avgPlace` (the last two ratio sorts need 5 matches). Cached 30 s |
| `GET /api/me?season=&mode=` | With `Authorization: Bearer <session>`: your identity, rank (by score) and stats |
| `GET /api/status` | The menu's news line and live rules: `{ banner, maintenance, maintenanceMessage, rules }` (`ServerStatus` in `packages/shared/src/lobby.ts`). In memory, public, read limit as the leaderboard |

Account routes (`/api/auth/*`, `/api/account/*`): see `docs/accounts.md`. Hunt Season progression (`/api/duck`, `/api/duck/buy`, `/equip`, `/tree`, `/respec`, with the game session token): see `docs/progression.md`. Legal pages on the same origin: `/terms`, `/privacy`, `/cookies` (static, built from `docs/legal/` by `apps/client/build/legalPages.ts`).

Errors are JSON `{ error }`: `claimed` (a guest whose duck moved into an account), `name_format`, `name_blocked`, `name_reserved`, `name_full`, `turnstile_failed`, `banned` (a banned player's device token), `rate_limited` (with `Retry-After`; also an IP block), `unauthorized`, `unavailable` (no database), `origin_not_allowed`, `bad_request`.

### Score

Per match: placement points `round(50 * (field - place) / (field - 1))` (field = everyone in the match, bots included; in a Duo or Squad battle royale the teams in the match, and the place is the team's, the same for every member), plus 50 for first place, plus 10 per kill counting at most 20 kills, times 1 for battle royale and 0.5 for deathmatch. Season score is the sum. Winning a 32-duck royale with 6 kills is 160. Rank is the position by score (ties: wins, then kills). K/D floors deaths at 1. Bots are stored but never ranked. Numbers live in `apps/server/src/meta/score.ts`.

### Environment

Server:

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL. Unset: no leaderboard, matches not recorded, sessions still work |
| `SESSION_SECRET` | HMAC key for session and device tokens, 32 characters or more. Required in production (the server refuses to start without it); a dev default is used otherwise. Rotating it resets every guest identity |
| `TURNSTILE_SECRET` | Cloudflare Turnstile secret. Unset: new guests and code requests are not challenged |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Sign-in code email (Hostinger: `smtp.hostinger.com`, 465, `noreply@qwakk.fun`). Unset: the dev mail sink prints codes to the console outside production; in production sending a code answers 503 |
| `QWAKK_TEST_HOOKS` | `1` in tests only (refused in production): the dev mail sink's last code per address at `GET /api/test/mail?email=` |
| `TRUST_PROXY` | Number of reverse proxies in front (CapRover: `1`). Only then is `X-Forwarded-For` read, from the right |
| `ALLOWED_ORIGINS` | Comma-separated browser origins, for example `https://play.qwakk.fun` (the one-container hosting serves the page from the game server's own origin). Applies to `/api`, Colyseus matchmaking CORS and WebSocket upgrades. Unset: all three are same-origin only in production (a client served from another host cannot join; the server logs a loud warning at startup) and open in dev |
| `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET` | The admin panel's secrets (`npm run admin:setup`). Both set and valid: the panel is on at `/admin`; otherwise every `/admin` path is a 404 |
| `QWAKK_ADMIN_DIR` | The built admin UI (default `apps/admin/dist`; the image sets `/srv/admin`) |
| `QWAKK_COMMIT` | Commit shown on the admin dashboard (the image takes CapRover's `CAPROVER_GIT_COMMIT_SHA`) |

Client (build time, `apps/client/src/net/endpoint.ts`): `VITE_GAME_SERVER` (game server; default: the page's own origin in public builds, the page host on port 2567 in dev and test builds, or `VITE_SERVER_PORT`), `VITE_API_BASE` (API origin; default: the game server's origin over HTTP(S)), `VITE_TURNSTILE_SITEKEY` (shows the Turnstile check for new guests; unset: no widget and no request to Cloudflare).

### Database setup

```sh
npm run dev                       # starts and connects PostgreSQL 17 on 127.0.0.1:5439 too
docker compose down               # keeps the data volume
```

To use an existing development database instead, supply `DATABASE_URL` to `npm run dev`; the launcher then skips Docker startup.

Migrations run at server start (one transaction under an advisory lock, recorded in `schema_migrations`). Never edit an applied migration; add the next `NNN_*.sql`. Tables: `seasons` (season 1 starts when the first migration runs), `players`, `matches`, `match_players`, and the view `leaderboard_stats`; the admin tables (`002_admin.sql`); accounts, their logins, sessions, codes and news consents (`003_accounts.sql`). A new season: insert a row in `seasons` with a later `starts_at` and set the old one's `ends_at`.

### Tests

`npm test` runs the meta unit tests (names and word filter, tokens and tampering, rate limits, IPs, score, settings, menu entry, account codes and tokens) and the PostgreSQL tests (migration runner, `recordMatch`, the session to leaderboard flow, accounts: codes, limits, sign-up, sessions, ducks, claim, deletion, migration 003 on old data). The PostgreSQL tests use a throwaway database on `localhost:5439` (`TEST_DATABASE_URL` overrides) and are skipped with a message when it is not reachable.

Menu in headless Chrome (needs the local PostgreSQL; uses ports 2591 and 5181):

```sh
node --disable-warning=ExperimentalWarning apps/client/test/menu/browser-check.ts DIR
```

It seeds a throwaway database, checks render, the name filter message, the leaderboard, settings persistence across a reload, keyboard tabs, that Play calls the game entry with the session and settings, the result card, and the phone layout, and saves screenshots to `DIR`.

## Duck Pass (QoreChain Quantum Pass)

Duck Pass links a QoreX wallet to a Qwakk account with one hybrid-signed, post-quantum proof on the QoreChain testnet (Diana, `qorechain-diana`). It is the game's entry for the QoreChain "Build Before Q-Day" fest, Quantum Pass category. Identity only: no tokens, no prizes, no money flows. A linked wallet never touches Tüy, XP, rewards or the leaderboard, and other players never see it.

### The flow

1. Signed in, open the plaza's sheet (Esc), Account, the Duck Pass card, **Link QoreX**.
2. QoreX `getKey('qorechain-diana')` gives the wallet address (QoreX connects the site the first time).
3. The game server answers a challenge for that wallet and the active duck: one `MsgSend` of 1 uqor from the wallet to itself, memo `qwakk-duck-pass:v1:<season>:<duck tag>:<nonce>` (the nonce is random, single use, bound to the account and the wallet, 15 minutes), gas 250,000 (about 0.04 test QOR at QoreX's 0.15 uqor per gas).
4. QoreX `signAndBroadcast` shows it, adds its ML-DSA-87 layer (the wallet's first transaction also registers its post-quantum key), signs with secp256k1 + ML-DSA-87 and broadcasts. Neither the page nor the server ever sees a key or a signature, and the server never broadcasts.
5. The menu sends only the hash. The server reads the transaction from Diana's REST and checks: code 0, exactly the 1 uqor self send, the exact memo of this account's open challenge, one secp256k1 signer whose key derives to the wallet, the `/qorechain.pqc.v1.PQCHybridSignature` body extension and the chain's own `pqc_hybrid_verify` event for the wallet with `status` `verified`. Then it stores the wallet as the account's `qorex` login plus the proof (migration 008). The card shows the wallet and the proof on `https://explore.qore.network/tx/<hash>`.

States on the card: no QoreX (an install link), QoreX too old (no `signAndBroadcast`), wrong network, declined, locked, a request already open, waiting for the chain (Check again), verified, unlink. Every message is fixed copy; wallet and chain text never reach the screen. Routes, errors and limits: `docs/accounts.md` (Duck Pass).

### Kits and network features used

- **create-qorechain-dapp 0.14.0**: `duck-pass/` was scaffolded with `npx create-qorechain-dapp@0.14.0 duck-pass --template fullstack-web --network testnet --yes --no-install` and turned into the **Duck Pass checker**: paste a transaction hash (or open `?tx=<hash>`) and it reads the transaction from QoreChain and checks the proof in the browser with the same rules as the server (`packages/shared/src/duckPass.ts`), including the signer key to address derivation, without any Qwakk server.
- **@qorechain/sdk 0.14.0** (in the checker): `createClient` (testnet), `getTx`, `sha256`, `ripemd160`, `bytesToBech32`.
- **@qorechain/qorex-types 0.1.0** (in the game menu): `getQorexNative`, `hasCapability(native, 'signAndBroadcast')`, `qorexSignAndBroadcast`, `QOREX_DOWNLOAD_URLS`, `isQorexIntegrationError`.
- **QoreX wallet** native lane: `getKey`, `signAndBroadcast` (QoreX 0.3.5 or newer).
- **QoreChain hybrid signatures**: secp256k1 + ML-DSA-87 (FIPS 204) in one transaction, verified by the chain's ante handler (`pqc_hybrid_verify`), and the automatic ML-DSA-87 key registration on a wallet's first transaction.
- No contract: Duck Pass needs none. The proof is a native bank transaction checked against the chain's own PQC events. (CosmWasm upload is governance only on both networks, per the create-qorechain-dapp templates README.)

### Run it

- The game: `npm run dev` (needs the local PostgreSQL for accounts: `npm run db:up`), sign in, hatch a duck, then the Account sheet. The server reads Diana's public REST at `https://api-testnet.qore.host`; there is nothing to configure.
- The checker: `cd duck-pass && npm install && cp .env.example .env && npm run dev`, then open http://localhost:5173 (the game's client uses 5173 too, so run one at a time, or `npx vite --port 5175`). The public REST sends no CORS headers, so the page reads it through the Vite proxy (`/lcd`); a hosted copy needs a proxy that forwards `/lcd` the same way. `npm run build` type-checks and builds it.
- Tests: `npm test` covers the memo, the MsgSend bytes (checked against cosmjs-types), the proof check, the signer address derivation (checked against `@qorechain/sdk`), the server rules with a fake chain, the menu flow with a fake QoreX, and with the local PostgreSQL the routes and rows (`apps/server/test/meta/duckPass.db.test.ts`).

### Privacy

Linking stores the wallet's public qor1 address with the account (`account_logins`, method `qorex`) and the proof's hash and season (`duck_passes`), until the player unlinks it or deletes the account. The proof transaction itself is public on the QoreChain testnet for good: the address, the 1 uqor self send and the memo with the season, the duck's tag and the one-time code. The card says so before the player signs. Details: `docs/privacy-notes.md`, the privacy policy (`docs/legal/privacy.md`, `LEGAL_VERSION` 2026-11-14) and the terms (`docs/legal/terms.md` section 3).

## Admin panel

`play.qwakk.fun/admin` (any server: `http://localhost:2567/admin` in dev) runs the live game from a browser or a phone, without redeploys. `npm run dev` opens no browser and uses your server environment for normal manual login; an authenticated temporary preview is available only with explicit `--open`. For a deployed server, it is off (every `/admin` path a plain 404) until `ADMIN_PASSWORD_HASH` and `ADMIN_TOTP_SECRET` are set; `npm run admin:setup` makes both (it asks for a password, prints the two values, an `otpauth://` URI and a QR code for the authenticator app, and writes nothing to disk). Rules: CLAUDE.md (Admin panel rules); deploy steps: `docs/deploy.md` (2c).

Pages:

- **Dashboard** (refreshes every 3 s): humans in game, open sockets, rooms and bots, tick time (avg, p95), CPU, memory, event loop delay, uptime, version and commit, database state; every game room with its type, mode (Solo, Duo, Squad, free for all), map, humans, bots, watchers, phase and clock, tick p95. A room's player list has Kick, Block IP (60 min, memory only) and Ban; a battle royale room can be closed.
- **Settings**: every server-only number below, with its range, default, when it applies and a reset. A field saves on change; the server validates and clamps it, applies it and logs it. The bot groups have a difficulty preset (easy, normal = the constants, hard) over their 22 knobs. The numbers the client also simulates (movement, fire rate, magazines, spread, aim down sights) are listed read only: they change only with a deploy.
- **Moderation**: find a guest by name or id (database), ban (reason, 1 h to no end; the player leaves every room and its device token gets no new session) or unban, hide from the leaderboard or show again; the active bans; IP blocks (server memory only, at most a day, masked in the list); extra blocked name words (letters only, anywhere or whole word, on top of `blocked-names.json`, new names only).
- **Notices**: a line to everyone in game now (`Msg.Notice`, a HUD toast for 8 s), the menu banner (`ops.banner`, read by the menu from `GET /api/status` when it opens and once a minute) and maintenance mode (no new joins or rooms, `LOBBY_ERROR.maintenance`; matches already running finish; the menu shows the note).
- **Audit log**: who (the session's `admin@xxxx` label), when, what, old and new value, for every change and login.

### Settings

The constants stay the defaults: with nothing stored the server runs exactly as `constants.ts`, `weapons.ts` and `BR_SKILL` say. Stored values (table `admin_settings`, only the ones that differ) load at start. A set environment switch decides instead (the panel shows the setting as locked).

| Key | Setting | Default | Range | Applies | Env override |
| --- | --- | --- | --- | --- | --- |
| `dm.room.istanbul` | Deathmatch: Kavren room open | on | on / off | now | `QWAKK_DM_ROOMS` |
| `dm.room.paris` | Deathmatch: Kumra room open | off | on / off | now | `QWAKK_DM_ROOMS` |
| `dm.room.hongkong` | Deathmatch: Tanoba room open | off | on / off | now | `QWAKK_DM_ROOMS` |
| `dm.players` | Deathmatch: Ducks per room | 24 ducks | 2 to 32 | now |  |
| `dm.maxHumans` | Deathmatch: Most humans per room | 32 players | 1 to 32 | now | `QWAKK_MAX_CLIENTS` |
| `dm.scoreLimit` | Deathmatch: Kill limit | 50 kills | 5 to 500 | next round |  |
| `dm.roundSeconds` | Deathmatch: Round time | 600 s | 60 to 3600 | next round |  |
| `dm.intermissionSeconds` | Deathmatch: Break between rounds | 10 s | 3 to 60 | next round |  |
| `dm.spawnProtectionSeconds` | Deathmatch: Spawn protection | 2 s | 0 to 10 | now |  |
| `dm.killStacks` | Deathmatch: Kill stacks | on | on / off | now |  |
| `dm.stackDamagePercent` | Deathmatch: Damage per kill stack | 6 % | 0 to 20 | now |  |
| `dm.hero` | Deathmatch: Caped hero | on | on / off | now |  |
| `dm.heroEverySeconds` | Deathmatch: Hero pick interval | 120 s | 30 to 900 | now |  |
| `dm.heroHealth` | Deathmatch: Hero health | 200 hp | 100 to 250 | now (next hero) |  |
| `dm.heroKillPoints` | Deathmatch: Hero takedown bonus | 300 points | 0 to 2000 | now |  |
| `dm.heroHoldPoints` | Deathmatch: Hero points every 5 s | 10 points | 0 to 200 | now |  |
| `br.maxRooms` | Battle royale: Rooms at once | 1 rooms | 0 to 8 | now | `QWAKK_BR_MAX_ROOMS` |
| `br.minHumans` | Battle royale: Humans to start | 2 players | 1 to 16 | new rooms | `QWAKK_BR_MIN_HUMANS` |
| `br.countdownSeconds` | Battle royale: Start countdown | 30 s | 5 to 120 | new rooms | `QWAKK_BR_COUNTDOWN` |
| `br.mode.solo` | Battle royale: Solo rooms | on | on / off | now |  |
| `br.mode.duo` | Battle royale: Duo rooms | on | on / off | now |  |
| `br.mode.squad` | Battle royale: Squad rooms | on | on / off | now |  |
| `br.zoneTimeScale` | Battle royale: Zone timing (every wait and shrink times this) | 1 x | 0.5 to 2 | new rooms |  |
| `br.zoneDamageScale` | Battle royale: Zone damage (damage outside times this, rounded, at least 1 per second) | 1 x | 0.5 to 3 | new rooms |  |
| `br.firstCircleRadius` | Battle royale: First circle radius (kept 20 m above the second circle) | 220 m | 160 to 380 | new rooms |  |
| `raid.maxRooms` | Hunt Season: Runs at once | 3 rooms | 0 to 12 | now | `QWAKK_RAID_MAX_ROOMS` |
| `raid.lobbySeconds` | Hunt Season: Lobby countdown | 15 s | 3 to 60 | new rooms | `QWAKK_RAID_COUNTDOWN` |
| `raid.breakSeconds` | Hunt Season: Break between objectives | 8 s | 4 to 60 | new rooms |  |
| `raid.coreHp` | Hunt Season: Core health | 1000 hp | 100 to 5000 | new rooms |  |
| `raid.maxLive` | Hunt Season: Hunters at once | 44 hunters | 5 to 60 | new rooms |  |
| `raid.waveScale` | Hunt Season: Pack size | 1 x | 0.3 to 3 | new rooms |  |
| `raid.hunterHpScale` | Hunt Season: Hunter health | 1 x | 0.3 to 3 | new rooms |  |
| `raid.hunterDamageScale` | Hunt Season: Hunter damage | 1 x | 0.2 to 3 | new rooms |  |
| `raid.coreDamageScale` | Hunt Season: Core damage | 1 x | 0.2 to 3 | new rooms |  |
| `raid.gateHp` | Hunt Season: Gate health | 700 hp | 100 to 5000 | new rooms |  |
| `raid.gateDamageScale` | Hunt Season: Gate damage | 1 x | 0.2 to 3 | new rooms |  |
| `raid.gateRepairPerSecond` | Hunt Season: Gate repair | 35 hp/s | 5 to 200 | new rooms |  |
| `raid.gateBreakRepairPercent` | Hunt Season: Gate patched at a break | 25 % | 0 to 100 | new rooms |  |
| `raid.bridgeMoveSeconds` | Hunt Season: Drawbridge travel | 2.5 s | 1 to 8 | new rooms |  |
| `raid.bridgeCooldownSeconds` | Hunt Season: Drawbridge lever cooldown | 10 s | 2 to 60 | new rooms |  |
| `raid.bridgeUpMaxSeconds` | Hunt Season: Drawbridge up at most | 25 s | 5 to 120 | new rooms |  |
| `raid.raftSpeed` | Hunt Season: Raft speed | 1.5 m/s | 0.5 to 4 | new rooms |  |
| `raid.cannon.damage` | Hunt Season: Bread cannon damage | 75 hp | 10 to 400 | new rooms |  |
| `raid.cannon.radius` | Hunt Season: Bread cannon splash | 3.5 m | 1 to 8 | new rooms |  |
| `raid.cannon.knockback` | Hunt Season: Bread cannon knockback | 8 m/s | 0 to 20 | new rooms |  |
| `raid.cannon.reloadSeconds` | Hunt Season: Bread cannon reload | 1.3 s | 0.4 to 5 | new rooms |  |
| `raid.cannon.heatPerShot` | Hunt Season: Bread cannon heat per loaf | 30 % | 5 to 100 | new rooms |  |
| `raid.cannon.coolPerSecond` | Hunt Season: Bread cannon cooling | 10 %/s | 1 to 50 | new rooms |  |
| `raid.cannon.ventBelow` | Hunt Season: Bread cannon vents to | 35 % | 0 to 90 | new rooms |  |
| `raid.hunterReactionMin` | Hunt Season: Hunter reaction, fastest | 15 ticks | 0 to 90 | new rooms |  |
| `raid.hunterReactionMax` | Hunt Season: Hunter reaction, slowest | 25 ticks | 0 to 90 | new rooms |  |
| `raid.hunterAimError` | Hunt Season: Hunter aim error | 0.1 rad | 0 to 0.4 | new rooms |  |
| `raid.hunterSpreadDeg` | Hunt Season: Hunter spread | 1.1 deg | 0 to 6 | new rooms |  |
| `raid.blade.slash1` | Hunt Season: Katana: first cut | 24 hp | 1 to 200 | new rooms |  |
| `raid.blade.slash2` | Hunt Season: Katana: second cut | 24 hp | 1 to 200 | new rooms |  |
| `raid.blade.slash3` | Hunt Season: Katana: finisher | 42 hp | 1 to 300 | new rooms |  |
| `raid.blade.heavy` | Hunt Season: Katana: heavy spin | 34 hp | 1 to 300 | new rooms |  |
| `raid.blade.heavyCharge` | Hunt Season: Katana: heavy charge bonus | 40 hp | 0 to 300 | new rooms |  |
| `raid.blade.storm` | Hunt Season: Blade Storm pulse | 12 hp | 1 to 100 | new rooms |  |
| `raid.blade.quack` | Hunt Season: Quack shockwave damage | 10 hp | 0 to 100 | new rooms |  |
| `raid.blade.dash` | Hunt Season: Dash cut | 16 hp | 0 to 100 | new rooms |  |
| `raid.blade.crit` | Hunt Season: Crit multiplier | 1.6 x | 1 to 4 | new rooms |  |
| `raid.blade.staggerSeconds` | Hunt Season: Stagger | 0.35 s | 0 to 2 | new rooms |  |
| `raid.blade.knockScale` | Hunt Season: Blade knockback | 1 x | 0 to 3 | new rooms |  |
| `raid.blade.meterPerHit` | Hunt Season: Storm meter per hit | 1.2 | 0 to 20 | new rooms |  |
| `raid.blade.meterPerKill` | Hunt Season: Storm meter per kill | 3 | 0 to 50 | new rooms |  |
| `raid.blade.comboSeconds` | Hunt Season: Combo window | 3 s | 1 to 10 | new rooms |  |
| `raid.blade.beaterDamage` | Hunt Season: Beater hit | 6 hp | 1 to 60 | new rooms |  |
| `raid.blade.recruitDamage` | Hunt Season: Recruit hit | 4 hp | 1 to 60 | new rooms |  |
| `raid.push.trenchKills` | Hunt Season: Trench: hunters to bag | 28 hunters | 5 to 200 | new rooms |  |
| `raid.push.crates` | Hunt Season: Supply crates | 3 crates | 1 to 6 | new rooms |  |
| `raid.push.crateHp` | Hunt Season: Supply crate health | 150 hp | 20 to 2000 | new rooms |  |
| `raid.push.snipersPerTower` | Hunt Season: Snipers per watchtower | 2 snipers | 1 to 4 | new rooms |  |
| `raid.push.packGapScale` | Hunt Season: Time between packs | 1 x | 0.3 to 3 | new rooms |  |
| `raid.upgrade.damagePercent` | Hunt Season: Upgrade: damage | 15 % | 1 to 50 | new rooms |  |
| `raid.upgrade.maxHealth` | Hunt Season: Upgrade: max health | 20 hp | 5 to 60 | new rooms |  |
| `raid.upgrade.armorPercent` | Hunt Season: Upgrade: armor | 10 % | 1 to 30 | new rooms |  |
| `raid.upgrade.regenPerSecond` | Hunt Season: Upgrade: regen | 1.5 hp/s | 0.5 to 6 | new rooms |  |
| `raid.upgrade.revivePercent` | Hunt Season: Upgrade: faster revive | 25 % | 5 to 50 | new rooms |  |
| `raid.upgrade.reachPercent` | Hunt Season: Upgrade: wider arcs | 15 % | 5 to 50 | new rooms |  |
| `raid.upgrade.critPercent` | Hunt Season: Upgrade: crits | 30 % | 5 to 100 | new rooms |  |
| `raid.upgrade.lifesteal` | Hunt Season: Upgrade: lifesteal | 1 hp | 0.5 to 10 | new rooms |  |
| `raid.upgrade.stormPercent` | Hunt Season: Upgrade: storm charge | 25 % | 5 to 100 | new rooms |  |
| `raid.upgrade.bleedDps` | Hunt Season: Upgrade: bleed | 6 hp/s | 1 to 40 | new rooms |  |
| `raid.upgrade.chainPercent` | Hunt Season: Upgrade: chain lightning | 40 % | 5 to 100 | new rooms |  |
| `raid.upgrade.finisherPercent` | Hunt Season: Upgrade: finisher | 40 % | 5 to 150 | new rooms |  |
| `raid.levelHpPercent` | Hunt Season: Strong ducks: hunter health per level | 1 % | 0 to 3 | new rooms |  |
| `raid.levelDamagePercent` | Hunt Season: Strong ducks: hunter damage per level | 0.5 % | 0 to 2 | new rooms |  |
| `raid.dropAmmoPercent` | Hunt Season: Ammo drop chance | 22 % | 0 to 100 | new rooms |  |
| `raid.dropHealPercent` | Hunt Season: Heal drop chance | 12 % | 0 to 100 | new rooms |  |
| `raid.healAmount` | Hunt Season: Heal drop | 25 hp | 5 to 100 | new rooms |  |
| `weapons.rifle.damage` | Weapons: Rifle body damage | 24 hp | 1 to 100 | now |  |
| `weapons.rifle.headMultiplier` | Weapons: Rifle headshot multiplier | 3.6 x | 1 to 6 | now |  |
| `weapons.pistol.damage` | Weapons: Pistol body damage | 26 hp | 1 to 100 | now |  |
| `weapons.pistol.headMultiplier` | Weapons: Pistol headshot multiplier | 4 x | 1 to 6 | now |  |
| `ops.banner` | Notices: Menu banner | (empty) | up to 160 characters | now |  |
| `ops.maintenance` | Notices: Maintenance mode | off | on / off | now |  |
| `ops.maintenanceMessage` | Notices: Maintenance note | (empty) | up to 160 characters | now |  |

Bot skill knobs (deathmatch `dmBot.*`, defaults `DM_BOT`; battle royale `brBot.*`, defaults `BR_SKILL`), all applied at once (the live skill objects every bot reads), a range whose upper end is below its lower end uses the lower one:

| Knob (`dmBot.*` / `brBot.*`) | Deathmatch default | Battle royale default | Range |
| --- | --- | --- | --- |
| `reactionMin` reaction, fastest | 14 | 14 | 1 to 90 ticks |
| `reactionMax` reaction, slowest | 24 | 26 | 1 to 90 ticks |
| `yawError` first aim error, sideways | 0.2 | 0.17 | 0 to 0.6 rad |
| `pitchError` first aim error, up and down | 0.08 | 0.08 | 0 to 0.3 rad |
| `errorSettle` aim error kept per tick | 0.95 | 0.93 | 0.8 to 0.999 |
| `burstYawError` burst error, sideways | 0.02 | 0 | 0 to 0.1 rad |
| `burstPitchError` burst error, up and down | 0.012 | 0 | 0 to 0.06 rad |
| `trackRate` tracking | 0.3 | 1 | 0.05 to 1 |
| `turnRate` turn speed | 0.16 | 0.22 | 0.03 to 0.5 rad/tick |
| `recoilControl` recoil control | 0.55 | 0.6 | 0 to 1 |
| `headChance` headshot aim chance | 0.05 | 0.1 | 0 to 1 |
| `viewRange` view range | 80 | 50 | 10 to 200 m |
| `fovDeg` field of view, half angle | 60 | 75 | 20 to 90 deg |
| `hearRange` notice range | 6 | 9 | 0 to 30 m |
| `burstMin` burst, fewest shots | 2 | 3 | 1 to 30 shots |
| `burstMax` burst, most shots | 5 | 6 | 1 to 30 shots |
| `longBurstMin` long range burst, fewest | 2 | 2 | 1 to 30 shots |
| `longBurstMax` long range burst, most | 3 | 4 | 1 to 30 shots |
| `pauseMin` pause between bursts, shortest | 8 | 5 | 0 to 60 ticks |
| `pauseMax` pause between bursts, longest | 16 | 12 | 0 to 60 ticks |
| `semiPauseMin` pistol pause, shortest | 5 | 3 | 0 to 60 ticks |
| `semiPauseMax` pistol pause, longest | 10 | 7 | 0 to 60 ticks |

Weapon damage is server only (the client never predicts damage), so it is tunable; fire rate, spread, recoil and ammo are not.

How the game reads them (`apps/server/src/settings/`): `rules.ts` getters when a room, a round or a spawn starts (`dmRoundRules` at each deathmatch round start, `spawnProtectTicks` at each spawn, `brStartRules` when a battle royale room is created, `brMaxRooms` and the team modes in the matchmaking guard), the bot skills by writing the shared `SKILL` and `BR_SKILL` objects in place, damage through `serverWeapon` (a table rebuilt on change). Nothing is looked up per tick, so `npm run bench` is unchanged. `dm.players` and `dm.maxHumans` reach running deathmatch rooms through a change listener; the deathmatch rooms open and close as `dm.room.*` say (`ops/dmRooms.ts`).

The menu reads the live rules from `GET /api/status`: the rooms cap and start rule in the battle royale list, the open deathmatch rooms and their size, the team modes in the picker.

### Security

- Login: a plain HTML form with no script (`admin/pages.ts`). The password is checked with scrypt (N 2^15, r 8, p 1, on the thread pool so the tick loop never waits) in constant time, then the TOTP code (RFC 6238, 6 digits, 30 s, one step of drift); a step that logged in once is refused after (replay), and a wrong password never uses up a code. Wrong password and wrong code get the same answer.
- Lockout (memory): 5 failures from one address (IPv6 /64) in 15 min lock it for 15 min, doubling up to a day; more than 20 failures from anywhere in 10 min lock every login for 1 min, doubling up to 30 min. Plus rate limits per address: logins 10 then 1 a minute, pages 60 then 2 a second, API 120 then 5 a second.
- Session: `__Host-qwakk_admin`, HttpOnly, Secure, SameSite=Strict, Path=/, signed (HMAC-SHA256, a key random per process) and held in server memory: 12 h at most, 2 h idle, logout or a restart ends it.
- Every POST needs this server's own Origin (https in production) and, when sent, `Sec-Fetch-Site: same-origin`; API writes must be JSON. No CORS headers on any admin answer. Admin responses carry `Cache-Control: no-store`, `X-Frame-Options: DENY` and a CSP (the app: its own files only; the login page: no script at all).
- The admin bundle is not public: `apps/admin/dist` sits outside the client dist and the server sends its files only with a valid session (404 otherwise). `apps/client/dist` has no admin code (`grep -ri admin apps/client/dist` finds only the menu line about the flock admins; the image build fails on `/admin/api`).
- Never logged: passwords, codes, cookies. IP addresses are never stored (blocks live in memory, the audit log names the block and the player).

### Run it locally

```sh
npm run dev
# Open http://localhost:2567/admin yourself (requires the two server environment values below).
```

For manual local login, run `npm run admin:setup`, choose a password (4+ characters), and scan the authenticator QR. Put the exact `ADMIN_PASSWORD_HASH` and `ADMIN_TOTP_SECRET` lines in the repo root's ignored `.env` file, or export them in the terminal. `npm run dev` reads `.env` for the server only; exported variables take precedence. Restart the dev command after changing these values. Then open http://localhost:2567/admin and enter the password and current 6-digit code. Without both valid values the panel stays off. `.env` is excluded from Git and Docker; never commit or share it. `npm run dev -- --open` is an optional temporary authenticated preview; it is never automatic. Production setup is in `docs/deploy.md` (2c). Local PostgreSQL is connected automatically; a server started directly without `DATABASE_URL` uses memory only.

## Battle royale

### Match flow

| Stage | What happens |
| --- | --- |
| Lobby | The menu's room list comes from the `lobby` room (Colyseus' built-in LobbyRoom with realtime listing on `br`, `apps/server/src/lobby.ts`). Each room's metadata is public: label, stage, humans, capacity, humans still needed, countdown seconds. Join by id, create, or Quick Play (joinOrCreate, most players first). Rooms in progress are listed but locked |
| Waiting | On the village square, both guns, damage off, the room's roster (name#tag) and "waiting for N more" on screen. The countdown (`BR.countdownSeconds`, 30 s) starts once `BR.minHumans` (2) humans are in and resets when they drop below it; more humans can join during it, up to 16 (a full room starts in `BR.fullCountdownSeconds`, 10 s). Joins close 2 s before the end |
| Lock | The room locks, bots fill to 16, loot is rolled, the zone is planned, everyone boards the plane with no gear |
| Plane | The map path (of 8) that passes closest to the first circle, picked by seed between the two best (a path whose start is right at the circle scores worse), 180 m up at 1.3 times the map's 55 m/s (about 72 m/s); the sea before the island is cut off (the path starts 60 m before the first land). F jumps (only over land); everyone still aboard is ejected at the first circle's far edge or 70 m before the last land point, whichever comes first, but not before 6 s (`DROP`, `plane.ts`); the server sends that time (`planeEnd`) |
| Drop | Freefall (32 m/s down, W dives to 46 m/s, 10 m/s steering), then the glider: Space or F, or by itself 45 m above the terrain. Gliding: 13 m/s forward, 4.3 m/s down (about 1:3); W dives (19 / 7.5), S brakes (6 / 3) |
| Loot | 634 loot points: each floor point holds an item 70% of the time; every crate on the map (149 today: small crates 2 items, large crates 3 one tier better, ammo boxes 2 ammo stacks) is always filled and starts closed; tables by tier (1 to 4), better in hot zones and upstairs; every gun comes with an ammo stack (next to it, or in the same crate) |
| Zone | 6 phases (table below), final circle picked first from the map's weighted candidates, then grown outward so every circle contains the next, keeps at least 70% land and, among the tries that do, holds the most loot spots (the populated part of the island). The first circle (220 m) is up from the start, while everyone is still in the plane. The zone fully closes 5.5 minutes after the plane starts; `br.zoneTimeScale`, `br.zoneDamageScale` and `br.firstCircleRadius` tune it live |
| Teams | Duo and Squad rooms: teams of 2 or 4, parties on one team, knocked ducks, revives (see Run it). Placement is per team; the match ends when one team has someone standing |
| End | The last duck standing wins; every duck gets a place (a duck that leaves mid-match is out with the place it had then; a winner who leaves the results screen stays the winner). Results go to the leaderboard through `recordMatch`, also when the last human leaves before the end (the room records the match as it stands). One identity holds at most one seat per room. The room closes 20 s later |

| Phase | Wait (s) | Shrink (s) | End radius (m) | Damage per second outside |
| --- | --- | --- | --- | --- |
| 0 (drop and loot) | 50 | snap | 220 (shown from the start) | 0 |
| 1 | 40 | 40 | 150 | 2 |
| 2 | 35 | 35 | 95 | 4 |
| 3 | 30 | 25 | 55 | 7 |
| 4 | 20 | 20 | 25 | 12 |
| 5 | 15 | 20 | 0 | 20 |

All of it is in `constants.ts` (`BR`, `DROP`, `HEAL`, `ZONE`, `VIS`, `WATER`) and `items.ts` (`LOOT`, `PACK`, `ARMOR`, loot tables).

### Items

| Item | Rule |
| --- | --- |
| Rifle, pistol | One slot each (1 and 2). The first one comes with a full magazine and is equipped if you are unarmed; a gun you already have becomes reserve ammo |
| Rifle ammo (30), pistol ammo (24) | Up to 180 rifle and 96 pistol rounds in reserve, as far as the backpack holds them; what does not fit stays on the ground |
| Vest level 1 / 2 | 30% / 40% less body damage, 100 / 150 durability; each hit wears 0.75 per point of raw damage; taken only as an upgrade |
| Helmet level 1 / 2 | 30% / 40% less head damage, 80 / 120 durability |
| Bandage | 4 s, +15 health up to 75; up to 10 (backpack permitting) |
| Medkit | 7 s, full health; up to 3 |
| Backpack level 1 / 2 / 3 | Carrying capacity 90 / 130 / 170 (50 without one); taken only as an upgrade, drawn on the duck's back |

Heals slow you to 2.2 m/s and stop when you fire, reload, switch or jump (the item is kept). A dead duck drops a crate with its guns (with the rounds still in them), reserve ammo, armor (with its durability), backpack and heals; E on the crate takes everything that fits. Nothing is created on the way.

#### Inventory and carrying capacity

PUBG-style weight: ammo and heals go into the backpack and weigh something, the two guns (slots 1 and 2), worn armor and the backpack itself weigh nothing. Numbers in `items.ts` (`PACK`, `LOOT`), rules in `inventory.ts`.

| Item | Weight per unit | A full stack weighs | Cap per kind |
| --- | --- | --- | --- |
| Rifle ammo | 0.5 | 15 (30 rounds) | 180 |
| Pistol ammo | 0.25 | 6 (24 rounds) | 96 |
| Bandage | 2 | 4 (2) | 10 |
| Medkit | 6 | 6 (1) | 3 |

| Backpack | Capacity | Holds for example |
| --- | --- | --- |
| None | 50 | 60 rifle rounds, 24 pistol rounds, 4 bandages, 1 medkit (50) |
| Level 1 | 90 | |
| Level 2 | 130 | |
| Level 3 | 170 | everything up to the caps (152) |

- A pickup takes what fits: part of an ammo stack can be taken and the rest stays. Nothing fits: the item stays and the HUD says why (backpack full, carrying the max of it, your armor or backpack is as good or better). The prompt already says it before you press E, and an open crate's panel marks what does not fit.
- A better vest, helmet or backpack replaces the worn one, which drops at your feet with its durability. A second gun of a kind you own adds its magazine to your reserve, as far as it fits.
- The inventory screen (I) drops a stack (one magazine's worth or all of it, one heal or all), a gun (with the rounds in its magazine; you switch to the other gun), an armor piece (with its durability) or the backpack (only when what you carry fits without it). Dropped items land in front of you for anyone to take. It also lists what is in reach (open crates and items on the ground) with a Take button each.

#### Crates

Every small crate, large crate and ammo box on the map is a closed crate at match start. E on a closed crate opens it: the lid swings up for everyone who sees the crate, the loot lies inside on a straw bed, and after the lid is up (0.3 s, `LOOT.crateOpenTicks`) E takes everything that fits, or the inventory screen takes single items. An opened crate stays open, also when it is empty. The client draws these crates itself (`world/sainte/crates.ts`, model `models/crates/crates.glb` from `art/map/blender/crates_open.py`, greybox until it loads) in place of the static crate props at each container loot point; the static props keep their colliders, so the map data and hash are unchanged.

Pickups are server decisions: E is an input button, and the server checks reach (2.6 m from the chest) and line of sight before it opens a crate or moves anything into the inventory. The inventory screen's buttons are requests too (`Msg.Inv`): the server applies the same reach, sight and inventory rules, at most 8 per second per duck, and only to a living duck on the ground in a running match. Inventory, ammo, armor durability and health are owner-only (`.view()`); other players only see the armor and backpack levels (drawn on the duck), the held gun and the glider.

### The map: Yelova

The map workstream exports `map_v1` (format v2) to `art/map/export/` and the prop kit to `apps/client/public/models/props/`. `npm run map:sync` copies `map_v1.json`, `map_v1_heights.bin`, `map_v1_ground.bin` and `colliders.json` into `packages/shared/src/maps/sainte-canard/` (and the deathmatch arena into `canard-quarter/`): the server reads them from there and the client bundles the same files, so both build the same 6,137 colliders. `npm test` fails when the copy is stale. `apps/server/test/houses.test.ts` walks a sim duck through every placed house (doors, stairs, the ruin's debris ramp, upper floors), running and crouched, along the `walk` paths in the prop manifest. The room sends the map id and a hash of the three files the sim uses; a client with different files refuses to play.

Collider kinds follow the map's table: `wire` and `fence` block movement only, `hedge` blocks movement and sight but not bullets, `foliage` (bushes) only hides. The river and the shallow sea slow you down (70% when the water is over 25 cm, 45% over 1 m).

The client draws the props as instanced meshes per prop type and LOD level, refilled from the visible chunks with per-instance LOD by distance (`manifest.json` switch distances, 0.6 times on the low quality setting), terrain with the ground paint, river and sea, and a sky and fog that hide the cull distance. Ducks past 35 m drop their outline and shadow.

The terrain is textured from the ground paint (`world/sainte/groundMaterial.ts`, textures from `art/ground/`, see `art/README.md`): per pixel the four surrounding paint samples pick their texture layers (grass, forest floor, dirt, sand, rock, cobble, plowed, wheat, crop), blended by weight and height map along noise-warped edges, in world-space UVs with a second rotated or shifted sample against tiling, tinted to the paint colors and faded into the flat vertex colors by distance and by texel footprint (no moire on rows). The High preset reads 4 paint texels, 8 layer samples and 2 noise samples per ground pixel with 8x anisotropic filtering; Low (phones) reads one of each (the nearest sample's layer and tint, no anti-tiling, 2x anisotropic filtering, a shorter fade). If the textures fail to load, take longer than 8 s, or the material cannot be built, the terrain keeps the flat vertex colors.

### The deathmatch arena: Kavren

`canard-quarter`, a compact village quarter from the same kit for the 24-duck deathmatch (`art/map/layout/gen_quarter.py`, renders in `art/map/renders/canard-quarter/`, details in `art/map/README.md`): the QoreChain Tower in the middle of the square on a crossroads (an open arcade hall under a lettered tower) with five enterable houses, about 162 x 162 m inside a closed hedgerow ring, 1,498 colliders. `npm run map:sync` copies it to `packages/shared/src/maps/canard-quarter/`; `apps/server/test/canardQuarter.test.ts` checks it and its 48 `dmSpawns` (`[x, y, z, yaw]`, player yaw).

### Anti-wallhack

Battle royale and deathmatch rooms on map_v1 maps (the greybox deathmatch keeps everyone in view). The server sends an enemy's pose only when the viewer could plausibly see it: within 10 m always, otherwise within 320 m and with a clear line through opaque geometry from the viewer's eye or either camera shoulder to the target's head, chest, feet or sides (a 0.6 m margin), tested every 3 ticks (a third of the viewers each tick, so the ray casts do not spike), also at the positions both will have 150 ms plus half a round trip later (so a duck coming round a corner is already there), and kept for 1 s after it was last visible. A hidden enemy is removed from the client's state, so the client has nothing to reveal. Allies (teammates, party allies in a deathmatch) are sent to each other at any range and through walls (they are on your side; their markers show through walls), and only they get each other's team entries (health, knocked, revive) through the per-viewer views; enemies stay under the culling unchanged. A knocked duck shows as a pose action (crouched, gun away), culled like any pose. Shots from a duck you cannot see arrive as a direction and a loudness only (for the sound); kill messages carry the victim's position only to viewers who saw it; damage indicators carry a direction, never the attacker's position. A duck's movement mode (plane, freefall, glider) and action (reload, heal) ride on its pose entry, so they are culled with it. Loot is sent within 100 m and only once its spot is in sight (or within 10 m): a death crate behind a wall shows up when you see it, and an item taken behind a wall stays as a stale copy until you see that spot again (pressing E on it does nothing, the server decides pickups on its own list). Crates work the same way: a crate opened behind a wall stays closed for you until you see it again, and a closed crate's contents are never sent to anyone.

### Switching the deathmatch map

The deathmatch map is one constant, `MATCH.mapId` in `packages/shared/src/constants.ts` (`'canard-quarter'`; `'sainte-canard'` and `'greybox'` work too). Any folder `packages/shared/src/maps/<id>/` with `map_v1.json`, `map_v1_heights.bin`, `colliders.json` (and optionally `map_v1_ground.bin`) is a valid id: the server reads it by id, the client bundles every map folder (an `import.meta.glob` in `apps/client/src/world/sainte/assets.ts`) and fetches only the one in play, and the join still refuses a client whose files hash differently. Spawns come from the map's optional `dmSpawns` field (`[[x, y, z, yaw], ...]`, yaw as the input yaw); without it they are derived on open ground within 60 m of the map's plaza (`MATCH.derived*`). The optional `playArea.ring` keeps the bots' roaming goals inside the play area. The navmesh for the new id is built on server start (a few seconds for Kavren, cached by map hash) and baked into the server image (`deploy/server/build-navmesh.ts`).

### Bots

Deathmatch bot skill lives in `DM_BOT` (`constants.ts`): a reaction of 14 to 24 ticks (about half a second) to a new target, a first aim error that settles slowly, a fresh error per burst, an aim point that trails a strafing target, weak recoil control, 2 to 5 shot bursts, an 80 m view and a 120 degree field of view. A duck back from a respawn is a new target (fresh reaction), and spawn-protected ducks are skipped. Battle royale bots keep their own numbers (`BR_SKILL`, unchanged). Deathmatch bots on map_v1 maps (`dmBot.ts`) fight with the deathmatch brain and walk navmesh paths between fights (`nav/navWalker.ts`): chase the last sighting, else roam between spawn points and random walkable spots inside the play area, pausing now and then. A bot that gives up a goal without getting anywhere (on a table, in a corner off the navmesh) walks off toward the most open direction first. On the greybox they keep the ray-steering brain.

Battle royale bots run on a tiled recast navmesh built from the map colliders (`recast-navigation` 0.43.1, MIT): cell 0.2 m, about 64 s to build, cached in `apps/server/.navcache/` by map hash (under a second to load), built on a worker thread at server start when the cache is cold (bots steer directly until it is ready). They pick a landing spot by zone heat and tier within 170 m of the plane's route, spread out from each other's spots (and pick again, favoring the inside of the first circle, once it is announced), jump as the plane passes it, dive in freefall straight at it and open the glider only when the spot is out of reach of a diving glide from where they are, then dive the glider and spiral over the spot instead of braking above it (a bot is on the ground about 9 s after it jumps). Unarmed, they run for a gun: no holding a spot, no early rotation, no running from unarmed ducks, far items only when they may hold a gun, and loot spots in order of distance (a spot that does not work out within 12 s is given up). Then they loot what they see, heal when safe, rotate into the announced circle and fight with the deathmatch brain (same input path, same line-of-sight rules, softer skill: reaction 14 to 26 ticks, 50 m view range). In Duo and Squad they play on their team: teammates are never targets, a knocked bot stays put and waits, and a bot with a knocked teammate within 40 m walks to it and holds Use once no fight has been on for 2 s (the same Use input a player sends).

## How the netcode works

- The client sends inputs only: move axes, buttons (including fire, reload, weapon slot, shoulder side and aim down sights), yaw, pitch, its tick estimate and the server time it is drawing other players at (`vt`, the rewind target). Colyseus numbers them (`room.input()`), the server acks them.
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

### Aim down sights

Holding the right mouse button sets the `Aim` input bit. The sim ramps `aim` up by one tick per tick to 6 (200 ms) while the duck is armed, not reloading and not healing, and down by 2 per tick on release (100 ms out), so a one-tick flick buys almost nothing. Everything scales with that ramp, on the client and the server alike (`ADS` in `constants.ts`):

| At full aim | Value |
| --- | --- |
| Base spread (standing, crouched) | x0.5 (rifle 0.10 degrees standing) |
| Moving penalty | x0.6 |
| Spray bloom | x0.6 |
| Airborne penalty | unchanged |
| Spray pattern (recoil) | x0.65, carried on the shot (`ShotFired.recoil`) so the server traces the same pattern |
| Move speed | 3.0 m/s cap, no sprint |
| Camera | arm 3.1 to 2.0 m along the same shoulder line, zoom x1.5 (rifle) or x1.25 (pistol), view kick x0.55, screen shake x0.5, edge vignette |
| Look speed | the aiming sensitivity setting (default 0.8 of the normal speed) |

Starting a reload drops the aim. Other players see the raised aim pose (pose action 4).

Movement below 34% of run speed adds no inaccuracy, which a counter-strafe reaches in 2 ticks. Firing stops sprinting. A trigger pull on an empty magazine starts the reload. Deathmatch spawn protection lasts 2 s or until you press fire (the duck blinks; shots pass through a protected duck, no predicted hit markers on it or during the round break); respawn takes 3 s, at the arena spawn point farthest from living enemies, and the camera turns to the spawn facing.

## Measured results

### Two clients in real browsers (e2e)

Two headless Chrome pages (WebGPU backend, 1280x720) on the same machine as the server (bots off), both on autopilot, 15 s per phase. Measured on the greybox; the same test now runs on Kavren with culling (`QWAKK_DM_SPAWN_RADIUS=21` spawns both on the square): map hash `bd7d95fa:1542` and the sim scenario on it identical in Node and Chrome, B sent in 30 of 30 samples, no close duck missed, 0 of about 450 reconciles corrected without added latency. One of three runs showed 10 to 11 small corrections (up to 25 cm) at 120 ms, from the two ducks bumping into each other (player collision is server only, see Known issues); the other two had 0.

| Condition | Predicted local player | Remote player drawn | Corrections |
| --- | --- | --- | --- |
| No added latency | max drawn speed 7.3 m/s, 0 snap frames | max 8.2 to 9.1 m/s, 0 snap frames | 0 of about 450 reconciles |
| 120 ms round trip, +/- 10 ms jitter | max 7.3 m/s, 0 snap frames | max 7.8 to 8.2 m/s, 0 snap frames | 0 of about 450 reconciles |
| 150 ms, +/- 15 ms, 2% loss (stress) | 0 snap frames | 6 to 7 snap frames (TCP stalls) | 0 of about 320 |

The test also runs a fixed 600-tick, 6-player scenario in Node and in Chrome: the resulting state hashes are identical.

"Drawn speed" is the speed of what is actually rendered, sampled every frame. Sprint speed is 7 m/s, so a frame drawn above 11.2 m/s counts as a snap. Both pages held 60 fps (16.7 ms frames, vsync capped in headless Chrome, so this is not a GPU benchmark). The WebGL2 fallback was also rendered and checked with `?webgl=1`.

### Deathmatch with bots

- Headless on Kavren (`apps/server/test/deathmatch.test.ts` and longer runs of the same code): a full room of 32 navmesh bots scores about 220 kills a minute (the leader reaches 44 in 4 minutes); the bots spend about 62% of their time fighting, 34% dead (3 s respawn) and the rest walking. With 6 bots, 8 runs of 10 minutes had no bot stuck for a 10 s window while walking. The bots and the sim cost 0.7 ms per tick for 32 bots in a tight loop (see the benchmark note on macOS timings).
- Softer deathmatch bots and spawn protection (one scripted human plus 23 bots on Kavren, 3 rooms x 300 s each; the human walks the navmesh like a bot but never fires): before, it died every 6.6 s alive (median life 4.7 s), 28 of 94 deaths within 3 s of spawning, bot hit rate 22.4%, 155 kills a minute in the room; after, every 11.5 s (median 8.3 s), 0 of 62 deaths within 3 s of spawning, bot hit rate 15.1%, 100 kills a minute. From a bot first picking the human as its target to the first hit took 1.4 s with the old skill and 2.3 s with the new one (to the kill 3.3 s and 5.5 s).
- Greybox (Phase 1, 8 bots): 143 kills in 3 minutes, 2,658 shots, 19.8% hit rate, 18% of hits on the head, 0.16 ms per tick.
- In the browser (`npm run shots`, one autopilot player and 31 bots on Kavren, about 40 s): 98 kills in the room, 7 kills and 3 deaths for the local player, hit markers and kill confirmations from the server.

### Server benchmark

`npm run bench` on an Apple M4 Pro (Node 24.12), the deathmatch on Kavren with culling, 30 s per run, network clients on the same machine. Each network client sends 30 inputs per second with random movement, sprint, crouch and jumps, and fires a third of the time; server bots are the real navmesh bots. "Poses held" is how many of the other ducks (31 with 32 clients, 23 with one client and the bots) a client has a pose entry for on average (the rest are culled). CPU is the whole server process (three rooms plus the lobby), tick time is per room.

| Rooms x (clients + bots) | Tick avg / p95 / max per room (ms) | Patch avg / p95 / max (ms) | Server CPU (% of 1 core) | RSS (MB) | Down per client (KB/s) | Up per client (KB/s) | Messages/s | Poses held / others | Visibility rays/s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 x (32 + 0) | 8.666 / 10.768 / 19.13 | 0.344 / 0.564 / 0.90 | 32.7 | 485 | 7.14 | 0.64 | 50.5 | 19.3 / 31.0 | 85790 |
| 1 x (1 + 23) | 3.733 / 5.987 / 9.47 | 0.191 / 0.494 / 1.14 | 15.1 | 386 | 4.17 | 0.64 | 58.4 | 12.8 / 23.0 | 2044 |
| 3 x (32 + 0) | 5.914 / 7.570 / 9.71 | 0.236 / 0.369 / 0.98 | 62.1 | 585 | 7.17 | 0.64 | 61.4 | 20.0 / 31.0 | 246944 |
| 3 x (1 + 23) | 2.463 / 4.830 / 6.27 | 0.092 / 0.286 / 0.48 | 26.1 | 476 | 4.44 | 0.64 | 59.4 | 14.0 / 23.0 | 5824 |

The table is from the softer deathmatch bots and spawn protection (24 ducks per room, so 1 human plays with 23 bots). The rows before that change, with 32 ducks per room: 32 clients 9.184 / 10.878 / 11.66 ms tick, 1 client plus 31 bots 3.849 / 7.121 / 9.05 ms, three rooms of 32 clients 6.002 / 7.240 / 8.88 ms, three rooms of 1 plus 31 bots 2.742 / 6.108 / 8.19 ms.

- With `--no-interest` (culling still on, every visible duck at the full rate): 9.91 KB/s down per client at 32 humans, 6.43 KB/s with 1 human and 31 bots; the near/far split saves about 30%.
- The culling is the largest cost with many humans: 32 human viewers test about 1,000 pairs every 3 ticks (89,000 rays a second per room). It runs for a third of the viewers each tick; before that change the 32-human room had a 27.6 ms tick p95 (now 10.9 ms).
- Tick times on this Mac are pessimistic for light loads: the same 32-bot room costs 0.7 ms per tick in a tight loop but 3.4 ms when it wakes every 33 ms like the server (macOS moves a mostly idle process to slower cores and clocks), which is why one room shows a higher tick time than each of three. Measure on the target box before tuning the CapRover CPU limit.
- An empty room sleeps (no tick loop) until someone joins: 0 CPU.

Duck Plaza (`npm run bench:hub`, same machine, port 2594, after the navmeshes loaded): one plaza of 40 network clients (HUB.maxClients) walking, sprinting and jumping with random inputs, a quack every 5 s and a chat line every 10 s each; 30 s measured. The plaza has no combat, no bots and no culling rays: near poses (20 m) every tick, far ones (70 m) at 10 Hz, nothing beyond.

| Hub room | Tick avg / p95 / max (ms) | Patch avg / p95 (ms) | Server CPU (% of 1 core) | RSS (MB) | Down per client (KB/s) | Poses held per client |
| --- | --- | --- | --- | --- | --- | --- |
| 40 clients, crowding the spawn square | 3.375 / 5.316 / 10.24 | 1.079 / 1.837 | 21.0 | 433 | 9.97 | 38.9 of 39 |
| 40 clients, spread over the plaza | 4.044 / 6.204 / 9.27 | 0.952 / 1.995 | 22.7 | 421 | 7.27 | 32.7 of 39 |

A full plaza costs well under a full deathmatch room (1 x (32 + 0) above: 8.67 ms tick, 32.7 percent CPU) with 25 percent more players: no shots, hit checks or visibility rays, only the movement step and the poses. With a 30 m near radius instead of 20 m the crowded square cost 11.6 KB/s down per client.

Phase 1 numbers (greybox, 8 ducks per room, no culling, network bots only):

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
- One tick has 33 ms; a 32-player greybox room used about 2.6 ms of it. A CPU profile at 32 bots (Phase 0) showed the process idle 82% of the time, with socket writes and Rapier as the largest costs.
- Phone frame time is not measured yet; use `npm run dev:lan` and `?autopilot=1`.

### Battle royale

Measured on an Apple M4 Pro, Node 24.12, headless Chrome (WebGPU) at 1280x720. Headless Chrome is vsync capped at 60 fps, so every frame time below is 16.7 ms; the CPU time of our own frame (input, sim, scene update and render submit) is the useful number.

Two browsers in one battle royale (`npm run e2e:br`, no bots): map hash `2dc8f2ec` with 6,137 colliders and the sim scenario on the map are identical in Node and Chrome; neither client gets the other's pose while in the plane; both jump, glide to the village, land, see each other, pick up 1 to 4 items; when B leaves, A gets the victory card.

Lobby rooms (`npm run e2e:lobby`, bots on, 10 s countdown, start rule pinned to 3 humans): a Node player creates a room and the lobby lists it as waiting for 2 more; Chrome sees it in the menu's live list (1/16, needs 2 more) and joins from there; the waiting room shows the roster and "Waiting for 1 more duck"; a second Node player picks the room from the lobby list and joins, the countdown starts (listed and shown in game); when it ends, 13 bots fill the seats, the match starts with 3 humans, the room is listed as in progress and a late join by id is refused.

A full match in the browser (`npm run perf:br`: one autopilot client aimed at the village, 15 navmesh bots, the client was knocked out on foot and then watched):

| Stage | CPU per frame avg / p95 (ms) | Draw calls avg / max | Triangles avg / max | Enemy ducks drawn avg / max |
| --- | --- | --- | --- | --- |
| Plane | 1.55 / 1.80 | 92 / 99 | 108k / 110k | 0.0 / 0 |
| Freefall | 1.90 / 2.70 | 124 / 142 | 164k / 208k | 6.0 / 10 |
| Glide | 2.33 / 2.70 | 151 / 156 | 219k / 258k | 11.8 / 12 |
| On foot | 2.03 / 3.00 | 118 / 147 | 217k / 264k | 4.3 / 12 |

Measured after the detailed houses landed (27 houses with full interiors instead of 37 plain ones; the duck survived this run, so there is no watching stage). The same run before the change on the same machine: on foot 1.81 / 6.50 ms, 110 / 148 calls, 147k / 216k triangles; glide 1.99 / 2.30 ms, 135 / 141 calls, 183k / 218k triangles. `npm run perf:map` (16 ducks in the square) before and after: street 215 / 319 to 216 / 320 calls, 377k / 611k to 400k / 640k triangles, CPU 3.27 to 2.68 ms; village square turn 230 to 231 calls, 392k to 415k triangles. Draw calls do not change (same prop types, instanced per type and LOD); the houses add about 5 percent triangles inside 60 m.

The map alone (`npm run perf:map`, no ducks) draws 83 to 117 calls and 104k to 159k triangles at 1.4 to 2.0 ms CPU per frame; the rest is ducks (about 9k triangles and 3 to 7 calls each near the camera). The glide over the village with ten gliders in view is the heaviest moment, a little over the 150-call target.

Headless 16-bot matches (`apps/server/bench/brHeadless.ts`, the test in `apps/server/test/br.test.ts` runs seed 7), after the faster tempo (220 m first circle, zone closed 5.5 minutes after the plane starts, the plane over the first circle) and the fast bot drop:

| Seed | Duration (s) | Last duck landed (s) | Gun kills | Zone deaths | Pickups | Tick avg / p95 (ms) | ms per bot per tick |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 212 | 23.5 | 15 | 0 | 98 | 0.185 / 0.647 | 0.0115 |
| 2 | 151 | 25.0 | 15 | 0 | 91 | 0.206 / 0.508 | 0.0129 |
| 3 | 273 | 25.5 | 13 | 2 | 104 | 0.235 / 0.542 | 0.0147 |
| 4 | 263 | 20.5 | 15 | 0 | 93 | 0.127 / 0.444 | 0.0079 |
| 5 | 249 | 23.5 | 15 | 0 | 84 | 0.143 / 0.486 | 0.0089 |
| 6 | 146 | 26.5 | 15 | 0 | 89 | 0.227 / 0.492 | 0.0142 |
| 7 | 151 | 23.0 | 15 | 0 | 82 | 0.199 / 0.576 | 0.0124 |
| 8 | 208 | 22.5 | 15 | 0 | 90 | 0.129 / 0.384 | 0.0081 |

Durations and landings count from the room lock (3 s of boarding first). Every match had exactly one winner and unique places 1 to 16, nobody landed in the sea. Bot thinking costs about 0.01 ms per bot per tick (the tick time includes all 16 sims). Before the change (zone closed after 10 minutes, bots braking over their spot for 30 to 50 s): 284 to 531 s per match on the same seeds, the last duck down about 60 s after the lock. A bot is on the ground about 9 s after it jumps (at most 12 to 16 s, before: 33 to 41 s median, up to 50 s) and finds its first gun a median 4 to 11 s after landing (per run, 4 seeds in `apps/server/test/brDrop.test.ts`; before: 5 to 19 s).

Server benchmark (`npm run bench:br`: 4 network clients plus 12 bots, 60 s after the drop):

| Clients + bots | Tick avg / p95 / max (ms) | Patch avg / p95 (ms) | Server CPU (% of 1 core) | RSS (MB) | Down per client (KB/s) | Up per client (KB/s) | Enemy poses received / enemies in the world | Visibility pairs / rays per second |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 4 + 12 | 0.921 / 1.876 / 13.60 | 0.107 / 0.354 | 4.8 | 339 | 2.71 | 0.56 | 7.8 / 12.3 | 493 / 2560 |

The row above is after the faster tempo and the fast bot drop (the ducks are on the ground and fighting inside the 220 m circle for the whole minute, hence more poses received and more bandwidth). Two more runs on the same machine, with other work running on it: 1.707 / 4.072 / 23.26 and 1.977 / 4.949 / 29.25 ms tick (8.6 and 10.4 percent CPU, 2.74 and 2.25 KB/s down); the max is a single outlier tick, the headless matches above never go past 3.3 ms in a tick. The row before it: 1.323 / 6.144 / 9.03 ms tick, 5.8 percent CPU, 2.05 KB/s down, 8.7 / 8.9 poses, 578 / 5,409 visibility pairs and rays per second. That one was after the detailed houses (6,137 colliders instead of 6,702). The same benchmark just before the change on the same machine: 2.205 / 5.417 / 7.44 ms tick, 9.1 percent CPU, 1.73 KB/s down, 2.4 / 10.0 poses, 600 / 3,696 visibility pairs and rays per second. Bench runs vary with how the bots meet: that run's ducks fought in the open more (8.7 of 8.9 enemies in sight on average), hence more poses and rays.

Team modes (`npm run bench:br -- 4 60 T`, the 4 clients fill teams together, same machine, one run each after the party and team change):

| Mode | Tick avg / p95 / max (ms) | Patch avg / p95 (ms) | Server CPU (% of 1 core) | RSS (MB) | Down per client (KB/s) | Poses received / ducks alive | Visibility pairs / rays per second |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Solo (16 x 1) | 2.949 / 4.950 / 10.40 | 0.201 / 0.364 | 11.8 | 380 | 1.80 | 2.8 / 11.4 | 600 / 3423 |
| Duo (8 x 2) | 3.184 / 5.452 / 8.70 | 0.217 / 0.387 | 12.7 | 380 | 1.89 | 4.9 / 10.3 | 560 / 3875 |
| Squad (4 x 4) | 2.913 / 5.663 / 11.41 | 0.199 / 0.356 | 11.7 | 391 | 1.83 | 5.0 / 12.2 | 480 / 3554 |

Teammates are always sent (no rays for them), so a client receives more poses in Duo and Squad and the visibility work per pair does not grow; tick times stay within run-to-run noise (bench runs vary with how the bots meet).

With the culling a client receives on average 3.3 of the 11 enemies alive, so a 16-duck battle royale costs 1.6 KB/s down per client (the deathmatch with 16 players: 5.6 KB/s). The visibility checks cost about 3,200 ray casts per second (about 2 microseconds each on this map).

### Hunt Season

`npm run bench:raid` on the same Apple M4 Pro (Node 24.12), Hunt Season v3 (the push with the katana) on Pond Keep. Headless: four katana bot ducks (`raid/duckBot.ts`: light combos, heavy spins, dashes and quacks through the human input path) push toward the objective with the default rules (hunter damage turned down so the run keeps going); packs keep coming up to the four-duck cap (`raid.maxLive`, 44); then a forced worst case of 50 hunters at once around the four ducks:

| Headless run | Raid tick avg / p95 / max (ms) | Most hunters alive | Sight rays per tick |
| --- | --- | --- | --- |
| The push, 4 katana bot ducks, 120 s (objective 2 reached) | 0.235 / 0.396 / 4.57 | 44 | 10.4 |
| 50 hunters at once around 4 katana bot ducks, 30 s | 0.322 / 0.483 / 1.17 | 50 | 12.5 |

Networked: a server process (port 2597, test hooks on), one raid room with 4 network clients at the first objective, the ducks held (no damage) so it keeps going, a horde of 44 around them, all four cutting with the katana (Fire taps, Dash, Quack), measured over 30 s; alone, and next to a deathmatch room with 1 client and its 23 navmesh bots. CPU is the whole process:

| Server with | Raid room tick avg / p95 / max (ms) | Patch avg / p95 (ms) | Server CPU (% of 1 core) | RSS (MB) | Down per client (KB/s) | Hunters alive (avg) |
| --- | --- | --- | --- | --- | --- | --- |
| Raid (4 katana clients, a horde of 44) | 1.828 / 2.995 / 9.08 | 0.383 / 0.541 | 10.5 | 444 | 9.65 | 32 (41 at the end) |
| Raid (4 katana clients, a horde of 44) + deathmatch (1 + 23 bots) | 1.646 / 2.909 / 4.81 | 0.292 / 0.466 | 23.0 | 416 | 9.60 | 37 (36 at the end) |

- Compared with v2 (30 hunters, wave 8, one duck at a cannon: headless 0.213 ms, networked 1.961 ms alone at 10.8% CPU and 1.287 ms next to a deathmatch room at 19.8%, 5.9 KB/s down): half again as many hunters for the same tick (earlier v3 runs: 2.158 and 1.883 alone, 1.456 and 1.486 next to the deathmatch room). Down per client grows with the horde (about 10 KB/s at 35 to 40 hunters: hunters are public room state, sent every tick). The katana's hits cost little: a swing sweeps the lag compensated hunter history inside its reach and casts one ray per hunter in its shape.
- Hunters are kinematic navmesh movers (no character controller), see only every third tick and are sent to everyone without culling (the co-op rule), so a full run costs a fraction of a deathmatch room. The networked tick includes the 4 ducks' sim steps, the state writes and the macOS light-load effect noted above.
- An empty raid room sleeps (no tick loop) and disposes when its last client leaves.
- `npm run bench` after Hunt Season v1 (same machine): 1 x (32 + 0) 9.175 / 10.821 / 11.65 ms, 1 x (1 + 23) 3.498 / 6.253 / 8.36, 3 x (32 + 0) 6.261 / 7.278 / 8.38, 3 x (1 + 23) 2.696 / 5.454 / 8.03; after v2 (the keep checks in the duck sim step): 9.358 / 10.778 / 11.39, 3.632 / 6.259 / 9.99, 6.294 / 7.969 / 8.43, 2.538 / 6.483 / 7.73; after v3 (the katana branch and the ground snag retry in the duck sim step): 8.845 / 10.469 / 11.69, 4.215 / 7.664 / 10.56, 6.268 / 7.352 / 8.37, 2.834 / 6.387 / 8.85 (a first v3 run, before the retry was limited to ground contacts: 9.756, 3.993, 6.254, 2.692). The 32-client and three-room rows are unchanged; the one-room bot row moves with how the bots meet (8.3 enemy poses held per client in this run, 12.9 in the first), 3.5 to 4.2 ms across runs.

Client frame pacing (`npm run perf:raid`, headless Chrome with WebGPU on the same machine, the alt test bundle, one duck on the dev autopilot, 40 s per stage; the peak holds the duck in the field with a horde of 44 topped up around it, the four-duck peak on one screen):

| Stage | Hunters drawn | Frame p50 / p95 / p99 / max (ms) | Long tasks | Our CPU per frame avg / p95 (ms) | Patches/s, bytes avg / p95 | Server stamp gap p95 (ms) | Corrections | Hunter stall / jump frames | Server tick avg / p95 / max (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Opening (out of the castle into the first packs) | 17 | 16.7 / 16.8 / 16.8 / 16.8 | 0 | 2.9 / 3.6 | 30.1, 106 / 175 | 36.0 | 0 | 0.47% / 0.95% | 0.48 / 0.87 / 7.2 |
| Peak, 44 hunters | 42 | 16.7 / 16.7 / 16.8 / 16.8 | 0 | 4.6 / 6.7 | 30.1, 269 / 581 | 35.0 | 0 | 0.96% / 0.49% | 0.68 / 1.48 / 3.3 |

- The hitching hunt (before v3, the same harness): frames were already smooth at 60 fps (no long tasks, 0 corrections, patches at an even 30 a second), the peak of v2's wave 9 (14 to 24 hunters) had single frames of 33 to 117 ms, and a v3 horde first spiked to 200 ms frames when a pack's looks were cloned in one frame. Three real causes, all fixed: (1) the duck sim: Rapier's controller clipped a grounded step that touched the ground at a near-zero time of impact, so a running duck stopped dead for one tick (0.87% of steps in the courtyard, 0.47% on the island); `moveCapsule` retries such a step (0.16% and 0.13%, the rest are real wall contacts); (2) the client: a new hunter look was a skinned model cloned on the frame it appeared; looks are now made ahead (one a frame) and pooled, far hunters animate at a lower rate and only the LOD on show stays in the scene graph; (3) the game: the v2 waves left long stretches of waiting behind the gate while hunters hammered it, which read as the game stalling; v3 sends the fight to the ducks.
- With the page's CPU slowed 4 times (`THROTTLE=4`, a phone or an older laptop): the peak runs at 30 to 60 fps, our CPU 13.8 ms a frame (p95 23.5; before hunters off screen animated at an eighth of the rate and far hunters stopped re-turning their spines between mixer updates: 15.6 ms), with a few long tasks when the test hook tops a horde up past the look pool (a real pack takes pooled looks). A CPU profile puts the matrix updates of about 1,500 bones (42 hunters) and the render submission on top; the static scene is small (824 objects in the opening, 2,654 at the peak).
- The Vite dev server (`npm run dev`, `DEV=1`) measures the same as the production build once loaded: opening 3.1 ms a frame, peak 4.9 ms on both, no long tasks.

Animation smoothness (`npm run anim:raid`, the same machine; pops per second: frames where a bone in the duck's own frame jumps over 3 times as far as in the frames around it):

| Move | Hand pops /s before / after | Foot pops /s before / after | Hips and head pops /s before / after |
| --- | --- | --- | --- |
| Run, katana out | 0.40 / 0.20 | 0.00 / 0.00 | 0.00 / 0.00 |
| Run + light combo taps | 3.17 / 0.00 to 1.34 | 1.17 / 0.00 to 0.17 | 2.33 / 0.00 |
| Stand + light combo taps | 2.33 / 0.00 | 2.00 / 0.00 | 2.33 / 0.50 |
| Sprint + light combo taps | 3.18 / 0.17 to 0.67 | 2.01 / 0.00 | 2.34 / 0.00 |

Before: a new swing snapped in at full weight (the finisher into the next combo's first cut moved the hand 31 cm and the hips 9 cm in one frame), every swing took the legs out of the run and back (feet popping and sliding), and the katana's idle and running arms switched at 3 m/s out of step with the legs. After: eased crossfades, swings on the upper body over the running legs while moving, the running arms in step with the run (details in `docs/hunt-season.md`, Client). What is left are the art's fastest impact frames and the finisher's recovery rising out of its crouch.

### Phones (emulated)

`npm run perf:mobile` on the same Apple M4 Pro: headless Chrome as a landscape phone (844 x 390, device scale 3, so 1266 x 585 render pixels at the 1.5 cap), touch and a coarse pointer, CPU throttled 4x through the DevTools protocol. The GPU is the desktop's, so this measures the main thread side of a phone frame; frame time is vsync capped at 16.7 ms, CPU per frame is the useful number. Before: the High preset with shadows (the old default); after: the Low preset phones now start on (shorter draw distances, no shadow map).

| Stage | Before: CPU avg / p95 max (ms) | Before: calls avg, triangles avg | After: CPU avg / p95 max (ms) | After: calls avg, triangles avg |
| --- | --- | --- | --- | --- |
| Deathmatch (24 ducks with bots) | 5.77 / 20.20 | 85, 167k | 5.46 / 16.30 | 100, 156k |
| Royale plane | 3.22 / 5.20 | 93, 113k | 2.27 / 3.70 | 82, 110k |
| Royale freefall | 5.65 / 11.20 | 143, 183k | 3.90 / 12.10 | 93, 122k |
| Royale glide | 6.90 / 9.30 | 183, 279k | 4.96 / 7.80 | 142, 216k |
| Royale on foot | 6.01 / 9.60 | 131, 190k | 4.38 / 7.90 | 114, 156k |

Each run follows its own autopilot path, so draw calls differ a little between runs (the deathmatch walked through busier streets in the second run). Every stage held 60 fps in the emulator. Real phones still need a check on the device (GPU fill rate, thermal throttling, Safari's WebGPU or WebGL2 path).

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
| Aim down sights | `ADS` in `constants.ts` (ramp, spread, recoil, speed), arm, zoom, kick and shake in `CAMERA` (see Weapons) |

## Art and animation

The art workstream (`art/`) publishes into `apps/client/public/models/`; the game picks the files up when they exist and falls back to greybox otherwise (`?duck=placeholder` forces the primitive duck):

- `duck.glb`: skinned toon duck (the classic character), used at its authored size (meters), turned to face -z. It gets the art's toon recipe in the engine: two-band toon shading with the shadow tint `#d9a6a0`, and a 7.5 mm inverted-hull outline in `#151619` that follows the skinning. Toski uses the same thin 7.5 mm visual outline, without changing the hitboxes. Both outlines remain visible up to 75 m; shadows stop at 35 m.
- `duck_<key>.glb` (today `duck_mallard.glb`): every other character (`packages/shared/src/characters.ts`), same contract as `duck.glb` and exactly its skeleton (joint names, order and bind pose), so `duck_anims.glb` and `weapons/attach.json` fit it unchanged; accessories stay inside the classic duck's silhouette, so the shared hitboxes fit (`art/blender/validate_glb.py` and `apps/client/test/characterModels.test.ts` check both). The game loads a character's model once, when a duck wearing it joins (`loadDuckGlb(character)` in `player/duckModel.ts`); a failed request keeps the primitive Qwakk-shaped placeholder and retries after 5 seconds, rather than caching the failure. The menu keeps the selected character's static portrait visible until its 3D model loads successfully.
- `duck_anims.glb`: the clips. Locomotion clips drive the hips and legs (8-way blend of walk and run by the direction of travel, sprint, crouch, jump, fall, land) with `timeScale = speed / authored speed`. The upper body (Spine and everything below it) plays `Rifle_Aim` or `Pistol_Aim` blended into `Rifle_ADS` or `Pistol_ADS` by the aim (the local camera's aim blend, or pose action 4 for others), or the reload or `Equip` while they run. The reload clips are as long as the server's reloads (rifle 2.3 s, pistol 1.6 s) and are stretched to them anyway; they start on the reload action (predicted for the local duck, from the pose for others). `Death_A` or `Death_B` take over the whole body. `Quack` opens the bill on a kill. Then procedural layers: spine, neck and head follow the camera pitch, a recoil kick on each shot, and two-bone IK puts the left hand on the gun's `Support` node.
- `weapons/rifle.glb`, `weapons/pistol.glb`, `weapons/attach.json`: the gun rides the `RightHand` bone at the attach pose; tracers and flashes start at its `Muzzle` node. Guns get toon shading but no outline hull (hard edges would crack it).
- Reloads move a real magazine: the gun's `Mag` child node. `attach.json` `reload.rifle` and `reload.pistol` give the clip's timeline in seconds (`out`: the magazine leaves the gun, into the left hand for the rifle, falling free for the pistol; `drop`: the old one leaves the hand and falls; `fresh`: a new one appears in the left hand at the hip pouch; `in`: it is seated) and the magazine's pose in the `LeftHand` joint (`magInHand`). `reloadMag.ts` re-parents the node at those moments (keeping its world pose, then easing into place), drops a toon copy that falls, lands at the duck's feet and shrinks away, and the clicks play on the events. Guns without a `Mag` node or a timeline reload without it. While the reload clip runs, the left-hand IK eases off so the clip's hand reaches the magazine.

- `crates/crates.glb` (`art/map/blender/crates_open.py`, uncompressed): the openable loot crates, nodes `small_body`, `large_body`, `ammo_body` (open top, a straw bed inside) each with a `<variant>_lid` child whose translation is the hinge at the back top edge (glTF -z side); the game swings the lid around its local X. Sizes and colors match the `crate_small`, `crate_large` and `ammo_box` props, whose colliders stay in the map.

Without clips, a procedural pose takes over (leg swing, crouch, both hands on the gun by IK). Every sound is synthesized in code (`LICENSES.md`).

### Hunters (raid enemies)

`hunters/` holds the co-op raid's enemies, built by `art/hunters/` (`sh art/hunters/build.sh`; the full contract is `art/hunters/README.md`, the numbers are in `hunters/hunters.json`). Wired into Hunt Season: `apps/client/src/game/raid/hunterAssets.ts` loads them once per page (toon recipe and outline like the ducks, the effects and the held decoy attached to their joints, LODs by distance), `hunterView.ts` plays the clips in two layers (body clips under Aim, Fire, Reload and Throw, split at `Spine`; the aim pitch on `Spine2`), and greybox hunters stand in until they load or if a file is missing. The hitbox numbers are copied into `packages/shared/src/raid/hunters.ts`: keep them in sync with the art.

- `hunter_rifleman.glb`, `hunter_trapper.glb`, `hunter_decoy.glb`, `hunter_boss.glb`: one shared 33-joint skeleton (armature `HunterRig`, root joint `Root`), skinned `LOD0`/`LOD1`/`LOD2` meshes (under 4k / 1.5k triangles), material `Hunter`, facing +Z in meters like the ducks. About 1.8 m tall; the boss is the same rig with `Root` scaled 1.24 (2.4 m to the hat crown). Tracers start at the `Muzzle` node, name tags at `HeadTop`.
- `hunter_anims.glb`: `Idle`, `Walk` (1.4 m/s), `Run` (3.6 m/s), `Aim`, `Aim_Up`, `Aim_Down`, `Fire`, `Reload`, `Throw`, `Hit`, `Defeat`, `Defeat_Dizzy`, `Taunt`, `Whistle` (full-body and upper-body layers, events in the manifest). The toony defeat pops the hat off and shows stars and a dust poof from `hunter_fx.glb` attached to the hidden `FxStars`/`FxPoof` joints (node scale 0 until a clip scales them up).
- `dog.glb` (its own rig and clips: `Idle`, `Run`, `Bite`, `Hit`, `Defeat`, `Defeat_Dizzy`), `decoy.glb` (the thrown wooden decoy), `trap.glb` (`Open`, `Sprung`).
- Hitboxes follow the duck's style (a head sphere plus a vertical body capsule per pose, measured from the meshes): see the tables in `art/hunters/README.md`.
- Horde minions for the melee waves, on the same skeleton and clips: `hunter_beater.glb` (a lanky villager with a pot helmet and a big wooden spoon) and `hunter_recruit.glb` (a kid-sized hunter, `Root` scale 0.72, with an oversized cap and a butterfly net), under 2,000 triangles at LOD0, flagged `"minion": true` in `hunters.json`. New clips for every hunter look: `Charge` (4.2 m/s), `Bonk` (event `hit`), `Stagger`, `Launched` (event `ground`, ends lying down) and `Get_Up`.

### Melee (Hunt Season)

`melee/` holds the duck's katana kit, built by `art/melee/` (`sh art/melee/build.sh`; the full contract, with the clip table, events, attach poses and hit arcs, is `art/melee/README.md`, the numbers are in `melee/melee.json`). Wired into Hunt Season: `apps/client/src/player/meleeArt.ts` loads the kit once, `meleeRig.ts` attaches the katana and the scabbard and layers the clips over the locomotion from the sim's pose action, `katanaTrail.ts` draws the trail between `TrailStart` and `TrailEnd`, `game/raid/bladeFeel.ts` places the `SlashArc`, `Shockwave` and `Feather` effects; greybox swings stand in while it loads or if a file is missing. The swing timings in `packages/shared/src/raid/blade.ts` (`BLADE`, `DASH`) come from the clip events at 30 Hz; the sim's dash is 4.5 m (the clip's own 3.0 m reads fine stretched) and the server's hit shapes (`raid/arc.ts`) are a little more generous than the art's arcs.

- `katana.glb`: `Katana` (origin at the grip, blade +Y, edge -Z) with the `Blade` mesh and the `Grip`, `TrailStart`, `TrailEnd` and `Tip` empties; `Scabbard` with its `KatanaSeat` empty. The katana rides `RightHand`, the scabbard `Spine1` (diagonally across the back), at the poses in `melee.json` `attach`.
- `duck_melee_anims.glb`: the classic duck's bones, a separate file next to `duck_anims.glb` (which is unchanged): `Katana_Idle`, `Katana_Run` (upper), `Slash_1`, `Slash_2`, `Slash_3` (a 3-hit combo with impact, combo window and recover events), `Heavy_Charge`, `Heavy_Release` (a 360 degree spin), `Dash` (no root motion: the sim moves the duck 3.0 m along `melee.json` `dash.progress`), `Quack_Shockwave`, `Ultimate`, `Ultimate_Spin`, `Draw` and `Sheathe` (upper; the katana moves between the hand and `KatanaSeat` at their `grab` and `release` events).
- `melee_fx.glb`: `SlashArc`, `Shockwave`, `EliteRing` (additive glow ribbons, the ramp in vertex colors) and the `Feather` XP pickup.
- Checks: `python3 art/melee/validate.py` and `node art/melee/tools/load_test.mjs` (three.js playback, the attach pose and the draw and sheathe hand-overs).

## Known issues

- Player collision is server-only (see above), so bumping into another duck gives a small correction.
- Bots on the navmesh steer directly while it builds on a cold cache (first start after a map change): about a minute for Yelova, a few seconds for Kavren. Greybox deathmatch bots steer by ray casts and can get stuck on complex geometry for a moment. Once in about a dozen 10-minute headless runs on Yelova a deathmatch bot stayed stuck for a while despite the walk-off recovery (not seen on Kavren).
- Battle royale bots do not use vertical cover on purpose and can bump into each other while looting. Matches with 16 bots last 5 to 9 minutes, a little short of the 8 to 12 minute plan, because many fights happen right after landing.
- A crate that was opened while you could not see it swings open when you next see it (the client cannot tell an old opening from a new one without learning when it happened).
- The inventory screen has no drag and drop; every action is a button.
- The anti-wallhack culling has no field-of-view test (a fast 180 degree turn would show pop-in), and a duck you cannot see can still be heard (direction only). Bushes do not count as walls for the culling (a duck in a bush is sent; it is hidden by the bush itself).
- LOD switches on props are hard cuts; far hedgerows look chunky from the plane.
- Going back to the menu and starting a new game keeps a few GPU buffers of the previous one (the scene is replaced, not every geometry is disposed).
- The shot effects of other players use their drawn gun as the start point, so a tracer can start a few centimeters off the server's line.
- Crouched ducks' heads reach 1.30 m but the crouched movement capsule is 1.15 m, so under a low overhang the head can clip into the geometry (the hitbox still follows the visual head).
- Under packet loss on WebSocket (TCP), downstream stalls make remote players hitch (the interpolation buffer runs dry). WebTransport with unreliable delivery, or an adaptive interpolation delay, is the planned fix.
- After a pause longer than about 0.2 s (a hidden tab), the server's stand-in steps differ from what the client predicted, so the duck gets one smoothed correction on return.
- The client bundle is about 2 MB gzip, mostly Rapier (its WASM is inlined as base64 in the compat build) and Three.js.
- Rapier's character controller sometimes refuses to move off the ground it rests on; the sim retries from 4 mm up (see `sim.ts`), which fixed every case seen in a 12,000-step scan. A second case (Hunt Season's hitch hunt): a grounded step that hits the ground at a near-zero time of impact is clipped to almost nothing, so a walking duck stopped for one tick (on Pond Keep's courtyard 0.87% of steps); `moveCapsule` now also retries such a step from the same lift, only when everything the controller touched is walkable ground (never a wall or a face past the slope limit) and only when the retry goes further without climbing (0.16%, the rest are real wall contacts; a duck sprinting into a 55 or 70 degree face rises a few centimeters a minute at most, as before, `sim.test.ts`; a wall-pushing duck costs one controller call a step, as before).
- Rapier's autostep does not fire at walking or crouching speed on 0.27 m stair treads, and the wall clip in `moveCapsule` used to treat climbing a slope as a wall hit (with stop-speed friction a walking duck went up a 36 degree ramp at 0.2 m/s, a crouched one at 0.1). The clip now skips steps where the controller lifts a grounded duck, and house stairs use one ramp collider per flight under the visual steps: 4 m of stairs take 1.3 s sprinting, 1.7 s running, 3.7 s walking, 4.3 s crouched (`sim.test.ts`, `houses.test.ts`).
- Touch controls are checked under Chrome's phone emulation (real touch events, several fingers), not yet on a real iPhone or Android phone. iPhone Safari cannot go fullscreen or lock the orientation for a page: the address bar can show, and turning the phone shows the rotate screen until it is back in landscape.
- Knocked ducks are drawn crouched with the gun away and a sway, not lying down: the hitbox stays the crouched one, so the drawing matches it. A crawl clip from the art workstream would need a matching low hitbox.
- Teammates do not jump out of the plane together; each picks its own moment (bots their own landing spot).
- A Duo or Squad Quick Play while the only battle royale room (`BR.maxRooms` 1 at launch) is a Solo room in its warm-up cannot open a second room: the party gets the rooms-full message until it ends.
- A full deathmatch room is a bloodbath: 32 ducks on 162 x 162 m score about 3.7 kills a second with bots, and ducks that spawn at the same moment (a round start) can see each other at once.
- The deathmatch rooms are created once per server process with fixed ids: run a single server instance (more replicas would each open their own copies of the same rooms).


## Languages and continuation checks

The game supports English and Turkish. Use the language selector in the menu header.
On first visit the browser language decides; the selection is saved as `qwakk.language`.
`?lang=tr` and `?lang=en` explicitly select and save a language. This also works when
storage is unavailable (the query keeps the current choice). Switching reloads the menu;
character, identity and gameplay settings remain saved. Player names, place names and
operator-written notices are displayed as written.

Menu and touch copy: `apps/client/src/ui/menu/copy.en.ts` and `copy.tr.ts`.
In-game copy and formatting: `apps/client/src/i18n/game.ts`. The menu keeps its lazy game
import. The admin panel currently uses English.

Additional checks (Chrome and the local test PostgreSQL for the admin check):

- `npm run e2e:admin -- /tmp/qwakk-admin`: real 2FA login, all admin pages, settings across a server restart, origin checks, public banner, session invalidation and logout. Uses a throwaway database and generated test credentials.
- `npm run e2e:localization -- /tmp/qwakk-language`: browser language, language switch and reload, mobile layout, failed character model recovery, and a Turkish deathmatch HUD.
- `npm run shots:characters -- /tmp/qwakk-characters`: nine controlled game-renderer comparisons, two helmet levels and a contrast report. See `docs/character-readability.md` for the method and limits.

When local dev already occupies 2567/5173, build a separate test endpoint with
`VITE_GAME_SERVER=ws://localhost:2589 npm run build:test`, then run the game e2es with
`E2E_SERVER_PORT=2589 E2E_WEB_PORT=5189 npm run e2e`. The normal production build
uses the hosting origin and needs no endpoint override.

## Credits

Qwakk Island is built on these open-source projects and kits. Thank you to their authors. Asset sources (all made for Qwakk) and the font licenses are in [LICENSES.md](LICENSES.md).

| Project | Used for | License |
| --- | --- | --- |
| [Three.js](https://threejs.org) 0.186 | Rendering in the client (WebGPU with a WebGL2 fallback) | MIT |
| [Rapier](https://rapier.rs) (`@dimforge/rapier3d-compat` 0.21) | Physics on the client and the server | Apache-2.0 |
| [Colyseus](https://colyseus.io) 0.18 (`@colyseus/core`, `ws-transport`, `sdk`, `schema`) | Game rooms, state sync, client prediction helpers | MIT |
| [recast-navigation](https://github.com/isaac-mason/recast-navigation-js) 0.43 | Bot navmesh on the server | MIT |
| [postgres](https://github.com/porsager/postgres) 3.4 | Database client | Unlicense |
| [Nodemailer](https://nodemailer.com) 10 | Sign-in code emails | MIT-0 |
| [Geist and Geist Mono](https://vercel.com/font) (`@fontsource-variable` 5.3) | Menu and admin fonts | SIL OFL 1.1 |
| [Vite](https://vite.dev) 8 | Client build and dev server | MIT |
| [TypeScript](https://www.typescriptlang.org), [Vitest](https://vitest.dev), [Playwright](https://playwright.dev) | Types, unit tests, browser tests | Apache-2.0, MIT, Apache-2.0 |
| [create-qorechain-dapp](https://github.com/qorechain/qorechain-sdk) 0.14.0 (`fullstack-web` template) | Starting point of the Duck Pass checker (`duck-pass/`) | Apache-2.0 |
| [@qorechain/sdk](https://github.com/qorechain/qorechain-sdk) 0.14.0 | The checker's chain reads and signer address check | Apache-2.0 |
| `@qorechain/qorex-types` 0.1.0 | The menu's QoreX calls for Duck Pass | Apache-2.0 |
| React 18, Vite 5, `@vitejs/plugin-react` | The Duck Pass checker page | MIT |

The files `duck-pass/` kept from the create-qorechain-dapp template (Vite setup, the `/lcd` proxy, the `.env` layout) stay under that template's Apache-2.0 license; `duck-pass/README.md` lists what was kept and what was replaced. Duck Pass also relies on the player's own QoreX wallet, which signs and broadcasts the proof; no QoreX code is included here.

Tools that ship nothing into the game: Blender runs our own Python scripts that build every model, map and texture (`art/`), and Claude Code (Anthropic) agents wrote much of the code, the art scripts and the docs under the builder's direction ([AI_USAGE.md](AI_USAGE.md)). Apart from the create-qorechain-dapp starter above, no templates, asset packs or other games were copied.

## License

The source code is MIT, see [LICENSE](LICENSE). The Qwakk name, logo, characters, art, models and maps are not: all rights reserved, see [NOTICE.md](NOTICE.md). Forks must use their own name and art. Asset sources and third-party licenses are listed in [LICENSES.md](LICENSES.md).

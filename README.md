# Qwakk game

A browser third-person shooter with ducks, planned to live at `qwakk.fun/game`. This repo is at **Phase 1**: an 8-player deathmatch slice. Players and server bots fight in a town on a greybox island with a rifle and a pistol: CS-style gunplay, server-authoritative hits with lag compensation, client-side prediction of movement and shooting, and toon ducks with animations from the art workstream.

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
    src/net/schema.ts  Colyseus Schema 5 state, quantized poses, input and message ids
    test/              Vitest: determinism, movement feel, weapons, spread, hitscan, wall-blocked muzzle
  apps/server/       Colyseus 0.18 game server (Node 24, runs the .ts sources directly)
    src/IslandRoom.ts  Networking glue: joins, inputs, patches, views, messages
    src/deathmatch.ts  Rules and authoritative combat: shots, damage, deaths, respawns, rounds, separation
    src/lagComp.ts     Hitbox history for lag compensation (rewind capped at 230 ms)
    src/bots.ts        Server bots: same input path as players, line of sight only
    src/interest.ts    Per-viewer near (30 Hz) and far (10 Hz) pose entries
    src/tickLoop.ts    Fixed-rate loop with exact tick deadlines
    src/inputPacer.ts  Which steps run each tick: real inputs, stand-ins, late inputs (unit tested)
    test/              Vitest: input pacer, rewind hit/miss, fire spam, headless 8-bot match
    bench/             Headless bots and the benchmark runner
  apps/client/       Vite + Three.js (three/webgpu, WebGL2 fallback), plain game loop
    src/game.ts        Frame loop: pump inputs, read predicted and interpolated poses, render
    src/net/           Session (prediction, poses, messages), far-pose interpolation, fake network
    src/game/          Combat feedback (predicted shots, hit markers, kill feed), autopilot, metrics
    src/fx/            Particles: feathers, dust, cartoon splats; tracers and muzzle flashes
    src/audio/         Synthesized sounds (WebAudio), 3D for other players
    src/hud/           Game HUD (crosshair, health, ammo, feed, scoreboard) and the debug HUD
    src/camera/        Over-the-shoulder spring-arm camera, recoil kick, shake, death camera
    src/player/        Duck avatar: clips, procedural layers, hand IK, weapons
    src/world/         Terrain, props and sea meshes
    public/models/     Art from the art workstream (duck, animations, weapons)
  e2e/two-clients.ts Two real headless browsers in one room
  e2e/pause-resume.ts Node client: input pauses and network stalls, must recover within 1 s
  e2e/firefight-shots.ts Screenshots of a firefight in headless Chrome
  scripts/dev.ts     Runs server and client together
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

Open http://localhost:5173/game/ and click to play. Bots fill the room up to 8 ducks; every human who joins replaces a bot. First to 25 kills or the most kills after 5 minutes wins the round, then a new round starts after 8 seconds.

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
| Tab | Scoreboard |
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
npm run e2e          # two headless Chrome clients in one room (build:test first)
npm run test:net     # pause and stall recovery against the real server
npm run bench        # server benchmark at 8, 16 and 32 bots (npm run bench -- 4 64 for other counts)
npm run shots -- DIR # screenshots of a firefight (build:test first)
```

Server environment switches: `QWAKK_BOTS=0` (no bots), `QWAKK_MAX_CLIENTS` (humans per room, default 8), `QWAKK_INTEREST=0` (every player at full rate), `QWAKK_SPECTATORS=1` (allow spectators).

## How the netcode works

- The client sends inputs only: move axes, buttons (including fire, reload, weapon slot and shoulder side), yaw, pitch, its tick estimate and the server time it is drawing other players at (`vt`, the rewind target). Colyseus numbers them (`room.input()`), the server acks them.
- The server owns position and velocity. Every input is sanitized (`sanitizeInputFields`: NaN, ranges, diagonal speed, unknown buttons, angles), turn rate is capped, the input buffer is capped (10), and an input credit (one per tick, burst of 8, spent by every simulated step) means a client can never run faster than the tick rate. WebSocket frames are capped at 1 KB and a client may send at most 300 messages per second, enough for the backlog after a stall of several seconds (inputs are one message per tick).
- The server runs at 30 Hz on its own loop with exact tick deadlines (`tickLoop.ts`) and sends one state patch right after each tick.
- The local player is predicted with the Colyseus 0.18 `Reconciler`: each input is simulated immediately with the shared sim, then checked against the server state when its ack arrives. The sim is bit-for-bit deterministic between Node and the browser (states are float32 on both sides, deterministic trig, inputs rounded to float32 before stepping), so in normal play the prediction never needs correcting. When a correction is needed, it is blended out over about 70 ms.
- Other players are sent as quantized poses (16-bit position and yaw, 8-bit pitch: about 9 bytes per update). Players within 35 m get the near entry every tick and are drawn 100 ms in the past with Colyseus `Predict` lerp plus a 30 ms output spring. Players beyond 42 m get the far entry at 10 Hz, drawn 180 ms behind with our own buffer (`farInterp.ts`: Predict's lerp treats a 100 ms cadence as idle gaps and stutters; the buffer handles real idle gaps itself, so a far duck that stood still starts moving when it does instead of gliding). A near/far switch is eased out over about 150 ms. The server decides per viewer which entry, if any, each client receives (StateView).
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
- Bots navigate by steering and ray casts, not a navmesh; they can get stuck on complex geometry for a moment (they pick a new goal after a second).
- The shot effects of other players use their drawn gun as the start point, so a tracer can start a few centimeters off the server's line.
- Crouched ducks' heads reach 1.30 m but the crouched movement capsule is 1.15 m, so under a low overhang the head can clip into the geometry (the hitbox still follows the visual head).
- Under packet loss on WebSocket (TCP), downstream stalls make remote players hitch (the interpolation buffer runs dry). WebTransport with unreliable delivery, or an adaptive interpolation delay, is the planned fix.
- After a pause longer than about 0.2 s (a hidden tab), the server's stand-in steps differ from what the client predicted, so the duck gets one smoothed correction on return.
- The client bundle is about 2 MB gzip, mostly Rapier (its WASM is inlined as base64 in the compat build) and Three.js.
- Rapier's character controller sometimes refuses to move off the ground it rests on; the sim retries from 4 mm up (see `sim.ts`), which fixed every case seen in a 12,000-step scan.
- No touch controls yet.

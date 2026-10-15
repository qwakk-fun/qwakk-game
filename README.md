# Qwakk game

A browser third-person shooter with ducks, planned to live at `qwakk.fun/game`. This repo is **Phase 0**: the foundation. Two or more browser tabs join one server-authoritative room and run around a greybox island together, with client-side prediction, server reconciliation and snapshot interpolation.

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
    src/net/schema.ts  Colyseus Schema 5 state and input definitions
    test/              Vitest: determinism, movement feel, input sanitizing
  apps/server/       Colyseus 0.18 game server (Node 24, runs the .ts sources directly)
    src/IslandRoom.ts  Authoritative 30 Hz room
    src/tickLoop.ts    Fixed-rate loop with exact tick deadlines
    src/inputPacer.ts  Which steps run each tick: real inputs, stand-ins, late inputs (unit tested)
    test/              Vitest: input pacer (pauses, stalls, bursts, speedhack bound)
    bench/             Headless bots and the benchmark runner
  apps/client/       Vite + Three.js (three/webgpu, WebGL2 fallback), plain game loop
    src/game.ts        Frame loop: pump inputs, read predicted and interpolated poses, render
    src/net/           Session (Colyseus prediction stack) and the fake-network simulator
    src/camera/        Over-the-shoulder spring-arm camera
    src/player/        Duck avatar (placeholder now, GLB hook)
    src/world/         Terrain, props and sea meshes
    public/models/     duck.glb goes here (loaded automatically when present)
  e2e/two-clients.ts Two real headless browsers in one room
  e2e/pause-resume.ts Node client: input pauses and network stalls, must recover within 1 s
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

Open http://localhost:5173/game/ in two tabs or two browsers and click to play. Each tab is a separate duck.

| Key | Action |
| --- | --- |
| Click | Lock the mouse and play (Esc to release) |
| WASD | Move |
| Shift | Sprint (forward) |
| Alt | Walk |
| C | Crouch (hold) |
| Space | Jump |
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
| `server=ws://host:2567` | Game server address (dev tools only; default: the page host on port 2567) |
| `pr=1` | Render scale cap (default 2 on desktop, 1.5 on touch devices) |
| `shadows=0` | Turn shadows off |
| `hud=0` | Start with the HUD hidden |
| `duck=placeholder` | Ignore `duck.glb` and use the primitive duck |
| `lerpsmooth=30` | Output smoothing for remote players in ms (0 turns it off) |

The fake network options, the N / J / L keys and the `window.__qwakk` test hook are dev tools: on with `npm run dev`, and on a production build only with `?devtools=1`.

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
npm test             # Vitest: shared sim and the server input pacer
npm run build        # typecheck, then the client production build in apps/client/dist
npm run e2e          # two headless Chrome clients in one room (build first)
npm run test:net     # pause and stall recovery against the real server
npm run bench        # server benchmark at 8, 16 and 32 bots (npm run bench -- 4 64 for other counts)
```

## How the netcode works

- The client sends inputs only: move axes, buttons, yaw, pitch and its tick estimate. Colyseus numbers them (`room.input()`), the server acks them.
- The server owns position and velocity. Every input is sanitized (`sanitizeInputFields`: NaN, ranges, diagonal speed, unknown buttons, angles), turn rate is capped, the input buffer is capped (10), and an input credit (one per tick, burst of 8, spent by every simulated step) means a client can never run faster than the tick rate. WebSocket frames are capped at 1 KB and a client may send at most 300 messages per second, enough for the backlog after a stall of several seconds (inputs are one message per tick).
- The server runs at 30 Hz on its own loop with exact tick deadlines (`tickLoop.ts`) and sends one state patch right after each tick.
- The local player is predicted with the Colyseus 0.18 `Reconciler`: each input is simulated immediately with the shared sim, then checked against the server state when its ack arrives. The sim is bit-for-bit deterministic between Node and the browser (states are float32 on both sides, deterministic trig, inputs rounded to float32 before stepping), so in normal play the prediction never needs correcting. When a correction is needed, it is blended out over about 70 ms.
- Remote players are drawn about 100 ms in the past with Colyseus `Predict` lerp interpolation, plus a 30 ms output spring.
- If a client's inputs stop arriving for more than 6 ticks (a TCP stall, a hidden tab, a lag switch), the server keeps simulating that player with stand-in steps: its last input for 10 ticks, then standing still. Nobody can freeze in mid-air by holding back packets. When inputs return, late ones (made during the stall, recognized by their tick stamp) are acked without a step because a stand-in already took their place; the first fresh input clears the rest. Recovery is immediate and always converges (`inputPacer.ts`, covered by `npm test` and `npm run test:net`).
- If the connection drops or the server kicks the client, the page shows "Disconnected" with a Reconnect button.
- Owner-only fields (velocity, sim timers) are tagged `.view()` in the schema, so other clients never receive them.
- Players do not collide with each other yet.

## Measured results

### Two clients in real browsers (e2e)

Two headless Chrome pages (WebGPU backend, 1280x720) on the same machine as the server, both on autopilot, 15 s per phase:

| Condition | Predicted local player | Remote player drawn | Corrections |
| --- | --- | --- | --- |
| No added latency | max drawn speed 7.1 to 7.7 m/s, 0 snap frames | max 7.1 to 7.5 m/s, 0 snap frames | 0 of about 450 reconciles |
| 120 ms round trip, +/- 10 ms jitter | max 7.2 to 7.7 m/s, 0 snap frames | max 7.4 to 9.0 m/s, 0 snap frames | 0 of about 450 reconciles |
| 150 ms, +/- 15 ms, 2% loss (stress) | 0 snap frames | 21 to 26 snap frames (TCP stalls) | 0 of about 300 |

The test also runs a fixed 600-tick, 6-player scenario in Node and in Chrome: the resulting state hashes are identical.

"Drawn speed" is the speed of what is actually rendered, sampled every frame. Sprint speed is 7 m/s, so a frame drawn above 11.2 m/s counts as a snap. Both pages held 60 fps (16.7 ms frames, vsync capped in headless Chrome, so this is not a GPU benchmark). The WebGL2 fallback was also rendered and checked with `?webgl=1`.

### Server benchmark

`npm run bench` on an Apple M4 Pro (Node 24.12), bots on the same machine, 30 s per run, each bot sending 30 inputs per second with random movement, sprint, crouch and jumps:

| Bots | Tick avg / p95 / max (ms) | Patch avg / p95 / max (ms) | Server CPU (% of 1 core) | RSS (MB) | Down per client (KB/s) | Up per client (KB/s) | Patches/s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 8 | 0.919 / 1.592 / 10.38 | 0.758 / 1.217 / 2.55 | 8.6 | 221 | 7.19 | 0.48 | 30.0 |
| 16 | 1.792 / 3.556 / 6.28 | 0.876 / 1.980 / 6.12 | 11.9 | 251 | 13.64 | 0.48 | 30.0 |
| 32 | 3.202 / 5.496 / 8.41 | 1.324 / 2.097 / 5.35 | 18.6 | 238 | 26.31 | 0.48 | 30.0 |

- One tick has 33 ms; a 32-player room uses about 3 ms of it on this machine. The movement sim alone is about 0.6 ms for 32 players in a tight loop; the rest is input handling, schema change tracking and timer overhead at low duty cycle. A CPU profile at 32 bots shows the process idle 82% of the time, with socket writes and Rapier as the largest costs.
- Bandwidth is WebSocket payload only (no TCP/IP overhead) and grows linearly: every client receives every player every tick. At 32 players that is about 26 KB/s down per client, above the plan's 10 KB/s target. Interest management (send far players at 10 Hz, hide them past a range) and tighter quantization are the planned fixes (Phase 2).
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

## Character model

`apps/client/public/models/duck.glb` is loaded automatically when it exists. The model is scaled to the player height, its feet are put on the ground and it is turned to face forward (-z). Every duck uses its own clone (`SkeletonUtils.clone`), ready for animations. Until then (or with `?duck=placeholder`) a primitive duck in brand yellow with an orange beak is drawn.

## Known issues

- Players pass through each other (no player collision yet).
- Under packet loss on WebSocket (TCP), downstream stalls make remote players hitch (the interpolation buffer runs dry). WebTransport with unreliable delivery, or an adaptive interpolation delay, is the planned fix.
- After a pause longer than about 0.2 s (a hidden tab), the server's stand-in steps differ from what the client predicted, so the duck gets one smoothed correction on return.
- The client bundle is about 2 MB gzip, mostly Rapier (its WASM is inlined as base64 in the compat build) and Three.js.
- Rapier's character controller sometimes refuses to move off the ground it rests on; the sim retries from 4 mm up (see `sim.ts`), which fixed every case seen in a 12,000-step scan.
- No touch controls yet.

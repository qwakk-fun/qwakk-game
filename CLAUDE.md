# qwakk-game

The Qwakk browser battle royale: a third-person shooter with ducks, planned for `qwakk.fun/game`. npm workspaces: `packages/shared` (pure sim), `apps/server` (Colyseus 0.18 on Node 24), `apps/client` (Vite + Three.js WebGPU). The full plan is `../GAME_PLAN.md`; the run, test and benchmark commands are in `README.md`.

Read this file before changing anything here. Agents start without the owner's conversation, so pass these rules on when you brief one.

## Workspace rules

- Git lives in this repo only. Never run git in the parent `qwakk/` folder. Commit or push only when the owner asks, using Conventional Commits. The GitHub repo (`qwakk-fun/qwakk-game`) and any remote need the owner's approval.
- Start dev servers only when asked or briefly to test, and stop every process you started, by its PID. Never use broad `pkill` patterns: the owner may be running `./dev.sh`. The owner's `./dev.sh` stack uses ports 3000, 3002, 4400 and 5438. This repo uses 5173 (client) and 2567 (server); the benchmark uses 2599 and `test:net` uses 2596.
- Ask before anything destructive or outward-facing: deleting files, deploying, DNS, CapRover or GitHub settings, external services.
- `art/` belongs to the art workstream (Blender scripts, renders). Do not edit it unless that is the task. `apps/client/public/models/duck.glb` is produced there.

## Product rules

- No crypto rewards in the game. The leaderboard is in-game stats only and is written only by the server.
- No em dashes in user-facing copy, metadata or docs. Use commas, colons, periods or parentheses.
- Brand colors: yellow `#ffd43b`, beak orange `#ff8a3d`, dark `#151619` (`apps/client/src/render/palette.ts`). Keep them in sync with the app and the landing.
- Do not use Synty assets (their EULA bans blockchain projects). Never put third-party token logos on loot.

## Netcode and anti-cheat rules

- The client sends inputs only: sequence (assigned by Colyseus), client tick, move axes, buttons, yaw and pitch. Never trust or accept positions, hits or any other result from a client.
- The server owns position, velocity, hits, damage, ammo, reloads, fire rate, inventory, loot, zone damage, kills and timers.
- Sanitize every input on the server (`sanitizeInputFields` via `defineInput({ sanitize })`), cap the turn rate, cap the input buffer and the message size, and rate-limit consumption with the input credit. Which steps run each tick (real inputs, stand-ins for late inputs, late inputs to skip) is decided only in `apps/server/src/inputPacer.ts`; keep it pure and keep its unit tests and `npm run test:net` passing. Add per-weapon fire-rate gates and per-IP connection and join limits when those features land.
- 30 Hz simulation, one patch per tick. Later: 10 Hz for far players and spatial interest management that also hides far enemies (anti-wallhack). Rewind cap 200 to 250 ms.
- TPS hit rule: a ray from the camera through the crosshair finds the aim point, then the server traces from the muzzle to that point. Hitboxes are simple server capsules (head sphere plus body capsule, stance aware), never skinned meshes.
- Owner-only state uses `.view()` schema fields plus a per-client `StateView`.

## Engineering rules

- `packages/shared` stays pure: no DOM, no network, no timers, no `Date.now()` or `Math.random()` in the sim. `step` functions take state, input and dt and mutate plain number fields. It must stay portable to a Rust/WASM kernel later.
- Determinism is a hard requirement. Client prediction only matches the server when both run the same sim on the same inputs from the same state:
  - Use `dsin`/`dcos` from `math.ts`, never `Math.sin`/`Math.cos`, in anything the sim or map generation computes.
  - The sim rounds its state to float32 every step (that is what the wire carries). Round replayed inputs to float32 on the client before stepping (`session.ts` does this).
  - Map generation uses only the seeded RNG and integer or exact float math. A test checks that `terrainHeightAt` matches the Rapier heightfield.
  - Run `npm test` after any sim change; the determinism tests must pass. The e2e test prints prediction corrections: they should be 0 without packet loss.
- Every tunable feel or netcode number lives in `packages/shared/src/constants.ts` (camera numbers in `apps/client/src/camera/tpsCamera.ts`).
- TypeScript is strict with `erasableSyntaxOnly` (no enums, no parameter properties, no namespaces), because the server runs `.ts` files directly on Node 24. Relative imports use the `.ts` extension. Schemas use the `schema()` API, not decorators.
- Use the Colyseus 0.18 built-ins (`defineInput`, `room.input()`, `Predict`, `Reconciler`, `allowRewindState`, `StateView`) unless measured behavior says otherwise, and write down why in the code when you replace one. Read the installed type definitions in `node_modules/@colyseus/*` instead of relying on memory; the 0.18 API differs from older versions.
- Known Colyseus traps found in Phase 0:
  - `setFixedTimestep` uses `setInterval(1000 / 30)`, which Node truncates to 33 ms, so some wake-ups run 0 or 2 ticks and remote players hitch. The room uses `tickLoop.ts` instead and sends one patch after each tick; the framework's own patch-timer calls to `broadcastPatch()` are ignored.
  - Keep `patchRate` at the real cadence (1000 / 30). It is advertised to clients, which size their input replay ring from it (a huge value runs the client out of memory). `patchRate = null` without a simulation interval starts a hidden 60 Hz clock ticker.
  - The client state object exists with default values before the first patch is decoded. Wait for `onStateChange` before reading it (the seed!).
  - Reconciler telemetry (`lastCorrection`, `drift`) is only computed when `warnOnDivergence` is set.
  - Taking an input from the buffer acks it. Never take an input you will not simulate, unless a stand-in step already took its place (see `inputPacer.ts`). Buffer overflow also acks dropped inputs.
  - Reliable inputs are one WebSocket message each, so `maxMessagesPerSecond` must leave room for the backlog after a stall, or recovering clients get kicked (code 4002).
- The fake network (`apps/client/src/net/netsim.ts`) must deliver strictly in order. One `setTimeout` per message is not enough: browsers round delays to whole milliseconds and can swap messages, which corrupts Colyseus' delta-encoded inputs and patches.
- No WASM threads or SharedArrayBuffer (no COOP/COEP headers needed).
- Keep modules small and readable. No giant single files.
- Before handing over a change: `npm run typecheck`, `npm test`, `npm run build`, and for netcode or rendering changes `npm run e2e` and `npm run test:net`. For server performance changes, `npm run bench` and update the table in `README.md`.

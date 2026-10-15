# qwakk-game

The Qwakk browser battle royale: a third-person shooter with ducks, planned for `qwakk.fun/game`. Current state: Phase 1, an 8-player deathmatch slice with bots. npm workspaces: `packages/shared` (pure sim), `apps/server` (Colyseus 0.18 on Node 24), `apps/client` (Vite + Three.js WebGPU). The full plan is `../GAME_PLAN.md`; the run, test and benchmark commands are in `README.md`.

Read this file before changing anything here. Agents start without the owner's conversation, so pass these rules on when you brief one.

## Workspace rules

- Git lives in this repo only. Never run git in the parent `qwakk/` folder. Commit or push only when the owner asks, using Conventional Commits. The GitHub repo (`qwakk-fun/qwakk-game`) and any remote need the owner's approval.
- Start dev servers only when asked or briefly to test, and stop every process you started, by its PID. Never use broad `pkill` patterns: the owner may be running `./dev.sh`. The owner's `./dev.sh` stack uses ports 3000, 3002, 4400 and 5438. This repo uses 5173 (client) and 2567 (server); the benchmark uses 2599 and `test:net` uses 2596.
- Ask before anything destructive or outward-facing: deleting files, deploying, DNS, CapRover or GitHub settings, external services.
- `art/` belongs to the art workstream (Blender scripts, renders). Do not edit it unless that is the task. It owns `apps/client/public/models/` (`duck.glb`, `duck_anims.glb`, `weapons/*`); code against the asset contract in `README.md` (Art and animation) and keep the greybox fallbacks working.

## Product rules

- No crypto rewards in the game. The leaderboard is in-game stats only and is written only by the server.
- No em dashes in user-facing copy, metadata or docs. Use commas, colons, periods or parentheses.
- Brand colors: yellow `#ffd43b`, beak orange `#ff8a3d`, dark `#151619` (`apps/client/src/render/palette.ts`). Keep them in sync with the app and the landing.
- Do not use Synty assets (their EULA bans blockchain projects). Never put third-party token logos on loot.
- Every third-party asset (sound, texture, model) gets a row in `LICENSES.md` before it lands. Today every sound is synthesized in code.
- Death effects stay toony (feathers, a cartoon splat), never gore.

## Netcode and anti-cheat rules

- The client sends inputs only: sequence (assigned by Colyseus), client tick, move axes, buttons (fire, reload, weapon slot, shoulder side included), yaw, pitch and view time `vt`. Never trust or accept positions, hits or any other result from a client.
- The server owns position, velocity, hits, damage, ammo, reloads, fire rate, inventory, loot, zone damage, kills and timers.
- Sanitize every input on the server (`sanitizeInputFields` via `defineInput({ sanitize })`), cap the turn rate, cap the input buffer and the message size, and rate-limit consumption with the input credit. Which steps run each tick (real inputs, stand-ins for late inputs, late inputs to skip) is decided only in `apps/server/src/inputPacer.ts`; keep it pure and keep its unit tests and `npm run test:net` passing. Fire-rate gates and ammo live in the shared weapon state machine (server copy decides). Add per-IP connection and join limits before public launch.
- 30 Hz simulation, one patch per tick. Interest management (`interest.ts`): near players every tick, far players at 10 Hz through per-viewer StateView entries; hiding far enemies entirely (anti-wallhack) comes with bigger maps. Rewind cap 230 ms (`COMBAT.maxRewindMs`).
- TPS hit rule (`packages/shared/src/shot.ts`): a ray from the camera through the crosshair finds the aim point, then the server traces from the muzzle to that point; a wall in front of the muzzle stops the shot. Hitboxes (`hitbox.ts`) are a head sphere plus a body capsule per stance, never skinned meshes, and they follow the visual duck, not the movement capsule. Keep them in sync with the art when the duck changes.
- Weapons are part of the shared sim (`combat.ts`, numbers in `weapons.ts`): fire rate, ammo, reloads and switching are decided by the server's copy. The client predicts shots for feedback only; damage and kills come from the server, never predicted.
- Lag compensation uses our own history (`apps/server/src/lagComp.ts`). The shooter's `vt` is client-chosen, so it is bounded by the round trip the SERVER measures (`rttProbe.ts`, WebSocket ping frames) plus interpolation delay and a margin, and by the 230 ms cap (`Deathmatch.maxRewindFor`). Bots never rewind.
- Spread trade-off: the spray PATTERN is deterministic and predicted; the RANDOM part of the spread is seeded with a per-round server secret (`spreadSeed`), so it cannot be predicted or cancelled by a cheat. The client predicts its tracer and hit marker with a local guess; the server's shot is authoritative and is what other players see. Do not send the secret to clients.
- Bots (`bots.ts`) act only through input frames on the same path as players and see only what is in line of sight. No wallhack, no aimbot.
- Stand-in steps (a stalled player) never fire.
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
- Known Colyseus traps found so far:
  - `setFixedTimestep` uses `setInterval(1000 / 30)`, which Node truncates to 33 ms, so some wake-ups run 0 or 2 ticks and remote players hitch. The room uses `tickLoop.ts` instead and sends one patch after each tick; the framework's own patch-timer calls to `broadcastPatch()` are ignored.
  - Keep `patchRate` at the real cadence (1000 / 30). It is advertised to clients, which size their input replay ring from it (a huge value runs the client out of memory). `patchRate = null` without a simulation interval starts a hidden 60 Hz clock ticker.
  - The client state object exists with default values before the first patch is decoded. Wait for `onStateChange` before reading it (the seed!).
  - Reconciler telemetry (`lastCorrection`, `drift`) is only computed when `warnOnDivergence` is set.
  - Taking an input from the buffer acks it. Never take an input you will not simulate, unless a stand-in step already took its place (see `inputPacer.ts`). Buffer overflow also acks dropped inputs.
  - Reliable inputs are one WebSocket message each, so `maxMessagesPerSecond` must leave room for the backlog after a stall, or recovering clients get kicked (code 4002).
  - `Predict` lerp treats any sample gap over 1.5 patch intervals as an idle entity and inserts a held sample. Anything updated slower than every tick (far poses at 10 Hz) must use our own buffer (`farInterp.ts`), or it moves stop-go.
  - Quantized schema fields (`t.quantized`, `t.angle`) snap on assignment and only send real changes, so writing them every tick is cheap.
  - Removing an entry from a client's StateView deletes it on that client.
- The fake network (`apps/client/src/net/netsim.ts`) must deliver strictly in order. One `setTimeout` per message is not enough: browsers round delays to whole milliseconds and can swap messages, which corrupts Colyseus' delta-encoded inputs and patches.
- No WASM threads or SharedArrayBuffer (no COOP/COEP headers needed).
- Keep modules small and readable. No giant single files.
- Dev tools (autopilot, test hook, fake network, `?server=`, spectate) exist only in dev and test builds (`import.meta.env.DEV || VITE_DEVTOOLS === '1'`, `npm run build:test`). Spell that condition out at a dynamic import site so the bundler drops the module from public builds, and check `apps/client/dist` for it after changes. Never gate cheats or tools on a URL flag alone.
- Before handing over a change: `npm run typecheck`, `npm test`, `npm run build`, and for netcode or rendering changes `npm run build:test`, `npm run e2e` and `npm run test:net`. For server performance changes, `npm run bench` and update the table in `README.md`. For visual changes, `npm run shots -- DIR` and look at the frames.

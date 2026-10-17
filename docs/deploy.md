# Deploying the Qwakk game

This runbook hosts the game at `https://play.qwakk.fun` on the owner's Hetzner 8 GB CapRover server, next to the DEX, the indexer and their PostgreSQL. Nothing here has been deployed yet.

Steps marked **[OWNER APPROVAL]** change something outward-facing (CapRover, DNS, GitHub, Cloudflare). Run them only after the owner says yes. Unmarked steps are local and safe.

## What runs where

| CapRover app | Image | Container port | Public address | Role |
| --- | --- | --- | --- | --- |
| `qwakk-game` | `deploy/server/Dockerfile` (root `captain-definition`) | 2567 (`PORT`) | `https://play.qwakk.fun` (HTTPS and WSS) | One container: the Colyseus game server (WebSocket, matchmaking, `/api`, `/health`) and the built client on the same origin. Exactly 1 instance |
| `qwakk-game-db` | CapRover one-click PostgreSQL | 5432 | none (internal only) | Leaderboard and guest names. Only the game server talks to it |

Flow: the browser loads `https://play.qwakk.fun/`, and the client then opens matchmaking, `/api` and the WebSocket on the origin it was loaded from (`wss://play.qwakk.fun`). Nothing is baked per domain, so the same image works on any hostname.

At launch the server opens one deathmatch room (Istanbul, `DM_OPEN_ROOMS` in `packages/shared/src/lobby.ts`) and allows one battle royale room at a time (`BR.maxRooms`, `QWAKK_BR_MAX_ROOMS` overrides it). Both are listed in the menu.

### Files

| File | Purpose |
| --- | --- |
| `captain-definition` | CapRover's default entry point, points at `deploy/server/Dockerfile`. It lives at the repo root because CapRover uses its folder as the Docker build context, and the image needs the whole monorepo |
| `deploy/server/Dockerfile` | Node 24 slim. Stages: server production deps, the public client build (minified, no source maps, no dev tools, precompressed), the baked bot navmeshes, then the runtime as user `node` with a healthcheck on `/health` |
| `deploy/server/build-navmesh.ts` | Build step: bakes the Yelova and Kavren navmeshes into `/srv/navcache` |
| `deploy/server/precompress.ts` | Build step: `.br` and `.gz` copies of the client files |
| `deploy/server/.env.example` | Every env var, with comments (placeholders only) |
| `deploy/caprover/qwakk-game.service-override.yml` | CPU and memory limits plus stop-first updates for the game app |
| `deploy/caprover/qwakk-game-db.service-override.yml` | Optional limits for the PostgreSQL app |
| `deploy/smoke/join.ts` | `npm run smoke`: health, a session, the lobby lists the deathmatch rooms, a join into each, a battle royale join |
| `apps/server/src/staticClient.ts` | How the server serves the client (see "What the website exposes") |
| `apps/admin/` | The admin UI, built into the image at `/srv/admin` (never the public folder); served only to a logged-in admin (step 2c) |
| `scripts/admin-setup.ts` | `npm run admin:setup`: makes the two admin secrets on the owner's machine (step 2c) |
| `docker-compose.yml` | Local PostgreSQL 17 on port 5439 for development and tests |

Kept for the optional split hosting later (see the last section), not used by this plan: `captain-definition-web`, `deploy/web/`, `deploy/landing/game-proxy.conf`.

## 0. Local checks before any deploy

Run from the `qwakk-game` folder.

```bash
npm run typecheck && npm test && npm run build
npm run build:test && npm run e2e && npm run test:net   # netcode and determinism (ports 2567, 5173, 2596)

# The lockfile must still be valid for Linux npm ci (npm 11 on macOS can drop
# entries). Copy package.json, package-lock.json and the three workspace
# package.json files (apps/server, apps/client, packages/shared) into an empty
# folder and run there, so the real node_modules is untouched:
npx -y npm@10 ci --dry-run

# Build the image exactly as CapRover will
npm run docker:game          # docker build -f deploy/server/Dockerfile -t qwakk-game .
```

Run it against a throwaway PostgreSQL, with the same limits as production (ports 2610 and none for the database, so nothing collides with `./dev.sh` or the e2e):

```bash
docker network create qwakk-game-check
docker run -d --name qwakk-game-check-db --network qwakk-game-check \
  -e POSTGRES_DB=qwakk_game -e POSTGRES_USER=qwakk_game -e POSTGRES_PASSWORD=localcheck postgres:17-alpine
docker run -d --name qwakk-game-check --network qwakk-game-check -p 127.0.0.1:2610:2567 \
  --cpus 1.5 --memory 1g \
  -e SESSION_SECRET="$(openssl rand -hex 32)" -e TRUST_PROXY=1 -e ALLOWED_ORIGINS=http://127.0.0.1:2610 \
  -e NODE_OPTIONS=--max-old-space-size=768 \
  -e DATABASE_URL=postgres://qwakk_game:localcheck@qwakk-game-check-db:5432/qwakk_game qwakk-game
docker logs qwakk-game-check 2>&1 | grep '^\['
#   [meta] database ready, applied 001_init.sql
#   [web] serving the client from /srv/public (72 files)
#   [nav] sainte-canard navmesh ready: cache in 7 ms
#   [nav] canard-quarter navmesh ready: cache in 1 ms
#   [qwakk-game] server listening ... (deathmatch rooms istanbul on canard-quarter, "br" battle royale)
npm run smoke -- ws://127.0.0.1:2610      # ends with "OK ws://127.0.0.1:2610"
# open http://127.0.0.1:2610/ in a browser and play a round
docker rm -f qwakk-game-check qwakk-game-check-db && docker network rm qwakk-game-check
```

If the database starts slower than the server, the log shows `[meta] database start failed, retrying in 30 s`; the game runs meanwhile and the migration follows on the retry.

If `docker build` hangs at "load metadata for docker.io/...", the macOS keychain credential helper is waiting for a prompt. Unlock the keychain or answer the prompt, then retry.

The code must be committed and pushed to `qwakk-fun/qwakk-game` before a GitHub or `caprover deploy` build can see it. **[OWNER APPROVAL]** for the commit and push.

## 1. Create the database app **[OWNER APPROVAL]**

CapRover > Apps > One-Click Apps/Databases > PostgreSQL:

- App name: `qwakk-game-db`
- Version: `17` (or the newest 17.x offered)
- Username: `qwakk_game`
- Password: generate with `openssl rand -hex 24` and paste it straight into the field (it is stored only in CapRover)
- Default database: `qwakk_game`

Do not map its port to the host: only `qwakk-game` reaches it, over CapRover's internal network as `srv-captain--qwakk-game-db:5432`. Optionally paste `deploy/caprover/qwakk-game-db.service-override.yml` into its Service Update Override (0.5 CPU, 256 MiB).

Alternative that saves memory: use the existing PostgreSQL app with its own role and database (`CREATE ROLE qwakk_game LOGIN PASSWORD '...'; CREATE DATABASE qwakk_game OWNER qwakk_game;`) and point `DATABASE_URL` at that app's `srv-captain--<name>` host instead.

Skipping the database is fine for a first test: the game runs without a leaderboard (`/health` then says `"db":"off"`).

## 2. Create and configure `qwakk-game` **[OWNER APPROVAL]**

Apps > Create a New App: `qwakk-game`, "Has Persistent Data" off.

### HTTP Settings

- Container HTTP Port: `2567`.
- Websocket Support: **on**. Without it the WebSocket upgrade fails and nobody can join. Nothing else in CapRover's nginx needs changing: the server pings every socket every 3 s (Colyseus) and once a second (round-trip probe), far inside nginx's 60 s proxy timeout, and dead sockets are dropped after about 9 s.
- Domain: added in step 4 (DNS first).

### App Configs

- Instance Count: **1**. The deathmatch rooms are created inside the process at boot; a second instance would open its own Istanbul with its own players, and there is no shared presence or sticky routing. Never scale this app above 1. The service override below also sets stop-first updates, so a redeploy never runs two side by side.
- Environmental Variables (full list with comments: `deploy/server/.env.example`):

  ```
  SESSION_SECRET=<step 2a, 32+ characters>
  TRUST_PROXY=1
  ALLOWED_ORIGINS=https://play.qwakk.fun
  DATABASE_URL=postgres://qwakk_game:<db password>@srv-captain--qwakk-game-db:5432/qwakk_game
  NODE_OPTIONS=--max-old-space-size=768
  TURNSTILE_SECRET=<step 2b, or leave unset>
  VITE_TURNSTILE_SITEKEY=<step 2b, or leave unset>
  ```

  | Variable | Required | When | Notes |
  | --- | --- | --- | --- |
  | `SESSION_SECRET` | yes | runtime | The image sets `NODE_ENV=production`, so the server refuses to start without it or with fewer than 32 characters. Rotating it resets every guest identity |
  | `TRUST_PROXY` | yes, `1` | runtime | CapRover's nginx is one proxy. Without it every player has the proxy's IP and the per-IP limits throttle everyone together. Use `2` only if Cloudflare proxying (orange cloud) is ever turned on for `play` |
  | `ALLOWED_ORIGINS` | yes | runtime | `https://play.qwakk.fun`. Applies to `/api`, matchmaking CORS and WebSocket upgrades. Unset also works (same origin only), but the explicit value documents it and silences the startup warning |
  | `DATABASE_URL` | for the leaderboard | runtime | Migrations run at start. Unset: no leaderboard, play still works |
  | `NODE_OPTIONS` | recommended | runtime | Keeps the V8 heap under the 1 GiB limit |
  | `TURNSTILE_SECRET` | recommended before wide sharing | runtime | Set together with `VITE_TURNSTILE_SITEKEY`, or neither. A secret without a site key makes every new guest fail with 403 `turnstile_failed` |
  | `VITE_TURNSTILE_SITEKEY` | with the secret | build | Public value. CapRover passes app env vars to the Docker build as build args; a change needs Save, then Force Build |
  | `QWAKK_BR_MAX_ROOMS` | no | runtime | Battle royale rooms open at once. Default `BR.maxRooms` (1). Raise it only after watching CPU (step 6) |
  | `QWAKK_STATS` | no | runtime | `1` prints per-room tick time, CPU and RSS to the logs every `QWAKK_STATS_MS` (default 5000) |
  | `ADMIN_PASSWORD_HASH` | for the admin panel | runtime | Secret. From `npm run admin:setup` (step 2c). Set together with `ADMIN_TOTP_SECRET`, or neither: without both, `/admin` is a 404 |
  | `ADMIN_TOTP_SECRET` | for the admin panel | runtime | Secret. The authenticator app's base32 secret, from `npm run admin:setup` |
  | `PORT` | no | runtime | Default 2567, must match the Container HTTP Port |

  Do not set: `VITE_GAME_SERVER` and `VITE_API_BASE` (leave them empty so the client uses its own origin), `QWAKK_NAV_CACHE`, `QWAKK_CLIENT_DIR` and `NODE_ENV` (the image sets them), and the test switches `QWAKK_MAX_CLIENTS` (a value below 32 caps every deathmatch room), `QWAKK_DM_ROOMS`, `QWAKK_BOTS`, `QWAKK_INTEREST`, `QWAKK_SPECTATORS`, `QWAKK_BR_COUNTDOWN`, `QWAKK_BR_MIN_HUMANS`, `QWAKK_BR_SEED`, `QWAKK_ZONE_SCALE`, `QWAKK_DM_MAP`, `QWAKK_DM_SPAWN_RADIUS`, `COLYSEUS_LATENCY`.

  Do not set `QWAKK_ADMIN_DIR` or `QWAKK_COMMIT` either (the image sets them; the dashboard shows CapRover's commit when the app deploys from the repository).

  Secrets (`SESSION_SECRET`, `TURNSTILE_SECRET`, `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET`, the database password) live only in CapRover, never in the repo, an image or a log. The Dockerfile declares no build arg for them, so Docker ignores them at build time.
- Service Update Override: paste `deploy/caprover/qwakk-game.service-override.yml` (1.5 CPUs, 1 GiB, 0.5 CPU and 256 MiB reserved, stop-first updates). CapRover reapplies it on every deploy.

### Deployment

- Captain Definition Relative Path: leave the default `./captain-definition`.

### 2a. Generate `SESSION_SECRET` **[OWNER APPROVAL]**

On the owner's machine, generate it and paste it straight into the CapRover env field, without saving it anywhere else:

```bash
openssl rand -hex 32    # 64 characters
```

Keep it stable. Changing it later resets every guest identity.

### 2b. Turnstile (optional at first) **[OWNER APPROVAL]**

Cloudflare dashboard > Turnstile > Add widget: hostname `play.qwakk.fun`, mode "Managed". The secret key goes to `TURNSTILE_SECRET`, the site key to `VITE_TURNSTILE_SITEKEY`, both on `qwakk-game`. Set both or neither. Adding them later needs one Force Build.

### 2c. Admin panel (optional) **[OWNER APPROVAL]**

The panel at `https://play.qwakk.fun/admin` (dashboard, settings, moderation, notices and maintenance, audit log; README "Admin panel") is off until both secrets are set. It needs the image built from a commit that has it (any deploy after the admin panel landed) and, for saved settings, bans and the audit log, `DATABASE_URL` (migration `002_admin.sql` runs by itself at start).

1. On the owner's machine (local, nothing is written to disk):

   ```bash
   cd ~/Desktop/qwakk/qwakk-game
   npm ci                  # once
   npm run admin:setup     # asks for a password (4+ characters, twice)
   ```

2. Scan the QR code it prints with an authenticator app (Google Authenticator, 1Password, Authy, ...). The account shows as "Qwakk Game (admin)". If the code does not scan, add the `otpauth://` line by hand.
3. **[OWNER APPROVAL]** CapRover > `qwakk-game` > App Configs > Environmental Variables: add the two printed lines, `ADMIN_PASSWORD_HASH=scrypt:...` and `ADMIN_TOTP_SECRET=...`, then Save & Update (a restart, no rebuild; rooms in progress end).
4. The app log shows `[admin] panel on at /admin (UI from /srv/admin)`. Open `https://play.qwakk.fun/admin`, log in with the password and the current 6 digit code.
5. Clear the terminal (the secret was on screen). Keep the password in a password manager.

Notes:

- A new password or a lost phone: run `npm run admin:setup` again and replace both values (re-add the account in the app).
- Logging in fails 5 times from one address: that address waits 15 minutes (longer after repeats). Many failures from anywhere lock every login for a minute or more (an attack); wait it out.
- Sessions live in server memory: a deploy or restart logs you out (12 hours at most anyway).
- Turning it off: remove both variables and Save. `/admin` becomes a 404 again.

## 3. Resource sizing

Measured on an Apple M4 Pro with the production image under `--cpus 1.5 --memory 1g`, every network player sending inputs at 30 Hz and firing a third of the time:

| Load | Process CPU | Memory | Tick rate | Notes |
| --- | --- | --- | --- | --- |
| Idle (rooms open, nobody in) | about 0 | 163 MiB | rooms sleep | an empty room has no tick loop |
| 3 deathmatch rooms x 32 network players + 20 battle royale matches (1 player + 15 bots each), 116 sockets | about 1.1 CPUs | 415 MiB | 30 Hz held in every room, no client dropped | deathmatch tick 6.9 ms avg, 8.2 ms p95 of 33 ms; battle royale 0.5 to 0.7 ms |

That stress case is far above launch (one deathmatch room and one battle royale room). The game loop runs on one thread: in the stress case it used most of one M4 Pro core, and Hetzner cores are slower, so before raising `DM_OPEN_ROOMS` or `QWAKK_BR_MAX_ROOMS` a lot, measure on the server with `QWAKK_STATS=1` (step 6). The 1 GiB limit leaves about 600 MiB of headroom; a full launch load (32 humans in Istanbul plus a full royale) is about a third of the stress case.

## 4. DNS and SSL for `play.qwakk.fun` **[OWNER APPROVAL]**

1. At the DNS provider for `qwakk.fun`, add:

   | Type | Name | Value | TTL |
   | --- | --- | --- | --- |
   | A | `play` | the Hetzner server's public IPv4 (the same IP `qwakk.fun` points to) | 300 |

   Add an AAAA record only if the server has IPv6 configured in CapRover. If `qwakk.fun` is on Cloudflare, keep the record "DNS only" (grey cloud): Let's Encrypt must reach the server directly, and `TRUST_PROXY=1` assumes CapRover's nginx is the only proxy.
2. Wait until it resolves: `dig +short play.qwakk.fun` prints the server IP.
3. CapRover > `qwakk-game` > HTTP Settings > Connect New Domain: `play.qwakk.fun`.
4. Click "Enable HTTPS" next to it, then turn on "Force HTTPS by redirecting all HTTP traffic to HTTPS". Save.

## 5. Deploy **[OWNER APPROVAL]**

Option A, from GitHub (repeatable, can be wired to a webhook later):

1. GitHub `qwakk-fun/qwakk-game` > Settings > Deploy keys: add a read-only key whose private half goes into CapRover (or use a fine-grained token with read access to this one repo). **[OWNER APPROVAL]** for the GitHub setting.
2. CapRover > `qwakk-game` > Deployment > "Deploy from Github/Bitbucket/Gitlab": repository `github.com/qwakk-fun/qwakk-game`, branch `main`, the key or token. Save and Update, then Force Build.

Option B, from the owner's machine with the CapRover CLI (it uploads the last commit of the branch, not uncommitted files):

```bash
cd ~/Desktop/qwakk/qwakk-game
npx caprover deploy -n <captain-machine-name> -a qwakk-game -b main
```

Build cost on the server: about 2.5 minutes, most of it the navmesh bake (about a minute of one core) and two `npm ci` runs. Prefer a quiet moment for the DEX. On the first build, check the log shows `deploy/server/Dockerfile`, `[precompress]` and both `[nav] ... baked and verified` lines. After start, the app log must show `[nav] ... navmesh ready: cache in` a few ms for both maps; `built (worker)` means the baked file did not match and the server spent a minute rebuilding it. Any deploy restarts the process, so rooms in progress end and players see the reconnect screen.

## 6. Smoke tests

```bash
curl -s https://play.qwakk.fun/health
#   {"ok":true,"db":"up"}   ("off" without DATABASE_URL)
npm run smoke -- wss://play.qwakk.fun
#   health, session, "lobby lists ... deathmatch istanbul", "joined istanbul ... 24 ducks seated",
#   "joined battle royale", then "OK wss://play.qwakk.fun".
#   With Turnstile on it stops after the session check ("joins skipped"). For the full run,
#   play once at play.qwakk.fun, copy `token` from localStorage `qwakk.identity`, then:
#   SMOKE_SESSION=<token> npm run smoke -- wss://play.qwakk.fun

# Origins
curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://evil.example' https://play.qwakk.fun/api/leaderboard   # 403
curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://play.qwakk.fun' https://play.qwakk.fun/api/leaderboard  # 200

# The page and its caching
curl -sI https://play.qwakk.fun/ | grep -i -E '^(HTTP|content-type|cache-control)'
#   200, text/html, cache-control: no-cache
JS=$(curl -s https://play.qwakk.fun/ | grep -o '/assets/main-[^"]*\.js' | head -1)
curl -sI -H 'Accept-Encoding: br, gzip' "https://play.qwakk.fun$JS" | grep -i -E '^(HTTP|cache-control|content-encoding)'
#   200, public, max-age=31536000, immutable, content-encoding: br
curl -sI https://play.qwakk.fun/models/duck.glb | grep -i -E '^(HTTP|content-type)'
#   200, model/gltf-binary

# The admin panel: with the secrets set, the login page (200) and nothing else without a session;
# without them, 404 like any unknown path
curl -s -o /dev/null -w '%{http_code}\n' https://play.qwakk.fun/admin                     # 200 (on) or 404 (off)
curl -s -o /dev/null -w '%{http_code}\n' https://play.qwakk.fun/admin/api/overview        # 401 (on) or 404 (off)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://play.qwakk.fun/admin/login       # 403 (no Origin) or 404 (off)
curl -s https://play.qwakk.fun/api/status                                                 # {"banner":null,"maintenance":false,...}

# Nothing but the client is served (every line must print 404)
for p in /apps/server/src/index.ts /.git/config /.env /package.json /node_modules/postgres/package.json \
         /packages/shared/src/index.ts /navcache/x.bin /apps/server/db/migrations/001_init.sql /etc/passwd; do
  printf '%-44s %s\n' "$p" "$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "https://play.qwakk.fun$p")"
done
```

Then in a browser: open `https://play.qwakk.fun/`, check the console has no errors and the `v0.1.0 BETA` badge shows, create a guest, check the leaderboard tab loads, join Istanbul and a battle royale, move, shoot, watch the bots walk paths. Open a second browser or a phone on mobile data and check both ducks see each other. After a match, the result shows on the leaderboard.

On the server, watch the DEX is not starved while rooms run:

```bash
docker stats --no-stream | grep -E 'qwakk'
```

`qwakk-game` should stay under its 1.5 CPU cap and the app log should show no restarts. For tick timings, set `QWAKK_STATS=1` for a while (Save restarts the app).

## 7. Rollback

- Bad build: CapRover > `qwakk-game` > Deployment > version history, deploy the previous version.
- Game overloading the host: set Instance Count to `0` (players see the reconnect screen), or lower the CPU limit in the override and Save.
- Remove everything: delete `qwakk-game`, then `qwakk-game-db` (this deletes the leaderboard data), then the `play` DNS record. **[OWNER APPROVAL]**

## What the website exposes

The server answers HTTP only from a fixed table of the files in the client build (`/srv/public` in the image, `apps/server/src/staticClient.ts`): `/` is `index.html`, hashed files under `/assets/` are cached for a year, everything else revalidates. `/admin` belongs to the admin panel (`apps/server/src/admin/http.ts`): a 404 while it is off; when on, a script-free login page, and the admin UI (`/srv/admin`, outside the public folder) only with a valid admin session. Nothing is looked up from the request path on disk, so server source, `packages/`, `.git`, `.env`, `node_modules`, the navmesh cache and the migrations are never reachable; dot paths and unknown paths are 404 (there is no catch-all), and `/game/...` redirects to `/...` for links made for the old plan. `/api`, `/health` and `/matchmake` belong to the game server. The image itself holds no `.git`, `.env`, `art/`, tests, benchmarks or docs (`.dockerignore`), and runs as the unprivileged `node` user with read-only files.

The public client bundle is minified with local identifier mangling, has no source maps and no `sourceMappingURL`, no comments, no original file paths, and no dev tools (autopilot, test hook, map viewer, `?server=`, spectate and the fake network controls are compiled out; the image build fails if a source map or the map viewer appears). Property names are not mangled on purpose: the shared sim runs in the browser and on the server and must match bit for bit, and property mangling or float-changing transforms would break that (the e2e map hash and sim scenario checks prove the build matches).

Browser JavaScript can never be fully hidden, only made hard to read: anyone can download and study what their browser runs. What protects the game is the server-authoritative design: the client sends inputs only, the server decides movement, hits, damage, loot and the leaderboard, and hidden enemies are never sent. Reading the client gives no way to cheat past that.

## Per-IP limits (all in memory, never stored)

All need `TRUST_PROXY=1` behind CapRover, or every player shares the proxy's address.

| Limit | Value |
| --- | --- |
| Open WebSockets (game rooms and lobby together) | 16 at once per IP (IPv6 per /64); more get HTTP 429 at the upgrade |
| Room joins | a burst of 10, then one every 4 s |
| New battle royale rooms | a burst of 3, then one a minute; at most `BR.maxRooms` open |
| Lobby connections | a burst of 20, then one every 3 s |
| New sessions (`POST /api/session`) | a burst of 8, then one every 20 s; Turnstile on new guests when configured |
| Leaderboard and profile reads | a burst of 40, then 2 a second |

Plus the deathmatch rooms cannot be created by clients (matchmaking returns 530), every input is sanitized and rate-limited, and frames over 1 KB are refused.

## Optional later: client at `qwakk.fun/game`

The first plan served the client from its own nginx app behind the landing (`qwakk.fun/game`) with the server at `play.qwakk.fun`. The files are kept and still work:

- `qwakk-game-web` app from `captain-definition-web` (`deploy/web/Dockerfile`, nginx on port 80, `VITE_GAME_SERVER=wss://play.qwakk.fun` baked in, base `/game/`), 0.5 CPU and 128 MiB (`deploy/caprover/qwakk-game-web.service-override.yml`).
- `deploy/landing/game-proxy.conf` pasted into the landing app's nginx template above `location / {` (instructions in the file).
- `ALLOWED_ORIGINS=https://play.qwakk.fun,https://qwakk.fun` on `qwakk-game`, and the Turnstile widget extended to the hostname `qwakk.fun`.

## Local PostgreSQL

`docker compose up -d postgres` (or `npm run db:up`) starts PostgreSQL 17 on `localhost:5439` (database `qwakk_game`, local-only password in `docker-compose.yml`). `docker compose down` (or `npm run db:down`) stops it and keeps the data volume.

## Before public launch

Done in code: the one-origin hosting, `/health`, the origin check, the per-IP limits above, Turnstile on guest creation, the single-instance setup.

Still open:

- Content hashes for models, so `/models/` can be cached as immutable instead of revalidated.
- A Content-Security-Policy header (needs the Turnstile origin `challenges.cloudflare.com` allowed).

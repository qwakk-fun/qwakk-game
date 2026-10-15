# Deploying the Qwakk game

This runbook hosts the game on the owner's Hetzner 8 GB CapRover server, next to the DEX, the indexer and PostgreSQL. Nothing here has been deployed yet.

Steps marked **[OWNER APPROVAL]** change something outward-facing (CapRover, DNS, GitHub, the live landing). Run them only after the owner says yes. Unmarked steps are local and safe.

## What runs where

| CapRover app | Image | Container port | Public address | Role |
| --- | --- | --- | --- | --- |
| `qwakk-game-server` | `deploy/server/Dockerfile` | 2567 (`PORT`) | `https://play.qwakk.fun` (HTTPS and WSS) | Colyseus game server, 1 instance, CPU and memory capped |
| `qwakk-game-web` | `deploy/web/Dockerfile` | 80 | none of its own; reached as `https://qwakk.fun/game/` | nginx serving the Vite build |
| `qwakk-landing` (exists) | unchanged | 3000 | `https://qwakk.fun` | gets one extra nginx `location /game/` that proxies to `qwakk-game-web` |

Flow: the browser loads `qwakk.fun/game/` (landing nginx, proxied to `srv-captain--qwakk-game-web`), then the client opens matchmaking and a WebSocket to `wss://play.qwakk.fun`, baked into the bundle at build time (`VITE_GAME_SERVER`).

Files:

| File | Purpose |
| --- | --- |
| `deploy/server/Dockerfile` | Node 24 slim, production deps of `@qwakk/server` and `@qwakk/shared` only, runs as user `node`, healthcheck |
| `deploy/server/.env.example` | Server env vars (placeholders only) |
| `deploy/web/Dockerfile`, `deploy/web/nginx.conf` | Vite build, then nginx at `/game/` with caching, MIME types and gzip |
| `captain-definition-server`, `captain-definition-web` | CapRover entry points. They live at the repo root because CapRover uses the folder of the captain-definition file as the Docker build context, and both images need the whole monorepo |
| `deploy/caprover/*.service-override.yml` | CPU and memory limits for CapRover's Service Update Override |
| `deploy/landing/game-proxy.conf` | The `location /game/` block for the landing app |
| `deploy/smoke/join.ts` | Joins a room over WSS and waits for the first state patch |
| `docker-compose.yml` | Local PostgreSQL 17 on port 5439 (Phase 2 leaderboard) |

## 0. Local checks before any deploy

Run from the `qwakk-game` folder. The lockfile check matters: npm 11 on macOS can drop lockfile entries that Linux `npm ci` needs.

```bash
npm run typecheck && npm test && npm run build

# Lockfile still valid for Linux npm ci (run in a temp copy, see the note below)
npx -y npm@10 ci --dry-run

# Both images build and start
docker build -f deploy/server/Dockerfile -t qwakk-game-server:check .
docker build -f deploy/web/Dockerfile -t qwakk-game-web:check .

docker run -d --name qwakk-game-server-check -p 2597:2567 qwakk-game-server:check
node --disable-warning=ExperimentalWarning deploy/smoke/join.ts ws://localhost:2597
docker rm -f qwakk-game-server-check

docker run -d --name qwakk-game-web-check -p 8097:80 qwakk-game-web:check
curl -sI http://localhost:8097/game/ | grep -i -E '^(HTTP|content-type|cache-control)'
curl -sI http://localhost:8097/game/models/duck.glb | grep -i -E '^(HTTP|content-type)'
docker rm -f qwakk-game-web-check
```

If `docker build` hangs at "load metadata for docker.io/...", the macOS keychain credential helper is waiting for a prompt. Unlock the keychain or answer the prompt, then retry.

For the lockfile check, copy `package.json`, `package-lock.json` and every workspace `package.json` (`apps/server`, `apps/client`, `packages/shared`) into an empty folder and run it there, so the real `node_modules` is untouched.

The code must be committed and pushed to `qwakk-fun/qwakk-game` before a GitHub or `caprover deploy` build can see it. **[OWNER APPROVAL]** for the push.

## 1. Create the two apps **[OWNER APPROVAL]**

In the CapRover dashboard, Apps > Create a New App:

1. `qwakk-game-server`, "Has Persistent Data" off.
2. `qwakk-game-web`, "Has Persistent Data" off.

## 2. Configure `qwakk-game-server` **[OWNER APPROVAL]**

HTTP Settings:

- Container HTTP Port: `2567`.
- Websocket Support: on. Without it the WebSocket upgrade fails and players cannot join.
- Leave "Force HTTPS" until SSL exists (step 4).

App Configs:

- Instance Count: `1`. Rooms live in one process; there is no shared presence or sticky sessions, so never scale this app above 1. Scale later with more apps or nodes, each with its own hostname.
- Environmental Variables (see `deploy/server/.env.example`):

  ```
  PORT=2567
  QWAKK_MAX_CLIENTS=8
  NODE_OPTIONS=--max-old-space-size=768
  ```

  Optional: `QWAKK_SEED`, `QWAKK_BOTS=0`, `QWAKK_STATS=1` (prints tick timing to the logs). Never set `QWAKK_INTEREST`, `QWAKK_SPECTATORS` or `COLYSEUS_LATENCY` in production.

  `DATABASE_URL`, `ALLOWED_ORIGINS` and `TURNSTILE_SECRET` are reserved for upcoming work; the server does not read them yet. When it does, set `TURNSTILE_SECRET` and the database password only here in CapRover, never in the repo.
- Service Update Override: paste `deploy/caprover/qwakk-game-server.service-override.yml`. It limits the server to 1.5 CPUs and 1 GiB. CapRover reapplies it on every deploy.

  The same limit as a one-off command on the server (for a quick test; CapRover drops it on the next deploy unless the override is set):

  ```bash
  docker service update --limit-cpu 1.5 --limit-memory 1g srv-captain--qwakk-game-server
  ```

Deployment:

- Captain Definition Relative Path: `./captain-definition-server`.

## 3. Configure `qwakk-game-web` **[OWNER APPROVAL]**

- HTTP Settings: Container HTTP Port `80` (default). No custom domain is needed, because the landing proxies to it. Websocket Support is not needed.
- App Configs > Environmental Variables: `VITE_GAME_SERVER=wss://play.qwakk.fun`. CapRover passes app env vars to the Docker build as build args; the Dockerfile already defaults to this value, so this line only documents it and allows a change later.
- App Configs > Instance Count: `1`.
- Service Update Override: paste `deploy/caprover/qwakk-game-web.service-override.yml` (0.5 CPU, 128 MiB).
- Deployment > Captain Definition Relative Path: `./captain-definition-web`.

## 4. DNS and SSL for `play.qwakk.fun` **[OWNER APPROVAL]**

1. At the DNS provider for `qwakk.fun`, add:

   | Type | Name | Value | TTL |
   | --- | --- | --- | --- |
   | A | `play` | the Hetzner server's public IPv4 (the same IP `qwakk.fun` points to) | 300 |

   Add an AAAA record too only if the server has IPv6 configured in CapRover. If `qwakk.fun` is on Cloudflare, keep the record "DNS only" (grey cloud) so CapRover's Let's Encrypt check reaches the server directly.
2. Wait until it resolves: `dig +short play.qwakk.fun` prints the server IP.
3. CapRover > `qwakk-game-server` > HTTP Settings > Connect New Domain: `play.qwakk.fun`.
4. Click "Enable HTTPS" next to it, then turn on "Force HTTPS by redirecting all HTTP traffic to HTTPS". Save.

## 5. Deploy the images **[OWNER APPROVAL]**

Deploy the server first, so the client has something to connect to.

Option A, from GitHub (repeatable, can be wired to a webhook later):

1. GitHub `qwakk-fun/qwakk-game` > Settings > Deploy keys: add a read-only key whose private half goes into CapRover (or use a fine-grained token with read access to this one repo). **[OWNER APPROVAL]** for the GitHub setting.
2. CapRover > each app > Deployment > "Deploy from Github/Bitbucket/Gitlab": repository `github.com/qwakk-fun/qwakk-game`, branch `main`, the key or token. Save and Update, then Force Build.

Option B, from the owner's machine with the CapRover CLI (it uploads the last commit of the branch, not uncommitted files):

```bash
cd ~/Desktop/qwakk/qwakk-game
npx caprover deploy -n <captain-machine-name> -a qwakk-game-server -b main
npx caprover deploy -n <captain-machine-name> -a qwakk-game-web -b main
```

Both options rely on the Captain Definition Relative Path from steps 2 and 3. On the first build, check that the build log shows the expected Dockerfile (`deploy/server/Dockerfile` or `deploy/web/Dockerfile`).

Build cost on the server: the web build runs Vite and installs about 200 packages, roughly a minute of full CPU. Prefer a quiet moment.

## 6. Add the `/game/` proxy to the landing **[OWNER APPROVAL]**

Do this only after `qwakk-game-web` is deployed and healthy.

1. CapRover > `qwakk-landing` > HTTP Settings > "Edit Default Nginx Configurations".
2. Copy the current template into a local file first (this is the rollback).
3. Paste the contents of `deploy/landing/game-proxy.conf` inside the main `server { ... }` block (the one with `set $upstream ...` and the `listen 443 ssl` lines), directly above the existing `location / {`. Not into the small port-80 block that only redirects to HTTPS.
4. Save and Update. CapRover reloads its nginx.

The snippet resolves `srv-captain--qwakk-game-web` per request through a variable. If the game web app is down or missing, only `/game/` returns 502; the rest of `qwakk.fun` and the CapRover nginx keep working.

## 7. Smoke tests

```bash
# Game server: HTTPS answers, and a real join over WSS gets state
curl -s -o /dev/null -w '%{http_code}\n' https://play.qwakk.fun/      # expect 200 (Colyseus answers / with an empty body)
node --disable-warning=ExperimentalWarning deploy/smoke/join.ts wss://play.qwakk.fun   # expect "OK wss://play.qwakk.fun"

# Client through the landing proxy
curl -sI https://qwakk.fun/game/ | grep -i -E '^(HTTP|content-type|cache-control)'
#   HTTP/2 200, text/html, cache-control: no-cache
curl -sI https://qwakk.fun/game | grep -i -E '^(HTTP|location)'
#   301 to /game/
curl -sI https://qwakk.fun/game/models/duck.glb | grep -i -E '^(HTTP|content-type)'
#   200, model/gltf-binary
curl -s https://qwakk.fun/game/ | grep -o '/game/assets/[^"]*\.js' | head -1   # then:
curl -sI -H 'Accept-Encoding: gzip' https://qwakk.fun/game/assets/<that file> | grep -i -E '^(HTTP|cache-control|content-encoding)'
#   200, immutable, content-encoding: gzip

# The landing itself still works
curl -s -o /dev/null -w '%{http_code}\n' https://qwakk.fun/            # expect 200
```

Then in a browser: open `https://qwakk.fun/game/`, check the console has no errors, join, move and shoot. Open a second browser or phone and check both ducks see each other.

On the server, watch that the DEX is not starved while a room runs:

```bash
docker stats --no-stream | grep -E 'qwakk'
```

`qwakk-game-server` should stay under its 1.5 CPU cap; the app's logs (CapRover > App Logs) should show no restarts.

## 8. Rollback

- Bad game build: CapRover > app > Deployment > version history, deploy the previous version. Rooms in progress end on any server redeploy.
- Broken `/game/` or landing: CapRover > `qwakk-landing` > HTTP Settings > Edit Default Nginx Configurations, paste back the template saved in step 6 (or remove the two `location` blocks), Save and Update.
- Game server overloading the host: set Instance Count to `0` for `qwakk-game-server` (players see the reconnect screen), or lower the CPU limit in the override and Save.
- Remove everything: delete the `/game/` proxy first, then the two apps, then the `play` DNS record. **[OWNER APPROVAL]**

## Phase 2: PostgreSQL for the leaderboard (later)

Locally: `docker compose up -d postgres` starts PostgreSQL 17 on `localhost:5439` (database `qwakk_game`, local-only password in `docker-compose.yml`). `docker compose down` stops it and keeps the data volume.

In production, to save memory on the 8 GB host, use the existing CapRover PostgreSQL app with its own database and role instead of a second PostgreSQL. **[OWNER APPROVAL]**:

```sql
CREATE ROLE qwakk_game LOGIN PASSWORD '<generated, stored only in CapRover>';
CREATE DATABASE qwakk_game OWNER qwakk_game;
```

Then set `DATABASE_URL=postgres://qwakk_game:<password>@srv-captain--<postgres-app>:5432/qwakk_game` on `qwakk-game-server` only. The leaderboard is written only by the game server.

## Before public launch (code work, not deploy work)

- A `/health` route on the game server (the healthcheck currently treats any answer below 500 from `/` as healthy; today `/` returns 200).
- An origin check on matchmaking and the WebSocket upgrade, driven by `ALLOWED_ORIGINS`. Colyseus currently answers matchmaking with `Access-Control-Allow-Origin: *`, so any site can embed a client.
- Per-IP connection and join limits (behind CapRover, read the client IP from `X-Forwarded-For`).
- Turnstile verification on guest creation (`TURNSTILE_SECRET`).
- Content hashes for models, so `/game/models/` can be cached as immutable instead of revalidated.

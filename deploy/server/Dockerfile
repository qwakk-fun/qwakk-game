# Qwakk game: ONE container for the whole game at play.qwakk.fun. The Colyseus
# game server (Node 24, runs .ts directly with type stripping) answers the
# WebSocket, the matchmaking, /api and /health, and serves the built client
# (apps/client/dist) on the same port and origin.
# Build context: the repo root. CapRover app: qwakk-game (root captain-definition).
#
#   docker build -f deploy/server/Dockerfile -t qwakk-game .
#   docker run --rm -p 2567:2567 -e SESSION_SECRET=<32+ chars> qwakk-game   # then open http://localhost:2567/

ARG NODE_IMAGE=node:24-slim

# Production dependencies for the server and the shared sim only (no client, no Vite).
FROM ${NODE_IMAGE} AS deps
WORKDIR /srv
COPY package.json package-lock.json ./
# Every workspace manifest must exist so npm ci accepts the lockfile.
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci --omit=dev --workspace @qwakk/server --workspace @qwakk/shared \
      --no-audit --no-fund \
 && npm cache clean --force

# The public client build, served from the site root. Minified, no source
# maps, no dev tools (VITE_DEVTOOLS=0 compiles them out).
FROM ${NODE_IMAGE} AS client
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci --workspace @qwakk/client --workspace @qwakk/shared --no-audit --no-fund
COPY packages/shared packages/shared
COPY apps/client apps/client
COPY deploy/server/precompress.ts deploy/server/
# Optional build-time settings. CapRover passes app env vars as build args, so
# they are set in the qwakk-game app settings; changing one needs a rebuild.
# VITE_GAME_SERVER: leave EMPTY here. Empty means the page's own origin
# (wss://play.qwakk.fun when served there), so one build works on any domain.
ARG VITE_GAME_SERVER=
# Public Cloudflare Turnstile site key (hostname play.qwakk.fun). Set it
# together with TURNSTILE_SECRET, or leave both unset.
ARG VITE_TURNSTILE_SITEKEY=
ARG VITE_API_BASE=
ENV VITE_GAME_SERVER=${VITE_GAME_SERVER} \
    VITE_TURNSTILE_SITEKEY=${VITE_TURNSTILE_SITEKEY} \
    VITE_API_BASE=${VITE_API_BASE} \
    VITE_DEVTOOLS=0
# The build fails if the bundle has source maps, a sourceMappingURL or the dev-only map viewer.
RUN npm run build -w @qwakk/client -- --base / \
 && if find apps/client/dist -name '*.map' | grep -q . \
       || grep -rlq 'sourceMappingURL' apps/client/dist \
       || [ -e apps/client/dist/mapview.html ]; then \
      echo 'public client build contains source maps or dev pages' >&2; exit 1; \
    fi \
 && node --disable-warning=ExperimentalWarning deploy/server/precompress.ts apps/client/dist

# Bake the bot navmeshes (Sainte-Canard about a minute of one core, the
# deathmatch map a few seconds). Without them every container start rebuilds
# them, because the runtime user cannot write /srv.
FROM ${NODE_IMAGE} AS nav
WORKDIR /srv
COPY --from=deps /srv /srv
COPY packages/shared/src packages/shared/src
COPY apps/server/src apps/server/src
COPY deploy/server/build-navmesh.ts deploy/server/
RUN QWAKK_NAV_CACHE=/srv/navcache node --disable-warning=ExperimentalWarning deploy/server/build-navmesh.ts

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=2567 \
    QWAKK_NAV_CACHE=/srv/navcache \
    QWAKK_CLIENT_DIR=/srv/public
WORKDIR /srv
# Files stay owned by root and read-only for the runtime user. Only the client
# dist is served over HTTP (QWAKK_CLIENT_DIR); nothing else in /srv is reachable.
COPY --from=deps /srv /srv
COPY packages/shared/src packages/shared/src
COPY apps/server/src apps/server/src
COPY apps/server/db apps/server/db
COPY --from=nav /srv/navcache /srv/navcache
COPY --from=client /src/apps/client/dist /srv/public

USER node
EXPOSE 2567

# /health answers without touching the database.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 2567) + '/health', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "--disable-warning=ExperimentalWarning", "apps/server/src/index.ts"]

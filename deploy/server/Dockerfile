# Qwakk game server (Colyseus on Node 24, runs .ts directly with type stripping).
# Build context: the repo root. CapRover app: qwakk-game-server.
#
#   docker build -f deploy/server/Dockerfile -t qwakk-game-server .
#   docker run --rm -p 2567:2567 -e SESSION_SECRET=<32+ chars> qwakk-game-server

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

# Bake the Sainte-Canard bot navmesh (about a minute of one core). Without it,
# every container start rebuilds it, because the runtime user cannot write /srv.
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
    QWAKK_NAV_CACHE=/srv/navcache
WORKDIR /srv
# Files stay owned by root and read-only for the runtime user.
COPY --from=deps /srv /srv
COPY packages/shared/src packages/shared/src
COPY apps/server/src apps/server/src
COPY apps/server/db apps/server/db
COPY --from=nav /srv/navcache /srv/navcache

USER node
EXPOSE 2567

# /health answers without touching the database.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 2567) + '/health', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "--disable-warning=ExperimentalWarning", "apps/server/src/index.ts"]

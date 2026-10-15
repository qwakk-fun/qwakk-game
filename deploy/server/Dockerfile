# Qwakk game server (Colyseus on Node 24, runs .ts directly with type stripping).
# Build context: the repo root. CapRover app: qwakk-game-server.
#
#   docker build -f deploy/server/Dockerfile -t qwakk-game-server .
#   docker run --rm -p 2567:2567 qwakk-game-server

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

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=2567
WORKDIR /srv
# Files stay owned by root and read-only for the runtime user.
COPY --from=deps /srv /srv
COPY packages/shared/src packages/shared/src
COPY apps/server/src apps/server/src

USER node
EXPOSE 2567

# Any HTTP answer below 500 means the process is up and the event loop responds.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 2567) + '/', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"]

CMD ["node", "--disable-warning=ExperimentalWarning", "apps/server/src/index.ts"]

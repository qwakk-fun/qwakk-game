# Qwakk game client: Vite static build served by nginx at /game/.
# Build context: the repo root. CapRover app: qwakk-game-web (reached through
# the landing app's nginx at qwakk.fun/game/).
#
#   docker build -f deploy/web/Dockerfile -t qwakk-game-web .
#   docker run --rm -p 8080:80 qwakk-game-web   # then open http://localhost:8080/game/

ARG NODE_IMAGE=node:24-slim
ARG NGINX_IMAGE=nginx:stable-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/client/package.json apps/client/
RUN npm ci --workspace @qwakk/client --workspace @qwakk/shared --no-audit --no-fund

COPY packages/shared packages/shared
COPY apps/client apps/client

# Baked into the bundle at build time. CapRover passes app env vars as build
# args, so this can be overridden in the qwakk-game-web app settings.
ARG VITE_GAME_SERVER=wss://play.qwakk.fun
ENV VITE_GAME_SERVER=${VITE_GAME_SERVER}
# Public builds never ship dev tools (fake network, ?server=, autopilot).
ENV VITE_DEVTOOLS=0
RUN npm run build -w @qwakk/client

# Precompressed copies for gzip_static. A copy is kept only when it is smaller.
RUN cd apps/client/dist && find . -type f \
      \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.json' \
         -o -name '*.svg' -o -name '*.glb' -o -name '*.bin' -o -name '*.wasm' \) \
      -size +1k | while read -r f; do \
        gzip -9 -k -n "$f"; \
        if [ "$(wc -c < "$f.gz")" -ge "$(( $(wc -c < "$f") * 95 / 100 ))" ]; then rm "$f.gz"; fi; \
      done

FROM ${NGINX_IMAGE} AS web
COPY deploy/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/apps/client/dist /usr/share/nginx/html/game
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

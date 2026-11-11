# One image for every role: api, worker (+ scheduler), web, migrate.
# Requires the autosoccer-sim submodule to be checked out (git submodule update --init).
FROM oven/bun:1.2.19 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/sim-adapter/package.json packages/sim-adapter/
COPY vendor/autosoccer-sim/packages/controller-runtime/package.json vendor/autosoccer-sim/packages/controller-runtime/
COPY vendor/autosoccer-sim/packages/controller-sdk/package.json vendor/autosoccer-sim/packages/controller-sdk/
COPY vendor/autosoccer-sim/packages/match-runner/package.json vendor/autosoccer-sim/packages/match-runner/
COPY vendor/autosoccer-sim/packages/sim-core/package.json vendor/autosoccer-sim/packages/sim-core/
COPY vendor/autosoccer-sim/packages/telemetry/package.json vendor/autosoccer-sim/packages/telemetry/
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun run --cwd apps/web build

FROM oven/bun:1.2.19 AS runtime
LABEL org.opencontainers.image.source="https://github.com/onomasticon/autosoccer"
WORKDIR /app
ENV NODE_ENV=production REPLAY_DIR=/data/replays
COPY --from=build /app /app
RUN mkdir -p /data/replays && chown -R bun:bun /data
USER bun
EXPOSE 4000 3000
# Default role: API. Override per service (see docker-compose.prod.yml).
CMD ["bun", "apps/server/src/api.ts"]

# The SSR web server runs on Node (react-dom's streaming server build is Node-specific).
FROM node:22-slim AS web
LABEL org.opencontainers.image.source="https://github.com/onomasticon/autosoccer"
WORKDIR /app/apps/web
ENV NODE_ENV=production PORT=3000
COPY --from=build /app /app
USER node
EXPOSE 3000
CMD ["node", "../../node_modules/@react-router/serve/dist/cli.js", "./build/server/index.js"]

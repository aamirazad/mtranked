# syntax=docker/dockerfile:1
# Multi-stage build for MT Ranked.
#   target "server": API + realtime + DB scripts (pick the process with `command:`)
#   target "web":    Caddy serving the static frontend and proxying /api and /ws

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
ARG PUBLIC_SOURCE_URL=""
ENV PUBLIC_SOURCE_URL=$PUBLIC_SOURCE_URL
RUN pnpm build

# production dependencies only (workspace packages are bundled into the dists)
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json api/
COPY realtime/package.json realtime/
COPY frontend/package.json frontend/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/engine/package.json packages/engine/
COPY packages/race-protocol/package.json packages/race-protocol/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:22-alpine AS server
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app ./
COPY --from=build /app/api/dist ./api/dist
COPY --from=build /app/realtime/dist ./realtime/dist
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/migrations ./packages/db/migrations
USER node
CMD ["node", "api/dist/index.js"]

FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/build /srv

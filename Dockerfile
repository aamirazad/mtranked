# syntax=docker/dockerfile:1
# Single-image build for MT Ranked: one container runs migrations, then the API,
# the realtime server and Caddy (static frontend + HTTPS + proxy for /api and /ws).
# See deploy/start.mjs for how the processes are supervised.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
ARG PUBLIC_SOURCE_URL=""
ENV PUBLIC_SOURCE_URL=$PUBLIC_SOURCE_URL
ARG PUBLIC_CONTACT_EMAIL=""
ENV PUBLIC_CONTACT_EMAIL=$PUBLIC_CONTACT_EMAIL
ARG PUBLIC_SENTRY_DSN=""
ENV PUBLIC_SENTRY_DSN=$PUBLIC_SENTRY_DSN
# optional build secret: when set, frontend source maps are uploaded to Sentry
RUN --mount=type=secret,id=sentry_auth_token,env=SENTRY_AUTH_TOKEN pnpm build

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

FROM caddy:2-alpine AS caddy

FROM node:22-alpine AS app
# Caddy binds 80/443 as the unprivileged node user
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
RUN apk add --no-cache libcap \
  && setcap cap_net_bind_service=+ep /usr/bin/caddy \
  && apk del libcap \
  && mkdir -p /data /config \
  && chown node:node /data /config
WORKDIR /app
ENV NODE_ENV=production \
  XDG_DATA_HOME=/data \
  XDG_CONFIG_HOME=/config
COPY --from=prod-deps /app ./
COPY --from=build /app/api/dist ./api/dist
COPY --from=build /app/realtime/dist ./realtime/dist
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/migrations ./packages/db/migrations
COPY --from=build /app/frontend/build /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY deploy/start.mjs ./start.mjs
ARG VERSION=dev
ENV MTR_VERSION=$VERSION
USER node
# caddy certificates and state; mount a volume here so they survive restarts
VOLUME ["/data", "/config"]
EXPOSE 80 443 443/udp
# migrations run before the servers start, so give the first check some time
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1:4001/api/health && wget -qO /dev/null http://127.0.0.1:4002/health || exit 1
CMD ["node", "start.mjs"]

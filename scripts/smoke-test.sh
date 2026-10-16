#!/usr/bin/env bash
# Boots an app image against throwaway Postgres and Redis containers and checks
# that migrations run, every process comes up healthy, Caddy serves the site and
# proxies the API, and the container shuts down cleanly. Used by CI.
#   bash scripts/smoke-test.sh ghcr.io/aamirazad/mtranked:main
set -euo pipefail
IMAGE=${1:?usage: smoke-test.sh <image>}
PORT=${SMOKE_PORT:-8080}
P=mtr-smoke-$$

cleanup() {
  docker rm -f "$P-app" "$P-pg" "$P-redis" >/dev/null 2>&1 || true
  docker network rm "$P" >/dev/null 2>&1 || true
}
fail() {
  echo "smoke test failed: $*" >&2
  docker logs "$P-app" 2>&1 | tail -100 >&2 || true
  exit 1
}
trap cleanup EXIT

docker network create "$P" >/dev/null
docker run -d --name "$P-pg" --network "$P" \
  -e POSTGRES_USER=mtr -e POSTGRES_PASSWORD=mtr -e POSTGRES_DB=mtr postgres:17-alpine >/dev/null
docker run -d --name "$P-redis" --network "$P" redis:7-alpine >/dev/null
for _ in $(seq 60); do docker exec "$P-pg" pg_isready -U mtr -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done
docker exec "$P-pg" pg_isready -U mtr -h 127.0.0.1 >/dev/null || fail "postgres did not start"

docker run -d --name "$P-app" --network "$P" -p "127.0.0.1:$PORT:80" \
  -e DATABASE_URL="postgres://mtr:mtr@$P-pg:5432/mtr" \
  -e REDIS_URL="redis://$P-redis:6379" \
  -e APP_URL="http://localhost:$PORT" \
  "$IMAGE" >/dev/null

echo "waiting for the container to report healthy..."
for _ in $(seq 120); do
  status=$(docker inspect -f '{{.State.Status}} {{.State.Health.Status}}' "$P-app")
  case $status in
    "running healthy") break ;;
    running*) sleep 1 ;;
    *) fail "container is $status" ;;
  esac
done
[ "$status" = "running healthy" ] || fail "container never became healthy ($status)"

base="http://127.0.0.1:$PORT"
check() { # check <path> <expected substring>
  body=$(curl -fsS --max-time 10 "$base$1") || fail "GET $1"
  grep -q "$2" <<<"$body" || fail "GET $1 did not contain '$2'"
  echo "ok: GET $1"
}
check /api/health '"ok":true'
check /api/season '{'
check / '<html'
check /leaderboard '<html' # SPA fallback

# websocket endpoint reaches the realtime server through Caddy (no ticket: rejected, not 404/502)
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 --http1.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "$base/ws" || true)
case $code in 404 | 502 | 503 | 000) fail "GET /ws returned $code" ;; esac
echo "ok: /ws reaches realtime ($code)"

docker stop -t 30 "$P-app" >/dev/null
exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$P-app")
[ "$exit_code" = 0 ] || fail "container exited with $exit_code on stop"
echo "ok: clean shutdown"
echo "smoke test passed"

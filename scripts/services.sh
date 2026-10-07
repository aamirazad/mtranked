#!/usr/bin/env bash
# Start/stop local dev services (Postgres, Redis, Mailpit) with Docker Compose.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-up}" = "down" ]; then
  docker compose -f docker-compose.dev.yml down
else
  docker compose -f docker-compose.dev.yml up -d --wait
fi

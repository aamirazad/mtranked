#!/bin/sh
# Restore a backup made by deploy/backup.sh into the running prod Postgres.
#
#   deploy/restore.sh backups/mtr-2026-01-01T030000Z.dump
#
# WARNING: this OVERWRITES the live database. Every table in the dump is
# dropped and recreated with the dump's contents. Stop the app first so nothing
# writes during the restore:
#
#   docker compose --env-file .env.production -f docker-compose.prod.yml stop api realtime
#
# The restore runs in a single transaction: if anything fails, nothing changes.
set -eu

[ $# -eq 1 ] && [ -f "$1" ] || { echo "usage: $0 <file.dump>" >&2; exit 2; }
dump=$1

cd "$(dirname "$0")/.."
compose() { docker compose --env-file .env.production -f docker-compose.prod.yml "$@"; }

if [ -n "$(compose ps -q --status running api realtime)" ]; then
  echo "warning: api/realtime are still running; stop them first (see the top of this script)." >&2
fi
echo "This will OVERWRITE the 'mtr' database with $dump."
printf 'Type "restore" to continue: '
read -r answer
[ "$answer" = "restore" ] || { echo "aborted"; exit 1; }

compose exec -T postgres pg_restore -U mtr -d mtr --clean --if-exists --no-owner \
  --single-transaction --exit-on-error <"$dump"
echo "restored $dump. Start the app again: docker compose --env-file .env.production -f docker-compose.prod.yml up -d"

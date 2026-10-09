#!/bin/sh
# Daily pg_dump loop, run by the `backup` service in docker-compose.prod.yml.
# Takes one dump on start, then one every BACKUP_INTERVAL_SECONDS. Connection
# comes from the standard PGHOST/PGUSER/PGPASSWORD/PGDATABASE variables.
# Dumps are written to a temp file and only renamed into place (and old ones
# pruned) after pg_dump succeeds, so a failed run never costs a good backup.
set -u

DIR=${BACKUP_DIR:-/backups}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}
INTERVAL=${BACKUP_INTERVAL_SECONDS:-86400}

case $KEEP_DAYS in '' | *[!0-9]* | 0) echo "backup: BACKUP_KEEP_DAYS must be a positive integer" >&2; exit 1 ;; esac
case $INTERVAL in '' | *[!0-9]* | 0) echo "backup: BACKUP_INTERVAL_SECONDS must be a positive integer" >&2; exit 1 ;; esac

umask 077 # dumps contain user data
mkdir -p "$DIR"
rm -f "$DIR"/.*.partial # left over from a run that was killed mid-dump

log() { echo "$(date -u +%FT%TZ) backup: $*"; }

backup() {
  name="$PGDATABASE-$(date -u +%Y-%m-%dT%H%M%SZ).dump"
  tmp="$DIR/.$name.partial"
  log "dumping $PGDATABASE@$PGHOST to $name"
  if pg_dump -Fc -f "$tmp" && pg_restore --list "$tmp" >/dev/null; then
    chown "$(stat -c %u:%g "$DIR")" "$tmp" # owned like the directory, so the host user can copy it off
    mv "$tmp" "$DIR/$name"
    log "ok: $name ($(du -h "$DIR/$name" | cut -f1))"
    # keep the last KEEP_DAYS days; only pruned after a successful dump
    find "$DIR" -maxdepth 1 -name "$PGDATABASE-*.dump" -mtime +"$((KEEP_DAYS - 1))" | while read -r old; do
      rm -f "$old" && log "pruned $(basename "$old")"
    done
  else
    rm -f "$tmp"
    log "FAILED, keeping existing backups" >&2
  fi
}

trap 'exit 0' TERM INT
while :; do
  backup
  sleep "$INTERVAL" &
  wait $!
done

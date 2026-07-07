#!/usr/bin/env bash
# MeetCopilot v2 — SQLite backup (run on the HOST via cron; decision 20).
#
# Uses sqlite3's online `.backup` (safe while the server holds the DB open, incl.
# WAL mode), gzips each snapshot to a timestamped file, then prunes old backups.
#
# Prereq on the VM:  sudo apt-get install -y sqlite3
# Cron (daily 03:17):
#   17 3 * * *  DB_DIR=/opt/meetcopilot/data BACKUP_DIR=/opt/meetcopilot/data/backups \
#               /opt/meetcopilot/scripts/backup.sh >> /var/log/meetcopilot-backup.log 2>&1
#
# Env knobs (all optional):
#   DB_DIR                 dir holding *.db          (default: /data)
#   BACKUP_DIR             where snapshots are written (default: $DB_DIR/backups)
#   BACKUP_RETENTION_DAYS  prune *.db.gz older than N (default: 14)
set -euo pipefail

DB_DIR="${DB_DIR:-/data}"
BACKUP_DIR="${BACKUP_DIR:-${DB_DIR}/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "[backup] sqlite3 not found — install it (apt-get install sqlite3)" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
ts="$(date +%Y%m%d_%H%M%S)"
found=0

shopt -s nullglob
for db in "$DB_DIR"/*.db; do
  found=1
  name="$(basename "$db" .db)"
  out="${BACKUP_DIR}/${name}_${ts}.db"
  echo "[backup] $db -> ${out}.gz"
  # Online backup: consistent snapshot without stopping the server.
  sqlite3 "$db" ".backup '${out}'"
  gzip -f "$out"
done

if [ "$found" -eq 0 ]; then
  echo "[backup] no *.db files in ${DB_DIR} — nothing to do" >&2
fi

# Retention prune.
find "$BACKUP_DIR" -maxdepth 1 -name '*.db.gz' -type f -mtime "+${RETENTION_DAYS}" -print -delete

echo "[backup] done ($(date -u +%FT%TZ))"

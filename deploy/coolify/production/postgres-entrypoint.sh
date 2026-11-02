#!/bin/sh
set -eu
# Fail before the upstream entrypoint can initialize PGDATA with placeholders.
for value in "${POSTGRES_PASSWORD:-}" "${RUNTIME_DB_PASSWORD:-}"; do
  case "$value" in *[!a-fA-F0-9]*|'') echo 'Database passwords must be independently generated hexadecimal secrets' >&2; exit 1 ;; esac
  [ "${#value}" -ge 64 ] || { echo 'Database password is too short' >&2; exit 1; }
done
[ "$POSTGRES_PASSWORD" != "$RUNTIME_DB_PASSWORD" ] || { echo 'Admin and runtime passwords must differ' >&2; exit 1; }
exec /usr/local/bin/docker-entrypoint.sh "$@"

#!/bin/sh
# Explicitly managed schemas for temporalio/server, not the development auto-setup image.
set -eu
: "${POSTGRES_SEEDS:?}" "${POSTGRES_USER:?}" "${POSTGRES_PWD:?}"
export PGHOST="$POSTGRES_SEEDS" PGPORT="${DB_PORT:-5432}" PGUSER="$POSTGRES_USER"
export PGPASSWORD="$POSTGRES_PWD" SQL_PASSWORD="$POSTGRES_PWD" PGCONNECT_TIMEOUT=10
history_db="${DBNAME:-temporal}"
visibility_db="${VISIBILITY_DBNAME:-temporal_visibility}"
history_path=/etc/temporal/schema/postgresql/v12/temporal/versioned
visibility_path=/etc/temporal/schema/postgresql/v12/visibility/versioned
mode="${1:-check-or-initialize}"
case "$mode" in check-or-initialize|upgrade) ;; *) echo 'Unknown Temporal schema operation' >&2; exit 1 ;; esac
if [ "$mode" = upgrade ] && [ "${2:-}" != --approve-schema-upgrade ]; then
  echo 'Temporal schema upgrades require --approve-schema-upgrade after backup/review' >&2
  exit 1
fi
table_count() {
  PGDATABASE="$1" psql -X -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'"
}
history_count=$(table_count "$history_db")
visibility_count=$(table_count "$visibility_db")
if [ "$history_count" = 0 ] && [ "$visibility_count" = 0 ]; then
  [ "$mode" = check-or-initialize ] && [ "${INITIALIZE_EMPTY_TEMPORAL_DATABASES:-false}" = true ] || {
    echo 'Temporal databases are empty; explicit fresh initialization is required' >&2; exit 1;
  }
  for db in "$history_db" "$visibility_db"; do
    temporal-sql-tool --plugin postgres12 --ep "$PGHOST" -p "$PGPORT" -u "$PGUSER" --db "$db" setup-schema -v 0.0
  done
  temporal-sql-tool --plugin postgres12 --ep "$PGHOST" -p "$PGPORT" -u "$PGUSER" --db "$history_db" update-schema -d "$history_path"
  temporal-sql-tool --plugin postgres12 --ep "$PGHOST" -p "$PGPORT" -u "$PGUSER" --db "$visibility_db" update-schema -d "$visibility_path"
elif [ "$history_count" = 0 ] || [ "$visibility_count" = 0 ]; then
  echo 'Partial Temporal initialization detected; stop and review, no automatic repair' >&2
  exit 1
elif [ "$mode" = upgrade ]; then
  # This path is never run by normal service startup.
  temporal-sql-tool --plugin postgres12 --ep "$PGHOST" -p "$PGPORT" -u "$PGUSER" --db "$history_db" update-schema -d "$history_path"
  temporal-sql-tool --plugin postgres12 --ep "$PGHOST" -p "$PGPORT" -u "$PGUSER" --db "$visibility_db" update-schema -d "$visibility_path"
fi
check_version() {
  expected=$(find "$2" -mindepth 1 -maxdepth 1 -type d -name 'v*' | sort -V | tail -n 1)
  expected=${expected##*/v}
  actual=$(PGDATABASE="$1" psql -X -A -t -v ON_ERROR_STOP=1 -c 'SELECT curr_version FROM schema_version')
  [ -n "$expected" ] && [ "$actual" = "$expected" ] || {
    echo 'Temporal schema version differs from the pinned server; use a reviewed manual upgrade' >&2; exit 1;
  }
}
check_version "$history_db" "$history_path"
check_version "$visibility_db" "$visibility_path"
echo 'Temporal schema readiness passed'

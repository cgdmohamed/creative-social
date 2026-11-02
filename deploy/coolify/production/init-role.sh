#!/bin/sh
# Official PostgreSQL entrypoint invokes this only for a new, empty PGDATA.
set -eu
: "${RUNTIME_DB_USER:?}" "${RUNTIME_DB_PASSWORD:?}" "${RUNTIME_DB_NAME:?}"
case "$RUNTIME_DB_USER" in postgres|temporal_admin|*[!a-z0-9_]*|'') echo 'Invalid runtime database user' >&2; exit 1 ;; esac
case "$RUNTIME_DB_PASSWORD" in *[!a-fA-F0-9]*|'') echo 'Runtime database password must be hexadecimal' >&2; exit 1 ;; esac
[ "${#RUNTIME_DB_PASSWORD}" -ge 64 ] || { echo 'Runtime database password is too short' >&2; exit 1; }
psql -X --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
\getenv app_user RUNTIME_DB_USER
\getenv app_password RUNTIME_DB_PASSWORD
\getenv app_db RUNTIME_DB_NAME
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE :"app_db" OWNER :"app_user";
REVOKE ALL ON DATABASE :"app_db" FROM PUBLIC;
SQL
if [ -n "${RUNTIME_VISIBILITY_DB:-}" ]; then
  psql -X --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
\getenv app_user RUNTIME_DB_USER
\getenv visibility_db RUNTIME_VISIBILITY_DB
CREATE DATABASE :"visibility_db" OWNER :"app_user";
REVOKE ALL ON DATABASE :"visibility_db" FROM PUBLIC;
SQL
fi

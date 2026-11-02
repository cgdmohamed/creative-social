#!/bin/sh
set -eu
: "${REDIS_PASSWORD:?}"
case "$REDIS_PASSWORD" in *[!a-fA-F0-9]*|'') echo 'Redis password must be hexadecimal' >&2; exit 1 ;; esac
[ "${#REDIS_PASSWORD}" -ge 64 ] || { echo 'Redis password is too short' >&2; exit 1; }
umask 077
# Password is not a redis-server command-line argument or a repository file.
printf 'requirepass %s\n' "$REDIS_PASSWORD" > /tmp/creative-redis.conf
exec redis-server /tmp/creative-redis.conf --appendonly yes --appendfsync everysec --maxmemory 256mb --maxmemory-policy noeviction --bind 0.0.0.0 --protected-mode yes

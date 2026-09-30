#!/bin/sh
set -e
# Idempotent superuser bootstrap — PB has no env-var superuser support, upsert every start.
if [ -n "$PB_ADMIN_EMAIL" ] && [ -n "$PB_ADMIN_PASSWORD" ]; then
  /pb/pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" --dir=/pb/pb_data >/dev/null 2>&1 || true
fi
exec /pb/pocketbase serve --http=0.0.0.0:8090 --dir=/pb/pb_data --migrationsDir=/pb/pb_migrations --hooksDir=/pb/pb_hooks "$@"

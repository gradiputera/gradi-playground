#!/bin/sh
# Refuses to start without configuration, applies migrations, then serves HTTP.
set -eu

if [ -z "${DATABASE_URL:-}" ] || [ -z "${SUPABASE_URL:-}" ]; then
  echo '{"level":"ERROR","message":"account-service stopped: DATABASE_URL and SUPABASE_URL must be set"}'
  exit 1
fi

cd /app
php artisan config:cache --no-interaction >/dev/null
php artisan migrate --force --no-interaction
exec frankenphp run --config /etc/frankenphp/Caddyfile

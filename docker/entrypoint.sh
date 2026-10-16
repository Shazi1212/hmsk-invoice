#!/bin/sh
# Prepares the data volume and, on first start, creates the admin user from
# INVOICE_ADMIN_USER / INVOICE_ADMIN_PASSWORD. Without a user the app runs in browser-only mode.
set -e
DATA="${INVOICE_DATA_DIR:-/data}"
mkdir -p "$DATA"

if [ -n "${INVOICE_ADMIN_PASSWORD:-}" ] && ! grep -q '"users"' "$DATA/config.json" 2>/dev/null; then
  if printf '%s' "$INVOICE_ADMIN_PASSWORD" | php /app/tools/set-password.php "$DATA" "${INVOICE_ADMIN_USER:-admin}" admin; then
    echo "invoice: created admin user '${INVOICE_ADMIN_USER:-admin}'"
  else
    echo "invoice: WARNING – could not create the admin user (password needs at least 10 characters). Running in browser-only mode." >&2
  fi
fi

chown -R www-data:www-data "$DATA"
chmod 700 "$DATA"
exec docker-php-entrypoint "$@"

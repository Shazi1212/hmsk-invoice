#!/usr/bin/env bash
# Build a static, browser-only copy of the app (no PHP, no server, data in localStorage).
#   tools/build-static.sh OUTDIR [CONFIG.js]
# OUTDIR gets index.html + assets; CONFIG.js replaces config.js (default: storage = 'browser', no links).
# All URLs inside the app are relative, so OUTDIR can be served from any sub-path (e.g. /apps/invoice/).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:?usage: tools/build-static.sh OUTDIR [CONFIG.js]}"
CFG="${2:-}"
mkdir -p "$OUT/assets"
for f in index.html app.css app.js i18n.js rules.js render.js xrechnung.js demo.js; do cp "public/$f" "$OUT/$f"; done
cp public/assets/icon.svg "$OUT/assets/icon.svg"
if [[ -n "$CFG" ]]; then cp "$CFG" "$OUT/config.js"; else
  printf '%s\n' "// Static build: browser-only storage." "window.INVOICE_CONFIG = { storage: 'browser', topLinks: [] };" > "$OUT/config.js"
fi
echo "Static build written to $OUT"

#!/usr/bin/env bash
# Generate the sample XRechnung files and validate them (XSD + EN 16931 + XRechnung 3.0 schematron).
# Downloads the official KoSIT validator configuration (XSD + compiled schematron) once into tools/.cache/.
# Needs: node + npm (for xslt3 = SaxonJS), xmllint, curl, unzip. No Java required.
set -euo pipefail
cd "$(dirname "$0")/.."

CFG_VERSION="v2026-08-31"
CFG_ZIP="xrechnung-3.0.2-validator-configuration-2026-08-31.zip"
CACHE=tools/.cache
mkdir -p "$CACHE"

if [[ ! -d "$CACHE/kosit/resources" ]]; then
  curl -fsSL -o "$CACHE/kosit.zip" "https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/download/$CFG_VERSION/$CFG_ZIP"
  unzip -q -o "$CACHE/kosit.zip" -d "$CACHE/kosit"
fi
if [[ ! -x "$CACHE/node_modules/.bin/xslt3" ]]; then
  npm install --silent --prefix "$CACHE" xslt3@2.7.0
fi

node tools/xrechnung_test.js
XSLT3="$CACHE/node_modules/.bin/xslt3" node tools/validate_xrechnung.js "$@"

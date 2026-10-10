#!/usr/bin/env bash
# Uploads the places index (built by scripts/build-places.mjs into
# .cache/places/) to R2: the MEDIA bucket of hour-web (`hour-media`, see
# apps/web/wrangler.jsonc), under places/v1/, where /api/places reads it.
#
#   scripts/upload-places.sh            # to the REMOTE bucket (production)
#   scripts/upload-places.sh --local    # to wrangler's local R2 state
#
# Production is not a default anybody should hit by accident: the remote run
# asks for the word «upload» first. It is ~2,900 small objects; uploads run 8
# at a time. A new build with a different shape gets a new prefix (v2) and a
# deploy that reads it, so a half-finished upload never serves mixed files.
#
# Requires wrangler logged in to the Hour account (`wrangler whoami`).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/.cache/places"
BUCKET="hour-media"
PREFIX="places/v1"
MODE="--remote"
[[ "${1:-}" == "--local" ]] && MODE="--local"

[[ -f "$SRC/index.json" ]] || { echo "no index in $SRC: run scripts/build-places.mjs first" >&2; exit 1; }

if [[ "$MODE" == "--remote" ]]; then
  count="$(find "$SRC" -name '*.json' | wc -l | tr -d ' ')"
  read -r -p "Upload $count files to R2 $BUCKET/$PREFIX (production)? Type upload: " ok
  [[ "$ok" == "upload" ]] || { echo "not uploaded"; exit 1; }
fi

cp "$ROOT/scripts/places-ATTRIBUTION.txt" "$SRC/ATTRIBUTION.txt"
cd "$ROOT/apps/web"
(cd "$SRC" && find . -type f \( -name '*.json' -o -name 'ATTRIBUTION.txt' \) | sed 's|^\./||') |
  xargs -P 8 -I{} npx wrangler r2 object put "$BUCKET/$PREFIX/{}" --file "$SRC/{}" "$MODE" >/dev/null
echo "uploaded to $BUCKET/$PREFIX ($MODE)"

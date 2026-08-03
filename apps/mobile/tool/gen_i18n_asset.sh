#!/usr/bin/env bash
# Regenerate the i18n asset from the SACRED translation source (MOB-I18N-01).
#
#   docs/extract/i18n-full.json      (single source, SACRED — read only)
#        │  verbatim copy (byte-identical; no pruning, no re-shaping)
#        ▼
#   apps/mobile/assets/i18n/i18n-full.json
#        │  rootBundle asset          (lib/i18n/juneflow_i18n.dart)
#        ▼
#   t() / tn() / tp() / tpat() at runtime
#
# Why a copy at all: Flutter can only bundle assets that live under the package
# root, and the sacred file sits at the repo root. The copy is byte-identical and
# verified by sha256 below, so it is a transport step, not a transformation — the
# same precedent packages/i18n/src/i18n-full.json already sets (identical hash).
#
# NEVER hand-edit assets/i18n/i18n-full.json and never translate a single word
# here: strings come only from the sacred file (PLAN.md §0 rule 2). A UI string
# with no entry there goes to BLOCKERS.md.
set -euo pipefail
cd "$(dirname "$0")/.."   # -> apps/mobile

REPO_ROOT="$(cd ../.. && pwd)"
SRC="$REPO_ROOT/docs/extract/i18n-full.json"
DEST="assets/i18n/i18n-full.json"

[ -f "$SRC" ] || { echo "FATAL: sacred source not found: $SRC" >&2; exit 1; }

echo "==> [1/2] copy sacred source verbatim"
mkdir -p "$(dirname "$DEST")"
cp "$SRC" "$DEST"

echo "==> [2/2] verify byte-identity (sha256)"
src_sum="$(shasum -a 256 "$SRC" | cut -d' ' -f1)"
dest_sum="$(shasum -a 256 "$DEST" | cut -d' ' -f1)"
if [ "$src_sum" != "$dest_sum" ]; then
  echo "FATAL: copy is not byte-identical ($src_sum != $dest_sum)" >&2
  exit 1
fi

echo "==> done. $DEST @ $src_sum — do not hand-edit."

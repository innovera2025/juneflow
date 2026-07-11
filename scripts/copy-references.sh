#!/usr/bin/env bash
# copy-references.sh — copy read-only source packs into their in-repo destinations.
# Idempotent: safe to re-run (mkdir -p + cp overwrite). NEVER modifies the sources.
# Sources (read-only, sacred): juneflow-extract/, design_handoff_juneflow/, pototype/
# Refs: Manifest group 5 · TASKS.md P0-BE-02 / P0-BE-03 / P0-BE-04 / P0-BE-05 · BLOCKERS B-001
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

EXTRACT_SRC="$REPO_ROOT/juneflow-extract"
HANDOFF_SRC="$REPO_ROOT/design_handoff_juneflow"
PROTO_SRC="$REPO_ROOT/pototype"

# --- 1) Cowork extract pack (8 files) -> docs/extract/ (sacred after copy) ---
mkdir -p "$REPO_ROOT/docs/extract"
cp "$EXTRACT_SRC"/* "$REPO_ROOT/docs/extract/"

# --- 2) Design handoff (full set) -> docs/handoff/ ---
mkdir -p "$REPO_ROOT/docs/handoff"
cp -R "$HANDOFF_SRC"/* "$REPO_ROOT/docs/handoff/"

# --- 3) Visual gate references: gallery g1..g5 (all .jpg, actual count 106 per B-001) ---
for g in g1 g2 g3 g4 g5; do
  mkdir -p "$REPO_ROOT/tests/visual/reference/gallery/$g"
  cp -R "$PROTO_SRC/gallery/$g/." "$REPO_ROOT/tests/visual/reference/gallery/$g/"
done

# --- 4) Visual gate references: shots (22 .png) ---
mkdir -p "$REPO_ROOT/tests/visual/reference/shots"
cp "$PROTO_SRC/shots/"*.png "$REPO_ROOT/tests/visual/reference/shots/"

# --- 5) Design tokens (fiori theme) -> packages/tokens/src/ (P0-BE-04) ---
mkdir -p "$REPO_ROOT/packages/tokens/src"
cp "$HANDOFF_SRC/tokens.css" "$HANDOFF_SRC/tokens.json" "$REPO_ROOT/packages/tokens/src/"

# --- 6) i18n translations (sacred, never re-translate) -> packages/i18n/src/ (P0-BE-05) ---
mkdir -p "$REPO_ROOT/packages/i18n/src"
cp "$EXTRACT_SRC/i18n-full.json" "$REPO_ROOT/packages/i18n/src/"

# --- Summary ---
echo "copy-references: done"
echo "  docs/extract files:          $(find "$REPO_ROOT/docs/extract" -type f | wc -l | tr -d ' ')"
echo "  docs/handoff files:          $(find "$REPO_ROOT/docs/handoff" -type f | wc -l | tr -d ' ')"
echo "  gallery reference .jpg:      $(find "$REPO_ROOT/tests/visual/reference/gallery" -name '*.jpg' | wc -l | tr -d ' ')"
echo "  shots reference .png:        $(find "$REPO_ROOT/tests/visual/reference/shots" -name '*.png' | wc -l | tr -d ' ')"
echo "  packages/tokens/src:         $(ls "$REPO_ROOT/packages/tokens/src" | tr '\n' ' ')"
echo "  packages/i18n/src:           $(ls "$REPO_ROOT/packages/i18n/src" | tr '\n' ' ')"

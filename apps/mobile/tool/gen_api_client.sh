#!/usr/bin/env bash
# Regenerate the Dart API client from the SACRED OpenAPI contract (P0-MOB-03).
#
#   packages/contracts/openapi.yaml  (single source, SACRED — read only)
#        │  tool/normalize_openapi.py   (derived working copy; sacred file untouched)
#        ▼
#   apps/mobile/build/openapi.normalized.yaml
#        │  swagger_parser              (pure Dart; no JRE on host)
#        ▼
#   apps/mobile/lib/api/generated/**    (retrofit-on-dio clients + json_serializable models)
#        │  build_runner                (*.g.dart serializers)
#        ▼
#   compiles into the app
#
# Hand-written API models are forbidden (root CLAUDE.md). NEVER edit lib/api/generated/**;
# change the contract (via Wei) and rerun this script.
#
# Prerequisites (dev host): python3 + pyyaml, Flutter/Dart, and swagger_parser
#   (dart pub global activate swagger_parser).
set -euo pipefail
cd "$(dirname "$0")/.."   # -> apps/mobile

echo "==> [1/3] normalize sacred contract into a generator-friendly working copy"
python3 tool/normalize_openapi.py

echo "==> [2/3] generate Dart client (swagger_parser)"
dart pub global run swagger_parser:swagger_parser -f swagger_parser.yaml

echo "==> [3/3] build_runner (json_serializable + retrofit .g.dart)"
dart run build_runner build --delete-conflicting-outputs

echo "==> done. Generated client at lib/api/generated/ — do not hand-edit."

#!/usr/bin/env bash
# seed.sh — root seed entrypoint. Delegates to the @juneflow/db workspace seed.
# TODO(P0-BE-10): real seed lands in packages/db (from docs/extract/MOCK-DATA.md summary,
# normalize text FKs -> real *_id, apply rulings C3/C6/C9/C10, persist — no reseed on reload).
set -euo pipefail

exec pnpm --filter @juneflow/db seed "$@"

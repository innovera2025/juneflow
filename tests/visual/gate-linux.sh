#!/usr/bin/env bash
# tests/visual/gate-linux.sh — run Gate G5 in the SAME Linux image CI uses.
#
# WHY THIS EXISTS. reference/app-baseline/ is captured on linux/amd64 — the
# platform CI runs on, and the platform named in the provenance note in
# screens.manifest.json. A browser on a macOS host renders the same DOM
# differently enough that EVERY screen fails: measured twice (2026-08-18 and
# 2026-08-22), one variable, identical stack / pack / session / frozen instant,
# 99 of 99 rows failing in a 0.0123-0.0832 band against 9 on the host.
#
# The decisive row is `login`: it is the only screen in the manifest that makes
# ZERO API requests (measured — promote-evidence.json), so it has no seed data,
# no dates and no session-dependent content, and it still differed by 1.2%. No
# frozen instant, mask or seed fix can reach that. So "run the gate locally"
# cannot mean "run it on the host": it means putting the browser in the image the
# pack was captured in.
#
# It does NOT start the stack. Bring one up first, seeded with the SAME frozen
# instant the pack was captured at (ci.yml Stage 6 and the manifest note both
# name it), then point this at its compose network:
#
#   SEED_FROZEN_NOW=2026-08-07T12:22:42+07:00 \
#     docker compose -p juneflow -f infra/docker-compose.yml up -d --wait
#   bash tests/visual/gate-linux.sh
#
# Env:
#   COMPOSE_PROJECT_NAME  compose project whose network to join (default juneflow)
#   VISUAL_DOCKER_NETWORK override the network name outright
#   VISUAL_BASE_URL       origin INSIDE the network (default http://web — the web
#                         image's nginx proxies /api to the api service, so it is
#                         same-origin and no side-car proxy is needed)
#   VISUAL_STORAGE_STATE  reuse a session file instead of minting one
#   VISUAL_PROMOTE_BASELINE / VISUAL_PROMOTE_EXPECT_USER   passed through
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)

# MUST track the @playwright/test pin in tests/package.json + pnpm-lock.yaml. A
# different image is a different Chromium build, and a different Chromium build
# moves the pixels — that is B-413, which had to be closed before any G5 number
# could be trusted.
IMG=${VISUAL_PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.61.1-jammy}
PROJECT=${COMPOSE_PROJECT_NAME:-juneflow}
NET=${VISUAL_DOCKER_NETWORK:-${PROJECT}_default}
BASE=${VISUAL_BASE_URL:-http://web}

docker network inspect "$NET" >/dev/null 2>&1 || {
  echo "no docker network '$NET' — is the stack up? (docker compose -p $PROJECT -f infra/docker-compose.yml up -d --wait)" >&2
  exit 1
}

# --- session ---------------------------------------------------------------
# B-411 refuses the run without one; B-415 is why it is minted for $BASE and not
# for the host's published port: Playwright matches the storageState origin
# EXACTLY, and a mismatch captures 99 logged-out screens that fail in the shape
# of drift.
CLEAN_STATE=""
trap 'if [ -n "$CLEAN_STATE" ]; then rm -f "$CLEAN_STATE"; fi' EXIT
STATE_HOST=${VISUAL_STORAGE_STATE:-}
if [ -z "$STATE_HOST" ]; then
  STATE_HOST=$(mktemp "${TMPDIR:-/tmp}/juneflow-visual-state.XXXXXX")
  CLEAN_STATE=$STATE_HOST
  docker run --rm --network "$NET" -v "$STATE_HOST:/state.json" "$IMG" node -e '
    const base = process.argv[1];
    fetch(base + "/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "wipha@rungrueang.co.th", password: "juneflow-dev" }),
    })
      .then((r) => r.json())
      .then(({ token }) => {
        if (!token) throw new Error("login returned no token — the gate would capture logged-out screens (B-411)");
        require("node:fs").writeFileSync("/state.json", JSON.stringify({
          cookies: [],
          origins: [{ origin: base, localStorage: [{ name: "juneflow-token", value: token }] }],
        }));
        console.log(`minted a session for ${base} (token ${token.length} chars)`);
      })
      .catch((e) => {
        console.error(String(e));
        process.exit(1);
      });
  ' "$BASE"
fi

# --- the gate --------------------------------------------------------------
docker run --rm --network "$NET" \
  -v "$ROOT:/repo" -v "$STATE_HOST:/state.json" -w /repo/tests \
  -e VISUAL_BASE_URL="$BASE" \
  -e VISUAL_STORAGE_STATE=/state.json \
  -e VISUAL_PROMOTE_BASELINE="${VISUAL_PROMOTE_BASELINE:-}" \
  -e VISUAL_PROMOTE_EXPECT_USER="${VISUAL_PROMOTE_EXPECT_USER:-}" \
  "$IMG" npx --no-install playwright test --config visual/playwright.visual.config.ts --workers=1

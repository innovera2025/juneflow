# live-G5 harness — reproducibility notes (why it took 3 debug rounds + the fixes)

> orch-B · 2026-07-17 · captured after the batch-8 live-G5 sweep. Goal: the NEXT live-G5 run is push-button, not a 3-round debug. The committed harness (`tests/visual/`) is NOT run-ready out of the box; each historical round set it up ad-hoc (the committed `screens.manifest.json` still holds only the `dashboard` row). This documents every gap + the fix so it can be made permanent deliberately (with a verification run).

## The runner
`agents/orch-b-recon/live-g5-batch8.sh <dev-sha>` (full ~28-screen sweep) and `live-g5-finance.sh <dev-sha>` (7 finance screens). They spin up an isolated compose stack (own project + offset ports), inject an auth storageState, build the manifest, run `test:visual`, collect diffs, tear down. Both are read-only vs `tests/visual/reference/`.

## Gap 1 — `git worktree add` does NOT install deps  ✅ fixed in runner
Symptom: `sh: playwright: command not found` → `test:visual` never runs. The throwaway worktree has no `node_modules`. Fix (in both runners): `pnpm install --frozen-lockfile --prefer-offline` in the worktree + `pnpm --dir tests exec playwright install chromium` before the gate.

## Gap 2 — capture mode has no login  ✅ fixed in runner
`visual-gate.spec.ts` capture does `page.goto('/#/<route>')` with **no auth step** (`globalSetup` only clears results). Unauthenticated → the app renders the login screen → every capture mismatches. Fix (in runner): `POST /api/v1/auth/login` as seed user **`wipha@rungrueang.co.th` / `juneflow-dev`** (MD/L4, sees every screen) → `{token}` → write a Playwright `storageState` with localStorage key **`juneflow-token`** (`apps/web/src/auth-token.ts`) for the web origin → patch the throwaway config's `use` to read `storageState` from `VISUAL_STORAGE_STATE`.

## Gap 3 — viewport must match reference dimensions  ⚠️ PARTIAL (g5 still breaks)
References are NOT one size: **g1/g2 = 1600x1000**, **g5 = 924x540** (e.g. `gl.coa` uses g5/08). The committed config sets **no viewport** → Playwright default **1280x720** → EVERY screen auto-FAILs on `dimension mismatch` (PLAN.md §0: size change = layout change). The runner patches a **global** `viewport: {1600,1000}` — correct for g1/g2, but **g5-referenced screens (gl.coa, and any future g5) still dimension-mismatch**.
**Proper fix (not yet done — needs a verification run):** set the viewport **per-screen** from each reference's real dimensions. Two clean ways:
  (a) manifest carries a `viewport` field per row; the runner's manifest-build derives it (g5/* → 924x540, else 1600x1000), and the spec does `await page.setViewportSize(entry.viewport)` before `page.screenshot`; or
  (b) the spec reads the reference image header for its width/height and sets the viewport from it (fully automatic, no per-row data).
  Pair with `screenshot({ fullPage: false })` (viewport-clip) so the shot dimensions equal the viewport exactly (references are fixed-size, not full-scroll; the Fiori shell is 100vh so a viewport clip = the whole shell).

## Gap 4 — lossy-JPG references + threshold 0 ⇒ the pixel gate ALWAYS FAILs (by design)
References are lossy `.jpg`; captures are `.png`; `VISUAL_MAX_DIFF_PIXEL_RATIO=0` (exact). JPEG compression + font anti-aliasing + **seed data ≠ prototype mock data** shift a large fraction of pixels even when the layout is identical. In the batch-8 sweep, **every** screen — including on-main, already-promoted, rounds-1-4-passed screens — landed in the same 0.49–0.76 diff band. The automated verdict is therefore NOT the gate.
**How to read a live-G5 result (until Wei relaxes the threshold via BLOCKERS):**
  1. **Dimension** must match (Gap 3) — a true dimension mismatch IS a real layout change.
  2. **Relative ratio** — compare each review screen's diff ratio to the on-main known-good baseline. Same band = no structural regression; a clear outlier above the baseline = investigate.
  3. **Visual spot-check** the diff PNGs (`*-results/diff/*.png`) for structure (sidebar/KPI/labels/positions). Red overlay = per-pixel diff, not layout diff.
  (This is what rounds 1-4's "0 regression" actually meant — a visual review, not an automated pass.)

## Gap 5 — manifest ↔ self-check drift
`screens.manifest.json` has a row `screen:"dashboard"` but the spec self-check (`visual-gate.spec.ts` "the app-shell manifest row parses") expects `screen:"app-shell"` with masks `["sidebar-logo-b044","content-area-b048"]`. → 1 failing self-check on dev regardless of the sweep. Fix: align the manifest row name (or the self-check) — pick one canonical name.

## Recommendation
Make live-G5 push-button by folding Gaps 1–3 + 5 into the **committed** harness (config viewport-per-screen + storageState-from-env; runner with install; manifest self-check aligned), then a single verification run confirms the self-checks stay green and captures compare at correct dimensions. Gap 4 (threshold vs lossy-jpg) stays a Wei/BLOCKERS decision. Until then, the runner here works for g1/g2 screens; g5 screens need the per-screen-viewport fix before their verdicts are meaningful.

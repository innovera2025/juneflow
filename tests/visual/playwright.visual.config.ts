import { defineConfig } from "@playwright/test";

// tests/visual — Visual gate harness config (Gate G5 — PLAN.md §0 + §9).
//
// Reference images live in tests/visual/reference/ (copied verbatim from
// pototype/gallery/g1-g5: 106 .jpg, all of them + pototype/shots/: 22 .png —
// populated by scripts/copy-references, P0-BE-03). NEVER modify or delete
// anything under reference/ — it is the ground truth of the visual gate.
//
// The harness (visual-gate.spec.ts) does NOT use toHaveScreenshot() because that
// matcher decodes .png only, while 106/128 references are .jpg. Instead lib/compare.ts
// decodes jpg + png alike inside the chromium browser Playwright already drives
// (no native image dependency) and writes a readable diff report + diff PNGs to
// tests/visual/.results/ (gitignored — never under reference/).
//
// Comparison rules (PLAN.md §0): layout structure, menu/column order + labels,
// color tokens, and KPI/button/tab positions must match the reference. Only
// data numbers (from the central seed) may differ, plus anything Wei explicitly
// approved via BLOCKERS.md. Thresholds start strict (VISUAL_MAX_DIFF_PIXEL_RATIO=0);
// relaxing them for lossy-jpg real screenshots is a Wei/BLOCKERS decision, not a
// silent harness default.
export default defineConfig({
  testDir: ".",
  testIgnore: ["reference/**"],
  // B-206=ก (Wei · 2026-07-31): the G5 gate runs SEQUENTIALLY, enforced by the config
  // rather than by runner discipline. Proven cause of the long-standing flake: under
  // parallel load the capture lands on a deterministic PRE-DATA frame (KPIs 0, empty
  // table bodies, skeleton pickers — chrome/labels/columns/colours pixel-identical), so
  // the failing SET tracks load, not screens: a cold-container 8-worker run failed 8 rows
  // (land.bank 49.7% · pm.wo 33.9% · solar.monitor 32.5% · ar.invoice 31.4% · gl.jv 25.4%
  // · subcon.contracts 23.3% · pm.dashboard 16.5% · dashboard 16.2%) — a DIFFERENT set
  // than an earlier parallel run, while two rows reproduced byte-identical diff counts
  // across days/branches. Sequential = 48/48 PASS twice with identical per-row diffs.
  // Cost ~2 min per full run; a flaky gate is a gate people learn to ignore (B-186 was
  // only a note, which is not enforcement).
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  outputDir: "./.results/playwright",
  globalSetup: "./lib/setup.ts",
  globalTeardown: "./lib/teardown.ts",
  use: {
    baseURL: process.env.VISUAL_BASE_URL ?? "http://localhost:5173",
    // Auth for capture mode (P0-QA-04 fold): a run points VISUAL_STORAGE_STATE at a
    // Playwright storageState file (localStorage bearer token — apps/web/src/auth-token.ts
    // key `juneflow-token`) so /#/<route> renders the authed shell, not the login screen.
    // Unset (self-check / no-app) → undefined = no state. NOT unchanged behaviour since B-411: if the app IS reachable, an unset value now REFUSES the whole run instead of capturing 99 logged-out screens that fail in the shape of drift. Unset with no app still skips.
    storageState: process.env.VISUAL_STORAGE_STATE || undefined,
  },
});

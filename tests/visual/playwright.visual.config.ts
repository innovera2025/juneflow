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
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  outputDir: "./.results/playwright",
  globalSetup: "./lib/setup.ts",
  globalTeardown: "./lib/teardown.ts",
  use: {
    baseURL: process.env.VISUAL_BASE_URL ?? "http://localhost:5173",
  },
});

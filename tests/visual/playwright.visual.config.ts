import { defineConfig } from "@playwright/test";

// tests/visual — Visual gate harness config (Gate G5 — PLAN.md §0 + §9).
//
// Reference images live in tests/visual/reference/ (copied verbatim from
// pototype/gallery/g1-g5: 106 .jpg, all of them + pototype/shots/: 22 .png —
// populated by scripts/copy-references, P0-BE-03). NEVER modify or delete
// anything under reference/ — it is the ground truth of the visual gate.
//
// Comparison rules (PLAN.md §0): layout structure, menu/column order + labels,
// color tokens, and KPI/button/tab positions must match the reference. Only
// data numbers (coming from the central seed) may differ, plus anything Wei
// explicitly approved via BLOCKERS.md. Screens without a reference image must
// first be captured from the same screen in pototype/Juneflow Fiori.html.
//
// TODO(P0-QA-04): implement the screenshot-comparison specs + readable diff
// report (depends on P0-QA-01 reference index). Note: toHaveScreenshot()
// compares .png only, while 106 gallery references are .jpg — the comparison
// step must handle jpg references (convert on the fly or use a custom matcher)
// WITHOUT touching the originals in reference/.
export default defineConfig({
  testDir: ".",
  testIgnore: ["reference/**"],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  // Point snapshot expectations at the reference pack.
  snapshotDir: "./reference",
  // Flat naming: expect(page).toHaveScreenshot("g1/<file>.png") resolves into
  // reference/. TODO(P0-QA-04): align names with tests/visual/reference-index.md
  // (image -> screen/route mapping from P0-QA-01).
  snapshotPathTemplate: "{snapshotDir}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      // TODO(P0-QA-04): calibrate masks/thresholds so ONLY seed-data numbers may
      // differ, per PLAN.md §0 — start strict, loosen only via approved masks.
      maxDiffPixelRatio: 0,
    },
  },
  use: {
    baseURL: process.env.VISUAL_BASE_URL ?? "http://localhost:5173",
  },
});

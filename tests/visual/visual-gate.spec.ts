import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { compareImages, fileToDataUrl } from "./lib/compare";
import { MASK_REGISTRY, resolveMasks } from "./lib/masks";
import { recordScreen } from "./lib/report";

// tests/visual/visual-gate.spec.ts — Visual gate harness (Gate G5 · PLAN.md §0 + §9).
//
// Two run modes in one harness:
//   1. self-check  — runs NOW, no app required: proves the jpg-aware decode +
//      pixel-diff + readable-report pipeline end-to-end against the real
//      reference pack (read-only). This is what makes G5's "harness runs + diff
//      report readable" verifiable before apps/web exists.
//   2. capture     — real screenshots vs reference, driven by screens.manifest.json.
//      Skipped (not failed) while the manifest is empty or VISUAL_BASE_URL is
//      unreachable, so the gate stays green during scaffold (apps/web pending).
//
// Iron rules: reference/ is read-only ground truth (skill visual-gate); expected
// values come from spec/reference only — never from implementation (tests/CLAUDE.md).

const REF_DIR = join(__dirname, "reference");
// A stable, known-present reference used only to exercise the engine.
const SELF_CHECK_REF = join(REF_DIR, "gallery", "g1", "01-s.jpg");

test.describe("visual gate · engine self-check (no app required)", () => {
  test("identical reference compares as PASS with zero diff", async ({ page }) => {
    const candidate = fileToDataUrl(SELF_CHECK_REF); // same bytes → identical raster
    const r = await compareImages(page, SELF_CHECK_REF, candidate, "self:identical");
    expect(r.diffPixels).toBe(0);
    expect(r.dimensionMismatch).toBe(false);
    expect(r.verdict).toBe("PASS");
    recordScreen({ ...r, screen: "self-check/identical", kind: "self-check" });
  });

  test("a perturbed candidate is detected and reported as FAIL", async ({ page }) => {
    // Build a PNG from the reference with a block of pixels overwritten.
    const refDataUrl = fileToDataUrl(SELF_CHECK_REF);
    const perturbed = await page.evaluate(async (src) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = src;
      });
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      // Overwrite a visible block — a real layout/content change.
      ctx.fillStyle = "#ff00ff";
      ctx.fillRect(0, 0, Math.min(50, c.width), Math.min(50, c.height));
      return c.toDataURL("image/png");
    }, refDataUrl);

    const r = await compareImages(page, SELF_CHECK_REF, perturbed, "self:perturbed");
    expect(r.diffPixels).toBeGreaterThan(0);
    expect(r.verdict).toBe("FAIL");
    recordScreen({ ...r, screen: "self-check/perturbed", kind: "self-check" });
  });

  test("a size mismatch auto-FAILs as a layout change", async ({ page }) => {
    const tiny =
      "data:image/png;base64," +
      (await page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 8;
        c.height = 8;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, 8, 8);
        return c.toDataURL("image/png").split(",")[1];
      }));
    const r = await compareImages(page, SELF_CHECK_REF, tiny, "self:size-mismatch");
    expect(r.dimensionMismatch).toBe(true);
    expect(r.verdict).toBe("FAIL");
    recordScreen({ ...r, screen: "self-check/size-mismatch", kind: "self-check" });
  });

  test("a candidate LARGER than the reference auto-FAILs (no silent pass)", async ({ page }) => {
    // Regression guard (P0-FIX-04 / QA-04 audit): the ref-sized diff loop never
    // inspects the extra candidate area, so a larger candidate whose overlapping
    // region matches produces diffPixels=0. It must still FAIL on dimension
    // mismatch — a size change is a layout change per PLAN.md §0.
    const bigger = await page.evaluate(async (src) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = src;
      });
      const c = document.createElement("canvas");
      // Larger in both dimensions; overlapping region is a pixel-perfect copy of
      // the reference, so the ONLY signal is the dimension mismatch.
      c.width = img.naturalWidth + 40;
      c.height = img.naturalHeight + 40;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      return c.toDataURL("image/png");
    }, fileToDataUrl(SELF_CHECK_REF));

    const r = await compareImages(page, SELF_CHECK_REF, bigger, "self:size-larger");
    expect(r.candDims.w).toBeGreaterThan(r.refDims.w);
    expect(r.candDims.h).toBeGreaterThan(r.refDims.h);
    expect(r.diffPixels).toBe(0); // overlapping region matches exactly — the trap
    expect(r.dimensionMismatch).toBe(true);
    expect(r.verdict).toBe("FAIL"); // ...yet it must NOT pass silently
    recordScreen({ ...r, screen: "self-check/size-larger", kind: "self-check" });
  });
});

// ---- mask self-check: B-044 logo-region exclusion (P0-QA-07) ------------------

/** Paint solid magenta blocks over a decoded copy of `src` at the given rects. */
async function perturbAt(
  page: Page,
  src: string,
  rects: Array<{ x: number; y: number; w: number; h: number }>
): Promise<string> {
  return page.evaluate(
    async ({ src, rects }) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = src;
      });
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      ctx.fillStyle = "#ff00ff";
      for (const r of rects) ctx.fillRect(r.x, r.y, r.w, r.h);
      return c.toDataURL("image/png");
    },
    { src, rects }
  );
}

test.describe("visual gate · mask regions (B-044 · P0-QA-07)", () => {
  const LOGO_MASK = MASK_REGISTRY["sidebar-logo-b044"];
  const maskRegions = resolveMasks(["sidebar-logo-b044"]);
  // A change fully INSIDE the mask — the reference's own logo lockup area.
  const insideRect = { x: 16, y: 16, w: 100, h: 36 };
  // A change clearly OUTSIDE the mask (main content area).
  const outsideRect = { x: 400, y: 400, w: 50, h: 50 };

  test("a candidate differing ONLY inside the mask PASSes, masked pixels reported", async ({ page }) => {
    const cand = await perturbAt(page, fileToDataUrl(SELF_CHECK_REF), [insideRect]);
    const r = await compareImages(page, SELF_CHECK_REF, cand, "self:mask-inside", { maskRegions });
    expect(r.diffPixels).toBe(0); // exclusion works — nothing outside differs
    expect(r.maskedPixels).toBe(LOGO_MASK.width * LOGO_MASK.height); // reported
    expect(r.maskedDiffPixels).toBeGreaterThan(0); // the hidden difference is visible in the report
    expect(r.dimensionMismatch).toBe(false);
    expect(r.verdict).toBe("PASS");
    expect(r.note).toContain("masked");
    expect(r.note).toContain("B-044");
    recordScreen({ ...r, screen: "self-check/mask-inside", kind: "self-check" });
  });

  test("a candidate differing inside AND outside the mask FAILs", async ({ page }) => {
    const cand = await perturbAt(page, fileToDataUrl(SELF_CHECK_REF), [insideRect, outsideRect]);
    const r = await compareImages(page, SELF_CHECK_REF, cand, "self:mask-in+out", { maskRegions });
    expect(r.maskedDiffPixels).toBeGreaterThan(0); // inside part masked...
    expect(r.diffPixels).toBeGreaterThan(0); // ...but the outside part still counts
    expect(r.verdict).toBe("FAIL"); // mask is NOT a general loosening
    recordScreen({ ...r, screen: "self-check/mask-in-out", kind: "self-check" });
  });

  test("a size mismatch still auto-FAILs even with the mask configured", async ({ page }) => {
    // P0-FIX-04 interplay: masks must never rescue a dimension mismatch.
    const bigger = await page.evaluate(async (src) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = src;
      });
      const c = document.createElement("canvas");
      c.width = img.naturalWidth + 40;
      c.height = img.naturalHeight + 40;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      return c.toDataURL("image/png");
    }, fileToDataUrl(SELF_CHECK_REF));
    const r = await compareImages(page, SELF_CHECK_REF, bigger, "self:mask-size", { maskRegions });
    expect(r.dimensionMismatch).toBe(true);
    expect(r.verdict).toBe("FAIL");
    recordScreen({ ...r, screen: "self-check/mask-size-larger", kind: "self-check" });
  });

  test("a mask region without a blocker citation is rejected", async ({ page }) => {
    await expect(
      compareImages(page, SELF_CHECK_REF, fileToDataUrl(SELF_CHECK_REF), "self:mask-nocite", {
        maskRegions: [{ x: 0, y: 0, width: 10, height: 10, reason: "logo looks different" }],
      })
    ).rejects.toThrow(/BLOCKERS\.md/);
  });

  test("an unknown mask registry key is rejected", async () => {
    expect(() => resolveMasks(["sidebar-logo-b999"])).toThrow(/Unknown mask/);
  });
});

// ---- capture mode: real screens vs reference (pending apps/web) ---------------

interface ManifestEntry {
  screen: string;
  route: string;
  ref: string; // relative to tests/visual/reference/
  // Opt-in Wei-approved mask keys from lib/masks.ts MASK_REGISTRY (P0-QA-07).
  // Shell-bearing screens list "sidebar-logo-b044"; screens without the
  // sidebar lockup (e.g. login, P1-WEB-01) must omit this field.
  masks?: string[];
}

function loadManifest(): ManifestEntry[] {
  try {
    const raw = JSON.parse(
      readFileSync(join(__dirname, "screens.manifest.json"), "utf8")
    );
    return Array.isArray(raw.screens) ? raw.screens : [];
  } catch {
    return [];
  }
}

async function appReachable(baseURL: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(baseURL, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

test.describe("visual gate · capture mode (real screens vs reference)", () => {
  const manifest = loadManifest();
  const baseURL = process.env.VISUAL_BASE_URL ?? "http://localhost:5173";

  test("capture manifest is wired", async () => {
    test.skip(
      manifest.length === 0,
      "screens.manifest.json is empty — apps/web screens not built yet (P0-WEB-05+)."
    );
    expect(manifest.length).toBeGreaterThan(0);
  });

  for (const entry of manifest) {
    test(`${entry.screen} (${entry.route}) matches reference`, async ({ page }) => {
      test.skip(
        !(await appReachable(baseURL)),
        `app not reachable at ${baseURL} — start it (docker compose / pnpm dev) to run capture mode.`
      );
      await page.goto(`${baseURL}/#/${entry.route}`);
      const shot = await page.screenshot({ fullPage: true });
      const candidate =
        "data:image/png;base64," + shot.toString("base64");
      const refPath = join(REF_DIR, entry.ref);
      const r = await compareImages(page, refPath, candidate, `capture:${entry.route}`, {
        maskRegions: resolveMasks(entry.masks),
      });
      recordScreen({ ...r, screen: entry.screen, kind: "capture" });
      expect(r.verdict, r.note).toBe("PASS");
    });
  }
});

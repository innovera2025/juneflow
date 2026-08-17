import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { compareImages, fileToDataUrl } from "./lib/compare";
import { MASK_REGISTRY, resolveMasks } from "./lib/masks";
import { recordScreen, RESULTS_DIR } from "./lib/report";
import {
  AUTH_TOKEN_KEY,
  MAX_IDENTICAL_GROUP,
  MAX_NEAR_DUP_DISTANCE,
  NEAR_DUP_ADVISORY_DISTANCE,
  PROMOTE_ENV,
  PromoteRefusal,
  assertAuthenticatedSession,
  assertPlausiblyDistinct,
  captureProblems,
  duplicateGroups,
  imageSignature,
  isPromoteMode,
  nearDuplicateReport,
  openPromoteSession,
  planPromotion,
  promoteAuthPreflight,
  readPngSize,
  renderPromoteManifest,
  sha256,
  signatureDistance,
} from "./lib/promote";
import type { CaptureEvidence, PromoteRow } from "./lib/promote";

// The app's "not ported yet" body copy. Recorded as promote evidence (never a
// refusal on its own — a manifest row may legitimately be a shell-only screen),
// so a human reviewing a re-baseline sees which screens were placeholders.
const PLACEHOLDER_TEXT = "กำลังพัฒนา — เลือกเมนูอื่นทางซ้าย";

// The contract's single `servers` url (packages/contracts/openapi.yaml), which
// is also apps/web/src/api-client.ts's default API_BASE_URL. Every data request
// the app makes goes through this path, so it is what the response listener
// watches to tell "this screen asked for data and was refused" apart from "this
// screen is empty by design".
const API_BASE_PATH = "/api/v1";

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

// ---- content-area crop self-check: B-048 shell-only G5 (P0-QA-08) -------------
//
// A shell-bearing route ships the chrome (sidebar x<244 + topbar y<56) before
// its body screen is ported, so the content region (x>=244 AND y>=56) has no
// counterpart to compare against yet. The "content-area-b048" mask excludes
// exactly that region so G5 compares ONLY the chrome. These self-checks prove:
//   (1) a change in the BODY passes (correctly excluded),
//   (2) a change in the CHROME still fails (mask is spatial, not a loosener),
//   (3) a dimension mismatch still auto-FAILs (P0-FIX-04 untouched).
test.describe("visual gate · content-area crop (B-048 · P0-QA-08)", () => {
  const CONTENT_MASK = MASK_REGISTRY["content-area-b048"];
  const maskRegions = resolveMasks(["content-area-b048"]);
  // SELF_CHECK_REF is gallery/g1/01-s.jpg (1600x1000). The mask (244,56,1356,944)
  // clips to the full bottom-right content rectangle of that reference.
  const clippedMaskedPixels = (1600 - 244) * (1000 - 56); // 1356*944 = 1,280,064
  // A change fully INSIDE the content region (body area to be masked).
  const bodyRect = { x: 800, y: 500, w: 120, h: 120 };
  // A change in the TOPBAR chrome band (x>=244 but y<56 — must NOT be masked).
  const topbarRect = { x: 800, y: 12, w: 120, h: 30 };
  // A change in the SIDEBAR chrome column (x<244 — must NOT be masked).
  const sidebarRect = { x: 40, y: 400, w: 120, h: 30 };

  test("a candidate differing ONLY in the content area PASSes, masked pixels reported", async ({ page }) => {
    const cand = await perturbAt(page, fileToDataUrl(SELF_CHECK_REF), [bodyRect]);
    const r = await compareImages(page, SELF_CHECK_REF, cand, "self:content-inside", { maskRegions });
    expect(r.diffPixels).toBe(0); // the whole content change is excluded
    expect(r.maskedPixels).toBe(clippedMaskedPixels); // full content rectangle masked
    expect(r.maskedDiffPixels).toBeGreaterThan(0); // hidden difference still visible in the report
    expect(r.dimensionMismatch).toBe(false);
    expect(r.verdict).toBe("PASS");
    expect(r.note).toContain("masked");
    expect(r.note).toContain("B-048");
    recordScreen({ ...r, screen: "self-check/content-inside", kind: "self-check" });
  });

  test("a change in the TOPBAR chrome (x>=244, y<56) still FAILs under the content mask", async ({ page }) => {
    const cand = await perturbAt(page, fileToDataUrl(SELF_CHECK_REF), [topbarRect]);
    const r = await compareImages(page, SELF_CHECK_REF, cand, "self:content-topbar", { maskRegions });
    expect(r.diffPixels).toBeGreaterThan(0); // topbar is chrome — NOT masked
    expect(r.verdict).toBe("FAIL"); // content mask must not eat the topbar band
    recordScreen({ ...r, screen: "self-check/content-topbar", kind: "self-check" });
  });

  test("a change in the SIDEBAR chrome (x<244) still FAILs under the content mask", async ({ page }) => {
    const cand = await perturbAt(page, fileToDataUrl(SELF_CHECK_REF), [sidebarRect]);
    const r = await compareImages(page, SELF_CHECK_REF, cand, "self:content-sidebar", { maskRegions });
    expect(r.diffPixels).toBeGreaterThan(0); // sidebar is chrome — NOT masked
    expect(r.verdict).toBe("FAIL");
    recordScreen({ ...r, screen: "self-check/content-sidebar", kind: "self-check" });
  });

  test("a size mismatch still auto-FAILs even with the content mask configured", async ({ page }) => {
    // P0-FIX-04 interplay: the content mask must never rescue a dimension mismatch.
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
    const r = await compareImages(page, SELF_CHECK_REF, bigger, "self:content-size", { maskRegions });
    expect(r.dimensionMismatch).toBe(true);
    expect(r.verdict).toBe("FAIL");
    recordScreen({ ...r, screen: "self-check/content-size-larger", kind: "self-check" });
  });

  test("both chrome masks coexist (sidebar-logo + content-area) and resolve", async () => {
    const combined = resolveMasks(["sidebar-logo-b044", "content-area-b048"]);
    expect(combined).toHaveLength(2);
    expect(CONTENT_MASK).toBeDefined();
    expect(CONTENT_MASK.reason).toMatch(/B-048/);
  });

  test("the app-shell manifest row parses and its masks resolve", async () => {
    // B-120(ข) 2026-07-20: the row moved off the scaffold-era shape this test
    // originally pinned (gallery ref + sidebar-logo/content-area masks). The
    // dashboard body IS ported now — the B-048 note itself said content-area
    // drops "once the body screen lands" — and Wei's re-baseline ruling points
    // refs at app-baseline/ with the two live-time masks instead.
    const manifest = loadManifest();
    const shell = manifest.find((m) => m.screen === "app-shell");
    expect(shell, "app-shell row present in screens.manifest.json").toBeDefined();
    expect(shell!.route).toBe("dashboard");
    expect(shell!.ref).toBe("app-baseline/dashboard.png");
    // B-160 dashboard as_of (2026-07-31 · full-manifest G5 audit): two more
    // B-160-class rects joined the row — the subtitle prints the SERVER as_of
    // (apps/api dashboard.ts:200 new Date()) as absolute Thai-short text, whose
    // {date} half sat LEFT of header-update-time-b120 and whose reflow (shorter
    // date) pushes the line's trailing glyphs past that mask's right edge.
    expect(shell!.masks).toEqual([
      "header-update-time-b120",
      "header-date-chip-b120",
      "dashboard-asof-date-b160",
      "dashboard-asof-tail-b160",
    ]);
    // Every listed mask key must be a real registry entry (throws otherwise).
    expect(() => resolveMasks(shell!.masks)).not.toThrow();
    expect(resolveMasks(shell!.masks)).toHaveLength(4);
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
  // Capture viewport = the reference's own pixel size (P0-QA-04 fold): g1/g2 refs
  // are 1600x1000, g5 refs are 924x540. Omit → defaults to 1600x1000. A mismatch
  // between capture and reference dimensions auto-FAILs (PLAN.md §0), so the run
  // must shoot at the reference size.
  viewport?: { width: number; height: number };
  // B-187 (2026-07-30): per-row sidebar viewMode. "platform" seeds
  // juneflow-state={tweaks:{viewMode:'platform'}} in localStorage BEFORE the app
  // boots so an owner-only screen (admin.*) renders the SAME platform sidebar its
  // app-baseline was captured with. Omit -> the app defaults to "tenant"
  // (unchanged for every other row). viewMode is a sidebar-only gate; screen
  // bodies enable on authed() — the owner (wipha) token renders both sidebars.
  viewMode?: "tenant" | "platform";
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

interface Capture {
  png: Buffer;
  evidence: CaptureEvidence;
}

/**
 * THE ONE capture path. Compare mode and promote mode both call this and
 * nothing else — the mode branch happens strictly AFTER it returns, on the
 * bytes it produced.
 *
 * This is the guarantee that promote and compare cannot drift apart: they do
 * not have two capture implementations to keep in sync (the 2026-08-07
 * re-baseline used a SEPARATE driver script in agents/, whose header had to
 * claim "mirrors visual-gate.spec.ts EXACTLY" — a claim nothing enforced).
 * Every capture parameter that decides what the pixels are — viewport, the
 * B-187 viewMode init-script seeding, browser-path nav (B-155), networkidle,
 * the 1500 ms settle (B-120), fullPage:false, and the storageState/globalSetup
 * auth from playwright.visual.config.ts — is written exactly once, here. A
 * promoted baseline is therefore, by construction, a capture taken under the
 * conditions the gate will later compare against.
 *
 * It collects the evidence promote needs (nav status, landing URL, page errors)
 * passively — listeners and the goto return value only, no extra page
 * interaction — so compare mode drives the browser exactly as it did before.
 * Anything promote wants that would TOUCH the page (the body probe) is done by
 * the promote branch instead, after the screenshot, so the compare gate never
 * gains a step it does not need.
 */
async function captureScreen(
  page: Page,
  entry: ManifestEntry,
  baseURL: string
): Promise<Capture> {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  const readApiWatch = attachApiWatch(page);

  // Shoot at the reference's dimensions (fold P0-QA-04) so the capture never
  // auto-FAILs on a dimension mismatch. fullPage:false clips to the viewport,
  // which equals the fixed-size reference (the Fiori shell is 100vh — the
  // content pane scrolls internally, not the page).
  await page.setViewportSize(entry.viewport ?? { width: 1600, height: 1000 });
  // B-187: seed the sidebar viewMode BEFORE the app boots. The run
  // storageState seeds only juneflow-token; the app's tweaks/viewMode
  // (localStorage "juneflow-state", shell-context.tsx STATE_KEY) then defaults
  // to "tenant". The 3 platform-owner admin.* baselines were captured with the
  // owner (platform) sidebar, so seeding juneflow-state here makes the capture
  // render the SAME sidebar the baseline has (~2.2% whole-sidebar mismatch → 0).
  // addInitScript runs before any page script on every navigation, so
  // ShellProvider's loadTweaks() reads it on mount. Rows without entry.viewMode
  // are untouched → default "tenant" (unchanged behaviour for every other row).
  if (entry.viewMode) {
    await page.addInitScript((mode) => {
      try {
        window.localStorage.setItem(
          "juneflow-state",
          JSON.stringify({ tweaks: { viewMode: mode } })
        );
      } catch {
        /* localStorage unavailable — leave default tenant viewMode */
      }
    }, entry.viewMode);
  }
  // B-120 (regression gate): wait for the DATA to settle before shooting.
  // Default goto resolves at `load` — TanStack Query fetches are still in
  // flight then, so the shot captures skeleton/loading frames and the gate
  // flakes 13-16% against a settled baseline. networkidle + a fixed settle
  // makes capture-vs-baseline deterministic (both sides settled).
  // B-155: browser-path nav (NOT hash). The app uses browser history
  // (createRouter default), so `/#/${route}` was ignored → pathname "/" →
  // indexRoute redirect → /dashboard → EVERY screen captured the dashboard
  // (all 28 baselines were dashboards · gate was a no-op). nginx SPA-fallback
  // (apps/web/nginx.conf.template try_files → index.html) serves the deep-link.
  const res = await page.goto(`${baseURL}/${entry.route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const png = await page.screenshot({ fullPage: false });
  return {
    png,
    evidence: {
      landedUrl: page.url(),
      status: res?.status() ?? null,
      pageErrors,
      consoleErrors,
      ...readApiWatch(),
    },
  };
}

/**
 * Count the API responses this page received, and how many were refused.
 *
 * Passive by construction: a response listener observes traffic the page was
 * going to make anyway, so compare mode drives the browser exactly as it did
 * before (no extra request, no page interaction). Exported so the counting
 * itself is testable against a real browser and a real server — the guard that
 * consumes these numbers is only as good as the numbers.
 */
export function attachApiWatch(page: Page): () => { apiRequests: number; apiUnauthorized: number } {
  let apiRequests = 0;
  let apiUnauthorized = 0;
  page.on("response", (r) => {
    if (!r.url().includes(API_BASE_PATH)) return;
    apiRequests += 1;
    if (r.status() === 401 || r.status() === 403) apiUnauthorized += 1;
  });
  return () => ({ apiRequests, apiUnauthorized });
}

/**
 * Promote-only, and strictly AFTER the screenshot: what the body actually said.
 * Recorded in the evidence file so a human reviewing a re-baseline can see
 * which screens were empty or still showing the "not ported yet" placeholder.
 * Never runs in compare mode — it is diagnostics, not a capture parameter.
 */
export async function probeBody(
  page: Page
): Promise<Pick<CaptureEvidence, "bodyChars" | "placeholder" | "authTokenPresent">> {
  const probe = await page
    .evaluate(
      ({ placeholder, tokenKey }) => {
        const txt = document.body?.innerText ?? "";
        let token: string | null = null;
        try {
          token = window.localStorage.getItem(tokenKey);
        } catch {
          /* storage unavailable — reported as "not measured", never as "fine" */
        }
        return {
          bodyChars: txt.length,
          placeholder: txt.includes(placeholder),
          // Read at SCREENSHOT time, not at run start: a token cleared or
          // expired mid-run is exactly the case a start-of-run check misses.
          authTokenPresent: typeof token === "string" && token.length > 0,
        };
      },
      { placeholder: PLACEHOLDER_TEXT, tokenKey: AUTH_TOKEN_KEY }
    )
    .catch(() => null);
  return {
    bodyChars: probe?.bodyChars ?? null,
    placeholder: probe?.placeholder ?? null,
    authTokenPresent: probe?.authTokenPresent ?? null,
  };
}

test.describe("visual gate · capture mode (real screens vs reference)", () => {
  const manifest = loadManifest();
  const baseURL = process.env.VISUAL_BASE_URL ?? "http://localhost:5173";
  // GUARD 1 (opt-in): null unless VISUAL_PROMOTE_BASELINE is explicitly set, so
  // a normal gate run behaves exactly as it did before promote mode existed.
  // Constructing the session runs the preflight (GUARD 2) BEFORE any screenshot
  // is taken, so a bad manifest refuses the whole run instead of promoting part
  // of it. See tests/visual/README.md § re-baseline (B-409).
  const promote = openPromoteSession(process.env, manifest, {
    refDir: REF_DIR,
    stagingDir: join(RESULTS_DIR, "promote-staging"),
    manifestPath: process.env.VISUAL_PROMOTE_MANIFEST || join(RESULTS_DIR, "promote-manifest.txt"),
    evidencePath: join(RESULTS_DIR, "promote-evidence.json"),
  });

  // GUARD 0 — the auth pre-flight, once, before screen 0.
  //
  // beforeAll is the mechanism that makes this cheap: when it throws, Playwright
  // does not run the tests in this describe at all, so a bad session costs one
  // HTTP round trip instead of 99 screenshots that would then be thrown away by
  // commit()'s all-or-nothing rule anyway.
  //
  // Compare mode is untouched: the pre-flight runs only when promote is on. A
  // compare run against an unauthenticated stack simply FAILS its diffs, which
  // is already the correct outcome — it is only PROMOTE that would silently
  // enshrine the bad pack.
  test.beforeAll(async () => {
    const auth = await promoteAuthPreflight(promote, {
      storageStatePath: process.env.VISUAL_STORAGE_STATE,
      baseURL,
      apiBasePath: API_BASE_PATH,
      expectUser: process.env.VISUAL_PROMOTE_EXPECT_USER,
    });
    if (auth) {
      console.log(
        `  promote · auth pre-flight OK — GET ${baseURL}${API_BASE_PATH}/me answered 200 as ${auth.user} ` +
          `(token ${auth.tokenChars} chars, origin ${auth.origin || "unknown"})`
      );
    }
  });

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
      const cap = await captureScreen(page, entry, baseURL);
      if (promote) {
        // GUARD 5 lives inside stage(): a screen that errored, redirected, or
        // produced a zero/absurd image throws here and is never staged — and
        // because commit() is all-or-nothing, it also stops the whole promote.
        const rec = promote.stage(entry, cap.png, { ...cap.evidence, ...(await probeBody(page)) });
        console.log(
          `  promote · staged ${rec.screen} ← ${cap.evidence.landedUrl} · ${rec.width}x${rec.height} · ${rec.bytes} B · sha ${rec.sha256.slice(0, 12)}`
        );
        return; // nothing is compared: this reference is about to be replaced
      }
      const candidate =
        "data:image/png;base64," + cap.png.toString("base64");
      const refPath = join(REF_DIR, entry.ref);
      const r = await compareImages(page, refPath, candidate, `capture:${entry.route}`, {
        maskRegions: resolveMasks(entry.masks),
      });
      recordScreen({ ...r, screen: entry.screen, kind: "capture" });
      expect(r.verdict, r.note).toBe("PASS");
    });
  }

  // Declared last, so with workers=1 (playwright.visual.config.ts) it runs after
  // every capture. This is the ONLY step that writes tests/visual/reference/.
  test("promote · commit the captured pack (B-409)", async () => {
    test.skip(!promote, `promote mode off (${PROMOTE_ENV} unset) — the gate compared, it wrote nothing.`);
    const summary = promote!.commit();
    expect(summary.promoted).toBe(manifest.length);
  });
});

// ---- promote-mode guards (B-409 re-baseline mechanism) -----------------------
//
// These run NOW, with no app and no stack: every guard is a pure decision over
// bytes + manifest rows, so it is testable at unit level. They operate on a
// SANDBOX reference pack under .results/ — the real tests/visual/reference/ is
// never a write destination here (each test hashes its sandbox before and after).
//
// The question each test answers is "does this die on revert?" — remove the
// guard it names and the test must go RED.

const SELFTEST_ROOT = join(RESULTS_DIR, "promote-selftest");

interface Sandbox {
  root: string;
  refDir: string;
  opts: {
    refDir: string;
    stagingDir: string;
    manifestPath: string;
    evidencePath: string;
    log: (m: string) => void;
  };
}

function sandbox(name: string): Sandbox {
  const root = join(SELFTEST_ROOT, name);
  rmSync(root, { recursive: true, force: true });
  const refDir = join(root, "reference");
  mkdirSync(join(refDir, "app-baseline"), { recursive: true });
  return {
    root,
    refDir,
    opts: {
      refDir,
      stagingDir: join(root, "staging"),
      manifestPath: join(root, "promote-manifest.txt"),
      evidencePath: join(root, "promote-evidence.json"),
      log: () => {},
    },
  };
}

function rows(names: string[], viewport = { width: 120, height: 80 }): PromoteRow[] {
  return names.map((n) => ({ screen: n, route: n, ref: `app-baseline/${n}.png`, viewport }));
}

/** Give every row an EXISTING baseline (promote overwrites, never mints). */
function seedExistingRefs(sb: Sandbox, list: PromoteRow[]): void {
  for (const r of list) {
    const p = join(sb.refDir, r.ref);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, Buffer.from(`OLD-BASELINE:${r.screen}`));
  }
}

function packHashes(sb: Sandbox, list: PromoteRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of list) {
    const p = join(sb.refDir, r.ref);
    out[r.screen] = existsSync(p) ? sha256(readFileSync(p)) : "(absent)";
  }
  return out;
}

function cleanCapture(row: PromoteRow): CaptureEvidence {
  return {
    landedUrl: `http://app.test/${row.route}`,
    status: 200,
    pageErrors: [],
    consoleErrors: [],
    bodyChars: 4000,
    placeholder: false,
    // An authenticated capture: token in localStorage at screenshot time, and
    // the screen's API calls were answered (not refused).
    authTokenPresent: true,
    apiRequests: 6,
    apiUnauthorized: 0,
  };
}

const PROMOTE_ON = { [PROMOTE_ENV]: "1" } as NodeJS.ProcessEnv;

/** A deterministic, non-trivial PNG of the given size (distinct per seed). */
async function makePng(page: Page, seed: number, w = 120, h = 80): Promise<Buffer> {
  const b64 = await page.evaluate(
    ({ seed, w, h }) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      let s = (seed * 7919 + 104729) % 2147483647;
      const rnd = () => {
        s = (s * 1103515245 + 12345) % 2147483648;
        return s / 2147483648;
      };
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = `rgb(${Math.floor(rnd() * 256)},${Math.floor(rnd() * 256)},${Math.floor(rnd() * 256)})`;
        ctx.fillRect(rnd() * w, rnd() * h, (rnd() * w) / 2, (rnd() * h) / 2);
      }
      return c.toDataURL("image/png").split(",")[1];
    },
    { seed, w, h }
  );
  return Buffer.from(b64, "base64");
}

test.describe("visual gate · promote mode · GUARD 1 opt-in (B-409)", () => {
  test("promote is OFF unless the env var is explicitly 1/true", async () => {
    for (const v of [undefined, "", " ", "0", "false", "no", "yes", "on", "please"]) {
      const env = (v === undefined ? {} : { [PROMOTE_ENV]: v }) as NodeJS.ProcessEnv;
      expect(isPromoteMode(env), `${JSON.stringify(v)} must not enable promote`).toBe(false);
    }
    for (const v of ["1", "true", "TRUE", " true "]) {
      expect(isPromoteMode({ [PROMOTE_ENV]: v } as NodeJS.ProcessEnv), `${v} must enable promote`).toBe(true);
    }
  });

  test("promote OFF: openPromoteSession returns null and touches nothing", async () => {
    const sb = sandbox("guard1-off");
    const list = rows(["alpha", "beta"]);
    seedExistingRefs(sb, list);
    const before = packHashes(sb, list);
    // The env the real gate runs under today — no promote var at all.
    const session = openPromoteSession({} as NodeJS.ProcessEnv, list, sb.opts);
    expect(session).toBeNull();
    expect(packHashes(sb, list)).toEqual(before);
    expect(existsSync(sb.opts.stagingDir)).toBe(false);
    expect(existsSync(sb.opts.manifestPath)).toBe(false);
  });

  test("promote ON in CI is refused (a re-baseline is never automatic)", async () => {
    const sb = sandbox("guard1-ci");
    const list = rows(["alpha"]);
    seedExistingRefs(sb, list);
    expect(() =>
      openPromoteSession({ ...PROMOTE_ON, CI: "true" } as NodeJS.ProcessEnv, list, sb.opts)
    ).toThrow(/never promoted from CI/);
    expect(existsSync(sb.opts.stagingDir)).toBe(false);
  });
});

test.describe("visual gate · promote mode · GUARD 2 declared+existing paths (B-409)", () => {
  test("a missing reference refuses the WHOLE run before any capture", async () => {
    const sb = sandbox("guard2-missing");
    const list = rows(["alpha", "typo-screen"]);
    seedExistingRefs(sb, [list[0]]); // only alpha exists — the second is a manifest typo
    const before = packHashes(sb, list);
    let err: Error | null = null;
    try {
      openPromoteSession(PROMOTE_ON, list, sb.opts);
    } catch (e) {
      err = e as Error;
    }
    expect(err, "a missing reference must refuse").not.toBeNull();
    expect(err).toBeInstanceOf(PromoteRefusal);
    expect(err!.message).toContain("typo-screen");
    expect(err!.message).toMatch(/never mints a new baseline/);
    // The good row must NOT have been promoted: refusal is total, not partial.
    expect(packHashes(sb, list)).toEqual(before);
    expect(existsSync(sb.opts.stagingDir)).toBe(false);
  });

  test("refs outside app-baseline/ are refused (traversal · absolute · symlink · sibling dir)", async () => {
    const sb = sandbox("guard2-escape");
    // A real file outside the baseline dir, reached several different ways.
    const outsideDir = join(sb.refDir, "gallery");
    mkdirSync(outsideDir, { recursive: true });
    const outside = join(outsideDir, "sneaky.png");
    writeFileSync(outside, Buffer.from("NOT-A-BASELINE"));
    symlinkSync(outside, join(sb.refDir, "app-baseline", "linked.png"));

    // A directory whose NAME starts with the baseline dir's. Containment that
    // compares raw prefixes instead of path + separator reads this as "inside
    // app-baseline/", and the promote would then overwrite a file the pack
    // never declared. (Measured: that mutant survived a 58-mutant sweep until
    // this case existed.)
    const siblingDir = join(sb.refDir, "app-baseline-old");
    mkdirSync(siblingDir, { recursive: true });
    const sibling = join(siblingDir, "sneaky.png");
    writeFileSync(sibling, Buffer.from("NOT-A-BASELINE-EITHER"));

    // An absolute ref that lands INSIDE the pack. It is still refused, because
    // refs are declared relative to reference/ and the COMPARE path resolves
    // them with join(REF_DIR, ref) — an absolute ref would make promote and
    // compare mean two different files, which is how a gate stops testing what
    // it thinks it tests.
    const insideAbsolute = join(sb.refDir, "app-baseline", "inside.png");
    writeFileSync(insideAbsolute, Buffer.from("OLD-BASELINE:inside"));

    const cases: Array<[string, string]> = [
      ["traversal", "app-baseline/../gallery/sneaky.png"],
      ["absolute", outside],
      ["symlink-out", "app-baseline/linked.png"],
      ["plain-outside", "gallery/sneaky.png"],
      ["sibling-dir-sharing-a-prefix", "app-baseline-old/sneaky.png"],
      ["absolute-but-inside", insideAbsolute],
    ];
    for (const [label, ref] of cases) {
      const list: PromoteRow[] = [{ screen: label, route: label, ref, viewport: { width: 120, height: 80 } }];
      expect(() => openPromoteSession(PROMOTE_ON, list, sb.opts), label).toThrow(PromoteRefusal);
    }
    // Nothing outside the pack was touched.
    expect(readFileSync(outside).toString()).toBe("NOT-A-BASELINE");
    expect(readFileSync(sibling).toString()).toBe("NOT-A-BASELINE-EITHER");
  });

  test("a ref that is a DIRECTORY named *.png is refused before any capture", async () => {
    // Without the isFile() check this plans fine (it exists, it ends in .png,
    // it is inside the pack) and only fails at commit — on renameSync, AFTER
    // earlier screens have already been overwritten. That is the mixed pack
    // this module exists to prevent, arriving through a typo.
    const sb = sandbox("guard2-dir-as-ref");
    const list = rows(["a", "dirref"]);
    seedExistingRefs(sb, [list[0]]);
    mkdirSync(join(sb.refDir, "app-baseline", "dirref.png"), { recursive: true });
    expect(() => openPromoteSession(PROMOTE_ON, list, sb.opts)).toThrow(/not a regular file/);
    expect(existsSync(sb.opts.stagingDir)).toBe(false);
  });

  test("two rows sharing one screen id are refused at preflight, before any capture", async () => {
    // The screen id is the promote's key: it maps captures to targets and rows
    // to manifest lines. Two rows claiming it means the second capture silently
    // replaces the first's target, and the manifest ends up one line short of
    // the pack it just wrote. Caught before a single screenshot, not after 99.
    const sb = sandbox("guard2-dupe-screen");
    const list: PromoteRow[] = [
      { screen: "twin", route: "one", ref: "app-baseline/one.png", viewport: { width: 120, height: 80 } },
      { screen: "twin", route: "two", ref: "app-baseline/two.png", viewport: { width: 120, height: 80 } },
    ];
    seedExistingRefs(sb, list);
    expect(() => openPromoteSession(PROMOTE_ON, list, sb.opts)).toThrow(/duplicate or empty screen id/);
    expect(existsSync(sb.opts.stagingDir)).toBe(false);
  });

  test("a non-.png ref is refused (compare.ts decodes by extension)", async () => {
    const sb = sandbox("guard2-ext");
    const list: PromoteRow[] = [{ screen: "jpgish", route: "jpgish", ref: "app-baseline/jpgish.jpg" }];
    writeFileSync(join(sb.refDir, "app-baseline", "jpgish.jpg"), Buffer.from("OLD"));
    expect(() => openPromoteSession(PROMOTE_ON, list, sb.opts)).toThrow(/is not a \.png/);
  });

  test("two screens claiming one ref are refused (order-dependent promote)", async () => {
    const sb = sandbox("guard2-dupe-ref");
    const list: PromoteRow[] = [
      { screen: "a", route: "a", ref: "app-baseline/shared.png" },
      { screen: "b", route: "b", ref: "app-baseline/shared.png" },
    ];
    writeFileSync(join(sb.refDir, "app-baseline", "shared.png"), Buffer.from("OLD"));
    expect(() => openPromoteSession(PROMOTE_ON, list, sb.opts)).toThrow(/also claimed by/);
  });

  test("planPromotion returns exactly the declared rows when the pack is sane", async () => {
    const sb = sandbox("guard2-happy");
    const list = rows(["a", "b"]);
    seedExistingRefs(sb, list);
    const planned = planPromotion(list, sb.refDir);
    expect(planned.map((t) => t.screen)).toEqual(["a", "b"]);
    for (const t of planned) expect(t.absRef.includes("app-baseline")).toBe(true);
  });

  test("a reference deleted DURING the run is caught at commit, not minted back", async ({ page }) => {
    // "Never mint" is checked at preflight, but a promote run is minutes long
    // (99 screens x networkidle + settle) and the pack is a working tree someone
    // can `git checkout`, rebase or clean underneath it. Without the re-check at
    // commit, writeFileSync happily RE-CREATES the file that was deleted — a
    // reference no human approved, born mid-run, indistinguishable afterwards
    // from one that was always there.
    const sb = sandbox("guard2-vanished");
    const list = rows(["a", "b", "c"]);
    seedExistingRefs(sb, list);
    const session = openPromoteSession(PROMOTE_ON, list, sb.opts)!;
    const shots = await Promise.all(list.map((_, i) => makePng(page, 610 + i)));
    list.forEach((r, i) => session.stage(r, shots[i], cleanCapture(r)));

    const vanished = join(sb.refDir, list[1].ref);
    rmSync(vanished);
    const before = packHashes(sb, list);

    let err: Error | null = null;
    try {
      session.commit();
    } catch (e) {
      err = e as Error;
    }
    expect(err, "a reference that disappeared mid-run must refuse the commit").not.toBeNull();
    expect(err).toBeInstanceOf(PromoteRefusal);
    expect(err!.message).toMatch(/never mints a new baseline/);
    expect(err!.message).toContain(list[1].screen);
    // Nothing minted, and the two intact baselines were not overwritten either:
    // all-or-nothing survives a mid-run change to the pack.
    expect(existsSync(vanished), "the deleted reference must NOT be re-created").toBe(false);
    expect(packHashes(sb, list)).toEqual(before);
    expect(existsSync(sb.opts.manifestPath)).toBe(false);
  });
});

test.describe("visual gate · promote mode · GUARD 3 the B-155 detector (B-409)", () => {
  test("an all-identical pack is refused, with counts and screen names", async ({ page }) => {
    const sb = sandbox("guard3-all-same");
    const list = rows(["s01", "s02", "s03", "s04", "s05", "s06", "s07", "s08", "s09", "s10", "s11", "s12"]);
    seedExistingRefs(sb, list);
    const before = packHashes(sb, list);
    const session = openPromoteSession(PROMOTE_ON, list, sb.opts)!;
    // THE B-155 SHAPE: every route captured the same page (all dashboards).
    const dashboard = await makePng(page, 1);
    for (const r of list) session.stage(r, dashboard, cleanCapture(r));
    let err: Error | null = null;
    try {
      session.commit();
    } catch (e) {
      err = e as Error;
    }
    expect(err, "12 identical screens must refuse").not.toBeNull();
    expect(err!.message).toMatch(/implausibly uniform/);
    expect(err!.message).toContain("screens captured: 12");
    expect(err!.message).toContain("distinct images: 1");
    expect(err!.message).toContain("s01"); // groups reported BY SCREEN NAME
    expect(err!.message).toContain("s12");
    expect(err!.message).toContain("B-155");
    // ...and refused means refused: not one baseline was overwritten.
    expect(packHashes(sb, list)).toEqual(before);
    expect(existsSync(sb.opts.manifestPath)).toBe(false);
  });

  test("THREE identical screens refuse, a pair is allowed", async ({ page }) => {
    // 20 screens on purpose, so this test isolates the GROUP CAP from the ratio
    // rule: one trio leaves 18 distinct of 20 = 0.90, which is NOT below
    // MIN_DISTINCT_RATIO, so only the cap can refuse it. (With 10 screens a trio
    // gives 0.80 and the ratio rule would fire too, and the test would pass even
    // with the cap removed — it would prove nothing about the cap.)
    //
    // The 3 and the 2 below are LITERAL, and that is the point. Written as
    // MAX_IDENTICAL_GROUP + 1 / MAX_IDENTICAL_GROUP, the test moved with the
    // constant: raising the cap to 3 also raised the trio to a quartet, so
    // "three different screens may share one image" — the B-155 shape at small
    // scale — became permitted with the suite still green (measured: that
    // mutant survived a 46-mutant sweep). A policy line the test reads out of
    // the implementation is not a policy line.
    const list = rows(Array.from({ length: 20 }, (_, i) => `s${String(i).padStart(2, "0")}`));
    const distinct = await Promise.all(list.map((_, i) => makePng(page, 100 + i)));

    // A trio sharing one image — over the cap.
    const trio = sandbox("guard3-trio");
    seedExistingRefs(trio, list);
    const before = packHashes(trio, list);
    const s1 = openPromoteSession(PROMOTE_ON, list, trio.opts)!;
    list.forEach((r, i) => s1.stage(r, i < 3 ? distinct[0] : distinct[i], cleanCapture(r)));
    expect(() => s1.commit()).toThrow(/implausibly uniform/);
    expect(packHashes(trio, list)).toEqual(before);

    // Exactly one pair — allowed, and reported so a human can still judge.
    const pair = sandbox("guard3-pair");
    seedExistingRefs(pair, list);
    const s2 = openPromoteSession(PROMOTE_ON, list, pair.opts)!;
    list.forEach((r, i) => s2.stage(r, i < 2 ? distinct[0] : distinct[i], cleanCapture(r)));
    const summary = s2.commit();
    expect(summary.promoted).toBe(list.length);
    expect(summary.duplicateGroups).toHaveLength(1);
    expect(summary.duplicateGroups[0].screens).toEqual([list[0].screen, list[1].screen]);
  });

  test("diffuse duplication is refused by the distinct-ratio rule (every group a legal pair)", async ({ page }) => {
    const sb = sandbox("guard3-ratio");
    const list = rows(["p1", "p2", "q1", "q2", "r1", "r2", "t1", "t2", "u1", "u2", "v1", "v2"]);
    seedExistingRefs(sb, list);
    const before = packHashes(sb, list);
    const session = openPromoteSession(PROMOTE_ON, list, sb.opts)!;
    const imgs = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => makePng(page, 200 + i)));
    list.forEach((r, i) => session.stage(r, imgs[Math.floor(i / 2)], cleanCapture(r)));
    // 6 groups of 2: no group exceeds the cap, yet the pack is obviously broken.
    // Literal 2, for the reason spelled out in the trio test above: read out of
    // the constant, this line would keep agreeing with whatever the cap became.
    expect(duplicateGroups(session.stagedRecords()).every((g) => g.screens.length <= 2)).toBe(true);
    expect(() => session.commit()).toThrow(/implausibly uniform/);
    expect(packHashes(sb, list)).toEqual(before);
  });

  test("a small pack is judged by the group cap alone (the ratio needs a big enough pack)", async ({ page }) => {
    const sb = sandbox("guard3-small");
    const list = rows(["x", "y", "z", "w"]);
    seedExistingRefs(sb, list);
    const session = openPromoteSession(PROMOTE_ON, list, sb.opts)!;
    const img = await makePng(page, 300);
    // 2 of 4 identical = ratio 0.5, below MIN_DISTINCT_RATIO, but only 4 screens.
    session.stage(list[0], img, cleanCapture(list[0]));
    session.stage(list[1], img, cleanCapture(list[1]));
    session.stage(list[2], await makePng(page, 301), cleanCapture(list[2]));
    session.stage(list[3], await makePng(page, 302), cleanCapture(list[3]));
    expect(session.commit().promoted).toBe(4);
  });

  test("duplicate groups are reported by screen name, in a canonical order", async () => {
    // Fed in an order that is NOT the answer: "c" before "a" inside a group,
    // and the smaller group first. What comes back must not depend on where a
    // screen happened to sit in screens.manifest.json — the groups are what a
    // human reads to decide "is this pair real or is the nav broken", and two
    // people reading the same pack must be reading the same list.
    // The SMALL group is complete before the big one starts, so insertion order
    // and the answer disagree on both axes: group order and name order.
    const messy = [
      { screen: "y", sha256: "bb" },
      { screen: "solo", sha256: "cc" },
      { screen: "x", sha256: "bb" },
      { screen: "c", sha256: "aa" },
      { screen: "a", sha256: "aa" },
      { screen: "b", sha256: "aa" },
    ];
    expect(duplicateGroups(messy)).toEqual([
      { sha256: "aa", screens: ["a", "b", "c"] }, // biggest group first, though seen last
      { sha256: "bb", screens: ["x", "y"] }, // names sorted, though y came first
    ]);
    // Equal-sized groups fall back to the hash, so even a tie is not "whichever
    // the manifest happened to list first".
    const tied = [
      { screen: "p", sha256: "bb" },
      { screen: "q", sha256: "bb" },
      { screen: "r", sha256: "aa" },
      { screen: "s", sha256: "aa" },
    ];
    expect(duplicateGroups(tied).map((g) => g.sha256)).toEqual(["aa", "bb"]);
    const clean = [
      { screen: "c", sha256: "aa" },
      { screen: "b", sha256: "bb" },
      { screen: "a", sha256: "aa" },
    ];
    expect(assertPlausiblyDistinct(clean)).toEqual([{ sha256: "aa", screens: ["a", "c"] }]);
  });
});

test.describe("visual gate · promote mode · the evidence is MEASURED, not assumed (B-409)", () => {
  // The guards above are only as good as the numbers fed to them. These drive a
  // REAL chromium page against a REAL http server, so probeBody() and
  // attachApiWatch() are exercised the way the capture path exercises them —
  // no stub stands in for the code under test.
  function appStub(opts: {
    token: string | null;
    apiStatus: number;
    body?: string;
  }): Promise<{ url: string; close: () => Promise<void> }> {
    const shell = opts.body ?? `<div id="shell">Juneflow shell chrome</div>`;
    const server = createServer((req, res) => {
      const url = req.url ?? "/";
      if (url.startsWith(API_BASE_PATH)) {
        res.writeHead(opts.apiStatus, { "content-type": "application/json" });
        res.end(JSON.stringify(opts.apiStatus === 200 ? { data: [] } : { code: "UNAUTHENTICATED" }));
        return;
      }
      // A miniature of the real thing: chrome renders regardless of auth (the
      // router is not auth-gated), and the data call happens on load.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><body>${shell}
<script>
  ${opts.token === null ? "" : `localStorage.setItem(${JSON.stringify(AUTH_TOKEN_KEY)}, ${JSON.stringify(opts.token)});`}
  fetch(${JSON.stringify(`${API_BASE_PATH}/dashboard`)}).then(() => { window.__done = true; }).catch(() => { window.__done = true; });
</script></body></html>`);
    });
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        resolve({
          url: `http://127.0.0.1:${addr.port}`,
          close: () => new Promise<void>((done) => server.close(() => done())),
        });
      });
    });
  }

  test("an AUTHENTICATED page measures a token and zero refusals", async ({ page }) => {
    const app = await appStub({ token: "a.real.token", apiStatus: 200 });
    try {
      const readApi = attachApiWatch(page);
      await page.goto(app.url, { waitUntil: "networkidle" });
      await page.waitForFunction(() => (window as unknown as { __done?: boolean }).__done === true);
      const probe = await probeBody(page);
      const api = readApi();
      expect(probe.authTokenPresent).toBe(true);
      // bodyChars must be the MEASURED text length, not a constant: assert the
      // exact rendered string length so a hardcoded value cannot satisfy it.
      expect(probe.bodyChars).toBe("Juneflow shell chrome".length);
      expect(api.apiRequests).toBeGreaterThan(0);
      expect(api.apiUnauthorized).toBe(0);
      // ...and that evidence promotes.
      expect(captureProblems(rows(["x"])[0], await makePng(page, 77), {
        landedUrl: "http://app.test/x",
        status: 200,
        pageErrors: [],
        consoleErrors: [],
        ...probe,
        ...api,
      })).toEqual([]);
    } finally {
      await app.close();
    }
  });

  test("a genuinely BLANK page measures 0 body chars and is refused", async ({ page }) => {
    // The third measured hole, proven through the real probe rather than a
    // hand-written evidence literal: a page that rendered nothing.
    const app = await appStub({ token: "a.real.token", apiStatus: 200, body: "" });
    try {
      await page.goto(app.url, { waitUntil: "networkidle" });
      await page.waitForFunction(() => (window as unknown as { __done?: boolean }).__done === true);
      const probe = await probeBody(page);
      expect(probe.bodyChars).toBe(0);
      const problems = captureProblems(rows(["x"])[0], await makePng(page, 80), {
        landedUrl: "http://app.test/x",
        status: 200,
        pageErrors: [],
        consoleErrors: [],
        ...probe,
        apiRequests: 1,
        apiUnauthorized: 0,
      });
      expect(problems.join(" ")).toMatch(/body is EMPTY \(0 characters\)/);
    } finally {
      await app.close();
    }
  });

  test("an UNAUTHENTICATED page measures NO token — and captureProblems refuses it", async ({ page }) => {
    const app = await appStub({ token: null, apiStatus: 200 });
    try {
      const readApi = attachApiWatch(page);
      await page.goto(app.url, { waitUntil: "networkidle" });
      await page.waitForFunction(() => (window as unknown as { __done?: boolean }).__done === true);
      const probe = await probeBody(page);
      expect(probe.authTokenPresent).toBe(false);
      // The shell still rendered — which is precisely why this shot would have
      // looked promotable before this round.
      expect(probe.bodyChars).toBeGreaterThan(0);
      const problems = captureProblems(rows(["x"])[0], await makePng(page, 78), {
        landedUrl: "http://app.test/x",
        status: 200,
        pageErrors: [],
        consoleErrors: [],
        ...probe,
        ...readApi(),
      });
      expect(problems.join(" ")).toMatch(/UNAUTHENTICATED/);
    } finally {
      await app.close();
    }
  });

  test("an EXPIRED session is measured as 401s on the wire", async ({ page }) => {
    const app = await appStub({ token: "expired.token", apiStatus: 401 });
    try {
      const readApi = attachApiWatch(page);
      await page.goto(app.url, { waitUntil: "networkidle" });
      await page.waitForFunction(() => (window as unknown as { __done?: boolean }).__done === true);
      const probe = await probeBody(page);
      const api = readApi();
      // The token IS there — only the wire says it is no longer good.
      expect(probe.authTokenPresent).toBe(true);
      expect(api.apiUnauthorized).toBeGreaterThan(0);
      const problems = captureProblems(rows(["x"])[0], await makePng(page, 79), {
        landedUrl: "http://app.test/x",
        status: 200,
        pageErrors: [],
        consoleErrors: [],
        ...probe,
        ...api,
      });
      expect(problems.join(" ")).toMatch(/answered 401\/403/);
    } finally {
      await app.close();
    }
  });
});

test.describe("visual gate · promote mode · GUARD 3b near-duplicate detector (B-409)", () => {
  /** The same picture, with exactly ONE pixel painted a different colour. */
  async function onePixelVariant(page: Page, seed: number, pixel: number, w = 120, h = 80): Promise<Buffer> {
    const b64 = await page.evaluate(
      ({ seed, pixel, w, h }) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d")!;
        let s = (seed * 7919 + 104729) % 2147483647;
        const rnd = () => {
          s = (s * 1103515245 + 12345) % 2147483648;
          return s / 2147483648;
        };
        for (let i = 0; i < 40; i++) {
          ctx.fillStyle = `rgb(${Math.floor(rnd() * 256)},${Math.floor(rnd() * 256)},${Math.floor(rnd() * 256)})`;
          ctx.fillRect(rnd() * w, rnd() * h, (rnd() * w) / 2, (rnd() * h) / 2);
        }
        // The whole difference between these captures: one pixel.
        ctx.fillStyle = `rgb(${pixel % 256},${(pixel * 7) % 256},${(pixel * 13) % 256})`;
        ctx.fillRect(pixel % w, Math.floor(pixel / w) % h, 1, 1);
        return c.toDataURL("image/png").split(",")[1];
      },
      { seed, pixel, w, h }
    );
    return Buffer.from(b64, "base64");
  }

  // THE MEASURED ATTACK: the adversarial verifier promoted 12 captures of the
  // SAME page differing in one pixel — 12 distinct sha256 values, zero duplicate
  // groups, commit() succeeded. This is that exact pack.
  test("12 captures of one page differing by ONE pixel are refused (byte identity missed this)", async ({ page }) => {
    const sb = sandbox("guard3b-one-pixel");
    const list = rows(["s01", "s02", "s03", "s04", "s05", "s06", "s07", "s08", "s09", "s10", "s11", "s12"]);
    seedExistingRefs(sb, list);
    const before = packHashes(sb, list);
    const session = openPromoteSession(PROMOTE_ON, list, sb.opts)!;

    const shots: Buffer[] = [];
    for (const [i, r] of list.entries()) {
      const png = await onePixelVariant(page, 1, i + 1);
      shots.push(png);
      session.stage(r, png, cleanCapture(r));
    }

    // Every capture is byte-DISTINCT: the old detector saw 12 distinct images.
    expect(new Set(shots.map((s) => sha256(s))).size).toBe(12);
    expect(duplicateGroups(session.stagedRecords())).toHaveLength(0);

    // The near-duplicate detector sees one group of 12.
    let err: Error | null = null;
    try {
      session.commit();
    } catch (e) {
      err = e as Error;
    }
    expect(err, "12 one-pixel variants of one page must refuse").not.toBeNull();
    expect(err!.message).toMatch(/implausibly uniform/);
    expect(err!.message).toContain("distinct images: 1");
    expect(err!.message).toContain("s01");
    expect(err!.message).toContain("s12");
    expect(packHashes(sb, list)).toEqual(before);
    expect(existsSync(sb.opts.manifestPath)).toBe(false);
  });

  // THE FALSE-POSITIVE COST, measured against the arbiter itself rather than
  // asserted. Read-only: this test never writes into reference/.
  test("the REAL 99-file pack produces ZERO near-duplicate groups (measured FP cost)", async () => {
    const dir = join(REF_DIR, "app-baseline");
    const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
    expect(files.length).toBeGreaterThanOrEqual(99);

    const records = files.map((f) => {
      const png = readFileSync(join(dir, f));
      return { screen: f, sha256: sha256(png), signature: imageSignature(png) };
    });

    // Every real baseline must decode, or the detector is silently degraded to
    // byte identity on the very pack it was calibrated against.
    expect(records.filter((r) => !r.signature).map((r) => r.screen)).toEqual([]);

    const report = nearDuplicateReport(records);
    expect(report.groups, `false positives: ${JSON.stringify(report.groups)}`).toEqual([]);
    expect(report.undecodable).toEqual([]);

    // ...and the margin is real, not incidental: state the closest pair.
    let closest = Infinity;
    for (let i = 0; i < records.length; i++) {
      for (let j = i + 1; j < records.length; j++) {
        const d = signatureDistance(records[i].signature, records[j].signature);
        if (d < closest) closest = d;
      }
    }
    expect(closest).toBeGreaterThan(MAX_NEAR_DUP_DISTANCE);
    console.log(
      `  near-dup calibration · ${records.length} real baselines · closest pair ${closest.toFixed(4)} ` +
        `· refusal threshold ${MAX_NEAR_DUP_DISTANCE} · margin ${(closest / MAX_NEAR_DUP_DISTANCE).toFixed(2)}x ` +
        `· advisory band <= ${NEAR_DUP_ADVISORY_DISTANCE} holds ${report.advisory.length} pair(s)`
    );

    // The whole pack must still promote — the detector may not block a
    // re-baseline of the very screens it was calibrated on.
    expect(() => assertPlausiblyDistinct(records)).not.toThrow();
  });

  test("signatureDistance never mistakes a MISSING signature for 'far apart'", async ({ page }) => {
    const png = await makePng(page, 61);
    const sig = imageSignature(png);
    expect(sig).not.toBeNull();
    expect(signatureDistance(sig, sig)).toBe(0);
    expect(signatureDistance(sig, null)).toBe(Infinity);
    expect(signatureDistance(null, null)).toBe(Infinity);
    expect(imageSignature(Buffer.from("not a png"))).toBeNull();

    // An undecodable capture is still caught by byte identity, and is REPORTED
    // as undecodable rather than silently treated as distinct.
    const undecodable = [
      { screen: "a", sha256: "same", signature: null },
      { screen: "b", sha256: "same", signature: null },
      { screen: "c", sha256: "other", signature: null },
    ];
    const rep = nearDuplicateReport(undecodable);
    expect(rep.groups.map((g) => g.screens)).toEqual([["a", "b"]]);
    expect(rep.undecodable).toEqual(["a", "b", "c"]);
  });
});

test.describe("visual gate · promote mode · GUARD 5 never promote a failed capture (B-409)", () => {
  const badCaptures: Array<[string, (png: Buffer, row: PromoteRow) => { png: Buffer; ev: CaptureEvidence }, RegExp]> = [
    ["zero-byte image", (_p, r) => ({ png: Buffer.alloc(0), ev: cleanCapture(r) }), /empty \(0 bytes\)/],
    [
      "truncated / non-PNG bytes",
      (_p, r) => ({ png: Buffer.from("not a png at all, just text".repeat(20)), ev: cleanCapture(r) }),
      /not a decodable PNG/,
    ],
    ["wrong dimensions", (p, r) => ({ png: p, ev: cleanCapture(r) }), /but the capture viewport is/],
    ["HTTP 500 error page", (p, r) => ({ png: p, ev: { ...cleanCapture(r), status: 500 } }), /HTTP 500/],
    [
      "uncaught page error",
      (p, r) => ({ png: p, ev: { ...cleanCapture(r), pageErrors: ["TypeError: x is not a function"] } }),
      /uncaught page error/,
    ],
    [
      "redirected to another screen (B-155)",
      (p, r) => ({ png: p, ev: { ...cleanCapture(r), landedUrl: "http://app.test/dashboard" } }),
      /B-155 shape/,
    ],
    // ---- the three measured holes that let a BROKEN capture promote ----------
    // Each of these returned [] from captureProblems before this round.
    [
      "null HTTP status (the check silently did not apply)",
      (p, r) => ({ png: p, ev: { ...cleanCapture(r), status: null } }),
      /NO HTTP status/,
    ],
    [
      "blank page (bodyChars 0)",
      (p, r) => ({ png: p, ev: { ...cleanCapture(r), bodyChars: 0 } }),
      /body is EMPTY \(0 characters\)/,
    ],
    [
      "body probe did not run (bodyChars null)",
      (p, r) => ({ png: p, ev: { ...cleanCapture(r), bodyChars: null } }),
      /body probe did not run/,
    ],
    [
      "console errors were collected but never consulted",
      (p, r) => ({
        png: p,
        ev: {
          ...cleanCapture(r),
          consoleErrors: ["Failed to load resource: the server responded with a status of 401 (Unauthorized)"],
        },
      }),
      /console error\(s\) reporting a refused\/failed request/,
    ],
    // ---- THE unauthenticated-promote scenario -------------------------------
    [
      "UNAUTHENTICATED: no bearer token in localStorage",
      (p, r) => ({ png: p, ev: { ...cleanCapture(r), authTokenPresent: false } }),
      /this capture is UNAUTHENTICATED/,
    ],
    [
      "token probe did not run (authTokenPresent null)",
      (p, r) => ({ png: p, ev: { ...cleanCapture(r), authTokenPresent: null } }),
      /probe did not run/,
    ],
    [
      "EXPIRED session: the screen's API calls answered 401",
      (p, r) => ({ png: p, ev: { ...cleanCapture(r), apiRequests: 6, apiUnauthorized: 6 } }),
      /answered 401\/403/,
    ],
    [
      "API traffic not measured (an expired token stays in localStorage)",
      (p, r) => ({ png: p, ev: { ...cleanCapture(r), apiUnauthorized: null } }),
      /API traffic was not measured/,
    ],
  ];

  for (const [label, mutate, expected] of badCaptures) {
    test(`refuses to stage: ${label}`, async ({ page }) => {
      const sb = sandbox(`guard5-${label.replace(/[^a-z0-9]+/gi, "-")}`);
      const list = rows(["only"]);
      seedExistingRefs(sb, list);
      const before = packHashes(sb, list);
      const session = openPromoteSession(PROMOTE_ON, list, sb.opts)!;
      // "wrong dimensions" gets a valid PNG of the WRONG size; the rest a good one.
      const png = label === "wrong dimensions" ? await makePng(page, 7, 121, 80) : await makePng(page, 7);
      const mutated = mutate(png, list[0]);
      expect(() => session.stage(list[0], mutated.png, mutated.ev)).toThrow(expected);
      expect(session.stagedRecords()).toHaveLength(0);
      // ...and the run cannot then commit a partial pack.
      expect(() => session.commit()).toThrow(/did not stage/);
      expect(packHashes(sb, list)).toEqual(before);
    });
  }

  test("a partial run refuses to commit and writes nothing", async ({ page }) => {
    const sb = sandbox("guard5-partial");
    const list = rows(["a", "b", "c"]);
    seedExistingRefs(sb, list);
    const before = packHashes(sb, list);
    const session = openPromoteSession(PROMOTE_ON, list, sb.opts)!;
    session.stage(list[0], await makePng(page, 11), cleanCapture(list[0]));
    session.stage(list[1], await makePng(page, 12), cleanCapture(list[1]));
    let err: Error | null = null;
    try {
      session.commit();
    } catch (e) {
      err = e as Error;
    }
    expect(err, "2 of 3 staged must refuse").not.toBeNull();
    expect(err!.message).toContain("1 of 3 screens did not stage");
    expect(err!.message).toContain("c (c)");
    expect(packHashes(sb, list)).toEqual(before);
    expect(existsSync(sb.opts.manifestPath)).toBe(false);
  });

  test("captureProblems accepts a clean capture (the guard is not a blanket refusal)", async ({ page }) => {
    const row = rows(["clean"])[0];
    const png = await makePng(page, 42);
    expect(captureProblems(row, png, cleanCapture(row))).toEqual([]);
    expect(readPngSize(png)).toEqual({ width: 120, height: 80 });
  });

  // Requirement (b) of the unauthenticated detector: it must NOT fire on screens
  // that are legitimately empty BY DESIGN. This is the test that stops the new
  // guard from being a blanket "any quiet screen is broken" refusal — which
  // would make a promote impossible for the empty-state screens the pack
  // legitimately contains.
  test("a legitimately EMPTY screen still promotes (emptiness is data, auth is session)", async ({ page }) => {
    const row = rows(["empty-by-design"])[0];
    const png = await makePng(page, 43);
    const cases: Array<[string, CaptureEvidence]> = [
      [
        "empty list: the API answered 200 with no rows",
        { ...cleanCapture(row), apiRequests: 3, apiUnauthorized: 0, bodyChars: 180 },
      ],
      [
        "static screen: renders shell only, calls no API at all",
        { ...cleanCapture(row), apiRequests: 0, apiUnauthorized: 0, bodyChars: 140 },
      ],
      [
        "placeholder screen: 'not ported yet', legitimately in the manifest",
        { ...cleanCapture(row), apiRequests: 0, apiUnauthorized: 0, bodyChars: 96, placeholder: true },
      ],
      [
        "console noise that is NOT a refused/failed request",
        {
          ...cleanCapture(row),
          consoleErrors: ["Warning: Each child in a list should have a unique \"key\" prop."],
        },
      ],
    ];
    for (const [label, ev] of cases) {
      expect(captureProblems(row, png, ev), label).toEqual([]);
    }
  });

  // THE SCENARIO, end to end: apps/web's router is not auth-gated, so an
  // unauthenticated run produces captures that are correctly routed, HTTP 200,
  // and DISTINCT per screen. Before this round every one of them passed
  // captureProblems and the pack promoted.
  test("an UNAUTHENTICATED pack (routed, 200, distinct) is refused, not promoted", async ({ page }) => {
    const sb = sandbox("guard5-unauthenticated-pack");
    const list = rows(["s01", "s02", "s03", "s04", "s05"]);
    seedExistingRefs(sb, list);
    const before = packHashes(sb, list);
    const session = openPromoteSession(PROMOTE_ON, list, sb.opts)!;

    // Exactly what the verifier measured: every screen routed correctly, HTTP
    // 200, a real body (the Fiori chrome renders), and a DIFFERENT image each.
    const unauth = (r: PromoteRow): CaptureEvidence => ({
      landedUrl: `http://app.test/${r.route}`,
      status: 200,
      pageErrors: [],
      consoleErrors: [],
      bodyChars: 820, // chrome only — not zero, so a length check alone misses it
      placeholder: false,
      authTokenPresent: false, // VISUAL_STORAGE_STATE missing/expired
      apiRequests: 0, // hooks are gated on authed() — they never even fire
      apiUnauthorized: 0,
    });
    for (const [i, r] of list.entries()) {
      const png = await makePng(page, 700 + i);
      expect(() => session.stage(r, png, unauth(r)), r.screen).toThrow(/UNAUTHENTICATED/);
    }
    expect(session.stagedRecords()).toHaveLength(0);
    expect(() => session.commit()).toThrow(/did not stage/);
    expect(packHashes(sb, list)).toEqual(before);
    expect(existsSync(sb.opts.manifestPath)).toBe(false);
  });
});

test.describe("visual gate · promote mode · GUARD 0 the auth pre-flight (B-409)", () => {
  // These drive the REAL assertAuthenticatedSession against a REAL http server
  // over a REAL socket — no double is injected for the code under test. Only the
  // remote peer is a stand-in, which is what it always is. (Lesson: a suite that
  // injects a double for the thing it claims to test proves only the double.)
  function apiStub(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; close: () => Promise<void> }> {
    const server = createServer(handler);
    return new Promise((res) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        res({
          url: `http://127.0.0.1:${addr.port}`,
          close: () => new Promise<void>((done) => server.close(() => done())),
        });
      });
    });
  }

  /** A stand-in for apps/api: bearer required, 401 otherwise (tenant-scope shape). */
  const GOOD_TOKEN = "header.payload.signature";
  function realish(req: IncomingMessage, res: ServerResponse): void {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${GOOD_TOKEN}`) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ code: "UNAUTHENTICATED", message: "Missing tenant context" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ user: { email: "wipha@rungrueang.co.th" }, role: {}, package: {} }));
  }

  function stateFile(name: string, entries: Array<{ name: string; value: string }>): string {
    const p = join(SELFTEST_ROOT, `state-${name}.json`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify({ cookies: [], origins: [{ origin: "http://localhost:5173", localStorage: entries }] }));
    return p;
  }

  test("PASSES with a good token (the check is not a blanket refusal)", async () => {
    const api = await apiStub(realish);
    try {
      const r = await assertAuthenticatedSession({
        storageStatePath: stateFile("good", [{ name: AUTH_TOKEN_KEY, value: GOOD_TOKEN }]),
        baseURL: api.url,
      });
      expect(r.user).toBe("wipha@rungrueang.co.th");
      expect(r.tokenChars).toBe(GOOD_TOKEN.length);
    } finally {
      await api.close();
    }
  });

  test("REFUSES with a bad token — the same server, the same call, only the token differs", async () => {
    const api = await apiStub(realish);
    try {
      await expect(
        assertAuthenticatedSession({
          storageStatePath: stateFile("bad", [{ name: AUTH_TOKEN_KEY, value: "expired.token.sig" }]),
          baseURL: api.url,
        })
      ).rejects.toThrow(/EXPIRED or INVALID/);
    } finally {
      await api.close();
    }
  });

  test("REFUSES with no token at all (VISUAL_STORAGE_STATE unset / no token key)", async () => {
    await expect(assertAuthenticatedSession({ storageStatePath: undefined, baseURL: "http://unused" })).rejects.toThrow(
      /VISUAL_STORAGE_STATE is not set/
    );
    await expect(
      assertAuthenticatedSession({ storageStatePath: join(SELFTEST_ROOT, "does-not-exist.json"), baseURL: "http://unused" })
    ).rejects.toThrow(/does not exist/);
    await expect(
      assertAuthenticatedSession({
        storageStatePath: stateFile("wrongkey", [{ name: "some-other-key", value: "x" }]),
        baseURL: "http://unused",
      })
    ).rejects.toThrow(new RegExp(`no "${AUTH_TOKEN_KEY}" localStorage entry`));
    await expect(
      assertAuthenticatedSession({
        storageStatePath: stateFile("emptyval", [{ name: AUTH_TOKEN_KEY, value: "" }]),
        baseURL: "http://unused",
      })
    ).rejects.toThrow(/carries no bearer token/);
  });

  test("REFUSES when the /api proxy serves index.html with HTTP 200 (the measured past failure)", async () => {
    const api = await apiStub((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><html><head><title>Juneflow</title></head><body><div id=root></div></body></html>");
    });
    try {
      await expect(
        assertAuthenticatedSession({
          storageStatePath: stateFile("html", [{ name: AUTH_TOKEN_KEY, value: GOOD_TOKEN }]),
          baseURL: api.url,
        })
      ).rejects.toThrow(/serving index\.html for API paths/);
    } finally {
      await api.close();
    }
  });

  test("REFUSES when the session is a DIFFERENT user than the run expects", async () => {
    const api = await apiStub(realish);
    try {
      await expect(
        assertAuthenticatedSession({
          storageStatePath: stateFile("whoami", [{ name: AUTH_TOKEN_KEY, value: GOOD_TOKEN }]),
          baseURL: api.url,
          expectUser: "somebody.else@rungrueang.co.th",
        })
      ).rejects.toThrow(/but the run expects/);
    } finally {
      await api.close();
    }
  });

  test("REFUSES a 200 that does not say WHO the session is (no user.email)", async () => {
    // A 200 with no identity cannot prove the run is the user the pack expects,
    // and "200" alone is exactly what a misrouted proxy also returns.
    const api = await apiStub((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ user: {}, role: {}, package: {} }));
    });
    try {
      await expect(
        assertAuthenticatedSession({
          storageStatePath: stateFile("noemail", [{ name: AUTH_TOKEN_KEY, value: GOOD_TOKEN }]),
          baseURL: api.url,
        })
      ).rejects.toThrow(/carried no user\.email/);
    } finally {
      await api.close();
    }
  });

  test("promoteAuthPreflight: no-op when promote is OFF, refusal when promote is ON", async () => {
    // The wiring itself, not just the check: a compare run must not acquire a
    // new way to fail, and a promote run must not be able to skip the check.
    const badState = { storageStatePath: undefined, baseURL: "http://unused" };
    await expect(promoteAuthPreflight(null, badState)).resolves.toBeNull();

    const api = await apiStub(realish);
    try {
      await expect(promoteAuthPreflight({} as object, badState)).rejects.toThrow(/VISUAL_STORAGE_STATE is not set/);
      const ok = await promoteAuthPreflight({} as object, {
        storageStatePath: stateFile("wiring", [{ name: AUTH_TOKEN_KEY, value: GOOD_TOKEN }]),
        baseURL: api.url,
      });
      expect(ok?.user).toBe("wipha@rungrueang.co.th");
    } finally {
      await api.close();
    }
  });

  test("REFUSES when the API is not up at all (no silent skip)", async () => {
    const api = await apiStub(realish);
    const dead = api.url;
    await api.close(); // nothing is listening on that port now
    await expect(
      assertAuthenticatedSession({
        storageStatePath: stateFile("down", [{ name: AUTH_TOKEN_KEY, value: GOOD_TOKEN }]),
        baseURL: dead,
        timeoutMs: 2000,
      })
    ).rejects.toThrow(/did not answer the pre-flight/);
  });
});

test.describe("visual gate · promote mode · GUARD 4 the written manifest (B-409)", () => {
  test("staging writes nothing to reference/; commit writes exactly the captured bytes", async ({ page }) => {
    const sb = sandbox("guard4-write");
    const list = rows(["a", "b", "c"]);
    seedExistingRefs(sb, list);
    const before = packHashes(sb, list);
    const session = openPromoteSession(PROMOTE_ON, list, sb.opts)!;
    const shots = await Promise.all(list.map((_, i) => makePng(page, 500 + i)));
    list.forEach((r, i) => session.stage(r, shots[i], cleanCapture(r)));
    // Staged, not promoted: the pack is still untouched.
    expect(packHashes(sb, list)).toEqual(before);
    const summary = session.commit();
    expect(summary.promoted).toBe(3);
    // Byte-exact promotion — the file on disk IS the capture.
    list.forEach((r, i) => {
      expect(readFileSync(join(sb.refDir, r.ref)).equals(shots[i]), r.screen).toBe(true);
    });
    expect(summary.records.map((r) => r.sha256).sort()).toEqual(shots.map((s) => sha256(s)).sort());
    expect(() => session.commit()).toThrow(/twice/);
  });

  test("the manifest is stable-ordered, complete, and free of run-specific noise", async ({ page }) => {
    // Routes deliberately DIFFER from screen ids. With route === screen (the
    // rows() helper's default) the screen and route columns are interchangeable,
    // so a manifest that swapped them would still satisfy every assertion below
    // — the test would pin nothing about which column is which.
    const list: PromoteRow[] = ["zulu", "alpha", "mike"].map((n) => ({
      screen: n,
      route: `nav/${n}`,
      ref: `app-baseline/${n}.png`,
      viewport: { width: 120, height: 80 },
    }));
    const shots = await Promise.all(list.map((_, i) => makePng(page, 900 + i)));

    // Two independent runs over the SAME captures, staged in OPPOSITE orders —
    // the two-run reproducibility check diffs these files, so ordering and
    // content must depend only on the pixels.
    const runA = sandbox("guard4-manifest-a");
    seedExistingRefs(runA, list);
    const a = openPromoteSession(PROMOTE_ON, list, runA.opts)!;
    list.forEach((r, i) => a.stage(r, shots[i], cleanCapture(r)));
    a.commit();

    const runB = sandbox("guard4-manifest-b");
    seedExistingRefs(runB, list);
    const b = openPromoteSession(PROMOTE_ON, list, runB.opts)!;
    [2, 0, 1].forEach((i) => b.stage(list[i], shots[i], cleanCapture(list[i])));
    b.commit();

    const textA = readFileSync(runA.opts.manifestPath, "utf8");
    const textB = readFileSync(runB.opts.manifestPath, "utf8");
    expect(textB, "two runs of the same pixels must produce byte-identical manifests").toBe(textA);

    const dataLines = textA.trimEnd().split("\n").filter((l) => !l.startsWith("#"));
    expect(dataLines).toHaveLength(3);
    expect(dataLines.map((l) => l.split("\t")[3])).toEqual(["alpha", "mike", "zulu"]); // sorted
    for (const [i, screen] of ["alpha", "mike", "zulu"].entries()) {
      const cols = dataLines[i].split("\t");
      const shot = shots[list.findIndex((r) => r.screen === screen)];
      expect(cols[0]).toBe(sha256(shot)); // sha256
      expect(cols[1]).toBe(String(shot.length)); // byte size
      expect(cols[2]).toBe("120x80"); // captured dimensions (WxH)
      expect(cols[3]).toBe(screen); // screen id
      expect(cols[4]).toBe(`nav/${screen}`); // route — NOT the same string as the screen
      expect(cols[5]).toBe(`app-baseline/${screen}.png`); // ref path
    }
    // No timestamps, no host paths, no run ids — anything that differs run to
    // run would make the reproducibility diff meaningless.
    expect(textA).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(textA).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(textA).not.toContain(runA.root);
  });

  test("a whole-run viewport change is legible in the manifest diff, not just 'every sha moved'", async ({ page }) => {
    // The failure this column exists for: run 1 and run 2 are captured at
    // different viewports (a stale --window-size, a deviceScaleFactor, headed vs
    // headless). EVERY sha256 differs, which is the same signature as "the app
    // changed on every screen" — the operator diffs the two manifests and learns
    // nothing about which of the two it is. The dimensions are already measured
    // per record (IHDR at stage time), so the diff can just say so.
    const names = ["alpha", "mike", "zulu"];
    const mk = (w: number, h: number): PromoteRow[] =>
      names.map((n) => ({ screen: n, route: n, ref: `app-baseline/${n}.png`, viewport: { width: w, height: h } }));

    const small = mk(120, 80);
    const runA = sandbox("guard4-viewport-a");
    seedExistingRefs(runA, small);
    const a = openPromoteSession(PROMOTE_ON, small, runA.opts)!;
    for (const [i, r] of small.entries()) a.stage(r, await makePng(page, 700 + i, 120, 80), cleanCapture(r));
    a.commit();

    const large = mk(160, 100);
    const runB = sandbox("guard4-viewport-b");
    seedExistingRefs(runB, large);
    const b = openPromoteSession(PROMOTE_ON, large, runB.opts)!;
    for (const [i, r] of large.entries()) b.stage(r, await makePng(page, 700 + i, 160, 100), cleanCapture(r));
    b.commit();

    const data = (p: string) =>
      readFileSync(p, "utf8").trimEnd().split("\n").filter((l) => !l.startsWith("#"));
    const linesA = data(runA.opts.manifestPath);
    const linesB = data(runB.opts.manifestPath);
    expect(linesA).toHaveLength(3);

    // Every line differs (the sha of a 160x100 render is nothing like a 120x80
    // one) — that is precisely the ambiguous signal...
    for (const [i, la] of linesA.entries()) expect(linesB[i]).not.toBe(la);
    // ...and the reason is readable on the line itself, screen by screen.
    for (const [i, screen] of names.entries()) {
      expect(linesA[i].split("\t")[2], `${screen} run-1 size`).toBe("120x80");
      expect(linesB[i].split("\t")[2], `${screen} run-2 size`).toBe("160x100");
    }
  });

  test("renderPromoteManifest is a pure function of the records", async () => {
    const recs = [
      { screen: "b", route: "b.r", ref: "app-baseline/b.png", bytes: 2, sha256: "22", width: 1, height: 1, stagedPath: "/tmp/one" },
      { screen: "a", route: "a.r", ref: "app-baseline/a.png", bytes: 1, sha256: "11", width: 1, height: 1, stagedPath: "/tmp/two" },
    ];
    const once = renderPromoteManifest(recs);
    expect(renderPromoteManifest([...recs].reverse())).toBe(once);
    expect(once.endsWith("\n")).toBe(true);
    expect(once).not.toContain("/tmp/"); // staging paths are run-specific noise
  });
});

// ---- GUARD 2b · the operator-supplied ARTIFACT paths -------------------------
//
// GUARD 2 proves an IMAGE write cannot leave app-baseline/. These three paths —
// stagingDir, manifestPath (settable from the command line as
// VISUAL_PROMOTE_MANIFEST), evidencePath — had no check at all, and each of the
// three tests below reproduces something that was MEASURED to happen on
// 2026-08-17 with the guard absent, not something imagined:
//
//   * the manifest path minted app-baseline/run-1.txt inside the pack;
//   * stagingDir === refDir passed the old strict-prefix test and the
//     constructor's rmSync deleted reference/app-baseline/ outright;
//   * a symlinked ancestor created a real staging/ directory inside reference/.
//
// Every test asserts REFUSED-AND-UNTOUCHED, never refused-and-moved-elsewhere.
test.describe("visual gate · promote mode · GUARD 2b operator artifact paths (B-409)", () => {
  /** What is in the pack right now — names, not just the declared rows. */
  function packEntries(sb: Sandbox): { ref: string[]; baseline: string[] } {
    return {
      ref: readdirSync(sb.refDir).sort(),
      baseline: existsSync(join(sb.refDir, "app-baseline"))
        ? readdirSync(join(sb.refDir, "app-baseline")).sort()
        : ["(app-baseline DELETED)"],
    };
  }

  /** One planned row with its baseline already on disk. */
  function onePackScreen(name: string) {
    const sb = sandbox(name);
    const list = rows(["alpha"]);
    seedExistingRefs(sb, list);
    return { sb, list, before: packHashes(sb, list), entries: packEntries(sb) };
  }

  test("a manifest path INSIDE the pack is refused — the promote mints nothing, anywhere", async () => {
    const { sb, list, before, entries } = onePackScreen("guard2b-manifest-in-pack");
    const insidePack = join(sb.refDir, "app-baseline", "run-1.txt");
    let err: Error | null = null;
    try {
      openPromoteSession(PROMOTE_ON, list, { ...sb.opts, manifestPath: insidePack });
    } catch (e) {
      err = e as Error;
    }
    expect(err, "an artifact path inside the pack must refuse").not.toBeNull();
    expect(err).toBeInstanceOf(PromoteRefusal);
    expect(err!.message).toMatch(/inside the reference pack/);
    expect(err!.message).toContain("manifestPath");
    // The measured failure was a file appearing in app-baseline/. Not one byte
    // of the pack may change, and no run-1.txt may exist.
    expect(existsSync(insidePack), "no artifact may be minted inside the pack").toBe(false);
    expect(packEntries(sb)).toEqual(entries);
    expect(packHashes(sb, list)).toEqual(before);
    expect(existsSync(sb.opts.stagingDir)).toBe(false);
  });

  test("stagingDir === the pack root is refused (the constructor rm -rf's stagingDir)", async () => {
    const { sb, list, before, entries } = onePackScreen("guard2b-staging-is-pack");
    // The old test was `startsWith(resolve(refDir) + sep)`, and a directory is
    // not a strict prefix of itself, so this exact value walked through it into
    // rmSync(stagingDir, {recursive:true, force:true}).
    let err: Error | null = null;
    try {
      openPromoteSession(PROMOTE_ON, list, { ...sb.opts, stagingDir: sb.refDir });
    } catch (e) {
      err = e as Error;
    }
    expect(err, "stagingDir === refDir must refuse before the rmSync").not.toBeNull();
    expect(err!.message).toMatch(/inside the reference pack/);
    expect(err!.message).toContain("stagingDir");
    // THE measurement: with the guard removed, both of these were gone.
    expect(existsSync(join(sb.refDir, "app-baseline")), "the pack directory must still exist").toBe(true);
    expect(packEntries(sb)).toEqual(entries);
    expect(packHashes(sb, list)).toEqual(before);
  });

  test("an artifact path reaching the pack through a SYMLINKED ancestor is refused", async () => {
    const { sb, list, before, entries } = onePackScreen("guard2b-symlink");
    // resolve() cannot see this; only a realpath can. Measured with the guard
    // absent: a real staging/ directory appeared inside reference/.
    const link = join(sb.root, "looks-innocent");
    symlinkSync(sb.refDir, link);
    for (const [label, opts] of [
      ["stagingDir", { ...sb.opts, stagingDir: join(link, "staging") }],
      ["manifestPath", { ...sb.opts, manifestPath: join(link, "app-baseline", "run-1.txt") }],
      ["evidencePath", { ...sb.opts, evidencePath: join(link, "evidence.json") }],
    ] as const) {
      expect(() => openPromoteSession(PROMOTE_ON, list, opts), label).toThrow(/inside the reference pack/);
    }
    expect(packEntries(sb)).toEqual(entries);
    expect(packHashes(sb, list)).toEqual(before);
  });

  test("an artifact path that already exists as a DIRECTORY is refused before any capture", async () => {
    const { sb, list, before } = onePackScreen("guard2b-dir");
    // writeFileSync on a directory throws EISDIR — and the manifest is written
    // AFTER the pack has been overwritten, so without this the operator ends up
    // with a re-baselined arbiter, no manifest to diff, and a stack trace
    // instead of a refusal.
    const asDir = join(sb.root, "run-1.txt");
    mkdirSync(asDir, { recursive: true });
    expect(() =>
      openPromoteSession(PROMOTE_ON, list, { ...sb.opts, manifestPath: asDir })
    ).toThrow(/not a regular file/);
    expect(packHashes(sb, list)).toEqual(before);
    expect(existsSync(sb.opts.stagingDir)).toBe(false);
  });

  test("an artifact path whose PARENT is a file is refused before any capture", async () => {
    // Same harm, one directory up: commit() creates the artifact's directory
    // with mkdirSync(recursive) and that throws ENOTDIR, at the same late
    // moment — pack already rewritten, no manifest, a stack trace instead of a
    // refusal. `VISUAL_PROMOTE_MANIFEST=$RUN/run-1.txt` where $RUN turned out to
    // be a file is an ordinary shell mistake.
    const { sb, list, before } = onePackScreen("guard2b-parent-is-file");
    const notADir = join(sb.root, "runs");
    writeFileSync(notADir, Buffer.from("i am a file, not a directory"));
    expect(() =>
      openPromoteSession(PROMOTE_ON, list, { ...sb.opts, manifestPath: join(notADir, "run-1.txt") })
    ).toThrow(/is not a directory/);
    expect(packHashes(sb, list)).toEqual(before);
    expect(existsSync(sb.opts.stagingDir)).toBe(false);
  });

  test("a directory whose name merely STARTS with the pack path is not the pack", async ({ page }) => {
    // The containment test compares path + separator on both sides. Drop the
    // separator and `<...>/reference-runs/run-1.txt` reads as "inside
    // <...>/reference" — a guard that refuses the operator's legitimate,
    // outside-the-pack location is a guard they will route around.
    const { sb, list } = onePackScreen("guard2b-sibling-dir");
    const sibling = `${sb.refDir}-runs`;
    mkdirSync(sibling, { recursive: true });
    const manifestPath = join(sibling, "run-1.txt");
    const session = openPromoteSession(PROMOTE_ON, list, { ...sb.opts, manifestPath })!;
    session.stage(list[0], await makePng(page, 1234), cleanCapture(list[0]));
    const summary = session.commit();
    expect(summary.promoted).toBe(1);
    // ...and it was written EXACTLY where it was pointed, not relocated.
    expect(summary.manifestPath).toBe(manifestPath);
    expect(existsSync(manifestPath)).toBe(true);
    expect(readFileSync(manifestPath, "utf8")).toContain("app-baseline/alpha.png");
    expect(readdirSync(join(sb.refDir, "app-baseline"))).toEqual(["alpha.png"]);
  });
});

// ---- the PNG header decoder + the size bounds --------------------------------
//
// Every one of these was a SURVIVING mutant in the 58-mutant sweep of
// 2026-08-17: the guard could be deleted and the whole promote suite stayed
// green. They are pure functions over bytes, so there is no excuse for that.
test.describe("visual gate · promote mode · readPngSize + size bounds (B-409)", () => {
  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  /** A hand-built PNG header, deliberately corrupt in exactly one way. */
  function header(o: { sig?: boolean; type?: string; width?: number; height?: number; bytes?: number } = {}): Buffer {
    const { sig = true, type = "IHDR", width = 4, height = 3, bytes = 24 } = o;
    const b = Buffer.alloc(bytes);
    Buffer.from(sig ? PNG_SIG : [0x4e, 0x4f, 0x50, 0x45, 0x21, 0x21, 0x21, 0x21]).copy(b, 0);
    b.write(type, 12, "latin1");
    if (bytes >= 20) b.writeUInt32BE(width, 16);
    if (bytes >= 24) b.writeUInt32BE(height, 20);
    return b;
  }

  test("a header that is not a readable PNG header returns null — it never throws", async () => {
    // A truncated buffer is the one that matters most: without the length
    // check, readUInt32BE(20) walks off the end and readPngSize throws a
    // RangeError instead of returning null. The caller's contract is "null
    // means not a decodable PNG", and it turns that into a PROMOTE REFUSED
    // message plus an evidence row; a RangeError is a stack trace with no
    // evidence written for the screen that produced it.
    expect(readPngSize(header({ bytes: 20 })), "truncated header").toBeNull();
    expect(readPngSize(header({ sig: false })), "wrong signature").toBeNull();
    expect(readPngSize(header({ type: "IDAT" })), "first chunk is not IHDR").toBeNull();
    expect(readPngSize(header({ width: 0 })), "zero width").toBeNull();
    expect(readPngSize(header({ height: 0 })), "zero height").toBeNull();
    // ...and a well-formed header still decodes: this is not a blanket null.
    expect(readPngSize(header())).toEqual({ width: 4, height: 3 });
  });

  test("a decodable, correctly-sized capture that is far too small is still refused", async ({ page }) => {
    // 128 and 32 MiB are LITERAL here on purpose (same reason as the identical
    // group cap): written as MIN_PNG_BYTES the assertion would follow the
    // constant anywhere it moved, including to 0, and stay green.
    const row: PromoteRow = { screen: "tiny", route: "tiny", ref: "app-baseline/tiny.png", viewport: { width: 1, height: 1 } };
    const png = await makePng(page, 3, 1, 1);
    // The trap this bound is for: it decodes, and its dimensions MATCH the
    // viewport, so neither the PNG check nor the dimension check says a word.
    expect(readPngSize(png)).toEqual({ width: 1, height: 1 });
    expect(png.length).toBeLessThan(128);
    expect(captureProblems(row, png, cleanCapture(row)).join(" · ")).toMatch(/MIN_PNG_BYTES/);

    // The other end: a runaway capture, same intact header.
    const runaway = Buffer.concat([png], 32 * 1024 * 1024 + 1);
    expect(readPngSize(runaway)).toEqual({ width: 1, height: 1 });
    expect(captureProblems(row, runaway, cleanCapture(row)).join(" · ")).toMatch(/MAX_PNG_BYTES/);
  });
});

// ---- staging bookkeeping ------------------------------------------------------
//
// Both were surviving mutants too. stage() is where a capture becomes a
// promotable record, and both of these decide WHICH pixels end up in the pack.
test.describe("visual gate · promote mode · stage() bookkeeping (B-409)", () => {
  test("staging a screen the manifest never declared is REFUSED, not crashed on", async ({ page }) => {
    const sb = sandbox("stage-unplanned");
    const list = rows(["only"]);
    seedExistingRefs(sb, list);
    const session = openPromoteSession(PROMOTE_ON, list, sb.opts)!;
    const ghost: PromoteRow = { screen: "ghost", route: "ghost", ref: "app-baseline/ghost.png", viewport: { width: 120, height: 80 } };
    const png = await makePng(page, 21);
    // Without the check this dereferences an undefined target and dies with a
    // TypeError — which fails the run, but as a crash: no PROMOTE REFUSED, no
    // named screen, nothing that tells the operator their manifest and their
    // capture loop disagree about which screens exist.
    expect(() => session.stage(ghost, png, cleanCapture(ghost))).toThrow(/not a planned target/);
    expect(session.stagedRecords()).toHaveLength(0);
  });

  test("staging one screen twice is REFUSED — the second capture must not win silently", async ({ page }) => {
    const sb = sandbox("stage-twice");
    const list = rows(["only"]);
    seedExistingRefs(sb, list);
    const session = openPromoteSession(PROMOTE_ON, list, sb.opts)!;
    const first = await makePng(page, 31);
    const second = await makePng(page, 32);
    expect(first.equals(second)).toBe(false);
    session.stage(list[0], first, cleanCapture(list[0]));
    // Without the check the second record silently replaces the first, and the
    // pack ends up holding a capture the run already decided against — with a
    // manifest that cannot show it happened, because it records one row either
    // way. A retry loop or a duplicated manifest row is all it takes.
    expect(() => session.stage(list[0], second, cleanCapture(list[0]))).toThrow(/staged twice/);
    expect(session.stagedRecords()).toHaveLength(1);
    session.commit();
    expect(readFileSync(join(sb.refDir, list[0].ref)).equals(first)).toBe(true);
  });
});

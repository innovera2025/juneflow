import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { Page } from "@playwright/test";

// tests/visual/lib/compare.ts — jpg-aware screenshot comparison engine for the
// visual gate (Gate G5 — PLAN.md §0 + §9).
//
// The documented problem (see playwright.visual.config.ts): Playwright's built-in
// toHaveScreenshot() decodes .png only, but 106 of the 128 references are .jpg
// (pototype/gallery/g1-g5). Instead of adding a native image dependency, we reuse
// the chromium browser Playwright already drives to decode BOTH the reference
// (.jpg OR .png) and the candidate (.png) into raw RGBA, then diff them.
//
// Iron rules honored here (skill visual-gate):
//   - reference/ files are read-only ground truth — we only READ them.
//   - start strict: default channelThreshold 0 + maxDiffPixelRatio 0. Loosening
//     for lossy-jpg real screenshots is a calibration decision that belongs to
//     Wei / BLOCKERS.md, NOT to this mechanism — hence env-configurable, not
//     silently relaxed.

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export interface CompareOptions {
  // A pixel counts as "different" when any RGBA channel delta exceeds this.
  // Default 0 = exact match required (strict). Env: VISUAL_CHANNEL_THRESHOLD.
  channelThreshold?: number;
  // Verdict is FAIL when diffRatio exceeds this. Default 0 = zero tolerance.
  // Env: VISUAL_MAX_DIFF_PIXEL_RATIO.
  maxDiffPixelRatio?: number;
}

export interface DiffResult {
  refPath: string;
  candLabel: string;
  refDims: { w: number; h: number };
  candDims: { w: number; h: number };
  dimensionMismatch: boolean;
  diffPixels: number;
  totalPixels: number;
  diffRatio: number;
  verdict: "PASS" | "FAIL";
  note: string;
  // PNG (base64, no data-url prefix) highlighting differing pixels in red.
  diffPngBase64: string | null;
}

export function mimeForPath(path: string): string {
  const mime = MIME_BY_EXT[extname(path).toLowerCase()];
  if (!mime) throw new Error(`Unsupported reference image type: ${path}`);
  return mime;
}

export function fileToDataUrl(path: string): string {
  const bytes = readFileSync(path);
  return `data:${mimeForPath(path)};base64,${bytes.toString("base64")}`;
}

function resolveOptions(opts: CompareOptions): Required<CompareOptions> {
  const channelThreshold =
    opts.channelThreshold ??
    Number(process.env.VISUAL_CHANNEL_THRESHOLD ?? "0");
  const maxDiffPixelRatio =
    opts.maxDiffPixelRatio ??
    Number(process.env.VISUAL_MAX_DIFF_PIXEL_RATIO ?? "0");
  return { channelThreshold, maxDiffPixelRatio };
}

/**
 * Decode a reference image (jpg/png) and a candidate PNG buffer inside chromium
 * and compute a pixel diff. `candidate` is a data URL (usually a PNG screenshot
 * captured via page.screenshot(), or a synthetic PNG for self-verification).
 */
export async function compareImages(
  page: Page,
  refPath: string,
  candidateDataUrl: string,
  candLabel: string,
  opts: CompareOptions = {}
): Promise<DiffResult> {
  const { channelThreshold, maxDiffPixelRatio } = resolveOptions(opts);
  const refDataUrl = fileToDataUrl(refPath);

  const raw = await page.evaluate(
    async ({ refDataUrl, candidateDataUrl, channelThreshold }) => {
      function load(src: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("decode failed"));
          img.src = src;
        });
      }
      function toData(img: HTMLImageElement): ImageData {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height);
      }

      const [refImg, candImg] = await Promise.all([
        load(refDataUrl),
        load(candidateDataUrl),
      ]);
      const ref = toData(refImg);
      const cand = toData(candImg);

      const dimensionMismatch =
        ref.width !== cand.width || ref.height !== cand.height;

      // Diff canvas sized to the reference; overlap compared pixel-wise, any
      // out-of-overlap region counts as fully different (a layout/size change is
      // a real visual-gate failure per PLAN.md §0).
      const w = ref.width;
      const h = ref.height;
      const diff = document.createElement("canvas");
      diff.width = w;
      diff.height = h;
      const dctx = diff.getContext("2d")!;
      const out = dctx.createImageData(w, h);

      const overlapW = Math.min(ref.width, cand.width);
      const overlapH = Math.min(ref.height, cand.height);
      let diffPixels = 0;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const inOverlap = x < overlapW && y < overlapH;
          let differs: boolean;
          if (!inOverlap) {
            differs = true;
          } else {
            const j = (y * cand.width + x) * 4;
            const dr = Math.abs(ref.data[i] - cand.data[j]);
            const dg = Math.abs(ref.data[i + 1] - cand.data[j + 1]);
            const db = Math.abs(ref.data[i + 2] - cand.data[j + 2]);
            const da = Math.abs(ref.data[i + 3] - cand.data[j + 3]);
            differs = Math.max(dr, dg, db, da) > channelThreshold;
          }
          if (differs) {
            diffPixels++;
            out.data[i] = 255; // red highlight
            out.data[i + 1] = 0;
            out.data[i + 2] = 0;
            out.data[i + 3] = 255;
          } else {
            // faded original for context
            out.data[i] = ref.data[i];
            out.data[i + 1] = ref.data[i + 1];
            out.data[i + 2] = ref.data[i + 2];
            out.data[i + 3] = 60;
          }
        }
      }
      dctx.putImageData(out, 0, 0);

      return {
        refW: ref.width,
        refH: ref.height,
        candW: cand.width,
        candH: cand.height,
        dimensionMismatch,
        diffPixels,
        totalPixels: w * h,
        diffPng: diff.toDataURL("image/png").split(",")[1],
      };
    },
    { refDataUrl, candidateDataUrl, channelThreshold }
  );

  const diffRatio = raw.totalPixels === 0 ? 0 : raw.diffPixels / raw.totalPixels;
  // A dimension mismatch is an unconditional FAIL in EVERY direction (candidate
  // larger, smaller, or off-shape) — a layout/size change is a real visual-gate
  // failure per PLAN.md §0. This must not depend on diffRatio: when the candidate
  // is larger than the reference the ref-sized diff loop never inspects the extra
  // candidate area, so diffRatio can be 0 and would otherwise PASS silently.
  const verdict: DiffResult["verdict"] =
    raw.dimensionMismatch || diffRatio > maxDiffPixelRatio ? "FAIL" : "PASS";

  let note = "";
  if (raw.dimensionMismatch) {
    note = `dimension mismatch ref=${raw.refW}x${raw.refH} cand=${raw.candW}x${raw.candH} (layout change → auto-FAIL per PLAN.md §0)`;
  } else if (verdict === "FAIL") {
    note = `diffRatio ${diffRatio.toFixed(6)} > maxDiffPixelRatio ${maxDiffPixelRatio}`;
  } else {
    note = "within tolerance";
  }

  return {
    refPath,
    candLabel,
    refDims: { w: raw.refW, h: raw.refH },
    candDims: { w: raw.candW, h: raw.candH },
    dimensionMismatch: raw.dimensionMismatch,
    diffPixels: raw.diffPixels,
    totalPixels: raw.totalPixels,
    diffRatio,
    verdict,
    note,
    diffPngBase64: raw.diffPng,
  };
}

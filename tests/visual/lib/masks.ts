import type { MaskRegion } from "./compare";

// tests/visual/lib/masks.ts — named registry of Wei-approved mask regions
// (P0-QA-07). Masks are opt-in PER SCREEN via the "masks" field of a
// screens.manifest.json entry (list of registry keys) — there is no global or
// ambient mask. Every region cites the approving BLOCKERS.md id in `reason`
// (enforced by validateMaskRegions in compare.ts).
//
// Screens WITHOUT the region simply do not list the key — e.g. the login
// screen (P1-WEB-01) has no sidebar logo lockup, so it must NOT opt into
// "sidebar-logo-b044".

export const MASK_REGISTRY: Record<string, MaskRegion> = {
  // B-120(ข) — Wei ruling 2026-07-20 (G5 re-baseline as regression gate; the
  // ruling pre-noted "clock-relative … may need masks"): the page-header carries
  // LIVE-TIME widgets that legitimately differ between a baseline capture and a
  // gate capture — (1) the "(อัปเดต HH:MM น.)" last-updated text (dashboard /
  // subcon.contracts), (2) the date chip "20 ก.ค. 69" (TODAY — changes daily)
  // next to the period tabs. Measured from the app-baseline diffs
  // (agents/orch-b-recon/g5-bringup-results): red-px bboxes x[646-1562] y[109-139]
  // (update-time) and x[1166-1562] y[109-110] (chip/tabs edge AA).
  "header-update-time-b120": {
    x: 560,
    y: 92,
    width: 240,
    height: 60,
    reason:
      "B-120(ข) Wei-approved 2026-07-20 — live '(อัปเดต HH:MM น.)' last-updated clock in the page header ticks between baseline and gate captures",
  },
  "header-date-chip-b120": {
    x: 1120,
    y: 92,
    width: 470,
    height: 62,
    reason:
      "B-120(ข) Wei-approved 2026-07-20 — TODAY date chip ('20 ก.ค. 69') + period-tab strip edge: date text changes daily; strip border AA jitters sub-pixel between captures",
  },

  // B-186 / B-160 / B-120(ข) — live wall-clock mask for the sub.mine (SubMine) "days
  // until renewal" warn strip. sub-mine.tsx:167 computes daysLeft(me.renewAt, new Date()):
  // renewAt is a FIXED seed date (2026-12-31) but `new Date()` (now) advances daily, so the
  // rendered day-count decrements every day and the number's digit-count reflows the trailing
  // Thai text — a naked baseline would flake tomorrow. This is EXACTLY the class B-120(ข)
  // pre-authorised ("clock-relative seed may need masks later if a screen proves time-sensitive")
  // and B-160 addressed (body-level relative-time masks) — NOT silencing a real regression.
  //
  // Rect measured LIVE from the warn-strip element (b.num's closest <div>, the only <b class=
  // "num"> on the screen) at 1600x1000, deviceScaleFactor 1: bbox x295.0 y513.25 w493.66 h37.0
  // (text "เหลืออีก 156 วันก่อนต่ออายุ"). Mask x293 y511 w498 h42 wraps it with a ~2px AA margin
  // and stays clear of the DetailRows above (y<511) and the renew/cancel buttons below (y>553) —
  // it covers ONLY the drifting strip, no neighbouring element (PLAN.md §0 minimal-mask).
  "sub-mine-daysleft-b186": {
    x: 293,
    y: 511,
    width: 498,
    height: 42,
    reason:
      "B-186 first-time G5 app-baseline (sub.mine) — the daysLeft warn strip is a live wall-clock element (daysLeft(renewAt, new Date()) decrements daily); masking this class is pre-authorised by B-120(ข) live-time-widget ruling + B-160 body relative-time follow-up. Covers only the measured strip bbox (x295 y513 w494 h37), not neighbouring content",
  },

  // B-044(ก) — Wei ruling 2026-07-13: the port's t("app.name") th =
  // "ระบบงานก่อสร้าง" is CORRECT; all ~128 reference images carry an older
  // logo lockup (lowercase "juneflow" wordmark + English "Construction ERP"
  // tagline). Differences inside the sidebar logo region are Wei-approved.
  //
  // Rect measured from tests/visual/reference/gallery/g1/01-s.jpg (1600x1000):
  //   - lockup content bbox: x 16..124, y 16..55
  //     (icon tile x16..49 y15..50 · wordmark x60..119 y21..33 ·
  //      tagline "Construction"/"ERP" x60..124 y35..54)
  //   - header/nav divider at y=64-65 · ลูกค้า/เจ้าของระบบ toggle from y≈69
  // Mask x8..231, y6..61: wraps the lockup with margin + horizontal headroom
  // for the port's one-line Thai tagline (t("app.name")), and stays ABOVE the
  // y=64 divider so the toggle/search/menu rows below are never masked.
  "sidebar-logo-b044": {
    x: 8,
    y: 6,
    width: 224,
    height: 56,
    reason:
      "B-044(ก) Wei-approved 2026-07-13 — sidebar logo lockup: references show older 'juneflow / Construction ERP'; port renders brand mark + t(\"app.name\") (th: ระบบงานก่อสร้าง)",
  },

  // B-048(ก) — Wei ruling 2026-07-13 ("ตอบแล้ว — นำไปใช้", task P0-QA-08):
  // shell-only G5. A shell-bearing route (app-shell) ships the chrome
  // (Sidebar + per-page TopBar) BEFORE its body screen is ported, so the
  // reference's content area (e.g. the full Dashboard in g1/01-s.jpg) has no
  // counterpart yet — only a Placeholder. This mask EXCLUDES the content
  // region so G5 compares ONLY the chrome until the body screen lands
  // (dashboard → P1-WEB-07), at which point full-page G5 returns and this key
  // is dropped from the row.
  //
  // Geometry (reference-image coords, verified against the ported shell):
  //   - sidebar occupies the full-height left column, width 244
  //     (apps/web/src/shell/sidebar.tsx:147 · ported from chrome.jsx:340-444;
  //      consistent with the B-044 logo lockup ending at x=231 < 244).
  //   - the per-page TopBar is the top band of the content column, height 56
  //     (apps/web/src/shell/topbar.tsx:36 · ds.jsx Page → TopBar).
  //   => chrome = sidebar (x<244, any y) + topbar (x>=244, y<56);
  //      content  = x>=244 AND y>=56  → the rectangle masked here.
  // Sized to the 1600x1000 g1-g4 gallery references (244+1356=1600,
  // 56+944=1000) so it reaches the bottom-right corner exactly. compare.ts
  // clips every mask rect to the reference bounds (Math.min(w,...)/Math.min(h,...)),
  // so a smaller reference is handled safely too.
  //
  // This is a targeted, Wei-approved SPATIAL exclusion, NOT a threshold
  // loosening: channelThreshold/maxDiffPixelRatio stay 0, chrome differences
  // outside this rect still FAIL, and the dimensionMismatch auto-FAIL
  // (P0-FIX-04) is untouched — a size/layout change can never be masked away.
  "content-area-b048": {
    x: 244,
    y: 56,
    width: 1356,
    height: 944,
    reason:
      "B-048(ก) Wei-approved 2026-07-13 (P0-QA-08) — shell-only G5: content region (x>=244, y>=56) excluded so a shell-bearing route compares ONLY chrome (sidebar+topbar) until its body screen is ported (dashboard → P1-WEB-07); drop this key once full-page G5 returns",
  },
};

/** Resolve manifest mask keys → regions. Unknown key = config error, throw. */
export function resolveMasks(names: string[] | undefined): MaskRegion[] {
  if (!names || names.length === 0) return [];
  return names.map((name) => {
    const region = MASK_REGISTRY[name];
    if (!region) {
      throw new Error(
        `Unknown mask "${name}" — known masks: ${Object.keys(MASK_REGISTRY).join(", ")} (tests/visual/lib/masks.ts)`
      );
    }
    return region;
  });
}

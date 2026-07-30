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

  // ── B-160 body date-column masks (G5 baseline date-drift · orch-B QA 2026-07-29) ──
  // Root cause (measured live on the running stack): 8 list/detail screens render a
  // SERVER-side date/time value that equals the SEED DAY — either the row's `created_at`
  // (schema defaultNow() → the DB-insert instant) or a SEED_TODAY-relative due/start date
  // (packages/db/seed: `SEED_NOW = new Date()` + isoDaysFromToday). The stack re-seeds on
  // every fresh `up`, so these cells print the current calendar day as ABSOLUTE ISO text
  // ("2026-07-29" / "2026-07-29 13:58"). A committed app-baseline captured on an earlier
  // day therefore drifts against a later gate run — the layout, labels, column order and
  // colour tokens are pixel-identical; ONLY the date DIGITS differ (verified: every red
  // region is a single narrow date column, 165–1971 px). This is NOT a regression.
  //
  // Why a mask, not a clock-freeze (B-160 preferred → rejected on evidence): the drift is
  // SERVER-computed (value comes from the DB/API), so pinning the Playwright browser clock
  // (page.clock) does nothing to it — and would positively HARM the currently-passing
  // dashboard, whose timeAgo(at = SEED_NOW − i·4h, Date.now()) is deterministic ONLY because
  // browser-now tracks seed-now; freezing browser-now to a fixed instant while the seed
  // clock keeps advancing would desync it into a fresh failure. The seed/DB clock is out of
  // the tests/ zone (packages/db + infra), so the sanctioned fix is a MINIMAL per-column mask
  // — exactly the class B-120(ข) pre-authorised and B-160 was filed to address.
  //
  // Geometry: ISO dates are FIXED-WIDTH (YYYY-MM-DD is always 10 chars), so each column's
  // bbox is stable day-to-day — the digits change inside a constant box. Every rect was
  // measured LIVE from the value cells at 1600x1000 dSF=1 and wraps ONLY that column's DATA
  // rows with a ~2px margin: it sits BELOW the static column header (never masks the header
  // label) and clear of every neighbouring column. Thresholds stay strict and
  // dimensionMismatch still auto-FAILs — a layout/label/colour change anywhere else, or in
  // any other column, still FAILs. maskedDiffPixels is reported so the absorbed drift stays
  // visible (never silent). admin.* are NOT here: their ~2.2% failure is a viewMode/sidebar
  // mismatch (default viewMode="tenant" vs platform-mode baselines), a run-config issue —
  // masking it would hide the whole sidebar and real regressions, so it is left untouched.
  "gl-inbox-createdat-b160": {
    x: 1315,
    y: 414,
    width: 124,
    height: 427,
    reason:
      "B-160 (class B-120(ข)) — gl.inbox time column renders each row's created_at (defaultNow at seed) as 'YYYY-MM-DD HH:mm'; the value = the seed day and drifts vs an older baseline. Covers only the 9-row date/time column (measured cells x1317-1437 y416-839), no neighbouring cell",
  },
  "gl-jv-date-b160": {
    x: 415,
    y: 447,
    width: 114,
    height: 312,
    reason:
      "B-160 (class B-120(ข)) — gl.jv date column renders created_at as 'YYYY-MM-DD' (= seed day); drifts vs an older baseline. Covers only the 7-row date column (measured cells x417-527 y449-757), no neighbouring cell",
  },
  "ar-tax-date-b160": {
    x: 505,
    y: 409,
    width: 114,
    height: 268,
    reason:
      "B-160 (class B-120(ข)) — ar.tax date column renders created_at as 'YYYY-MM-DD' (= seed day); drifts vs an older baseline. Covers only the 6-row date column (measured cells x507-617 y411-675), no neighbouring cell",
  },
  "ar-cn-date-b160": {
    x: 1245,
    y: 356,
    width: 104,
    height: 163,
    reason:
      "B-160 (class B-120(ข)) — ar.cn date column renders created_at as 'YYYY-MM-DD' (= seed day); drifts vs an older baseline. Covers only the 3-row date column (measured cells x1247-1347 y358-517), no neighbouring cell",
  },
  "tax-etax-date-b160": {
    x: 1221,
    y: 356,
    width: 94,
    height: 406,
    reason:
      "B-160 (class B-120(ข)) — tax.etax date column renders created_at as 'YYYY-MM-DD' (= seed day); drifts vs an older baseline. Covers only the 6-row date column (measured cells x1223-1313 y358-760), no neighbouring cell",
  },
  "ap-retention-due-b160": {
    x: 1165,
    y: 416,
    width: 144,
    height: 185,
    reason:
      "B-160 (class B-120(ข)) — ap.retention due-date column: rows 1-3 render a SEED_TODAY-relative due date ('2027-07-29') that drifts vs an older baseline; row 0 is a fixed literal ('2025-01-15') and is left UNMASKED. Covers only the 3 drifting rows (measured cells x1167-1307 y418-599), no neighbouring cell",
  },
  "sub-billing-date-b160": {
    x: 445,
    y: 209,
    width: 124,
    height: 175,
    reason:
      "B-160 (class B-120(ข)) — sub.billing invoice-date column renders created_at as 'YYYY-MM-DD' (= seed day); drifts vs an older baseline. Covers only the 3-row date column (measured cells x447-567 y211-382), no neighbouring cell",
  },
  "sub-mine-startedat-b160": {
    x: 721,
    y: 399,
    width: 75,
    height: 23,
    reason:
      "B-160 (class B-120(ข)) — sub.mine contract-start value (formatDate(me.startedAt), sub-mine.tsx:161) renders the seed-time start date '2026-07-29' (= seed day); latent daily drift (passes today only by margin). Covers ONLY the startedAt value cell (measured x723-788 y401-420), not its label nor the fixed renewAt row below",
  },

  // B-187 date-column masks (B-160 class, exposed once the viewMode fix landed).
  // The admin.* baselines were captured in PLATFORM viewMode; the gate seeded only
  // juneflow-token -> tenant sidebar -> a whole-sidebar ~2.2% mismatch that DOMINATED
  // the diff and hid the body. B-187 seeds juneflow-state={tweaks:{viewMode:platform}}
  // per-row (screens.manifest.json "viewMode" + visual-gate.spec.ts addInitScript), so
  // the sidebar is now pixel-identical (admin.plans = 0.0000%). That uncovered a small,
  // deterministic BODY residual on two rows -- the SAME server/seed date-drift class as
  // the b160 masks above, which B-160 had explicitly deferred here (admin.* left
  // untouched). Proven date-drift, not a regression: identical committed dev code +
  // identical deterministic seed + identical viewMode make admin.plans and every sibling
  // screen 0%, so wall-clock rendering is the ONLY variable; capture-twice is byte-stable
  // (RUN A == RUN B). Each rect wraps ONLY its column data cells (below the header, clear
  // of both neighbours -- measured live), threshold stays strict, dimensionMismatch still
  // auto-FAILs, and maskedDiffPixels is reported so the absorbed drift stays visible.
  "admin-subs-renew-b187": {
    x: 1322,
    y: 290,
    width: 100,
    height: 540,
    reason:
      "B-187 (class B-160 / B-120) - admin.subs renew (ต่ออายุ) column renders renew_at overdue-TINTED (admin-subs.tsx: REAL renew_at, tint flips as now() passes the seed date) so the cell colour/text drifts vs an older platform-mode baseline. Covers only the renew data cells (measured red x1341-1398 y294-824; cell band x1330-1417), clear of MRR (ends x1304) and the status badges (start x1480)",
  },
  "admin-invoices-date-b187": {
    x: 1104,
    y: 374,
    width: 78,
    height: 366,
    reason:
      "B-187 (class B-160 / B-120) - admin.invoices date (วันที่) column renders each invoice seed-day date as YYYY-MM-DD (baseline froze 2026-07-28; a fresh stack re-seeds to the current day) so the day digits drift vs an older baseline. Covers only the date-text data cells (measured text x1110-1172 y381-731; changing digits x1160-1173), clear of the amount column (starts x1285)",
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

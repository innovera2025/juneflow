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

  // ── B-160 dashboard as_of masks (G5 full-manifest audit · orch-B QA 2026-07-31) ──
  // Root cause (measured live on the running stack): the dashboard page-header subtitle
  // renders i18n key `dashboard.tplAsOf` = "ข้อมูล ณ {date} (อัปเดต {time} น.)" where BOTH
  // values come from the SERVER — apps/api/src/routes/dashboard.ts:200 sets
  // `as_of = new Date().toISOString()` at REQUEST time, and dashboard.tsx:266-267/382 prints
  // it as absolute Thai-short text ("31 ก.ค. 69"). Only the {time} half sat inside
  // header-update-time-b120 (x560-800); the {date} half renders LEFT of it (measured
  // x515.31-574.58, y125-145) and so drifts against any baseline captured on an earlier
  // calendar day. Measured today (baseline 2026-07-27 vs run 2026-07-31): 100 of the row's
  // 146 unmasked diff px are exactly the day digits "27"→"31" at x[515-529] y[129-139] —
  // 91% of the 160 px epsilon, i.e. the row was one digit-width from a false FAIL.
  //
  // Proven by a live API-intercept experiment (as_of rewritten, nothing else changed):
  //   as_of day 2-digit→1-digit (2026-08-01 "1 ส.ค. 69")   → 587 unmasked px = FAIL
  //   worst case 5-char month + 1-digit day (2026-03-05)   → 604 unmasked px = FAIL
  // because a shorter date REFLOWS the rest of the one-line subtitle leftwards: 319-327 px
  // at the date itself (x515-559) plus 222-231 px where the trailing "online" glyphs slide
  // past the existing mask's right edge (x[800-833]). With the two rects below both cases
  // fall to 46 px (= the same sub-pixel topbar AA residual every other row carries) = PASS.
  //
  // Class: B-160 / B-120(ข) — a SERVER-computed date printed as absolute text. Not a
  // regression (layout, labels, order and colour tokens are pixel-identical; only the date
  // glyphs and the reflow they cause differ), and not fixable by a browser clock freeze
  // (the value is computed server-side; freezing browser-now would also desync the
  // dashboard's seed-relative timeAgo — see the B-160 note above).
  //
  // Minimal by construction: both rects sit INSIDE the 20px-tall subtitle line band
  // (y125-145, wrapped to y123-147) and each only extends the ALREADY-approved
  // header-update-time-b120 rect (x560-800) to the true edges of the drifting text run —
  // 50px on the left, 40px on the right. No KPI, button, tab, menu row or table column is
  // touched (the h1 title row ends at y112; the role banner starts at y165). Thresholds
  // stay strict and dimensionMismatch still auto-FAILs.
  //
  // REVIEW FLAG (drafted for BLOCKERS.md, orch-B QA 2026-07-31): the -tail rect covers the
  // last ~34px of the STATIC "· Sync SAP/REM ● online" copy — static text that MOVES because
  // of the date drift, not drifting text itself. header-update-time-b120 already covers that
  // phrase from x560 to x800, so the tail rect hides the final glyphs of "online" from the
  // gate. Pending Wei ratification.
  "dashboard-asof-date-b160": {
    x: 513,
    y: 123,
    width: 50,
    height: 24,
    reason:
      "B-160 (class B-120(ข)) — dashboard subtitle `dashboard.tplAsOf` prints the SERVER as_of (dashboard.ts:200 new Date()) as Thai-short text; its {date} half renders left of header-update-time-b120 and drifts vs an older baseline (measured live: date value x515.31-574.58 y125-145; drifting day digits x515-529 = 100 of 146 unmasked px). Covers only the strip of that date value left of the existing mask, inside the subtitle line band — no neighbouring element",
  },
  "dashboard-asof-tail-b160": {
    x: 798,
    y: 123,
    width: 40,
    height: 24,
    reason:
      "B-160 (class B-120(ข)) — reflow tail of the same dashboard as_of drift: a shorter date (1-digit day / 5-char Thai month) slides the one-line subtitle leftwards, pushing the trailing '● online' glyphs (measured run x780.80-834.11 y125-145) past header-update-time-b120's right edge (x800) — measured 222-231 px, enough to FAIL on its own. Covers only x798-838 inside the subtitle line band; the same phrase is already masked from x560-800 by header-update-time-b120. Static copy that MOVES — flagged for Wei ratification in the G5 audit report",
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

  // ── B-205 first-time app-baselines: the ONLY two proven-drifting cells (orch-B QA 2026-07-31) ──
  // B-205=ก (Wei 2026-07-31) baselined the 28 shipped-but-ungated screens. A live audit of all 28
  // (DOM text-node scan for today's ISO/Thai date + current YYYY-MM/CE/BE year, cross-checked
  // against packages/db/src/seed/index.ts's only three clock anchors — isoDaysFromToday (L824),
  // the EVM SEED_TODAY month series (L1643) and the dashboard activity feed (L1789) — plus a
  // `new Date()` sweep of every apps/api route that serves them) found exactly TWO screens whose
  // captured viewport renders a clock-derived value. Every other row is baselined mask-free: their
  // dates are fixed seed literals (bank.cheque/bank.recon 2026-05-xx, ap.billing's PO/WO doc nos)
  // and none of the 27 shell-bearing rows carries the live-time header widgets, so they do NOT
  // take the header-*-b120 masks either (adding them would mask static copy — B-186/B-160 rule).
  //
  // Class: B-160 / B-120(ข) — a SERVER-computed date printed as absolute text; not fixable from
  // tests/ (the value comes from the DB/API, so a browser clock freeze does nothing).
  //
  // PROVEN LIVE by API interception (agents/orch-b-recon/b205-results/drift-sim2.js — the response
  // is rewritten in-flight, nothing else changes), each verdict measured with these exact rects:
  //   ap.billing due_date  +1d = 255px · +40d = 832px · +400d = 923px unmasked → FAIL (epsilon 160)
  //                        with masks → 0px = PASS, all 3
  //   ap.pv      created_at +1d = 364px · +40d = 528px · +400d = 709px → FAIL; with masks → 0/0/5px
  //   NEIGHBOUR CONTROLS (the mask must not swallow the line touching it):
  //     ap.billing `aging` sub-line, rendered DIRECTLY BELOW each masked date → 149,768px unmasked,
  //       still 147,317px = FAIL with the masks on (a real regression there is still caught);
  //     ap.pv payee name, rendered DIRECTLY ABOVE each masked date → 202px, and the masks absorb
  //       ZERO of it (maskedDiff = 0) = still FAIL — the rects clear the payee ink by ~1.25px.
  // Total masked area: 6,270px (0.39%) on ap.billing + 4,602px (0.29%) on ap.pv. Thresholds stay
  // strict, dimensionMismatch still auto-FAILs, and maskedDiffPixels is reported so the absorbed
  // drift is never silent.

  // ap.billing — due_date = isoDaysFromToday(AP_DUE_DAYS = [-10,3,14,30,5]) (packages/db seed
  // L1418): an ABSOLUTE 'YYYY-MM-DD' re-anchored to SEED_TODAY on every fresh stack, so the digits
  // change every day. The aging sub-line right below it ("อีก 10 วัน" / "เลย 3 วัน") is a
  // seed-relative offset and is STABLE across days — it stays UNMASKED and gated.
  // Measured live at 1600x1000 dSF=1: date text runs x1366.77-1426.80 (w60.03, h17) at
  // y429.25/489.25/549.25/609.25/669.25; aging line boxes start y446.25+ (ink ~y449);
  // retention column ends at x1352.77 and the status cell starts at x1462.77 — so each rect
  // (x1364..1430) sits inside the due column, clear of BOTH neighbours, and stops above the aging ink.
  "ap-billing-due-r1-b205": {
    x: 1364, y: 427, width: 66, height: 19,
    reason:
      "B-205 (class B-160 / B-120(ข)) — ap.billing due-date row 1: seed dueDate = isoDaysFromToday(-10) re-anchors to the seed day, so the ISO digits drift daily. Covers only the measured date text run (x1366.77-1426.80 y429.25-446.25); the aging sub-line below (ink from y449) and the retention/status neighbours stay gated",
  },
  "ap-billing-due-r2-b205": {
    x: 1364, y: 487, width: 66, height: 19,
    reason:
      "B-205 (class B-160 / B-120(ข)) — ap.billing due-date row 2 (isoDaysFromToday(+3)); same daily digit drift. Covers only the measured date text run (y489.25-506.25), aging sub-line below stays gated",
  },
  "ap-billing-due-r3-b205": {
    x: 1364, y: 547, width: 66, height: 19,
    reason:
      "B-205 (class B-160 / B-120(ข)) — ap.billing due-date row 3 (isoDaysFromToday(+14)); same daily digit drift. Covers only the measured date text run (y549.25-566.25), aging sub-line below stays gated",
  },
  "ap-billing-due-r4-b205": {
    x: 1364, y: 607, width: 66, height: 19,
    reason:
      "B-205 (class B-160 / B-120(ข)) — ap.billing due-date row 4 (isoDaysFromToday(+30)); same daily digit drift. Covers only the measured date text run (y609.25-626.25), aging sub-line below stays gated",
  },
  "ap-billing-due-r5-b205": {
    x: 1364, y: 667, width: 66, height: 19,
    reason:
      "B-205 (class B-160 / B-120(ข)) — ap.billing due-date row 5 (isoDaysFromToday(+5)); same daily digit drift. Covers only the measured date text run (y669.25-686.25), aging sub-line below stays gated",
  },

  // ap.pv — the payee cell's sub-line prints formatDate(created_at) (ap-pv.tsx:294 / pv-rows.ts:135
  // toISOString().slice(0,10)); created_at is schema defaultNow(), i.e. the seed-insert instant, so
  // every fresh stack renders the CURRENT day. Unlike the b160 column masks this is NOT a dedicated
  // column: the payee NAME sits directly above each date inside the same cell, so a single column-tall
  // band would swallow 3 payee names. Hence one minimal rect per row.
  // Measured live at 1600x1000 dSF=1: date runs x421.00-475.81 (w54.81, h16) at
  // y372.75/433.25/493.25/553.75; payee name runs end at y372.75/433.25/493.75/554.25 with ink
  // ~4px higher; the cell spans x407-777 so x419..478 touches no neighbouring column.
  "ap-pv-date-r1-b205": {
    x: 419, y: 371, width: 59, height: 19,
    reason:
      "B-205 (class B-160 / B-120(ข)) — ap.pv row 1 created_at date (formatDate(r.createdAt), ap-pv.tsx:294): defaultNow() = the seed-insert day, so it renders TODAY and drifts against any older baseline. Covers only the measured date run (x421.00-475.81 y372.75-388.75); the payee name above it is untouched (proven: a payee-text change still FAILs with 0 px absorbed)",
  },
  "ap-pv-date-r2-b205": {
    x: 419, y: 431, width: 59, height: 20,
    reason:
      "B-205 (class B-160 / B-120(ข)) — ap.pv row 2 created_at date; same daily drift. Covers only the measured date run (y433.25-449.25), payee name above stays gated",
  },
  "ap-pv-date-r3-b205": {
    x: 419, y: 491, width: 59, height: 20,
    reason:
      "B-205 (class B-160 / B-120(ข)) — ap.pv row 3 created_at date; same daily drift. Covers only the measured date run (y493.25-509.25), payee name above stays gated",
  },
  "ap-pv-date-r4-b205": {
    x: 419, y: 552, width: 59, height: 19,
    reason:
      "B-205 (class B-160 / B-120(ข)) — ap.pv row 4 created_at date; same daily drift. Covers only the measured date run (y553.75-569.75), payee name above stays gated",
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

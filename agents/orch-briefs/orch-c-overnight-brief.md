# ORCH-C overnight brief — web lane — 2026-08-03 night

## Remaining inventory

- **gl.revrec (GLRevenueWIP)** — B-122 Q7: Wei ruled 'gl.revrec defer ทั้งก้อน' — no honest %-of-completion source (B-107c class). DO NOT PORT. Would fabricate the WIP % the screen shows.
  - spec: pototype/accounting-extra.jsx L291 · NAV-ROUTES 'gl.revrec' row · GET /gl/revrec + /gl/revrec/{id}/post + /gl/wip + /gl/wip/{id}/transfer (openapi 2750-2793)
  - dep: endpoints exist but Wei-DEFERRED the whole port
- **sales.dashboard (SalesDashboard)** — B-222 RULED DEFER (Wei 2026-08-03): no sales-KPI/target/quota schema, no owner attribution, no Kpi/Donut/Bar primitives in apps/web/ui. Placeholder stays. Next scope.
  - spec: pototype/sales-crm.jsx L7 · NAV-ROUTES 'sales.dashboard' row · only /sales/leads+bookings+contracts+downs exist
  - dep: no aggregate endpoint + missing chart primitives
- **timeline (ProjectTimeline)** — B-142 RULED DEFER (Wei 2026-07-26): greenfield, 9 open rulings, NULL-seed Gantt, no project date anchor. Moved out of P2 to a later program. timeline i18n (~90 keys) does not compile. DO NOT PORT.
  - spec: pototype/timeline.jsx L274 · NAV-ROUTES 'timeline' row (mod: timeline) · no /timeline endpoint
  - dep: no backend (greenfield Gantt)
- **alloc (AllocateCost)** — Fully-mock analytics (ALLOC_CAT hardcoded array, 'คำนวณใหม่' = notify toast only). Standard-vs-Actual needs a cost-allocation aggregate over PO/WO/GR/Petty that does not exist. If picked up: write BLOCKER (needs aggregate endpoint) + skip. Not portable honestly now.
  - spec: pototype/petty-alloc.jsx L132 · NAV-ROUTES 'alloc' row · NO /alloc or cost-allocation endpoint
  - dep: no backend
- **sync (SyncStatus)** — Integration-status screen; no sync-state wire source. Honest port = every cell em-dash → low value. Defer until an integration-status endpoint exists.
  - spec: pototype/master.jsx L1122 · NAV-ROUTES 'sync' row (platform section) · no /sync endpoint
  - dep: no backend (SAP B1 / REM integration stub)
- **mobile (MobilePreview)** — Device-frame PREVIEW of the Flutter mobile app rendered inside the web shell — not a data-backed product screen. Exclude from the web-port wave; belongs to mobile lane / demo chrome.
  - spec: pototype/mobile-preview.jsx L46 · NAV-ROUTES 'mobile' row (platform section)
  - dep: n/a
- **settings · dms · audit · reports (web-tail)** — These are ALREADY ported (present in dev router.tsx). The Solar web-tail rounds are re-wiring them: B-220 settings honest-empty RULED ก; B-221 dms backend landed on dev (registerDocumentsRoute + mig 0050) → orch-C wiring DMSCenter; B-213/214 i18n rounds PENDING Wei apply. Reconcile current dev state before touching; do not re-port from scratch.
  - spec: extra-screens.jsx / dms.jsx / exec-audit.jsx · B-213/B-214/B-220/B-221
  - dep: already imported in dev router (PORTED_SCREENS) — in-flight rework, not net-new

## Work queue (ordered)

### #1 P2-WEB-70 — Port ap.deposit (APDeposit · มัดจำจ่าย)  💰money
- **scope:** Pure web port — clone the ap.billing web trio: ap-deposit.tsx (Page + 3-KPI strip + 7-col register table) + ap-deposit-form.tsx (modal) + deposit-rows.ts (KPI/status derivation, G3 unit) + ap-deposit-strings.json. Add useApDepositList + useCreateApDeposit to screens/ap/use-ap.ts (clone useApBillingList pattern, B-014 .data envelope). Honest-empty register (seed inserts 0 apDeposits rows). Real vendor picker (useVendorList active) + real PO/WO picker → send po_id/wo_id (never free-text ref). status badge client-derived from balance===0; balance em-dash when 0. Swap Placeholder→APDeposit in router PORTED_SCREENS (graft onto dev).
- **spec:** agents/orch-b-recon/wpw-ap-deposit-accel.md (full accelerator) · pototype/ap.jsx L388-448 (APDeposit) + L452-483 (APDepositForm) · NAV-ROUTES.md 'ap.deposit' row (APDeposit · ap.jsx) · openapi GET+POST /ap/deposit (line 2145) — Entity-opaque, LIVE · apps/api/src/routes/ap-deposit.ts (wire fields L211-240; POST body {vendor_id,po_id?,wo_id?,amount,pct?,reason?}) · reuse: apps/web/src/screens/ap/ap-billing.tsx + billing-form.tsx + billing-rows.ts
- **dependsOn:** none (backend live + accelerator ready)
- **gates:** zero-Thai (i18n-guard: Thai lives only in ap-deposit-strings.json) · i18n-resolve · web tsc (pnpm --filter @juneflow/web typecheck) · web vitest (deposit-rows.ts G3) · check:routes (nav-parity, trivially green — route already registered) · gate-4.5 (orch-B) · G5 visual vs tests/visual/reference (gallery g2/~10-s.jpg; if no exact match capture Fiori ref first; register empty → POST one row for the shot or record data-divergence in REVIEW-QUEUE)
- **handoff:** push feature/web-ap-deposit → channel note (agents/channel.md, next C-id) to orch-B: verify + merge to dev. Attach ap-deposit-strings.json _missing list + draft apply.json for the morning i18n mint (orch-B/Wei apply sacred).

### #2 P2-WEB-71 — Port subcon.handover (SubconHandover · เอกสารส่งมอบงาน)  
- **scope:** Additive read-only certificate screen subcon-handover.tsx reusing use-subcon.ts + subcon-rows.ts + subcon-accept-rows.ts (NO new hooks/resolvers). Resolve params.wo (contract 'no' string) via useSubconContractList().find(c=>c.no===wo) → id → useContractPeriods(id). FK-resolve vendor_id→name, project_id→name (existing resolvers). Accepted-periods table (status ∈ {passed,paid}); client-compute total/retention/net from real amount + retention_pct (already unit-tested helpers). partialWarn when accepted.length!==periods.length. Add subcon.handover to router PORTED_SCREENS (graft onto dev).
- **spec:** agents/orch-b-recon/wpw-subcon-handover-accel.md (full accelerator) · pototype/subcon-accept2.jsx L245-311 (SubconHandover) · NAV-ROUTES.md 'subcon.handover' row (RouteView table) · openapi GET /subcon-contracts (1631) + /subcon-contracts/{id}/periods (1659) — LIVE · reuse: apps/web/src/screens/subcon/subcon-accept.tsx + subcon-rows.ts + subcon-accept-rows.ts + use-subcon.ts
- **dependsOn:** none (backend live + accelerator ready)
- **gates:** zero-Thai · i18n-resolve (CONSUME-ONLY — every string already a dict.subcon.*/common.* key, ZERO mint, no round) · web tsc · web vitest (acceptedPeriods() filter helper if added, G3) · check:routes (trivially green) · gate-4.5 (orch-B) · G5 visual — NO existing baseline: capture pototype/'Juneflow Fiori.html' subcon.handover as reference first, then compare
- **handoff:** push feature/web-subcon-handover → channel note to orch-B: verify + merge to dev. NO i18n apply.json needed (consume-only). Flag the 4 honest WIRE GAPS (colAcceptDate, fieldPoRef, fieldScope, colDelivered em-dash) in REVIEW-QUEUE evidence.

### #3 P2-WEB-72 — Port po.form (POForm · สร้าง PO ใหม่ / from PR)  💰money
- **scope:** Thin create-from-PR form screen po-form.tsx. Recon po.ts createPo body shape first (POST /po = Entity-opaque — read the handler to learn required fields: pr_id, vendor_id, payment terms, delivery, vat/wht). 'อ้างจาก PR' = real PR picker (usePrList → pr_id); 'ผู้ขาย' = real vendor picker (useVendorList). Items block = honest-static ('ดึงจาก PR' — server pulls from the PR, web sends no line math). The 902,475฿ PR-linked amount is DISPLAY only, server-owned — never client-computed. Wire บันทึกร่าง→POST /po draft, ส่งอนุมัติ→POST /po (+submit). Reuse use-po-wo.ts. Follow the pr.form accelerator precedent for divergences (honest-empty mock fields). Add po.form to router PORTED_SCREENS.
- **spec:** pototype/po-wo.jsx L216-262 (POForm) · NAV-ROUTES.md 'po.form' row (POForm · po-wo.jsx · navigate-in) · openapi POST /po (1454) createPo Entity-opaque + /po/{id}/submit (4351) — LIVE · apps/api/src/routes/po.ts (create body) + po.test.ts · precedent: agents/orch-b-recon/wpw-pr-form-accel.md + apps/web/src/screens/pr/pr-form.tsx + screens/po-wo/use-po-wo.ts · i18n: 'สร้าง PO ใหม่' = 8 hits in i18n-full.json — po.list ported, most keys reusable
- **dependsOn:** none (backend live). NB PR picker → usePrList must exist (pr.list ported).
- **gates:** zero-Thai (residual → po-form-strings.json) · i18n-resolve · web tsc · web vitest (any create-body mapper G3) · check:routes (trivially green) · gate-4.5 (orch-B) · G5 visual vs tests/visual/reference (procurement gallery; capture Fiori ref if no baseline)
- **handoff:** push feature/web-po-form → channel note to orch-B: verify + merge to dev. Attach po-form-strings.json residuals + apply.json draft. Surface any create-body wire gap (vendor/pr resolve) as a note, not a stall.

### #4 P2-WEB-73 — Port wo.form (WOForm · สร้าง WO ใหม่)  💰money
- **scope:** Pure create form screen wo-form.tsx. Recon wo.ts createWo body first (POST /wo Entity-opaque — subcon vendor, scope, contract value, down%, retention%, warranty months). 'ผู้รับเหมา' = real vendor picker (useVendorList). มูลค่าสัญญา (2,150,000) is a single typed contract value → send as-is through the generated client, money=SERVER (no line math, no client total). Wire ส่งอนุมัติ→POST /wo (+submit). Reuse use-po-wo.ts (wo.list already ported). Add wo.form to router PORTED_SCREENS.
- **spec:** pototype/po-wo.jsx L433-458 (WOForm) · NAV-ROUTES.md 'wo.form' row (WOForm · po-wo.jsx · navigate-in) · openapi POST /wo (1524) createWo Entity-opaque + /wo/{id}/submit (4403) — LIVE · apps/api/src/routes/wo.ts (create body) + wo.test.ts · reuse: screens/po-wo/wo-list.tsx + use-po-wo.ts · i18n: 'ใบสั่งจ้าง (Work Order)' = 4 hits — wo.list ported, residuals (มูลค่าสัญญา/ระยะประกัน) → strings.json
- **dependsOn:** none (backend live)
- **gates:** zero-Thai (residual → wo-form-strings.json) · i18n-resolve · web tsc · web vitest (create-body mapper G3) · check:routes (trivially green) · gate-4.5 (orch-B) · G5 visual vs tests/visual/reference (capture Fiori ref if no baseline)
- **handoff:** push feature/web-wo-form → channel note to orch-B: verify + merge to dev. Attach wo-form-strings.json residuals + apply.json draft.

### #5 P2-WEB-74 — Port ap.cn-dn (APCreditDebit · ใบลด/เพิ่มหนี้ CN/DN)  💰money
- **scope:** Two-list-merged register ap-cndn.tsx (kind badge CN/DN, 7 cols) + CNDNForm modal (kind='CN'|'DN'). Wire GET /ap/cn + GET /ap/dn (merge + sort), POST /ap/cn or /ap/dn {vendor_id, ref_ap_id, amount, reason}. 'อ้างจาก AP' = real AP-billing picker (useApBillingList → ref_ap_id uuid; free-text 'AP-2026-0184' cannot map — same fix as ap.deposit ref picker). Vendor picker (useVendorList active). GL-info line = static template copy (no amounts). 3 KPIs (CN/DN this month, net AP) derive from loaded rows or em-dash. money=SERVER: send typed amount; create + approve post Model-A JV server-side (Dr2010/Cr5020 CN · Dr5100/Cr2010 DN). Add ap.cn-dn to router PORTED_SCREENS.
- **spec:** pototype/ap.jsx L321-388 (APCreditDebit list) + L486-520 (CNDNForm) · NAV-ROUTES.md 'ap.cn-dn' row (APCreditDebit · ap.jsx) · openapi /ap/cn (2460) + /ap/cn/{id}/approve + /ap/dn (2515) + /ap/dn/{id}/approve — LIVE · apps/api/src/routes/ap-cndn.ts + ap-cndn.test.ts (registerApCnDnRoute app.ts:233) · reuse: screens/ap/ap-billing.tsx (ref-picker precedent) + screens/ar/ar-cn.tsx (CN precedent) · i18n: title '(CN / DN)' = 0 hits → residual strings.json + apply.json
- **dependsOn:** none (backend live)
- **gates:** zero-Thai (Thai → ap-cndn-strings.json) · i18n-resolve · web tsc · web vitest (cndn-rows.ts merge/KPI derivation G3) · check:routes (trivially green) · gate-4.5 (orch-B, money-skeptic on the ref_ap_id path) · G5 visual vs tests/visual/reference (capture Fiori ref if no baseline)
- **handoff:** push feature/web-ap-cndn → channel note to orch-B: verify + merge to dev. Attach ap-cndn-strings.json + apply.json draft. Note: no client money math — amount typed, JV is server-authority.

### #6 P2-WEB-75 — Port petty (PettyCash · เงินสดย่อย)  💰money
- **scope:** Register + balance screen petty.tsx + PettyClaimForm modal. Wire GET /petty (list, filters type/status), POST /petty {category, amount, description, txn_date, project_id?} (cap ≤10,000 server-enforced — web may soft-validate but server owns the 10k cap + GL-inbox post). money=SERVER. HONEST DIVERGENCES: balance card (14,270 / float 50,000) is hardcoded mock with no fund-balance endpoint → derive from loaded rows or em-dash the balance/float/%; PettyTopupForm (เติมเงินกองทุน) has NO endpoint → honest-disabled. KPIs derive from rows. Add petty to router PORTED_SCREENS.
- **spec:** pototype/petty-alloc.jsx L12-131 (PettyCash) + PettyClaimForm + PettyTopupForm · NAV-ROUTES.md 'petty' row (PettyCash · petty-alloc.jsx · mod: petty) · openapi GET+POST /petty (2268) — cap ≤10,000, posts via GL inbox — LIVE · apps/api/src/routes/petty.ts + petty.test.ts (registerPettyRoute app.ts:243) · i18n: 'เงินสดย่อย (Petty Cash)' = 0 hits → residual strings.json + apply.json
- **dependsOn:** none (backend live)
- **gates:** zero-Thai (Thai → petty-strings.json) · i18n-resolve · web tsc · web vitest (petty-rows.ts KPI/balance derivation G3) · check:routes (trivially green) · gate-4.5 (orch-B, money-skeptic on the ≤10k cap + claim POST) · G5 visual vs tests/visual/reference (capture Fiori ref if no baseline)
- **handoff:** push feature/web-petty → channel note to orch-B: verify + merge to dev. Attach petty-strings.json + apply.json draft. Flag topup-honest-disabled + balance-mock divergence in REVIEW-QUEUE.

### #7 P2-WEB-76 — Port opex (OpexBudget · งบ OPEX บริษัท)  💰money
- **scope:** OPEX budget register opex.tsx. Recon opex.ts createOpexBudget body first (POST /opex/budgets Entity-opaque — planned expense figures by category/year). Wire GET /opex/budgets?year= (list). money=amounts (planned budget figures, no JV) — send typed, no client rollup math; any variance/total = server field or em-dash. Add opex to router PORTED_SCREENS.
- **spec:** pototype/opex-budget.jsx L44+ (OpexBudget) · NAV-ROUTES.md 'opex' row (OpexBudget · opex-budget.jsx) · openapi GET+POST /opex/budgets (3406) — LIVE · apps/api/src/routes/opex.ts + opex.test.ts (registerOpexRoute app.ts:227) · i18n: 'งบ OPEX บริษัท' = 8 hits — partial coverage; residuals → strings.json
- **dependsOn:** none (backend live)
- **gates:** zero-Thai (residual → opex-strings.json) · i18n-resolve · web tsc · web vitest (opex-rows.ts derivation G3) · check:routes (trivially green) · gate-4.5 (orch-B) · G5 visual vs tests/visual/reference (capture Fiori ref if no baseline)
- **handoff:** push feature/web-opex → channel note to orch-B: verify + merge to dev. Attach opex-strings.json residuals + apply.json draft.

### #8 P2-WEB-77 — Port notifications (NotificationsCenter · ศูนย์การแจ้งเตือน)  
- **scope:** Read + mark-read screen notifications.tsx. Recon notifications.ts wire first (GET /notifications Entity-opaque → title, time/created_at, route target, unread, type→icon/tone). Filter tabs (all/unread/accept) client-side; day-group from created_at. Row click → mark read (POST /notifications/{id}/read) + navigate(route). 'อ่านทั้งหมด' → loop read (or a bulk endpoint if the handler exposes one — else per-id). money=NONE. HONEST: icon/tone derive from type or default; if the wire lacks a route target, em-dash the navigate (don't invent). Add notifications to router PORTED_SCREENS.
- **spec:** pototype/extra-screens.jsx L171-215 (NotificationsCenter) · NAV-ROUTES.md 'notifications' row (NotificationsCenter · extra-screens.jsx · navigate-in) · openapi GET /notifications (4009) + POST /notifications/{id}/read (4022) — LIVE · apps/api/src/routes/notifications.ts + notifications.test.ts (registerNotificationsRoute app.ts:220) · i18n: 'การแจ้งเตือน' = 15 hits — partial; title 'ศูนย์การแจ้งเตือน · Notifications' likely residual → strings.json
- **dependsOn:** none (backend live)
- **gates:** zero-Thai (residual → notifications-strings.json) · i18n-resolve · web tsc · web vitest (notif grouping/derivation G3) · check:routes (trivially green) · gate-4.5 (orch-B) · G5 visual — likely no baseline: capture Fiori ref first
- **handoff:** push feature/web-notifications → channel note to orch-B: verify + merge to dev. Attach notifications-strings.json residuals + apply.json draft.

### #9 P2-WEB-78 — Port gl.projectpl (GLProjectPL · P&L รายโครงการ) — DEPENDENCY-GATED  
- **scope:** Read-only P&L-per-project report gl-projectpl.tsx. Wire GET /gl/reports/project-pl (per-project revenue/cost/margin). money=NONE (report figures server-computed). PRECONDITION CHECK before porting: confirm getGlProjectPl handler is LIVE on dev (B-227 un-defer, orch-A building — currently NOT registered in app.ts). If GET /gl/reports/project-pl returns real data → port. If handler absent/501 → write BLOCKERS.md (reference B-227, 'web port waiting on getGlProjectPl on dev') and SKIP. Add gl.projectpl to router PORTED_SCREENS only when wired.
- **spec:** pototype/accounting-extra2.jsx L371+ (GLProjectPL) · NAV-ROUTES.md 'gl.projectpl' row (GLProjectPL · accounting-extra2.jsx) · openapi GET /gl/reports/project-pl (2726) — path declared, handler getGlProjectPl DEFERRED then Wei un-deferred (B-227) · BLOCKERS.md B-227 (Wei RULED ก un-defer 2026-08-03 → orch-A implements → then orch-C ports)
- **dependsOn:** orch-A: getGlProjectPl handler live on dev (B-227). Blocked until then → BLOCKER + skip, do not stall.
- **gates:** zero-Thai (residual → gl-projectpl-strings.json) · i18n-resolve · web tsc · web vitest (report-rows derivation G3) · check:routes (trivially green) · gate-4.5 (orch-B) · G5 visual — no baseline: capture Fiori ref first
- **handoff:** if ported: push feature/web-gl-projectpl → channel note to orch-B: verify + merge to dev + strings.json apply.json draft. If blocked: BLOCKERS.md entry + channel note that gl.projectpl awaits orch-A B-227; move on.


## Autonomy protocol
RUN CONTINUOUSLY WITHOUT WEI (asleep; reviews in the morning). Work the queue top-to-bottom in the apps/web worktree (one agent = one worktree = one zone). Per-screen loop:

1. RECON-FIRST (proven pattern, before touching code): run a scope + i18n-2-axis + contract-2-axis pass on the screen so residual i18n keys + wire gaps are known UP FRONT. For ap.deposit + subcon.handover the recon is already done — read the accelerator (agents/orch-b-recon/wpw-ap-deposit-accel.md, wpw-subcon-handover-accel.md) instead. For po.form/wo.form/ap.cn-dn read the source .jsx line range + the matching apps/api/src/routes/*.ts handler (Entity-opaque POST bodies must be read from the handler, like the pr.form accel did) to learn the create-body shape.

2. i18n AUTONOMY (the key enabler — never stall on a mint): orch-C has NO sacred override, and orch-B/Wei cannot apply a sacred i18n round while Wei sleeps. So for ANY residual key, use the proven honest-render pattern: reuse existing dict keys via t() where they exist, and put every NEW Thai phrase in a screen-local <screen>-strings.json (the i18n-guard hook SKIPS .json, so no Thai/baht literal lands in .tsx; the .tsx imports the json constants and renders real Thai). List new phrases under _missing. This ports the screen NOW and passes zero-Thai + i18n-resolve. ALSO draft an apply.json (mirror agents/orch-c-recon/*.apply.json) so orch-B/Wei can mint the keys in a morning sacred round. Never wait for the mint. subcon.handover is consume-only (0 mints).

3. MONEY DISCIPLINE (§0 + money-post lessons): every submit/POST that carries an amount is money=SERVER. The web sends the value the user typed through the GENERATED client and does ZERO money math — no client-computed totals, no pct×base, no rollups. The JV/balance/commitment is server-authority. pct is a label, not a multiplier. Pick real FK pickers (vendor/PR/AP/PO/WO uuid) so a typed doc-number never fails tenant-ownership. Flag any client-total temptation as an honest em-dash instead.

4. HONEST WIRE (§0 rule 3): render real wire fields (FK-resolve to NAMES, never a raw uuid); every field with no backing wire → em-dash / honest-disabled button / honest-empty list. Never fabricate a backing table or re-print a mock literal. Record divergences in REVIEW-QUEUE evidence.

5. GATES (run locally before handoff): zero-Thai (i18n-guard) · i18n-resolve · web tsc (pnpm --filter @juneflow/web typecheck) · web vitest (the rows/derivation helper, G3) · check:routes (scripts/check-nav-parity.mjs — stays green since every route is already registered; porting only swaps Placeholder→real in router PORTED_SCREENS). Then G5 visual: screenshot the changed screen and compare to tests/visual/reference; if the screen has no baseline (subcon.handover, notifications, opex, gl.projectpl) capture pototype/'Juneflow Fiori.html' for that route as the reference FIRST.

6. ROUTER GRAFT RULE (web-slice-graft + web-port-branch-stale lessons): editing router.tsx PORTED_SCREENS (add import + map entry) and any shared file MUST graft additively onto the CURRENT dev — never wholesale `git checkout branch -- router.tsx`/i18n-full.json, or you silently drop screens other lanes merged while you worked. Rebase/refresh dev before each handoff.

7. BLOCKED → BLOCKERS.md + SKIP (never guess, never stall): if a screen needs a ruling/backend that is not ready (gl.projectpl handler absent; alloc has no aggregate endpoint; a wire gap needs a schema col), grep the freshest B-0 id, write a BLOCKERS.md row (options + recommendation), post a channel note, and move to the next queue item. Conflicts outside the PLAN.md Appendix-C decision table are NEVER decided by orch-C.

8. HANDOFF to orch-B (verify lane — orch-C does NOT merge to dev): after gates pass, push feature/web-<screen>, then append a channel note (agents/channel.md, next C-id, CLAIM/RELEASE-aware, append-only) telling orch-B to verify (gate-4.5 + independent api/gates) and merge to dev; include the strings.json + apply.json paths for the morning mint. Then start the next screen. Keep one screen in flight at a time per worktree; batch two only if you spin a second worktree.

## Cross-lane deps
1) orch-A (backend) — gl.projectpl (P2-WEB-78) is BLOCKED on orch-A implementing getGlProjectPl (B-227 Wei ruled un-defer 2026-08-03; handler NOT yet registered in app.ts). orch-C checks GET /gl/reports/project-pl live on dev before porting; absent → BLOCKER + skip. All other 8 screens' backends are already registered + tested (po/wo/notifications/opex/ap-cndn/petty routes in app.ts:215-243, ap-deposit + subcon-contracts live) — no backend dependency.
2) orch-B (verify/merge/promote lane) — owns every merge to dev and every SACRED i18n apply. orch-C hands each finished feature/web-<screen> branch + apply.json to orch-B via channel note; orch-B runs gate-4.5 + independent gates and merges. orch-C never self-merges to dev, never promotes to main.
3) Wei (rulings + sacred approval + main promote) — the residual i18n mints (ap.cn-dn/petty/opex/notifications/po.form/wo.form strings.json → apply.json) need Wei-approved SACRED_OVERRIDE before orch-B Bash-applies them to i18n-full.json (both dict copies). Overnight: port via strings.json honest-render (no mint needed to ship); Wei/orch-B mint in the morning. Any new BLOCKER ruling (alloc aggregate endpoint, sync integration source, a wire-gap schema col) waits for Wei — orch-C files it and skips.
4) Read-only cross-lane recon is fine: orch-C reads apps/api/src/routes/*.ts to learn Entity-opaque POST body shapes (po.ts/wo.ts/opex.ts/notifications.ts) — read-only, no edit to backend zone.
5) Shared-file contention: router.tsx PORTED_SCREENS + tests/visual/reference are touched by orch-C ports; graft onto current dev each time (lesson: web-port branches go stale on router.tsx/i18n as dev advances). registry.ts + nav-tree.json need NO change (all routes already registered).

## Work order (kickoff)
orch-C — WEB lane, zone apps/web. This is an overnight autonomous run: Wei is asleep and reviews in the morning. Work the 9-task queue below top-to-bottom in your apps/web worktree, one screen at a time, never stalling.

FIRST read the discipline: root CLAUDE.md + PLAN.md §0 (pototype = law, design-fidelity 5 rules, i18n from i18n-full.json only, no hand-translation, conflict → BLOCKERS.md never guess) + §10 (feature → dev via orch-B verify lane; you do NOT merge to dev or promote to main). Sacred files (openapi.yaml, migrations, CLAUDE.md, CI, i18n-full.json, docs/extract) are Bash-hook-protected — never edit; a needed i18n change → draft a <screen>-strings.json (honest render now) + an apply.json and hand it to orch-B for the morning mint.

QUEUE (money-critical + accelerator-ready first, then dependency-free, gl.projectpl last because it is dependency-gated):
1. P2-WEB-70 ap.deposit — accelerator READY (agents/orch-b-recon/wpw-ap-deposit-accel.md), money=SERVER. Clone the ap.billing trio.
2. P2-WEB-71 subcon.handover — accelerator READY (wpw-subcon-handover-accel.md), money=NONE, i18n CONSUME-ONLY (0 mints) — your safest guaranteed win.
3. P2-WEB-72 po.form — money=SERVER, from-PR create form; pr.form accel is the precedent; recon po.ts create body.
4. P2-WEB-73 wo.form — money=SERVER, pure create form; recon wo.ts create body.
5. P2-WEB-74 ap.cn-dn — money=SERVER, two-list merge (GET /ap/cn + /ap/dn) + CN/DN modal; real AP-ref picker.
6. P2-WEB-75 petty — money=SERVER, GET/POST /petty (≤10k cap server-side); topup honest-disabled, balance-card mock → derive/em-dash.
7. P2-WEB-76 opex — money=amounts, GET/POST /opex/budgets; recon opex.ts body.
8. P2-WEB-77 notifications — money=NONE, GET /notifications + mark-read; recon notifications.ts wire.
9. P2-WEB-78 gl.projectpl — DEPENDENCY-GATED on orch-A getGlProjectPl (B-227). Check GET /gl/reports/project-pl live on dev FIRST; absent → BLOCKERS.md + skip.

PER SCREEN: recon-first (scope + i18n-2-axis + contract-2-axis, or read the accelerator) → port from the exact .jsx line range (use the port-screen skill) → strip mock mechanics → wire the GENERATED client with money=SERVER discipline (web does ZERO money math; send typed amounts; FK-resolve names not uuids; real pickers) → honest em-dash/disable every unbacked field (§0 rule 3, never fabricate) → residual Thai only in <screen>-strings.json (i18n-guard skips .json) + draft apply.json for orch-B → run gates: zero-Thai · i18n-resolve · web tsc (pnpm --filter @juneflow/web typecheck) · web vitest (rows/derivation G3) · check:routes · then G5 visual vs tests/visual/reference (capture the Fiori reference first for screens with no baseline: subcon.handover/notifications/opex/gl.projectpl).

ROUTER GRAFT: adding to router.tsx PORTED_SCREENS must graft additively onto CURRENT dev — refresh dev before each handoff, never wholesale-checkout router.tsx or i18n-full.json (you'll drop screens other lanes merged). registry.ts needs no change (all routes already registered).

HANDOFF each finished screen: push feature/web-<screen>, then post a channel note (agents/channel.md, next C-id, append-only, CLAIM/RELEASE-aware) telling orch-B to verify (gate-4.5 + independent gates) + merge to dev, with the strings.json + apply.json paths attached. Then start the next screen.

BLOCKED → grep the freshest B-0 id, write a BLOCKERS.md row (options + recommendation) + a channel note, and SKIP to the next queue item. Never decide a ruling yourself; never guess; never stall. Do NOT port the deferred screens (gl.revrec B-122, sales.dashboard B-222, timeline B-142, alloc/sync/mobile — see remainingInventory). Keep working the queue until it is exhausted or every remaining item is blocked.

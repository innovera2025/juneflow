Verified. Registry has all 7 screens registered (registry.ts:187-195), openapi declares every `/admin/*` path (234-422) plus `/line/webhook` (3953). Blocker ceiling is **B-175** → new rulings start **B-176**.

---

# PHASE-6 CHARTER — Subscription SaaS Platform + LINE OA (the LAST phase)

*For orch-B to relay to Wei. Recon = read-only, 5 dimensions, citation-dense. Nothing built yet except schema + contract + web shell wiring.*

## 1) SCOPE — 8 surfaces (3 tenant · 4 platform · 1 LINE)

| Route | viewMode | Source | Nature |
|---|---|---|---|
| **sub.mine** (แพ็กเกจของฉัน) | tenant | subscription.jsx:41-129 | **READ** — package card + 4 quota bars + modules. Actions (ต่ออายุ/ยกเลิก/อัปเกรด) = toasts only |
| **sub.plans** (แพ็กเกจ & ราคา) | tenant | subscription.jsx:132-184 | **READ** — plan cards + cycle toggle. Change-package = modal→toast, no POST |
| **sub.billing** (บิล & ใบเสร็จ) | tenant | subscription.jsx:187-215 | **READ** — own platform_invoice history. Download receipt = toast, no PDF |
| **admin.overview** | platform | subscription-admin.jsx:55-110 | **READ/ANALYTICS** — 5 KPIs (MRR/ARR/active/trial/churn) + charts. All series HARDCODED |
| **admin.subs** | platform | subscription-admin.jsx:113-176 | **READ table + TRANSACTIONAL modal** — CompanyControl writes: change package, set seats, suspend/activate, block/reset user |
| **admin.plans** | platform | subscription-admin.jsx:179-190 + pkg-builder.jsx | **READ grid + TRANSACTIONAL** — create/edit package; menus[] tree = tenant sidebar-gating source of truth. No delete |
| **admin.invoices** | platform | subscription-admin.jsx:193-238 | **READ + light action** — list + 3 KPIs + "ทวงถาม" (remind). NO issue/create-invoice anywhere |
| **line** (LINE OA) | tenant | line-oa.jsx + line-pm.jsx | **STATIC PREVIEW PORT** — 16 hardcoded phone-frame chat mockups in a setScreen switcher. Zero real integration |

All 7 web screens register today but render the generic **Placeholder** (registry.ts:187-195) — no component files exist.

## 2) REUSE vs GREENFIELD

**Already built by P0/P1 (wire, don't rebuild):**
- **Full schema** — `packages/db/src/schema/platform.ts`: package, subscription, platform_invoice(:222), ai_usage, companies, roles/users. All 7 tables + enums.
- **Seed** — `seed/packages.ts` (4 tiers S=2900/M=7900/L=14900/Full=contact) + `seed/index.ts` (9 subscribers + subs + 7 platform_invoice rows verbatim from AdminInvoices mock).
- **OpenAPI contract** — every `/admin/*` path (openapi.yaml:234-422) + `/line/webhook` (:3953) **already declared**, opaque Entity/EntityList envelopes → handlers need little/no contract edit.
- **Quota enforcement** — `plugins/quota.ts` + `subscription-quota.ts` (402 QUOTA_EXCEEDED, real resolver, B-082 F2). **DONE, not Phase-6 work** (only storage_gb byte-accounting is a known gap).
- **Tenant read surface** — `me.ts` loadPackageUsage returns package{menus,limits,ai_used}; web sidebar pkgMenuAllowed gating + viewMode=platform switch (sidebar.tsx:112-122) already there.
- **Notifications** — LINE adapter INTERFACE + FakeLineNotificationAdapter for dunning/notify.

**Greenfield (the actual Phase-6 build):**
- **All `/admin/*` route handlers** — none exist, no admin.ts, not registered in app.ts.
- **2 tenant read-endpoints** — GET tenant-plans (only owner `/admin/packages` exists) + GET own-subscription invoices (only owner `/admin/invoices` exists). Wrong authz to reuse.
- **All 8 web screen components** + PkgBuilderForm + CompanyControl modal.
- **Platform-owner identity + authz + cross-tenant-scope door** — the one genuinely NEW architecture piece (§6 R1-R3).
- **Server-side analytics compute** — MRR/ARR/churn.
- **Real LINE integration** — separate lane (§4).

**Does platform billing reuse the tenant AR lane? NO — separate lane.** Tenant AR (`ar.ts` ar_invoice→jv Dr1130/Cr revenue+VAT, company-scoped) must **not** back platform billing. platform_invoice is a standalone status record with no jv link, no company_id GL post (data-dictionary.html:39 vs :88 — platform sits outside the "→GLPosting→JV" section). Reuse **patterns only** (round2, money=server, doc-numbering, list-envelope, tax-engine) — never the ar_invoice/jv tables.

## 3) MONEY — platform-billing path + exact rulings

**The path today (prototype + schema):** `platform_invoice`(subscription_id, amount numeric(12,2), currency_code THB, status paid|pending|overdue) is a **flat status-machine billing document** — no invoice_no, no date, no VAT split, no line items, no jv/gl link. Every billing action in both prototypes is a toast: download-receipt (subscription.jsx:208), renew/cancel/upgrade (:84-85,:170), dunning "ทวงถาม" (admin:230). MRR/ARR/outstanding are client-side reduces of a hardcoded array. **No mark-paid, no issue-invoice, no pay flow exists anywhere.**

**Two money domains, keep separate:** (A) Tenant construction-ERP GL — untouched by Phase-6. (B) Platform billing — Juneflow charging its tenants — lives **outside the tenant books**, and the prototype defines **no platform ledger either**. Recommendation for a faithful port: **display/status-only, money=SERVER-computed, zero double-entry.** But the design is undefined and needs Wei rulings (§6 R4-R8).

Billing model read: per-plan-tier flat fee, monthly(price_m) or yearly(price_y ≈ price_m×10 "save 2 months"). **No usage/overage billing** — AI-overage triggers an upgrade prompt via quota plugin, never a charged line.

## 4) LINE — PORT vs REAL INTEGRATION (split cleanly)

**(A) SHIPS NOW as a UI port** — `line` route = LineOAPreview, a Fiori showcase page rendering 16 static phone-frame mockups in a left-nav setScreen switcher (line-oa.jsx:599-706) + two ctx.notify toast stubs (:608-609). Wired to i18n keys + tokens + tier-L pkgMenuAllowed gating. **No API, no new table, no LINE SDK.** Proof it's static: every "button" is a `<div>` with no handler (line-pm.jsx:44-48,:116-119); LIFF screens use real `<button>`s but with no handlers + hardcoded values. Touches **no sacred file** except the normal i18n-full.json round every ported screen needs.

**(B) DEFERRED to a separate Integrations program (recommended)** — the real LINE build is greenfield, **not prototype-specified**. Seams are scaffolded but unbuilt: LineNotificationAdapter.send() **throws TODO(P0-INT-03)** (line.ts:22); pm.ts lineNotifyStub() is a deliberate NO-OP (:209-217, B-108b/c explicitly out of scope); env creds LINE_CHANNEL_ACCESS_TOKEN/SECRET (P0-INT-04 unbuilt). Entirely missing: `/line/webhook` handler + x-line-signature verify, LINE Login/LIFF auth (PLAN.md:70/252/259 mandate custom, not Clerk), `line_binding` table (LINE userId↔company↔unit — undefined by prototype), Messaging-API push. Each mockup implies its own subsystem (LineBind→Login+LIFF+binding; LiffReport/Track→LIFF app posting to existing /sales/service; LinePMQuote approve→webhook postback→POST /pm/quotes/{id}/decide which already exists pm.ts:23). **The real integration introduces a NEW external-unauthenticated authz surface** (residents are not tenant users) — its own security ruling. Recommend defer unless Wei pulls it in (§6 R9).

## 5) WAVE PLAN

- **Wave-0 — Reads & analytics (no rulings block; largest chunk, start immediately).**
  - Tenant: port sub.mine / sub.plans / sub.billing (display-only, all actions stay toasts) + 2 tenant read-endpoints (GET plans, GET own invoices).
  - Platform: port admin.overview (analytics READ) + admin.subs/admin.invoices READ tables + admin.plans READ grid. Server-compute MRR/ARR/outstanding (money=server) with whatever formula R6 lands.
  - **Gated by R1-R3** (platform-owner authz) for the `/admin/*` handlers specifically — tenant reads (sub.*) are un-gated and can go first.
- **Wave-1 — Platform-billing + admin WRITES (after rulings).**
  - CompanyControl transactional modal (change package / seats / suspend↔activate / block-reset user), PkgBuilderForm create/edit package, invoice remind. Gated by R4-R8 (billing model, seats persistence, suspend-toggle, invoice identity).
- **LINE preview port** — parallel/anytime in Wave-0 (independent web zone, no backend). Recommend fold into Wave-0.
- **Real LINE integration** — **deferred to a separate Integrations program** (R9). Mock-first, adapters already fake-swappable.

## 6) WEI RULINGS NEEDED (do NOT decide — numbered B-176+)

**B-176 — Platform-owner identity (BLOCKS all /admin/* handlers).** viewMode tenant|platform is client-only (shell-context.tsx:31) with zero server enforcement; resolveAuthContext always resolves a companyId; users.companyId is NOT NULL; no platform_admin role/flag/table. *Options:* (a) boolean `is_platform_admin` flag on user (small ALTER migration); (b) a dedicated platform-owner company/realm; (c) separate auth realm. *Lean:* (a) — smallest schema delta, one migration.

**B-177 — Cross-tenant scope escape (architectural).** Whole API is company_id-scoped via TenantDb/registerTenantScope (app.ts:132); admin reads must span all 9 tenants. *Options:* (a) un-scoped platform DB door guarded by the B-176 owner check; (b) per-route opt-out flag on the tenant-scope middleware. *Lean:* (a) — one explicit guarded door, auditable.

**B-178 — Platform authz gate.** authz.ts gates role.perms[module][right] but there's no "platform"/"admin" module in the 11×5 matrix. *Options:* (a) owner-identity alone gates /admin/* (no perms needed); (b) add a platform module to the matrix; (c) a role flag. *Lean:* (a) — owner identity is binary, matrix is tenant-scoped by design.

**B-179 — Does platform_invoice post to ANY GL? (core money ruling).** *Options:* (a) standalone status-only billing record, NO double-entry, no tenant-GL AP bill, no platform ledger; (b) Juneflow keeps its own corporate GL for subscription revenue. *Lean:* (a) — strongly supported by schema (no jv link, no company_id) + data-dictionary.html:39 vs :88. Prototype gives zero account codes → do not invent.

**B-180 — Billing-cycle generation + payment transition.** No issue-invoice or mark-paid action exists in either prototype. *Options:* (a) renewal cron on subscription.renew_at → creates pending row, owner-marks-paid; (b) payment-gateway capture; (c) defer generation entirely, keep seeded rows display-only. *Lean:* (c) for Phase-6 faithfulness (out of prototype scope), revisit post-launch.

**B-181 — VAT on the SaaS fee.** Schema `amount` is a single flat column but tenant subtitle promises 'ใบกำกับภาษี' tax-invoice (subscription.jsx:192). *Options:* (a) amount is VAT-inclusive, no split, no platform e-Tax (display-only); (b) apply 7% Thai VAT with subtotal/vat/net + platform issues its own e-Tax. *Lean:* (a) — prototype shows one flat amount, no tax rows; e-Tax is a large separate build.

**B-182 — Proration on upgrade.** subscription.jsx:170 text 'คิดค่าส่วนต่างตามสัดส่วนวันที่เหลือ' + mock 18400 'เฉลี่ย', formula undefined. *Options:* (a) defer — plan-change stays a toast (display-only), no proration compute; (b) server prorate by remaining-days ratio. *Lean:* (a) — prototype never posts it; formula not specified → don't invent.

**B-183 — MRR/ARR/churn formula (money=server for analytics).** No mrr column; AdminOverview sums hardcoded per-row mrr, churn 2.1% is a literal. *Options:* (a) server-derive MRR = Σ active subs (yearly→price_y/12, monthly→price_m; trial/cancelled=0), ARR=MRR×12, and render churn/monthly-series as display-only constants for now (no snapshot table); (b) add an mrr_snapshot/history table (like evm_snapshot) for real trend/churn. *Lean:* (a) — MRR/ARR derivable from live data; trend/churn have no source, defer the snapshot table.

**B-184 — Real invoice identity (possible SACRED migration).** AdminInvoices shows PINV-2569-06xx numbers + dates; schema has neither (seed:143 confirms presentational). *Options:* (a) display-derive (no from a scheme, date=created_at, desc=pkg+cycle+year) — no schema change; (b) ALTER platform_invoice + invoice_no/issued_at/period + reuse doc-numbering (sacred migration + maybe openapi). *Lean:* (a) for Phase-6, (b) only if real numbers are legally required.

**B-185 — Per-subscriber SEAT persistence (schema gap).** CompanyControl PUT /admin/subscribers/{id}/package sends {package_id, **seats**} (openapi:307) but subscription has no seat column (only package.limits.users default). *Options:* (a) add `seat_override` to subscription (small ALTER, sacred); (b) drop seats from the write, package-level users limit only. *Lean:* needs Wei — (a) matches the contract shape, (b) matches current schema.

**B-186 — Suspend vs activate endpoint.** Contract has only POST .../suspend (openapi:327) but CompanyControl toggles suspend↔activate (company.status active|suspended). *Options:* (a) add an activate/resume endpoint; (b) make /suspend a toggle. *Lean:* (a) — explicit verbs are clearer for an audited state change.

**B-187 — Package delete + live-edit semantics.** PKG_STORE.remove exists but admin.plans surfaces no delete button and contract has no DELETE. Also: editing a live package's limits/menus retro-affects every tenant's quota (resolver reads package.limits live). *Options:* (a) create/edit-only, no delete, edits apply live (matches prototype); (b) add versioning so edits don't retro-mutate active tenants. *Lean:* (a) — prototype is create/edit-only; flag the live-mutation risk to Wei.

**B-188 — LINE scope split.** *Options:* (a) Phase-6 ships ONLY the LineOAPreview screen-port; real LINE (webhook + x-line-signature + Messaging push + LINE Login/LIFF + line_binding table + LINE_CHANNEL_* secrets) is a separate deferred Integrations program; (b) pull the real integration into Phase-6. *Lean:* (a) — prototype defines only the preview; real integration is greenfield, unspecified, and opens an external-unauthenticated authz surface. **Sub-item:** LinePMCert PDF (line-pm.jsx:57) has no renderer (pm.ts:212) — defer with (b).

## 7) VERIFY PLAN (orch-B)

- **G1 schema:** if any ruling lands a migration (B-176 owner flag, B-184 invoice cols, B-185 seat_override), drizzle check + confirm ALTER-only, no data loss, USING casts hand-verified — same discipline as migration 0012/0040.
- **G2 contract-live:** assert `/admin/*` handlers match the pre-declared opaque Entity/EntityList envelopes (openapi:234-422) exactly; assert the 2 new tenant reads (plans, own-invoices) if they need openapi additions (sacred round). Verify **authz cross-tenant door**: a tenant bearer hitting `/admin/*` gets 403; the platform owner reads across all 9 companies; a tenant sub.billing read returns ONLY its own platform_invoice rows (own-subscription-scoped) — this is the central new-security test.
- **G3 unit (money=server):** MRR/ARR/outstanding computed server-side, not client reduces; trial/cancelled=0 in MRR; **no jv/jv_line row is ever created by any platform-billing path** (grep-assert platform_invoice touches no gl-post). If B-179=standalone, prove zero GL linkage under a live post.
- **G4 E2E:** tenant sub.* flows are display-only (renew/cancel/download produce toasts, zero network mutation); admin write flows (change package, suspend↔activate, block/reset, create/edit package, remind) round-trip; **money-skeptic pass** on any Wave-1 billing write (server-compute, idempotent, atomic status flip, negative/authz cases).
- **G5 visual:** all 8 screens vs tests/visual/reference/ — capture prototype references first for the greenfield screens (none exist in reference/). **Glyph discipline** on i18n (curly ""/U+201C-D, ฿/U+0E3F, middot) per prior master-wave lessons. sub.plans tier-count (3 stale prototype vs 4 canonical) must match whatever Wei rules — flag as its own visual-gate check.
- **Two-reviewer gate-4.5** on every merge (per [[verify-chain-atomicity-lesson]] — my static pass can miss atomicity; keep orch-A's independent gate-4.5). Live E2E graceful-skip-on-429 pattern for any login-throttled path.

**Sacred footprint:** i18n-full.json (all admin.*/sub.*/line UI copy — one sacred round); openapi.yaml only IF new tenant reads or B-184/B-185 columns land; migrations for B-176/B-184/B-185; .env.example LINE_CHANNEL_* only if B-188=(b). The screen ports + `/admin/*` handlers over existing contract touch **no sacred file** beyond i18n.

**Recommended relay to Wei:** approve **Wave-0 + LINE preview port to start now** (only R1-R3 gate the /admin handlers; tenant sub.* reads are ungated), and get rulings **B-176 through B-188** before Wave-1 writes. **B-188 lean = defer real LINE integration** to a separate Integrations program.
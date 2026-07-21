# Phase-3 Finance — EXECUTION CHARTER (orch-B recon wf_e951d4f9 · 2026-07-20 · main 0e1ad79)
Wei-scoped. 4-lane recon (AR · tax/e-Tax · FA · GL-close) + adversarial synth. Full lane detail in workflow journal.

## Headline
6 backend handlers + 1 draft migration START TODAY (zero ruling) · orch-C ports gl.inbox first (backend live on main since P2-BE-17) · everything else funnels through 4 Wei bundles (B-121..124 = W3-A/B/C/D) driving 4 sacred contract rounds + 2 i18n waves (~510 keys · ar./tax./etax./fa. namespaces = 0 keys today, gl. partial).

## Wave-0 START-NOW (orch-A · no ruling · contract-declared + schema-ready)
1. routes/ar.ts — POST /ar/invoices (server money from lines[] · B-107a · etax_status='queued' C4) + POST /ar/rv (validate invoice ownership · server math) — mirror ap.ts (tenant-scope · financial-authz B-082/084 · AuditLog · B-097 tx door)
2. routes/etax.ts — POST /etax/send (queued→sent · FakeTaxEngine · C4) + GET /etax/status (honest aggregate)
3. gl.ts — GET /gl/reports/trial-balance (Σdr/Σcr per account · Dr=Cr footer) + POST /gl/close-period (accounting_period lock · 409 already-locked · CE YYYY-MM strict — beware bank seed '2569-05' BE rows)
4. routes/fa.ts — GET+POST /fa/assets on EXISTING columns (no computed depreciation until W3-C) · DRAFT migration 0035 fixed_asset superset (code/category/location/acquisition_date/salvage/status/coa-link) + file confirm-blocker — DRAFT, don't merge
5. G2 contract-live + G4 E2E scaffolds ×6 (graceful-skip-on-429 · B-099 open)
6. i18n manifests Wave-A/B compile (orch-B applies later)

## Wave-1 web (orch-C · in order)
gl.inbox (LIVE backend · zero dependency · FIRST) → gl.trial (หลัง trial-balance lands) → gl.close shell → fa.register (หลัง fa.ts + 0035 confirm) → FinAging shared shell (ar.aging+ap.aging one port) → ar.invoice/ar.rv (create-modals live · lists รอ round A) → tail (fa.depr · tax.* · gl.statements/cashflow หลัง bundles)

## Wei ruling bundles (filed as BLOCKERS)
- **B-121 = W3-A** AR read-surface + AR money (9Q · critical path — all 5 AR screens + tax.etax queue hang on Q1 op-set · ar_invoice/rv migrations · RV semantics · CN VAT authority · tax-register derive-vs-table · doc-number seed · Sync-REM/dunning mock strip)
- **B-122 = W3-B** GL classification + posting map (7Q · F-GL2 account-type enum · /gl/post doc-type→account map · GET /gl/periods · period canon CE · trial carry · close checklist · revrec defer confirm)
- **B-123 = W3-C** FA money authority (7Q · depreciation basis CONTRADICTION in prototype L158 vs L491 · run posting route inbox-vs-JV · account mapping · 0035 confirm · adjust op-set · import · internal-rent KPI)
- **B-124 = W3-D** tax reports + e-Tax honesty (5Q · /tax/reports/vat+wht op shapes · RD-ack/CA-cert theater = C10 honest-empty vs labeled-mock · ภ.พ.30 16-line inputs · ภงด3/53 split heuristic · RD form render side)

## Sacred rounds (queued on bundle answers)
Contract A (AR surface · dual-serves tax.etax filters — declare ONCE) · B (/tax/reports pair · ZERO /tax paths today verified) · C (FA adjust surface) · D (GET /gl/periods · 1 op if revrec stays deferred) · i18n Wave-A (gl+ar ~200) · Wave-B (fa+tax ~310) — ports may precede via *-strings.json _missing pattern (ap/billing precedent) · doc_numbering seed ext (B-060 precedent · after W3-A Q7)

## Cross-lane risks (verify lane will skeptic these)
Money authority: CN VAT client-calc · RV paid-flip Σ-rule · FA depreciation — ALL server-owned at build. Posting-route consistency (FA run + CN approve + /gl/post → same mechanism). Period BE/CE canon. Doc-number display = never client-fabricate. ~510-key glyph discipline.

## CORRECTIONS (2026-07-20 · from orch-A/orch-C prep reports · orch-B verified vs NAV-ROUTES)
- **Web source list:** gl.* screens = **pototype/gl.jsx** (NAV-ROUTES L60+) · tax.vat/wht = **pototype/tax.jsx** · finance.jsx = NOT ROUTED (dead code · §0-forbidden as source) — supersedes the accounting-extra-only list. NAV-ROUTES stays authoritative; re-read the .jsx at port time (§0).
- **Depreciation formula:** orch-A prep assumed cost/(life×12) — WRONG per B-123: server = **(cost−salvage)/life** (L491 = mock bug). Corrected in C-176.
- **RV over-allocation:** REJECT 409 (server money authority · no silent clamp) — orch-B default recorded C-176; RV posting rides posting-inbox (consistency: rv:/fa:/cn: all inbox).
- **close-period:** lock-only in Phase-3 (no closing entries — accounting policy defer).
- **Retention 50/50 release:** NOT covered by B-121..124 → filed B-125 (Wei async · Wave-P3-2).

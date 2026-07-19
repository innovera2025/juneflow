# Phase-4 verify baseline + plan (orch-B · 2026-07-19 · dev 75bb419)
Captured BEFORE any Wave-0 merge so sacred-integrity + migration verify is exact.

## Baseline (pre-Wave-0)
- **openapi md5 = `4557061e047c21de73086be9a022ff91`** — Wave-0 backend handlers implement the ALREADY-declared ops → this md5 must **NOT change** in Wave-0 (contract frozen). A change = unauthorized sacred edit → FAIL.
- **i18n = 2127 / 2127 keys, cmp-identical** (docs/extract + packages/i18n). After R1 (subcon+accept ~+200-240) + R2 (pm ~+130-160): both dicts still `cmp`-identical, delta = ONLY subcon.*/accept.*/pm.* keys, glyph-exact vs prototype, i18n test 19/19.
- **highest migration = 0032.** Wave-0 adds NONE. Wave-2 = 0033 (subcon autosplit cols) / 0034 (pm cert col). A migration in a Wave-0 diff = flag.
- **routes: no subcon.ts / pm.ts yet** — Wave-0 creates them + registers in app.ts.
- **15 subcon/pm ops frozen-declared:** /subcon-contracts · /periods/{id}/{deliver,inspect,approve-payment} · /defects/{id}/{fix,recheck} · /acceptance-center · /pm/{assets,checklist-templates,contracts,quotes,workorders}.

## Wave-0 verify plan (on merge)
1. **Sacred:** openapi md5 == baseline (unchanged) · i18n cmp-identical + delta only subcon/accept (R1) or pm (R2) keys · NO migration in the backend diff.
2. **Backend (contract-live):** subcon.ts + pm.ts registered in app.ts · the START-NOW ops respond with the B-014 envelope · generated client regens clean (no drift).
3. **Tenant-door skeptic:** subcon reads scope via subcon_contract.project_id→project.company_id (selectThrough door, no bare select — evm-snapshot-class check) · pm via company_id door · foreign id → 404/empty (no leak) · 401 fail-closed.
4. **State-machine unit (C3):** deliver pending→delivered (409 on bad state) · inspect pass→passed / reject→rejected+defect insert · fix open→fixing · recheck→closed|open · acceptance-center period slice = counts.ts C3 query.
5. **AuditLog:** every mutation writes audit_log (middleware).
6. **Live:** boot stack + curl subcon/pm endpoints + assert scope + state transitions + 401.
7. **gate-4.5** before push.

## Wave-2 (later) extra verify
- **money-authority skeptic** (approve-payment): server-computed amount, NOT client-trusted (Wei B-107) · retention auto-deduct → ap_billing cross-lane write correct · per-basis formula.
- migration 0033 additive live-proof (autosplit cols) · pm per_visit autogen (spread visits_per_year, anchor=start_date).

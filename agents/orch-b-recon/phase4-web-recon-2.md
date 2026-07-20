# Phase-4 Web Recon 2 — 5 upcoming screens (orch-B · 2026-07-20 · main 16d71ac)
Recon-first (ultracode 5-scout+synth · wf_2e9b9869). Purpose: front-load i18n/contract/visual/ruling so chat-3 ports green.

## Headline
- **i18n ~complete** (R1/R2 accept.*44/subcon.*245/pm.*261 well-built). Real residual = tiny.
- **Real blockers = 10 ruling-gates (C10 wire/display-parity + mock-mechanism)** — NOT i18n.
- **Only pm.dashboard is GREEN** (3 keys · 0 gate · visual ref present).

## Sacred i18n — pm.dashboard round (APPLY-READY · glyph-verified by orch-B)
- pm.kpiCostYtdSub = "ม.ค.–มิ.ย. 69"  (pm.jsx:114 · separator = U+2013 EN-DASH e2 80 93 — VERIFIED)
- pm.statusDue = "ใกล้ถึงกำหนด"       (pm.jsx:34)
- pm.calMonthTitle = "มิถุนายน 2569"   (pm2.jsx:552 · shared PMCalendar dashboard+schedule)
- (optional fold: subcon.periodPctTooltip = "งวด {n} = {pct}%" · subcon-accept2.jsx:55 · title-attr · uncontested)
- DO NOT re-key "ทำแล้ว 21 · เหลือ 25" (fills existing pm.kpiJobsThisMonthSub).

## Ruling-gates (B-114) — grouped
META-1 WIRE/DISPLAY-PARITY (accept G1/G2 + subcon.accept G3/G5): honest opaque wires lack prototype's visible columns (project name/owner/title/due-text/wait-days/docs-count/defect · projPct progress · overdue). §0 (match prototype) vs C10 (no fabricate) tension. → enrich wires+openapi+backend joins (sacred+orch-A) VS lean-honest port judged on chrome/layout.
META-2 pm.wo checklist-manager scope (G6): 7 keys picker-only (modal-defer B-065/066 precedent) VS 19 keys port-full (+PUT/DELETE /pm/checklist-templates missing on main).
META-3 pm.schedule derive-vs-mock (G7): reproduce static June-2569 mock for visual parity VS derive from pm_asset (B-108a) + re-baseline reference. (+G8 '3'-hardcode · G9 month-names · G10 next_due bucketing follow-ons.)
SMALL: G4 subcon.accept '%' header key (add subcon.colPct vs inline glyph).

## Contract gaps (orch-A)
- PUT /pm/checklist-templates/:id · DELETE /pm/checklist-templates/:id — MISSING on main (blocks pm.wo manager · gated on META-2). All other endpoints live.

## Visual-ref gaps (capture before G5)
- accept: UNKNOWN (gallery opaque NN-s.jpg · content-scan or re-capture)
- subcon.accept: MISSING · pm.wo: MISSING · pm.schedule: present-but-G7-tied · pm.dashboard: PRESENT (shots/pm-dash.png) ✓

## Readiness
green: pm.dashboard | gated: accept(META-1) · subcon.accept(META-1+G4) · pm.wo(META-2) · pm.schedule(META-3)

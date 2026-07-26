# Road to 100% — master runway plan (orch-B · 2026-07-26 · main 6ef1f0f)
Phase-3 done (47/111 จอ). ~64 จอ + mobile เหลือ. Sequence = 5 programs, recon-first ต่อ program, ไม่หยุดข้าม program.
Each program: orch-B recon-charter (4-lane scout → Wei ruling bundle → START-NOW + i18n front-load) → orch-A backend → orch-C web → orch-B verify (gate-4.5 + G5 fleet) → promote 0-drift.

## Program order (เร็ว→ยาก · dependency-aware)
1. **P1 Finance tail (6 จอ · ~1-2 วัน)** — backend ส่วนใหญ่พร้อม · web-only เป็นหลัก. ปิด FLOW-F 100%.
   - web-only ports (backend live): gl.statements · gl.cashflow (DIRECT · B-129=ก) · ap.retention (/retention) · master.customer (/customers) · pm.contracts (/pm/contracts)
   - backend needed: ap.deposit (sacred op + handler)
   - DEFER (no honest source · B-107c class): gl.revrec · gl.projectpl → Phase-5
2. **P2 Operational core (~9 จอ · ~3-4 วัน)** — inv ×3 (stock/transfer/issue) · labor ×3 (attendance/payroll/workers) · petty · timeline · cost-alloc. Backend ใหม่ทั้ง flow (recon needed).
3. **P3 Sales+Land (FLOW-E+D · ~8 จอ · ~1-2 สัปดาห์)** — sales ×5 (crm/process/down/loan/service · AR auto-link) · land ×3 (bank/survey/dd). Greenfield backend+web.
4. **P4 SaaS platform (FLOW-G · ~7 จอ · ~1 สัปดาห์)** — admin ×4 (owner console MRR/subs/plans/invoices) · sub ×3 (tenant my-package/plans/billing). Backend contract-only → build. + Solar/EPC ×5 · DMS/reports/settings/audit hub screens.
5. **P5 Mobile (26 จอ Flutter · ~2-3 สัปดาห์)** — un-defer B-109 (offline ruling) first. Separate platform program.

## Verify invariants (ทุก program · เหมือน Phase-3/4)
money=SERVER (B-107a) · C10 honest-empty · sacred=BLOCKERS · consume-only i18n (orch-B front-loads+applies) · gate-4.5 before push · G5 fleet gate before web merge · 0-drift promote · report branch+SHA only.

## Status
- P1 filed 2026-07-26 (this doc). P2-5 = recon-charter at program start.

<!-- orch-B draft answers for Wei · 2026-07-17 10:55 · Wei ปรับ/approve แล้ว orch-A หยิบไป build -->
# WAVE-2 forks — draft คำตอบให้ Wei (Q0-Q6)

> orch-B วิเคราะห์ + validate recommendation ของ orch-A (WAVE-2-COMPLETENESS.md). Wei อ่าน/ปรับ → approve → orch-A build.

| Q | fork | 💡 draft answer | เหตุผล |
|---|---|---|---|
| **Q0** | greenlight timing | **ปิด batch-7 ก่อน** (B-084+drizzle fix → promote → re-wire 8 จอ) แล้วเปิด Wave-2 · *(อนุญาต gl.jv/inbox/coa no-fork start ขนานได้ถ้าอยาก momentum)* | อย่าเปิด flow ใหม่ทั้งที่ FLOW-A ยังมี promote-blocker + จอ em-dash |
| **Q1** F-GL1 | gl.projectpl revenue | **ง defer ทั้งจอ → Phase 5** *(หรือ ข อ่าน ar_invoice ถ้าอยากเห็นเลข P&L เดี๋ยวนี้)* | project-pl = risk สูงสุด/XL/blocked · B-069 defer AR/sales แล้ว · แยก packet เหมือน group-C. ก=deviation(§0) ค=fabricate(§0) |
| **Q2** F-GL2 | GL account type | **ก additive enum** (populate จาก code-prefix 1-5xxx) *(deferrable ถ้า Q1=ง)* | explicit + clean · ข infer-in-app เปราะ · ค accountant out-of-band |
| **Q3** F-PV1 | PV approval tier | **ข seed Finance Manager role** | ตรง flows.html 3-tier · เลี่ยง mixed-axis ของ ก (approvalLevel:0 = "ไม่มีสิทธิ์" ขัดกับ perms) |
| **Q4** F-BANK1 | bank-match algo | **ก exact-amount+date-window auto-suggest + manual confirm** | useful+safe · ข manual-only เหนื่อย · ค fuzzy over-engineer/เสี่ยง |
| **Q5** F-BANK2 | bank line shape | **ก normalize bank_statement_line table** (FK pv/rv/cheque) | ตรง gr_item precedent (FLOW-A) · match-write สะอาด + FK integrity · ข jsonb-rewrite awkward |
| **Q6** F-AP1 | WHT/retention | **ก persist** (additive wht/retention/woId · precedent cc/vendor) **+ WHT ผ่าน tax-engine.calcWht** | persist correct กว่า derive · reuse typed abstraction ที่มีแล้ว ไม่ inline |

## ผลถ้า approve ตามนี้
- Wave-2 = gl.jv/inbox/coa (S · no fork) + AP/PV (F-PV1/AP1) + bank recon/cheque (F-BANK1/2) · **gl.projectpl แยกไป Phase 5**
- migrations: account-type enum(ถ้าทำ coa P&L) + Finance Manager role seed + bank_statement_line + ap wht/retention = ~3-4 additive (0026+)
- ขนาด: ~5-8 web จอ + ~10 BE (เล็กกว่าถ้า defer project-pl)

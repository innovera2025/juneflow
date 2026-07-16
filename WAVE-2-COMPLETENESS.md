# Phase-2 Wave-2 (Finance Touch) — Wei Decision Packet

> DRAFT (orch-A · 2026-07-17 overnight · from Stream-3 recon → WAVE-2-RECON.md) · **รอ Wei greenlight + 6 fork rulings**
> Scope (MVP-B / B-069 ruling): finance touch = **AP → PV → bank** + **GL ขั้นต่ำ (jv/inbox/coa) + gl.projectpl** · **cost-side only · ไม่มี AR/sales** (Phase 5 defer)

## 1. ข่าวดี — โครงสร้างมีอยู่แล้วเยอะ (เหมือน FLOW-A)
- **schema finance.ts มีครบหลายตัว:** ap_billing · pv · cheque · bank_statement · reconcile · gl_account · jv · jv_line · accounting_period · ar_invoice
- **packages พร้อม (แต่ยังไม่ wire):** `bank-file` (kbank-direct formatter ทำงานได้) · `tax-engine` (calcWht/calcVat typed)
- **contract มี path บางส่วน:** POST /ap/billing · POST /ap/pv · /pv/{id}/approve · /bank/* · /gl/* reports (opaque · ยังไม่ implement)
- **ยังไม่มี handler เลย:** ไม่มี ap.ts/pv.ts/bank.ts/gl.ts route (0 finance route registered)

## 2. exists vs missing (สรุป)
| slice | schema | contract | handler | ขนาด |
|---|---|---|---|---|
| **gl.jv / gl.inbox / gl.coa** | ✅ ครบ (jv/jv_line/gl_account seeded balanced) | ✅ opaque paths มีแล้ว | ❌ | **S — สะอาดสุด** (handler-only · no fork) |
| **ap.billing** | ✅ (ขาด wht/retention/woId) | POST narrow · ไม่มี list/detail | ❌ | M (เหมือน pr.ts) |
| **ap.pv** | ✅ (ขาด method/cheque/retention · cheque.pvId FK) | POST narrow · ไม่มี list/detail | ❌ | M |
| **bank recon (+cheque/export)** | ✅ แต่ jsonb-raw · ไม่ normalize | action-only · ไม่มี list/match | ❌ | M-L (match algo ใหม่ · wire bank-file) |
| **gl.projectpl** | GL มี · **ขาด account-type + revenue data path** | GET /gl/reports/project-pl opaque | ❌ | **L-XL · blocked F-GL1** |

## 3. 🔀 6 Design Forks — ต้อง Wei ตัดสิน (ก่อนเริ่ม build)

**F-GL1 (สำคัญสุด) — gl.projectpl revenue ขัด B-069 "cost-side only":** prototype เป็น income statement เต็ม (Revenue−COGS−SG&A−interest−tax=NP) แต่ B-069 defer AR/sales ไป Phase 5 · จอนี้ render ไม่ได้ถ้าไม่มี revenue
- (ก) cost-only variant (ตัด revenue/GP/NP) = deviation จาก prototype → ต้อง Wei-exception (§0 rule 1)
- (ข) อ่าน revenue จาก ar_invoice ที่ seed มีแล้ว (5 rows มี projectId) — "ไม่ทำ AR feature ใหม่" ≠ "ห้ามมี revenue"
- (ค) seed revenue static ตาม mock (ขัด §0 rule 3 no-fabricate ถ้าไม่มี exception)
- (ง) **defer gl.projectpl ทั้งจอ** ไป Phase 5 · Wave-2 ทำแค่ gl.jv/inbox/coa

**F-GL2 — GL account type:** gl_account ไม่มี column แยก revenue/COGS/SG&A/asset/liability → P&L rollup ต้องรู้ · (ก) เพิ่ม type enum (additive · populate จาก code-prefix 1-5xxx) (ข) infer จาก code-range ใน app code (ค) accountant validate COA เต็ม (PLAN §11 Q3)

**F-PV1 — PV approval tier:** flows.html PV = 3-tier (บัญชี→ผจก.การเงิน>500K→MD>2M) แต่ไม่มี seed "Finance Manager" role · acc role = approvalLevel:0 (code ถือว่า "ไม่มีสิทธิ์") แต่ perms finance.approve=true · (ก) reuse pm/dir levels + tier-1="any finance.approve perm" (mixed-axis ใหม่) (ข) seed Finance Manager role ใหม่ (ค) Wei อื่น

**F-BANK1 — bank-match algorithm:** prototype "จับคู่" = decorative (hand-toggle · ไม่มี logic ให้ port) · (ก) exact-amount+date-window auto-suggest+manual confirm (ข) manual match only (ค) fuzzy

**F-BANK2 — bank line shape:** bank_statement.lines = jsonb raw · match-write awkward · (ก) normalize bank_statement_line table (เหมือน gr_item precedent · FK pv/rv/cheque) (ข) คง jsonb + in-place rewrite (ค) engineering judgment (fork เล็กสุด)

**F-AP1 — WHT/retention persist:** prototype persist wht+retention ต่อ row บน ap_billing · (ก) additive migration เพิ่ม wht/retention/woId (precedent cc/vendor B-059/071) — low-risk default (ข) presentation-only derived ตอน PV · + question: WHT ผ่าน tax-engine.calcWht (typed fake มีแล้ว) หรือ inline?

## 4. ข้อเสนอลำดับ (orch-A recommend หลัง Wei ตอบ forks)
1. **gl.jv/inbox/coa ก่อน** (S · สะอาด · handler-only · no fork) — เริ่มได้ทันทีที่ greenlight
2. **ap.billing + ap.pv** (M · additive migration + list/detail contract + widen POST + handler + web) — เหมือน FLOW-A pr/po
3. **bank recon+cheque+export** (M-L · หลัง F-BANK1/2 · wire bank-file package)
4. **gl.projectpl** (L-XL · หลัง F-GL1/F-GL2 · อาจแยก packet เอง เหมือน boq.reports/EVM group-C)

## 5. คำถาม Wei (greenlight + forks)
- **Q0:** greenlight Wave-2 (finance) เริ่มเลย หรือ promote batch-7 + ปิด FLOW-A ให้จบก่อน?
- **Q1 (F-GL1):** gl.projectpl → ก/ข/ค/ง? (แนะนำ **ง defer** หรือ **ข ar_invoice-read** ถ้าอยากเห็นเลข)
- **Q2 (F-GL2):** account type → ก (enum) / ข (code-range) / ค? (แนะนำ **ก** additive enum)
- **Q3 (F-PV1):** PV tier → ก/ข/ค? (แนะนำ **ข** seed Finance Manager role = ชัดสุด)
- **Q4 (F-BANK1):** match → ก/ข/ค? (แนะนำ **ก** exact+date auto-suggest+manual)
- **Q5 (F-BANK2):** line shape → ก (normalize) / ข (jsonb)? (แนะนำ **ก** normalize · เหมือน gr_item)
- **Q6 (F-AP1):** wht/retention → ก (persist) / ข (derived)? + tax-engine? (แนะนำ **ก** persist · WHT ผ่าน tax-engine)

## 6. ขนาดรวม
เท่ากับหรือใหญ่กว่า FLOW-A Wave-1 (13 BE + 11 web) · 4-7 migrations (0025+) · i18n ~100-200 keys (ap/bank/gl.jsx) · web ~6-9 จอ · **gl.projectpl = risk สูงสุด** (แยก packet ได้)

---
*Evidence: WAVE-2-RECON.md · finance.ts · openapi.yaml:1963-2269 · pototype/{ap,bank,gl,accounting-extra,accounting-extra2}.jsx · seed:768-1330 · packages/{bank-file,tax-engine}*

# packages/integrations — เขต Integrations · อ่านราก `CLAUDE.md` + `PLAN.md` §0 (Design Fidelity Protocol) ก่อนเริ่มงานทุกครั้ง

## เขตความรับผิดชอบ (PLAN.md §8)
- ครอบคลุม `packages/tax-engine` · `packages/bank-file` · `packages/notifications` — เข้าทำงาน Phase 3

## Interface กลาง (Compliance เป็น interface — PLAN.md §4)
- **ทุก integration ต้อง implement interface กลาง** — ห้ามเรียก external service ตรงจากที่อื่น:
  - `TaxEngine` — implementation แรก = `thailand`
  - `BankFileFormatter` — implementation แรก = `kbank-direct`
  - `NotificationAdapter` — adapters: `line` / `email` / `webpush`

## Mock-first (บังคับ)
- ทุก external service เริ่มด้วย **fake adapter**: e-Tax · KBANK · LINE
- fake ต้องทำให้ flow, contract test และ E2E เดินได้ครบก่อนต่อของจริง — ของจริงสลับเข้าผ่าน interface เดิม

## ฟอร์มภาษีไทย
- ฟอร์มภาษีทุกใบต้อง **render ตรง `pototype/tax-forms.jsx` 100%** ซึ่งถอดแบบตรงต้นฉบับกรมสรรพากร (RD)
- ห้ามจัดเลย์เอาต์ฟอร์มใหม่ — นี่คือเอกสารราชการ ความตรงต้นฉบับคือ requirement

## Credentials
- credential ทุกตัว (e-Tax / KBANK / LINE ฯลฯ) **ผ่าน env เท่านั้น** — ห้าม hardcode ห้าม commit ลง repo
- secrets = sacred (PLAN.md §10) — จัดการผ่าน DevOps/infra ไม่ใช่ในโค้ด package

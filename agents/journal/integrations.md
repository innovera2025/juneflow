# Journal — Integrations (เขต: `packages/tax-engine` · `packages/bank-file` · `packages/notifications`)

> บันทึกต่อรอบ loop ตาม PLAN.md §10 — หนึ่ง entry ต่อหนึ่งรอบ · entry ใหม่อยู่บนสุด
> รูปแบบ entry ต่อรอบ:
>
> ```
> ## [YYYY-MM-DD] · รอบที่ N · task: <task id>
> - ทำอะไร: (งานที่ลงมือทำจริงในรอบนี้ + ผล gates)
> - ตัดสินใจอะไร: (การตัดสินใจในเขตตัวเอง — ความขัดแย้ง design/spec ห้ามตัดสินเอง → BLOCKERS.md)
> - เจออะไร: (สิ่งที่พบ/ติดขัด/blocker ที่เปิด/สิ่งที่ agent รอบถัดไปควรรู้)
> ```

## 2026-07-12 · รอบที่ 1 · task: P0-INT-05

- ทำอะไร: field inventory ฟอร์มภาษีไทย 3 ใบจาก `pototype/tax-forms.jsx` (L1–727) → เขียนใหม่ `packages/tax-engine/docs/tax-forms-map.md`. ครอบคลุม (A) ภ.พ.30 `PND30Form` incl. ตาราง VAT 16 บรรทัดพร้อมสูตร calc, (B) ใบแนบ ภ.ง.ด.3/53 `PND53Form` (component เดียว 2 ฟอร์มผ่าน prop `kind`), (C) 50 ทวิ `WHTCertificate`, + shared primitives (`FormPage`/`TaxIdBoxes`/`AddrCell`/`PartyBox`/`bahtText`/`TH_MONTHS_FULL`/openers). แต่ละฟิลด์ระบุ key บน `data`, ป้าย TH verbatim, input/calc/static, type, และ src line. Gate = coverage checklist ครบทุกฟอร์ม + สัญลักษณ์ export ครบ (task docs-only ไม่มี G1–G5 อัตโนมัติ; ไม่แตะโค้ด/UI จึงไม่กระทบ CI). เขียว → commit บน `feature/integrations`, TASKS.md `doing→review`, เพิ่มแถว REVIEW-QUEUE.md.
- ตัดสินใจอะไร: ไม่ตัดสิน design/spec เอง. transcribe ป้ายภาษาไทยตามต้นฉบับ RD ในซอร์ส (เป็น documentation ไม่ใช่ re-translate). ไม่ push เอง (auto-merge dev เป็นขั้นตอน loop-runner/Wei review) — จบรอบที่สถานะ review ตามคำสั่งรอบนี้.
- เจออะไร: **ประเด็นรอ Wei (ยังไม่ block งาน inventory)** — 50 ทวิ จับคู่ประเภทเงินได้ด้วย `String(r.typeIdx) === t.i` (L598) แต่ id มี `"4(ก)"`/`"4(ข)"` ที่ `typeIdx` เลขจำนวนเต็มจับคู่ไม่ได้ตลอด → Phase 3 `TaxEngine.thailand` ต้องส่ง `typeIdx` เป็น string ตรง catalog 7 คีย์ (บันทึกไว้ใน map §C.4 + handoff note 5). คิว `ready` เขต integrations หลังรอบนี้ = 4 (INT-01..04) — INT-01/02/03 ยังรอ P0-BE-01 (`ready`, ยังไม่ done); ต่ำกว่า 5 เพราะ dep เขต backend ยังไม่ปลด, ไม่ใช่คิวหมด. เตือน Wei: งาน integrations ที่เริ่มได้จริงตอนนี้เหลือ INT-05 (เสร็จแล้ว); ที่เหลือปลดล็อกเมื่อ P0-BE-01 done.

## 2026-07-06 · bootstrap · task: —

- ทำอะไร: bootstrap ไฟล์สถานะ loop ตาม Manifest v2 กลุ่ม 3 · เขต integrations มี 5 task ใน `TASKS.md` (P0-INT-01 ถึง P0-INT-05) สถานะ `ready` — P0-INT-05 (tax forms field inventory) เริ่มได้ทันทีโดยไม่รอเขตอื่น
- ตัดสินใจอะไร: ไม่มีการตัดสินใจเชิง design/spec — ความขัดแย้งถูกยกเข้า `BLOCKERS.md` (B-001, B-002)
- เจออะไร: โครงโฟลเดอร์เขตนี้ยังมีประเด็นเปิด → **B-002** (`packages/integrations/CLAUDE.md` ตามกลุ่ม 2 vs 3 แพ็กเกจแยกตามกลุ่ม 5 — รอ Wei เลือก ก/ข/ค แต่ไม่ block งาน skeleton) · หลักเขต (กลุ่ม 2.5): ทุกตัว implement interface กลาง · mock-first (fake adapter e-Tax/KBANK/LINE) · credentials ผ่าน env · agent เขตนี้เข้าทีมเต็มรูป Phase 3 (PLAN.md §7)

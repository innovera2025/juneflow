# tests/seed/ — Seed fixture assertions (P0-QA-06)

Expected-first assertions ของ **จำนวน record ต่อ entity** ที่ seed จริง (P0-BE-10) ต้องผลิต

## แหล่งอ้างอิงเดียว
`docs/extract/MOCK-DATA.md` §"สรุปสำหรับทำ seed data" — ถอดจำนวน record ทุกบรรทัดมาเป็น
ค่าคาดหวังตรง ๆ 100% ห้ามตีความใหม่ (tests/CLAUDE.md · PLAN.md §0)

## method
- **ห้ามอ่าน implementation ก่อนเขียน expected** — ยังไม่มี `packages/db` seed อยู่แล้ว
- แต่ละบรรทัด §สรุป → 1 `SeedCount { entity, expected, group, source, sub? }` พร้อม citation ต้นทาง (`.jsx` const)
- **รอบนี้ (spec-only)** รันได้เฉพาะ fixture-consistency: จำนวนเต็มไม่ติดลบ · ไม่ซ้ำ · ครบ 7 กลุ่ม · Notification 3 ชุด · entity ไม่มี record = 9
- **เทียบกับ record จริง** อยู่ใน `describe.todo` — เปิดสายเมื่อ P0-BE-10 (seed) done: `countRows(table) === expected`

## ขอบเขต
- นับเฉพาะ **7 กลุ่ม Juneflow** (Platform · Master · BOQ/จัดซื้อ · ผู้รับเหมา · PM · การเงิน-บัญชี · ที่ดิน/ขาย/อื่นๆ)
- `wat/` ("บุญบัญชี") = **คนละผลิตภัณฑ์** (§0 กฎข้อ 5) → เก็บใน `WAT_COUNTS` reference-only, ไม่ seed เข้า Juneflow db
- entity ที่ dictionary มีแต่ไม่มี mock record (AiUsage, Acceptance, Defect, Attendance, Payroll, SalesUnit, Cheque, JV lines, Unit) → expected 0

## รัน
`pnpm --filter @juneflow/tests test:seed` (หรือ `vitest run seed`)

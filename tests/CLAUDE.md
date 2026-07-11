# tests/ — เขต QA · อ่านราก `CLAUDE.md` + `PLAN.md` §0 (Design Fidelity Protocol) ก่อนเริ่มงานทุกครั้ง

## หลักการเขียน expected (กฎเหล็กของเขตนี้)
- เขียน test จาก **spec เท่านั้น**: `docs/handoff/flows.html` · `docs/extract/NAV-ROUTES.md` ·
  `docs/extract/PACKAGE-RULES.md` · `docs/extract/PROJECT-TYPES.md` · ภาพใน `pototype/gallery/`
- **ห้ามอ่าน implementation ก่อนเขียน expected values** — กัน test ที่เขียนตามโค้ดที่ผิดแทนที่จะจับผิดโค้ด

## โครงเขต
- `tests/contract/` · `tests/e2e/` · `tests/visual/reference/`
- ภาพอ้างอิง visual gate ใน `tests/visual/reference/` ก๊อปจาก `pototype/gallery/g1–g5`
  (นับจริงบนดิสก์ **106 .jpg — ใช้ทั้งหมด**) + `pototype/shots/` (22 .png)
- จอที่ไม่มีภาพอ้างอิง → แคปจาก `pototype/Juneflow Fiori.html` จอเดียวกันเป็น reference ก่อน (PLAN.md §0)

## Test data
- ใช้ข้อมูลจาก **central seed** (`packages/db` seed ตาม `docs/extract/MOCK-DATA.md`) เท่านั้น
- ห้ามสร้าง fixture เฉพาะกิจที่ขัดกับ seed กลาง

## 5 Verification Gates (PLAN.md §9 — Done = ครบทั้ง 5)
1. Schema gate — ตรง dictionary + ภาคผนวก B
2. Contract test — generate จาก OpenAPI แล้วผ่านทั้งหมด
3. Unit business logic — posting rules · ตัด remain BOQ · retention · approval matrix · quota · งวดงาน 4 basis
4. E2E Playwright — ตาม state machine ใน `flows.html`
5. Visual gate — screenshot เทียบ reference ใน `tests/visual/reference/`

## ความขัดแย้ง
- expected ขัดกับพฤติกรรมจริง/ระหว่างไฟล์ spec → เช็ค PLAN.md ภาคผนวก C ก่อน · นอกตาราง → `BLOCKERS.md` ห้ามตัดสินเอง

## ขั้นตอนปฏิบัติ (skills)
- ขั้นตอนรัน 5 gates → `.claude/skills/run-gates` · ขั้นตอน visual gate → `.claude/skills/visual-gate`

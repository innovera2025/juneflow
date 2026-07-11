# REVIEW-QUEUE.md — คิวงานเขียวบน dev รอ Wei promote

> ตาม PLAN.md §10 Review flow: `feature → dev (auto เมื่อ CI เขียว) → main (Wei promote คนเดียว)`
> Wei ตรวจเป็น batch: อ่านคิวนี้ + `BLOCKERS.md` → คลิกเล่นบน dev เทียบ gallery → ผ่าน = promote / ไม่ผ่าน = rework task

## วิธีใช้

**ฝั่ง agent:**

1. task ผ่าน gates ครบ (ตามคอลัมน์ gates ใน `TASKS.md`) และ auto-merge เข้า `dev` แล้ว → เพิ่มหนึ่งแถวในตารางด้านล่าง
2. เปลี่ยนสถานะ task ใน `TASKS.md` เป็น `review` + เขียน journal ประจำรอบ
3. คอลัมน์ **diff** = ลิงก์/ref ของ commit หรือ PR ที่ merge เข้า dev · คอลัมน์ **ภาพเทียบ gallery** = path screenshot จอที่สร้าง คู่กับ path ภาพอ้างอิงใน `tests/visual/reference/` (งานที่ไม่มีจอ เช่น schema/script → ระบุ "—" พร้อมหลักฐาน gate ที่ใช้แทน)

**ฝั่ง Wei:**

1. ไล่ตรวจจากแถวเก่าสุด → คลิกเล่นบน dev เทียบ gallery
2. **ผ่าน** = promote เข้า `main` → เปลี่ยนสถานะ task ใน `TASKS.md` เป็น `done` → ลบแถวออกจากคิวนี้
3. **ไม่ผ่าน** = สร้าง rework task ใน `TASKS.md` (สถานะ `ready` ระบุสิ่งที่ต้องแก้) → ลบแถวออกจากคิวนี้

## คิวรอ promote

| task id | โมดูล | diff | ภาพเทียบ gallery | วันที่ |
|---|---|---|---|---|
| P0-QA-01 | qa · visual-gate | `feature/qa` @ `006fbf0` | — (งาน index ไม่มีจอ · หลักฐาน: `tests/visual/reference-index.md` 128 แถว = 106 .jpg + 22 .png · นับไฟล์ตรงเกณฑ์ B-001) | 2026-07-12 |
| P0-QA-05 | qa · unit G3 | `feature/qa` @ `b81528c` | — (test spec ไม่มีจอ · หลักฐาน: `tests/unit/` 6 ไฟล์ · `vitest run unit` = 48 tests เขียว · expected ถอดจาก spec ล้วน · posting account mapping/approval thresholds ค้าง Open Q #3/#2 ทำ `describe.todo` ไม่เดา) | 2026-07-12 |
| P0-QA-06 | qa · seed fixture | `feature/qa` @ `4ad56a5` | — (seed assertions ไม่มีจอ · หลักฐาน: `tests/seed/seed-counts.spec.ts` · `vitest run seed` = 90 tests เขียว · จำนวน record ถอดจาก `docs/extract/MOCK-DATA.md` §สรุป 100% · เทียบ record จริง = `describe.todo` รันเมื่อ P0-BE-10 done · wat/ reference-only ไม่ seed §0กฎ5) | 2026-07-12 |

> หมายเหตุ: ยังไม่ push→dev ในรอบนี้ (ตามคำสั่งรอบ commit+review) · ด่าน 4.5 diff-reviewer + auto-merge dev เหลือให้ loop-runner/รอบถัดไปก่อน Wei promote

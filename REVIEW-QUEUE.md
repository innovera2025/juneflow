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
| P0-WEB-05 | web | `feature/web` (รอ CI+diff-reviewer+auto-merge dev) | smoke `shell-dashboard.png` เทียบ `tests/visual/reference/gallery/g1/01-s.jpg` (sidebar chrome th ตรง · badge ขาดตาม C10/B-040 · content=Placeholder ยังไม่มีจอ dashboard) · G5 เต็มรอ live seeded stack (B-038) | 2026-07-13 |

> ✅ **batch #2 (46 งาน) promoted → `main` `1eb2ecb` เมื่อ 2026-07-13** — Phase 0 ครบ + P1 login · audit อิสระ 0 defects (sacred integrity · migration 0000-0008 · gates 28/29 · api 81/web 24 · seed 113/113) · queue เคลียร์
> แถวใหม่จะสะสมเมื่อมีงาน merge เข้า `dev` รอบถัดไป (WEB-05 shell · DEV-06 secret กำลังจะเดิน)

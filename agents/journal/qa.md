# Journal — QA (เขต: `tests/`)

> บันทึกต่อรอบ loop ตาม PLAN.md §10 — หนึ่ง entry ต่อหนึ่งรอบ · entry ใหม่อยู่บนสุด
> รูปแบบ entry ต่อรอบ:
>
> ```
> ## [YYYY-MM-DD] · รอบที่ N · task: <task id>
> - ทำอะไร: (งานที่ลงมือทำจริงในรอบนี้ + ผล gates)
> - ตัดสินใจอะไร: (การตัดสินใจในเขตตัวเอง — ความขัดแย้ง design/spec ห้ามตัดสินเอง → BLOCKERS.md)
> - เจออะไร: (สิ่งที่พบ/ติดขัด/blocker ที่เปิด/สิ่งที่ agent รอบถัดไปควรรู้)
> ```

## 2026-07-06 · bootstrap · task: —

- ทำอะไร: bootstrap ไฟล์สถานะ loop ตาม Manifest v2 กลุ่ม 3 · เขต qa มี 6 task ใน `TASKS.md` (P0-QA-01 ถึง P0-QA-06) สถานะ `ready` — P0-QA-05 (unit business-logic test spec) และ P0-QA-06 (seed fixture assertions) เริ่มได้ทันทีเพราะเขียนจาก spec ล้วน
- ตัดสินใจอะไร: ไม่มีการตัดสินใจเชิง design/spec — ความขัดแย้งถูกยกเข้า `BLOCKERS.md` (B-001, B-002)
- เจออะไร: กฎเขตนี้ (กลุ่ม 2.4): เขียน expected จาก flows.html + NAV-ROUTES + PACKAGE-RULES + PROJECT-TYPES + gallery — **ห้ามอ่าน implementation ก่อนเขียน expected** · visual reference จริงมี 106 .jpg (manifest ระบุ 102) → รอคำยืนยัน B-001 แต่ index ทำครบ 106 ไปก่อน (ไม่ block งาน)

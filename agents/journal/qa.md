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

## 2026-07-12 · รอบที่ 1 · task: P0-QA-01

- ทำอะไร: สร้าง `tests/visual/reference-index.md` — index ภาพอ้างอิง → จอ/route ครบ **128 ภาพ (106 .jpg + 22 .png)**. ตรวจนับไฟล์บนดิสก์ตรงเกณฑ์ (g1:30·g2:47·g3:5·g4:4·g5:20 = 106 .jpg + shots 22 .png). gallery ทั้ง 106 map จาก caption ต้นทาง `pototype/คู่มือ Flow + ภาพหน้าจอ.html` (route + ไฟล์ .jsx) + `pototype/แกลเลอรีหน้าจอ.html` (route id) แล้ว cross-check กับ `docs/extract/NAV-ROUTES.md` ทุกแถว. **Gates GREEN** (task row: จำนวนไฟล์ตรง + index ครอบคลุมทุกภาพ) — task นี้ไม่มีจอ/โค้ด จึงไม่เข้า G1–G5. → commit บน `feature/qa`, task → `review`, เพิ่มแถว REVIEW-QUEUE.
- ตัดสินใจอะไร: ไม่มีการตัดสิน design/spec. shots/ 22 ภาพ (.png) เป็น dev working-capture ไม่มี caption ต้นทาง — map จากชื่อไฟล์ (land-*, pm-*, ptype-modal) cross-check NAV-ROUTES แล้วระบุ **คอลัมน์ความมั่นใจต่อแถว** (สูง/กลาง/ต่ำ) อย่างโปร่งใส ไม่แต่งข้อมูล spec; visual gate ให้ยึด gallery/ เป็นเกณฑ์หลัก.
- เจออะไร: (1) แหล่ง caption จริงของภาพ = 2 ไฟล์ HTML ใน `pototype/` (คู่มือ Flow ให้ route+.jsx ครบสุด). (2) shots/ ไม่ถูกอ้างใน HTML caption ใด — เป็น working shots ของ module land + PM; ถ้ารอบต่อไปทำ visual-gate harness (P0-QA-04) ให้ยึด gallery 106 ภาพเป็น reference หลัก. (3) diff-reviewer (ด่าน 4.5) + push→auto-merge dev ยังไม่ทำในรอบนี้ (ตามคำสั่งรอบ: commit+review+REVIEW-QUEUE) — เหลือให้ loop-runner/รอบถัดไป push. (4) คิว ready เขต qa เหลือ 5 (P0-QA-02/03/04 ติด dep, P0-QA-05/06 พร้อม) — ยังไม่ต่ำกว่าเกณฑ์.

## 2026-07-06 · bootstrap · task: —

- ทำอะไร: bootstrap ไฟล์สถานะ loop ตาม Manifest v2 กลุ่ม 3 · เขต qa มี 6 task ใน `TASKS.md` (P0-QA-01 ถึง P0-QA-06) สถานะ `ready` — P0-QA-05 (unit business-logic test spec) และ P0-QA-06 (seed fixture assertions) เริ่มได้ทันทีเพราะเขียนจาก spec ล้วน
- ตัดสินใจอะไร: ไม่มีการตัดสินใจเชิง design/spec — ความขัดแย้งถูกยกเข้า `BLOCKERS.md` (B-001, B-002)
- เจออะไร: กฎเขตนี้ (กลุ่ม 2.4): เขียน expected จาก flows.html + NAV-ROUTES + PACKAGE-RULES + PROJECT-TYPES + gallery — **ห้ามอ่าน implementation ก่อนเขียน expected** · visual reference จริงมี 106 .jpg (manifest ระบุ 102) → รอคำยืนยัน B-001 แต่ index ทำครบ 106 ไปก่อน (ไม่ block งาน)

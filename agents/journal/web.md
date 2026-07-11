# Journal — Frontend Web (เขต: `apps/web`)

> บันทึกต่อรอบ loop ตาม PLAN.md §10 — หนึ่ง entry ต่อหนึ่งรอบ · entry ใหม่อยู่บนสุด
> รูปแบบ entry ต่อรอบ:
>
> ```
> ## [YYYY-MM-DD] · รอบที่ N · task: <task id>
> - ทำอะไร: (งานที่ลงมือทำจริงในรอบนี้ + ผล gates — เขตนี้ต้องระบุผล visual gate เสมอเมื่อมีจอ)
> - ตัดสินใจอะไร: (การตัดสินใจในเขตตัวเอง — ความขัดแย้ง design/spec ห้ามตัดสินเอง → BLOCKERS.md)
> - เจออะไร: (สิ่งที่พบ/ติดขัด/blocker ที่เปิด/สิ่งที่ agent รอบถัดไปควรรู้)
> ```

## 2026-07-06 · bootstrap · task: —

- ทำอะไร: bootstrap ไฟล์สถานะ loop ตาม Manifest v2 กลุ่ม 3 · เขต web มี 6 task ใน `TASKS.md` (P0-WEB-01 ถึง P0-WEB-06) สถานะ `ready` — P0-WEB-04 (port-map inventory) เริ่มได้ทันทีโดยไม่รอเขตอื่น
- ตัดสินใจอะไร: ไม่มีการตัดสินใจเชิง design/spec — ความขัดแย้งถูกยกเข้า `BLOCKERS.md` (B-001, B-002)
- เจออะไร: เขตนี้ Design Fidelity เข้มสุด (PLAN.md §0 + กลุ่ม 2.2) — ทุกจอ port ตรงจาก `pototype/*.jsx` · token จาก `packages/tokens` ห้าม hardcode · ทุกข้อความ = key จาก i18n-full.json · task ส่วนใหญ่รอ P0-BE-01/04/05/12 จากเขต backend (ระบุใน dependencies แล้ว)

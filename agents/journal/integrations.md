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

## 2026-07-06 · bootstrap · task: —

- ทำอะไร: bootstrap ไฟล์สถานะ loop ตาม Manifest v2 กลุ่ม 3 · เขต integrations มี 5 task ใน `TASKS.md` (P0-INT-01 ถึง P0-INT-05) สถานะ `ready` — P0-INT-05 (tax forms field inventory) เริ่มได้ทันทีโดยไม่รอเขตอื่น
- ตัดสินใจอะไร: ไม่มีการตัดสินใจเชิง design/spec — ความขัดแย้งถูกยกเข้า `BLOCKERS.md` (B-001, B-002)
- เจออะไร: โครงโฟลเดอร์เขตนี้ยังมีประเด็นเปิด → **B-002** (`packages/integrations/CLAUDE.md` ตามกลุ่ม 2 vs 3 แพ็กเกจแยกตามกลุ่ม 5 — รอ Wei เลือก ก/ข/ค แต่ไม่ block งาน skeleton) · หลักเขต (กลุ่ม 2.5): ทุกตัว implement interface กลาง · mock-first (fake adapter e-Tax/KBANK/LINE) · credentials ผ่าน env · agent เขตนี้เข้าทีมเต็มรูป Phase 3 (PLAN.md §7)

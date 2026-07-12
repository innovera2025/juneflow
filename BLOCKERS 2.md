# BLOCKERS.md — ช่องทาง escalate ความขัดแย้ง design/spec

> **ไฟล์นี้คือช่องทางเดียว (single channel) สำหรับความขัดแย้ง design/spec ทุกกรณี** — ตาม PLAN.md §0 กฎข้อ 4 และ §10
> เจอความขัดแย้งที่ไม่อยู่ในตารางคำตัดสิน (PLAN.md ภาคผนวก C) → เขียน blocker ที่นี่ แล้วข้ามไป task อื่น **ห้ามเดา ห้ามเลือกเอง**
> Sacred files (PLAN.md §10: OpenAPI · merged migrations · CLAUDE.md ทุกใบ · CI config · secrets · `docs/extract/*` · i18n-full.json) แก้ได้ผ่าน blocker ที่ Wei อนุมัติแล้วเท่านั้น
> ข้อความ UI ที่ไม่มี key ใน `i18n-full.json` = เข้า blocker (PLAN.md §0 กฎข้อ 2)

## วิธีใช้

1. id รูปแบบ `B-xxx` รันต่อเนื่อง · ระบุ task ที่ชน · ตั้งคำถามให้ชัด · เสนอตัวเลือกให้ Wei เลือก
2. ระหว่างรอคำตอบ → เปลี่ยน task ใน `TASKS.md` เป็น `blocked` แล้วหยิบ task อื่น (ยกเว้น blocker ประเภทแจ้งเพื่อทราบ/ยืนยันย้อนหลัง สถานะ "รอ Wei ตอบ — ไม่ block งาน")
3. Wei ตอบแล้ว → บันทึกลงคอลัมน์ "คำตอบ Wei" → นำไปใช้ → เปลี่ยนสถานะเป็น `ตอบแล้ว — นำไปใช้` และปลด task จาก `blocked`
4. ค่าสถานะ: `รอ Wei ตอบ` / `รอ Wei ตอบ — ไม่ block งาน` / `ตอบแล้ว — นำไปใช้` / `ปิด`

## ตาราง blockers

| id | task | คำถาม | ตัวเลือกที่เสนอ | คำตอบ Wei | สถานะ |
|---|---|---|---|---|---|
| B-001 | P0-BE-03 / P0-QA-01 (visual reference) | gallery จริงมี **106 .jpg** (manifest ระบุ 102) — ก๊อปครบทั้ง 106 เข้า `tests/visual/reference/` แล้ว ยืนยันหรือไม่ | (ก) ใช้ครบทั้ง 106 ตามจริงบนดิสก์ (ค่าที่ใช้อยู่) · (ข) Wei ระบุรายชื่อ 102 ไฟล์ที่ต้องใช้ แล้วตัดส่วนเกินออกจาก reference | — | รอ Wei ตอบ — ไม่ block งาน |
| B-002 | bootstrap กลุ่ม 2 / P0-INT-01..04 | manifest กลุ่ม 2 ให้สร้าง `packages/integrations/CLAUDE.md` แต่โครง scaffold กลุ่ม 5 มี `packages/tax-engine\|bank-file\|notifications` แยกกัน (ไม่มีโฟลเดอร์ `integrations`) — bootstrap สร้างตาม manifest ตรงตัวแล้ว จะจัดโครงสร้างอย่างไร | (ก) ย้าย 3 แพ็กเกจเข้าใต้ `packages/integrations/` · (ข) คัดลอก CLAUDE.md ไปทั้ง 3 แพ็กเกจ · (ค) คงตามเดิม (`packages/integrations/CLAUDE.md` เป็นใบกลางของเขต + 3 แพ็กเกจแยกตามกลุ่ม 5) | — | รอ Wei ตอบ — ไม่ block งาน |
| B-003 | bootstrap กลุ่ม 6 (`.claude/` harness — manifest v3) | v3 กำหนดจำนวนองค์ประกอบ `.claude/` = hooks 5 + skills 4 + subagents 3 แต่ไม่ได้ระบุรายชื่อ — orchestrator เป็นผู้เลือกองค์ประกอบชุดนี้: hooks = `protect-files.sh` · `zone-guard.sh` · `i18n-guard.sh` · `block-main-commit.sh` · `journal-append.sh` — skills = `loop-task` · `port-screen` · `visual-gate` · `run-gates` — subagents = `diff-reviewer` · `visual-gate-runner` · `spec-scout` — ยืนยันชุดนี้หรือไม่ | (ก) ยืนยันชุดนี้ (ค่าที่ใช้อยู่จริงบนดิสก์) · (ข) Wei ระบุรายการที่ต้องการแทน | — | รอ Wei ตอบ — ไม่ block งาน |

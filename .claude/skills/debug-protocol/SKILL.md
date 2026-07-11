---
name: debug-protocol
description: Systematic root-cause debugging for the Juneflow loop - reproduce first, gather evidence (logs via log-reader, gate output, docker compose logs), localize to a zone, fix minimally inside your own zone, re-run the failing gate, respect the 3-red-rounds cap, escalate via BLOCKERS.md. Trigger keywords - debug, bug, broken, error, gate แดง, แก้บั๊ก, root cause, investigate, test fail, CI fail, why is this failing.
---

# debug-protocol — แก้บั๊กแบบหาต้นเหตุก่อนเสมอ (ใช้ในรอบ loop และงาน debug ทั่วไป)

> กฎที่ครอบทุกขั้นตอน: ทำงานเฉพาะเขตตัวเอง (PLAN.md §8) · ห้ามแตะ sacred files ·
> ความขัดแย้ง design/spec หรือ fix ที่ต้องออกนอกเขต → `BLOCKERS.md` แล้วข้าม **ห้ามเดา**
> เพดานตาม PLAN.md §10: gate แดงวนแก้ได้ **ไม่เกิน 3 รอบ** ต่อ task

## ขั้นตอน (ทำตามลำดับ ห้ามข้ามไปแก้ก่อนมีหลักฐาน)

### 1) Reproduce ให้ได้ก่อน

- รันคำสั่ง/gate ที่พังซ้ำให้เห็น error จริงกับตา — ห้ามแก้จาก error message ที่คนอื่นเล่าต่อ
- จด: คำสั่งที่ใช้ · exit code · ข้อความ error เต็ม · จอ/route ที่เกี่ยว (ถ้าเป็น UI)
- reproduce ไม่ได้ = ยังไม่มีบั๊กให้แก้ → บันทึกสิ่งที่ลองไว้ใน journal แล้วกลับไปทำ task

### 2) เก็บหลักฐาน (evidence ก่อน hypothesis)

- ใช้ subagent **`log-reader`** รวบรวม log ที่เกี่ยว: docker compose logs · ผล vitest/playwright ·
  CI run · `agents/journal/*` รอบก่อนหน้า — ขอเป็นสรุป + บรรทัด error ที่อ้างอิงได้
- expected behavior ไม่ชัด → ถาม subagent **`spec-scout`** (ตอบจาก pototype/extract/handoff เท่านั้น)
  **ห้ามอนุมาน expected จากโค้ด implementation**
- UI ไม่ตรง design → เทียบ `tests/visual/reference/` + เปิด `pototype/Juneflow Fiori.html` จอเดียวกัน

### 3) Localize + ตั้งสมมติฐาน

- ระบุจุดพังให้แคบสุด: package ไหน / ไฟล์ไหน / ชั้นไหน (schema · API · UI · seed · config)
- เขียนสมมติฐานหนึ่งประโยค: "พังเพราะ X — พิสูจน์ได้ถ้า Y" แล้วพิสูจน์ก่อนแก้
- ต้นเหตุอยู่นอกเขตตัวเอง → **หยุด** เขียน `BLOCKERS.md` (ระบุ task, หลักฐาน, เขตที่ต้องแก้) แล้วข้าม

### 4) แก้แบบแคบที่สุด

- แก้ที่ต้นเหตุ ไม่แก้ที่อาการ · หนึ่งสมมติฐาน = หนึ่งการแก้ · ห้ามแถม refactor/แต่งจอในรอบ debug
- ห้ามแก้ expected ของ test ให้ตรง implementation — expected มาจาก spec (tests/CLAUDE.md)
- ห้ามลอกกลไก mock จาก pototype มา "ซ่อม" จอ (PLAN.md §0 กฎข้อ 3)

### 5) ยืนยันผล + ปิดรอบ

- รัน gate ที่แดงซ้ำ → เขียวจริงจึงไปต่อ (`.claude/skills/run-gates`) · ระวังแก้แล้วพังจอ/gate อื่น
- ยังแดง → กลับข้อ 2 พร้อมหลักฐานใหม่ (นับเป็นรอบแก้) · **ครบ 3 รอบยังแดง** → หยุดตาม PLAN.md §10:
  บันทึกสิ่งที่รู้ทั้งหมดลง journal + `BLOCKERS.md` (ถ้าติด spec) แล้วข้ามไป task อื่น
- ปิดท้ายเสมอ: บันทึก root cause + วิธีแก้ + หลักฐานลง `agents/journal/<agent>.md`

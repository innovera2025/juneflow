# tests/visual/ — Visual gate harness (Gate G5)

> เขต QA — อ่าน `tests/CLAUDE.md` + ราก `CLAUDE.md` + `PLAN.md` §0 (Design Fidelity Protocol) ก่อนเริ่มงานทุกครั้ง

## กติกา visual gate (นิยามการ "ตรง Design" — PLAN.md §0)

- ทุกจอที่สร้างต้อง screenshot เทียบภาพอ้างอิงใน `tests/visual/reference/`
- สิ่งที่ต้องตรง: **โครงเลย์เอาต์ · ลำดับ/ป้ายเมนูและคอลัมน์ · token สี · ตำแหน่ง KPI/ปุ่ม/แท็บ**
- ต่างได้เฉพาะ: **ตัวเลขข้อมูล (มาจาก seed)** และสิ่งที่ Wei อนุมัติผ่าน `BLOCKERS.md`
- **จอที่ไม่มีภาพอ้างอิง → เปิด `pototype/Juneflow Fiori.html` จอเดียวกัน แคปเป็น reference ก่อนเริ่มสร้าง**

## reference/ (ความจริงของ visual gate)

- ก๊อปจาก `pototype/gallery/g1–g5` (**106 .jpg — ใช้ทั้งหมด** ดู B-001) + `pototype/shots/` (22 .png) ผ่าน `scripts/copy-references` (P0-BE-03)
- **ห้ามแก้/ลบ/เขียนทับไฟล์ใดๆ ใน `reference/`** — ไฟล์ต้นทางใน `pototype/` ก็ห้ามแตะเช่นกัน
- index ภาพ→จอ/route (จาก `docs/extract/NAV-ROUTES.md`) อยู่ที่ `tests/visual/reference-index.md` — P0-QA-01

## สถานะ

- **TODO(P0-QA-04):** implement screenshot-comparison specs + รายงาน diff ที่อ่านได้ (รอ P0-QA-01) — หมายเหตุ: `toHaveScreenshot()` เทียบ .png เท่านั้น แต่ reference จาก gallery เป็น .jpg 106 ไฟล์ → ขั้น comparison ต้องรองรับ jpg (แปลงตอนรัน หรือ custom matcher) โดย**ห้ามแตะไฟล์ต้นฉบับใน `reference/`**
- config: `playwright.visual.config.ts` — snapshot expectations ชี้ที่ `reference/`
- รัน: `pnpm --filter @juneflow/tests test:visual` — ตอนนี้ยังไม่มี test = ผ่านเขียวด้วย `--pass-with-no-tests` (ตั้งใจ ให้ CI เขียวระหว่าง scaffold)

## Gate ที่เกี่ยวข้อง (PLAN.md §9)

- **G5 — Visual gate:** screenshot เทียบ reference ใน `tests/visual/reference/` ตาม §0 · ขาด G5 = ไม่ done

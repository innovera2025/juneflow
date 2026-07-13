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

## สถานะ (P0-QA-04 — harness implemented)

- **harness:** `visual-gate.spec.ts` + `lib/compare.ts` (jpg-aware compare) + `lib/report.ts` (readable diff report) · config: `playwright.visual.config.ts`
- **รองรับ jpg โดยไม่แตะ reference:** `toHaveScreenshot()` เทียบ .png เท่านั้น แต่ 106/128 reference เป็น .jpg → `lib/compare.ts` decode ทั้ง jpg + png ด้วย chromium ที่ Playwright ใช้อยู่แล้ว (ไม่เพิ่ม native dep) แล้ว pixel-diff ในเบราว์เซอร์ · **อ่านไฟล์ `reference/` อย่างเดียว ห้ามเขียนทับ**
- **สองโหมด:**
  - `self-check` — รันได้ทันที ไม่ต้องมีแอป: พิสูจน์ pipeline (decode → diff → report) กับ reference จริง (identical=PASS 0 diff · perturbed=FAIL · size mismatch=auto-FAIL) — นี่คือหลักฐาน "G5 harness รันได้ + รายงาน diff อ่านได้" ก่อน apps/web จะมี
  - `capture` — screenshot จริงเทียบ reference ตาม `screens.manifest.json` (ยังว่างจนกว่าจอ apps/web จะมา · map route→ref อยู่ที่ `reference-index.md`) · **skip** (ไม่ fail) เมื่อ manifest ว่าง หรือ `VISUAL_BASE_URL` ไม่ถึง → gate เขียวระหว่าง scaffold
- **รายงาน diff:** `.results/visual-report.md` + `.results/visual-report.json` + `.results/diff/*.png` (gitignored — ไม่อยู่ใน `reference/`)
- **threshold เริ่ม strict** (`VISUAL_MAX_DIFF_PIXEL_RATIO=0`, `VISUAL_CHANNEL_THRESHOLD=0`) — การผ่อน threshold สำหรับ jpg lossy ของจอจริง = คำตัดสินของ Wei/BLOCKERS ไม่ใช่ default เงียบ ๆ (skill `visual-gate` กฎเหล็ก)
- **Mask regions (P0-QA-07 · B-044):** ยกเว้นเฉพาะสี่เหลี่ยมที่ Wei อนุมัติจากการนับ diff — **opt-in ต่อจอ** ผ่าน field `masks` ใน `screens.manifest.json` (คีย์จาก `lib/masks.ts` `MASK_REGISTRY`) · ทุก region ต้องมี `reason` อ้าง id ใน `BLOCKERS.md` (บังคับ runtime — ไม่มี citation = throw) · ไม่ใช่การผ่อน threshold ทั่วไป · **dimension mismatch ยัง auto-FAIL เสมอ** (mask ช่วยไม่ได้ — P0-FIX-04 คงเดิม) · จำนวน masked px + จำนวนที่ต่างจริงในนั้นถูกรายงานใน `visual-report.md` (คอลัมน์ `masked px`) และย้อมน้ำเงินใน diff PNG
  - mask ปัจจุบัน: `sidebar-logo-b044` = กล่องโลโก้ sidebar (wordmark + tagline) rect x8 y6 w224 h56 — วัดจาก `reference/gallery/g1/01-s.jpg` (1600x1000: lockup x16..124 y16..55 · เส้นแบ่ง y64 · ปุ่ม toggle y≈69) — reference ทุกใบเป็น logo lockup รุ่นเก่า (`juneflow / Construction ERP`) ส่วน port ใช้ `t("app.name")` th=`ระบบงานก่อสร้าง` (B-044(ก) Wei ตัดสิน 13 ก.ค.) · จอที่ไม่มี sidebar lockup (เช่น login — P1-WEB-01) **ห้ามใส่** mask นี้
- **รัน:** `pnpm --filter @juneflow/tests test:visual`

## Gate ที่เกี่ยวข้อง (PLAN.md §9)

- **G5 — Visual gate:** screenshot เทียบ reference ใน `tests/visual/reference/` ตาม §0 · ขาด G5 = ไม่ done

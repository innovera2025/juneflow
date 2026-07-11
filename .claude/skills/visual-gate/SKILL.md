---
name: visual-gate
description: Run the Visual Gate (G5 - PLAN.md §0 + §9) - build/run the app, screenshot every changed screen with Playwright, compare against tests/visual/reference/ (106 gallery .jpg + 22 shots .png, never modified), capture a prototype reference first for screens without one, and record a per-screen verdict in REVIEW-QUEUE.md. Trigger keywords - visual gate, G5, screenshot compare, เทียบภาพ, เทียบ gallery, ตรง design, reference image, ภาพอ้างอิง, pixel diff, Playwright visual.
---

# visual-gate — ด่าน Visual Gate (G5 · PLAN.md §0 + §9)

> นิยามการ "ตรง Design": ทุกจอที่สร้าง/แก้ ต้อง screenshot เทียบภาพอ้างอิงใน `tests/visual/reference/` — ขาด G5 = **ไม่ done**
> config harness: `tests/visual/playwright.visual.config.ts` (เขต QA — P0-QA-04) · index ภาพ→จอ/route: `tests/visual/reference-index.md` (P0-QA-01)

## ขั้นตอน (ทำตามลำดับ)

### 1) build + run แอป

- รันระบบให้จอขึ้นจริงด้วยวิธีใดวิธีหนึ่ง:
  - stack เต็ม: `docker compose -f infra/docker-compose.yml up -d --wait` (pg16 + redis + api + web + worker · seed อัตโนมัติผ่าน service `migrate-seed`)
  - เฉพาะ web dev: `pnpm dev` (ต้องมี API + seed พร้อม เพราะข้อมูลบนจอต้องมาจาก central seed)
- base URL ของ harness: env `VISUAL_BASE_URL` (default `http://localhost:5173`)

### 2) screenshot ทุกจอที่เปลี่ยน

- ระบุรายการจอที่ diff ของ task นี้แตะ (route id จาก `docs/extract/NAV-ROUTES.md`)
- แคปด้วย Playwright ผ่าน harness: `pnpm --filter @juneflow/tests test:visual` (config: `tests/visual/playwright.visual.config.ts`)
- หา reference คู่เทียบของแต่ละจอจาก `tests/visual/reference-index.md` — ถ้า index ยังไม่ครอบคลุมจอนั้น ให้ไล่หาใน `tests/visual/reference/gallery/g1–g5` + `tests/visual/reference/shots/` เอง

### 3) เทียบกับ `tests/visual/reference/`

- reference pack = ก๊อปจาก `pototype/gallery/g1–g5` (**106 .jpg — ใช้ทั้งหมด** ตาม B-001) + `pototype/shots/` (22 .png) ผ่าน `scripts/copy-references.sh`
- **ห้ามแก้/ลบ/เขียนทับไฟล์ใดๆ ใน `reference/`** — เป็น ground truth ของ gate · ไฟล์ต้นทางใน `pototype/` ก็ห้ามแตะเช่นกัน
- หมายเหตุเทคนิค: `toHaveScreenshot()` เทียบ .png เท่านั้น — reference จาก gallery เป็น .jpg → ขั้น comparison ต้องรองรับ jpg (แปลงตอนรัน/custom matcher) **โดยไม่แตะไฟล์ต้นฉบับ**

**เกณฑ์เทียบ (PLAN.md §0) — ต้องตรงทั้งหมด:**

| ต้องตรง | ต่างได้ |
|---|---|
| โครงเลย์เอาต์ | ตัวเลขข้อมูล (มาจาก central seed) เท่านั้น |
| ลำดับ + ป้ายเมนูและคอลัมน์ | สิ่งที่ Wei อนุมัติแล้วผ่าน `BLOCKERS.md` เท่านั้น |
| token สี (จาก `packages/tokens`) | |
| ตำแหน่ง KPI / ปุ่ม / แท็บ | |

### 4) จอที่ไม่มีภาพอ้างอิง → แคป reference จาก pototype ก่อน

1. **ก่อนเริ่มสร้างจอ** เปิด `pototype/Juneflow Fiori.html` navigate ไปจอเดียวกัน แล้วแคปเป็นภาพอ้างอิง (PLAN.md §0)
2. บันทึกเป็น**ไฟล์ใหม่**ใน `tests/visual/reference/` — **เพิ่มได้อย่างเดียว ห้ามเขียนทับ/ลบ/แก้ไฟล์เดิม** (106 .jpg + 22 .png เดิมแตะไม่ได้) · ตั้งชื่อไฟล์ตาม route id ให้ตามรอยได้
3. **reference ใหม่ต้องผ่าน review — ห้ามเพิ่มเงียบๆ:** ระบุ path ไฟล์ reference ใหม่ในแถว `REVIEW-QUEUE.md` ของ task พร้อมป้าย `NEW-REF` ให้ Wei ตรวจว่ายอมรับเป็น ground truth หรือไม่
4. ถ้า hook `protect-files.sh` บล็อกการเขียน (exit code 2) → เขียน `BLOCKERS.md` รอ Wei อนุมัติ — **ห้าม bypass**

### 5) ตัดสินผลต่อจอ + บันทึกลง REVIEW-QUEUE

- ตัดสินทีละจอ: **ผ่าน** (ตรงตามเกณฑ์ ต่างเฉพาะตัวเลข seed) / **ไม่ผ่าน** (ระบุรายการที่ต่าง: เลย์เอาต์/ป้าย/สี/ตำแหน่ง)
- จอไม่ผ่าน = gate แดง → กลับไปแก้จอ (นับรอบแก้ตามเพดาน 3 รอบของ skill `loop-task`) — **ห้ามแก้ reference ให้ตรงกับจอ**
- จอผ่านครบแล้ว → กรอกคอลัมน์ **ภาพเทียบ gallery** ในแถว `REVIEW-QUEUE.md` ของ task รูปแบบต่อจอ:

```
<route id>: shot=<path screenshot ที่แคป> ↔ ref=tests/visual/reference/<path> → ผ่าน
<route id>: shot=<path> ↔ ref=<path NEW-REF ที่เสนอ> → ผ่าน (NEW-REF รอ Wei ตรวจ)
```

- งานที่ไม่มีจอ (schema/script/config) → ช่องภาพใส่ `—` พร้อมหลักฐาน gate ที่ใช้แทน (ดู skill `run-gates`)

## กฎเหล็กของด่านนี้

- **ห้ามลด threshold / เพิ่ม mask เพื่อให้ผ่าน** — mask/threshold ปรับได้เฉพาะผ่านเขต QA + การอนุมัติของ Wei (เริ่มที่ strict: `maxDiffPixelRatio: 0`)
- ความต่างที่คิดว่า "จงใจ/ดีกว่าเดิม" ไม่มีสิทธิ์ตัดสินเอง → `BLOCKERS.md` (PLAN.md §0 กฎข้อ 4)
- ปิด stack หลังจบ (ถ้าเปิดด้วย compose): `docker compose -f infra/docker-compose.yml down`

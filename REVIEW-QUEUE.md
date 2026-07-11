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
| P0-INT-05 | tax-engine | merged to dev `394eb18` (docs: `packages/tax-engine/docs/tax-forms-map.md`) — **ด่าน 4.5 PASS** (8/8 + fidelity spot-check ~40 จุด · notes: ป้ายย่อ 3 จุดใน map ให้ยึด .jsx เป็นแหล่งจริง · promptpayId render เสมอ · B-007) | — (docs-only · หลักฐาน gate = coverage checklist ครบ 3 ฟอร์ม A/B/C + shared primitives, เทียบ `pototype/tax-forms.jsx` L1–727) | 2026-07-12 |
| P0-BE-01 | monorepo scaffold + CI tooling (platform) | merged to dev (branch `feature/backend`) — **ด่าน 4.5 PASS** (reviewer รัน gates ซ้ำเอง: lint+typecheck 11/11 · build 5/5 · note: 3 แพ็กเกจเขต integrations ยังเป็น placeholder echo — เจ้าของคือ P0-INT-01/02/03) | — (ไม่มีจอ) · หลักฐาน gate: `pnpm run lint` ✓ · `pnpm run typecheck` ✓ · `pnpm run build` ✓ ครบ 10 workspaces (dev green from day one) | 2026-07-12 |
| P0-QA-01 | qa · visual-gate | merged to dev @ `006fbf0` — **ด่าน 4.5 PASS** (reviewer ตรวจเอง: index ↔ ดิสก์ exact 128/128 · route 103/103 ตรง NAV-ROUTES) | — (งาน index ไม่มีจอ · หลักฐาน: `tests/visual/reference-index.md` 128 แถว = 106 .jpg + 22 .png · นับไฟล์ตรงเกณฑ์ B-001) | 2026-07-12 |
| P0-QA-06 | qa · seed fixture assertions (REWORK) | commit บน `feature/qa` (รอ loop-runner push→ด่าน 4.5) — แก้ 3 จุดที่ด่าน 4.5 FAIL 12 ก.ค.: **C1** Package 3→**4** (`pkg-builder.jsx PKG_STORE` + PACKAGE-RULES §1) · **C9** JV lines ออกจากกลุ่ม expected-0 → assert สมดุล DR=CR (JV 7 ใบ ≥14 บรรทัด) · **B-009** Unit/SalesUnit ถอดออกจาก expected-0 → `it.todo` ผูก B-009 (ไม่ล็อกค่า) | — (test spec ไม่มีจอ · หลักฐาน: `tests/seed/` · `vitest run seed` = **91 passed \| 2 todo** เขียว · expected ถอดจาก §สรุป + ยึด ภาคผนวก C เมื่อขัด · Unit persist ค้าง B-009 ไม่เดา) | 2026-07-12 |
| P0-QA-04 | qa · visual-gate harness (G5) | commit บน `feature/qa` (รอ loop-runner push→ด่าน 4.5) — harness `tests/visual/visual-gate.spec.ts` + `lib/compare.ts` (jpg-aware decode ผ่าน chromium — ไม่เพิ่ม native dep) + `lib/report.ts` (worker-safe: part files → globalTeardown consolidate) · **อ่าน `reference/` อย่างเดียว ไม่แตะ** | — (harness · ยังไม่มีจอจริง apps/web) · หลักฐาน gate = **G5 harness รันได้ + รายงาน diff อ่านได้**: `pnpm --filter @juneflow/tests test:visual` = **3 passed \| 1 skipped** (self-check: identical=PASS 0 diff · perturbed=FAIL 2500px · size-mismatch=auto-FAIL) → รายงาน `tests/visual/.results/visual-report.md` (gitignored) · capture mode skip จน `screens.manifest.json` มีจอ + `VISUAL_BASE_URL` ถึง · threshold strict=0 (ผ่อนสำหรับ jpg lossy = คำตัดสิน Wei/BLOCKERS) | 2026-07-12 |
| P0-QA-05 | qa · unit G3 | merged to dev @ `b81528c` — **ด่าน 4.5 PASS** (reviewer รันซ้ำ 48/48 เขียว · C2/C3/C5/C9 ตรง · note: transition `rejected→draft` ใน approval-matrix เป็นการต่อยอดเล็กจาก Global rule #4 — ให้ Wei เห็นตอน review) | — (test spec ไม่มีจอ · หลักฐาน: `tests/unit/` 6 ไฟล์ · `vitest run unit` = 48 tests เขียว · expected ถอดจาก spec ล้วน · posting account mapping/approval thresholds ค้าง Open Q #3/#2 ทำ `describe.todo` ไม่เดา) | 2026-07-12 |

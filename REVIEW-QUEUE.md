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
| P0-INT-03 | notifications | commit `a286d53` บน `feature/integrations` — wire real lint/typecheck/test scripts (เลิก echo placeholder, เอา build echo ออกให้ตรง tax-engine/bank-file) + `tsconfig.json` + **18 unit tests** (`src/adapters/notifications.test.ts`, `describe.each` 3 channels) สำหรับ `NotificationAdapter` interface + `Fake*`/`*NotificationAdapter` (line/email/webpush). lockfile +3 บรรทัด (vitest importer ของ notifications — แพตเทิร์นเดียวกับ P0-INT-01/02) — **ด่าน 4.5 PASS** (sacred ✓ · zone: lockfile +3 importer ยอมรับได้เชิงกลไก · ไม่มี UI/token/re-translate · payload เป็น i18n-key opaque fixture · fake ไม่ปน production (index.ts export เฉพาะ interface/types) · skeleton reject `/not implemented/` · ไม่แตะ C1–C10 · 18 tests คลุม conformance + fake output + determinism + skeleton reject ครบ 3 channels · bookkeeping สอดคล้อง) | — (ไม่มีจอ · package logic) · หลักฐาน gate: `pnpm --filter @juneflow/notifications test` = 18/18 pass (G3 fake adapter: channel id · sent + messageId keyed on recipient · error undefined · byte-identical determinism · skeleton channel id + reject) · root `typecheck` 6/6 · lint 5/5 · test 6/6 (CI ขั้นต่ำเขียว) | 2026-07-12 |
| P0-INT-02 | bank-file | commit `ee7e9b7` บน `feature/integrations` — wire real lint/typecheck/test scripts (เลิก echo placeholder) + `tsconfig.json` + **8 unit tests** (`src/kbank-direct/kbank-direct.test.ts`) สำหรับ `BankFileFormatter` interface + `FakeBankFileFormatter`/`KBankDirectFormatter`. lockfile +3 บรรทัด (vitest importer ของ bank-file — แพตเทิร์นเดียวกับ P0-INT-01) — **ด่าน 4.5 PASS** (sacred ✓ · zone: lockfile +3 importer ยอมรับได้เชิงกลไก · ไม่แตะ C1–C10 · Money มี currencyCode ตาม §4 · fake ไม่ปน production · skeleton reject `/not implemented/` · 8 tests คลุม fake output layout + empty batch + determinism ครบ · bookkeeping สอดคล้อง) | — (ไม่มีจอ · package logic) · หลักฐาน gate: `pnpm --filter @juneflow/bank-file test` = 8/8 pass (G3 fake adapter: header/detail/trailer · missing reference → empty field · filename+encoding · empty-batch zero trailer · byte-identical determinism · skeleton format-id + reject) · root `typecheck` 6/6 (FULL TURBO) · lint 5/5 (CI ขั้นต่ำเขียว) | 2026-07-12 |
| P0-INT-01 | tax-engine | commit `e2d0b35` บน `feature/integrations` — wire real lint/typecheck/test scripts (เลิก echo placeholder) + tsconfig + **17 unit tests** (`src/thailand/thailand.test.ts`) สำหรับ `TaxEngine` interface + `FakeTaxEngine`/`ThailandTaxEngine`. lockfile +3 บรรทัด (vitest importer ของ tax-engine เท่านั้น — resolved อยู่แล้วในคิว tests) — **ด่าน 4.5 PASS** (sacred ✓ · zone: lockfile +3 importer ยอมรับได้เชิงกลไก · C4 สะท้อนตรง ไม่ตีความใหม่ · mock ไม่ปน production · 17 tests คลุม logic ครบ · bookkeeping สอดคล้อง) | — (ไม่มีจอ · package logic) · หลักฐาน gate: `pnpm --filter @juneflow/tax-engine test` = 17/17 pass (G3 fake adapter: calcWht/calcVat inclusive+exclusive · e-Tax lifecycle C4 queued→sent+void · renderRdForm placeholder · skeleton rejects) · root `typecheck` 6/6 · `build` 4/4 (CI ขั้นต่ำเขียว) | 2026-07-12 |
| P0-INT-05 | tax-engine | merged to dev `394eb18` (docs: `packages/tax-engine/docs/tax-forms-map.md`) — **ด่าน 4.5 PASS** (8/8 + fidelity spot-check ~40 จุด · notes: ป้ายย่อ 3 จุดใน map ให้ยึด .jsx เป็นแหล่งจริง · promptpayId render เสมอ · B-007) | — (docs-only · หลักฐาน gate = coverage checklist ครบ 3 ฟอร์ม A/B/C + shared primitives, เทียบ `pototype/tax-forms.jsx` L1–727) | 2026-07-12 |
| P0-BE-01 | monorepo scaffold + CI tooling (platform) | merged to dev (branch `feature/backend`) — **ด่าน 4.5 PASS** (reviewer รัน gates ซ้ำเอง: lint+typecheck 11/11 · build 5/5 · note: 3 แพ็กเกจเขต integrations ยังเป็น placeholder echo — เจ้าของคือ P0-INT-01/02/03) | — (ไม่มีจอ) · หลักฐาน gate: `pnpm run lint` ✓ · `pnpm run typecheck` ✓ · `pnpm run build` ✓ ครบ 10 workspaces (dev green from day one) | 2026-07-12 |
| P0-QA-01 | qa · visual-gate | merged to dev @ `006fbf0` — **ด่าน 4.5 PASS** (reviewer ตรวจเอง: index ↔ ดิสก์ exact 128/128 · route 103/103 ตรง NAV-ROUTES) | — (งาน index ไม่มีจอ · หลักฐาน: `tests/visual/reference-index.md` 128 แถว = 106 .jpg + 22 .png · นับไฟล์ตรงเกณฑ์ B-001) | 2026-07-12 |
| P0-QA-05 | qa · unit G3 | merged to dev @ `b81528c` — **ด่าน 4.5 PASS** (reviewer รันซ้ำ 48/48 เขียว · C2/C3/C5/C9 ตรง · note: transition `rejected→draft` ใน approval-matrix เป็นการต่อยอดเล็กจาก Global rule #4 — ให้ Wei เห็นตอน review) | — (test spec ไม่มีจอ · หลักฐาน: `tests/unit/` 6 ไฟล์ · `vitest run unit` = 48 tests เขียว · expected ถอดจาก spec ล้วน · posting account mapping/approval thresholds ค้าง Open Q #3/#2 ทำ `describe.todo` ไม่เดา) | 2026-07-12 |

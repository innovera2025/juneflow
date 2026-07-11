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
| P0-BE-06 | packages/db — Platform/Tenant schema (Drizzle) | commit `d2a65cf` on `feature/backend` — **ด่าน 4.5 PASS** (schema fidelity vs data-dictionary "Platform / Tenant" 7 entities ครบ · uuid PK / real *_id FK / UTC timestamptz / currency_code / C5 keys · circular company↔subscription FK handled) | — (schema-only, ไม่มีจอ) · หลักฐาน gate G1(บางส่วน)+migration check: `pnpm --dir packages/db typecheck` ✓ · workspace typecheck 6/6 ✓ · `drizzle-kit check` "Everything's fine" ✓ (migration `0000_flashy_eddie_brock.sql`, 7 tables) | 2026-07-12 |

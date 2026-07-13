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
| P0-DEV-06 | devops · infra/docker-compose.yml — BETTER_AUTH_SECRET dev-default (B-038ก) | commit `10171ea` (feature/devops→dev merge `4b7ead3`) — เพิ่ม `BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:-juneflow-dev-secret}` ใน api+worker (mirror POSTGRES_PASSWORD) · prod compose fail-fast ไม่แตะ · self gate-4.5: sacred untouched · zone infra ล้วน · ไม่มี secret literal (dev-default placeholder) | — (infra config · ไม่มีจอ) · หลักฐาน: `docker compose config` = CONFIG_OK · api boot ได้เมื่อ compose up (ปลด P1-BE-01 fail-fast) | 2026-07-13 |
| P0-QA-07 | qa · tests/visual — logo-region mask ใน visual gate (B-044ก) | feature/qa — `lib/compare.ts` เพิ่ม `maskRegions` (opt-in ต่อ region · `reason` ต้องอ้าง B-xxx ไม่งั้น throw · ไม่ใช่การผ่อน threshold) + `lib/masks.ts` registry `sidebar-logo-b044` + manifest field `masks` ต่อจอ (login P1-WEB-01 ไม่ใส่) · dimensionMismatch auto-FAIL ไม่แตะ (P0-FIX-04) · reference อ่านอย่างเดียว | — (harness · ไม่มีจอใหม่) · หลักฐาน: mask rect **x8 y6 w224 h56** วัดจาก `reference/gallery/g1/01-s.jpg` (1600x1000 — lockup bbox x16..124 y16..55 · icon x16..49 y15..50 · wordmark x60..119 y21..33 · tagline x60..124 y35..54 · divider y64 · toggle y≈69 → mask จบ y61 ไม่โดนแถวเมนู/ปุ่มด้านล่าง) · test:visual **9 passed** (self-check เดิม 4 เขียว + mask 5: inside-only=PASS/masked 12544 px มี 3600 diff รายงานครบ · inside+outside=FAIL · size-mismatch+mask=FAIL · no-citation=throw · unknown-key=throw) · turbo typecheck/lint 19/19 · tsc strict harness exit 0 | 2026-07-13 |

> ✅ **batch #2 (46 งาน) promoted → `main` `1eb2ecb` เมื่อ 2026-07-13** — Phase 0 ครบ + P1 login · audit อิสระ 0 defects (sacred integrity · migration 0000-0008 · gates 28/29 · api 81/web 24 · seed 113/113) · queue เคลียร์
> แถวใหม่จะสะสมเมื่อมีงาน merge เข้า `dev` รอบถัดไป (WEB-05 shell · DEV-06 secret กำลังจะเดิน)

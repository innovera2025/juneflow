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
| P0-PLAT-03 | platform · i18n-full.json 2 สำเนา — B-039(ก-ปรับ) key fill (SACRED_OVERRIDE=wei-approved:B-039) | commit `f1ff477` (feature/platform · รอ orchestrator gate 4.5 + merge) — **nav_i18n +15** (112→127 · 15 nav label จาก chrome.jsx NAV) · **phrases +26** (736→762 · chrome strings จาก chrome.jsx/shell.jsx) · ทุก entry th verbatim (script cross-verify 41/41 พบใน pototype source) · en/zh/ar = ไทยเดิม (B-035 pattern · tn() fallback i18n.jsx:314) · 9 string ที่มีคำแปลจริงอยู่แล้วไม่แตะ · `บันทึกการใช้งาน` = Thai-in-all-langs (ไม่ก๊อป nav.audit dict) · diff append-only 205 บรรทัด/สำเนา · `notifEmpty` ไม่มีใน prototype → **B-045** (ไม่เติม · ไม่ block) | — (data file · ไม่มีจอ) · หลักฐาน: `cmp` 2 สำเนา byte-identical ✓ · i18n test **19/19** (15 เดิม + 4 ใหม่ th-verbatim ทั้ง 4 ภาษา + no-overwrite guard) · turbo lint/typecheck/build 21/21 · `pnpm install --frozen-lockfile` ✓ | 2026-07-13 |

> ✅ **batch #2 (46 งาน) promoted → `main` `1eb2ecb` เมื่อ 2026-07-13** — Phase 0 ครบ + P1 login · audit อิสระ 0 defects (sacred integrity · migration 0000-0008 · gates 28/29 · api 81/web 24 · seed 113/113) · queue เคลียร์
> แถวใหม่จะสะสมเมื่อมีงาน merge เข้า `dev` รอบถัดไป (WEB-05 shell · DEV-06 secret กำลังจะเดิน)

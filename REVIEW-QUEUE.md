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
| P1-BE-12 | backend · docnum `locked` boolean→text enum-code (B-067 · ไม่แตะ openapi Entity-opaque) | commit `395ad78`+`596a9f7` feature/backend — **migration 0013_high_anthem ALTER-only** (hand-CASE `USING (CASE WHEN locked THEN 'all' ELSE 'none' END)` · 0000-0012 byte-identical · drizzle check clean) · schema locked→text default none · re-seed 10 codes (PR=dept/PO=all/WO=all/GR=all/RT=none/BOQ=all/PT=none/TR=warehouse/IS=warehouse/JV=all verbatim §B-067) · route comment · **+3 i18n keys orch-A direct-apply** (docnum.lockAll/lockWarehouse/fmtYear · verbatim master.jsx · dict+3) | — (schema/API/data · ไม่มีจอ) · หลักฐาน: **api 182/182** · drizzle check clean · **live PG16 disposable: migrate 0000-0013 + USING-cast บน boolean จริง + seed×2 idempotent (all=5/dept=1/warehouse=2/none=2)** · i18n 19/19 · cmp identical · gate-4.5 inline orch-A | 2026-07-15 |
| P1-DEV-08 | devops · infra/docker-compose.prod.yml — prod boot fix (B-055) | commit `834b1af` feature/devops — env key `AUTH_SECRET`→`BETTER_AUTH_SECRET` ทั้ง api+worker (mirror dev · คง fail-fast `${VAR:?set on host}` ไม่เพิ่ม default) · dev compose ไม่แตะ · **แก้ prod ที่ api อ่าน BETTER_AUTH_SECRET ไม่เจอ → boot ไม่ขึ้น** | — (infra config · ไม่มีจอ) · หลักฐาน: `docker compose -f infra/docker-compose.prod.yml config` = exit 0 (vars set) · BETTER_AUTH_SECRET wired api+worker · ไม่มี AUTH_SECRET ค้าง · gate-4.5 inline orch-A (zone infra ล้วน · sacred .github ไม่แตะ) | 2026-07-15 |
| P1-WEB-15 | web (ui infra) | feature/web (pending orch gate-4.5 + merge) | **— NO G5 (charts primitive = infra ไม่ใช่ screen · ไม่มี gallery ref)** · หลักฐาน gate แทน: typecheck 0 · vite build 242 mod ✓ (chart.js ^4.5.1 tree-shaken จาก app bundle — consumer dashboard B-049 ยัง defer · proven bundles ผ่าน lib-probe = 241kB มี chart.js internals) · vitest 134/134 incl. 12 chart tests (chartTheme token+fallback · baseChartOpts themed+merge · createThemedChart mount/unmount/rebuild via chart.js mock · ChartCanvas SSR render) · dashboard prereq (B-049) | 2026-07-15 |

> ✅ **batch #4 (9 งาน) promoted → `main` `433dda5` เมื่อ 2026-07-15** — master wave web 6/7 (WEB-08 company/09 project/10 ptype/11 cc/13 model/14 users · recon-first + residual keys B-054/057/063/064/068 + §9) + MOB-02 (Dart §6) + PLAT-04 (§9 i18n 91 keys) + BE-11 (cc/docnum schema · migration 0012) · gate-4.5 + G5 PASS ทุก task · promote `git merge --squash -X theirs 1bbcaba` = main tree == dev 0 diff · queue เคลียร์ · **WEB-12 docnum ยัง blocked B-067 (backend lock column)**
> ✅ **batch #3 (21 งาน) promoted → `main` `43e0b70` เมื่อ 2026-07-14** — sacred rounds 4 (i18n §1/§5/§7/§8 + envelope B-014 + contract §4/§6) · routes 6 · shell 5b · Dart regen · audit อิสระ 14-agent = 0 blocker (main tree == fde14e6 เป๊ะ · diff ว่าง) · queue เคลียร์ · **batch #4 เริ่มสะสมจาก WEB-08 (master.company กำลัง port)**
> ✅ **batch #2 (46 งาน) promoted → `main` `1eb2ecb` เมื่อ 2026-07-13** — Phase 0 ครบ + P1 login · audit อิสระ 0 defects (sacred integrity · migration 0000-0008 · gates 28/29 · api 81/web 24 · seed 113/113) · queue เคลียร์
> แถวใหม่จะสะสมเมื่อมีงาน merge เข้า `dev` รอบถัดไป (WEB-05 shell · DEV-06 secret กำลังจะเดิน)

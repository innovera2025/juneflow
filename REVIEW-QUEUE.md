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
| P1-BE-02 | backend · GET /counts (B-040ก · openapi.yaml SACRED_OVERRIDE=wei-approved:B-040) | commit `74dde26` feature/backend — /counts?keys= → Counts (9 nav id enum · 401 ref · 400 flat) + TenantDb.selectThrough (scoped join door: fail-closed empty-path/unscoped-root) + semantics ตาม flows.html (journal มีคำอธิบายราย key) | — (endpoint · ไม่มีจอ) · หลักฐาน: api vitest 96/96 (ณ commit) · G2 live compose: /counts 9 key = {boq:1, boq.approval:1, pr.list:3, accept:3, pm.wo:6, gl.inbox:9, sales:5, sales.crm:10, sales.service:5} · unknown key→400 `INVALID_COUNT_KEY` · contract 422/422 (live 401 probe รวม op ใหม่) · turbo 21/21 | 2026-07-13 |
| P1-BE-03 | backend · GET /companies + Project ext + เครือ seed (B-041ก+ · openapi.yaml SACRED_OVERRIDE=wei-approved:B-041 · migration 0009) | commit `972f5d1` — /companies → Company[] {id,name,short,color,biz,tax_id,doc_prefix,project_count} · Project +short/color/company_id/units/phases[] (ProjectPhase schema) · migration 0009 additive (project.short/color) drizzle-kit check OK · seed เครือ JF/JE/JC group_parent=CO1 + stamp short/color 7 โครงการ verbatim · **cross-zone แจ้ง QA: company rows 9→12** · **B-045 (ไม่ block): project_count เครือ = 0/0/0 (schema ไม่มี attribution column — mock 4/1/2 รอ Wei เลือก model)** | — (endpoint/schema · ไม่มีจอ) · หลักฐาน: api vitest 102/102 (ณ commit) · G2 live: /companies = 3 แถวเครือ short/color/biz/tax_id/doc_prefix ตรง company-accept.jsx verbatim · /projects: RJP #0B2A4A units=84 · phase p2 units=84 sold_pct=68 · ทุกโครงการมี short/color ตรง chrome.jsx · reseed idempotent (12\|7\|103\|84 คงที่) | 2026-07-13 |
| P1-BE-04 | backend · seed package.menus = NAV id allow-list (B-043ค) | commit `44585ca` — PACKAGES.menus module-key → NAV top-level id ตาม PACKAGE-RULES §2 verbatim (S=6 · M=20 · L=29 · Full="*") · แยก seed packages เป็น `@juneflow/db/seed/packages` ให้ test assert ได้ · **cross-zone note → web (5b wiring): `pkgMenuAllowed(id)` = เช็ค allow-list `/me.package.menus` · dashboard + sub เปิดเสมอ (ไม่อยู่ใน list ก็ต้องแสดง) · `"*"` = เปิดทุกเมนู (PACKAGE-RULES §4) · g1/01 = package M ยืนยันจาก seed (T-1001 = pro/M)** | — (seed · ไม่มีจอ) · หลักฐาน: test ใหม่ 7 (list S/M/L/Full verbatim + accept-in/exec·sales·labor·opex-out + /me passthrough) · suite รวม 109/109 · G2 live: /me.package.menus = 20 NAV id ครบตาม §2 | 2026-07-13 |

> ✅ **batch #2 (46 งาน) promoted → `main` `1eb2ecb` เมื่อ 2026-07-13** — Phase 0 ครบ + P1 login · audit อิสระ 0 defects (sacred integrity · migration 0000-0008 · gates 28/29 · api 81/web 24 · seed 113/113) · queue เคลียร์
> แถวใหม่จะสะสมเมื่อมีงาน merge เข้า `dev` รอบถัดไป (WEB-05 shell · DEV-06 secret กำลังจะเดิน)

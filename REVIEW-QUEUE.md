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

> **BATCH-12 QUEUED (2026-07-19 · orch-A)** — P2-BE-27/28/29 merged to `dev` (hardening close-out) await Wei promote. Prior: — cleared 28 stale-promoted rows (all batch-7/8/9 tasks, already on `main`; verified board 0 review/doing/ready + each task status=done). New rows accumulate below when work merges to `dev` for the next batch (batch-12). The `>` records below are the durable promote history.

| task id | โมดูล | diff | ภาพเทียบ gallery | วันที่ |
|---|---|---|---|---|
| P2-BE-27 | boq/bank authz (B-084 residual) | 2ae9679 feature/backend | — (backend · G3 565 api · boq revise 403 + bank match 403 exploit-regression · gate 4.5) | 2026-07-19 |
| P2-BE-28 | auth (B-099 rate-limit) | 2ae9679 feature/backend | — (backend · G3 565 api · 3 throttle regression tests · gate 4.5) | 2026-07-19 |
| P2-BE-29 | migration 0030 FK-index | 2ae9679 feature/backend | — (schema · G1 live migrate 0000→0030 + seed PG16 · 5 indexes · gate 4.5) | 2026-07-19 |
| P2-BE-30 | auth (B-100 lockout-DoS fix) | 446bda0 feature/backend | — (backend · G3 567 api · 2 B-100 regression tests · gate 4.5) | 2026-07-19 |
| QA-B094-fix | finance-flow SoD spec fix | 5d47092 feature/qa-sod-finance-spec (merged dev d7c2d1d) | — (tests/ · G4 finance-flow 7/7 LIVE PG16 · creator≠approver per Wei B-094-3 · gate 4.5 PASS) | 2026-07-19 |

> ✅ **batch #2 (46 งาน) → `main` `1eb2ecb` (2026-07-13)** — Phase 0 + P1 login · audit 0 defects.
> ✅ **batch #3 (21 งาน) → `main` `43e0b70` (2026-07-14)** — sacred rounds 4 (i18n §1/5/7/8 + envelope B-014 + contract §4/6) · routes/shell/Dart · 14-agent audit 0 blocker.
> ✅ **batch #4 (9 งาน) → `main` `433dda5` (2026-07-15)** — master wave web 6/7 + MOB-02 + PLAT-04 + BE-11 (migration 0012).
> ✅ **batch 5+6 (22 rows) → `main` `244912c` (2026-07-16)** — Phase-2 FLOW-A procurement backend + i18n Wave-1 (dict→1059) + migrations 0012-0017.
> ✅ **batch #7 (12 web ports + FLOW-A data-completeness) → `main` `1b7fbca` (2026-07-17)** — B-082 F1-F4 security + B-084 authz + B-085 hardening + migrations 0024/0025 (FK indexes + TOCTOU) + drizzle 0.45.2 (HIGH vuln cleared).
> ✅ **batch #8 (Wave-2 finance) → `main` `041013a` (2026-07-17 · 0-drift)** — GL/AP/bank web+api + **B-095 packaging fix** (prod boot restored · orch-B caught) + migrations 0026/0027.
> ✅ **batch #9 (MVP-B hardening) → `main` `2051e40` (2026-07-17 · 0-drift)** — bank import/reconcile (B-093) + B-094 3/3 (gl.jv locked-period · bank reverse-unique · PV SoD) + B-084 reject/reconcile/import authz gates · migrations 0028/0029 · adversarial skeptic 6/6 SOUND.
> ✅ **batch #10+11 → `main` `eb88544` (2026-07-17 · 0-drift · pin 4c64ef7)** — B-096 bank hygiene + **B-097 TenantDb transaction door** (atomic multi-write · scope-safe · **live-rollback proven**) + B-098 atomic generate-PR + orch-B audits/finance-E2E · gate-4.5 PASS · closes the B-085-class txn-door loop.

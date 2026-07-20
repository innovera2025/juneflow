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

> **PHASE-4 W3 QUEUED (2026-07-20 · orch-A)** — P2-BE-42 on dev await Wei promote. Prior: **QUEUE EMPTY (2026-07-20 · PHASE-4 Wave-2 backend PROMOTED → main `b35059d` · 0-drift · pin 90dc065)** — P2-BE-40/41 promoted, moved to history. New rows accumulate for the next batch (Wave-2 web / Wave-3). The `>` records below are the durable promote history.

| task id | โมดูล | diff | ภาพเทียบ gallery | วันที่ |
|---|---|---|---|---|
| P2-BE-42 | acceptance-center fan-in (W3) | c681f2a feature/backend (+675d566 sacred pm-enum) | — (backend · G3 736 api · live 4 slices period3/pm6/house4/gr4 · gate 4.5) | 2026-07-20 |

> ✅ **batch #2 (46 งาน) → `main` `1eb2ecb` (2026-07-13)** — Phase 0 + P1 login · audit 0 defects.
> ✅ **batch #3 (21 งาน) → `main` `43e0b70` (2026-07-14)** — sacred rounds 4 (i18n §1/5/7/8 + envelope B-014 + contract §4/6) · routes/shell/Dart · 14-agent audit 0 blocker.
> ✅ **batch #4 (9 งาน) → `main` `433dda5` (2026-07-15)** — master wave web 6/7 + MOB-02 + PLAT-04 + BE-11 (migration 0012).
> ✅ **batch 5+6 (22 rows) → `main` `244912c` (2026-07-16)** — Phase-2 FLOW-A procurement backend + i18n Wave-1 (dict→1059) + migrations 0012-0017.
> ✅ **batch #7 (12 web ports + FLOW-A data-completeness) → `main` `1b7fbca` (2026-07-17)** — B-082 F1-F4 security + B-084 authz + B-085 hardening + migrations 0024/0025 (FK indexes + TOCTOU) + drizzle 0.45.2 (HIGH vuln cleared).
> ✅ **batch #8 (Wave-2 finance) → `main` `041013a` (2026-07-17 · 0-drift)** — GL/AP/bank web+api + **B-095 packaging fix** (prod boot restored · orch-B caught) + migrations 0026/0027.
> ✅ **batch #9 (MVP-B hardening) → `main` `2051e40` (2026-07-17 · 0-drift)** — bank import/reconcile (B-093) + B-094 3/3 (gl.jv locked-period · bank reverse-unique · PV SoD) + B-084 reject/reconcile/import authz gates · migrations 0028/0029 · adversarial skeptic 6/6 SOUND.
> ✅ **batch #10+11 → `main` `eb88544` (2026-07-17 · 0-drift · pin 4c64ef7)** — B-096 bank hygiene + **B-097 TenantDb transaction door** (atomic multi-write · scope-safe · **live-rollback proven**) + B-098 atomic generate-PR + orch-B audits/finance-E2E · gate-4.5 PASS · closes the B-085-class txn-door loop.
> ✅ **batch-12 + B-100 → `main` `a1421bf` (2026-07-19 · 0-drift · pin c7838ac)** — B-084 authz residual (boq /revise MD-lock + bank /match finance.create · **B-084 fully closed**) + B-099 per-user login throttle (fixes office-NAT 429) + **B-100 account-lockout DoS closed** + migration 0030 FK-index + finance-flow SoD spec-fix (**7/7 live**) + group-C Wave-1 spec · orch-B verified (full live E2E green + adversarial skeptic on authz/throttle/B-100 · 567 api) · differential-proven B-099 live · gate-4.5 PASS.
> ✅ **group-C PROGRAM → `main` `e416f17` (2026-07-19 · 0-drift · pin 985acdb)** — Dashboard/Analytics complete: Wave-1 (GET /audit-log + clock-relative seed + dashboard) + W2 (cost-type/boq-vs-nonboq/portfolio) + W3 (evm_snapshot mig 0031 + S-curve BUILD-ONCE) + W1b (activity feed) + W2b (RPT-001/003/004/005 cards + ExecDashboard) + W3b (evm/variance handlers) + B-102 (health stored-curated mig 0032) + B-103 (exec i18n +22) + SR-1/2/3 sacred · orch-B verified (sacred PERFECT · live migrate 0000-0032 · BUILD-ONCE SOUND · C10 skeptic · health mock-exact) · api 608 web 533 · non-block B-104. Wave-4 deferred.
> ✅ **Phase-4 Wave-0+1 → `main` `7741e1b` (2026-07-20 · 0-drift · pin b312f5a)** — Subcon+PM start: subcon.ts + pm.ts backend (8+8 ops · tenant-door AIRTIGHT · no migration · contract frozen) + i18n R1/R2 sacred (B-105/B-106 · +550 keys) + subcon.contracts + pm.assets web ports · orch-B verified (tenant-door skeptic AIRTIGHT + glyph-fidelity SOUND + gate-4.5 ×2 + live) · api 680 · web 560. Wave-2 gated (B-107/B-108).
> ✅ **Phase-4 Wave-2 backend → `main` `b35059d` (2026-07-20 · 0-drift · pin 90dc065)** — Subcon+PM money: approve-payment (money authority=SERVER · 4-basis · retention split → ap_billing + retention_ledger + period→paid atomic B-097 tx · %-gate advisory never-403) + pm contracts/quotes/close (per_visit autogen · LINE stub) + migrations 0033/0034 additive (B-110 name cols) + B-111 sacred openapi (listPmQuotes additive · wei-approved:B-108) · orch-B VERIFIED: money-authority AIRTIGHT static+LIVE (bogus 99999999 IGNORED→server 430k · PASS 11/11 real-PG) · tenant-door skeptic AIRTIGHT (8 HOPS→company_id) · i18n 2677 unchanged · api 726. Wave-2 web + Wave-3 (fan-in 'pm' enum · retention 50/50) next.

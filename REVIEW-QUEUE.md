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
| P2-WEB-11 | web · gr (goods receipt) port (B-070) | merge 8382506 feature/web3 → dev — GRList (ref g1/18): breadcrumb+4 MiniKpi+5-tab TabBar C10 counts+search+3 chips+split list/detail+return tab+cancel tab · GRCreateForm (po/wo/other segmented pickers from GET /po+/wo approved anchors) · gr-rows.ts+25 unit · gr-strings.json · **create/return/cancel all WIRED** (POST /gr · /gr/{id}/return · /gr/{id}/cancel via ctx.confirm) | — · typecheck clean · vitest 193/193 (+25) · gate-4.5 inline orch-A · **G5 structural PASS vs g1/18** · **live-pixel PENDING** (stack down) · **flag: (1) GET /gr wire minimal {id,no,po_id,wo_id,status,received,rejected,photos} → em-dash: money/vendor/date/received-by/per-line item+ordered-qty+progress+partial badge (2) ref# resolved po_id→po.no / wo_id→wo.no via GET /po+/wo (3) KPI cards 2/3 no wire metric→em-dash; card1 month-unscoped (4) status map received→approved green · cancelled verbatim · **returned has no ds.jsx STATUS entry → reuses info tone + kpiReturns label (APPROXIMATE)** (5) full Return-form modal + cancel-reason NOT reproduced (minimal ConfirmDialog · keys absent → B-072) (6) live-PG/live-pixel not run — batch-7 audit** | 2026-07-16 |
| P2-WEB-01 | web · master.vendor port (B-070/B-071) | merge 5e6efd7 feature/web → dev — MasterVendor: Page+4 PartyKpi+5 filter tabs+search+8-col table+row menu · VendorForm modal (4-way type→2-way kind map) · GET/POST/PUT /vendors (code/addr/bank/status from BE-08) · vendor-rows.ts pure display+19 unit · vendor-strings.json (Thai out of .tsx per i18n-guard) · **i18n: 0 missing** (vendor.* dict + ผู้ขาย/ผู้รับเหมา nav + วัสดุ/รับเหมา/บริการ/ราย/ล้านบาท/ใช้งาน/เงินสด/ตามงวดงาน phrases all present B-071) | — · typecheck clean · vitest 187/187 (+19) · vite build 255 modules clean · gate-4.5 inline orch-A · **G5 structural PASS vs g2/30** (breadcrumb/title/actions/4 KPI/5 tabs/search/8 cols verbatim) · **live-pixel PENDING** (stack down) · **flag: (1) spend em-dash honest — no AP source (2) type derived from kind: บริการ/ที่ดิน tabs read 0 (3) GET returns 13 rows (6 supplier+7 subcon seed superset) vs 6 in g2/30 — data-count ต่างได้ (4) credit_term from wire int days (5) ⚠️ `--brand-ink` NOT in @juneflow/tokens — used prototype fallback var(--brand-ink,var(--brand)); surface to tokens owner (6) live-PG/live-pixel not run — batch-7 audit** | 2026-07-16 |

> ✅ **batch #4 (9 งาน) promoted → `main` `433dda5` เมื่อ 2026-07-15** — master wave web 6/7 (WEB-08 company/09 project/10 ptype/11 cc/13 model/14 users · recon-first + residual keys B-054/057/063/064/068 + §9) + MOB-02 (Dart §6) + PLAT-04 (§9 i18n 91 keys) + BE-11 (cc/docnum schema · migration 0012) · gate-4.5 + G5 PASS ทุก task · promote `git merge --squash -X theirs 1bbcaba` = main tree == dev 0 diff · queue เคลียร์ · **WEB-12 docnum ยัง blocked B-067 (backend lock column)**
> ✅ **batch 5+6 (22 rows) promoted → `main` `244912c` เมื่อ 2026-07-16** — **Phase-2 FLOW-A procurement backend ครบ** (BOQ→PR→PO/WO→GR→inbox · state machine · tiered approval · 3 door fail-closed) + **i18n Wave-1** (dict→1059) + docnum/boq.list web + migrations 0012-0017 · audit 2 ชุด (22 agents · 0 blocker · tree == pin e44627e เป๊ะ) · queue เคลียร์ · **owe: live-G5 QA pass สำหรับ web ports** · batch-7 เริ่มจาก pr.list
> ✅ **batch #3 (21 งาน) promoted → `main` `43e0b70` เมื่อ 2026-07-14** — sacred rounds 4 (i18n §1/§5/§7/§8 + envelope B-014 + contract §4/§6) · routes 6 · shell 5b · Dart regen · audit อิสระ 14-agent = 0 blocker (main tree == fde14e6 เป๊ะ · diff ว่าง) · queue เคลียร์ · **batch #4 เริ่มสะสมจาก WEB-08 (master.company กำลัง port)**
> ✅ **batch #2 (46 งาน) promoted → `main` `1eb2ecb` เมื่อ 2026-07-13** — Phase 0 ครบ + P1 login · audit อิสระ 0 defects (sacred integrity · migration 0000-0008 · gates 28/29 · api 81/web 24 · seed 113/113) · queue เคลียร์
> แถวใหม่จะสะสมเมื่อมีงาน merge เข้า `dev` รอบถัดไป (WEB-05 shell · DEV-06 secret กำลังจะเดิน)

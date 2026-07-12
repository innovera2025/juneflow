# TASKS.md — คิวงาน Autonomous Loop

> อ้างอิง: `PLAN.md` §7 (Phase Plan) · §10 (Autonomous Loop Protocol) · Bootstrap Manifest v2 กลุ่ม 3.1 + กลุ่ม 5
> เขต (zone): `backend` | `web` | `mobile` | `qa` | `integrations` | `devops`
> สถานะ: `ready` / `doing` / `blocked` / `review` / `done`
> ขนาด task ≤ 2–3 ชม. · คิว `ready` ต้องมี **≥ 5 task ต่อเขตตลอดเวลา** (PLAN.md §10)

## กติกาการหยิบ task

1. หยิบเฉพาะ task สถานะ `ready` **ในเขตตัวเองเท่านั้น** — งานนอกเขต = เขียน `BLOCKERS.md` (PLAN.md §8)
2. **ห้ามหยิบ task ที่คอลัมน์ dependencies ยัง `done` ไม่ครบ** — ให้ข้ามไปหยิบ `ready` ตัวถัดไปในเขต
3. เปลี่ยนสถานะเมื่อเริ่ม: `ready → doing` · ผ่าน gates + auto-merge `dev` แล้ว: `→ review` (เพิ่มแถวใน `REVIEW-QUEUE.md`) · Wei promote แล้ว: `→ done`
4. แดง = วนแก้ (เพดาน 3 รอบ) · ตัน/ขัดแย้ง spec = เขียน `BLOCKERS.md` เปลี่ยน task เป็น `blocked` แล้วข้ามไป task อื่น **ห้ามเดา ห้ามเลือกเอง**
5. ทุกรอบเขียน journal ที่ `agents/journal/{เขต}.md` (ทำอะไร/ตัดสินใจอะไร/เจออะไร)
6. path อ้างอิง: ก่อน `P0-BE-02` done ให้อ่าน `juneflow-extract/*` แทน `docs/extract/*` และ `design_handoff_juneflow/*` แทน `docs/handoff/*`

> **หมายเหตุ Phase 0:** PLAN.md §7 กำหนด Phase 0 = Backend/Platform **เดี่ยว** — task เขตอื่นในตารางนี้คืองาน Phase 0 ในเขตตัวเอง + งานเตรียม Phase 0/1 ที่เริ่มได้เร็วสุด โดยลำดับถูกบังคับผ่านคอลัมน์ dependencies แล้ว
>
> **TODO [TBD-MVP]** — การแตก task Phase 1 ขึ้นไปแบบเต็มรูปต้องรอนิยาม MVP (PLAN.md §2) — ห้าม agent สร้าง task ที่ผูกกับขอบเขต MVP เอง งานที่ขึ้นกับนิยาม MVP ให้ escalate ผ่าน `BLOCKERS.md`

Gates อ้างตาม PLAN.md §9: **G1** schema · **G2** contract test · **G3** unit business logic · **G4** E2E Playwright · **G5** visual gate — task โครงสร้างพื้นฐานที่ยังไม่แตะ 5 gates ให้ระบุเกณฑ์ CI ขั้นต่ำ (lint+typecheck+build) แทน

---

## เขต backend — `apps/api` + `packages/db` (+ แพ็กเกจ platform: contracts/tokens/i18n ตามกลุ่ม 5)

| id | เขต | สถานะ | spec pointer | dependencies | gates ที่ต้องผ่าน | ประมาณเวลา |
|---|---|---|---|---|---|---|
| P0-BE-01 | backend | done | PLAN.md §5 (โครง monorepo) + Manifest กลุ่ม 5 | — | CI: lint+typecheck+build ทุก workspace | 3 ชม. |
| P0-BE-02 | backend | done | ก๊อป `docs/extract/` (Cowork pack 8 ไฟล์ ← sacred) + `docs/handoff/` (design_handoff_juneflow ทั้งชุด) ตามกลุ่ม 5 | P0-BE-01 | inventory ครบ: extract 8 ไฟล์ + handoff ทั้งชุด (byte-identical กับต้นทาง) | 1 ชม. |
| P0-BE-03 | backend | done | `scripts/copy-references` — ก๊อป `pototype/gallery/g1–g5` ทั้งหมด **106 .jpg** (ดู B-001) + `pototype/shots/` 22 .png → `tests/visual/reference/` | P0-BE-01 | จำนวนไฟล์ตรง 106 + 22 · ห้ามแก้ไฟล์ต้นทาง | 1 ชม. |
| P0-BE-04 | backend | done | `packages/tokens` — tokens.css/tokens.json (ธีม fiori จาก `docs/handoff/`) + pipeline + gen Flutter ThemeData (PLAN.md §5, กลุ่ม 5) · ปลดล็อกแล้ว (B-011 ตอบ ก) | P0-BE-01, P0-BE-02 | CI + output gen ตรงค่า token ต้นทาง (ห้าม hardcode) | 3 ชม. |
| P0-BE-05 | backend | done | `packages/i18n` — ก๊อป `i18n-full.json` (sacred) + loader key-based โครง 3 ชั้น dict/nav/phrases (กลุ่ม 5) · spec: `docs/extract/i18n-full.json` + `docs/extract/I18N-KEYS.md` · **B-011** (packages/i18n นอก zonePaths ทุกเขต — รอ Wei) · ปลดล็อกแล้ว (B-011 ตอบ ก) | P0-BE-01, P0-BE-02 | CI + unit loader (th/zh/en/ar+RTL) · **ห้ามแปลใหม่แม้แต่คำเดียว** | 2 ชม. |
| P0-BE-06 | backend | done | `packages/db` — Drizzle + PG16 baseline + schema กลุ่ม tenant/company/user/role/session ตาม `docs/handoff/data-dictionary.html` + `erd.html` | P0-BE-01 | G1 (บางส่วน) + migration check | 3 ชม. |
| P0-BE-07 | backend | done | schema กลุ่มโครงการ/BOQ/จัดซื้อ ตาม dictionary (+คำตัดสิน C2: basis ที่ 4 = `unit`, C3: WorkPeriod states ตาม flows/dictionary) · **REWORK (ด่าน 4.5 FAIL 12 ก.ค.):** ต้องเพิ่ม `pm_quote` ตาม erd (§6 นับ erd เป็น base) — งานส่วนอื่นเสร็จบน feature/backend แล้ว (C2/C3 ผ่าน) | P0-BE-06 | G1 (บางส่วน) + migration check | 3 ชม. |
| P0-BE-08 | backend | done | schema กลุ่มการเงิน-บัญชี/subscription ตาม dictionary (+C4: e-Tax superset, C5: limits key = storage_gb/ai_per_month, C9: JV lines) · **REWORK (ด่าน 4.5 FAIL 12 ก.ค.):** ต้องเพิ่ม `sales_unit.contract` (ชนิดถาม B-013 — ห้ามอ้าง TBD-MVP) + คืน spec-comment — งานส่วนอื่นเสร็จบน feature/backend แล้ว (C4/C9 ผ่าน) | P0-BE-06 | G1 (บางส่วน) + migration check | 3 ชม. |
| P0-BE-09 | backend | done | schema ส่วนขยายบังคับ **ภาคผนวก B** ครบ 14 รายการ (PLAN.md ภาคผนวก B + `docs/extract/MOCK-DATA.md`) | P0-BE-06, P0-BE-07, P0-BE-08 | **G1 เต็ม** = dictionary + ภาคผนวก B ครบ | 3 ชม. |
| P0-BE-10 | backend | ready | seed จาก `docs/extract/MOCK-DATA.md` §สรุป — normalize FK ข้อความ → `*_id` จริง · apply C3 (map state) · C6 (VENDOR_SEED จาก master-party.jsx) · C9 (JV lines DR=CR) · C10 (ห้าม hardcode badge) · **blocked B-009**: §สรุป ระบุ Unit/SalesUnit = "ไม่มี record (generate 84 ยูนิตทุก reload)" แต่ §0 กฎ 3 ห้ามลอก generator runtime — จำนวน Unit ที่ต้อง persist (84/0) คือคำถาม "84 vs 0 ห้ามตัดสินเอง" เดียวกับที่ diff-reviewer FAIL P0-QA-06 · gate "counts ตรง §สรุป" ครอบ Unit → seed สมบูรณ์ไม่ได้จนกว่า Wei ตอบ B-009 · **B-009 ตอบแล้ว (ก): persist SalesUnit 84 records ตาม generator** — อัปเดต expected ใน tests/seed ด้วย (todo ผูก B-009) | P0-BE-09 | seed รันผ่าน + จำนวน record ตรง §สรุป + persist (ไม่ reseed ทุก reload) | 3 ชม. |
| P0-BE-11 | backend | done | better-auth self-host ใน Postgres + middleware tenant scope `company_id` **ทุก query** (PLAN.md §5, ภาคผนวก A) · **REWORK — ด่าน 4.5 FAIL (security):** update() ใน apps/api/src/db/tenant-db.ts ต้อง strip/force company_id ที่ runtime เหมือน insert() (พิสูจน์แล้ว reassign ข้าม tenant ได้) + เพิ่ม G3 test update-cannot-reassign-company_id · auth wiring จริงรอ B-016 | P0-BE-06 | G3 (unit tenant scope — ห้ามมี query หลุด scope) | 3 ชม. |
| P0-BE-12 | backend | done | `packages/contracts` — `openapi.yaml` จาก `docs/handoff/api-contract.md` + codegen TS (Dart pipeline ดู P0-MOB-03) · **sacred หลัง merge — แก้ผ่าน Wei เท่านั้น** · ปลดล็อกแล้ว (B-012 ตอบ ก — orchestrator รันรอบพิเศษพร้อม override) | P0-BE-01, P0-BE-02 | contract lint + codegen ผ่าน | 3 ชม. |
| P0-BE-13 | backend | done | Fastify app skeleton — AuditLog middleware (ทุก mutation) · quota → `402 QUOTA_EXCEEDED` + `upgrade_url` · `POST /files` presigned skeleton (R2, fake ใน dev) · BullMQ worker skeleton · health endpoint (PLAN.md §5) | P0-BE-11, P0-BE-12 | G2 (endpoints ที่มีใน contract) + G3 (audit/quota) | 3 ชม. |
| P0-BE-14 | backend | done | กลไก feature flag ซ่อนโมดูลที่ยังไม่เสร็จ — dev เขียว/demo ได้ตลอด (Manifest กลุ่ม 5 ข้อกำหนด Phase 0) · **REWORK — ด่าน 4.5 FAIL:** (1) 404 ของ requireFeature ต้อง flat {code,message} ตรง contract Error + แก้ test assertion (2) ถอด GET /feature-flags ออกชั่วคราว (B-018 ตัวเลือก ค — endpoint ไม่มีใน contract ห้ามเพิ่มเอง) (3) normalize 401 nested ใน tenant-scope.ts:84 เป็น flat ด้วย (4) comment ไทย "กลุ่ม 5" → อังกฤษ | P0-BE-13 | G3 (flag gating) + CI เขียว | 2 ชม. |
| P0-BE-15 | backend | done | `scripts/loop-runner.sh` + `scripts/loop-config.json` ตาม Manifest กลุ่ม 4.1/4.2 + PLAN.md §10 — พารามิเตอร์ agent/เพดานรอบ/เพดานงบ · no-progress detection (diff ว่าง 2 รอบติด → park) · เขียน journal · done-on-arrival: runner+config มีจริง gate "dry-run ผ่าน" พิสูจน์จากการรันจริง 6 lifecycle คืนนี้ (journal ทุกเขต) — ownership ของ scripts/ อยู่ใน B-011 | P0-BE-01 | dry-run ผ่าน: อ่าน TASKS.md → เลือก 1 task → เช็ค exit + เขียน journal | 3 ชม. |

## เขต web — `apps/web`

| id | เขต | สถานะ | spec pointer | dependencies | gates ที่ต้องผ่าน | ประมาณเวลา |
|---|---|---|---|---|---|---|
| P0-WEB-01 | web | done | apps/web skeleton — React 18 + Vite + TS + TanStack Router/Query ผูก `packages/tokens` (**ห้าม hardcode ค่าใดๆ**) (PLAN.md §5, ภาคผนวก A) | P0-BE-01, P0-BE-04 | CI: lint+typecheck+build | 3 ชม. |
| P0-WEB-02 | web | done | route tree + route constants ครบ 44 เมนูจาก `docs/extract/NAV-ROUTES.md` (+C7: ป้ายฝั่ง NAV/"อนุมัติ BOQ"/boq.bom · C8: gate `subcon.*`) — จอ placeholder ซ่อนหลัง feature flag | P0-WEB-01 | route ตรง NAV-ROUTES 100% (ตรวจกับไฟล์ extract) | 3 ชม. |
| P0-WEB-03 | web | done | i18n wiring — `t()` key-based จาก `packages/i18n` · สลับ th/zh/en/ar+RTL ตาม pototype · ทุกข้อความ = key จาก i18n-full.json เท่านั้น (key ไม่มี → BLOCKERS) | P0-WEB-01, P0-BE-05 | G3 (loader/RTL) + ไม่มี string นอก i18n key | 3 ชม. |
| P0-WEB-04 | web | done | port-map inventory — ตาราง mapping `pototype/*.jsx` (ยกเว้นไฟล์ excluded ตาม PLAN.md §0 ข้อ 5) → โมดูล/route เป้าหมาย + ภาพอ้างอิง gallery ต่อจอ → เก็บที่ `apps/web/docs/port-map.md` · spec: pototype/ + `docs/extract/INVENTORY.md` + NAV-ROUTES.md | — | ครอบคลุมทุก .jsx ที่ไม่ถูก exclude · review โดย Wei | 3 ชม. |
| P0-WEB-05 | web | blocked | app shell port ตรงจาก `chrome.jsx` + `shell.jsx` (sidebar/topbar/เมนู) — badge จาก query จริง (C10) · ป้ายจาก i18n key · โครงเมนูตรง NAV-ROUTES 100% | P0-WEB-02, P0-WEB-03 | **G5** (visual gate จอ shell เทียบ reference) | 3 ชม. |
| P0-WEB-06 | web | done | API client จาก codegen `packages/contracts` — **ห้ามเขียน model มือ** + setup TanStack Query client | P0-WEB-01, P0-BE-12 | CI + typecheck ผ่านด้วย generated types เท่านั้น | 2 ชม. |

## เขต mobile — `apps/mobile` (Flutter — จอเริ่ม Phase 4)

| id | เขต | สถานะ | spec pointer | dependencies | gates ที่ต้องผ่าน | ประมาณเวลา |
|---|---|---|---|---|---|---|
| P0-MOB-01 | mobile | done | apps/mobile Flutter skeleton (โครงเท่านั้น ตามกลุ่ม 5 — จอเริ่ม Phase 4) | P0-BE-01 | `flutter analyze` + build ผ่าน | 2 ชม. |
| P0-MOB-02 | mobile | done | theme จาก generated ThemeData ของ `packages/tokens` — **ห้ามแก้มือ** (กลุ่ม 2.3) | P0-MOB-01, P0-BE-04 | theme มาจาก gen เท่านั้น (ไม่มีค่า hardcode) | 2 ชม. |
| P0-MOB-03 | mobile | done | Dart client codegen จาก `packages/contracts/openapi.yaml` (กลุ่ม 2.3 + PLAN.md §5) | P0-MOB-01, P0-BE-12 | codegen ผ่าน + compile ผ่าน | 3 ชม. |
| P0-MOB-04 | mobile | blocked | mobile screen inventory — `pototype/mobile*.jsx` (31 จอ) → ตาราง widget mapping + ภาพอ้างอิง gallery mobile ต่อจอ → เก็บที่ `apps/mobile/docs/screen-map.md` (เตรียม Phase 4) · **blocked B-015**: source enumerate ได้ 26 จอ distinct (+1 host) ขัดกับ "31 จอ" ใน zone CLAUDE.md (sacred) — count/นิยาม "จอ" ต้อง Wei ตัดสิน | — | ครบ 31 จอ · review โดย Wei | 3 ชม. |
| P0-MOB-05 | mobile | done | โครง offline queue interface (drift/SQLite + sync queue ตามภาคผนวก A) — **เฉพาะส่วนที่ไม่ขึ้นกับระดับ (ก)/(ข)** · ระดับ offline-first รอคำตอบ Open Q #5 (PLAN.md §11) — ถ้าชนทางเลือก → BLOCKERS **ห้ามตัดสินใจเอง** | P0-MOB-01 | `flutter analyze` + unit interface ผ่าน | 3 ชม. |

## เขต qa — `tests/`

| id | เขต | สถานะ | spec pointer | dependencies | gates ที่ต้องผ่าน | ประมาณเวลา |
|---|---|---|---|---|---|---|
| P0-QA-01 | qa | done | ตรวจ `tests/visual/reference/` ครบ (106 .jpg + 22 .png — ดู B-001) + จัดทำ index ภาพ→จอ/route จาก `docs/extract/NAV-ROUTES.md` → `tests/visual/reference-index.md` | P0-BE-03 | จำนวนไฟล์ตรง + index ครอบคลุมทุกภาพ | 2 ชม. |
| P0-QA-02 | qa | done | contract test harness (`tests/contract/`) — generate จาก `openapi.yaml` · **expected จาก contract เท่านั้น ห้ามอ่าน implementation ก่อน** (กลุ่ม 2.4) | P0-BE-12 | G2 harness รันได้กับ dev API | 3 ชม. |
| P0-QA-03 | qa | ready | Playwright E2E harness (`tests/e2e/`) + smoke test (login → shell load) ตาม state machine ใน `docs/handoff/flows.html` | P0-DEV-01 | G4 smoke ผ่านบน compose dev | 3 ชม. |
| P0-QA-04 | qa | done | visual gate harness — screenshot compare กับ `tests/visual/reference/` ตามเกณฑ์ PLAN.md §0 (ต่างได้เฉพาะตัวเลขข้อมูลจาก seed + สิ่งที่ Wei อนุมัติผ่าน BLOCKERS) | P0-QA-01 | G5 harness รันได้ + รายงาน diff อ่านได้ | 3 ชม. |
| P0-QA-05 | qa | done | unit business-logic test spec (expected-first) สำหรับ G3: posting rules · ตัด remain BOQ · retention · approval matrix · quota · งวดงาน 4 basis (C2 รวม `unit`) — เขียนจาก `docs/handoff/flows.html` + `docs/extract/PACKAGE-RULES.md` + `docs/extract/PROJECT-TYPES.md` + dictionary · **ห้ามอ่าน implementation ก่อนเขียน expected** | — | spec review โดย Wei (ยังไม่รันกับโค้ด) | 3 ชม. |
| P0-QA-06 | qa | done | seed fixture assertions จาก `docs/extract/MOCK-DATA.md` §สรุป — จำนวน record ต่อ entity เป็น expected (รันจริงเมื่อ P0-BE-10 done) · **REWORK — ด่าน 4.5 FAIL 12 ก.ค.:** (1) Package expected = 4 ตาม C1/PKG_STORE (ห้ามใช้ SUB_PACKAGES=3) (2) JV lines ห้ามล็อก 0 — C9 ให้ seed สร้าง lines สมดุล DR=CR (JV 7 ใบ ≥14 lines) (3) Unit 84 vs 0 ห้ามตัดสินเอง → เปิด blocker (ร่างใน REVIEW-QUEUE/journal) · โค้ดเดิมอยู่บน feature/qa แก้ต่อจากตรงนั้น | — | assertions ตรง §สรุป 100% | 2 ชม. |

## เขต integrations — `packages/tax-engine` · `packages/bank-file` · `packages/notifications`

| id | เขต | สถานะ | spec pointer | dependencies | gates ที่ต้องผ่าน | ประมาณเวลา |
|---|---|---|---|---|---|---|
| P0-INT-01 | integrations | done | interface `TaxEngine` + impl `thailand` (skeleton + fake ตามกลุ่ม 5) — mock-first (กลุ่ม 2.5, PLAN.md §4) | P0-BE-01 | CI + G3 (unit interface + fake adapter) | 3 ชม. |
| P0-INT-02 | integrations | done | interface `BankFileFormatter` + impl `kbank-direct` (skeleton + fake ตามกลุ่ม 5) | P0-BE-01 | CI + G3 (unit interface + fake adapter) | 2 ชม. |
| P0-INT-03 | integrations | done | interface `NotificationAdapter` + adapters line/email/webpush (skeleton + fake ตามกลุ่ม 5) | P0-BE-01 | CI + G3 (unit interface + fake adapter) | 3 ชม. |
| P0-INT-04 | integrations | done | credentials ผ่าน env — convention + `.env.example` ทั้ง 3 แพ็กเกจ (**ห้าม secrets ใน repo**) (กลุ่ม 2.5/2.6) | P0-INT-01, P0-INT-02, P0-INT-03 | scan ไม่พบ secret ใน repo + config โหลดจาก env ผ่าน | 2 ชม. |
| P0-INT-05 | integrations | done | field inventory ฟอร์มภาษีไทยจาก `pototype/tax-forms.jsx` → `packages/tax-engine/docs/tax-forms-map.md` (เตรียม Phase 3 — ฟอร์มต้อง render ตรง tax-forms.jsx / accurate to RD originals) | — | ครอบคลุมทุกฟอร์มใน tax-forms.jsx · review โดย Wei | 3 ชม. |

## เขต devops — `infra/` (+ `.github/` ตามกลุ่ม 4)

| id | เขต | สถานะ | spec pointer | dependencies | gates ที่ต้องผ่าน | ประมาณเวลา |
|---|---|---|---|---|---|---|
| P0-DEV-01 | devops | ready | `infra/docker-compose.yml` (dev) — pg16 + redis + api + web + worker · **`docker compose up` เดียวได้ระบบ + seed** (Manifest กลุ่ม 5 ข้อกำหนด Phase 0) | P0-BE-10, P0-BE-13 | compose up สำเร็จรอบเดียว + seed ครบ + คลิกเทียบ gallery ได้ | 3 ชม. |
| P0-DEV-02 | devops | done | `.github/workflows/ci.yml` ตามกลุ่ม 4.3 — stages: lint+typecheck → migration check → contract → unit → E2E → visual · เขียว auto-merge feature→dev · main ล็อกให้ Wei · **sacred หลัง merge** · done ตาม B-010 ตอบ ก (pipeline จริงรันเมื่อมี remote) | P0-BE-01 | pipeline รันผ่านบน branch ทดสอบ | 3 ชม. |
| P0-DEV-03 | devops | done | `.github/CODEOWNERS` ตามกลุ่ม 4.4 — ล็อกเขตต่อ agent + sacred files (OpenAPI · merged migrations · CLAUDE.md ทุกใบ · CI config · secrets · `docs/extract/*` · i18n-full.json) | P0-BE-01 | ครอบคลุม sacred ครบตาม PLAN.md §10 | 1 ชม. |
| P0-DEV-04 | devops | done | branch policy + runbook — dev auto-merge เมื่อ CI เขียว · main = Wei promote คนเดียว · runbook: deploy dev / promote main / restore DB → `infra/runbook.md` (กลุ่ม 2.6) | P0-DEV-02 | review โดย Wei + ทดสอบ flow feature→dev จริง 1 รอบ | 2 ชม. |
| P0-DEV-05 | devops | ready | infra prod compose skeleton (VPS Singapore ตามภาคผนวก A) — env จาก host **ห้าม secrets ใน repo** | P0-DEV-01 | config validate ผ่าน + scan ไม่พบ secret | 3 ชม. |

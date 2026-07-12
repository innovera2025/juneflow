# Juneflow — PLAN.md (แผนกลาง)

> Construction ERP + Subscription SaaS · สร้างตาม Bootstrap Manifest v3 (`JUNEFLOW-BOOTSTRAP.md` · 6 ก.ค. 2569)
> ส่วนที่ระบุ **[TBD-MVP]** = รอ Wei เติมเมื่อปิดนิยาม MVP — **ห้าม agent ใดเดาหรือกำหนดเอง**
> เอกสารนี้คือแผนกลางฉบับเดียวของ repo — ทุก agent ต้องอ่านก่อนเริ่มงาน และอ่าน §0 ก่อนทุก section

---

## 0. Design Fidelity Protocol (กฎหมายสูงสุด)

**Prototype อยู่ที่ `~/Documents/juneflow/pototype/`** (สะกด "pototype" ตามจริง) — เปิดดูพฤติกรรมจริงผ่าน `pototype/Juneflow Fiori.html`

### กฎ 5 ข้อ — บังคับเคร่งครัด ห้ามละเมิด

1. **สิ่งที่ผู้ใช้เห็น/กด/อ่าน ต้องตรง pototype 100%** — เลย์เอาต์ โครงเมนู ป้ายข้อความ สี ระยะ พฤติกรรมปุ่ม/modal/ฟอร์ม state ของทุกจอ ห้ามออกแบบใหม่ ห้าม "ปรับปรุงให้ดีขึ้น" ห้ามใช้ component library หน้าตาอื่น
2. **แหล่งอ้างอิงบังคับต่อเรื่อง (ทั้งหมดถอดจาก pototype แล้ว — ใช้ตามนี้ ห้ามตีความใหม่):**
   - โครงเมนู/route ทุกตัว → `docs/extract/NAV-ROUTES.md` (ถอดจาก chrome.jsx + shell.jsx)
   - กติกาแพ็กเกจ S/M/L/Full + sub rules + โควต้า AI → `docs/extract/PACKAGE-RULES.md`
   - ประเภทโครงการ 4 แบบ + hierarchy + modules + route gating → `docs/extract/PROJECT-TYPES.md`
   - คำแปลทุกข้อความ 4 ภาษา (th/zh/en/ar+RTL) → `docs/extract/i18n-full.json` — **ห้ามแปลใหม่แม้แต่คำเดียว** ข้อความที่ไม่มีในไฟล์นี้ = เข้า BLOCKERS
   - สี/ฟอนต์/ระยะ/รัศมี → `packages/tokens` (จาก tokens.css/tokens.json ธีม fiori) — ห้าม hardcode ค่าใดๆ
   - ภาพอ้างอิงทุกจอ → `pototype/gallery/g1–g5` (102 .jpg — หมายเหตุ: นับจริงบนดิสก์ = **106 .jpg** ให้ใช้ทั้งหมด) + `pototype/shots/` (22 .png) — คือ reference ของ visual gate
   - พฤติกรรมละเอียดระดับปุ่ม → โค้ด `.jsx` ต้นทาง + `design_handoff_juneflow/FUNCTIONS.md` (หลัง scaffold = `docs/handoff/FUNCTIONS.md`)
3. **Fidelity = สิ่งที่ผู้ใช้เห็น ไม่ใช่กลไกภายในของ prototype** — สิ่งต่อไปนี้เป็นกลไก mock ห้ามลอกเข้า production: FK เป็นข้อความชื่อ (ต้องเป็น `*_id` จริงตาม dictionary), การแปลด้วย DOM MutationObserver (production ใช้ key-based t() โดยคำแปลจาก i18n-full.json), badge ตัวเลข hardcode ใน NAV (ต้องมาจาก query จริง), ข้อมูล seed ใหม่ทุก reload (ต้อง persist), `Math.round(price*10)` ฯลฯ ให้คงเป็น business rule ตามโค้ด
4. **ห้ามลอกบั๊ก และห้ามตัดสินความขัดแย้งเอง** — ทุกข้อใน `docs/extract/GAPS.md` และตารางคำตัดสิน (ภาคผนวก C ท้ายเอกสารนี้) คือคำตัดสินของ Wei · เจอความขัดแย้งใหม่ที่ไม่อยู่ในตาราง → เขียน BLOCKERS.md แล้วข้ามไป task อื่น **ห้ามเดา ห้ามเลือกเอง**
5. **นอกขอบเขตเด็ดขาด:** `pototype/wat/` + `บุญบัญชี*.html` (แอปการเงินวัด — คนละผลิตภัณฑ์), ไฟล์โค้ดตาย `finance.jsx` และ `tweaks-panel.jsx` (ไม่ถูกโหลด/ไม่ถูก route), ไฟล์ standalone build ทุกตัว (2–9 MB), ธีม `Juneflow Ant Pro*` (ใช้ Fiori เท่านั้น)

### Visual Gate (นิยามการ "ตรง Design")

- ทุกจอที่สร้างต้อง screenshot เทียบภาพอ้างอิงใน `tests/visual/reference/` (ก๊อปจาก `pototype/gallery/` + `shots/`)
- เทียบ: โครงเลย์เอาต์, ลำดับ/ป้ายเมนูและคอลัมน์, token สี, ตำแหน่ง KPI/ปุ่ม/แท็บ — ต่างได้เฉพาะตัวเลขข้อมูล (มาจาก seed) และสิ่งที่ Wei อนุมัติผ่าน BLOCKERS
- จอที่ไม่มีภาพอ้างอิง → เปิด `Juneflow Fiori.html` จอเดียวกัน แคปเป็น reference ก่อนเริ่มสร้าง

---

## 1. Vision & Scope

Juneflow คือ **Construction ERP + Subscription SaaS แบบ multi-tenant** — ระบบบริหารธุรกิจก่อสร้างครบวงจรที่ขายเป็น subscription หลายบริษัท (tenant) บนระบบเดียว

ขอบเขตระบบ (ตามที่ถอดจริงจาก prototype):

- **7 process flows** (state machine + approval matrix ตาม flows.html)
- **44 เมนูหลัก / 100+ จอ** — ตาม `docs/extract/NAV-ROUTES.md`
- **4 project types** พร้อม hierarchy + modules + route gating — ตาม `docs/extract/PROJECT-TYPES.md`

**Source of truth แยกตามหน้าที่ — ห้ามสลับบทบาทกัน:**

| เรื่อง | แหล่งความจริง |
|---|---|
| พฤติกรรม + visual ทุกจอ | `pototype/` |
| State machine + approval matrix | `design_handoff_juneflow/flows.html` (หลัง scaffold = `docs/handoff/flows.html`) |
| โครง DB ฐาน | `data-dictionary.html` + `erd.html` (หลัง scaffold = `docs/handoff/`) |
| โครง API | `api-contract.md` (หลัง scaffold = `docs/handoff/api-contract.md`) |
| ข้อเท็จจริงถอดจากโค้ด prototype | `docs/extract/*` (Cowork pack 8 ไฟล์) |

---

## 2. MVP Definition

**TODO [TBD-MVP]** — Wei จะเติมเมื่อปิดนิยาม MVP · ห้าม agent ใดกำหนด/เดาขอบเขต MVP เอง งานที่ขึ้นกับนิยาม MVP ให้ escalate ผ่าน BLOCKERS.md

---

## 3. Tech Stack & Rationale

Stack ที่เลือกใช้ทั้งหมด → ตาราง **ภาคผนวก A** ท้ายเอกสารนี้ (บังคับใช้ตามตาราง ห้ามเปลี่ยนโดยไม่ผ่าน Wei)

**เหตุผลที่ไม่ใช้ทางเลือกยอดนิยม:**

- **ไม่ใช้ Clerk (หรือ hosted auth ใดๆ)** — auth ต้อง self-host ใน Postgres ของเราเอง (better-auth) และต้อง custom LINE Login/LIFF · ระบบ multi-tenant ที่ผูก `company_id` กับทุก query ต้องควบคุมข้อมูลผู้ใช้เองทั้งหมด
- **ไม่ใช้ Firebase** — ระบบเป็น relational ERP: PostgreSQL 16 + Drizzle คือ system of record เดียว · deploy self-host บน VPS ไม่ผูก vendor NoSQL/BaaS
- **ไม่ใช้ Next.js** — ทุกจอ port ตรงจาก `pototype/*.jsx` ซึ่งเป็น SPA อยู่แล้ว ไม่มีความต้องการ SSR/SEO · ใช้ React 18 + Vite + TanStack Router/Query ให้ตรงธรรมชาติของ prototype ที่สุด
- **ไม่ใช้ Supabase** — เราคุม DB เองผ่าน Drizzle migration + Docker Compose บน VPS Singapore · tenant isolation ทำผ่าน `company_id` middleware (RLS deferred) จึงไม่พึ่งแพลตฟอร์ม RLS-first

---

## 4. Global-readiness (hard req.)

ข้อบังคับระดับ hard requirement — ใช้กับทุกโมดูลตั้งแต่ Phase 0:

1. **เวลา:** timestamp ทุกตัวเก็บเป็น **UTC** · timezone และระบบปฏิทิน (พ.ศ./ค.ศ.) เป็น setting ของผู้ใช้/tenant
2. **เงิน:** เงินทุกคอลัมน์ต้องมี `currency_code` กำกับ + มี functional currency ต่อ tenant
3. **พื้นที่ที่ดิน:** เก็บเป็น**ตารางเมตร**เสมอ แปลงตอนแสดงผลเท่านั้น (ไร่-งาน-วา / acre / ha)
4. **Compliance เป็น interface:** `TaxEngine` / `BankFileFormatter` / `NotificationAdapter` — implementation แรก = `thailand`

---

## 5. Architecture

**โครง monorepo (scaffold Phase 0):**

```
juneflow/
├─ apps/
│  ├─ api/            # Fastify + TS · better-auth · BullMQ worker
│  ├─ web/            # React 18 + Vite + TanStack Router/Query
│  └─ mobile/         # Flutter (โครง — จอเริ่ม Phase 4)
├─ packages/
│  ├─ db/             # Drizzle schema: dictionary + ภาคผนวก B · seed จาก MOCK-DATA.md
│  ├─ contracts/      # openapi.yaml (จาก api-contract.md) + codegen TS/Dart
│  ├─ tokens/         # tokens.css/json (fiori) + gen Flutter ThemeData
│  ├─ i18n/           # ก๊อป i18n-full.json + loader key-based (โครง 3 ชั้น: dict/nav/phrases)
│  ├─ tax-engine/     # interface + `thailand` (skeleton + fake) — ฟอร์มตรง tax-forms.jsx
│  ├─ bank-file/      # interface + `kbank-direct` (skeleton + fake)
│  └─ notifications/  # interface + adapters line/email/webpush (skeleton + fake)
├─ tests/
│  ├─ contract/  ├─ e2e/
│  └─ visual/reference/   # ก๊อปจาก pototype/gallery/g1–g5 + shots/
├─ infra/              # docker-compose.yml (pg16+redis+api+web+worker, up เดียว+seed) + prod
├─ scripts/            # loop-runner, seed, copy-references
├─ agents/journal/
├─ docs/
│  ├─ handoff/         # ก๊อป design_handoff_juneflow/ ทั้งชุด
│  └─ extract/         # ก๊อป Cowork pack 8 ไฟล์ ← sacred
├─ PLAN.md · CLAUDE.md · TASKS.md · BLOCKERS.md · REVIEW-QUEUE.md
```

**หลักสถาปัตยกรรมบังคับ:**

- **Tenant scope:** `company_id` บังคับผ่าน middleware **ทุก query** — ห้ามมี query ที่หลุด scope
- **OpenAPI = contract เดียว** — FE/Mobile generate client จาก `packages/contracts/openapi.yaml` **ห้ามเขียน model มือ**
- **Async jobs** ผ่าน BullMQ: export / e-Tax / notification / PM schedule gen
- **ไฟล์:** `POST /files` presigned → Cloudflare R2 → เข้า DMS อัตโนมัติ + `link_module`
- **Audit:** ทุก mutation เขียน AuditLog ผ่าน middleware (ไม่ใช่เขียนมือรายจุด)
- **Quota:** เกินโควต้า → `402 QUOTA_EXCEEDED` + `upgrade_url`

---

## 6. Data Model Strategy

- **ฐาน schema** = data-dictionary (~34 entities) จาก `docs/handoff/data-dictionary.html` + `erd.html`
- **+ ส่วนขยายบังคับจาก pototype ที่ dictionary ไม่มี** → รายการเต็มใน **ภาคผนวก B** (ออกแบบจากจอ + mock ตาม MOCK-DATA.md)
- **Schema gate = dictionary + ภาคผนวก B** — schema ที่ไม่ครบสองส่วนนี้ = ไม่ผ่าน gate ข้อ 1
- **Seed:** mock ใน `.jsx` → แปลงเป็น seed จริง จำนวน record ตาม `docs/extract/MOCK-DATA.md` §สรุป · normalize FK ที่เป็นข้อความชื่อ → `*_id` จริง (กลไก mock ตาม §0 กฎข้อ 3)

---

## 7. Phase Plan

| Phase | ขอบเขตงาน | Milestone (นิยามจบเฟส) | Agent เข้าใหม่ | Agent ที่ทำงานในเฟส |
|---|---|---|---|---|
| 0 | scaffold + schema + auth + OpenAPI + tokens pipeline + loop runner | `docker compose up` เดียวได้ระบบ + seed คลิกเทียบ gallery ได้ · โมดูลไม่เสร็จซ่อนหลัง feature flag — dev เขียว/demo ได้ตลอด | Backend/Platform (**เดี่ยว**) | Backend/Platform |
| 1 | Auth + Master + โครงการ | โมดูลของเฟสผ่าน gates ครบ 5 (§9) และ demo ได้บน dev | Frontend Web · QA · DevOps (หมุนเวียน)* | Backend · Web · QA · DevOps |
| 2 | BOQ + จัดซื้อ + Inventory | โมดูลของเฟสผ่าน gates ครบ 5 และ demo ได้บน dev | — | Backend · Web · QA · DevOps |
| 3 | การเงิน-บัญชี | โมดูลของเฟสผ่าน gates ครบ 5 และ demo ได้บน dev | **Integrations เข้า** | Backend · Web · QA · DevOps · Integrations |
| 4 | ผู้รับเหมา + ตรวจรับ + PM | โมดูลของเฟสผ่าน gates ครบ 5 และ demo ได้บน dev | **Mobile เข้า** | Backend · Web · Mobile · QA · DevOps · Integrations |
| 5 | ขาย / ที่ดิน / โซลาร์ | โมดูลของเฟสผ่าน gates ครบ 5 และ demo ได้บน dev | — | ครบทั้ง 6 ตำแหน่ง |
| 6 | Subscription platform + LINE OA | โมดูลของเฟสผ่าน gates ครบ 5 และ demo ได้บน dev | — | ครบทั้ง 6 ตำแหน่ง |

\* Manifest ระบุชัดเฉพาะ: Phase 0 = Backend เดี่ยว · Phase 3 = +Integrations เข้า · Phase 4 = +Mobile เข้า — จุดเข้าของ Web/QA/DevOps ที่ Phase 1 เป็นการอนุมานจากข้อกำหนด "Phase 0 Backend เดี่ยว" (Wei ปรับได้)

**การออกจากทีม:** ไม่มีตำแหน่งใดออกก่อนจบ Phase 6 · DevOps เป็นตำแหน่งหมุนเวียน (เข้า-ออกตามรอบงาน infra/CI)

---

## 8. Agent Team & Ownership

**6 ตำแหน่ง — หนึ่ง agent = หนึ่ง worktree = หนึ่งเขต:**

| ตำแหน่ง | เขต (zone) | หมายเหตุ |
|---|---|---|
| Backend | `apps/api` + `packages/db` + `packages/contracts` | **เจ้าของ OpenAPI คนเดียว** |
| Frontend Web | `apps/web` | Design Fidelity เข้มสุดในเขตนี้ |
| Mobile | `apps/mobile` | Flutter |
| QA | `tests/` | เขียน expected จาก spec ห้ามอ่าน implementation ก่อน |
| Integrations | `packages/tax-engine` · `packages/bank-file` · `packages/notifications` | mock-first |
| DevOps | `infra/` · `scripts/` · `.github/` | หมุนเวียน · CI/compose/loop infra |
| **Platform** (เขตที่ 7 — B-032) | root build/CI config (`package.json` · `turbo.json` · `tsconfig.base.json` · `pnpm-workspace.yaml` · `pnpm-lock.yaml` · `.dockerignore`) + `packages/tokens` + `packages/i18n` | เจ้าของ monorepo tooling ที่ไม่มี app zone ใดครอบ — ปลดปม docker build + CI test scripts + tokens/i18n (แทนที่ B-011) |

- ห้ามข้ามเขต — งานนอกเขตตัวเอง = เขียน BLOCKERS.md
- **Contract change (OpenAPI) ผ่าน Wei เท่านั้น** — แม้แต่เจ้าของ contract ก็ต้องได้รับอนุมัติก่อน merge การเปลี่ยน contract

---

## 9. Verification Gates (นิยาม Done)

**Done = ผ่านครบทั้ง 5 gates — ขาดข้อใดข้อหนึ่ง = ไม่ done:**

1. **Schema gate** — schema ตรง dictionary + ภาคผนวก B
2. **Contract test** — generate จาก OpenAPI แล้วผ่านทั้งหมด
3. **Unit business logic** — posting rules · ตัด remain BOQ · retention · approval matrix · quota · งวดงาน 4 basis
4. **E2E Playwright** — ตาม state machine ใน flows.html
5. **Visual gate** — ตาม §0 (screenshot เทียบ reference ใน `tests/visual/reference/`)

---

## 10. Autonomous Loop Protocol

**ลูปต่อ agent (ทำซ้ำจนคิวหมดหรือชนเพดาน):**

1. หยิบ task สถานะ `ready` ในเขตตัวเองจาก `TASKS.md`
2. อ่าน spec ที่ task ชี้
3. implement ใน worktree ของตัวเอง
4. รัน gates ครบ 5
5. ตัดสินผล:
   - **เขียว** → ผ่าน**ด่าน 4.5** (ด้านล่าง) แล้วจึง push → auto-merge เข้า `dev` + อัปเดต `TASKS.md` + เขียน journal (`agents/journal/`)
   - **แดง** → วนแก้ (เพดาน **3 รอบ**)
   - **ตัน** → เขียน `BLOCKERS.md` แล้วข้ามไป task อื่น

**ด่าน 4.5 — diff-reviewer (gate ก่อน push/auto-merge):** หลัง gates ในเครื่องเขียวครบ (ขั้น 4) และก่อน push feature branch ต้องผ่าน subagent `.claude/agents/diff-reviewer.md` (ตัดสิน PASS/FAIL) — **FAIL = ไม่ push ไม่ merge, task กลับ rework** · PASS แล้ว push → CI เขียว = auto-merge เข้า `dev` อัตโนมัติ — เงื่อนไข merge `CI เขียว + diff-reviewer PASS` จึงครบคู่เสมอ เพราะ PASS ถูกบังคับก่อน push

**Guardrails:**

- **Sacred files** — แก้ผ่าน blocker เท่านั้น: OpenAPI (`packages/contracts/openapi.yaml`) · merged migrations · CLAUDE.md ทุกใบ · CI config · secrets · `docs/extract/*` · `i18n-full.json`
  — sacred files ถูกบังคับเชิงกลไกด้วย hook `.claude/hooks/protect-files.sh` (PreToolUse, exit 2) — ปลดล็อกได้เฉพาะ `SACRED_OVERRIDE=wei-approved:B-xxx` ที่ Wei อนุมัติใน `BLOCKERS.md`
- **No-progress detection:** diff ว่าง 2 รอบติด → park task
- **เพดาน token/งบต่อคืนต่อ agent** — กำหนดใน `scripts/loop-config.json`

**Review flow:**

- `feature → dev (auto เมื่อ CI เขียว + diff-reviewer PASS) → main (Wei promote คนเดียว)`
- Wei ตรวจเป็น batch: อ่าน `REVIEW-QUEUE.md` + `BLOCKERS.md` → คลิกเล่นบน dev เทียบ gallery → ผ่าน = promote / ไม่ผ่าน = rework task
- คิว `ready` ต้องมี **≥ 5 task ต่อ agent ตลอดเวลา**

---

## 11. Open Questions

1. **นิยาม MVP** — **TODO [TBD-MVP]** (ผูกกับ §2)
2. **Approval matrix** — fix หรือ configurable ต่อบริษัท?
3. **COA seed** — `COA_SEED` 23 บัญชีใน pototype เป็นจุดตั้งต้น — รอนักบัญชี validate + กำหนด posting rules ต่อชนิดเอกสาร
4. **Doc numbering** — `DOCNUM_SEED` 10 แบบเป็นจุดตั้งต้น (รอยืนยันรูปแบบสุดท้าย)
5. **Offline-first (Mobile)** — เลือกระดับ (ก) หรือ (ข)?

คำตอบทุกข้อเป็นของ Wei — ระหว่างรอคำตอบ งานที่ขึ้นกับข้อเหล่านี้ให้ escalate ผ่าน BLOCKERS.md ห้ามเดา

---

## 12. Out of Scope / Deferred + trigger

| รายการ | สถานะ | Trigger นำกลับเข้า scope (ข้อเสนอ — Wei ยืนยัน) |
|---|---|---|
| `pototype/wat/` + `บุญบัญชี*.html` | นอกขอบเขตเด็ดขาด — คนละผลิตภัณฑ์ (แอปการเงินวัด) | ไม่นำกลับ |
| AI QTO engine จริง (Python/ifcopenshell) | Deferred — UI/flow ทำตาม pototype ด้วย fake result ก่อน | เมื่อ flow fake result ผ่าน visual gate ครบ และ Wei สั่งเริ่ม Python microservice (ผ่าน queue ตามภาคผนวก A) |
| Multi-currency เต็มรูป | Deferred (ตอนนี้: ทุกคอลัมน์เงินมี `currency_code` + functional currency ต่อ tenant ตาม §4) | มี tenant ที่ใช้สกุลเงินอื่นนอก functional currency จริง |
| Stripe/USD | Deferred | เปิดขายลูกค้าต่างประเทศ |
| SSO/SAML | Deferred | มีลูกค้า enterprise ที่ต้องการ |
| Multi-region | Deferred | ข้อกำหนด data residency / latency ที่ VPS Singapore ตอบไม่ได้ |
| RLS | Deferred — ใช้ `company_id` middleware scope ไปก่อน (ภาคผนวก A) | ต้องการ tenant isolation ระดับ DB |
| FCM native push | Deferred (ภาคผนวก A: push FCM/APNs deferred) | Mobile ต้องใช้ native push จริงหลัง Phase 4 |

---

## ภาคผนวก A — Tech Stack

| ชั้น | เลือกใช้ |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | React 18 + Vite + TS (SPA) · TanStack Router + Query · tokens ธีม Fiori |
| Backend | Node.js + Fastify + TS |
| ORM/DB | Drizzle + PostgreSQL 16 · single DB · `company_id` middleware scope (RLS deferred) |
| Auth | better-auth (self-host ใน Postgres เรา) + custom LINE Login/LIFF — ไม่ใช้ Clerk/hosted |
| Queue | Redis + BullMQ |
| Files | Cloudflare R2 + presigned (`POST /files` → DMS) |
| Edge | Cloudflare DNS+CDN+WAF+rate limit+Turnstile (ไม่ใช้ Workers/D1/Pages) |
| Mobile | Flutter · offline-first (drift/SQLite + sync queue) · Dart client จาก OpenAPI · theme จาก tokens.json · push FCM/APNs (deferred) |
| Deploy | Docker Compose บน VPS Singapore · CI = GitHub Actions |
| Testing | Vitest + Playwright + contract test + visual gate (gallery jpg/png) |
| ข้อยกเว้น | AI QTO = Python microservice (ifcopenshell) ผ่าน queue · LINE LIFF = React web |

---

## ภาคผนวก B — ส่วนขยาย schema บังคับ

(มีใน pototype แต่ไม่มีใน data-dictionary — ออกแบบจากจอ + mock ตาม MOCK-DATA.md)

- Inventory (Item/Warehouse/StockTransfer/MaterialIssue)
- Lead/CRM (5 stage funnel)
- ServiceTicket (After-sales แจ้งซ่อม)
- Solar (Inverter O&M/PPA invoice/ROI/Permit steps/Warranty registry)
- Timeline (Task/Milestone Gantt)
- PettyCash transaction
- OrgStructure (ORG_SEED)
- DocNumbering (DOCNUM_SEED)
- Retention ledger
- RevRec/WIP
- AR CreditNote
- BidComparison
- Role.perms matrix (11 โมดูล × 5 สิทธิ์)
- Multi-company ในเครือ (COMPANIES + docPrefix)

---

## ภาคผนวก C — คำตัดสินความขัดแย้ง

(จาก GAPS.md — คำตอบ Wei มีผลเหนือทุกไฟล์)

| # | ความขัดแย้ง | คำตัดสิน |
|---|---|---|
| C1 | แพ็กเกจ: pkg-builder = 4 ระดับ S/M/L/Full · subscription.jsx = 3 ระดับ | **ใช้ 4 ระดับ** ตาม pkg-builder + dictionary (SUB_PACKAGES เป็น mock ค้างเวอร์ชัน) — จอ sub.plans ต้อง render 4 การ์ด |
| C2 | WorkPeriod.basis: โค้ดมี `unit` (เหมาต่อหลัง) เพิ่มจาก dictionary | **เพิ่ม `unit` เป็น basis ที่ 4** — โค้ดคือความจริงล่าสุด |
| C3 | WorkPeriod states: mock (accepted/requested/…) ≠ flows/dictionary (pending/delivered/inspecting/passed/rejected/paid) | **ใช้ state machine ตาม flows.html/dictionary** · map ค่า mock ตอน seed (requested→delivered, accepted→passed) |
| C4 | e-Tax status: mock sent/pending/error/void ≠ dictionary queued/sent/rejected | **ใช้ superset:** queued→sent \| rejected + void — คง UI ตาม pototype |
| C5 | limits key: โค้ด storage/ai · dictionary storage_gb/ai_per_month | **ใช้ชื่อ dictionary** (storage_gb, ai_per_month) ใน schema — UI แสดงตาม pototype |
| C6 | `VENDOR_SEED` ประกาศซ้ำ 2 ไฟล์ | ใช้ชุด `master-party.jsx` (master ตัวจริงที่โมดูลอื่นอ้าง) |
| C7 | ROUTE_LABELS ไม่มี `boq.bom` / ป้าย boq.approval ไม่ตรงกัน | ใช้ป้ายฝั่ง **NAV** (สิ่งที่ผู้ใช้เห็นใน sidebar) = "อนุมัติ BOQ" · เพิ่ม label boq.bom ตาม NAV |
| C8 | `routeModule("subcon")` ไม่ gate subcon.* / `aftersales` ประกาศแต่ไม่ใช้ | gate `subcon.*` ด้วย module subcon ให้ครบ (เจตนาชัดจาก NAV) · `aftersales` คงไว้ใน type config แต่ไม่ผูก route (ตาม pototype) |
| C9 | JV mock ไม่มี lines จริง | schema ตาม dictionary (`lines[{account_id,dr,cr,cc_id,project_id}]`) · seed สร้าง lines สมดุล DR=CR จากยอด mock |
| C10 | badge เลข hardcode ใน NAV | production = count จาก query จริง (กลไก mock — กฎ §0 ข้อ 3) |

> **ความขัดแย้งอื่นใดนอกตารางนี้ → BLOCKERS.md เท่านั้น** — ห้ามตัดสินเอง ห้ามเดา ห้ามเลือกเอง

# Juneflow — Bootstrap Manifest v3 สำหรับ Claude Code

> **v3 (6 ก.ค. 2569)** — changelog: v3 = v2 + กลุ่ม 6 Claude harness (`.claude/`) + ด่าน 4.5 (diff-reviewer ก่อน auto-merge) + hook enforcement (protect-files.sh, exit 2)
> **v2 (6 ก.ค. 2569)** — อัปเดตหลังได้ผลถอด prototype จริง (Cowork pack 8 ไฟล์)
> คำสั่งถึง Claude Code: สร้างไฟล์ทั้งหมดตาม manifest นี้ใน repo `juneflow`
> ลำดับการสร้าง: กลุ่ม 0 → 1 → 2 → 3 → 4 → 5 → 6 (ห้ามข้ามลำดับ)
> ส่วนที่ระบุ **[TBD-MVP]** ให้ใส่ TODO marker — Wei จะเติมเมื่อปิดนิยาม MVP

---

## กลุ่ม 0 — Design Fidelity Protocol (กฎหมายสูงสุด — ฝังใน PLAN.md §0 และ root CLAUDE.md)

**Prototype อยู่ที่ `~/Documents/juneflow/pototype/`** (สะกด "pototype" ตามจริง) — เปิดดูพฤติกรรมจริงผ่าน `pototype/Juneflow Fiori.html`

### กฎ 5 ข้อ — บังคับเคร่งครัด ห้ามละเมิด

1. **สิ่งที่ผู้ใช้เห็น/กด/อ่าน ต้องตรง pototype 100%** — เลย์เอาต์ โครงเมนู ป้ายข้อความ สี ระยะ พฤติกรรมปุ่ม/modal/ฟอร์ม state ของทุกจอ ห้ามออกแบบใหม่ ห้าม "ปรับปรุงให้ดีขึ้น" ห้ามใช้ component library หน้าตาอื่น
2. **แหล่งอ้างอิงบังคับต่อเรื่อง (ทั้งหมดถอดจาก pototype แล้ว — ใช้ตามนี้ ห้ามตีความใหม่):**
   - โครงเมนู/route ทุกตัว → `docs/extract/NAV-ROUTES.md` (ถอดจาก chrome.jsx + shell.jsx)
   - กติกาแพ็กเกจ S/M/L/Full + sub rules + โควต้า AI → `docs/extract/PACKAGE-RULES.md`
   - ประเภทโครงการ 4 แบบ + hierarchy + modules + route gating → `docs/extract/PROJECT-TYPES.md`
   - คำแปลทุกข้อความ 4 ภาษา (th/zh/en/ar+RTL) → `docs/extract/i18n-full.json` — **ห้ามแปลใหม่แม้แต่คำเดียว** ข้อความที่ไม่มีในไฟล์นี้ = เข้า BLOCKERS
   - สี/ฟอนต์/ระยะ/รัศมี → `packages/tokens` (จาก tokens.css/tokens.json ธีม fiori) — ห้าม hardcode ค่าใดๆ
   - ภาพอ้างอิงทุกจอ → `pototype/gallery/g1–g5` (102 .jpg) (นับจริงบนดิสก์ = 106 — ดู B-001) + `pototype/shots/` (22 .png) — คือ reference ของ visual gate
   - พฤติกรรมละเอียดระดับปุ่ม → โค้ด `.jsx` ต้นทาง + `design_handoff_juneflow/FUNCTIONS.md`
3. **Fidelity = สิ่งที่ผู้ใช้เห็น ไม่ใช่กลไกภายในของ prototype** — สิ่งต่อไปนี้เป็นกลไก mock ห้ามลอกเข้า production: FK เป็นข้อความชื่อ (ต้องเป็น `*_id` จริงตาม dictionary), การแปลด้วย DOM MutationObserver (production ใช้ key-based t() โดยคำแปลจาก i18n-full.json), badge ตัวเลข hardcode ใน NAV (ต้องมาจาก query จริง), ข้อมูล seed ใหม่ทุก reload (ต้อง persist), `Math.round(price*10)` ฯลฯ ให้คงเป็น business rule ตามโค้ด
4. **ห้ามลอกบั๊ก และห้ามตัดสินความขัดแย้งเอง** — ทุกข้อใน `docs/extract/GAPS.md` และตารางคำตัดสิน (ท้าย manifest) คือคำตัดสินของ Wei · เจอความขัดแย้งใหม่ที่ไม่อยู่ในตาราง → เขียน BLOCKERS.md แล้วข้ามไป task อื่น **ห้ามเดา ห้ามเลือกเอง**
5. **นอกขอบเขตเด็ดขาด:** `pototype/wat/` + `บุญบัญชี*.html` (แอปการเงินวัด — คนละผลิตภัณฑ์), ไฟล์โค้ดตาย `finance.jsx` และ `tweaks-panel.jsx` (ไม่ถูกโหลด/ไม่ถูก route), ไฟล์ standalone build ทุกตัว (2–9 MB), ธีม `Juneflow Ant Pro*` (ใช้ Fiori เท่านั้น)

### Visual Gate (นิยามการ "ตรง Design")
- ทุกจอที่สร้างต้อง screenshot เทียบภาพอ้างอิงใน `tests/visual/reference/` (ก๊อปจาก `pototype/gallery/` + `shots/`)
- เทียบ: โครงเลย์เอาต์, ลำดับ/ป้ายเมนูและคอลัมน์, token สี, ตำแหน่ง KPI/ปุ่ม/แท็บ — ต่างได้เฉพาะตัวเลขข้อมูล (มาจาก seed) และสิ่งที่ Wei อนุมัติผ่าน BLOCKERS
- จอที่ไม่มีภาพอ้างอิง → เปิด `Juneflow Fiori.html` จอเดียวกัน แคปเป็น reference ก่อนเริ่มสร้าง

---

## กลุ่ม 1 — เอกสารแผนกลาง (root)

### 1.1 `PLAN.md` — 13 sections

0. **Design Fidelity Protocol** — เนื้อหากลุ่ม 0 ทั้งก้อน (วางเป็น section แรกสุด)
1. **Vision & Scope** — Construction ERP + Subscription SaaS multi-tenant · 7 process flows · 44 เมนูหลัก/100+ จอ (ตาม NAV-ROUTES.md) · 4 project types · source of truth: pototype = พฤติกรรม+visual, `design_handoff_juneflow/flows.html` = state machine + approval matrix, `data-dictionary.html`+`erd.html` = โครง DB ฐาน, `api-contract.md` = โครง API, `docs/extract/*` = ข้อเท็จจริงถอดจากโค้ด
2. **MVP Definition** — **[TBD-MVP]**
3. **Tech Stack & Rationale** — ตารางภาคผนวก A + เหตุผลไม่ใช้ Clerk / Firebase / Next.js / Supabase
4. **Global-readiness (hard req.)** — UTC ทุก timestamp + timezone/calendar (พ.ศ./ค.ศ.) เป็น setting · เงินทุกคอลัมน์มี `currency_code` + functional currency ต่อ tenant · พื้นที่ที่ดินเก็บตารางเมตร แปลงตอนแสดง (ไร่-งาน-วา/acre/ha) · compliance เป็น interface: `TaxEngine` / `BankFileFormatter` / `NotificationAdapter` (impl แรก = thailand)
5. **Architecture** — โครง monorepo · tenant scope `company_id` ผ่าน middleware ทุก query · OpenAPI = contract เดียว (FE/Mobile gen client ห้ามเขียน model มือ) · async jobs (BullMQ: export/e-Tax/notification/PM schedule gen) · `POST /files` presigned → R2 → DMS อัตโนมัติ + link_module · ทุก mutation เขียน AuditLog ผ่าน middleware · quota → 402 QUOTA_EXCEEDED + upgrade_url
6. **Data Model Strategy** — data-dictionary (~34 entities) เป็นฐาน + **ส่วนขยายบังคับจาก pototype ที่ dictionary ไม่มี** (ดูภาคผนวก B) · schema gate = dictionary + ภาคผนวก B · mock ใน .jsx → แปลงเป็น seed (จำนวน record ตาม `docs/extract/MOCK-DATA.md` §สรุป) โดย normalize FK ข้อความ → `*_id` จริง
7. **Phase Plan** — Phase 0: scaffold+schema+auth+OpenAPI+tokens pipeline+loop runner (Backend เดี่ยว) · 1: Auth+Master+โครงการ · 2: BOQ+จัดซื้อ+Inventory · 3: การเงิน-บัญชี (+Integrations เข้า) · 4: ผู้รับเหมา+ตรวจรับ+PM (+Mobile เข้า) · 5: ขาย/ที่ดิน/โซลาร์ · 6: Subscription platform+LINE OA · ระบุ milestone + agent เข้า-ออกต่อเฟส
8. **Agent Team & Ownership** — 6 ตำแหน่ง: Backend/Platform (`apps/api`+`packages/db`, เจ้าของ OpenAPI คนเดียว) · Frontend Web (`apps/web`) · Mobile (`apps/mobile`, Flutter) · QA (`tests/`) · Integrations (`packages/tax-engine|bank-file|notifications`) · DevOps (`infra/`, หมุนเวียน) · หนึ่ง agent = หนึ่ง worktree = หนึ่งเขต · contract change ผ่าน Wei เท่านั้น
9. **Verification Gates (นิยาม Done)** — (1) schema ตรง dictionary+ภาคผนวก B (2) contract test จาก OpenAPI (3) unit business logic: posting rules, ตัด remain BOQ, retention, approval matrix, quota, งวดงาน 4 basis (4) E2E Playwright ตาม state machine ใน flows.html (5) **visual gate ตามกลุ่ม 0**
10. **Autonomous Loop Protocol** — ลูปต่อ agent: หยิบ task `ready` ในเขต → อ่าน spec → implement ใน worktree → รัน gates → เขียว: ผ่าน**ด่าน 4.5** (subagent `.claude/agents/diff-reviewer.md` ตัดสิน PASS/FAIL — FAIL = ไม่ merge, task กลับ rework) แล้วจึง auto-merge `dev` + อัปเดต TASKS.md + journal / แดง: วนแก้ (เพดาน 3 รอบ) / ตัน: BLOCKERS.md แล้วข้าม task · Guardrails: sacred files (OpenAPI, merged migrations, CLAUDE.md ทุกใบ, CI config, secrets, `docs/extract/*`, i18n-full.json) แก้ผ่าน blocker เท่านั้น — sacred files ถูกบังคับเชิงกลไกด้วย hook `.claude/hooks/protect-files.sh` (PreToolUse, exit 2) ปลดล็อกได้เฉพาะ `SACRED_OVERRIDE=wei-approved:B-xxx` ที่ Wei อนุมัติใน BLOCKERS.md · no-progress = diff ว่าง 2 รอบติด → park · เพดาน token/งบต่อคืนต่อ agent · Review: `feature → dev (auto เมื่อ CI เขียว + diff-reviewer PASS) → main (Wei promote คนเดียว)` · Wei ตรวจ batch: REVIEW-QUEUE + BLOCKERS → คลิกเล่นบน dev เทียบ gallery → ผ่าน=promote / ไม่ผ่าน=rework task · คิว ready ≥5 task/agent ตลอดเวลา
11. **Open Questions** — [TBD-MVP] · approval matrix fix หรือ configurable ต่อบริษัท · COA seed (COA_SEED 23 บัญชีใน pototype เป็นจุดตั้งต้น — รอนักบัญชี validate + posting rules ต่อชนิดเอกสาร) · doc numbering (DOCNUM_SEED 10 แบบเป็นจุดตั้งต้น) · offline-first ระดับ (ก) หรือ (ข)
12. **Out of Scope / Deferred + trigger** — `wat/` (คนละผลิตภัณฑ์) · AI QTO engine จริง (Python/ifcopenshell — UI/flow ทำตาม pototype ด้วย fake result ก่อน) · multi-currency เต็มรูป · Stripe/USD · SSO/SAML · multi-region · RLS · FCM native push

### 1.2 `CLAUDE.md` (root — ≤60 บรรทัด)
- ภาพรวม 3 บรรทัด + ชี้ PLAN.md
- **Design Fidelity: pototype คือกฎหมาย — ทำตามกฎ 5 ข้อใน PLAN.md §0 เคร่งครัด ห้ามละเมิด ห้ามตัดสินความขัดแย้งเอง (→ BLOCKERS.md)**
- คำสั่งพื้นฐาน: pnpm / turbo / docker compose / flutter
- กฎเหล็ก: OpenAPI คือ contract · ทุก mutation → AuditLog · เงินมี currency_code · เวลา UTC · ห้าม commit main · Done = gates ครบ 5
- ภาษา: โค้ด/comment อังกฤษ · UI copy ผ่าน i18n key จาก i18n-full.json เท่านั้น
- โหมด loop: งานจาก TASKS.md เฉพาะเขตตัวเอง · escalate ผ่าน BLOCKERS.md · ห้ามแตะ sacred files

---

## กลุ่ม 2 — CLAUDE.md ประจำเขต (6 ใบ · ≤60 บรรทัด/ใบ)

| ไฟล์ | เนื้อหาหลัก (เพิ่มจาก root) |
|---|---|
| 2.1 `apps/api/CLAUDE.md` | เจ้าของ OpenAPI คนเดียว · pattern ตาม api-contract.md (สถานะเปลี่ยนผ่าน action endpoint) · tenant scope ทุก query · Drizzle migration เท่านั้น · state machine ตาม flows.html + คำตัดสิน GAPS · quota → 402 |
| 2.2 `apps/web/CLAUDE.md` | **Design Fidelity เข้มสุดในเขตนี้:** port จาก `pototype/*.jsx` ตรงๆ (ยกเว้นไฟล์ excluded) · token จาก packages/tokens ห้าม hardcode · ทุกข้อความ = key จาก i18n-full.json · empty state + loading ตามกติกา tokens.css · เลข class `num` tabular ชิดขวา · client จาก codegen · ทุกจอผ่าน visual gate ก่อนนับ done |
| 2.3 `apps/mobile/CLAUDE.md` | Flutter · theme gen จาก tokens.json ห้ามแก้มือ · Dart client จาก OpenAPI · spec = gallery mobile + `mobile*.jsx` (31 จอ) เขียนใหม่เป็น widget ให้ visual ตรง · offline queue (ระดับตาม Open Q) · LINE LIFF ไม่อยู่เขตนี้ (React web) |
| 2.4 `tests/CLAUDE.md` | เขียน test จาก flows.html + NAV-ROUTES + PACKAGE-RULES + PROJECT-TYPES + gallery — **ห้ามอ่าน implementation ก่อนเขียน expected** · visual gate: reference จาก `pototype/gallery`+`shots` · test data จาก seed กลาง |
| 2.5 `packages/integrations/CLAUDE.md` | ทุกตัว implement interface กลาง · mock-first (fake adapter สำหรับ e-Tax/KBANK/LINE) · ฟอร์มภาษีไทยต้อง render ตรง `tax-forms.jsx` (accurate to RD originals) · credentials ผ่าน env |
| 2.6 `infra/CLAUDE.md` | Compose · CI stages ตาม 5 gates · ห้าม secrets ใน repo · runbook: deploy dev / promote main / restore DB |

---

## กลุ่ม 3 — ไฟล์สถานะ Loop

| ไฟล์ | โครงสร้าง |
|---|---|
| 3.1 `TASKS.md` | task: id · เขต · สถานะ (ready/doing/blocked/review/done) · ชี้ spec · gates · ขนาด ≤2–3 ชม. · เริ่มต้น: แตก task Phase 0 ตามกลุ่ม 5 |
| 3.2 `BLOCKERS.md` | id · task · คำถาม · ตัวเลือกที่เสนอ · คำตอบ Wei · สถานะ — **ช่องทางเดียวสำหรับความขัดแย้ง design/spec ทุกกรณี** |
| 3.3 `REVIEW-QUEUE.md` | งานเขียวบน dev รอ Wei promote: task id · โมดูล · diff · ภาพเทียบ gallery |
| 3.4 `agents/journal/{backend,web,mobile,qa,integrations,devops}.md` | บันทึกต่อรอบ: ทำอะไร/ตัดสินใจอะไร/เจออะไร |

---

## กลุ่ม 4 — Loop Infrastructure

| ไฟล์ | หน้าที่ |
|---|---|
| 4.1 `scripts/loop-runner.sh` | วน Claude Code headless ต่อ agent: อ่าน TASKS.md → หนึ่ง task → เช็ค exit · พารามิเตอร์: agent, เพดานรอบ, เพดานงบ · no-progress detection · เขียน journal |
| 4.2 `scripts/loop-config.json` | agent + เขต + branch + เพดานรอบ/งบต่อคืน |
| 4.3 `.github/workflows/ci.yml` | lint+typecheck → migration check → contract → unit → E2E → visual · เขียว auto-merge feature→dev · main ล็อกให้ Wei |
| 4.4 `.github/CODEOWNERS` | ล็อกเขตต่อ agent + sacred files (รวม `docs/extract/`) |

---

## กลุ่ม 5 — Repo Scaffold (Phase 0)

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
│  └─ extract/         # ก๊อป Cowork pack 8 ไฟล์: INVENTORY, NAV-ROUTES, PACKAGE-RULES,
│                      #   PROJECT-TYPES, I18N-KEYS, i18n-full.json, MOCK-DATA, GAPS  ← sacred
├─ PLAN.md · CLAUDE.md · TASKS.md · BLOCKERS.md · REVIEW-QUEUE.md
```

ข้อกำหนด Phase 0: `docker compose up` เดียวได้ระบบ+seed คลิกเทียบ gallery ได้ · โมดูลไม่เสร็จซ่อนหลัง feature flag — dev เขียว/demo ได้ตลอด

---

## กลุ่ม 6 — Claude Code Harness (`.claude/`)

> องค์ประกอบตายตัว: **5 hooks + `settings.json` + 4 skills + 3 subagents** — ห้ามเพิ่ม/ลด/เปลี่ยนชื่อโดยไม่ผ่าน Wei
> v3 กำหนดเฉพาะจำนวน — รายชื่อชุดนี้คือคำเลือกของ orchestrator (ดู B-003 ใน `BLOCKERS.md`)

### 6.1 Hooks (5 ตัว — `.claude/hooks/`)

สัญญา exit code ของ PreToolUse hook ทุกตัว: **exit 0 = อนุญาต · exit 2 = บล็อก** (ข้อความ stderr แสดงต่อ model เป็นเหตุผลที่ถูกบล็อก)

| Hook | Event (matcher) | หน้าที่ |
|---|---|---|
| `protect-files.sh` | PreToolUse (Edit · Write · MultiEdit · NotebookEdit) | บล็อกการเขียน sacred files (PLAN.md §0 + §10) — **fail-closed** (payload อ่านไม่ได้ = บล็อก) · ปลดล็อกได้เฉพาะ env `SACRED_OVERRIDE=wei-approved:B-xxx` ที่อ้าง blocker id ที่ Wei อนุมัติแล้วใน BLOCKERS.md |
| `zone-guard.sh` | PreToolUse (Edit · Write · MultiEdit · NotebookEdit) | บังคับ "หนึ่ง agent = หนึ่งเขต" (PLAN.md §8) ระหว่างรันลูป (`LOOP_AGENT` set) — เขตอ่านจาก `scripts/loop-config.json` · นอกเขตอนุญาตเฉพาะ TASKS.md · BLOCKERS.md · REVIEW-QUEUE.md · journal ของตัวเอง · fail-open |
| `i18n-guard.sh` | PreToolUse (Edit · Write · MultiEdit) | บล็อกข้อความไทย hardcode ในโค้ด UI (`apps/web/src/**/*.ts(x)` · `apps/mobile/lib/**/*.dart`) — UI copy ต้องเป็น i18n key จาก i18n-full.json (PLAN.md §0 กฎข้อ 2) · fail-open |
| `block-main-commit.sh` | PreToolUse (Bash) | บล็อก `git commit`/`git push` ขณะอยู่บน main และบล็อก force-push เข้า main ทุกกรณี — บังคับ flow `feature → dev → main (Wei คนเดียว)` · fail-open |
| `journal-append.sh` | Stop | จบรอบลูป → append บรรทัด timestamp ลง `agents/journal/<agent>.md` (เฉพาะเมื่อ `LOOP_AGENT` set) — ไม่บล็อกอะไร (exit 0 เสมอ) |

### 6.2 `settings.json` wiring

- `PreToolUse` matcher `Edit|Write|MultiEdit|NotebookEdit` → รันตามลำดับ: `protect-files.sh` → `zone-guard.sh` → `i18n-guard.sh`
- `PreToolUse` matcher `Bash` → `block-main-commit.sh`
- `Stop` → `journal-append.sh`
- ทุกคำสั่งอ้าง path ผ่าน `"$CLAUDE_PROJECT_DIR/.claude/hooks/<name>.sh"`

### 6.3 Skills (4 ตัว — `.claude/skills/<name>/SKILL.md`)

| Skill | หน้าที่ |
|---|---|
| `loop-task` | ขั้นตอนมาตรฐาน "หนึ่งรอบ" ของ autonomous loop (PLAN.md §10): หยิบ task `ready` ในเขตจาก TASKS.md → implement ใน worktree → รัน 5 gates → อัปเดต TASKS.md / REVIEW-QUEUE.md / BLOCKERS.md / journal — คือรอบที่ `scripts/loop-runner.sh` เรียกแบบ headless |
| `port-screen` | port หนึ่งจอจาก `pototype/*.jsx` เข้า `apps/web` แบบ fidelity 100% (PLAN.md §0): หา route ใน NAV-ROUTES → port source .jsx → ตัดกลไก mock → ต่อ i18n key + tokens + API client จาก codegen → ใช้คำตัดสิน C1–C10 → ปิดท้ายด้วย skill `visual-gate` |
| `visual-gate` | รัน Visual Gate (G5 — PLAN.md §0 + §9): build/รันแอป → screenshot ทุกจอที่สร้าง/แก้ด้วย Playwright → เทียบ `tests/visual/reference/` (gallery 106 .jpg + shots 22 .png — ห้ามแก้ reference) → จอที่ไม่มี reference ให้แคปจาก prototype ก่อน → บันทึกผลต่อจอลง REVIEW-QUEUE.md |
| `run-gates` | รัน 5 ด่าน Done ในเครื่อง (PLAN.md §9: schema · contract · unit · E2E · visual) + mapping CI stages (`.github/workflows/ci.yml`) + ขั้นตอน**ด่าน 4.5** (diff-reviewer) ก่อน auto-merge + การแพ็กหลักฐานลง REVIEW-QUEUE.md + **runbook infra** (deploy dev / promote main / restore DB — `infra/CLAUDE.md` ชี้มาที่ section นี้) |

### 6.4 Subagents (3 ตัว — `.claude/agents/`)

| Subagent | หน้าที่ |
|---|---|
| `diff-reviewer` | **= ด่าน 4.5** — ผู้ตรวจ diff อ่านอย่างเดียว หลัง gates ในเครื่องเขียวครบ ก่อน push feature branch (push แล้ว CI เขียว = auto-merge `feature → dev` อัตโนมัติ): ตรวจ sacred files · ขอบเขต zone (loop-config) · design fidelity (tokens / i18n / กลไก mock) · คำตัดสิน C1–C10 · loop bookkeeping (TASKS.md / REVIEW-QUEUE.md) · test coverage ของ logic ที่แก้ — ตัดสิน **PASS = push/merge ต่อได้ / FAIL = ไม่ push ไม่ merge, task กลับ rework** |
| `visual-gate-runner` | รัน skill `visual-gate` (G5) ต่อรายการจอที่ได้รับมอบหมาย — รายงาน PASS/FAIL ต่อจอ + diff notes + รายการ reference-missing · read-only ต่อ `tests/visual/reference/` และ `pototype/` |
| `spec-scout` | ผู้ตอบคำถาม expected behavior แบบอ่านอย่างเดียว — ตอบจาก `pototype/*.jsx` + `docs/extract/*` + `docs/handoff/*` เท่านั้น พร้อม citation · **ห้ามอ่านโค้ด implementation ใน `apps/`** · ความขัดแย้งนอกภาคผนวก C → ร่างข้อความ BLOCKERS.md แทนการตัดสินเอง |

### 6.5 กฎ CLAUDE.md = directive-only

- CLAUDE.md ทุกใบ (root + 6 เขต) มีได้เฉพาะ **กฎ / ข้อบังคับ / ข้อเท็จจริง / pointer** — ห้ามมีขั้นตอน HOW-TO หลายสเต็ป
- ขั้นตอนปฏิบัติทั้งหมดอยู่ใน `.claude/skills/` แล้วให้ CLAUDE.md ชี้ด้วย pointer บรรทัดเดียว (เช่น "ขั้นตอน visual gate → `.claude/skills/visual-gate`" · runbook infra → skill `run-gates` section "Runbook infra")
- เพดานเดิมคงอยู่: **≤60 บรรทัด/ใบ**

---

## ภาคผนวก A — Tech Stack (สำหรับ PLAN.md §3)

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

## ภาคผนวก B — ส่วนขยาย schema บังคับ (มีใน pototype แต่ไม่มีใน data-dictionary — ออกแบบจากจอ+mock ตาม MOCK-DATA.md)

Inventory (Item/Warehouse/StockTransfer/MaterialIssue) · Lead/CRM (5 stage funnel) · ServiceTicket (After-sales แจ้งซ่อม) · Solar (Inverter O&M/PPA invoice/ROI/Permit steps/Warranty registry) · Timeline (Task/Milestone Gantt) · PettyCash transaction · OrgStructure (ORG_SEED) · DocNumbering (DOCNUM_SEED) · Retention ledger · RevRec/WIP · AR CreditNote · BidComparison · Role.perms matrix (11 โมดูล × 5 สิทธิ์) · Multi-company ในเครือ (COMPANIES + docPrefix)

## ภาคผนวก C — คำตัดสินความขัดแย้ง (จาก GAPS.md — คำตอบ Wei มีผลเหนือทุกไฟล์)

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
| C10 | badge เลข hardcode ใน NAV | production = count จาก query จริง (กลไก mock — กฎกลุ่ม 0 ข้อ 3) |

> ความขัดแย้งอื่นใดนอกตารางนี้ → BLOCKERS.md เท่านั้น

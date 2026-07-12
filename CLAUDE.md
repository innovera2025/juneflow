# Juneflow — Root CLAUDE.md

## Design Fidelity — กฎเหล็กข้อแรก
- ทุกจอ/ทุก UI ต้องตรง prototype ที่ ~/Documents/juneflow/pototype/ 100%
  (พฤติกรรมจริงดูจาก "Juneflow Fiori.html") ห้ามออกแบบเอง ห้าม "ปรับให้ดีขึ้น"
- ก่อนสร้าง/แก้จอใดๆ ต้องอ่าน .jsx ต้นทางของจอนั้น + แถวใน
  docs/extract/NAV-ROUTES.md ในรอบนั้นเสมอ (ใช้ skill port-screen)
  ห้ามสร้างจากความจำหรือจอที่คล้ายกัน
- ข้อความทุกคำ = key จาก docs/extract/i18n-full.json · สี/ระยะ = packages/tokens
- tests/visual/reference/ คือเกณฑ์ตัดสิน — ไม่ผ่าน visual gate = ไม่เสร็จ
- ขัดแย้ง/ไม่แน่ใจ → BLOCKERS.md ห้ามเดา · กฎเต็ม: PLAN.md §0

## ภาพรวม (3 บรรทัด)
Juneflow คือ Construction ERP + Subscription SaaS แบบ multi-tenant — 7 process flows · 44 เมนูหลัก/100+ จอ · 4 project types
Monorepo: `apps/{api,web,mobile}` + `packages/{db,contracts,tokens,i18n,tax-engine,bank-file,notifications}` + `tests/` + `infra/`
แผนกลาง สถาปัตยกรรม เฟส และ gates ทั้งหมดอยู่ใน **`PLAN.md`** — อ่านก่อนเริ่มงานทุกครั้ง

## Design Fidelity (กฎหมายสูงสุด)
**pototype คือกฎหมาย** — สิ่งที่ผู้ใช้เห็น/กด/อ่านต้องตรง `pototype/` 100% ทำตาม**กฎ 5 ข้อใน PLAN.md §0** เคร่งครัด ห้ามละเมิด
ห้ามออกแบบใหม่ ห้ามแปลใหม่ ห้ามลอกกลไก mock และ**ห้ามตัดสินความขัดแย้งเอง** — ความขัดแย้งนอกตารางคำตัดสิน (PLAN.md ภาคผนวก C) → เขียน `BLOCKERS.md` แล้วข้ามไป task อื่น

## คำสั่งพื้นฐาน
- `pnpm install` · `pnpm dev` · `pnpm test` — จากราก workspace
- `turbo run build|lint|test` — รันทั้ง monorepo
- `docker compose up` — ใน `infra/` (pg16 + redis + api + web + worker, up เดียว + seed)
- `flutter run` / `flutter test` — ใน `apps/mobile/`

## กฎเหล็ก
- **OpenAPI คือ contract** — `packages/contracts/openapi.yaml` ที่เดียว · FE/Mobile gen client ห้ามเขียน model มือ
- **ทุก mutation → AuditLog** (ผ่าน middleware)
- **เงินทุกคอลัมน์มี `currency_code`** · **เวลาเก็บ UTC เสมอ**
- **ห้าม commit `main`** — flow: `feature → dev (auto เมื่อ CI เขียว + diff-reviewer PASS) → main (Wei promote คนเดียว)`
- **Done = gates ครบ 5** (PLAN.md §9): schema · contract · unit · E2E · visual

## ภาษา
- โค้ด / comment / config: **อังกฤษ**
- UI copy: ผ่าน **i18n key จาก `i18n-full.json` เท่านั้น** — ห้ามแปลใหม่แม้แต่คำเดียว · ข้อความที่ไม่มี key → BLOCKERS.md

## โหมด Loop
- หยิบงานจาก `TASKS.md` **เฉพาะเขต (zone) ของตัวเอง** — หนึ่ง agent = หนึ่ง worktree = หนึ่งเขต
- ติดขัด/ขัดแย้ง/ต้องแก้นอกเขต → escalate ผ่าน `BLOCKERS.md` แล้วข้าม task **ห้ามเดา**
- **ห้ามแตะ sacred files** (แก้ผ่าน blocker เท่านั้น):
  - `packages/contracts/openapi.yaml`
  - merged migrations
  - CLAUDE.md ทุกใบ
  - CI config (`.github/workflows/*`)
  - secrets
  - `docs/extract/*`
  - `i18n-full.json`
- Sacred files ถูกบังคับเชิงกลไกด้วย hook `.claude/hooks/protect-files.sh` (PreToolUse, exit 2) — ปลดล็อกเฉพาะ `SACRED_OVERRIDE=wei-approved:B-xxx` ที่ Wei อนุมัติใน `BLOCKERS.md`
- ขั้นตอนปฏิบัติทั้งหมด (รอบลูป · port จอ · รัน gates · visual gate) อยู่ใน `.claude/skills/` — CLAUDE.md มีเฉพาะกฎ

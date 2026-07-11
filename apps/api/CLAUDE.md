# apps/api — เขต Backend/Platform · อ่านราก `CLAUDE.md` + `PLAN.md` §0 (Design Fidelity Protocol) ก่อนเริ่มงานทุกครั้ง

## เขตความรับผิดชอบ
- เขตนี้ = `apps/api` + `packages/db` (PLAN.md §8) — Fastify + TS · better-auth · BullMQ worker
- **เจ้าของ OpenAPI คนเดียว** — `packages/contracts/openapi.yaml` แก้ได้จากเขตนี้เท่านั้น
  แต่ contract change ทุกครั้งต้องผ่าน Wei อนุมัติก่อน merge (sacred file — PLAN.md §8/§10)

## กติกา endpoint (ตาม `docs/handoff/api-contract.md`)
- Pattern มาตรฐานทุก resource: `GET /x?filter&page` · `GET /x/:id` · `POST /x` · `PUT /x/:id`
- **สถานะเปลี่ยนผ่าน action endpoint เท่านั้น** เช่น `POST /x/:id/approve` — ห้ามเปลี่ยน status ด้วย PUT ตรง
- FE/Mobile generate client จาก openapi.yaml — ห้ามปล่อยให้ contract drift จาก implementation

## Tenant scope + Audit (บังคับ)
- `company_id` บังคับผ่าน middleware **ทุก query** — ห้ามมี query ใดหลุด scope แม้แต่จุดเดียว
- ทุก mutation เขียน AuditLog ผ่าน middleware — ไม่เขียนมือรายจุด

## Database
- **แก้ schema ผ่าน Drizzle migrations เท่านั้น** — ห้าม SQL มือนอก migration · merged migrations = sacred
- ฐาน schema = data-dictionary + ภาคผนวก B (PLAN.md §6) · เงินทุกคอลัมน์มี `currency_code` · เวลาเก็บ UTC เสมอ

## State machines
- ทุก flow ทำตาม state machine ใน `docs/handoff/flows.html` + คำตัดสิน GAPS ใน **PLAN.md ภาคผนวก C**
  (เช่น C3 WorkPeriod states · C4 e-Tax status superset) — ความขัดแย้งนอกตาราง → `BLOCKERS.md` ห้ามตัดสินเอง

## Quota
- เกินโควต้าแพ็กเกจ/AI (ตาม `docs/extract/PACKAGE-RULES.md`) → ตอบ **HTTP 402 `QUOTA_EXCEEDED` + `upgrade_url`** เสมอ

# tests/contract/ — Contract test harness (Gate G2)

> เขต QA — อ่าน `tests/CLAUDE.md` + ราก `CLAUDE.md` + `PLAN.md` §0 ก่อนเริ่มงานทุกครั้ง

## หลักการ (กฎเหล็ก)

- Contract test ทั้งหมด **generate จาก `packages/contracts/openapi.yaml`** (openapi.yaml สร้างจาก `docs/handoff/api-contract.md` — P0-BE-12)
- **ห้ามเขียน model มือเด็ดขาด** — ทุก type/schema/expected ที่ใช้ตรวจต้องมาจาก codegen ของ contract เท่านั้น (PLAN.md §5: "OpenAPI = contract เดียว")
- **expected มาจาก contract เท่านั้น — ห้ามอ่าน implementation ก่อนเขียน expected** (กฎเหล็กของเขตนี้ตาม `tests/CLAUDE.md`)
- `openapi.yaml` = sacred file — เจอ contract ขัดกับ implementation → เขียน `BLOCKERS.md` แล้วข้ามไป task อื่น **ห้ามตัดสินเอง**
- test data ใช้จาก central seed (`packages/db` seed ตาม `docs/extract/MOCK-DATA.md`) เท่านั้น — ห้ามสร้าง fixture เฉพาะกิจที่ขัดกับ seed กลาง

## สถานะ

- **TODO(P0-QA-02):** สร้าง harness ที่ generate contract test จาก `openapi.yaml` แล้วรันกับ dev API (รอ P0-BE-12 done ก่อน)
- รัน: `pnpm --filter @juneflow/tests test:contract` — ตอนนี้ยังไม่มี test = ผ่านเขียวด้วย `--passWithNoTests` (ตั้งใจ ให้ CI เขียวระหว่าง scaffold)

## Gate ที่เกี่ยวข้อง (PLAN.md §9)

- **G2 — Contract test:** generate จาก OpenAPI แล้วต้องผ่านทั้งหมด · ขาด G2 = ไม่ done

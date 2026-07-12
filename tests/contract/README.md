# tests/contract/ — Contract test harness (Gate G2)

> เขต QA — อ่าน `tests/CLAUDE.md` + ราก `CLAUDE.md` + `PLAN.md` §0 ก่อนเริ่มงานทุกครั้ง

## หลักการ (กฎเหล็ก)

- Contract test ทั้งหมด **generate จาก `packages/contracts/openapi.yaml`** (openapi.yaml สร้างจาก `docs/handoff/api-contract.md` — P0-BE-12)
- **ห้ามเขียน model มือเด็ดขาด** — ทุก type/schema/expected ที่ใช้ตรวจต้องมาจาก codegen ของ contract เท่านั้น (PLAN.md §5: "OpenAPI = contract เดียว")
- **expected มาจาก contract เท่านั้น — ห้ามอ่าน implementation ก่อนเขียน expected** (กฎเหล็กของเขตนี้ตาม `tests/CLAUDE.md`)
- `openapi.yaml` = sacred file — เจอ contract ขัดกับ implementation → เขียน `BLOCKERS.md` แล้วข้ามไป task อื่น **ห้ามตัดสินเอง**
- test data ใช้จาก central seed (`packages/db` seed ตาม `docs/extract/MOCK-DATA.md`) เท่านั้น — ห้ามสร้าง fixture เฉพาะกิจที่ขัดกับ seed กลาง

## สถานะ (P0-QA-02 — harness พร้อม)

- `lib/openapi.ts` — engine: โหลด+parse `openapi.yaml` (js-yaml) · resolve `$ref` · แตก paths×methods เป็น operation list (effective security, request/response schema) · minimal structural validator ($ref/allOf/type/required/properties/items/enum/const) — **ทุกค่า derive จาก contract ล้วน ไม่มี model มือ**
- `contract.spec.ts` — **static shape tests (generate ต่อ endpoint)**: unique operationId · ทุก op มี 2xx · auth-required op ต้องมี 401 + Error envelope · requestBody ต้อง resolve · 404 = Error envelope · 402 = `QUOTA_EXCEEDED` + `upgrade_url` · ทุก `$ref` resolve — รันได้เลยไม่ต้องมี dev API
- `live.spec.ts` — **contract vs dev API จริง**: gated ด้วย `CONTRACT_API_URL` (unset → skip เพื่อให้เขียวระหว่าง scaffold · set → รันจริง) · เรียกเฉพาะ side-effect-free: unauth GET → ต้อง 401 + Error envelope · bad login → response ตรง contract-declared shape · ไม่แตะ mutation, ไม่พึ่ง seed

รัน:

```bash
pnpm --filter @juneflow/tests test:contract                                   # static (green ทันที)
CONTRACT_API_URL=http://localhost:3000/api/v1 \
  pnpm --filter @juneflow/tests test:contract                                 # + live vs dev API
```

## Gate ที่เกี่ยวข้อง (PLAN.md §9)

- **G2 — Contract test:** generate จาก OpenAPI แล้วต้องผ่านทั้งหมด · ขาด G2 = ไม่ done

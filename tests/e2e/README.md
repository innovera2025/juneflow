# tests/e2e/ — Playwright E2E harness (Gate G4)

> เขต QA — อ่าน `tests/CLAUDE.md` + ราก `CLAUDE.md` + `PLAN.md` §0 ก่อนเริ่มงานทุกครั้ง

## หลักการ (กฎเหล็ก)

- E2E ทุกตัวเขียนจาก **state machine ใน `docs/handoff/flows.html`** (7 process flows + approval matrix) เท่านั้น
- กฎเหล็กของเขตนี้ตาม `tests/CLAUDE.md`: **ห้ามอ่าน implementation ก่อนเขียน expected values** — กัน test ที่เขียนตามโค้ดที่ผิดแทนที่จะจับผิดโค้ด
- test data ใช้จาก central seed (`packages/db` seed ตาม `docs/extract/MOCK-DATA.md`) เท่านั้น — ห้ามสร้าง fixture เฉพาะกิจที่ขัดกับ seed กลาง
- expected ขัดกันระหว่างไฟล์ spec → เช็ค **PLAN.md ภาคผนวก C** ก่อน (เช่น C3: WorkPeriod states ใช้ตาม flows/dictionary) · นอกตารางคำตัดสิน → เขียน `BLOCKERS.md` **ห้ามตัดสินเอง**

## สถานะ

- **TODO(P0-QA-03):** smoke test แรก (login → shell load) ตาม state machine ใน `docs/handoff/flows.html` — รันบน compose dev (รอ P0-DEV-01)
- config: `playwright.config.ts` — base URL ชี้ dev stack ผ่าน env `E2E_BASE_URL`
- รัน: `pnpm --filter @juneflow/tests test:e2e` — ตอนนี้ยังไม่มี test = ผ่านเขียวด้วย `--pass-with-no-tests` (ตั้งใจ ให้ CI เขียวระหว่าง scaffold)

## Gate ที่เกี่ยวข้อง (PLAN.md §9)

- **G4 — E2E Playwright:** ตาม state machine ใน `flows.html` · ขาด G4 = ไม่ done

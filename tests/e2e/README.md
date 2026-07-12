# tests/e2e/ — Playwright E2E harness (Gate G4)

> เขต QA — อ่าน `tests/CLAUDE.md` + ราก `CLAUDE.md` + `PLAN.md` §0 ก่อนเริ่มงานทุกครั้ง

## หลักการ (กฎเหล็ก)

- E2E ทุกตัวเขียนจาก **state machine ใน `docs/handoff/flows.html`** (7 process flows + approval matrix) เท่านั้น
- กฎเหล็กของเขตนี้ตาม `tests/CLAUDE.md`: **ห้ามอ่าน implementation ก่อนเขียน expected values** — กัน test ที่เขียนตามโค้ดที่ผิดแทนที่จะจับผิดโค้ด
- test data ใช้จาก central seed (`packages/db` seed ตาม `docs/extract/MOCK-DATA.md`) เท่านั้น — ห้ามสร้าง fixture เฉพาะกิจที่ขัดกับ seed กลาง
- expected ขัดกันระหว่างไฟล์ spec → เช็ค **PLAN.md ภาคผนวก C** ก่อน (เช่น C3: WorkPeriod states ใช้ตาม flows/dictionary) · นอกตารางคำตัดสิน → เขียน `BLOCKERS.md` **ห้ามตัดสินเอง**

## สถานะ

- **P0-QA-03 (re-scope B-034):** `smoke.spec.ts` = **reachability smoke จริงบน compose dev** ผ่าน G4 —
  web GET `/` = 200 + Playwright โหลด document ได้ · api `/health` = 200 `{ ok: true }`
  (surface จาก `infra/docker-compose.yml`: web `$WEB_PORT`/5173 · api `$API_PORT`/3000)
- **TODO Phase 1 (P0-WEB-05 / B-020):** smoke "login → shell load" เต็มตาม `extra-screens.jsx` (`ScreenLogin`)
  + app shell + state machine ใน `docs/handoff/flows.html` — ลงเป็น `test.fixme` (todo ที่ยังไม่รัน)
  เพราะ apps/web ยัง render แค่ `Placeholder` (ไม่มี login form/shell) · **ห้าม fabricate flow ที่ยังไม่มีจอ** (PLAN §0 กฎ 1+4)
- config: `playwright.config.ts` — base URL ชี้ dev stack ผ่าน env `E2E_BASE_URL` · api ผ่าน `E2E_API_URL`
- รัน: `pnpm --filter @juneflow/tests test:e2e` (ต้องมี compose dev up)

## Gate ที่เกี่ยวข้อง (PLAN.md §9)

- **G4 — E2E Playwright:** ตาม state machine ใน `flows.html` · ขาด G4 = ไม่ done

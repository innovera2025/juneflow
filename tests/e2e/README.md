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
- **DONE — login → shell load (real G4):** `smoke.spec.ts` ขับ flow จริงตาม `extra-screens.jsx` (`ScreenLogin`)
  + app shell — (1) credential ว่าง → error `login.errRequired` + ไม่ navigate · (2) seed user
  `somchai@rungrueang.co.th` / `juneflow-dev` → bearer-JWT จริง → shell render (aside + nav + header +
  ชื่อจาก GET /me) · selector = i18n key ที่ Thai-ทุกภาษา (B-035/B-036) + โครงสร้าง ไม่ผูก pixel
- **gate `E2E_LIVE`:** ไม่ตั้ง = reachability อย่างเดียว (login → shell ถูก skip · pattern เดียวกับ
  contract `CONTRACT_API_URL`) · `E2E_LIVE=1` = รัน flow เต็มหลัง single-origin proxy
- **`live-proxy.mjs`:** compose `web` (nginx) ไม่ proxy `/api/*` → api · proxy รวม SPA(:5173) + api(:3000)
  เป็น origin เดียว ให้ browser ยิง same-origin `/api/v1` ถึง api จริง (harness plumbing เท่านั้น ไม่แตะ apps/**)
- config: `playwright.config.ts` — base URL ผ่าน `E2E_BASE_URL` (default proxy เมื่อ LIVE) · api /health ผ่าน `E2E_API_URL`
- รัน: `docker compose -f infra/docker-compose.yml up -d --wait` → `E2E_LIVE=1 pnpm --filter @juneflow/tests test:e2e` → `down`

## Gate ที่เกี่ยวข้อง (PLAN.md §9)

- **G4 — E2E Playwright:** ตาม state machine ใน `flows.html` · ขาด G4 = ไม่ done

# Journal — Frontend Web (เขต: `apps/web`)

> บันทึกต่อรอบ loop ตาม PLAN.md §10 — หนึ่ง entry ต่อหนึ่งรอบ · entry ใหม่อยู่บนสุด
> รูปแบบ entry ต่อรอบ:
>
> ```
> ## [YYYY-MM-DD] · รอบที่ N · task: <task id>
> - ทำอะไร: (งานที่ลงมือทำจริงในรอบนี้ + ผล gates — เขตนี้ต้องระบุผล visual gate เสมอเมื่อมีจอ)
> - ตัดสินใจอะไร: (การตัดสินใจในเขตตัวเอง — ความขัดแย้ง design/spec ห้ามตัดสินเอง → BLOCKERS.md)
> - เจออะไร: (สิ่งที่พบ/ติดขัด/blocker ที่เปิด/สิ่งที่ agent รอบถัดไปควรรู้)
> ```

## 2026-07-12 · รอบที่ 3 · task: P0-WEB-06

- ทำอะไร: wire generated API client เข้า `apps/web` (P0-WEB-06). เพิ่ม `src/api-client.ts` = single `apiClient = createClient<paths>()` (openapi-fetch) โดย `paths` re-export จาก `@juneflow/contracts` (openapi-typescript gen จาก `packages/contracts/openapi.yaml`) → **type ของ request/response/param/query ทุกตัวมาจาก contract ล้วน ไม่มี model/fetch เขียนมือ** (PLAN §5 · apps/web/CLAUDE.md "API client") · `baseUrl` = `/api/v1` (servers url ของ contract, override ผ่าน `VITE_API_BASE_URL`) + `credentials:"include"` (better-auth session cookie) · `query-client.ts` เพิ่ม `unwrap` adapter แปลง `{ data, error }` ของ openapi-fetch → value/throw ที่ TanStack Query queryFn ต้องการ (normalise shape เท่านั้น — type ยังไหลจาก contract) · อัปเดต comment `main.tsx` (TODO→DONE WEB-06) · deps: `@juneflow/contracts` (workspace:*) + `openapi-fetch` ^0.17.0 (`pnpm install` +2 pkgs) · **ผล gates (CI: typecheck+build ด้วย generated types เท่านั้น — infra/wiring ไม่มี G1–G5, non-UI → visual gate N/A):** `pnpm turbo run typecheck lint` = **18/18 FULL TURBO** (contracts regenerate `paths` + web typecheck ✓) · `pnpm --filter @juneflow/web run build` = vite 168 modules ✓. **ด่าน 4.5 diff-reviewer = PASS** (reviewer รัน gates ซ้ำเอง 2/2 + build ✓ · sacred untouched · zone เฉพาะ apps/web+lockfile importer · "no hand-written models" CONFIRMED · ไม่แตะ C1–C10) → commit `70879b3` บน `feature/web` · TASKS.md P0-WEB-06 → `review` + แถว REVIEW-QUEUE
- ตัดสินใจอะไร: ไม่มีการตัดสิน design/spec. เลือก **openapi-fetch** (companion ทางการของ openapi-typescript ที่ gen types อยู่แล้ว) แทนการ hand-roll typed client — เพราะมันบริโภค `paths` type ตรงๆ จึงบังคับ "ห้ามเขียน model มือ" ได้เชิงกลไก 100% · `baseUrl` ยึด servers url ที่ contract ประกาศไว้ (ไม่เดา/ไม่ hardcode host) · `unwrap` เป็น shape-normaliser ล้วน (throw บน error) ไม่สร้าง model ใหม่ — cast `data as TData` อยู่หลัง error guard. ไม่มี conflict → ไม่เปิด blocker
- เจออะไร: (1) `@juneflow/contracts` เดิม **ไม่ได้เป็น dependency ของ apps/web** (P0-WEB-01 ใส่แค่ i18n/tokens/tanstack) — ต้องเพิ่ม `workspace:*` เอง · lockfile root +2 importer (contracts link + openapi-fetch) = แพตเทิร์นเดียวกับ P0-INT/P0-BE รอบก่อน (ยอมรับเชิงกลไก) · (2) quick-verify hook typecheck FAIL ทันทีหลังเขียน api-client.ts (module ยังไม่ resolve) → แก้ด้วย `pnpm install` แล้วเขียว — ปกติสำหรับการเพิ่ม dep · (3) คิว `ready` เขต web หลังรอบนี้: P0-WEB-02/03 ยังหยิบได้ (deps P0-WEB-01 done + BE-05 done) แต่ P0-WEB-05 ยัง block (dep 02/03 ยัง `ready` ไม่ `done`) — **คิว ready ที่หยิบได้จริงเหลือ 2 (WEB-02, WEB-03) ต่ำกว่าเกณฑ์ ≥5** → เตือน Wei: promote review-queue (WEB-01/04/06) + เติมคิว Phase 1 web เมื่อ MVP นิยามพร้อม (ห้าม agent สร้าง task ผูก MVP เอง — [TBD-MVP])

## 2026-07-12 · รอบที่ 2 · task: P0-WEB-04

- ทำอะไร: สร้าง `apps/web/docs/port-map.md` — บัญชี port ครบ **76/76** `.jsx` ที่ไม่ถูก exclude (78 ราก − `finance.jsx`/`tweaks-panel.jsx` ตาม PLAN §0 กฎ 5). โครงสร้าง: §1 จอ 46 ไฟล์ (route(s) + ภาพอ้างอิงต่อ route จาก reference-index) · §2 ไม่ใช่จอเดี่ยว 25 (shell/entry/shared/forms/viewer-embed/supporting/config/i18n-source) · §3 mobile-zone 5 (Phase 4 นอกเขต) · §4 route ต้อง cross-check (legacy redirect/badge-C10/parent-nav/gating) · §5 ความไม่ตรงกันของแหล่ง 5 จุด (D1–D5) บันทึกโปร่งใสไม่ตัดสินเอง · §6 สรุปความครบ. แหล่ง: NAV-ROUTES.md (คำตัดสิน route+ไฟล์) + INVENTORY.md §2 + reference-index.md (ภาพต่อ route). **ผล gates:** task นี้เป็น docs inventory ไม่มี G1–G5 (ไม่มีจอ/schema/contract) → gate = ครอบคลุมทุก .jsx ที่ไม่ถูก exclude: ตรวจโปรแกรม `ls pototype/*.jsx` − 2 exclude = 76 ↔ ชื่อไฟล์ในตาราง **76/76 ตรง (0 missing, 0 extra)** · §6 นับ 46+25+5=76 reconcile. visual gate ไม่ applicable (ไม่มีจอ). **ด่าน 4.5 diff-reviewer:** รอบแรก **FAIL** → แก้ → รอบสอง **PASS** → commit `7f6ac4b` บน `feature/web` · TASKS.md P0-WEB-04 → `review` + แถว REVIEW-QUEUE
- ตัดสินใจอะไร: ไม่ตัดสิน design/spec — คอลัมน์ route+ไฟล์ยึด **NAV-ROUTES.md เป็นแหล่งความจริง** (PLAN §0 ข้อ 2) เมื่อ reference-index.md (เอกสาร QA derived) attribute ต่าง → บันทึกเป็น D-note ไม่ silently เลือก. `design-canvas.jsx` (โหลด index.html แต่ไม่มี route) → ไม่ port จน Wei ยืนยันขอบเขต (D4 ไม่เดา). ไม่มี blocker (route มีคำตัดสินชัด — ไม่ใช่ conflict นอกตาราง)
- เจออะไร: (1) **ด่าน 4.5 รอบแรก FAIL** — จับได้ว่า `boq.archive`/`boq.reports` ผมผูกไป `boq-extra.jsx` ตาม reference-index (คอลัมน์ไฟล์) แทน NAV-ROUTES rows 27–28 ที่ระบุ `BOQArchive`/`BOQReports`@**boq.jsx** (RouteView@shell.jsx render จาก boq.jsx) → แก้: boq.jsx ถือครบ 5 route + boq-extra.jsx → `viewer-embed` (รายงานฝัง ไม่ใช่ route target) + เพิ่ม D5 + ปรับนับ §6 (screen 47→46, non-screen 24→25). **บทเรียน: reference-index.md คอลัมน์ 'ไฟล์' เป็น QA-derived ไม่ authoritative — route↔ไฟล์ ต้อง cross-check NAV-ROUTES เสมอ** (D1/D2 ก็มาจากเหตุเดียวกัน) · (2) คิว `ready` เขต web หลังรอบนี้: P0-WEB-02/03/06 ยัง block เพราะ dep P0-WEB-01 อยู่สถานะ `review` (ยังไม่ `done` — รอ Wei promote) · P0-WEB-04 → review · **คิว ready ที่หยิบได้จริงตอนนี้เหลือ 0** (WEB-05 dep 02/03, ทั้งคู่ block) — เตือน Wei: promote P0-WEB-01 เพื่อปลด WEB-02/03/06 มิฉะนั้นเขต web ตันจนกว่า dep ปลด

## 2026-07-12 · รอบที่ 1 · task: P0-WEB-01

- ทำอะไร: wire apps/web skeleton (เดิม scaffold มี package.json/vite/tsconfig/index.html + main.tsx render `PlaceholderShell` เฉยๆ — TanStack Router/Query เป็น dep แต่ยังไม่ต่อ) → เพิ่ม `src/router.tsx` (minimal TanStack Router: root route render `<Outlet/>` + index route render scaffold PlaceholderShell + `Register` module augmentation) + `src/query-client.ts` (single QueryClient) + rewire `src/main.tsx` mount `RouterProvider` ใน `QueryClientProvider` ใน `StrictMode` ใต้ `@juneflow/tokens/src/tokens.css` (fiori). **ผล gates (CI: lint+typecheck+build):** `npx turbo run lint typecheck build --filter=@juneflow/web` = 3 successful (typecheck ✓ · vite build 168 modules ✓ · web ไม่มี lint task → skip · tokens build upstream). visual gate ไม่ applicable รอบนี้ (skeleton ยังไม่มีจอจริง — จอเริ่ม P0-WEB-05). **ด่าน 4.5 diff-reviewer = PASS** → commit `3555f87` บน `feature/web` · TASKS.md P0-WEB-01 → `review` + เพิ่มแถว REVIEW-QUEUE
- ตัดสินใจอะไร: ไม่มีการตัดสินใจ design/spec — เก็บ router เป็น skeleton ขั้นต่ำ (root + index) ตามขอบเขต P0-WEB-01 เท่านั้น · full 44-route tree เป็นของ P0-WEB-02 · ไม่ hardcode ค่า design ใดๆ (grep hex/rgb/px = 0) · comment ทั้งหมดเป็นภาษาอังกฤษ (i18n-guard hook block Thai fragment `"อนุมัติ BOQ"` ที่ตกค้างใน comment เดิม → paraphrase เป็น `approve-BOQ label`)
- เจออะไร: (1) i18n-guard hook (`.claude/hooks/i18n-guard.sh`) บล็อกอักษรไทยแม้อยู่ใน code comment — comment ต้องอังกฤษล้วน · (2) `PlaceholderShell` เป็น scaffold-only (hardcoded English + ไม่มี token style) — diff-reviewer note #4: **ต้องไม่หลุดเข้า P0-WEB-03/05** ให้ port จริงจาก chrome.jsx/shell.jsx แทน · (3) ไม่มี git remote → push→auto-merge เป็นหน้าที่ loop-runner (เหมือน task backend/qa อื่น) · (4) รอบถัดไปในเขต web: P0-WEB-01 done แล้วจะปลด P0-WEB-02/03/06 (deps บน WEB-01) — ตอนนี้ P0-WEB-04 (port-map inventory, deps `—`) ยังหยิบได้เลย

## 2026-07-06 · bootstrap · task: —

- ทำอะไร: bootstrap ไฟล์สถานะ loop ตาม Manifest v2 กลุ่ม 3 · เขต web มี 6 task ใน `TASKS.md` (P0-WEB-01 ถึง P0-WEB-06) สถานะ `ready` — P0-WEB-04 (port-map inventory) เริ่มได้ทันทีโดยไม่รอเขตอื่น
- ตัดสินใจอะไร: ไม่มีการตัดสินใจเชิง design/spec — ความขัดแย้งถูกยกเข้า `BLOCKERS.md` (B-001, B-002)
- เจออะไร: เขตนี้ Design Fidelity เข้มสุด (PLAN.md §0 + กลุ่ม 2.2) — ทุกจอ port ตรงจาก `pototype/*.jsx` · token จาก `packages/tokens` ห้าม hardcode · ทุกข้อความ = key จาก i18n-full.json · task ส่วนใหญ่รอ P0-BE-01/04/05/12 จากเขต backend (ระบุใน dependencies แล้ว)
- 2026-07-12T02:02:15Z loop round ended (agent: web)

## 2026-07-12 09:02 · loop-runner · รอบที่ 1/10 · task: P0-WEB-01
- ทำอะไร: รัน claude headless 1 รอบ · task P0-WEB-01 → สถานะ review · ค่าใช้จ่ายรอบนี้ $2.8817955 (สะสม $2.8818/เพดาน $20)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes
- 2026-07-12T02:14:49Z loop round ended (agent: web)
- 2026-07-12T02:16:53Z loop round ended (agent: web)

## 2026-07-12 09:16 · loop-runner · รอบที่ 2/10 · task: P0-WEB-04
- ทำอะไร: รัน claude headless 1 รอบ · task P0-WEB-04 → สถานะ review · ค่าใช้จ่ายรอบนี้ $7.691627250000001 (สะสม $10.5734/เพดาน $20)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes
- 2026-07-12T02:17:27Z loop round ended (agent: web)

## 2026-07-12 09:17 · loop-runner · คิวว่าง
- ทำอะไร: รอบที่ 3/10: ไม่มี task สถานะ ready ที่ dependencies ครบในเขต web — จบลูป
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: งบสะสม $11.1562/$20 · เติมคิว ready ให้ครบ ≥ 5 task ต่อเขต (PLAN.md §10)

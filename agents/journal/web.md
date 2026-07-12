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

## 2026-07-12 · รอบที่ 1 · task: P0-WEB-01

- ทำอะไร: wire apps/web skeleton (เดิม scaffold มี package.json/vite/tsconfig/index.html + main.tsx render `PlaceholderShell` เฉยๆ — TanStack Router/Query เป็น dep แต่ยังไม่ต่อ) → เพิ่ม `src/router.tsx` (minimal TanStack Router: root route render `<Outlet/>` + index route render scaffold PlaceholderShell + `Register` module augmentation) + `src/query-client.ts` (single QueryClient) + rewire `src/main.tsx` mount `RouterProvider` ใน `QueryClientProvider` ใน `StrictMode` ใต้ `@juneflow/tokens/src/tokens.css` (fiori). **ผล gates (CI: lint+typecheck+build):** `npx turbo run lint typecheck build --filter=@juneflow/web` = 3 successful (typecheck ✓ · vite build 168 modules ✓ · web ไม่มี lint task → skip · tokens build upstream). visual gate ไม่ applicable รอบนี้ (skeleton ยังไม่มีจอจริง — จอเริ่ม P0-WEB-05). **ด่าน 4.5 diff-reviewer = PASS** → commit `3555f87` บน `feature/web` · TASKS.md P0-WEB-01 → `review` + เพิ่มแถว REVIEW-QUEUE
- ตัดสินใจอะไร: ไม่มีการตัดสินใจ design/spec — เก็บ router เป็น skeleton ขั้นต่ำ (root + index) ตามขอบเขต P0-WEB-01 เท่านั้น · full 44-route tree เป็นของ P0-WEB-02 · ไม่ hardcode ค่า design ใดๆ (grep hex/rgb/px = 0) · comment ทั้งหมดเป็นภาษาอังกฤษ (i18n-guard hook block Thai fragment `"อนุมัติ BOQ"` ที่ตกค้างใน comment เดิม → paraphrase เป็น `approve-BOQ label`)
- เจออะไร: (1) i18n-guard hook (`.claude/hooks/i18n-guard.sh`) บล็อกอักษรไทยแม้อยู่ใน code comment — comment ต้องอังกฤษล้วน · (2) `PlaceholderShell` เป็น scaffold-only (hardcoded English + ไม่มี token style) — diff-reviewer note #4: **ต้องไม่หลุดเข้า P0-WEB-03/05** ให้ port จริงจาก chrome.jsx/shell.jsx แทน · (3) ไม่มี git remote → push→auto-merge เป็นหน้าที่ loop-runner (เหมือน task backend/qa อื่น) · (4) รอบถัดไปในเขต web: P0-WEB-01 done แล้วจะปลด P0-WEB-02/03/06 (deps บน WEB-01) — ตอนนี้ P0-WEB-04 (port-map inventory, deps `—`) ยังหยิบได้เลย

## 2026-07-06 · bootstrap · task: —

- ทำอะไร: bootstrap ไฟล์สถานะ loop ตาม Manifest v2 กลุ่ม 3 · เขต web มี 6 task ใน `TASKS.md` (P0-WEB-01 ถึง P0-WEB-06) สถานะ `ready` — P0-WEB-04 (port-map inventory) เริ่มได้ทันทีโดยไม่รอเขตอื่น
- ตัดสินใจอะไร: ไม่มีการตัดสินใจเชิง design/spec — ความขัดแย้งถูกยกเข้า `BLOCKERS.md` (B-001, B-002)
- เจออะไร: เขตนี้ Design Fidelity เข้มสุด (PLAN.md §0 + กลุ่ม 2.2) — ทุกจอ port ตรงจาก `pototype/*.jsx` · token จาก `packages/tokens` ห้าม hardcode · ทุกข้อความ = key จาก i18n-full.json · task ส่วนใหญ่รอ P0-BE-01/04/05/12 จากเขต backend (ระบุใน dependencies แล้ว)

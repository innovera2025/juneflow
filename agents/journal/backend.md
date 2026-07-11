# Journal — Backend/Platform (เขต: `apps/api` + `packages/db`)

> บันทึกต่อรอบ loop ตาม PLAN.md §10 — หนึ่ง entry ต่อหนึ่งรอบ · entry ใหม่อยู่บนสุด
> รูปแบบ entry ต่อรอบ:
>
> ```
> ## [YYYY-MM-DD] · รอบที่ N · task: <task id>
> - ทำอะไร: (งานที่ลงมือทำจริงในรอบนี้ + ผล gates)
> - ตัดสินใจอะไร: (การตัดสินใจในเขตตัวเอง — ความขัดแย้ง design/spec ห้ามตัดสินเอง → BLOCKERS.md)
> - เจออะไร: (สิ่งที่พบ/ติดขัด/blocker ที่เปิด/สิ่งที่ agent รอบถัดไปควรรู้)
> ```

## 2026-07-12 · รอบที่ 2 · task: P0-BE-06

- ทำอะไร: หยิบ P0-BE-06 (`packages/db` — schema กลุ่ม Platform/Tenant) — เป็น ready task ในเขต backend ที่ dep (P0-BE-01) done แล้ว และอยู่ใน writable zone จริง (P0-BE-04 tokens / P0-BE-05 i18n อยู่ใน `packages/tokens`/`packages/i18n` = นอก zonePaths ของ backend agent ตาม loop-config → ข้าม). อ่าน `docs/handoff/data-dictionary.html` ส่วน "Platform / Tenant" แล้ว implement 7 entity เป็น Drizzle schema ที่ `packages/db/src/schema/platform.ts`: company, package, subscription, platform_invoice, ai_usage, role, user. Re-export ผ่าน barrel `index.ts` (NodeNext `.js`), เพิ่มสคริปต์ `migration:check` = `drizzle-kit check` (ตรงกับ CI Stage 2 ที่ระบุ P0-BE-06 ต้องมีสคริปต์นี้ · ไม่ต้องใช้ DB), gen migration `0000_flashy_eddie_brock.sql` (7 tables). Gates: typecheck 6/6 ✓, lint ✓, `drizzle-kit check` "Everything's fine" ✓ → เขียว. ด่าน 4.5 diff-reviewer = **PASS**. commit `d2a65cf` → สถานะ review + แถว REVIEW-QUEUE.
- ตัดสินใจอะไร: (เขตตัวเอง ไม่ใช่ design/spec) (1) circular FK company.subscription_id ↔ subscription.company_id: ใช้ `AnyPgColumn` ตัด type-cycle + drizzle gen ADD CONSTRAINT หลัง CREATE ครบทุกตาราง (insert-order ปลอดภัย). (2) drizzle.config `schema` ชี้ไฟล์กลุ่มตรงๆ (`["./src/schema/platform.ts"]`) แทน barrel — เพราะ CJS loader ของ drizzle-kit resolve `./platform.js` ไม่ได้ (ชนกับ NodeNext ของ tsc) → **P0-BE-07/08/09 ต้อง append ไฟล์กลุ่มใหม่ใน array นี้ทุกครั้ง**. (3) currency_code default `THB` บนคอลัมน์เงิน (package price, platform_invoice amount) ตาม PLAN §4. ไม่มีการตัดสินความขัดแย้ง design/spec — ช่องว่าง dictionary (cycle=monthly|yearly ตาม price_m/y, price nullable สำหรับ Full=ติดต่อ, email unique ต่อ company) เป็นการเติมให้สอดคล้อง ไม่ขัดแย้ง จึงไม่ต้องเปิด BLOCKERS.
- เจออะไร (handoff): (1) better-auth session/account tables **ยังไม่สร้าง** — เว้นให้ P0-BE-11 (แม้ชื่อ task พูดถึง "session"; scaffold comment ระบุ better-auth = P0-BE-11 ชัดเจน). (2) Role.perms matrix (11 modules × 5 perms) = Appendix B item 13 → P0-BE-09 ยังไม่ทำ. (3) **เตือน**: คิว ready เขต backend ที่ dep ครบ + อยู่ใน zone จริงเริ่มบาง — P0-BE-04/05 (tokens/i18n) อยู่นอก zonePaths backend (`packages/tokens`,`packages/i18n`) ทั้งที่ตารางจัดเป็นเขต backend; ถ้าตั้งใจให้ backend agent ทำ ต้องเพิ่ม path ใน loop-config (นอกเขต = แก้ไม่ได้รอบนี้). ที่หยิบได้จริงในรอบถัดๆ: P0-BE-07/08 (schema, dep P0-BE-06 กำลัง review), P0-BE-12 (contracts, openapi.yaml = sacred hook-blocked — ต้องเช็คก่อน), P0-BE-15 (loop-runner อยู่ `scripts/` = นอก zone). → ฝาก Wei ยืนยัน zonePaths ของ backend ครอบ `packages/tokens`/`packages/i18n` หรือไม่.

## 2026-07-12 · รอบที่ 1 · task: P0-BE-01

- ทำอะไร: หยิบ P0-BE-01 (monorepo scaffold + CI lint+typecheck+build ทุก workspace) ซึ่งเป็น ready task เดียวในเขต backend ที่ dependency ครบ (ว่าง) — task อื่นทุกตัวมี P0-BE-01 เป็น dep ที่ยังไม่ done. ตรวจพบว่าโครง scaffold ถูกวางไว้แล้วโดย foundation commit (0b66192) และ CI green-from-day-one อยู่แล้ว. รันด่านจริงทั้ง 3: `pnpm run lint` / `typecheck` / `build` → เขียวครบ 10 workspaces. ปิดช่องว่างในเขตตัวเอง: `packages/db` มี TS source จริง (schema/index.ts + seed/index.ts) แต่ยังไม่ถูก wire เข้า CI — เพิ่ม `packages/db/tsconfig.json` (extends tsconfig.base) + สคริปต์ `typecheck`/`lint` = `tsc --noEmit` (ตาม convention ของ apps/api). รันซ้ำ: lint 5/5 ✓, typecheck 6/6 ✓, build 5/5 ✓.
- ตัดสินใจอะไร: ทำเฉพาะในเขต writable ของตัวเอง (apps/api · packages/db · packages/contracts) — แตะแค่ `packages/db` (tsconfig + package.json scripts). ไม่แตะ root config/sacred files. packages/contracts ยังไม่มี TS source (รอ codegen P0-BE-12) จึงยังไม่ wire typecheck. ไม่ตัดสินความขัดแย้ง design/spec.
- เจออะไร (handoff): 3 แพ็กเกจเขต integrations (`packages/tax-engine` · `packages/bank-file` · `packages/notifications`) ยังมีสคริปต์ placeholder ที่ label ว่า `TODO(P0-BE-01): ... wired by monorepo tooling` สำหรับ lint/typecheck/build — placeholder echo success จึง CI เขียว แต่ไฟล์เหล่านี้อยู่ **นอกเขต writable** ของ backend agent รอบนี้ (เขต integrations, มี task ของตัวเอง P0-INT-01/02/03). ปล่อยไว้ให้เจ้าของเขตแทนที่ด้วย tooling จริงในงานของตน. → ฝากให้ Wei ยืนยันความเป็นเจ้าของ tooling wiring ของ 3 แพ็กเกจนั้นตอน review (label เป็น P0-BE-01 แต่ไฟล์อยู่คนละเขต). งานรอบนี้ไม่ได้ push (รอ diff-reviewer/loop-runner ตาม PLAN.md §10 ด่าน 4.5).

## 2026-07-06 · bootstrap · task: —

- ทำอะไร: bootstrap ไฟล์สถานะ loop ตาม Manifest v2 กลุ่ม 3 (`TASKS.md` / `BLOCKERS.md` / `REVIEW-QUEUE.md` / journal 6 ใบ) · แตก task Phase 0 ลง `TASKS.md` — เขต backend มี 15 task (P0-BE-01 ถึง P0-BE-15) สถานะ `ready` ครบ
- ตัดสินใจอะไร: ไม่มีการตัดสินใจเชิง design/spec — ความขัดแย้งที่พบถูกยกเข้า `BLOCKERS.md` ทั้งหมด (B-001, B-002)
- เจออะไร: gallery จริงมี 106 .jpg ขณะที่ manifest ระบุ 102 → B-001 (ไม่ block งาน) · โครง `packages/integrations/CLAUDE.md` vs 3 แพ็กเกจแยกตามกลุ่ม 5 → B-002 (ไม่ block งาน) · Phase 0 = Backend เดี่ยว — เริ่มที่ P0-BE-01 (monorepo scaffold) ก่อนเสมอ เพราะเป็น dependency ของเกือบทุก task
- 2026-07-11T18:20:03Z loop round ended (agent: backend)

## 2026-07-12 01:20 · loop-runner · รอบที่ 1/10 · task: P0-BE-01
- ทำอะไร: รัน claude headless 1 รอบ · task P0-BE-01 → สถานะ review · ค่าใช้จ่ายรอบนี้ $2.5477825000000003 (สะสม $2.5478/เพดาน $20)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes
- 2026-07-11T18:21:53Z loop round ended (agent: backend)

## 2026-07-12 01:21 · loop-runner · คิวว่าง
- ทำอะไร: รอบที่ 2/10: ไม่มี task สถานะ ready ที่ dependencies ครบในเขต backend — จบลูป
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: งบสะสม $3.4381/$20 · เติมคิว ready ให้ครบ ≥ 5 task ต่อเขต (PLAN.md §10)

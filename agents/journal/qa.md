# Journal — QA (เขต: `tests/`)

> บันทึกต่อรอบ loop ตาม PLAN.md §10 — หนึ่ง entry ต่อหนึ่งรอบ · entry ใหม่อยู่บนสุด
> รูปแบบ entry ต่อรอบ:
>
> ```
> ## [YYYY-MM-DD] · รอบที่ N · task: <task id>
> - ทำอะไร: (งานที่ลงมือทำจริงในรอบนี้ + ผล gates)
> - ตัดสินใจอะไร: (การตัดสินใจในเขตตัวเอง — ความขัดแย้ง design/spec ห้ามตัดสินเอง → BLOCKERS.md)
> - เจออะไร: (สิ่งที่พบ/ติดขัด/blocker ที่เปิด/สิ่งที่ agent รอบถัดไปควรรู้)
> ```

## 2026-07-12 · รอบที่ 6 · task: P0-QA-02

- ทำอะไร: implement **contract test harness (G2)** ที่ `tests/contract/` — 3 ไฟล์ใหม่: `lib/openapi.ts` (engine: โหลด+parse `packages/contracts/openapi.yaml` ด้วย js-yaml · `$ref` resolver + `deref` · `listOperations()` แตก 108 paths × methods = **145 operations** พร้อม effective security/request media types+schema/response schema · `collectRefs` · `validate()` structural validator รองรับ `$ref`/`allOf`/`type`/`required`/`properties`/`items`/`enum`/`const`) · `contract.spec.ts` (**static invariants generate ต่อ endpoint**: unique operationId 145/145 · ทุก op มี 2xx · 141 auth op ต้องมี 401 + Error envelope · requestBody resolve (รวม multipart 3 ตัว) · 404 = Error envelope · 402 = `QUOTA_EXCEEDED`+`upgrade_url` · ทุก `$ref` resolve) · `live.spec.ts` (**contract vs dev API จริง** gated ด้วย `CONTRACT_API_URL`: unset→`describe.skip` · set→รันจริง; เรียกเฉพาะ side-effect-free: 44 guarded GET ต้อง 401+Error envelope · bad login → contract-declared shape) + update `README.md` (สถานะ+วิธีรัน) + เพิ่ม `js-yaml` เข้า `@juneflow/tests` devDeps (offline install จาก store, lockfile +3). **Gate G2 = "harness รันได้กับ dev API"**: `pnpm --filter @juneflow/tests test:contract` = **370 passed | 46 skipped** · full `pnpm test` = exit 0 · **พิสูจน์ live path รันจริงกับ dev API** ด้วย stub contract-conforming (`CONTRACT_API_URL` → **46/46 passed**) → **GREEN** · commit `7ff33a6` บน `feature/qa`, task → `review`, เพิ่มแถว REVIEW-QUEUE.
- ตัดสินใจอะไร: **ไม่อ่าน implementation / ไม่เขียน model มือ** (กฎเหล็กเขต qa + PLAN.md §5) — expected ทุกตัว derive จาก `openapi.yaml` ล้วนผ่าน engine (openapi.yaml อ่านอย่างเดียว = sacred untouched). **ไม่ตัดสิน spec เอง** — harness assert เฉพาะ invariant ที่ contract ประกาศเอง (contract ผ่านทั้งหมดอยู่แล้ว → static เขียว; ถ้า contract อนาคตแก้จนละเมิด invariant = G2 แดง โดยตั้งใจ). ด่าน live gated ด้วย env (กลไก) ไม่ hardcode base URL — dev API ยังไม่มี (P0-DEV-01/P0-BE-13 pending) จึง skip เพื่อให้เขียวระหว่าง scaffold ตาม pattern เขต (เหมือน seed/visual harness รอบก่อน). requestBody ครอบคลุม multipart (3 upload endpoints) ไม่ล็อก JSON-only.
- เจออะไร: (1) **ไม่มี `yaml`/`@types/js-yaml` ใน store** แต่ `js-yaml@4.2.0` มี (transitive ของ @redocly) → เพิ่มเป็น devDep `@juneflow/tests` + `pnpm install --offline` สำเร็จ (ไม่ดาวน์โหลด) + local ambient `lib/js-yaml.d.ts` แทน @types (tests ไม่มี typecheck script อยู่แล้ว; vitest esbuild ไม่บังคับ type). (2) contract แข็งแรงมาก: 145 op operationId unique · auth 141/141 มี 401 · 402 = 3 ตัว (POST /projects,/ai-qto/upload,/files) `QuotaExceededError` = allOf(Error)+{code enum[QUOTA_EXCEEDED], upgrade_url uri required} · 3 upload ใช้ `multipart/form-data` (ไม่ใช่ JSON) → generalize `bodySchemaOf` prefer json else first media. (3) `list` = bare array (B-014 ยังค้าง envelope — harness ไม่ assert envelope shape, ไม่เดา). (4) ยังไม่ push→dev / ด่าน 4.5 รอบนี้ (commit+review+REVIEW-QUEUE) — เหลือ loop-runner. (5) **คิว ready เขต qa หลังรอบนี้ = 0 ที่ dep พร้อม**: P0-QA-03 รอ P0-DEV-01 (ยัง `ready` ไม่ done) · P0-QA-02 รอบนี้→review · ที่เหลือ done/review — ต่ำกว่าเกณฑ์ ≥5 มาก · ต้องปลด P0-DEV-01 (compose dev) เพื่อเปิด P0-QA-03 + promote คิว review เพื่อเดินต่อ.

## 2026-07-12 · รอบที่ 5 · task: P0-QA-04

- ทำอะไร: implement **visual gate harness (G5)** ที่ `tests/visual/` — ใหม่ 4 ไฟล์: `visual-gate.spec.ts` (harness 2 โหมด) · `lib/compare.ts` (compare engine) · `lib/report.ts` (readable diff report + worker-safe part files) · `lib/setup.ts`/`lib/teardown.ts` (globalSetup/Teardown) + `screens.manifest.json` (capture list ว่างจนกว่าจอ apps/web จะมา) + `.gitignore` (`.results/`). แก้ `playwright.visual.config.ts` (custom-matcher approach, ถอด snapshot template ของ toHaveScreenshot) + `README.md` (สถานะ). **แก้ปัญหา jpg ที่ config เดิม TODO ไว้**: `toHaveScreenshot()` decode .png เท่านั้น แต่ 106/128 ref เป็น .jpg → `lib/compare.ts` decode ทั้ง jpg+png ด้วย **chromium ที่ Playwright ใช้อยู่แล้ว** (canvas getImageData ในเบราว์เซอร์ → ไม่เพิ่ม native dep เช่น sharp/jpeg-js) แล้ว pixel-diff + สร้าง diff PNG · **อ่าน `reference/` อย่างเดียว ไม่เขียนทับ** (git: reference/ clean). สองโหมด: (1) **self-check** รันได้ทันทีไม่ต้องมีแอป — พิสูจน์ pipeline กับ ref จริง `g1/01-s.jpg`: identical=PASS 0 diff · perturbed(50×50 block)=FAIL 2500px · size-mismatch=auto-FAIL (2) **capture** screenshot จริงเทียบ ref ตาม manifest — `test.skip` เมื่อ manifest ว่าง/แอปไม่ถึง (ไม่ fail → gate เขียวระหว่าง scaffold). **Gate** = "G5 harness รันได้ + รายงาน diff อ่านได้": `pnpm --filter @juneflow/tests test:visual` = **3 passed | 1 skipped** · full `pnpm test` (unit/seed/contract/e2e/visual) = **exit 0** · รายงาน `tests/visual/.results/visual-report.md` (table + diff PNG, gitignored) → **GREEN** · commit บน `feature/qa`, task → `review`, เพิ่มแถว REVIEW-QUEUE.
- ตัดสินใจอะไร: **ไม่ตัดสิน design/threshold เอง** — (1) threshold เริ่ม **strict** `VISUAL_MAX_DIFF_PIXEL_RATIO=0` + `VISUAL_CHANNEL_THRESHOLD=0` ตามกฎเหล็ก skill `visual-gate` ("start strict, ผ่อนเฉพาะผ่าน Wei/BLOCKERS"); การผ่อน threshold ให้รับ jpg lossy ของจอจริง = คำตัดสิน Wei ไม่ทำเป็น default เงียบ ๆ — เปิดเป็น env-configurable (กลไก) ไม่ใช่นโยบาย. (2) route→ref mapping ไม่ hardcode ในโค้ด — อ้าง `reference-index.md` (P0-QA-01) ผ่าน `screens.manifest.json` ที่ยังว่าง (ยังไม่มีจอ apps/web) เพื่อไม่เดา mapping. (3) ไม่อ่าน implementation (apps/web ยังไม่มีอยู่แล้ว) ตามกฎเขต.
- เจออะไร: (1) chromium ติดตั้งแล้วใน `~/Library/Caches/ms-playwright` → decode jpg ผ่านเบราว์เซอร์ได้โดยไม่เพิ่ม dep (ทางออกที่ config TODO บอก "convert on the fly / custom matcher"). (2) Playwright รัน 4 workers ขนาน → afterAll เขียน report ต่อ worker ทับกัน (เห็นครั้งแรก report เหลือ 1 แถว) → เปลี่ยนเป็น **part files ต่อ test + globalTeardown consolidate** (worker-safe, deterministic). (3) capture mode ยัง skip ทั้งหมดจนกว่า **P0-WEB-05+** จะมีจอจริง + `VISUAL_BASE_URL` ถึง (compose dev P0-DEV-01) — ตอนนั้นเติมแถวใน `screens.manifest.json` แล้วรันได้เลย. (4) ยังไม่ push→dev / ด่าน 4.5 รอบนี้ (commit+review+REVIEW-QUEUE) — เหลือ loop-runner. (5) **คิว ready เขต qa หลังรอบนี้ = 0 ตัวที่ dep พร้อม**: P0-QA-02 รอ P0-BE-12 · P0-QA-03 รอ P0-DEV-01 · (ทั้งคู่ยัง `ready` ไม่ done) · P0-QA-04 รอบนี้ review · QA-06 review — ต้องปลด dep P0-BE-12/P0-DEV-01 หรือ promote เพื่อเปิดคิว qa รอบถัดไป (ต่ำกว่าเกณฑ์ ≥5 มาก).

## 2026-07-12 · รอบที่ 4 · task: P0-QA-06 (REWORK แก้ตาม ด่าน 4.5 FAIL)

- ทำอะไร: แก้ `tests/seed/seed-counts.spec.ts` + `README.md` ตาม 3 จุดที่ diff-reviewer FAIL — ยึด **ภาคผนวก C** (§0 กฎ 4: §สรุป = mock ค้างเวอร์ชัน → C ชี้ขาด): (1) **C1** Package `expected 3→4` เปลี่ยน source `subscription.jsx SUB_PACKAGES` → `pkg-builder.jsx PKG_STORE.seed (S/M/L/Full)` ยืนยันด้วย PACKAGE-RULES §1 (จอ sub.plans render 4 การ์ด) (2) **C9** ถอด `'JV lines (DR/CR)'` ออกจาก `NO_RECORD_ENTITIES` → เพิ่มค่าคง `JV_BOOK_COUNT=7 / JV_MIN_LINES_PER_BOOK=2 / JV_MIN_TOTAL_LINES=14` + describe ใหม่ assert JV 7 ใบ · ทุกใบ ≥2 บรรทัด · รวม ≥14 · invariant ΣDR=ΣCR + แก้ note บรรทัด JV finance (3) **B-009** ถอด `'Unit'`+`'SalesUnit'` ออกจาก expected-0 → `B009_PENDING_ENTITIES` + 2 `it.todo` (Unit/SalesUnit persist = ? รอ Wei). `NO_RECORD_ENTITIES` 9→6, แก้ assertion นับ 9→6 + เพิ่ม guard ว่า 3 ตัวที่ย้ายไม่อยู่ในกลุ่มแล้ว. **`vitest run seed` = เขียว 91 passed | 2 todo** (เดิม 90). Gate task = "assertions ตรง §สรุป 100%" (แก้ conflict ด้วย ภาคผนวก C) → **GREEN** · commit บน `feature/qa` · task → `review` · เพิ่มแถว REVIEW-QUEUE.
- ตัดสินใจอะไร: **ไม่ตัดสิน spec เอง** — 3 จุดเป็นคำตัดสินที่มีอยู่แล้ว (C1/C9 ในภาคผนวก C · B-009 ใน BLOCKERS เปิดโดย diff-reviewer). Unit **และ** SalesUnit ถอดออกจาก expected-0 ทั้งคู่ (ไม่ใช่แค่ Unit) เพราะเป็น `units` array 84 ตัวเดียวกัน (sales-process.jsx:24) และ B-009 ระบุ "Unit/SalesUnit" ชัด — ล็อก SalesUnit=0 ต่อ = ตัดสินค่าที่ B-009 ยังค้าง จึงทำเป็น todo ทั้งคู่ (non-deciding).
- เจออะไร: (1) §สรุป (MOCK-DATA L295/306/326/333/341) ระบุ Package 3 · JV lines 0 · Unit/SalesUnit 0 — **ขัด** ภาคผนวก C1/C9 + §0 กฎ 3 ทั้งหมด → §สรุป เป็น snapshot ของ mock ที่ค้างเวอร์ชัน ไม่ใช่ spec เป้าหมายของ seed จริง; test เขต qa ต้องยึด C/§0 เมื่อขัด. (2) B-009 ยัง `รอ Wei ตอบ` แต่ไม่ block task นี้ (ออกแบบให้ ship ด้วย todo ตามคำสั่ง rework) — เมื่อ Wei ตอบ B-009 ให้เติมค่า Unit/SalesUnit ใน describe.todo real-seed. (3) ยังไม่ push→dev / ด่าน 4.5 รอบนี้ (commit+review+REVIEW-QUEUE) — เหลือ loop-runner. (4) คิว ready เขต qa: P0-QA-02/03/04 ยังติด dep (P0-BE-12/P0-DEV-01 ยัง ready · P0-QA-04 รอ P0-QA-01 done) — หลังรอบนี้ **ไม่มี ready ที่ dep พร้อมเหลือ** ต้องปลด dep/promote เพื่อเปิด P0-QA-04.

## 2026-07-12 · orchestrator/ด่าน 4.5 · task: P0-QA-06 → REWORK

- ทำอะไร: diff-reviewer ตัดสิน **FAIL** เฉพาะ P0-QA-06 (QA-01/05 PASS และ merge เข้า dev แล้ว) — สอง commit ของ QA-06 (`4ad56a5` `9cf0e56`) ไม่ถูก merge · TASKS.md กลับเป็น `ready` พร้อม rework note · แถว REVIEW-QUEUE ถูกถอน
- ตัดสินใจอะไร: — (คำตัดสินเป็นของ diff-reviewer ตาม PLAN.md §10 ด่าน 4.5)
- เจออะไร (สิ่งที่รอบ rework ต้องแก้): (1) `tests/seed/seed-counts.spec.ts:38` Package expected 3 จาก SUB_PACKAGES — **ขัด C1** (mock ค้างเวอร์ชัน) ต้องเป็น 4 ตาม PKG_STORE/PACKAGE-RULES §1 (2) `seed-counts.spec.ts:156-159` + README ล็อก JV lines = 0 — **ขัด C9** seed ต้องสร้าง lines สมดุล DR=CR (JV 7 ใบ → ≥14 lines) — ย้ายออกจากกลุ่ม expected-0 (3) `Unit` 84 vs 0 — เปิดเป็น **B-009** ใน BLOCKERS.md แล้ว ให้ทำ assertion เป็น todo ผูก B-009 แทนการล็อกค่า · โค้ดยังอยู่บน feature/qa แก้ต่อจากไฟล์เดิมได้เลย

## 2026-07-12 · รอบที่ 3 · task: P0-QA-06

- ทำอะไร: สร้าง **seed fixture assertions (expected-first)** ที่ `tests/seed/` — `seed-counts.spec.ts` + `README.md`. ถอด **จำนวน record ต่อ entity** จาก `docs/extract/MOCK-DATA.md` §"สรุปสำหรับทำ seed data" ทุกบรรทัดเป็นค่าคาดหวังตรง ๆ 100%: 7 กลุ่ม Juneflow (Platform · Master · BOQ/จัดซื้อ · ผู้รับเหมา · PM · การเงิน-บัญชี · ที่ดิน/ขาย/อื่นๆ) แต่ละ entry มี `{entity, expected, group, source(.jsx const), sub?}` + citation ต้นทาง · Notification 3 ชุด [5,7,10] · entity ที่ dictionary มีแต่ไม่มี record 9 ตัว (AiUsage/Acceptance/Defect/Attendance/Payroll/SalesUnit/Cheque/JV lines/Unit) = expected 0. เพิ่ม script `test:seed` (`vitest run seed`) ใน `tests/package.json` + ผูกเข้า aggregate `test`. **`vitest run seed` = เขียว: 90 tests ผ่านหมด** (fixture-consistency: จำนวนเต็มไม่ติดลบ · ไม่ซ้ำ · ครบ 7 กลุ่ม · มี citation ทุก entry). เทียบกับ record ที่ seed จริงผลิต = `describe.todo` (รันเมื่อ P0-BE-10 done). Gate ของ task = "assertions ตรง §สรุป 100%" → **GREEN**. commit test `4ad56a5` บน `feature/qa`, task → `review`, เพิ่มแถว REVIEW-QUEUE.
- ตัดสินใจอะไร: **ไม่ตัดสิน scope เอง** — `wat/` ("บุญบัญชี") อยู่ใน §สรุป แต่ **§0 กฎข้อ 5 = คนละผลิตภัณฑ์** จึงเก็บ 10 entity ของ wat/ ใน `WAT_COUNTS` เป็น reference-only (ไม่ assert เป็น expected ของ seed Juneflow, todo ระบุ table wat ต้องไม่อยู่ใน schema เลย) — ไม่เดา ไม่รวมเข้า seed. AP ตั้งหนี้ §สรุประบุ "5 (+6 จอเก่า)" → ใช้ 5 เป็น seed หลัก บันทึก legacy 6 ใน note. JV "7 (ไม่มีบรรทัด DR/CR)" → JV=7, JV lines=0 (เข้ากลุ่ม no-record). ค่าทุกตัวถอดจาก §สรุป อย่างเดียว — ไม่อ่าน implementation (ยังไม่มี packages/db seed) ตามกฎเขต.
- เจออะไร: (1) §สรุป ให้ record หลัก + sub-count ปนกัน (เช่น Project 7 +16 phase, BOQItem 21/6 กลุ่ม, สัญญา subcon 4/งวดงาน 16) — แยก `expected` (record หลัก) ออกจาก `sub` เพื่อไม่ให้ assertion นับผิด. (2) เลือกวางที่ `tests/seed/` + script แยก `test:seed` (ไม่ยัดใน `unit`) เพราะ seed count ≠ business logic — `vitest run seed` กับ `vitest run unit` แยกกันสะอาด (90 vs 48). (3) ยังไม่ push→dev / ด่าน 4.5 ในรอบนี้ (commit+review+REVIEW-QUEUE) — เหลือ loop-runner/รอบถัดไป. (4) คิว ready เขต qa เหลือ **P0-QA-02/03/04 ติด dep ทั้งหมด** (P0-BE-12=ready, P0-DEV-01=ready, P0-QA-01=review — ยังไม่ done สักตัว) → **ไม่มี ready task ที่ dep พร้อมเหลือเลยหลังรอบนี้** ต่ำกว่าเกณฑ์ ≥5 มาก · ต้องปลด dep: P0-BE-12 (contract), P0-DEV-01 (compose dev), + promote P0-QA-01/05/06 ให้ done เพื่อปลด P0-QA-04.

## 2026-07-12 · รอบที่ 2 · task: P0-QA-05

- ทำอะไร: สร้าง **unit business-logic test spec (expected-first)** สำหรับ Gate G3 ที่ `tests/unit/` — 6 ไฟล์ครบทุกด้านในแถว task: `workperiod-basis.spec.ts` (4 basis = percent/distance/milestone/**unit** ตาม C2 + state machine C3), `retention.spec.ts` (net+withheld=amount · ledger outstanding), `boq-remain.spec.ts` (remain_qty ตัดเมื่อเปิด PR · กันตัดเกิน · cat M/L/S routing), `quota.spec.ts` (limits ต่อแพ็กเกจ §1 · 402 QUOTA_EXCEEDED · chip color §5), `posting-rules.spec.ts` (**invariant-only** DR=CR ตาม C9), `approval-matrix.spec.ts` (routing rule escalate จน authLimit≥amount + state machine) + `README.md` (method + citation ต่อค่า). เพิ่ม script `test:unit` (`vitest run unit`) ใน `tests/package.json` และผูกเข้า aggregate `test`. **รัน `vitest run unit` = เขียว: 6 ไฟล์ / 48 tests ผ่านหมด** (fixture-consistency assertions รันได้จริง + `describe.todo` เป็นจุดต่อสาย logic จริงในอนาคต). Gate ของ task = spec review โดย Wei (ยังไม่รันกับโค้ด) → **GREEN**. commit บน `feature/qa`, task → `review`, เพิ่มแถว REVIEW-QUEUE.
- ตัดสินใจอะไร: **ไม่ตัดสิน Open Q เอง** — 2 ด้านที่ spec ยังไม่นิยามครบ เขียนเป็น invariant/rule เท่านั้นแล้วทำเครื่องหมายส่วนที่ค้าง ไม่เดา: (1) **posting rules** — spec กำหนดแค่ double-entry invariant (ΣDR=ΣCR, C9); การ map บัญชี debit/credit ต่อชนิดเอกสาร = **Open Q #3** (รอนักบัญชี) → ไม่เขียนค่า account mapping, ใส่ `describe.todo` "BLOCKED on Open Q #3". (2) **approval matrix** — เขียน routing rule (escalate ตาม level จน authLimit≥amount) ด้วย ladder **ตัวอย่าง**; เพดานจริงมาจาก seed ROLE_PRESETS (P0-BE-10) + "fix vs configurable" = **Open Q #2** → ไม่ผูกค่าตายตัว. ค่าคาดหวังทุกตัวถอดจาก spec (data-dictionary / FUNCTIONS.md / PACKAGE-RULES / ภาคผนวก C) — ไม่อ่าน implementation (ยังไม่มี apps/api อยู่แล้ว) ตามกฎเขต.
- เจออะไร: (1) WorkPeriod.basis ใน dictionary มี 3 (`percent|distance|milestone`) — C2 เพิ่ม `unit` เป็นที่ 4; MOCK-DATA `method(percent/distance/milestone/unit)` ยืนยัน. (2) มี tension เล็กน้อยระหว่าง FUNCTIONS.md บรรทัด openMilestoneForm ("% / ระยะทาง / milestone / **รายเดือน**") กับบรรทัด 77 ("เกณฑ์ **3 แบบ**") — ยึด dictionary+C2 (4 basis ไม่รวม `monthly`) เป็นความจริง ตาม §0 ข้อ 2 ไม่ยกเป็น blocker เพราะ C2/dictionary ชี้ขาดแล้ว. (3) เพิ่ม `test:unit` เข้า aggregate `test` = additive, ไม่แตะ contract/e2e/visual เดิม. (4) ยังไม่ push→dev / ด่าน 4.5 ในรอบนี้ (ตามคำสั่งรอบ: commit+review+REVIEW-QUEUE) — เหลือ loop-runner/รอบถัดไป. (5) คิว ready เขต qa เหลือ P0-QA-02/03/04 (ติด dep) + P0-QA-06 (พร้อม) = ต่ำกว่าเกณฑ์ ≥5 → backend ควรเติมคิวหรือปลด dep P0-BE-12/P0-DEV-01.

## 2026-07-12 · รอบที่ 1 · task: P0-QA-01

- ทำอะไร: สร้าง `tests/visual/reference-index.md` — index ภาพอ้างอิง → จอ/route ครบ **128 ภาพ (106 .jpg + 22 .png)**. ตรวจนับไฟล์บนดิสก์ตรงเกณฑ์ (g1:30·g2:47·g3:5·g4:4·g5:20 = 106 .jpg + shots 22 .png). gallery ทั้ง 106 map จาก caption ต้นทาง `pototype/คู่มือ Flow + ภาพหน้าจอ.html` (route + ไฟล์ .jsx) + `pototype/แกลเลอรีหน้าจอ.html` (route id) แล้ว cross-check กับ `docs/extract/NAV-ROUTES.md` ทุกแถว. **Gates GREEN** (task row: จำนวนไฟล์ตรง + index ครอบคลุมทุกภาพ) — task นี้ไม่มีจอ/โค้ด จึงไม่เข้า G1–G5. → commit บน `feature/qa`, task → `review`, เพิ่มแถว REVIEW-QUEUE.
- ตัดสินใจอะไร: ไม่มีการตัดสิน design/spec. shots/ 22 ภาพ (.png) เป็น dev working-capture ไม่มี caption ต้นทาง — map จากชื่อไฟล์ (land-*, pm-*, ptype-modal) cross-check NAV-ROUTES แล้วระบุ **คอลัมน์ความมั่นใจต่อแถว** (สูง/กลาง/ต่ำ) อย่างโปร่งใส ไม่แต่งข้อมูล spec; visual gate ให้ยึด gallery/ เป็นเกณฑ์หลัก.
- เจออะไร: (1) แหล่ง caption จริงของภาพ = 2 ไฟล์ HTML ใน `pototype/` (คู่มือ Flow ให้ route+.jsx ครบสุด). (2) shots/ ไม่ถูกอ้างใน HTML caption ใด — เป็น working shots ของ module land + PM; ถ้ารอบต่อไปทำ visual-gate harness (P0-QA-04) ให้ยึด gallery 106 ภาพเป็น reference หลัก. (3) diff-reviewer (ด่าน 4.5) + push→auto-merge dev ยังไม่ทำในรอบนี้ (ตามคำสั่งรอบ: commit+review+REVIEW-QUEUE) — เหลือให้ loop-runner/รอบถัดไป push. (4) คิว ready เขต qa เหลือ 5 (P0-QA-02/03/04 ติด dep, P0-QA-05/06 พร้อม) — ยังไม่ต่ำกว่าเกณฑ์.

## 2026-07-06 · bootstrap · task: —

- ทำอะไร: bootstrap ไฟล์สถานะ loop ตาม Manifest v2 กลุ่ม 3 · เขต qa มี 6 task ใน `TASKS.md` (P0-QA-01 ถึง P0-QA-06) สถานะ `ready` — P0-QA-05 (unit business-logic test spec) และ P0-QA-06 (seed fixture assertions) เริ่มได้ทันทีเพราะเขียนจาก spec ล้วน
- ตัดสินใจอะไร: ไม่มีการตัดสินใจเชิง design/spec — ความขัดแย้งถูกยกเข้า `BLOCKERS.md` (B-001, B-002)
- เจออะไร: กฎเขตนี้ (กลุ่ม 2.4): เขียน expected จาก flows.html + NAV-ROUTES + PACKAGE-RULES + PROJECT-TYPES + gallery — **ห้ามอ่าน implementation ก่อนเขียน expected** · visual reference จริงมี 106 .jpg (manifest ระบุ 102) → รอคำยืนยัน B-001 แต่ index ทำครบ 106 ไปก่อน (ไม่ block งาน)
- 2026-07-11T18:18:17Z loop round ended (agent: qa)

## 2026-07-12 01:18 · loop-runner · รอบที่ 1/10 · task: P0-QA-01
- ทำอะไร: รัน claude headless 1 รอบ · task P0-QA-01 → สถานะ review · ค่าใช้จ่ายรอบนี้ $2.6731175 (สะสม $2.6731/เพดาน $20)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes
- 2026-07-11T18:27:36Z loop round ended (agent: qa)

## 2026-07-12 01:27 · loop-runner · รอบที่ 2/10 · task: P0-QA-05
- ทำอะไร: รัน claude headless 1 รอบ · task P0-QA-05 → สถานะ review · ค่าใช้จ่ายรอบนี้ $3.1359859999999995 (สะสม $5.8091/เพดาน $20)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes
- 2026-07-11T18:53:30Z loop round ended (agent: qa)

## 2026-07-12 01:53 · loop-runner · รอบที่ 1/10 · task: P0-QA-06
- ทำอะไร: รัน claude headless 1 รอบ · task P0-QA-06 → สถานะ review · ค่าใช้จ่ายรอบนี้ $2.5426040000000008 (สะสม $2.5426/เพดาน $20)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes
- 2026-07-11T19:04:14Z loop round ended (agent: qa)

## 2026-07-12 02:04 · loop-runner · รอบที่ 2/10 · task: P0-QA-04
- ทำอะไร: รัน claude headless 1 รอบ · task P0-QA-04 → สถานะ review · ค่าใช้จ่ายรอบนี้ $4.3789489999999995 (สะสม $6.9215/เพดาน $20)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes
- 2026-07-11T19:04:42Z loop round ended (agent: qa)

## 2026-07-12 02:04 · loop-runner · คิวว่าง
- ทำอะไร: รอบที่ 3/10: ไม่มี task สถานะ ready ที่ dependencies ครบในเขต qa — จบลูป
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: งบสะสม $7.5567/$20 · เติมคิว ready ให้ครบ ≥ 5 task ต่อเขต (PLAN.md §10)
- 2026-07-12T00:55:18Z loop round ended (agent: qa)

## 2026-07-12 07:55 · loop-runner · รอบที่ 1/10 · task: P0-QA-02
- ทำอะไร: รัน claude headless 1 รอบ · task P0-QA-02 → สถานะ review · ค่าใช้จ่ายรอบนี้ $3.9997094999999985 (สะสม $3.9997/เพดาน $20)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes
- 2026-07-12T00:55:53Z loop round ended (agent: qa)

## 2026-07-12 07:55 · loop-runner · คิวว่าง
- ทำอะไร: รอบที่ 2/10: ไม่มี task สถานะ ready ที่ dependencies ครบในเขต qa — จบลูป
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: งบสะสม $4.7105/$20 · เติมคิว ready ให้ครบ ≥ 5 task ต่อเขต (PLAN.md §10)

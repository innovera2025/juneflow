# Journal — Integrations (เขต: `packages/tax-engine` · `packages/bank-file` · `packages/notifications`)

> บันทึกต่อรอบ loop ตาม PLAN.md §10 — หนึ่ง entry ต่อหนึ่งรอบ · entry ใหม่อยู่บนสุด
> รูปแบบ entry ต่อรอบ:
>
> ```
> ## [YYYY-MM-DD] · รอบที่ N · task: <task id>
> - ทำอะไร: (งานที่ลงมือทำจริงในรอบนี้ + ผล gates)
> - ตัดสินใจอะไร: (การตัดสินใจในเขตตัวเอง — ความขัดแย้ง design/spec ห้ามตัดสินเอง → BLOCKERS.md)
> - เจออะไร: (สิ่งที่พบ/ติดขัด/blocker ที่เปิด/สิ่งที่ agent รอบถัดไปควรรู้)
> ```

## 2026-07-12 · รอบที่ 2 · task: P0-INT-01

- ทำอะไร: P0-BE-01 done แล้ว → ปลดล็อก P0-INT-01/02/03. หยิบ P0-INT-01 (`ready`→`doing`→`review`). โครง `packages/tax-engine` มี interface `TaxEngine` + `FakeTaxEngine`/`ThailandTaxEngine` (จาก scaffold BE-01) อยู่แล้ว — งานรอบนี้คือ finalize เป็น G3-verifiable: (1) เขียน `tsconfig.json` (extends base, `types:[]`, noEmit) (2) แทน echo placeholder scripts ใน `package.json` ด้วยของจริง `lint`/`typecheck`=`tsc --noEmit`, `test`=`vitest run` (แพตเทิร์นเดียวกับ `packages/db`) + เพิ่ม vitest devDep (3) `src/thailand/thailand.test.ts` 17 tests คลุม interface conformance, calcWht, calcVat inclusive+exclusive, e-Tax lifecycle C4 (queued→sent+void), renderRdForm placeholder, และ ThailandTaxEngine skeleton reject. Gates: `pnpm --filter @juneflow/tax-engine test` 17/17 ✓ · lint/typecheck ✓ · root typecheck 6/6 ✓ · build 4/4 ✓ (CI ขั้นต่ำ). เขียว → commit `feature/integrations`, TASKS `review`, +แถว REVIEW-QUEUE.
- ตัดสินใจอะไร: ไม่ตัดสิน design/spec เอง. C4 (e-Tax superset queued→sent|rejected+void) มีในตารางคำตัดสินแล้ว — test ยึดตามนั้น ไม่ใช่การตีความใหม่. เอา `build` echo script ออก (แพ็กเกจ source-only main=src/index.ts เหมือน db/tokens ที่ไม่มี build) — turbo ข้าม task ที่ไม่มี ไม่กระทบ root build. แตะ `pnpm-lock.yaml` (root, นอก zonePaths) เฉพาะ 3 บรรทัด importer ของ packages/tax-engine เพื่อ sync vitest (resolved อยู่แล้วในคิว tests) — ถือเป็นผลพลอยได้เชิงกลไกของการเพิ่ม dev dep ในแพ็กเกจเขตตัวเอง (แพตเทิร์นเดียวกับที่ backend/tokens เติม importer ของตน) ไม่ใช่ sacred file ไม่ใช่การแก้โค้ดนอกเขต.
- เจออะไร: quick-verify hook (PostToolUse typecheck) จับ error ทันทีตอนเขียน test ก่อน `pnpm install` (vitest ยังไม่ link) — แก้ด้วย `pnpm install` (reused, ไม่มี download). คิว `ready` เขต integrations หลังรอบนี้ = P0-INT-02, P0-INT-03 (deps P0-BE-01 done, หยิบได้) + P0-INT-04 (รอ INT-01/02/03 done). เหลือ ready ที่หยิบได้จริง 2 task — ต่ำกว่า 5 เพราะ INT-04 ยังรอ dep และ INT-05/01 ออกจากคิวแล้ว; เตือน Wei เติมคิว Phase 3 เมื่อปิดนิยาม MVP.

## 2026-07-12 · รอบที่ 1 · task: P0-INT-05

- ทำอะไร: field inventory ฟอร์มภาษีไทย 3 ใบจาก `pototype/tax-forms.jsx` (L1–727) → เขียนใหม่ `packages/tax-engine/docs/tax-forms-map.md`. ครอบคลุม (A) ภ.พ.30 `PND30Form` incl. ตาราง VAT 16 บรรทัดพร้อมสูตร calc, (B) ใบแนบ ภ.ง.ด.3/53 `PND53Form` (component เดียว 2 ฟอร์มผ่าน prop `kind`), (C) 50 ทวิ `WHTCertificate`, + shared primitives (`FormPage`/`TaxIdBoxes`/`AddrCell`/`PartyBox`/`bahtText`/`TH_MONTHS_FULL`/openers). แต่ละฟิลด์ระบุ key บน `data`, ป้าย TH verbatim, input/calc/static, type, และ src line. Gate = coverage checklist ครบทุกฟอร์ม + สัญลักษณ์ export ครบ (task docs-only ไม่มี G1–G5 อัตโนมัติ; ไม่แตะโค้ด/UI จึงไม่กระทบ CI). เขียว → commit บน `feature/integrations`, TASKS.md `doing→review`, เพิ่มแถว REVIEW-QUEUE.md.
- ตัดสินใจอะไร: ไม่ตัดสิน design/spec เอง. transcribe ป้ายภาษาไทยตามต้นฉบับ RD ในซอร์ส (เป็น documentation ไม่ใช่ re-translate). ไม่ push เอง (auto-merge dev เป็นขั้นตอน loop-runner/Wei review) — จบรอบที่สถานะ review ตามคำสั่งรอบนี้.
- เจออะไร: **ประเด็นรอ Wei (ยังไม่ block งาน inventory)** — 50 ทวิ จับคู่ประเภทเงินได้ด้วย `String(r.typeIdx) === t.i` (L598) แต่ id มี `"4(ก)"`/`"4(ข)"` ที่ `typeIdx` เลขจำนวนเต็มจับคู่ไม่ได้ตลอด → Phase 3 `TaxEngine.thailand` ต้องส่ง `typeIdx` เป็น string ตรง catalog 7 คีย์ (บันทึกไว้ใน map §C.4 + handoff note 5). คิว `ready` เขต integrations หลังรอบนี้ = 4 (INT-01..04) — INT-01/02/03 ยังรอ P0-BE-01 (`ready`, ยังไม่ done); ต่ำกว่า 5 เพราะ dep เขต backend ยังไม่ปลด, ไม่ใช่คิวหมด. เตือน Wei: งาน integrations ที่เริ่มได้จริงตอนนี้เหลือ INT-05 (เสร็จแล้ว); ที่เหลือปลดล็อกเมื่อ P0-BE-01 done.

## 2026-07-06 · bootstrap · task: —

- ทำอะไร: bootstrap ไฟล์สถานะ loop ตาม Manifest v2 กลุ่ม 3 · เขต integrations มี 5 task ใน `TASKS.md` (P0-INT-01 ถึง P0-INT-05) สถานะ `ready` — P0-INT-05 (tax forms field inventory) เริ่มได้ทันทีโดยไม่รอเขตอื่น
- ตัดสินใจอะไร: ไม่มีการตัดสินใจเชิง design/spec — ความขัดแย้งถูกยกเข้า `BLOCKERS.md` (B-001, B-002)
- เจออะไร: โครงโฟลเดอร์เขตนี้ยังมีประเด็นเปิด → **B-002** (`packages/integrations/CLAUDE.md` ตามกลุ่ม 2 vs 3 แพ็กเกจแยกตามกลุ่ม 5 — รอ Wei เลือก ก/ข/ค แต่ไม่ block งาน skeleton) · หลักเขต (กลุ่ม 2.5): ทุกตัว implement interface กลาง · mock-first (fake adapter e-Tax/KBANK/LINE) · credentials ผ่าน env · agent เขตนี้เข้าทีมเต็มรูป Phase 3 (PLAN.md §7)
- 2026-07-11T18:19:32Z loop round ended (agent: integrations)

## 2026-07-12 01:19 · loop-runner · รอบที่ 1/10 · task: P0-INT-05
- ทำอะไร: รัน claude headless 1 รอบ · task P0-INT-05 → สถานะ review · ค่าใช้จ่ายรอบนี้ $2.2198479999999994 (สะสม $2.2198/เพดาน $20)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes
- 2026-07-11T18:20:12Z loop round ended (agent: integrations)

## 2026-07-12 01:20 · loop-runner · คิวว่าง
- ทำอะไร: รอบที่ 2/10: ไม่มี task สถานะ ready ที่ dependencies ครบในเขต integrations — จบลูป
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: งบสะสม $2.7538/$20 · เติมคิว ready ให้ครบ ≥ 5 task ต่อเขต (PLAN.md §10)

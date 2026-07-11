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

# tests/unit — Unit business-logic test spec (Gate G3)

Expected-first specifications for PLAN.md §9 **Gate 3 (Unit business logic)**:
posting rules · ตัด remain BOQ · retention · approval matrix · quota · งวดงาน 4 basis.

> **กฎเหล็กของเขต (tests/CLAUDE.md):** เขียน expected จาก **spec เท่านั้น** —
> **ห้ามอ่าน implementation ก่อนเขียน expected values** เพื่อกัน test ที่วิ่งตามโค้ดผิด
> แทนที่จะจับผิดโค้ด. ทุกค่าคาดหวังในโฟลเดอร์นี้ถอดจาก spec ด้านล่าง ไม่ใช่จาก `apps/`.

## Spec sources (อ้างอิงต่อค่าคาดหวัง)

| ด้าน | แหล่ง spec |
|---|---|
| posting rules (GL/JV) | `docs/handoff/data-dictionary.html` (AP/AR·GL·Bank) · `docs/handoff/FUNCTIONS.md` (Global rule #3) · PLAN.md ภาคผนวก C **C9** |
| ตัด remain BOQ | `docs/handoff/data-dictionary.html` (BOQItem `remain_qty ตัดเมื่อเปิด PR`) · `docs/handoff/FUNCTIONS.md` (`openBOQtoPR`) |
| retention | `docs/handoff/data-dictionary.html` (`Contract.retention_pct`) · `docs/handoff/FUNCTIONS.md` (งวดงาน→หัก retention→AP) · ภาคผนวก B (Retention ledger) |
| approval matrix | `docs/handoff/data-dictionary.html` (`Role.approval_limits`, `PR.approval_step`) · `docs/handoff/FUNCTIONS.md` (PR: matrix ตามมูลค่า · Global rule #4) |
| quota | `docs/extract/PACKAGE-RULES.md` §1/§5 · PLAN.md §5 (402 `QUOTA_EXCEEDED` + `upgrade_url`) |
| งวดงาน 4 basis | `docs/handoff/data-dictionary.html` (`WorkPeriod.basis`) · PLAN.md ภาคผนวก C **C2/C3** · `docs/extract/MOCK-DATA.md` §SubconContract |

## Status of each area

- **Fully specified → concrete expected values below:** งวดงาน 4 basis (C2/C3), retention, ตัด remain BOQ, quota.
- **Invariant-only (per-document account mapping is an Open Question):**
  - **posting rules** — spec fixes only the *double-entry invariant* (`Σ DR = Σ CR`, ภาคผนวก C9).
    Which accounts a document type debits/credits = **PLAN.md §11 Open Q #3** (รอนักบัญชี validate).
    ค่าคาดหวังระดับ account mapping **ยังไม่เขียน** — จะผูกเมื่อ Wei/นักบัญชีตอบ. ห้ามเดา.
  - **approval matrix** — spec fixes the *routing rule* (escalate จนกว่า `authLimit ≥ amount`).
    เพดานจริงต่อ role มาจาก seed `ROLE_PRESETS` (P0-BE-10); "fix vs configurable ต่อบริษัท" =
    **Open Q #2**. เขียน rule + example thresholds ที่ทำเครื่องหมายว่าเป็นตัวอย่าง ไม่ผูกค่าตายตัว.

## ทำไมเป็น `it.todo()` (ยังไม่รันกับโค้ด)

Gate ของ P0-QA-05 = **spec review โดย Wei — ยังไม่รันกับโค้ด**. business logic (`apps/api`,
`packages/*`) ยังไม่ถูก implement. แต่ละไฟล์จึง:

1. ประกาศ **CASES** = ตารางค่าคาดหวัง (pure data ถอดจาก spec) — สิ่งที่ Wei review
2. `it(...)` ที่ **ยืนยันความสอดคล้องภายในของ fixtures เอง** (เช่น JV บาลานซ์ DR=CR,
   retention = withheld + net) → รันเขียวได้ทันที ไม่ต้องมี implementation
3. `it.todo(...)` = จุดต่อสายเข้า business function จริง เมื่อ logic ลงแล้ว
   (แทน todo ด้วย assertion ที่เรียกฟังก์ชันจริงเทียบ `expected`)

รัน: `pnpm --filter @juneflow/tests run test:unit`

# FLOW-A Data + Action Completeness — Wei Decision Packet

> **สถานะ:** READY (orch-A · 2026-07-16) — **Wave-1 web ports ครบทั้ง 12 จอแล้ว** (all in review · dev)
> **บริบท:** Wave-1 web ports **ครบเชิงโครงสร้าง 100%** (pototype-faithful · merged · structural-G5 PASS ทุกจอ · dev build 305 modules clean · Thai-free)
> เอกสารนี้ = แผนทำให้จอเหล่านั้น **data-complete** (ผ่าน live-pixel-G5 ด้วย "ข้อมูลจริง" ไม่ใช่ em-dash)
>
> **จอที่ port รอบนี้ (12):** vendor · gr · boq.overview · boq.editor · boq.bom · boq.approval · boq.archive · boq.reports · boq.aiqto · pr · po · wo · dashboard
> **live-G5 แล้ว (orch-B):** 9 PASS · 1 FAIL (gr.list B-074) · จอใหม่รอบนี้รอ orch-B รอบถัดไป

---

## 1. แก่นปัญหา (ทำไมต้องมี packet นี้)

`structural-G5 PASS ≠ live-G5 PASS`

- ทุกจอ port ตรง prototype เป๊ะ (layout/token/i18n = ผ่าน)
- แต่ **backend wire บางกว่า mock ของ prototype** → field ที่ prototype โชว์ข้อมูล แต่ backend ไม่มี source
- ตาม **§0 กฎ 3 (ห้าม fabricate)** → จอ render `—` (em-dash) / empty-state อย่างซื่อสัตย์
- ผลคือเทียบ reference (ที่มีข้อมูลเต็มจาก mock) แล้ว **live-pixel ต่างสาระ** → orch-B live-G5 pass 9/10 · **gr.list FAIL (B-074)** เพราะ em-dash เยอะเกิน

**ไม่ใช่ bug ของ port** — port ถูกต้องแล้ว · เป็น **backend ยังไม่มีข้อมูล/endpoint ให้จอกิน**

**ทางที่ห้ามทำ:** crop reference ให้ตรง em-dash = ผิด §0 กฎ 1 (pototype คือกฎหมาย) — ปฏิเสธแล้ว

---

## 2. Gap Inventory — จัดกลุ่มตามชนิดงาน

### กลุ่ม A — Wire-extend + Seed (โชว์ field ที่มีอยู่แล้วให้เป็นข้อมูลจริง)
*ROI สูงสุด · additive migration (precedent 0012-0017) · ทำให้จอส่วนใหญ่ผ่าน live-G5*

| จอ | gap | ต้องการ |
|---|---|---|
| gr.list (B-074) | GET /gr = `{no,po_id,wo_id,status,received,rejected}` เท่านั้น → รายการ/ผู้ขาย/มูลค่า/วันที่/ordered-qty/badge em-dash | extend GET /gr คืน line items + vendor + value + date + ordered · seed line rows |
| pr.list (B-075) | prWire ไม่มี title/vendor/requester/phase/budget%/urgent/doc-date/approval-timestamps | extend pr schema+contract+seed |
| po.list | poWire ไม่มี deposit/paid/GR%/date/line-items | extend po + seed |
| wo.list | woWire ไม่มี scope/progress/installment-table | extend wo + seed installments |
| boq.editor | boq_item ไม่มี `detail` column | ADD boq_item.detail |
| boq.bom | **boms.items jsonb มีอยู่แต่ไม่มี endpoint** — /models คืนแค่ bom_item_count | **GET /models/{id}/bom** (contract) |
| boq.archive | ไม่มี approver/approve-date/attach-count column | extend boq_doc + seed |
| vendor | spend ไม่มี AP source | (รอ AP subsystem — defer หรือ seed stub) |

### กลุ่ม B — Action Endpoints ใหม่ (ปุ่ม mutation ที่ตอนนี้เป็น stub)
*medium · เปิดปุ่มที่ prototype มีแต่ backend ยังไม่มี route*

- **boq.approval:** reject / request-edit endpoint + reason-persist field (ตอนนี้ notify-only stub)
- **po:** cancel · pay endpoint
- **wo:** variation (งานเพิ่ม-ลด) · close (ปิดสัญญา) endpoint
- **boq:** copy/duplicate endpoint (`POST /boq/{id}/copy`) — archive "copy to new BOQ"
- **boq.editor:** update/delete item · group-CRUD · import · template endpoints
- **boq.bom:** line-item edit (boms.items write)

### กลุ่ม C — Analytics + Version + AI subsystem (ใหญ่สุด · อาจเป็น Wave เอง)
*largest · ระบบใหม่ทั้งชุด*

- **boq.reports: ไม่มี reports/analytics backend เลย** → ทั้งจอ empty-state · ต้องการ reports-aggregate endpoints + sources: Non-BOQ over-plan spend · per-installment actual cost · EVM (PV/EV/AC time-series) · revise before/after snapshot
- **version-history / revise-snapshot log** (schema foundation) — ปลดล็อก 3 อย่างพร้อมกัน: boq.approval version-diff table · boq.archive revise-history expand · RPT-002
- **dashboard analytics sources** — budget-vs-actual time-series · cashflow-forecast · recent-activity feed · alerts engine · 5-indicator health score (ตอนนี้ BE-15 honest-empty เพราะ seed ไม่มี source type)
- **AI-QTO engine (§12)** — ai-qto.ts เป็น stub · IFC/BIM parse ยังไม่สร้าง → boq.aiqto steps 2-4 empty-state · ระบบ AI จริงทั้งชุด

### กลุ่ม D — เล็ก/อิสระ (ทำเร็ว · ปลดล็อกทันที)
- **notifications 404** — GET /notifications ไม่มี → กระดิ่ง fail silent · ต้องการ stub-empty หรือ real endpoint
- **B-077 create-boq project_id** — SACRED `createBoqFromAiQto` body model แค่ `{mappings}` → create wizard 400 · ต้องการ sacred openapi patch (เพิ่ม project_id) หรือ backend derive
- **i18n keys ขาด** (SACRED i18n round): generic error-toast · approve-success toast (boq.approval) · gr Return-form modal + cancel-reason (B-072) · aiqto quota-chip (pkg-builder) · dashboard 3 DatePicker keys (ต้นเดือน/ต้นปี/เลือกวันที่) + alerts count-template
- **B-076 escalate-copy conflict** — i18n `boq.aprEscalateInfo` สื่อ 500K threshold ขัด no-threshold rule → Wei ตัดสิน: คง copy / แก้ copy / แก้ backend
- **QA (orch-B zone):** `screens.manifest.json` dashboard row = shell-only masked (B-048) → body port แล้ว ควร drop mask → full-page G5

---

## 3. ข้อเสนอลำดับงาน (orch-A recommend)

1. **กลุ่ม A ก่อน** — additive migration + seed · ROI สูงสุด · จอส่วนใหญ่ผ่าน live-G5 ทันที
2. **กลุ่ม D** — เร็ว · ปลดกระดิ่ง + toast + escalate ruling
3. **กลุ่ม B** — เปิดปุ่ม mutation
4. **กลุ่ม C** — reports + version subsystem · ใหญ่ · แยกเป็น Wave-2 หรือ Wave เฉพาะได้

---

## 4. คำถามที่ต้องให้ Wei ตัดสิน

**Q1 — Wave-1 นับว่า "เสร็จ" หรือยัง?**
- (ก) เสร็จแล้ว (structural + merged + pototype-faithful) → data-completeness = งาน backend wave ใหม่
- (ข) ยังไม่เสร็จจนกว่า live-G5 ผ่านข้อมูลจริง → ทำกลุ่ม A ต่อทันทีก่อนไป Phase 2

**Q2 — ทำ data-completeness เป็น "Phase-2 Wave-1.5" (ปิด FLOW-A ให้จบจริง) หรือเลื่อนไปทำ flow ถัดไปก่อน (Wave-2) แล้วค่อยวน?**

**Q3 — กลุ่ม C (reports + EVM + version-history) — priority จริงแค่ไหน?** (ระบบใหญ่ · อาจ defer ยาว)

**Q4 — B-076 escalate copy:** คง prototype / แก้ i18n ตัด ≥500K / ยืนยัน BOQ มี threshold แก้ backend?

---

*Gap sources: REVIEW-QUEUE.md rows P1-WEB-07 + P2-WEB-01/03/04/05/06/07/08/09/10/11 + BLOCKERS B-072/074/075/076/077 + orch-B live-G5 C-065*

---

## 5. สรุปให้ Wei อ่านเร็ว (TL;DR)

- **Wave-1 web = 12 จอ port ครบ · merged · structural-G5 PASS · build เขียว** ✅ (นี่คือ deliverable ที่สั่ง "ทำให้เสร็จ")
- จอสวย+ตรง prototype 100% แต่ **หลายจอโชว์ `—`** เพราะ backend ยังไม่มีข้อมูล/endpoint (ไม่ใช่ bug — ซื่อสัตย์ตาม §0)
- ทำให้ "มีข้อมูลจริง" = งาน backend 4 กลุ่ม (A เร็ว/คุ้ม → D เล็ก → B ปุ่ม → C ระบบใหญ่)
- **ผมแนะนำ:** ตอบ Q1+Q2 → ถ้าเลือกปิด FLOW-A ให้จบจริงก่อน ผมเดินกลุ่ม A+D ทันที (additive migration + seed · ผมเคยทำ 0012-0017 มาแล้ว) · กลุ่ม C ค่อยเป็น Wave แยก
- ระหว่างนี้ **orch-B รัน live-G5 จอใหม่** + Wei ยัง promote batch ปัจจุบันขึ้น main ได้ (structural-complete)

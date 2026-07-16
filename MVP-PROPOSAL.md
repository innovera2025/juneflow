# MVP-SCOPE PROPOSAL — Juneflow (เสนอ Wei ให้สัตยาบัน)

> เอกสารตัดสินใจ · ร่างโดย orch-A (workflow 4-agent · 2026-07-15) · สังเคราะห์จาก 3 analyses (PLAN extraction · Flows/package-tier ranking · Build-state/dependency) · หลักฐานอ้าง `file:line`
> **ขอบเขต MVP เป็นสิทธิ์ของ Wei เท่านั้น** — เอกสารนี้เป็น input ไม่ใช่คำตัดสิน · เมื่อ Wei เลือก scope → Wei เติมลง `PLAN.md §2` (sacred · Wei แก้คนเดียว) → freeze ปลด → agent แตก task Phase-2 ได้

---

## 1. สรุปสถานะ + ทำไมต้องนิยาม MVP ตอนนี้

`PLAN.md §2` (`PLAN.md:58-60`) ยังเป็น `**TODO [TBD-MVP]**` เปล่า — ไม่มี draft ใดในทั้ง repo — และ marker เดียวกันถูกบังคับเชิงกลไกที่ `TASKS.md:19` + `diff-reviewer.md:73` ทำให้ **ห้ามสร้าง task Phase 1+ ที่ผูกกับขอบเขต MVP** จนกว่า §2 จะถูกเติม ขณะเดียวกัน foundation พร้อมเกินคาด: **DB schema (G1) และ OpenAPI contract ถูกสเปคครบทั้งผลิตภัณฑ์แล้ว** — 60+ ตาราง และ 90+ endpoints รวม BOQ/PR/PO/WO/GR/finance/sales (`openapi.yaml:997-1415`, `packages/db/src/schema/*`) — ช่องว่างที่เหลือของ Phase 2-6 คือ **route handlers + web screens เท่านั้น** ไม่ต้องปลดล็อก sacred file ใหม่ Phase 1 web เดินมาไกล (login · app-shell · master wave 7 จอ done) และ dashboard เพิ่ง un-defer → GO วันนี้ (`B-049`) แต่ **ยังไม่มีจอเดียวสำหรับ BOQ/procurement/subcon/finance/sales** ทั้ง 5 flows หลักยังไม่ถูกแตะ กล่าวคือ board กำลังจะ starve — master wave ใกล้หมด แต่ระบบกลไกล็อกไม่ให้แตก task ต่อ นี่คือคอขวดเดียวที่เหลือ และปลดได้ด้วยการเติม §2 เท่านั้น

---

## 2. สามตัวเลือก MVP scope (เล็ก → ใหญ่)

**บริบทร่วมทุกตัวเลือก:** contract + schema มีครบแล้ว · งานจริง = handler + port จอ (pattern พิสูจน์แล้ว 7 จอ) · effort ใช้ scale S/M/L เทียบ comparable (จอ master ~3 ชม./จอ, backend 3-resource ~4 ชม.)

**Prerequisite ร่วมทุกตัวเลือก:** `master.vendor` และ `master.customer` **ยังไม่มี task row** (grep ไม่พบใน `TASKS.md`) — แต่ `pr`/`po`/`wo` อ้าง vendor → **`master.vendor` เป็น prerequisite ซ่อนของ procurement** ต้องเข้า wave แรกทุกตัวเลือก · project creation (`P1-BE-13`+wizard) ยัง `ready` รอ port

---

### (A) Lean vertical slice — FLOW-A ครึ่งหน้า (procure-only), demo เร็วสุด

| หัวข้อ | รายละเอียด |
|---|---|
| **Flows** | FLOW-A ครึ่งหน้า: **BOQ → PR → PO/WO → GR** (หยุดก่อนจ่ายเงิน) = ตรง **S/Starter tier** (`PACKAGE-RULES.md:22`) |
| **จอ web** | `CreateProjectForm` (wire `P1-BE-13`) · `boq.jsx` (multi-tab) · `boq-list` · `pr-list`+`pr-form` (ไม่มี gallery ref → capture Fiori ใหม่) · `po-wo` · `gr.jsx` · **+ `master.vendor`** ≈ **8 จอ** |
| **Endpoints** | `POST /projects` · `/boq` (+submit/approve/items/generate-pr) · `/pr` · `/po`/`/wo` · `/gr` ≈ 5 module / ~18 ep (contract มีครบ) |
| **Effort** | project S · **BOQ L (หนักสุด — state machine + generate-pr + CBS)** · PR M · PO/WO M · GR S · vendor M → **รวม ≈ L** |
| **Mobile** | ไม่เข้า |
| **จุดอ่อน** | หยุดที่ GR → demo เห็นแค่ "กรอกเอกสาร" ไม่พิสูจน์คุณค่าเชิงการเงิน |

### (B) Balanced core — FLOW-A ครบวง + finance touch ⭐ แนะนำ

| หัวข้อ | รายละเอียด |
|---|---|
| **Flows** | **FLOW-A เต็ม** (BOQ→PR→PO/WO→GR→**AP→PV→จ่าย/bank export**) + **finance touch**: posting + P&L รายโครงการ = จุดที่ vendor บอกว่า "loop เต็มทำได้" (M tier `PACKAGE-RULES.md:23`) |
| **จอ web** | ของ (A) **+** `ap.jsx` (billing+pv `NAV:68-69`) · `bank.export` (`NAV:81`) · `gl.projectpl` (P&L รายโครงการ `NAV:66`) + `gl.jv`/`gl.inbox` posting ขั้นต่ำ · **dashboard** (`P1-WEB-07`) ≈ **13 จอ** |
| **Endpoints** | ของ (A) **+** `/ap` · `/bank/export` · `/gl` (jv,inbox,project-pl) · **dashboard ~7 ep ใหม่** (Wei GO แล้ว B-049) |
| **Effort** | (A=L) + AP M + bank S + GL-touch M + dashboard L → **รวม ≈ XL** |
| **Mobile** | ไม่เข้า |
| **ทำไม balanced** | ปิด loop คุณค่าจริง (เงินออก + เห็นต้นทุนต่อโครงการ) = **ERP demo** ไม่ใช่แอปฟอร์ม · ยังเจาะแนวดิ่ง flow เดียว ไม่กว้างทั้ง M-tier |

### (C) Full Phase-1+2 — จบ Phase 1 + Phase 2 ทั้งหมด (broad)

| หัวข้อ | รายละเอียด |
|---|---|
| **Flows** | Phase 1 ครบ + **Phase 2 เต็ม = BOQ + procurement + Inventory** (`PLAN.md:143`) — กว้างแต่**ไม่แตะ finance** (Phase 3) |
| **จอ web** | ของ (A) **+ `inv.*`** (~2-3 จอ) · **`master.customer`** · **`master.docnum`** · WO/VO เต็ม · dashboard ≈ **14-15 จอ** |
| **Effort** | **≈ XXL** — กว้างสุด แต่ demo ตื้นกว่า B (ยังไม่มี finance) · first-demo ช้าสุด |
| **จุดอ่อน** | จอเยอะสุด headline loop ยังไม่ถึง finance → effort สูงกว่า B แต่ demo ไม่กระแทกกว่า |

---

## 3. คำแนะนำ + เหตุผล — **เลือก (B) Balanced core**

1. **มีแค่ B ที่ปิด loop คุณค่า** — "define → BOQ → procure → track → **cost/finance**" `gl.projectpl` = จอที่ตอบ "ต้นทุน/การเงินต่อโครงการ" ตรงตัว (`NAV:66`) · A หยุดที่ GR · C กว้างแต่ยังไม่ถึง finance
2. **ความเสี่ยงจำกัด** — contract + schema มีครบทุกส่วนของ B แล้ว · sacred unlock เดียว = dashboard ~7 ep ซึ่ง **Wei GO แล้ว** (`B-049`)
3. **dependency สะอาด** — BOQ→PR→PO→GR อยู่ในเขต board ที่ว่าง · pattern พิสูจน์แล้ว 7 จอ master
4. **ตรง signal ของ vendor** — M tier = จุดที่ "loop เต็มทำได้" (`PACKAGE-RULES.md:23`) · B เจาะแนวดิ่งของ M
5. **เทียบ C** — C ได้จอมากกว่าแต่ demo อ่อนกว่า + first-demo ช้าสุด → cost สูง value ต่ำกว่า

**ทางเลือกเสริม:** ถ้าต้องการ demo เร็วสุด ทำ **A ก่อนเป็น milestone แรกของ B** (A ⊂ B) แล้วต่อ finance touch เป็น wave ถัดไป

---

## 4. ผลกระทบต่อ loop — เมื่อ Wei เลือก B จะแตกเป็น wave อะไร

> ทุก task = 1 zone = 1 worktree = 5 gates + diff-reviewer

- **Wave 0 (คอขวดปัจจุบัน — กำลังปิด):** `P1-BE-12` docnum ✅ merged · `P1-BE-13`(POST projects) + `P1-BE-14`(ptype scope) ready · WEB-12 ready (master wave 7/7) · WEB-07 dashboard prep กำลัง queue · **เพิ่ม task `master.vendor` (prerequisite ซ่อน)**
- **Wave 1 (procurement backend):** handler `boq.ts` · `pr.ts` · `po.ts`/`wo.ts` · `gr.ts`
- **Wave 2 (procurement web):** port `boq.jsx` · `boq-list` · `pr-list` · `pr-form` (capture Fiori) · `po-wo` · `gr.jsx`
- **Wave 3 (finance touch):** `ap.ts` + `bank export` + `gl.ts` (jv/inbox/projectpl) → web `ap.jsx` · `gl.projectpl`
- **Cross-cutting:** **Approval-matrix (คำถามข้อ 1) ต้องตอบก่อน** Wave 1/2 (ทุกจอ procurement มีขั้น approve)

---

## 5. คำถามที่ Wei ต้องตัดสินก่อนแตก task (ตอบพร้อมเลือก A/B/C ได้)

1. **Approval matrix — fixed หรือ configurable ต่อบริษัท?** (`PLAN.md:220` Q2) — **บล็อกตรง** ขั้น approve ของ BOQ/PR/PO
2. **demo ต้องมีฝั่งรายได้ (AR / วางบิลลูกค้า) ไหม หรือฝั่งต้นทุนพอ?** — `gl.projectpl` แสดงต้นทุนได้แม้ไม่มี AR
3. **"Track" = subcon/งวดงาน (FLOW-B ranked #2) แต่ `§7` วางไว้ Phase 4** — ดึง subcon เข้า MVP หรือ MVP "track" = สถานะ GR เท่านั้น?
4. **COA seed (23 accounts) + posting rules + doc-numbering format** (`PLAN.md:221-222`) — ยืนยัน demo project-P&L ใช้ seed COA / stub ได้
5. **AI QTO** — ยืนยัน `boq.aiqto` = fake-result UI (M+ gated) ตาม defer (`PLAN.md:234`)
6. **Mobile ยืนยันอยู่นอก MVP?** — 0/26 จอ + offline-first level (ก/ข) ยังไม่ตัดสิน → ยืนยัน mobile คง Phase 4

**ช่องที่ยังไม่ตรวจลึก (อย่าเดา):** ตัวเลข ชม.รวมแม่นยำ (มีแค่ S/M/L) · สเปคระดับจอ BOQ/proc อาจมี discrepancy ใน `GAPS.md` — ตรวจตอนแตก Wave 1


---

## ✅ APPROVED (Wei 16 ก.ค. · B-069) — ข้อความสำหรับ PLAN.md §2

> Wei เลือก **B** + 4 rulings · ข้อความด้านล่างให้ Wei วางแทน `**TODO [TBD-MVP]**` ใน **PLAN.md §2** (sacred · Wei แก้เอง) · หลัง apply แล้ว §11 Q1 + `> [TBD-MVP]` header (PLAN.md:4) ปรับตามได้

```markdown
## 2. MVP Definition

**MVP = Option B "Balanced core" (Wei 16 ก.ค. · B-069)** — เจาะแนวดิ่ง FLOW-A ครบวงจร + finance touch ให้ demo เป็น ERP loop จริง: define → procure → track → cost

**ขอบเขต IN:**
- FLOW-A procurement ครบวง: BOQ → PR → PO/WO → GR → AP → จ่ายเงิน/bank export
- Finance touch: GL posting (jv/inbox ขั้นต่ำ) + P&L รายโครงการ (gl.projectpl)
- Dashboard (default landing · B-049)
- Master prerequisite: master.vendor
- Approval matrix: fixed/seed จาก flows.html (ไม่ configurable ใน MVP)
- Track = GR/procurement status + phase-progress dashboard

**ขอบเขต OUT (defer เป็น Phase ถัดไป):**
- AR/รายได้/sales-CRM/land (Phase 5) · subcon/งวดงาน/ศูนย์ตรวจรับ/PM (Phase 4)
- Inventory · Mobile (Phase 4 · offline level ยังไม่ตัดสิน)
- AI-QTO engine จริง (fake-result UI M+ gated เท่านั้น · §12)
- Configurable approval · multi-currency เต็ม · Stripe/SSO/RLS (§12)

**Wave:** Wave-0 (master.vendor + ปิด Phase-1) → Wave-1 (procurement backend) → Wave-2 (procurement web) → Wave-3 (finance touch)
```

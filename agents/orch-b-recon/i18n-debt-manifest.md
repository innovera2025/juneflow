# Juneflow — i18n Translation-Debt Manifest

**Scope:** `packages/i18n/src/i18n-full.json` → `dict` section (the `t()` layer).  
**Type:** read-only recon (orch-B). i18n-full.json is a **sacred file** — NOT edited here. This manifest feeds one future Wei sacred translation round.  
**Date:** 2026-07-16 · **Author:** orch-B recon

> **Debt definition:** a `dict` entry where all three of `en` / `zh` / `ar` are byte-identical to the Thai (`th`) source — i.e. the string was never translated and falls back to Thai in every language. Langs in file: `th, zh, en, ar` (ar = RTL).

---

## 1. Summary

- **Total `dict` keys:** 1059
- **Debt keys** (en==zh==ar==th): **999**  → **94.3%** (survey estimate was ~87%; actual is higher)
- **Clean / translated keys:** 60  (namespaces `nav` 29, `common` 26, `app` 2, `user` 2, `login` 1 — the app-shell chrome)
- **Partial debt** (some-but-not-all langs == th): **0** — debt is all-or-nothing here

**Debt vs. code-usage cross-tab** (against `apps/web/src/**`, 139 `.ts/.tsx` files):

- **Actionable debt** (debt AND referenced in web) — worth translating: **738**
- **Debt AND dead** (unused in web — translating = wasted effort, drop candidates): **261**
- Total dead keys in dict (unused as a literal anywhere in web): **291** (30 of those are already-translated `nav` chrome)

**Top namespaces by debt:**

| # | namespace | debt | of total | actionable (live) | dead |
|---|-----------|-----:|---------:|------------------:|-----:|
| 1 | `boq` | 463 | 463 | 344 | 119 |
| 2 | `dashboard` | 70 | 70 | 38 | 32 |
| 3 | `vendor` | 44 | 44 | 44 | 0 |
| 4 | `po` | 44 | 44 | 34 | 10 |
| 5 | `gr` | 42 | 42 | 36 | 6 |
| 6 | `org` | 41 | 41 | 41 | 0 |
| 7 | `wo` | 37 | 37 | 24 | 13 |
| 8 | `docnum` | 36 | 36 | 12 | 24 |
| 9 | `ptype` | 34 | 34 | 15 | 19 |
| 10 | `pr` | 31 | 31 | 7 | 24 |
| 11 | `cc` | 27 | 27 | 27 | 0 |
| 12 | `model` | 24 | 24 | 24 | 0 |
| 13 | `users` | 21 | 21 | 21 | 0 |
| 14 | `login` | 20 | 21 | 20 | 0 |
| 15 | `role` | 18 | 18 | 18 | 0 |
| 16 | `block` | 13 | 13 | 13 | 0 |
| 17 | `project` | 12 | 12 | 12 | 0 |
| 18 | `createProj` | 12 | 12 | 0 | 12 |
| 19 | `dept` | 5 | 5 | 5 | 0 |
| 20 | `company` | 3 | 3 | 1 | 2 |
| 21 | `perm` | 1 | 1 | 1 | 0 |
| 22 | `master` | 1 | 1 | 1 | 0 |
| | **TOTAL** | **999** | **1059** | **738** | **261** |

---

## 2. Per-namespace debt tables

Grouped by namespace so a translator can batch by domain. Key order preserves the source-`.jsx` order (screens stay grouped). `live?` column: **DEAD** = key is never referenced in `apps/web/src` (skip it — see §3); blank = referenced/live.

### `boq` — 463 debt keys (344 live · 119 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `boq.ovSubtitle` | ภาพรวม Bill of Quantities · ผูกกับ Master Project → Phase → Block → Unit |  |
| `boq.ovScopeLabel` | ขอบเขต BOQ |  |
| `boq.ovScopeFloor` | ชั้น |  |
| `boq.ovReload` | รีโหลด |  |
| `boq.ovReloadToast` | รีโหลดข้อมูล BOQ ตามขอบเขต |  |
| `boq.ovKpiTotal` | มูลค่า BOQ รวม |  |
| `boq.ovKpiPendingRevise` | รออนุมัติ Revise |  |
| `boq.ovKpiUsed` | ใช้งบไป (จาก BOQ) |  |
| `boq.ovFlowTitle` | การไหลของงบ — BOQ → PR → PO/WO → GR |  |
| `boq.ovFlowApproved` | BOQ ที่อนุมัติ |  |
| `boq.ovFlowPR` | เปิดเป็น PR แล้ว |  |
| `boq.ovFlowPOWO` | อนุมัติเป็น PO / WO |  |
| `boq.ovFlowGR` | รับวัสดุ / รับงาน (GR) |  |
| `boq.ovTabBoq` | BOQ + Balance |  |
| `boq.ovTabNon` | Non-BOQ |  |
| `boq.ovTabGrpo` | GR PO |  |
| `boq.ovTabGrwo` | GR WO |  |
| `boq.ovTabRev` | Revise History |  |
| `boq.ovSearchPh` | ค้นหา Material / Cost Name / รหัส... |  |
| `boq.ovEmptyTab` | เลือกแท็บ {tab} เพื่อดูตารางรายการแสดงตัวอย่าง |  |
| `boq.ovThBoqQty` | BOQ (จำนวน) |  |
| `boq.ovThUsed` | ใช้ไป |  |
| `boq.ovThBalance` | Balance |  |
| `boq.ovThBoqValue` | มูลค่า BOQ (฿) |  |
| `boq.ovThBalanceValue` | Balance (฿) |  |
| `boq.ovThPctUsed` | % Used |  |
| `boq.listSubtitle` | รายการ BOQ ทั้งหมด · ผูกกับ Project → Phase → Block → Unit/Model |  |
| `boq.listKpiAll` | BOQ ทั้งหมด |  |
| `boq.listKpiValueFilter` | มูลค่ารวม (กรอง) |  |
| `boq.listKpiValueSub` | ผลรวมรายการที่แสดง |  |
| `boq.listKpiDraftPending` | ร่าง + รออนุมัติ |  |
| `boq.listKpiPendingDelta` | ค้าง |  |
| `boq.listSearchPh` | ค้นหา รหัส / ชื่อ / ผู้รับผิดชอบ... |  |
| `boq.listStatusAll` | ทุกสถานะ |  |
| `boq.listThCodeBoq` | รหัส BOQ |  |
| `boq.listThNameBoq` | ชื่อ BOQ |  |
| `boq.listThScope` | โครงการ / เฟส / บล็อก / Unit-Model |  |
| `boq.listEditInEditor` | แก้ไขใน Editor |  |
| `boq.listDelReasonPh` | เหตุผลการลบ... | DEAD |
| `boq.listNewSubtitle` | กำหนดขอบเขต · เลือกวิธีเริ่มต้น · ระบบจะออกเลขที่ให้อัตโนมัติ |  |
| `boq.listScopeSection` | ขอบเขต |  |
| `boq.listFldUnitModel` | ยูนิต / Model |  |
| `boq.listFldLevel` | ระดับการสร้าง BOQ |  |
| `boq.listLevelBomFormula` | BOM (ระดับสูตร) |  |
| `boq.listLevelByUnit` | by Model / Unit |  |
| `boq.listLevelByBlock` | by Block / Floor |  |
| `boq.listStartFrom` | เริ่มต้นจาก |  |
| `boq.listTplBom` | จาก BOM (สูตรต่อหลัง) |  |
| `boq.listTplBomD` | ดึงรายการจากสูตร BOM ของ Model ที่เลือก × จำนวนยูนิต |  |
| `boq.listTplCopy` | คัดลอกจาก BOQ เดิม |  |
| `boq.listTplCopyD` | เริ่มจาก BOQ ที่มีอยู่แล้ว แล้วปรับแก้ |  |
| `boq.listTplScratch` | สร้างใหม่จากศูนย์ |  |
| `boq.listTplScratchD` | เริ่มจาก BOQ เปล่า เพิ่มหมวด/รายการเอง |  |
| `boq.listTplExcelD` | อัปโหลดไฟล์ + จับคู่คอลัมน์ แล้วนำเข้า |  |
| `boq.listErrCode` | ระบุรหัส BOQ |  |
| `boq.listErrName` | ระบุชื่อ BOQ |  |
| `boq.listErrExcel` | อัปโหลดและตรวจสอบไฟล์ก่อนสร้าง |  |
| `boq.listSelectBomModel` | เลือกสูตร BOM (Model) |  |
| `boq.listCopyFromBoq` | คัดลอกจาก BOQ |  |
| `boq.listFldCurrency` | หน่วยเงิน |  |
| `boq.listFldStartDate` | วันที่เริ่มต้น |  |
| `boq.listFldOwnerUnit` | หน่วยงานเจ้าของ |  |
| `boq.listFldApprover` | ผู้อนุมัติขั้นต้น |  |
| `boq.listOptionalPh` | ไม่บังคับ |  |
| `boq.listSubmitCreate` | สร้าง BOQ |  |
| `boq.listExcDropText` | ลากไฟล์ Template BOM & BOQ มาวาง หรือเลือกไฟล์ |  |
| `boq.listExcDownloadTpl` | ดาวน์โหลด Template |  |
| `boq.listExcPickSample` | เลือกไฟล์ตัวอย่าง |  |
| `boq.listExcChangeFile` | เปลี่ยนไฟล์ |  |
| `boq.edCreateRevise` | สร้าง Revise |  |
| `boq.edSaveDraftToast` | บันทึกร่าง BOQ แล้ว |  |
| `boq.edSendApproveTitle` | ส่ง BOQ ไปอนุมัติ |  |
| `boq.edSendApproveToast` | ส่ง BOQ ไปอนุมัติแล้ว |  |
| `boq.edLockBadge` | 🔒 ล็อก · แก้ไขผ่าน Revise |  |
| `boq.edReviseBadge` | กำลังแก้ไขเป็นเวอร์ชันใหม่ → ส่งอนุมัติ Revise |  |
| `boq.edFreshBadge` | BOQ ใหม่ · ยังไม่มีรายการ |  |
| `boq.edLevelBomHouse` | BOM (ตามแบบบ้าน) |  |
| `boq.edEmptyTitle` | ยังไม่มีรายการ — เริ่มจากไหนดี? |  |
| `boq.edStartManual` | เพิ่มรายการด้วยตัวเอง |  |
| `boq.edStartManualD` | เริ่มจากหมวดงานมาตรฐาน 6 หมวด |  |
| `boq.edStartBom` | นำเข้าจาก BOM |  |
| `boq.edStartBomD` | ดึงสูตรวัสดุ-แรงงานต่อหลัง |  |
| `boq.edStartExcelD` | อัปโหลด + จับคู่คอลัมน์ |  |
| `boq.edDownloadTplExcel` | ดาวน์โหลด Template Excel |  |
| `boq.edStartManualToast` | เริ่มด้วยหมวดงานมาตรฐาน — เพิ่มรายการได้เลย | DEAD |
| `boq.edStartBomToast` | ดึงรายการจากสูตร BOM แล้ว · ตรวจสอบและปรับแก้ได้ | DEAD |
| `boq.edCardMaterial` | Material · วัสดุ |  |
| `boq.edCardSubcon` | Subcontractor · ค่าผู้รับเหมา |  |
| `boq.edCardLabor` | Labor · ค่าแรง |  |
| `boq.edCardTotalGroup` | ยอดรวมหมวดนี้ |  |
| `boq.edCbsTitle` | Budget Control · CBS |  |
| `boq.edCbsSubtitle` | งบ vs ใช้ไป vs ผูกพัน vs คงเหลือ — ตามหมวดงาน |  |
| `boq.edCbsBudget` | งบรวม |  |
| `boq.edCbsCommitted` | ผูกพัน |  |
| `boq.edCbsLegUsed` | ใช้ไป (Actual) |  |
| `boq.edCbsLegCommit` | ผูกพัน (PR/PO Committed) |  |
| `boq.edGroupsPanel` | BOQ Groups |  |
| `boq.edRename` | เปลี่ยนชื่อ |  |
| `boq.edDelGroup` | ลบหมวด |  |
| `boq.edGroupsFooterTotal` | ยอดรวมทุกหมวด |  |
| `boq.edReadOnly` | อ่านอย่างเดียว |  |
| `boq.edTemplateBtn` | Template |  |
| `boq.edImportBtn` | Import |  |
| `boq.edGenPr` | สร้าง PR จากรายการที่เลือก |  |
| `boq.edMoveGroup` | ย้ายหมวด |  |
| `boq.edMoveGroupToast` | ย้ายไปหมวดอื่น · เลือกหมวดในเมนูถัดไป | DEAD |
| `boq.edDelSelected` | ลบที่เลือก |  |
| `boq.edThMaterialItem` | Material / รายการ |  |
| `boq.edThCostName` | Cost Name |  |
| `boq.edThQty` | QTY |  |
| `boq.edThUnitEn` | Unit |  |
| `boq.edThPriceUnit` | Price/Unit |  |
| `boq.edThTotal` | Total (฿) |  |
| `boq.edEmptyRowsGroup` | ยังไม่มีรายการในหมวดนี้ — กด 'เพิ่มรายการ' เพื่อเริ่ม |  |
| `boq.edEmptyRowsFilter` | ไม่พบรายการที่ตรงกับตัวกรอง |  |
| `boq.edDupRowToast` | ทำซ้ำรายการแล้ว |  |
| `boq.edItemEditTitle` | แก้ไขรายการ BOQ | DEAD |
| `boq.edItemAddTitle` | เพิ่มรายการ BOQ |  |
| `boq.edItemUpdateToast` | อัปเดตรายการแล้ว | DEAD |
| `boq.edItemAddToast` | เพิ่มรายการแล้ว · อัปเดตยอดรวม |  |
| `boq.edDelItemTitle` | ลบรายการ BOQ | DEAD |
| `boq.edItemThis` | รายการนี้ | DEAD |
| `boq.edAddGroupTitle` | เพิ่ม BOQ Group ใหม่ | DEAD |
| `boq.edAddGroupSubtitle` | กำหนดรหัส + ชื่อหมวดงาน | DEAD |
| `boq.edRenameGroupTitle` | เปลี่ยนชื่อหมวด | DEAD |
| `boq.edRenameGroupToast` | เปลี่ยนชื่อหมวดแล้ว | DEAD |
| `boq.edDelGroupTitle` | ลบ BOQ Group | DEAD |
| `boq.edDelGroupReasonPh` | เหตุผลการลบหมวด... | DEAD |
| `boq.edItemTypeLabel` | ประเภทรายการ |  |
| `boq.edCatMaterial` | Material |  |
| `boq.edCatSubcon` | Subcontractor |  |
| `boq.edCatLabor` | Labor |  |
| `boq.edFldItemCode` | รหัสรายการ |  |
| `boq.edFldItemName` | ชื่อรายการ (Material) |  |
| `boq.edFldCostCenter` | Cost Center (Cost_Code ↔ Cost_Name) |  |
| `boq.edCostCenterPh` | เลือก Cost Center... |  |
| `boq.edFldQty` | จำนวน (QTY) |  |
| `boq.edFldPriceUnit` | ราคา / หน่วย |  |
| `boq.edItemTotalValue` | มูลค่ารวมรายการ |  |
| `boq.edAddItemUpdate` | เพิ่มรายการ + อัปเดตยอด |  |
| `boq.edFldGroupCode` | รหัสหมวด | DEAD |
| `boq.edFldGroupName` | ชื่อหมวดงาน | DEAD |
| `boq.edReviseTitle` | สร้าง Revise (ขอแก้ไข BOQ) |  |
| `boq.edReviseCopyNote` | คัดลอกรายการเดิมมาทั้งหมด แล้วแก้ไขได้ |  |
| `boq.edReviseScopeLabel` | ขอบเขตการแก้ไข | DEAD |
| `boq.edReviseScope1` | เพิ่ม/แก้รายการบางส่วน | DEAD |
| `boq.edReviseScope2` | แก้ราคาต่อหน่วย (price update) | DEAD |
| `boq.edReviseScope3` | เพิ่มหมวดงานใหม่ | DEAD |
| `boq.edReviseScope4` | ปรับทั้ง BOQ (major revise) | DEAD |
| `boq.edReviseReasonLabel` | เหตุผลการขอแก้ไข |  |
| `boq.edReviseReasonPh` | เช่น ราคาเหล็กปรับขึ้น + เจ้าของเพิ่มงานไฟฟ้า... |  |
| `boq.edReviseReasonErr` | ต้องระบุเหตุผลก่อนสร้าง Revise | DEAD |
| `boq.edLockTitle` | BOQ นี้อนุมัติแล้ว — แก้ไขได้ผ่าน Revise เท่านั้น |  |
| `boq.edLockDesc` | ตารางรายการถูกล็อกเพื่อรักษาความถูกต้องของงบที่อนุมัติ · การแก้ไขจะสร้างเป็นเวอร์ชันใหม่และต้องผ่านการอนุมัติ |  |
| `boq.edLockCreateRevise` | สร้าง Revise (ขอแก้ไข) |  |
| `boq.edAuditSubtitle` | ใคร · เมื่อไหร่ · แก้อะไร | DEAD |
| `boq.edAuditExport` | Export ประวัติ | DEAD |
| `boq.edAuditExportToast` | Export ประวัติการแก้ไข (CSV) | DEAD |
| `boq.ovFlowSubtitle` | เทียบมูลค่าแต่ละขั้นกับ BOQ ({total}) · ตัดงบอัตโนมัติเมื่ออนุมัติ PO/WO |  |
| `boq.ovUpdatedAt` | อัปเดต {time} น. | DEAD |
| `boq.ovRemainInfo` | คงเหลือใน BOQ พร้อมใช้ {value} — ยังไม่ได้เปิด PR ({pct}) |  |
| `boq.ovCommitInfo` | ภาระผูกพันรอ GR {value} |  |
| `boq.listKpiMatchFilter` | {n} ตรงตัวกรอง |  |
| `boq.listShowCount` | แสดง {shown} จาก {total} ฉบับ |  |
| `boq.listEmptyText` | ไม่พบ BOQ ตามเงื่อนไข · ลองล้างตัวกรอง หรือ {create} |  |
| `boq.listFootTotal` | รวม {n} ฉบับ |  |
| `boq.listDupToast` | ทำซ้ำเป็น {no} แล้ว | DEAD |
| `boq.listDelMsg` | ต้องการลบ {no} — {name} ({value} ฿) ออกจากระบบใช่หรือไม่? ไม่สามารถย้อนกลับได้ | DEAD |
| `boq.listDelToast` | ลบ {no} แล้ว | DEAD |
| `boq.listNameBoqPh` | เช่น ทาวน์โฮม Block B (เฟส 2) |  |
| `boq.listCreateToast` | สร้าง {no} สำเร็จ |  |
| `boq.listCurBaht` | บาท (THB) |  |
| `boq.listCurUsd` | ดอลลาร์ (USD) |  |
| `boq.listExcGroupBom` | กลุ่ม BOM | DEAD |
| `boq.listExcItemCode` | รหัส Item | DEAD |
| `boq.listExcItemName` | ชื่อรายการ | DEAD |
| `boq.listExcCostCode` | รหัส Cost | DEAD |
| `boq.listExcCostName` | ชื่อ Cost Center | DEAD |
| `boq.listExcMS` | M/S | DEAD |
| `boq.listExcSupport` | รองรับ .xlsx, .csv · 10 คอลัมน์: Group_boq · Material_Code · Material_Name · Detail · Cost_Code · Cost_Name · QTY · UOM · Price_Unit · Type |  |
| `boq.listExcSkipRows` | (ข้าม 2 แถวบนสุดที่เป็นคำอธิบาย/แหล่งดึงข้อมูล Master อัตโนมัติ) |  |
| `boq.listExcMatType` | วัสดุ (M) | DEAD |
| `boq.listExcSubType` | เหมา/แรง (S) | DEAD |
| `boq.listExcMatched` | · กลุ่ม {group} · จับคู่ 10 คอลัมน์อัตโนมัติ |  |
| `boq.listDownloadToast` | ดาวน์โหลด {file} |  |
| `boq.edPrintToast` | ส่งคำสั่งพิมพ์ {docNo} |  |
| `boq.edSendApproveMsg` | ส่ง BOQ ฉบับนี้ไปยังขั้นตอนอนุมัติ ({value} ฿) |  |
| `boq.edEmptyDesc` | {docNo} เป็น BOQ ใหม่ที่ยังว่างอยู่ · เลือกวิธีเริ่มต้นด้านล่าง เพิ่มรายการได้ทันที |  |
| `boq.edCardSub` | {count} รายการ · {pct}% |  |
| `boq.edCardTotalSub` | {group} · ต่อ 1 BOQ |  |
| `boq.edCbsDetail` | ใช้ {used} + ผูกพัน {committed} / งบ {budget} · เหลือ {available} |  |
| `boq.edGroupItems` | {n} รายการ |  |
| `boq.edSelectedCount` | เลือกแล้ว {n} รายการ |  |
| `boq.edFootGroupTotal` | ยอดรวม {group} |  |
| `boq.edPrMarked` | เปิด PR แล้ว · {prNo} |  |
| `boq.edItemSubtitle` | หมวด {group} |  |
| `boq.edDelItemSubtitle` | {n} รายการที่เลือก | DEAD |
| `boq.edDelItemMsg` | ต้องการลบ {target} ออกจาก BOQ ใช่หรือไม่? การลบจะส่งผลต่อยอดรวมและงบประมาณ | DEAD |
| `boq.edDelItemToast` | ลบ {n} รายการแล้ว | DEAD |
| `boq.edAddGroupToast` | เพิ่มหมวด {label} แล้ว | DEAD |
| `boq.edDelGroupMsg` | การลบจะลบ {n} รายการ ภายในหมวดทั้งหมด · ไม่สามารถย้อนกลับได้ | DEAD |
| `boq.edDelGroupToast` | ลบหมวด {label} แล้ว | DEAD |
| `boq.edCatShortSubcon` | ค่าผู้รับเหมา |  |
| `boq.edAddToGroup` | จะเพิ่มเข้า {group} |  |
| `boq.edGroupCodeHint` | เช่น 07, 08 ... | DEAD |
| `boq.edGroupNamePh` | เช่น 07 งานภายนอก + Landscape | DEAD |
| `boq.edReviseSubtitle` | {no} · เวอร์ชันปัจจุบัน {ver} |  |
| `boq.edReviseSubmit` | สร้าง {ver} & แก้ไข |  |
| `boq.edReviseToast` | สร้าง {no} {ver} (ร่าง-รออนุมัติ Revise) แล้ว |  |
| `boq.bomCatSubcon` | Subcontractor · ผู้รับเหมาช่วง |  |
| `boq.bomCatShortMat` | MAT |  |
| `boq.bomCatShortSub` | SUB |  |
| `boq.bomCatShortLab` | LAB |  |
| `boq.bomBreadcrumbLeaf` | BOM · สูตรต่อหลัง |  |
| `boq.bomTitle` | BOM · สูตรวัสดุ-แรงงานต่อหลัง |  |
| `boq.bomSubtitle` | ต้นแบบต้นทุนต่อ 1 หลัง แยกตามแบบบ้าน (Model) · เป็นต้นทางของ BOQ — BOQ = BOM × จำนวนยูนิต |  |
| `boq.bomImport` | นำเข้า BOM |  |
| `boq.bomGenBoq` | สร้าง BOQ จาก BOM |  |
| `boq.bomGenTitle` | สร้าง BOQ จาก BOM · {code} |  |
| `boq.bomGenMsgLine1` | ระบบจะสร้างรายการ BOQ จากสูตร BOM ต่อหลัง คูณด้วยจำนวนยูนิตของบล็อกที่เลือก |  |
| `boq.bomGenMsgLine2` | {n} รายการ/หลัง × {units} ยูนิต = {value} ฿ (มูลค่า BOQ รวมโดยประมาณ) |  |
| `boq.bomGenToast` | สร้าง BOQ จาก BOM {code} แล้ว · ลง BOQ-2026-B-02 v5 (รออนุมัติ) |  |
| `boq.bomModelMeta` | {area} ตร.ม. · {units} ยูนิต |  |
| `boq.bomEmptyTitle` | ยังไม่มี BOM สำหรับ {type} ({code}) |  |
| `boq.bomEmptyDesc` | เริ่มจากนำเข้าสูตรจาก Excel หรือคัดลอกจากแบบบ้านที่ใกล้เคียง แล้วปรับรายการให้ตรงสเปก |  |
| `boq.bomCopyOther` | คัดลอกจากแบบอื่น |  |
| `boq.bomCopyToast` | คัดลอก BOM จากแบบ B-1 |  |
| `boq.bomKpiCostPerHouse` | ต้นทุนต่อหลัง |  |
| `boq.bomKpiItemsVer` | {n} รายการ · {ver} |  |
| `boq.bomKpiCatMaterial` | หมวด Material |  |
| `boq.bomKpiCatSubcon` | หมวด Subcon |  |
| `boq.bomKpiCatLabor` | หมวด Labor |  |
| `boq.bomListHeader` | รายการ BOM · {type} ({code}) |  |
| `boq.bomUpdatedAt` | อัปเดต {date} |  |
| `boq.bomExportToast` | Export BOM เป็น Excel แล้ว |  |
| `boq.bomEditItemTitle` | แก้ไขรายการ BOM | DEAD |
| `boq.bomCatGroupSummary` | · {n} รายการ · {value} ฿ |  |
| `boq.bomFootTotal` | รวมต้นทุนต่อ 1 หลัง · {type} |  |
| `boq.bomInfoFormula` | BOQ ของบล็อกนี้ = ต้นทุน BOM ต่อหลัง {total} ฿ × {units} ยูนิต = {grand} ฿ |  |
| `boq.aprFilesTitle` | ไฟล์แนบ · {no} |  |
| `boq.aprFilesSubtitle` | {n} ไฟล์ · {ver} |  |
| `boq.aprPrintTitle` | พิมพ์ BOQ {no} |  |
| `boq.aprPrintMsg` | เลือกรูปแบบการพิมพ์: PDF เปรียบเทียบ Revise หรือ BOQ ฉบับเต็ม |  |
| `boq.aprPrintConfirm` | ส่งพิมพ์ | DEAD |
| `boq.aprPrintToast` | ส่งคำสั่งพิมพ์ {no} |  |
| `boq.aprTitle` | อนุมัติ BOM / BOQ |  |
| `boq.aprSubtitle` | เปรียบเทียบ Revise — ดูรายการที่เพิ่ม/ลด เทียบกับเวอร์ชั่นก่อน — อนุมัติ/ปฏิเสธพร้อมเหตุผล |  |
| `boq.aprPendingSort` | เรียงตามเวลาส่งอนุมัติ · ล่าสุดก่อน |  |
| `boq.aprAgeAgo` | {age} ที่แล้ว | DEAD |
| `boq.aprVerFirstSuffix` | · ใหม่ |  |
| `boq.aprReviseVer` | Revise · {ver} |  |
| `boq.aprFilesBtn` | ไฟล์แนบ ({n}) |  |
| `boq.aprDiffOldValue` | มูลค่า BOQ เดิม ({ver}) |  |
| `boq.aprDiffNewValue` | มูลค่า BOQ ใหม่ ({ver}) |  |
| `boq.aprDiffNet` | ส่วนต่าง (Net) |  |
| `boq.aprDiffNewBoq` | BOQ ใหม่ | DEAD |
| `boq.aprDiffChanged` | รายการที่เปลี่ยน |  |
| `boq.aprNewItemsCount` | {n} รายการใหม่ | DEAD |
| `boq.aprChangedOf` | {a} จาก {b} | DEAD |
| `boq.aprFirstEdition` | ฉบับแรก | DEAD |
| `boq.aprChangeBreakdown` | {add} เพิ่มใหม่ · {del} ลบ · {edit} แก้ราคา/จำนวน | DEAD |
| `boq.aprTabInc` | เพิ่ม / Increase |  |
| `boq.aprTabDec` | ลด / Decrease |  |
| `boq.aprCompareVer` | เปรียบเทียบ {vA} ({dateA}) กับ {vB} ({dateB}) |  |
| `boq.aprThEdit` | การแก้ไข |  |
| `boq.aprThOldVal` | ค่าเดิม |  |
| `boq.aprThNewVal` | ค่าใหม่ |  |
| `boq.aprThDeltaVal` | มูลค่าเปลี่ยน |  |
| `boq.aprNetDiffFoot` | ส่วนต่างสุทธิ (เพิ่ม {inc} · ลด {dec}) |  |
| `boq.aprChainTitle` | ลำดับอนุมัติ |  |
| `boq.aprChainRequester` | วิภา (ผู้ขอ) |  |
| `boq.aprChainPurchasing` | หน. จัดซื้อ |  |
| `boq.aprChainDirector` | ผอ.ก่อสร้าง |  |
| `boq.aprNotifyInApp` | ในระบบ |  |
| `boq.aprNotifyInAppWho` | ผู้ขอ + ผู้อนุมัติชั้นถัดไป |  |
| `boq.aprNotifyLine` | LINE Notify |  |
| `boq.aprNotifyLineWho` | กลุ่ม ICON-Construction-PM |  |
| `boq.aprNotifyEmailWho` | ผู้อนุมัติ + cc.ผู้ขอ |  |
| `boq.aprReasonLabel` | เหตุผล / ความเห็น |  |
| `boq.aprReasonHint` | (จำเป็นถ้า "ปฏิเสธ") |  |
| `boq.aprReasonPh` | พิมพ์เหตุผลการอนุมัติ/ปฏิเสธ... |  |
| `boq.aprEscalateInfo` | การอนุมัติจะส่งต่อเป็น {tier} เนื่องจาก Net Increase ≥ 500K |  |
| `boq.aprTier4` | ชั้น 4 (ผอ.ก่อสร้าง) |  |
| `boq.aprApproveForward` | อนุมัติ → ส่งต่อ ผอ. |  |
| `boq.aprFilesCloudNote` | ไฟล์ทั้งหมดถูกเก็บใน Cloud Storage · มีการเข้ารหัส · ผู้อนุมัติสามารถดู/ดาวน์โหลดได้ |  |
| `boq.aprAddFileToast` | เปิด File browser เพื่อเพิ่มไฟล์... |  |
| `boq.aprDownloadAll` | ดาวน์โหลดทั้งหมด |  |
| `boq.aprDownloadAllToast` | ดาวน์โหลดทั้งหมด {n} ไฟล์ (ZIP) |  |
| `boq.aprOpenNewTab` | เปิด {file} ในแท็บใหม่ | DEAD |
| `boq.arcTitle` | BOQ Archive |  |
| `boq.arcSubtitle` | ค้นหา BOQ ทุกฉบับ · ดูประวัติ Revise พร้อมผู้อนุมัติและไฟล์แนบ |  |
| `boq.arcFilterTitle` | ตัวกรอง BOQ Archive | DEAD |
| `boq.arcFilterSubtitle` | กรองตามโครงการ / สถานะ / ปี / ผู้อนุมัติ | DEAD |
| `boq.arcExportTitle` | Export BOQ Archive | DEAD |
| `boq.arcExportSubtitle` | เลือกขอบเขต + รูปแบบไฟล์ | DEAD |
| `boq.arcSearchPh` | ค้นหา BOQ no, โครงการ, Block... |  |
| `boq.arcThCodeBoq` | เลขที่ BOQ |  |
| `boq.arcThVersion` | เวอร์ชั่น |  |
| `boq.arcThApprover` | ผู้อนุมัติล่าสุด |  |
| `boq.arcThApproveDate` | วันที่อนุมัติ |  |
| `boq.arcThFileRevise` | ไฟล์ · Revise |  |
| `boq.arcCopyMsg` | คัดลอกโครงสร้างและรายการของ {no} ไปตั้งเป็น BOQ ใหม่ (สถานะ ร่าง) เพื่อใช้กับโครงการ/บล็อกอื่น | DEAD |
| `boq.arcCopyConfirm` | Copy & สร้างใหม่ | DEAD |
| `boq.arcCopyToast` | สร้าง {no} จาก {from} แล้ว | DEAD |
| `boq.arcHistoryTitle` | ประวัติ Revise · {n} เวอร์ชั่น | DEAD |
| `boq.arcExportHistoryToast` | Export ประวัติ Revise (PDF) | DEAD |
| `boq.arcCompareVer` | เปรียบเทียบ {vA} ↔ {vB} | DEAD |
| `boq.arcCompareToast` | เปิดมุมมองเปรียบเทียบเวอร์ชั่น | DEAD |
| `boq.arcFldYearBe` | ปี พ.ศ. | DEAD |
| `boq.arcOptCancelled` | ยกเลิก / Archive | DEAD |
| `boq.arcToggleWithFiles` | เฉพาะที่มีไฟล์แนบ | DEAD |
| `boq.arcToggleWithFilesSub` | กรอง BOQ ที่มีเอกสารแนบ ≥ 1 ไฟล์ | DEAD |
| `boq.arcApplyFilter` | ใช้ตัวกรอง | DEAD |
| `boq.arcFilterToast` | ตั้งตัวกรอง · {project} / {status} / {year} | DEAD |
| `boq.arcExportScopeFiltered` | ตามตัวกรองปัจจุบัน ({n} รายการ) | DEAD |
| `boq.arcExportScopeAll` | ทุกโครงการ / ทุกปี | DEAD |
| `boq.arcExportScopeYear` | เฉพาะปี {year} | DEAD |
| `boq.arcFmtExcel` | Excel (.xlsx) — แนะนำ | DEAD |
| `boq.arcFmtCsv` | CSV (.csv) | DEAD |
| `boq.arcFmtPdfReport` | PDF (รายงาน) | DEAD |
| `boq.arcToggleIncHist` | รวมประวัติ Revise | DEAD |
| `boq.arcToggleIncHistSub` | แนบประวัติทุกเวอร์ชั่น (v1 → vN) ใน Workbook | DEAD |
| `boq.arcExportToast` | Export BOQ Archive · {format} สำเร็จ | DEAD |
| `boq.arcExportHistFlag` | + ประวัติ Revise | DEAD |
| `boq.repFilterTitle` | ตัวกรองรายงาน BOQ | DEAD |
| `boq.repFilterSubtitle` | กำหนดเงื่อนไขก่อนสร้างรายงาน | DEAD |
| `boq.repPrintTitle` | พิมพ์รายงาน BOQ | DEAD |
| `boq.repPrintSubtitle` | เลือกรายงาน + รูปแบบเอกสาร | DEAD |
| `boq.repExportBtn` | Export Excel |  |
| `boq.repExportTitle` | Export รายงาน BOQ เป็น Excel | DEAD |
| `boq.repExportSubtitle` | เลือกรายงาน + ขอบเขต + รูปแบบไฟล์ | DEAD |
| `boq.repSubtitle` | BOQ vs Non-BOQ Summary + ประวัติการ Revise — ใช้ตรวจสอบความถูกต้องของการประมาณราคา |  |
| `boq.repScopeConditions` | เงื่อนไขรายงาน |  |
| `boq.repScopeBlock` | Block |  |
| `boq.repRpt001` | RPT-001 |  |
| `boq.repSummaryTitle` | BOQ และ Non-BOQ Summary Report |  |
| `boq.repSummaryDesc` | เปรียบเทียบมูลค่าที่อยู่ใน BOQ (ตามแผน) กับมูลค่าที่เกิดนอก BOQ (ใช้เกินแผน) ตามหมวดงาน |  |
| `boq.repIssuedAt` | ออก ณ {datetime} |  |
| `boq.repValueByCat` | มูลค่าตามหมวด (ล้านบาท) |  |
| `boq.repLegendBoqPlan` | BOQ (ตามแผน) |  |
| `boq.repLegendNonBoqOver` | Non-BOQ (เกินแผน) |  |
| `boq.repThBoq` | BOQ |  |
| `boq.repThActualUsed` | รวมใช้จริง |  |
| `boq.repThPctOver` | % เกิน |  |
| `boq.repCat01` | 01 Site Work | DEAD |
| `boq.repCat04` | 04 งานระบบไฟฟ้า | DEAD |
| `boq.repCat05Plumb` | 05 งานประปา/สุขาฯ | DEAD |
| `boq.repCat06` | 06 งานเก็บงาน | DEAD |
| `boq.repRpt002` | RPT-002 |  |
| `boq.repReviseTitle` | BOQ Revise Report — ก่อน/หลังแก้ไข |  |
| `boq.repReviseDesc` | สรุปการแก้ไข BOQ ในช่วงที่เลือก พร้อมส่วนต่างมูลค่า เพื่อตรวจสอบเหตุผลและผู้อนุมัติ |  |
| `boq.repThBefore` | ก่อนแก้ไข (฿) |  |
| `boq.repThAfter` | หลังแก้ไข (฿) |  |
| `boq.repThDiff` | ส่วนต่าง |  |
| `boq.repRpt003` | RPT-003 |  |
| `boq.repMslTitle` | Material / Subcon / Labor Breakdown |  |
| `boq.repMslDesc` | สัดส่วนต้นทุนตามชนิด แยกตามหมวดงาน — ใช้วิเคราะห์โครงสร้างต้นทุน |  |
| `boq.repThSubcon` | Subcon |  |
| `boq.repRpt004` | RPT-004 |  |
| `boq.repVarTitle` | Variance Report — Plan vs Actual |  |
| `boq.repVarDesc` | เปรียบเทียบงบตามแผน (BOQ) กับค่าใช้จ่ายจริงรายงวด พร้อมร้อยละเบี่ยงเบน |  |
| `boq.repThPlanBoq` | Plan (BOQ) |  |
| `boq.repThActual` | Actual |  |
| `boq.repThVariance` | Variance |  |
| `boq.repThPctDev` | % Dev. |  |
| `boq.repStatusPending` | รอดำเนิน | DEAD |
| `boq.repStatusDone` | เสร็จ |  |
| `boq.repRpt005` | RPT-005 |  |
| `boq.repEvmTitle` | EVM — Earned Value Management |  |
| `boq.repEvmDesc` | PV (แผน) · EV (มูลค่างานที่ทำได้) · AC (ค่าใช้จ่ายจริง) + ดัชนี SPI / CPI ตามงวดเวลา |  |
| `boq.repEvmLegPv` | PV (แผน) |  |
| `boq.repEvmLegEv` | EV (ทำได้) |  |
| `boq.repEvmLegAc` | AC (จ่ายจริง) |  |
| `boq.repEvmSpi` | SPI |  |
| `boq.repEvmCpi` | CPI |  |
| `boq.repEvmSpiHint` | Schedule Performance |  |
| `boq.repEvmCpiHint` | Cost Performance |  |
| `boq.repEvmGood` | ตามแผน/ดีกว่าแผน | DEAD |
| `boq.repEvmBad` | ช้ากว่า/เกินงบ | DEAD |
| `boq.repEvmFooter` | ณ งวด {month} · EV {ev}M / PV {pv}M / AC {ac}M | DEAD |
| `boq.repCat03ArchOpt` | 03 สถาปัตยกรรม | DEAD |
| `boq.repCat05PlumbOpt` | 05 งานประปา-สุขาภิบาล | DEAD |
| `boq.repFilterToggle` | เฉพาะรายการที่ Revise | DEAD |
| `boq.repFilterToggleSub` | กรองเฉพาะ BOQ ที่มีประวัติแก้ไข ≥ 1 ครั้ง | DEAD |
| `boq.repFilterToast` | ตั้งตัวกรอง · {project} / {phase} / {block} / {period} | DEAD |
| `boq.repOptSummary` | BOQ vs Non-BOQ Summary Report | DEAD |
| `boq.repOptRevisePrint` | BOQ Revise Report (ก่อน/หลังแก้ไข) | DEAD |
| `boq.repOptBoth` | ทั้ง 2 รายงาน | DEAD |
| `boq.repDocFormat` | รูปแบบเอกสาร | DEAD |
| `boq.repFmtPdfPortrait` | PDF · A4 แนวตั้ง | DEAD |
| `boq.repFmtPdfLandscape` | PDF · A4 แนวนอน | DEAD |
| `boq.repFmtPrintNow` | พิมพ์ออกเครื่องพิมพ์ทันที | DEAD |
| `boq.repCopies` | จำนวนชุด | DEAD |
| `boq.repPrintInfo` | ระบบจะสร้างไฟล์ตามตัวกรองปัจจุบัน · {n} รายงาน · {copies} ชุด | DEAD |
| `boq.repPrintToast` | ส่งพิมพ์รายงาน · {format} × {copies} ชุด | DEAD |
| `boq.repOptReviseExport` | BOQ Revise Report | DEAD |
| `boq.repOptBothWorkbook` | ทั้ง 2 รายงาน (Workbook เดียว) | DEAD |
| `boq.repExportScopeFiltered` | ตามตัวกรองปัจจุบัน | DEAD |
| `boq.repExportScopeAllPhase` | ทุกโครงการ / ทุกเฟส | DEAD |
| `boq.repExportScopeYear` | ปีงบประมาณ {year} ทั้งปี | DEAD |
| `boq.repFmtPdfShare` | PDF (สำหรับดู/ส่งต่อ) | DEAD |
| `boq.repExportToast` | Export {reports} · {format} สำเร็จ | DEAD |
| `boq.repReportsCount` | {n} รายงาน | DEAD |
| `boq.aiqAccExact` | แม่นสุด |  |
| `boq.aiqAccMedium` | ปานกลาง |  |
| `boq.aiqAccCheck` | ต้องตรวจ |  |
| `boq.aiqNoteIfc` | ถอดปริมาณตรงจากโมเดล BIM |  |
| `boq.aiqNoteRvt` | Revit native · ถอดจาก parametric model |  |
| `boq.aiqNoteDwg` | AI ตีความเส้น 2D · ควรตรวจ |  |
| `boq.aiqNotePdf` | AI OCR + ตีความแบบแปลน · ตรวจละเอียด |  |
| `boq.aiqProcRead` | อ่าน / parse โมเดล |  |
| `boq.aiqProcDetect` | ตรวจจับ element (Wall/Column/Beam/Slab…) |  |
| `boq.aiqProcClassify` | จำแนกประเภทงาน |  |
| `boq.aiqProcMatch` | จับคู่รายการ BOQ มาตรฐาน |  |
| `boq.aiqProcCompute` | คำนวณปริมาณ + ประเมินราคา |  |
| `boq.aiqTitle` | นำเข้า CAD/BIM · AI ถอด BOQ |  |
| `boq.aiqDemoBadge` | DEMO / Preview |  |
| `boq.aiqSubtitle` | ถอดปริมาณงานอัตโนมัติจากโมเดล BIM/CAD ด้วย AI แล้วป้อนเข้าโมดูล BOQ — จำลองผลลัพธ์ (parse จริงต้องมี backend) |  |
| `boq.aiqStepUpload` | อัปโหลดไฟล์ |  |
| `boq.aiqStepProcessing` | AI กำลังถอดปริมาณ |  |
| `boq.aiqStepReview` | ตรวจ & แก้การจับคู่ |  |
| `boq.aiqStepSummary` | สรุป & สร้าง BOQ |  |
| `boq.aiqDropzone` | ลากไฟล์ CAD/BIM มาวาง หรือคลิกเพื่อเลือก |  |
| `boq.aiqSupportFormats` | รองรับ IFC · RVT (Revit) · DWG · DXF · PDF |  |
| `boq.aiqSampleIfc` | ไฟล์ตัวอย่าง IFC |  |
| `boq.aiqSampleDwg` | ไฟล์ตัวอย่าง DWG |  |
| `boq.aiqLodLabel` | ระดับความละเอียดโมเดล (LOD) |  |
| `boq.aiqLod100` | LOD 100 (แนวคิด) |  |
| `boq.aiqLod200` | LOD 200 (ประมาณ) |  |
| `boq.aiqLod400` | LOD 400 (ผลิต) |  |
| `boq.aiqAccuracyByType` | ระดับความแม่นยำต่อชนิดไฟล์ |  |
| `boq.aiqInfoAccuracy` | IFC/Revit ถอดปริมาณตรงจากโมเดล (แม่นสุด) · DWG/PDF 2D ใช้ AI ตีความ ควรตรวจทาน |  |
| `boq.aiqStartExtract` | เริ่มถอดปริมาณด้วย AI |  |
| `boq.aiqProcessingTitle` | AI กำลังถอดปริมาณ... |  |
| `boq.aiqProcActive` | กำลังทำ… |  |
| `boq.aiqElementsFound` | Element ที่ตรวจพบ |  |
| `boq.aiqElemPieces` | {n} ชิ้น | DEAD |
| `boq.aiqReviewTitle` | ตรวจ & แก้การจับคู่รายการ BOQ |  |
| `boq.aiqLowConfBadge` | ⚠ {n} รายการ confidence ต่ำ ควรตรวจ |  |
| `boq.aiqSuggestSpec` | AI แนะนำ spec |  |
| `boq.aiqSuggestSpecToast` | AI แนะนำ spec วัสดุตามมาตรฐาน มยผ. แล้ว |  |
| `boq.aiqCheckDup` | ตรวจซ้ำ/ขาด |  |
| `boq.aiqCheckDupToast` | AI ตรวจรายการซ้ำ/ขาด: ไม่พบรายการซ้ำ · แนะนำเพิ่มงานฉาบปูน |  |
| `boq.aiqThElement` | Element (AI ถอด) |  |
| `boq.aiqThQty` | ปริมาณ |  |
| `boq.aiqThAi` | AI |  |
| `boq.aiqManualElem` | เพิ่มเอง (manual) |  |
| `boq.aiqManualName` | รายการใหม่ |  |
| `boq.aiqAddRow` | เพิ่มรายการเอง |  |
| `boq.aiqViewerHeader` | โมเดล CAD/BIM (preview) |  |
| `boq.aiqRestart` | เริ่มใหม่ |  |
| `boq.aiqConfirmMatch` | ยืนยันการจับคู่ · ไปสรุป |  |
| `boq.aiqKpiExtracted` | รายการที่ถอดได้ |  |
| `boq.aiqKpiValue` | มูลค่าประเมินรวม |  |
| `boq.aiqKpiConf` | ความเชื่อมั่นเฉลี่ย |  |
| `boq.aiqKpiNeedCheck` | ต้องตรวจ (conf<80%) |  |
| `boq.aiqCreateToast` | สร้าง {no} จากผลถอด AI แล้ว · เพิ่ม {n} รายการ (ผูก element id เพื่อ traceability) |  |
| `boq.aiqModelCostShare` | โมเดล + สัดส่วนต้นทุน |  |
| `boq.aiqGroupWork` | จัดกลุ่มงาน (3 ระดับ) |  |
| `boq.aiqGroup02` | 02 งานโครงสร้าง (Structural) |  |
| `boq.aiqGroup0304` | 03-04 งานสถาปัตยกรรม (Architectural) |  |
| `boq.aiqGroup05` | 05 งานระบบ (MEP) |  |
| `boq.aiqCreateBoq` | สร้าง BOQ จากผลถอด ({n} รายการ) |  |

### `dashboard` — 70 debt keys (38 live · 32 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `dashboard.reportNotify` | เปิดหน้ารายงาน Dashboard |  |
| `dashboard.syncSource` | Sync SAP/REM |  |
| `dashboard.syncOnline` | ● online |  |
| `dashboard.roleExec` | ผู้บริหาร |  |
| `dashboard.roleEngineer` | ช่าง/หน้างาน |  |
| `dashboard.roleBannerExec` | มุมมองผู้บริหาร — เน้นงบรวม สุขภาพโครงการ และเอกสารที่ต้องตัดสินใจ |  |
| `dashboard.roleBannerManager` | มุมมองผู้จัดการโครงการ — ครบทุกด้าน: ความคืบหน้า อนุมัติ และกระแสเงินสด |  |
| `dashboard.roleBannerAccountant` | มุมมองบัญชี-การเงิน — เน้นงบประมาณ กระแสเงินสด และเอกสารรออนุมัติ |  |
| `dashboard.roleBannerEngineer` | มุมมองช่าง/หน้างาน — เน้นความคืบหน้างานก่อสร้างและการแจ้งเตือนหน้างาน |  |
| `dashboard.statusSolarCOD` | จ่ายไฟเชิงพาณิชย์ (COD) |  |
| `dashboard.statusOperating` | กำลังดำเนินงาน |  |
| `dashboard.progressTitleSolar` | ความคืบหน้ารายโซน / Array |  |
| `dashboard.progressTitleCivil` | ความคืบหน้ารายส่วนงาน |  |
| `dashboard.progressTitleService` | ความคืบหน้ารายเฟส (WBS) |  |
| `dashboard.progressTitleDefault` | ความคืบหน้า |  |
| `dashboard.progressSubSolar` | แยกตามโซน/Array · % ติดตั้ง-จ่ายไฟ |  |
| `dashboard.progressSubCivil` | แยกตามส่วนงาน · % ความคืบหน้า / งบที่ใช้ |  |
| `dashboard.progressSubService` | แยกตามเฟส/งาน · % ความคืบหน้า |  |
| `dashboard.rangeTitleWeek` | รายวันสัปดาห์นี้ |  |
| `dashboard.rangeTitleMonth` | รายสัปดาห์ในเดือน พ.ค. 2569 |  |
| `dashboard.rangeTitleQuarter` | รายเดือนใน Q2/2569 |  |
| `dashboard.rangeTitleYear` | รายเดือน ปีงบประมาณ 2569 · ทุกหมวดงาน |  |
| `dashboard.legendBudgetShort` | งบ |  |
| `dashboard.costOverhead` | Overhead | DEAD |
| `dashboard.phaseOnTrack` | ● ตรงแผน | DEAD |
| `dashboard.phaseLate` | ● ล่าช้า 8 วัน | DEAD |
| `dashboard.phaseSoon` | ● ใกล้กำหนด | DEAD |
| `dashboard.activitySyncSAP` | Sync จาก SAP | DEAD |
| `dashboard.activityRejectRevise` | ปฏิเสธ + ขอแก้ | DEAD |
| `dashboard.activityAutoBudget` | ตัดงบอัตโนมัติ | DEAD |
| `dashboard.deltaBudgetWeek` | งบสัปดาห์ | DEAD |
| `dashboard.deltaBudgetMonth` | งบเดือน | DEAD |
| `dashboard.deltaBudgetQuarter` | งบไตรมาส | DEAD |
| `dashboard.deltaBelowPlan` | ต่ำกว่าแผน |  |
| `dashboard.kpiSolarCapacity` | กำลังผลิตติดตั้ง |  |
| `dashboard.unitMWp` | MWp |  |
| `dashboard.deltaCOD` | COD แล้ว |  |
| `dashboard.kpiSolarEnergy` | พลังงานสะสม (YTD) |  |
| `dashboard.unitMWh` | MWh |  |
| `dashboard.kpiSolarPR` | Performance Ratio |  |
| `dashboard.deltaPass` | ผ่านเกณฑ์ |  |
| `dashboard.kpiWorkProgress` | ความคืบหน้างาน |  |
| `dashboard.kpiNextMilestone` | Milestone ถัดไป |  |
| `dashboard.deltaPerContract` | ตามสัญญา | DEAD |
| `dashboard.milestoneUAT` | UAT | DEAD |
| `dashboard.remainSubLoss` | ขาดทุน · ต้องขออนุมัติเพิ่ม | DEAD |
| `dashboard.tplRangeLabel` | ช่วง: {range} |  |
| `dashboard.tplAvgPhase` | เฉลี่ยทุกเฟส ({n}) |  |
| `dashboard.tplAvgSection` | เฉลี่ยทุกส่วนงาน ({n}) |  |
| `dashboard.tplDocCount` | {n} ฉบับ | DEAD |
| `dashboard.tplTimeAgo` | {t} ที่แล้ว | DEAD |
| `dashboard.tplAsOf` | ข้อมูล ณ {date} (อัปเดต {time} น.) |  |
| `dashboard.tplDeltaMoM` | +{p}% MoM | DEAD |
| `dashboard.tplDeltaYoY` | +{p}% YoY | DEAD |
| `dashboard.tplDeltaOverBudget` | +{p}% เกินงบ | DEAD |
| `dashboard.tplInDays` | ใน {n} วัน | DEAD |
| `dashboard.tplPctOfWeekBudget` | {p}% ของงบสัปดาห์ | DEAD |
| `dashboard.tplPctOfMonthBudget` | {p}% ของงบเดือน | DEAD |
| `dashboard.tplOverQuarterBudget` | เกินงบไตรมาส {p}% | DEAD |
| `dashboard.tplPctOfTotalBudget` | {p}% ของงบทั้งหมด |  |
| `dashboard.tplRemainDays` | {p}% · เหลือ {n} วัน | DEAD |
| `dashboard.tplRemainMonths` | {p}% · พอใช้ {n} เดือน | DEAD |
| `dashboard.tplEditCount` | แก้ไข {n} ครั้ง | DEAD |
| `dashboard.tplInverterPanels` | {n} Inverter · {m} แผง | DEAD |
| `dashboard.tplTargetGte` | เป้าหมาย ≥ {n}% | DEAD |
| `dashboard.tplFiTRate` | FiT {rate} ฿/kWh | DEAD |
| `dashboard.tplIrrNpv` | IRR {irr}% · NPV +{npv} ลบ. | DEAD |
| `dashboard.tplMilestoneInspection` | ตรวจรับงวด {n} | DEAD |
| `dashboard.tplGoLive` | Go-Live {date} | DEAD |
| `dashboard.tplDeliver` | ส่งมอบ {date} | DEAD |

### `vendor` — 44 debt keys (44 live · 0 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `vendor.title` | ผู้ขาย / ผู้รับเหมา · Vendor Master |  |
| `vendor.subtitle` | ทะเบียนคู่ค้ากลาง — ใช้ร่วมกับจัดซื้อ (PR/PO/WO), เจ้าหนี้ (AP) และงานจัดหาที่ดิน |  |
| `vendor.btnExport` | Export |  |
| `vendor.notifyExport` | Export ทะเบียนผู้ขาย |  |
| `vendor.btnAddVendor` | เพิ่มผู้ขาย |  |
| `vendor.btnAddContractor` | เพิ่มผู้รับเหมา |  |
| `vendor.kpiTotal` | ผู้ขายทั้งหมด |  |
| `vendor.kpiSubActive` | ใช้งาน {count} |  |
| `vendor.kpiMaterialContractor` | วัสดุ / รับเหมา |  |
| `vendor.kpiSpend` | ยอดซื้อสะสม |  |
| `vendor.kpiSubAllPartners` | ทุกคู่ค้า |  |
| `vendor.kpiInactive` | พักใช้งาน |  |
| `vendor.typeMaterial` | ผู้ขายวัสดุ |  |
| `vendor.tabLand` | ที่ดิน/เช่า |  |
| `vendor.searchPlaceholder` | ค้นหา รหัส/ชื่อ/เลขภาษี... |  |
| `vendor.thName` | ชื่อผู้ขาย |  |
| `vendor.thTaxId` | เลขผู้เสียภาษี |  |
| `vendor.thTerm` | เครดิตเทอม |  |
| `vendor.thSpend` | ยอดซื้อ (฿) |  |
| `vendor.statusInactive` | พักงาน |  |
| `vendor.menuHistory` | ประวัติ |  |
| `vendor.notifyHistory` | ประวัติซื้อ-PO ของ {name} |  |
| `vendor.modalAddTitle` | เพิ่มผู้ขาย / ผู้รับเหมา |  |
| `vendor.modalEditTitle` | แก้ไขผู้ขาย {code} |  |
| `vendor.modalEditSubtitle` | แก้ไขข้อมูลคู่ค้า |  |
| `vendor.modalAddSubtitle` | บันทึกผู้ขาย ผู้รับเหมา หรือผู้ให้บริการรายใหม่ |  |
| `vendor.toastSaved` | บันทึกผู้ขาย {code} แล้ว |  |
| `vendor.toastAdded` | เพิ่มผู้ขาย {name} ({code}) แล้ว |  |
| `vendor.formTypeLabel` | ประเภทคู่ค้า |  |
| `vendor.typeService` | ผู้ให้บริการ |  |
| `vendor.typeLand` | ที่ดิน / เช่า |  |
| `vendor.fieldNameContractor` | ชื่อผู้รับเหมา / บริษัท |  |
| `vendor.fieldNameSupplier` | ชื่อผู้ขาย / บริษัท |  |
| `vendor.phNameContractor` | เช่น บจก. รุ่งเรืองก่อสร้าง |  |
| `vendor.phNameSupplier` | เช่น บจก. รุ่งเรืองวัสดุ |  |
| `vendor.phTaxId` | 0105545012345 |  |
| `vendor.term15` | 15 วัน |  |
| `vendor.term30` | 30 วัน |  |
| `vendor.term45` | 45 วัน |  |
| `vendor.term60` | 60 วัน |  |
| `vendor.fieldAddr` | ที่อยู่ |  |
| `vendor.phAddr` | ที่อยู่จดทะเบียน |  |
| `vendor.fieldBank` | เลขบัญชี |  |
| `vendor.phBank` | KBANK 012-3-... |  |

### `po` — 44 debt keys (34 live · 10 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `po.list.title` | ใบสั่งซื้อ (Purchase Order) |  |
| `po.list.subtitle` | สร้าง PO จาก PR ที่อนุมัติ · จ่ายมัดจำ · ติดตามการรับสินค้า · ปิด PO อัตโนมัติเมื่อรับครบ |  |
| `po.list.createBtn` | สร้าง PO |  |
| `po.list.kpiPending` | PO รออนุมัติ |  |
| `po.list.kpiOpen` | PO เปิดอยู่ |  |
| `po.list.kpiDepositDue` | มัดจำค้างจ่าย |  |
| `po.list.kpiAwaitGr` | รอรับสินค้า |  |
| `po.list.kpiClosedMonth` | ปิดเดือนนี้ |  |
| `po.list.kpiDepositSub` | ค่าวัสดุ {value} | DEAD |
| `po.list.overdueCount` | เลยกำหนด {n} ฉบับ | DEAD |
| `po.list.tabDepositDue` | มัดจำค้าง |  |
| `po.list.colNo` | เลขที่ PO |  |
| `po.list.colRefPr` | อ้างจาก PR |  |
| `po.list.colPaid` | จ่ายไป |  |
| `po.list.receiveGoods` | รับสินค้า |  |
| `po.list.depositPaid` | {pct}% · จ่ายแล้ว | DEAD |
| `po.list.depositDue` | {pct}% · ค้างจ่าย | DEAD |
| `po.list.paymentSchedule` | กำหนดการจ่ายเงิน |  |
| `po.list.milestoneDeposit` | มัดจำ (Down Payment) |  |
| `po.list.dueBeforeProduction` | ก่อนเริ่มผลิต |  |
| `po.list.milestonePartial` | งวด 1 · ส่งของบางส่วน |  |
| `po.list.dueAfterReceive50` | หลังรับของ 50% |  |
| `po.list.milestoneFinal` | งวดสุดท้าย · รับครบ |  |
| `po.list.dueAfterFull` | หลังรับครบ |  |
| `po.list.decrementTitle` | PO Decrement |  |
| `po.list.decrementSub` | · การหักจาก PO |  |
| `po.list.deductDeposit` | หักมัดจำจาก PO | DEAD |
| `po.list.deductInstall1` | หักจ่ายงวด 1 | DEAD |
| `po.list.poRemaining` | คงเหลือ PO |  |
| `po.list.confirmPayTitle` | ยืนยันจ่ายมัดจำ |  |
| `po.list.confirmPayMsg` | จ่ายมัดจำ {pct}% ของ {vendor} {amount} ฿ | DEAD |
| `po.list.payBtn` | จ่ายเงิน |  |
| `po.list.paySuccessToast` | จ่ายมัดจำ {no} สำเร็จ |  |
| `po.list.cancelPo` | ยกเลิก PO |  |
| `po.form.breadcrumbNew` | สร้าง PO ใหม่ | DEAD |
| `po.form.createdToast` | สร้าง PO ใหม่แล้ว · ส่งอนุมัติ |  |
| `po.form.deliveryDate` | วันส่งมอบ |  |
| `po.form.paymentTerms` | เงื่อนไขการชำระ |  |
| `po.form.downPmt` | มัดจำ (Down Pmt) |  |
| `po.form.vatWht` | VAT / WHT |  |
| `po.form.deductInfo` | PO นี้จะถูกตัดออกจาก {pr} มูลค่า {amount} ฿ · งบที่ผูกพันจะอัปเดตอัตโนมัติเมื่ออนุมัติ | DEAD |
| `po.form.itemsTitle` | รายการสินค้า |  |
| `po.form.itemsFromPr` | · ดึงจาก PR · {n} รายการ | DEAD |
| `po.form.itemsNote` | (รายการสินค้าเหมือนใน PR — ดูได้ในมุมมองรายละเอียด PO หลังบันทึก) |  |

### `gr` — 42 debt keys (36 live · 6 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `gr.list.title` | รับสินค้า (Goods Receipt) |  |
| `gr.list.subtitle` | รับวัสดุจาก PO + รับงานจาก WO · คืนสินค้า · ยกเลิก GR |  |
| `gr.list.createBtn` | รับสินค้าใหม่ |  |
| `gr.list.kpiReceivedMonth` | รับเดือนนี้ |  |
| `gr.list.kpiAwaitPo` | รอรับจาก PO |  |
| `gr.list.kpiReturns` | คืนสินค้า |  |
| `gr.list.kpiReturnsSub` | {amount} ฿ · {n} รออนุมัติ | DEAD |
| `gr.list.tabOther` | รับอื่นๆ |  |
| `gr.list.searchPlaceholder` | ค้นหา GR no, PO/WO, ผู้ขาย... |  |
| `gr.list.filterWarehouse` | คลัง |  |
| `gr.list.allWarehouses` | ทุกคลัง |  |
| `gr.list.colNo` | GR เลขที่ |  |
| `gr.list.colRef` | อ้างถึง |  |
| `gr.list.colItemVendor` | รายการ / ผู้ขาย |  |
| `gr.list.colReceivedOrdered` | รับ / สั่ง |  |
| `gr.list.badgeComplete` | ครบ | DEAD |
| `gr.list.receivedBy` | ผู้รับของ |  |
| `gr.list.receivedItems` | รายการที่รับ |  |
| `gr.list.fullyReceived` | ครบตามสั่ง | DEAD |
| `gr.list.shortReceived` | รับไม่ครบ — ขาด {n} เส้น | DEAD |
| `gr.list.viewDeliveryToast` | เปิดดูใบส่งของ |  |
| `gr.list.receiptNote` | ใบรับของ |  |
| `gr.list.printReceiptToast` | ส่งคำสั่งพิมพ์ใบรับของ |  |
| `gr.list.colRefGr` | อ้างจาก GR |  |
| `gr.list.canceledCount` | มี GR ที่ยกเลิก {n} ฉบับ · กดเพื่อดู |  |
| `gr.create.modalTitle` | รับสินค้า / รับงาน (Goods Receipt) |  |
| `gr.create.modalSubtitle` | เลือก PO/WO ที่จะรับ |  |
| `gr.create.refSubtitle` | อ้างถึง {ref} | DEAD |
| `gr.create.tabOther` | Receive Others (ไม่มี PO) |  |
| `gr.create.selectRef` | เลือก {docType} |  |
| `gr.create.balanceRemaining` | คงเหลือต้องรับ: {balance} | DEAD |
| `gr.create.receiveToWarehouse` | รับเข้าคลัง |  |
| `gr.create.deliveryNoteNo` | เลขที่ใบส่งของ |  |
| `gr.create.partialCheckbox` | รับบางส่วน (Partial) |  |
| `gr.create.colOrdered` | สั่ง |  |
| `gr.create.colReceived` | รับ |  |
| `gr.create.colCondition` | สภาพ |  |
| `gr.create.conditionGood` | ครบ-ดี |  |
| `gr.create.partialWarning` | รับไม่ครบ — PO จะเปิดต่อ รอรับส่วนที่เหลือ |  |
| `gr.create.attachBtn` | แนบใบส่งของ + รูปสินค้า |  |
| `gr.create.saveBtn` | บันทึกรับสินค้า |  |
| `gr.create.savedToast` | บันทึก {no} (จาก {ref}) แล้ว — สต็อกอัปเดต |  |

### `org` — 41 debt keys (41 live · 0 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `org.pageTitle` | Company / Organization |  |
| `org.subtitle` | โครงสร้างองค์กร · บริษัท · แผนก · ตำแหน่ง · เชื่อมกับ SAP B1 |  |
| `org.addBtn` | เพิ่มบริษัท / หน่วยงาน |  |
| `org.orgStructure` | โครงสร้างองค์กร |  |
| `org.menuAddSub` | เพิ่มหน่วยย่อย |  |
| `org.addSubtitle` | เพิ่มนิติบุคคลใหม่ หรือแผนก/หน่วยงานในโครงสร้างองค์กร |  |
| `org.editSubtitle` | แก้ไขข้อมูลหน่วยงานในโครงสร้างองค์กร |  |
| `org.kindCompany` | บริษัท / นิติบุคคล |  |
| `org.kindDept` | แผนก / หน่วยงาน |  |
| `org.fieldNameCompany` | ชื่อบริษัท / นิติบุคคล |  |
| `org.fieldNameDept` | ชื่อแผนก / หน่วยงาน |  |
| `org.phNameCompany` | เช่น จูนโฟลว์ ดีเวลลอปเมนท์ จำกัด |  |
| `org.phNameDept` | เช่น ฝ่ายทรัพยากรบุคคล (HR) |  |
| `org.fieldCode` | รหัส |  |
| `org.phCodeCompany` | เช่น IDV |  |
| `org.phCodeDept` | เช่น HR |  |
| `org.fieldTaxId` | เลขประจำตัวผู้เสียภาษี |  |
| `org.fieldParent` | สังกัดภายใต้ |  |
| `org.fieldEmpCount` | จำนวนพนักงาน |  |
| `org.fieldHead` | หัวหน้าหน่วยงาน |  |
| `org.phHead` | เช่น สุดารัตน์ |  |
| `org.fieldCount` | จำนวนคน |  |
| `org.saveEditBtn` | บันทึกการแก้ไข |  |
| `org.addCompanyBtn` | เพิ่มบริษัท |  |
| `org.addDeptBtn` | เพิ่มแผนก |  |
| `org.errNameReq` | ระบุชื่อ |  |
| `org.errCodeReq` | ระบุรหัส |  |
| `org.errCodeDup` | รหัสนี้มีอยู่แล้ว |  |
| `org.errParentReq` | เลือกบริษัท/หน่วยงานแม่ |  |
| `org.errTaxInvalid` | เลขผู้เสียภาษีไม่ถูกต้อง |  |
| `org.unitDept` | แผนก |  |
| `org.unitSub` | หน่วยย่อย |  |
| `org.syncStatus` | sync SAP เมื่อ 5 นาทีก่อน |  |
| `org.noteSubCompany` | บริษัทย่อย |  |
| `org.noteCountUnit` | คน |  |
| `org.noteHeadPrefix` | หัวหน้า: |  |
| `org.noteNewUnit` | หน่วยงานใหม่ |  |
| `org.toastAddCompany` | เพิ่มบริษัท “{name}” ({code}) แล้ว |  |
| `org.toastAddDept` | เพิ่มแผนก “{name}” ({code}) แล้ว |  |
| `org.toastEdit` | บันทึกการแก้ไข “{name}” แล้ว |  |
| `org.toastDelete` | ลบ “{name}” แล้ว |  |

### `wo` — 37 debt keys (24 live · 13 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `wo.list.title` | ใบสั่งจ้าง (Work Order) |  |
| `wo.list.subtitle` | จ้างผู้รับเหมา · ระบุงวดงาน · จ่ายมัดจำ + retention · ติดตามความคืบหน้า |  |
| `wo.list.createBtn` | สร้าง WO |  |
| `wo.list.kpiPending` | WO รออนุมัติ |  |
| `wo.list.kpiActive` | WO กำลังดำเนินงาน |  |
| `wo.list.kpiDueInstallments` | งวดงานที่ครบกำหนด |  |
| `wo.list.kpiDueSub` | ต้องอนุมัติงวด |  |
| `wo.list.kpiRetentionSub` | คืนเมื่อพ้นประกัน |  |
| `wo.list.kpiClosedMonth` | ปิดสัญญาเดือนนี้ |  |
| `wo.list.tabActive` | กำลังเดิน |  |
| `wo.list.tabApproveInstallment` | รออนุมัติงวด |  |
| `wo.list.colNo` | เลขที่ WO |  |
| `wo.list.installmentSummary` | · {n} งวด · {pct}% เสร็จ |  |
| `wo.list.atContractPct` | ที่ {pct}% ของสัญญา | DEAD |
| `wo.list.variationLabel` | งานเพิ่ม/ลด (Variation) |  |
| `wo.list.variationCount` | {n} รายการ · เพิ่ม {add} · ลด {cut} | DEAD |
| `wo.list.retentionHeld` | Retention หักไว้ |  |
| `wo.list.retentionTerms` | {pct}% · คืนเมื่อพ้นประกัน {months} เดือน |  |
| `wo.list.approveInstallmentBtn` | อนุมัติงวด |  |
| `wo.list.variationBtn` | งานเพิ่ม-ลด |  |
| `wo.list.filesCount` | ไฟล์ ({n}) |  |
| `wo.list.closeConfirmMsg` | ยืนยันปิดสัญญา — ระบบจะตรวจ checklist ก่อนคืน Retention |  |
| `wo.list.closeConfirmBtn` | เริ่มปิดสัญญา | DEAD |
| `wo.list.closeStartToast` | เริ่มขั้นตอนปิดสัญญา |  |
| `wo.form.breadcrumbNew` | สร้าง WO ใหม่ | DEAD |
| `wo.form.createdToast` | สร้าง WO + ส่งอนุมัติแล้ว |  |
| `wo.form.deliverWork` | ส่งมอบงาน |  |
| `wo.form.warrantyPeriod` | ระยะประกัน |  |
| `wo.vo.modalTitle` | งานเพิ่ม-ลด (Variation Order) | DEAD |
| `wo.vo.modalSubtitle` | สร้าง VO อ้างอิงสัญญา/PO เดิม | DEAD |
| `wo.vo.dirAdd` | งานเพิ่ม (+) | DEAD |
| `wo.vo.dirCut` | งานลด (−) | DEAD |
| `wo.vo.workDetail` | รายละเอียดงาน | DEAD |
| `wo.vo.workDetailPlaceholder` | เช่น เพิ่มงานกันซึมดาดฟ้า 240 ตร.ม. | DEAD |
| `wo.vo.reasonPlaceholder` | เช่น เจ้าของโครงการสั่งเพิ่ม | DEAD |
| `wo.vo.submitBtn` | สร้าง VO + ส่งอนุมัติ | DEAD |
| `wo.vo.createdToast` | สร้าง VO งาน{dir} {amount} ฿ · ส่งอนุมัติ + ปรับมูลค่าสัญญา | DEAD |

### `docnum` — 36 debt keys (12 live · 24 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `docnum.subtitle` | ตั้งรูปแบบเลขเอกสาร · prefix + ปี + running · รีเซ็ตอัตโนมัติทุกปีบัญชี |  |
| `docnum.addBtn` | เพิ่มประเภทเอกสาร |  |
| `docnum.addModalSubtitle` | ตั้งรูปแบบเลขเอกสาร · prefix + ปี + running | DEAD |
| `docnum.editTitle` | แก้ไขประเภทเอกสาร · {type} | DEAD |
| `docnum.editModalSubtitle` | ปรับเลขถัดไป · การรีเซ็ต · ความปลอดภัย | DEAD |
| `docnum.toastAdd` | เพิ่มประเภทเอกสาร {type} ({prefix}) แล้ว | DEAD |
| `docnum.toastSave` | บันทึกการแก้ไข {type} แล้ว | DEAD |
| `docnum.thType` | ประเภทเอกสาร |  |
| `docnum.thFormat` | Format |  |
| `docnum.thExample` | ตัวอย่าง |  |
| `docnum.thNext` | เลขถัดไป |  |
| `docnum.thReset` | รีเซ็ต |  |
| `docnum.thLock` | ความปลอดภัย |  |
| `docnum.fldType` | ชื่อประเภทเอกสาร | DEAD |
| `docnum.fldPrefix` | Prefix | DEAD |
| `docnum.fldRunningEdit` | เลขถัดไป (running) | DEAD |
| `docnum.fldRunningNew` | เลขเริ่มต้น (running) | DEAD |
| `docnum.fldReset` | รีเซ็ตเลข | DEAD |
| `docnum.fldLock` | ความปลอดภัย (ล็อกเลข) | DEAD |
| `docnum.phType` | เช่น Debit Note | DEAD |
| `docnum.phPrefix` | เช่น DN | DEAD |
| `docnum.errTypeRequired` | ระบุชื่อประเภทเอกสาร | DEAD |
| `docnum.errPrefixRequired` | ระบุ prefix | DEAD |
| `docnum.errPrefixExists` | prefix นี้มีอยู่แล้ว | DEAD |
| `docnum.errRunningRequired` | ระบุเลขเริ่มต้น | DEAD |
| `docnum.previewLabel` | ตัวอย่างเลขที่จะออก: | DEAD |
| `docnum.optResetQuarter` | ทุกไตรมาส | DEAD |
| `docnum.optResetNone` | ไม่รีเซ็ต | DEAD |
| `docnum.optLockAll` | ล็อกทุกใบ | DEAD |
| `docnum.optLockDept` | ล็อกตามแผนก | DEAD |
| `docnum.optLockWarehouse` | ล็อกตามคลัง | DEAD |
| `docnum.optLockNone` | ไม่ล็อก | DEAD |
| `docnum.lockDept` | ตามแผนก |  |
| `docnum.lockAll` | ทุกใบ |  |
| `docnum.lockWarehouse` | ตามคลัง |  |
| `docnum.fmtYear` | {ปี} |  |

### `ptype` — 34 debt keys (15 live · 19 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `ptype.title` | ประเภทโครงการ · Project Type |  |
| `ptype.subtitle` | กำหนดประเภทของโครงการ — แต่ละประเภทมีโครงสร้างลำดับชั้น ชุดต้นทุน และเปิด/ปิดโมดูลต่างกัน · เมนูซ้ายปรับอัตโนมัติตามประเภทของโครงการที่เลือก |  |
| `ptype.addBtn` | เพิ่มประเภทโครงการ |  |
| `ptype.editTitle` | แก้ไขประเภทโครงการ | DEAD |
| `ptype.modalSubtitle` | กำหนดชื่อ ไอคอน สี โครงสร้างลำดับชั้น ชุดต้นทุน และโมดูลที่เปิดใช้ | DEAD |
| `ptype.secWbs` | โครงสร้างลำดับชั้น (WBS) |  |
| `ptype.secCostTypes` | ชุดต้นทุน (Cost Types) |  |
| `ptype.noProjects` | ยังไม่มีโครงการใช้ประเภทนี้ |  |
| `ptype.modUsed` | โมดูลที่เปิดใช้ ({n}) |  |
| `ptype.projUsage` | ใช้กับ {n} โครงการ · {names} |  |
| `ptype.toastEdit` | บันทึกประเภท “{name}” แล้ว | DEAD |
| `ptype.toastAdd` | เพิ่มประเภท “{name}” แล้ว | DEAD |
| `ptype.fldNameTh` | ชื่อประเภท (ไทย) | DEAD |
| `ptype.phNameTh` | เช่น คลังสินค้า / โรงงาน | DEAD |
| `ptype.fldNameEn` | ชื่อประเภท (อังกฤษ) | DEAD |
| `ptype.phNameEn` | e.g. Warehouse / Factory | DEAD |
| `ptype.fldIcon` | ไอคอน | DEAD |
| `ptype.phDesc` | อธิบายสั้น ๆ ว่าประเภทนี้ใช้กับงานแบบไหน | DEAD |
| `ptype.hintWbs` | คั่นแต่ละระดับด้วย → หรือเครื่องหมาย / | DEAD |
| `ptype.phWbs` | โครงการ → เฟส → บล็อก → ยูนิต | DEAD |
| `ptype.hintCostTypes` | คั่นด้วยเครื่องหมายจุลภาค , | DEAD |
| `ptype.phCostTypes` | วัสดุ, ค่าแรง, สั่งจ้าง/เหมา | DEAD |
| `ptype.secModules` | โมดูล / เมนูที่เปิดใช้ | DEAD |
| `ptype.moduleNote` | หมายเหตุ: กลุ่มเมนู “บัญชี-การเงิน” และ “ระบบ” แสดงเสมอทุกประเภท | DEAD |
| `ptype.formSubmitAdd` | เพิ่มประเภท | DEAD |
| `ptype.defHierarchy` | โครงการ → เฟส → งาน | DEAD |
| `ptype.defCostTypes` | วัสดุ, ค่าแรง | DEAD |
| `ptype.mod.procure` | จัดซื้อ (PR/PO/WO/GR) |  |
| `ptype.mod.timeline` | แผนงาน (Timeline/Gantt) |  |
| `ptype.mod.salesRe` | ขาย-CRM อสังหาฯ |  |
| `ptype.mod.aftersales` | บริการหลังการขาย |  |
| `ptype.mod.lineoa` | LINE OA ลูกบ้าน |  |
| `ptype.mod.om` | O&M / Monitoring |  |
| `ptype.mod.pm` | PM · บำรุงรักษา (CMMS) |  |

### `pr` — 31 debt keys (7 live · 24 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `pr.list.importExcelToast` | เปิดฟอร์มนำเข้า Excel |  |
| `pr.list.kpiOverBudgetSub` | ต้องขอแก้งบก่อน |  |
| `pr.list.unitDay` | วัน |  |
| `pr.list.kpiValueMillion` | มูลค่า {value} M ฿ |  |
| `pr.list.kpiAvgImprove` | ดีขึ้น {days} วัน vs เดือนก่อน |  |
| `pr.list.filterCount` | กรอง · {count} |  |
| `pr.list.paginationRange` | แสดง {from}–{to} จาก {total} รายการ |  |
| `pr.form.approvalChainTitle` | เส้นทางการอนุมัติ | DEAD |
| `pr.form.stepPassed` | ผ่าน | DEAD |
| `pr.form.stepNotReached` | ยังไม่ถึง | DEAD |
| `pr.form.youBadge` | คุณ | DEAD |
| `pr.form.budgetCommittedLabel` | งบที่ผูกพันแล้ว / งบทั้งหมด | DEAD |
| `pr.form.budgetAfterApprove` | หลังอนุมัติ | DEAD |
| `pr.form.budgetUsed` | ใช้แล้ว | DEAD |
| `pr.form.budgetThisPR` | PR ฉบับนี้ | DEAD |
| `pr.form.colBoqItem` | BOQ Item | DEAD |
| `pr.form.attachModalTitle` | แนบไฟล์ประกอบ PR | DEAD |
| `pr.form.commentsTitle` | หมายเหตุ / Comment | DEAD |
| `pr.form.sendComment` | ส่ง | DEAD |
| `pr.form.syncTitle` | การ Sync | DEAD |
| `pr.form.syncOnApprove` | Sync เมื่ออนุมัติ | DEAD |
| `pr.form.back` | กลับ | DEAD |
| `pr.form.draftSavedToast` | บันทึกร่างแล้ว | DEAD |
| `pr.form.selectToast` | เลือก: {value} | DEAD |
| `pr.form.lastEdited` | · แก้ไขล่าสุด {datetime} น. | DEAD |
| `pr.form.tierWaiting` | ชั้น {step} จาก {total} · รอ {approver} | DEAD |
| `pr.form.itemsFromBoq` | ดึงจาก BOQ {code} · {n} รายการ · ราคาอัปเดต {date} | DEAD |
| `pr.form.itemsAddedToast` | เพิ่ม {n} รายการเข้า PR แล้ว · แก้จำนวนได้ในตาราง | DEAD |
| `pr.form.stickySummary` | ยอด {amount} ฿ · เหลือชั้นอนุมัติ {n} ชั้น · คาดอนุมัติเสร็จ {when} | DEAD |
| `pr.form.approvalRule` | กฎ: {rule} · {tiers} ชั้น | DEAD |
| `pr.form.budgetFooter` | BOQ {code} · หมวด {category} · งบ {amount} ฿ | DEAD |

### `cc` — 27 debt keys (27 live · 0 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `cc.title` | Cost Center · ศูนย์ต้นทุน |  |
| `cc.subtitle` | รหัสศูนย์ต้นทุน · จัดสรรค่าใช้จ่ายตามโครงการ/แผนก · ใช้กับ GL + Allocate |  |
| `cc.addBtn` | เพิ่ม Cost Center |  |
| `cc.modalTitle` | เพิ่ม Cost Center · ศูนย์ต้นทุนใหม่ |  |
| `cc.modalSubtitle` | กำหนดรหัส ชื่อ ประเภท และงบประมาณ · ใช้กับ GL + Allocate |  |
| `cc.fldCode` | รหัสศูนย์ต้นทุน |  |
| `cc.fldName` | ชื่อศูนย์ต้นทุน |  |
| `cc.fldLink` | ผูกกับ (เฟส / Block / แผนก) |  |
| `cc.fldOwner` | หัวหน้าศูนย์ต้นทุน |  |
| `cc.fldBudget` | งบประมาณ FY2569 (฿) |  |
| `cc.optProject` | Project · โครงการ |  |
| `cc.optOverhead` | Overhead · ค่าใช้จ่ายส่วนกลาง |  |
| `cc.optDept` | Dept · แผนก |  |
| `cc.phCode` | เช่น CC-CONS-RJP-04 |  |
| `cc.phName` | เช่น โครงการ ราชพฤกษ์ เฟส 4 |  |
| `cc.phLink` | เช่น เฟส 4 / Block E |  |
| `cc.phOwner` | เช่น สมชาย |  |
| `cc.errCodeRequired` | ระบุรหัสศูนย์ต้นทุน |  |
| `cc.errNameRequired` | ระบุชื่อศูนย์ต้นทุน |  |
| `cc.errBudgetNumber` | งบต้องเป็นตัวเลข |  |
| `cc.thLink` | ผูกกับ |  |
| `cc.thOwner` | หัวหน้า |  |
| `cc.thBudget` | งบ FY2569 (฿) |  |
| `cc.toastAdd` | เพิ่มศูนย์ต้นทุน {code} แล้ว · สถานะ ร่าง (รออนุมัติงบ) |  |
| `cc.thCode` | รหัส |  |
| `cc.fldType` | ประเภท |  |
| `cc.errCodeDup` | รหัสนี้มีอยู่แล้ว |  |

### `model` — 24 debt keys (24 live · 0 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `model.addBtn` | เพิ่ม Model |  |
| `model.addTitle` | เพิ่ม Model · แบบบ้านใหม่ |  |
| `model.addSubtitle` | กำหนดรหัส แบบบ้าน พื้นที่ และสเปกห้อง · ใช้ผูกกับ BOM และ Unit |  |
| `model.subtitle` | แบบบ้านมาตรฐาน · ใช้กับ BOM ของแต่ละ Model · ผูกกับ Unit ในโครงการ |  |
| `model.fieldCode` | รหัส Model |  |
| `model.fieldType` | ชื่อแบบบ้าน |  |
| `model.fieldArea` | พื้นที่ใช้สอย (ตร.ม.) |  |
| `model.fieldPrice` | ราคาเริ่มต้น (ล้านบาท) |  |
| `model.fieldBed` | ห้องนอน |  |
| `model.fieldBath` | ห้องน้ำ |  |
| `model.fieldParking` | ที่จอดรถ |  |
| `model.phCode` | เช่น F-1 |  |
| `model.phType` | เช่น บ้านเดี่ยว 2 ชั้น (ใหม่) |  |
| `model.errCodeRequired` | ระบุรหัส Model |  |
| `model.errCodeDup` | รหัส Model นี้มีอยู่แล้ว |  |
| `model.errTypeRequired` | ระบุชื่อแบบบ้าน |  |
| `model.errAreaRequired` | ระบุพื้นที่ใช้สอย |  |
| `model.errPriceInvalid` | ราคาไม่ถูกต้อง |  |
| `model.addInfo` | Model ใหม่เริ่มต้นสถานะ “ร่าง” · สร้าง BOM ของแบบบ้านนี้ได้หลังบันทึก |  |
| `model.priceLabel` | ราคาเริ่มต้น |  |
| `model.notifyOpenBom` | เปิดดู Bill of Materials |  |
| `model.parkingLabel` | ที่จอด |  |
| `model.priceUnit` | M ฿ |  |
| `model.toastAdd` | เพิ่มแบบบ้าน {code} · {type} แล้ว · สถานะ ร่าง |  |

### `users` — 21 debt keys (21 live · 0 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `users.title` | ผู้ใช้ & สิทธิ์การใช้งาน |  |
| `users.subtitle` | กำหนดบทบาท (Role) · สิทธิ์ตามโมดูล · วงเงินอนุมัติ |  |
| `users.addUserBtn` | เพิ่มผู้ใช้ |  |
| `users.addRoleBtn` | เพิ่มบทบาท |  |
| `users.roleLabel` | บทบาท (Role) |  |
| `users.approvalLimit` | วงเงินอนุมัติ |  |
| `users.moduleCol` | โมดูล |  |
| `users.matrixHint` | คลิกบทบาทอื่นที่แผงซ้ายเพื่อดูสิทธิ์ของบทบาทนั้น |  |
| `users.addUserTitle` | เพิ่มผู้ใช้งานใหม่ |  |
| `users.addUserSubtitle` | บันทึกข้อมูลผู้ใช้ · กำหนดบทบาท + แผนก · ส่งคำเชิญทาง email |  |
| `users.fieldFirst` | ชื่อ |  |
| `users.fieldLast` | นามสกุล |  |
| `users.fieldEmail` | อีเมล (ใช้เป็น Username) |  |
| `users.fieldDept` | แผนก / สังกัด |  |
| `users.activateNow` | เปิดใช้งานทันที |  |
| `users.activateNote` | ส่งคำเชิญทางอีเมล + ผู้ใช้ตั้งรหัสผ่านเอง |  |
| `users.saveInviteBtn` | บันทึก + ส่งคำเชิญ |  |
| `users.rolePanelCount` | {count} บทบาท |  |
| `users.notifyPermSaved` | บันทึกสิทธิ์ {role} แล้ว |  |
| `users.addUserRoleHint` | ระบบจะ gen Username จากอีเมล · กำหนดสิทธิ์ตาม {role} · วงเงินอนุมัติ {limit} |  |
| `users.notifyUserAdded` | เพิ่มผู้ใช้ {first} {last} ({role}) · ส่งคำเชิญทางอีเมลแล้ว |  |

### `login` — 20 debt keys (20 live · 0 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `login.heroLine1` | บริหารโครงการครบวงจร |  |
| `login.heroLine2` | ตั้งแต่จัดหาที่ดินถึงส่งมอบ |  |
| `login.heroDesc` | BOQ · จัดซื้อ · การเงิน · PM · ขาย-CRM · AI ถอด BOQ — รองรับหลายโครงการ หลายภาษา |  |
| `login.statScreens` | หน้าจอ |  |
| `login.statProjectTypes` | ประเภทโครงการ |  |
| `login.title` | เข้าสู่ระบบ |  |
| `login.subtitle` | ยินดีต้อนรับกลับ · กรอกข้อมูลเพื่อเข้าใช้งาน |  |
| `login.errRequired` | กรุณากรอกอีเมลและรหัสผ่าน |  |
| `login.password` | รหัสผ่าน |  |
| `login.remember` | จดจำฉันไว้ |  |
| `login.forgot` | ลืมรหัสผ่าน? |  |
| `login.noAccount` | ยังไม่มีบัญชี? |  |
| `login.signupFree` | สมัครทดลองฟรี |  |
| `login.success` | เข้าสู่ระบบสำเร็จ |  |
| `login.forgotTitle` | ลืมรหัสผ่าน |  |
| `login.forgotSubtitle` | ส่งลิงก์ตั้งรหัสใหม่ทางอีเมล |  |
| `login.forgotEmail` | อีเมลที่ลงทะเบียน |  |
| `login.forgotSubmit` | ส่งลิงก์รีเซ็ต |  |
| `login.forgotSent` | ส่งลิงก์ตั้งรหัสใหม่ไปที่ {email} แล้ว |  |
| `login.forgotEmailFallback` | อีเมลของคุณ |  |

### `role` — 18 debt keys (18 live · 0 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `role.noApprovalRight` | ไม่มีสิทธิ์อนุมัติเอกสาร |  |
| `role.addTitle` | เพิ่มบทบาทใหม่ (Role) |  |
| `role.addSubtitle` | ตั้งชื่อบทบาท + วงเงินอนุมัติ + กำหนดสิทธิ์ตามโมดูล |  |
| `role.fieldName` | ชื่อบทบาท |  |
| `role.phName` | เช่น Project Coordinator |  |
| `role.fieldLimit` | วงเงินอนุมัติ (฿) |  |
| `role.fieldLevel` | ชั้นอนุมัติ |  |
| `role.level0` | ไม่มีสิทธิ์อนุมัติ |  |
| `role.level1` | ชั้น 1 (Site) |  |
| `role.level2` | ชั้น 2 (Manager) |  |
| `role.level3` | ชั้น 3 (Director) |  |
| `role.level4` | ชั้น 4 (Executive) |  |
| `role.permHeader` | กำหนดสิทธิ์ตามโมดูล |  |
| `role.permHint` | คลิก checkbox เพื่อเปิด/ปิด |  |
| `role.saveBtn` | บันทึกบทบาท |  |
| `role.matrixLevelLine` | ระดับชั้น {level} ในการอนุมัติเอกสาร |  |
| `role.limitUnlimited` | ไม่จำกัด |  |
| `role.notifyAdded` | เพิ่มบทบาท "{name}" · วงเงิน {limit} ฿ สำเร็จ |  |

### `block` — 13 debt keys (13 live · 0 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `block.fieldName` | ชื่อบล็อก / อาคาร |  |
| `block.phName` | เช่น Block E |  |
| `block.fieldCode` | รหัส |  |
| `block.phCode` | เช่น E |  |
| `block.fieldModel` | แบบบ้าน (Model) |  |
| `block.fieldUnits` | จำนวนยูนิต |  |
| `block.addBtn` | เพิ่ม Block |  |
| `block.errNameReq` | ระบุชื่อบล็อก/อาคาร |  |
| `block.errCodeReq` | ระบุรหัส |  |
| `block.errCodeDup` | รหัสบล็อกนี้มีอยู่แล้ว |  |
| `block.errUnitsReq` | ระบุจำนวนยูนิต (อย่างน้อย 1) |  |
| `block.errUnitsMax` | สูงสุด 200 ยูนิตต่อบล็อก |  |
| `block.infoLine` | เพิ่มเข้า {phase} · ยูนิตทั้งหมดเริ่มต้นสถานะ “ว่าง” พร้อมผูก Model ที่เลือก |  |

### `project` — 12 debt keys (12 live · 0 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `project.createBtn` | สร้างโครงการใหม่ |  |
| `project.unitViewBtn` | มุมมองยูนิต |  |
| `project.notifyUnitGrid` | เปิดมุมมองยูนิต Grid |  |
| `project.legendSoldBuilt` | ขายแล้ว + ก่อสร้างเสร็จ |  |
| `project.legendSold` | ขายแล้ว |  |
| `project.legendBuilt` | ก่อสร้างแล้ว |  |
| `project.legendEmpty` | ว่าง |  |
| `project.structureLabel` | โครงสร้าง |  |
| `project.builtDoneLabel` | ก่อสร้างเสร็จ |  |
| `project.addPhaseBlockSubtitle` | เพิ่ม{block}ใหม่เข้า{phase} พร้อมจำนวน{unit} |  |
| `project.toastAddBlock` | เพิ่ม {name} ({units} {unit}) แล้ว |  |
| `project.notifyImportUnit` | เปิดฟอร์มนำเข้า{unit} |  |

### `createProj` — 12 debt keys (0 live · 12 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `createProj.subtitle` | เลือกประเภทโครงการ + ตั้งชื่อ — ระบบจะผูกโครงสร้าง/โมดูลตามประเภทให้อัตโนมัติ | DEAD |
| `createProj.step1Label` | ข้อมูลโครงการ | DEAD |
| `createProj.fieldName` | ชื่อโครงการ | DEAD |
| `createProj.phName` | เช่น juneflow ลาดพร้าว เฟส 1 | DEAD |
| `createProj.errName` | กรุณาระบุชื่อโครงการ | DEAD |
| `createProj.fieldCode` | รหัสย่อ (ไม่บังคับ) | DEAD |
| `createProj.phUnits` | เช่น 84 | DEAD |
| `createProj.summaryTitle` | สรุปก่อนสร้าง | DEAD |
| `createProj.createSkip` | สร้างเลย (ข้ามโครงสร้าง) | DEAD |
| `createProj.next` | ถัดไป | DEAD |
| `createProj.createBtn2` | สร้างโครงการ | DEAD |
| `createProj.quotaLabel` | จำนวนโครงการ | DEAD |

### `dept` — 5 debt keys (5 live · 0 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `dept.PROC` | PROC — ฝ่ายจัดซื้อ |  |
| `dept.FIN` | FIN — ฝ่ายบัญชี/การเงิน |  |
| `dept.SLS` | SLS — ฝ่ายขาย-การตลาด |  |
| `dept.ADM` | ADM — ฝ่ายบริหาร |  |
| `dept.WH` | WH — คลังวัสดุ |  |

### `company` — 3 debt keys (1 live · 2 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `company.pickTitle` | เลือกบริษัท (Multi-Company) | DEAD |
| `company.taxLabel` | เลขภาษี |  |
| `company.info` | สลับบริษัทแล้ว รายการโครงการ/เอกสาร/งบการเงินจะกรองตามบริษัทที่เลือก · เลขที่เอกสารออกตาม prefix ของแต่ละบริษัท | DEAD |

### `perm` — 1 debt keys (1 live · 0 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `perm.view` | ดู |  |

### `master` — 1 debt keys (1 live · 0 dead)

| key | Thai source (`th`) | live? |
|-----|--------------------|:-----:|
| `master.breadcrumb` | ข้อมูลกลาง |  |

---

## 3. Dead-key list (in `dict`, unused in `apps/web/src`)

**291 keys** appear in the `dict` but are never referenced as a string literal anywhere in `apps/web/src` (checked plain `t("key")`, keys stored in `labelKey`/`accKey`/`noteKey`/`lockKey` object props passed to dynamic `t(var)`, and template-prefix builds like `` t(`role.level$master`) ``).

- **261** of these are also debt (never translated **and** never used) — safe drop candidates; do **not** spend the sacred round translating them.
- **30** are already-translated but unused (mostly `nav` chrome kept for future menus).
- Cross-checked against `apps/mobile` + `packages`: only **`nav.audit`** is consumed outside web — every other dead key is dead repo-wide.

_Dead keys by namespace:_ `boq` 119 · `dashboard` 32 · `pr` 24 · `docnum` 24 · `nav` 23 · `ptype` 19 · `wo` 13 · `createProj` 12 · `po` 10 · `gr` 6 · `common` 4 · `company` 2 · `user` 2 · `app` 1

<details><summary>Full dead-key list (291)</summary>

- `app.tagline` — translated-but-unused
- `boq.aiqElemPieces` — debt (drop candidate)
- `boq.aprAgeAgo` — debt (drop candidate)
- `boq.aprChangeBreakdown` — debt (drop candidate)
- `boq.aprChangedOf` — debt (drop candidate)
- `boq.aprDiffNewBoq` — debt (drop candidate)
- `boq.aprFirstEdition` — debt (drop candidate)
- `boq.aprNewItemsCount` — debt (drop candidate)
- `boq.aprOpenNewTab` — debt (drop candidate)
- `boq.aprPrintConfirm` — debt (drop candidate)
- `boq.arcApplyFilter` — debt (drop candidate)
- `boq.arcCompareToast` — debt (drop candidate)
- `boq.arcCompareVer` — debt (drop candidate)
- `boq.arcCopyConfirm` — debt (drop candidate)
- `boq.arcCopyMsg` — debt (drop candidate)
- `boq.arcCopyToast` — debt (drop candidate)
- `boq.arcExportHistFlag` — debt (drop candidate)
- `boq.arcExportHistoryToast` — debt (drop candidate)
- `boq.arcExportScopeAll` — debt (drop candidate)
- `boq.arcExportScopeFiltered` — debt (drop candidate)
- `boq.arcExportScopeYear` — debt (drop candidate)
- `boq.arcExportSubtitle` — debt (drop candidate)
- `boq.arcExportTitle` — debt (drop candidate)
- `boq.arcExportToast` — debt (drop candidate)
- `boq.arcFilterSubtitle` — debt (drop candidate)
- `boq.arcFilterTitle` — debt (drop candidate)
- `boq.arcFilterToast` — debt (drop candidate)
- `boq.arcFldYearBe` — debt (drop candidate)
- `boq.arcFmtCsv` — debt (drop candidate)
- `boq.arcFmtExcel` — debt (drop candidate)
- `boq.arcFmtPdfReport` — debt (drop candidate)
- `boq.arcHistoryTitle` — debt (drop candidate)
- `boq.arcOptCancelled` — debt (drop candidate)
- `boq.arcToggleIncHist` — debt (drop candidate)
- `boq.arcToggleIncHistSub` — debt (drop candidate)
- `boq.arcToggleWithFiles` — debt (drop candidate)
- `boq.arcToggleWithFilesSub` — debt (drop candidate)
- `boq.bomEditItemTitle` — debt (drop candidate)
- `boq.edAddGroupSubtitle` — debt (drop candidate)
- `boq.edAddGroupTitle` — debt (drop candidate)
- `boq.edAddGroupToast` — debt (drop candidate)
- `boq.edAuditExport` — debt (drop candidate)
- `boq.edAuditExportToast` — debt (drop candidate)
- `boq.edAuditSubtitle` — debt (drop candidate)
- `boq.edDelGroupMsg` — debt (drop candidate)
- `boq.edDelGroupReasonPh` — debt (drop candidate)
- `boq.edDelGroupTitle` — debt (drop candidate)
- `boq.edDelGroupToast` — debt (drop candidate)
- `boq.edDelItemMsg` — debt (drop candidate)
- `boq.edDelItemSubtitle` — debt (drop candidate)
- `boq.edDelItemTitle` — debt (drop candidate)
- `boq.edDelItemToast` — debt (drop candidate)
- `boq.edFldGroupCode` — debt (drop candidate)
- `boq.edFldGroupName` — debt (drop candidate)
- `boq.edGroupCodeHint` — debt (drop candidate)
- `boq.edGroupNamePh` — debt (drop candidate)
- `boq.edItemEditTitle` — debt (drop candidate)
- `boq.edItemThis` — debt (drop candidate)
- `boq.edItemUpdateToast` — debt (drop candidate)
- `boq.edMoveGroupToast` — debt (drop candidate)
- `boq.edRenameGroupTitle` — debt (drop candidate)
- `boq.edRenameGroupToast` — debt (drop candidate)
- `boq.edReviseReasonErr` — debt (drop candidate)
- `boq.edReviseScope1` — debt (drop candidate)
- `boq.edReviseScope2` — debt (drop candidate)
- `boq.edReviseScope3` — debt (drop candidate)
- `boq.edReviseScope4` — debt (drop candidate)
- `boq.edReviseScopeLabel` — debt (drop candidate)
- `boq.edStartBomToast` — debt (drop candidate)
- `boq.edStartManualToast` — debt (drop candidate)
- `boq.listDelMsg` — debt (drop candidate)
- `boq.listDelReasonPh` — debt (drop candidate)
- `boq.listDelToast` — debt (drop candidate)
- `boq.listDupToast` — debt (drop candidate)
- `boq.listExcCostCode` — debt (drop candidate)
- `boq.listExcCostName` — debt (drop candidate)
- `boq.listExcGroupBom` — debt (drop candidate)
- `boq.listExcItemCode` — debt (drop candidate)
- `boq.listExcItemName` — debt (drop candidate)
- `boq.listExcMS` — debt (drop candidate)
- `boq.listExcMatType` — debt (drop candidate)
- `boq.listExcSubType` — debt (drop candidate)
- `boq.ovUpdatedAt` — debt (drop candidate)
- `boq.repCat01` — debt (drop candidate)
- `boq.repCat03ArchOpt` — debt (drop candidate)
- `boq.repCat04` — debt (drop candidate)
- `boq.repCat05Plumb` — debt (drop candidate)
- `boq.repCat05PlumbOpt` — debt (drop candidate)
- `boq.repCat06` — debt (drop candidate)
- `boq.repCopies` — debt (drop candidate)
- `boq.repDocFormat` — debt (drop candidate)
- `boq.repEvmBad` — debt (drop candidate)
- `boq.repEvmFooter` — debt (drop candidate)
- `boq.repEvmGood` — debt (drop candidate)
- `boq.repExportScopeAllPhase` — debt (drop candidate)
- `boq.repExportScopeFiltered` — debt (drop candidate)
- `boq.repExportScopeYear` — debt (drop candidate)
- `boq.repExportSubtitle` — debt (drop candidate)
- `boq.repExportTitle` — debt (drop candidate)
- `boq.repExportToast` — debt (drop candidate)
- `boq.repFilterSubtitle` — debt (drop candidate)
- `boq.repFilterTitle` — debt (drop candidate)
- `boq.repFilterToast` — debt (drop candidate)
- `boq.repFilterToggle` — debt (drop candidate)
- `boq.repFilterToggleSub` — debt (drop candidate)
- `boq.repFmtPdfLandscape` — debt (drop candidate)
- `boq.repFmtPdfPortrait` — debt (drop candidate)
- `boq.repFmtPdfShare` — debt (drop candidate)
- `boq.repFmtPrintNow` — debt (drop candidate)
- `boq.repOptBoth` — debt (drop candidate)
- `boq.repOptBothWorkbook` — debt (drop candidate)
- `boq.repOptReviseExport` — debt (drop candidate)
- `boq.repOptRevisePrint` — debt (drop candidate)
- `boq.repOptSummary` — debt (drop candidate)
- `boq.repPrintInfo` — debt (drop candidate)
- `boq.repPrintSubtitle` — debt (drop candidate)
- `boq.repPrintTitle` — debt (drop candidate)
- `boq.repPrintToast` — debt (drop candidate)
- `boq.repReportsCount` — debt (drop candidate)
- `boq.repStatusPending` — debt (drop candidate)
- `common.create` — translated-but-unused
- `common.profile` — translated-but-unused
- `common.total` — translated-but-unused
- `common.viewAll` — translated-but-unused
- `company.info` — debt (drop candidate)
- `company.pickTitle` — debt (drop candidate)
- `createProj.createBtn2` — debt (drop candidate)
- `createProj.createSkip` — debt (drop candidate)
- `createProj.errName` — debt (drop candidate)
- `createProj.fieldCode` — debt (drop candidate)
- `createProj.fieldName` — debt (drop candidate)
- `createProj.next` — debt (drop candidate)
- `createProj.phName` — debt (drop candidate)
- `createProj.phUnits` — debt (drop candidate)
- `createProj.quotaLabel` — debt (drop candidate)
- `createProj.step1Label` — debt (drop candidate)
- `createProj.subtitle` — debt (drop candidate)
- `createProj.summaryTitle` — debt (drop candidate)
- `dashboard.activityAutoBudget` — debt (drop candidate)
- `dashboard.activityRejectRevise` — debt (drop candidate)
- `dashboard.activitySyncSAP` — debt (drop candidate)
- `dashboard.costOverhead` — debt (drop candidate)
- `dashboard.deltaBudgetMonth` — debt (drop candidate)
- `dashboard.deltaBudgetQuarter` — debt (drop candidate)
- `dashboard.deltaBudgetWeek` — debt (drop candidate)
- `dashboard.deltaPerContract` — debt (drop candidate)
- `dashboard.milestoneUAT` — debt (drop candidate)
- `dashboard.phaseLate` — debt (drop candidate)
- `dashboard.phaseOnTrack` — debt (drop candidate)
- `dashboard.phaseSoon` — debt (drop candidate)
- `dashboard.remainSubLoss` — debt (drop candidate)
- `dashboard.tplDeliver` — debt (drop candidate)
- `dashboard.tplDeltaMoM` — debt (drop candidate)
- `dashboard.tplDeltaOverBudget` — debt (drop candidate)
- `dashboard.tplDeltaYoY` — debt (drop candidate)
- `dashboard.tplDocCount` — debt (drop candidate)
- `dashboard.tplEditCount` — debt (drop candidate)
- `dashboard.tplFiTRate` — debt (drop candidate)
- `dashboard.tplGoLive` — debt (drop candidate)
- `dashboard.tplInDays` — debt (drop candidate)
- `dashboard.tplInverterPanels` — debt (drop candidate)
- `dashboard.tplIrrNpv` — debt (drop candidate)
- `dashboard.tplMilestoneInspection` — debt (drop candidate)
- `dashboard.tplOverQuarterBudget` — debt (drop candidate)
- `dashboard.tplPctOfMonthBudget` — debt (drop candidate)
- `dashboard.tplPctOfWeekBudget` — debt (drop candidate)
- `dashboard.tplRemainDays` — debt (drop candidate)
- `dashboard.tplRemainMonths` — debt (drop candidate)
- `dashboard.tplTargetGte` — debt (drop candidate)
- `dashboard.tplTimeAgo` — debt (drop candidate)
- `docnum.addModalSubtitle` — debt (drop candidate)
- `docnum.editModalSubtitle` — debt (drop candidate)
- `docnum.editTitle` — debt (drop candidate)
- `docnum.errPrefixExists` — debt (drop candidate)
- `docnum.errPrefixRequired` — debt (drop candidate)
- `docnum.errRunningRequired` — debt (drop candidate)
- `docnum.errTypeRequired` — debt (drop candidate)
- `docnum.fldLock` — debt (drop candidate)
- `docnum.fldPrefix` — debt (drop candidate)
- `docnum.fldReset` — debt (drop candidate)
- `docnum.fldRunningEdit` — debt (drop candidate)
- `docnum.fldRunningNew` — debt (drop candidate)
- `docnum.fldType` — debt (drop candidate)
- `docnum.optLockAll` — debt (drop candidate)
- `docnum.optLockDept` — debt (drop candidate)
- `docnum.optLockNone` — debt (drop candidate)
- `docnum.optLockWarehouse` — debt (drop candidate)
- `docnum.optResetNone` — debt (drop candidate)
- `docnum.optResetQuarter` — debt (drop candidate)
- `docnum.phPrefix` — debt (drop candidate)
- `docnum.phType` — debt (drop candidate)
- `docnum.previewLabel` — debt (drop candidate)
- `docnum.toastAdd` — debt (drop candidate)
- `docnum.toastSave` — debt (drop candidate)
- `gr.create.balanceRemaining` — debt (drop candidate)
- `gr.create.refSubtitle` — debt (drop candidate)
- `gr.list.badgeComplete` — debt (drop candidate)
- `gr.list.fullyReceived` — debt (drop candidate)
- `gr.list.kpiReturnsSub` — debt (drop candidate)
- `gr.list.shortReceived` — debt (drop candidate)
- `nav.ap` — translated-but-unused
- `nav.ar` — translated-but-unused
- `nav.audit` — translated-but-unused
- `nav.bank` — translated-but-unused
- `nav.boq.archive` — translated-but-unused
- `nav.boq.editor` — translated-but-unused
- `nav.boq.overview` — translated-but-unused
- `nav.dashboard` — translated-but-unused
- `nav.gl` — translated-but-unused
- `nav.gr` — translated-but-unused
- `nav.master.item` — translated-but-unused
- `nav.master.project` — translated-but-unused
- `nav.master.vendor` — translated-but-unused
- `nav.po` — translated-but-unused
- `nav.pr` — translated-but-unused
- `nav.sales` — translated-but-unused
- `nav.sec.fin` — translated-but-unused
- `nav.sec.main` — translated-but-unused
- `nav.sec.master` — translated-but-unused
- `nav.sec.sys` — translated-but-unused
- `nav.settings` — translated-but-unused
- `nav.subcon` — translated-but-unused
- `nav.users` — translated-but-unused
- `po.form.breadcrumbNew` — debt (drop candidate)
- `po.form.deductInfo` — debt (drop candidate)
- `po.form.itemsFromPr` — debt (drop candidate)
- `po.list.confirmPayMsg` — debt (drop candidate)
- `po.list.deductDeposit` — debt (drop candidate)
- `po.list.deductInstall1` — debt (drop candidate)
- `po.list.depositDue` — debt (drop candidate)
- `po.list.depositPaid` — debt (drop candidate)
- `po.list.kpiDepositSub` — debt (drop candidate)
- `po.list.overdueCount` — debt (drop candidate)
- `pr.form.approvalChainTitle` — debt (drop candidate)
- `pr.form.approvalRule` — debt (drop candidate)
- `pr.form.attachModalTitle` — debt (drop candidate)
- `pr.form.back` — debt (drop candidate)
- `pr.form.budgetAfterApprove` — debt (drop candidate)
- `pr.form.budgetCommittedLabel` — debt (drop candidate)
- `pr.form.budgetFooter` — debt (drop candidate)
- `pr.form.budgetThisPR` — debt (drop candidate)
- `pr.form.budgetUsed` — debt (drop candidate)
- `pr.form.colBoqItem` — debt (drop candidate)
- `pr.form.commentsTitle` — debt (drop candidate)
- `pr.form.draftSavedToast` — debt (drop candidate)
- `pr.form.itemsAddedToast` — debt (drop candidate)
- `pr.form.itemsFromBoq` — debt (drop candidate)
- `pr.form.lastEdited` — debt (drop candidate)
- `pr.form.selectToast` — debt (drop candidate)
- `pr.form.sendComment` — debt (drop candidate)
- `pr.form.stepNotReached` — debt (drop candidate)
- `pr.form.stepPassed` — debt (drop candidate)
- `pr.form.stickySummary` — debt (drop candidate)
- `pr.form.syncOnApprove` — debt (drop candidate)
- `pr.form.syncTitle` — debt (drop candidate)
- `pr.form.tierWaiting` — debt (drop candidate)
- `pr.form.youBadge` — debt (drop candidate)
- `ptype.defCostTypes` — debt (drop candidate)
- `ptype.defHierarchy` — debt (drop candidate)
- `ptype.editTitle` — debt (drop candidate)
- `ptype.fldIcon` — debt (drop candidate)
- `ptype.fldNameEn` — debt (drop candidate)
- `ptype.fldNameTh` — debt (drop candidate)
- `ptype.formSubmitAdd` — debt (drop candidate)
- `ptype.hintCostTypes` — debt (drop candidate)
- `ptype.hintWbs` — debt (drop candidate)
- `ptype.modalSubtitle` — debt (drop candidate)
- `ptype.moduleNote` — debt (drop candidate)
- `ptype.phCostTypes` — debt (drop candidate)
- `ptype.phDesc` — debt (drop candidate)
- `ptype.phNameEn` — debt (drop candidate)
- `ptype.phNameTh` — debt (drop candidate)
- `ptype.phWbs` — debt (drop candidate)
- `ptype.secModules` — debt (drop candidate)
- `ptype.toastAdd` — debt (drop candidate)
- `ptype.toastEdit` — debt (drop candidate)
- `user.name` — translated-but-unused
- `user.role` — translated-but-unused
- `wo.form.breadcrumbNew` — debt (drop candidate)
- `wo.list.atContractPct` — debt (drop candidate)
- `wo.list.closeConfirmBtn` — debt (drop candidate)
- `wo.list.variationCount` — debt (drop candidate)
- `wo.vo.createdToast` — debt (drop candidate)
- `wo.vo.dirAdd` — debt (drop candidate)
- `wo.vo.dirCut` — debt (drop candidate)
- `wo.vo.modalSubtitle` — debt (drop candidate)
- `wo.vo.modalTitle` — debt (drop candidate)
- `wo.vo.reasonPlaceholder` — debt (drop candidate)
- `wo.vo.submitBtn` — debt (drop candidate)
- `wo.vo.workDetail` — debt (drop candidate)
- `wo.vo.workDetailPlaceholder` — debt (drop candidate)

</details>

---

## 4. Missing-key list (referenced in code, ABSENT from `dict`) — real bugs

**0 missing keys.** Every `t("…")` literal key resolved against the `dict` — no key-name-render bug found. (700 distinct `t()` literal keys + keys via dynamic `labelKey`/`accKey`/prefix builds all resolve.)

> Note: `tp()` (PHRASES) and `tn()` (NAV) layers key on Thai strings, not dict keys, so they are out of scope for dict missing-key checks — see §5.

---

## 5. Other translation surfaces (brief)

The `dict` (`t()`) layer above is the debt hotspot. Two sibling surfaces are keyed by Thai string (not stable key) and are **largely already translated**:

- **`nav_i18n`** (`tn()` layer) — 127 entries, Thai menu label → `{en,zh,ar, +bn/fa/id/ja/pt/zh-TW}`. Only ~33 echo/empty `en`; mostly done. Extra langs present beyond the 4 UI langs.
- **`phrases`** (`tp()` layer) — 762 entries, Thai phrase → `{en,zh,ar}`. Only ~44 echo/empty `en`; mostly done.
- **`phrase_patterns`** — 2 dynamic number-bearing patterns; intentionally NOT wired (BLOCKERS.md B-017).

These surfaces are a separate batch and not counted in the 999-key `dict` debt.

---

## 6. Applying this = ONE Wei sacred round

`packages/i18n/src/i18n-full.json` is sacred (hook-protected, `.claude/hooks/protect-files.sh`). Translating the debt = **one Wei-approved sacred round** (`SACRED_OVERRIDE=wei-approved:B-xxx`), editing the `dict` `en`/`zh`/`ar` fields in place.

- Translate the **738 actionable (live)** debt keys; **skip the 261 debt-and-dead** keys (drop them in a separate cleanup, or leave as-is).
- **Both copies** must move together if a build/dist copy of `i18n-full.json` exists — keep source and any generated copy identical.
- Recommend batching by namespace (largest first: `boq`, then `vendor`/`org`/`dashboard`/`gr`/`po` …) so the round can be reviewed per-domain.


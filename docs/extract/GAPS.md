# GAPS — สิ่งที่พบในโค้ดแต่ไม่อยู่ในเอกสาร handoff หรือขัดแย้งกัน

เทียบระหว่างโค้ดใน `pototype/` กับเอกสารชุด `design_handoff_juneflow/` (README.md, FUNCTIONS.md, FUNCTIONS-INVENTORY.md, api-contract.md, data-dictionary.html, tokens.json)
ทุกข้อคือข้อเท็จจริงที่ตรวจจากไฟล์จริง — ไม่มีการตีความหรือเสนอทางแก้

## 1. ตัวเลข/ข้อความในเอกสารที่ไม่ตรงกับโค้ด

| เอกสารระบุ | โค้ดจริง |
|---|---|
| README.md + FUNCTIONS.md: "i18n*.jsx (dict **732 คีย์**)" | นับจริงหลัง merge: DICT 59 + NAV_I18N 112 + PHRASES 736 (ไม่มีชุดใดเท่ากับ 732) — ดู I18N-KEYS.md |
| FUNCTIONS-INVENTORY.md: "719 functions จาก **78 ไฟล์** .jsx" | มี .jsx 78 ไฟล์ที่ root จริง แต่ **ไม่รวม** `wat/*.jsx` อีก 14 ไฟล์ (แอป "บุญบัญชี" แยกต่างหาก) |
| README.md: "ไฟล์ `.jsx` ~78 ไฟล์ ... เปิดในเบราว์เซอร์" | `index.html` โหลด .jsx เพียง **77 ไฟล์** — `tweaks-panel.jsx` มีอยู่แต่ไม่ถูกโหลด (shell.jsx มี `TweaksPopover` ของตัวเอง) |
| data-dictionary: แพ็กเกจ 4 ระดับ S/M/L/Full (2,900 / 7,900 / **14,900** / ติดต่อ) | `pkg-builder.jsx` ตรงตามนี้ แต่ `subscription.jsx` (`SUB_PACKAGES`) มีเพียง **3 ระดับ** starter/pro/enterprise (2,900 / 7,900 / null) — ไม่มีชั้น 14,900 |
| data-dictionary: `limits` ใช้ key `storage_gb`, `ai_per_month` | โค้ดใช้ `storage`, `ai` |

## 2. โค้ด/ระบบที่ไม่อยู่ในเอกสาร handoff เลย

- **แอป `wat/` "บุญบัญชี — ระบบบริหารการเงินวัด"** ทั้งแอป (14 ไฟล์ + entry HTML + theme.css + `window.SCREENS` registry ของตัวเอง + mock 11 ชุด) — ไม่ถูกกล่าวถึงในเอกสาร handoff ฉบับใด
- Entity ที่มี mock ในโค้ดแต่ **ไม่มีใน data-dictionary**: Inventory ทั้งหมวด (Item/Warehouse/Transfer/Issue), Lead/CRM, Service tickets หลังการขาย, Solar (PPA/ROI/permit/warranty/O&M), Timeline/Task/Milestone, Petty Cash, org structure (`ORG_SEED`), doc numbering (`DOCNUM_SEED`), bid comparison, Retention/RevRec/WIP/P&L, ใบลดหนี้ AR
- `pototype/uploads/` มีไฟล์ต้นทางที่เอกสารไม่กล่าวถึง: template Excel BOM/BOQ 2 ไฟล์ (M1-RM, M2-RM), แบบ AutoCAD `ผังถนน.dwg`, screenshot 27 ไฟล์
- โฟลเดอร์ `pototype/wat-shots/` (1 ไฟล์)

## 3. โค้ดขัดแย้งกันเอง / จุดกำกวมภายในโค้ด

- **`window.VENDOR_SEED` ถูก assign ใน 2 ไฟล์**: `master-party.jsx` และ `subcon.jsx` (ผลขึ้นกับลำดับโหลด)
- `finance.jsx` (header: "Finance — AP, AR, GL") ซ้ำซ้อนกับโมดูลเต็ม `ap.jsx` / `ar.jsx` / `gl.jsx` ที่ RouteView ใช้จริง — finance.jsx ไม่ถูกอ้างใน RouteView
- `ROUTE_LABELS` (chrome.jsx) **ไม่มี key `boq.bom`** ทั้งที่เมนูและ RouteView มี route นี้; ป้าย `boq.approval` ใน NAV ("อนุมัติ BOQ") ต่างจาก ROUTE_LABELS ("อนุมัติ BOM/BOQ")
- `chrome.jsx` export `window.ROUTE_PARENT = {}` เป็น object ว่าง (ตัว logic จริงอยู่ที่ฟังก์ชัน `PARENT_ID_OF_ROUTE`)
- `routeModule("subcon")` (project-types.jsx) จับเฉพาะ route `subcon` ตรงตัว — route ที่ใช้จริงในเมนู (`subcon.progress`, `subcon.contracts`) คืน null = ไม่ถูก gate ด้วยประเภทโครงการที่ระดับ route (ยัง gate ที่ระดับ NAV ด้วย `mod: "subcon"`)
- module `aftersales` ประกาศใน `PROJECT_TYPES.realestate.modules` แต่ไม่มีเมนู/route ใดอ้างถึง
- i18n มี key ซ้ำภายใน object เดียวกันหลายจุด (ตัวหลังทับตัวแรก) — รายการเต็มใน I18N-KEYS.md §5
- แพ็กเกจใน `PKG_STORE` ไม่ persist (seed ใหม่ทุก reload) ขณะที่ route/theme/lang persist ใน localStorage — README ระบุข้อจำกัดนี้ไว้แล้วบางส่วน ("ข้อมูล mock ในไฟล์ รีเฟรชรีเซ็ต")

## 4. Mock data ขัดแย้งกับ data-dictionary (สรุปจาก MOCK-DATA.md)

- WorkPeriod: mock ใช้ `basis` เพิ่มค่า `unit` (เหมาต่อหลัง) ที่ dictionary ไม่มี; `state` ใน mock = accepted/requested/pending/rejected ≠ ชุดใน dictionary (pending/delivered/inspecting/passed/rejected/paid)
- e-Tax status: mock `sent|pending|error|void` ≠ dictionary `queued|sent|rejected`
- JV: dictionary กำหนด `lines[{account_id,dr,cr,...}]` แต่ mock `JV_LIST.lines` เป็นแค่ตัวเลขจำนวนบรรทัด
- FK ทุกชุดใน mock เป็นข้อความชื่อ (vendor, project, costName) ไม่ใช่ `*_id` ตาม dictionary
- ฟิลด์หายรายตัว (Company, PO, GR, Contract, PMContract, PMWO, ARInvoice, AP/PV, Document, Notification, AuditLog, OpexBudget) — รายละเอียดใน MOCK-DATA.md
- Entity ใน dictionary ที่ **ไม่มี mock เลย**: AiUsage, Acceptance, Defect, Attendance, Payroll, SalesUnit (โครงฟิลด์เต็ม), Cheque register, Unit records

## 5. เอกสาร handoff ซ้ำซ้อน 2 ชุด

- `pototype/handoff/` กับ `design_handoff_juneflow/` มีไฟล์ร่วม 8 ไฟล์ **byte-identical ทั้งหมด** (ตรวจด้วย `cmp`)
- ต่างกัน: `pototype/handoff/` มี `HANDOFF.md` เพิ่ม; `design_handoff_juneflow/` มี `README.md`, `FUNCTIONS.md`, `FUNCTIONS-INVENTORY.md`, `_inv1.md` เพิ่ม
- `_inv1.md` เป็นไฟล์ทำงานค้าง (เริ่มกลางรายการ ไม่มี header) เนื้อหาซ้อนกับ FUNCTIONS-INVENTORY.md

## 6. Gallery / build artifacts

- `แกลเลอรีหน้าจอ.html` อ้างรูป g1 28 รูป แต่โฟลเดอร์ g1 มี 30; ใช้ g1/g2/g3/g5 แต่ไม่ใช้ g4; `คู่มือ Flow + ภาพหน้าจอ.html` ใช้ g1–g4 ไม่ใช้ g5
- ไฟล์ standalone build ขนาดใหญ่ 4 ไฟล์ (2–9 MB) + แกลเลอรีออฟไลน์ 8.5 MB ซ้ำ 3 ตำแหน่ง — รวม ~37 MB เป็น artifact ซ้ำ

## 7. ไฟล์ที่อ่านไม่ได้

ไม่มี — ทุกไฟล์เปิดอ่านได้ปกติ (ไฟล์ binary: รูป .jpg/.png, .xlsx 2 ไฟล์, .dwg 1 ไฟล์ — บันทึกขนาดไว้ใน INVENTORY.md แต่ไม่ได้แกะเนื้อหา)

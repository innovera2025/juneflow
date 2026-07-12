# Visual Gate Reference Index — ภาพอ้างอิง → จอ / route

> Task **P0-QA-01** · Gate G5 (PLAN.md §0 + §9) · เขต `qa`
> ทุก path relative จาก `tests/visual/reference/`  
> ห้ามแก้ไฟล์ภาพต้นทาง (ก๊อปจาก `pototype/gallery/` + `pototype/shots/` — sacred ต้นทาง B-001)

## สรุปจำนวน (ตรวจแล้วตรง gate P0-QA-01)

| ชุด | ที่ตั้ง | จำนวน | รูปแบบ |
|---|---|---|---|
| gallery/g1 | `tests/visual/reference/gallery/g1/` | 30 | `.jpg` |
| gallery/g2 | `tests/visual/reference/gallery/g2/` | 47 | `.jpg` |
| gallery/g3 | `tests/visual/reference/gallery/g3/` | 5 | `.jpg` |
| gallery/g4 | `tests/visual/reference/gallery/g4/` | 4 | `.jpg` |
| gallery/g5 | `tests/visual/reference/gallery/g5/` | 20 | `.jpg` |
| **gallery รวม** | | **106 .jpg** | |
| shots | `tests/visual/reference/shots/` | 22 | `.png` |
| **รวมทั้งหมด** | | **128 ภาพ** | |

**แหล่งอ้างอิงการ map:** label + route id ถอดจาก `pototype/คู่มือ Flow + ภาพหน้าจอ.html` (มี route + ไฟล์ .jsx) และ `pototype/แกลเลอรีหน้าจอ.html` (มี route id) — cross-check กับ `docs/extract/NAV-ROUTES.md` ทุกแถว  
route id ที่ลงท้าย `.jsx` = ไฟล์ต้นทางใน pototype · คอลัมน์ 'route' = route id ตาม NAV-ROUTES.md

---

## g1 — แกนระบบ · ที่ดิน · BOQ · จัดซื้อ (30)

| ภาพ | จอ (label) | route | ไฟล์ .jsx | หมวด | แหล่ง map |
|---|---|---|---|---|---|
| `gallery/g1/01-s.jpg` | ภาพรวมโครงการ (Dashboard) | `dashboard` | dashboard.jsx | แกนระบบ | gallery+flow |
| `gallery/g1/02-s.jpg` | ภาพรวมผู้บริหาร | `exec` | exec-audit.jsx | แกนระบบ | gallery+flow |
| `gallery/g1/03-s.jpg` | Pipeline จัดหาที่ดิน | `land.pipeline` | land.jsx | ที่ดิน | gallery+flow |
| `gallery/g1/04-s.jpg` | ทะเบียนแปลงที่ดิน | `land.bank` | land.jsx | ที่ดิน | gallery+flow |
| `gallery/g1/05-s.jpg` | สำรวจ-รังวัด & Feasibility | `land.survey` | land2.jsx | ที่ดิน | gallery+flow |
| `gallery/g1/06-s.jpg` | Due Diligence & ซื้อ/เช่า | `land.dd` | land2.jsx | ที่ดิน | gallery+flow |
| `gallery/g1/07-s.jpg` | BOQ Overview | `boq.overview` | boq.jsx | BOQ | gallery+flow |
| `gallery/g1/08-s.jpg` | BOQ List | `boq.list` | boq-list.jsx | BOQ | gallery+flow |
| `gallery/g1/09-s.jpg` | นำเข้า CAD/BIM (AI ถอด BOQ) | `boq.aiqto` | ai-qto.jsx | BOQ | gallery+flow |
| `gallery/g1/10-s.jpg` | BOM สูตรต่อหลัง | `boq.bom` | bom.jsx | BOQ | gallery+flow |
| `gallery/g1/11-s.jpg` | BOQ Editor | `boq.editor` | boq.jsx | BOQ | gallery+flow |
| `gallery/g1/12-s.jpg` | อนุมัติ BOM/BOQ | `boq.approval` | boq.jsx | BOQ | gallery+flow |
| `gallery/g1/13-s.jpg` | Archive BOQ | `boq.archive` | boq-extra.jsx | BOQ | gallery+flow |
| `gallery/g1/14-s.jpg` | รายงาน BOQ | `boq.reports` | boq-extra.jsx | BOQ | gallery+flow |
| `gallery/g1/15-s.jpg` | ใบขอซื้อ (PR) | `pr.list` | pr-list.jsx | จัดซื้อ | gallery+flow |
| `gallery/g1/16-s.jpg` | ใบสั่งซื้อ (PO) | `po.list` | po-wo.jsx | จัดซื้อ | gallery+flow |
| `gallery/g1/17-s.jpg` | ใบสั่งจ้าง (WO) | `wo.list` | po-wo.jsx | จัดซื้อ | gallery+flow |
| `gallery/g1/18-s.jpg` | รับสินค้า (GR) | `gr.list` | gr.jsx | จัดซื้อ | gallery+flow |
| `gallery/g1/19-s.jpg` | ผู้รับเหมา (Progress) | `subcon` | subcon.jsx | จัดซื้อ | flow |
| `gallery/g1/20-s.jpg` | แผนงานโครงการ (Timeline) | `timeline` | timeline.jsx | แกนระบบ | gallery+flow |
| `gallery/g1/21-s.jpg` | Item Master | `inv.items` | inventory.jsx | คลัง | gallery+flow |
| `gallery/g1/22-s.jpg` | Stock & คลัง | `inv.stock` | inventory.jsx | คลัง | gallery+flow |
| `gallery/g1/23-s.jpg` | โอนคลัง | `inv.transfer` | inventory.jsx | คลัง | gallery+flow |
| `gallery/g1/24-s.jpg` | เบิกออก | `inv.issue` | inventory.jsx | คลัง | gallery+flow |
| `gallery/g1/25-s.jpg` | เงินสดย่อย | `petty` | petty-alloc.jsx | การเงิน | gallery+flow |
| `gallery/g1/26-s.jpg` | PM Dashboard | `pm.dashboard` | pm.jsx | PM | gallery+flow |
| `gallery/g1/27-s.jpg` | สัญญาบำรุงรักษา | `pm.contracts` | pm2.jsx | PM | flow |
| `gallery/g1/28-s.jpg` | แผน PM | `pm.schedule` | pm2.jsx | PM | gallery+flow |
| `gallery/g1/29-s.jpg` | ใบงาน PM | `pm.wo` | pm3.jsx | PM | gallery+flow |
| `gallery/g1/30-s.jpg` | ทะเบียนอุปกรณ์ | `pm.assets` | pm.jsx | PM | gallery+flow |

## g2 — การเงิน-บัญชี · ขาย · Master (47)

| ภาพ | จอ (label) | route | ไฟล์ .jsx | หมวด | แหล่ง map |
|---|---|---|---|---|---|
| `gallery/g2/01-s.jpg` | จัดสรรต้นทุน | `alloc` | petty-alloc.jsx | การเงิน | gallery+flow |
| `gallery/g2/02-s.jpg` | JV บันทึกรายการมือ | `gl.jv` | gl.jsx | การเงิน | gallery+flow |
| `gallery/g2/03-s.jpg` | GL Posting Inbox | `gl.inbox` | gl.jsx | การเงิน | gallery+flow |
| `gallery/g2/04-s.jpg` | งบทดลอง | `gl.trial` | gl.jsx | การเงิน | gallery+flow |
| `gallery/g2/05-s.jpg` | งบการเงิน | `gl.statements` | gl.jsx | การเงิน | gallery+flow |
| `gallery/g2/06-s.jpg` | ปิดงวดบัญชี | `gl.close` | gl.jsx | การเงิน | gallery+flow |
| `gallery/g2/07-s.jpg` | ตั้งหนี้ (Billing) | `ap.billing` | ap.jsx | การเงิน | gallery+flow |
| `gallery/g2/08-s.jpg` | ใบสำคัญจ่าย (PV) | `ap.pv` | ap.jsx | การเงิน | gallery+flow |
| `gallery/g2/09-s.jpg` | ใบลด/เพิ่มหนี้ | `ap.cn-dn` | ap.jsx | การเงิน | gallery+flow |
| `gallery/g2/10-s.jpg` | มัดจำจ่าย | `ap.deposit` | ap.jsx | การเงิน | gallery+flow |
| `gallery/g2/11-s.jpg` | ใบแจ้งหนี้ / วางบิล | `ar.invoice` | ar.jsx | การเงิน | gallery+flow |
| `gallery/g2/12-s.jpg` | ใบกำกับ / ใบเสร็จ | `ar.tax` | ar.jsx | การเงิน | gallery+flow |
| `gallery/g2/13-s.jpg` | ใบสำคัญรับ (RV) | `ar.rv` | ar.jsx | การเงิน | gallery+flow |
| `gallery/g2/14-s.jpg` | ทะเบียนเช็ค | `bank.cheque` | bank.jsx | การเงิน | gallery+flow |
| `gallery/g2/15-s.jpg` | กระทบยอดธนาคาร | `bank.recon` | bank.jsx | การเงิน | gallery+flow |
| `gallery/g2/16-s.jpg` | Export to Bank | `bank.export` | bank.jsx | การเงิน | gallery+flow |
| `gallery/g2/17-s.jpg` | ภ.พ.30 (VAT) | `tax.vat` | tax.jsx | การเงิน | gallery+flow |
| `gallery/g2/18-s.jpg` | ภ.ง.ด.3/53 (WHT) | `tax.wht` | tax-forms.jsx | การเงิน | gallery+flow |
| `gallery/g2/19-s.jpg` | ทะเบียนสินทรัพย์ | `fa.register` | fa.jsx | การเงิน | gallery+flow |
| `gallery/g2/20-s.jpg` | ค่าเสื่อมราคา | `fa.depr` | fa.jsx | การเงิน | gallery+flow |
| `gallery/g2/21-s.jpg` | ปรับมูลค่า / Write-Off | `fa.adjust` | fa.jsx | การเงิน | gallery+flow |
| `gallery/g2/22-s.jpg` | Sales Dashboard | `sales.dashboard` | sales-crm.jsx | ขาย | gallery+flow |
| `gallery/g2/23-s.jpg` | CRM / Leads | `sales.crm` | sales-crm.jsx | ขาย | gallery+flow |
| `gallery/g2/24-s.jpg` | ขายยูนิต (Quote/จอง/สัญญา) | `sales.process` | sales-process.jsx | ขาย | gallery+flow |
| `gallery/g2/25-s.jpg` | งวดดาวน์ | `sales.down` | sales-process.jsx | ขาย | gallery+flow |
| `gallery/g2/26-s.jpg` | สินเชื่อ & โอน | `sales.loan` | sales-process.jsx | ขาย | gallery+flow |
| `gallery/g2/27-s.jpg` | After-Sales · แจ้งซ่อม | `sales.service` | sales-service.jsx | ขาย | gallery+flow |
| `gallery/g2/28-s.jpg` | Company / Org | `master.company` | master.jsx | Master | gallery+flow |
| `gallery/g2/29-s.jpg` | ประเภทโครงการ | `master.ptype` | project-type-screen.jsx | Master | gallery+flow |
| `gallery/g2/30-s.jpg` | ผู้ขาย (Vendor) | `master.vendor` | master-party.jsx | Master | gallery+flow |
| `gallery/g2/31-s.jpg` | ลูกค้า (Customer) | `master.customer` | master-party.jsx | Master | gallery+flow |
| `gallery/g2/32-s.jpg` | Project/Phase/Block/Unit | `master.project` | master.jsx | Master | gallery+flow |
| `gallery/g2/33-s.jpg` | Model / แบบบ้าน | `master.model` | master.jsx | Master | gallery+flow |
| `gallery/g2/34-s.jpg` | Cost Center | `master.cc` | master.jsx | Master | gallery+flow |
| `gallery/g2/35-s.jpg` | Document Numbering | `master.docnum` | master.jsx | Master | gallery+flow |
| `gallery/g2/36-s.jpg` | ผู้ใช้ & สิทธิ์ | `users` | master.jsx | แกนระบบ | gallery+flow |
| `gallery/g2/37-s.jpg` | บันทึกการใช้งาน (Audit) | `audit` | exec-audit.jsx | แกนระบบ | gallery+flow |
| `gallery/g2/38-s.jpg` | แพ็กเกจของฉัน | `sub.mine` | subscription.jsx | Subscription | gallery+flow |
| `gallery/g2/39-s.jpg` | แพ็กเกจ & ราคา | `sub.plans` | subscription.jsx | Subscription | gallery+flow |
| `gallery/g2/40-s.jpg` | บิล & ใบเสร็จ | `sub.billing` | subscription.jsx | Subscription | gallery+flow |
| `gallery/g2/41-s.jpg` | Platform · ภาพรวมรายได้ | `admin.overview` | subscription-admin.jsx | Platform | gallery+flow |
| `gallery/g2/42-s.jpg` | Platform · จัดการผู้สมัคร | `admin.subs` | subscription-admin.jsx | Platform | gallery+flow |
| `gallery/g2/43-s.jpg` | Platform · จัดการแพ็กเกจ | `admin.plans` | subscription-admin.jsx | Platform | gallery+flow |
| `gallery/g2/44-s.jpg` | Platform · ใบแจ้งหนี้ | `admin.invoices` | subscription-admin.jsx | Platform | gallery+flow |
| `gallery/g2/45-s.jpg` | Mobile Approval | `mobile` | mobile-preview.jsx | Mobile/LINE | gallery+flow |
| `gallery/g2/46-s.jpg` | LINE OA · ลูกบ้าน | `line` | line-oa.jsx | Mobile/LINE | gallery+flow |
| `gallery/g2/47-s.jpg` | Sync SAP / REM | `sync` | chrome.jsx | แกนระบบ | gallery+flow |

## g3 — Subscription · Platform Admin (5)

| ภาพ | จอ (label) | route | ไฟล์ .jsx | หมวด | แหล่ง map |
|---|---|---|---|---|---|
| `gallery/g3/01-s.jpg` | Monitoring · O&M | `solar.monitor` | solar.jsx | Solar | gallery+flow |
| `gallery/g3/02-s.jpg` | ขายไฟ / PPA | `solar.ppa` | solar.jsx | Solar | gallery+flow |
| `gallery/g3/03-s.jpg` | ROI & ผลตอบแทน | `solar.roi` | solar.jsx | Solar | gallery+flow |
| `gallery/g3/04-s.jpg` | ขออนุญาต (PEA/MEA/COD) | `solar.permit` | solar.jsx | Solar | gallery+flow |
| `gallery/g3/05-s.jpg` | Warranty / รับประกัน | `solar.warranty` | solar.jsx | Solar | gallery+flow |

## g4 — เพิ่มใหม่ ก.ค. 69: Login · Reports · Settings · Notifications (4)

| ภาพ | จอ (label) | route | ไฟล์ .jsx | หมวด | แหล่ง map |
|---|---|---|---|---|---|
| `gallery/g4/01-s.jpg` | เข้าสู่ระบบ (Login/Auth) | `login` | extra-screens.jsx | แกนระบบ · เพิ่มใหม่ | flow |
| `gallery/g4/02-s.jpg` | ศูนย์รายงาน (Reports Hub) | `reports` | extra-screens.jsx | แกนระบบ · เพิ่มใหม่ | flow |
| `gallery/g4/03-s.jpg` | ตั้งค่าระบบ / โปรไฟล์บริษัท | `settings` | extra-screens.jsx | แกนระบบ · เพิ่มใหม่ | flow |
| `gallery/g4/04-s.jpg` | ศูนย์การแจ้งเตือน (Notifications) | `notifications` | extra-screens.jsx | แกนระบบ · เพิ่มใหม่ | flow |

## g5 — Solar EPC · PM · Mobile/LINE · อื่น ๆ (20)

| ภาพ | จอ (label) | route | ไฟล์ .jsx | หมวด | แหล่ง map |
|---|---|---|---|---|---|
| `gallery/g5/01-s.jpg` | ผู้รับเหมา · Progress รวม | `subcon.progress` | — | — | gallery |
| `gallery/g5/02-s.jpg` | ทะเบียนสัญญาผู้รับเหมา | `subcon.contracts` | — | — | gallery |
| `gallery/g5/03-s.jpg` | ศูนย์ตรวจรับ (ทุกประเภท) | `accept` | — | — | gallery |
| `gallery/g5/04-s.jpg` | ทะเบียนคนงาน (HR ค่าแรง) | `labor.workers` | — | — | gallery |
| `gallery/g5/05-s.jpg` | เช็คชื่อรายวัน | `labor.attendance` | — | — | gallery |
| `gallery/g5/06-s.jpg` | สรุปค่าแรง & ลงต้นทุน | `labor.payroll` | — | — | gallery |
| `gallery/g5/07-s.jpg` | งบ OPEX บริษัท | `opex` | — | — | gallery |
| `gallery/g5/08-s.jpg` | ผังบัญชี (COA) | `gl.coa` | — | — | gallery |
| `gallery/g5/09-s.jpg` | รับรู้รายได้ & WIP | `gl.revrec` | — | — | gallery |
| `gallery/g5/10-s.jpg` | งบกระแสเงินสด | `gl.cashflow` | — | — | gallery |
| `gallery/g5/11-s.jpg` | P&L รายโครงการ | `gl.projectpl` | — | — | gallery |
| `gallery/g5/12-s.jpg` | เงินประกันผลงาน (Retention) | `ap.retention` | — | — | gallery |
| `gallery/g5/13-s.jpg` | รายงานอายุหนี้ AP | `ap.aging` | — | — | gallery |
| `gallery/g5/14-s.jpg` | ใบลดหนี้ (AR Credit Note) | `ar.cn` | — | — | gallery |
| `gallery/g5/15-s.jpg` | รายงานอายุหนี้ AR | `ar.aging` | — | — | gallery |
| `gallery/g5/16-s.jpg` | e-Tax Invoice | `tax.etax` | — | — | gallery |
| `gallery/g5/17-s.jpg` | ศูนย์รายงาน (Reports Hub) | `reports` | — | — | gallery |
| `gallery/g5/18-s.jpg` | ศูนย์เอกสาร (DMS) | `dms` | — | — | gallery |
| `gallery/g5/19-s.jpg` | ตั้งค่าระบบ | `settings` | — | — | gallery |
| `gallery/g5/20-s.jpg` | สัญญาบำรุงรักษา | `pm.contracts` | — | — | gallery |

---

## shots/ — ภาพ working-capture (.png)

> `pototype/shots/` ไม่มี caption ใน HTML ต้นทาง — map ด้านล่างถอดจาก**ชื่อไฟล์** cross-check `NAV-ROUTES.md`  
> ภาพเหล่านี้เป็น dev capture ระหว่างทำ (หลาย step ของจอเดียว) ไม่ใช่ 1 ภาพ = 1 route เสมอ — visual gate ให้ยึด `gallery/` เป็นเกณฑ์หลัก · แถวที่ route ยังไม่ชัด = ตรวจกับ gallery ก่อนใช้

| ภาพ | route (จากชื่อไฟล์) | จอ / หมายเหตุ | ไฟล์ .jsx | ความมั่นใจ |
|---|---|---|---|---|
| `shots/01-land-rest.png` | `land.*` | งานที่ดิน (working capture) | land2.jsx | กลาง (module ชัด route ย่อยต้องยืนยัน) |
| `shots/01-pm-c-detail.png` | `pm.contracts` | สัญญาบำรุงรักษา (detail) | pm2.jsx | สูง |
| `shots/01-pm-c-wizard.png` | `pm.contracts` | สัญญาบำรุงรักษา (wizard) | pm2.jsx | สูง |
| `shots/01-pm-manual-final.png` | `pm.*` | PM manual entry (final) | pm3.jsx | กลาง (module ชัด route ย่อยต้องยืนยัน) |
| `shots/01-pm-manual.png` | `pm.*` | PM manual entry (working capture) | pm3.jsx | กลาง (module ชัด route ย่อยต้องยืนยัน) |
| `shots/01-pm-manual3.png` | `pm.*` | PM manual entry (working capture) | pm3.jsx | กลาง (module ชัด route ย่อยต้องยืนยัน) |
| `shots/01-ptype-modal.png` | `master.ptype` | ประเภทโครงการ (modal) | project-type-screen.jsx | สูง |
| `shots/02-land-rest.png` | `land.*` | งานที่ดิน (working capture) | land2.jsx | กลาง (module ชัด route ย่อยต้องยืนยัน) |
| `shots/02-pm-c-detail.png` | `pm.contracts` | สัญญาบำรุงรักษา (detail) | pm2.jsx | สูง |
| `shots/02-pm-c-wizard.png` | `pm.contracts` | สัญญาบำรุงรักษา (wizard) | pm2.jsx | สูง |
| `shots/02-pm-manual-final.png` | `pm.*` | PM manual entry (final) | pm3.jsx | กลาง (module ชัด route ย่อยต้องยืนยัน) |
| `shots/02-pm-manual.png` | `pm.*` | PM manual entry (working capture) | pm3.jsx | กลาง (module ชัด route ย่อยต้องยืนยัน) |
| `shots/02-pm-manual3.png` | `pm.*` | PM manual entry (working capture) | pm3.jsx | กลาง (module ชัด route ย่อยต้องยืนยัน) |
| `shots/02-ptype-modal.png` | `master.ptype` | ประเภทโครงการ (modal) | project-type-screen.jsx | สูง |
| `shots/03-land-rest.png` | `land.*` | งานที่ดิน (working capture) | land2.jsx | กลาง (module ชัด route ย่อยต้องยืนยัน) |
| `shots/03-pm-manual-final.png` | `pm.*` | PM manual entry (final) | pm3.jsx | กลาง (module ชัด route ย่อยต้องยืนยัน) |
| `shots/land-pipeline.png` | `land.pipeline` | Pipeline จัดหาที่ดิน | land.jsx | สูง |
| `shots/pm-contract-step1.png` | `pm.contracts` | สัญญาบำรุงรักษา (step 1) | pm2.jsx | สูง |
| `shots/pm-dash.png` | `pm.dashboard` | PM Dashboard | pm.jsx | สูง |
| `shots/pm-grouped.png` | `pm.*` | PM · บำรุงรักษา (grouped view) | pm.jsx | กลาง (module ชัด route ย่อยต้องยืนยัน) |
| `shots/pm-manual2.png` | `pm.*` | PM manual entry (working capture) | pm3.jsx | กลาง (module ชัด route ย่อยต้องยืนยัน) |
| `shots/pm-manual4.png` | `pm.*` | PM manual entry (working capture) | pm3.jsx | กลาง (module ชัด route ย่อยต้องยืนยัน) |

---

## หมายเหตุการตรวจสอบ (P0-QA-01)

- ✅ นับไฟล์บนดิสก์: **106 .jpg** (g1:30 · g2:47 · g3:5 · g4:4 · g5:20) + **22 .png** = ตรงเกณฑ์ B-001 / task row

- ✅ index ครอบคลุมทุกภาพ: 106 + 22 = 128 แถว

- gallery ทั้ง 106 ภาพ map ได้จากแหล่ง caption ต้นทาง (flow manual + gallery HTML) ยืนยันกับ NAV-ROUTES.md

- shots 22 ภาพเป็น working-capture ไม่มี caption ต้นทาง → map จากชื่อไฟล์ (โปร่งใส ระบุความมั่นใจต่อแถว)


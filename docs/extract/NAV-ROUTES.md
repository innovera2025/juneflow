# NAV-ROUTES — โครงเมนู & Route ทั้งหมด

ถอดจากโค้ดจริง: `pototype/chrome.jsx` (const `NAV`, `ROUTE_LABELS`, `PARENT_ID_OF_ROUTE`) และ `pototype/shell.jsx` (`RouteView`) — ไฟล์ component ยืนยันด้วยการค้นหาตำแหน่งประกาศ component ในทุกไฟล์ .jsx

- Route เริ่มต้น: `dashboard` (จาก `useState(persisted.route || "dashboard")` ใน shell.jsx)
- Route ที่ไม่มีใน `RouteView` → render `Placeholder` ("หน้านี้ยังไม่ได้สร้าง")
- Sidebar กรองเมนูด้วย 3 เงื่อนไข: `viewMode` (tenant/platform), `moduleOn(n.mod)` (ตามประเภทโครงการ), `pkgMenuAllowed(id)` / `pkgSubMenuAllowed(id)` (ตามแพ็กเกจ)
- หมวด "ผู้ดูแลแพลตฟอร์ม" แสดงเฉพาะ viewMode = `platform`; เมนูอื่นแสดงเฉพาะ `tenant` (ยกเว้น `dashboard`)

## ตาราง Route ทั้งหมด (จากเมนู Sidebar)

| route id | ชื่อเมนู | parent | component | ไฟล์ |
|---|---|---|---|---|
| `dashboard` | Dashboard | — | `Dashboard` | dashboard.jsx |
| `exec` | ภาพรวมผู้บริหาร | — | `ExecDashboard` | exec-audit.jsx |
| **§ งานหลัก** | | | | |
| `land.pipeline` | Pipeline จัดหาที่ดิน | land (mod: `land`) | `LandPipeline` | land.jsx |
| `land.bank` | ทะเบียนแปลงที่ดิน | land | `LandBank` | land.jsx |
| `land.survey` | สำรวจ-รังวัด & Feasibility | land | `LandSurvey` | land2.jsx |
| `land.dd` | Due Diligence & ซื้อ/เช่า | land | `LandDueDiligence` | land2.jsx |
| `boq.overview` | BOQ Overview | boq (mod: `boq`, badge 4) | `BOQOverview` | boq.jsx |
| `boq.list` | BOQ List | boq | `BOQList` | boq-list.jsx |
| `boq.aiqto` | นำเข้า CAD/BIM (AI ถอด BOQ) | boq | `AIQuantityTakeoff` | ai-qto.jsx |
| `boq.bom` | BOM (สูตรต่อหลัง) | boq | `BOMTemplates` | bom.jsx |
| `boq.editor` | BOQ Editor | boq | `BOQEditor` | boq.jsx |
| `boq.approval` | อนุมัติ BOQ (badge 4) | boq | `BOQApproval` | boq.jsx |
| `boq.archive` | Archive | boq | `BOQArchive` | boq.jsx |
| `boq.reports` | รายงาน BOQ | boq | `BOQReports` | boq.jsx |
| `pr.list` | ใบขอซื้อ (PR) (badge 17) | proc (mod: `proc`) | `PRList` | pr-list.jsx |
| `po.list` | ใบสั่งซื้อ (PO) | proc | `POList` | po-wo.jsx |
| `wo.list` | ใบสั่งจ้าง (WO) | proc | `WOList` | po-wo.jsx |
| `gr.list` | รับสินค้า (GR) | proc | `GRList` | gr.jsx |
| `subcon.progress` | Progress รวม | subcon (mod: `subcon`) | `SubconProgress` | subcon.jsx |
| `subcon.contracts` | ทะเบียนสัญญา | subcon | `SubconContracts` | subcon-accept.jsx |
| `timeline` | แผนงานโครงการ (mod: `timeline`) | — | `ProjectTimeline` | timeline.jsx |
| `inv.items` | Item Master | inv (mod: `inv`) | `InventoryItems` | inventory.jsx |
| `inv.stock` | Stock & คลัง | inv | `InventoryStock` | inventory.jsx |
| `inv.transfer` | โอนคลัง | inv | `InventoryTransfer` | inventory.jsx |
| `inv.issue` | เบิกออก | inv | `InventoryIssue` | inventory.jsx |
| `petty` | เงินสดย่อย (mod: `petty`) | — | `PettyCash` | petty-alloc.jsx |
| `accept` | ศูนย์ตรวจรับ (badge 8) | — | `AcceptanceCenter` | company-accept.jsx |
| `labor.attendance` | เช็คชื่อรายวัน | labor | `LaborAttendance` | labor.jsx |
| `labor.payroll` | สรุปค่าแรง & ลงต้นทุน | labor | `LaborPayroll` | labor.jsx |
| `labor.workers` | ทะเบียนคนงาน | labor | `LaborWorkers` | labor.jsx |
| `pm.dashboard` | PM Dashboard | pm (mod: `pm`) | `PMDashboard` | pm.jsx |
| `pm.contracts` | สัญญาบำรุงรักษา | pm | `PMContracts` | pm2.jsx |
| `pm.schedule` | แผน PM | pm | `PMSchedule` | pm2.jsx |
| `pm.wo` | ใบงาน PM (badge 6) | pm | `PMWorkOrders` | pm3.jsx |
| `pm.assets` | ทะเบียนอุปกรณ์ | pm | `PMAssets` | pm.jsx |
| **§ พลังงาน · EPC** (mod: `solar_sec`) | | | | |
| `solar.monitor` | Monitoring · O&M (mod: `om`) | — | `SolarMonitoring` | solar.jsx |
| `solar.ppa` | ขายไฟ / PPA (mod: `ppa`) | — | `SolarPPA` | solar.jsx |
| `solar.roi` | ROI & ผลตอบแทน (mod: `roi`) | — | `SolarROI` | solar.jsx |
| `solar.permit` | ขออนุญาต (PEA/MEA/COD) (mod: `permit`) | — | `SolarPermit` | solar.jsx |
| `solar.warranty` | Warranty / รับประกัน (mod: `warranty`) | — | `SolarWarranty` | solar.jsx |
| **§ บัญชี-การเงิน** | | | | |
| `alloc` | จัดสรรต้นทุน | — | `AllocateCost` | petty-alloc.jsx |
| `opex` | งบ OPEX บริษัท | — | `OpexBudget` | opex-budget.jsx |
| `gl.coa` | ผังบัญชี (COA) | gl | `GLChartOfAccounts` | accounting-extra.jsx |
| `gl.jv` | JV · บันทึกรายการมือ | gl | `GLJournalVoucher` | gl.jsx |
| `gl.inbox` | GL Posting Inbox (badge 8) | gl | `GLPostingInbox` | gl.jsx |
| `gl.trial` | งบทดลอง | gl | `GLTrialBalance` | gl.jsx |
| `gl.statements` | งบดุล + กำไรขาดทุน | gl | `GLStatements` | gl.jsx |
| `gl.revrec` | รับรู้รายได้ & WIP | gl | `GLRevenueWIP` | accounting-extra.jsx |
| `gl.cashflow` | งบกระแสเงินสด | gl | `GLCashFlow` | accounting-extra2.jsx |
| `gl.projectpl` | P&L รายโครงการ | gl | `GLProjectPL` | accounting-extra2.jsx |
| `gl.close` | ปิดงวดบัญชี | gl | `GLPeriodClose` | gl.jsx |
| `ap.billing` | ตั้งหนี้ (Billing) | ap | `APBilling` | ap.jsx |
| `ap.pv` | ใบสำคัญจ่าย (PV) | ap | `APPaymentVoucher` | ap.jsx |
| `ap.cn-dn` | ใบลดหนี้ / เพิ่มหนี้ | ap | `APCreditDebit` | ap.jsx |
| `ap.deposit` | มัดจำจ่าย | ap | `APDeposit` | ap.jsx |
| `ap.retention` | เงินประกันผลงาน (Retention) | ap | `APRetention` | accounting-extra2.jsx |
| `ap.aging` | อายุหนี้ (Aging) | ap | `FinAging` (side="ap") | accounting-extra.jsx |
| `ar.invoice` | ใบแจ้งหนี้ / วางบิล | ar | `ARInvoice` | ar.jsx |
| `ar.tax` | ใบกำกับ / ใบเสร็จ | ar | `ARTaxInvoice` | ar.jsx |
| `ar.rv` | ใบสำคัญรับ (RV) | ar | `ARReceiveVoucher` | ar.jsx |
| `ar.cn` | ใบลดหนี้ (Credit Note) | ar | `ARCreditNote` | accounting-extra2.jsx |
| `ar.aging` | อายุหนี้ (Aging) | ar | `FinAging` (side="ar") | accounting-extra.jsx |
| `bank.cheque` | ทะเบียนเช็ค | bank | `BankCheque` | bank.jsx |
| `bank.recon` | กระทบยอดธนาคาร | bank | `BankReconciliation` | bank.jsx |
| `bank.export` | Export to Bank | bank | `BankExport` | bank.jsx |
| `tax.vat` | ภ.พ.30 (VAT) | tax | `TaxVAT` | tax.jsx |
| `tax.wht` | ภ.ง.ด.3 / 53 (WHT) | tax | `TaxWHT` | tax.jsx |
| `tax.etax` | e-Tax Invoice | tax | `TaxETax` | etax.jsx |
| `fa.register` | ทะเบียนสินทรัพย์ | fa | `FARegister` | fa.jsx |
| `fa.depr` | ค่าเสื่อมราคา | fa | `FADepreciation` | fa.jsx |
| `fa.adjust` | ปรับมูลค่า / Write-Off | fa | `FAAdjust` | fa.jsx |
| **§ งานขาย-อสังหาฯ** (mod: `sales_sec`) | | | | |
| `sales.dashboard` | Sales Dashboard | sales (mod: `sales_re`, badge 5) | `SalesDashboard` | sales-crm.jsx |
| `sales.crm` | CRM / Leads (badge 12) | sales | `SalesCRM` | sales-crm.jsx |
| `sales.process` | ขายยูนิต (Quote/จอง/สัญญา) | sales | `SalesProcess` | sales-process.jsx |
| `sales.down` | งวดดาวน์ | sales | `SalesDown` | sales-process.jsx |
| `sales.loan` | สินเชื่อ & โอน | sales | `SalesLoan` | sales-process.jsx |
| `sales.service` | After-Sales · แจ้งซ่อม (badge 5) | sales | `AfterSalesService` | sales-service.jsx |
| **§ ระบบ** | | | | |
| `master.company` | Company / Org | master | `MasterCompany` | master.jsx |
| `master.ptype` | ประเภทโครงการ (Project Type) | master | `MasterProjectType` | project-type-screen.jsx |
| `master.vendor` | ผู้ขาย / ผู้รับเหมา | master | `MasterVendor` | master-party.jsx |
| `master.customer` | ลูกค้า (Customer) | master | `MasterCustomer` | master-party.jsx |
| `master.project` | Project / Phase / Block / Unit | master | `MasterProject` | master.jsx |
| `master.model` | Model / แบบบ้าน | master | `MasterModel` | master.jsx |
| `master.cc` | Cost Center | master | `MasterCC` | master.jsx |
| `master.docnum` | Document Numbering | master | `MasterDocNum` | master.jsx |
| `users` | ผู้ใช้ & สิทธิ์ | — | `UsersPermissions` | master.jsx |
| `reports` | ศูนย์รายงาน | — | `ReportsHub` | extra-screens.jsx |
| `dms` | ศูนย์เอกสาร (DMS) | — | `DMSCenter` | dms.jsx |
| `settings` | ตั้งค่าระบบ | — | `SettingsCompany` | extra-screens.jsx |
| `audit` | บันทึกการใช้งาน | — | `AuditLog` | exec-audit.jsx |
| **§ บัญชีการใช้งาน** | | | | |
| `sub.mine` | แพ็กเกจของฉัน | sub | `SubMine` | subscription.jsx |
| `sub.plans` | แพ็กเกจ & ราคา | sub | `SubPlans` | subscription.jsx |
| `sub.billing` | บิล & ใบเสร็จ | sub | `SubBilling` | subscription.jsx |
| **§ ผู้ดูแลแพลตฟอร์ม** (แสดงเฉพาะ viewMode=platform) | | | | |
| `admin.overview` | ภาพรวมรายได้ | admin | `AdminOverview` | subscription-admin.jsx |
| `admin.subs` | จัดการผู้สมัคร | admin | `AdminSubscribers` | subscription-admin.jsx |
| `admin.plans` | จัดการแพ็กเกจ | admin | `AdminPlans` | subscription-admin.jsx |
| `admin.invoices` | ใบแจ้งหนี้ | admin | `AdminInvoices` | subscription-admin.jsx |
| `mobile` | Mobile Approval | — | `MobilePreview` | mobile-preview.jsx |
| `line` | LINE OA · ลูกบ้าน (mod: `lineoa`) | — | `LineOAPreview` | line-oa.jsx |
| `sync` | Sync SAP / REM | — | `SyncStatus` | master.jsx |

## Route ที่มีใน RouteView / ROUTE_LABELS แต่ไม่มีในเมนู Sidebar

| route id | label (ROUTE_LABELS) | component | ไฟล์ | เข้าถึงจาก |
|---|---|---|---|---|
| `pr.form` | PR · ฟอร์ม | `PRForm` | pr-form.jsx | navigate ภายใน (PR list, notifications) |
| `po.form` | PO · ฟอร์ม | `POForm` | po-wo.jsx | navigate ภายใน |
| `wo.form` | WO · ฟอร์ม | `WOForm` | po-wo.jsx | navigate ภายใน |
| `subcon` | Progress Subcontractor | `SubconProgress` | subcon.jsx | route id ซ้ำกับ `subcon.progress` |
| `subcon.accept` | งวดงาน & ตรวจรับ | `SubconAccept` | subcon-accept2.jsx | navigate ภายใน |
| `subcon.handover` | เอกสารส่งมอบงาน | `SubconHandover` | subcon-accept2.jsx | navigate ภายใน |
| `notifications` | การแจ้งเตือน | `NotificationsCenter` | extra-screens.jsx | ปุ่ม "ดูการแจ้งเตือนทั้งหมด" |
| `login` | เข้าสู่ระบบ | `ScreenLogin` | extra-screens.jsx | user menu "ออกจากระบบ" (render ก่อน shell) |
| `fin.ap` | (legacy redirect) | `APBilling` | ap.jsx | comment ในโค้ด: "Legacy fin.* routes redirect" |
| `fin.ar` | (legacy redirect) | `ARInvoice` | ar.jsx | " |
| `fin.gl` | (legacy redirect) | `GLJournalVoucher` | gl.jsx | " |

## กติกา parent (PARENT_ID_OF_ROUTE ใน chrome.jsx)

prefix → parent: `sub.*`→sub, `admin.*`→admin, `land.*`→land, `labor.*`→labor, `pm.*`→pm, `subcon.*`→subcon, `boq.*`→boq, `pr.*`/`po.*`/`wo.*`/`gr.*`→proc, `inv.*`→inv, `gl.*`→gl, `ap.*`→ap, `ar.*`→ar, `bank.*`→bank, `tax.*`→tax, `fa.*`→fa, `sales.*`→sales, `master.*`→master; อื่น ๆ → ตัวมันเอง

## ข้อสังเกตตามโค้ด (ไม่ตีความ)

- `ROUTE_LABELS` ไม่มี key `boq.bom` ทั้งที่เมนูและ RouteView มี route นี้
- ป้าย `boq.approval` ใน NAV = "อนุมัติ BOQ" แต่ใน ROUTE_LABELS = "อนุมัติ BOM/BOQ"
- badge เป็นตัวเลข hardcode ใน NAV: boq=4, boq.approval=4, pr.list=17, accept=8, pm.wo=6, gl.inbox=8, sales=5, sales.crm=12, sales.service=5
- `chrome.jsx` ประกาศ `window.ROUTE_PARENT = {}` (object ว่าง) ตอน export
- คลิกเมนู parent ที่มี sub จะ navigate ไป sub ตัวแรกอัตโนมัติ (`onNavigate?.(n.sub[0].id)`)
- เปลี่ยนโครงการแล้ว route ปัจจุบันไม่ผ่าน `routeAllowedForProject` → เด้งกลับ `dashboard` (shell.jsx `setTweak`)

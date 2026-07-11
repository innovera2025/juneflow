# INVENTORY.md — บัญชีไฟล์ทั้งหมดของ juneflow prototype

> สร้างเมื่อ 6 ก.ค. 2026 · สแกนจากโฟลเดอร์ `juneflow/` (ไม่รวม `.git`, `.DS_Store`, `*.thumbnail`)
> คอลัมน์ "หน้าที่" ถอดจากคอมเมนต์หัวไฟล์ / `<title>` / โค้ดจริงเท่านั้น — ไม่ตีความเพิ่ม
> ขนาดเป็น **ไบต์ (bytes)** ตามจริงจาก `ls -l` · โฟลเดอร์รูปสรุปเป็น 1 แถวต่อโฟลเดอร์ (ขนาดเป็น KB จาก `du -sk`)

**สรุปจำนวน:** ไฟล์ทั้งหมด 296 ไฟล์ = pototype root 101 (jsx 78 · js 2 · css 2 · html 18 · png 1) + `wat/` 15 + `handoff/` 9 + โฟลเดอร์รูป 159 + `design_handoff_juneflow/` 12

---

## 1) ไฟล์ระดับราก (root)

ไม่มีไฟล์ระดับรากของ `juneflow/` — รากมีเพียง 2 โฟลเดอร์คือ `pototype/` และ `design_handoff_juneflow/`

---

## 2) pototype/ — ไฟล์ .jsx (78 ไฟล์)

โมดูล/หน้าที่ถอดจากคอมเมนต์บรรทัดแรกของแต่ละไฟล์ และ `window.*` ที่ไฟล์ประกาศ

| ไฟล์ | ขนาด (bytes) | โมดูล / หน้าที่ (ตามคอมเมนต์หัวไฟล์) |
|---|---:|---|
| pototype/accounting-extra.jsx | 40,409 | Accounting Extra — (1) ผังบัญชี COA (2) AR/AP Aging (3) รับรู้รายได้+WIP · ใช้ global Page/Card/Btn/Icon/Field/Dropdown/th/td/fmt |
| pototype/accounting-extra2.jsx | 41,105 | Accounting Extra 2 — (4) Retention (5) AR Credit Note (6) งบกระแสเงินสด |
| pototype/ai-qto-fullscreen.jsx | 18,909 | BIM Fullscreen Viewer — large-model overlay สำหรับ AI QTO · pan/zoom/fit · layers · floor select · minimap · 3D/2D · element linking + side element list/search/filters · mock geometry |
| pototype/ai-qto-viewer.jsx | 13,634 | BIM Viewer — lightweight SVG isometric / 2D-plan model preview · mock geometry ผูกกับ QTO row ids (e1..e10) เพื่อ bidirectional linking |
| pototype/ai-qto.jsx | 29,067 | AI Quantity Take-Off — นำเข้า CAD/BIM → ถอด BOQ อัตโนมัติ (mock/preview) · 4-step wizard → ส่งผลเข้าโมดูล BOQ |
| pototype/ap.jsx | 39,932 | AP — Accounts Payable: Billing, Payment Voucher (PV), CN/DN, Deposit |
| pototype/app.jsx | 119 | App entry — single-page application · `ReactDOM.createRoot(...).render(<AppShell/>)` |
| pototype/ar.jsx | 24,321 | AR — Accounts Receivable: Invoice/Billing, Tax Invoice/Receipt, Receive Voucher |
| pototype/bank.jsx | 18,512 | Bank — Cheque Register, Bank Reconciliation, Export to Bank |
| pototype/bom.jsx | 17,399 | BOM — Bill of Materials (สูตรวัสดุ-แรงงานต่อ 1 หลัง ต่อแบบบ้าน/Model) · ต้นทางของ BOQ: BOQ ของบล็อก = BOM ต่อหลัง × จำนวนยูนิต |
| pototype/boq-extra.jsx | 35,456 | BOQ Extra — PR generation, Revise workflow, Budget Control, Audit drawer, extended reports (M/S/L, Variance, EVM) · ใช้ ctx.openModal |
| pototype/boq-list.jsx | 34,068 | BOQ List + flow "สร้าง BOQ ใหม่" · shared store ให้เอกสาร BOQ ที่สร้างโผล่ในลิสต์และเปิดใน editor |
| pototype/boq.jsx | 138,081 | BOQ Module — 5 screens |
| pototype/charts.jsx | 2,778 | Chart.js wrapper + theme-aware helpers |
| pototype/chrome.jsx | 50,568 | App chrome: Sidebar + TopBar + ProjectSwitcher + SearchPalette + NotificationsPopover + UserMenu · ประกาศ `window.PROJECTS` `window.ProjectStore` `window.useProjects` |
| pototype/company-accept.jsx | 21,868 | Phase: (1) Multi-Company switcher (2) ศูนย์ตรวจรับรวม (Acceptance Center) |
| pototype/dashboard.jsx | 36,270 | Dashboard ภาพรวมโครงการ · Budget vs Actual chart (Chart.js) · ประกาศ `window.Dashboard` |
| pototype/datepicker.jsx | 7,591 | DatePicker + RangeSwitch — clickable, theme-aware |
| pototype/design-canvas.jsx | 49,677 | DesignCanvas — Figma-ish design canvas wrapper · warm gray grid bg + Sections + Artboards + PostIt notes · artboards reorderable/deletable |
| pototype/dms.jsx | 17,059 | ศูนย์เอกสาร (DMS) — Document Management: หมวด/เวอร์ชัน/หมดอายุ/ผูกโมดูล |
| pototype/ds.jsx | 25,928 | Design system primitives: icons, badges, buttons, helpers (fmt ฯลฯ) |
| pototype/etax.jsx | 12,771 | e-Tax Invoice & e-Receipt — ออกใบกำกับภาษีอิเล็กทรอนิกส์ ส่งกรมสรรพากร |
| pototype/exec-audit.jsx | 19,792 | Executive Dashboard (ภาพรวมผู้บริหาร) + Central Audit Log (บันทึกรวม) · cross-project, cross-module rollup |
| pototype/extra-screens.jsx | 23,876 | Missing production screens: Login/Auth · Reports hub · Settings/Company · Notifications center |
| pototype/fa.jsx | 60,408 | Fixed Asset — Register, Depreciation, Adjustments — fully wired |
| pototype/finance.jsx | 22,192 | Finance — AP, AR, GL |
| pototype/forms.jsx | 46,550 | Modal forms — PO, WO, GR + reusable confirm flows |
| pototype/gl.jsx | 54,627 | GL — General Ledger: JV, Posting Inbox, Trial Balance, Statements, Period Close |
| pototype/gr.jsx | 14,610 | Goods Receipt (รับสินค้า) |
| pototype/i18n-accounting.jsx | 26,113 | i18n — Accounting screens (COA / Aging / RevRec+WIP / Retention / CN / Cash Flow / Project P&L) — merge เข้า `window.PHRASES` + `window.NAV_I18N` |
| pototype/i18n-phrases.jsx | 14,559 | extended phrase dictionary (merge เข้า `window.PHRASES` ตอนโหลด) · domain vocabulary, units, categories, months, statuses |
| pototype/i18n-phrases3.jsx | 12,322 | i18n phrases batch 3: UI strings โมดูลที่เหลือ (PM, Land, Solar, BOQ, Master, Sales, finance) merge เข้า `window.PHRASES` |
| pototype/i18n.jsx | 68,311 | i18n — Thai / English / 中文 / العربية (RTL สำหรับ Arabic) · global store `window.I18N` · hook `useLang()` · translate `t("key")` |
| pototype/inventory.jsx | 47,047 | Inventory module — Items / Stock / Transfer / Issue |
| pototype/ios-frame.jsx | 15,755 | iOS 26 (Liquid Glass) device frame แบบ simplified · exports: IOSDevice, IOSStatusBar, IOSNavBar, IOSGlassPill, IOSList, IOSListRow, IOSKeyboard |
| pototype/labor.jsx | 21,822 | HR ไซต์งาน — ทะเบียนคนงาน · เช็คชื่อรายวัน · สรุปค่าแรง → ลงต้นทุนโครงการ |
| pototype/land.jsx | 28,474 | Land Acquisition & Survey — Pipeline, Land Bank, Survey/Feasibility, Due Diligence + Buy/Lease · เปิดใช้ทุก project type |
| pototype/land2.jsx | 35,021 | Land module — จอ Survey/Feasibility + Due Diligence/Buy-Lease |
| pototype/line-oa.jsx | 51,962 | LINE OA · ลูกบ้าน — Chat screens preview |
| pototype/line-pm.jsx | 10,341 | LINE OA · PM screens (ฝั่งลูกค้า, Maxtech) — plan/history, quote approval, PM certificate, contracts · reuse LineFrame/Bubble/CardBubble |
| pototype/linked-docs.jsx | 12,516 | Linked Documents — cross-doc deep linking · static mapping ของ BOQ codes ไปเอกสารที่เกี่ยวข้อง |
| pototype/master-party.jsx | 29,662 | Master · Vendor (ผู้ขาย/ผู้รับเหมา) + Customer (ลูกค้า) registries · central stores ที่ PR/PO/AP, Sales/AR, PM contracts, Land อ้างถึง · ประกาศ `window.VENDOR_SEED` `window.CUSTOMER_SEED` `window.customersFor` `window.vendorsBy` |
| pototype/master.jsx | 87,260 | Master Data + Users & Permissions + Sync (Company / Org) · ประกาศ `window.CC_SEED` `window.costCentersFor` |
| pototype/mobile-field.jsx | 17,769 | Mobile · F · สโตร์ & โฟร์แมน — รับของหน้าไซต์ (GR) + กรอก % งาน |
| pototype/mobile-pm.jsx | 21,668 | Mobile · E · งาน PM (ช่าง) — 5 screens (ฝั่ง engineer, Maxtech) · ใช้ MobileHeader / MSection / MField / MInput / MPill จาก mobile-screens |
| pototype/mobile-preview.jsx | 9,038 | Mobile Preview screen — full field app + after-sales + executive |
| pototype/mobile-screens.jsx | 56,139 | Mobile screens — Field app + After-Sales + Site + Safety + Executive + CRM |
| pototype/mobile.jsx | 36,102 | Mobile approval screens — แสดงใน iOS frame |
| pototype/modal.jsx | 5,444 | Modal / Dialog system (ขนาด sm/md/lg/xl/full) |
| pototype/opex-budget.jsx | 27,218 | งบประมาณบริหารประจำปี (Corporate OPEX Budget) — งบ vs จริง รายแผนก |
| pototype/petty-alloc.jsx | 29,966 | Petty Cash + Allocate Cost |
| pototype/pkg-builder.jsx | 22,597 | Package Builder — เจ้าของระบบสร้าง/แก้แพ็กเกจ S · M · L · Full · เลือกว่าแต่ละแพ็กเกจปล่อยเมนูไหนบ้างจากโครงเมนูจริง · ประกาศ `window.__tenantPkg` `window.__aiUsed` |
| pototype/pm-checklist.jsx | 14,126 | PM Checklist Templates — settings (create/edit named checklist sets) + picker แทรก items เข้า work order หลังสร้าง |
| pototype/pm.jsx | 26,590 | PM · Preventive Maintenance (CMMS) — data + Dashboard + Asset Registry · Maxtech-style lift service contracts + CMMS standard |
| pototype/pm2.jsx | 50,296 | PM module — Contracts, Schedule, Work Orders (Maxtech-style detail) |
| pototype/pm3.jsx | 24,903 | PM module — Work Orders list + Maxtech-style WO detail |
| pototype/po-wo.jsx | 33,398 | PO (ใบสั่งซื้อ) + WO (ใบสั่งจ้าง) modules |
| pototype/pr-form.jsx | 33,052 | PR Create / Edit form with approval flow · ประกาศ `window.PRForm` |
| pototype/pr-list.jsx | 18,789 | PR List screen (ประเภท วัสดุ/…) |
| pototype/project-type-screen.jsx | 14,179 | Master · Project Type screen + Add modal |
| pototype/project-types.jsx | 6,226 | Project Types — multi-domain support (real-estate / solar-EPC / civil / service) · กำหนด hierarchy (WBS), cost types, enabled modules ต่อ type |
| pototype/real-forms.jsx | 22,129 | Real Forms — แทน toast-only buttons กลุ่ม 1–4 (ธนาคาร/การเงิน/PR/ขาย) · helper กลาง: `window.openChequeForm / openBankImport / openReconcileConfirm / openPayForm / openReceiveForm / openBOQPick / openCustHistory / openPRItem` |
| pototype/real-forms2.jsx | 37,612 | Real Forms 2 — ฟอร์มรองที่เหลือ (subscription/FA/PO/solar/BOM/inventory/งวดงาน/แนบไฟล์/จับคู่ธนาคาร/เปรียบเทียบ vendor/ประวัติเอกสาร) |
| pototype/sales-crm.jsx | 31,258 | Sales Dashboard + CRM / Leads |
| pototype/sales-process.jsx | 47,340 | Sales Process · Down Payment · Loan & Transfer (Unit grid + Quote + Booking + Contract) |
| pototype/sales-service.jsx | 25,090 | After-Sales Service — Warranty + Service Requests |
| pototype/shell.jsx | 22,132 | App Shell — single-page routing + modal + tweaks · TWEAK_DEFAULTS · ประกาศ `window.__juneflowCtx` `window.__t` |
| pototype/solar.jsx | 23,145 | Solar / Energy EPC module screens — Monitoring/O&M, PPA, ROI, Permit, WTY · แสดงเฉพาะเมื่อ project type = "solar" |
| pototype/subcon-accept.jsx | 15,796 | Subcontractor Work Acceptance — Contracts · Progress&Acceptance · Handover · วิธีคิดงวด: by % / by distance-quantity (auto-calc) / by milestone |
| pototype/subcon-accept2.jsx | 30,276 | Subcon Page 2 — Progress & Acceptance (ตรวจรับงาน) + Page 3 Handover docs |
| pototype/subcon.jsx | 38,240 | Progress Subcontractor · ประกาศ `window.VENDOR_SEED` (มีในไฟล์นี้ด้วย) |
| pototype/subscription-admin.jsx | 31,858 | Subscription — Platform Admin console (รายได้ / ผู้สมัคร / แพ็กเกจ / ใบแจ้งหนี้) · ประกาศ `window.SUBSCRIBERS` |
| pototype/subscription-flow.jsx | 11,485 | Subscription flow — quota enforcement + signup/onboarding wizard |
| pototype/subscription.jsx | 17,457 | Subscription — data model + Tenant screens (แพ็กเกจ / โควต้า / ราคา / บิล) |
| pototype/tax-forms.jsx | 46,826 | แบบภาษีทางการไทย — ภ.พ.30, ภ.ง.ด.3/53, 50 ทวิ — v2 (accurate to RD originals) · FormPage = A4 white paper modal + print toolbar |
| pototype/tax.jsx | 14,148 | Tax — VAT (ภพ.30) and WHT (ภงด.3/53) Reports |
| pototype/timeline.jsx | 37,255 | Project Timeline + BOQ Import modal |
| pototype/tweaks-panel.jsx | 23,873 | Reusable Tweaks shell + form-control helpers |

## 3) pototype/ — ไฟล์ .js / .css / รูป ระดับราก

| ไฟล์ | ขนาด (bytes) | หน้าที่ (ตามคอมเมนต์หัวไฟล์) |
|---|---:|---|
| pototype/fiori-empty.js | 2,786 | Fiori skin — auto empty-state ทุกหน้า: ตรวจ `<tbody>` ที่ไม่มีแถวแล้วเติมแถว empty state สไตล์ Fiori · ทำงานระดับ DOM ไม่แตะโค้ดจอ · โหลดเฉพาะไฟล์ Fiori |
| pototype/fiori-loading.js | 1,829 | Fiori skin — loading/busy state ทุกหน้า (SAP busy indicator): แถบ progress บนสุด + skeleton ตอนเปลี่ยนหน้า · ประกาศ `window.__FIORI__` `window.__fioriBusy` |
| pototype/fiori-theme.css | 6,235 | Juneflow — Fiori Skin (สไตล์ C · Enterprise SAP Fiori) · เปลี่ยนเฉพาะ "ผิว" โครงเมนู/ฟังก์ชันเดิม · โหลดทับ styles.css |
| pototype/styles.css | 5,761 | juneflow — theme หลัก: Clean / Minimal / Premium · emerald-teal on warm neutral |
| pototype/font-check.png | 64,929 | ไฟล์ภาพ PNG (ชื่อไฟล์ font-check) |

## 4) pototype/ — ไฟล์ .html (18 ไฟล์)

| ไฟล์ | ขนาด (bytes) | หน้าที่ (ตาม `<title>` และโครงไฟล์) |
|---|---:|---|
| pototype/index.html | 6,309 | หน้า entry หลักของ prototype — title "juneflow — UI/UX Design" · โหลด React 18.3.1 + ReactDOM + Babel standalone + Chart.js จาก CDN แล้วโหลดไฟล์ .jsx ทั้งหมด (รวม 81 `src=` เริ่มจาก design-canvas.jsx, ios-frame.jsx, ds.jsx, i18n.jsx …) |
| pototype/index-print.html | 4,854 | "juneflow — UI/UX Design (Print)" — entry แบบพิมพ์: `@page A4 landscape` + override `@media print` ให้จอ active ไหลลงกระดาษ |
| pototype/_standalone-src.html | 3,770 | "juneflow — UI/UX Design" — ไฟล์ HTML ต้นทาง (โหลด styles.css + CDN scripts แบบมี integrity hash) |
| pototype/Juneflow Ant Pro.html | 7,288 | "juneflow — UI/UX Design" — หน้า loader (styles.css + ฟอนต์ Noto Sans Thai/Arabic/SC + CDN + 81 script) |
| pototype/Juneflow Ant Pro (standalone).html | 9,066,441 | "juneflow — UI/UX Design" — ไฟล์ standalone ขนาดใหญ่ (รวมทุกอย่างในไฟล์เดียว) |
| pototype/Juneflow Ant Pro Redesign.html | 20,362 | "Juneflow · Ant Design Pro Redesign" — หน้าเดี่ยว มี CSS inline โทน Ant Design (`--primary:#1677ff` ฯลฯ) |
| pototype/Juneflow Ant Pro-print-f0911m.html | 22,508 | "juneflow — UI/UX Design" — variant สำหรับพิมพ์ (มี `@media print` 4 จุด + `window.print`) · โหลด .jsx ชุดเดียวกัน |
| pototype/Juneflow Fiori.html | 7,464 | "Juneflow · Fiori Skin (Enterprise)" — loader ที่โหลด styles.css + fiori-theme.css + fiori-empty.js + fiori-loading.js |
| pototype/juneflow - Construction ERP (standalone).html | 2,031,884 | "juneflow — UI/UX Design" — ไฟล์ standalone |
| pototype/juneflow-standalone.html | 2,029,210 | "juneflow — UI/UX Design" — ไฟล์ standalone |
| pototype/ระบบงานก่อสร้าง (standalone).html | 9,004,392 | "juneflow — UI/UX Design" — ไฟล์ standalone ขนาดใหญ่ |
| pototype/คู่มือ Flow + ภาพหน้าจอ.html | 126,932 | "คู่มือ Flow + ภาพหน้าจอ ทั้งระบบ" — เอกสารคู่มือ อ้างรูปจาก gallery/g1 (30), g2 (47), g3 (5), g4 (4) รวม `<img>` 87 รูป |
| pototype/ดัชนีฟังก์ชันระบบ.html | 67,667 | "ดัชนีฟังก์ชันทั้งระบบ · ระบบงานก่อสร้าง" |
| pototype/ถอดฟังก์ชันตาม Flow.html | 68,095 | "ถอดฟังก์ชันทั้งระบบ (ตาม Flow)" |
| pototype/บุญบัญชี - ระบบบริหารการเงินวัด.html | 2,063 | "บุญบัญชี · ระบบบริหารการเงินวัด" — entry ของแอปวัด: โหลด wat/theme.css + React/Babel CDN + wat/*.jsx (core, forms, data, shell, screen-*) |
| pototype/เทียบ 3 สไตล์ Redesign.html | 37,944 | "เทียบ 3 สไตล์ Redesign · Juneflow" — หน้าเปรียบเทียบสไตล์ (ในไฟล์อ้างถึง "Ant Pro" และ "Fiori") |
| pototype/แกลเลอรีหน้าจอ.html | 33,847 | "แกลเลอรีหน้าจอทั้งระบบ · ระบบงานก่อสร้าง" — แกลเลอรีอ้างรูปจาก gallery/g1 (28 อ้างอิง), g2 (47), g3 (5), g5 (20) |
| pototype/แกลเลอรีหน้าจอ (ออฟไลน์).html | 8,555,111 | "แกลเลอรีหน้าจอทั้งระบบ · ระบบงานก่อสร้าง" — เวอร์ชันออฟไลน์ (ไฟล์เดี่ยวขนาดใหญ่ ไม่อ้างรูปภายนอก) |

## 5) pototype/ — โฟลเดอร์ย่อย

### 5.1 pototype/wat/ — แอป "บุญบัญชี" ระบบบริหารการเงินวัด (14 .jsx + 1 .css)

| ไฟล์ | ขนาด (bytes) | หน้าที่ (ตามคอมเมนต์หัวไฟล์) |
|---|---:|---|
| pototype/wat/core.jsx | 14,335 | บุญบัญชี — core components (formatting ฯลฯ) |
| pototype/wat/data.jsx | 17,844 | บุญบัญชี — sample data (realistic Thai temple finance operations) · TENANTS ฯลฯ |
| pototype/wat/forms.jsx | 11,248 | บุญบัญชี — form controls (office-form feel: tight, labelled, validated) |
| pototype/wat/main.jsx | 88 | entry — `ReactDOM.createRoot(...).render(<App/>)` |
| pototype/wat/shell.jsx | 14,808 | บุญบัญชี — app shell: tenant switcher, sidebar, topbar, router, modal + toast · ประกาศ `window.SCREENS` `window.__ctx` |
| pototype/wat/screen-dashboard.jsx | 9,818 | บุญบัญชี — Dashboard: what needs doing today (ลงทะเบียนใน `window.SCREENS`) |
| pototype/wat/screen-donate.jsx | 11,536 | บุญบัญชี — Donation intake |
| pototype/wat/screen-receipt.jsx | 17,097 | บุญบัญชี — Receipts list + official อนุโมทนาบัตร detail · ประกาศ `window.bahtText` |
| pototype/wat/screen-donor.jsx | 9,630 | บุญบัญชี — Donor registry + profile |
| pototype/wat/screen-ledger.jsx | 8,248 | บุญบัญชี — Funds & general ledger |
| pototype/wat/screen-approvals.jsx | 10,793 | บุญบัญชี — Approvals: void & correction with before→after and required reasons |
| pototype/wat/screen-admin.jsx | 12,432 | บุญบัญชี — Admin / master data (PERMS) |
| pototype/wat/screen-audit.jsx | 3,405 | บุญบัญชี — Audit log |
| pototype/wat/screen-ds.jsx | 9,457 | บุญบัญชี — Design system showcase |
| pototype/wat/theme.css | 3,642 | บุญบัญชี — theme: Grounded Thai back-office finance UI · warm paper · single ink-navy accent · oxblood seal for documents only |

### 5.2 pototype/handoff/ — แพ็กเกจ handoff ในตัว prototype (9 ไฟล์)

> 8 ไฟล์ (ยกเว้น HANDOFF.md) เหมือนกับไฟล์ชื่อเดียวกันใน `design_handoff_juneflow/` แบบ byte-identical (ตรวจด้วย `cmp`)

| ไฟล์ | ขนาด (bytes) | หน้าที่ |
|---|---:|---|
| pototype/handoff/HANDOFF.md | 5,010 | "Juneflow — Handoff Package สำหรับทีมพัฒนา (Production)" · เวอร์ชัน 5 ก.ค. 2569 · เป้าหมาย: ส่งต่อ UI 100% + Process flows 100% ให้ทีม dev เริ่มสร้างระบบจริง · หัวข้อ 1) ไฟล์ในแพ็กเกจนี้ |
| pototype/handoff/api-contract.md | 5,665 | Juneflow — API Contract (เบื้องต้น) · REST · JSON · prefix `/api/v1` · JWT ระบุ company_id = tenant scope |
| pototype/handoff/data-dictionary.html | 11,985 | "Juneflow — Data Dictionary" |
| pototype/handoff/erd.html | 11,598 | "Juneflow — ERD แผนภาพความสัมพันธ์ฐานข้อมูล" |
| pototype/handoff/flows.html | 15,907 | "Juneflow — Process Flows & Approval Matrix" |
| pototype/handoff/tokens.css | 3,290 | Juneflow Design Tokens — 2 themes · ใช้ `<html data-theme="fiori">` (ค่าเริ่มต้น) หรือ `data-theme="navy"` |
| pototype/handoff/tokens.json | 2,639 | Design tokens ในรูป JSON |
| pototype/handoff/ถอดฟังก์ชันตาม Flow.html | 68,095 | "ถอดฟังก์ชันทั้งระบบ (ตาม Flow)" |
| pototype/handoff/แกลเลอรีหน้าจอ (ออฟไลน์).html | 8,555,111 | "แกลเลอรีหน้าจอทั้งระบบ · ระบบงานก่อสร้าง" (เวอร์ชันออฟไลน์) |

### 5.3 โฟลเดอร์รูปภาพ (สรุป 1 แถวต่อโฟลเดอร์)

| โฟลเดอร์ | จำนวนไฟล์ | ขนาดรวม (KB) | เนื้อหา |
|---|---:|---:|---|
| pototype/gallery/g1/ | 30 | 2,144 | ภาพหน้าจอ .jpg ชื่อ 01-s.jpg … 30-s.jpg (ใช้ในแกลเลอรี/คู่มือ Flow) |
| pototype/gallery/g2/ | 47 | 3,116 | ภาพหน้าจอ .jpg ชื่อ 01-s.jpg … 47-s.jpg |
| pototype/gallery/g3/ | 5 | 292 | ภาพหน้าจอ .jpg ชื่อ 01-s.jpg … 05-s.jpg |
| pototype/gallery/g4/ | 4 | 176 | ภาพหน้าจอ .jpg ชื่อ 01-s.jpg … 04-s.jpg |
| pototype/gallery/g5/ | 20 | 700 | ภาพหน้าจอ .jpg ชื่อ 01-s.jpg … 20-s.jpg |
| pototype/shots/ | 22 | 1,288 | ภาพหน้าจอ .png ตั้งชื่อตามจอ: land-rest, pm-c-detail, pm-c-wizard, pm-manual, pm-manual3/4, ptype-modal, land-pipeline, pm-contract-step1, pm-dash, pm-grouped |
| pototype/uploads/ | 30 | 2,296 | ไฟล์ที่อัปโหลดเข้ามา: pasted-*.png 27 ไฟล์ + Template_BOM_And_BOQ (M2-RM).xlsx (13,929 B) + Template_BOM_And_BOQ M1-RM.xlsx (14,162 B) + ผังถนน.dwg (305,510 B — ไฟล์ AutoCAD) |
| pototype/wat-shots/ | 1 | 24 | dash.png (22,012 B) — ภาพหน้าจอของแอปบุญบัญชี |

## 6) design_handoff_juneflow/ (12 ไฟล์)

| ไฟล์ | ขนาด (bytes) | หน้าที่ |
|---|---:|---|
| design_handoff_juneflow/README.md | 5,736 | "Handoff: Juneflow — Construction ERP + Subscription SaaS (ทั้งระบบ)" · Overview: multi-tenant SaaS: BOQ/จัดซื้อ → ผู้รับเหมา/ตรวจรับ → การเงิน-บัญชี + PM/CMMS + ที่ดิน + ขาย-CRM + โซลาร์ EPC + Subscription (แพ็กเกจ S/M/L/Full) + Mobile + LINE OA · i18n 4 ภาษา |
| design_handoff_juneflow/FUNCTIONS.md | 20,213 | "ถอดฟังก์ชันละเอียดทุก Feature (สำหรับ Claude Code)" · รูปแบบ: ฟังก์ชัน → trigger → input → พฤติกรรม → state/ผลลัพธ์ · ระบุว่ารายชื่อฟังก์ชันครบดู FUNCTIONS-INVENTORY.md (719 functions / 78 ไฟล์) |
| design_handoff_juneflow/FUNCTIONS-INVENTORY.md | 11,926 | "ภาคผนวก — Function Inventory (สแกนอัตโนมัติจากโค้ด prototype ทั้งหมด)" · รายการ component/function ที่ประกาศจริงในไฟล์ .jsx รายไฟล์ |
| design_handoff_juneflow/_inv1.md | 5,484 | รายการ function ต่อไฟล์ รูปแบบเดียวกับ FUNCTIONS-INVENTORY.md (เริ่มที่ accounting-extra.jsx) แต่ไม่มีหัวเรื่อง — เนื้อหาเป็นบางส่วนของ inventory |
| design_handoff_juneflow/api-contract.md | 5,665 | Juneflow — API Contract (เบื้องต้น) · เหมือน pototype/handoff/api-contract.md แบบ byte-identical |
| design_handoff_juneflow/data-dictionary.html | 11,985 | "Juneflow — Data Dictionary" · byte-identical กับสำเนาใน handoff/ |
| design_handoff_juneflow/erd.html | 11,598 | "Juneflow — ERD แผนภาพความสัมพันธ์ฐานข้อมูล" · byte-identical กับสำเนาใน handoff/ |
| design_handoff_juneflow/flows.html | 15,907 | "Juneflow — Process Flows & Approval Matrix" · byte-identical กับสำเนาใน handoff/ |
| design_handoff_juneflow/tokens.css | 3,290 | Juneflow Design Tokens — 2 themes (fiori ค่าเริ่มต้น / navy) · byte-identical กับสำเนาใน handoff/ |
| design_handoff_juneflow/tokens.json | 2,639 | Design tokens JSON · byte-identical กับสำเนาใน handoff/ |
| design_handoff_juneflow/ถอดฟังก์ชันตาม Flow.html | 68,095 | "ถอดฟังก์ชันทั้งระบบ (ตาม Flow)" · byte-identical กับสำเนาใน handoff/ และใน pototype/ root |
| design_handoff_juneflow/แกลเลอรีหน้าจอ (ออฟไลน์).html | 8,555,111 | "แกลเลอรีหน้าจอทั้งระบบ · ระบบงานก่อสร้าง" (ออฟไลน์) · byte-identical กับสำเนาใน handoff/ และใน pototype/ root |

---

## อ่านไม่ได้

ไม่มี — ทุกไฟล์เปิดอ่านได้ปกติ (ไฟล์ binary ได้แก่ รูป .jpg/.png, .xlsx 2 ไฟล์ และ ผังถนน.dwg เปิดอ่าน metadata/ขนาดได้ แต่ไม่ได้ถอดเนื้อหาภายในในเอกสารนี้)

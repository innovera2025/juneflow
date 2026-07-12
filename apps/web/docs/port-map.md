# port-map.md — บัญชี port `pototype/*.jsx` → route/module + ภาพอ้างอิง (เขต `web`)

> Task **P0-WEB-04** · เขต `apps/web` · PLAN.md §0 (Design Fidelity Protocol) + §7
> แหล่งความจริง (อ่านทุกครั้งก่อน port จอ — PLAN.md §0 ข้อ 2):
> - โครงเมนู/route ทุกตัว → `docs/extract/NAV-ROUTES.md` (ถอดจาก chrome.jsx + shell.jsx)
> - บัญชีไฟล์ + หน้าที่ต่อไฟล์ → `docs/extract/INVENTORY.md` §2
> - ภาพอ้างอิง visual gate ต่อ route → `tests/visual/reference-index.md` (Task P0-QA-01)
> - พฤติกรรมจริง → เปิด `pototype/Juneflow Fiori.html` + อ่าน `.jsx` ต้นทางของจอนั้นในรอบนั้นเสมอ
>
> **กติกาใช้ตาราง:** คอลัมน์ `route` + `ไฟล์ .jsx` ยึด `NAV-ROUTES.md` เป็นคำตัดสิน (แหล่งความจริงของ route ตาม §0 ข้อ 2)
> · คอลัมน์ `ภาพอ้างอิง` ดึงตาม route id จาก `reference-index.md` · จอที่ไม่มีภาพ → แคปจาก `Juneflow Fiori.html` ก่อน port (§0 ข้อ 3 visual gate)

## ขอบเขต & การนับ

- ไฟล์ `.jsx` ระดับราก `pototype/` = **78 ไฟล์** (INVENTORY.md §2)
- **ตัดออกตาม PLAN.md §0 ข้อ 5 (ไม่ port):** `finance.jsx`, `tweaks-panel.jsx` (โค้ดตาย — ไม่ถูกโหลด/ไม่ถูก route) → เหลือ **76 ไฟล์** ที่อยู่ในบัญชีนี้ (คลุมครบ 76/76)
- ตัดออกด้วยแต่ **ไม่ใช่ .jsx ราก** (อยู่นอกบัญชีนี้อยู่แล้ว): `pototype/wat/*` (บุญบัญชี — คนละผลิตภัณฑ์), `*standalone*.html` / `Juneflow Ant Pro*` (ธีมอื่น — ใช้ Fiori เท่านั้น)
- `docs/extract/*` = sacred (อ่านอย่างเดียว) · ตารางนี้ **ไม่แก้** ไฟล์ต้นทางใด ๆ

### คำอธิบาย `scope` (บทบาทของไฟล์ต่อการ port ฝั่ง web)

| scope | ความหมาย | เจ้าของ task |
|---|---|---|
| `screen` | จอจริงที่มี route ใน sidebar → port + visual gate | P0-WEB-05 ขึ้นไป |
| `shell` | app chrome / routing host (ไม่ใช่จอเดี่ยว) | P0-WEB-05 |
| `shared` | primitive/องค์ประกอบร่วม (ds/modal/datepicker/chart/ios-frame) — port เป็น component ไม่ใช่จอ | P0-WEB-05 |
| `forms` | modal ฟอร์ม (PO/WO/GR/ธนาคาร/ภาษี ฯลฯ) เปิดจากจออื่น — ไม่มี route ตรง | ตาม module เจ้าของ |
| `viewer-embed` | component ฝังในจอหลัก (BIM viewer ใน AI-QTO) | คู่กับ `boq.aiqto` |
| `i18n-source` | พจนานุกรม/เอนจิน i18n ต้นทาง → ป้อน `packages/i18n` (production ใช้ key-based `t()` ไม่ port DOM observer — §0 ข้อ 3) | P0-WEB-03 / P0-BE-05 |
| `config` | ข้อมูล config (project types) — เป็น data ไม่ใช่จอ | P0-WEB-02 gating |
| `supporting` | flow/ตัวช่วยที่ไม่มี route sidebar (onboarding, checklist templates, package builder) | ตาม module |
| `entry` | จุด mount ของ prototype — แทนด้วย Vite entry ของ apps/web ไม่ port | — |
| `mobile-zone` | จอ/preview ฝั่ง mobile — Phase 4 เขต `apps/mobile` (นอกเขต web) | mobile |

> **หมายเหตุ mobile:** route `mobile` (MobilePreview) และ `line` (LineOAPreview) มีใน NAV-ROUTES และ render ใน web shell เป็น "preview" → นับเป็น `screen` (web) ตามภาพ g2/45–46 · ส่วนไฟล์ mobile อื่น (`mobile.jsx`, `mobile-field.jsx`, `mobile-pm.jsx`, `mobile-screens.jsx`, `line-pm.jsx`) เป็นเนื้อหาจอ mobile Phase 4 → `mobile-zone` (ลงบัญชีเพื่อความครบ ไม่ใช่งาน port ของ web)

---

## 1) ไฟล์จอ (`scope=screen`) — route + ภาพอ้างอิง

หนึ่งไฟล์อาจ render หลาย route (BOQ/GL/AP/AR/master ฯลฯ) — แตกทุก route ในคอลัมน์กลาง

| ไฟล์ .jsx | scope | route(s) (NAV-ROUTES) | ภาพอ้างอิง (reference-index) | หมวด / หมายเหตุ |
|---|---|---|---|---|
| dashboard.jsx | screen | `dashboard` | g1/01 | Dashboard ภาพรวมโครงการ (Chart.js) |
| exec-audit.jsx | screen | `exec` · `audit` | g1/02 (exec) · g2/37 (audit) | ภาพรวมผู้บริหาร + Central Audit Log |
| land.jsx | screen | `land.pipeline` · `land.bank` | g1/03 · g1/04 · shots/land-pipeline | Land Pipeline + Land Bank |
| land2.jsx | screen | `land.survey` · `land.dd` | g1/05 · g1/06 · shots/*land-rest* (working) | Survey/Feasibility + Due Diligence |
| boq.jsx | screen | `boq.overview` · `boq.editor` · `boq.approval` · `boq.archive` · `boq.reports` | g1/07 · g1/11 · g1/12 · g1/13 · g1/14 | BOQ Module (5 จอ — ทั้งหมดที่นี่: RouteView@shell.jsx render `BOQArchive`/`BOQReports` จาก boq.jsx) · **C7:** ป้าย `boq.approval`="อนุมัติ BOQ" (NAV) ≠ ROUTE_LABELS "อนุมัติ BOM/BOQ" → ยึดคำตัดสิน C7 · **ดู §5 หมายเหตุ D5** (ภาพ g1/13–14 ↔ ไฟล์) |
| boq-list.jsx | screen | `boq.list` | g1/08 | BOQ List + flow "สร้าง BOQ ใหม่" |
| ai-qto.jsx | screen | `boq.aiqto` | g1/09 | AI Quantity Take-Off (4-step wizard) |
| bom.jsx | screen | `boq.bom` | g1/10 | BOM สูตรต่อหลัง · **C7:** `boq.bom` ไม่มีใน ROUTE_LABELS (เมนู+RouteView มี) → ยึด C7 |
| pr-list.jsx | screen | `pr.list` | g1/15 | ใบขอซื้อ (PR) · badge 17 = query จริง (C10) |
| pr-form.jsx | screen | `pr.form` | — (แคปจาก Fiori.html ก่อน port) | PR Create/Edit — เข้าจาก navigate ภายใน (ไม่ใน sidebar) |
| po-wo.jsx | screen | `po.list` · `wo.list` · `po.form` · `wo.form` | g1/16 (po) · g1/17 (wo) · form: — | PO + WO list + ฟอร์ม (form เข้าจาก navigate ภายใน) |
| gr.jsx | screen | `gr.list` | g1/18 | Goods Receipt (รับสินค้า) |
| subcon.jsx | screen | `subcon.progress` (alias `subcon`) | g1/19 · g5/01 | Progress ผู้รับเหมา · **C8:** เมนู `subcon.*` gate ด้วยแพ็กเกจ → ยึด C8 |
| subcon-accept.jsx | screen | `subcon.contracts` | g5/02 | ทะเบียนสัญญาผู้รับเหมา |
| subcon-accept2.jsx | screen | `subcon.accept` · `subcon.handover` | — (แคปจาก Fiori.html ก่อน port) | งวดงาน&ตรวจรับ + เอกสารส่งมอบ (navigate ภายใน) |
| timeline.jsx | screen | `timeline` | g1/20 | Project Timeline (+BOQ Import modal) |
| inventory.jsx | screen | `inv.items` · `inv.stock` · `inv.transfer` · `inv.issue` | g1/21 · g1/22 · g1/23 · g1/24 | Inventory (Items/Stock/Transfer/Issue) |
| petty-alloc.jsx | screen | `petty` · `alloc` | g1/25 (petty) · g2/01 (alloc) | เงินสดย่อย + จัดสรรต้นทุน |
| company-accept.jsx | screen | `accept` | g5/03 | ศูนย์ตรวจรับรวม · badge 8 = query จริง (C10) |
| labor.jsx | screen | `labor.attendance` · `labor.payroll` · `labor.workers` | g5/05 · g5/06 · g5/04 | HR ไซต์งาน |
| pm.jsx | screen | `pm.dashboard` · `pm.assets` | g1/26 · g1/30 · shots/pm-dash · shots/pm-grouped | PM Dashboard + Asset Registry |
| pm2.jsx | screen | `pm.contracts` · `pm.schedule` | g1/27 · g1/28 · g5/20 · shots/*pm-c-*(detail/wizard/step1) | สัญญาบำรุงรักษา + แผน PM |
| pm3.jsx | screen | `pm.wo` | g1/29 · shots/*pm-manual* (working) | ใบงาน PM · badge 6 = query จริง (C10) |
| solar.jsx | screen | `solar.monitor` · `solar.ppa` · `solar.roi` · `solar.permit` · `solar.warranty` | g3/01 · g3/02 · g3/03 · g3/04 · g3/05 | Solar/EPC (แสดงเมื่อ project type=solar) |
| opex-budget.jsx | screen | `opex` | g5/07 | งบ OPEX บริษัท |
| accounting-extra.jsx | screen | `gl.coa` · `gl.revrec` · `ap.aging` · `ar.aging` | g5/08 · g5/09 · g5/13 · g5/15 | COA + RevRec/WIP + Aging (FinAging side=ap/ar) |
| accounting-extra2.jsx | screen | `gl.cashflow` · `gl.projectpl` · `ap.retention` · `ar.cn` | g5/10 · g5/11 · g5/12 · g5/14 | Cash Flow + Project P&L + Retention + AR CN |
| gl.jsx | screen | `gl.jv` · `gl.inbox` · `gl.trial` · `gl.statements` · `gl.close` | g2/02 · g2/03 · g2/04 · g2/05 · g2/06 | General Ledger · badge gl.inbox 8 = query จริง (C10) |
| ap.jsx | screen | `ap.billing` · `ap.pv` · `ap.cn-dn` · `ap.deposit` | g2/07 · g2/08 · g2/09 · g2/10 | Accounts Payable |
| ar.jsx | screen | `ar.invoice` · `ar.tax` · `ar.rv` | g2/11 · g2/12 · g2/13 | Accounts Receivable |
| bank.jsx | screen | `bank.cheque` · `bank.recon` · `bank.export` | g2/14 · g2/15 · g2/16 | ทะเบียนเช็ค / กระทบยอด / Export |
| tax.jsx | screen | `tax.vat` · `tax.wht` | g2/17 (vat) · g2/18 (wht) | VAT (ภพ.30) + WHT (ภงด.3/53) — **ดู §5 หมายเหตุ D1** (ภาพ g2/18 ↔ ไฟล์) |
| etax.jsx | screen | `tax.etax` | g5/16 | e-Tax Invoice & e-Receipt |
| fa.jsx | screen | `fa.register` · `fa.depr` · `fa.adjust` | g2/19 · g2/20 · g2/21 | Fixed Asset |
| sales-crm.jsx | screen | `sales.dashboard` · `sales.crm` | g2/22 · g2/23 | Sales Dashboard + CRM/Leads · badge 5/12 = query จริง (C10) |
| sales-process.jsx | screen | `sales.process` · `sales.down` · `sales.loan` | g2/24 · g2/25 · g2/26 | ขายยูนิต / งวดดาวน์ / สินเชื่อ&โอน |
| sales-service.jsx | screen | `sales.service` | g2/27 | After-Sales · แจ้งซ่อม · badge 5 = query จริง (C10) |
| master.jsx | screen | `master.company` · `master.project` · `master.model` · `master.cc` · `master.docnum` · `users` · `sync` | g2/28 · g2/32 · g2/33 · g2/34 · g2/35 · g2/36 (users) · g2/47 (sync) | Master Data + Users/Perms + Sync — **ดู §5 หมายเหตุ D2** (ภาพ g2/47 ↔ ไฟล์) |
| project-type-screen.jsx | screen | `master.ptype` | g2/29 · shots/*ptype-modal* | Project Type screen + Add modal |
| master-party.jsx | screen | `master.vendor` · `master.customer` | g2/30 · g2/31 | Vendor + Customer registries (VENDOR_SEED/CUSTOMER_SEED) |
| dms.jsx | screen | `dms` | g5/18 | ศูนย์เอกสาร (DMS) |
| extra-screens.jsx | screen | `login` · `reports` · `settings` · `notifications` | g4/01 · g4/02 (+g5/17) · g4/03 (+g5/19) · g4/04 | Login / Reports Hub / Settings / Notifications Center |
| subscription.jsx | screen | `sub.mine` · `sub.plans` · `sub.billing` | g2/38 · g2/39 · g2/40 | Subscription — Tenant screens |
| subscription-admin.jsx | screen | `admin.overview` · `admin.subs` · `admin.plans` · `admin.invoices` | g2/41 · g2/42 · g2/43 · g2/44 | Platform Admin console (viewMode=platform) |
| mobile-preview.jsx | screen (web) | `mobile` | g2/45 | Mobile Approval preview (render ใน web shell) |
| line-oa.jsx | screen (web) | `line` | g2/46 | LINE OA · ลูกบ้าน preview (mod: lineoa) |

## 2) ไฟล์ที่ไม่ใช่จอเดี่ยว (shell / shared / forms / viewer / i18n / config / supporting)

| ไฟล์ .jsx | scope | ผูกกับ route/module | หมายเหตุ |
|---|---|---|---|
| chrome.jsx | shell | ทุกจอ (Sidebar/TopBar/ProjectSwitcher/SearchPalette/Notifications/UserMenu) | เจ้าของ NAV/ROUTE_LABELS/PARENT_ID_OF_ROUTE · badge = query จริง (C10) · P0-WEB-05 |
| shell.jsx | shell | routing host + modal + tweaks | RouteView · route เริ่ม `dashboard` · P0-WEB-05 |
| app.jsx | entry | — | mount `<AppShell/>` — แทนด้วย Vite entry (`src/main.tsx`) ไม่ port |
| ds.jsx | shared | ทุกจอ | Design system primitives (icons/badges/buttons/fmt) — port เป็น component ร่วม |
| modal.jsx | shared | ทุกจอ | Modal/Dialog system (sm/md/lg/xl/full) |
| datepicker.jsx | shared | ฟอร์ม/รายงาน | DatePicker + RangeSwitch |
| charts.jsx | shared | dashboard/exec/sales/solar | Chart.js wrapper theme-aware |
| ios-frame.jsx | shared | `mobile` preview | iOS device frame (ใช้โดย mobile-preview) |
| forms.jsx | forms | proc (`po.*`/`wo.*`/`gr.*`) | Modal PO/WO/GR + confirm flows |
| real-forms.jsx | forms | bank/gl/ar/pr/sales | helper ฟอร์มกลาง (openChequeForm/openPayForm/openReceiveForm/openBOQPick…) |
| real-forms2.jsx | forms | subscription/fa/po/solar/bom/inv/งวดงาน | ฟอร์มรองที่เหลือ + แนบไฟล์/จับคู่ธนาคาร/เทียบ vendor |
| tax-forms.jsx | forms | tax (`tax.wht`/`tax.vat`/50 ทวิ) | แบบภาษีทางการไทย A4 (accurate to RD) — render เป็น modal จากจอ tax · เตรียม Phase 3 (P0-INT-05 map แล้ว) |
| linked-docs.jsx | shared | cross-module | Linked Documents deep-linking (BOQ code → เอกสารเกี่ยว) |
| boq-extra.jsx | viewer-embed | `boq.reports` (embed ใน `BOQReports`@boq.jsx) | รายงานฝัง (`BOQReportsExtra`/M-S-L/Variance/EVM) + PR gen/revise/budget/audit modals — **ไม่ใช่ route target** (route boq.archive/boq.reports = boq.jsx) · **ดู §5 หมายเหตุ D5** |
| ai-qto-viewer.jsx | viewer-embed | `boq.aiqto` | BIM viewer (SVG isometric/2D) ผูก QTO rows |
| ai-qto-fullscreen.jsx | viewer-embed | `boq.aiqto` | BIM fullscreen overlay (pan/zoom/layers/3D-2D) |
| pm-checklist.jsx | supporting | `pm.wo` | PM Checklist Templates (settings + picker) |
| pkg-builder.jsx | supporting | platform (package config) | Package Builder S/M/L/Full (`window.__tenantPkg`) — ไม่มี route sidebar · **ดู §5 หมายเหตุ D3** |
| subscription-flow.jsx | supporting | `sub.*` / onboarding | signup/onboarding wizard + quota enforcement (402) — ไม่มี route sidebar |
| project-types.jsx | config | route gating (ม. PROJECT-TYPES.md) | นิยาม hierarchy/cost types/enabled modules ต่อ project type — data ไม่ใช่จอ · ใช้ใน P0-WEB-02 gating |
| design-canvas.jsx | supporting | — | DesignCanvas (Figma-ish) — ไม่มี route ใน NAV-ROUTES · **ดู §5 หมายเหตุ D4** (ยืนยันขอบเขต product) |
| i18n.jsx | i18n-source | ทุกจอ | เอนจิน i18n th/zh/en/ar+RTL (`window.I18N`/`useLang`/`t()`) → production ใช้ `packages/i18n` key-based (§0 ข้อ 3) |
| i18n-phrases.jsx | i18n-source | ทุกจอ | phrase dict (units/categories/months/statuses) → merge `packages/i18n` |
| i18n-phrases3.jsx | i18n-source | PM/Land/Solar/BOQ/Master/Sales | phrase batch 3 → merge `packages/i18n` |
| i18n-accounting.jsx | i18n-source | จอบัญชี (COA/Aging/RevRec/Retention/CN/CashFlow/P&L) | phrase บัญชี → merge `packages/i18n` |

## 3) ไฟล์ mobile (Phase 4 — เขต `apps/mobile`, นอกเขต web)

ลงบัญชีเพื่อความครบของ 76 ไฟล์ — **ไม่ใช่งาน port ของเขต web** (จอ mobile เริ่ม Phase 4)

| ไฟล์ .jsx | scope | หมายเหตุ |
|---|---|---|
| mobile.jsx | mobile-zone | Mobile approval screens (ใน iOS frame) |
| mobile-screens.jsx | mobile-zone | Field + After-Sales + Site + Safety + Executive + CRM |
| mobile-field.jsx | mobile-zone | สโตร์ & โฟร์แมน — รับของหน้าไซต์ (GR) + % งาน |
| mobile-pm.jsx | mobile-zone | งาน PM (ช่าง) 5 screens — Maxtech |
| line-pm.jsx | mobile-zone | LINE OA · PM ฝั่งลูกค้า (plan/quote/certificate/contract) |

> `mobile-preview.jsx` และ `line-oa.jsx` **ไม่** อยู่กลุ่มนี้ — มี route ใน web shell (`mobile`/`line`) → อยู่ §1

---

## 4) route ที่ต้อง cross-check ตอน port (จาก NAV-ROUTES §ข้อสังเกต + RouteView)

- **Legacy redirects (RouteView, ไม่ใน sidebar):** `fin.ap`→APBilling(ap.jsx) · `fin.ar`→ARInvoice(ar.jsx) · `fin.gl`→GLJournalVoucher(gl.jsx) — port เป็น redirect ไม่ใช่จอใหม่
- **badge hardcode ใน NAV** (boq=4, boq.approval=4, pr.list=17, accept=8, pm.wo=6, gl.inbox=8, sales=5, sales.crm=12, sales.service=5) → **production มาจาก query จริง (C10)** ห้าม hardcode
- **parent auto-nav:** คลิกเมนู parent ที่มี sub → navigate ไป sub ตัวแรก (chrome.jsx)
- **route gating:** เปลี่ยนโครงการแล้ว route ไม่ผ่าน `routeAllowedForProject` → เด้งกลับ `dashboard`

## 5) หมายเหตุความไม่ตรงกันของแหล่ง (บันทึกโปร่งใส — ไม่ตัดสินเอง, §0 ข้อ 4)

ยึด `NAV-ROUTES.md` เป็นคำตัดสินของ `route`+`ไฟล์` (แหล่งความจริงตาม §0 ข้อ 2) — บันทึกจุดที่ `reference-index.md` (เอกสาร QA derived) attribute ต่างไว้ให้ผู้ port + diff-reviewer เห็น ไม่ใช่ blocker (route มีแหล่งตัดสินชัดแล้ว)

- **D1 · `tax.wht` (ภาพ g2/18):** NAV-ROUTES → `tax.wht`=`TaxWHT`@**tax.jsx** · reference-index คอลัมน์ไฟล์เขียน `tax-forms.jsx` → ตารางนี้ผูก g2/18 กับ route `tax.wht`(tax.jsx) ตาม NAV · `tax-forms.jsx` = ตัว render แบบ RD จริง (เปิดเป็น modal) ตาม §2
- **D2 · `sync` (ภาพ g2/47):** NAV-ROUTES → `sync`=`SyncStatus`@**master.jsx** · reference-index คอลัมน์ไฟล์เขียน `chrome.jsx` → ตารางนี้ผูก g2/47 กับ route `sync`(master.jsx) ตาม NAV
- **D5 · `boq.archive` / `boq.reports` (ภาพ g1/13–14):** NAV-ROUTES rows 27–28 + RouteView@shell.jsx → ทั้งคู่=`BOQArchive`/`BOQReports`@**boq.jsx** · reference-index คอลัมน์ไฟล์เขียน `boq-extra.jsx` → ตารางนี้ผูก g1/13–14 กับ route ที่ boq.jsx ตาม NAV · `boq-extra.jsx` = รายงานฝัง (`BOQReportsExtra` embed ใน `BOQReports`) + PR/revise/budget modals ตาม §2 (ไม่ใช่ route target)
- **D3 · `pkg-builder.jsx`:** ไม่มี route ใน NAV-ROUTES sidebar (เครื่องมือ platform config) — port เมื่อขอบเขต platform admin ชัด · ไม่บล็อกงานจอ tenant
- **D4 · `design-canvas.jsx`:** ไม่มี route ใน NAV-ROUTES · โหลดใน index.html แต่ไม่ถูก route → **ยังไม่ยืนยันว่าเป็นจอในผลิตภัณฑ์จริงหรือเครื่องมือ design** — ไม่ port จนกว่า Wei ยืนยันขอบเขต (บันทึกไว้ ไม่ตัดสินเอง)
- ป้าย/label ที่ NAV ≠ ROUTE_LABELS (`boq.approval`, `boq.bom`) → คำตัดสิน **C7** (ภาคผนวก C)

## 6) สรุปความครบ (gate: ครอบคลุมทุก .jsx ที่ไม่ถูก exclude)

- .jsx ราก 78 − exclude 2 (finance/tweaks-panel) = **76 ไฟล์** — ลงบัญชีครบ:
  - §1 screen = **46 ไฟล์** (รวม mobile-preview/line-oa ที่ render ใน web shell)
  - §2 ไม่ใช่จอเดี่ยว = **25 ไฟล์** (shell 2 · entry 1 · shared 6 [ds/modal/datepicker/charts/ios-frame/linked-docs] · forms 4 [forms/real-forms/real-forms2/tax-forms] · viewer-embed 3 [boq-extra/ai-qto-viewer/ai-qto-fullscreen] · supporting 4 [pm-checklist/pkg-builder/subscription-flow/design-canvas] · config 1 · i18n-source 4)
  - §3 mobile-zone = **5 ไฟล์**
  - รวม 46 + 25 + 5 = **76** ✅
- ทุก route ใน NAV-ROUTES.md (sidebar + RouteView) มีไฟล์ .jsx เจ้าของในตารางนี้
- **review โดย Wei** (gate ของ task นี้ตาม TASKS.md) — ยังไม่มี G1–G5 (เอกสาร inventory ไม่มีจอ/schema/contract)

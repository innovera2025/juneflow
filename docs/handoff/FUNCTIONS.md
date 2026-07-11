# FUNCTIONS.md — ถอดฟังก์ชันละเอียดทุก Feature (สำหรับ Claude Code)

> คู่มือ implement ต่อฟีเจอร์ · รูปแบบ: **ฟังก์ชัน → trigger → input → พฤติกรรม → state/ผลลัพธ์**
> อ้างอิงโค้ดตัวอย่าง: ไฟล์ .jsx ใน project root (behavior จริงเปิดดูได้ใน `Juneflow Fiori.html`)
> รายชื่อฟังก์ชันครบทุกตัวดูใน `FUNCTIONS-INVENTORY.md` (719 functions / 78 ไฟล์) · state machine ดู `flows.html` · schema ดู `erd.html` + `data-dictionary.html` · API ดู `api-contract.md`

## 0) โครงระบบกลาง (shell.jsx, chrome.jsx, ds.jsx)

| ฟังก์ชัน | พฤติกรรม |
|---|---|
| `App()` | root: state `route,params,tweaks,modal,toasts` · persist route/theme/lang ใน localStorage · expose `window.__juneflowCtx` |
| `ctx.navigate(route, params)` | เปลี่ยนหน้า + scroll top + loading bar 3px + skeleton · route ทั้งหมด ~110 เส้นทางใน `RouteView()` |
| `ctx.openModal({title,subtitle,icon,size,body})` | modal กลาง ปิดด้วย ×/backdrop/Esc · `body({close})` เป็น render prop |
| `ctx.confirm({message,onConfirm,reasonRequired})` | confirm dialog + ช่องเหตุผล (ใช้กับ ลบ/void/ระงับ) |
| `ctx.notify(msg, tone)` | toast 3.2s (ok/info/warn/danger) |
| `Sidebar()` | เมนู 2 ระดับ ยุบ-ขยาย · กรอง 3 ชั้น: **โมดูลตาม ProjectType** (`moduleOn`) → **แพ็กเกจ tenant** (`pkgMenuAllowed` + `pkgSubMenuAllowed`) → viewMode (ลูกค้า/เจ้าของระบบ) |
| `ProjectSwitcher()` | สลับ บริษัท→โครงการ→เฟส + TypeBadge · เปลี่ยนโครงการที่หน้าปัจจุบันใช้ไม่ได้ → redirect dashboard (`routeAllowedForProject`) |
| `TopBar` | breadcrumb (แปลตามภาษา) + LanguageSwitcher(4 ภาษา th/zh/en/ar-RTL) + Notifications + theme toggle |
| i18n (`i18n.jsx`) | `I18N.set(lang)` → dict 732 คีย์ + MutationObserver แปลข้อความ/placeholder อัตโนมัติ · `ar` พลิก `dir=rtl` ทั้งแอป ตัวเลข/รหัสคง LTR (`.num`) |

## 1) Subscription Platform

### 1.1 Package Builder (pkg-builder.jsx) — เจ้าของระบบ
- `openPkgBuilder(ctx, preset?)` — ปุ่ม "สร้างแพ็กเกจ/แก้ไข" (admin.plans) → modal:
  - ชิป S/M/L/Full → `pkgPresetIds(size)` ติ๊กชุดเมนูอัตโนมัติ (S=6, M=+การเงิน/PM, L=+ขาย/HR, Full=ทั้งหมด 46)
  - ต้นไม้เมนูจริงจาก `pkgNavGroups()` (อ่าน NAV) · ติ๊กรายเมนู/หัวกลุ่ม (indeterminate) + ตัวนับ x/46
  - ฟิลด์: name, price(หรือ "ติดต่อทีมขาย"=null), projects/users/storage/ai (-1=ไม่จำกัด)
  - validate: ต้องมีชื่อ+ราคา+≥1 เมนู → `PKG_STORE.save()` → การ์ดอัปเดตสด
- `PkgAdminGrid` — การ์ด 4 แพ็กเกจ: ราคา ด./ปี, โควต้า, แถบสัดส่วนเมนู, จำนวนผู้สมัคร
- กติกาเมนูย่อย `PKG_SUB_RULES`: `master.ptype→[Full]`, `boq.aiqto→[M,L,Full]`
- ฝั่งลูกค้า: `tenantPkg()` + `pkgMenuAllowed(id)` → sidebar ซ่อนเมนู · Dashboard+`sub.*` เห็นเสมอ
- โควต้า AI: `aiQuota()` {limit,used,left} · `consumeAiCredit()` เมื่อกดเริ่มถอด · `AiQuotaChip` แสดง used/limit · หมด → `openAiQuotaModal` + ปุ่มอัปเกรด→sub.plans

### 1.2 Admin (subscription-admin.jsx) / Tenant (subscription.jsx)
- `AdminOverview` — KPI MRR/ผู้สมัคร/ค้างชำระ + ตารางบริษัท (แพ็กเกจ, seat ใช้/ลิมิต, สถานะ)
- ต่อบริษัท: เปลี่ยนแพ็กเกจ+seat (`PUT package`), ระงับ (confirm+เหตุผล), `openNotifySend` ทวงถาม, ดูผู้ใช้ทั้งหมด → **บล็อก user** (toggle) + **รีเซ็ตรหัสผ่าน** (ส่งลิงก์, confirm)
- `openInviteUserForm` — เชิญ user ใหม่ (validate email + เลือก role)
- Tenant: `SubMyPackage` (แพ็กเกจของฉัน: โควต้าใช้/เหลือ 4 มิเตอร์), `SubPlans` (เทียบแพ็กเกจ+อัปเกรด), `SubBilling` (ประวัติบิล)

## 2) Master Data (master.jsx, project-types.jsx, project-type-screen.jsx)

- **Company/Org** — tree บริษัท→หน่วยงานย่อย: เพิ่ม (`เพิ่มหน่วยงานย่อย` ทุก node), แก้ไข inline modal, ยุบ/ขยาย node (ไม่ expand ค้าง)
- **หลายบริษัท (multi-company)** — เพิ่มบริษัทใหม่ + สลับบริษัทใน ProjectSwitcher
- **ProjectType (Full เท่านั้น)** — 4 default (อสังหาฯ/โซลาร์/โยธา/บริการ): การ์ด hierarchy+costTypes+modules · `openAdd` สร้าง type ใหม่ (ชื่อ2ภาษา, ไอคอน8, สี6, WBS แยกด้วย →, toggle โมดูล 14+pm)
- **Project wizard** — สร้างโครงการ 3 ขั้นตาม type: เลือก type → ข้อมูล+งบ → hierarchy (label ตาม type เช่น ไซต์→โซน/Array→String→Inverter)
- **Phase/Block/Unit** — label ปรับตาม type · เพิ่ม block (`BlockAddForm`: code ซ้ำ validate, จำนวนยูนิต) · unit grid สถานะขาย
- **Vendor/Customer** — แยกชัด: Vendor(kind=ผู้ขาย|ผู้รับเหมา แท็บแยก), Customer · ฟอร์มเพิ่ม/แก้ (ชื่อ,เลขภาษี,เครดิต,ธนาคาร) · **ใช้ master เดียวกับ AP/AR/สัญญา** (dropdown ดึงจากนี่ ไม่ซ้ำซ้อน)
- **Cost Center** — ผูกโครงการ · เพิ่ม/แก้ · ใช้ใน: PR/PO, FA, ค่าแรง, งานสำรวจที่ดิน, JV lines
- **Document Numbering** — รูปแบบเลขเอกสารต่อชนิด (prefix-ปี-run)

## 3) BOQ & AI QTO

### 3.1 BOQ (boq.jsx, boq-list.jsx, boq-extra.jsx, bom.jsx)
- `BOQList` — ตาราง+ตัวกรอง(โครงการ/เฟส/สถานะ/ค้นหา) + KPI · แถว: เปิด Editor, ⋮ ทำซ้ำ(`BOQStore.add` เลขใหม่)/พิมพ์/ลบ(confirm+เหตุผล)
- `openNewBOQ` — modal สร้าง: เลข auto gen แก้ได้(กันซ้ำ), cascade โครงการ→เฟส→บล็อก→ยูนิต, ระดับ(BOM/byUnit/byBlock), เริ่มจาก 4 แบบ(BOM สูตร/คัดลอก BOQ/ศูนย์/Excel นำเข้า+map คอลัมน์...) → สร้างเข้า list + navigate editor
- `BOQEditor` — กลุ่มงานซ้าย + ตารางรายการ: เพิ่ม/แก้/ทำซ้ำ/ลบ/ย้ายหมวด (bulk checkbox) · **สร้าง PR จากรายการที่เลือก** (`openBOQtoPR`: แยก Material→PR, Subcon→PR-Subcon, mark "เปิด PR แล้ว" ตัด remain) · BudgetControlBar (CBS งบ/ใช้/ผูกพัน + เตือนเกินงบ) · Audit drawer (ใคร-เมื่อไหร่-แก้อะไร)
- **Lock & Revise** — approved = read-only + banner → `openBOQRevise` (เหตุผล+ขอบเขต) → v(n+1) draft → ส่งอนุมัติ
- `BOQApproval` — คิว + diff เทียบเวอร์ชัน (แถวเพิ่ม=เขียว ลด=แดง) + approval ladder + comment + อนุมัติ/ปฏิเสธ/ขอแก้
- `BOQReports` — Cost summary/หมวด, M-S-L breakdown, Variance งวด(%dev), EVM (PV/EV/AC + SPI/CPI), Revise history · Archive: copy ไปตั้ง BOQ ใหม่
- `BOM` — templates ต่อ unit type: ตาราง+detail(M/S/L ต่อหลัง) + "ใช้สร้าง BOQ" + แก้ไขรายการ

### 3.2 AI QTO (ai-qto.jsx + ai-qto-viewer.jsx) — wizard 4 ขั้น (demo/preview badge)
1. **อัปโหลด**: drag-drop IFC/RVT/DWG/DXF/PDF + badge ความแม่นต่อชนิด + LOD + thumbnail preview + เครดิต AI chip (ตัด 1 เครดิต/หมดแล้วบล็อก)
2. **Processing**: progress 5 ขั้น (parse→ตรวจจับ→จำแนก→จับคู่→คำนวณ) + การ์ด element + confidence
3. **Review/Mapping**: ตาราง element→รายการ BOQ (แก้ map/qty/ลบ/เพิ่ม) · <80% ไฮไลต์เตือน · **3D isometric viewer (SVG)**: สลับ 3D/2D ผังพื้น, toggle layer 6 หมวด, zoom, **element-linking 2 ทาง** (คลิกแถว↔คลิกชิ้น+scroll) · **โหมดเต็มจอ**: pan/drag, zoom+scroll, fit, เลือกชั้น, mini-map, ค้นหา element, ตัวนับ+กรอง
4. **สรุป & สร้าง BOQ**: ยอดรวม/สัดส่วน M-L-S/กลุ่มงาน 3 ระดับ + mini-preview → "สร้าง BOQ จากผลถอด" → BOQ ใหม่ + traceability element_id

## 4) จัดซื้อ (pr-list/pr-form/po-wo/gr .jsx + forms.jsx + real-forms*.jsx)

- **PR**: list (แท็บ รอฉันอนุมัติ/ของฉัน/ร่าง + ตัวกรอง) · form: ผู้ขอ/แผนก/เฟส/ยูนิต + รายการ (เลือกจาก BOQ → `openBOQPick`, เทียบราคา BOQ, VAT7%) + แนบไฟล์ (`openAttachModal`) + `openDocHistory` timeline + ส่งอนุมัติ (matrix ตามมูลค่า) + อนุมัติ/ปฏิเสธ+เหตุผล
- **PO/WO**: สร้างจาก PR อนุมัติ · `openVendorCompare` เทียบ 3 เจ้า+คะแนน → ดึงราคา · `openLineItemForm` เพิ่ม/แก้รายการ · `openVarOrderForm` VO งานเพิ่ม-ลด (ปรับมูลค่าสัญญา) · `openMilestoneForm` เพิ่มงวด (% / ระยะทาง / milestone / รายเดือน)
- **GR**: รับเต็ม/บางส่วน/ตีกลับ + รูป → ตีกลับสร้าง defect + แจ้งผู้ขาย → เข้า **ศูนย์ตรวจรับ**

## 5) ผู้รับเหมา + ศูนย์ตรวจรับ (subcon.jsx, acceptance.jsx)

- **ทะเบียนสัญญา** → คลิกผู้รับเหมา → detail: งวดงาน & ตรวจรับ + เอกสารส่งมอบ (ใต้สัญญา ไม่ใช่เมนูแยก)
- งวดงาน: เกณฑ์ 3 แบบ (% งาน / ระยะทาง เช่น ท่อ 100 ม./งวด / milestone) · ส่งมอบ+แนบเอกสาร/รูป (เข้า DMS) → นัดตรวจ → ผ่าน→อนุมัติจ่าย (หัก retention) → AP | ตีกลับ→Defect list (ข้อ+รูปก่อน/หลัง+กำหนดแก้) → แก้→ตรวจซ้ำ→ปิด
- **ศูนย์ตรวจรับ** (acceptance center) — รวมตรวจรับทุกชนิด (GR ตีกลับ/งวดงาน/บ้านลูกค้า) + เชื่อม: Mobile โฟร์แมน, ศูนย์แจ้งเตือน, Dashboard ผู้บริหาร, Audit log, Reports hub, DMS (เอกสาร defect)

## 6) PM · CMMS (pm*.jsx)

- สัญญา: wizard เลือกโครงการก่อน (หรือเพิ่มโครงการ manual) → รายละเอียด (ลูกค้า/ไซต์/ขอบเขต filter ตามโครงการ) · โหมด **MA ตามเงื่อนไข | รายครั้ง n ครั้ง/ปี → auto-gen ใบงานลงปฏิทิน** · หน้าแรกแสดงเป็นโครงการ→คลิกเห็นสัญญาภายใน→คลิกดูสัญญา · แก้ไขสัญญาได้ · ต่ออายุ
- Dashboard: KPI + **ปฏิทิน PM คลิกวันกรองงาน** + แผนที่จะถึง (ไม่มีกราф) · ทะเบียนอุปกรณ์ type-aware + เพิ่ม/detail→สร้างใบงาน
- ใบงาน (Maxtech): check-in GPS → checklist (เลือก template ตั้งค่าได้ ตอนสร้างเลือกก่อน) รายข้อ รูปก่อน→ผล Normal/ปรับตั้ง/เปลี่ยน-ซ่อม→รูป/วิดีโอหลัง → สาเหตุ/แก้ไข/ข้อเสนอแนะ+อะไหล่ → ปิดงาน+ลายเซ็น → ใบรับรอง→LINE · อะไหล่→ใบเสนอราคา→ลูกค้าอนุมัติผ่าน LINE

## 7) การเงิน-บัญชี (finance.jsx, gl.jsx, bank.jsx, tax.jsx, fa.jsx, labor.jsx, opex.jsx, etax.jsx, acct-*.jsx)

- **AP**: ตั้งหนี้ 3-way match → PV (WHT → 50 ทวิอัตโนมัติ) → อนุมัติ → `openBatchConfirm` Export to Bank (ล็อก PV)
- **AR**: invoice (เครดิตเทอม/VAT) → e-Tax queue (`etax.jsx`: ส่งสรรพากร mock สถานะส่ง/ตีกลับ) → RV รับชำระ → `openReceiveForm`
- **GL**: Posting Inbox (ตรวจ+post → gen JV, filter, post ทีละชุด) · JV manual (`JVCreateForm` dr=cr validate) · ผังบัญชี tree · งบทดลอง/งบการเงิน/P&L รายโครงการ (drill ต่อโครงการ)/กระแสเงินสด/Revenue recognition (%completion+WIP) · ปิดงวด (เช็คเงื่อนไข → ล็อกย้อนหลัง)
- **Bank**: ทะเบียนเช็ค (`openChequeForm`) · นำเข้า statement (`openBankImport`) → auto-match + `openBankMatch` จับคู่มือรายตัว → ปิดกระทบยอด
- **FA**: ทะเบียน (เพิ่ม/แก้ `openAssetEditForm`: CC/อายุ→คิดค่าเสื่อมใหม่ prospective) · run ค่าเสื่อมรายเดือน→JV · ปรับมูลค่า/Write-off
- **ค่าแรง (labor)**: คนงาน/ลงเวลา(OT)/จ่ายค่าแรงรายงวด → ลงต้นทุนโครงการ+JV
- **OPEX**: งบสำนักงานรายแผนก/เดือน + เทียบหลายปี + เข้า Reports hub
- **ภาษี**: ภ.พ.30 รายงานซื้อ-ขาย, ภ.ง.ด.3/53 + ใบ 50 ทวิ

## 8) ที่ดิน / โซลาร์ / ขาย

- **ที่ดิน (land*.jsx)**: kanban 7 ขั้น (เลื่อนขั้น/คลิกการ์ด detail) · Land Bank (โฉนด/เนื้อที่ไร่-งาน-วา/GPS/ราคา, เพิ่มแปลง) · สำรวจ+Feasibility (type-aware: โซลาร์ irradiance/ระยะสายส่ง → MWp/ROI, อสังหาฯ → ยูนิต) + **ดึง Cost Center บันทึกค่าสำรวจ** · DD checklist 7 ข้อ (toggle ผ่าน/ติด/รอ) · ซื้อ (มัดจำ/นัดโอน/ค่าธรรมเนียม+ภาษีธุรกิจเฉพาะ) | เช่า (25-30ปี escalation จดทะเบียน>3ปี) — ร่างสัญญา+ยืนยัน modal จริง
- **โซลาร์ (solar.jsx)**: Monitoring inverter real-time + ใบงาน O&M (`openOMTicketForm` สร้าง/ดู/ปิด) · PPA วางบิลรายเดือน (`openInvoiceForm`) · ROI (CAPEX/payback/IRR/cashflow) · Permit (`openPermitForm`) · Warranty (`openWarrantyForm`)
- **ขาย (sales-*.jsx)**: CRM pipeline → จอง→สัญญา→ดาวน์รายงวด→สินเชื่อ→ตรวจรับบ้าน(Defect loop)→โอน → After-sales แจ้งซ่อม · แนบสำเนาบัตร/โฉนด (`openAttachModal`)

## 9) ระบบกลาง + Mobile + LINE

- **DMS (dms.jsx)**: 6 หมวด rail + ตาราง (เวอร์ชัน timeline v1..n, เตือนหมดอายุ 60 วัน, ลิงก์กลับโมดูล) + อัปโหลด · ทุกโมดูลแนบไฟล์เข้าอัตโนมัติ
- **ศูนย์แจ้งเตือน / ศูนย์รายงาน / Audit log / ตั้งค่า / Login** (auth.jsx: login+ลืมรหัส 3 ขั้น+สมัครทดลอง wizard)
- **Executive Dashboard** — type-aware KPI (โซลาร์=MWp/PR/รายได้ไฟ/payback · โยธา-บริการ=งบ/คืบหน้า/milestone)
- **Mobile (mobile-*.jsx)** — phone mockup + หมวด: อนุมัติเอกสาร, แจ้งซ่อม (ลูกบ้าน/ช่าง), **E·งาน PM ช่าง 5 จอ** (งานของฉัน→checkin GPS→checklist ก่อน/ผล/หลัง→บันทึก→ปิดงาน+ลายเซ็น), สโตร์ (รับของ/เบิก/นับสต็อก), โฟร์แมน (ตรวจรับงวด+defect+ถ่ายรูป)
- **LINE OA (line-oa.jsx, line-pm.jsx)** — 16 จอ (บิล/นัด/แจ้งซ่อม/งวดดาวน์/... + PM 4 จอ: แผน+ประวัติ, อนุมัติใบเสนอราคา, ใบรับรองผล, สัญญา) + Rich Menu 7 ปุ่ม

---
### กติการวมที่ Claude Code ต้อง implement เสมอ
1. ทุก mutation → AuditLog · 2. ทุกไฟล์แนบ → DMS พร้อม link_module · 3. เอกสารเงินทุกใบ → GL Posting → JV · 4. สถานะเอกสาร: draft→pending(ขั้นตาม matrix)→approved|rejected · 5. โควต้า/เมนูตรวจที่ middleware (402 + upgrade_url) · 6. ตัวเลขเงิน tabular-nums ชิดขวา · 7. Empty/Loading state ทุกหน้า · 8. i18n 4 ภาษา + RTL

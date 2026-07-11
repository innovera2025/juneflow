# MOCK-DATA.md — สำรวจ mock data ใน prototype (pototype/*.jsx + pototype/wat/*.jsx)

- ขอบเขต: ไฟล์ `.jsx` ทั้งหมดใน `pototype/` และ `pototype/wat/` (สแกน const array/object ของ record ทุกตัว)
- เอกสารเทียบ: `design_handoff_juneflow/data-dictionary.html`
- รูปแบบอ้างอิง: `ไฟล์:บรรทัด` ตามตำแหน่งประกาศตัวแปร
- หมายเหตุ: บันทึกเฉพาะสิ่งที่มีอยู่ในโค้ดจริง ณ วันที่สำรวจ (2026-07-06)

---

## 1. Platform / Tenant / Subscription

| ไฟล์:บรรทัด | ตัวแปร | Entity | จำนวน | ฟิลด์หลัก |
|---|---|---|---|---|
| company-accept.jsx:6 | `COMPANIES` | บริษัทในเครือ (multi-company) | 3 | id, name, short, taxId, color, docPrefix, biz |
| company-accept.jsx:108 | `ACCEPT_ITEMS` | เอกสารรออนุมัติข้ามบริษัท | 10 | type, doc, title, project, owner, value, wait, due, docs |
| subscription-admin.jsx:5 | `SUBSCRIBERS` | ผู้เช่าระบบ (tenant + subscription) | 9 | id, org, pkg, cycle, status, projects, users, mrr, since, renew |
| subscription-admin.jsx:19 | `COMPANY_USERS` | ผู้ใช้ของ tenant "T-1001" | 12 (+ generator สร้างที่เหลือ runtime) | name, email, role, last, status |
| subscription-admin.jsx:194 | `inv` | Platform Invoice | 5 | no, org, date, amount, status (paid/pending/overdue) |
| subscription-admin.jsx:60 | `MONTHS` | ข้อมูลกราฟ MRR รายเดือน | 6 | m, v |
| subscription.jsx:6 | `SUB_PACKAGES` | Package | 3 (starter/pro/enterprise) | id, name, price, yearly, limits{projects,users,storage,ai}, modules[], modLabel |
| subscription.jsx:26 | `MY_SUB` | Subscription ของ tenant ปัจจุบัน | 1 (object) | pkg, cycle, status, start, renew, daysLeft, usage{projects,users,storage,ai} |
| subscription.jsx:31 | `SUB_INVOICES` | ใบแจ้งหนี้ subscription ของ tenant | 3 | no, date, desc, amount, status |
| pkg-builder.jsx:27–29, 275 | `S/M/L` (derive), `PKG_SUB_RULES` | เมนูต่อ package + sub rules | กติกา ไม่ใช่ record | PKG_SUB_RULES = { "master.ptype": [Full], "boq.aiqto": [M,L,Full] } |

**เทียบ data dictionary**
- Company: dictionary กำหนด `name / tax_id / address, subscription_id, status` — mock ไม่มี address, subscription_id, status; มีฟิลด์เกิน short, color, docPrefix, biz
- Package: dictionary กำหนด 4 ระดับ S/M/L/Full (2900/7900/14900/ติดต่อ) — mock `SUB_PACKAGES` มี 3 ระดับ starter(2900)/pro(7900)/enterprise(null) ไม่มีระดับ 14900; แต่ pkg-builder.jsx ใช้ชื่อชั้น S/M/L ตรงกับ dictionary และ `PKG_SUB_RULES` ตรงกับ sub_rules (ptype→Full, aiqto→M+)
- limits: mock ใช้ key `storage, ai` — dictionary ใช้ `storage_gb, ai_per_month` (ความหมายเดียวกัน ชื่อต่าง)
- Subscription: mock `SUBSCRIBERS` รวมข้อมูล company+subscription ไว้แถวเดียว (org เป็นชื่อ ไม่ใช่ company_id/package_id); มี renew, cycle, status ตรง dictionary; ฟิลด์เกิน mrr, projects, users
- PlatformInvoice: mock `inv` ใช้ org (ชื่อ) แทน subscription_id; amount, status ตรง
- AiUsage (company_id, month, used): **ไม่มี mock เป็น record** — มีเพียงตัวเลข `MY_SUB.usage.ai`

## 2. User / Role

| ไฟล์:บรรทัด | ตัวแปร | Entity | จำนวน | ฟิลด์หลัก |
|---|---|---|---|---|
| master.jsx:895 | `ROLE_PRESETS` | Role + สิทธิ์ | 8 role | name, c(จำนวนผู้ใช้), authLimit, level, perms[11 โมดูล][5 สิทธิ์ ดู/สร้าง/แก้ไข/อนุมัติ/ยกเลิก] |
| subscription-admin.jsx:19 | `COMPANY_USERS` | User (ดูตาราง ข้อ 1) | 12 | name, email, role, last, status |

**เทียบ data dictionary**
- User: dictionary `email, name, role_id, status` — mock ใช้ role เป็นข้อความ ไม่ใช่ role_id; ฟิลด์เกิน last
- Role: dictionary `Role.approval_limits` (json เพดานต่อชนิดเอกสาร) — mock มี authLimit ค่าเดียว + perms matrix 11×5 (dictionary ไม่ได้ระบุ perms matrix)

## 3. โครงการ / Master

| ไฟล์:บรรทัด | ตัวแปร | Entity | จำนวน | ฟิลด์หลัก |
|---|---|---|---|---|
| chrome.jsx:3 | `PROJECTS` | Project (+ Phase ซ้อน) | 7 โครงการ / 16 phase | id, name, short, units, color, type(realestate/solar/civil/service), phases[{id,l,units,sold,active,status}] |
| project-types.jsx:6 | `PROJECT_TYPES` | ProjectType | 4 | id, name, nameEn, icon, color, desc, hierarchy[], costTypes[], modules{} |
| master.jsx:7 | `ORG_SEED` | โครงสร้างองค์กร (บริษัท/ฝ่าย/ทีม) | 10 | lvl, ic, name, code, note |
| master.jsx:240 | `BLOCK_SEED` | Block | 3 | code, name, model, units, sold, built, color |
| master.jsx:426 | `MODELS` | แบบบ้าน (Model) | 5 | code, type, area, bed, bath, parking, count, price, status, color |
| master.jsx:584 | `CC_SEED` | Cost Center | 7 | code, name, type(Project/Overhead/Dept), link, owner, budget, status |
| master.jsx:737 | `DOCNUM_SEED` | เลขที่เอกสาร (running number) | 10 | type, prefix, running, reset, lock |
| boq.jsx:950 | `COST_CENTERS` | Cost Center (ชุดย่อในฟอร์ม BOQ) | 7 | code, name |
| master-party.jsx:6 | `VENDOR_SEED` | Vendor | 6 | code, name, type(วัสดุ/รับเหมา/บริการ), taxId, addr, term, bank, status, spend |
| master-party.jsx:18 | `CUSTOMER_SEED` | Customer | 6 | code, name, type(บุคคล/นิติบุคคล/หน่วยงานรัฐ), taxId, addr, project, value, status |
| sales-process.jsx:24 | `units` | Unit (สร้างด้วยโค้ด runtime) | 84 | code, status(soldBuilt/sold/booked/built/empty) เท่านั้น |

**เทียบ data dictionary**
- Project: dictionary `name, type, budget, status` — mock ไม่มี budget, status ระดับโครงการ (status อยู่ที่ phase บางแถว); ฟิลด์เกิน units, color, short, phases ซ้อน
- ProjectType: hierarchy + modules ตรง dictionary; ฟิลด์เกิน costTypes, icon, color, desc, nameEn
- Phase/Block/Unit: dictionary กำหนด tree `parent_id + model_id + สถานะขาย` — mock แยกเป็น phases ใน PROJECTS, BLOCK_SEED, MODELS โดยไม่มี parent_id/model_id เป็น FK (ผูกด้วยข้อความ); Unit ไม่มี record จริง มีแต่ generate 84 ยูนิต (code+status)
- CostCenter: dictionary `code, name, project_id` — mock ไม่มี project_id (ใช้ข้อความ link); ฟิลด์เกิน owner, budget, type, status
- Vendor/Customer: ตรงแนว dictionary (master แยก vendor/customer, มี flag ประเภท); dictionary ไม่ได้ระบุฟิลด์ละเอียด — mock มี taxId, addr, term, bank, spend/value เพิ่ม
- ORG_SEED (โครงสร้างองค์กร) และ DOCNUM_SEED (เลขรันเอกสาร): **ไม่มี entity นี้ใน data dictionary**

## 4. BOQ / BOM / AI QTO

| ไฟล์:บรรทัด | ตัวแปร | Entity | จำนวน | ฟิลด์หลัก |
|---|---|---|---|---|
| boq-list.jsx:7 | `docs` | BOQDoc | 6 | no, name, project, phase, block, scope, value, status, ver, owner, updated, level |
| boq.jsx:317 | `INITIAL_GROUPS` | กลุ่มงาน BOQ | 6 | id, label |
| boq.jsx:326 | `INITIAL_ROWS_BY_GROUP` | BOQItem | 21 แถว / 6 กลุ่ม | id, code, cat(M/L/S), name, detail, costName, qty, unit, price |
| boq.jsx:237 | `BOQ_BALANCE` | ยอดคงเหลือ BOQ (ตัด PR) | 8 | group, code, cat, name, unit, boqQty, used, balQty, boqV, usedV, balV, pct |
| boq.jsx:1069 | `APPROVAL_LIST` | BOQ รออนุมัติ (revise) | 4 | no, title, project, v, change, pct, by, age, summary, prev, next, files |
| boq.jsx:1099 | `DIFF_ROWS` | รายการ diff ระหว่างเวอร์ชัน | 6 | kind, cat, code, name, col, before, after, qty, deltaV |
| boq.jsx:1454 | `ARCHIVE` | BOQ เวอร์ชันเก่า | 5 | no, title, v, value, by, date, status, attach, revises, history |
| boq-extra.jsx:7 | `CBS_BUDGET` | CBSBudget รายหมวด | 6 กลุ่ม | budget, used, committed |
| boq-extra.jsx:17 | `BOQ_AUDIT` | audit trail การแก้ BOQ | 5 | who, role, at, act, what, detail, tone |
| bom.jsx:22 | `BOM_MODELS` | BOM ต่อแบบบ้าน | 4 | code, type, area, units, color, status, ver, updated |
| bom.jsx:30 | `BOM_LINES` | รายการ BOM (มีเฉพาะ "B-1") | 17 แถว | cat(M/S/L), code, name, detail, unit, qty, price |
| ai-qto.jsx:32 | `QTO_ROWS_SEED` | ผลถอดปริมาณ AI QTO | 10 | id, elem, code, name, unit, qty, price, cat, conf, eid |
| ai-qto.jsx:22 | `QTO_ELEMENTS_FOUND` | element ที่ AI พบ | 6 | k, n, conf |
| ai-qto.jsx:6 / :14 | `QTO_FILETYPES` / `QTO_PROC_STEPS` | config ชนิดไฟล์ / ขั้นประมวลผล | 5 / 5 | ext, acc, note / l, ic |
| ai-qto-viewer.jsx:23 | `QTO_LAYERS` | เลเยอร์ viewer | 6 | id, label, color, cat |
| linked-docs.jsx:4 | `LINKED_DOCS` | เอกสารอ้างถึง BOQ item (PR/PO/WO/GR) | 8 รหัส BOQ / 20 เอกสาร | kind, no, title, amount, date, status, goTo |
| boq-list.jsx:264 / :391 | `TEMPLATES` / `sample` | เทมเพลตสร้าง BOQ / แถวตัวอย่าง import | 4 / 4 | v,l,d,icon / gb,mc,mn,det,cc,cn,q,u,p,t |

**เทียบ data dictionary**
- BOQDoc: `no, name, scope, version(ver), status` ตรง; ฟิลด์เกิน project/phase/block/value/owner/level (dictionary ผูก BOQDoc→Project ผ่าน FK, mock ใช้ข้อความ)
- BOQItem: dictionary `code, name, cat, qty, unit, price, cc_id` — mock ใช้ costName (ข้อความ) แทน cc_id; ไม่มี `remain_qty` ในแถว item (ยอดคงเหลือแยกไปอยู่ `BOQ_BALANCE`); `element_id` มีเฉพาะฝั่ง AI QTO (ฟิลด์ `eid` ใน QTO_ROWS_SEED)
- cat M/L/S ตรง dictionary (M วัสดุ / L ค่าแรง / S เหมา)
- CBSBudget: `budget, used, committed` ตรง dictionary (key เป็นรหัสกลุ่ม = group_id)
- BOM: dictionary กล่าวถึงเพียง "Item ← BOM template ได้" ไม่ระบุฟิลด์ — mock มีโครง BOM_MODELS + BOM_LINES (ข้อมูลรายการมีเฉพาะแบบ B-1)

## 5. จัดซื้อ — PR / PO / WO / GR

| ไฟล์:บรรทัด | ตัวแปร | Entity | จำนวน | ฟิลด์หลัก |
|---|---|---|---|---|
| pr-list.jsx:11 | `PR_ROWS` | PR | 10 | no, type(material/subcon/expense/advance), title, project, phase, amount, vendor, requester, date, status, step, totalSteps, urgent, budget |
| pr-form.jsx:72 / :79 | `ITEMS` / `APPROVERS` | รายการใน PR / สายอนุมัติ | 4 / 4 | code,name,unit,qty,price,boq,remark / name,role,dept,status,time,note |
| forms.jsx:134 / :375 / :579 | `PR_FOR_PO` / `PO_FOR_GR` / `BOQ_ITEMS_FOR_PR` | ตัวเลือกในฟอร์ม | 3 / 3 / 4 | no,title,amount,items / no,kind,vendor,balance,amount / code,name,unit,price,bal |
| po-wo.jsx:3 | `PO_ROWS` | PO | 6 | no, vendor, refPR, project, amount, downPct, downPaid, paid, gr, status, date, active |
| po-wo.jsx:272 | `WO_ROWS` | WO | 5 | no, subcon, scope, project, amount, downPct, gist, retention, status, active |
| gr.jsx:3 | `GR_ROWS` | GR | 5 | no, ref, refKind(PO/WO), vendor, items, qty, pct, amount, date, by, status, complete, active |
| gr.jsx:11 | `RETURN_ROWS` | ใบตีกลับ/คืนของ | 3 | no, grRef, vendor, reason, qty, amount, date, status |
| real-forms.jsx:179 | `items` | BOQ item ในฟอร์ม PR (มี remain) | 5 | code, n, u, p, remain |
| real-forms2.jsx:394 | `rows` | ตารางเทียบราคาผู้ขาย (bid compare) | 3 | v, p12, p16, credit, ship, score, best |
| mobile-field.jsx:7 / :39 / :94 | `pos` / `items` / `works` | PO รอรับของ / รายการรับ / งวดงานหน้างาน (mobile) | 3 / 3 / 4 | no,vendor,items,due,truck,urgent / n,ordered,unit / n,base |

**เทียบ data dictionary**
- PR: dictionary `no, type, project_id, need_date, status, approval_step` — mock ใช้ date (ไม่มี need_date แยก), step/totalSteps ≈ approval_step, project เป็นชื่อไม่ใช่ project_id; type 4 ค่าตรง dictionary; ฟิลด์เกิน title, vendor, requester, urgent, budget
- PO: dictionary `vendor_id, total, vat, credit_term` — mock ไม่มี vat, credit_term ในแถว PO (vendor เป็นชื่อ); ฟิลด์เกิน downPct, downPaid, paid, gr
- GR: dictionary `po_id, received, rejected, photos[]` — mock ไม่มี photos[], rejected ในแถว (การตีกลับแยกเป็น `RETURN_ROWS`); มี ref/refKind ชี้ PO หรือ WO
- VariationOrder: ดูข้อ 6 (`VARIATIONS` ใน subcon.jsx)
- ตารางเทียบราคาผู้ขาย (real-forms2): **ไม่มี entity นี้ใน dictionary**

## 6. ผู้รับเหมา / ตรวจรับ

| ไฟล์:บรรทัด | ตัวแปร | Entity | จำนวน | ฟิลด์หลัก |
|---|---|---|---|---|
| subcon.jsx:3 | `SUBCONS` | ทะเบียนผู้รับเหมา | 6 | id, name, type, contracts, totalValue, paid, retention, completion, status, active, contact, since, project |
| subcon.jsx:14 | `PROGRESS_PAYMENTS` | งวดงาน (จอเบิกงวด) | 5 | no, l, pct, status, v, paid, gr, date, retention |
| subcon.jsx:22 | `VARIATIONS` | Variation Order | 2 | no, date, reason, type, value, status |
| subcon-accept.jsx:8 | `SUBC_CONTRACTS` | SubconContract + WorkPeriod ซ้อน | 4 สัญญา / 16 งวด | no, subcon, project, scope, method(percent/distance/milestone/unit), value, retentionPct, signed, po, status, periods[{no,l,pct/qty,value,state,gr,date,defect,inspectCount}] + unit,totalQty,ratePerUnit,perPeriodQty,doneQty (แบบ distance/unit) |
| subcon-accept2.jsx:145 | `SUBC_DMS_DOCS` | ไฟล์เอกสารแนบต่อสัญญา | 3 สัญญา + default (ชื่อไฟล์ 3+3+3+2) | ชื่อไฟล์ (string) |
| company-accept.jsx:108 | `ACCEPT_ITEMS` | งานรอตรวจรับ/อนุมัติ (รวมหลายชนิด) | 10 | type, doc, title, project, owner, value, wait, due, docs |

**เทียบ data dictionary**
- Contract: dictionary `no, value, retention_pct, start, end` — mock มี signed (วันเซ็น) แต่ไม่มี start/end แยก; มี po, method เพิ่ม
- WorkPeriod: dictionary `seq, basis(percent|distance|milestone), target, pct, amount, status(pending|delivered|inspecting|passed|rejected|paid)` — mock มี basis เพิ่มค่า `unit` (เหมาต่อหลัง) ที่ dictionary ไม่มี; ค่า state ใน mock = `accepted | requested | pending | rejected` ไม่ตรงชุดค่าใน dictionary (ไม่มี delivered/inspecting/paid)
- Acceptance: dictionary `inspector, photos[], docs[], signed_at` — **ไม่มี record mock**; มีเพียงฟอร์ม `AcceptForm` (checklist + photos + measured) ที่กรอก runtime
- Defect: dictionary `item, severity, before/after_photo, due, status` — **ไม่มี record mock แยก**; มีเพียงข้อความ `defect` + `inspectCount` ในงวดที่ถูกตีกลับ (WO-2026-0055 งวด 3)
- VariationOrder: dictionary `dir(add|cut), amount, reason` — mock ใช้ type ≈ dir, value ≈ amount; มี reason ตรง

## 7. PM (CMMS)

| ไฟล์:บรรทัด | ตัวแปร | Entity | จำนวน | ฟิลด์หลัก |
|---|---|---|---|---|
| pm.jsx:61 | `PM_CONTRACTS` | PMContract | 5 | no, project, customer, site, scope, cycle, sla, start, end, value, status |
| pm.jsx:7 | `PM_ASSETS_BY_TYPE` | PMAsset (แยกตาม project type) | 16 (realestate 6 / solar 5 / civil 3 / service 2) | id, name, kind, site, cycle, last, next, status(ok/due/overdue), contract |
| pm.jsx:47 | `PM_WOS` | PMWorkOrder | 6 | no, asset, assetName, type, contract, site, zone, tech, date, status, sla |
| pm.jsx:40 | `PM_MONTHLY` | กราฟแผน/ทำจริงรายเดือน | 6 | m, plan, done |
| pm-checklist.jsx:6 | `PM_CHECKLIST_TEMPLATES` | ChecklistTemplate | 5 | id, name, kind, items[] |
| pm2.jsx:541 | `PM_PLAN_ITEMS` | แผน PM รายปฏิทิน | 6 | date, asset, name, cycle, status, day |
| pm3.jsx:6 | `PM_CHECKLIST` | checklist ในใบงาน (object ต่อชนิด) | object | รายการตรวจต่อ kind |
| mobile-pm.jsx:9 | `jobs` | ใบงาน PM ฝั่งช่าง (mobile) | 4 | no, asset, name, site, dist, time, urgent, status, type |

**เทียบ data dictionary**
- PMContract: dictionary `mode(MA|per-visit), visits_per_year, sla, value, end` — mock ไม่มี mode, visits_per_year (มี cycle แทน); sla, value, start, end มี
- PMAsset: dictionary `kind, site, cycle, next_due` — ตรง (next); ฟิลด์เกิน last, status, contract; type-aware ตรงคำอธิบาย dictionary
- PMWO: dictionary `tech, checkin_gps, items[{label,result,before,after}], cause, fix, advice, customer_sign` — mock `PM_WOS` มีเฉพาะ tech + header; ไม่มี checkin_gps, items[], cause, fix, advice, customer_sign เป็นข้อมูล (checklist อยู่ใน PM_CHECKLIST/ฟอร์ม, กรอก runtime)
- ChecklistTemplate: `kind, items[]` ตรง dictionary

## 8. การเงิน-บัญชี (AP / AR / GL / Bank / FA / e-Tax / Petty / OPEX / Labor)

| ไฟล์:บรรทัด | ตัวแปร | Entity | จำนวน | ฟิลด์หลัก |
|---|---|---|---|---|
| ap.jsx:3 | `AP_BILL` | APBilling (ตั้งหนี้) | 5 | no, vendor, ref, inv, amount, vat, wht, due, status, aging |
| ap.jsx:160 | `PV_LIST` | PV (ใบสำคัญจ่าย) | 4 | no, payee, ref, amount, method, chequeNo, chequeBank, net, wht, retention, status, date |
| finance.jsx:7 | `AP_INVOICES` | AP invoice (จอ finance เก่า) | 6 | no, vendor, po, amount, due, days, tax, status, aging |
| ar.jsx:7 | `AR_INV` | ARInvoice | 6 | no, customer, unit, phase, amount, vat, retention, due, days, status |
| finance.jsx:135 | `AR_CUSTOMERS` | ลูกหนี้รายลูกค้า | 5 | name, unit, ref, contract, paid, balance, due, aging, phase, overdue |
| accounting-extra2.jsx:107 | `ARCN_SEED` | ใบลดหนี้ AR (Credit Note) | 3 | no, customer, ref, reason, amount, status, date |
| gl.jsx:7 | `JV_LIST` | JV | 7 | no, date, desc, source, amount, status, lines (เป็น "จำนวนบรรทัด" ตัวเลข) |
| gl.jsx:219 | `POST_INBOX` | posting inbox (เอกสารรอลง GL) | 7 | src, no, desc, time, amount, by, status, jv |
| gl.jsx:494 | `TRIAL` | งบทดลอง | 14 | code, name, carry, dr, cr |
| gl.jsx:742 | `checklist` | checklist ปิดงวด | 10 | l, done, note |
| finance.jsx:231 | `GL_ENTRIES` | รายการ GL (จอเก่า) | 5 | no, date, desc, drAccount, crAccount, amount, by, source |
| accounting-extra.jsx:7 / :14 | `COA_CLASSES` / `COA_SEED` | ผังบัญชี (COA) | 5 class / 23 บัญชี | id,name,nature / code, name, cls, group, bal, active |
| accounting-extra.jsx:168 / :175 | `AGING_AP` / `AGING_AR` | รายงาน aging | 5 / 5 | name, cur, b30, b60, b90, over, docs |
| accounting-extra.jsx:279 / :285 | `REVREC_SEED` / `WIP_SEED` | รับรู้รายได้ / WIP | 4 / 3 | proj, method, contract, pct, recognized, billed, posted / proj, mat, sub, oh, transferred |
| accounting-extra2.jsx:6 | `RETENTION_SEED` | เงินประกันผลงาน (retention ledger) | 4 | wo, vendor, scope, contract, rate, withheld, returned, due, status |
| accounting-extra2.jsx:343 | `PROJPL_SEED` | P&L รายโครงการ | 5 | proj, type, revenue, cogs, sga, interest |
| accounting-extra2.jsx:226 | `CASHFLOW_DATA` | กระแสเงินสด (ชุดข้อมูลกราฟ) | object | — |
| bank.jsx:84 | `STMT` | BankStatement (จับคู่ reconcile) | 8 | date, desc, v, matched |
| fa.jsx:3 | `ASSETS` | FixedAsset | 8 | code, name, cat, buy, depr, book, life, lifeY, date, status, noDepr, loc, method, salvage, cc |
| fa.jsx:575 | `ADJ_ROWS` | ปรับปรุง/ตัดจำหน่ายทรัพย์สิน | 5 | no, k, asset, reason, before, after, diff, date, status |
| fa.jsx:245 | `sample` | แถวตัวอย่าง import FA | 4 | code, name, cat, buy, life, loc |
| etax.jsx:5 | `ETAX_SEED` | e-Tax queue | 6 | no, customer, taxId, desc, amount, date, channel, status(sent/pending/error/void), rd |
| petty-alloc.jsx:3 | `PETTY_TX` | Petty Cash transaction | 6 | no, type(claim/clear/topup), l, v, by, date, status, cat, ref |
| petty-alloc.jsx:123 | `ALLOC_CAT` | ปันส่วนต้นทุนรายหมวด | 6 | code, name, std, actual, diff, pct |
| labor.jsx:6 | `WORKERS_SEED` | Worker | 8 | id, name, team, type, wage, skill, active |
| opex-budget.jsx:5 / :38 / :222 | `OPEX_SEED` / `OPEX_MONTHLY` / `OPEX_HISTORY` | OpexBudget | 6 แผนก / 6 เดือน / 6 แผนก | dept, budget, used, committed, cats / m, plan, act / dept, vals[] |
| tax-forms.jsx:529 | `types` | ชนิดแบบภาษี (UI) | 7 | i, l |

**เทียบ data dictionary**
- APBilling/PV: dictionary `3-way match (po,gr,inv), wht_pct, net, batch_id` — mock AP_BILL มี ref+inv (ไม่มีอ้าง gr ชัดเจน), มี wht; PV_LIST มี net, wht, cheque; **ไม่มี batch_id (Export to Bank)** ในทั้งสองชุด
- ARInvoice: dictionary `credit_term, vat, etax_status` — mock ไม่มี credit_term, etax_status ในแถว AR (สถานะ e-Tax แยกอยู่ ETAX_SEED); vat มี; ใบลดหนี้ ARCN_SEED ไม่มีระบุใน dictionary (dictionary กล่าวถึงเฉพาะ ARInvoice/RV)
- JV: dictionary `lines[{account_id, dr, cr, cc_id, project_id}]` — mock `JV_LIST.lines` เป็นแค่ตัวเลขจำนวนบรรทัด **ไม่มีข้อมูลบรรทัด DR/CR จริง**; GL_ENTRIES (finance.jsx) มี drAccount/crAccount เป็นข้อความ 1 คู่ต่อรายการ
- GLAccount: COA_SEED 23 บัญชี + 5 class ตรงแนว "ผังบัญชีมาตรฐาน" (mock ไม่มีโครง tree parent จริง ใช้ cls+group)
- Cheque: ไม่มีทะเบียนเช็คแยก — ข้อมูลเช็คฝังใน PV_LIST (chequeNo, chequeBank); BankStatement/Reconcile มี STMT (matched boolean) ตรงแนว dictionary
- FixedAsset: dictionary `cost, life_years, cc_id, depr_method` — ตรง (buy≈cost, lifeY, method, cc); ฟิลด์เกิน depr, book, salvage, loc, noDepr
- Labor: dictionary `Worker/Attendance/Payroll` — mock มีเฉพาะ Worker (WORKERS_SEED); **Attendance และ Payroll ไม่มี record** (labor.jsx มีเพียง ATT_OPTS ตัวเลือกสถานะ)
- OpexBudget: dictionary `dept, year, months[]` — OPEX_SEED ไม่มี year/months ในแถว (แยกเป็น OPEX_MONTHLY กลาง 1 ชุด + OPEX_HISTORY รายปีต่อแผนก)
- e-Tax: dictionary ระบุ etax_status `queued|sent|rejected` — mock ใช้ `sent|pending|error|void` (ชุดค่าต่างกัน)
- Retention ledger, RevRec, WIP, P&L โครงการ, Aging, ปันส่วนต้นทุน (ALLOC_CAT): **ไม่มีเป็น entity ใน dictionary** (เป็นข้อมูลจอรายงาน)

## 9. ที่ดิน / ขาย / CRM / บริการหลังการขาย / Solar

| ไฟล์:บรรทัด | ตัวแปร | Entity | จำนวน | ฟิลด์หลัก |
|---|---|---|---|---|
| land.jsx:17 | `LAND_PLOTS` | LandPlot | 8 | id, title, deed, tambon, amphoe, prov, rai, ngan, wa, gps, pricePerRai, stage, tenure, project, owner |
| land.jsx:6 | `LAND_STAGES` | ขั้น pipeline ที่ดิน | 7 | id, label, color |
| land2.jsx:129 | `DD_ITEMS` | Due Diligence checklist | 7 | k, note, st(pass/issue/wait) |
| sales-crm.jsx:191 | `LEADS_BY_STAGE` | Lead/CRM (5 stage) | 10 (lead 4, visit 2, quote 2, booking 1, contract 1) | id, name, phone, source, interest, hot, lastContact, note, owner, days |
| sales-crm.jsx:217 | `stages` | stage funnel | 5 | id, l, c |
| sales-process.jsx:24 | `units` | SalesUnit (generate runtime) | 84 | code, status เท่านั้น |
| sales-service.jsx:3 | `SERVICE_TICKETS` | ใบแจ้งซ่อมหลังการขาย | 7 | no, unit, customer, channel, category, title, prio, status, assignee, date, scheduled, warranty |
| solar.jsx:26 / :34 / :111 / :169 / :224 / :270 | `inverters` / `tickets` / `rows` / `years` / `steps` / `items` | O&M inverter / ticket / ใบแจ้งหนี้ขายไฟ PPA / ROI รายปี / ขั้นขออนุญาต / ทะเบียน warranty | 6 / 3 / 5 / 6 / 6 / 4 | id,zone,kw,out,perf,status,temp / no,t,pri,who,st / m,mwh,rate,amt,st / y,rev,opex,cum / n,org,st,date / item,brand,qty,perf,prod,exp,st |

**เทียบ data dictionary**
- LandPlot: dictionary `deed_no, area(rai-ngan-wa), gps, price_per_rai, stage, tenure` — **ตรงครบ** (deed, rai/ngan/wa, gps, pricePerRai, stage, tenure); stage 7 ขั้นตรงคำอธิบาย; DD checklist มี (DD_ITEMS); ฟิลด์เกิน tambon/amphoe/prov/project/owner/title
- SalesUnit: dictionary `unit_id, customer_id, stage, booking, contract, down[], loan, transfer` — mock ไม่มี record ตามโครงนี้; units ที่ generate มีแค่ code+status; ข้อมูล booking/contract/down กระจายอยู่ใน UI ของ sales-process.jsx (inline ในฟอร์ม ไม่ใช่ dataset)
- Lead/CRM (LEADS_BY_STAGE): **ไม่มี entity ใน dictionary**
- ใบแจ้งซ่อมหลังการขาย (SERVICE_TICKETS): **ไม่มี entity ใน dictionary** (dictionary ผูกตรวจรับบ้านกับ Defect ผ่าน SalesUnit)
- ข้อมูล Solar (PPA, ROI, permit, warranty, O&M ticket): **ไม่มี entity ใน dictionary** (dictionary มีเพียง modules om/ppa/roi/permit ใน ProjectType)

## 10. คลังวัสดุ (Inventory)

| ไฟล์:บรรทัด | ตัวแปร | Entity | จำนวน | ฟิลด์หลัก |
|---|---|---|---|---|
| inventory.jsx:3 | `ITEMS` | วัสดุคงคลัง | 8 | code, cat, name, unit, price, stock, low, status, wh |
| inventory.jsx:114 | `WH` | คลัง | 5 | name, items, value, alerts, util |
| inventory.jsx:206 | `TRANSFERS` | ใบโอนย้ายคลัง | 4 | no, from, to, items, qty, value, date, by, status |
| inventory.jsx:262 | `ISSUES` | ใบเบิก | 4 | no, proj, from, items, value, date, by, status |
| inventory.jsx:385 | `sample` | แถวตัวอย่าง import | 4 | code, name, cat, unit, price |

**เทียบ data dictionary** — **entity คลังวัสดุ (Item/Warehouse/Transfer/Issue) ไม่อยู่ใน data dictionary เลย** (dictionary ไม่มีหมวด Inventory)

## 11. DMS / Notification / Audit / Timeline / Dashboard

| ไฟล์:บรรทัด | ตัวแปร | Entity | จำนวน | ฟิลด์หลัก |
|---|---|---|---|---|
| dms.jsx:14 | `DMS_SEED` | Document | 13 | name, cat, proj, ver, by, date, size, status(active/review/expiring), link |
| dms.jsx:5 | `DMS_CATS` | หมวดเอกสาร | 7 | id, l, icon, color |
| chrome.jsx:634 | `NOTIFS` | Notification (topbar) | 5 | ic, c, t, title, sub, route |
| mobile.jsx:544 | `NOTIFS` | Notification (mobile) | 7 | t, title, by, body, kind, ic, color |
| extra-screens.jsx:159 | `NOTIFS` | Notification center | 10 | ic, tone, t, time, d, unread, r |
| exec-audit.jsx:162 | `AUDIT_ENTRIES` | AuditLog | 13 | t, d, user, role, mod, act, obj, detail |
| timeline.jsx:238 | `TIMELINE_TASKS` | งานในแผนงาน (Gantt) | 5 กลุ่ม / 13 งาน | group, color, tasks[{l, plan[], actual[], status, pct, late}] |
| timeline.jsx:264 | `MILESTONES` | milestone | 5 | l, day, date, status |
| dashboard.jsx:4 / :229 / :237 / :244 | `RANGE_DATA` / `approvals` / `phases` / `alerts` | ข้อมูลกราฟ / รออนุมัติ / เฟส / แจ้งเตือน (จอ dashboard) | object / 5 / 4 / 3 | — / kind,no,title,requester,amount,age,urgent / name,units,sold,built,budgetUsed,status / tone,title,sub,action |
| mobile.jsx:25 | `items` | กล่องอนุมัติ (mobile) | 5 | kind, no, title, requester, amount, age, urgent, project, overBudget, color |
| exec / boq-extra / subscription-admin ฯลฯ | ชุดตัวเลขกราฟ (data, rows, P, MONTHS, segs) | ข้อมูล chart | — | ตัวเลขกราฟ ไม่ใช่ record entity |

**เทียบ data dictionary**
- Document: dictionary `cat, project_id, version, expiry, link_module` — mock ไม่มีฟิลด์ expiry เป็นวันที่ (มีเพียง status "expiring"); link ≈ link_module; proj เป็นชื่อ
- Notification: dictionary `user_id, type, ref, read` — mock ทั้ง 3 ชุดไม่มี user_id; extra-screens มี unread ≈ read; ไม่มี ref เป็น FK (มี route/r เป็นเส้นทางหน้าจอ)
- AuditLog: dictionary `user, action, entity, before/after, ip, at` — mock ไม่มี before/after และ ip (ฝั่ง wat มี ip); user/role/act/obj/detail/เวลา มีครบ
- Timeline/Task: **ไม่มี entity แผนงาน (Task/Milestone) ใน dictionary**

## 12. แอป wat/ ("บุญบัญชี" — ระบบการเงินวัด แยกคนละระบบ)

ข้อมูลทั้งหมดอยู่ที่ `wat/data.jsx` (ประกาศแล้ว assign เข้า window):

| ตัวแปร | Entity | จำนวน | ฟิลด์หลัก |
|---|---|---|---|
| `TENANTS` | วัด (tenant) | 3 | id, name, branch, taxId |
| `FUNDS` | กองทุน | 6 | id, code, name, balance, color |
| `DONORS` | ผู้บริจาค | 5 | id, name, kind, phone, taxId, addr, contact, since, total, count, last, note |
| `RECEIPTS` | อนุโมทนาบัตร | 8 | no, donorId, donor, fund, amount, pay, ref, date, time, status(issued/waiting/void), by, rv, posted, dedicate |
| `LEDGER` | บัญชีแยกประเภทต่อกองทุน | 8 | no, date, fund, type(in/out), desc, amount, ref, status, by |
| `APPROVALS` | คำขอยกเลิก/แก้ไข | 4 | id, kind(void/correct), title, doc, amount, fund, reason, by, byRole, at, status, before/after |
| `AUDIT` | audit log | 8 | id, at, who, role, act, obj, detail, ip |
| `NUMBERING` | เลขรันเอกสาร | 4 | type, prefix, next, reset, lock |
| `ROLES` | บทบาท | 5 | id, name, desc, users, scope |
| `RECON` | กระทบยอดช่องทางรับเงิน | 4 | ch, expected, counted, status |
| `PAY` | ช่องทางชำระ | 4 | v, l |

**เทียบ data dictionary** — **ทั้งแอป wat/ ไม่อยู่ใน data dictionary ของ juneflow** (เป็น prototype คนละผลิตภัณฑ์)

## 13. ชุดข้อมูล config/UI (ไม่ใช่ record ของ entity)

- chrome.jsx: `NAV` (44 เมนู — id,icon,label), `ALL` (7 กลุ่ม filter)
- i18n.jsx / i18n-accounting.jsx / i18n-phrases*.jsx: `LANGS` (4 ภาษา), `DICT`, `NAV_I18N`, `PHRASES`, `MORE` — คำแปล ไม่ใช่ mock record
- ตัวเลือก dropdown/status map จำนวนมาก เช่น `PR_TYPES`, `TYPE_TABS`, `BOQ_STATUS_FILTER`, `RESET_OPTS`, `LOCK_OPTS`, `ATT_OPTS`, `MPM_RESULTS`, `RESULT_OPTS`, `ETAX_ST`, `SUB_ST`, `PM_STATUS`, `PMWO_STATUS`, `PMC_STATUS`, `PERIOD_STATE`, `SUBC_METHOD`, `DD_ST`, `LAND_STAGES` (กึ่ง master), `CAT`, `BOM_CAT`, `COA_CLASSES` (กึ่ง master), `ACT`, `ST` ฯลฯ
- ทะเบียนหน้าจอ: `LINE_SCREENS` (line-oa.jsx, 16), `MOBILE_GROUPS` (mobile-preview.jsx, 7), `REPORT_CATS` (extra-screens.jsx, 7 กลุ่ม)
- design-canvas.jsx `DC`, shell.jsx `ACCENT_PALETTES` — ธีม/แคนวาส

## 14. ไฟล์ .jsx ที่ไม่มี mock dataset เป็น const record

`app.jsx`, `ds.jsx`, `modal.jsx`, `datepicker.jsx`, `charts.jsx` (คอมโพเนนต์กราฟ), `shell.jsx` (มีเฉพาะ palette), `tweaks-panel.jsx`, `ios-frame.jsx`, `fiori-empty.js`, `fiori-loading.js`, `subscription-flow.jsx` (ฟอร์มสมัคร), `project-type-screen.jsx` (ฟอร์ม + label config), `ai-qto-fullscreen.jsx` (สร้าง geometry ด้วยโค้ด), `sales-process.jsx` (generate 84 units + ข้อมูล inline ใน JSX), `tax.jsx` (แถวแบบ ภพ.30/WHT เขียน inline ใน JSX), `line-pm.jsx` (ข้อมูล inline ใน JSX), `mobile-screens.jsx` (inline เล็กน้อย: jobs 4), `wat/core.jsx`, `wat/forms.jsx`, `wat/main.jsx`, `wat/screen-*.jsx` (ดึงจาก wat/data.jsx)

---

## สรุปสำหรับทำ seed data

รายการ entity ที่มี mock record ใช้ทำ seed ได้ (จำนวน record):

**Platform**
- Company (บริษัทในเครือ): 3 — company-accept.jsx `COMPANIES`
- Tenant/Subscriber: 9 — subscription-admin.jsx `SUBSCRIBERS`
- Package: 3 — subscription.jsx `SUB_PACKAGES` (+ กติกาเมนู S/M/L ใน pkg-builder.jsx)
- Platform Invoice: 5 — subscription-admin.jsx `inv`; Subscription Invoice ของ tenant: 3 — subscription.jsx `SUB_INVOICES`
- User: 12 — subscription-admin.jsx `COMPANY_USERS["T-1001"]`
- Role: 8 — master.jsx `ROLE_PRESETS` (พร้อม perms matrix 11×5)

**Master / โครงการ**
- Project: 7 (พร้อม 16 phase) — chrome.jsx `PROJECTS`
- ProjectType: 4 — project-types.jsx `PROJECT_TYPES`
- โครงสร้างองค์กร: 10 — master.jsx `ORG_SEED`
- Block: 3, Model: 5, Cost Center: 7, เลขรันเอกสาร: 10 — master.jsx
- Vendor: 6, Customer: 6 — master-party.jsx
- Unit: ไม่มี record (generate 84 ยูนิต code+status ใน sales-process.jsx)

**BOQ / จัดซื้อ**
- BOQDoc: 6 — boq-list.jsx; BOQItem: 21 (6 กลุ่ม) — boq.jsx; BOQ balance: 8; BOQ archive: 5; BOQ รออนุมัติ: 4; CBS Budget: 6 กลุ่ม
- BOM: 4 แบบบ้าน + รายการ 17 บรรทัด (เฉพาะ B-1)
- AI QTO: 10 แถวถอดปริมาณ + 6 element
- เอกสารเชื่อม BOQ→PR/PO/WO/GR: 20 รายการ (8 รหัส BOQ) — linked-docs.jsx
- PR: 10 — pr-list.jsx; PO: 6, WO: 5 — po-wo.jsx; GR: 5 + ใบตีกลับ 3 — gr.jsx

**ผู้รับเหมา**
- ทะเบียนผู้รับเหมา: 6 — subcon.jsx
- สัญญา subcon: 4 (งวดงานรวม 16) — subcon-accept.jsx; งวดเบิกจ่าย: 5; Variation Order: 2 — subcon.jsx
- Acceptance/Defect: ไม่มี record (มีเฉพาะฟอร์ม + ข้อความ defect 1 งวด)

**PM**
- PMContract: 5, PMAsset: 16, PMWO: 6 — pm.jsx; ChecklistTemplate: 5 — pm-checklist.jsx; แผน PM: 6 — pm2.jsx

**การเงิน-บัญชี**
- AP ตั้งหนี้: 5 (+6 จอเก่า), PV: 4 — ap.jsx/finance.jsx
- AR Invoice: 6, ลูกหนี้: 5, ใบลดหนี้: 3
- JV: 7 (ไม่มีบรรทัด DR/CR), Posting inbox: 7, งบทดลอง: 14, COA: 23 บัญชี/5 class
- Bank statement: 8; FixedAsset: 8 + ปรับปรุง 5; e-Tax: 6
- Petty Cash: 6 + ปันส่วน 6; Worker: 8 (ไม่มี Attendance/Payroll); OPEX: 6 แผนก + รายเดือน 6 + ประวัติ 6
- Retention: 4, RevRec: 4, WIP: 3, P&L โครงการ: 5, Aging AP/AR: 5+5

**ที่ดิน / ขาย / อื่น ๆ**
- LandPlot: 8 (+ stage 7 ขั้น + DD checklist 7 ข้อ)
- Lead CRM: 10 (5 stage); ใบแจ้งซ่อมหลังขาย: 7; SalesUnit: ไม่มี record ตามโครง dictionary
- Solar: inverter 6, ticket 3, ใบแจ้งหนี้ PPA 5, ROI 6 ปี, ขั้นขออนุญาต 6, warranty 4
- Inventory: วัสดุ 8, คลัง 5, โอนย้าย 4, เบิก 4
- Document (DMS): 13; Notification: 5+7+10 (3 ชุด); AuditLog: 13; Timeline: 13 งาน/5 กลุ่ม + milestone 5
- เอกสารรออนุมัติข้ามบริษัท: 10 — company-accept.jsx

**แอป wat/ (แยกผลิตภัณฑ์):** วัด 3, กองทุน 6, ผู้บริจาค 5, อนุโมทนาบัตร 8, ledger 8, คำขออนุมัติ 4, audit 8, เลขรัน 4, role 5, กระทบยอด 4

**entity ใน dictionary ที่ไม่มี mock record เลย:** AiUsage, Acceptance, Defect (แยกเป็น record), Attendance, Payroll, SalesUnit (ตามโครงฟิลด์), Cheque (ทะเบียนแยก), JV lines (บรรทัด DR/CR), Unit (record จริง)

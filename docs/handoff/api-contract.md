# Juneflow — API Contract (เบื้องต้น)

> REST · JSON · prefix `/api/v1` · ทุก request มี `Authorization: Bearer <jwt>` (jwt ระบุ company_id = tenant scope)
> Pattern มาตรฐานทุก resource: `GET /x?filter&page` · `GET /x/:id` · `POST /x` · `PUT /x/:id` · สถานะเปลี่ยนผ่าน action endpoint (`POST /x/:id/approve`) ไม่ใช่ PUT ตรง

## Auth & Tenant
```
POST /auth/login {email,password} → {token,user,company,package}
POST /auth/forgot | /auth/reset
GET  /me → user + role + approval_limits + package{menus,limits,ai_used}
```

## Platform Admin (เจ้าของระบบ)
```
GET/POST/PUT /admin/packages            — S/M/L/Full {price,limits,menus[],sub_rules}
GET  /admin/subscribers                 — รายบริษัท + usage
PUT  /admin/subscribers/:id/package     {package_id,seats}
POST /admin/subscribers/:id/suspend | /notify
GET  /admin/users?company=  · POST /admin/users/:id/block | /reset-password
GET  /admin/invoices · POST /admin/invoices/:id/remind
```

## Master
```
GET/POST/PUT /projects · /projects/:id/hierarchy (phase/block/unit tree)
GET/POST/PUT /project-types             — hierarchy[], modules{} (Full เท่านั้น)
GET/POST/PUT /vendors?kind=supplier|subcon · /customers · /cost-centers · /doc-numbering
```

## BOQ / จัดซื้อ
```
GET/POST /boq · POST /boq/:id/submit | /approve | /revise (→ v+1)
GET  /boq/:id/items?group= · POST /boq/:id/items (bulk จาก BOM/Excel/AI)
POST /boq/:id/generate-pr {item_ids[],qty{}} → แยก PR material/subcon + ตัด remain
POST /ai-qto/upload (file) → job_id     — ตัดเครดิต AI · GET /ai-qto/:job (progress/elements)
POST /ai-qto/:job/create-boq {mappings[]}
GET/POST /pr · POST /pr/:id/submit | /approve | /reject {reason}
GET/POST /po /wo · POST /po/:id/variation-order {dir,amount,reason}
POST /gr {po_id,lines[{qty_ok,qty_rejected,photos[]}]} → ตีกลับ gen defect-report
```

## ผู้รับเหมา / ตรวจรับ
```
GET/POST /subcon-contracts · GET /subcon-contracts/:id/periods
POST /periods/:id/deliver {docs[],photos[]} → สถานะ delivered
POST /periods/:id/inspect {result:pass|reject, defects[{item,severity,photo_before}]}
POST /defects/:id/fix {photo_after} · POST /defects/:id/recheck {result}
POST /periods/:id/approve-payment → สร้าง AP billing (หัก retention)
GET  /acceptance-center?type=gr|period|house&status=
```

## PM (CMMS)
```
GET/POST /pm/contracts {project_id,mode:ma|visits,visits_per_year,sla}
   → mode=visits: server gen schedule+WO ตามจำนวนครั้งอัตโนมัติ
GET/POST /pm/assets · /pm/checklist-templates
GET/POST /pm/workorders · POST /pm/workorders/:id/checkin {gps}
PUT  /pm/workorders/:id/checklist {items[{result,before,after}]}
POST /pm/workorders/:id/close {cause,fix,advice,signature} → gen ใบรับรอง + push LINE
POST /pm/quotes {wo_id,parts[]} · POST /pm/quotes/:id/decide {approve} (ลูกค้าผ่าน LINE)
```

## การเงิน-บัญชี
```
POST /ap/billing {po_id,gr_id,invoice_no} (3-way match) · POST /ap/pv {billing_ids[],wht_pct} → /pv/:id/approve → /bank/export-batch
POST /ar/invoices {customer_id,lines[],credit_term} → คิว e-tax · POST /ar/rv {invoice_id,amount}
GET  /gl/posting-inbox · POST /gl/post {doc_ids[]} → gen JV · GET/POST /gl/jv · GET /gl/coa
GET  /gl/reports/trial-balance|statements|project-pl|cashflow?period=
POST /bank/statements/import (file) → auto-match · POST /bank/reconcile {period}
POST /gl/close-period {period} (ล็อกย้อนหลัง)
GET/POST /fa/assets · POST /fa/run-depreciation {month}
GET/POST /labor/workers /attendance /payroll · /opex/budgets?year=
POST /etax/send {invoice_ids[]} · GET /etax/status
```

## ที่ดิน / ขาย / อื่นๆ
```
GET/POST /land/plots · POST /land/plots/:id/advance-stage · PUT /land/plots/:id/dd {checklist}
POST /land/plots/:id/deal {type:buy|lease, terms{}}
GET/POST /sales/leads /bookings /contracts /downs /loans · POST /sales/units/:id/transfer
GET/POST /documents (DMS) ?cat=&project= · GET /documents/:id/versions
GET /notifications · POST /notifications/:id/read
GET /audit-log?entity=&user=&action=
GET /reports/hub → รายการรายงานทุกโมดูล + POST /reports/:id/export {format} (async job)
```

## Mobile / LINE (endpoints เดิม + scope)
- Mobile app (ช่าง/โฟร์แมน/สโตร์/ผู้อนุมัติ): ใช้ API ชุดเดียวกัน + push notification
- LINE OA: webhook `/line/webhook` + rich menu deep-link ไป flow: แจ้งซ่อม, แผน PM, อนุมัติใบเสนอราคา, ใบรับรองผล, สัญญา, งวดดาวน์

## หมายเหตุ implementation
1. ทุก mutation เขียน AuditLog อัตโนมัติ (middleware)
2. เอกสารแนบทุก endpoint → `POST /files` (multipart) ก่อน แล้วส่ง file_id — ไฟล์เข้า DMS อัตโนมัติพร้อม link_module
3. Export ทั้งหมดเป็น async job: `POST /exports {type,params}` → `GET /exports/:id` (url เมื่อเสร็จ)
4. โควต้า: middleware ตรวจ package (เมนู/โครงการ/ผู้ใช้/พื้นที่/AI) → 402 QUOTA_EXCEEDED + upgrade_url

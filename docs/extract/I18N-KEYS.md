# I18N-KEYS — โครงสร้าง dictionary การแปลภาษา

ถอดจากโค้ดจริง 4 ไฟล์ (ลำดับโหลดตาม `index.html` บรรทัด 36–39): `i18n.jsx` → `i18n-phrases.jsx` → `i18n-accounting.jsx` → `i18n-phrases3.jsx`
ตัวเลขทั้งหมดได้จากการ parse object literal จริงด้วยสคริปต์ (balanced-brace + eval) ไม่ใช่การประมาณ
Export ฉบับเต็ม: **`i18n-full.json`** (แนบในโฟลเดอร์นี้)

## 1. ภาษา (LANGS ใน i18n.jsx)

| code | label | dir |
|---|---|---|
| `th` | ไทย | ltr |
| `zh` | 简体中文 | ltr |
| `en` | English | ltr |
| `ar` | العربية (دبي) | rtl |

Fallback ใน `langResolve`: ภาษาที่ไม่มีคำแปล → `en` → `th`; `zh-TW` → `zh` → `en` → `th` (comment ในโค้ดกล่าวถึง bn/fa/id/ja/pt ว่า fallback เป็น English)

## 2. โครงสร้าง 3 ชั้น

| ชั้น | รูปแบบ key | ใช้ผ่าน | จำนวน key จริง (หลัง merge) |
|---|---|---|---|
| `DICT` | key คงที่ เช่น `app.name`, `common.save` → `{th,en,zh,ar}` | `t("key")` / `I18N.t` | **59** |
| `NAV_I18N` | ข้อความไทยเป็น key → `{en,zh,ar,...}` | `tn("ป้ายเมนูไทย")` | **112** (105 ใน i18n.jsx + 7 จาก i18n-accounting.jsx) |
| `PHRASES` | ข้อความไทยเป็น key → `{en,zh,ar}` | MutationObserver แปล DOM ทั้งหน้าอัตโนมัติ (`startTextI18n`) | **736** |
| `PHRASE_PATTERNS` | regex + build function | ข้อความมีตัวเลข เช่น "แสดง X จาก Y รายการ" | 2 patterns |

ที่มาของ PHRASES 736 key (merge ตามลำดับโหลด, key ซ้ำตัวหลังทับตัวแรก):

| แหล่ง | จำนวน key |
|---|---|
| `PHRASES` base ใน i18n.jsx | 252 |
| + copy จาก NAV_I18N (เฉพาะ key ที่ยังไม่มี) | → 352 |
| + `MORE` ใน i18n-phrases.jsx | 153 |
| + `MORE` ใน i18n-accounting.jsx | 141 |
| + `NAV` ใน i18n-accounting.jsx | 7 |
| + `MORE` ใน i18n-phrases3.jsx | 98 |
| **รวมหลัง dedupe** | **736** |

ความครบของภาษา: DICT ครบ th/en/zh/ar ทั้ง 59 key · PHRASES ครบ en/zh/ar ทั้ง 736 key · มี 19 key (ใน NAV_I18N base) ที่มีภาษาเสริม bn/fa/id/ja/pt/zh-TW ด้วย

## 3. ตัวอย่าง 20 keys แรกของ DICT (ครบ 4 ภาษา)

| key | th | en | zh | ar |
|---|---|---|---|---|
| `app.name` | ระบบงานก่อสร้าง | Construction ERP | 建筑工程系统 | نظام إدارة الإنشاءات |
| `app.tagline` | บริหารต้นทุน–จัดซื้อ–การเงิน | Cost · Procurement · Finance | 成本 · 采购 · 财务 | التكلفة · المشتريات · المالية |
| `nav.sec.main` | งานหลัก | Main | 主要 | الرئيسية |
| `nav.sec.boq` | BOQ & งบประมาณ | BOQ & Budget | 工程量与预算 | جداول الكميات والميزانية |
| `nav.sec.proc` | จัดซื้อ | Procurement | 采购 | المشتريات |
| `nav.sec.fin` | การเงิน-บัญชี | Finance & Accounting | 财务会计 | المالية والمحاسبة |
| `nav.sec.master` | ข้อมูลหลัก | Master Data | 主数据 | البيانات الرئيسية |
| `nav.sec.sys` | ระบบ | System | 系统 | النظام |
| `nav.dashboard` | แดชบอร์ด | Dashboard | 仪表板 | لوحة المعلومات |
| `nav.boq.overview` | ภาพรวม BOQ | BOQ Overview | 工程量概览 | نظرة عامة |
| `nav.boq.list` | รายการ BOQ | BOQ List | 工程量清单 | قائمة الكميات |
| `nav.boq.bom` | BOM (สูตรต่อหลัง) | BOM Templates | 物料清单模板 | قوالب المواد |
| `nav.boq.editor` | แก้ไข BOQ | BOQ Editor | 工程量编辑 | محرر الكميات |
| `nav.boq.approval` | อนุมัติ BOQ | BOQ Approval | 工程量审批 | اعتماد الكميات |
| `nav.boq.reports` | รายงาน BOQ | BOQ Reports | 工程量报表 | تقارير الكميات |
| `nav.boq.archive` | คลังเอกสาร | Archive | 归档 | الأرشيف |
| `nav.pr` | ใบขอซื้อ (PR) | Purchase Requests | 采购申请 | طلبات الشراء |
| `nav.po` | ใบสั่งซื้อ (PO) | Purchase Orders | 采购订单 | أوامر الشراء |
| `nav.subcon` | ผู้รับเหมาช่วง | Subcontractors | 分包商 | مقاولو الباطن |
| `nav.gr` | รับของ (GR) | Goods Receipt | 收货 | استلام البضائع |

## 4. กลไกตามโค้ด

- ภาษา active เก็บใน `localStorage["juneflow-lang"]` (default `th`); เปลี่ยนภาษาแล้ว set attribute `lang`/`dir` ที่ `<html>` (Arabic = rtl)
- `t(key, fallback)` — คืน fallback หรือ key เมื่อไม่พบ; `tn(label)` — คืน label เดิมเมื่อไม่พบ
- `startTextI18n` (IIFE ท้าย i18n.jsx) เดิน DOM ด้วย MutationObserver แปล text node/`placeholder`/`value` ตาม PHRASES + PHRASE_PATTERNS (debounce 150ms, ข้าม SCRIPT/STYLE/INPUT/TEXTAREA/SVG — INPUT จัดการแยกผ่าน value/placeholder)

## 5. Key ซ้ำภายในไฟล์เดียวกัน (ตัวหลังทับตัวแรกตามกติกา JS — ควรรู้ก่อนแปลงเป็นระบบจริง)

- `NAV_I18N` (i18n.jsx): "บัญชี-การเงิน", "งานขาย-อสังหาฯ", "ระบบ", "BOM (สูตรต่อหลัง)", "Company / Org", "เงินสดย่อย", "จัดสรรต้นทุน"
- `PHRASES` (i18n.jsx): "ทั้งหมด", "รออนุมัติ", "Project Timeline · แผนงานโครงการ", "ยอดสุทธิ", "เพิ่มไฟล์", "ผู้ขอ", "ค้นหา PR..."
- `MORE` (i18n-phrases.jsx): "วัสดุเก็บงาน"
- `MORE` (i18n-phrases3.jsx): "ขอบเขตงาน", "ผู้รับเงิน", "ยอดขายสะสม"

## 6. โครง i18n-full.json ที่แนบ

```json
{
  "_source": { "files": [...], "load_order_from_index_html": [...], "note": "..." },
  "langs": [ {code,label,en,dir} × 4 ],
  "dict": { "app.name": {th,en,zh,ar}, ... 59 keys },
  "nav_i18n": { "ป้ายไทย": {en,zh,ar,...}, ... 112 keys },
  "phrases": { "ข้อความไทย": {en,zh,ar}, ... 736 keys }
}
```

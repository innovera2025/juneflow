# Handoff: Juneflow — Construction ERP + Subscription SaaS (ทั้งระบบ)

## Overview
ระบบบริหารงานก่อสร้างครบวงจร (multi-tenant SaaS): BOQ/จัดซื้อ → ผู้รับเหมา/ตรวจรับ → การเงิน-บัญชี ครบวงจร + PM/CMMS + ที่ดิน + ขาย-CRM + โซลาร์ EPC + Subscription platform (แพ็กเกจ S/M/L/Full คุมเมนู/โควต้า) + Mobile app + LINE OA · i18n 4 ภาษา (ไทย default / 中文 / English / العربية-RTL)

## About the Design Files
ไฟล์ทั้งหมดในชุดนี้เป็น **design reference ที่สร้างด้วย HTML/React(Babel)** — เป็น prototype แสดงหน้าตาและพฤติกรรมที่ต้องการ **ไม่ใช่โค้ด production ที่เอาไปใช้ตรงๆ** งานคือ **สร้างใหม่ใน environment จริงของโปรเจกต์** (แนะนำ React + backend ตาม `api-contract.md`) ตาม pattern/library ของ codebase ปลายทาง — mock data ในไฟล์ .jsx ใช้เป็น seed/fixture ได้

## Fidelity
**High-fidelity (hifi)** — สี/ฟอนต์/ระยะ/สถานะ hover เป็นค่าจริงที่ตัดสินใจแล้ว (ธีมหลัก: SAP Fiori — token ครบใน `tokens.css`/`tokens.json`) ให้ recreate ตาม token ไม่ต้องออกแบบใหม่ · behavior ทุกปุ่ม/modal ดูได้จาก prototype จริง

## เอกสารในชุดนี้ (อ่านตามลำดับ)
1. `README.md` — ไฟล์นี้
2. **`FUNCTIONS.md`** — ★ ถอดฟังก์ชันละเอียดทุก feature (trigger/input/พฤติกรรม/state) จัดตาม 9 โดเมน + กติการวม 8 ข้อ
3. `FUNCTIONS-INVENTORY.md` — รายชื่อ 719 functions จาก 78 ไฟล์ .jsx (สแกนอัตโนมัติ ใช้เช็คความครบ)
4. `flows.html` — state machine 7 กระบวนการ + Approval Matrix ตามมูลค่า
5. `erd.html` — ERD ~34 entities · `data-dictionary.html` — ฟิลด์เต็ม
6. `api-contract.md` — REST endpoints ทุกโมดูล + กติกา middleware
7. `tokens.css` / `tokens.json` — design tokens 2 ธีม + นิยามแพ็กเกจ
8. `แกลเลอรีหน้าจอ (ออฟไลน์).html` — ภาพจริง 100 หน้าจอ · `ถอดฟังก์ชันตาม Flow.html` — ~400 ฟังก์ชันเรียงตาม flow ผู้ใช้ (รวม popup/mobile)

## Prototype (behavior spec)
- `Juneflow Fiori.html` (ธีมหลัก) + `Juneflow Ant Pro.html` + ไฟล์ `.jsx` ~78 ไฟล์ ใน project root — เปิดในเบราว์เซอร์ ทุกเมนู/ปุ่ม/ฟอร์ม/modal ทำงานจริง
- ไฟล์สำคัญต่อสถาปัตยกรรม: `shell.jsx` (router+ctx) · `chrome.jsx` (NAV+sidebar) · `pkg-builder.jsx` (แพ็กเกจ/เมนู gating) · `project-types.jsx` (โมดูลตามประเภทโครงการ) · `i18n*.jsx` (dict 732 คีย์)

## Mock ที่ต้องทำ backend จริง
Export Excel/PDF/พิมพ์ (ตอนนี้ toast) · AI parse CAD/BIM (flow ครบ ต้องมี IFC parser+ML) · ส่งอีเมล/LINE จริง · e-Tax ส่งสรรพากร · Export to Bank (ไฟล์ KBANK) · Auth จริง · Persistence (ข้อมูล mock ในไฟล์ รีเฟรชรีเซ็ต ยกเว้น route/theme/lang ใน localStorage)

## Interactions & State (สรุป — รายละเอียดใน FUNCTIONS.md)
- Navigation: SPA route string (เช่น `boq.editor`) + params · loading bar+skeleton ทุกครั้ง
- Modal กลาง 1 ระบบ (size sm–xl) + confirm(+เหตุผลบังคับ) + toast 4 tone
- เอกสารทุกใบ: draft→pending(ขั้นอนุมัติตาม matrix)→approved|rejected→posted/closed
- Sidebar กรอง 3 ชั้น: ProjectType modules → Package menus/sub-rules → viewMode
- โควต้า: เมนู+AI ตัดตามแพ็กเกจ หมดแล้วชน modal อัปเกรด

## Design Tokens
ดู `tokens.css` (คอมเมนต์กติกาใช้งาน 5 ข้อท้ายไฟล์) — Fiori: brand #0A6ED1, shell เข้ม #354A5F, radius 4-6px, row 32px, Inter+Noto Sans Thai · สถานะ ok #107E3E / warn #E9730C / danger #BB0000

## Assets
ไอคอน = inline SVG (stroke 1.4-1.6) ใน `ds.jsx` (~90 ตัว) · ฟอนต์ Google Fonts (Inter, Noto Sans Thai/Arabic/SC, Sarabun, IBM Plex Sans) · ไม่มีรูป binary — แผนที่/รูปถ่ายเป็น CSS gradient placeholder

## ลำดับพัฒนา (แนะนำ)
Phase 1 Auth+Company+Master+Package gating → 2 BOQ+จัดซื้อ → 3 การเงิน-บัญชี → 4 ผู้รับเหมา+ตรวจรับ+PM → 5 ที่ดิน/ขาย/โซลาร์ → 6 Platform admin+Mobile/LINE

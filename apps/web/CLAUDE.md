# apps/web — เขต Frontend Web · อ่านราก `CLAUDE.md` + `PLAN.md` §0 (Design Fidelity Protocol) ก่อนเริ่มงานทุกครั้ง

## เขตนี้ = Design Fidelity เข้มสุดของทั้ง repo (PLAN.md §8)
- React 18 + Vite + TS (SPA) · TanStack Router + Query — **port ตรงจาก `pototype/*.jsx`** ห้ามออกแบบใหม่
- **ยกเว้น ห้าม port:** ไฟล์โค้ดตาย `finance.jsx` และ `tweaks-panel.jsx` (ไม่ถูกโหลด/ไม่ถูก route) ·
  `pototype/wat/` + `บุญบัญชี*.html` (คนละผลิตภัณฑ์) · ไฟล์ standalone build ทุกตัว · ธีม `Juneflow Ant Pro*` (ใช้ Fiori เท่านั้น)
- **ห้ามเริ่ม task ที่มี UI โดยไม่ได้เปิดอ่านไฟล์ .jsx ต้นทางในรอบนั้น — การอ้างว่าเคยอ่านแล้วไม่นับ**

## Tokens
- สี/ฟอนต์/ระยะ/รัศมี มาจาก `packages/tokens` **เท่านั้น** — ห้าม hardcode ค่าใดๆ ในโค้ดจอ

## i18n
- **ทุกข้อความบนจอ = i18n key จาก `i18n-full.json`** — ห้ามแปลใหม่แม้แต่คำเดียว
- ข้อความที่ไม่มี key ในไฟล์ → เขียน `BLOCKERS.md` แล้วข้าม ห้ามเดา

## States + ตัวเลข (กฎจาก tokens.css)
- **Empty state ทุกตาราง** + **Loading (top progress 3px + skeleton) ทุกการเปลี่ยนหน้า**
- ตัวเลขเงินทุกที่ใช้ class `num` → `font-variant-numeric: tabular-nums` และชิดขวาในตาราง

## API client
- ใช้ client ที่ generate จาก `packages/contracts/openapi.yaml` เท่านั้น — ห้ามเขียน model/fetch มือ

## Visual gate (นิยาม done ของเขตนี้)
- **ทุกจอต้องผ่าน visual gate ก่อนถือว่า done** — screenshot เทียบ reference ใน `tests/visual/reference/`
  ตามเกณฑ์ PLAN.md §0 (โครงเลย์เอาต์ ลำดับ/ป้ายเมนูและคอลัมน์ token สี ตำแหน่ง KPI/ปุ่ม/แท็บ)
- จอที่ไม่มีภาพอ้างอิง → เปิด `pototype/Juneflow Fiori.html` จอเดียวกัน แคปเป็น reference ก่อนเริ่มสร้าง

## ขั้นตอนปฏิบัติ (skills)
- ขั้นตอน port จอ → `.claude/skills/port-screen` · ขั้นตอน visual gate → `.claude/skills/visual-gate`

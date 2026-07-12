# apps/mobile — เขต Mobile (Flutter) · อ่านราก `CLAUDE.md` + `PLAN.md` §0 (Design Fidelity Protocol) ก่อนเริ่มงานทุกครั้ง

## เขตความรับผิดชอบ
- Flutter — โครงตั้งแต่ Phase 0, จอเริ่มจริง Phase 4 (PLAN.md §7)

## Theme
- ThemeData **generate จาก `tokens.json`** ผ่าน pipeline ของ `packages/tokens` เท่านั้น
- **ห้ามแก้ไฟล์ theme ที่ generate ด้วยมือ** — ต้องแก้ที่ต้นทาง token แล้ว gen ใหม่

## API client
- Dart client **generate จาก OpenAPI** (`packages/contracts/openapi.yaml`) — ห้ามเขียน model มือ

## Spec ของจอ (Design Fidelity)
- Spec = ภาพ mobile ใน `pototype/gallery/` + โค้ด `mobile*.jsx` **รวม 31 จอ**
  (`mobile.jsx` · `mobile-screens.jsx` · `mobile-field.jsx` · `mobile-pm.jsx` · `mobile-preview.jsx`)
- เขียนใหม่เป็น Flutter widget โดย **visual ต้องตรงต้นฉบับ** — ผ่าน visual gate เหมือนจอ web
- **ห้ามเริ่ม task ที่มี UI โดยไม่ได้เปิดอ่านไฟล์ .jsx ต้นทางในรอบนั้น — การอ้างว่าเคยอ่านแล้วไม่นับ**

## Offline
- offline-first: drift/SQLite + **sync queue** (PLAN.md ภาคผนวก A)
- ระดับ offline (ก) หรือ (ข) ยังเป็น **Open Question — PLAN.md §11 ข้อ 5** รอ Wei ตัดสิน
  งานที่ขึ้นกับข้อนี้ → เขียน `BLOCKERS.md` แล้วข้ามไป task อื่น ห้ามเดา
- push FCM/APNs = deferred (PLAN.md ภาคผนวก A / §12)

## นอกเขตนี้
- **LINE LIFF ไม่อยู่ในเขต mobile** — LIFF เป็น React web (PLAN.md ภาคผนวก A) · งาน LIFF = เขต `apps/web`

# @juneflow/tokens
- แหล่งที่มา: `tokens.css` + `tokens.json` จาก design_handoff (ธีม **fiori**) — ก๊อปเข้ามาที่ `src/` แบบ byte-identical ห้ามแก้มือ
- สี/ฟอนต์/ระยะ/รัศมี ทุกค่าต้องมาจากแพ็กเกจนี้เท่านั้น — **ห้าม hardcode ค่าใดๆ** ในโค้ดจอ/ธีม (PLAN.md §0 กฎข้อ 2)
- Regen Flutter theme: `pnpm --filter @juneflow/tokens gen:flutter` — อ่าน `src/tokens.json` → generate ThemeData สำหรับ `apps/mobile` (TODO(P0-BE-04))
- ไฟล์ที่ generate ออกมา **ห้ามแก้มือ** (P0-MOB-02) · การเปลี่ยนค่า token ต้นทางต้องผ่าน Wei เท่านั้น

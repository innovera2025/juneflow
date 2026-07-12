# @juneflow/tokens
- แหล่งที่มา: `tokens.css` + `tokens.json` จาก design_handoff (ธีม **fiori**) — ก๊อปเข้ามาที่ `src/` แบบ byte-identical ห้ามแก้มือ
- สี/ฟอนต์/ระยะ/รัศมี ทุกค่าต้องมาจากแพ็กเกจนี้เท่านั้น — **ห้าม hardcode ค่าใดๆ** ในโค้ดจอ/ธีม (PLAN.md §0 กฎข้อ 2)
- Gen Flutter theme: `pnpm --filter @juneflow/tokens gen:flutter` — อ่าน `src/tokens.json` (ธีม fiori) → generate `ThemeData` เป็นไฟล์ Dart
  - ปลายทาง default: `packages/tokens/gen/juneflow_theme.dart` (in-zone build artifact — อยู่ใน `.gitignore`)
  - เขต mobile (P0-MOB-02) รันด้วย `--out apps/mobile/lib/theme` เพื่อวางไฟล์ที่ Flutter import
  - ตรรกะ gen อยู่ใน `src/flutter-theme.ts` (pure · ทุกค่ามาจาก token ต้นทาง) · unit test `src/flutter-theme.test.ts` พิสูจน์ว่าไม่มีค่า hardcode และไม่มีสีจากธีม navy หลุด
- ไฟล์ที่ generate ออกมา **ห้ามแก้มือ** (P0-MOB-02) · การเปลี่ยนค่า token ต้นทางต้องผ่าน Wei เท่านั้น · เฉพาะธีม **fiori** เท่านั้น (navy อยู่นอกขอบเขต — PLAN.md §0 กฎข้อ 5)

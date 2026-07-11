# lib/theme — ปลายทางของ theme ที่ generate เท่านั้น

โฟลเดอร์นี้คือที่วางไฟล์ `ThemeData` ที่ **generate จาก `packages/tokens/src/tokens.json` (ธีม fiori) ผ่าน pipeline `gen-flutter-theme` ของ `packages/tokens`** (งาน P0-BE-04 ฝั่ง tokens + P0-MOB-02 ฝั่ง mobile — TODO(P0-MOB-02)) — **ห้ามแก้ไฟล์ที่ generate ด้วยมือเด็ดขาด** และห้าม hardcode ค่า สี/ฟอนต์/ระยะ/รัศมี ใดๆ ในเขต mobile ถ้าต้องการเปลี่ยนค่า ให้แก้ที่ token ต้นทางแล้ว gen ใหม่เท่านั้น (ดู `apps/mobile/CLAUDE.md` และ PLAN.md §0 Design Fidelity Protocol)

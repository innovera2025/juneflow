# Journal — Mobile (เขต: `apps/mobile` · Flutter)

> บันทึกต่อรอบ loop ตาม PLAN.md §10 — หนึ่ง entry ต่อหนึ่งรอบ · entry ใหม่อยู่บนสุด
> รูปแบบ entry ต่อรอบ:
>
> ```
> ## [YYYY-MM-DD] · รอบที่ N · task: <task id>
> - ทำอะไร: (งานที่ลงมือทำจริงในรอบนี้ + ผล gates)
> - ตัดสินใจอะไร: (การตัดสินใจในเขตตัวเอง — ความขัดแย้ง design/spec ห้ามตัดสินเอง → BLOCKERS.md)
> - เจออะไร: (สิ่งที่พบ/ติดขัด/blocker ที่เปิด/สิ่งที่ agent รอบถัดไปควรรู้)
> ```

## 2026-07-12 · รอบที่ 3 · task: P0-MOB-02

- ทำอะไร: หยิบ P0-MOB-02 (ready→doing→review · dep P0-MOB-01 done + P0-BE-04 done). eligible mobile รอบนี้ = MOB-02 / MOB-03 / MOB-05 (MOB-04 blocked B-015) → เลือก MOB-02 (เสี่ยงต่ำสุด · pipeline พร้อมแล้ว). รัน generator ที่ P0-BE-04 สร้างไว้: `pnpm --filter @juneflow/tokens gen:flutter -- --out ../../apps/mobile/lib/theme` → ได้ `lib/theme/juneflow_theme.dart` (export `juneflowFioriTheme()` + `JuneflowTokens`) · แก้ `lib/main.dart`: `theme: ThemeData(useMaterial3: true)` → `juneflowFioriTheme()` + import · อัปเดต `lib/theme/README.md` (เอา TODO(P0-MOB-02) ออก + ใส่ regen cmd). **gates ผ่านครบ:** `flutter analyze` = No issues · `flutter test` = 1/1 · `flutter build web` = ✓ Built build/web. **ด่าน 4.5 diff-reviewer = PASS** (traced ทุก literal ตรง tokens.json fiori · no hardcode). commit `ea8c80e` บน feature/mobile → TASKS `review` + REVIEW-QUEUE row.
- ตัดสินใจอะไร: **generator ทำงาน read-only ต่อ packages/tokens** — รัน pipeline ที่มีอยู่แล้ว (P0-BE-04) ไม่แก้ source token/generator ใดๆ (out of zone) · output เขียนลง `apps/mobile/lib/theme` (in-zone) เท่านั้น. ไม่ hardcode ค่า design ใน main.dart — อ้าง `juneflowFioriTheme()` ล้วน (PLAN.md §0 กฎ 2). ไม่มีการตัดสิน design/spec — theme มาจาก token ต้นทาง verbatim. build พิสูจน์ผ่าน web target เหมือน MOB-01 (Android/iOS SDK ยังไม่มีในเครื่อง — env constraint).
- เจออะไร: (1) generated `juneflow_theme.dart` เป็น output → commit เข้า repo (ไม่ gitignore ที่ apps/mobile/lib/theme · ต่างจาก default `packages/tokens/gen/` ที่ gitignored) — regen ได้ตลอดด้วย cmd เดียว · **ห้ามแก้มือ** (header GENERATED). (2) `build/web` เป็น artifact → gitignored ✓ (ไม่หลุดเข้า diff). (3) คิว ready เขต mobile หลังรอบนี้เหลือ MOB-03 (Dart client · dep done พร้อม) + MOB-05 (offline queue · ทำเฉพาะส่วนไม่ขึ้น Open Q #5) = **2 ตัว** (MOB-04 blocked B-015) — ต่ำกว่าเกณฑ์ ≥5 มาก · **เตือน Wei:** ตอบ B-015 (ปลด MOB-04) + เติมคิว Phase 0/เตรียม Phase 4 (ห้าม agent สร้าง task ผูก MVP เอง — [TBD-MVP]). (4) หาก tokens.json เปลี่ยนในอนาคต ต้อง regen theme ใหม่ (ผูก dep P0-BE-04) — agent รอบถัดไปที่แตะ theme ควรรู้.

## 2026-07-12 · รอบที่ 2 · task: P0-MOB-01

- ทำอะไร: หยิบ P0-MOB-01 (ready→doing→review · dep P0-BE-01 done). eligible mobile รอบนี้เหลือ **ตัวเดียว** = MOB-01 (MOB-02/03/05 ยังติด dep MOB-01 ไม่ done · MOB-04 blocked B-015). skeleton จาก foundation commit มีแล้ว (lib/main.dart · pubspec.yaml · analysis_options.yaml · lib/theme/README.md) แต่ยังไม่มี platform dir → `flutter build` ไม่ได้. เติม platform scaffold: `flutter create --platforms=web` (เพิ่ม `web/` + `.metadata` + `pubspec.lock`) · แก้ `test/widget_test.dart` จาก template counter (อ้าง `MyApp` ที่ไม่มี → analyze error/test fail) เป็น smoke test จริงของ `JuneflowApp` · แทน README generic. **gates ผ่านครบ:** `flutter analyze` = No issues · `flutter test` = 1/1 · `flutter build web` = ✓ Built build/web. commit บน feature/mobile → TASKS `review` + REVIEW-QUEUE row.
- ตัดสินใจอะไร: **web เป็น build target ที่ใช้พิสูจน์ gate** — `flutter doctor` ยืนยัน Android toolchain ✗ + Xcode ✗ (ไม่มี SDK ในเครื่อง) · Chrome/web ✓. gate เขียนว่า "build ผ่าน" ไม่ระบุ platform → เลือก web (compile Dart→app สำเร็จ พิสูจน์โครง build ได้) แทน apk/ipa ที่ต้องมี SDK แต่ละ platform. ไม่ใช่การตัดสิน design/spec — เป็น env constraint · target มือถือจริง (android/ios scaffold + SDK) ทำตอนมี toolchain/Phase 4. ไม่แตะ lib/theme (theme ยัง gen-only P0-MOB-02) · ไม่เขียน API model มือ (P0-MOB-03).
- เจออะไร: (1) CI (`.github/workflows/ci.yml`) **ไม่มี Flutter stage เลย** — pnpm/node ล้วน → gate MOB-01 เป็น local เท่านั้น (agent รัน `flutter analyze`+build เอง). (2) `flutter create` สร้าง `.idea/` (gitignored ✓) + `test/widget_test.dart` เป็น counter template ที่พังกับ skeleton — ต้องแก้ทุกครั้งที่ scaffold. (3) MOB-01 → review จะปลดล็อก MOB-02 (theme · +dep P0-BE-04 ต้อง done ก่อน — ตอนนี้ ready) + MOB-03 (Dart client · dep P0-BE-12 done แล้ว → พร้อมเมื่อ MOB-01 done) + MOB-05 (offline queue). (4) คิว ready เขต mobile: หลังรอบนี้เหลือ MOB-02/03/05 = 3 ตัว (MOB-04 blocked) — ต่ำกว่าเกณฑ์ ≥5 · เตือน Wei เติมคิว/ตอบ B-015 (ห้ามสร้าง task ผูก MVP เอง). (5) offline (ก)/(ข) ยังค้าง Open Q #5 — MOB-05 ทำเฉพาะส่วนไม่ขึ้นระดับ.

## 2026-07-12 · รอบที่ 1 · task: P0-MOB-04

- ทำอะไร: หยิบ P0-MOB-04 (ready→doing · dep ว่าง). eligible mobile tasks รอบนี้ = P0-MOB-01 (dep BE-01 done) และ P0-MOB-04 (no dep) เท่านั้น (MOB-02/03/05 ติด dep MOB-01 ยังไม่ done). เลี่ยง MOB-01 เพราะ gate ต้อง `flutter build` แต่ยังไม่มี platform dirs (android/ios/…) + ไม่มี Android SDK/Xcode แน่นอน → RED-prone. ลง MOB-04 (inventory ล้วน · ในเขต apps/mobile/docs · ไม่มี visual gate). อ่าน spec ครบ: mobile-preview.jsx (MOBILE_GROUPS + router) · mobile.jsx · mobile-screens.jsx · mobile-pm.jsx · mobile-field.jsx · docs/extract/INVENTORY.md · NAV-ROUTES.md · tests/visual/reference-index.md. ผล: **ตัน — เปิด B-015**, ยังไม่เขียน screen-map.md.
- ตัดสินใจอะไร: ไม่ตัดสิน design/spec เอง. count "31 จอ" ใน zone CLAUDE.md (sacred) ขัดกับ enumerate source = 26 จอ distinct (+1 host) — ไม่มีเขตใด/ตาราง C ให้คำตัดสิน → escalate B-015 แทนการแต่งจอ (ผิด fidelity) หรือ redefine count เอง (ผิด PLAN.md §0 กฎ 4). ตั้ง P0-MOB-04 = blocked แล้วหยุดรอบ.
- เจออะไร: (1) source mobile*.jsx มี 26 จอ distinct จริง (window exports ครบ ไม่มี orphan) — MOBILE_GROUPS ก็ list 26 ตรงกัน · "31" น่าจะมาจากนับ approval 5 จอซ้ำ (mobile.jsx standalone iOS-frame + preview) → ราย B-015. (2) gallery มี mobile ref แค่ 1 ภาพ (g2/45-s.jpg = Mobile Approval/preview host ตาม reference-index.md) — จอ mobile ที่เหลือ **ไม่มีภาพอ้างอิง gallery** ต้องแคปจาก Juneflow Fiori.html ตอน build Phase 4 (PLAN.md §0). agent รอบถัดไปควรทราบก่อนวางคอลัมน์ "ภาพอ้างอิง". (3) คิว ready เขต mobile เหลือ 4 (MOB-01/02/03/05) ต่ำกว่าเกณฑ์ ≥5 — เตือน Wei เติมคิว (แต่ห้ามสร้าง task ผูก MVP เอง). (4) MOB-02/03/05 ปลดล็อกเมื่อ MOB-01 done — MOB-01 build gate ต้องมี Flutter toolchain ครบ (platform scaffold + SDK) รอบถัดไปเตรียมประเด็นนี้.

## 2026-07-06 · bootstrap · task: —

- ทำอะไร: bootstrap ไฟล์สถานะ loop ตาม Manifest v2 กลุ่ม 3 · เขต mobile มี 5 task ใน `TASKS.md` (P0-MOB-01 ถึง P0-MOB-05) สถานะ `ready` — P0-MOB-04 (mobile screen inventory 31 จอ) เริ่มได้ทันทีโดยไม่รอเขตอื่น
- ตัดสินใจอะไร: ไม่มีการตัดสินใจเชิง design/spec — ความขัดแย้งถูกยกเข้า `BLOCKERS.md` (B-001, B-002)
- เจออะไร: จอ mobile เริ่มจริง Phase 4 (PLAN.md §7) — Phase 0 เป็นโครง skeleton + pipeline เท่านั้น · theme ต้องมาจาก ThemeData ที่ gen จาก tokens.json ห้ามแก้มือ · ระดับ offline-first (ก)/(ข) ยังเป็น Open Q #5 — P0-MOB-05 ทำเฉพาะส่วนที่ไม่ขึ้นกับระดับ ถ้าชนทางเลือกต้องเข้า BLOCKERS
- 2026-07-12T01:09:49Z loop round ended (agent: mobile)

## 2026-07-12 08:09 · loop-runner · รอบที่ 1/10 · task: P0-MOB-04
- ทำอะไร: รัน claude headless 1 รอบ · task P0-MOB-04 → สถานะ blocked · ค่าใช้จ่ายรอบนี้ $2.396243 (สะสม $2.3962/เพดาน $20)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes
- 2026-07-12T01:21:30Z loop round ended (agent: mobile)

## 2026-07-12 08:21 · loop-runner · รอบที่ 2/10 · task: P0-MOB-01
- ทำอะไร: รัน claude headless 1 รอบ · task P0-MOB-01 → สถานะ review · ค่าใช้จ่ายรอบนี้ $3.1500837499999994 (สะสม $5.5463/เพดาน $20)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes
- 2026-07-12T01:22:07Z loop round ended (agent: mobile)

## 2026-07-12 08:22 · loop-runner · คิวว่าง
- ทำอะไร: รอบที่ 3/10: ไม่มี task สถานะ ready ที่ dependencies ครบในเขต mobile — จบลูป
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: งบสะสม $6.0468/$20 · เติมคิว ready ให้ครบ ≥ 5 task ต่อเขต (PLAN.md §10)

## 2026-07-12 08:54 · loop-runner · fail-safe
- ทำอะไร: หยุดการทำงานจาก error: tracked worktree is dirty at loop start — commit or stash changes first (clean-state requirement) (รอบที่ 1/10 · task ล่าสุด: -)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: ตรวจสถานะ repo และ log ก่อนสั่งรันใหม่ · งบสะสมรอบนี้: $0
- 2026-07-12T02:02:09Z loop round ended (agent: mobile)

## 2026-07-12 09:02 · loop-runner · รอบที่ 1/10 · task: P0-MOB-02
- ทำอะไร: รัน claude headless 1 รอบ · task P0-MOB-02 → สถานะ review · ค่าใช้จ่ายรอบนี้ $2.82959825 (สะสม $2.8296/เพดาน $20)
- ตัดสินใจอะไร: — (loop-runner เป็นกลไกอัตโนมัติ ไม่ตัดสินใจเชิง design/spec — ความขัดแย้งต้องเข้า BLOCKERS.md โดย agent ในรอบ)
- เจออะไร: git progress: yes

## 2026-07-12 · รอบที่ 4 · task: P0-MOB-03
- ทำอะไร: หยิบ P0-MOB-03 (ready→doing→review · deps P0-MOB-01+P0-BE-12 done). eligible mobile รอบนี้ = MOB-03 / MOB-05 (MOB-02 อยู่ review · MOB-04 blocked B-015) → เลือก MOB-03 (concrete กว่า เสี่ยง spec-conflict ต่ำ). **generate Dart client จาก `packages/contracts/openapi.yaml`** → `apps/mobile/lib/api/generated/**`: retrofit-on-`dio` (12 tag `*Api` + root `JuneflowApiClient`) + json_serializable models (49). สร้าง pipeline `tool/gen_api_client.sh` (normalize→swagger_parser→build_runner) + `tool/normalize_openapi.py` + `swagger_parser.yaml` + `test/api_client_test.dart` (compile+smoke จริงของ generated client). pubspec: +retrofit/json_annotation (+dev retrofit_generator/json_serializable/build_runner) · sdk floor 3.4→3.8. **gates ผ่านครบ:** codegen (swagger_parser Success 12/145/49 + build_runner Built 74 outputs) · `flutter analyze` = No issues · `flutter test` = 4/4 · `flutter build web` = ✓. commit บน feature/mobile → TASKS `review` + REVIEW-QUEUE row → (ต่อ) diff-reviewer.
- ตัดสินใจอะไร: **generator choice = engineering ในเขต ไม่ใช่ design/spec** — openapi-generator (Java `dart-dio`) ใช้ไม่ได้เพราะ host ไม่มี JRE (`/usr/bin/java` เป็น stub) → เลือก `swagger_parser` (pure Dart, OpenAPI 3.1, retrofit-on-dio ตรงกับ dio ที่ pubspec commit ไว้แล้ว). เจอ generator 2 จุดพังกับ contract นี้ → แก้ด้วย **normalize สำเนา derived (build/, gitignored) ไม่แตะ sacred openapi.yaml เลย** ด้วย transform semantics-preserving 2 อย่าง: (1) inline path-level `parameters` 44 paths (swagger_parser 1.44 crash เพราะ cast path-item เป็น Map ก่อน guard) (2) free-form object 8 ตัว (Entity ฯลฯ = `type object`/no props/additionalProperties free) → empty `@JsonSerializable` class แทน `typedef=dynamic` เพราะ retrofit_generator 10.2.7 (ก) crash คำนวณ inner type ของ `Future<List<dynamic>>` เป็น null (ข) emit `.fromJson` บน typedef ที่ compile ไม่ได้ — empty class faithful กับ contract ที่ "ยังไม่ประกาศ field ให้ opaque resource" (field ไป schema task; regen เติมเองเมื่อ contract เพิ่ม). **ไม่เขียน model มือ · ไม่แตะ sacred/i18n/token/C1–C10 · zone = apps/mobile ล้วน**.
- เจออะไร: (1) `/usr/bin/java` = macOS stub (no JRE) → **Java-based generator ใดๆ ใช้ไม่ได้บน host นี้** — agent อื่นที่จะ gen จาก openapi (เช่น P0-WEB-06 ใช้ openapi-typescript = node ok) ควรทราบ; ฝั่ง Dart ต้อง pure-Dart (swagger_parser) เท่านั้น. (2) generated client ต้อง **build_runner** (retrofit `_$XApi` + json `*.g.dart`) — เป็น step บังคับหลัง swagger_parser; `tool/gen_api_client.sh` รวมให้แล้ว. (3) prereq host เพิ่ม: `python3`+pyyaml (normalize), `dart pub global activate swagger_parser` — CI ไม่มี Flutter/py stage (gate MOB เป็น local เหมือน MOB-01/02) จึง commit generated output เข้า repo. (4) `lib/api/generated/**` ถูก exclude จาก analyze อยู่แล้วใน analysis_options (P0-MOB-01 ผู้วางโครงจองไว้) — วาง output ตรงนั้นพอดี. (5) คิว ready เขต mobile หลังรอบนี้เหลือ **MOB-05 ตัวเดียว** (offline queue · ทำเฉพาะส่วนไม่ขึ้น Open Q #5) — ต่ำกว่าเกณฑ์ ≥5 มาก · **เตือน Wei:** ตอบ B-015 (ปลด MOB-04) + เติมคิว Phase 4-prep (ห้าม agent สร้าง task ผูก MVP เอง [TBD-MVP]). (6) Phase 4 screens จะ import `package:juneflow_mobile/api/generated/export.dart` แล้ว `JuneflowApiClient(dio, baseUrl: '.../api/v1')` — ดู `lib/api/README.md`.

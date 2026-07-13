---
name: port-screen
description: Port ONE pototype screen into apps/web with 100% design fidelity (PLAN.md §0) - locate the route in NAV-ROUTES.md, port the source .jsx, strip mock mechanics, wire i18n keys + tokens + generated API client, apply rulings C1-C10, finish with the visual-gate skill. Trigger keywords - port screen, port จอ, ทำจอ, สร้างหน้า, pototype, prototype screen, NAV-ROUTES, route, จอใหม่, UI page, apps/web screen, Fiori screen.
---

# port-screen — port หนึ่งจอจาก pototype เข้า `apps/web`

> เขต Frontend Web = Design Fidelity เข้มสุดของ repo (PLAN.md §8) — สิ่งที่ผู้ใช้เห็น/กด/อ่านต้องตรง pototype **100%** (PLAN.md §0 กฎข้อ 1) ห้ามออกแบบใหม่ ห้าม "ปรับปรุงให้ดีขึ้น" ห้ามใช้ component library หน้าตาอื่น
> อ่านก่อนเสมอ: `PLAN.md` §0 · `apps/web/CLAUDE.md` · แถว task ใน `TASKS.md`

## ขั้นตอนต่อจอ (ทำตามลำดับ)

### 1) หา route ของจอใน NAV-ROUTES

- เปิด `docs/extract/NAV-ROUTES.md` → หาแถวของจอในตาราง Route: `route id | ชื่อเมนู | parent | component | ไฟล์`
- จดให้ครบ: route id · ป้ายเมนู (ภาษาไทยฝั่ง NAV) · parent + module gating (`mod:`) · badge · ชื่อ component · ไฟล์ `.jsx` ต้นทาง
- เช็ค/อัปเดตแถว mapping ใน `apps/web/docs/port-map.md` (P0-WEB-04) ให้ตรงจอที่กำลัง port
- route ที่ไม่อยู่ใน NAV-ROUTES = ไม่มีจริง → **ห้ามสร้างเอง** เขียน `BLOCKERS.md`

### 2) อ่านโค้ดต้นทางใน `pototype/`

- อ่านไฟล์ `.jsx` ตามคอลัมน์ "ไฟล์" · เปิดพฤติกรรมจริงประกอบได้จาก `pototype/Juneflow Fiori.html`
- **ห้าม port เด็ดขาด** (PLAN.md §0 กฎข้อ 5): `finance.jsx` · `tweaks-panel.jsx` (โค้ดตาย ไม่ถูกโหลด/ไม่ถูก route) · `pototype/wat/` + `บุญบัญชี*.html` (คนละผลิตภัณฑ์) · ไฟล์ standalone build ทุกตัว (2–9 MB) · ธีม `Juneflow Ant Pro*` (ใช้ Fiori เท่านั้น)
- `pototype/` เป็น read-only — ห้ามแก้ไฟล์ต้นทางใดๆ

### 3) ถอดพฤติกรรมจาก FUNCTIONS.md

- เปิด `docs/handoff/FUNCTIONS.md` หมวดของจอ — รูปแบบ: **ฟังก์ชัน → trigger → input → พฤติกรรม → state/ผลลัพธ์**
- ครอบคลุมระดับปุ่ม: modal (`ctx.openModal`) · confirm + เหตุผล (`ctx.confirm`) · toast (`ctx.notify`) · การ navigate · validate ฟอร์ม · state machine ของจอ (เทียบ `docs/handoff/flows.html`)
- รายชื่อฟังก์ชันครบทุกตัว → `docs/handoff/FUNCTIONS-INVENTORY.md`

### 4) แยก "สิ่งที่ผู้ใช้เห็น" ออกจาก "กลไก mock" (PLAN.md §0 กฎข้อ 3)

กลไก mock ต่อไปนี้ **ห้ามลอกเข้า production** — แปลงตามตาราง:

| กลไก mock ใน pototype | สิ่งที่ต้องทำใน production |
|---|---|
| FK เป็นข้อความชื่อ (เช่น `vendor: "บจก. ..."`) | ใช้ `*_id` จริงตาม dictionary — ข้อมูลจาก API |
| แปลภาษาด้วย DOM MutationObserver | key-based `t()` จาก `@juneflow/i18n` (ขั้นที่ 5) |
| badge ตัวเลข hardcode ใน NAV | count จาก query จริง (คำตัดสิน C10) |
| ข้อมูล seed ใหม่ทุก reload | ข้อมูล persist จาก DB (central seed — ขั้นที่ 8) |

- **business rule ตามโค้ดให้คงไว้** เช่น `Math.round(price*10)` — อย่าตีความว่าเป็นบั๊กแล้วแก้เอง (ห้ามลอกบั๊กก็จริง แต่การชี้ว่าอะไรคือบั๊กเป็นของ Wei — สงสัย → `BLOCKERS.md`)

### 5) ทุกข้อความผ่าน i18n key

- ทุก string บนจอ = key จาก `@juneflow/i18n` (`packages/i18n` — คำแปลจาก `docs/extract/i18n-full.json` โครง 3 ชั้น: `dict` / `nav` / `phrases`) — **ห้ามแปลใหม่แม้แต่คำเดียว** ห้าม hardcode ข้อความ
- ค้น key จาก `docs/extract/I18N-KEYS.md` + `i18n-full.json` · **key ไม่มีในไฟล์ → เขียน `BLOCKERS.md` แล้วข้าม ห้ามเดา** (PLAN.md §0 กฎข้อ 2)
- รองรับ 4 ภาษา th/zh/en/ar — `ar` พลิก `dir=rtl` ทั้งจอ ยกเว้นตัวเลข/รหัสคง LTR

### 6) style ผ่าน tokens เท่านั้น

- สี/ฟอนต์/ระยะ/รัศมี มาจาก `@juneflow/tokens` (`packages/tokens` — ธีม fiori จาก tokens.css/tokens.json) **เท่านั้น — ห้าม hardcode ค่าใดๆ** ในโค้ดจอ
- **ข้อยกเว้นทางการ (คำตัดสิน B-037 ก):** literal (สี/px) ใส่ได้ **เฉพาะเมื่อ** (1) ก๊อป verbatim จาก prototype **และ** (2) ไม่มี token ตรงใน `@juneflow/tokens` — เช่น `#fff` · translucent-white · shadow rgba ที่ prototype hardcode ไว้เอง · ทุกสี/ค่าที่ **มี** token ต้องใช้ `var(--)` เสมอ ห้าม hardcode ทับ (ยึดตาม §0 กฎ 1 fidelity ก่อน กฎ 2 no-hardcode เมื่อชนกัน) · ค่าใหม่ที่ไม่ได้มาจาก prototype = ห้ามคิดเอง → `BLOCKERS.md`
- กติกา state จาก tokens.css: **empty state ทุกตาราง** + **loading ทุกการเปลี่ยนหน้า** (top progress 3px + skeleton)

### 7) ตัวเลข = class `num`

- ตัวเลขเงิน/จำนวนทุกที่ใช้ class `num` → `font-variant-numeric: tabular-nums` และ**ชิดขวาในตาราง**

### 8) ข้อมูลจริงผ่าน client ที่ generate + central seed

- data ทั้งหมดมาจาก API client ที่ generate จาก `packages/contracts/openapi.yaml` — **ห้ามเขียน model/fetch มือ** (PLAN.md §5)
- ข้อมูล dev มาจาก central seed (`packages/db` seed ตาม `docs/extract/MOCK-DATA.md`) — ห้ามสร้าง fixture เฉพาะกิจที่ขัด seed กลาง
- endpoint ที่จอต้องใช้แต่ไม่มีใน contract → `BLOCKERS.md` (contract change ผ่าน Wei เท่านั้น — PLAN.md §8)

### 9) apply คำตัดสิน C1–C10 (PLAN.md ภาคผนวก C)

- ไล่ตารางภาคผนวก C ทุกครั้ง — ข้อที่ชนจอฝั่ง web บ่อย:
  - **C1** จอ `sub.plans` ต้อง render **4 การ์ด** (S/M/L/Full)
  - **C3/C4** state ตาม flows/dictionary · UI e-Tax คงตาม pototype
  - **C5** UI แสดงตาม pototype (schema ใช้ชื่อ dictionary)
  - **C7** ป้ายเมนูใช้ฝั่ง **NAV** = "อนุมัติ BOQ" · เพิ่ม label `boq.bom` ตาม NAV
  - **C8** gate `subcon.*` ด้วย module `subcon` ให้ครบ · `aftersales` ไม่ผูก route
  - **C10** badge = count จาก query จริง
- ความขัดแย้งใหม่นอกตาราง → `BLOCKERS.md` **ห้ามตัดสินเอง** (PLAN.md §0 กฎข้อ 4)

### 10) ปิดจอด้วย visual gate

- ทุกจอต้องผ่าน **skill `visual-gate`** ก่อนถือว่า done (G5 — PLAN.md §9) — screenshot เทียบ reference ใน `tests/visual/reference/` แล้วบันทึกผลลง `REVIEW-QUEUE.md`

## เช็คลิสต์ก่อนนับว่าจอเสร็จ

- [ ] เลย์เอาต์/โครงเมนู/ป้าย/สี/ระยะ/พฤติกรรมปุ่ม-modal-ฟอร์ม-state ตรง pototype 100%
- [ ] ไม่มีกลไก mock หลุดเข้ามา (FK ชื่อ / MutationObserver / badge hardcode / reseed ทุก reload)
- [ ] ไม่มี string นอก i18n key · ไม่มีค่า style hardcode · ตัวเลขใช้ `num`
- [ ] empty state + loading ครบ · client จาก codegen เท่านั้น
- [ ] คำตัดสิน C1–C10 ที่เกี่ยวข้องถูก apply แล้ว
- [ ] ผ่าน `visual-gate` แล้ว + บันทึกผลใน `REVIEW-QUEUE.md`

# screen-map.md — บัญชีจอ mobile `pototype/mobile*.jsx` → Flutter (เขต `mobile` · เตรียม Phase 4)

> Task **P0-MOB-04** · เขต `apps/mobile` · PLAN.md §0 (Design Fidelity Protocol) + §7 (จอ mobile เริ่ม Phase 4)
> **การนับยึดคำตัดสิน Wei ใน `BLOCKERS.md` B-015 ตอบ (ก) 2026-07-13:** inventory = **26 จอ distinct + 1 host** ถือว่าครบ
> แหล่งความจริง (อ่านทุกครั้งก่อนสร้างจอ — PLAN.md §0 ข้อ 2 + apps/mobile/CLAUDE.md):
> - โค้ดจอ → `pototype/mobile.jsx` · `mobile-screens.jsx` · `mobile-pm.jsx` · `mobile-field.jsx` · `mobile-preview.jsx` (อ่าน .jsx ต้นทาง**ในรอบนั้น**เสมอ — การอ้างว่าเคยอ่านแล้วไม่นับ)
> - route/host → `docs/extract/NAV-ROUTES.md` แถว `mobile` (L118) · บัญชีไฟล์ → `docs/extract/INVENTORY.md` §2
> - ภาพอ้างอิง → `tests/visual/reference-index.md` (P0-QA-01) · พฤติกรรมจริง → เปิด `pototype/Juneflow Fiori.html` เมนู "Mobile Approval"
>
> **กติกาใช้ตาราง:** คอลัมน์ `โครง Flutter` เป็น **structural mapping เท่านั้น** (โครง widget จากโครงจอที่อ่านจาก .jsx จริง — ไม่ใช่ design ใหม่ ไม่เพิ่ม/ตัด element) · ทุกข้อความบนจอ = i18n key จาก `i18n-full.json` เท่านั้น · สี/ระยะ = `juneflowFioriTheme()` (gen จาก `packages/tokens` — P0-MOB-02) ห้าม hardcode

---

## 1) ขอบเขต & การนับ (B-015 ก)

| ไฟล์ | จอ distinct | window exports | top-level defs | หมายเหตุ |
|---|---|---|---|---|
| `mobile.jsx` (611 บรรทัด) | **5** | 5 (จอทั้งหมด) | 7 | + primitive ภายใน 2: `MobileStatusBar` (L3 · return null — iOS frame วาดเอง) · `MobileHeader` (L7) |
| `mobile-screens.jsx` (781 บรรทัด) | **12** | 13 | 17 | export รวม `MTabBar` (primitive — ไม่ใช่จอ) · primitive ภายในอีก 4: `MSection`/`MField`/`MInput`/`MPill` |
| `mobile-pm.jsx` (219 บรรทัด) | **5** | 5 (จอทั้งหมด) | 5 | + const `MPM_RESULTS` (L92 — ชุดค่าผลตรวจ ไม่ใช่ component) |
| `mobile-field.jsx` (189 บรรทัด) | **4** | 4 (จอทั้งหมด) | 4 | — |
| `mobile-preview.jsx` (147 บรรทัด) | **host 1** | 1 (`MobilePreview`) | 2 | + `MobileScreenRouter` (L109 · ภายใน ไม่ export) + const `MOBILE_GROUPS` (L3) |
| **รวม** | **26 + host = 27** | 28 | 35 | 28 exports − `MTabBar` (primitive) − `MobilePreview` (host) = **26 จอ** ✅ |

**Cross-check 3 ทาง (0 missing / 0 extra):**
- `MOBILE_GROUPS` (mobile-preview.jsx:3-44) = 5+4+5+4+4+2+2 = **26 screen ids**
- `MobileScreenRouter` (mobile-preview.jsx:109-145) = **26 branches** — ทุก id ใน MOBILE_GROUPS มี branch · ไม่มี branch เกิน
- ตาราง §3 ด้านล่าง = **26 แถว** — reconcile ครบทั้งสามแหล่ง · ไม่มีจอ orphan ใน 5 ไฟล์ (ตรวจ top-level defs ครบทุกตัวแล้ว)

---

## 2) Host — `MobilePreview` (mobile-preview.jsx:46)

- **บริบท:** route `mobile` ("Mobile Approval") ใน web shell — `NAV-ROUTES.md` L118 · mount จุดเดียวที่ `shell.jsx:307` (`<MobilePreview ctx={ctx}/>`) · ฝั่ง web ลงบัญชีเป็นจอ web แล้วใน `apps/web/docs/port-map.md` §1
- **โครง:** ซ้าย = sidebar การ์ดกลุ่มจอตาม `MOBILE_GROUPS` (7 กลุ่ม 26 จอ) + การ์ด "คุณสมบัติเด่น" · ขวา = `IOSDevice` 390×844 (จาก `ios-frame.jsx:190`) ครอบ `MobileScreenRouter`
- **โครง Flutter (structural):** ตัว host ไม่ใช่จอในแอป Flutter — สิ่งที่ map คือ **switch ของ `MobileScreenRouter` → route table 26 จอของแอป** (screen id = ชื่อ route) · `IOSDevice` = ตัวเครื่องจริง ไม่ port · พฤติกรรม back ใน router: `onClose` ของ approve/reject → กลับ `inbox` · จอ pm-*/st-*/fm-* รับ `setScreen` ไหลตามลำดับงาน → Navigator flow ตามลำดับเดียวกัน
- **ภาพอ้างอิง:** `tests/visual/reference/gallery/g2/45-s.jpg` (จอ host ทั้งใบฝั่ง web — reference-index.md L108) — เป็นภาพ mobile ใบเดียวที่มีใน reference ทั้งชุด

---

## 3) ตาราง 26 จอ distinct (เรียงตามกลุ่ม + ลำดับใน `MOBILE_GROUPS`)

> label = ข้อความใน `MOBILE_GROUPS` verbatim · คอลัมน์ **ภาพอ้างอิง = "—" ทุกจอ** (ดู §6 — ไม่มีภาพต่อจอใน reference · Phase 4 ต้องแคปจาก `Juneflow Fiori.html` ก่อนสร้าง ตาม §0 — **ห้ามใส่ภาพมั่ว**)

### กลุ่ม "อนุมัติเอกสาร" (approval) — mobile.jsx · 5 จอ

| id | label | component @ source | โครงจอ (จาก .jsx) | โครง Flutter (structural) | ภาพอ้างอิง |
|---|---|---|---|---|---|
| `inbox` | กล่องอนุมัติ | `MobileApprovalInbox` @ mobile.jsx:24 | MobileHeader + summary chips 3 ช่อง + filter pills (ทั้งหมด/ด่วน/PR/PO/WO) + list การ์ดเอกสาร (kind/no/title/ผู้ขอ/ยอด/เกินงบ) + tab bar inline 4 แท็บ (ดู D3) | Scaffold + header widget ร่วม + Row สถิติ + แถบ chip เลื่อนนอน + ListView.builder การ์ด + BottomNavigationBar | — |
| `detail` | รายละเอียดเอกสาร | `MobileApprovalDetail` @ mobile.jsx:179 | MobileHeader + status banner + การ์ดข้อมูล PR + ยอด/วงเงิน + budget progress bar + รายการวัสดุ + เส้นทางอนุมัติ (timeline จาก `APPROVERS` — ดู §7) + เอกสารแนบ + sticky action bar (x/แก้ไข/อนุมัติ) | Scaffold + SingleChildScrollView + progress custom (token สี) + timeline Column + bottom action bar ติดล่าง | — |
| `approve` | ยืนยันอนุมัติ | `MobileApproveSheet` @ mobile.jsx:393 | จอยืนยัน: ไอคอน ok + ข้อความยืนยัน + การ์ด "ส่งต่อไปยัง" + textarea หมายเหตุ + ปุ่มคู่ ยกเลิก/ยืนยันอนุมัติ · `onClose` → inbox | หน้า confirm เต็มจอ (route ใน frame ตาม router — ชื่อ "Sheet" แต่ render เป็นจอเต็ม) + TextField + ปุ่มคู่ล่าง | — |
| `reject` | ปฏิเสธ + เหตุผล | `MobileRejectSheet` @ mobile.jsx:460 | banner เตือน + radio เหตุผล 5 ข้อ (state) + textarea บังคับ + ปุ่มคู่ ยกเลิก/ส่งกลับให้แก้ไข · `onClose` → inbox | หน้าเต็มจอ + radio group + TextField + ปุ่มคู่ล่าง | — |
| `notif` | แจ้งเตือน | `MobileNotifications` @ mobile.jsx:543 | MobileHeader + filter pills 4 + list การ์ดแจ้งเตือน · kind=approval มีปุ่ม อนุมัติ/ดู inline | Scaffold + แถบ chip + ListView การ์ด + ปุ่ม action ในการ์ด | — |

### กลุ่ม "A · แจ้งซ่อม / After-Sales" (service) — mobile-screens.jsx · 4 จอ

| id | label | component @ source | โครงจอ (จาก .jsx) | โครง Flutter (structural) | ภาพอ้างอิง |
|---|---|---|---|---|---|
| `srv-new` | ลูกบ้าน · แจ้งซ่อมใหม่ | `MSrvNewReport` @ mobile-screens.jsx:61 | ฟอร์ม: ยูนิต + เลือกหมวด grid 6 ช่อง + คำอธิบาย + รูป ≥1 (grid + ปุ่มเพิ่ม) + นัดวันสะดวก + ปุ่มคู่ บันทึกร่าง/ส่งแจ้งซ่อม | หน้า form (field widgets ร่วมจาก MSection/MField) + GridView ตัวเลือกหมวด + photo grid + ปุ่มคู่ล่าง | — |
| `srv-track` | ลูกบ้าน · ติดตามสถานะ | `MSrvTrack` @ mobile-screens.jsx:125 | การ์ดสถานะ SR + timeline 5 ขั้น + ประวัติการซ่อม + การ์ด Warranty + `MTabBar(service)` | Scaffold + timeline Column + list ประวัติ + BottomNavigationBar ร่วม | — |
| `tech-jobs` | ช่าง · รายการงาน | `MTechJobs` @ mobile-screens.jsx:198 | สถิติ 3 ช่อง + การ์ดงานตาม status (fixing/scheduled/received) พร้อมปุ่ม action ต่างกันต่อ status + `MTabBar(service)` | Scaffold + Row สถิติ + ListView การ์ด + ปุ่มตามสถานะ | — |
| `tech-close` | ช่าง · ปิดงาน + ลายเซ็น | `MTechClose` @ mobile-screens.jsx:263 | รูปก่อน/หลังซ่อม + รายละเอียดงาน + วัสดุที่ใช้ + กล่องลายเซ็นลูกค้า + ปุ่ม ปิดงาน+ส่งแบบประเมิน | หน้า form + photo rows + พื้นที่เซ็น (custom paint) + CTA ล่าง | — |

### กลุ่ม "E · งาน PM (ช่าง)" (pm-eng) — mobile-pm.jsx · 5 จอ

| id | label | component @ source | โครงจอ (จาก .jsx) | โครง Flutter (structural) | ภาพอ้างอิง |
|---|---|---|---|---|---|
| `pm-jobs` | รายการงาน PM ของฉัน | `MPMJobs` @ mobile-pm.jsx:7 | filter segmented 3 (state) + การ์ดงาน PM/CM (สถานะ open/inprogress/overdue) · แตะการ์ด → `pm-checkin` + `MTabBar(field)` | Scaffold + segmented filter + ListView การ์ด (tap → Navigator ไปจอเช็คอิน) | — |
| `pm-checkin` | เช็คอินจุดบริการ (GPS) | `MPMCheckin` @ mobile-pm.jsx:52 | แผนที่ (mock grid + pin + ตำแหน่งฉัน) + การ์ดเขตบริการ/SLA/สัญญา + state เช็คอิน: ก่อน = ปุ่ม "เช็คอินหน้างาน (GPS)" · หลัง = banner สำเร็จ + ปุ่ม "เริ่มตรวจเช็ค" → `pm-checklist` | หน้าเต็มจอ + map widget (แผนที่จริงแทน mock) + stateful CTA 2 จังหวะ | — |
| `pm-checklist` | ตรวจเช็ครายการ PM | `MPMChecklist` @ mobile-pm.jsx:98 | 5 รายการตรวจ × (รูปก่อน/หลัง + ปุ่มผล 3 ค่า ปกติ/ปรับตั้ง/เปลี่ยน-ซ่อม จาก `MPM_RESULTS`) · header นับ "ตรวจแล้ว n/5" + ปุ่ม → `pm-notes` | ListView ของ section ต่อรายการ + toggle ผลตรวจ (state ต่อแถว) + CTA ล่าง | — |
| `pm-notes` | บันทึกสาเหตุ/แก้ไข | `MPMNotes` @ mobile-pm.jsx:148 | ฟิลด์ สาเหตุ/การแก้ไข/ข้อเสนอแนะ/อะไหล่ที่ใช้ + banner แจ้งสร้างใบเสนอราคา LINE OA + ปุ่ม → `pm-close` | หน้า form + info banner + CTA ล่าง | — |
| `pm-close` | ปิดงาน PM + ลายเซ็น | `MPMClose` @ mobile-pm.jsx:182 | สรุปงาน 5 แถว + tap-to-sign (state `signed` ปลดล็อกปุ่ม) + state `closed` = จอ success เต็มจอ + ปุ่มกลับ `pm-jobs` | หน้า summary + พื้นที่เซ็น + conditional success view + Navigator กลับต้นทาง | — |

### กลุ่ม "F · สโตร์ & โฟร์แมน" (storefm) — mobile-field.jsx · 4 จอ

| id | label | component @ source | โครงจอ (จาก .jsx) | โครง Flutter (structural) | ภาพอ้างอิง |
|---|---|---|---|---|---|
| `st-grlist` | สโตร์ · รอรับของ (PO) | `MStGRList` @ mobile-field.jsx:6 | การ์ด PO รอรับ (เลขที่/ผู้ขาย/ของ/กำหนดส่ง/ทะเบียนรถ) · แตะ → `st-receive` + `MTabBar(field)` | Scaffold + ListView การ์ด (tap → จอตรวจนับ) | — |
| `st-receive` | สโตร์ · ตรวจนับ + รับของ (GR) | `MStReceive` @ mobile-field.jsx:38 | ต่อรายการ: ปุ่ม ±10 ปรับ "รับจริง" (state) + เตือนขาด/เกิน + รูปของ/ใบส่งของ · ปุ่มยืนยัน (รับขาด → โทน warn) · state `done` = จอ success GR + กลับ `st-grlist` | หน้า stepper ต่อรายการ + เงื่อนไขสี/ข้อความตามผลนับ + conditional success view | — |
| `fm-progress` | โฟร์แมน · กรอก % งาน | `MFmProgress` @ mobile-field.jsx:93 | header เฉลี่ยโซน + ต่องาน: ปุ่ม ±5 + progress bar + % (state) + รูป + "เดิม x% → y%" + ปุ่มส่ง (แจ้งผ่าน `__juneflowCtx.notify` — ดู §7) | หน้า stepper %/progress ต่องาน + ส่งค่าเข้า API จริง | — |
| `fm-accept` | โฟร์แมน · รอตรวจรับ | `MFmAccept` @ mobile-field.jsx:146 | tab filter (ทั้งหมด/รอตรวจ/ตีกลับ) + รายการจาก `window.ACCEPT_ITEMS` filter subcon/gr (ดู §7) + ปุ่ม ตรวจรับผ่าน/ตีกลับ (state done ต่อแถว) + `MTabBar(field)` | Scaffold + tab filter + ListView + action คู่ต่อแถว (data จาก API) | `tests/visual/reference/mobile/fm-accept.png` |

### กลุ่ม "B · งานหน้างาน" (field) — mobile-screens.jsx · 4 จอ

| id | label | component @ source | โครงจอ (จาก .jsx) | โครง Flutter (structural) | ภาพอ้างอิง |
|---|---|---|---|---|---|
| `field-progress` | บันทึก Progress งวดงาน | `MFieldProgress` @ mobile-screens.jsx:316 | ข้อมูลผู้รับเหมา/งาน + progress งวด (bar+%) + รูปหน้างาน grid + หมายเหตุ + CTA ขออนุมัติงวด | หน้า form + progress + photo grid + CTA ล่าง | `tests/visual/reference/mobile/field-progress.png` |
| `field-gr` | ตรวจรับงาน / GR + QC | `MFieldGR` @ mobile-screens.jsx:364 | ผู้ขาย/ใบส่ง + รายการรับ (got/ordered · แถว partial โทน danger) + QC checklist 4 ข้อ + รูป + ปุ่มคู่ คืน-ปฏิเสธ/เซ็นรับ GR | หน้า list รับของ + checklist + ปุ่มคู่ล่าง | — |
| `field-pr` | สร้าง PR ด่วน | `MFieldQuickPR` @ mobile-screens.jsx:429 | เลือกจาก BOQ + รายการขอซื้อ + ความเร่งด่วน (ด่วน/ปกติ) + รูป+เหตุผล + banner สาย approval + CTA ส่ง PR ด่วน | หน้า form + ตัวเลือกความเร่งด่วน + info banner + CTA ล่าง | `tests/visual/reference/mobile/field-pr.png` |
| `field-stock` | เบิก/คืนวัสดุ + scan | `MFieldStock` @ mobile-screens.jsx:484 | ปุ่มสแกน QR/Barcode + รายการเบิก (± stepper ต่อแถว) + "ใช้กับ" WO + ปุ่มคู่ คืนวัสดุ/ยืนยันเบิก | หน้า list + scanner entry (กล้องจริงแทน mock) + stepper + ปุ่มคู่ล่าง | — |

### กลุ่ม "C · ช่าง & ความปลอดภัย" (safety) — mobile-screens.jsx · 2 จอ

| id | label | component @ source | โครงจอ (จาก .jsx) | โครง Flutter (structural) | ภาพอ้างอิง |
|---|---|---|---|---|---|
| `field-checkin` | GPS Check-in + งานวันนี้ | `MFieldCheckin` @ mobile-screens.jsx:534 | การ์ดโปรไฟล์ gradient + สถานะรัศมีไซต์ (GPS) + ปุ่มคู่ Check-in/Check-out + งานมอบหมายวันนี้ + `MTabBar(field)` | Scaffold + การ์ดโปรไฟล์ + ปุ่มลงเวลาคู่ + list งาน + BottomNavigationBar ร่วม | — |
| `field-hse` | HSE · รายงานความปลอดภัย | `MFieldHSE` @ mobile-screens.jsx:584 | ประเภทรายงาน grid 4 + ระดับความรุนแรง 4 ปุ่ม + คำอธิบาย + ตำแหน่ง GPS + รูป + CTA ส่งรายงานด่วน (โทน danger) | หน้า form + grid เลือกประเภท + segmented ความรุนแรง + CTA ล่าง | — |

### กลุ่ม "D · ผู้บริหาร & เซลล์" (exec) — mobile-screens.jsx · 2 จอ

| id | label | component @ source | โครงจอ (จาก .jsx) | โครง Flutter (structural) | ภาพอ้างอิง |
|---|---|---|---|---|---|
| `exec` | Executive Dashboard | `MExecDashboard` @ mobile-screens.jsx:647 | hero gradient ยอดขายสะสม + KPI grid 2×2 + S-Curve (SVG แผน/จริง + เส้นวันนี้) + "รออนุมัติของฉัน" 3 แถว พร้อมปุ่มอนุมัติ + `MTabBar(exec)` | Scaffold + hero card + GridView KPI + chart (custom painter/chart lib · สีจาก token) + list อนุมัติ | — |
| `sales-crm` | Sales CRM Mobile | `MSalesCRM` @ mobile-screens.jsx:722 | pipeline stage chips (Lead/นัดชม/จอง/สัญญา/โอน) + การ์ด lead (hot/warm) + ปุ่ม 3 โทร/LINE/นัดชม + `MTabBar(exec)` | Scaffold + แถบ chip เลื่อนนอน + ListView การ์ด + action row | — |

---

## 4) Shared primitives (port เป็น widget ร่วม — ไม่ใช่จอ ไม่นับ)

| primitive | source | ใช้โดย | โครง Flutter (structural) |
|---|---|---|---|
| `MobileHeader` | mobile.jsx:7 | ทุกจอทั้ง 26 | header widget ร่วม (title + sub + slot ซ้าย/ขวา) — ดู D4 เรื่อง comment ต้นทาง |
| `MobileStatusBar` | mobile.jsx:3 | — (return null — iOS frame วาดเอง) | ไม่ port — status bar ของเครื่องจริง |
| `MTabBar` | mobile-screens.jsx:3 (window export) | srv-track · tech-jobs · pm-jobs · st-grlist · fm-accept · field-checkin · exec · sales-crm (+ inbox ใช้ tab bar inline ของตัวเอง — ดู D3) | BottomNavigationBar ร่วม 5 แท็บ · **badge 17 = hardcode mock — production มาจาก query จริง (PLAN.md §0 ข้อ 3)** |
| `MSection` / `MField` / `MInput` / `MPill` | mobile-screens.jsx:28/35/44/50 | จอ form/list ส่วนใหญ่ (รวม mobile-pm.jsx · mobile-field.jsx ที่ใช้ข้ามไฟล์) | section card / labeled field / input / status pill widgets ร่วม |
| `IOSDevice` | ios-frame.jsx:190 (นอกชุด mobile*.jsx) | host เท่านั้น | ไม่ port — ตัวเครื่องจริง (viewport อ้างอิง 390×844) |
| `MPM_RESULTS` | mobile-pm.jsx:92 | `MPMChecklist` | ชุดค่าผลตรวจ 4 ค่า (none/normal/adjust/repair) — enum/const ฝั่ง Dart ตามค่าเดิม |

---

## 5) Dual context ของ 5 จอ approval (ตาม B-015 — บันทึกไว้ **โดยไม่นับซ้ำ**)

จอ `inbox`/`detail`/`approve`/`reject`/`notif` ปรากฏใน 2 บริบทของ spec:

1. **บริบทไฟล์ standalone (iOS frame):** `INVENTORY.md` §2 บรรยาย `mobile.jsx` ว่า "Mobile approval screens — แสดงใน iOS frame" และเอกสาร handoff (`ถอดฟังก์ชันตาม Flow.html`) รายชื่อ component approval ทีละตัว — เป็นบริบทเอกสาร/ที่มาของไฟล์
2. **บริบท MOBILE_GROUPS:** กลุ่มแรก "อนุมัติเอกสาร" ใน `mobile-preview.jsx:4-10` — บริบทที่ผู้ใช้เข้าถึงจริงผ่าน sidebar ของ host

**ข้อเท็จจริงจาก source (ตรวจรอบนี้):** จุด mount จริงมี**จุดเดียว** = `MobileScreenRouter` (mobile-preview.jsx:112-116) — grep ทั้ง `pototype/` ยืนยัน**ไม่มี** การ mount `MobileApproval*`/`Mobile*Sheet`/`MobileNotifications` ในไฟล์ .jsx อื่นใดนอก mobile.jsx (ที่ define) และ mobile-preview.jsx (ที่ mount) → นับ **5 จอ ครั้งเดียว** (แถวกลุ่ม approval ใน §3) · สมมุติฐาน "31" ของ zone CLAUDE.md = 26 + 5 (นับ approval ซ้ำสองบริบท) ตามบันทึก B-015 — Wei ตัดสิน (ก) ไม่นับซ้ำ

---

## 6) ภาพอ้างอิง (visual gate Phase 4)

- ตรวจ `tests/visual/reference-index.md` ครบทั้ง 128 แถว (gallery 106 + shots 22): ภาพที่ map ถึง mobile มี**ใบเดียว** = `gallery/g2/45-s.jpg` → route `mobile` = จอ host `MobilePreview` ทั้งใบฝั่ง web (L108) · ไม่มีแถวใดใน g1–g5 หรือ `shots/` map ไปจอใดจอหนึ่งใน 26 จอ
- **ทั้ง 26 จอจึงไม่มีภาพอ้างอิงต่อจอ** — ช่อง "ภาพอ้างอิง" ใน §3 = `—` ทุกแถวโดยเจตนา (โปร่งใส — ไม่ fabricate)
- ทางปฏิบัติ Phase 4 ตาม PLAN.md §0 Visual Gate: **จอที่ไม่มีภาพอ้างอิง → เปิด `Juneflow Fiori.html` จอเดียวกัน (เมนู Mobile Approval → เลือกจอใน sidebar) แคปเป็น reference ก่อนเริ่มสร้าง** — ใช้กับทุกจอในตารางนี้ · `g2/45-s.jpg` ใช้เทียบได้เฉพาะบริบท host/กรอบ ไม่ใช่รายจอ

---

## 7) กลไก mock / dependency ข้ามไฟล์ (ห้ามลอกเข้า production — PLAN.md §0 ข้อ 3)

| สิ่งที่เจอใน source | ตำแหน่ง | production ต้องเป็น |
|---|---|---|
| `APPROVERS` global (เส้นทางอนุมัติใน `detail`) | define ที่ `pr-form.jsx:79` — mobile.jsx ใช้ข้ามไฟล์ | approval chain จาก API (generated client — P0-MOB-03) |
| `window.ACCEPT_ITEMS` (รายการรอตรวจรับใน `fm-accept`) | define ที่ `company-accept.jsx:108` — filter `subcon`/`gr` | data จาก API — ไม่มี window global |
| `window.__juneflowCtx?.notify` (toast หลังส่ง % งาน / ตรวจรับ) | mobile-field.jsx:139,176-177 | notification จริงของแอป |
| badge/ตัวเลข hardcode (17 รออนุมัติ · chips สถิติ · จำนวนใน filter pills ทุกจอ) | ทุกไฟล์ | มาจาก query จริง |
| ข้อมูลรายการ inline ทุกจอ (PR/PO/SR/lead/วัสดุ ฯลฯ) | arrays ในตัว component | data จาก API + seed persist |
| สี/ระยะ inline `var(--...)` ทุกค่า | ทุกไฟล์ | `juneflowFioriTheme()` gen จาก `packages/tokens` (P0-MOB-02) — ห้าม hardcode |
| ลายเซ็น = SVG path ตายตัว / รูป = gradient placeholder / แผนที่ = grid mock | tech-close · pm-close · pm-checkin ฯลฯ | signature capture / กล้อง / แผนที่จริง — **โครงและตำแหน่งบนจอต้องตรงต้นแบบ** |

---

## 8) หมายเหตุความไม่ตรงกันของแหล่ง (บันทึกโปร่งใส — ไม่ตัดสินเอง · แบบเดียวกับ port-map.md §5)

- **D1 · จำนวนจอ "31" ใน `apps/mobile/CLAUDE.md` (sacred) vs source 26+host:** zone CLAUDE.md L14 เขียน "รวม 31 จอ" แต่ enumerate source ทั้ง 5 ไฟล์ได้ 26 จอ distinct + host (§1) — **Wei ตัดสินแล้ว (B-015 ก):** 26 distinct + host = ครบ · การแก้เลข "31" ในไฟล์ sacred = งานของ Wei เอง — เอกสารนี้ยึด 26+host และ**ไม่แตะ** zone CLAUDE.md
- **D2 · ช่องว่างภาพอ้างอิง:** จอ mobile 26/26 ไม่มีภาพอ้างอิงต่อจอ (มีแต่ g2/45 ระดับ host) — ไม่ใช่ blocker เพราะ §0 กำหนดทางออกไว้แล้ว (แคปจาก Fiori.html ก่อนสร้าง — §6) · บันทึกให้ agent Phase 4 วางเวลาแคป reference ต่อจอ
- **D3 · tab bar สองแบบใน source:** `MobileApprovalInbox` ใช้ tab bar inline **4 แท็บ** (Dashboard/อนุมัติ/เอกสาร/โปรไฟล์ — mobile.jsx:148-174) ขณะที่ `MTabBar` กลาง (mobile-screens.jsx:3) มี **5 แท็บ** (อนุมัติ/หน้างาน/แจ้งซ่อม/Dashboard/โปรไฟล์) · แท็บ "เอกสาร" (inbox) และ "โปรไฟล์"/`me` ไม่มีจอปลายทางใน `MOBILE_GROUPS`/router — source ไม่ได้ตัดสินว่าโครง navigation จริงของแอป Flutter ใช้แบบใด → **บันทึกไว้ ไม่ตัดสินเอง** · ถ้างานจอ Phase 4 บังคับต้องเลือก = เปิด BLOCKERS ก่อน (PLAN.md §0 ข้อ 4)
- **D4 · comment หัวไฟล์ mobile-pm.jsx คลาดเคลื่อน:** L3 เขียนว่าใช้ "MobileHeader … from mobile-screens" แต่ `MobileHeader` define ที่ **mobile.jsx:7** (mobile-screens.jsx ไม่มี) — ไม่มีผลพฤติกรรม (ทุกไฟล์โหลดเป็น global ตามลำดับใน `Juneflow Fiori.html:66-70`) · บันทึกกัน agent หลงหาไฟล์ผิด

---

## 9) สรุปความครบ (gate: ครบ 26 จอ distinct + host)

- ตาราง §3 = **26 แถว** (5 approval + 4 service + 5 pm-eng + 4 storefm + 4 field + 2 safety + 2 exec) + host §2 = **27** — ตรง B-015 (ก) · **0 missing / 0 extra**
- Cross-check เชิงโปรแกรม (§1): window exports 28 ตัว − primitive `MTabBar` − host `MobilePreview` = 26 · `MOBILE_GROUPS` 26 ids = router 26 branches = ตาราง 26 แถว · top-level defs 35 ตัว reconcile ครบ (26 จอ + host + router + primitive 7)
- เอกสารนี้ **docs-only** — ไม่มีการแก้โค้ด Dart/ไฟล์ต้นทางใด ๆ · `docs/extract/*` + zone CLAUDE.md (sacred) อ่านอย่างเดียว
- **review โดย Wei** (gate ตามแถว TASKS.md P0-MOB-04) — ไม่มี G1–G5 (เอกสาร inventory ไม่มีจอ/schema/contract)

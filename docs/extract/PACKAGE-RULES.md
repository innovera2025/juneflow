# PACKAGE-RULES — กติกาแพ็กเกจ S / M / L / Full

ถอดจากโค้ดจริง: `pototype/pkg-builder.jsx` ทั้งไฟล์ (functions `pkgPresetIds`, `PKG_STORE.seed`, `PKG_SUB_RULES`, `pkgMenuAllowed`, `pkgSubMenuAllowed`, `aiQuota`)

## 1. แพ็กเกจตั้งต้น (PKG_STORE seed)

| id | size | ชื่อ | ราคา/เดือน | ราคา/ปี | tagline | โครงการ | ผู้ใช้ | พื้นที่ (GB) | AI/เดือน | จำนวนเมนู |
|---|---|---|---|---|---|---|---|---|---|---|
| `starter` | S | Starter | 2,900 | 29,000 | ทีมเล็ก / โครงการเดียว | 2 | 5 | 20 | 10 | 6 |
| `pro` | M | Professional (`popular: true`) | 7,900 | 79,000 | ผู้รับเหมา / นักพัฒนาขนาดกลาง | 10 | 25 | 100 | 50 | 20 |
| `business` | L | Business | 14,900 | 149,000 | หลายโครงการ + ทีมขาย/HR | 30 | 60 | 300 | 200 | 29 |
| `enterprise` | Full | Enterprise | null ("ติดต่อทีมขาย") | null | องค์กรใหญ่ · ทุกเมนู + API/SSO | -1 (∞) | -1 (∞) | 1000 | -1 (ไม่จำกัด) | 37 (ทุกเมนู) |

ค่า `-1` = ไม่จำกัด (แสดงเป็น ∞ / "ไม่จำกัด" ใน UI)

## 2. เมนูที่แต่ละไซซ์เปิด (pkgPresetIds — เป็น nav id ระดับบนสุด)

สะสมแบบ S ⊂ M ⊂ L ⊂ Full:

| ไซซ์ | เมนูที่เพิ่มจากไซซ์ก่อนหน้า |
|---|---|
| **S** (6 เมนู) | `dashboard`, `boq`, `proc`, `petty`, `timeline`, `reports` |
| **M** (20 เมนู) | + `land`, `subcon`, `accept`, `inv`, `pm`, `gl`, `ap`, `ar`, `bank`, `tax`, `fa`, `alloc`, `dms`, `master` |
| **L** (29 เมนู) | + `sales`, `labor`, `opex`, `exec`, `mobile`, `line`, `users`, `audit`, `settings` |
| **Full** (37 = ทุกเมนูใน NAV) | + `solar.monitor`, `solar.ppa`, `solar.roi`, `solar.permit`, `solar.warranty`, `sub`, `admin`, `sync` |

หมายเหตุตามโค้ด: preset intersect กับเมนูที่มีจริงใน `window.NAV` (`filter(has)`) — จำนวนข้างต้นคำนวณจาก NAV ปัจจุบันใน chrome.jsx

## 3. PKG_SUB_RULES — เมนูย่อยที่ล็อกตามไซซ์

```js
const PKG_SUB_RULES = { "master.ptype": ["Full"], "boq.aiqto": ["M", "L", "Full"] };
```

| sub-menu id | เปิดให้ไซซ์ | ความหมายตาม comment ในโค้ด |
|---|---|---|
| `master.ptype` (ประเภทโครงการ) | Full เท่านั้น | "Project Type เฉพาะ Full" |
| `boq.aiqto` (AI ถอด BOQ) | M, L, Full | "AI QTO เฉพาะ M ขึ้นไป" |

sub-menu อื่นที่ไม่มี rule = เปิดตามเมนู parent

## 4. กติกาการซ่อน/เปิดเมนู

- `pkgMenuAllowed(navId)`: `dashboard` และ `sub` (แพ็กเกจของฉัน) **เปิดเสมอ** ทุกแพ็กเกจ; ที่เหลือเช็ค `p.menus.includes(navId)`
- แพ็กเกจ tenant ปัจจุบัน: `window.__tenantPkg` → fallback `window.MY_SUB.pkg` → fallback ค่า default `"pro"`
- ถ้าไม่พบแพ็กเกจ (`tenantPkg()` = null) → เปิดทุกเมนู
- เปลี่ยนแพ็กเกจแล้วหน้าปัจจุบันถูกซ่อน → navigate กลับ `dashboard` (`setTenantPkg`)
- `PkgDemoSwitcher` = ชิปจำลองแพ็กเกจในหน้า "แพ็กเกจของฉัน" (sub.mine)

## 5. โควต้า AI ถอด BOQ (aiQuota)

- limit = `limits.ai` ของแพ็กเกจ tenant; ถ้าไม่มีแพ็กเกจ = 50
- mock การใช้งานเดือนนี้: `window.__aiUsed = 18`
- `limit < 0` = ไม่จำกัด (left = Infinity)
- สี chip: ไม่จำกัด=ok, เหลือ 0=danger, เหลือ ≤5=warn, อื่น=brand
- เครดิตหมด → modal "เครดิต AI ถอด BOQ หมดแล้ว" ข้อความในโค้ด: "L = 200/ด. · Full = ไม่จำกัด" + ปุ่มอัปเกรดไป `sub.plans`

## 6. Package Builder (ฝั่ง Platform Admin — หน้า admin.plans)

- สร้าง/แก้แพ็กเกจได้เอง: ชื่อ, ราคา/เดือน (หรือติ๊ก "ติดต่อทีมขาย" = null), โครงการ, ผู้ใช้, พื้นที่ GB, AI/เดือน, และติ๊กเลือกเมนูรายตัวจากโครง NAV จริง (จัดกลุ่มตาม section)
- ราคา/ปี คำนวณอัตโนมัติ = `Math.round(price * 10)`
- id ใหม่ = ชื่อ lower-case แทนช่องว่างด้วย `-`
- สีตามไซซ์: S `#5A7CA8`, M `#0B2A4A`, L `#0F766E`, Full `#B45309`
- validation: ต้องมีชื่อ, ต้องมีราคา (ถ้าไม่ติ๊ก contact), ต้องเลือกอย่างน้อย 1 เมนู
- ช่อง AI ว่าง → default 50; ช่องโควต้าอื่นว่าง/ไม่ใช่ตัวเลข → -1
- ข้อมูลแพ็กเกจอยู่ในหน่วยความจำเท่านั้น (`PKG_STORE` seed ใหม่ทุก reload — ไม่มี persistence ในโค้ด)

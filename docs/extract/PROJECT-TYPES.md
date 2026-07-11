# PROJECT-TYPES — ประเภทโครงการ 4 แบบ

ถอดจากโค้ดจริง: `pototype/project-types.jsx` ทั้งไฟล์ (const `PROJECT_TYPES`, functions `activeProject`, `activeProjectType`, `moduleOn`, `routeModule`, `routeAllowedForProject`)

## 1. ประเภทโครงการ (PROJECT_TYPES)

| id | ชื่อไทย | ชื่ออังกฤษ | icon | สี | คำอธิบายในโค้ด |
|---|---|---|---|---|---|
| `realestate` | อสังหาริมทรัพย์ | Real Estate | building | `#0B2A4A` | บ้านจัดสรร / คอนโด / ทาวน์โฮม — ครบวงจรตั้งแต่ก่อสร้างถึงขายและบริการหลังการขาย |
| `solar` | โซลาเซลล์ / พลังงาน (EPC) | Solar / Energy EPC | sun | `#B45309` | โรงไฟฟ้าพลังงานแสงอาทิตย์ — EPC, ขายไฟ/PPA, O&M, ROI และการขออนุญาต |
| `civil` | ก่อสร้างทั่วไป / โยธา | General / Civil | hardhat | `#0F766E` | งานโยธา-ก่อสร้างทั่วไป — เน้น BOQ จัดซื้อ และบริหารผู้รับเหมา |
| `service` | โครงการบริการ / ทั่วไป | Service / General | briefcase | `#6D28D9` | งานบริการ / ที่ปรึกษา — เน้นงบประมาณและแผนงาน (Timeline) ไม่มีงานก่อสร้าง |

## 2. Hierarchy labels (โครง WBS ต่อประเภท)

| type | ลำดับชั้น |
|---|---|
| `realestate` | โครงการ → เฟส → บล็อก / อาคาร → ยูนิต → Model / แบบ (5 ชั้น) |
| `solar` | ไซต์ → โซน / Array → String → Inverter (4 ชั้น) |
| `civil` | โครงการ → ส่วนงาน / โซน → WBS (3 ชั้น) |
| `service` | โครงการ → เฟส → งาน (WBS) (3 ชั้น) |

## 3. Cost types ต่อประเภท

| type | costTypes |
|---|---|
| `realestate` | วัสดุ, ค่าแรง, สั่งจ้าง / เหมา, ค่าใช้จ่ายอื่น |
| `solar` | อุปกรณ์ (Module/Inverter), งานติดตั้ง (EPC), งานโยธา / ฐานราก, ค่าขนส่ง, ขออนุญาต / ที่ปรึกษา |
| `civil` | วัสดุ, ค่าแรง, เครื่องจักร, สั่งจ้าง / เหมา |
| `service` | ค่าบริการ / ที่ปรึกษา, ค่าแรง, ค่าใช้จ่ายอื่น |

## 4. Modules ที่เปิดต่อประเภท

| module | realestate | solar | civil | service |
|---|---|---|---|---|
| `land` | ✓ | ✓ | ✓ | ✓ |
| `boq` | ✓ | ✓ | ✓ | — |
| `proc` | ✓ | ✓ | ✓ | ✓ |
| `subcon` | ✓ | ✓ | ✓ | — |
| `timeline` | ✓ | ✓ | ✓ | ✓ |
| `inv` | ✓ | ✓ | ✓ | — |
| `petty` | ✓ | ✓ | ✓ | ✓ |
| `pm` | ✓ | ✓ | ✓ | ✓ |
| `sales_re` | ✓ | — | — | — |
| `aftersales` | ✓ | — | — | — |
| `lineoa` | ✓ | — | — | — |
| `om` | — | ✓ | — | — |
| `ppa` | — | ✓ | — | — |
| `roi` | — | ✓ | — | — |
| `permit` | — | ✓ | — | — |
| `warranty` | — | ✓ | — | — |

## 5. การ map route → module (routeModule)

| เงื่อนไข route | module |
|---|---|
| `land.*` | land |
| `pm.*` | pm |
| `boq.*` | boq |
| `pr.*` / `po.*` / `wo.*` / `gr.*` (regex `^(pr|po|wo|gr)\.`) | proc |
| `subcon` (exact) | subcon |
| `timeline` (exact) | timeline |
| `inv.*` | inv |
| `petty` (exact) | petty |
| `sales.*` | sales_re |
| `line` (exact) | lineoa |
| `solar.monitor` | om |
| `solar.ppa` | ppa |
| `solar.roi` | roi |
| `solar.permit` | permit |
| `solar.warranty` | warranty |
| อื่น ๆ ทั้งหมด | null = เปิดเสมอ |

## 6. กติกาการทำงาน (ตามโค้ด)

- `moduleOn(mod)`: mod ว่าง/ไม่รู้จัก = เปิดเสมอ; อื่น ๆ เช็ค `activeProjectType().modules[mod]`
- โครงการ active มาจาก tweak `project` (default `"rjp.p2"`); ไม่พบโครงการ → fallback type `realestate`
- `routeAllowedForProject(route, projectId)`: route ที่ไม่ผูก module = เข้าได้ทุกประเภท
- `TypeBadge` แสดงชื่อไทย/อังกฤษตามภาษา (`I18N.get() === "en"` → nameEn)

## 7. ข้อสังเกตตามโค้ด (ไม่ตีความ)

- module `aftersales` ประกาศใน `realestate.modules` แต่ **ไม่มี** ใน `routeModule` และไม่มีเมนูใดใน NAV ใช้ `mod: "aftersales"` (route `sales.service` ถูก gate ด้วย `sales_re` ผ่าน prefix `sales.*`)
- `routeModule("subcon")` จับเฉพาะ route `subcon` เป๊ะ ๆ — route `subcon.progress`, `subcon.contracts` (ที่ใช้จริงในเมนู) ไม่เข้าเงื่อนไข → คืน null = เปิดเสมอ ในขณะที่เมนู sidebar gate ด้วย `mod: "subcon"` ที่ระดับ NAV
- comment ในไฟล์: "unknown module = always on"

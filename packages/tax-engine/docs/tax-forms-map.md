# Thai Tax Forms — Field Inventory Map

> Task **P0-INT-05** · zone `integrations` · prep for **Phase 3**
> Source of truth: `~/Documents/juneflow/pototype/tax-forms.jsx` (727 lines, header comment: *"Official Thai tax forms — ภ.พ.30, ภ.ง.ด.3/53, 50 ทวิ — v2 (accurate to RD originals)"*)
>
> **Purpose:** enumerate every field the prototype renders on each Thai Revenue Department (RD) form, so the Phase-3 `TaxEngine` (`packages/tax-engine`, impl `thailand`) can produce data objects that let `apps/web` render each form **100% identical to `tax-forms.jsx`** (PLAN.md §0). This is an inventory only — no layout/labels/behavior are redesigned here.
>
> **Fidelity rules that bind this inventory (PLAN.md §0):**
> - Thai labels below are transcribed verbatim from the source — they are the RD form wording, **not** re-translations. When these strings are rendered in `apps/web`, copy must still come from an i18n key (any label missing from `i18n-full.json` → `BLOCKERS.md`).
> - Computed fields (marked **calc**) reproduce the exact formula in the source — they are business rules, not mock mechanics, so they must be kept (PLAN.md §0 rule 3).
> - Seed sample values in the source `data ||` defaults (company name, tax IDs, amounts) are **mock defaults**; production supplies real data through the same field shape. The default values are listed only to document each field's type/example.

---

## Legend

| Column | Meaning |
|---|---|
| **key** | property path on the component's `data` (`d`) object, or `—` for static/derived-only |
| **form label (TH)** | wording printed on the form, verbatim from source |
| **kind** | `input` = comes from data · **calc** = derived in-component (formula given) · `static` = fixed form chrome · `sample` = mock default only |
| **type** | data type expected from `TaxEngine` |
| **notes** | RD line no. / formula / source line ref |

---

## 0. Shared primitives (used by all forms)

Defined once in `tax-forms.jsx`, reused across the three forms. Phase-3 web port must reuse the same primitives — do not re-style.

### `FormPage({ children, onClose, title })` — src L7–49
A4 white-paper modal (width 820px) with a sticky dark toolbar. Fields:

| element | form label (TH) | kind | notes |
|---|---|---|---|
| toolbar title | prop `title` (per form, see each section) | static | L28 |
| print button | `พิมพ์ / ดาวน์โหลด PDF` → `window.print()` | static | L31–33 · triggers `@media print` CSS (L61–67) |
| close button | `ปิด` (red `#B91C1C`) | static | L34–36 |
| paper font | `"Sarabun","TH Sarabun New","IBM Plex Sans Thai",serif` | static | L41 — mandatory Thai-official font stack |

Print CSS (`#form-print-css`, L57–91) defines the shared classes: `.tax-form`, `.grid-tax-id`, `.ck` / `.ck.on` (checkbox with ✓), `.box`, `.field-line` (dotted underline), `.v-label` (vertical rotated label), tables with `1px solid #000` borders and `#F0F0F0` header fill. **These class definitions are the visual contract** — reproduce byte-faithfully.

### `TaxIdBoxes({ value, len=13 })` — src L93–96
Renders a 13-digit Thai tax ID as individual bordered boxes (`.grid-tax-id span`, 18×22px). Pads/truncates `value` to `len`. Used for every taxpayer ID field below.

### `AddrCell({ l, v })` — src L329–336
Dotted-underline labelled address cell (`<label>` small gray + value, `—` when empty). Used by ภ.พ.30 address grid.

### `PartyBox({ title, party })` — src L673–685
Boxed party block (name + `TaxIdBoxes` + branch boxes + address). Used by 50 ทวิ for payer/payee. `party` shape: `{ name, taxId, branch, addr }`.

### `bahtText(n)` — src L687–711
**calc** — converts a number to Thai baht text (e.g. `19350` → `หนึ่งหมื่นเก้าพันสามร้อยห้าสิบบาทถ้วน`). Handles `เอ็ด`/`ยี่สิบ` rules, `ถ้วน` when no satang, else `...สตางค์`. Used by 50 ทวิ total-in-words. **Business rule — keep exactly.**

### `TH_MONTHS_FULL` — src L102
Constant array of 12 full Thai month names `["มกราคม",…,"ธันวาคม"]`. Used by ภ.พ.30 month checkboxes.

### Openers — src L717–725
- `openPND30(ctx, data)` → `<PND30Form>`
- `openPND53(ctx, kind="53", data)` → `<PND53Form kind>`
- `openWHTCertificate(ctx, data)` → `<WHTCertificate>`

All open via `ctx.openModal({ kind:"fullbleed", … })`. Exported to `window` (L727).

---

## Form A — ภ.พ.30 (VAT return / แบบแสดงรายการภาษีมูลค่าเพิ่ม)

Component `PND30Form({ ctx, onClose, data })` — src L104–327 · toolbar title `ภ.พ.30 · แบบแสดงรายการภาษีมูลค่าเพิ่ม` · footer stamp `ภ.พ.30 (กรมสรรพากร · ปรับปรุง พ.ศ. 2566)`.

### A.1 — Taxpayer identity block (src L184–196)

| key | form label (TH) | kind | type | notes |
|---|---|---|---|---|
| `company` | ชื่อผู้ประกอบการ | input | string | L186 |
| `taxId` | เลขประจำตัวผู้เสียภาษีอากร | input | string(13) | L190 · via `TaxIdBoxes` |
| `branch` | สาขาที่ | input | string(5) | L193–194 · digit boxes; `"00000"` = HQ |

### A.2 — Establishment address (src L199–221) — object `addr`

RD splits the address into fixed sub-fields. Each is an `AddrCell`.

| key (`addr.*`) | form label (TH) | kind | type | notes |
|---|---|---|---|---|
| `bldg` | อาคาร | input | string | L203 |
| `room` | ห้องเลขที่ | input | string | L204 |
| `floor` | ชั้นที่ | input | string | L205 |
| `village` | หมู่บ้าน | input | string | L206 |
| `no` | เลขที่ | input | string | L209 |
| `moo` | หมู่ที่ | input | string | L210 |
| `soi` | ตรอก/ซอย | input | string | L211 |
| `junction` | แยก | input | string | L212 |
| `road` | ถนน | input | string | L213 |
| `tambon` | ตำบล/แขวง | input | string | L216 |
| `amphoe` | อำเภอ/เขต | input | string | L217 |
| `province` | จังหวัด | input | string | L218 |
| `zip` | รหัสไปรษณีย์ | input | string | L219 |
| `tel` | โทรศัพท์ | input | string | L220 |

### A.3 — Filing type & tax period (src L177–232)

| key | form label (TH) | kind | type | notes |
|---|---|---|---|---|
| `—` | (1) ยื่นปกติ | static | — | L179 · checked ✓ hardcoded (normal filing) |
| `—` | (2) ยื่นเพิ่มเติม ครั้งที่ .... | static | — | L180 · unchecked blank |
| `monthIdx` | เดือนภาษี (เลือกได้เพียง 1 เดือน) | input | int 0–11 | L228–230 · checks the matching month in `TH_MONTHS_FULL` |
| `year` | ปี พ.ศ. | input | string (พ.ศ.) | L226 · Buddhist-era year, e.g. `"2569"` |

### A.4 — Branch-filing case (src L235–240)

| key | form label (TH) | kind | type | notes |
|---|---|---|---|---|
| `isHQ` | ยื่นรวมกัน / ยื่นแยกแต่ละสาขา | input | bool | L237–238 · `true`→ยื่นรวมกัน, `false`→ยื่นแยก |
| `branchCount` | จำนวนสาขาที่ยื่นรวมกันในแบบนี้ | input | int | L239 |

### A.5 — 16-line VAT calculation table (src L242–282)

Grouped by vertical labels: **ภาษีขาย** (sales tax, lines 1–5), **ภาษีซื้อ** (purchase tax, lines 6–7), **ภาษีมูลค่าเพิ่ม** (VAT, lines 8–10), **ภาษีสุทธิ** (net, lines 11–16). Column header: `ข้อ | รายการ | จำนวนเงิน (บาท)`. Amounts via `fmtB` = `Intl.NumberFormat("th-TH", 2dp)`; `0` renders as `—` unless `showZero`.

| line | key / formula | form label (TH) | kind | notes |
|---|---|---|---|---|
| 1 | `v1 = salesAll` | ยอดขายในเดือนนี้ | input | L129,261 |
| 2 | `v2 = zeroSales` | หัก ยอดขายที่เสียภาษีในอัตราร้อยละ 0 (ถ้ามี) | input | L130,262 |
| 3 | `v3 = exemptSales` | หัก ยอดขายที่ได้รับยกเว้น (ถ้ามี) | input | L131,263 |
| 4 | `v4 = v1 - v2 - v3` | ยอดขายที่ต้องเสียภาษี (1.-2.-3.) | **calc** | L132,264 · strong row |
| 5 | `v5 = salesVat` | ภาษีขายเดือนนี้ | input | L133,265 · tint `#E8F4F0` |
| 6 | `v6 = purchaseBase` | ยอดซื้อที่มีสิทธินำภาษีซื้อมาหักฯ | input | L134,267 |
| 7 | `v7 = purchaseVat` | ภาษีซื้อเดือนนี้ (ตามใบกำกับภาษีของยอดซื้อตาม 6.) | input | L135,268 · tint `#E8F4F0` |
| 8 | `v8 = v5>v7 ? v5-v7 : 0` | ภาษีที่ต้องชำระเดือนนี้ (ถ้า 5. มากกว่า 7.) | **calc** | L136,270 |
| 9 | `v9 = v5<v7 ? v7-v5 : 0` | ภาษีที่ชำระเกินเดือนนี้ (ถ้า 5. น้อยกว่า 7.) | **calc** | L137,271 |
| 10 | `v10 = refundCarry` | ภาษีที่ชำระเกินยกมา | input | L138,272 |
| 11 | `v11 = v8>v10 ? v8-v10 : 0` | ภาษีสุทธิที่ต้องชำระ (ถ้า 8. มากกว่า 10.) | **calc** | L139,274 |
| 12 | `v12 = v8<v10 ? v10-v8 : 0` | ภาษีสุทธิที่ชำระเกิน | **calc** | L140,275 |
| 13 | `v13 = surcharge` | เงินเพิ่ม | input | L141,276 |
| 14 | `v14 = penalty` | เบี้ยปรับ | input | L142,277 |
| 15 | `v15 = v11 + v13 + v14` | รวมภาษี เงินเพิ่ม และเบี้ยปรับที่ต้องชำระ | **calc** | L143,278 · label notes `((11+13+14) หรือ (13+14-12))`; tint `#E8EEF6` |
| 16 | `v16 = max(0, v12 - v13 - v14)` | รวมภาษีที่ชำระเกิน หลังคำนวณเงินเพิ่มและเบี้ยปรับ (12.-13.-14.) | **calc** | L144,279 |

### A.6 — Refund request block (src L284–298)

| key | form label (TH) | kind | type | notes |
|---|---|---|---|---|
| `refundMode` | การขอคืนภาษี (กรณีมีภาษีชำระเกิน) | input | enum `"carry"｜"cash"｜"promptpay"` | L124,288–292 |
| ↳ `carry` | ขอนำไปชำระภาษีเดือนถัดไป | — | — | L288 |
| ↳ `cash` | ขอคืนเป็นเงินสด | — | — | L289 |
| ↳ `promptpay` | โอนเข้าบัญชีพร้อมเพย์ ที่ผูกกับเลขประจำตัวผู้เสียภาษี | — | — | L291 |
| `promptpayId` | (PromptPay tax-ID boxes) | input | string(13) | L292 · via `TaxIdBoxes`, shown for `promptpay` |
| `—` | ลงชื่อผู้ขอคืนภาษี ..... | static | — | L296 |

### A.7 — Signature / officer footer (src L300–323)

| key | form label (TH) | kind | notes |
|---|---|---|---|
| `—` | คำเตือน ผู้ใดยื่นรายการเท็จมีโทษ… / ข้าพเจ้าขอรับรอง… + ลงชื่อผู้มีอำนาจลงนาม / ตำแหน่ง / ยื่นวันที่ | static | L303–308 |
| `—` | สำหรับเจ้าหน้าที่ (เลขที่รับ / วันที่ / ลงชื่อเจ้าหน้าที่) | static | L311–316 |
| `—` | เลขรับ / วันที่ (top-right receipt box) | static | L171–173 |

---

## Form B — ใบแนบ ภ.ง.ด.3 / ภ.ง.ด.53 (WHT return attachment)

Component `PND53Form({ ctx, onClose, kind="53", data })` — src L342–503. **One component renders two RD forms** via `kind`:
- `kind="3"` → **ภ.ง.ด.3** (บุคคลธรรมดา / personal, ม.59) · `isPersonal = true`
- `kind="53"` → **ภ.ง.ด.53** (นิติบุคคล / corporate, ม.69ทวิ + ม.3เตรส) · `isPersonal = false`

Toolbar title `ใบแนบ ภ.ง.ด.{kind} · {บุคคลธรรมดา|นิติบุคคล}` (L365) · footer `ใบแนบ ภ.ง.ด.{kind} · กรมสรรพากร` (L498).

### B.1 — Form selector & header

| key | form label (TH) | kind | type | notes |
|---|---|---|---|---|
| `kind` (prop) | drives ภ.ง.ด.3 vs 53 | input | `"3"｜"53"` | L342 · default `"53"` |
| `—` (derived) | subtitle: ม.59 (personal) vs ม.69ทวิ+ม.3เตรส (corporate) | **calc** | L375–378 |
| `pageNo` | แผ่นที่ | input | int | L381 |
| `pageTotal` | ในจำนวน … แผ่น | input | int | L382 |

### B.2 — Withholder (payer) block (src L387–400)

| key | form label (TH) | kind | type | notes |
|---|---|---|---|---|
| `company` | ผู้มีหน้าที่หักภาษี ณ ที่จ่าย | input | string | L389 |
| `taxId` | เลขประจำตัวผู้เสียภาษีอากร | input | string(13) | L393 · `TaxIdBoxes` |
| `branch` | สาขาที่ | input | string(5) | L397 |

### B.3 — Line-item table `rows[]` (src L402–455)

RD column order (header L405–419): `ลำดับที่ | เลขผู้เสียภาษี | สาขา | ชื่อและที่อยู่ของผู้มีเงินได้ | วัน เดือน ปี ที่จ่าย | ประเภทเงินได้พึงประเมินที่จ่าย | อัตราภาษี ร้อยละ | จำนวนเงินที่จ่ายในครั้งนี้ | ภาษีที่หักและนำส่งในครั้งนี้ | เงื่อนไข (1)/(2)`. Renders min 6 rows (pads empty, L439–443).

Per-row object (`rows[i]`):

| key (`row.*`) | form label (TH) | kind | type | notes |
|---|---|---|---|---|
| `no` | ลำดับที่ | input | int | L424 |
| `tax` | เลขประจำตัวผู้เสียภาษีอากร (ของผู้มีเงินได้) | input | string(13) | L425 |
| `brn` | สาขา | input | string(5) | L426 |
| `name` | ชื่อ…ของผู้มีเงินได้ | input | string | L428 |
| `addr` | ที่อยู่…ของผู้มีเงินได้ | input | string | L429 |
| `date` | วัน เดือน ปี ที่จ่าย | input | string (Thai date) | L431 · e.g. `"25 พ.ค. 2569"` |
| `type` | ประเภทเงินได้พึงประเมินที่จ่าย | input | string | L432 · e.g. `ค่าจ้างทำของ/รับเหมา (ม.3 เตรส)` |
| `rate` | อัตราภาษี ร้อยละ | input | number | L433 · e.g. 1 / 3 / 5 |
| `income` | จำนวนเงินที่จ่ายในครั้งนี้ | input | number | L434 · `fmtB` 2dp |
| `wht` | ภาษีที่หักและนำส่งในครั้งนี้ | input | number | L435 |
| `cond` | เงื่อนไข (1)/(2) | input | int `1｜2` | L436 · (1)=หัก ณ ที่จ่าย, (2)=ออกภาษีให้ (note L462–464) |

### B.4 — Totals & summary (src L445–495)

| key / formula | form label (TH) | kind | notes |
|---|---|---|---|
| `d.rows.length` | รวม … ราย | **calc** | L448 / L482 |
| `totalIncome = Σ rows.income` | ยอดเงินที่จ่ายรวม | **calc** | L360,450,485 |
| `totalWht = Σ rows.wht` | ภาษีที่หักและนำส่งรวม | **calc** | L361,451,488 |
| `—` | หมายเหตุ เงื่อนไข (1) หัก ณ ที่จ่าย / (2) ออกภาษีให้ | static | L461–465 |
| `—` | ลงชื่อผู้จ่ายเงิน / ตำแหน่ง / ยื่นวันที่ / ประทับตรานิติบุคคล | static | L468–494 |

---

## Form C — 50 ทวิ (Withholding Tax Certificate / หนังสือรับรองการหักภาษี ณ ที่จ่าย)

Component `WHTCertificate({ ctx, onClose, data })` — src L509–671 · toolbar title `หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)` · subtitle `ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร` · footer `50 ทวิ · กรมสรรพากร (ปรับปรุง พ.ศ. 2566)`.

### C.1 — Document identity (src L550–567)

| key | form label (TH) | kind | type | notes |
|---|---|---|---|---|
| `bookNo` | เล่มที่ | input | string | L552 · e.g. `"12/2569"` |
| `certNo` | เลขที่ | input | string | L552 · also printed in footer L657 |
| `copy` | ฉบับที่ 1 / ฉบับที่ 2 | input | int `1｜2` | L565–566 · 1=แนบแบบฯ, 2=เก็บเป็นหลักฐาน |

### C.2 — Payer / payee (`payer`, `payee` — via `PartyBox`) (src L570–573)

Each object: `{ name, taxId, branch, addr }`.

| key | form label (TH) | kind | type | notes |
|---|---|---|---|---|
| `payer.*` | ผู้มีหน้าที่หักภาษี ณ ที่จ่าย (ชื่อ/เลขผู้เสียภาษี/สาขา/ที่อยู่) | input | object | L571 |
| `payee.*` | ผู้ถูกหักภาษี ณ ที่จ่าย (ชื่อ/เลขผู้เสียภาษี/สาขา/ที่อยู่) | input | object | L572 |

### C.3 — Filing-sequence checkboxes (src L539–544, 576–583)

`sequence` (int 1–7) checks one of the `filings[]` labels:

| value | form label (TH) |
|---|---|
| 1 | (1) ภ.ง.ด.1ก |
| 2 | (2) ภ.ง.ด.1ก พิเศษ |
| 3 | (3) ภ.ง.ด.2 |
| 4 | (4) ภ.ง.ด.3 |
| 5 | (5) ภ.ง.ด.2ก |
| 6 | (6) ภ.ง.ด.3ก |
| 7 | (7) ภ.ง.ด.53 |

`key: sequence` — input, int 1–7 (L515 default 7 = ภ.ง.ด.53).

### C.4 — Income-type table `incomeRows[]` (src L528–619)

Fixed income-type rows `types[]` (the 6 RD categories); a data row is matched to a type by `String(row.typeIdx) === t.i` (L598). Table header: `ข้อ | ประเภทเงินได้พึงประเมินที่จ่าย | วัน เดือน ปี ที่จ่าย | จำนวนเงินที่จ่าย | ภาษีที่หักและนำส่ง`.

Fixed income-type catalog (`types`, L529–537):

| `i` | form label (TH) — RD category | notes |
|---|---|---|
| `1` | เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40(1) | |
| `2` | ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40(2) | |
| `3` | ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40(3) | |
| `4(ก)` | ดอกเบี้ย ฯลฯ ตามมาตรา 40(4)(ก) | sub-item |
| `4(ข)` | เงินปันผล เงินส่วนแบ่งกำไร ฯลฯ ตามมาตรา 40(4)(ข) — includes rate options 30/25/20/อื่นๆ + เครดิตภาษี clause | sub-item, long clause verbatim L534 |
| `5` | การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งฯ ม.3 เตรส (รางวัล/ส่วนลด/ค่าจ้างทำของ/ค่าโฆษณา/ค่าเช่า/ค่าขนส่ง/ค่าบริการ/เบี้ยประกันวินาศภัย ฯลฯ) | ⚠ see note below |
| `6` | อื่น ๆ (ระบุ) ..... | |

Per data-row object (`incomeRows[i]`):

| key (`row.*`) | form label (TH) | kind | type | notes |
|---|---|---|---|---|
| `typeIdx` | (matches `types[].i`) | input | number/string | L517 · **⚠ FIDELITY NOTE** below |
| `date` | วัน เดือน ปี ที่จ่าย | input | string | L603 |
| `amount` | จำนวนเงินที่จ่าย | input | number | L604 |
| `wht` | ภาษีที่หักและนำส่ง | input | number | L605 |

> **⚠ FIDELITY NOTE (do NOT self-resolve — candidate `BLOCKERS.md` item):** the match `String(r.typeIdx) === t.i` (L598) compares a numeric `typeIdx` against string ids including `"4(ก)"`, `"4(ข)"`. The seed uses `typeIdx: 5` (L517) → matches category `"5"`, which is correct for ค่าจ้างทำของ ม.3 เตรส. But categories `4(ก)`/`4(ข)` can never be matched by an integer `typeIdx`. This is a **mock/data-shape limitation in the prototype**, not a visible bug in the rendered sample (the sample only uses type 5). Phase-3 `TaxEngine` must therefore emit `typeIdx` as a **string** matching `types[].i` exactly (`"1"`,`"2"`,`"3"`,`"4(ก)"`,`"4(ข)"`,`"5"`,`"6"`). Flag to Wei before implementation if the engine's income-type enum diverges from this 7-key catalog. Not blocking this inventory task.

### C.5 — Totals (src L524–617)

| key / formula | form label (TH) | kind | notes |
|---|---|---|---|
| `totalIncome = Σ incomeRows.amount` | รวมเงินที่จ่ายและภาษีที่หักนำส่ง | **calc** | L524,611 |
| `totalWht = Σ incomeRows.wht` | (same total row, WHT column) | **calc** | L525,612 |
| `bahtText(totalWht)` | รวมเงินภาษีที่หักนำส่ง (ตัวอักษร) | **calc** | L616 · Thai baht text |

### C.6 — Fund contributions block (src L621–627) — object `funds`

| key (`funds.*`) | form label (TH) | kind | type | notes |
|---|---|---|---|---|
| `govPension` | กบข./กสจ./กองทุนสงเคราะห์ครูโรงเรียนเอกชน | input | number | L624 |
| `ssf` | กองทุนประกันสังคม | input | number | L625 |
| `providentFund` | กองทุนสำรองเลี้ยงชีพ | input | number | L626 |

### C.7 — Payer intent & footer (src L629–667)

| key | form label (TH) | kind | type | notes |
|---|---|---|---|---|
| `issueMode` | ผู้จ่ายเงิน: (1) หัก ณ ที่จ่าย / (2) ออกภาษีให้ตลอดไป / (3) ออกภาษีให้ครั้งเดียว / (4) อื่นๆ | input | int 1–4 | L631–635 |
| `payDate` | วันเดือนปีที่จ่าย | input | string | L655 |
| `—` | คำเตือน … มาตรา 50 ทวิ … ปรับไม่เกิน 2,000 บาท ตามมาตรา 35 | static | L639 |
| `—` | ลงชื่อผู้จ่ายเงิน / ตำแหน่ง / วันที่ออกหนังสือ | static | L647–650 |
| `—` | สถานที่ออก / หมายเหตุ พิมพ์ออกจากระบบ juneflow · เลขที่อ้างอิง `{certNo}` / ตราประทับนิติบุคคล | static+`certNo` | L656–661 |

---

## Coverage checklist (gate: "ครอบคลุมทุกฟอร์มใน tax-forms.jsx")

| # | RD form | component | src lines | mapped |
|---|---|---|---|---|
| A | ภ.พ.30 (VAT return) | `PND30Form` | 104–327 | ✅ A.1–A.7 (incl. 16-line calc table) |
| B | ใบแนบ ภ.ง.ด.3 (personal WHT) | `PND53Form kind="3"` | 342–503 | ✅ B.1–B.4 |
| B | ใบแนบ ภ.ง.ด.53 (corporate WHT) | `PND53Form kind="53"` | 342–503 | ✅ B.1–B.4 (same component) |
| C | 50 ทวิ (WHT certificate) | `WHTCertificate` | 509–671 | ✅ C.1–C.7 |
| — | shared primitives (`FormPage`, `TaxIdBoxes`, `AddrCell`, `PartyBox`, `bahtText`, `TH_MONTHS_FULL`, openers) | — | 7–102, 329–336, 673–727 | ✅ §0 |

All exported symbols in `Object.assign(window, {…})` (L727) are accounted for. **No tax form in `tax-forms.jsx` is left unmapped.**

## Phase-3 handoff notes for `TaxEngine`

1. **`TaxEngine.thailand` output shape** must supply exactly the `data` object each component reads (keys above). The `data ||` defaults in the source are mock fallbacks — production always passes real data.
2. **Computed lines are engine responsibilities** for validation but the components re-derive them client-side (ภ.พ.30 lines 4,8–9,11–12,15–16; all `totalIncome`/`totalWht`; `bahtText`). Engine and component formulas must agree — mismatch = bug.
3. **Money formatting** is `Intl.NumberFormat("th-TH", 2dp)` everywhere (`fmtB`); zero → `—` on ภ.พ.30 rows. Every money value carries THB implicitly here; align with the root rule "เงินทุกคอลัมน์มี `currency_code`" when persisting.
4. **Dates** are pre-formatted Thai strings (`"25 พ.ค. 2569"`, Buddhist era) in the prototype. Decide the engine's date contract (raw ISO + formatter vs pre-formatted) during Phase-3 planning — currently prototype expects display strings.
5. **Open follow-up for Wei** — 50 ทวิ `typeIdx` string/number mismatch (see ⚠ in C.4). Confirm income-type enum before coding.

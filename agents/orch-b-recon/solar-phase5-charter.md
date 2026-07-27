# SOLAR PROGRAM CHARTER — Phase-5 (พลังงาน · EPC)
*Program lead recon synthesis · main @ 0739d8b · for Wei via orch-B*

**Headline:** SOLAR is **not greenfield at the schema layer** — all 6 tables already exist and are migrated (`extensions.ts:386-539`, migrations `0005` + `0007`). The work is **API + contract (openapi) + web-port + i18n**, plus **one genuinely new money path (PPA electricity revenue) that is entirely ruling-gated**. Four of five screens are read/analytics and can ship without money rulings.

---

## 1) SCOPE — the 5 screens

| Route | Screen | Nature | Money? |
|---|---|---|---|
| `solar.monitor` | Monitoring + O&M (`solar.jsx:25-107`) | **Read-only telemetry** (inverter table + KPIs) + O&M ticket list; O&M open/close is **client-mock only** (`real-forms2.jsx:250-302`, notify-only) | No |
| `solar.ppa` | ขายไฟ / PPA billing (`solar.jsx:109-161`) | **THE money path** — monthly kWh billing list; but prototype is **display-only** with a shared generic AR **mock** modal (`real-forms.jsx:247`) | **YES — un-wired AR/GL** |
| `solar.roi` | ROI analytics (`solar.jsx:164-220`) | **Pure read/analytics** — CAPEX/IRR/NPV/payback + cumulative cashflow; zero mutations | No |
| `solar.permit` | Permit pipeline (`solar.jsx:222-266`) | **Read-only tracking** timeline (รง.4/พค.2/PPA/Commissioning/COD/อ.6); add-modal is mock (`real-forms2.jsx:305-330`) | No |
| `solar.warranty` | Equipment warranty registry (`solar.jsx:268-310`) | **Read-only master-data** (item/brand/qty/terms/expiry); add-modal mock (`real-forms2.jsx:338-356`) | No |

**Honest read:** 4 of 5 are display/analytics. Only `solar.ppa` implies a real transaction, and even *that* is display-only mock in the prototype — the "issue electricity invoice" behavior is **implied, not defined**.

---

## 2) REUSE vs GREENFIELD

### Rides on existing backend (no new tables)
- **Solar LAND acquisition/feasibility/DD** → the **land module is already built and enabled for solar** (`land_plot` `misc.ts:45` with tenure field; routes `land-sales.ts`; screens `apps/web/src/screens/land/*`; PROJECT-TYPES §4). Solar feasibility = same land module (`flows.html:63` "Feasibility โซลาร์=MWp/ROI").
- **EPC construction** → reuse **boq / proc(pr-po-wo-gr) / subcon / inv / pm / timeline / petty** wholesale — all enabled for solar (§4), all have routes+schema. Solar cost types (Module/Inverter, EPC, civil, transport, permit/consult §3) are **just BOQ categories** — no schema change.
- **AR/GL lane** for PPA → full AR machinery reusable (`ar.ts` 941 lines: invoice create/list/aging + JV post + e-Tax; RV receipt→paid-flip; `gl-post.ts` resolveAccountIds/allocJvNo/POSTING_MAP). COA `4040 รายได้ขายไฟฟ้า (PPA)`, `2050 VAT-output`, `1030 AR`, buyer `C-3001 กฟภ.` **all already seeded** (`seed/index.ts:392,327`).
- **`project_node` tree** structurally supports the 4-level ไซต์→โซน/Array→String→Inverter (`project.ts:242` free-text kind, self-ref parent) BUT `createProjectNode` is hardcoded to block+unit (`project-nodes.ts:170-215`), and the prototype **does not render a tree** — it uses a **flat `solar_inverter` table with zone-as-text**. Leaf devices live in `solar_inverter`, not `project_node`.

### The NEW solar entities (tables EXIST, everything above them is greenfield)
All 6 in `extensions.ts:386-539`, migrated `0005`/`0007`, company-scoped + `company_idx`, `project_id` = set-null soft link:

| Entity | Table | Backs | Status |
|---|---|---|---|
| **monitoring/production** | `solar_inverter` (386) + `solar_om_ticket` (413) | inverter telemetry + O&M tickets | table only; **no production/time-series entity exists** (KPIs hardcoded) |
| **ppa** | `ppa_invoice` (441) | monthly billing rows | **display-orphan** — no customer_id/jv_id/due_date/vat/etax |
| **roi** | `solar_roi` (468) | per-year cashflow | table only; **CAPEX/IRR/NPV have no schema home** |
| **permit** | `solar_permit_step` (493) | permit timeline | table maps prototype 1:1; status = free text |
| **warranty** | `solar_warranty` (518) | equipment registry | 3 type conflicts (qty/prod-term/perf-compound) |

**Greenfield work = per module:** API route file (none exist — only consumer today is a read-only dashboard branch `dashboard.ts:257-287`) + **sacred openapi ops** (zero solar ops; "solar" appears only as project_type enum `openapi.yaml:4609/4641`) + web screen (no `apps/web/src/screens/solar/`) + **sacred i18n keys** (zero `solar.*` keys in `i18n-full.json`).

**Schema/migration footprint:** The 6 tables need **no creation**. The **only** likely migration is an **additive-nullable ALTER on `ppa_invoice`** to make it posting-shaped — *if and only if* Wei rules PPA billing is real and routes through `ppa_invoice` rather than `ar_invoice`. Warranty may need additive columns depending on the type-conflict ruling. Both are **sacred** (touch merged migrations + openapi + i18n).

---

## 3) MONEY — the PPA electricity-revenue path (the gating design work)

**This is the one real money path and it is entirely un-wired.** Everything else (Monitoring KPIs, ROI analytics, Permit timeline, Warranty registry) posts **nothing** — confirmed money-free.

### What the prototype actually shows (honest)
- `solar.ppa` is a **display-only KPI + read list**. Contract terms (buyer กฟภ., FiT 4.12 ฿/kWh, Non-Firm 20yr, COD 15 ธ.ค. 68) are **static KPI string literals** — no editable/stored contract entity.
- Billing rows are **5 hardcoded mocks** (`solar.jsx:111-117`); `amt` is a **precomputed literal** that *happens* to equal `mwh × 1000 × rate`.
- The sole create affordance "ออกใบแจ้งหนี้ค่าไฟ" calls the **shared generic AR mock modal** (`real-forms.jsx:247-285`) — validates desc+amt, adds client-side 7% VAT, then `notify`s a **hardcoded invoice no** "JF-INV-2569-0256". **No POST, no server compute, no real number.** There is **no PPA-specific billing form** (period/mwh/tariff inputs) anywhere.

### What a real posting would need (all Wei-ruled — B-161 class)
Prototype shows amounts but names **no account, no JV, no VAT treatment, no formula authority**:
- **Billing JV:** `Dr 1030 AR / Cr 4040 รายได้ขายไฟฟ้า (PPA) / Cr 2050 VAT-output` — but the AR handler currently hardcodes `ACCT.revenue = "4010"` (real-estate sales, `gl-post.ts:91`), and `POSTING_MAP` has **no `ppa` entry** (`GlPostableKind = "pv"|"rv"|"gr"|"payroll"`, `gl-post.ts:47,62-67`). Wiring `4040` is net-new.
- **Receipt JV** (if "รับชำระแล้ว" is real): `Dr 1020 bank / Cr 1030 AR` (mirrors `POSTING_MAP.rv`).
- **Basis = SERVER-computed** `mwh × 1000 × tariff` — but **tariff has no authoritative source** (KPI says 4.12, seed says 3.5 — both mock, no contract/tariff store exists).

### Data-shape gap
`ppa_invoice` (`extensions.ts:441`) is **display-shaped, not posting-shaped**: no `customer_id`, `jv_id`, `due_date`, `vat`, `etax`, or doc-number. Either **wire it (additive migration = sacred)** or **abandon it and route PPA through `ar_invoice`** with a PPA discriminator.

### Other money
- **Permit fees:** NONE on the permit screen. Permit-cost "ขออนุญาต/ที่ปรึกษา" lives in **BOQ/procurement** (PROJECT-TYPES §3), never here. Read-only tracking — no posting.
- **Warranty claims:** NONE. No claim→expense/credit flow; no currency column on `solar_warranty`. Pure registry.

---

## 4) WAVE PLAN (mirrors P3 sales/land waving)

### Wave-0 — reads/analytics (ships WITHOUT money rulings)
Route + Entity-opaque openapi op (reuse `analytics.ts` B-101 tenant-scoped read pattern) + web port + i18n for the **four read-only screens**:
- **solar.roi** — port ROI analytics as **stored-display** (`solar_roi` reads). *Gated only by the IRR/NPV compute-locus ruling (R5) — but can ship verbatim-display without it.*
- **solar.permit** — CRUD list + create (`solar_permit_step`). *Needs status-enum + POST-defaults ruling (R6) but is otherwise clean.*
- **solar.warranty** — GET list (`solar_warranty`). *POST scope + type-conflict rulings (R7) gate the create form; read ships now.*
- **solar.monitor** — inverter table + O&M list read. *KPI-provenance ruling (R2) gates whether KPIs are live or static-display; read of `solar_inverter` ships now.*

**Sacred prereq for Wave-0:** one openapi round (4 read op-groups) + one i18n round (all solar Thai copy) — both Wei-approved, no migration.

### Wave-1 — the PPA money path (RULING-GATED, do not start until R1-R4 answered)
Only after Wei rules the PPA posting model:
- Wire `POSTING_MAP.ppa` + `4040` revenue account (or route through `ar_invoice`).
- `ppa_invoice` additive migration (if wired) — **sacred**.
- Real "issue electricity invoice" behavior + server money compute + (maybe) receipt JV.

### Deferred / cross-module (no prototype authority — separate Wei items)
- COD→PPA-revenue-recognition link (R6/COD).
- Lease-PV gap (B-161 class — no lease table exists; shared with realestate).
- Real 4-level project_node device tree (accept flat `solar_inverter` unless Wei wants it).

**Ship-without-rulings:** all four read screens (Wave-0). **Ruling-gated:** the entire PPA money path (Wave-1) + all create-forms with schema conflicts.

---

## 5) WEI RULINGS NEEDED (B-16x style — I am NOT deciding these)

**R1 — PPA billing: real transaction or read-only KPI screen?**
The screen is display-only; its create affordance is a shared AR mock (notify-only, hardcoded no.). Options: (a) implement PPA as a **real AR transaction** (kWh × tariff → invoice → GL post); (b) keep `solar.ppa` **read-only KPI+list** mirroring seeded `ppa_invoice` rows (like SolarROI); (c) real invoice but **no receipt step**. *Prototype leans (b) — it defines no real create form.*

**R2 — PPA revenue account.** If real: credit dedicated `4040 รายได้ขายไฟฟ้า (PPA)` (seeded, unwired) vs the AR handler's hardcoded `4010` real-estate account. *Prototype names no account → 4040 is the obvious intent but must be ruled.*

**R3 — VAT on electricity sale to กฟภ.** Prototype billing table shows **no VAT line**, but the shared AR modal adds 7%. Options: (a) VAT-applicable `Dr 1030 gross / Cr 4040 net / Cr 2050 VAT`; (b) VAT-exclusive/exempt (`Cr 4040` = full, no 2050). *Contradictory in prototype → Wei must rule.*

**R4 — tariff/contract source + `ppa_invoice` fate.** FiT is a static KPI literal (4.12 vs seed 3.5). Options: (a) net-new **PPA contract entity** (buyer/tariff/term/COD) sourcing server tariff; (b) **per-invoice tariff input**; (c) config constant. AND: **wire `ppa_invoice`** (additive-nullable migration for customer_id/jv_id/due_date/vat/etax = sacred) vs **abandon it, route through `ar_invoice`**. *money=SERVER requires a defined tariff source — none exists.*

**R5 — ROI IRR/NPV compute-locus.** IRR 14.8% / NPV +312M are **hardcoded literals, no formula** (`solar.jsx:188`); payback/net-annual are client-computed. Options: (a) **port verbatim as display text** (respects "don't invent formulas"); (b) **server-compute** real XIRR/NPV @6% (invents a formula — B-161 pattern); (c) store on a ROI-summary field. Also: CAPEX 248M/8MWp has no schema home. *Prototype leans (a).*

**R6 — Permit status enum + COD link.** (i) Constrain `status` to exactly `{approved, pending}` (prototype shows only these) or allow a fuller lifecycle (→ new ALTER migration)? (ii) Is **COD a first-class `project.cod_date`** that starts PPA revenue-rec/ROI year-0, or **display-derived** from the permit step only? *Prototype: COD is just a step; leans display-only — do not invent the COD→PPA link.*

**R7 — Warranty schema conflicts + write scope.** Three type gaps: (i) `qty` integer vs unit-bearing strings ("14,400 แผง") → text / add qty_unit?; (ii) product-warranty is **years** but schema stores `prod_date` → add `product_warranty_years`?; (iii) perf is compound "25 ปี (สมรรถนะ 87.4%)" but `perf numeric(6,2)` holds one number → split into term+pct? AND: ship **read-only GET** vs also build **POST** (create modal has only item+years vs 7 display columns)? *Prototype leans read-only master-data.*

**R8 — O&M ticket: real POST or mock?** Ticket carries priority/SLA + team + status that `PMWorkOrder` (`pm.ts:168`) lacks; `solar_om_ticket` table exists. Options: (a) real POST open/close ticket + doc-number series `OM-2026-###`; (b) read-only list, no create. *Prototype only notifies → leans (b), but table implies (a) intended.*

---

## 6) VERIFY PLAN (orch-B)

**Wave-0 (reads) — light verify:**
- **G5 visual gate** on all 4 ported screens vs prototype (`tests/visual/reference/`) — the primary gate for display screens.
- **G2 contract-live** tests confirming Entity-opaque tenant-scoped reads (analytics.ts B-101 pattern) — no cross-tenant leak on `company_id`-scoped solar reads.
- **i18n glyph discipline** — grep raw prototype lines before compiling every solar key (curly quotes, ฿ U+0E3F, middot, Thai-BE date formats "ธ.ค. 2580"); the recurring master-wave lesson.
- No money-skeptic needed (money-free screens confirmed).

**Wave-1 (PPA money) — full money-skeptic + live-E2E (the P2/P3 discipline):**
- **money-skeptic review** on the PPA posting: (1) amount **server-computed** (`mwh × 1000 × tariff`, client never posts the number); (2) **balanced JV** (Dr AR = Cr revenue + Cr VAT); (3) correct accounts (`4040` not `4010`, `2050` per R3 ruling); (4) **idempotent** invoice creation (no double-post per period/project — the seq-count-dedup lesson: a count-derived doc-number does NOT close a concurrent double-post; needs an idempotency key); (5) **atomic** header+JV+line in one tx (B-097 rollback pattern).
- **Live-E2E (E2E_LIVE-gated, graceful-skip-on-429):** issue a PPA invoice end-to-end against live PG → assert the JV rows + AR balance; a **rollback proof** (bad-FK line fails inside tx → header rolls back, no orphan) mirroring `b097-rollback.spec.ts`.
- **Concurrent double-post test** (mirror b163/b165): fire two simultaneous "issue" calls for the same period → expect `[201, 409]`, not `[201, 201]`.
- **G5** on `solar.ppa` after wiring.

**Two-reviewer discipline:** per the verify-chain-atomicity lesson, orch-B's gate-4.5 + orch-A's own gate-4.5 both run on any PPA posting change — the optimistic-lock / atomicity class of bug repeatedly escapes a single reviewer.

---

**Recommended open move:** Wave-0 reads (solar.roi verbatim-display + solar.permit + solar.warranty read + solar.monitor read) can begin immediately behind **one Wei sacred round** (4 read openapi op-groups + solar i18n keys, no migration). Hold **all** PPA money work until **R1-R4** are answered — that is the single gating decision cluster for the phase.

---
## WEI RULINGS (recorded)
- **R1 = read-only KPI (2026-07-27):** PPA stays a read-only KPI + billing list (prototype-faithful) — NO real AR/GL revenue transaction. Collapses Solar to an all-read/display port; R2/R3/R4 (revenue account / VAT / tariff) are MOOT. R5-R8 default to read-only/verbatim/defer-writes (honest, no-invention). Wave-0 = the whole program (5 read screens, no writes). Needs 2 sacred rounds (openapi read ops + i18n solar.*) — awaiting Wei approval.

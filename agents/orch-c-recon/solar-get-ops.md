# Solar Wave-0 — GET-op specs for orch-A (orch-C recon · reads over the 6 existing tables)

## solar.monitor
- **GET:** GET /solar/inverters (list) + GET /solar/om-tickets (list) — two reads on one screen. Inverter list: /solar/inverters?projectId={active} (company-scoped). Ticket list: /solar/om-tickets?projectId={active}. No /{id} needed (view modal is honest-disabled).
- **table:** solar_inverter (packages/db/src/schema/extensions.ts:386-406) + solar_om_ticket (extensions.ts:413-434)
- **rowFields:** solar_inverter → SELECT id, zone, kw, output_kw, perf, status (WHERE company_id=tenant [+ project_id=active]). Wire: id→Inverter col; zone→โซน/Array; output_kw + kw→`{output_kw} / {kw} kW`; perf→perf-bar+`{perf}%`; status(text 'ok'/'warn'/'down')→StatusBadge map. VERIFIED columns: id, company_id, project_id, zone, kw, output_kw, perf, temp, status — all real; temp EXISTS but not rendered on this screen (skip). KPI1 value=SUM(output_kw)/1000, KPI1 sub=SUM(kw)/1000 → both server-computable from these rows. No invented columns. || solar_om_ticket → SELECT no, title, priority, assignee_user_id, status, inverter_id (WHERE company_id=tenant). VERIFIED columns: id, company_id, inverter_id, no, title, priority, assignee_user_id, status — all real. Wire: no→card no; priority(text 'ด่วน'/'สูง'/'ปกติ')→Tag tone; title→card title; assignee_user_id→resolve display name for 'who' (JOIN users) — NOTE prototype `who` holds TEAM strings ('ทีม O&M A'/'ทีม Cleaning') but schema stores a user FK → seed must put team-as-user or accept divergence; status(text)→StatusBadge label.

## solar.ppa
- **GET:** GET /solar/ppa-invoices
- **table:** ppa_invoice (packages/db/src/schema/extensions.ts:441-461)
- **rowFields:** per-row: id, month (col งวดเดือน), mwh numeric(14,4) (col หน่วยขาย MWh), rate numeric(12,4) (col อัตรา ฿/kWh), amount numeric(16,2) (col มูลค่า ฿), currency_code (money-column rule; default THB), status (col สถานะ — Thai seed values drive StatusBadge tone map); aggregate: SUM(amount) → YTD footer + KPI-3. Tenant-scope on company_id (index ppa_invoice_company_idx); optional project_id filter (nullable FK). List-only, display-only — NO /{id} detail (rows not clickable), NO POST (create honest-disabled). All named columns verified real against schema L441-461; no invented columns.

## solar.roi
- **GET:** /solar/roi (list; company+project scoped, no detail/{id} — screen is aggregate + year-row list, no drill-down)
- **table:** solar_roi (extensions.ts:468-487) — pgTable, index solar_roi_company_idx on company_id; project_id FK set-null; per-year rows
- **rowFields:** year (integer → 'ปีที่' / row 'ปี {year}'), revenue (numeric 16,2 → 'รายได้ (ลบ.)'), opex (numeric 16,2 → 'OPEX (ลบ.)'), cumulative (numeric 16,2 → 'เงินสดสะสม (ลบ.)' + bar-viz width), currency_code (text default THB), id + project_id (scope/keys, not displayed). SELECT these real columns; ORDER BY year. VERIFIED against extensions.ts:468-487 — these are the only data columns (+ company_id, created_at, updated_at). NO capex/irr/npv/payback/mw/wp/annual_revenue/annual_opex/discount_rate columns exist — KPI cards are NOT backed by this table (see honestDivergences).

## solar.permit
- **GET:** GET /solar/permit-steps (list; company_id-scoped + active project_id filter). NO detail /{id} — timeline has no row-click/detail in prototype. NO POST — add-modal is mock (honest-disabled). Path follows kebab-plural convention (cf. /cost-centers, /project-types, /doc-numbering); no /solar/* path exists in openapi.yaml yet, so orch-A adds this collection endpoint fresh.
- **table:** solar_permit_step (packages/db/src/schema/extensions.ts:493-511)
- **rowFields:** id (React key) · name text (step name) · org text (authority, meta line) · status text enum-code approved|pending (drives node color+icon AND StatusBadge label via solar.permit.statusApproved/statusPending) · step_date date (meta line, rendered Thai BE short e.g. 2025-03-12→"12 มี.ค. 68"; NULL → fallback "รอผล" = solar.permit.statusPending). Scope cols: company_id, project_id. All map to real columns (id/company_id/project_id/name/org/status/step_date) — no invented fields. Return rows in insertion/pipeline order (seed order รง.4→พค.2→PPA→Commissioning→COD→อ.6).

## solar.warranty
- **GET:** GET /solar/warranties
- **table:** solar_warranty (solarWarranties, packages/db/src/schema/extensions.ts:518-539)
- **rowFields:** id, item, brand, qty, perf, prod_date, expiry_date, status (+ company_id/project_id for tenant+project scope). All map to real columns (verified: id·company_id·project_id·item·brand·qty·perf·prod_date·expiry_date·status·created_at·updated_at). No /{id} detail op — list-only screen, no row drill-down.

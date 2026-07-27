/*
 * Down-payment register + receive-form helpers for SalesDown (sales.down) — pure,
 * i18n-free, ASCII-only logic ported from pototype/sales-process.jsx SalesDown
 * (L362-457) + DownPaymentReceiveForm (L459-487). Route sales.down (NAV-ROUTES.md
 * L92, component SalesDown, file sales-process.jsx, section module sales_re).
 *
 * The prototype held the register in a hardcoded per-unit array (sales-process.jsx
 * L410-416, each row carrying denormalised display strings: a Thai customer NAME, a
 * human unit code "B-12", a "10-instalment · 47,350" plan label, a done/total, a mock
 * next-due date, a fabricated status). PLAN.md §0 rule 3: that mock is dropped as
 * data — the register is the real server catalogue.
 *
 * DATA — the two reads (money is the SERVER's system of record):
 *   GET /sales/downs      (land-sales.ts listDowns) flattens every sales_unit's `down`
 *     jsonb array to ONE ROW PER INSTALMENT. The wire row is exactly:
 *       { sales_unit_id, unit_id, seq, amount, paid_at, currency_code }
 *     It carries NO customer_id and NO plan definition (no total-instalment count, no
 *     schedule). aggregateByUnit() folds those flat rows back into the per-unit
 *     register the prototype table shows.
 *   GET /sales/contracts  (land-sales.ts listContracts -> unitWire) is the receive
 *     modal's unit picker: contracted sales units, each carrying { id (sales_unit_id),
 *     unit_id, customer_id, currency_code, ... }. Unlike the downs wire, unitWire DOES
 *     carry customer_id, so the picker resolves a real customer name via GET /customers
 *     (customerNameById) — the register table cannot (no customer_id on its wire).
 *
 * HONEST GAPS the register em-dashes (never fabricated — see sales-down.tsx header):
 *   - customer name: the /sales/downs wire has NO customer_id -> em-dash (the register
 *     cannot resolve a name; the modal picker can, via /sales/contracts + /customers).
 *   - unit code: the wire's `unit_id` is the sold project_node UUID, NOT the human
 *     "B-12" code the prototype shows -> em-dash (ap-pv "ref" precedent: a bare UUID FK
 *     is not a meaningful label).
 *   - plan schedule ("10 instalments · 47,350"): there is NO plan definition on the wire
 *     (no total-instalment count, no per-instalment amount schedule) -> em-dash.
 *   - progress total: `done` (count of recorded instalments) IS derivable; the plan
 *     TOTAL is not -> the cell shows "{done}/—" (no fabricated fraction, no bar).
 *   - total down / remaining: both need the plan total (absent) -> em-dash.
 *   - next instalment / status (overdue vs complete): both need a due-date schedule +
 *     plan total the wire lacks -> em-dash.
 *   REAL derivations: `done` (instalment count) and `paid` (Σ instalment amounts) per
 *   unit; the cumulative-down KPI (Σ every instalment amount) and the paying-units KPI
 *   (the register row count). Everything requiring a time-window / due schedule / plan
 *   total is em-dashed (ar-rv "RV this month" precedent).
 *
 * RECEIVE (POST /sales/downs) — money=SERVER: the client composes ONLY
 * { sales_unit_id, amount, paid_at? }. The server auto-assigns the instalment seq
 * (existing length + 1), posts + balances the receipt JV (Dr 1020 bank / Cr 2040
 * advance-received = amount), and returns jv_no. The client NEVER sends a seq, a
 * Dr/Cr line, or a JV/RV number (buildDownBody enforces this). A duplicate seq answers
 * 409 (idempotent replay), surfaced honestly by the form.
 *
 * No Thai/baht leaks here (B-073) — formatMoney is ASCII digits + commas only; every
 * visible label is resolved via t() in the .tsx from the sales.down.* / common.* dict.
 */

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row; 0 when absent/invalid. */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Round to 2dp the way the server does (avoids float dust in the summed totals). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/* --------------------------------------------------------------------------- */
/* Register read (GET /sales/downs -> per-unit aggregate)                       */
/* --------------------------------------------------------------------------- */

/**
 * A single down INSTALMENT as the /sales/downs wire delivers it (one row per
 * instalment, land-sales.ts listDowns). `unitId` is the sold project_node UUID (not a
 * human unit code); there is no customer_id on this wire.
 */
export interface DownRow {
  /** The owning sales_unit id (the POST /sales/downs target + the aggregate key). */
  salesUnitId: string;
  /** Sold project_node UUID (NOT the human "B-12" code) -> the view em-dashes it. */
  unitId: string;
  /** Server-assigned instalment sequence (1-based); null when the wire omits it. */
  seq: number | null;
  /** The received amount for this instalment (server system of record). */
  amount: number;
  /** Calendar date this instalment was received (ISO), or "" when null. */
  paidAt: string;
  currencyCode: string;
}

/** Narrow an opaque /sales/downs Entity row (snake_case or camelCase) to a DownRow. */
export function toDownRow(e: Record<string, unknown>): DownRow {
  const seqRaw = e.seq;
  const seq =
    seqRaw == null || seqRaw === ""
      ? null
      : Number.isFinite(Number(seqRaw))
        ? Math.trunc(Number(seqRaw))
        : null;
  return {
    salesUnitId: str(e.sales_unit_id ?? e.salesUnitId),
    unitId: str(e.unit_id ?? e.unitId),
    seq,
    amount: num(e.amount),
    paidAt: str(e.paid_at ?? e.paidAt),
    currencyCode: str(e.currency_code ?? e.currencyCode),
  };
}

/**
 * The per-unit register row the table renders — the flat instalment rows folded back
 * to one row per sales_unit. `done` (instalment count) and `paid` (Σ amounts) are the
 * REAL derivations; the plan total / customer / schedule the prototype also shows are
 * absent from the wire and em-dashed by the view.
 */
export interface UnitDownRow {
  salesUnitId: string;
  /** Sold project_node UUID (em-dashed in the view — not a human code). */
  unitId: string;
  currencyCode: string;
  /** Count of recorded instalments for the unit (REAL; the "done" of done/total). */
  done: number;
  /** Σ of this unit's instalment amounts (REAL; the paid column, sales.down.thPaid). */
  paid: number;
}

/**
 * Fold the flat per-instalment rows into the per-unit register, preserving each unit's
 * first-seen order (the server already ordered the units newest-first). A row with a
 * blank sales_unit_id is skipped (never aggregated under an empty key).
 */
export function aggregateByUnit(rows: readonly DownRow[]): UnitDownRow[] {
  const order: string[] = [];
  const byUnit = new Map<string, UnitDownRow>();
  for (const r of rows) {
    if (!r.salesUnitId) continue;
    let agg = byUnit.get(r.salesUnitId);
    if (!agg) {
      agg = {
        salesUnitId: r.salesUnitId,
        unitId: r.unitId,
        currencyCode: r.currencyCode,
        done: 0,
        paid: 0,
      };
      byUnit.set(r.salesUnitId, agg);
      order.push(r.salesUnitId);
    }
    agg.done += 1;
    agg.paid = round2(agg.paid + r.amount);
  }
  return order.map((k) => byUnit.get(k) as UnitDownRow);
}

/**
 * Cumulative down received = Σ every instalment amount across all units (the real
 * value behind the cumulative-down KPI, sales.down.kpiCumDown, replacing the
 * prototype's mock 32.1M literal).
 */
export function cumulativeDown(rows: readonly DownRow[]): number {
  return round2(rows.reduce((s, r) => s + r.amount, 0));
}

/**
 * Group a FULL-baht amount with thousands separators ("473500" -> "473,500"), matching
 * the prototype's Intl fmt (ds.jsx th-TH maximumFractionDigits 0). ASCII digits + comma
 * only (no baht symbol / decimals); non-finite -> "0". Mirrors ar-rv-rows.formatMoney.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/* --------------------------------------------------------------------------- */
/* Receive form (POST /sales/downs) — unit picker + customer resolution         */
/* --------------------------------------------------------------------------- */

/**
 * A contracted sales unit as the receive-modal picker consumes it (GET /sales/contracts
 * row, land-sales.ts unitWire). `id` is the sales_unit_id the POST targets; `customerId`
 * resolves to a real name via customerNameById (this wire, unlike /sales/downs, carries it).
 */
export interface ContractUnit {
  /** sales_unit_id — the POST /sales/downs target. */
  id: string;
  /** Sold project_node UUID (em-dashed in the picker label — not a human code). */
  unitId: string;
  /** Buyer FK, resolved to a name via GET /customers (customerNameById). */
  customerId: string;
  currencyCode: string;
}

/** Narrow an opaque /sales/contracts Entity row to a ContractUnit. */
export function toContractUnit(e: Record<string, unknown>): ContractUnit {
  return {
    id: str(e.id),
    unitId: str(e.unit_id ?? e.unitId),
    customerId: str(e.customer_id ?? e.customerId),
    currencyCode: str(e.currency_code ?? e.currencyCode),
  };
}

/** A tenant customer reduced to the id -> name resolution it feeds (GET /customers row). */
export interface CustomerRef {
  id: string;
  name: string;
}

/** Narrow an opaque /customers Entity row to a CustomerRef (mirrors toUserRef). */
export function toCustomerRef(e: Record<string, unknown>): CustomerRef {
  return { id: str(e.id), name: str(e.name) };
}

/**
 * Build a customer id -> name map for the picker (mirrors sales-crm userNameById).
 * Blank ids are skipped; the picker em-dashes any id absent from the map (never the uuid).
 */
export function customerNameById(customers: readonly CustomerRef[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of customers ?? []) if (c.id) map.set(c.id, c.name);
  return map;
}

/**
 * The receive-form draft — the ONLY fields the client owns. money=SERVER: the seq,
 * the Dr/Cr JV lines, and the jv_no are all the server's (never in this draft).
 */
export interface DownDraft {
  /** The chosen sales_unit_id (REQUIRED). */
  salesUnitId: string;
  /** The real cash received (REQUIRED, finite > 0 — a legitimate client value). */
  amount: number;
  /** Optional receive date (ISO); "" -> omitted so the server defaults to today. */
  paidAt: string;
}

/** The submit is enabled once a unit is chosen and a positive amount is entered. */
export function downSubmittable(d: DownDraft): boolean {
  return d.salesUnitId.trim() !== "" && Number.isFinite(d.amount) && d.amount > 0;
}

/**
 * Compose the opaque POST /sales/downs body from the draft. money=SERVER: ONLY
 * sales_unit_id + amount (+ paid_at when supplied) — NEVER a seq, a Dr/Cr line, or a
 * JV/RV number. The server assigns the seq (existing + 1), posts + balances the JV,
 * and returns jv_no.
 */
export function buildDownBody(d: DownDraft): Record<string, unknown> {
  const body: Record<string, unknown> = {
    sales_unit_id: d.salesUnitId.trim(),
    amount: d.amount,
  };
  const paidAt = d.paidAt.trim();
  if (paidAt) body.paid_at = paidAt;
  return body;
}

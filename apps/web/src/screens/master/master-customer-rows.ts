/*
 * master-customer-rows — pure, i18n-free, ASCII-only row logic for MasterCustomer
 * (P2-WEB-40), narrowed from pototype/master-party.jsx MasterCustomer (L188-264).
 *
 * LEAN read-only register (Wei ruling B-135). The prototype held customers in local state
 * (CUSTOMER_SEED + setRows) whose rows carried code/type/addr/project/value/status — a rich
 * mock. §0 rule 3: that mock is dropped. The real read-side wire (GET /customers,
 * apps/api/src/routes/customers.ts customerWire) returns ONLY { id, name, tax_id, created_at }
 * — so this module narrows to the two fields the table can honestly back (name, taxId) plus
 * id. Every other prototype column (code · type · addr · project/unit · value) and the
 * person/corp + total-value KPIs have NO wire field: the screen renders the literal em-dash
 * for them and they are never fabricated here (C10 honest-gap). Only the REAL kpiTotal count
 * lives here so it is unit-testable (gate G3).
 */

/** A customer as the table consumes it (GET /customers row, narrowed from the opaque Entity). */
export interface CustomerRow {
  id: string;
  name: string;
  /** Tax id — nullable free text on the wire ("" when absent). */
  taxId: string;
}

/** Read a string field off an opaque row; "" when absent/null (mirrors vendor-rows.str). */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/**
 * Narrow an opaque /customers Entity row to the CustomerRow the table needs. Multi-word
 * fields accept snake_case (server convention, customerWire) or camelCase for robustness —
 * mirrors vendor-rows.toVendorRow. Only id/name/tax_id exist on the wire; nothing else is
 * read (the screen renders em-dash for the unbacked prototype columns, B-135).
 */
export function toCustomerRow(e: Record<string, unknown>): CustomerRow {
  return {
    id: str(e.id),
    name: str(e.name),
    taxId: str(e.tax_id ?? e.taxId),
  };
}

/**
 * kpiTotal — the REAL customer count (master-party.jsx:215 `String(rows.length)`). This is
 * the ONLY wire-backed KPI; the person/corp + total-value KPIs need `type` / `value` fields
 * that the wire does not carry, so the screen renders em-dash for those (never fabricated).
 */
export function customerCount(rows: readonly CustomerRow[]): number {
  return rows.length;
}

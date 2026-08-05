/*
 * POList-only wire helpers (B-278) — pure, i18n-free, ASCII-only.
 *
 * WHY A SEPARATE MODULE: po-wo-rows.ts is shared by 14 modules (po/wo lists, forms,
 * subcon, sales, fa). The two fields re-wired here are consumed by POList ALONE, so they
 * live beside the screen instead of widening the shared PoRow (whose PoRow[] identity
 * filterPoByTab depends on). POList keys them back onto its rows by doc id.
 *
 * WHAT THE LIST PAYLOAD ACTUALLY CARRIES (apps/api/src/routes/po.ts poWire, pinned by the
 * exact-key assertion in po.test.ts "GET /po ... Object.keys(p0).sort()"):
 *   amount · approval_step · credit_term · currency_code · deposit · doc_date · id · no ·
 *   paid · pr_id · status · total · vat · vendor_id
 * po-wo-rows.toPoRow already narrows id/no/pr_id/vendor_id/status/approval_step/
 * credit_term/vat/total. This module adds the two the screen used to em-dash despite the
 * server sending them:
 *   - doc_date  (= pos.created_at) -> the detail panel's document-date SmallStat.
 *   - paid      (= SUM(ap_billing.amount) on the PO, server-computed and 2dp-rounded,
 *                B-079/F2) -> the list's paid column. Displayed verbatim; never recomputed
 *                and never summed client-side (money = SERVER).
 *
 * STILL HONESTLY EM-DASHED (no source on this payload — see the POList header):
 *   - deposit column: the prototype cell is a CONTRACTED down-payment PERCENT pill
 *     ("{pct}% - paid/due", i18n po.list.depositPaid/depositDue). The wire's `deposit` is a
 *     PAID amount (SUM of kind=deposit billings), not the agreed rate; `pos` has no
 *     down-payment-percent column, so deriving pct = deposit/total would impute a contract
 *     term from a payment (wrong whenever a deposit is part-paid). B-279.
 *   - kpiDepositDue (deposits OUTSTANDING) needs that same missing agreed rate. B-279.
 *   - receive-goods %: lives on GET /gr, not on this payload.
 *   - payment-schedule amounts + "PO remaining": both are amount x pct / total - paid, i.e.
 *     monetary totals that would be originated in the browser. money = SERVER.
 *   - credit_term / vat: real on the payload, but pototype/po-wo.jsx POList (L12-205) has no
 *     cell for either - its 8 columns and 4 detail SmallStats are fixed, and adding one would
 *     be a redesign (PLAN.md section 0 rule 1). Reported, not invented. B-279.
 */

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row; 0 when absent/invalid (mirrors po-wo-rows.num). */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** The two POList-only wire fields, keyed back onto a PoRow by doc id. */
export interface PoListWire {
  /** Doc id — the join key onto the PoRow the table renders. */
  id: string;
  /** SUM(ap_billing.amount) for this PO, in FULL units. Server-computed (B-079/F2). */
  paid: number;
  /** Raw doc_date instant off the wire (= pos.created_at); "" when absent. */
  docDate: string;
}

/**
 * Narrow one opaque /po row to its POList-only fields. snake_case (server convention) or
 * camelCase, mirroring po-wo-rows.toPoRow. A row with no `paid` key reports 0 — which is
 * also what the server sends for a PO with no ap_billing rows (po.ts sumBillings), so the
 * two are indistinguishable by design and neither is fabricated.
 */
export function toPoListWire(e: Record<string, unknown>): PoListWire {
  return {
    id: str(e.id),
    paid: num(e.paid),
    docDate: str(e.doc_date ?? e.docDate),
  };
}

/** id -> PoListWire map for the rendered rows (rows without an id are skipped). */
export function poListWireById(
  rows: readonly Record<string, unknown>[] | undefined,
): Map<string, PoListWire> {
  const map = new Map<string, PoListWire>();
  for (const r of rows ?? []) {
    const w = toPoListWire(r);
    if (w.id) map.set(w.id, w);
  }
  return map;
}

/**
 * Format a wire timestamp as an ISO calendar date (YYYY-MM-DD, UTC) — the house convention
 * (pr-rows.formatDate / gl/jv-rows.formatDate / ap/pv-rows.formatDate), deterministic and
 * ASCII. The prototype printed a Thai buddhist-era short date, but that came from a mock
 * `date` string; doc_date is a real UTC instant, so the cell shows that. "" for a
 * missing/invalid value -> the view renders its em-dash.
 */
export function formatDate(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * Progress-bar fill for the paid column (po-wo.jsx L88 `width: (r.paid/r.amount)*100%`) —
 * a DISPLAY proportion of two server-owned figures, clamped to 0..100. It is never rendered
 * as a number and never becomes a monetary total; a non-positive total yields 0 rather than
 * a division blow-up.
 */
export function paidPct(paid: number, total: number): number {
  if (!Number.isFinite(paid) || !Number.isFinite(total) || total <= 0) return 0;
  const pct = (paid / total) * 100;
  if (pct <= 0) return 0;
  return pct > 100 ? 100 : pct;
}

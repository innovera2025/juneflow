/*
 * FinAging row/aggregate helpers (ar.aging + ap.aging) — pure, i18n-free, ASCII-only logic
 * ported from pototype/accounting-extra.jsx FinAging (L168-276).
 *
 * The prototype held two local mock arrays (AGING_AP / AGING_AR, L168-181) of PER-PARTY rows
 * (each party a row: { name, cur, b30, b60, b90, over, docs }) and derived the KPI strip + the
 * table body + the tfoot column sums from them. Section-0 rule 3 drops that mock seed: the AR side
 * is the real server report (GET /ar/aging, apps/api/src/routes/ar.ts aging()).
 *
 * HONEST WIRE SHAPE (the pivotal gap — see report + the .tsx header):
 *   GET /ar/aging returns an AGGREGATE-BY-BUCKET report, NOT a per-party breakdown:
 *     { buckets: [{ bucket, count, amount }], total_outstanding, currency_code }
 *   where bucket is one of "current" | "1-30" | "31-60" | "61-90" | "90+" (ASCII hyphen, the
 *   handler's AGING_BUCKETS order), `count` is the number of outstanding invoices that fall in
 *   the bucket, and `amount` is their summed outstanding (amount + vat − Σ rv).
 *
 *   => The wire has the BUCKET dimension (feeds the KPI strip + the tfoot column sums, REAL) but
 *      NOT the PARTY dimension (customer name / per-party row). So `resolveParties` below is
 *      HONEST-EMPTY on this endpoint (it can never fabricate a customer name the wire omits).
 *      A real per-party aging table needs either a per-customer breakdown added to /ar/aging or a
 *      client-side aggregation over GET /ar/invoices — flagged, out of this port's directed wire.
 *
 * The AP side (ap.aging) has NO endpoint at all (apps/api/src/routes/ap.ts exposes no /ap/aging),
 * so its view is null (honest-empty KPI + table) — /ar/aging is NEVER reused for AP (different
 * party + direction). See use-aging.ts.
 *
 * Every colour the .tsx paints from these values is an @juneflow/tokens var(); no Thai/baht leaks
 * here (B-073) — ASCII only.
 */

/** Which ledger side the shared screen renders (route ar.aging → "ar", ap.aging → "ap"). */
export type AgingSide = "ar" | "ap";

/** The five aging buckets, in fixed display order — ASCII keys mirroring the handler's wire. */
export const AGING_BUCKET_KEYS = ["current", "1-30", "31-60", "61-90", "90+"] as const;
export type AgingBucketKey = (typeof AGING_BUCKET_KEYS)[number];

/** One aggregate bucket cell off the /ar/aging wire. */
export interface AgingBucketWire {
  bucket: string;
  count: number;
  amount: number;
}

/**
 * The derived aggregate view the KPI strip + tfoot consume. All money magnitudes are THB minor
 * units already summed server-side; the percentages/counts are pure client derivations.
 */
export interface AgingView {
  /** Outstanding not yet due (bucket "current"). */
  current: number;
  /** Outstanding 1-30 days past due (bucket "1-30"). */
  b30: number;
  /** Outstanding 31-60 days past due (bucket "31-60"). */
  b60: number;
  /** Outstanding 61-90 days past due (bucket "61-90"). */
  b90: number;
  /** Outstanding over 90 days past due (bucket "90+"). */
  over: number;
  /** Σ of every bucket amount past due (b30 + b60 + b90 + over). */
  overdue: number;
  /** total_outstanding off the wire (server authority). */
  total: number;
  /** Σ of every bucket count = number of outstanding invoices the report covers. */
  count: number;
  /** current as a whole-percent of total (0 when total is 0 — no divide-by-zero). */
  currentPct: number;
  /** The report currency (currency_code off the wire; "THB" fallback). */
  currencyCode: string;
}

/**
 * A per-party aging table row (the prototype's AGING_* row shape). Kept as the table-body contract
 * so the screen lights up the moment a per-party wire lands; today `resolveParties` yields none.
 */
export interface AgingPartyRow {
  name: string;
  cur: number;
  b30: number;
  b60: number;
  b90: number;
  over: number;
  docs: number;
  total: number;
}

/** Coerce an opaque numeric (number | numeric-string | null) to a finite number, else 0. */
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Read a string field off an opaque row; "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Index the wire's bucket array by bucket key → amount (absent bucket → 0). */
function amountByBucket(buckets: readonly AgingBucketWire[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of buckets) m.set(str(b.bucket), num(b.amount));
  return m;
}

/**
 * Narrow the opaque GET /ar/aging report to the aggregate KPI/tfoot view. Returns null when there
 * is no wire (the AP side has no endpoint → honest-empty) so callers render em-dash uniformly.
 */
export function toAgingView(wire: Record<string, unknown> | undefined | null): AgingView | null {
  if (wire == null || typeof wire !== "object") return null;
  const rawBuckets = Array.isArray(wire.buckets) ? (wire.buckets as AgingBucketWire[]) : [];
  const byBucket = amountByBucket(rawBuckets);

  const current = byBucket.get("current") ?? 0;
  const b30 = byBucket.get("1-30") ?? 0;
  const b60 = byBucket.get("31-60") ?? 0;
  const b90 = byBucket.get("61-90") ?? 0;
  const over = byBucket.get("90+") ?? 0;
  const overdue = b30 + b60 + b90 + over;

  const count = rawBuckets.reduce((s, b) => s + num(b.count), 0);
  // Prefer the server's total_outstanding; fall back to the summed buckets if it is absent.
  const total =
    wire.total_outstanding != null ? num(wire.total_outstanding) : current + overdue;
  const currentPct = total > 0 ? Math.round((current / total) * 100) : 0;
  const currencyCode = str(wire.currency_code ?? wire.currencyCode) || "THB";

  return { current, b30, b60, b90, over, overdue, total, count, currentPct, currencyCode };
}

/**
 * Resolve the per-party table rows. GET /ar/aging is AGGREGATE-BY-BUCKET (no customer dimension),
 * so this HONESTLY yields NO rows — a per-party breakdown cannot be reconstructed from an
 * aggregate report and is never fabricated (C10). It is kept as the table-body seam so a future
 * per-customer aging wire (or a client-side /ar/invoices aggregation) lights the body up with no
 * screen change. See the module header for the flagged gap.
 */
export function resolveParties(
  _wire: Record<string, unknown> | undefined | null,
): AgingPartyRow[] {
  return [];
}

/** Row total = Σ of the five buckets (mirror the prototype's agRowTotal). */
export function partyRowTotal(r: AgingPartyRow): number {
  return r.cur + r.b30 + r.b60 + r.b90 + r.over;
}

/**
 * Group a money magnitude with thousands separators ("1840000" -> "1,840,000"), matching the
 * prototype's Intl th-TH maximumFractionDigits 0 output. ASCII digits + comma only (no baht
 * symbol / decimals); a non-finite input -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format a magnitude in millions with two decimals ("5200000" -> "5.20"), matching the
 * prototype's (n / 1e6).toFixed(2) KPI value. A non-finite input -> "0.00".
 */
export function formatMillion(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return (n / 1e6).toFixed(2);
}

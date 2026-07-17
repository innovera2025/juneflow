// Server-side money rounding (B-085 fix 3) — the single place FLOW-A handlers
// round a COMPUTED money wire value to the currency minor unit (2 dp) before it
// leaves the server.
//
// Why: several read paths derive money as a JS-float sum/product rather than
// reading a stored numeric column — Σ(received_qty × price) on a GR, Σ ap_billing
// on a PO, value × retention_pct / 100 on a WO, Σ(qty × price) BOQ aggregates.
// IEEE-754 accumulation makes those carry spurious trailing decimals (e.g.
// 0.1 + 0.2 = 0.30000000000000004), which the FE / visual gate then renders as
// drift against the prototype. Rounding at the wire-build point keeps the
// behaviour identical except for that trailing noise.
//
// Scope: COMPUTED aggregates only. Values read straight from a 2-dp numeric
// column are already exact at the wire and are left untouched.

/**
 * Round a computed money value to 2 decimal places (THB and every current
 * currency use a 2-digit minor unit). `Number(x.toFixed(2))` is exact for the
 * money magnitudes in this system (well within 2^53). A non-finite input
 * (NaN / ±Infinity — only reachable from corrupt data) collapses to 0 rather
 * than emitting `"NaN"` onto the wire.
 */
export function round2(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Number(x.toFixed(2));
}

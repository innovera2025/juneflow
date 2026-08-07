/**
 * B-224 — the "business now" used for date-relative DISPLAY status (e.g. aging = days past
 * due_date). `SEED_FROZEN_NOW` (an ISO instant) freezes it so the seed clock and this aging
 * clock stay ALIGNED in the G5 visual gate: a frozen seed alone would leave aging on the real
 * wall clock, so every seeded due_date would read as overdue and the whole billing screen would
 * drift. UNSET (prod/dev, the default) → `Date.now()`: real time, behaviour identical.
 *
 * SCOPE, CORRECTED 2026-08-08 (B-337). It used to say "this only shapes a READ-ONLY computed
 * display value … and never touches the money create path". That is no longer true, and a
 * stale scope note on a clock is exactly the kind of claim a later reader would trust:
 *   - ar.ts / ap.ts aging — still read-only display, unchanged;
 *   - labor.ts `selfServiceDayRefusal` — a WRITE gate. Wei ruled B-337 = ก, so a
 *     self-service check-in may only record a `day` this clock agrees is plausible
 *     (today, back to one 7-day pay week). It still writes no column and posts no JV:
 *     it decides 201 vs 400 on a table that sums into payroll.
 * Consequence worth knowing before setting SEED_FROZEN_NOW anywhere but the G5 gate: with it
 * set, that write gate is judged against the FROZEN date, not the wall clock.
 */
export function businessNowMs(): number {
  const frozen = process.env.SEED_FROZEN_NOW;
  if (!frozen) return Date.now();
  const t = new Date(frozen).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

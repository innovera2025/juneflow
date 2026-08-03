/**
 * B-224 — the "business now" used for date-relative DISPLAY status (e.g. aging = days past
 * due_date). `SEED_FROZEN_NOW` (an ISO instant) freezes it so the seed clock and this aging
 * clock stay ALIGNED in the G5 visual gate: a frozen seed alone would leave aging on the real
 * wall clock, so every seeded due_date would read as overdue and the whole billing screen would
 * drift. UNSET (prod/dev, the default) → `Date.now()`: real time, behaviour identical.
 *
 * This only shapes a READ-ONLY computed display value (aging in whole days). It never posts a
 * JV, never writes a stored column, and never touches the money create path.
 */
export function businessNowMs(): number {
  const frozen = process.env.SEED_FROZEN_NOW;
  if (!frozen) return Date.now();
  const t = new Date(frozen).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

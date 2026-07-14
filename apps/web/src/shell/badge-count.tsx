/*
 * BadgeCount — C10 count pill for a sidebar row (PLAN.md Appendix C).
 *
 * The prototype hardcodes the counts (chrome.jsx 4/17/8/5/12/6); those are a mock
 * mechanic and MUST NOT be ported (§0 rule 3). useBadgeCount() sources the number
 * from the real tenant-scoped GET /counts query (B-040); the pill is hidden when
 * the count is missing or 0, exactly like the prototype (a pill only ever shows a
 * positive number). It never emits a hardcoded number.
 */
import { useBadgeCount } from "./use-shell-data";

export function BadgeCount({ sourceId, sub = false }: { sourceId: string; sub?: boolean }) {
  const count = useBadgeCount(sourceId);
  if (count == null) return null; // no positive count (C10 / B-040) → no pill
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        padding: sub ? "1px 5px" : "1px 6px",
        borderRadius: 999,
        background: "var(--warn)",
        color: "#fff",
      }}
    >
      {count}
    </span>
  );
}

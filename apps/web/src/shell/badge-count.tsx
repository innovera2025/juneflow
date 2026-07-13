/*
 * BadgeCount — C10 count pill for a sidebar row (PLAN.md Appendix C).
 *
 * The prototype hardcodes the counts (chrome.jsx 4/17/8/5/12/6); those are a mock
 * mechanic and MUST NOT be ported (§0 rule 3). useBadgeCount() sources the number
 * from a real query — which does not exist yet (no /count endpoint in the sacred
 * openapi.yaml, BLOCKERS B-039) — so this renders nothing until one lands. It never
 * emits the prototype number.
 */
import { useBadgeCount } from "./use-shell-data";

export function BadgeCount({ sourceId, sub = false }: { sourceId: string; sub?: boolean }) {
  const count = useBadgeCount(sourceId);
  if (count == null) return null; // no real count source yet (C10 / B-039)
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

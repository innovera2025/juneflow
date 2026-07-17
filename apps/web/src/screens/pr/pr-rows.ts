/*
 * PR list-row helpers for PRList (P2-WEB-09, gate G3) — pure, i18n-free, ASCII-only
 * logic derived from pototype/pr-list.jsx PRList (L54-267) + the PR_TYPES map (L3-9),
 * the ApprovalSteps stepper (L34-52) and the ds.jsx STATUS map (L84-92) the prototype's
 * <StatusBadge> reads.
 *
 * §0 rule 3: the prototype's local PR_ROWS demo array (L11-22) is dropped — the list is
 * the real server catalogue (GET /pr, use-pr.ts). The wire doc shape (apps/api/src/
 * routes/pr.ts prWire) is exactly:
 *   { id, no, type, project_id, need_date, status, approval_step, currency_code, amount }
 * where `amount` is the real SUM of the doc's priced lines (never the mock's hardcoded
 * 842,500 etc), and `approval_step` is the real approval-matrix position.
 *
 * WIRE GAPs (reported honestly, never fabricated — surfaced to Wei): the prototype row
 * also shows `title` (detail), `vendor`, `requester` (requester), `phase` (work-position),
 * `budget %` and an `urgent` flag — NONE of these are columns on the pr table / prWire, so
 * the view renders an em-dash (or omits the decoration) for each and this module never
 * invents them. `need_date` IS on the wire but is the need-by date, not the mock's
 * document date, and no created/doc date is exposed (flagged in the view).
 *
 * What IS real and drives this module: type -> chip, status -> badge, amount -> money,
 * and (approval_step + amount) -> the tiered approval stepper. The total number of
 * approval tiers is derived from `amount` with the SAME B-070 thresholds the backend
 * approve-gate enforces (pr.ts requiredTierCount) so the stepper can never drift from the
 * server: > 2,000,000 THB -> 3 tiers, > 500,000 -> 2, otherwise 1.
 */

/** A PR doc as the table consumes it (GET /pr row, narrowed from the opaque wire). */
export interface PrRow {
  id: string;
  no: string;
  /** pr_type enum on the wire — material | subcon | expense | advance (clear maps to advance on write). */
  type: string;
  /** Owning project id (the mock's project name is not shown as a row column). */
  projectId: string;
  /** Need-by date (nullable) — NOT the mock's document date; the view flags this. */
  needDate: string | null;
  /** Lifecycle status — draft | pending | approved | rejected | revise (free-text column). */
  status: string;
  /** Approval-matrix position (0 for a draft; the tier last cleared otherwise). */
  approvalStep: number;
  currencyCode: string;
  /** Doc total in FULL currency units (server SUM of its priced lines). */
  amount: number;
}

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a string-or-null field (kept null so the view can render an honest em-dash). */
function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = typeof v === "string" ? v : String(v);
  return s.trim() === "" ? null : s;
}

/** Read a finite number off an opaque row; 0 when absent/invalid. */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Narrow an opaque /pr Entity row to the PrRow the table needs. Multi-word fields accept
 * snake_case (server convention) or camelCase for robustness (mirrors boq-rows / cc-rows).
 * Missing fields default (0 / "" / null) — never invented.
 */
export function toPrRow(e: Record<string, unknown>): PrRow {
  return {
    id: str(e.id),
    no: str(e.no),
    type: str(e.type),
    projectId: str(e.project_id ?? e.projectId),
    needDate: strOrNull(e.need_date ?? e.needDate),
    status: str(e.status),
    approvalStep: num(e.approval_step ?? e.approvalStep),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    amount: num(e.amount),
  };
}

/** The five PR type discriminants (pr-list.jsx PR_TYPES keys). */
export type PrTypeKey = "material" | "subcon" | "expense" | "advance" | "clear";

/**
 * Type-chip colours, verbatim from pototype/pr-list.jsx PR_TYPES (L3-9). These specific
 * hexes have no @juneflow/tokens equivalent, so they are kept prototype-verbatim
 * (B-037(a) precedent, same as the ds.jsx STATUS dot hexes). Unknown types fall back to
 * `material` (the wire only ever yields the four enum values; `clear` is mapped to
 * `advance` on write — pr.ts PR_TYPE_MAP — so it is included only for completeness).
 */
const PR_TYPE_META: Record<PrTypeKey, { color: string; soft: string }> = {
  material: { color: "#0F766E", soft: "#E6F4F2" },
  subcon: { color: "#1D4ED8", soft: "#E5ECFB" },
  expense: { color: "#7C3AED", soft: "#F1E9FE" },
  advance: { color: "#B45309", soft: "#FEF3C7" },
  clear: { color: "#475569", soft: "#EEF1F4" },
};

/** Chip colour + soft background for a PR type (unknown -> material). */
export function prTypeMeta(type: string): { color: string; soft: string } {
  return PR_TYPE_META[type as PrTypeKey] ?? PR_TYPE_META.material;
}

/** pr-strings.json phrase-key name for a PR type label (unknown -> typeMaterial). */
export function prTypeStringName(
  type: string,
): "typeMaterial" | "typeSubcon" | "typeExpense" | "typeAdvance" | "typeClear" {
  switch (type) {
    case "subcon":
      return "typeSubcon";
    case "expense":
      return "typeExpense";
    case "advance":
      return "typeAdvance";
    case "clear":
      return "typeClear";
    default:
      return "typeMaterial";
  }
}

/**
 * Status-badge tone (ds.jsx STATUS map, L84-92, read by <StatusBadge status={r.status}>).
 * bg/fg are @juneflow/tokens var() references (rule 6); `dot` is the prototype-verbatim
 * STATUS.<status>.dot hex (no matching @juneflow/tokens value, B-037(a)). Unknown statuses
 * fall back to draft, exactly like the prototype's `STATUS[status] || STATUS.draft`.
 */
export function statusTone(status: string): { bg: string; fg: string; dot: string } {
  switch (status) {
    case "pending":
      return { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
    case "approved":
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
    case "rejected":
      return { bg: "var(--danger-soft)", fg: "var(--danger)", dot: "#DC2626" };
    case "revise":
      return { bg: "var(--info-soft)", fg: "var(--info)", dot: "#1D4ED8" };
    default:
      return { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
  }
}

/** pr-strings.json phrase-key name for a status label (unknown -> statusDraft). */
export function statusStringName(
  status: string,
): "statusDraft" | "statusPending" | "statusApproved" | "statusRejected" | "statusRevise" {
  switch (status) {
    case "pending":
      return "statusPending";
    case "approved":
      return "statusApproved";
    case "rejected":
      return "statusRejected";
    case "revise":
      return "statusRevise";
    default:
      return "statusDraft";
  }
}

/** B-070 approval tier thresholds (THB, strict >), mirroring apps/api/src/routes/pr.ts. */
const PR_TIER_PM_THRESHOLD = 500_000; // amount > this -> +project-manager tier
const PR_TIER_MD_THRESHOLD = 2_000_000; // amount > this -> +MD tier

/**
 * How many approval tiers the PR's amount engages — the stepper's `total`. Identical to
 * the backend's requiredTierCount (pr.ts L206-210) so the display never drifts from the
 * server's approve-gate: > 2M -> 3, > 500k -> 2, otherwise 1.
 */
export function requiredTierCount(amount: number): number {
  if (amount > PR_TIER_MD_THRESHOLD) return 3;
  if (amount > PR_TIER_PM_THRESHOLD) return 2;
  return 1;
}

/**
 * The approval stepper bar colours (@juneflow/tokens var()s), ported 1:1 from
 * pototype/pr-list.jsx ApprovalSteps (L34-52). One entry per tier; `done` bars are ok,
 * the `current` bar is warn, and a `failed` bar is danger (rejected) or info (revise).
 */
export function approvalBars(step: number, total: number, status: string): string[] {
  const bars: string[] = [];
  for (let i = 0; i < total; i += 1) {
    const done = i < step && status !== "rejected" && status !== "revise";
    const current = i === step && (status === "pending" || status === "revise");
    const failed = i === step - 1 && (status === "rejected" || status === "revise");
    let bg = "var(--surface-3)";
    if (done) bg = "var(--ok)";
    if (current) bg = "var(--warn)";
    if (failed) bg = status === "rejected" ? "var(--danger)" : "var(--info)";
    bars.push(bg);
  }
  return bars;
}

/** Stepper label — "—" for a draft, else "{step}/{total}" (pr-list.jsx L47-49). */
export function approvalStepLabel(step: number, total: number, status: string): string {
  return status === "draft" ? "—" : `${step}/${total}`;
}

/**
 * Group a FULL-unit amount with thousands separators ("842500" -> "842,500"), matching
 * the prototype's Intl fmt (ds.jsx th-TH maximumFractionDigits 0). ASCII digits + comma
 * only; NaN / non-finite -> "0". Mirrors boq-rows / cc-rows formatMoney.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** KPI "value in millions", 2 dp (pr-list.jsx KPI sub "value {value} M THB"). */
export function millionsValue(totalUnits: number): string {
  return (totalUnits / 1e6).toFixed(2);
}

/** Filter inputs for the toolbar — status (tab), project id, PR type, free-text query. */
export interface PrFilter {
  status: string;
  projectId: string;
  type: string;
  q: string;
}

/**
 * Filter the docs by the active tab's status + the project / type selects + the free-text
 * query. Search runs over `no` only — the mock also searched title/vendor, which have no
 * wire column (WIRE GAP), so those are not searchable here. An empty field = no filter on
 * that field.
 */
export function filterPrRows(rows: readonly PrRow[], f: PrFilter): PrRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.status && r.status !== f.status) return false;
    if (f.projectId && r.projectId !== f.projectId) return false;
    if (f.type && r.type !== f.type) return false;
    if (q && !r.no.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Count docs of a given status (KPI + tab-count aggregates). */
export function countByStatus(rows: readonly PrRow[], status: string): number {
  return rows.filter((r) => r.status === status).length;
}

/** Sum the docs' amounts (KPI "value" aggregates). */
export function sumAmount(rows: readonly PrRow[]): number {
  return rows.reduce((s, r) => s + r.amount, 0);
}

/** Count of the active filter selects for the "filter · {count}" button badge. */
export function activeFilterCount(f: Pick<PrFilter, "projectId" | "type" | "q">): number {
  return (f.projectId ? 1 : 0) + (f.type ? 1 : 0) + (f.q.trim() ? 1 : 0);
}

/*
 * PR-form detail helpers for PRForm (pr.form) — pure, i18n-free, ASCII-only logic
 * derived from pototype/pr-form.jsx PRForm (L223-546). PRForm is the DETAIL view of an
 * EXISTING PR (reached via ctx.navigate("pr.form", {id}) from pr-list.tsx:292); this
 * module narrows the opaque GET /pr/{id} wire (apps/api/src/routes/pr.ts prWire +
 * prItemWire) and derives the status-gated action availability + the approval-tier
 * display, both mirrored from the SAME B-070 thresholds the backend approve-gate
 * enforces so the UI can never drift from the server.
 *
 * §0 rule 3 (real-wire-over-mock): the prototype's fully-mocked single doc (ITEMS L72-77,
 * APPROVERS L79-89, BudgetBar args L486, attachments/comments arrays) is DROPPED — only
 * fields the wire actually backs are surfaced. WIRE GAPS the detail wire cannot serve are
 * NEVER fabricated here (the view em-dashes them):
 *   - project_id resolves to a uuid only (no project_name) -> resolveProjectName() joins
 *     it client-side against GET /projects; unresolved -> "" (view renders an em-dash).
 *   - items[].boq_item_id resolves to NO name/code/unit (pr_item is {pr_id, boq_item_id,
 *     qty}; prItemWire returns {boq_item_id, qty, price, amount}) -> the item name/code/
 *     unit/BOQ-badge columns have no source -> the view em-dashes them; qty/price/amount
 *     are real.
 *   - VAT + net total: the wire carries only `amount` (ex-VAT Σ); client-computed vat/net
 *     is forbidden money-math -> this module exposes ONLY the server `amount` (no vat/net
 *     helper exists here by design).
 *
 * Money discipline: `amount` (and items[].amount / price) are SERVER-derived display
 * values (Σ qty×BOQ-price, C10) — this module only FORMATS them (formatMoney/formatDec),
 * never computes a money total. The only arithmetic here is INTEGER approval-tier counting
 * (remainingTiers), never money.
 */
import { formatMoney, requiredTierCount } from "./pr-rows";

export { formatMoney, requiredTierCount };

/** One PR line as the items table consumes it (GET /pr/{id} items[] row). */
export interface PrItem {
  /** BOQ item FK — a uuid; the wire resolves NO name/code/unit from it (WIRE GAP). */
  boqItemId: string | null;
  /** Requested quantity (real). */
  qty: number;
  /** Unit price priced from the referenced BOQ item (real, 0 for a non-BOQ line). */
  price: number;
  /** Line amount = qty × price (real, server-computed). */
  amount: number;
}

/** A PR doc as the detail view consumes it (GET /pr/{id}, narrowed from the opaque wire). */
export interface PrDetail {
  id: string;
  no: string;
  /** pr_type enum — material | subcon | expense | advance (clear maps to advance on write). */
  type: string;
  /** Lifecycle status — draft | pending | approved | rejected. */
  status: string;
  /** Short title (header description line) — the long reason textarea has no wire (WIRE GAP). */
  title: string;
  /** Owning project id (uuid) — resolved to a name via resolveProjectName (WIRE GAP). */
  projectId: string;
  /** Need-by date, ISO (or "" when blank). */
  needDate: string;
  /** Phase / building text (real). */
  phase: string;
  /** Resolved requester display name (backend-joined; "" when absent). */
  requester: string;
  /** Resolved vendor display name (backend-joined; "" when absent). */
  vendor: string;
  /** Submitted timestamp, ISO (or "" — draft). */
  submittedAt: string;
  /** Approved timestamp, ISO (or "" — not yet approved). */
  approvedAt: string;
  /** Approval-matrix position (0 while draft/pending; the tier count once approved). */
  approvalStep: number;
  currencyCode: string;
  /** Doc total in FULL currency units (server Σ of its priced lines, ex-VAT). */
  amount: number;
  items: PrItem[];
}

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a nullable string FK — null when absent/blank (so the view em-dashes it). */
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

/** Narrow one opaque GET /pr/{id} items[] entry to a PrItem (missing fields default, never invented). */
export function toPrItem(e: Record<string, unknown>): PrItem {
  return {
    boqItemId: strOrNull(e.boq_item_id ?? e.boqItemId),
    qty: num(e.qty),
    price: num(e.price),
    amount: num(e.amount),
  };
}

/**
 * Narrow the opaque GET /pr/{id} Entity to the PrDetail the view needs. Multi-word fields
 * accept snake_case (server convention) or camelCase for robustness (mirrors toPrRow).
 * `items` narrows each line; a non-array items field yields []. Missing fields default
 * (0 / "" / []) — never invented.
 */
export function toPrDetail(e: Record<string, unknown>): PrDetail {
  const rawItems = Array.isArray(e.items) ? (e.items as unknown[]) : [];
  return {
    id: str(e.id),
    no: str(e.no),
    type: str(e.type),
    status: str(e.status),
    title: str(e.title),
    projectId: str(e.project_id ?? e.projectId),
    needDate: str(e.need_date ?? e.needDate),
    phase: str(e.phase),
    requester: str(e.requester),
    vendor: str(e.vendor),
    submittedAt: str(e.submitted_at ?? e.submittedAt),
    approvedAt: str(e.approved_at ?? e.approvedAt),
    approvalStep: num(e.approval_step ?? e.approvalStep),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    amount: num(e.amount),
    items: rawItems.map((it) => toPrItem((it ?? {}) as Record<string, unknown>)),
  };
}

/**
 * Status gates for the state machine (apps/api/src/routes/pr.ts):
 *   draft --submit--> pending --approve--> approved | --reject--> rejected
 * Only a `draft` may be submitted; only a `pending` may be approved or rejected. Any other
 * status (approved/rejected/unknown) disables all three — the doc is terminal/read-only.
 */
export function canSubmit(status: string): boolean {
  return status === "draft";
}
export function canApprove(status: string): boolean {
  return status === "pending";
}
export function canReject(status: string): boolean {
  return status === "pending";
}

/**
 * Remaining approval tiers for the sticky-bar summary (the "{n} tiers remaining" value). Pure
 * INTEGER arithmetic on real columns (never money): total tiers the amount engages
 * (requiredTierCount, mirrored from the backend) minus the tiers already cleared
 * (approvalStep), clamped at 0. approvalStep is 0 while pending, so this reports the full
 * tier count for a mid-flight PR (honest — the per-step mid-progress is not on the wire).
 */
export function remainingTiers(amount: number, approvalStep: number, status: string): number {
  if (status === "approved" || status === "rejected") return 0;
  const total = requiredTierCount(amount);
  const cleared = Number.isFinite(approvalStep) && approvalStep > 0 ? approvalStep : 0;
  return Math.max(0, total - cleared);
}

/** pr-form-strings.json phrase-key name for a PR type tab label (unknown -> typeMaterial). */
export function typeTabPhraseName(
  type: string,
): "typeMaterial" | "typeSubconWo" | "typeExpense" | "typeAdvance" | "typeClear" {
  switch (type) {
    case "subcon":
      return "typeSubconWo";
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
 * Status-badge tone (ds.jsx STATUS map, read by the doc-header <StatusBadge>). bg/fg are
 * @juneflow/tokens var() references (rule 6); `dot` is the prototype-verbatim STATUS.<x>.dot
 * hex (no matching token, B-037(a)). Unknown -> draft, exactly like the prototype's
 * STATUS[status] || STATUS.draft.
 */
export function statusTone(status: string): { bg: string; fg: string; dot: string } {
  switch (status) {
    case "pending":
      return { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
    case "approved":
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
    case "rejected":
      return { bg: "var(--danger-soft)", fg: "var(--danger)", dot: "#DC2626" };
    default:
      return { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
  }
}

/** pr-form-strings.json phrase-key name for a status label (unknown -> statusDraft). */
export function statusPhraseName(
  status: string,
): "statusDraft" | "statusPending" | "statusApproved" | "statusRejected" {
  switch (status) {
    case "pending":
      return "statusPending";
    case "approved":
      return "statusApproved";
    case "rejected":
      return "statusRejected";
    default:
      return "statusDraft";
  }
}

/**
 * Resolve a project id to its display name against the tenant's GET /projects catalogue
 * (the detail wire returns project_id only — WIRE GAP). "" when the id is blank or not in
 * the catalogue, so the view renders an honest em-dash (never the raw uuid).
 */
export function resolveProjectName(
  projectId: string,
  projects: readonly { id: string; name?: string }[] | undefined,
): string {
  if (!projectId || !projects) return "";
  const hit = projects.find((p) => p.id === projectId);
  return hit?.name ?? "";
}

/**
 * Format a server timestamp as an ISO date (YYYY-MM-DD, UTC — deterministic, ASCII) for the
 * "last edited" line. The prototype showed a Thai buddhist date+time from a mock field; the
 * wire exposes only submitted_at/approved_at, so the "last edited" moment is the later of
 * the two, rendered as a stable ISO date (same honest pattern as pv-rows.formatDate). ""
 * for missing/unparseable input, so the view renders an em-dash.
 */
export function lastEditedDate(submittedAt: string, approvedAt: string): string {
  const raw = approvedAt.trim() || submittedAt.trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * Group a FULL-unit amount with 2 decimals + thousands separators ("168.5" -> "168.50",
 * "902475" -> "902,475.00"), matching the prototype's fmtDec (2dp) for the item unit-price
 * + the totals-footer ex-VAT amount. ASCII digits/comma/dot only; NaN / non-finite ->
 * "0.00". This FORMATS a server value — it never computes a money total.
 */
export function formatDec(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const [int, frac] = abs.toFixed(2).split(".");
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${grouped}.${frac}`;
}

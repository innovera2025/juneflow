/*
 * Cost-center row helpers for MasterCC (P1-WEB-11) — pure, i18n-free, ASCII-only
 * logic ported 1:1 from pototype/master.jsx MasterCC (L666-731) + the ds.jsx STATUS
 * map (L82-89) that the prototype's <StatusBadge> reads.
 *
 * The prototype held cost centers in local state (CC_SEED, master.jsx:584-592) whose
 * `budget` was already a FULL-baht number (e.g. 84_400_000) and whose type/status were
 * plain strings. §0 rule 3: that mock seed is dropped — the list is the real server
 * catalogue (GET /cost-centers, use-cost-centers.ts) of opaque Entity rows narrowed here.
 *
 * Budget semantics: server + prototype both store FULL baht (NOT millions — that is a
 * models-only scaling). The table shows it comma-grouped with no decimals and NO baht
 * symbol (the baht sign lives only in the cc.thBudget header key, so no baht/Thai leaks
 * into this .ts) — formatMoney mirrors role-matrix.ts formatMoney / ds.jsx fmt.
 */

/** A cost center as the table consumes it (GET /cost-centers row, narrowed from opaque). */
export interface CostCenterRow {
  id: string;
  code: string;
  name: string;
  /** Cost-center type — "Project" | "Overhead" | "Dept" (opaque row data, badge label). */
  type: string;
  /** Bound phase/block/department label ("—" when none). */
  link: string;
  /** Cost-center owner display name. */
  owner: string;
  /** Annual budget in FULL baht (server system of record). */
  budget: number;
  currency_code: string;
  /** Lifecycle status — "draft" | "approved" (new centers start "draft", server-forced). */
  status: string;
}

/** Read a string field off an opaque row; "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row; 0 when absent/invalid. */
function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Narrow an opaque /cost-centers Entity row to the CostCenterRow the table needs.
 * Multi-word fields accept snake_case (server convention) or camelCase for robustness —
 * mirrors model-cards.ts's `currency_code ?? currencyCode` dual read. Missing fields
 * default (0 / "").
 */
export function toCostCenterRow(e: Record<string, unknown>): CostCenterRow {
  return {
    id: str(e.id),
    code: str(e.code),
    name: str(e.name),
    type: str(e.type),
    link: str(e.link),
    owner: str(e.owner),
    budget: num(e.budget),
    currency_code: str(e.currency_code ?? e.currencyCode),
    status: str(e.status),
  };
}

/**
 * Token bg/fg for the type pill (master.jsx:709-713). Project = brand, Overhead = warn,
 * anything else (Dept) = the neutral surface-3 fallback. Values are @juneflow/tokens
 * var() references (rule 6) — the raw `type` string is the pill's visible label.
 */
export function typeBadgeTone(type: string): { bg: string; fg: string } {
  if (type === "Project") return { bg: "var(--brand-soft)", fg: "var(--brand)" };
  if (type === "Overhead") return { bg: "var(--warn-soft)", fg: "var(--warn)" };
  return { bg: "var(--surface-3)", fg: "var(--text-2)" };
}

/**
 * Status-badge tone (ds.jsx STATUS map, L82-87, read by <StatusBadge status={r.status}>).
 * "approved" -> ok; any other status -> the prototype's `STATUS[status] || STATUS.draft`
 * fallback (draft tone). bg/fg are @juneflow/tokens var() references; `dot` is the
 * prototype-verbatim STATUS dot hex (no matching @juneflow/tokens value, B-037(a)).
 */
export function statusTone(status: string): { bg: string; fg: string; dot: string } {
  if (status === "approved") {
    return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
  }
  return { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
}

/**
 * Group a FULL-baht budget with thousands separators ("1000000" -> "1,000,000"),
 * matching the prototype's Intl fmt (ds.jsx:4-5, th-TH maximumFractionDigits 0) and
 * role-matrix.ts formatMoney. ASCII digits + comma only (no baht symbol / decimals) so
 * no baht/Thai leaks here; NaN / non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

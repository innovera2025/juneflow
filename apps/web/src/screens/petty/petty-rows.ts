/*
 * Petty-cash row + form helpers for PettyCash (P2-WEB-75) — pure, i18n-free,
 * ASCII-only logic ported from pototype/petty-alloc.jsx PettyCash (L12-117) +
 * PettyClaimForm (L376-474).
 *
 * The prototype held the transactions in a local array (PETTY_TX, L3-10) whose rows
 * carried a signed mock money value + denormalised display strings. Juneflow §0
 * rule: that mock seed is dropped — the list is the real server catalogue
 * (GET /petty, apps/api/src/routes/petty.ts listPettyCash) of opaque Entity rows
 * narrowed here. The wire carries { id, no, type, label, value, currency_code,
 * by_user_id, by, project_id, project_name, cc_id, cc_name, cat, ref, status,
 * txn_date, created_at }.
 *
 * money=SERVER (§0 + money-post lessons): the server stores `value` as a POSITIVE
 * magnitude and distinguishes direction by `type` (topup = inflow, claim/clear =
 * outflow) — so the amount sign/tone is derived HERE from `type`, never from a
 * client re-sign of the number. The KPI baht sums are DISPLAY derivations off the
 * already-server-authoritative row amounts (same accepted pattern as billing-rows
 * billingKpis) — the web posts no computed money and never invents a fund balance.
 *
 * HONEST GAPS the screen em-dashes (never fabricated), see petty.tsx header:
 *   - the fund-balance card (prototype 14,270 / float 50,000 / % used) has NO
 *     backing endpoint -> em-dashed (a client rollup would be both a forbidden money
 *     computation and a wrong number: the loaded page is not the whole fund).
 *   - the "below reorder level" KPI has no reorder wire -> em-dash value.
 *   - `by` / `ref` / `txn_date` are nullable on the wire -> em-dash / omit.
 * Every colour is an @juneflow/tokens var() or a prototype-verbatim STATUS dot hex
 * (ds.jsx STATUS); no Thai/baht leaks here (labels live in petty-strings.json).
 */

/** The prototype's per-claim Petty cap (petty-alloc.jsx L387; server-enforced too). */
export const PETTY_CAP = 10_000;

/** A petty-cash transaction as the list table consumes it (GET /petty row, narrowed). */
export interface PettyRow {
  id: string;
  /** Server running number PT-YYYY-NNNN; "" when absent -> em-dash. */
  no: string;
  /** Movement kind: claim | clear | topup (drives the type badge + amount sign). */
  type: string;
  /** Free-text line description (the "item" column). */
  label: string;
  /** POSITIVE money magnitude (server system of record); direction is `type`. */
  value: number;
  currencyCode: string;
  byUserId: string;
  /** Resolved claimant name (server join); "" -> em-dash. */
  by: string;
  projectId: string;
  projectName: string;
  ccId: string;
  ccName: string;
  /** Category code (Welfare | Transport | ...); free text. */
  cat: string;
  /** Linked doc ref (e.g. a PR no); "" -> no sub-line. */
  ref: string;
  /** Lifecycle status (pending | approved | ...). */
  status: string;
  /** Optional user-supplied txn date string; "" when absent. */
  txnDate: string;
  /** Row creation timestamp (UTC ISO). */
  createdAt: string;
}

/** Read a string field off an opaque row; "" when absent/null. */
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

/** Narrow an opaque /petty Entity row to the PettyRow the table needs. */
export function toPettyRow(e: Record<string, unknown>): PettyRow {
  return {
    id: str(e.id),
    no: str(e.no),
    type: str(e.type),
    label: str(e.label),
    value: num(e.value),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    byUserId: str(e.by_user_id ?? e.byUserId),
    by: str(e.by),
    projectId: str(e.project_id ?? e.projectId),
    projectName: str(e.project_name ?? e.projectName),
    ccId: str(e.cc_id ?? e.ccId),
    ccName: str(e.cc_name ?? e.ccName),
    cat: str(e.cat),
    ref: str(e.ref),
    status: str(e.status),
    txnDate: str(e.txn_date ?? e.txnDate),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/**
 * Group a FULL-baht magnitude with thousands separators ("3200" -> "3,200"),
 * matching the prototype's fmt (ds.jsx th-TH maximumFractionDigits 0). ASCII digits
 * + comma only (no baht symbol / decimals); non-finite -> "0". Sign is applied by
 * the caller from `type`, not carried here.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(Math.abs(n));
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/* --------------------------------------------------------------------------- */
/* Type badge + amount direction (petty-alloc.jsx L92-108)                      */
/* --------------------------------------------------------------------------- */

/** Which type-badge label a wire type renders (resolved in the view — no Thai here). */
export type PettyTypeKind = "claim" | "clear" | "topup";

/** Classify a wire `type` into its badge kind (unknown -> claim, the mock default). */
export function pettyTypeKind(type: string): PettyTypeKind {
  switch (type) {
    case "clear":
      return "clear";
    case "topup":
      return "topup";
    default:
      return "claim";
  }
}

/** Token bg/fg for a type badge (petty-alloc.jsx L95-97). */
export function pettyTypeTone(kind: PettyTypeKind): { bg: string; fg: string } {
  switch (kind) {
    case "clear":
      return { bg: "var(--info-soft)", fg: "var(--info)" };
    case "topup":
      return { bg: "var(--ok-soft)", fg: "var(--ok)" };
    default:
      return { bg: "var(--brand-soft)", fg: "var(--brand)" };
  }
}

/**
 * The signed amount cell (petty-alloc.jsx L106-108). The server stores value as a
 * positive magnitude; direction comes from `type`: topup = inflow ("+", ok tone),
 * claim/clear = outflow ("-", danger tone). Returns the display text + a tone token.
 */
export function pettyAmountCell(row: Pick<PettyRow, "type" | "value">): {
  text: string;
  color: string;
} {
  const inflow = pettyTypeKind(row.type) === "topup";
  const sign = inflow ? "+" : "-";
  return {
    text: `${sign}${formatMoney(row.value)}`,
    color: inflow ? "var(--ok)" : "var(--danger)",
  };
}

/* --------------------------------------------------------------------------- */
/* Status badge (ds.jsx STATUS map, read by <StatusBadge>)                      */
/* --------------------------------------------------------------------------- */

/** Status-badge tone (ds.jsx STATUS). Unknown -> draft fallback (STATUS[s] || draft). */
export function statusTone(status: string): { bg: string; fg: string; dot: string } {
  switch (status) {
    case "approved":
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
    case "pending":
      return { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
    case "rejected":
      return { bg: "var(--danger-soft)", fg: "var(--danger)", dot: "#DC2626" };
    default:
      return { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
  }
}

/** Which i18n label a wire status renders (resolved in the view — no Thai here). */
export function statusLabelKind(
  status: string,
): "draft" | "pending" | "approved" | "rejected" {
  switch (status) {
    case "pending":
      return "pending";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    default:
      return "draft";
  }
}

/* --------------------------------------------------------------------------- */
/* Date cell (petty-alloc.jsx L105 renders a Thai-Buddhist date+time literal)     */
/* --------------------------------------------------------------------------- */

/**
 * The date cell text. The prototype rendered a Thai-Buddhist date+time literal; the
 * real wire carries an optional user `txn_date` string and a UTC `created_at`
 * timestamp. Honest render (no fabricated locale): the raw txn_date when present,
 * else "YYYY-MM-DD HH:mm" of created_at (times stored UTC, PLAN.md §4), else "".
 */
export function pettyDateCell(row: Pick<PettyRow, "txnDate" | "createdAt">): string {
  if (row.txnDate) return row.txnDate;
  if (!row.createdAt) return "";
  const d = new Date(row.createdAt);
  if (!Number.isFinite(d.getTime())) return row.createdAt;
  const p = (n: number): string => String(n).padStart(2, "0");
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  const time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return `${date} ${time}`;
}

/* --------------------------------------------------------------------------- */
/* Tab counts (petty-alloc.jsx L65-71) — presentational, but real counts        */
/* --------------------------------------------------------------------------- */

export interface PettyTabCounts {
  all: number;
  claim: number;
  clear: number;
  topup: number;
  pending: number;
}

/** Count rows per tab (petty-alloc.jsx L66-70). */
export function pettyTabCounts(rows: readonly PettyRow[]): PettyTabCounts {
  return {
    all: rows.length,
    claim: rows.filter((r) => pettyTypeKind(r.type) === "claim").length,
    clear: rows.filter((r) => pettyTypeKind(r.type) === "clear").length,
    topup: rows.filter((r) => pettyTypeKind(r.type) === "topup").length,
    pending: rows.filter((r) => r.status === "pending").length,
  };
}

/* --------------------------------------------------------------------------- */
/* KPI strip (petty-alloc.jsx L58-60) — derived from the loaded rows            */
/* --------------------------------------------------------------------------- */

export interface PettyKpis {
  /** Count of claim rows created in `now`'s calendar month (UTC). */
  claimMonthCount: number;
  /** Sum of those rows' value, FULL baht (display derivation). */
  claimMonthSum: number;
  /** Count of pending rows. */
  pendingCount: number;
  /** Sum of pending rows' value, FULL baht. */
  pendingSum: number;
}

/** The CE 'YYYY-MM' UTC month key of a timestamp, or "" for a bad/absent value. */
function monthKey(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * The KPI-card numbers (petty-alloc.jsx L58-60), all derived from the loaded rows.
 * "claims this month" filters type=claim on created_at's month (UTC, vs `now`);
 * "pending" filters status=pending. The "below reorder level" KPI is NOT computed
 * (no fund-balance/reorder wire) — the view em-dashes it. `now` is injectable so the
 * month boundary is deterministic under test.
 */
export function pettyKpis(rows: readonly PettyRow[], now: Date = new Date()): PettyKpis {
  const nowKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const claimsThisMonth = rows.filter(
    (r) => pettyTypeKind(r.type) === "claim" && monthKey(r.createdAt) === nowKey,
  );
  const pending = rows.filter((r) => r.status === "pending");
  return {
    claimMonthCount: claimsThisMonth.length,
    claimMonthSum: claimsThisMonth.reduce((s, r) => s + r.value, 0),
    pendingCount: pending.length,
    pendingSum: pending.reduce((s, r) => s + r.value, 0),
  };
}

/* --------------------------------------------------------------------------- */
/* Create-form (POST /petty) helpers                                            */
/* --------------------------------------------------------------------------- */

/**
 * The PettyClaimForm draft state (petty-alloc.jsx L376-386). Only the fields that
 * map to the typed POST /petty body are collected: category + amount + description
 * (required), txn_date + project_id (optional). The prototype fields with no create-
 * body counterpart are DROPPED (jv-create-form precedent): the claimant field
 * (server-owned: by_user_id = the authenticated caller), and the "clear PR" ref
 * (the clear/advance types have no create endpoint — claim-MVP, B-233).
 */
export interface PettyClaimDraft {
  category: string;
  /** Raw string input (parsed on submit). */
  amount: string;
  description: string;
  txnDate: string;
  projectId: string;
}

/** A blank claim draft (category defaults to the prototype's "Welfare", L378). */
export function emptyPettyClaimDraft(): PettyClaimDraft {
  return { category: "Welfare", amount: "", description: "", txnDate: "", projectId: "" };
}

/** Parse a raw money input to a non-negative finite number (blank/invalid -> 0). */
export function parseMoney(raw: string): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * Submit is enabled when a category is chosen, amount > 0, and a description is given
 * (petty-alloc.jsx L386 canSave = amount>0 && desc && by; `by` is server-owned here
 * so it drops out). The cap is NOT a submit gate — the prototype lets an over-cap
 * claim be submitted and the SERVER rejects it (money=SERVER), the view only warns.
 */
export function pettyClaimSubmittable(d: PettyClaimDraft): boolean {
  return d.category.trim() !== "" && parseMoney(d.amount) > 0 && d.description.trim() !== "";
}

/** True when the typed amount exceeds the per-claim cap (petty-alloc.jsx L387 warn). */
export function isOverCap(d: PettyClaimDraft): boolean {
  return parseMoney(d.amount) > PETTY_CAP;
}

/**
 * Compose the typed POST /petty body from the draft. amount is sent as the number
 * the user typed (money=SERVER: the server owns the cap, the currency, the running
 * number, and the deferred GL posting). Only present optional fields are sent.
 */
export function buildPettyClaimBody(d: PettyClaimDraft): {
  category: string;
  amount: number;
  description: string;
  txn_date?: string;
  project_id?: string;
} {
  const body: {
    category: string;
    amount: number;
    description: string;
    txn_date?: string;
    project_id?: string;
  } = {
    category: d.category.trim(),
    amount: parseMoney(d.amount),
    description: d.description.trim(),
  };
  if (d.txnDate.trim() !== "") body.txn_date = d.txnDate.trim();
  if (d.projectId.trim() !== "") body.project_id = d.projectId.trim();
  return body;
}

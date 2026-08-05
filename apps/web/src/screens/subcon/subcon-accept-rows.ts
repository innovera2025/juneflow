/*
 * SubconAccept row/derivation helpers (subcon.accept port, gate G3) — pure,
 * i18n-free, ASCII-only logic derived from pototype/subcon-accept2.jsx SubconAccept
 * (L5-142) + AcceptForm (L153-240) and the shared constants in subcon-accept.jsx
 * (SUBC_METHOD L44-49, PERIOD_STATE L50-53).
 *
 * PLAN.md section 0 rule 3: the prototype's local SUBC_CONTRACTS mock (inline period
 * arrays, hardcoded money, a per-contract `method`, an EXTERNAL PROJECT_PROGRESS feed)
 * is dropped. The periods are the real server rows (GET /subcon-contracts/{id}/periods,
 * use-subcon.ts) whose opaque Entity wire is EXACTLY (apps/api/src/routes/subcon.ts
 * periodWire):
 *   { id, contract_id, seq, basis, target, pct, amount, currency_code, status }
 * status vocab = pending | delivered | inspecting | passed | rejected | paid. The
 * periods-list handler additionally enriches each row (enrichPeriodRow) with a real
 * `defect` (the rejected period's defect items) — narrowed + rendered here (META-1).
 *
 * WIRE GAPS (reported, never fabricated — see the SubconAccept view header for the
 * full list). The period wire carries NO label, NO GR doc, NO unit label, and there
 * is no contract-level `basis` (the method chip is DERIVED from the periods' basis).
 * This module never invents values for those; the view em-dashes. The rejected-period
 * DEFECT text is now REAL (periods-list enrichment `defect`, META-1) — not a gap.
 *
 * Money helpers (formatMoney / millionsValue) are re-exported from ./subcon-rows so
 * the SubconAccept view + AcceptForm read every money format from this module (the
 * task's module layout) without duplicating the grouping implementation.
 *
 * POPULATION DISCIPLINE for everything derived here (B-290, the wo.list class of defect).
 * THE RULE, in one line: a claim about ONE period may only rest on preconditions checked
 * for THAT period — with .every()/per-row, never with the FIRST element and never with a
 * total. Where the fact cannot be established for every element the helper returns
 * null/"" and the view prints an em-dash: a visible gap beats a plausible wrong number.
 *
 *   - deriveMethod names the CONTRACT's method, so it requires every period to carry the
 *     SAME non-empty basis. It used to return the FIRST period's basis, which let a
 *     mixed-basis plan (contract-legal: work_period.basis is per-ROW, there is no
 *     contract-level basis column) light the percent tracker, stamp a percent chip on the
 *     title and label the whole acceptance column "%".
 *   - cumMap prints a threshold ABOUT ONE PERIOD, so all of its preconditions are
 *     per-element: every row percent-basis, every row's own pct recorded (> 0), every
 *     row's seq a distinct non-negative ordinal. It previously had NO precondition at all
 *     — it summed whatever pct arrived, in whatever order `seq` happened to impose. The
 *     one Σ-shaped check left is the > 100 ceiling, and it disqualifies the WHOLE series
 *     uniformly rather than licensing any single row.
 *   - hasOrdinalSeq is the same discipline for the period ORDINAL every subcon screen
 *     prints ("งวด {seq}"): work_period.seq is `integer NOT NULL DEFAULT 0` with no
 *     unique(contract_id, seq) (packages/db/src/schema/subcon.ts — the only index is
 *     (contract_id, status)) and POST /subcon/contracts writes `seq: toNum(...) ?? 0`
 *     unvalidated, so an all-zero or duplicated plan is contract-legal. Array position is
 *     deliberately NOT used as a fallback: that would fabricate an ordinal.
 *
 * NOTE (B-277, deliberately NOT touched here): whether the percent tracker should show a
 * period's CUMULATIVE share or its OWN share is an open question awaiting Wei. cumMap's
 * reading is unchanged — this module only stops a wrong number from being printed; it does
 * not decide which right number to print.
 */
export { formatMoney, millionsValue } from "./subcon-rows";
/*
 * The period-ordinal predicate, shared with WOList rather than re-implemented: both
 * modules narrow the SAME `work_period` rows off the same column, so the guard has ONE
 * implementation (po-wo-rows.hasOrdinalSeq) and one place a future correction lands.
 */
export { hasOrdinalSeq } from "../po-wo/po-wo-rows";
import { hasOrdinalSeq } from "../po-wo/po-wo-rows";

/** A work period as the SubconAccept table consumes it (periodWire, narrowed). */
export interface PeriodRow {
  id: string;
  /** Owning subcon contract id (the periods query key + accept/reject anchor). */
  contractId: string;
  /** 1-based ordering within the contract (the prototype's period `no`). */
  seq: number;
  /** Basis enum: percent | distance | milestone | unit (drives the method chip). */
  basis: string;
  /** Basis-dependent target (percent: unused; distance/unit: quantity target). */
  target: number;
  /** Percent-complete / percent target of the period (the % method cell + cumMap). */
  pct: number;
  /** Period money in FULL currency units (the value cell + accepted KPI). */
  amount: number;
  /** ISO currency code carried with the money value. */
  currencyCode: string;
  /** Lifecycle status (pending|delivered|inspecting|passed|rejected|paid). */
  status: string;
  /**
   * Rejected-period defect text (periods-list enrichment, subcon.ts enrichPeriodRow
   * `defect`): the period's defect items joined to one line, or null when there are
   * none. REAL via META-1 (P2-BE-43); the view shows it only for a rejected period.
   */
  defect: string | null;
}

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
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
 * Narrow the enriched `defect` field to a single display string. enrichPeriodRow
 * (subcon.ts) sets `defect` to the rejected period's defect items as a string[] (one
 * entry per defect row), or null. The view shows them on one line, so present string
 * items are joined; an empty/absent value (or a plain string, defensively) collapses
 * to null so the view em-dashes rather than rendering an empty label.
 */
function defectText(v: unknown): string | null {
  if (Array.isArray(v)) {
    const items = v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
    return items.length ? items.join(", ") : null;
  }
  if (typeof v === "string" && v.trim() !== "") return v;
  return null;
}

/**
 * Narrow an opaque /subcon-contracts/{id}/periods Entity row to a PeriodRow.
 * Multi-word fields accept snake_case (server convention) or camelCase for
 * robustness (mirrors subcon-rows toContractRow). Missing fields default (0 / "" /
 * null). `defect` is the enriched rejected-period defect items (defectText).
 */
export function toPeriodRow(e: Record<string, unknown>): PeriodRow {
  return {
    id: str(e.id),
    contractId: str(e.contract_id ?? e.contractId),
    seq: num(e.seq),
    basis: str(e.basis),
    target: num(e.target),
    pct: num(e.pct),
    amount: num(e.amount),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    status: str(e.status),
    defect: defectText(e.defect),
  };
}

/* --------------------------------------------------------------------------- */
/* method derivation (no contract-level basis on the wire)                      */
/* --------------------------------------------------------------------------- */

/**
 * The contract's period method, DERIVED from the periods' basis (subcon-accept.jsx
 * SUBC_METHOD keyed on a contract-level `method` that the wire does not carry).
 *
 * The returned value is a claim about the WHOLE contract — it picks the title chip, gates
 * which progress tracker renders, labels the acceptance column and fills the handover
 * certificate's method row — so it is only made when EVERY period agrees. Returns "" (the
 * callers then withhold the chip / the tracker / the column label) when the plan is empty,
 * when any period's basis is missing, or when the periods disagree.
 *
 * This used to return the FIRST period's non-empty basis. `basis` is a per-ROW column
 * (packages/db/src/schema/subcon.ts work_period.basis) and there is no contract-level
 * basis anywhere in the schema or on the wire, so nothing stops a plan of
 * [percent, distance, milestone] from being persisted; the first-element form then lit the
 * percent tracker over it, stamped "% of contract" on the title and headed the acceptance
 * column "%" while the rows underneath printed metres. Per element, that plan withholds.
 */
export function deriveMethod(periods: readonly PeriodRow[]): string {
  if (periods.length === 0) return "";
  const first = periods[0].basis;
  if (!first) return "";
  return periods.every((p) => p.basis === first) ? first : "";
}

/* --------------------------------------------------------------------------- */
/* status -> badge/action mapping (PERIOD_STATE, subcon-accept.jsx L50-53)       */
/* --------------------------------------------------------------------------- */

/** Which acceptance badge a period's status renders (resolved to an i18n key in the view). */
export type PeriodBadge = "notReached" | "requested" | "accepted" | "rejected";
/** Which action control a period row shows in the acceptance column. */
export type PeriodAction = "none" | "accept" | "cert" | "reinspect";

export interface PeriodDisplay {
  /** Badge kind (view maps to statusNotReached/statusRequested/kpiAccepted/rejectBtn). */
  badge: PeriodBadge;
  /** StatusBadge tone key (ds.jsx STATUS): approved | pending | draft | rejected. */
  tone: "approved" | "pending" | "draft" | "rejected";
  /** Acceptance-column control: none (wait) | accept (open form) | cert | reinspect. */
  action: PeriodAction;
  /** Warn-soft row highlight — a period the contractor has delivered for review. */
  rowWarn: boolean;
}

/**
 * Map a work-period status to its badge/tone/action (the prototype's PERIOD_STATE
 * + the acceptance-column switch in subcon-accept2.jsx L94/103-108). The wire's 6
 * statuses collapse onto the prototype's 4 display states:
 *   delivered | inspecting -> "requested" (contractor asked for inspection; the
 *                             acceptance form opens; the row is warn-soft)
 *   passed | paid          -> "accepted"  (inspected pass; the acceptance certificate
 *                             is available — passed awaits payment, paid is done)
 *   rejected               -> "rejected"  (bounced back; the re-inspect control shows)
 *   pending | (unknown)    -> "notReached" (the period has not been delivered yet)
 */
export function mapPeriodStatus(status: string): PeriodDisplay {
  switch (status) {
    case "delivered":
    case "inspecting":
      return { badge: "requested", tone: "pending", action: "accept", rowWarn: true };
    case "passed":
    case "paid":
      return { badge: "accepted", tone: "approved", action: "cert", rowWarn: false };
    case "rejected":
      return { badge: "rejected", tone: "rejected", action: "reinspect", rowWarn: false };
    case "pending":
    default:
      return { badge: "notReached", tone: "draft", action: "none", rowWarn: false };
  }
}

/**
 * Status-badge tone (ds.jsx STATUS map, read by the inlined <StatusBadge>). bg/fg are
 * @juneflow/tokens var() references (rule 6); `dot` is the prototype-verbatim
 * STATUS.<status>.dot hex (no matching token, B-037(a)). Mirrors po-wo-rows.statusTone.
 */
export function statusTone(tone: PeriodDisplay["tone"]): { bg: string; fg: string; dot: string } {
  switch (tone) {
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

/* --------------------------------------------------------------------------- */
/* KPI aggregates (subcon-accept2.jsx SubconAccept L19-20/42-45) — all REAL      */
/* --------------------------------------------------------------------------- */

/** Statuses that count as an accepted (inspected-pass) period for the KPIs. */
const ACCEPTED_STATUSES = new Set(["passed", "paid"]);
/** Statuses that count as a period awaiting inspection (the "pending review" KPI). */
const PENDING_REVIEW_STATUSES = new Set(["delivered", "inspecting"]);

/**
 * The accepted (passed|paid) periods, in wire order — the rows the handover
 * certificate lists (subcon.handover, subcon-accept2.jsx SubconHandover L247). The
 * value KPI + accepted count + the certificate table body all derive from this one
 * predicate so they can never disagree.
 */
export function acceptedPeriods(periods: readonly PeriodRow[]): PeriodRow[] {
  return periods.filter((p) => ACCEPTED_STATUSES.has(p.status));
}

/** KPI-2 value — the summed amount of the accepted (passed|paid) periods (FULL units). */
export function acceptedValue(periods: readonly PeriodRow[]): number {
  return acceptedPeriods(periods).reduce((s, p) => s + p.amount, 0);
}

/** KPI-2 sub — how many periods are accepted (the "{n}/{count} periods" numerator). */
export function acceptedCount(periods: readonly PeriodRow[]): number {
  return acceptedPeriods(periods).length;
}

/** KPI-4 value — how many periods the contractor has delivered for inspection. */
export function pendingReviewCount(periods: readonly PeriodRow[]): number {
  return periods.filter((p) => PENDING_REVIEW_STATUSES.has(p.status)).length;
}

/**
 * KPI-3 value — the retention held back on the accepted work
 * (acceptedValue x retention_pct / 100, subcon-accept2.jsx L20 Math.round). Guards a
 * non-finite pct to 0 so the KPI never renders NaN.
 */
export function retentionHeld(acceptedVal: number, retentionPct: number): number {
  const pct = Number.isFinite(retentionPct) ? retentionPct : 0;
  return Math.round(acceptedVal * pct / 100);
}

/* --------------------------------------------------------------------------- */
/* cumulative % markers (percent-method tracker, subcon-accept2.jsx L17-18)       */
/* --------------------------------------------------------------------------- */

/** One cumulative-percent marker: the period seq + its running % total. */
export interface CumPoint {
  seq: number;
  cum: number;
}

/**
 * Cumulative percent target per period (the percent-method tracker's division markers,
 * subcon-accept2.jsx L17-18 cumMap). periods[].pct summed in seq order — the PLAN target,
 * NOT the project's actual progress (that external feed is not on the wire; the view never
 * fabricates it). The cumulative reading itself is unchanged and is NOT the open question:
 * B-277 (awaiting Wei) asks whether the marker should be the cumulative or the own share.
 *
 * Every marker is a claim about ONE period ("period {seq} completes {cum}% of the
 * contract"), so EVERY precondition it rests on is checked PER ELEMENT (.every), never as
 * a total and never off the first row. Returns null — the view then draws no markers and
 * em-dashes the legend that describes them — when:
 *   - the plan is empty;
 *   - `seq` is not a usable ordinal (hasOrdinalSeq). The whole series is ordered by `seq`
 *     and each marker is keyed + labelled by it, so a defaulted all-zero plan (the schema
 *     default, no unique constraint, unvalidated on POST) would emit N markers that all
 *     claim to be "period 0" in arrival order, and a duplicated seq double-counts;
 *   - the plan is not ENTIRELY percent-basis. `pct` only carries a contract share for the
 *     percent basis (milestone uses the fixed amount, distance/unit use
 *     perPeriodQty x ratePerUnit and leave pct 0), so a mixed plan's running total would
 *     silently add two different populations — and the render gate that used to admit this
 *     function (deriveMethod on the FIRST period) could not see it;
 *   - ANY single percent period has no share recorded (pct <= 0). A Σ-shaped gate
 *     ("Σpct > 0") is the trap one relocation over: pct is `numeric(6,3) NOT NULL
 *     DEFAULT '0'` written unvalidated, so a plan of 30 / 0 / 40 is contract-legal — the Σ
 *     gate passes it and period 2's marker lands byte-identically on period 1's line while
 *     nothing about period 2's own share is known. Per element, that plan withholds whole.
 *     (It subsumes an all-zero plan too.)
 *   - the plan's shares total MORE than the whole contract. That is deliberately the one
 *     Σ-shaped test left, and it is legitimate because it gates a Σ-shaped fact and
 *     disqualifies the entire series uniformly — it never licenses a single row. (It also
 *     stops a marker being positioned at left: 140% and silently clipped by the bar's
 *     overflow:hidden, i.e. a period whose line is simply absent from a full-looking bar.)
 *     A plan totalling LESS than 100 is NOT rejected: an incomplete plan's cumulative is
 *     still that period's true share of the contract.
 */
export function cumMap(periods: readonly PeriodRow[]): CumPoint[] | null {
  if (periods.length === 0) return null;
  if (!hasOrdinalSeq(periods)) return null;
  if (!periods.every((p) => p.basis === "percent")) return null;
  if (!periods.every((p) => p.pct > 0)) return null;
  // pct is numeric(6,3); summing floats can leave 30.000000000000004 — the column's own
  // precision is the honest ceiling for every figure derived from it (mirrors po-wo-rows).
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  if (round3(periods.reduce((s, p) => s + p.pct, 0)) > 100) return null;
  let cum = 0;
  return [...periods]
    .sort((a, b) => a.seq - b.seq)
    .map((p) => {
      cum += p.pct;
      return { seq: p.seq, cum: round3(cum) };
    });
}

/*
 * PO + WO list-row helpers for POList / WOList (P2-WEB-10) — pure, i18n-free,
 * ASCII-only logic derived from pototype/po-wo.jsx (POList L12-205 · WOList
 * L280-431) + the ds.jsx STATUS map (L83-90) the prototype's <StatusBadge> reads.
 *
 * The prototype held both catalogues in local arrays (po-wo.jsx PO_ROWS L3-10 /
 * WO_ROWS L272-278) whose rows carried denormalised display strings + hardcoded
 * money. §0 rule 3: those mocks are dropped — each list is the real server
 * catalogue (GET /po · GET /wo, use-po-wo.ts) whose doc wires are:
 *   po:  { id, no, pr_id, vendor_id, status, approval_step, currency_code,
 *          credit_term, total, vat, amount, doc_date, paid?, deposit? }
 *                                              (apps/api/src/routes/po.ts poWire)
 *   wo:  { id, no, pr_id, vendor_id, contract_id, status, approval_step,
 *          currency_code, value, retention_pct, retention_amount, amount,
 *          scope, progress, installments[] }    (wo.ts woWire — the exact key set
 *          is pinned by the api's own assertion, wo.test.ts "returns the envelope
 *          with retention_amount + scope/progress/installments (F3)")
 * The prototype's vendor / subcon NAME resolves from vendor_id via GET /vendors;
 * the refPR number resolves from pr_id via GET /pr; the PO detail project name
 * resolves pr_id -> pr.project_id -> GET /projects (§0 rule 3, FK-as-string ->
 * real id join, mirrors boq-rows projectNameById). Retention is a REAL derived
 * column (value x retention_pct / 100, exposed as retention_amount).
 *
 * B-277 — the WO doc wire GREW (migration 0020 / B-080 F3) and this module's gap
 * list had gone stale: `scope` (= the source PR's title), the SERVER-derived
 * `progress`, `contract_id` and the `installments[]` (work_period rows) have been
 * on GET /wo since F3 while WOList still em-dashed all four. They are wired now.
 *
 * POPULATION DISCIPLINE for everything derived here (the gr.list class of defect).
 * THE RULE, in one line: a SUM may only license a claim about the SUM. The moment a
 * rendered string says something about ONE installment, every precondition that string
 * depends on has to hold for THAT installment — checked with .every()/per-row, never
 * with a total. Where it cannot be established per element, the helper returns null and
 * the view prints an em-dash: a visible gap beats a plausible wrong number.
 *
 *   - `progress` is SERVER-computed as SUM(done installment amount) /
 *     SUM(all installment amount) over ONE WO's own plan — numerator is a subset of
 *     the denominator's rows, same column. It is consumed verbatim, never recomputed
 *     and never combined with a header-level figure. null = the server says "not
 *     computable" (no plan) -> the view em-dashes and drops the bar.
 *   - progress === 100 means the plan's AMOUNTS balance. It does NOT mean every
 *     installment individually passed, and it is NEVER used as a closed/complete signal
 *     (the "SUM a >= SUM b does not imply each a >= its own b" trap).
 *   - cumulativeContractPct prints a threshold ABOUT ONE INSTALLMENT, so all three of its
 *     preconditions are per-element (.every): every row percent-basis, every row's own
 *     `pct` recorded (> 0), every row's `seq` a distinct non-negative ordinal. A Σ-shaped
 *     guard here (the old "Σpct > 0") passes a plan whose middle row has an unrecorded
 *     share and reprints the previous row's threshold as that row's — see the function's
 *     own doc block. The one Σ check left is the > 100 ceiling, and it disqualifies the
 *     WHOLE series uniformly rather than licensing any single row.
 *   - hasOrdinalSeq is the same discipline for the row LABEL: work_period.seq is
 *     `integer NOT NULL DEFAULT 0` with no unique(contract_id, seq), so "seq 0 = the
 *     down-payment row / seq n = installment n" is only true when the SERVED plan
 *     actually carries distinct ordinals. When it does not, the view withholds the label
 *     instead of stamping every row DP.
 *   - dueInstallmentCount aggregates the INSTALLMENT population across WOs and so
 *     de-duplicates by installment id: wo.contract_id has no unique constraint, so
 *     two WOs may point at the SAME subcon contract and the list handler then hands
 *     both the very same work_period rows. woTabCount("installment") counts the
 *     WO/HEADER population instead — the two numbers are deliberately different and
 *     must never be substituted for one another.
 *   - Both of those installment aggregates run over EVERY served WO regardless of the
 *     WO's own `status`, unlike their status-partitioned neighbours (kpiPending /
 *     kpiActive / the pending + active tabs). Deliberate: an installment belongs to the
 *     subcon CONTRACT, not to the WO doc, so a delivered period is awaiting our
 *     acceptance whether or not the WO that happens to reference it is still draft or was
 *     rejected. Filtering by WO status would UNDER-count real due installments and —
 *     because contract_id is not unique — would drop or keep the same installment
 *     depending on which WO happened to reference it. Pinned by tests in both suites.
 *   - sumRetention likewise sums retention_amount over every served WO. It is a Σ
 *     rendered as a Σ, but the KPI's "outstanding" qualifier is an approximation on two
 *     counts (no retention-RETURN tracking on the wire, and draft/rejected WOs are
 *     included) — stated here rather than silently narrowed.
 *
 * WIRE GAPS THAT REMAIN (reported, never fabricated — see the POList/WOList headers
 * for the full list): wo carries NO deposit/down-payment column, NO closed status,
 * NO variation figure, NO attachment count and NO per-installment label; po carries
 * NO line-item table and NO GR-receive % (po.ts GAP 1). The view renders an em-dash
 * there; this module never invents values for them.
 *
 * NOT FIXED HERE (same defect shape, different screen — reported under B-277 for the
 * orchestrator to allocate): poWire's LIST path now also emits `doc_date` and, via
 * sumBillings, `paid` + `deposit` (po.ts app.get("/po") L179), which POList still
 * em-dashes. Touching po-list.tsx would move a second G5 baseline, so it is left to
 * its own slice.
 */

/** A PO doc as the table consumes it (GET /po row, narrowed from the opaque wire). */
export interface PoRow {
  id: string;
  no: string;
  /** Source approved-PR id (the PO's only tenant anchor; resolves to the ref PR no). */
  prId: string;
  /** Supplier id (resolved to a vendor name via GET /vendors in the view). */
  vendorId: string;
  /** Lifecycle status — "draft" | "pending" | "approved" | "rejected" (po_status). */
  status: string;
  approvalStep: number;
  /** Payment credit-term in days (0 when unset). */
  creditTerm: number;
  vat: number;
  /** Doc total in FULL currency units (server stored total = source-PR line sum). */
  total: number;
}

/**
 * One installment of a WO's plan (a work_period row, wo.ts installmentWire).
 * NOTE: work_period has no label/description column, so the view composes the installment
 * caption from `seq` — it never invents the prototype's descriptive text.
 */
export interface WoInstallment {
  id: string;
  /** 1-based installment order (0 = the down-payment row, subcon convention). */
  seq: number;
  /** Billing basis — "percent" | "distance" | "milestone" | "unit" (work_period_basis). */
  basis: string;
  /** Basis-dependent target quantity (distance/unit plans); 0 for percent/milestone. */
  target: number;
  /**
   * This period's OWN share of the contract value as a percentage. Meaningful for
   * the "percent" basis only (subcon.ts computeGross: percent -> pct/100 x value);
   * milestone/distance/unit plans leave it at 0.
   */
  pct: number;
  /** The period's contract amount in FULL units (server column — money = SERVER). */
  amount: number;
  /** "pending" | "delivered" | "inspecting" | "passed" | "rejected" | "paid". */
  status: string;
}

/** A WO doc as the table consumes it (GET /wo row, narrowed from the opaque wire). */
export interface WoRow {
  id: string;
  no: string;
  prId: string;
  /** Subcontractor id (resolved to a vendor name via GET /vendors in the view). */
  vendorId: string;
  /**
   * Linked subcon_contract id — the anchor of the installment plan (B-080 / F3).
   * "" when this WO has no contract, which is what distinguishes "no plan known"
   * from "a plan that happens to be empty".
   */
  contractId: string;
  /** Lifecycle status — "draft" | "pending" | "approved" | "rejected" (wo_status). */
  status: string;
  approvalStep: number;
  /** Contract value in FULL currency units (= amount). */
  value: number;
  /** Retention hold-back rate as a percentage (e.g. 10 = 10%). */
  retentionPct: number;
  /** Held-back retention in FULL units (server-derived value x retention_pct / 100). */
  retentionAmount: number;
  /** lump-sum subcon work scope = the source PR's title (wo/subcon carry no scope column); "" when absent. */
  scope: string;
  /**
   * SERVER-derived completion percent (0-100 int) of this WO's own plan:
   * SUM(passed|paid installment amount) / SUM(all installment amount). null when the
   * server says it is not computable (no plan). Consumed verbatim — NEVER recomputed
   * here, never mixed with a header-level figure, never read as "the WO is closed".
   */
  progress: number | null;
  /** The installment plan (work_period rows), seq-ascending; [] when there is no plan. */
  installments: WoInstallment[];
}

/** An approved-PR option (create-form picker + refPR / project resolver). */
export interface PrRef {
  id: string;
  no: string;
  /** Owning project id (the PO detail resolves this -> a project name). */
  projectId: string;
  /** PR lifecycle status — only "approved" PRs may raise a PO/WO. */
  status: string;
  /** PR total in FULL units (create-form picker sub-line). */
  amount: number;
}

/** A vendor option (id -> display name for the list + create pickers). */
export interface VendorRef {
  id: string;
  name: string;
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
 * Narrow an opaque /po Entity row to the PoRow the table needs. Multi-word fields
 * accept snake_case (server convention) or camelCase for robustness (mirrors
 * gr-rows toGrRow). `amount` falls back to `total`. Missing fields default (0 / "").
 */
export function toPoRow(e: Record<string, unknown>): PoRow {
  return {
    id: str(e.id),
    no: str(e.no),
    prId: str(e.pr_id ?? e.prId),
    vendorId: str(e.vendor_id ?? e.vendorId),
    status: str(e.status),
    approvalStep: num(e.approval_step ?? e.approvalStep),
    creditTerm: num(e.credit_term ?? e.creditTerm),
    vat: num(e.vat),
    total: num(e.total ?? e.amount),
  };
}

/** Narrow one opaque installment (work_period) row of a /wo doc's plan. */
export function toWoInstallment(e: Record<string, unknown>): WoInstallment {
  return {
    id: str(e.id),
    seq: num(e.seq),
    basis: str(e.basis),
    target: num(e.target),
    pct: num(e.pct),
    amount: num(e.amount),
    status: str(e.status),
  };
}

/**
 * Narrow an opaque /wo Entity row to the WoRow the table needs. `progress` is
 * nullable ON PURPOSE: the server sends null for "no plan, not computable" and 0 for
 * "a plan on which nothing is done yet", so it is read with an explicit null check
 * rather than num() (which would flatten null to a fabricated 0%).
 */
export function toWoRow(e: Record<string, unknown>): WoRow {
  // `progress` / `installments` / `scope` are single words — the wire has no
  // camelCase variant of them to fall back to (unlike pr_id / retention_pct).
  const rawProgress = e.progress;
  const rawPlan = e.installments;
  return {
    id: str(e.id),
    no: str(e.no),
    prId: str(e.pr_id ?? e.prId),
    vendorId: str(e.vendor_id ?? e.vendorId),
    contractId: str(e.contract_id ?? e.contractId ?? ""),
    status: str(e.status),
    approvalStep: num(e.approval_step ?? e.approvalStep),
    value: num(e.value ?? e.amount),
    retentionPct: num(e.retention_pct ?? e.retentionPct),
    retentionAmount: num(e.retention_amount ?? e.retentionAmount),
    scope: str(e.scope ?? ""),
    progress: rawProgress == null ? null : num(rawProgress),
    installments: Array.isArray(rawPlan)
      ? sortInstallments(
          (rawPlan as unknown[])
            .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
            .map(toWoInstallment),
        )
      : [],
  };
}

/** Narrow an opaque /pr Entity row to a PrRef (create picker + ref/project resolver). */
export function toPrRef(e: Record<string, unknown>): PrRef {
  return {
    id: str(e.id),
    no: str(e.no),
    projectId: str(e.project_id ?? e.projectId),
    status: str(e.status),
    amount: num(e.amount ?? e.total),
  };
}

/** Narrow an opaque /vendors Entity row to a VendorRef (id -> name). */
export function toVendorRef(e: Record<string, unknown>): VendorRef {
  return { id: str(e.id), name: str(e.name) };
}

/**
 * Status-badge tone (ds.jsx STATUS map, L83-90, read by <StatusBadge status={..}>).
 * bg/fg are @juneflow/tokens var() references (rule 6); `dot` is the
 * prototype-verbatim STATUS.<status>.dot hex (no matching @juneflow/tokens value,
 * B-037(a)). Unknown statuses fall back to draft, exactly like the prototype's
 * `STATUS[status] || STATUS.draft`.
 */
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
/* PO tab partition (po-wo.jsx POList TabBar L42-49)                            */
/* --------------------------------------------------------------------------- */

/** The six POList tabs (po-wo.jsx L43-48). */
export type PoTab = "all" | "pending" | "open" | "deposit" | "wait" | "closed";

/**
 * Filter the POs for a tab. The prototype's tab counts are a mock; production
 * partitions the real rows honestly by status:
 *   all      -> every PO
 *   pending  -> a PO awaiting approval (status "pending")
 *   open     -> an approved (open) PO (status "approved")
 *   deposit  -> deposit-due: no deposit column on the wire (po.ts GAP 2) -> empty
 *   wait     -> awaiting-GR: no GR% column on the po wire -> empty
 *   closed   -> closed: no "closed" status on the wire -> empty
 */
export function filterPoByTab(rows: readonly PoRow[], tab: PoTab): PoRow[] {
  switch (tab) {
    case "all":
      return [...rows];
    case "pending":
      return rows.filter((r) => r.status === "pending");
    case "open":
      return rows.filter((r) => r.status === "approved");
    case "deposit":
    case "wait":
    case "closed":
      return [];
  }
}

/** C10 PO tab badge count — the real length of the tab's filtered set. */
export function poTabCount(rows: readonly PoRow[], tab: PoTab): number {
  return filterPoByTab(rows, tab).length;
}

/* --------------------------------------------------------------------------- */
/* WO tab partition (po-wo.jsx WOList TabBar L305-311)                          */
/* --------------------------------------------------------------------------- */

/** The five WOList tabs (po-wo.jsx L306-310). */
export type WoTab = "all" | "pending" | "active" | "installment" | "closed";

/**
 * Filter the WOs for a tab, partitioned honestly by status:
 *   all          -> every WO
 *   pending      -> awaiting approval (status "pending")
 *   active       -> active: an approved (running) WO (status "approved")
 *   installment  -> approve-installment: WOs with >= 1 installment awaiting acceptance
 *                   (B-277 — this counts the WO/HEADER population; the KPI counts
 *                   the INSTALLMENT/LINE population, see dueInstallmentCount). Unlike
 *                   its two status-partitioned neighbours this tab is a PREDICATE, not a
 *                   status slice: a draft or rejected WO whose contract has a delivered
 *                   period does appear here, because that period is genuinely awaiting
 *                   our acceptance (module header, population-discipline block).
 *   closed       -> closed-contract: no "closed" status on the wire -> empty
 */
export function filterWoByTab(rows: readonly WoRow[], tab: WoTab): WoRow[] {
  switch (tab) {
    case "all":
      return [...rows];
    case "pending":
      return rows.filter((r) => r.status === "pending");
    case "active":
      return rows.filter((r) => r.status === "approved");
    case "installment":
      return rows.filter(hasAwaitingInstallment);
    case "closed":
      return [];
  }
}

/** C10 WO tab badge count — the real length of the tab's filtered set. */
export function woTabCount(rows: readonly WoRow[], tab: WoTab): number {
  return filterWoByTab(rows, tab).length;
}

/** Count docs whose status equals `status` (KPI aggregates, C10). */
export function countByStatus(
  rows: readonly { status: string }[],
  status: string,
): number {
  return rows.filter((r) => r.status === status).length;
}

/** Sum the WOs' held-back retention (WO KPI "Retention outstanding", real-derived). */
export function sumRetention(rows: readonly WoRow[]): number {
  return rows.reduce((s, r) => s + r.retentionAmount, 0);
}

/* --------------------------------------------------------------------------- */
/* Installment plan (B-277 — wo.ts installmentWire / work_period)         */
/* --------------------------------------------------------------------------- */

/**
 * work_period statuses that mean "the subcon has handed this installment over and it is
 * waiting on us" — i.e. the installments the prototype's the "approve-installment" tab / the "due
 * installments / must-approve-installment" KPI is about. Same pair the accept screen already
 * treats as pending-review (subcon-accept-rows PENDING_REVIEW_STATUSES).
 */
const AWAITING_ACCEPTANCE: ReadonlySet<string> = new Set(["delivered", "inspecting"]);

/** work_period statuses that mean the installment is finished (wo.ts isPeriodDone). */
const PERIOD_DONE: ReadonlySet<string> = new Set(["passed", "paid"]);

/** The plan in seq order (the server already sorts; re-sorted so callers cannot depend on that). */
export function sortInstallments(
  installments: readonly WoInstallment[],
): WoInstallment[] {
  return [...installments].sort((a, b) => a.seq - b.seq);
}

/** True when this installment is handed over and awaiting our acceptance/approval. */
export function isAwaitingAcceptance(status: string): boolean {
  return AWAITING_ACCEPTANCE.has(status);
}

/** True when this WO has at least one installment awaiting acceptance (the tab predicate). */
export function hasAwaitingInstallment(row: WoRow): boolean {
  return row.installments.some((p) => isAwaitingAcceptance(p.status));
}

/**
 * Which of the prototype's THREE installment visual states a real work_period status
 * renders as (po-wo.jsx L381-387 draws exactly done / current / pending).
 *   passed | paid            -> "done"     (wo.ts isPeriodDone — the same pair the
 *                                           server's `progress` numerator uses)
 *   delivered | inspecting   -> "current"  (handed over, waiting on us)
 *   pending | rejected | ... -> "pending"  (not done)
 * B-277 CAVEAT (flagged, not fabricated): the wire's 6-value work_period_status
 * collapses onto 3 prototype states, so a REJECTED installment renders with the neutral
 * not-done styling — truthful (it is not done) but it loses the "sent back" nuance,
 * and inventing a 4th colour would be redesigning a screen the prototype fixes.
 */
export function installmentDisplayKind(
  status: string,
): "done" | "current" | "pending" {
  if (PERIOD_DONE.has(status)) return "done";
  if (AWAITING_ACCEPTANCE.has(status)) return "current";
  return "pending";
}

/**
 * KPI the "due installments" — how many installments across the tenant's WOs await acceptance.
 *
 * POPULATION NOTE (B-277): this aggregates the LINE population over many headers, so
 * it de-duplicates by installment id. wo.contract_id carries no unique constraint, so
 * two WOs may reference the SAME subcon_contract and GET /wo then hands both the very
 * same work_period rows (wo.ts periodsByContract) — summing per WO would count one
 * real installment twice. This is NOT interchangeable with woTabCount(rows, "installment"),
 * which counts WOs.
 *
 * The `p.id` test cannot silently shrink the figure: `id` is work_period's uuid PRIMARY
 * KEY and wo.ts installmentWire emits it unconditionally, so it is a defensive narrowing
 * guard on the opaque row, not a filter a served installment can fall through.
 *
 * Runs over every served WO regardless of that WO's own status — see the module header's
 * population-discipline block for why that is the honest population for an installment.
 */
export function dueInstallmentCount(rows: readonly WoRow[]): number {
  const seen = new Set<string>();
  for (const r of rows) {
    for (const p of r.installments) {
      if (p.id && isAwaitingAcceptance(p.status)) seen.add(p.id);
    }
  }
  return seen.size;
}

/**
 * Is this plan's `seq` column usable as the ordinal both of its renders read it as?
 *
 * `work_period.seq` is `integer NOT NULL DEFAULT 0` (packages/db/src/schema/subcon.ts)
 * with NO unique(contract_id, seq) — the index list is (contract_id, status) only — and
 * POST /subcon/contracts writes `seq: toNum(pick(p, "seq")) ?? 0` with no validation
 * (apps/api/src/routes/subcon.ts). So a client that omits `seq` persists a plan whose
 * every row is seq 0, and duplicate seqs are contract-legal.
 *
 * Two renders read `seq` as an ordinal and are wrong the moment it is not one:
 *   - cumulativeContractPct's `seq <= seq` prefix — on an all-zero plan every row selects
 *     the WHOLE plan, so every installment claims 100% of the contract; duplicates
 *     double-count.
 *   - the row label — `seq === 0` means "the down-payment row" (subcon convention), so an
 *     all-zero plan labels every installment DP.
 * Both are per-element claims, so the precondition is checked per element: every seq a
 * non-negative integer, and all of them distinct. False -> the callers withhold.
 */
export function hasOrdinalSeq(installments: readonly WoInstallment[]): boolean {
  if (installments.length === 0) return false;
  if (!installments.every((p) => Number.isInteger(p.seq) && p.seq >= 0)) return false;
  return new Set(installments.map((p) => p.seq)).size === installments.length;
}

/**
 * The installment's the atContractPct template ("at {pct}% of the contract") threshold (wo.list.atContractPct) — the CUMULATIVE
 * share of the contract reached once this installment is delivered, i.e. SUM(pct) over every
 * installments with seq <= this one. That cumulative reading is the server's own (subcon.ts
 * progressWarning: "cumTarget = Sum pct of periods with seq <= this seq") and the
 * prototype's (subcon.progressLegend: "the cumulative % of each installment; claimable once the project % reaches the threshold").
 *
 * The rendered string is a claim about ONE installment, so EVERY precondition it rests on
 * is checked PER ELEMENT (.every), never as a total. Returns null — the view then
 * em-dashes the line rather than printing a plausible wrong number — when:
 *   - the plan is empty;
 *   - `seq` is not a usable ordinal (hasOrdinalSeq: defaulted / duplicated / negative seqs
 *     make the `seq <= seq` prefix select the wrong rows);
 *   - the plan is not ENTIRELY percent-basis. `pct` only carries a contract share
 *     for the percent basis (schema: milestone uses the fixed amount, distance/unit
 *     use perPeriodQty x ratePerUnit and leave pct 0), so a mixed plan's cumulative
 *     would silently omit the non-percent installments — two different populations added up;
 *   - ANY single percent installment has no share recorded (pct <= 0). This guard used to be
 *     a SUM ("Σpct > 0") and that was the same Σ-then-assert trap one relocation over: pct
 *     is `numeric(6,3) NOT NULL DEFAULT '0'` and POST /subcon/contracts writes
 *     `pct: String(toNum(pick(p, "pct")) ?? 0)` with neither a per-period > 0 nor a Σ = 100
 *     check, so a plan of pct 30 / 0 / 40 is contract-legal — the Σ gate passed it and
 *     installment 2 printed installment 1's threshold (30) byte-identically while nothing
 *     about installment 2's own share was known. Per-element, that plan em-dashes whole.
 *     (It subsumes the old Σ > 0 check: an all-zero plan fails it too.)
 *   - the plan's shares total MORE than the whole contract. That is deliberately the one
 *     Σ-shaped test left, and it is legitimate because it gates a Σ-shaped fact and
 *     disqualifies the entire series uniformly — it never licenses a single row. A plan
 *     totalling LESS than 100 is NOT rejected: an incomplete plan's cumulative is still
 *     that installment's true share of the contract.
 */
export function cumulativeContractPct(
  installments: readonly WoInstallment[],
  seq: number,
): number | null {
  if (installments.length === 0) return null;
  if (!hasOrdinalSeq(installments)) return null;
  if (!installments.every((p) => p.basis === "percent")) return null;
  if (!installments.every((p) => p.pct > 0)) return null;
  // pct is numeric(6,3); summing floats can leave 30.000000000000004 — the column's
  // own precision is the honest ceiling for every figure derived from it.
  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  if (round3(installments.reduce((s, p) => s + p.pct, 0)) > 100) return null;
  return round3(
    installments.filter((p) => p.seq <= seq).reduce((s, p) => s + p.pct, 0),
  );
}

/* --------------------------------------------------------------------------- */
/* id -> display resolvers (real FK joins, never a raw UUID leak)              */
/* --------------------------------------------------------------------------- */

/** Build an id -> vendor-name map from VendorRefs (list + create pickers). */
export function vendorNameById(vendors: readonly VendorRef[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const v of vendors ?? []) if (v.id) map.set(v.id, v.name);
  return map;
}

/** Build a pr id -> pr-no map from PrRefs (refPR column resolver). */
export function prNoById(prs: readonly PrRef[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of prs ?? []) if (p.id) map.set(p.id, p.no);
  return map;
}

/** Build a pr id -> owning project id map (PO detail project-name resolution). */
export function prProjectIdById(prs: readonly PrRef[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of prs ?? []) if (p.id) map.set(p.id, p.projectId);
  return map;
}

/** Build an id -> name map from /projects rows (PO detail project column). */
export function projectNameById(
  projects: readonly { id: string; name: string }[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of projects ?? []) if (p.id) map.set(p.id, p.name);
  return map;
}

/**
 * Resolve a PO's project name through the 2-hop chain pr_id -> pr.projectId ->
 * project.name. Returns "" (never a UUID) when any hop is missing from the fetched
 * pages — the view then renders an em-dash.
 */
export function resolvePoProjectName(
  prId: string,
  prProjectIds: Map<string, string>,
  projectNames: Map<string, string>,
): string {
  const projectId = prProjectIds.get(prId);
  if (!projectId) return "";
  return projectNames.get(projectId) ?? "";
}

/** Only approved PRs may raise a PO/WO (POST /po|/wo 409s otherwise) — the picker set. */
export function approvedPrs(prs: readonly PrRef[] | undefined): PrRef[] {
  return (prs ?? []).filter((p) => p.status === "approved");
}

/**
 * Group a FULL-unit amount with thousands separators ("902475" -> "902,475"),
 * matching the prototype's Intl fmt (ds.jsx:4-5, th-TH maximumFractionDigits 0).
 * ASCII digits + comma only; NaN / non-finite -> "0". Mirrors gr-rows formatMoney.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** KPI "value in millions" ((total/1e6).toFixed(2)), mirrors boq-rows millionsValue. */
export function millionsValue(totalUnits: number): string {
  return (totalUnits / 1e6).toFixed(2);
}

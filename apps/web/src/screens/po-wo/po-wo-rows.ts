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
 *          credit_term, total, vat, amount }   (apps/api/src/routes/po.ts poWire)
 *   wo:  { id, no, pr_id, vendor_id, status, approval_step, currency_code,
 *          value, retention_pct, retention_amount, amount }  (wo.ts woWire)
 * The prototype's vendor / subcon NAME resolves from vendor_id via GET /vendors;
 * the refPR number resolves from pr_id via GET /pr; the PO detail project name
 * resolves pr_id -> pr.project_id -> GET /projects (§0 rule 3, FK-as-string ->
 * real id join, mirrors boq-rows projectNameById). Retention is a REAL derived
 * column (value x retention_pct / 100, exposed as retention_amount).
 *
 * WIRE GAPS (reported, never fabricated — see the POList/WOList headers for the
 * full list). po/wo carry NO deposit/down-payment/paid columns, NO GR%/progress
 * column, NO closed status, NO document date, and (po) NO line-item table / (wo)
 * NO installment table or scope column (po.ts GAP 1-2 · wo.ts GAP 1). So the
 * prototype's deposit / paid / receive-% / progress / scope / date cells and
 * the payment-schedule / installment panels have no wire source — the view renders an
 * em-dash there; this module never invents values for them.
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

/** A WO doc as the table consumes it (GET /wo row, narrowed from the opaque wire). */
export interface WoRow {
  id: string;
  no: string;
  prId: string;
  /** Subcontractor id (resolved to a vendor name via GET /vendors in the view). */
  vendorId: string;
  /** Lifecycle status — "draft" | "pending" | "approved" | "rejected" (wo_status). */
  status: string;
  approvalStep: number;
  /** Contract value in FULL currency units (= amount). */
  value: number;
  /** Retention hold-back rate as a percentage (e.g. 10 = 10%). */
  retentionPct: number;
  /** Held-back retention in FULL units (server-derived value x retention_pct / 100). */
  retentionAmount: number;
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

/** Narrow an opaque /wo Entity row to the WoRow the table needs. */
export function toWoRow(e: Record<string, unknown>): WoRow {
  return {
    id: str(e.id),
    no: str(e.no),
    prId: str(e.pr_id ?? e.prId),
    vendorId: str(e.vendor_id ?? e.vendorId),
    status: str(e.status),
    approvalStep: num(e.approval_step ?? e.approvalStep),
    value: num(e.value ?? e.amount),
    retentionPct: num(e.retention_pct ?? e.retentionPct),
    retentionAmount: num(e.retention_amount ?? e.retentionAmount),
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
 *   installment  -> approve-installment: no installment table on the wire (wo.ts GAP 1) -> empty
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

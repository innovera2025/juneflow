/*
 * PM Work-Order list/detail helpers for PMWorkOrders (pm.wo) — pure, i18n-free,
 * ASCII-only logic derived from pototype/pm3.jsx PMWorkOrders (L39-110) +
 * PMWorkOrderDetail (L111-259) + PMWOForm (L279-319).
 *
 * The prototype held its catalogue in the local PM_WOS mock (pm.jsx L47-54) whose
 * rows carried denormalised display strings (assetName / site / contract-code / a
 * per-row `status` / `sla` / `date` / `type` / human `no`). PLAN.md section 0
 * rule 3: that mock is dropped — the list is the real server catalogue
 * (GET /pm/workorders, use-pm.ts) whose opaque Entity wire is only:
 *   { id, asset_id, template_id, tech, checkin_gps, items[{label,result}],
 *     cause, fix, advice, customer_sign }        (apps/api/src/routes/pm.ts
 *   workOrderWire — pm_workorder models only these real columns).
 *
 * TWO WEB DERIVATIONS (rule 3/4, all pure here):
 *  1. ASSET/CONTRACT JOIN. The wire has no display asset name/site/schedule/SLA —
 *     they resolve through GET /pm/assets (id -> {name,code,site,next_due,
 *     contract_id}) and then asset.contract_id -> GET /pm/contracts (id -> {sla}).
 *     A missing join hop yields "" so the VIEW renders an em-dash (never fabricated,
 *     never a raw uuid).
 *  2. STATUS DERIVATION (deriveStatus, from REAL columns only, FLAG for Wei):
 *       customer_sign set                          -> "done"
 *       else checkin_gps set OR any item result set -> "inprogress"
 *       else asset.next_due < today                 -> "overdue"
 *       else                                        -> "open"
 *     This drives the five list tabs (all/open/inprogress/overdue/done) + the
 *     StatusBadge. It is a real-column interpretation of the mock's stored `status`,
 *     flagged for a Wei override.
 *
 * HONEST GAPS (never fabricated — see wo-list.tsx / wo-detail.tsx headers):
 *   - human WO number: pm_workorder has NO wo_no column (id is a uuid) -> the view
 *     renders an em-dash, never the raw uuid (DEFAULT 4).
 *   - type (PM/CM): no type column -> em-dash (DEFAULT 5).
 *   - contract ref: pm_contract has NO human code/no column -> em-dash (like
 *     pm-assets colContract); only the contract's SLA rides the join.
 *
 * ASCII-only (mirrors pm-rows.ts / pm-dashboard-rows.ts, B-073): no Thai literal
 * lives here; every label + the em-dash are the view's (wo-list/wo-detail).
 */

/** The four stored checklist result states. "" is the mock's unfilled state (the
 *  wire omits `result` for an unchecked row — pm.ts CHECKLIST_RESULTS), so "" is
 *  the not-yet-checked value here (never a stored enum). */
export type ChecklistResult = "" | "normal" | "adjust" | "repair";

/** The result-cycle order the tech taps through (pm3.jsx RESULT_OPTS, "none"=""). */
const RESULT_CYCLE: readonly ChecklistResult[] = ["", "normal", "adjust", "repair"];

/** Next result in the tap cycle (wraps repair -> ""); mirrors pm3.jsx nextResult. */
export function cycleResult(result: ChecklistResult): ChecklistResult {
  const i = RESULT_CYCLE.indexOf(result);
  return RESULT_CYCLE[(i < 0 ? 0 : i + 1) % RESULT_CYCLE.length]!;
}

/** One checklist line the detail fills (label captured at create, result tapped). */
export interface ChecklistItem {
  label: string;
  result: ChecklistResult;
}

/** Derived WO lifecycle (mock `status`, re-derived from real columns — FLAG). */
export type WoStatus = "open" | "inprogress" | "overdue" | "done";

/** The five list tabs (pm3.jsx L72; "all" is every WO, the rest are by status). */
export type WoTab = "all" | "open" | "inprogress" | "overdue" | "done";

/** A PM work order narrowed straight from its wire (before the asset/contract join). */
export interface WoRaw {
  id: string;
  assetId: string;
  templateId: string;
  tech: string;
  /** Recorded GPS fix ("lat,lng") — "" until the tech checks in. */
  checkinGps: string;
  items: ChecklistItem[];
  cause: string;
  fix: string;
  advice: string;
  /** Customer signature string — "" until close records one. Drives "done". */
  customerSign: string;
}

/** A PM asset as the WO join reads it (GET /pm/assets row, migration 0034 name/code). */
export interface WoAssetRef {
  id: string;
  name: string;
  code: string;
  site: string;
  /** Next-due date, ISO "YYYY-MM-DD" (or "") — the WO's "due" + overdue signal. */
  nextDue: string;
  /** Owning PM contract id (uuid) — the second join hop to the contract SLA. */
  contractId: string;
}

/** A PM contract as the WO join reads it (GET /pm/contracts row) — only its SLA. */
export interface WoContractRef {
  id: string;
  sla: string;
}

/** A fully-resolved WO row the list + detail consume (wire + asset/contract join). */
export interface WoRow extends WoRaw {
  /** Joined asset name (migration 0034) — "" when the asset is absent (em-dash). */
  assetName: string;
  /** Joined asset human code — "" when absent (em-dash). */
  assetCode: string;
  /** Joined asset site — "" when absent (em-dash). */
  site: string;
  /** Joined asset next-due (the WO "due" column) — "" when absent (em-dash). */
  nextDue: string;
  /** Joined contract SLA — "" when the asset/contract is absent (em-dash). */
  sla: string;
  /** Derived lifecycle status (drives the tabs + StatusBadge). */
  status: WoStatus;
}

/** Read a string field off an opaque row; "" when absent (mirrors toAssetRow). */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Narrow one opaque checklist item -> { label, result } (result "" when unfilled). */
function toChecklistItem(raw: unknown): ChecklistItem {
  const o = (raw ?? {}) as Record<string, unknown>;
  const result = str(o.result);
  return {
    label: str(o.label),
    result: (RESULT_CYCLE as readonly string[]).includes(result)
      ? (result as ChecklistResult)
      : "",
  };
}

/**
 * Narrow an opaque /pm/workorders Entity row to a WoRaw. Accepts snake_case (server
 * convention) or camelCase for robustness (mirrors toWoRow in po-wo-rows). A
 * non-array `items` yields []; missing fields default to "".
 */
export function toWoRaw(e: Record<string, unknown>): WoRaw {
  const rawItems = Array.isArray(e.items) ? e.items : [];
  return {
    id: str(e.id),
    assetId: str(e.asset_id ?? e.assetId),
    templateId: str(e.template_id ?? e.templateId),
    tech: str(e.tech),
    checkinGps: str(e.checkin_gps ?? e.checkinGps),
    items: rawItems.map(toChecklistItem),
    cause: str(e.cause),
    fix: str(e.fix),
    advice: str(e.advice),
    customerSign: str(e.customer_sign ?? e.customerSign),
  };
}

/** Narrow an opaque /pm/assets row to a WoAssetRef (the WO join source). */
export function toWoAssetRef(e: Record<string, unknown>): WoAssetRef {
  return {
    id: str(e.id),
    name: str(e.name),
    code: str(e.code),
    site: str(e.site),
    nextDue: str(e.next_due ?? e.nextDue),
    contractId: str(e.contract_id ?? e.contractId),
  };
}

/** Narrow an opaque /pm/contracts row to a WoContractRef (the SLA join source). */
export function toWoContractRef(e: Record<string, unknown>): WoContractRef {
  return { id: str(e.id), sla: str(e.sla) };
}

/** Build an asset-id -> WoAssetRef map (the first join hop). */
export function buildAssetMap(
  assets: readonly WoAssetRef[] | undefined,
): Map<string, WoAssetRef> {
  const map = new Map<string, WoAssetRef>();
  for (const a of assets ?? []) if (a.id) map.set(a.id, a);
  return map;
}

/** Build a contract-id -> WoContractRef map (the second join hop, SLA). */
export function buildContractMap(
  contracts: readonly WoContractRef[] | undefined,
): Map<string, WoContractRef> {
  const map = new Map<string, WoContractRef>();
  for (const c of contracts ?? []) if (c.id) map.set(c.id, c);
  return map;
}

/** True when any checklist line has a filled result (an in-progress signal). */
function anyResultSet(items: readonly ChecklistItem[]): boolean {
  return items.some((it) => it.result !== "");
}

/**
 * Derive the WO lifecycle from REAL columns only (FLAG, Wei override). `nextDue` is
 * the JOINED asset next-due ("" when the asset is absent — then overdue can't be
 * decided and the WO is "open", honest). `today` is ISO "YYYY-MM-DD"; the ISO
 * lexicographic compare is chronological for that fixed shape.
 */
export function deriveStatus(
  raw: Pick<WoRaw, "customerSign" | "checkinGps" | "items">,
  nextDue: string,
  today: string,
): WoStatus {
  if (raw.customerSign !== "") return "done";
  if (raw.checkinGps !== "" || anyResultSet(raw.items)) return "inprogress";
  if (nextDue !== "" && nextDue < today) return "overdue";
  return "open";
}

/**
 * Resolve one WoRaw into a full WoRow: join the asset (name/code/site/next_due) +
 * the asset's contract (SLA), then derive the status. Every missing join hop stays
 * "" so the view em-dashes it (never a fabricated value / raw uuid).
 */
export function resolveWoRow(
  raw: WoRaw,
  assetMap: Map<string, WoAssetRef>,
  contractMap: Map<string, WoContractRef>,
  today: string,
): WoRow {
  const asset = assetMap.get(raw.assetId);
  const contract = asset ? contractMap.get(asset.contractId) : undefined;
  const nextDue = asset?.nextDue ?? "";
  return {
    ...raw,
    assetName: asset?.name ?? "",
    assetCode: asset?.code ?? "",
    site: asset?.site ?? "",
    nextDue,
    sla: contract?.sla ?? "",
    status: deriveStatus(raw, nextDue, today),
  };
}

/** Resolve + status-derive a whole page of WOs (list source). */
export function resolveWoRows(
  raws: readonly WoRaw[],
  assetMap: Map<string, WoAssetRef>,
  contractMap: Map<string, WoContractRef>,
  today: string,
): WoRow[] {
  return raws.map((r) => resolveWoRow(r, assetMap, contractMap, today));
}

/** Filter resolved rows for a tab ("all" is every row; the rest match the status). */
export function filterWoByTab(rows: readonly WoRow[], tab: WoTab): WoRow[] {
  if (tab === "all") return [...rows];
  return rows.filter((r) => r.status === tab);
}

/** The tab badge count — the real length of the tab's filtered set (pm3.jsx counts). */
export function woTabCount(rows: readonly WoRow[], tab: WoTab): number {
  return filterWoByTab(rows, tab).length;
}

/** Which ds.jsx StatusBadge tone-kind a derived status renders (PMWO_STATUS.s map,
 *  pm.jsx L55-58): open->draft, inprogress->pending, overdue->rejected, done->approved. */
export function statusToneKind(
  status: WoStatus,
): "draft" | "pending" | "rejected" | "approved" {
  switch (status) {
    case "inprogress":
      return "pending";
    case "overdue":
      return "rejected";
    case "done":
      return "approved";
    default:
      return "draft";
  }
}

/** Count of filled checklist lines (result !== "") — the "{n}/{count}" numerator. */
export function doneCount(items: readonly ChecklistItem[]): number {
  return items.filter((it) => it.result !== "").length;
}

/** True when every checklist line is filled (and there is at least one) — close gate. */
export function allChecked(items: readonly ChecklistItem[]): boolean {
  return items.length > 0 && doneCount(items) === items.length;
}

/** Today as an ISO date "YYYY-MM-DD" (mirrors pm-dashboard-rows todayISO). */
export function todayISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

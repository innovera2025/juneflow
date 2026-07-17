/*
 * BOQ-overview aggregation helpers for BOQOverview (P2-WEB-03) — pure, i18n-free,
 * ASCII-only logic derived from pototype/boq.jsx BOQOverview (L52-311).
 *
 * §0 rule 3 + C10: the prototype hard-codes every number on this screen (total
 * 12.4M, approved 11.8M, the waterfall 10.64M/8.95M/6.28M, the 247/8/124/31/5 tab
 * counts, the KPI subs). ALL of those are mock decoration. Here every figure is a
 * REAL aggregate over the generated client's data — never a literal:
 *   - KPI money      : SUM of GET /boq doc totals, sliced by status
 *                      (draft/pending/approved/revise — boq_doc_status).
 *   - waterfall      : approved = SUM approved doc totals; PR-opened = SUM GET /pr
 *                      amounts; PO/WO = SUM approved GET /po + GET /wo amounts.
 *   - balance table  : per-item boq/used/balance derived from GET /boq/{id}/items
 *                      (qty, price, remain_qty — remain is the un-PR'd remainder,
 *                      so used = qty - remain).
 *
 * WIRE GAP (reported, never fabricated): the GR (goods-receipt) stage has NO money
 * on the wire — gr.ts stores receipt QUANTITIES only, returning no `amount`
 * (apps/api/src/routes/gr.ts header GAP 2). So the 4th waterfall bar and the
 * commitment-awaiting-GR chip cannot be computed; the view renders the GR bar's
 * value as an em-dash and omits the commit chip (a contract/api concern outside the
 * web zone). This module never invents a GR figure.
 */
import { toBoqRow, formatMoney, type BoqRow } from "./boq-rows";

export { toBoqRow, formatMoney, type BoqRow };

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

/* ── Doc-level aggregates (GET /boq rows -> BoqRow via toBoqRow) ─────────────── */

/**
 * The scoped project's docs (boq.jsx scope picker narrows to one project). An empty
 * projectId means "no project filter" (show every tenant doc). Mirrors
 * filterBoqRows' project slice (boq-rows.ts) but without the status/query fields.
 */
export function docsInProject(docs: readonly BoqRow[], projectId: string): BoqRow[] {
  if (!projectId) return [...docs];
  return docs.filter((d) => d.projectId === projectId);
}

/** SUM of the given docs' totals (KPI "total BOQ" — real, never the mock 12.4M). */
export function sumDocTotal(docs: readonly BoqRow[]): number {
  return docs.reduce((s, d) => s + d.total, 0);
}

/** SUM of docs whose status is in `statuses` (KPI approved / pending-revise slices). */
export function sumTotalByStatuses(
  docs: readonly BoqRow[],
  statuses: readonly string[],
): number {
  const set = new Set(statuses);
  return docs.reduce((s, d) => s + (set.has(d.status) ? d.total : 0), 0);
}

/* ── PR / PO / WO amount rows (GET /pr, /po, /wo -> AmtRow) ──────────────────── */

/** A priced document row as the waterfall consumes it (pr/po/wo wire). */
export interface AmtRow {
  projectId: string;
  status: string;
  /** Derived money amount on the wire (pr.amount = SUM lines; po/wo amount = total/value). */
  amount: number;
}

/** Narrow an opaque /pr|/po|/wo row to its (project, status, amount). */
export function toAmtRow(e: Record<string, unknown>): AmtRow {
  return {
    projectId: str(e.project_id ?? e.projectId),
    status: str(e.status),
    amount: num(e.amount),
  };
}

/**
 * SUM `amount` over the rows in the scoped project, optionally restricted to
 * `statuses`. Empty projectId = no project filter; undefined statuses = every
 * status. Used for the PR-opened bar (all PRs) and the PO/WO bar (approved only).
 */
export function sumAmount(
  rows: readonly AmtRow[],
  projectId: string,
  statuses?: readonly string[],
): number {
  const set = statuses ? new Set(statuses) : null;
  return rows.reduce((s, r) => {
    if (projectId && r.projectId !== projectId) return s;
    if (set && !set.has(r.status)) return s;
    return s + r.amount;
  }, 0);
}

/* ── Formatting (millions with 1 decimal, percentages) ──────────────────────── */

/** KPI value in millions, 1 decimal (boq.jsx Kpi shows "12.4" / "11.8" / "0.6"). */
export function millions1(units: number): string {
  if (!Number.isFinite(units)) return "0.0";
  return (units / 1e6).toFixed(1);
}

/** part / whole as a percentage (0 when whole <= 0). */
export function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** Percentage rendered to 1 decimal, e.g. "50.6" (no % sign). */
export function pct1(part: number, whole: number): string {
  return pct(part, whole).toFixed(1);
}

/* ── Balance table (GET /boq/{id}/items -> BalanceItem, grouped) ─────────────── */

/** M material · S lump-sum/subcontractor · L labor (boq_item_cat / boq.jsx CAT). */
export type ItemCat = "M" | "S" | "L";

/** One BOQ item as the Balance table consumes it (boq.jsx BOQ_BALANCE row shape). */
export interface BalanceItem {
  groupId: string;
  code: string;
  cat: ItemCat;
  name: string;
  unit: string;
  /** Priced BOQ quantity (item.qty). */
  boqQty: number;
  /** Consumed so far = qty - remain_qty (remain is the un-PR'd remainder). */
  used: number;
  /** Remaining un-PR'd quantity (item.remain_qty). */
  balQty: number;
  /** BOQ value = qty x price. */
  boqV: number;
  /** Used value = used x price. */
  usedV: number;
  /** Balance value = remain x price. */
  balV: number;
  /** Integer % used = round(used / qty x 100); 0 when qty <= 0. */
  pct: number;
}

/** Coerce an opaque cat to M/S/L; unknown -> "M" (boq.jsx CAT default). */
function toCat(v: unknown): ItemCat {
  const c = str(v).toUpperCase();
  return c === "S" || c === "L" ? c : "M";
}

/**
 * Narrow an opaque /boq/{id}/items row to a BalanceItem, deriving used/balance
 * from qty + remain_qty + price (all REAL columns). In a fresh seed remain_qty ==
 * qty (nothing PR'd yet) so used = 0 / pct = 0 — that is the true state, not a bug.
 */
export function toBalanceItem(e: Record<string, unknown>): BalanceItem {
  const qty = num(e.qty);
  const price = num(e.price);
  const remain = num(e.remain_qty ?? e.remainQty);
  const used = qty - remain;
  return {
    groupId: str(e.group_id ?? e.groupId),
    code: str(e.code),
    cat: toCat(e.cat),
    name: str(e.name),
    unit: str(e.unit),
    boqQty: qty,
    used,
    balQty: remain,
    boqV: qty * price,
    usedV: used * price,
    balV: remain * price,
    pct: qty > 0 ? Math.round((used / qty) * 100) : 0,
  };
}

/** SUM of BOQ value over items (denominator for the doc utilisation %). */
export function itemsBoqValue(items: readonly BalanceItem[]): number {
  return items.reduce((s, it) => s + it.boqV, 0);
}

/** SUM of used value over items (numerator for the doc utilisation %). */
export function itemsUsedValue(items: readonly BalanceItem[]): number {
  return items.reduce((s, it) => s + it.usedV, 0);
}

/**
 * The doc's budget-used percentage = SUM(usedV) / SUM(boqV) x 100. This is the REAL,
 * on-label meaning of the used-from-BOQ KPI (budget used FROM the BOQ), derived
 * from the BOQ items themselves — NOT the mock's GR-based 50.6% (the GR money is a
 * wire gap; see the module header). 0 when the doc has no priced items.
 */
export function usedPctFromItems(items: readonly BalanceItem[]): number {
  return pct(itemsUsedValue(items), itemsBoqValue(items));
}

/** A group header + its items, for the Balance table's grouped rows. */
export interface BalanceGroup {
  id: string;
  name: string;
  rows: BalanceItem[];
}

/**
 * Bucket items under their owning group, in the group order supplied by GET /boq/{id}
 * (already seq-sorted). Only groups that actually have (post-filter) items appear —
 * matching the prototype's per-group header rows over its BOQ_BALANCE list.
 */
export function groupBalanceItems(
  items: readonly BalanceItem[],
  groups: readonly { id: string; name: string }[],
): BalanceGroup[] {
  const byGroup = new Map<string, BalanceItem[]>();
  for (const it of items) {
    const list = byGroup.get(it.groupId);
    if (list) list.push(it);
    else byGroup.set(it.groupId, [it]);
  }
  const out: BalanceGroup[] = [];
  for (const g of groups) {
    const rows = byGroup.get(g.id);
    if (rows && rows.length > 0) out.push({ id: g.id, name: g.name, rows });
  }
  return out;
}

/** Filter items by the toolbar search over code + name (case-insensitive). */
export function filterBalanceItems(
  items: readonly BalanceItem[],
  q: string,
): BalanceItem[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...items];
  return items.filter((it) => (it.code + it.name).toLowerCase().includes(needle));
}

/** Map a GET /boq/{id} `groups` payload to ordered {id,name} (drops CBS / seq). */
export function toGroupList(
  groups: readonly Record<string, unknown>[] | undefined,
): { id: string; name: string }[] {
  return (groups ?? []).map((g) => ({ id: str(g.id), name: str(g.name) }));
}

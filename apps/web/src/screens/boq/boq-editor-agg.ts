/*
 * BOQ-editor pure logic for BOQEditor (P2-WEB-04) — pure, i18n-free, ASCII-only helpers
 * derived from pototype/boq.jsx BOQEditor (L362-848) + BOQEditorRow (L857-919) +
 * BOQItemForm (L922-1035) + boq-extra.jsx BudgetControlBar (L201-258).
 *
 * §0 rule 3 + C10: the prototype holds the whole editor in local state seeded from the
 * hardcoded INITIAL_GROUPS / INITIAL_ROWS_BY_GROUP / CBS_BUDGET (boq.jsx L317-360,
 * boq-extra.jsx L7-16). ALL of that mock is dropped — the editor reads the real server
 * document tree through the generated client:
 *   GET /boq              -> resolve the active doc (by ctx.params.no, else the first doc)
 *   GET /boq/{id}         -> the doc's groups + per-group CBS budget (BudgetControlBar)
 *   GET /boq/{id}/items   -> the doc's priced lines (the item table + M/S/L category totals)
 * and it WRITES through the real mutation endpoints (POST /boq/{id}/items = add line;
 * POST /boq/{id}/generate-pr = M/S-split PR + cut-remain; POST /boq/{id}/submit,/revise =
 * the state machine). This module holds only the framework-free derivations those wire
 * shapes feed; the React screen (boq-editor.tsx) + hooks (use-boq-editor.ts) sit on top.
 *
 * WIRE GAPS (reported honestly, never fabricated — flagged in boq-editor.tsx header):
 *  - boq_item has NO `detail` column and no cost-center NAME (only a `cc_id` FK). So the
 *    prototype's `detail` / `costName` / `costCode` per-row fields have no direct wire
 *    source: `detail` renders an em-dash, and the Cost Name is resolved from GET
 *    /cost-centers (cc_id -> {code,name}) when present, else an em-dash.
 *  - the POST /boq/{id}/items handler persists only { group_id, code, name, cat, qty, unit,
 *    price, currency_code }; the modal's Cost-Center + detail inputs do NOT persist.
 *  - there is no update / delete / group-CRUD endpoint, so edit-item / delete-item /
 *    move-group / group add-rename-delete are deferred stubs (add + duplicate are real
 *    creates through POST items).
 */
import { toBoqRow, formatMoney, versionLabel, type BoqRow } from "./boq-rows";
import { pct1, type ItemCat } from "./boq-overview-agg";

export { toBoqRow, formatMoney, versionLabel, pct1, type BoqRow, type ItemCat };

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent/null. */
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

/** Coerce an opaque cat to M/S/L; unknown -> "M" (boq.jsx CAT default). */
function toCat(v: unknown): ItemCat {
  const c = str(v).toUpperCase();
  return c === "S" || c === "L" ? c : "M";
}

/* ── Item wire (GET /boq/{id}/items row -> EditorItem) ───────────────────────── */

/** One priced BOQ line as the editor table consumes it (apps/api boq.ts itemWire). */
export interface EditorItem {
  /** Server UUID — the selection key + generate-pr item_id. */
  id: string;
  groupId: string;
  code: string;
  cat: ItemCat;
  name: string;
  unit: string;
  qty: number;
  price: number;
  /** Un-PR'd remainder (qty when nothing PR'd yet). */
  remainQty: number;
  /** Cost-center FK ("" when unset) — resolved to a name via GET /cost-centers. */
  ccId: string;
  currencyCode: string;
}

/** Narrow an opaque /boq/{id}/items row to an EditorItem (snake_case | camelCase). */
export function toEditorItem(e: Record<string, unknown>): EditorItem {
  return {
    id: str(e.id),
    groupId: str(e.group_id ?? e.groupId),
    code: str(e.code),
    cat: toCat(e.cat),
    name: str(e.name),
    unit: str(e.unit),
    qty: num(e.qty),
    price: num(e.price),
    remainQty: num(e.remain_qty ?? e.remainQty),
    ccId: str(e.cc_id ?? e.ccId),
    currencyCode: str(e.currency_code ?? e.currencyCode) || "THB",
  };
}

/** Line amount = qty x unit price (the table's Total column). */
export function lineTotal(it: EditorItem): number {
  return it.qty * it.price;
}

/* ── Group wire (GET /boq/{id} groups[] -> EditorGroup) ──────────────────────── */

/** Per-group CBS budget control (apps/api boq.ts cbsWire), all in FULL currency units. */
export interface Cbs {
  budget: number;
  used: number;
  committed: number;
  available: number;
}

/** One BOQ group as the editor's groups panel + BudgetControlBar consume it. */
export interface EditorGroup {
  id: string;
  name: string;
  seq: number;
  cbs: Cbs | null;
}

/** Narrow one opaque /boq/{id} group (with optional nested `cbs`). */
export function toEditorGroup(g: Record<string, unknown>): EditorGroup {
  const raw = g.cbs;
  const cbs =
    raw && typeof raw === "object"
      ? (() => {
          const c = raw as Record<string, unknown>;
          const budget = num(c.budget);
          const used = num(c.used);
          const committed = num(c.committed);
          return {
            budget,
            used,
            committed,
            available: num(c.available ?? budget - used - committed),
          };
        })()
      : null;
  return { id: str(g.id), name: str(g.name), seq: num(g.seq), cbs };
}

/** Map a GET /boq/{id} `groups` payload to ordered EditorGroups (by seq). */
export function toEditorGroups(
  groups: readonly Record<string, unknown>[] | undefined,
): EditorGroup[] {
  return (groups ?? [])
    .map(toEditorGroup)
    .sort((a, b) => a.seq - b.seq);
}

/* ── Grouping + per-group aggregates ─────────────────────────────────────────── */

/** Bucket items under their owning group id (boq.jsx rowsByGroup). */
export function groupItemsByGroup(
  items: readonly EditorItem[],
): Map<string, EditorItem[]> {
  const map = new Map<string, EditorItem[]>();
  for (const it of items) {
    const list = map.get(it.groupId);
    if (list) list.push(it);
    else map.set(it.groupId, [it]);
  }
  return map;
}

/** SUM of line totals over the rows (group value / all-groups total). */
export function sumLineTotals(rows: readonly EditorItem[]): number {
  return rows.reduce((s, r) => s + r.qty * r.price, 0);
}

/* ── Category (M/S/L) totals for a group's rows (boq.jsx `totals`) ───────────── */

export interface CatTotals {
  M: number;
  S: number;
  L: number;
  countM: number;
  countS: number;
  countL: number;
  grand: number;
}

/** M/S/L value + count + grand total over a set of rows (boq.jsx L394-402). */
export function categoryTotals(rows: readonly EditorItem[]): CatTotals {
  const t: CatTotals = { M: 0, S: 0, L: 0, countM: 0, countS: 0, countL: 0, grand: 0 };
  for (const r of rows) {
    const amt = r.qty * r.price;
    if (r.cat === "M") {
      t.M += amt;
      t.countM += 1;
    } else if (r.cat === "S") {
      t.S += amt;
      t.countS += 1;
    } else {
      t.L += amt;
      t.countL += 1;
    }
  }
  t.grand = t.M + t.S + t.L;
  return t;
}

/* ── Toolbar filter (cat chips + search) (boq.jsx displayedRows L387-391) ─────── */

/**
 * Filter a group's rows by the active category set (empty = show all) + the free-text
 * search. The prototype searched name+code+detail; `detail` has no wire column, so the
 * search runs over name+code only (WIRE GAP — never invented).
 */
export function filterEditorRows(
  rows: readonly EditorItem[],
  catFilter: ReadonlySet<ItemCat>,
  q: string,
): EditorItem[] {
  const needle = q.trim().toLowerCase();
  return rows.filter((r) => {
    if (catFilter.size > 0 && !catFilter.has(r.cat)) return false;
    if (needle && !(r.name + r.code).toLowerCase().includes(needle)) return false;
    return true;
  });
}

/* ── CBS budget control rows (boq-extra.jsx BudgetControlBar L201-258) ────────── */

/** One CBS bar row: real budget/used/committed + derived available + over-budget flag. */
export interface CbsRow {
  id: string;
  label: string;
  budget: number;
  used: number;
  committed: number;
  available: number;
  over: boolean;
  usedPct: number;
  commPct: number;
}

/**
 * Build the BudgetControlBar rows from the doc's groups. A group with no cbs row reads as
 * all-zero (its true state — the seed may carry no budget yet). `available` may go negative
 * when a group is over budget (rendered as a warning, C10).
 */
export function cbsRows(groups: readonly EditorGroup[]): CbsRow[] {
  return groups.map((g) => {
    const budget = g.cbs?.budget ?? 0;
    const used = g.cbs?.used ?? 0;
    const committed = g.cbs?.committed ?? 0;
    return {
      id: g.id,
      label: g.name,
      budget,
      used,
      committed,
      available: budget - used - committed,
      over: used + committed > budget,
      usedPct: budget ? (used / budget) * 100 : 0,
      commPct: budget ? (committed / budget) * 100 : 0,
    };
  });
}

export interface CbsTotals {
  budget: number;
  used: number;
  committed: number;
  available: number;
}

/** SUM the CBS rows into a totals strip (boq-extra.jsx `tot`). */
export function cbsTotals(rows: readonly CbsRow[]): CbsTotals {
  const budget = rows.reduce((s, r) => s + r.budget, 0);
  const used = rows.reduce((s, r) => s + r.used, 0);
  const committed = rows.reduce((s, r) => s + r.committed, 0);
  return { budget, used, committed, available: budget - used - committed };
}

/* ── Formatting (boq.jsx fmt/fmtDec, boq-extra.jsx bahtK) ─────────────────────── */

/** 2-decimal money (ds.jsx fmtDec) — "425" -> "425.00", grouped thousands, ASCII only. */
export function formatDec(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  const sign = n < 0 ? "-" : "";
  const [int, frac] = Math.abs(n).toFixed(2).split(".");
  return sign + int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + frac;
}

/** Compact baht (boq-extra.jsx bahtK) — >=1M -> "1.24M", else "K" thousands. */
export function bahtK(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + "M" : (n / 1e3).toFixed(0) + "K";
}

/* ── Doc resolution + read-only gate ─────────────────────────────────────────── */

/**
 * The active doc: the one matching the navigated `no` (boq-list openEditor / new-boq-form),
 * else the first doc in the catalogue (direct sidebar nav, no param). undefined when the
 * tenant has no BOQ docs at all.
 */
export function resolveDoc(docs: readonly BoqRow[], no: string): BoqRow | undefined {
  if (no) {
    const found = docs.find((d) => d.no === no);
    if (found) return found;
  }
  return docs[0];
}

/**
 * A doc is read-only when the server has APPROVED (locked) it — item add/edit is rejected
 * with 409 until a Revise spins a new version (apps/api boq.ts). draft/pending/revise are
 * editable. Mirrors the prototype's readOnly gate (boq.jsx L381), server-truth version.
 */
export function isReadOnly(status: string): boolean {
  return status === "approved";
}

/* ── Cost-center name resolution (cc_id -> {code,name} via GET /cost-centers) ──── */

/** Build an id -> {code,name} map from /cost-centers rows (resolves the Cost Name column). */
export function ccNameById(
  rows: readonly Record<string, unknown>[] | undefined,
): Map<string, { code: string; name: string }> {
  const map = new Map<string, { code: string; name: string }>();
  for (const r of rows ?? []) {
    const id = str(r.id);
    if (id) map.set(id, { code: str(r.code), name: str(r.name) });
  }
  return map;
}

/* ── Write-body builders (POST /boq/{id}/items · generate-pr) ─────────────────── */

/** The item-form values the modal collects (before persistence-field narrowing). */
export interface ItemFormValues {
  cat: ItemCat;
  code: string;
  name: string;
  unit: string;
  qty: number;
  price: number;
  currencyCode: string;
}

/** Submit-gate for the item form (boq.jsx canSubmit L934). */
export function canSubmitItem(code: string, name: string, qty: number): boolean {
  return code.trim().length > 0 && name.trim().length > 0 && qty > 0;
}

/**
 * The POST /boq/{id}/items body for one added line — ONLY the columns the handler persists
 * (group_id, code, name, cat, qty, unit, price, currency_code). The modal's Cost-Center +
 * detail inputs are not persisted by the handler (WIRE GAP), so they are not sent.
 */
export function buildAddItemBody(
  groupId: string,
  v: ItemFormValues,
): Record<string, unknown> {
  return {
    group_id: groupId,
    code: v.code.trim(),
    name: v.name.trim(),
    cat: v.cat,
    qty: v.qty,
    unit: v.unit.trim(),
    price: v.price,
    currency_code: v.currencyCode || "THB",
  };
}

/**
 * The POST /boq/{id}/items body for a duplicated line — a real new item copied from the
 * source with a "-COPY" code suffix (boq.jsx duplicateRow L429-435). "-COPY" is a document
 * CODE fragment (not translatable UI copy), so it stays an ASCII literal.
 */
export function buildDuplicateBody(it: EditorItem): Record<string, unknown> {
  return {
    group_id: it.groupId,
    code: it.code + "-COPY",
    name: it.name,
    cat: it.cat,
    qty: it.qty,
    unit: it.unit,
    price: it.price,
    currency_code: it.currencyCode || "THB",
  };
}

/**
 * The POST /boq/{id}/generate-pr body: the selected item ids (no per-item qty -> the
 * server cuts the FULL remaining qty of each). The server splits Material -> a supplier PR
 * and Subcon/Labor -> a PR-Subcon, and decrements remain_qty (cut-remain).
 */
export function buildGeneratePrBody(itemIds: Iterable<string>): { item_ids: string[] } {
  return { item_ids: [...itemIds] };
}

/** The PR numbers the generate-pr response created (resp.prs[].no), in order. */
export function generatedPrNos(resp: unknown): string[] {
  const prs = (resp as { prs?: unknown[] } | null)?.prs;
  if (!Array.isArray(prs)) return [];
  return prs
    .map((p) => (p as { no?: unknown } | null)?.no)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

/** The first PR number from the generate-pr response ("" when none). */
export function firstPrNo(resp: unknown): string {
  return generatedPrNos(resp)[0] ?? "";
}

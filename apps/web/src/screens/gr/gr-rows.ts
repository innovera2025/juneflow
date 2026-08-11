/*
 * GR list-row helpers for GRList (P2-WEB-11) — pure, i18n-free logic derived from
 * pototype/gr.jsx GRList (L17-205) + the ds.jsx STATUS map (L84-92) the
 * prototype's <StatusBadge> reads. No translatable copy lives here: the only
 * non-ASCII literal is the " · " label separator in itemsLabel (punctuation, the
 * repo-wide denormalised-label separator — cf. ap-cn-dn-rows sourceLabel).
 *
 * The prototype held GR docs in a local GR_ROWS array (gr.jsx:3-9) whose rows
 * carried denormalised display strings (vendor name / items / date / receiver / a
 * hardcoded money `amount` / an ordered qty for the received-vs-ordered bar). §0
 * rule 3: that mock array is dropped — the list is the real server catalogue
 * (GET /gr, use-gr.ts).
 *
 * RE-WIRE (B-078 / F1 data-completeness): the GET /gr row wire is now
 *   { id, no, po_id, wo_id, status, received, rejected, photos,
 *     vendor, date, ordered_qty, money, currency_code, items[] }
 * (apps/api/src/routes/gr.ts grWire; the exact 14-key set is pinned by the API's
 * own list test, gr.test.ts "Object.keys(g0).sort()"). The screen was ported while
 * the wire was still the 8-key shape, so vendor / date / ordered / money / per-line
 * items were em-dashed; they are REAL now and this module narrows them. Every value
 * below is SERVER-derived — `money` is Σ(received_qty × price) computed and 2-dp
 * rounded server-side (B-085 fix 3) and is only ever formatted here, NEVER summed
 * or recomputed client-side.
 *
 * A GR anchors on EITHER a material PO (po_id) or a subcon WO (wo_id) — never both
 * (B-070 GR-from-WO). The prototype's ref display number ("PO-2026-0288") resolves
 * from po_id / wo_id via GET /po + GET /wo (§0 rule 3, FK-as-string -> real id join,
 * mirrors boq-rows projectNameById).
 *
 * TWO POPULATIONS — THE ONE RULE THIS MODULE ENFORCES
 * ----------------------------------------------------
 * The wire mixes quantities from two different sets of lines:
 *   HEADER population — `received` / `rejected`: server Σ over ALL posted lines,
 *       named AND bare (apps/api/src/routes/gr.ts grWire, POST /gr sums every line).
 *   LINE population   — `items[]`, plus the two header-shaped figures DERIVED from
 *       it: `ordered_qty` (Σ line ordered) and `money` (Σ line received × price).
 *       Only lines posted WITH a name become gr_item rows (gr.ts create `if (name)`),
 *       so this population is a SUBSET of the header's.
 * Dividing, comparing, or even printing a number from one population next to a
 * number from the other is wrong — it reads as a like-for-like figure and is not.
 *
 * Enforcement is STRUCTURAL, not per-call-site discipline: `grRowDisplay(row)` and
 * `grItemDisplay(item)` below are the ONLY numbers GRList prints. The view imports
 * no raw-number helper and never touches `row.received` / `row.money` /
 * `item.receivedQty` itself, so a cell cannot silently pick the wrong population.
 * The rule those two encode:
 *   - line detail present -> EVERY quantity + the value come from items[] (one
 *     population, and the exact figures the detail panel lists);
 *   - no line detail      -> the header total is the receipt's ONLY quantity, so it
 *     stands alone and `money` is withheld (null) — nothing to mis-pair it with;
 *   - a ratio is formed only when EVERY line carries its own ordered quantity
 *     (allLinesMeasured), otherwise the ordered half em-dashes and no bar is drawn.
 *
 * REMAINING WIRE GAPS (reported, never fabricated — full list in the GRList header):
 *   - NO received-by / receiver column -> the prototype's `by` sub-line + the detail
 *     received-by stat stay em-dashed.
 *   - NO separate RT return document (RT-number / return reason) -> the returns tab
 *     lists the GRs whose status is "returned"; its ref-GR + reason cells em-dash.
 *   - NO warehouse column -> the warehouse filter chip stays presentational.
 *   - A receipt with NO gr_item lines has no per-line detail at all: the server then
 *     honestly reports money 0 / ordered_qty 0. Those zeroes mean "unknown", not
 *     "zero baht / zero ordered", so `hasLineDetail()` gates them and the view
 *     em-dashes instead of asserting a false 0 (see hasLineDetail below).
 *   - A MIXED receipt (some named lines, some bare qty-only lines) carries received
 *     quantity that no ordered quantity measures: the header total counts it, the
 *     gr_item lines do not. The received/ordered cell + bar therefore report the
 *     measured-line pair, and isFullyMeasured() withholds the completeness badge —
 *     an undescribed quantity can never evidence a full receipt.
 *   - The SAME superset-vs-subset trap exists INSIDE items[]: openapi.yaml requires
 *     no line field, and gr.ts's `toNum(...) ?? qtyOk` default fires only when
 *     ordered_qty is ABSENT, so an explicit 0 persists — a named line can carry
 *     received quantity with no ordered quantity to measure it. Summing every line's
 *     received against only the measured lines' ordered would overstate completion
 *     exactly as the header-vs-items pairing did. allLinesMeasured() therefore gates
 *     the ratio, the bar AND the per-line label: nothing is asserted about a line
 *     that nothing measures.
 *   - POST /gr defaults a named line's ordered_qty to its qty_ok when the client
 *     omits it, and openapi.yaml requires no line field, so such a line arrives as
 *     ordered == received and is indistinguishable from a real full receipt. Not
 *     fixable client-side — escalated as B-270 (contract owner).
 *   - The prototype's "partial" badge has no i18n key (only `gr.list.badgeComplete`
 *     exists) -> the complete badge renders, the partial badge is omitted (B-275).
 */

/** One received line of a GR (gr_item row, from the wire's `items[]`). */
export interface GrItem {
  id: string;
  /** Line description (the prototype's item name). */
  name: string;
  /** Quantity ordered on this line (0 when the source order carries no qty). */
  orderedQty: number;
  /** Quantity actually accepted on this line. */
  receivedQty: number;
  /** Unit of measure (server data, not UI copy — never translated). */
  unit: string;
  /** Unit price in FULL currency units (server-owned; never re-derived here). */
  price: number;
  /** ISO-4217 code for `price` (every money column carries its currency). */
  currencyCode: string;
}

/** A GR doc as the table consumes it (GET /gr row, narrowed from the opaque wire). */
export interface GrRow {
  id: string;
  no: string;
  /** Source material-PO id (set when the receipt anchors on a PO). */
  poId: string;
  /** Source subcon-WO id (set when the receipt anchors on a WO, B-070). */
  woId: string;
  /** Lifecycle status — "received" | "returned" | "cancelled" (gr_status). */
  status: string;
  /**
   * RECEIPT HEADER total accepted quantity — server Σ qty_ok over ALL posted
   * lines, named AND bare. NOT comparable with `orderedQty` below (different
   * populations): only `lineTotals(items)` may be compared. See receivedOrdered().
   */
  received: number;
  /** Total rejected quantity (SUM of qty_rejected -> defect_report). */
  rejected: number;
  /** Attached delivery-note / photo urls. */
  photos: string[];
  /** Resolved supplier name (gr -> po/wo -> vendor.name); "" when unresolvable. */
  vendor: string;
  /** Receipt timestamp (gr.created_at, ISO/UTC); "" when absent. */
  date: string;
  /**
   * Σ ordered_qty over the NAMED lines only (a bare qty-only line never becomes a
   * gr_item). Narrowed for completeness of the wire; the view derives the cell's
   * ordered side from `items` instead so both halves share one population.
   */
  orderedQty: number;
  /** SERVER-derived receipt value Σ(received_qty × price), 2-dp rounded. */
  money: number;
  /** ISO-4217 code for `money`. */
  currencyCode: string;
  /** Per-line received detail (empty when the receipt was a bare qty-only entry). */
  items: GrItem[];
}

/** A PO / WO option as the create-form picker + ref resolver consume it. */
export interface AnchorDoc {
  id: string;
  no: string;
  status: string;
  /** Doc total in FULL currency units (po.total / wo.value). */
  amount: number;
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

/** Read a string[] field off an opaque row; [] when absent/other. */
function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Read an array of opaque objects off a row; [] when absent/other. */
function objArr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    : [];
}

/** Narrow one opaque `items[]` entry (grItemWire) to a GrItem. */
export function toGrItem(e: Record<string, unknown>): GrItem {
  return {
    id: str(e.id),
    name: str(e.name),
    orderedQty: num(e.ordered_qty ?? e.orderedQty),
    receivedQty: num(e.received_qty ?? e.receivedQty),
    unit: str(e.unit),
    price: num(e.price),
    currencyCode: str(e.currency_code ?? e.currencyCode),
  };
}

/**
 * Narrow an opaque /gr Entity row to the GrRow the table needs. Multi-word fields
 * accept snake_case (server convention) or camelCase for robustness (mirrors
 * boq-rows toBoqRow). Missing fields default (0 / "" / []). `money` is read
 * straight off the wire — the server owns it; nothing here re-derives a total.
 */
export function toGrRow(e: Record<string, unknown>): GrRow {
  return {
    id: str(e.id),
    no: str(e.no),
    poId: str(e.po_id ?? e.poId),
    woId: str(e.wo_id ?? e.woId),
    status: str(e.status),
    received: num(e.received),
    rejected: num(e.rejected),
    photos: strArr(e.photos),
    vendor: str(e.vendor),
    date: str(e.date),
    orderedQty: num(e.ordered_qty ?? e.orderedQty),
    money: num(e.money),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    items: objArr(e.items).map(toGrItem),
  };
}

/** Narrow an opaque /po or /wo Entity row to an AnchorDoc (picker + ref resolver). */
export function toAnchorDoc(e: Record<string, unknown>): AnchorDoc {
  return {
    id: str(e.id),
    no: str(e.no),
    status: str(e.status),
    amount: num(e.amount ?? e.total ?? e.value),
  };
}

/** The five gr.jsx tabs (L43-49). */
export type GrTab = "po" | "wo" | "other" | "return" | "cancel";

/**
 * Filter the docs for a tab. The prototype's tabs are a mock (po/wo/other render
 * the SAME GR_ROWS); production partitions the real rows honestly:
 *   po      -> a still-open PO receipt (po_id set, status "received")
 *   wo      -> a still-open WO receipt (wo_id set, status "received")
 *   other   -> a receipt with neither anchor (impossible on this wire -> empty)
 *   return  -> a returned receipt (status "returned")
 *   cancel  -> a cancelled receipt (status "cancelled")
 */
export function filterByTab(rows: readonly GrRow[], tab: GrTab): GrRow[] {
  switch (tab) {
    case "po":
      return rows.filter((r) => r.poId !== "" && r.status === "received");
    case "wo":
      return rows.filter((r) => r.woId !== "" && r.status === "received");
    case "other":
      return rows.filter((r) => r.poId === "" && r.woId === "");
    case "return":
      return rows.filter((r) => r.status === "returned");
    case "cancel":
      return rows.filter((r) => r.status === "cancelled");
  }
}

/** C10 tab badge count — the real length of the tab's filtered set (never hardcoded). */
export function tabCount(rows: readonly GrRow[], tab: GrTab): number {
  return filterByTab(rows, tab).length;
}

/** Count docs whose status equals `status` (KPI aggregates). */
export function countByStatus(rows: readonly GrRow[], status: string): number {
  return rows.filter((r) => r.status === status).length;
}

/** "PO" | "WO" | "" — which anchor a row carries (drives the ref badge). */
export function refKind(row: GrRow): "PO" | "WO" | "" {
  if (row.poId !== "") return "PO";
  if (row.woId !== "") return "WO";
  return "";
}

/** Build an id -> doc-no map from AnchorDocs (for the ref column + ref resolver). */
export function refNoMap(docs: readonly AnchorDoc[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of docs ?? []) if (d.id) map.set(d.id, d.no);
  return map;
}

/**
 * Resolve a row's ref display number ("PO-2026-0288") from the po/wo no maps.
 * Falls back to "" when the anchor doc is not in the fetched page (never a UUID).
 */
export function resolveRefNo(
  row: GrRow,
  poNos: Map<string, string>,
  woNos: Map<string, string>,
): string {
  if (row.poId !== "") return poNos.get(row.poId) ?? "";
  if (row.woId !== "") return woNos.get(row.woId) ?? "";
  return "";
}

/**
 * Status badge descriptor. bg/fg are @juneflow/tokens var() references (rule 6);
 * `dot` is prototype-verbatim (ds.jsx STATUS map, B-037(a)). The GET /gr wire
 * statuses (received/returned/cancelled) are NOT the prototype's mock statuses, so
 * this maps them per apps/api/src/routes/gr.ts: a `received` GR is the recorded
 * (approved-style) state; `cancelled` is the ds.jsx STATUS.cancelled literal.
 * `returned` has no ds.jsx STATUS entry (APPROXIMATE, flagged): the info tone is
 * reused and its label falls back to gr.list.kpiReturns.
 */
export function statusTone(status: string): { bg: string; fg: string; dot: string } {
  switch (status) {
    case "returned":
      return { bg: "var(--info-soft)", fg: "var(--info)", dot: "#1D4ED8" };
    case "cancelled":
      return { bg: "#F1F5F9", fg: "#64748B", dot: "#94A3B8" };
    case "received":
    default:
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
  }
}

/** Which i18n label a wire status renders (resolved in the view — no Thai here). */
export function statusLabelKind(status: string): "received" | "returned" | "cancelled" {
  if (status === "returned") return "returned";
  if (status === "cancelled") return "cancelled";
  return "received";
}

/**
 * Filter the docs by the toolbar free-text query over no + resolved ref no +
 * vendor — the full haystack the prototype's placeholder advertises
 * (gr.list.searchPlaceholder: GR no, PO/WO, vendor). Vendor is searchable again now that it is on
 * the list wire. An empty query means "no filter".
 */
export function filterByQuery(
  rows: readonly GrRow[],
  q: string,
  poNos: Map<string, string>,
  woNos: Map<string, string>,
): GrRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((r) =>
    (r.no + resolveRefNo(r, poNos, woNos) + r.vendor).toLowerCase().includes(needle),
  );
}

/**
 * TRUE when the receipt carries real per-line detail. The server reports
 * money 0 / ordered_qty 0 for a bare qty-only receipt (no gr_item rows) — those
 * zeroes mean "not recorded", not "zero baht / nothing ordered", so the view must
 * em-dash rather than print a false 0. This is the single gate for that.
 */
export function hasLineDetail(row: GrRow): boolean {
  return row.items.length > 0;
}

/**
 * Received-vs-ordered completion percent (0-100, clamped) for the prototype's
 * progress bar. Returns null when there is no ordered quantity to measure against
 * (a lump-sum WO or a receipt without line detail) — the caller then draws NO bar
 * rather than a fabricated 0% or 100%.
 *
 * CALLERS MUST PASS ONE POPULATION: `received` and `ordered` have to describe the
 * SAME set of lines or the ratio is meaningless (see receivedOrdered below). Use
 * rowReceivedPct() for a GrRow — it picks the comparable pair for you.
 */
export function receivedPct(received: number, ordered: number): number | null {
  if (!Number.isFinite(ordered) || ordered <= 0) return null;
  if (!Number.isFinite(received)) return null;
  return Math.max(0, Math.min(100, Math.round((received / ordered) * 100)));
}

/**
 * Quantity comparison tolerance. Line quantities are numeric(_, 3) columns read
 * back as JS floats, so a summed pair that is arithmetically equal can differ in
 * the last bits (0.1 + 0.2). Compare with a tolerance well below the 3-dp minor
 * unit so real data is never mis-classified as a mismatch.
 */
const QTY_EPS = 1e-6;

/**
 * Σ of the receipt's NAMED lines (items[]) — received and ordered from the SAME
 * population, the only pair that may be compared.
 *
 * WHY THIS EXISTS (the mixed-population trap): the wire carries two different
 * received figures. `gr.received` is the RECEIPT HEADER total — Σ qty_ok over ALL
 * posted lines, named AND bare (apps/api/src/routes/gr.ts POST /gr sums every
 * line into `received`). `gr.ordered_qty` is Σ ordered_qty over the NAMED lines
 * ONLY, because a bare qty-only line never becomes a gr_item row (gr.ts create:
 * `if (name) itemDrafts.push(...)`). Pairing the header total with the named-line
 * ordered total therefore compares a superset against a subset — it overstates
 * the received side by exactly the bare-line quantity and reads as "more complete
 * than it is". Everything below measures lines against lines.
 */
export function lineTotals(items: readonly GrItem[]): { received: number; ordered: number } {
  return items.reduce(
    (acc, it) => ({
      received: acc.received + it.receivedQty,
      ordered: acc.ordered + it.orderedQty,
    }),
    { received: 0, ordered: 0 },
  );
}

/**
 * TRUE when a line states its own ordered quantity — i.e. when there is something
 * to measure the line's received quantity against. A line posted with an explicit
 * ordered_qty of 0 (contract-legal: openapi.yaml requires no line field and gr.ts's
 * `?? qtyOk` default only fires when the field is ABSENT) states none: it cannot
 * fall short, cannot be complete, and cannot contribute to a ratio.
 */
export function isItemMeasured(item: GrItem): boolean {
  return item.orderedQty > 0;
}

/**
 * TRUE when EVERY line of the receipt is measured — the precondition for summing
 * the lines into a ratio. Without it, Σ received would cover every line while
 * Σ ordered covered only the measured ones: the SAME superset-vs-subset defect as
 * the header-vs-items pairing, just relocated inside items[]. An empty items[] is
 * not "all measured" (there is no line detail at all).
 */
export function allLinesMeasured(items: readonly GrItem[]): boolean {
  return items.length > 0 && items.every(isItemMeasured);
}

/**
 * The received/ordered pair the list cell (gr.list.colReceivedOrdered)
 * and the progress bar render. `ordered` is null when nothing measurable exists to
 * compare against, and the caller then em-dashes that half and draws NO bar.
 *
 *   with line detail -> BOTH halves from items[] (Σ receivedQty / Σ orderedQty):
 *                       one population, and the exact numbers the detail panel
 *                       lists line by line, so the two panes cannot contradict.
 *   no line detail   -> the header total is the receipt's ONLY real quantity, so
 *                       it is shown alone against an em-dashed ordered side.
 *
 * MIXED RECEIPT (some named lines, some bare): the pair stays the measured-line
 * pair. The bare quantity has no ordered counterpart anywhere on the wire, so it
 * cannot enter a ratio; it is reported by isFullyMeasured() below, which withholds
 * the completeness badge for exactly this reason.
 *
 * PARTLY-MEASURED items[] (some lines carry ordered_qty, some carry an explicit 0):
 * the ordered side is null and NO ratio is formed. Summing all lines' received
 * against only the measured lines' ordered would repeat the superset-vs-subset
 * defect one level down — e.g. lines 90/100 + 10/0 would read "100 / 100, 100%"
 * for a receipt whose only measured line short-received 10. The received half is
 * still the honest line total; the ordered half em-dashes and the caller draws no
 * bar. `row.orderedQty` (the header-shaped Σ) is NEVER read here.
 */
export function receivedOrdered(row: GrRow): { received: number; ordered: number | null } {
  if (!hasLineDetail(row)) return { received: row.received, ordered: null };
  const { received, ordered } = lineTotals(row.items);
  if (!allLinesMeasured(row.items)) return { received, ordered: null };
  return { received, ordered };
}

/**
 * Σ of each line's received quantity CAPPED AT ITS OWN ordered quantity — the
 * numerator of the row ratio (B-276).
 *
 * WHY THE CAP IS PER LINE: receivedPct() clamps to 100 AFTER summing, which hides
 * cross-line padding instead of catching it. Lines A {150 of 100} + B {50 of 100}
 * sum to 200/200 and read 100% while B is half short — the 50 over-received on A
 * is not progress against B's order. Capping first (min(150,100) + min(50,100) =
 * 150) makes the bar 75%: a line can contribute at most its own order to the
 * receipt's progress, so no line's surplus can ever fill another line's gap. The
 * 100-clamp inside receivedPct() then becomes unreachable belt-and-braces.
 *
 * The CELL text is unaffected — it still prints the honest Σ received (200 of 200
 * above). This function feeds the bar only.
 *
 * Callers must have established that every line is measured (allLinesMeasured);
 * an unmeasured line would cap at 0 and understate, which is why the only caller
 * checks `ordered !== null` first.
 */
export function cappedReceived(items: readonly GrItem[]): number {
  return items.reduce((acc, it) => acc + Math.min(it.receivedQty, it.orderedQty), 0);
}

/** The row's progress-bar percent — the comparable pair, or null when unmeasurable. */
export function rowReceivedPct(row: GrRow): number | null {
  const { ordered } = receivedOrdered(row);
  if (ordered === null) return null;
  return receivedPct(cappedReceived(row.items), ordered);
}

/**
 * TRUE when EVERY quantity on the receipt is measured against an INDEPENDENT
 * ordered quantity — the precondition for saying anything at all about
 * completeness. Three things must hold:
 *
 *   1. the receipt has line detail (a bare receipt states no ordered quantity);
 *   2. every line carries ordered_qty > 0 (a line with no ordered quantity cannot
 *      fall short of anything, so it can never evidence a full receipt);
 *   3. the header total and the line total agree — i.e. NO unmeasured quantity.
 *      A bare line adds to `received` but contributes no ordered quantity, so a
 *      receipt carrying one is only partly described and its completeness is not
 *      knowable from this payload.
 *
 * KNOWN CONTRACT LIMIT (B-270, escalated — not fixable client-side): POST /gr
 * defaults a named line's ordered_qty to its qty_ok when the client omits it
 * (gr.ts create: `toNum(...) ?? qtyOk`), and openapi.yaml declares no required
 * line fields. Such a line reaches the wire as ordered == received, byte-identical
 * to a genuinely fully-received line. This check therefore cannot detect that case;
 * it is stated here rather than papered over.
 */
export function isFullyMeasured(row: GrRow): boolean {
  // (1) + (2) — line detail present AND every line states its own ordered qty.
  if (!allLinesMeasured(row.items)) return false;
  // (3) — no unmeasured quantity hides in the header total.
  return Math.abs(row.received - lineTotals(row.items).received) < QTY_EPS;
}

/**
 * TRUE when the receipt is fully received against its ordered quantity — drives
 * the prototype's complete badge (gr.list.badgeComplete). Both sides come
 * from items[]; a receipt that is not fully measured is NEVER complete, because an
 * unmeasured quantity cannot evidence a full receipt (and an un-quantified order
 * never auto-closes server-side either — apps/api/src/routes/gr.ts note 3).
 *
 * EVERY LINE, NOT THE Σ (B-276): the test is per line — `no line is short` — not
 * `Σ received >= Σ ordered`. The two are NOT equivalent: an over-receipt on one
 * line pads the sum over another line's shortfall, so a Σ-only rule badges a
 * receipt complete that the detail panel two panes over prints as short. Lines
 * A {200 of 100} + B {0 of 100} tie the sum at 200/200 and pass BOTH measurement
 * gates above, yet nothing of item B was ever received. isItemShort() is the
 * module's own per-line predicate and the one the detail panel already renders,
 * so consulting it here is also what keeps the two panes from contradicting.
 *
 * `ordered > 0` is belt-and-braces: isFullyMeasured() already implies at least one
 * line with orderedQty > 0. It is kept so this function never asserts completeness
 * off an empty order on its own, independent of how isFullyMeasured evolves.
 */
export function isComplete(row: GrRow): boolean {
  if (!isFullyMeasured(row)) return false;
  const { ordered } = lineTotals(row.items);
  return ordered > 0 && !row.items.some(isItemShort);
}

/**
 * TRUE when a line was short-received — drives the warn tint. Only a MEASURED line
 * can be short (nothing to fall short of otherwise), and the comparison carries
 * QTY_EPS so float noise on numeric(_,3) quantities cannot invent a phantom
 * shortfall (0.1 + 0.2 style drift, cf. QTY_EPS above).
 */
export function isItemShort(item: GrItem): boolean {
  return isItemMeasured(item) && item.receivedQty + QTY_EPS < item.orderedQty;
}

/** Missing quantity on a short line (0 when not short) — the {n} of shortReceived. */
export function itemShortfall(item: GrItem): number {
  return isItemShort(item) ? item.orderedQty - item.receivedQty : 0;
}

/**
 * The list cell's item summary — the line names joined by " · " (the repo's
 * standard denormalised-label separator, cf. ap-cn-dn-rows sourceLabel). "" when
 * the receipt has no named lines, so the caller em-dashes.
 */
export function itemsLabel(items: readonly GrItem[]): string {
  return items
    .map((it) => it.name.trim())
    .filter((n) => n !== "")
    .join(" · ");
}

/**
 * Format an ISO timestamp as YYYY-MM-DD (UTC, deterministic, ASCII) — the repo's
 * list-date convention (admin-rows / pv-rows formatDate). The prototype printed a
 * Thai Buddhist-era date+time from a mock string; the wire exposes created_at, and
 * a locale/timezone-dependent render would make the G5 gate nondeterministic.
 * "" for a missing/invalid timestamp.
 */
export function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** Only still-open (approved) anchor docs may be received against (POST /gr 409s otherwise). */
export function openAnchors(docs: readonly AnchorDoc[] | undefined): AnchorDoc[] {
  return (docs ?? []).filter((d) => d.status === "approved");
}

/**
 * Group a FULL-unit amount with thousands separators ("902475" -> "902,475"),
 * matching the prototype's Intl fmt (ds.jsx:4-5, th-TH maximumFractionDigits 0).
 * ASCII digits + comma only; NaN / non-finite -> "0". Mirrors boq-rows formatMoney.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Which sub-label a detail line may carry (gr-list.tsx per-line rows):
 *   "full"       -> gr.list.fullyReceived — measured AND met.
 *   "short"      -> gr.list.shortReceived {n} — measured, missed, and the shortfall
 *                   is expressible at the screen's quantity precision.
 *   "unmeasured" -> NO label (the view em-dashes). Two reasons, both "nothing may be
 *                   asserted": the line states no ordered quantity (an explicit
 *                   ordered_qty 0 — it cannot be short, so reading "not short" as
 *                   "fully received" would badge an unmeasured line as complete), or
 *                   it is short by less than the displayed minor unit, where the
 *                   shortfall label would read "missing 0" — a false number. The warn
 *                   tint still follows isItemShort(), which is the TRUE predicate;
 *                   only the wording is withheld.
 */
export type ItemMeasure = "short" | "full" | "unmeasured";

/** Which sub-label a line may carry — see ItemMeasure. */
export function itemMeasure(item: GrItem): ItemMeasure {
  if (!isItemMeasured(item)) return "unmeasured";
  if (!isItemShort(item)) return "full";
  // A shortfall that rounds away at display precision cannot be stated as {n}.
  return formatMoney(itemShortfall(item)) === "0" ? "unmeasured" : "short";
}

/** One detail line as the panel renders it — display-ready, never raw numbers. */
export interface GrItemDisplay {
  /** Accepted quantity, formatted. */
  received: string;
  /** Ordered quantity, or null when the line states none (the view em-dashes). */
  ordered: string | null;
  /** Which sub-label may be asserted (see ItemMeasure). */
  measure: ItemMeasure;
  /** Missing quantity, formatted — the {n} of gr.list.shortReceived. */
  shortfall: string;
  /** Warn tint — the TRUE short predicate, independent of label displayability. */
  short: boolean;
}

/** Display model for one detail line (both halves are the SAME line — one population). */
export function grItemDisplay(item: GrItem): GrItemDisplay {
  return {
    received: formatMoney(item.receivedQty),
    ordered: isItemMeasured(item) ? formatMoney(item.orderedQty) : null,
    measure: itemMeasure(item),
    shortfall: formatMoney(itemShortfall(item)),
    short: isItemShort(item),
  };
}

/**
 * Display model for one GR row — THE ONLY numbers GRList prints, in every tab.
 *
 * Both tabs (receipts + returns) and the detail panel read this one object, so they
 * cannot draw the same GR's quantity from different populations and contradict each
 * other. The invariant it guarantees:
 *
 *   hasLines  -> `received` / `ordered` / `money` are ALL line-population figures
 *                (Σ items received · Σ items ordered · the server's Σ line
 *                received × price), so `money / received` is a real unit price.
 *   !hasLines -> `received` is the receipt header total (its only real quantity)
 *                and `money` is null: the value column em-dashes rather than sit
 *                next to a quantity it does not describe. `ordered` is null too.
 *
 * Every quantity is formatted with formatMoney — the repo's quantity precedent
 * (ds.jsx `fmt`, th-TH maximumFractionDigits 0: pr-form `formatMoney(it.qty)`,
 * boq-editor `formatMoney(row.qty)`, inventory `formatMoney(r.onHand)`). That both
 * groups thousands and stops a client-summed float from reaching the screen as
 * `0.30000000000000004`. Consequence, stated not hidden: a sub-unit quantity
 * displays as 0 — the same 0-dp trade every other quantity column in the app makes.
 */
export interface GrRowDisplay {
  /** Received quantity (see the invariant above), formatted. */
  received: string;
  /** Ordered quantity, or null when no ratio may be formed (view em-dashes, no bar). */
  ordered: string | null;
  /** Progress-bar percent, or null -> draw NO bar. */
  pct: number | null;
  /** Receipt value, or null when the receipt has no line detail (view em-dashes). */
  money: string | null;
  /** Completeness badge — the receipt is fully measured AND every line met its own. */
  complete: boolean;
  /** Rejected quantity, or null when nothing was rejected (view omits the row). */
  rejected: string | null;
  /** TRUE when the per-line list may be rendered; FALSE -> the aggregate fallback. */
  hasLines: boolean;
}

/** Display model for one GR row — see GrRowDisplay for the population invariant. */
export function grRowDisplay(row: GrRow): GrRowDisplay {
  const hasLines = hasLineDetail(row);
  const { received, ordered } = receivedOrdered(row);
  return {
    received: formatMoney(received),
    ordered: ordered === null ? null : formatMoney(ordered),
    pct: rowReceivedPct(row),
    // money is a LINE figure (Σ over the named lines): it may only be printed where
    // the quantity beside it is one too, i.e. when the receipt has line detail. The
    // server's 0 for a line-less receipt means "not recorded", never "zero baht".
    money: hasLines ? formatMoney(row.money) : null,
    complete: isComplete(row),
    rejected: row.rejected > 0 ? formatMoney(row.rejected) : null,
    hasLines,
  };
}

/**
 * Compose the POST /gr lines[] from the aggregate receive entry. The wire has no
 * per-item line table (GAP 1), so the create form collects a single accepted /
 * rejected quantity; the endpoint sums lines[] into received/rejected anyway.
 * Negative inputs are clamped to 0 (the server rejects negatives with 400).
 */
export function buildLines(
  qtyOk: number,
  qtyRejected: number,
): { qty_ok: number; qty_rejected: number }[] {
  return [
    {
      qty_ok: Number.isFinite(qtyOk) && qtyOk > 0 ? qtyOk : 0,
      qty_rejected: Number.isFinite(qtyRejected) && qtyRejected > 0 ? qtyRejected : 0,
    },
  ];
}

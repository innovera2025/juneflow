/*
 * GR list-row helpers for GRList (P2-WEB-11) — pure, i18n-free, ASCII-only logic
 * derived from pototype/gr.jsx GRList (L17-205) + the ds.jsx STATUS map (L84-92)
 * the prototype's <StatusBadge> reads.
 *
 * The prototype held GR docs in a local GR_ROWS array (gr.jsx:3-9) whose rows
 * carried denormalised display strings (vendor name / items / date / receiver / a
 * hardcoded money `amount` / an ordered qty for the received-vs-ordered bar). §0
 * rule 3: that mock array is dropped — the list is the real server catalogue
 * (GET /gr, use-gr.ts) whose doc wire (apps/api/src/routes/gr.ts grWire) is ONLY
 *   { id, no, po_id, wo_id, status, received, rejected, photos }
 * A GR anchors on EITHER a material PO (po_id) or a subcon WO (wo_id) — never both
 * (B-070 GR-from-WO). The prototype's ref display number ("PO-2026-0288") resolves
 * from po_id / wo_id via GET /po + GET /wo (§0 rule 3, FK-as-string -> real id join,
 * mirrors boq-rows projectNameById).
 *
 * WIRE GAPS (reported, never fabricated — see the GRList header for the full list):
 * the grWire has NO money column (prototype's value column, GAP 2), NO vendor, NO
 * date, NO received-by, NO per-line item table (GAP 1), and NO ordered quantity on
 * the list read (ordered is derived from the source PR only inside POST /gr, GAP 3),
 * so the received-vs-ordered progress bar and the partial/complete badges have no
 * list-wire source. Those cells render an em-dash / are omitted; this module never
 * invents values for them.
 */

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
  /** Total accepted quantity (server SUM of the receipt lines' qty_ok). */
  received: number;
  /** Total rejected quantity (SUM of qty_rejected -> defect_report). */
  rejected: number;
  /** Attached delivery-note / photo urls. */
  photos: string[];
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

/**
 * Narrow an opaque /gr Entity row to the GrRow the table needs. Multi-word fields
 * accept snake_case (server convention) or camelCase for robustness (mirrors
 * boq-rows toBoqRow). Missing fields default (0 / "" / []).
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
 * Filter the docs by the toolbar free-text query over no + resolved ref no (the
 * prototype also searched vendor, which has no list-wire source, so it is dropped).
 * An empty query means "no filter".
 */
export function filterByQuery(
  rows: readonly GrRow[],
  q: string,
  poNos: Map<string, string>,
  woNos: Map<string, string>,
): GrRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((r) => (r.no + resolveRefNo(r, poNos, woNos)).toLowerCase().includes(needle));
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

/*
 * FA Adjustment row helpers (fa.adjust) — pure, i18n-free, ASCII-only logic ported from
 * pototype/fa.jsx FAAdjust (L583-661) + AdjustDetail (L778-810).
 *
 * The prototype held the adjustments in a local ADJ_ROWS seed (fa.jsx L575-581) with a rich
 * {no, before, after, diff, reason, date} shape. Section-0 rule 3: that seed is dropped — the
 * list is the real server catalogue (GET /fa/adjustments, apps/api/src/routes/fa.ts
 * listAdjustments -> adjustmentWire). The opaque Entity row (snake_case) is:
 *   { id, asset_id, kind:'revalue'|'write_off', amount:number, currency_code, jv_id:string|null,
 *     status, memo:string|null, created_at }  (fa.ts adjustmentWire).
 *
 * HONEST GAPS (never fabricated) — see fa-adjust.tsx for the screen-level notes:
 *   - the wire has ONE `amount` (revalue: the new value; write_off: the removed carrying amount)
 *     and NO before-value / gain-loss columns -> those cells em-dash.
 *   - there is NO document-number column -> the "no" cell shows the real record `id`.
 *   - the server has NO 'sale' kind (write_off covers disposal) -> the sale tab is always 0
 *     (honest empty, mirrors gl.inbox scheduled/error).
 *   - `jv_id` is null for a revalue (its GL posting is deferred — no revaluation-surplus account
 *     in COA_SEED) and set for a posted write-off -> the "view JV" affordance keys off it.
 *
 * Every colour the .tsx paints from these rows is an @juneflow/tokens var(); no Thai/baht leaks
 * here (B-073).
 */

/** Adjustment kind as the wire carries it. The server only ever writes revalue / write_off. */
export type AdjustKind = "revalue" | "write_off" | string;

/** An FA adjustment as the list consumes it (GET /fa/adjustments row, narrowed). */
export interface FaAdjustment {
  id: string;
  /** The adjusted asset's id (data, mono). */
  assetId: string;
  /** Adjustment kind (revalue | write_off). */
  kind: AdjustKind;
  /** The single money figure the wire carries (revalue: new value; write_off: removed book value). */
  amount: number;
  /** Currency of `amount` ("" when absent). */
  currencyCode: string;
  /** Posting JV id when posted; "" when deferred (revalue) / absent. */
  jvId: string;
  /** Lifecycle status (the server writes 'approved'). */
  status: string;
  /** Free-text memo the server generated ("" -> the reason cell em-dashes). */
  memo: string;
  /** Row creation timestamp (the only date on the wire). */
  createdAt: string;
}

/** Read a string field off an opaque row; "" when absent/null. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row, else 0. */
function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Narrow an opaque /fa/adjustments Entity row to the FaAdjustment the list needs. */
export function toFaAdjustment(e: Record<string, unknown>): FaAdjustment {
  return {
    id: str(e.id),
    assetId: str(e.asset_id ?? e.assetId),
    kind: str(e.kind),
    amount: num(e.amount),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    jvId: str(e.jv_id ?? e.jvId),
    status: str(e.status),
    memo: str(e.memo),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/** Tab kinds on the adjust screen (sale has no wire -> always empty). */
export type AdjustTab = "all" | "revalue" | "write_off" | "sale";

/**
 * Badge discriminant + token tones for an adjustment kind. `badge` maps to the label i18n key in
 * the .tsx (revalue -> Revalue / writeoff -> Write-Off / sale -> Sale). A revalue tones ok (green),
 * a write-off tones danger (red), a sale tones info; anything else is neutral surface.
 */
export interface KindMeta {
  badge: "revalue" | "writeoff" | "sale" | "other";
  bg: string;
  fg: string;
}

export function adjustKindMeta(kind: AdjustKind): KindMeta {
  switch (kind) {
    case "revalue":
      return { badge: "revalue", bg: "var(--ok-soft)", fg: "var(--ok)" };
    case "write_off":
      return { badge: "writeoff", bg: "var(--danger-soft)", fg: "var(--danger)" };
    case "sale":
      return { badge: "sale", bg: "var(--info-soft)", fg: "var(--info)" };
    default:
      return { badge: "other", bg: "var(--surface-3)", fg: "var(--text-2)" };
  }
}

/** Count of rows of a given tab kind (all -> total; sale -> 0, honest empty). */
export function countByKind(rows: readonly FaAdjustment[], tab: AdjustTab): number {
  if (tab === "all") return rows.length;
  return rows.filter((r) => r.kind === tab).length;
}

/** Rows of a given tab kind (all -> every row; sale -> [] since the server writes no sale). */
export function filterByKind(rows: readonly FaAdjustment[], tab: AdjustTab): FaAdjustment[] {
  if (tab === "all") return [...rows];
  return rows.filter((r) => r.kind === tab);
}

/**
 * Group a money amount with thousands separators ("1000000" -> "1,000,000"), ASCII digits +
 * comma only (no baht symbol / decimals — the baht glyph is an i18n key on the screen);
 * non-finite -> "0".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format the row's created_at as an ISO date (YYYY-MM-DD, UTC — deterministic, ASCII). The
 * prototype showed a Thai buddhist date, but that came from a mock `date` field; the wire only
 * exposes created_at (stored UTC). Returns "" for a missing/invalid timestamp (cell em-dashes).
 */
export function formatDate(createdAt: string): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

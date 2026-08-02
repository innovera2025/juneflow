/*
 * Acceptance-Center list-row helpers for AcceptanceCenter (route `accept`, read-only)
 * — pure, i18n-free, ASCII-only logic narrowed from pototype/company-accept.jsx
 * AcceptanceCenter (L121-222) + the ACCEPT_TYPES config (L102-107).
 *
 * The prototype held every queue item in a single local ACCEPT_ITEMS array
 * (company-accept.jsx L108-119) whose rows carried denormalised display strings
 * (owner / value / wait days / due text / attachment lists) across four different
 * work-types. §0 rule 3: that mock is dropped — the list is FOUR real server feeds,
 * one per ?type on GET /acceptance-center (apps/api/src/routes/subcon.ts
 * listAcceptanceCenter, use-accept.ts). There is NO merged "all" endpoint, so the
 * screen fans the four typed GETs in client-side. Each feed is heterogeneous:
 *   period (=> subcon tab)  : periodWire { id, contract_id, seq, basis, target, pct,
 *                             amount (MONEY), currency_code, status } + project_name,
 *                             title(=contract.no), owner(=null), defect(string[]|null).
 *   house  (=> handover tab): periodWire + type "house" + project_name,
 *                             title(=contract.no), owner(=null).
 *   pm     (=> pm tab)      : pmAcceptWire { id, type "pm", asset_id, tech, template_id,
 *                             checkin_gps } + project_name, title(composed asset name),
 *                             owner(=tech, REAL). NO money, NO status.
 *   gr     (=> gr tab)      : grAcceptWire { id, type "gr", no, po_id, wo_id, received,
 *                             rejected, status } + project_name, title(=gr.no),
 *                             owner(=null). NO money. This feed IS the return/defect
 *                             queue (rejected > 0).
 *
 * WIRE GAPS (reported honestly, never fabricated):
 *   - wait + due columns + overdue: NO column on any feed -> the view renders an em-dash
 *     for both cells, the overdue row-highlight/red styling is dropped, and the KPI
 *     "overdue {n}" count reads 0.
 *   - value: only the period/house feeds carry `amount` -> pm/gr rows em-dash.
 *   - owner: real only on the pm feed (=tech) -> other feeds em-dash.
 *   - doc#/descriptive split: period/house/gr carry a doc number (title) with NO second
 *     descriptive line; pm carries the composed asset title but NO doc number.
 *   - attachments (clip count / DMS doc list): NO docs field on any feed -> omitted.
 *   - `seq` work-period ordinal suffix: NO i18n key (B-116) -> the suffix is OMITTED, the
 *     doc number renders alone (never minted, never mis-borrowed from
 *     sales.down.fieldInstallmentNo which is a down-payment installment, not a subcon
 *     work-period ordinal).
 */

/** Which ACCEPT_TYPES bucket a row belongs to (drives its badge / colour / route). */
export type AcceptKind = "subcon" | "gr" | "pm" | "handover";

/** A queue item as the table consumes it (one narrowed acceptance-center row). */
export interface AcceptRow {
  /** Row id (React key only — never surfaced as a doc number). */
  id: string;
  /** Which feed produced the row (period=>subcon, house=>handover, pm, gr). */
  kind: AcceptKind;
  /** Doc number (period/house contract.no · gr.no); "" for pm (no doc number). */
  doc: string;
  /** Descriptive line (pm composed asset title); "" for period/house/gr. */
  descr: string;
  /** Owning project name (server-resolved); "" when unresolved. */
  project: string;
  /** Acceptance value in FULL currency units (period/house `amount`); 0 otherwise. */
  value: number;
  /** True only when the feed carries money (period/house) — else the cell em-dashes. */
  hasValue: boolean;
  /** Responsible inspector (pm `tech`); "" for period/house/gr. */
  owner: string;
  /** Lifecycle status (period {delivered|inspecting|rejected}, gr gr-status; "" for pm). */
  status: string;
  /** Defect item descriptions (period rejected rows only); [] otherwise. */
  defect: string[];
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
 * Narrow an opaque /acceptance-center Entity row to the AcceptRow the table needs,
 * given the feed `kind` it came from (the wire is heterogeneous per ?type, so the
 * feed decides how `title`/`amount`/`owner` map). Multi-word fields accept snake_case
 * (server convention) or camelCase for robustness (mirrors gr-rows.toGrRow). The
 * `title` field is a doc number on period/house/gr but a descriptive asset name on
 * pm, so it is routed to `doc` or `descr` accordingly. Missing fields default.
 */
export function toAcceptRow(e: Record<string, unknown>, kind: AcceptKind): AcceptRow {
  const title = str(e.title);
  const hasValue = kind === "subcon" || kind === "handover";
  return {
    id: str(e.id),
    kind,
    doc: kind === "pm" ? "" : title,
    descr: kind === "pm" ? title : "",
    project: str(e.project_name ?? e.projectName),
    value: hasValue ? num(e.amount) : 0,
    hasValue,
    owner: kind === "pm" ? str(e.owner) : "",
    status: str(e.status),
    defect: strArr(e.defect),
  };
}

/**
 * Whether a row belongs to the return/defect ("rejected") set. The gr feed IS the
 * return/defect queue (every row is rejected>0). A period (subcon) row is rejected
 * only when its status is "rejected". pm/house have no rejected concept (spec). This
 * drives both the rejected tab (period-rejected ∪ gr feed) and the red row highlight.
 */
export function isRejected(r: AcceptRow): boolean {
  if (r.kind === "gr") return true;
  if (r.kind === "subcon") return r.status === "rejected";
  return false;
}

/** Count rejected rows across a set (KPI-total sub "rejected {count}"). */
export function rejectedCount(rows: readonly AcceptRow[]): number {
  return rows.filter(isRejected).length;
}

/**
 * Filter the rows by the toolbar free-text query over doc + descriptive line + project
 * + owner (the prototype searched `r.doc + r.title + r.project + r.owner`; the fields
 * with no wire source, e.g. the fabricated owners, simply contribute "" and never match
 * a fabricated value). An empty query means "no filter".
 */
export function filterByQuery(rows: readonly AcceptRow[], q: string): AcceptRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [...rows];
  return rows.filter((r) =>
    (r.doc + r.descr + r.project + r.owner).toLowerCase().includes(needle),
  );
}

/**
 * Join a rejected period row's defect item descriptions for the reject-defect line
 * (accept.rejectDefectLine). The items are free-text server data (§0 rule 3) — the separator is display
 * concatenation, not invented copy. "" when the row carries no defect items (e.g. a
 * gr row, whose reject has no defect-text column -> the line is omitted upstream).
 */
export function defectText(r: AcceptRow): string {
  return r.defect.join(", ");
}

/**
 * Group a FULL-unit amount with thousands separators ("420000" -> "420,000"), matching
 * the prototype's Intl fmt (ds.jsx th-TH, maximumFractionDigits 0). ASCII digits + comma
 * only; NaN / non-finite -> "0". Mirrors gr-rows / land-bank formatMoney.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

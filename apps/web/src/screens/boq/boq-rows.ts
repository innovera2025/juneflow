/*
 * BOQ list-row helpers for BOQList (P2-WEB-02) — pure, i18n-free, ASCII-only logic
 * derived from pototype/boq-list.jsx BOQList (L64-211) + the ds.jsx STATUS map (L84-92)
 * the prototype's <StatusBadge> reads.
 *
 * The prototype held BOQ docs in a local BOQStore (boq-list.jsx:6-31) whose rows carried
 * denormalised display strings (project/phase/block/owner/updated) + a hardcoded value.
 * §0 rule 3: that mock store is dropped — the list is the real server catalogue
 * (GET /boq, use-boq.ts) whose doc wire is
 *   { id, no, name, scope, project_id, version, status, currency_code, total }
 * (apps/api/src/routes/boq.ts docWire; `total` is the real SUM of the doc's items, never
 * the mock's hardcoded value). The prototype's project NAME resolves from project_id via
 * GET /projects (§0 rule 3, FK-as-string -> real id join); phase/block are mock
 * decorations with no real column and collapse into the free-text `scope`.
 *
 * WIRE GAP (reported, not fabricated): the prototype's `owner` (ผู้รับผิดชอบ) and `updated`
 * (อัปเดตล่าสุด) columns have NO source in docWire — boq_doc has no owner column, and
 * updatedAt exists on the table but is not exposed on the wire (a contract/api change
 * outside the web zone). The view renders an em-dash placeholder for those two cells; this
 * module never invents values for them.
 */

/** A BOQ doc as the table consumes it (GET /boq row, narrowed from the opaque wire). */
export interface BoqRow {
  id: string;
  no: string;
  name: string;
  /** Free-text scope (e.g. "B-Type1 · 84 units") — the real column phase/block collapse into. */
  scope: string;
  /** Owning project id (resolved to a name via GET /projects in the view). */
  projectId: string;
  version: number;
  /** Lifecycle status — "draft" | "pending" | "approved" | "revise" (boq_doc_status enum). */
  status: string;
  currency_code: string;
  /** Doc total in FULL currency units (server SUM of its items). */
  total: number;
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
 * Narrow an opaque /boq Entity row to the BoqRow the table needs. Multi-word fields accept
 * snake_case (server convention) or camelCase for robustness (mirrors cc-rows.ts). Missing
 * fields default (0 / "").
 */
export function toBoqRow(e: Record<string, unknown>): BoqRow {
  return {
    id: str(e.id),
    no: str(e.no),
    name: str(e.name),
    scope: str(e.scope),
    projectId: str(e.project_id ?? e.projectId),
    version: num(e.version),
    status: str(e.status),
    currency_code: str(e.currency_code ?? e.currencyCode),
    total: num(e.total),
  };
}

/**
 * Status-badge tone (ds.jsx STATUS map, L84-92, read by <StatusBadge status={d.status}>).
 * bg/fg are @juneflow/tokens var() references (rule 6); `dot` is the prototype-verbatim
 * STATUS.<status>.dot hex (no matching @juneflow/tokens value, B-037(a)). Unknown statuses
 * fall back to draft, exactly like the prototype's `STATUS[status] || STATUS.draft`.
 */
export function statusTone(status: string): { bg: string; fg: string; dot: string } {
  switch (status) {
    case "approved":
      return { bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" };
    case "pending":
      return { bg: "var(--warn-soft)", fg: "var(--warn)", dot: "#D97706" };
    case "revise":
      return { bg: "var(--info-soft)", fg: "var(--info)", dot: "#1D4ED8" };
    default:
      return { bg: "var(--draft-soft)", fg: "var(--draft)", dot: "#94A3B8" };
  }
}

/** boq-strings.json phrase-key name for a status label (statusDraft/Pending/Approved/Revise). */
export function statusStringName(
  status: string,
): "statusDraft" | "statusPending" | "statusApproved" | "statusRevise" {
  switch (status) {
    case "approved":
      return "statusApproved";
    case "pending":
      return "statusPending";
    case "revise":
      return "statusRevise";
    default:
      return "statusDraft";
  }
}

/** Version display label "v{n}" (boq-list.jsx renders d.ver, e.g. "v3"); n<=0 -> "v1". */
export function versionLabel(version: number): string {
  return "v" + (version > 0 ? version : 1);
}

/**
 * Group a FULL-unit amount with thousands separators ("12400000" -> "12,400,000"),
 * matching the prototype's Intl fmt (ds.jsx:4-5, th-TH maximumFractionDigits 0). ASCII
 * digits + comma only (no baht symbol / decimals); NaN / non-finite -> "0". Mirrors
 * cc-rows.ts formatMoney.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** KPI "value in millions" (boq-list.jsx:121 `(totalValue/1e6).toFixed(2)`). */
export function millionsValue(totalUnits: number): string {
  return (totalUnits / 1e6).toFixed(2);
}

/** Filter inputs for the toolbar (project id + status code + free-text query). */
export interface BoqFilter {
  projectId: string;
  status: string;
  q: string;
}

/**
 * Filter the docs exactly like boq-list.jsx:75-81 — project by id, status by code, and the
 * free-text query over no + name + scope (the prototype also searched `owner`, which has no
 * real column, so it is dropped). An empty field means "no filter on that field".
 */
export function filterBoqRows(rows: readonly BoqRow[], f: BoqFilter): BoqRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((d) => {
    if (f.projectId && d.projectId !== f.projectId) return false;
    if (f.status && d.status !== f.status) return false;
    if (q && !(d.no + d.name + d.scope).toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Sum the docs' totals (boq-list.jsx:82 `rows.reduce((s,d)=>s+d.value,0)`). */
export function sumTotal(rows: readonly BoqRow[]): number {
  return rows.reduce((s, d) => s + d.total, 0);
}

/** Count docs whose status is in the given set (boq-list.jsx:122-123 KPI aggregates). */
export function countByStatuses(rows: readonly BoqRow[], statuses: readonly string[]): number {
  const set = new Set(statuses);
  return rows.filter((d) => set.has(d.status)).length;
}

/** Build an id -> name map from the /projects rows (for the scope column + project filter). */
export function projectNameById(
  projects: readonly { id: string; name: string }[] | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of projects ?? []) if (p.id) map.set(p.id, p.name);
  return map;
}

/**
 * Distinct names of one hierarchy `kind` (phase/block/unit) for the create-form cascade
 * (GET /projects/{id}/hierarchy rows). Pre-order, de-duplicated. Real data replaces the
 * prototype's hardcoded BOQ_PROJECTS cascade (§0 rule 3); when the project has no such
 * nodes the list is empty and the dropdown degrades to its base option.
 */
export function hierarchyNames(
  nodes: readonly Record<string, unknown>[],
  kind: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of nodes) {
    if (str(n.kind) === kind) {
      const nm = str(n.name);
      if (nm && !seen.has(nm)) {
        seen.add(nm);
        out.push(nm);
      }
    }
  }
  return out;
}

/**
 * Compose the doc's scope string from the create-form pickers, verbatim boq-list.jsx:284
 * (`unit === ALL ? `${block} · total` : unit`). The Thai labels are passed in from
 * boq-strings.json so no Thai literal sits in this ASCII-only module.
 */
export function composeScope(
  block: string,
  unit: string,
  allUnitsLabel: string,
  totalSuffix: string,
): string {
  return unit === allUnitsLabel ? block + " · " + totalSuffix : unit;
}

/**
 * Suggest the next "BOQ-{year}-NNN" code not already taken, mirroring BOQStore.nextNo
 * (boq-list.jsx:23-27). Only 3-digit-suffixed codes count toward the running number; the
 * prototype's fixed "2026" becomes the current CE year (dynamic, B-060 precedent).
 */
export function nextBoqNo(
  existingNos: readonly string[],
  year: number = new Date().getFullYear(),
): string {
  const taken = new Set(existingNos);
  const prefix = "BOQ-" + year + "-";
  const seq = new RegExp("^BOQ-" + year + "-\\d{3}$");
  let n = existingNos.filter((no) => seq.test(no)).length + 1;
  let cand = prefix + String(n).padStart(3, "0");
  while (taken.has(cand)) {
    n += 1;
    cand = prefix + String(n).padStart(3, "0");
  }
  return cand;
}

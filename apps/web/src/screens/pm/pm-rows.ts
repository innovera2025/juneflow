/*
 * PM Asset-Registry list-row helpers for PMAssets (pm.assets, the "light" list
 * port) — pure, i18n-free, ASCII-only logic derived from pototype/pm.jsx PMAssets
 * (L155-221) + PMAssetForm (L223-257).
 *
 * The prototype held its catalogue in the local PM_ASSETS_BY_TYPE mock arrays
 * (pm.jsx L7-37) whose rows carried denormalised display strings (code/name/last/
 * status/contract-code). PLAN.md section 0 rule 3: that mock is dropped as data —
 * the list is the real server catalogue (GET /pm/assets, use-pm.ts) whose opaque
 * Entity wire is:
 *   { id, contract_id, name, code, kind, site, cycle, next_due }   (apps/api/src/
 *   routes/pm.ts assetWire — `name`/`code` gained real columns in migration 0034,
 *   B-110, so they now ride the wire alongside kind/site/cycle/next_due).
 *
 * WIRE GAPS (reported, never fabricated — see pm-assets.tsx header for the full
 * list). `name` + `code` are now REAL columns (migration 0034). The wire still
 * carries NO `last` (last-PM date) and NO `status` column; the `contract_id` uuid
 * resolves to a contract via /pm/contracts (now live), but the contract wire has NO
 * human code/no column (only id/sla/mode/value/...), so the contract CODE still
 * cannot be shown. So the view renders an em-dash for last / status / contract; this
 * module never invents values for them and (deliberately) never resolves a status —
 * there is no wire signal to derive one.
 *
 * `search` in the view runs over the human-facing wire fields (code / name / kind /
 * site — `code`+`name` are real since 0034, matching the pm.searchPh "code/name/site"
 * placeholder); `distinctKinds` feeds the kind filter with the kinds actually present
 * in the loaded rows; the "{n}" count is the filtered length. All ASCII (B-073) — no
 * Thai lives here.
 */

/** A PM asset as the table consumes it (GET /pm/assets row, narrowed from wire). */
export interface AssetRow {
  id: string;
  /** Human asset code (e.g. LIFT-A01) — a real column since migration 0034 (B-110). */
  code: string;
  /** Asset name / model — a real column since migration 0034 (B-110). */
  name: string;
  /** Owning PM contract id (uuid). Resolves to a contract via /pm/contracts (now live),
   *  but the contract wire has no human code column — the view em-dashes it, never
   *  this raw uuid. */
  contractId: string;
  /** Equipment kind (e.g. lift / pump) — shown in a Tag + drives the kind filter. */
  kind: string;
  /** Location / site label. */
  site: string;
  /** PM cycle label (monthly / quarterly / ...). */
  cycle: string;
  /** Next-due schedule label (real column) — em-dash when blank. */
  nextDue: string;
}

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/**
 * Narrow an opaque /pm/assets Entity row to the AssetRow the table needs. Accepts
 * snake_case (server convention) or camelCase for robustness (mirrors toWoRow).
 * Missing fields default to "".
 */
export function toAssetRow(e: Record<string, unknown>): AssetRow {
  return {
    id: str(e.id),
    code: str(e.code),
    name: str(e.name),
    contractId: str(e.contract_id ?? e.contractId),
    kind: str(e.kind),
    site: str(e.site),
    cycle: str(e.cycle),
    nextDue: str(e.next_due ?? e.nextDue),
  };
}

/**
 * The distinct kinds present in the loaded rows, in first-seen order, with blanks
 * dropped — the source for the kind filter's options (pm.jsx L161
 * `[...new Set(pmAssets().map((a) => a.kind))]`).
 */
export function distinctKinds(rows: readonly AssetRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const k = r.kind;
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

/**
 * Client-side filter (pm.jsx L162-166). `q` matches over the human-facing fields
 * code + name + kind + site (the prototype matched code/name; both are real columns
 * since migration 0034, matching the pm.searchPh "code/name/site" placeholder). The
 * raw uuid `id` is never searched (not user-facing). `kind` (when non-empty) restricts
 * to that exact kind. Both filters are case-insensitive on the query; an empty
 * query/kind is a no-op. Never mutates the input.
 */
export function filterAssets(
  rows: readonly AssetRow[],
  q: string,
  kind: string,
): AssetRow[] {
  const query = q.trim().toLowerCase();
  return rows.filter((r) => {
    if (query && !(r.code + r.name + r.kind + r.site).toLowerCase().includes(query)) {
      return false;
    }
    if (kind && r.kind !== kind) {
      return false;
    }
    return true;
  });
}

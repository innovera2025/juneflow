/*
 * SubconProgress derivation helpers (subcon.progress port, gate G3) — pure,
 * i18n-free, ASCII-only logic derived from pototype/subcon.jsx SubconProgress
 * (L27-264) + CheckRow (L266-281).
 *
 * PLAN.md section 0 rule 3 (real-wire-over-mock, THIN-HONEST — Wei B-229 ruling): the
 * prototype's local SUBCONS / PROGRESS_PAYMENTS / VARIATIONS mocks (denormalised
 * subcon rows with hardcoded paid/retention/completion, a single fixed WO contract,
 * a mock variation ledger) are DROPPED. This screen renders ONLY what the live
 * backend serves and em-dashes the rest:
 *   GET /vendors?kind=subcon            -> the subcon list (id/name/kind/status).
 *   GET /subcon-contracts               -> grouped by vendor_id for the per-vendor
 *                                          contract COUNT + Σ VALUE (contractWire:
 *                                          { id, no, vendor_id, project_id, value,
 *                                            currency_code, retention_pct, start, end }).
 *   GET /subcon-contracts/{id}/periods  -> the selected contract's payment timeline
 *                                          (periodWire narrowed by subcon-accept-rows
 *                                          toPeriodRow; status -> the REAL enum badge).
 *
 * WIRE GAPS (reported, never fabricated — see the SubconProgress view header for the
 * full list). The vendor wire carries NO work-scope/type, NO contact, NO "since",
 * NO work-lifecycle status (its `status` is the account enum, not active/closing/pending). The
 * contract wire carries NO status. The period wire carries NO paid amount, NO period
 * retention, NO GR doc/date. There is NO variation-order feed for a subcon (a
 * variation_order attaches to a po_id only). This module never invents values for
 * those — the view renders an em-dash. Only the money-SAFE display sums (a count, or
 * a Σ of server money values) are derived here; nothing is minted or computed as JV.
 */
import { toPeriodRow, type PeriodRow } from "./subcon-accept-rows";
import { type ContractRow } from "./subcon-rows";

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/* --------------------------------------------------------------------------- */
/* vendor narrowing (GET /vendors?kind=subcon left list)                        */
/* --------------------------------------------------------------------------- */

/** A subcon vendor as the progress left-list consumes it (/vendors row, narrowed). */
export interface SubconVendor {
  id: string;
  name: string;
  /** vendor_kind enum (supplier | subcon); the list keeps only "subcon". */
  kind: string;
  /** Account status enum (active | inactive | ...); NOT the work lifecycle. */
  status: string;
}

/** Narrow an opaque /vendors Entity row to the SubconVendor the left list needs. */
export function toSubconVendor(e: Record<string, unknown>): SubconVendor {
  return {
    id: str(e.id),
    name: str(e.name),
    kind: str(e.kind),
    status: str(e.status),
  };
}

/**
 * Keep only the subcontractor vendors (kind === "subcon"). The list feed is already
 * server-filtered (GET /vendors?kind=subcon); this is a defensive client guard so a
 * full-catalogue response can never leak a supplier into the subcon list.
 */
export function subconVendors(vendors: readonly SubconVendor[]): SubconVendor[] {
  return vendors.filter((v) => v.kind === "subcon");
}

/**
 * Case-insensitive name filter for the left-list search box — a pure client view
 * filter over REAL rows (the prototype's decorative input, wired honestly over the
 * server catalogue, no mock). An empty query returns the list unchanged.
 */
export function filterVendorsByName(
  vendors: readonly SubconVendor[],
  query: string,
): SubconVendor[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...vendors];
  return vendors.filter((v) => v.name.toLowerCase().includes(q));
}

/* --------------------------------------------------------------------------- */
/* per-vendor contract aggregates (GET /subcon-contracts grouped by vendor_id)  */
/* --------------------------------------------------------------------------- */

/** The contracts owned by one vendor (group /subcon-contracts by vendor_id). */
export function contractsForVendor(
  contracts: readonly ContractRow[],
  vendorId: string,
): ContractRow[] {
  if (!vendorId) return [];
  return contracts.filter((c) => c.vendorId === vendorId);
}

/** Per-vendor contract COUNT (left-list count suffix + header contracts button) — REAL. */
export function vendorContractCount(
  contracts: readonly ContractRow[],
  vendorId: string,
): number {
  return contractsForVendor(contracts, vendorId).length;
}

/**
 * Per-vendor Σ contract VALUE (left-list thousands value + header statContractTotal) — a REAL,
 * money-SAFE display sum of server contract values (FULL units), never a JV compute.
 */
export function vendorTotalValue(
  contracts: readonly ContractRow[],
  vendorId: string,
): number {
  return contractsForVendor(contracts, vendorId).reduce((s, c) => s + c.value, 0);
}

/**
 * The vendor's active contract that drives the active-contract card + its
 * periods query. The contract wire carries NO status, so "active" cannot be inferred;
 * the first contract of the vendor is used (undefined when the vendor has none).
 */
export function activeContractFor(
  contracts: readonly ContractRow[],
  vendorId: string,
): ContractRow | undefined {
  return contractsForVendor(contracts, vendorId)[0];
}

/**
 * How many subcon vendors have >= 1 contract (KPI-1 working-count sub) — a REAL
 * count derived from the two feeds already held (distinct vendor_ids in the contract
 * list that are subcon vendors). No per-contract fan-out; a single-feed aggregation.
 */
export function workingVendorCount(
  vendors: readonly SubconVendor[],
  contracts: readonly ContractRow[],
): number {
  const subconIds = new Set(subconVendors(vendors).map((v) => v.id).filter(Boolean));
  const working = new Set<string>();
  for (const c of contracts) if (subconIds.has(c.vendorId)) working.add(c.vendorId);
  return working.size;
}

/* --------------------------------------------------------------------------- */
/* period timeline (GET /subcon-contracts/{id}/periods)                         */
/* --------------------------------------------------------------------------- */

/**
 * A work period as the progress timeline consumes it — the subcon-accept PeriodRow
 * plus the enriched `title` (subcon.ts enrichPeriodRow) the detail column shows. The
 * title is "" when the enrichment is absent, so the view em-dashes rather than
 * rendering an empty label.
 */
export interface ProgressPeriod extends PeriodRow {
  /** Enriched period title/description (subcon.ts enrichPeriodRow) — "" when absent. */
  title: string;
}

/** Narrow an opaque periods Entity row to a ProgressPeriod (PeriodRow + title). */
export function toProgressPeriod(e: Record<string, unknown>): ProgressPeriod {
  return { ...toPeriodRow(e), title: str(e.title) };
}

/** The periods in seq order (the timeline renders periods ascending). */
export function sortPeriodsBySeq(periods: readonly ProgressPeriod[]): ProgressPeriod[] {
  return [...periods].sort((a, b) => a.seq - b.seq);
}

/**
 * The timeline tfoot value total — a REAL, money-SAFE display sum of every period's
 * contract amount (FULL units). The tfoot paid / retention totals have NO wire field
 * (see WIRE GAPS) and are em-dashed by the view, not summed here.
 */
export function periodsTotal(periods: readonly ProgressPeriod[]): number {
  return periods.reduce((s, p) => s + p.amount, 0);
}

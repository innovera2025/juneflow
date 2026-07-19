// Shared EVM (Earned Value) time-series loader — the ONE build-once aggregation
// helper for group-C's S-curve / variance surfaces (recon
// agents/orch-b-recon/flow-a-group-c.md §3.2). Building it here once means the
// dashboard budget-vs-actual S-curve (GET /dashboard/budget-actual backfill),
// RPT-005 EVM (GET /boq/reports/evm) and RPT-004 variance (GET /boq/reports/
// variance) all read the same store the same tenant-scoped way, instead of three
// independent copies that could drift.
//
// evm_snapshot is PROJECT-ANCHORED — it carries NO company_id column, so it MUST
// be read THROUGH the projects hop (TenantDb.selectThrough), exactly like
// boq_doc / subcon_contract / project_node. The tenant predicate AND-anchors on
// project.company_id, so no cross-tenant snapshot can ever be returned.
import { eq } from "drizzle-orm";
import { evmSnapshots, projects } from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";

/** One EVM period, money as finite baht numbers (drizzle numeric → number). */
export interface EvmSeriesRow {
  period: string;
  periodEnd: string;
  pv: number;
  ev: number;
  ac: number;
  budget: number;
  bac: number;
  currencyCode: string;
}

type SnapshotRow = typeof evmSnapshots.$inferSelect;

/** Coerce a drizzle numeric (string) / number / null to a finite number, else 0. */
function num(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Load a tenant's EVM snapshot series, ordered by period ASC. The read is scoped
 * THROUGH the projects hop (evm_snapshot has no company_id — company scope flows
 * project_id → project.company_id), so a caller can never read another tenant's
 * snapshots. `projectId` is OPTIONAL:
 *   - provided → that ONE project's snapshots (a foreign id resolves to nothing
 *     through the join, so the caller gets an empty series, never a leak);
 *   - null → every owned project's snapshots (still tenant-scoped by the join).
 * Honest-empty ([]) when no snapshots exist (a tenant/project without seed).
 * period is a 'YYYY-MM' key, so a lexical sort IS the chronological order.
 */
export async function loadEvmSeries(
  db: TenantDb,
  projectId: string | null,
): Promise<EvmSeriesRow[]> {
  const rows = (await db.selectThrough(
    evmSnapshots,
    [{ fk: evmSnapshots.projectId, parent: projects }],
    projectId ? eq(evmSnapshots.projectId, projectId) : undefined,
  )) as SnapshotRow[];

  return rows
    .map((r) => ({
      period: r.period,
      periodEnd: r.periodEnd as unknown as string,
      pv: num(r.pv),
      ev: num(r.ev),
      ac: num(r.ac),
      budget: num(r.budget),
      bac: num(r.bac),
      currencyCode: r.currencyCode,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

// GL posting — the SINGLE source of truth for the doc-type → account map and the
// helpers a source money doc uses to become a balanced JV. Shared by /gl/post
// (gl.ts), CN approve (ar.ts), and FA depreciation + revalue/write-off (fa.ts) so
// the double-entry account map + JV-numbering + tenant-scoped account resolution
// never diverge across the finance handlers.
//
// POSTING MAP — DERIVED from the seed JV_BOOKS (Wei B-122 Q2: derive from
// JV_BOOKS → fixed map in code → confirm-before-merge). Each rule cites whether
// it has a REAL seed exemplar or is EXTRAPOLATED (no exemplar — flagged for the
// map-confirm blocker, never silently invented):
//   rv       Dr 1020 bank      / Cr 1030 AR        REAL  (JV-2026-0418 "REM")
//   gr       Dr 5020 materials / Cr 2010 AP        REAL  (JV-2026-0416 "GR auto")
//   pv       Dr 2010 AP        / Cr 1020 bank      EXTRAPOLATED (no PV exemplar)
//   payroll  Dr 5030 labor     / Cr 1020 bank      EXTRAPOLATED (no payroll exemplar)
// Direct-posting handlers (not inbox-sourced) use the ACCT codes below:
//   fa depr  Dr 5100 admin-exp / Cr 1210 PP&E      REAL  (JV-2026-0414 "FA auto")
//   cn       Dr 4010 revenue + Dr 2050 VAT / Cr 1030 AR   EXTRAPOLATED (invoice reversal)
// (The prototype's 5301/1502-4 accounts are NOT in COA_SEED and are deliberately
// not hardcoded — Wei C-177. Codes resolve to ids per-tenant at post time.)
import { inArray } from "drizzle-orm";
import { glAccounts, jvs } from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";

/**
 * A Postgres UNIQUE-violation (SQLSTATE 23505). P2-BE-52: jv.source_doc carries a
 * partial UNIQUE index (migration 0037) so a source money doc can be posted at
 * most ONCE even under a concurrent race the check-then-insert can't cover. When
 * the losing transaction's jv insert trips that constraint, the posting handler
 * maps it to the SAME idempotent outcome as the pre-check (409 / skip "already
 * posted") instead of a 500. The pg driver puts the SQLSTATE on `.code`; drizzle
 * may nest the driver error under `.cause`, so check both.
 */
export function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown): unknown =>
    e && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
  if (code(err) === "23505") return true;
  const cause = err && typeof err === "object" ? (err as { cause?: unknown }).cause : undefined;
  return code(cause) === "23505";
}

/** The posting-inbox source kinds that have a real backing table (gl-posting.ts). */
export type GlPostableKind = "pv" | "rv" | "gr" | "payroll";

export interface PostingRule {
  /** Debit account code. */
  dr: string;
  /** Credit account code. */
  cr: string;
  /** Which money field on the source row funds the JV. */
  basis: "amount" | "net";
  /** true = a real JV_BOOKS seed exemplar backs this map; false = extrapolated. */
  real: boolean;
  note: string;
}

/** doc-type → account-code posting map (derived from seed JV_BOOKS · B-122 Q2). */
export const POSTING_MAP: Record<GlPostableKind, PostingRule> = {
  rv: { dr: "1020", cr: "1030", basis: "amount", real: true, note: "JV-2026-0418 REM" },
  gr: { dr: "5020", cr: "2010", basis: "amount", real: true, note: "JV-2026-0416 GR auto; gr.amount is null → not postable" },
  pv: { dr: "2010", cr: "1020", basis: "net", real: false, note: "extrapolated — no PV exemplar in JV_BOOKS" },
  payroll: { dr: "5030", cr: "1020", basis: "amount", real: false, note: "extrapolated — no payroll exemplar in JV_BOOKS" },
};

/** Named COA codes the direct-posting handlers (CN, FA, retention, deposit) reference by intent. */
export const ACCT = {
  cash: "1010",
  bank: "1020",
  ar: "1030",
  // เงินมัดจำจ่ายล่วงหน้า — a deposit PAID to a vendor is an asset (advance to
  // supplier). Paying it: Dr 1160 / Cr 1010 cash (ap.jsx APDeposit · P2-BE-54).
  advanceToSupplier: "1160",
  ap: "2010",
  // เจ้าหนี้เงินประกันผลงานค้างจ่าย — the retention we withheld from a vendor/subcon
  // (a liability). Releasing it back pays the vendor: Dr 2030 / Cr 1020 (P2-BE-53).
  retentionPayable: "2030",
  vatOutput: "2050",
  revenue: "4010",
  materials: "5020",
  labor: "5030",
  adminExpense: "5100",
  ppe: "1210",
} as const;

/**
 * Resolve COA `code` → account id for THIS tenant (company-scoped select). A code
 * the tenant's COA does not carry is simply absent from the map — the caller
 * treats a missing required code as a fail-closed error (never posts an
 * unbalanced / mis-accounted JV). Returns a Map keyed by code.
 */
export async function resolveAccountIds(
  db: TenantDb,
  codes: string[],
): Promise<Map<string, string>> {
  const uniq = [...new Set(codes)];
  if (uniq.length === 0) return new Map();
  const rows = (await db.select(
    glAccounts,
    inArray(glAccounts.code, uniq),
  )) as (typeof glAccounts.$inferSelect)[];
  return new Map(rows.map((r) => [r.code, r.id]));
}

/**
 * Allocate the next JV number for this tenant — JV-<current-year>-<NNNN>, one past
 * the max numeric suffix among the tenant's existing JV numbers for that year
 * prefix (the seed's JV-2026-0418 → JV-2026-0419). Company-scoped read (fail
 * closed). Deterministic given the current jv set; the caller writes it inside the
 * same posting transaction.
 */
export async function allocJvNo(db: TenantDb): Promise<string> {
  const rows = (await db.select(jvs)) as (typeof jvs.$inferSelect)[];
  const year = new Date().getFullYear();
  const prefix = `JV-${year}-`;
  let max = 0;
  for (const r of rows) {
    const no = r.no ?? "";
    if (!no.startsWith(prefix)) continue;
    const m = /-(\d+)$/.exec(no);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

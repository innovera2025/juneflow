// Shared PO/WO procurement helpers (P2-BE-05, B-070) — the approval-tier matrix
// and caller-authority resolution that /po and /wo share verbatim, plus the
// source-PR line pricing used to seed a PO's stored total at create-time. The
// PR handler (pr.ts) keeps its own copy of these because its thresholds differ
// (see below); po.ts and wo.ts import from here so the identical PO/WO logic is
// declared once.
//
// Approval thresholds are the PO/WO row of the flows.html MATRIX (B-070
// authoritative), which are DIFFERENT from PR's (pr.ts uses 500K/2M): a PO/WO
// escalates to ผจก.โครงการ above 1,000,000 THB and to MD above 5,000,000 THB
// (strict >). The seed's role.approvalLimits jsonb is a single blanket ceiling,
// not a per-doc-tier matrix, so these thresholds are flows.html constants — the
// same ruling pr.ts applied (GAP flagged there; not a schema change).
import type { FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import {
  boqDocs,
  boqGroups,
  boqItems,
  projects,
  prItems,
  prs,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { loadRole, loadUserByEmail } from "./profile-data.js";

/** B-070 PO/WO approval tier thresholds (THB, strict >), flows.html MATRIX PO/WO row. */
export const PO_WO_TIER_PM_THRESHOLD = 1_000_000; // amount > this → ผจก.โครงการ tier
export const PO_WO_TIER_MD_THRESHOLD = 5_000_000; // amount > this → MD tier

/** role.approvalLevel tiers (packages/db seed ROLE_DEFS `level`) — same ladder as pr.ts. */
export const APPROVAL_LEVEL_PROC = 2; // หน.จัดซื้อ (Procurement head) — every PO/WO
export const APPROVAL_LEVEL_PM = 3; // ผจก.โครงการ (Project Manager) — > 1,000,000
export const APPROVAL_LEVEL_MD = 4; // MD (Director) — > 5,000,000

/** The lowest role.approvalLevel that may give a PO/WO's terminal approval. */
export function requiredApprovalLevel(amount: number): number {
  if (amount > PO_WO_TIER_MD_THRESHOLD) return APPROVAL_LEVEL_MD;
  if (amount > PO_WO_TIER_PM_THRESHOLD) return APPROVAL_LEVEL_PM;
  return APPROVAL_LEVEL_PROC;
}

/** How many approval tiers the amount engages (stored in approval_step on approval). */
export function requiredTierCount(amount: number): number {
  if (amount > PO_WO_TIER_MD_THRESHOLD) return 3; // หน.จัดซื้อ + ผจก.โครงการ + MD
  if (amount > PO_WO_TIER_PM_THRESHOLD) return 2; // หน.จัดซื้อ + ผจก.โครงการ
  return 1; // หน.จัดซื้อ only
}

/**
 * The caller's role.approvalLevel, or null when it cannot be attributed (no
 * session user / no dictionary row / no role). Resolved the same way as GET /me
 * (authUser.email → tenant user row → role), so it is tenant-scoped throughout.
 * Identical to pr.ts's private copy.
 */
export async function callerApprovalLevel(
  request: FastifyRequest,
): Promise<number | null> {
  const db = request.db;
  const authUser = request.authUser;
  if (!db || !authUser) return null;
  const user = await loadUserByEmail(db, authUser.email);
  if (!user) return null;
  const role = await loadRole(db, user.roleId);
  return role?.approvalLevel ?? null;
}

// ---------------------------------------------------------------------------
// Opaque-JSON body helpers (mirror pr.ts)
// ---------------------------------------------------------------------------

/** Coerce an opaque value to a string, else "". */
export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Does the opaque body explicitly carry any of these keys? */
export function has(body: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((k) => Object.prototype.hasOwnProperty.call(body, k));
}

/** First present value among the given opaque field aliases. */
export function pick(body: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(body, k)) return body[k];
  }
  return undefined;
}

/** Parse a finite number (number | numeric string) from opaque JSON, else null. */
export function toNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Source-PR line pricing (PO create) — the same C10 computation pr.ts uses to
// derive a PR's `amount`. A PO has NO line-item table of its own (unlike
// pr_item), so a PO's stored `total` is seeded from this at create-time; the PO
// read path then returns that stored total (no live re-sum is possible).
// ---------------------------------------------------------------------------

type PrItemRow = typeof prItems.$inferSelect;
type BoqItemRow = typeof boqItems.$inferSelect;

// Scope hop chains anchoring each parent-FK-scoped table on the company_id-
// scoped project root (mirror pr.ts).
const PR_ITEM_HOPS = [
  { fk: prItems.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
const BOQ_ITEM_HOPS = [
  { fk: boqItems.groupId, parent: boqGroups },
  { fk: boqGroups.boqId, parent: boqDocs },
  { fk: boqDocs.projectId, parent: projects },
];

/**
 * A PR's amount + currency = Σ over its lines of qty × the referenced BOQ item's
 * unit price (C10 — real rows, never a hardcoded doc total). A line with no
 * boq_item_id contributes 0 (pr_item has no standalone price column). Currency =
 * the currency of the first priced line, else THB.
 */
export async function prLineAmount(
  db: TenantDb,
  prId: string,
): Promise<{ amount: number; currency: string }> {
  const [lines, boqItemRows]: [PrItemRow[], BoqItemRow[]] = await Promise.all([
    db.selectThrough(prItems, PR_ITEM_HOPS, eq(prs.id, prId)),
    db.selectThrough(boqItems, BOQ_ITEM_HOPS),
  ]);
  const prices = new Map(
    boqItemRows.map((it) => [
      it.id,
      { price: Number(it.price), currency: it.currencyCode },
    ]),
  );
  let amount = 0;
  let currency = "THB";
  let currencySet = false;
  for (const ln of lines) {
    const priced = ln.boqItemId ? prices.get(ln.boqItemId) : undefined;
    if (!priced) continue;
    amount += Number(ln.qty) * priced.price;
    if (!currencySet) {
      currency = priced.currency;
      currencySet = true;
    }
  }
  return { amount, currency };
}

/**
 * The total ORDERED quantity of a PR = Σ over its lines of pr_item.qty (C10 —
 * real rows, never a hardcoded total). This is the denominator the GR
 * partial-vs-full check compares cumulative received against: a PO/WO has no
 * line-item table of its own, so the source PR's line quantities are the only
 * real "ordered" quantity (gr.ts partial receipt logic). Returns 0 when the PR
 * has no lines — the caller treats an un-quantified order as never auto-closing.
 */
export async function prOrderedQty(db: TenantDb, prId: string): Promise<number> {
  const lines: PrItemRow[] = await db.selectThrough(
    prItems,
    PR_ITEM_HOPS,
    eq(prs.id, prId),
  );
  return lines.reduce((sum, ln) => sum + Number(ln.qty), 0);
}

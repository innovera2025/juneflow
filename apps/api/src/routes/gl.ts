// GL (General Ledger) handlers — P2-BE-17, Wave-2 (finance) fork-free first
// slice. Handler-only: the schema (finance.ts gl_account / jv / jv_line /
// accounting_period), the COA_SEED (23 accounts) + JV_BOOKS (7 balanced books)
// seed, and the contract paths (openapi.yaml, opaque EntityList / EntityCreated)
// ALL pre-exist — this file wires the reads/writes and is registered in app.ts.
//
// Contract (openapi.yaml §finance):
//   GET  /gl/coa            → EntityList  — chart of accounts (getGlCoa)
//   GET  /gl/jv             → EntityList  — journal vouchers  (listGlJv)
//   POST /gl/jv             → EntityCreated — create a balanced JV (createGlJv)
//   GET  /gl/posting-inbox  → EntityList  — source docs pending posting
// Each row is the opaque Entity (snake_case wire of REAL columns). Reads on an
// opaque endpoint need no contract change (FLOW-A opaque-Entity finding).
//
// Tenant scope (fail closed): gl_account and jv carry company_id → the scoped
// TenantDb.select() door. jv_line hangs off jv (no company_id of its own) → it
// is READ through selectThrough (jv_id → jv root) and WRITTEN through
// insertThrough (which re-verifies this tenant owns the parent jv). Without a
// resolved tenant, request.db is absent and every handler answers a flat 401.
//
// Double-entry invariant (decision C9): POST /gl/jv rejects (400) any JV whose
// Σ dr ≠ Σ cr, or whose Σ dr is not > 0 — a JV must be balanced and non-empty.
//
// NOT in scope (out of this task, do NOT add here): gl.projectpl (Wei F-GL1 =
// defer to Phase 5) and the GL reports (trial-balance / statements / cashflow —
// need F-GL2 account-type classification). posting-inbox posted-state honesty is
// documented in gl-posting.ts (no seed posted-marker → all docs read PENDING).
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import {
  accountingPeriods,
  costCenters,
  glAccounts,
  jvLines,
  jvs,
  pettyCashTxns,
  projects,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";
import { listEnvelope } from "./list-envelope.js";
import { listGlPostingDocs } from "./gl-posting.js";
import {
  POSTING_MAP,
  allocJvNo,
  docNoExhausted,
  DocNoExhaustedError,
  isUniqueViolation,
  JV_COMPANY_NO_CONSTRAINT,
  resolveAccountIds,
  violatedConstraint,
  withDocNoRetry,
  type PostingRule,
} from "./gl-post.js";
import { loadCaller, permAllowed } from "./authz.js";
import { byIdAsc } from "./list-order.js";

type JvRow = typeof jvs.$inferSelect;
type JvLineRow = typeof jvLines.$inferSelect;
type GlAccountRow = typeof glAccounts.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type AccountingPeriodRow = typeof accountingPeriods.$inferSelect;

/**
 * The perms-matrix module (seed MODULE_IDS) that governs finance actions — the
 * same `finance` module ap.ts / bank.ts gate PV-approve + reconcile on. The GL
 * period close reuses it: closing (locking) a period is a priority `approve`
 * action, so it enforces the EXISTING 11×5 perms matrix (it invents no policy).
 */
const FINANCE_MODULE = "finance";

/** Flat 401 (fail closed) when no tenant was resolved onto the request. */
function unauthenticated(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
}

/** Flat 400 VALIDATION error (contract Error shape). */
function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ code: "VALIDATION", message });
}

/** Flat 409 INVALID_STATE error (contract Error shape). */
function conflict(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(409).send({ code: "INVALID_STATE", message });
}

/** Coerce opaque JSON (number | numeric string) to a finite number, else null. */
function toNum(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A computed 2-dp money magnitude as the numeric-column string ("184500.00"). */
function moneyStr(n: number): string {
  return round2(n).toFixed(2);
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Coerce a drizzle numeric (string) / number / null to a finite number, else 0. */
function num(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// GET /gl/coa — chart of accounts (accounting-extra.jsx GLChartOfAccounts)
// ---------------------------------------------------------------------------
// Real source: gl_account (COA_SEED, 23 rows). Wire = the REAL columns (id,
// code, name, parent_id self-ref, created_at). The prototype's cls (account
// class) is the code's leading digit — a presentational derivation the FE makes
// from `code`; group / balance / active are NOT stored (no schema column) and
// are therefore omitted here rather than fabricated (C10). Ordered by code so
// the class-grouped table renders deterministically.
function coaWire(a: GlAccountRow): Record<string, unknown> {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    parent_id: a.parentId,
    created_at: a.createdAt,
  };
}

async function getCoa(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(glAccounts)) as GlAccountRow[];
  return [...rows]
    // B-323: code is unique per company (gl_account_company_code_uq) — id floor anyway,
    // so the order does not depend on a constraint staying put.
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0) || byIdAsc(a, b))
    .map(coaWire);
}

// ---------------------------------------------------------------------------
// GET /gl/jv — journal vouchers (gl.jsx GLJournalVoucher list)
// ---------------------------------------------------------------------------
// Real sources: jv (7 JV_BOOKS) + jv_line (balanced legs). Per JV the wire
// carries: no, source_doc (the seed's free-text source label), memo (คำอธิบาย),
// amount (Σ dr = Σ cr — the real balanced total from its lines), line_count,
// currency_code (from its lines), period_id, created_at.
// DATA GAP: jv has NO status column (the seed's JV_BOOKS.status is dropped at
// seed time), so status is an honest null — NOT a fabricated approved/pending.
// Ordered newest-first (created_at desc, then no desc) matching the mock list.
async function listJv(db: TenantDb): Promise<Record<string, unknown>[]> {
  const [jvRows, lineRows] = await Promise.all([
    db.select(jvs) as Promise<JvRow[]>,
    // jv_line hangs off jv (no company_id) → read through the scoped root.
    db.selectThrough(jvLines, [
      { fk: jvLines.jvId, parent: jvs },
    ]) as Promise<JvLineRow[]>,
  ]);

  const linesByJv = new Map<string, JvLineRow[]>();
  for (const ln of lineRows) {
    const list = linesByJv.get(ln.jvId);
    if (list) list.push(ln);
    else linesByJv.set(ln.jvId, [ln]);
  }

  const wire = jvRows.map((jv) => {
    const lines = linesByJv.get(jv.id) ?? [];
    const amount = round2(lines.reduce((s, ln) => s + num(ln.dr), 0));
    const currency = lines[0]?.currencyCode ?? null;
    return {
      id: jv.id,
      no: jv.no,
      source_doc: jv.sourceDoc,
      memo: jv.memo,
      amount,
      currency_code: currency,
      line_count: lines.length,
      period_id: jv.periodId,
      status: null, // GAP: jv has no status column (seed drops JV_BOOKS.status).
      created_at: jv.createdAt,
    };
  });

  return wire.sort((a, b) => {
    const at = a.created_at ? new Date(a.created_at as Date).getTime() : 0;
    const bt = b.created_at ? new Date(b.created_at as Date).getTime() : 0;
    if (at !== bt) return bt - at;
    if (a.no !== b.no) return a.no < b.no ? 1 : -1;
    // B-323: `no` alone is NOT a safe floor here — B-168 is an open, live defect in
    // which allocJvNo can mint a DUPLICATE jv.no, so two distinct JVs can tie on both
    // created_at and no and hand the pair back to the join plan. id is unique by
    // construction, so it closes the order unconditionally.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// POST /gl/jv — create a balanced journal voucher (gl.jsx JVCreateForm)
// ---------------------------------------------------------------------------
// Body (opaque Entity): { no, source_doc?, memo?, period_id?, lines: [{
//   account_id, dr, cr, cc_id?, project_id?, currency_code? }] }.
// Enforced, in order:
//   - no (JV number) required; lines a non-empty array; each line has an
//     account_id and non-negative dr/cr.
//   - DOUBLE ENTRY (C9): Σ dr === Σ cr AND Σ dr > 0, else 400.
//   - TENANT OWNERSHIP (fail closed): every referenced account_id / cc_id /
//     project_id must belong to THIS tenant (a bare DB FK only checks existence,
//     not ownership — a foreign id would otherwise cross tenant scope), else 400.
// Write: jv via the scoped insert() (company_id force-set); jv_line via
// insertThrough() (re-verifies this tenant owns the just-created parent jv).
interface ParsedLine {
  accountId: string;
  dr: number;
  cr: number;
  ccId: string | null;
  projectId: string | null;
  currencyCode: string;
}

interface ParsedJv {
  no: string;
  sourceDoc: string | null;
  memo: string | null;
  periodId: string | null;
  lines: ParsedLine[];
}

/** Parse + shape-validate the body; a string is the error message. */
function parseJvBody(body: Record<string, unknown>): ParsedJv | string {
  const no = str(body.no).trim();
  if (!no) return "no (JV number) is required";

  const rawLines = body.lines;
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return "lines must be a non-empty array";
  }

  const lines: ParsedLine[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const raw = (rawLines[i] ?? {}) as Record<string, unknown>;
    const accountId = str(raw.account_id ?? raw.accountId).trim();
    if (!accountId) return `line ${i + 1}: account_id is required`;
    const dr = toNum(raw.dr) ?? 0;
    const cr = toNum(raw.cr) ?? 0;
    if (dr < 0 || cr < 0) return `line ${i + 1}: dr/cr must not be negative`;
    const ccId = str(raw.cc_id ?? raw.ccId).trim() || null;
    const projectId = str(raw.project_id ?? raw.projectId).trim() || null;
    const currencyCode = str(raw.currency_code ?? raw.currencyCode).trim() || "THB";
    lines.push({ accountId, dr, cr, ccId, projectId, currencyCode });
  }

  return {
    no,
    sourceDoc: str(body.source_doc ?? body.sourceDoc).trim() || null,
    memo: str(body.memo).trim() || null,
    periodId: str(body.period_id ?? body.periodId).trim() || null,
    lines,
  };
}

/** Distinct non-null ids from a line accessor (for one tenant-ownership query). */
function distinct(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => v != null))];
}

async function createJv(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const parsed = parseJvBody(body);
  if (typeof parsed === "string") return badRequest(reply, parsed);

  // Double-entry balance (C9): Σ dr === Σ cr, non-empty. Sum the PER-LINE rounded
  // values — the same round2() applied at storage (moneyStr below) — so a sub-cent
  // leg that rounds to 0.00 on write cannot survive a raw-sum gate and persist an
  // unbalanced ledger (validate-vs-persist divergence · gl.jv skeptic).
  const sumDr = round2(parsed.lines.reduce((s, l) => s + round2(l.dr), 0));
  const sumCr = round2(parsed.lines.reduce((s, l) => s + round2(l.cr), 0));
  if (sumDr <= 0) {
    return badRequest(reply, "JV total (Σ dr) must be greater than zero");
  }
  if (sumDr !== sumCr) {
    return badRequest(
      reply,
      `JV is not balanced: Σ dr (${moneyStr(sumDr)}) ≠ Σ cr (${moneyStr(sumCr)})`,
    );
  }

  // Tenant ownership of every referenced account / cost-center / project — a
  // foreign id must never be linkable through a jv_line FK (fail closed).
  const accountIds = distinct(parsed.lines.map((l) => l.accountId));
  const ownedAccounts = (await db.select(
    glAccounts,
    inArray(glAccounts.id, accountIds),
  )) as GlAccountRow[];
  const ownedAccountIds = new Set(ownedAccounts.map((a) => a.id));
  const foreignAccount = accountIds.find((id) => !ownedAccountIds.has(id));
  if (foreignAccount) {
    return badRequest(reply, `account_id ${foreignAccount} not found in this tenant`);
  }

  const ccIds = distinct(parsed.lines.map((l) => l.ccId));
  if (ccIds.length > 0) {
    // cost_center carries no company_id — scoped project → tenant root.
    const owned = await db.selectThrough(
      costCenters,
      [{ fk: costCenters.projectId, parent: projects }],
      inArray(costCenters.id, ccIds),
    );
    const ownedSet = new Set(owned.map((c) => c.id));
    const foreign = ccIds.find((id) => !ownedSet.has(id));
    if (foreign) {
      return badRequest(reply, `cc_id ${foreign} not found in this tenant`);
    }
  }

  const projectIds = distinct(parsed.lines.map((l) => l.projectId));
  if (projectIds.length > 0) {
    const owned = await db.select(projects, inArray(projects.id, projectIds));
    const ownedSet = new Set(owned.map((p) => p.id));
    const foreign = projectIds.find((id) => !ownedSet.has(id));
    if (foreign) {
      return badRequest(reply, `project_id ${foreign} not found in this tenant`);
    }
  }

  if (parsed.periodId) {
    const [period] = await db.select(
      accountingPeriods,
      eq(accountingPeriods.id, parsed.periodId),
    );
    if (!period) {
      return badRequest(reply, `period_id ${parsed.periodId} not found in this tenant`);
    }
    // B-094-1: a locked (closed) accounting period is closed to back-posting —
    // the data-dictionary "ปิดงวดล็อก" invariant (accounting_period.locked). A JV
    // posted into a closed period would silently reopen the books, so reject it
    // (409) rather than persist the leg. Tenant-scoped read above (fail closed).
    if (period.locked) {
      return conflict(
        reply,
        `period ${parsed.periodId} is locked — posting to a closed period is not allowed`,
      );
    }
  }

  const jvId = randomUUID();
  const lineRows: (typeof jvLines.$inferInsert)[] = parsed.lines.map((l) => ({
    jvId,
    accountId: l.accountId,
    dr: moneyStr(l.dr),
    cr: moneyStr(l.cr),
    currencyCode: l.currencyCode,
    ccId: l.ccId,
    projectId: l.projectId,
  }));

  // B-097: a jv header + its lines are ONE post — write them in a single
  // transaction so a line failure (e.g. a bad account_id FK) rolls back the
  // header too, never leaving an orphaned jv (previously mitigated only by
  // header-first ordering). insertThrough re-proves this tenant owns the parent
  // jv INSIDE the same transaction; the tx wrapper carries the same company_id.
  //
  // B-318: this is the ONE jv-insert site that must NOT retry. `no` is CLIENT-
  // supplied (parseJvBody) — re-running would insert the caller's same number
  // again and collide forever, and silently renumbering someone's manual JV would
  // be worse. It is also the only site with no catch at all, so before 0061 a
  // duplicate manual number was an unhandled 500. Map it BY NAME to the honest 409.
  let created: { createdJv: JvRow | undefined; createdLines: unknown[] };
  try {
    created = await db.transaction(async (tx) => {
      const [createdJv] = (await tx
        .insert(jvs, {
          id: jvId,
          no: parsed.no,
          sourceDoc: parsed.sourceDoc,
          periodId: parsed.periodId,
          memo: parsed.memo,
        })
        .returning()) as JvRow[];
      const createdLines = await tx.insertThrough(jvLines, jvs, jvId, lineRows);
      return { createdJv, createdLines };
    });
  } catch (err) {
    if (isUniqueViolation(err) && violatedConstraint(err) === JV_COMPANY_NO_CONSTRAINT) {
      return conflict(reply, `JV number ${parsed.no} is already used in this company`);
    }
    throw err;
  }
  const { createdJv, createdLines } = created;

  return reply.code(201).send({
    id: createdJv?.id ?? jvId,
    no: parsed.no,
    source_doc: parsed.sourceDoc,
    memo: parsed.memo,
    period_id: parsed.periodId,
    amount: round2(sumDr),
    currency_code: parsed.lines[0]?.currencyCode ?? "THB",
    line_count: createdLines.length,
    status: null, // GAP: jv has no status column (see GET /gl/jv).
    created_at: createdJv?.createdAt ?? null,
  });
}

// ---------------------------------------------------------------------------
// GET /gl/posting-inbox — source docs pending GL posting (gl.jsx GLPostingInbox)
// ---------------------------------------------------------------------------
// Delegates to the shared gl-posting.ts source-of-truth (same set the gl.inbox
// badge counts). See that module for the honest posted-marker gap: on the
// current seed no doc resolves as posted, so every source money doc reads
// PENDING (posted=false, jv_no=null) — NOT a fabricated status.
async function postingInbox(db: TenantDb): Promise<Record<string, unknown>[]> {
  const docs = await listGlPostingDocs(db);
  return docs as unknown as Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// GET /gl/reports/trial-balance — trial balance (gl.jsx GLTrialBalance)
// ---------------------------------------------------------------------------
// Real source: jv_line (aggregated) grouped by account. jv_line carries NO
// company_id — it is read THROUGH its jv (jv_id → jv.company_id) via
// selectThrough (a bare jv_line read would escape tenant scope). Σ dr and Σ cr
// are accumulated per account_id, then gl_account (company-scoped) supplies the
// code + name. The response is the opaque EntityOk:
//   { rows: [{account_code, account_name, debit, credit}],
//     totals: {total_debit, total_credit}, currency_code }
// C10 (honest): the rows are the REAL per-account sums of the seeded balanced
// JVs, and total_debit / total_credit are the true Σ dr / Σ cr across every leg —
// so the Dr=Cr footer is equal exactly when every JV is balanced (the C9
// invariant POST /gl/jv enforces), surfaced from real data, never fabricated.
// Accounts with no jv_line activity do not appear (the aggregation is over the
// real posted legs). Ordered by account code ascending (mirrors the mock's
// code-grouped table + getCoa).
//
// NOTE (C-180, DEFERRED): the openapi declares GET /gl/reports/trial-balance
// with a `?period=` filter, but this handler intentionally does NOT filter by
// period — jv.period_id is NULL across the whole seed, so no leg is
// period-attributable and applying a period filter would silently return an
// empty balance. Period filtering is DEFERRED until the posting/close flow
// populates jv.period_id (honest deferral — not implemented here).
async function trialBalance(
  db: TenantDb,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [lineRows, accountRows] = await Promise.all([
    // jv_line scopes THROUGH jv (no company_id of its own) — the scoped root read.
    db.selectThrough(jvLines, [
      { fk: jvLines.jvId, parent: jvs },
    ]) as Promise<JvLineRow[]>,
    db.select(glAccounts) as Promise<GlAccountRow[]>,
  ]);

  const accounts = new Map(accountRows.map((a) => [a.id, a]));
  const byAccount = new Map<string, { dr: number; cr: number }>();
  let currency: string | null = null;
  let totalDr = 0;
  let totalCr = 0;
  for (const ln of lineRows) {
    if (currency == null) currency = ln.currencyCode ?? null;
    const dr = num(ln.dr);
    const cr = num(ln.cr);
    totalDr += dr;
    totalCr += cr;
    const agg = byAccount.get(ln.accountId) ?? { dr: 0, cr: 0 };
    agg.dr += dr;
    agg.cr += cr;
    byAccount.set(ln.accountId, agg);
  }

  const rows = [...byAccount.entries()]
    .map(([accountId, agg]) => {
      const account = accounts.get(accountId);
      return {
        account_code: account?.code ?? null,
        account_name: account?.name ?? null,
        debit: round2(agg.dr),
        credit: round2(agg.cr),
      };
    })
    .sort((a, b) => {
      const ac = a.account_code ?? "";
      const bc = b.account_code ?? "";
      return ac < bc ? -1 : ac > bc ? 1 : 0;
    });

  return reply.code(200).send({
    rows,
    totals: { total_debit: round2(totalDr), total_credit: round2(totalCr) },
    currency_code: currency ?? "THB",
  });
}

// ---------------------------------------------------------------------------
// GET /gl/reports/statements — balance sheet + income statement
// (accounting-extra2.jsx financial statements). Opaque EntityOk (a single report
// object, NOT list-enveloped) — mirrors trial-balance.
// ---------------------------------------------------------------------------
// Real source: jv_line (aggregated per account) THROUGH jv (jv_line has NO
// company_id — a bare select escapes tenant scope) + gl_account (company-scoped)
// which supplies code, name, AND account_type. Extends trialBalance() verbatim:
// the ONLY new step is bucketing each account by gl_account.account_type instead
// of one flat list. account_type ∈ {asset,liability,equity,revenue,expense}
// (migration 0035 backfill from the code prefix). Sign convention per bucket:
//   asset / expense  → debit-normal  (Σdr − Σcr)
//   liability/equity/revenue → credit-normal (Σcr − Σdr)
// net_income = revenue_total − expense_total, folded into equity as the current-
// period "กำไรงวดปัจจุบัน" line so the two BS sides tie. No jv.status filter
// (mirror precedent — includes the seed's one pending JV-0412; identity still
// holds because each JV is internally ΣDR=ΣCR).
//
// C10 HONEST GAPS (return empty/null + // GAP, never fabricate):
//   - PRIOR-YEAR column — every prior_* field is null. No prior-year data exists
//     (all jv are 2026, jv.period_id is NULL across the seed). NEVER invent a
//     prior period, reuse current values, or derive a delta.
//   - equity (3010/3020) + revenue (4010-4040) — zero jv_line activity in the
//     seed → empty rows + subtotal/total 0, but the 5 buckets stay structurally
//     present (never dropped). Consequence: honest P&L net_income is a LOSS
//     (0 − 506,733), nothing like the mock's profit — ship the loss.
//   - margin/ratio KPI cards (from the mock) — OMITTED: revenue_total=0 makes
//     them undefined (only derive a ratio when BOTH operands are real).
//
// NOTE (C-180, DEFERRED): the openapi declares ?period= but this handler does NOT
// filter by period — jv.period_id is NULL across the whole seed, so a period
// filter would silently return an empty statement. Honest deferral until the
// posting/close flow populates jv.period_id (identical to trial-balance).
type StmtBucket = "asset" | "liability" | "equity" | "revenue" | "expense";
const STMT_BUCKETS: readonly StmtBucket[] = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
];

interface StmtRow {
  account_code: string | null;
  account_name: string | null;
  amount: number;
  prior_amount: null;
}

function byCode(
  a: { account_code: string | null },
  b: { account_code: string | null },
): number {
  const ac = a.account_code ?? "";
  const bc = b.account_code ?? "";
  return ac < bc ? -1 : ac > bc ? 1 : 0;
}

async function glStatements(
  db: TenantDb,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [lineRows, accountRows] = await Promise.all([
    // jv_line scopes THROUGH jv (no company_id of its own) — the scoped root read.
    db.selectThrough(jvLines, [
      { fk: jvLines.jvId, parent: jvs },
    ]) as Promise<JvLineRow[]>,
    db.select(glAccounts) as Promise<GlAccountRow[]>,
  ]);

  const accounts = new Map(accountRows.map((a) => [a.id, a]));
  const byAccount = new Map<string, { dr: number; cr: number }>();
  let currency: string | null = null;
  for (const ln of lineRows) {
    if (currency == null) currency = ln.currencyCode ?? null;
    const agg = byAccount.get(ln.accountId) ?? { dr: 0, cr: 0 };
    agg.dr += num(ln.dr);
    agg.cr += num(ln.cr);
    byAccount.set(ln.accountId, agg);
  }

  // The 5 buckets stay structurally present even with zero activity (honest-empty
  // — an account_type with no jv_line is a real 0, not a dropped section).
  const buckets: Record<StmtBucket, StmtRow[]> = {
    asset: [],
    liability: [],
    equity: [],
    revenue: [],
    expense: [],
  };
  for (const [accountId, agg] of byAccount) {
    const account = accounts.get(accountId);
    const type = account?.accountType ?? null;
    if (type == null || !STMT_BUCKETS.includes(type as StmtBucket)) {
      // GAP: an account with real activity but no account_type can't be placed
      // in a section — excluded, never guessed (the 0035 backfill guarantees a
      // type today, so this is a defensive fallthrough, not a live case).
      continue;
    }
    const bucket = type as StmtBucket;
    const debitNormal = bucket === "asset" || bucket === "expense";
    const amount = round2(debitNormal ? agg.dr - agg.cr : agg.cr - agg.dr);
    buckets[bucket].push({
      account_code: account?.code ?? null,
      account_name: account?.name ?? null,
      amount,
      // GAP: no prior-year data exists (all jv are 2026, period_id NULL) —
      // honest-null, never invented.
      prior_amount: null,
    });
  }
  for (const t of STMT_BUCKETS) buckets[t].sort(byCode);

  const sum = (rows: StmtRow[]): number =>
    round2(rows.reduce((s, r) => s + r.amount, 0));
  const assetsSubtotal = sum(buckets.asset);
  const liabilitiesSubtotal = sum(buckets.liability);
  const equityMembersSubtotal = sum(buckets.equity);
  const revenueTotal = sum(buckets.revenue);
  const expenseTotal = sum(buckets.expense);
  const netIncome = round2(revenueTotal - expenseTotal);
  // net_income is folded into equity (the "กำไรงวดปัจจุบัน" line) so the two BS
  // sides tie: total_liabilities_equity = liabilities + (equity members + NI).
  const equitySubtotal = round2(equityMembersSubtotal + netIncome);
  const totalAssets = assetsSubtotal;
  const totalLiabilitiesEquity = round2(liabilitiesSubtotal + equitySubtotal);
  // The honest anchor — a REAL equality over real sums (never asserted): assets
  // == liabilities + equity + net_income holds exactly when every JV is balanced
  // (the C9 invariant POST /gl/jv enforces), mirroring the Dr=Cr footer.
  const balanced = round2(totalAssets) === round2(totalLiabilitiesEquity);

  return reply.code(200).send({
    balance_sheet: {
      assets: { rows: buckets.asset, subtotal: assetsSubtotal },
      liabilities: { rows: buckets.liability, subtotal: liabilitiesSubtotal },
      equity: {
        // GAP: no jv_line touches 3010/3020 in the seed — honest-empty rows.
        rows: buckets.equity,
        net_income_line: { amount: netIncome, prior_amount: null },
        subtotal: equitySubtotal,
      },
      total_assets: totalAssets,
      total_liabilities_equity: totalLiabilitiesEquity,
      prior_total_assets: null, // GAP: no prior-year period.
      balanced,
    },
    income_statement: {
      // GAP: no revenue jv_line in the seed — honest-empty rows + total 0.
      revenue: { rows: buckets.revenue, total: revenueTotal, prior_total: null },
      expense: { rows: buckets.expense, total: expenseTotal, prior_total: null },
      net_income: netIncome,
      prior_net_income: null, // GAP: no prior-year period.
    },
    currency_code: currency ?? "THB",
  });
}

// ---------------------------------------------------------------------------
// GET /gl/reports/cashflow — DIRECT-method cash flow (accounting-extra2.jsx).
// Opaque EntityOk (single report object, NOT list-enveloped).
// ---------------------------------------------------------------------------
// METHOD = DIRECT / cash-account-movement (C10-safe & fully self-reconciling —
// resolved conservatively toward C10; see honest gap #9 for the prototype-Indirect
// divergence flag escalated to Wei). Real source: jv_line THROUGH jv + gl_account
// (both scoped exactly as trial-balance). Algorithm: CASH codes = {1010,1020}. For
// each JV with ≥1 cash leg, cashΔ = Σ(dr−cr) over its cash legs; each NON-cash
// contra leg is attributed (cr−dr) — those attributions sum to cashΔ for a
// balanced JV (C9), so the buckets reconcile to net_change to the cent (needs no
// period deltas, no opening balances, no depreciation isolation).
//
// BUCKET MAPPING keys on the 4-digit COA CODE (account_type alone cannot split
// asset into WC-vs-longterm or liability into operating-vs-financing). An unmapped
// code falls through to a // GAP exclusion, never a silent bucket. Verified vs the
// seeded COA (seed index.ts L378) + prototype bucketing (accounting-extra2.jsx).
// FLAGS (honest-follow-prototype, Wei ruling — do NOT decide unilaterally):
//   1150 ที่ดินรอการพัฒนา → investing (arguably operating-inventory for a
//     real-estate developer); 5200 ดอกเบี้ยจ่าย → financing (IAS7 permits O or F).
//
// C10 HONEST GAPS: investing/financing = {lines:[],net:0} (no cash JV against
// 1150/1210 resp. 2110/3xxx in the seed — real zeros, not fabricated);
// opening_cash = 0 (no opening-balance JV exists — a real opening balance is not
// derivable today); prior = null (no prior-year period). ?period= accepted but NOT
// filtered (jv.period_id NULL across seed — honest deferral, identical to C-180).
type CfBucket = "O" | "I" | "F";
const CASH_CODES = new Set(["1010", "1020"]);
const CF_BUCKET: Record<string, CfBucket> = {
  "1030": "O", // ลูกหนี้การค้า — Δ WC asset
  "1040": "O", // ลูกหนี้เงินประกัน Retention — Δ WC asset
  "1140": "O", // งานระหว่างก่อสร้าง WIP/CIP — Δ WC inventory
  "1150": "I", // ที่ดินรอการพัฒนา — investing (FLAG, see header)
  "1210": "I", // ที่ดิน อาคาร อุปกรณ์ PP&E
  "2010": "O", // เจ้าหนี้การค้า — Δ WC liability
  "2030": "O", // เจ้าหนี้เงินประกันค้างจ่าย
  "2040": "O", // เงินมัดจำ/เงินจองรับล่วงหน้า
  "2050": "O", // ภาษีขายรอนำส่ง VAT
  "2110": "F", // เงินกู้ยืมธนาคาร-โครงการ
  "3010": "F", // ทุนจดทะเบียนชำระแล้ว
  "3020": "F", // กำไร(ขาดทุน)สะสม
  "4010": "O", // รายได้ (P&L → operating)
  "4020": "O",
  "4030": "O",
  "4040": "O",
  "5010": "O", // ต้นทุน/ค่าใช้จ่ายบริหาร (P&L → operating)
  "5020": "O",
  "5030": "O",
  "5100": "O",
  "5200": "F", // ดอกเบี้ยจ่าย interest paid — financing (FLAG, see header)
};

interface CfLine {
  account_code: string | null;
  account_name: string | null;
  amount: number;
}

async function cashFlow(
  db: TenantDb,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [lineRows, accountRows] = await Promise.all([
    db.selectThrough(jvLines, [
      { fk: jvLines.jvId, parent: jvs },
    ]) as Promise<JvLineRow[]>,
    db.select(glAccounts) as Promise<GlAccountRow[]>,
  ]);

  const accounts = new Map(accountRows.map((a) => [a.id, a]));
  const currency = lineRows[0]?.currencyCode ?? null;

  // Group legs by their jv so each JV is classified as ONE cash event.
  const linesByJv = new Map<string, JvLineRow[]>();
  for (const ln of lineRows) {
    const list = linesByJv.get(ln.jvId);
    if (list) list.push(ln);
    else linesByJv.set(ln.jvId, [ln]);
  }

  // Per bucket, accumulate the cash attributable to each contra account.
  const bucketLines: Record<CfBucket, Map<string, number>> = {
    O: new Map(),
    I: new Map(),
    F: new Map(),
  };
  let netChange = 0;
  for (const lines of linesByJv.values()) {
    // cashΔ = Σ(dr−cr) over this JV's cash legs. A JV with no cash leg is not a
    // cash event → excluded entirely (e.g. an accrual-only JV like JV-0412).
    let cashDelta = 0;
    let hasCash = false;
    for (const ln of lines) {
      const code = accounts.get(ln.accountId)?.code ?? "";
      if (CASH_CODES.has(code)) {
        hasCash = true;
        cashDelta += num(ln.dr) - num(ln.cr);
      }
    }
    if (!hasCash) continue;
    netChange += cashDelta;
    // Attribute the cash movement to each NON-cash contra leg: (cr−dr) of the
    // contra leg. These sum to cashΔ for a balanced JV, so the buckets reconcile
    // to net_change exactly (a self-reconciling direct statement).
    for (const ln of lines) {
      const account = accounts.get(ln.accountId);
      const code = account?.code ?? "";
      if (CASH_CODES.has(code)) continue;
      const bucket = CF_BUCKET[code];
      if (!bucket) {
        // GAP: a contra code absent from CF_BUCKET is excluded (and would be
        // logged), never silently bucketed. No such code in the seed today.
        continue;
      }
      const attribution = num(ln.cr) - num(ln.dr);
      bucketLines[bucket].set(
        ln.accountId,
        (bucketLines[bucket].get(ln.accountId) ?? 0) + attribution,
      );
    }
  }

  const section = (bucket: CfBucket): { lines: CfLine[]; net: number } => {
    const lines: CfLine[] = [...bucketLines[bucket].entries()]
      .map(([accountId, amount]) => {
        const account = accounts.get(accountId);
        return {
          account_code: account?.code ?? null,
          account_name: account?.name ?? null,
          amount: round2(amount),
        };
      })
      .sort(byCode);
    const net = round2(lines.reduce((s, l) => s + l.amount, 0));
    return { lines, net };
  };

  // opening_cash is honest-0: no opening-balance JV exists in the seed (a real
  // opening balance would need an opening-balance entry or a period cutoff — not
  // derivable today). closing = opening + the real net cash movement.
  const openingCash = 0;
  const netChangeR = round2(netChange);
  const closingCash = round2(openingCash + netChange);

  return reply.code(200).send({
    method: "direct",
    operating: section("O"),
    // GAP: no cash JV against 1150/1210 in the seed → honest-empty {lines:[],net:0}.
    investing: section("I"),
    // GAP: no cash JV against 2110/3xxx in the seed → honest-empty {lines:[],net:0}.
    financing: section("F"),
    opening_cash: openingCash,
    net_change: netChangeR,
    closing_cash: closingCash,
    prior: null, // GAP: no prior-year period exists — honest-null, never invented.
    currency_code: currency ?? "THB",
  });
}

// ---------------------------------------------------------------------------
// POST /gl/close-period — lock an accounting period (gl.jsx GLPeriodClose)
// ---------------------------------------------------------------------------
// Body: { period } — a CE 'YYYY-MM' key (STRICT). Closing a period sets
// accounting_period.locked = true (the data-dictionary "ปิดงวดล็อก" invariant),
// so POST /gl/jv back-posting into it is rejected (409). Wei C-176 ruling =
// LOCK-ONLY: NO closing / retained-earnings entries are posted here — that is
// deferred (C-176 #6). Enforced (the route gates authz first), then here:
//   - period is a STRICT CE 'YYYY-MM' (400 else). A Buddhist-Era-looking year
//     (e.g. 2569 = พ.ศ.) is rejected — a real CE year sits in ~20xx. The bank
//     seed carries BE-labelled period rows ('2569-05'), so the EXACT CE param is
//     matched (company-scoped), never a naive/loose match against a BE row.
//   - resolve THIS company's accounting_period where period === <param>. If it
//     exists and is already locked → 409 INVALID_STATE. Else lock it (update),
//     or create it locked when absent.
// Returns ActionOk { period, locked: true, created, id }.

/** A STRICT CE 'YYYY-MM' key — 4-digit CE year (2000–2100) + month 01–12. A
 *  Buddhist-Era year (25xx/26xx) falls outside the CE window and is rejected,
 *  so the BE-labelled bank seed period ('2569-05') can never be closed by it. */
function isValidCePeriod(period: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12;
}

async function closeGlPeriod(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const period = str(body.period).trim();
  if (!isValidCePeriod(period)) {
    return badRequest(
      reply,
      "period must be a CE 'YYYY-MM' key (e.g. 2026-05); a Buddhist-Era year is not accepted",
    );
  }

  // Match THIS company's period by the EXACT CE param (company-scoped select —
  // a foreign or BE-labelled '2569-05' row is never naively matched).
  const [existing] = (await db.select(
    accountingPeriods,
    eq(accountingPeriods.period, period),
  )) as AccountingPeriodRow[];

  if (existing) {
    if (existing.locked) {
      return conflict(reply, `period ${period} is already closed (locked)`);
    }
    // Lock-only (Wei C-176 #6): flip locked; closing entries are deferred.
    // B-149 optimistic guard: fold the unlocked pre-state into the WHERE — a
    // concurrent close that already locked this period matches 0 rows → 409
    // (consistent with the `existing.locked` pre-check above).
    const [updated] = (await db
      .update(
        accountingPeriods,
        { locked: true },
        and(eq(accountingPeriods.id, existing.id), eq(accountingPeriods.locked, false)),
      )
      .returning()) as AccountingPeriodRow[];
    if (!updated) {
      return conflict(reply, `period ${period} is already closed (locked)`);
    }
    return reply.code(200).send({
      period,
      locked: true,
      created: false,
      id: updated.id,
    });
  }

  // No period row yet → create it already locked (lock-only; no closing entries).
  const [created] = (await db
    .insert(accountingPeriods, { period, locked: true })
    .returning()) as AccountingPeriodRow[];
  return reply.code(200).send({
    period,
    locked: true,
    created: true,
    id: created?.id ?? null,
  });
}

// ---------------------------------------------------------------------------
// POST /gl/post — post source money docs to the GL (gl.jsx GLPostingInbox → Post)
// ---------------------------------------------------------------------------
// Body: { doc_ids: uuid[] } — the client names WHICH inbox docs to post; it
// never sends money. MONEY AUTHORITY: each JV amount comes from the SOURCE ROW's
// money field (POSTING_MAP.basis, surfaced as GlPostingDoc.amount), never the
// client. Each requested doc is either POSTED (a balanced 2-leg JV) or SKIPPED
// with an honest reason — the response reports both, never fabricating a post:
//   - not in the tenant's inbox set        → skip "not found in this tenant's posting inbox"
//   - already posted (idempotent)          → skip "already posted"
//   - amount == null (gr = quantity, C10)  → skip "no postable money amount"
//   - no posting rule for the source kind  → skip "no posting rule for this source kind"
//   - a mapped COA code absent this tenant → skip "COA account missing"
//   - else → post: Dr rule.dr = amount / Cr rule.cr = amount, source_doc = "<kind>:<id>".
// finance.approve gates the route (LOCKS money into the ledger — mirror
// close-period). Each posted doc gets its own transaction (header + 2 legs; a
// leg failure rolls back the header — never an orphaned jv, mirrors createJv).

/** Parse the body's doc_ids into a deduped non-empty id list, or an error message. */
function parseDocIds(body: Record<string, unknown>): string[] | string {
  const raw = body.doc_ids;
  if (!Array.isArray(raw)) return "doc_ids must be a non-empty array";
  const ids = raw.map((v) => str(v).trim()).filter((v) => v !== "");
  if (ids.length === 0) return "doc_ids must be a non-empty array";
  return [...new Set(ids)]; // dedupe: a repeated id must never post twice
}

async function postGlDocs(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const parsed = parseDocIds(body);
  if (typeof parsed === "string") return badRequest(reply, parsed);
  const requestedIds = parsed;

  // The tenant's posting-inbox set (pending + posted), via the shared
  // source-of-truth (already company-scoped). Money authority lives here: the
  // amount is THIS row's money field, resolved server-side — the client cannot
  // influence it (it sent only doc_ids).
  const docs = await listGlPostingDocs(db);
  const byId = new Map(docs.map((d) => [d.id, d]));

  // Resolve every posting-map COA code ONCE (one company-scoped read) instead
  // of an N+1 resolve per doc. Same skip semantics as a per-doc resolve: a code
  // the tenant's COA lacks is simply absent from the map → that doc is skipped
  // (never posted against a missing/mis-mapped account).
  const accountIds = await resolveAccountIds(
    db,
    [...new Set(Object.values(POSTING_MAP).flatMap((r) => [r.dr, r.cr]))],
  );

  // JV numbers: allocate the batch's starting number ONCE, then increment per
  // posted doc so numbers never collide within a single batch. A real DB
  // continues the sequence on the next request from the committed max; the
  // in-batch increment keeps the numbers unique even before those commits land.
  const baseNo = await allocJvNo(db);
  const noMatch = /^(.*-)(\d+)$/.exec(baseNo);
  const noPrefix = noMatch ? noMatch[1]! : `${baseNo}-`;
  const seqWidth = noMatch ? noMatch[2]!.length : 4;
  let nextSeq = noMatch ? Number(noMatch[2]) : 1;
  const allocNextNo = (): string =>
    `${noPrefix}${String(nextSeq++).padStart(seqWidth, "0")}`;
  /**
   * B-318 retry allocator. This batch is the WORST case of the defect: it reads the
   * base ONCE and then increments in JS, so a concurrent batch does not collide on
   * one number — it collides across the whole RANGE. Bumping nextSeq on a collision
   * would inherit that drifted range and keep losing, so a retry must RE-BASE from
   * the committed max. (Each doc is its own committed transaction executed
   * sequentially, so the re-read always sees the winner and returns a higher number.)
   */
  const rebaseNextNo = async (): Promise<string> => {
    const fresh = await allocJvNo(db);
    const m = /^(.*-)(\d+)$/.exec(fresh);
    if (m) nextSeq = Number(m[2]);
    return allocNextNo();
  };

  const posted: { doc_id: string; source: string; jv_no: string; amount: number }[] = [];
  const skipped: { doc_id: string; reason: string }[] = [];
  let currency: string | null = null;

  for (const docId of requestedIds) {
    const doc = byId.get(docId);
    if (!doc) {
      skipped.push({ doc_id: docId, reason: "not found in this tenant's posting inbox" });
      continue;
    }
    if (doc.posted) {
      skipped.push({ doc_id: docId, reason: "already posted" });
      continue;
    }
    if (doc.amount == null || doc.amount <= 0) {
      // A doc with no real money value is NOT postable (never invent one).
      //
      // B-348 WIDENED THIS FROM `== null` TO `<= 0`, and it is defence in depth
      // rather than the primary guard. gl-posting.ts already returns null for a
      // receipt whose measurable total is 0 (no gr_item rows = the mobile shape;
      // or lines carrying no server price source). But `gr` is the first inbox
      // source whose amount is DERIVED rather than read off a stored money column,
      // so it is the first that can be 0 at all — every other kind is positive by
      // construction. A zero-amount JV is two zero legs: balanced, meaningless, and
      // it marks the document posted FOREVER, which is worse than leaving it
      // pending. Two independent places now have to fail for that to happen.
      skipped.push({ doc_id: docId, reason: "no postable money amount" });
      continue;
    }
    const rule: PostingRule | undefined =
      (POSTING_MAP as Record<string, PostingRule | undefined>)[doc.source];
    if (!rule) {
      // Defensive: listGlPostingDocs enumerates only mapped kinds today, but a
      // future inbox kind without a rule must be skipped, never mis-posted.
      skipped.push({ doc_id: docId, reason: "no posting rule for this source kind" });
      continue;
    }
    const drId = accountIds.get(rule.dr);
    const crId = accountIds.get(rule.cr);
    if (!drId || !crId) {
      skipped.push({ doc_id: docId, reason: "COA account missing" });
      continue;
    }

    const amount = round2(doc.amount); // server authority — from the source row
    const cur = doc.currency_code ?? "THB";
    if (currency == null) currency = cur;
    const jvId = randomUUID();
    // B-318: assigned INSIDE allocThenPost — the first attempt takes the in-batch
    // counter, a retry re-bases from the committed max.
    let jvNo = "";
    let attempt = 0;
    // A balanced 2-leg JV: Dr rule.dr = amount, Cr rule.cr = amount.
    const lineRows: (typeof jvLines.$inferInsert)[] = [
      { jvId, accountId: drId, dr: moneyStr(amount), cr: "0.00", currencyCode: cur },
      { jvId, accountId: crId, dr: "0.00", cr: moneyStr(amount), currencyCode: cur },
    ];
    // ONE transaction per posted doc: header + both legs together. insertThrough
    // re-proves this tenant owns the parent jv INSIDE the same tx (fail closed).
    const allocThenPost = async (): Promise<void> => {
      jvNo = attempt++ === 0 ? allocNextNo() : await rebaseNextNo();
      await db.transaction(async (tx) => {
        await tx
          .insert(jvs, {
            id: jvId,
            no: jvNo,
            sourceDoc: `${doc.source}:${doc.id}`,
            memo: `post ${doc.source} ${doc.doc_no ?? doc.id}`,
          })
          .returning();
        await tx.insertThrough(jvLines, jvs, jvId, lineRows);
        // B-233: a petty claim carries its own status column — flip it to
        // `posted` in the SAME transaction as its JV so GET /petty reflects the
        // posted state. Posted-ness for the inbox still derives from the jv
        // source_doc `petty:<id>` ref (like pv/rv/gr); the 0055 source_doc UNIQUE
        // index is the concurrent-double-post guard, and this flip rolls back with
        // the JV on any failure. pv/rv/gr have no such status column → no flip.
        if (doc.source === "petty") {
          await tx
            .update(
              pettyCashTxns,
              { status: "posted" },
              eq(pettyCashTxns.id, doc.id),
            )
            .returning();
        }
      });
    };
    try {
      await withDocNoRetry(allocThenPost);
      posted.push({ doc_id: doc.id, source: doc.source, jv_no: jvNo, amount });
    } catch (err) {
      // B-318 FIRST, and it must NOT reuse "already posted": this doc is NOT posted.
      // That existing reason is the nastiest possible lie here — the caller reads it
      // as "someone else did it" and stops trying. The batch answers 200 (other docs
      // in it really did commit), so an honest per-doc skip is the truthful analogue
      // of the 503 the single-doc handlers return.
      if (err instanceof DocNoExhaustedError) {
        skipped.push({
          doc_id: doc.id,
          reason: "document-number allocation contended — nothing posted, retry",
        });
        continue;
      }
      // P2-BE-52: a concurrent /gl/post posted this doc first — the 0037
      // source_doc UNIQUE index tripped. Map to the same idempotent skip as the
      // doc.posted pre-check (never a 500, never a duplicate JV).
      if (isUniqueViolation(err)) {
        skipped.push({ doc_id: doc.id, reason: "already posted" });
        continue;
      }
      throw err;
    }
  }

  return reply.code(200).send({
    posted,
    skipped,
    currency_code: currency ?? "THB",
  });
}

// ---------------------------------------------------------------------------
// GET /gl/periods — accounting periods (gl.jsx GLPeriodClose period picker)
// ---------------------------------------------------------------------------
// Real source: accounting_period (company-scoped). Wire = the REAL columns
// (id, period, locked, created_at). Ordered by period ascending so the picker
// renders chronologically.
async function listPeriods(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(accountingPeriods)) as AccountingPeriodRow[];
  return [...rows]
    // B-323: period is unique per company (accounting_period_company_period_uq) — id
    // floor anyway, same reasoning as the COA read.
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0) || byIdAsc(a, b))
    .map((p) => ({
      id: p.id,
      period: p.period,
      locked: p.locked,
      created_at: p.createdAt,
    }));
}

/** Register the GL routes on the given (already /api/v1-prefixed) scope. */
// ---------------------------------------------------------------------------
// GET /gl/reports/project-pl — profit & loss per project (accounting-extra2.jsx
// GLProjectPL · B-227 un-defer F-GL1). Opaque EntityOk (a single report object,
// NOT list-enveloped) — mirrors trial-balance / statements.
// ---------------------------------------------------------------------------
// Real source: jv_line (aggregated per project) THROUGH jv (jv_line has NO
// company_id — a bare select escapes tenant scope) + gl_account (company-scoped,
// supplies code + account_type) + project (company-scoped, supplies the name).
// Each jv_line is grouped by project_id and classified by its account:
//   revenue  = account_type 'revenue' (4xxx)   → credit-normal Σ(cr − dr)
//   cogs     = expense code prefix '50'         → debit-normal  Σ(dr − cr)
//   interest = expense code prefix '52' (5200)  → debit-normal  Σ(dr − cr)
//   sga      = every OTHER expense (5100 admin + any other 5xxx) → debit-normal
//              (a catch-all so no real expense is ever dropped)
// Derived per project (the prototype plNP rule — a flat 20% corporate-tax estimate,
// a real rule like VAT-7%): gross_profit = revenue − cogs · ebit = gp − sga ·
// pre_tax = ebit − interest · tax = pre_tax>0 ? round(pre_tax×0.20) : 0 ·
// net_income = pre_tax − tax. Margins are honest-null when revenue is 0 (never a
// divide-by-zero — mirror statements' margin-omit). A jv_line with a NULL
// project_id → the unallocated (central) group (project_id/name null) so real
// central activity is never dropped. money=SERVER: every figure is server-derived
// from the balanced jv_line, never a client input.
//
// NOTE (C-180, DEFERRED): the openapi declares ?period= but this handler does NOT
// filter by period — jv.period_id is NULL across the whole seed (identical to
// trial-balance / statements / cashflow). Honest deferral until the posting/close
// flow populates jv.period_id.
const PROJECT_PL_TAX_RATE = 0.2;

interface ProjectPlAcc {
  revenue: number;
  cogs: number;
  sga: number;
  interest: number;
}

async function glProjectPl(
  db: TenantDb,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [lineRows, accountRows, projectRows] = await Promise.all([
    db.selectThrough(jvLines, [{ fk: jvLines.jvId, parent: jvs }]) as Promise<JvLineRow[]>,
    db.select(glAccounts) as Promise<GlAccountRow[]>,
    db.select(projects) as Promise<ProjectRow[]>,
  ]);

  const accounts = new Map(accountRows.map((a) => [a.id, a]));
  const projName = new Map(projectRows.map((p) => [p.id, p.name]));
  const byProject = new Map<string, ProjectPlAcc>();
  let currency: string | null = null;

  for (const ln of lineRows) {
    if (currency == null) currency = ln.currencyCode ?? null;
    const account = accounts.get(ln.accountId);
    const type = account?.accountType ?? null;
    const code = account?.code ?? "";
    const dr = num(ln.dr);
    const cr = num(ln.cr);
    const key = ln.projectId ?? ""; // "" = the unallocated (central) bucket
    const acc = byProject.get(key) ?? { revenue: 0, cogs: 0, sga: 0, interest: 0 };
    if (type === "revenue") {
      acc.revenue += cr - dr; // credit-normal
    } else if (type === "expense") {
      const debit = dr - cr; // debit-normal
      if (code.startsWith("50")) acc.cogs += debit;
      else if (code.startsWith("52")) acc.interest += debit;
      else acc.sga += debit; // 5100 admin + any other operating expense (never dropped)
    }
    // asset/liability/equity lines are not part of a P&L — skipped, never an error.
    byProject.set(key, acc);
  }

  const projectsOut = [...byProject.entries()].map(([key, a]) => {
    const revenue = round2(a.revenue);
    const cogs = round2(a.cogs);
    const sga = round2(a.sga);
    const interest = round2(a.interest);
    const grossProfit = round2(revenue - cogs);
    const ebit = round2(grossProfit - sga);
    const preTax = round2(ebit - interest);
    const tax = preTax > 0 ? round2(preTax * PROJECT_PL_TAX_RATE) : 0;
    const netIncome = round2(preTax - tax);
    return {
      project_id: key || null,
      project_name: key ? projName.get(key) ?? null : null,
      revenue,
      cogs,
      gross_profit: grossProfit,
      sga,
      interest,
      pre_tax: preTax,
      tax,
      net_income: netIncome,
      gross_margin: revenue > 0 ? round2((grossProfit / revenue) * 100) : null,
      net_margin: revenue > 0 ? round2((netIncome / revenue) * 100) : null,
    };
  });
  // Highest revenue first — a stable, defined order (the mock's margin sort needs a
  // nonzero revenue the seed lacks; revenue desc is the honest ordering).
  // B-323: and because the seed lacks that revenue, EVERY project ties at 0 here — the
  // comparator returned 0 for the entire list. The rows carry no id (project_id is the
  // Map key, "" for the unallocated bucket), and the Map's insertion order comes from a
  // joined jv_line read, so it is join-plan order — not a floor. project_id is.
  projectsOut.sort(
    (a, b) =>
      b.revenue - a.revenue ||
      ((a.project_id ?? "") < (b.project_id ?? "")
        ? -1
        : (a.project_id ?? "") > (b.project_id ?? "")
          ? 1
          : 0),
  );

  const t = projectsOut.reduce(
    (s, p) => {
      s.revenue += p.revenue;
      s.cogs += p.cogs;
      s.gross_profit += p.gross_profit;
      s.sga += p.sga;
      s.interest += p.interest;
      s.net_income += p.net_income;
      return s;
    },
    { revenue: 0, cogs: 0, gross_profit: 0, sga: 0, interest: 0, net_income: 0 },
  );
  const totalRevenue = round2(t.revenue);
  const totalNetIncome = round2(t.net_income);

  return reply.code(200).send({
    projects: projectsOut,
    totals: {
      revenue: totalRevenue,
      cogs: round2(t.cogs),
      gross_profit: round2(t.gross_profit),
      sga: round2(t.sga),
      interest: round2(t.interest),
      net_income: totalNetIncome,
      net_margin: totalRevenue > 0 ? round2((totalNetIncome / totalRevenue) * 100) : null,
      project_count: projectsOut.length,
      losing_count: projectsOut.filter((p) => p.net_income < 0).length,
    },
    currency_code: currency ?? "THB",
  });
}

export function registerGlRoute(app: FastifyInstance): void {
  const withTenant =
    (run: (db: TenantDb) => Promise<Record<string, unknown>[]>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const db = request.db;
      if (!db) return unauthenticated(reply);
      return reply.code(200).send(listEnvelope(await run(db)));
    };

  app.get("/gl/coa", withTenant(getCoa));
  app.get("/gl/jv", withTenant(listJv));
  app.get("/gl/posting-inbox", withTenant(postingInbox));
  app.get("/gl/periods", withTenant(listPeriods));

  // Trial balance is the opaque EntityOk (a single report object, not a list) —
  // it is NOT wrapped in the list envelope. Fail-closed 401 without a tenant.
  app.get("/gl/reports/trial-balance", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return trialBalance(db, reply);
  });

  // Financial statements (balance sheet + income statement) — opaque EntityOk,
  // NOT list-enveloped. ?period= accepted (contract) but NOT filtered (honest
  // deferral, C-180). Fail-closed 401 without a tenant; no perm gate (a read,
  // mirrors trial-balance).
  app.get("/gl/reports/statements", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return glStatements(db, reply);
  });

  // Direct-method cash flow — opaque EntityOk. Same ?period= honest deferral +
  // fail-closed read gate (no perm gate — mirrors trial-balance).
  app.get("/gl/reports/cashflow", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return cashFlow(db, reply);
  });

  // Project P&L (B-227 F-GL1) — opaque EntityOk, NOT list-enveloped. ?period=
  // accepted (contract) but NOT filtered (honest deferral, C-180 — period_id NULL).
  // Fail-closed 401 without a tenant; no perm gate (a read, mirrors the reports).
  app.get("/gl/reports/project-pl", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return glProjectPl(db, reply);
  });

  app.post("/gl/jv", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return createJv(db, body, reply);
  });

  app.post("/gl/close-period", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    // A period close LOCKS the books (priority action) — require finance
    // `approve` (mirrors bank.ts reconcile). Fail-closed: an unattributable
    // caller, or one lacking the perm, is denied 403 before any period is locked.
    const caller = await loadCaller(request);
    if (!caller) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: "caller cannot be attributed" });
    }
    if (!permAllowed(caller.perms, FINANCE_MODULE, "approve")) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: "period close requires the finance approve permission",
      });
    }
    return closeGlPeriod(db, (request.body ?? {}) as Record<string, unknown>, reply);
  });

  app.post("/gl/post", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    // Posting LOCKS money into the ledger (priority action) — require finance
    // `approve` (mirrors close-period / bank reconcile). Fail-closed: an
    // unattributable caller, or one lacking the perm, is denied 403 before any
    // JV is written.
    const caller = await loadCaller(request);
    if (!caller) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: "caller cannot be attributed" });
    }
    if (!permAllowed(caller.perms, FINANCE_MODULE, "approve")) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: "GL posting requires the finance approve permission",
      });
    }
    return postGlDocs(db, (request.body ?? {}) as Record<string, unknown>, reply);
  });
}

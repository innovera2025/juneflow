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
import { eq, inArray } from "drizzle-orm";
import {
  accountingPeriods,
  costCenters,
  glAccounts,
  jvLines,
  jvs,
  projects,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";
import { listEnvelope } from "./list-envelope.js";
import { listGlPostingDocs } from "./gl-posting.js";

type JvRow = typeof jvs.$inferSelect;
type JvLineRow = typeof jvLines.$inferSelect;
type GlAccountRow = typeof glAccounts.$inferSelect;

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
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
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
    return a.no < b.no ? 1 : a.no > b.no ? -1 : 0;
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
  }

  // Write: jv first (scoped insert → company_id force-set), then its lines
  // through insertThrough (re-verifies this tenant owns the parent jv).
  const jvId = randomUUID();
  const [createdJv] = (await db
    .insert(jvs, {
      id: jvId,
      no: parsed.no,
      sourceDoc: parsed.sourceDoc,
      periodId: parsed.periodId,
      memo: parsed.memo,
    })
    .returning()) as JvRow[];

  const lineRows: (typeof jvLines.$inferInsert)[] = parsed.lines.map((l) => ({
    jvId,
    accountId: l.accountId,
    dr: moneyStr(l.dr),
    cr: moneyStr(l.cr),
    currencyCode: l.currencyCode,
    ccId: l.ccId,
    projectId: l.projectId,
  }));
  const createdLines = await db.insertThrough(jvLines, jvs, jvId, lineRows);

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

/** Register the GL routes on the given (already /api/v1-prefixed) scope. */
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

  app.post("/gl/jv", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return createJv(db, body, reply);
  });
}

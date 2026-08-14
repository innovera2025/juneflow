// Bank handlers — P2-BE-19 part 2, Wave-2 (finance). Wires the bank.recon +
// bank.cheque + bank.export screens: list bank statements, list a statement's
// normalized lines with per-line auto-match suggestions (F-BANK1), the manual
// match-confirm write, the cheque register, and the Export-to-Bank batch file
// (via @juneflow/bank-file). The schema (migration 0027 bank_statement_line),
// the seed, and the contract paths (openapi.yaml — the four new reads + the
// existing bank/export-batch op) ALL pre-exist. This file wires the handlers and
// is registered in app.ts.
//
// Contract (openapi.yaml §Finance-Accounting):
//   POST /bank/statements/import       → ActionOk    — import+match  (importBankStatements)
//   GET  /bank/statements              → EntityList  — statements   (listBankStatements)
//   GET  /bank/statements/{id}/lines   → EntityList  — lines+suggest (listBankStatementLines)
//   POST /bank/lines/{id}/match        → ActionOk    — manual match  (matchBankLine)
//   POST /bank/reconcile               → ActionOk    — period lock   (reconcileBank)
//   GET  /bank/cheque                  → EntityList  — cheque reg.   (listBankCheque)
//   POST /bank/export-batch            → ActionOk    — bank file      (bankExportBatch)
// Each row/body is the opaque Entity (snake_case wire of REAL columns). Reads on
// an opaque endpoint need no contract change (FLOW-A opaque-Entity finding).
//
// B-093 (Wave-2 follow-up) wires the last two ops — statement import (file →
// bank_statement + bank_statement_line rows → F-BANK1 auto-match) and the period
// reconcile lock — so the bank.recon screen's Import + Confirm buttons stop being
// honest client-intent stubs. The import file format is a fake-first CSV/JSON (no
// real bank layout exists in the prototype — see importStatement's header). The
// reconcile lock is REAL: once a period is locked, matchLine rejects a back-dated
// match (409), so the close actually closes the books.
//
// Tenant scope (fail closed): bank_statement / cheque / pv / rv / ap_billing /
// vendor all carry company_id → the scoped TenantDb.select() door. A
// bank_statement_line carries NO company_id of its own — it scopes THROUGH its
// statement (statement_id → bank_statement.company_id) via selectThrough()
// (reads) and updateThrough() (the match write), so a foreign line/statement
// resolves to nothing and is never read or written. Without a resolved tenant,
// request.db is absent and every handler answers a flat 401.
//
// F-BANK1 (Wei B-092): the auto-match SUGGEST is exact-amount + date-window.
// For each UNMATCHED line, a candidate pv / cheque / rv is suggested when
// abs(line.amount) === doc.amount (EXACT, to the 2-dp minor unit — the line
// amount is SIGNED, so its magnitude is compared) AND the doc's date is within
// ±7 calendar days of the line date. This is a suggestion only; the user
// CONFIRMS the link via POST /bank/lines/{id}/match (manual confirm). The match
// write is tenant-verified fail-closed — it never links a doc from another
// tenant, and rejects a re-match of an already-matched line.
//
// HONEST GAPs (C10 — flagged, never fabricated):
//   - "book balance" (สมุดบัญชี) has no ledger cash-balance source in this scope
//     → book_balance / difference read as honest null on a statement, not an
//     invented figure. bank_balance IS real: Σ(line.amount) (SIGNED).
//   - pv / rv carry NO doc-number column → a cheque's linked-PV number, and a
//     pv/rv suggestion/matched-doc `ref`, are honest null where the source has
//     none (a cheque carries its own `no`; a pv carries only cheque_no).
//   - a bank line matched to an RV in the seed keeps matched=true but rv_id null
//     (no RV rows are seeded — AR is Phase-5-deferred) → its matched_doc is null.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  apBillings,
  bankStatementLines,
  bankStatements,
  cheques,
  pvs,
  rvs,
  vendors,
} from "@juneflow/db/schema";
import type {
  BankFileFormatter,
  PaymentBatch,
  PaymentInstruction,
} from "@juneflow/bank-file";
import {
  FakeBankFileFormatter,
  KBankDirectFormatter,
} from "@juneflow/bank-file/kbank-direct";
import { loadBankFileConfig } from "@juneflow/bank-file/config";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";
import { listEnvelope } from "./list-envelope.js";
import { byNewestThenId, newestFirst } from "./list-order.js";
import { pick, str, toNum } from "./procurement.js";
import { loadCaller, permAllowed } from "./authz.js";

type BankStatementRow = typeof bankStatements.$inferSelect;
type BankStatementLineRow = typeof bankStatementLines.$inferSelect;
type ChequeRow = typeof cheques.$inferSelect;
type PvRow = typeof pvs.$inferSelect;
type RvRow = typeof rvs.$inferSelect;
type ApBillingRow = typeof apBillings.$inferSelect;
type VendorRow = typeof vendors.$inferSelect;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The auto-match date window (F-BANK1). A candidate doc is suggested only when
 * its date is within this many calendar days of the bank line's date — ±7 days
 * absorbs weekend/clearing lag between the statement posting and the source doc
 * date while staying tight enough that the exact-amount match stays meaningful.
 */
const MATCH_DATE_WINDOW_DAYS = 7;

/** One calendar day in ms — the date-window comparison unit. */
const MS_PER_DAY = 86_400_000;

/**
 * The perms-matrix module (seed MODULE_IDS) that governs finance actions — the
 * same `finance` module ap.ts gates PV approval on. The bank mutations enforce
 * the EXISTING 11×5 perms matrix (they invent no new policy): the period-lock
 * reconcile and the money-out batch export need finance `approve` (B-400), the
 * statement import and the line match need finance `create`. Reuses authz.ts
 * (loadCaller/permAllowed), fail-closed.
 */
const FINANCE_MODULE = "finance";

/**
 * The bank-file formatter (mock-first, PLAN.md §4). The env-selected driver
 * defaults to `fake` (FakeBankFileFormatter — deterministic, credential-free)
 * so dev / contract tests / E2E run before the real KBANK Direct layout lands
 * behind the same BankFileFormatter interface. Instantiated once at module load
 * (stateless, no per-request cost).
 */
const bankFileFormatter: BankFileFormatter = createBankFileFormatter();

/** Select the BankFileFormatter from env config (mock-first default = fake). */
function createBankFileFormatter(): BankFileFormatter {
  const config = loadBankFileConfig();
  return config.driver === "kbank-direct"
    ? new KBankDirectFormatter()
    : new FakeBankFileFormatter();
}

/** The one hop that scopes a bank_statement_line through its statement. */
const LINE_HOPS = [
  { fk: bankStatementLines.statementId, parent: bankStatements },
];

// ---------------------------------------------------------------------------
// Reply + parse helpers
// ---------------------------------------------------------------------------

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

/** Flat 404 NOT_FOUND error (contract Error shape). */
function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ code: "NOT_FOUND", message });
}

/** Flat 409 INVALID_STATE error (contract Error shape). */
function conflict(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(409).send({ code: "INVALID_STATE", message });
}

/** Coerce a drizzle numeric (string) / number / null to a finite number, else 0. */
function num(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** A computed 2-dp money magnitude as the numeric-column string ("894205.61"). */
function moneyStr(n: number): string {
  return round2(n).toFixed(2);
}

/** Epoch-ms of a calendar-date string / Date / null (UTC), else null. */
function toDateMs(value: unknown): number | null {
  if (value == null) return null;
  const ms =
    value instanceof Date ? value.getTime() : new Date(value as string).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Two dates within the ±window (both must be present — fail closed on a null date). */
function withinDateWindow(lineMs: number | null, docMs: number | null): boolean {
  if (lineMs == null || docMs == null) return false;
  return Math.abs(lineMs - docMs) <= MATCH_DATE_WINDOW_DAYS * MS_PER_DAY;
}

/** Two money magnitudes equal at the 2-dp minor unit (exact within 2^53). */
function amountEq(a: number, b: number): boolean {
  return round2(a) === round2(b);
}

// ---------------------------------------------------------------------------
// GET /bank/statements — list bank statements (bank.jsx BankReconciliation KPIs)
// ---------------------------------------------------------------------------
// Real source: bank_statement (company-scoped) + its bank_statement_line rows
// (scoped THROUGH the statement). Per statement the wire derives what the recon
// KPIs need: line_count, matched_count, matched_pct, and bank_balance =
// Σ(line.amount) (SIGNED). book_balance / difference are honest null (no ledger
// cash-balance source in this scope — header GAP).
function statementWire(
  s: BankStatementRow,
  lines: BankStatementLineRow[],
): Record<string, unknown> {
  const lineCount = lines.length;
  const matchedCount = lines.filter((l) => l.matched).length;
  const bankBalance = round2(lines.reduce((sum, l) => sum + num(l.amount), 0));
  const currency = lines[0]?.currencyCode ?? "THB";
  return {
    id: s.id,
    period: s.period,
    locked: s.locked,
    line_count: lineCount,
    matched_count: matchedCount,
    matched_pct: lineCount === 0 ? null : round2((matchedCount / lineCount) * 100),
    bank_balance: bankBalance,
    book_balance: null, // GAP: no ledger cash-balance source (header).
    difference: null, // GAP: needs book_balance to be derivable.
    currency_code: currency,
    created_at: s.createdAt,
  };
}

async function listStatements(db: TenantDb): Promise<Record<string, unknown>[]> {
  const [statements, lines] = await Promise.all([
    db.select(bankStatements) as Promise<BankStatementRow[]>,
    db.selectThrough(bankStatementLines, LINE_HOPS) as Promise<BankStatementLineRow[]>,
  ]);

  const byStatement = new Map<string, BankStatementLineRow[]>();
  for (const line of lines) {
    const bucket = byStatement.get(line.statementId);
    if (bucket) bucket.push(line);
    else byStatement.set(line.statementId, [line]);
  }

  // B-323: this hand-rolled comparator returned 0 for two statements sharing an
  // instant — which is EVERY row of one import batch — handing the pair back to the
  // heap order. newestFirst breaks the tie on id, so the list is totally ordered.
  return newestFirst(statements).map((s) => statementWire(s, byStatement.get(s.id) ?? []));
}

// ---------------------------------------------------------------------------
// GET /bank/statements/{id}/lines — a statement's normalized lines (bank.jsx STMT)
// ---------------------------------------------------------------------------
// Tenant-scoped via statement → company (404 when the statement is not this
// tenant's). Each line carries its SIGNED amount + match state. For a MATCHED
// line, `matched_doc` resolves the linked pv/cheque/rv (honest null when the FK
// is null — e.g. an RV-matched seed line has no rv row). For an UNMATCHED line,
// `suggestions` (F-BANK1) lists candidate docs with an EXACT amount and a date
// within ±MATCH_DATE_WINDOW_DAYS of the line — the auto-suggest the user then
// CONFIRMS via POST /bank/lines/{id}/match.

/** The tenant's pv / cheque / rv candidate pool for suggestions + matched-doc. */
interface DocPools {
  pv: PvRow[];
  cheque: ChequeRow[];
  rv: RvRow[];
}

/** A resolved matched doc, or a suggestion candidate, for the line wire. */
interface DocRef {
  type: "pv" | "cheque" | "rv";
  id: string;
  ref: string | null; // human-readable doc id where the source has one, else honest null
  amount: number;
  date: unknown; // the date compared against the line window (calendar string / timestamp)
}

/** The date a doc is compared against the line window by (best available, honest). */
function pvDate(pv: PvRow): unknown {
  return pv.chequeDate ?? pv.createdAt;
}
function chequeDate(c: ChequeRow): unknown {
  return c.dueDate ?? c.createdAt;
}
function rvDate(rv: RvRow): unknown {
  return rv.createdAt;
}

/** Auto-match suggestions for an UNMATCHED line (F-BANK1: exact-amount + date-window).
 *  Reads only the line's SIGNED `amount` + `lineDate` (widened so the import
 *  auto-match can reuse it with a pre-insert line-like — B-093), so a full
 *  BankStatementLineRow (lineWire) and a `{amount, lineDate}` shape both fit. */
function buildSuggestions(
  line: Pick<BankStatementLineRow, "amount" | "lineDate">,
  pools: DocPools,
): DocRef[] {
  const target = round2(Math.abs(num(line.amount))); // SIGNED line → compare magnitude
  const lineMs = toDateMs(line.lineDate);
  const out: DocRef[] = [];

  for (const pv of pools.pv) {
    // A PV's real bank cash-out is its NET (gross − WHT − retention), not the
    // GROSS `amount` — a transfer PV debits the bank for net. Match + display the
    // suggestion on pv.net so the candidate lines up with the actual withdrawal
    // (audit-flagged net-vs-gross). Cheque/RV stay on their own `amount`.
    if (amountEq(num(pv.net), target) && withinDateWindow(lineMs, toDateMs(pvDate(pv)))) {
      out.push({ type: "pv", id: pv.id, ref: pv.chequeNo ?? null, amount: num(pv.net), date: pvDate(pv) });
    }
  }
  for (const c of pools.cheque) {
    if (amountEq(num(c.amount), target) && withinDateWindow(lineMs, toDateMs(chequeDate(c)))) {
      out.push({ type: "cheque", id: c.id, ref: c.no, amount: num(c.amount), date: chequeDate(c) });
    }
  }
  for (const rv of pools.rv) {
    if (amountEq(num(rv.amount), target) && withinDateWindow(lineMs, toDateMs(rvDate(rv)))) {
      out.push({ type: "rv", id: rv.id, ref: null, amount: num(rv.amount), date: rvDate(rv) });
    }
  }
  return out;
}

/** The doc a MATCHED line links to (honest null when the FK / row is absent). */
function resolveMatchedDoc(line: BankStatementLineRow, pools: DocPools): DocRef | null {
  if (line.pvId) {
    const pv = pools.pv.find((p) => p.id === line.pvId);
    // Show the PV's NET (real bank cash-out) — the SAME figure buildSuggestions
    // matches + displays a candidate on — so a matched line's matched_doc amount
    // agrees with the suggestion and the actual withdrawal, instead of the GROSS
    // `amount` (B-096 fix 3: gross→net display consistency). Cheque/RV keep their
    // own `amount` (their stored figure IS the cash movement).
    return pv ? { type: "pv", id: pv.id, ref: pv.chequeNo ?? null, amount: num(pv.net), date: pvDate(pv) } : null;
  }
  if (line.chequeId) {
    const c = pools.cheque.find((x) => x.id === line.chequeId);
    return c ? { type: "cheque", id: c.id, ref: c.no, amount: num(c.amount), date: chequeDate(c) } : null;
  }
  if (line.rvId) {
    const rv = pools.rv.find((r) => r.id === line.rvId);
    return rv ? { type: "rv", id: rv.id, ref: null, amount: num(rv.amount), date: rvDate(rv) } : null;
  }
  return null;
}

function lineWire(line: BankStatementLineRow, pools: DocPools): Record<string, unknown> {
  return {
    id: line.id,
    statement_id: line.statementId,
    line_date: line.lineDate,
    description: line.description,
    amount: num(line.amount), // SIGNED — deposit +, withdrawal −
    currency_code: line.currencyCode,
    matched: line.matched,
    pv_id: line.pvId,
    cheque_id: line.chequeId,
    rv_id: line.rvId,
    matched_doc: line.matched ? resolveMatchedDoc(line, pools) : null,
    suggestions: line.matched ? [] : buildSuggestions(line, pools),
  };
}

async function listStatementLines(
  db: TenantDb,
  statementId: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  // Statement must belong to this tenant (scoped select — a foreign id is absent).
  const [statement] = (await db.select(
    bankStatements,
    eq(bankStatements.id, statementId),
  )) as BankStatementRow[];
  if (!statement) {
    return notFound(reply, `bank statement ${statementId} not found`);
  }

  const [lines, pv, cheque, rv] = await Promise.all([
    db.selectThrough(
      bankStatementLines,
      LINE_HOPS,
      eq(bankStatementLines.statementId, statementId),
    ) as Promise<BankStatementLineRow[]>,
    db.select(pvs) as Promise<PvRow[]>,
    db.select(cheques) as Promise<ChequeRow[]>,
    db.select(rvs) as Promise<RvRow[]>,
  ]);

  const pools: DocPools = { pv, cheque, rv };
  const rows = [...lines]
    .sort((a, b) => {
      const at = toDateMs(a.lineDate) ?? 0;
      const bt = toDateMs(b.lineDate) ?? 0;
      if (at !== bt) return bt - at; // newest line first
      // B-323: line_date is a business DATE, so ties are the NORM here, not an edge —
      // a statement routinely carries several lines on one day, and this comparator
      // returned 0 for every one of them, leaving their order to the join plan. Fall
      // through to the shared total order: created_at (the seed's stagger, and real
      // import order) and then id, which is unique by construction.
      return byNewestThenId(a, b);
    })
    .map((l) => lineWire(l, pools));
  return reply.code(200).send(listEnvelope(rows));
}

// ---------------------------------------------------------------------------
// POST /bank/lines/{id}/match — manual confirm of a line ↔ doc match (F-BANK1)
// ---------------------------------------------------------------------------
// Body: { pv_id? | cheque_id? | rv_id? } — EXACTLY one. MANUAL CONFIRM: set the
// line's matched=true + the chosen FK. Enforced, in order:
//   - exactly one of pv_id / cheque_id / rv_id (else 400).
//   - the line must be THIS tenant's (scoped THROUGH its statement — 404 else).
//   - the line must be UNMATCHED (409 on a re-match).
//   - the referenced pv / cheque / rv must be THIS tenant's (fail closed — a
//     foreign doc resolves to nothing through the scoped select → 400; a foreign
//     doc is NEVER linked).
// The write goes through updateThrough() (anchored on the line's statement), so
// it re-proves statement ownership before touching the row.

/** The chosen match target parsed from the body (exactly one, else an error string). */
type MatchTarget =
  | { field: "pvId" | "chequeId" | "rvId"; id: string }
  | { error: string };

function parseMatchTarget(body: Record<string, unknown>): MatchTarget {
  const pvId = str(pick(body, "pv_id", "pvId")).trim();
  const chequeId = str(pick(body, "cheque_id", "chequeId")).trim();
  const rvId = str(pick(body, "rv_id", "rvId")).trim();
  const chosen: { field: "pvId" | "chequeId" | "rvId"; id: string }[] = [];
  if (pvId) chosen.push({ field: "pvId", id: pvId });
  if (chequeId) chosen.push({ field: "chequeId", id: chequeId });
  if (rvId) chosen.push({ field: "rvId", id: rvId });
  if (chosen.length !== 1) {
    return { error: "exactly one of pv_id, cheque_id, rv_id is required" };
  }
  return chosen[0]!;
}

/** Verify the chosen doc belongs to this tenant (scoped select — fail closed). */
async function docBelongsToTenant(
  db: TenantDb,
  field: "pvId" | "chequeId" | "rvId",
  id: string,
): Promise<boolean> {
  if (field === "pvId") {
    const [row] = await db.select(pvs, eq(pvs.id, id));
    return Boolean(row);
  }
  if (field === "chequeId") {
    const [row] = await db.select(cheques, eq(cheques.id, id));
    return Boolean(row);
  }
  const [row] = await db.select(rvs, eq(rvs.id, id));
  return Boolean(row);
}

function matchLineWire(line: BankStatementLineRow): Record<string, unknown> {
  return {
    id: line.id,
    statement_id: line.statementId,
    line_date: line.lineDate,
    description: line.description,
    amount: num(line.amount),
    currency_code: line.currencyCode,
    matched: line.matched,
    pv_id: line.pvId,
    cheque_id: line.chequeId,
    rv_id: line.rvId,
  };
}

async function matchLine(
  db: TenantDb,
  lineId: string,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const target = parseMatchTarget(body);
  if ("error" in target) return badRequest(reply, target.error);

  // The line must be this tenant's — scoped THROUGH its statement (fail closed).
  const [line] = (await db.selectThrough(
    bankStatementLines,
    LINE_HOPS,
    eq(bankStatementLines.id, lineId),
  )) as BankStatementLineRow[];
  if (!line) {
    return notFound(reply, `bank statement line ${lineId} not found`);
  }
  if (line.matched) {
    return conflict(reply, "line is already matched");
  }

  // A reconciled (locked) period is closed to back-dated match changes — the
  // enforcement side of POST /bank/reconcile. The line's own statement carries
  // the lock; a locked statement rejects any further match (409) so the close
  // actually holds (C10 — the lock is not decorative).
  const [statement] = (await db.select(
    bankStatements,
    eq(bankStatements.id, line.statementId),
  )) as BankStatementRow[];
  if (statement?.locked) {
    return conflict(
      reply,
      "statement period is locked — reconciliation is closed",
    );
  }

  // Never link a foreign doc — the referenced pv/cheque/rv must be this tenant's.
  const owned = await docBelongsToTenant(db, target.field, target.id);
  if (!owned) {
    return badRequest(reply, `${matchFieldName(target.field)} not found in this tenant`);
  }

  // B-094-2: a single pv/cheque/rv settles at most ONE statement line — reject a
  // reverse double-reconcile (linking the same payment to a second line). Scoped
  // THROUGH the statement (a foreign line is invisible → fail closed). The DB
  // filter narrows to matched rows carrying this FK; the JS guard re-checks (the
  // WHERE is authoritative in prod, the in-memory re-check keeps it correct even
  // where a candidate row is returned unfiltered) and excludes this same line.
  const fkColumn = matchFkColumn(target.field);
  const existingLinks = (await db.selectThrough(
    bankStatementLines,
    LINE_HOPS,
    and(eq(fkColumn, target.id), eq(bankStatementLines.matched, true)),
  )) as BankStatementLineRow[];
  const alreadyLinked = existingLinks.some(
    (l) => l.id !== lineId && l.matched && lineFk(l, target.field) === target.id,
  );
  if (alreadyLinked) {
    return conflict(
      reply,
      `${matchFieldName(target.field)} is already matched to another statement line`,
    );
  }
  // B-096 note: this scoped pre-check (the project's uniqueness convention — cf.
  // users.ts DUPLICATE_EMAIL) gracefully rejects the common double-reconcile. A
  // residual concurrent-race (two matches passing this check before either
  // writes) would still hit the migration-0028 unique index (a 500), which no
  // pre-check can close — only a transactional/locking door can. That is the same
  // B-085-class door-layer gap flagged for importStatement; catching the raw
  // constraint error is deliberately NOT done here (no such pattern exists in the
  // codebase and it would risk masking a genuine error).

  // Set matched=true + the chosen FK (the other two stay null). updateThrough
  // re-proves this tenant owns the line's statement before writing the row.
  // B-149 optimistic guard: fold the unmatched pre-state into the WHERE so a
  // concurrent match of the SAME line matches 0 rows here → 409 (the migration-0028
  // unique index covers the FK double-link across lines; this closes the same-line
  // double-flip the JS pre-check above cannot).
  const [updated] = (await db.updateThrough(
    bankStatementLines,
    bankStatements,
    bankStatementLines.statementId,
    line.statementId,
    {
      matched: true,
      pvId: target.field === "pvId" ? target.id : null,
      chequeId: target.field === "chequeId" ? target.id : null,
      rvId: target.field === "rvId" ? target.id : null,
    },
    and(eq(bankStatementLines.id, lineId), eq(bankStatementLines.matched, false)),
  )) as BankStatementLineRow[];
  if (!updated) {
    return conflict(reply, "line is already matched");
  }

  return reply.code(200).send(matchLineWire(updated));
}

/** The wire field name for a match target (for the fail-closed 400 message). */
function matchFieldName(field: "pvId" | "chequeId" | "rvId"): string {
  return field === "pvId" ? "pv_id" : field === "chequeId" ? "cheque_id" : "rv_id";
}

/** The bank_statement_line FK column for a match target (reverse-uniqueness query). */
function matchFkColumn(field: "pvId" | "chequeId" | "rvId") {
  return field === "pvId"
    ? bankStatementLines.pvId
    : field === "chequeId"
      ? bankStatementLines.chequeId
      : bankStatementLines.rvId;
}

/** The stored FK value on a line for a match target (reverse-uniqueness re-check). */
function lineFk(
  line: BankStatementLineRow,
  field: "pvId" | "chequeId" | "rvId",
): string | null {
  return field === "pvId" ? line.pvId : field === "chequeId" ? line.chequeId : line.rvId;
}

// ---------------------------------------------------------------------------
// GET /bank/cheque — the cheque register (bank.jsx BankCheque)
// ---------------------------------------------------------------------------
// Real source: cheque (company-scoped). Wire carries the REAL columns: no,
// amount, due_date, status, and pv_id (the issuing PV back-link). pv_no is an
// honest null — the pv table has no doc-number column (header GAP), so the
// prototype's "PV-2026-xxxx" reference is not reconstructable from the pv row.
function chequeWire(c: ChequeRow): Record<string, unknown> {
  return {
    id: c.id,
    no: c.no,
    amount: num(c.amount),
    due_date: c.dueDate,
    status: c.status,
    pv_id: c.pvId,
    pv_no: null, // GAP: pv has no own doc-number column (header).
    currency_code: c.currencyCode,
    created_at: c.createdAt,
  };
}

async function listCheque(db: TenantDb): Promise<Record<string, unknown>[]> {
  const chequeRows = (await db.select(cheques)) as ChequeRow[];
  // B-323: same tie-blind comparator as listStatements — total-order it.
  return newestFirst(chequeRows).map(chequeWire);
}

// ---------------------------------------------------------------------------
// POST /bank/export-batch — Export-to-Bank payment file (bank.jsx BankExport)
// ---------------------------------------------------------------------------
// Body (opaque, optional): { pv_ids?[], batch_id?, value_date?, debit_account_no? }.
// Take the tenant's APPROVED + TRANSFER-method PVs that have NOT been sent yet
// (bank.jsx "อนุมัติแล้ว · โอน" narrowed to the waiting-to-send set), optionally
// restricted to pv_ids (a foreign/ineligible id is silently excluded — a foreign
// PV is NEVER exported), STAMP them with this batch's id, and format the batch via
// @juneflow/bank-file (mock-first FakeBankFileFormatter by default). Each
// instruction pays the PV's NET (the cash that leaves the bank) to the payee
// vendor (resolved billing_ids[0] → ap_billing → vendor); the vendor's stored
// `bank` string is the only beneficiary-account source (honest — no structured
// account/bank-code column).
//
// B-397 (the post-export lock). This handler used to be a pure build+return that
// mutated nothing, so the batch id it minted was stored NOWHERE. pv.status has
// exactly ONE writer in the repo (ap.ts pending→approved) and no paid/exported
// state exists at all — an approved transfer PV therefore stayed eligible for
// EVERY future export forever, and even one CORRECT upload left the same payment
// to be re-emitted in the next legitimate batch. The prototype states the lock in
// three places that agree: bank.jsx:226 "ระบบจะ ล็อกการเปลี่ยนแปลง PV ที่ส่งธนาคารแล้ว ·
// ถ้าต้องแก้ ต้องสร้างใบใหม่", real-forms2.jsx:463-471 (confirm copy + "… + ล็อก PV"),
// docs/handoff/FUNCTIONS.md:88 "openBatchConfirm Export to Bank (ล็อก PV)"; and
// bank.jsx:166's filter separates "รอส่งธนาคาร" from "ส่งแล้ว" — a sent PV is not in
// the waiting-to-send set. The lock is persisted on the column that ALREADY exists,
// pv.batch_id (data-dictionary:90 + erd:85; schema/finance.ts "batch_id groups PVs
// for a bank export") — no migration, no new state column, no contract change:
//   - eligibility now requires batch_id IS NULL (that IS the "รอส่งธนาคาร" set);
//   - the stamp is ONE guarded UPDATE inside a transaction, with the B-149 guard
//     (batch_id IS NULL) on the FINAL UPDATE's WHERE — never on the read that
//     resolved the candidates, or two exports under READ COMMITTED both pass;
//   - ONLY the rows that UPDATE returned are emitted, so an instruction can exist
//     only for a PV THIS transaction locked. If the stamp did not happen, the
//     instruction is not written;
//   - an explicit pv_ids naming an already-sent PV is a 409 (the caller asked for
//     that voucher by id and must be told, not silently dropped), and nothing left
//     to send is a 409 as well — a zero-instruction bank file is a footgun.
// Nothing else moves: file format, value-date defaulting, payee resolution, the
// KBANK line shape and the response envelope are unchanged.

/**
 * uuid matcher — the per-file idiom already in labor.ts / audit-log.ts / gr.ts.
 *
 * B-397: batch_id is now PERSISTED into pv.batch_id, a `uuid` column. A caller-
 * supplied batch_id that is not a uuid used to be harmless (it was only echoed);
 * writing it would now be `SET batch_id = 'batch-1'` → 22P02 → a 500. Same reason
 * labor.ts B-340 shape-checks cc_id before it reaches a query: refuse it at the
 * door rather than let the column decide.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve each PV's payee (billing_ids[0] → ap_billing → vendor), tenant-scoped. */
function resolvePayees(
  pvRows: PvRow[],
  bills: ApBillingRow[],
  vendorRows: VendorRow[],
): Map<string, { vendorId: string | null; vendorName: string | null }> {
  const billVendor = new Map(bills.map((b) => [b.id, b.vendorId]));
  const vendorNames = new Map(vendorRows.map((v) => [v.id, v.name]));
  const out = new Map<string, { vendorId: string | null; vendorName: string | null }>();
  for (const pv of pvRows) {
    const firstBilling = pv.billingIds[0] ?? null;
    const vendorId = firstBilling ? billVendor.get(firstBilling) ?? null : null;
    out.set(pv.id, {
      vendorId,
      vendorName: vendorId ? vendorNames.get(vendorId) ?? null : null,
    });
  }
  return out;
}

async function exportBatch(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const pvIdsRaw = pick(body, "pv_ids", "pvIds");
  const requestedIds = Array.isArray(pvIdsRaw)
    ? new Set(pvIdsRaw.map((v) => str(v).trim()).filter((v) => v !== ""))
    : null;
  const suppliedBatchId = str(pick(body, "batch_id", "batchId")).trim();
  // B-397: the id is written to a uuid column now — shape-check it before the write.
  if (suppliedBatchId !== "" && !UUID_RE.test(suppliedBatchId)) {
    return badRequest(reply, "batch_id must be a uuid");
  }
  const batchId = suppliedBatchId || randomUUID();
  const valueDate =
    str(pick(body, "value_date", "valueDate")).trim() ||
    new Date().toISOString().slice(0, 10);
  const debitAccountNo = str(pick(body, "debit_account_no", "debitAccountNo")).trim();

  const [pvRows, bills, vendorRows] = await Promise.all([
    db.select(pvs) as Promise<PvRow[]>,
    db.select(apBillings) as Promise<ApBillingRow[]>,
    db.select(vendors) as Promise<VendorRow[]>,
  ]);

  // B-397: an EXPLICIT pv_ids naming an already-sent PV is a 409, not a silent
  // drop — the caller asked for that voucher BY ID, so it must be told the voucher
  // is locked (bank.jsx:226 "ถ้าต้องแก้ ต้องสร้างใบใหม่"). An UNFILTERED call carries
  // no such claim and simply exports whatever is still waiting. Fail before any
  // stamp: a rejected request leaves the whole batch unstamped.
  if (requestedIds) {
    const alreadySent = pvRows.filter((pv) => requestedIds.has(pv.id) && pv.batchId != null);
    if (alreadySent.length > 0) {
      return conflict(
        reply,
        `already exported to the bank: ${alreadySent.map((pv) => pv.id).join(", ")} — ` +
          "a sent payment voucher is locked; issue a new voucher to pay it again",
      );
    }
  }

  // Eligible = approved + transfer-method + NOT YET SENT (bank.jsx "อนุมัติแล้ว · โอน"
  // within the waiting-to-send set — B-397), restricted to pv_ids when given. A
  // foreign id is absent from the tenant-scoped pvRows → never exported.
  const eligible = pvRows.filter(
    (pv) =>
      pv.status === "approved" &&
      pv.method === "transfer" &&
      pv.batchId == null &&
      (!requestedIds || requestedIds.has(pv.id)),
  );
  if (eligible.length === 0) {
    return conflict(
      reply,
      "no payment voucher is waiting to be sent to the bank " +
        "(approved + transfer method, not yet exported)",
    );
  }

  const vendorById = new Map(vendorRows.map((v) => [v.id, v]));
  const candidateIds = eligible.map((pv) => pv.id);

  // STAMP FIRST, THEN EMIT (B-397). The B-149 guard (batch_id IS NULL) sits on the
  // FINAL UPDATE's WHERE, not on the read above: under READ COMMITTED two exports
  // resolve the SAME candidate list, and only the re-check at write time makes the
  // loser update 0 rows for a PV the winner already took. Everything downstream is
  // derived from the rows the UPDATE RETURNED — a PV the guard excluded is absent
  // from the instructions, from pv_ids and from the total. The formatter runs
  // INSIDE the transaction so a formatting failure rolls the stamp back instead of
  // locking vouchers into a batch file that was never produced.
  const sent = await db.transaction(async (tx) => {
    const stamped = (await tx
      .update(
        pvs,
        { batchId },
        and(inArray(pvs.id, candidateIds), isNull(pvs.batchId)),
      )
      .returning()) as PvRow[];
    if (stamped.length === 0) return null;

    // TOTAL order (B-323). The first cut ranked rows by their position in the
    // candidate read — but that read is a bare `db.select(pvs)` with no ORDER BY
    // and no comparator, so "read order" was the join plan's order wearing a map.
    // newestFirst is the house comparator this file already uses for statements
    // (:242) and cheques (:609): total by construction (created_at, then id), so
    // the instruction order in a real bank file is the code's, not the planner's.
    const rows = newestFirst(stamped);
    const payees = resolvePayees(rows, bills, vendorRows);
    const instructions: PaymentInstruction[] = rows.map((pv) => {
      const payee = payees.get(pv.id);
      const vendor = payee?.vendorId ? vendorById.get(payee.vendorId) : undefined;
      return {
        beneficiaryName: payee?.vendorName ?? "",
        beneficiaryAccountNo: vendor?.bank ?? "", // honest — free-text bank/account string
        beneficiaryBankCode: "", // honest — no structured bank code stored
        amount: { amount: moneyStr(num(pv.net)), currencyCode: pv.currencyCode },
        reference: pv.id,
      };
    });

    const batch: PaymentBatch = {
      batchId,
      companyId: tx.companyId,
      debitAccountNo,
      valueDate,
      instructions,
    };
    return { rows, file: await bankFileFormatter.formatPaymentBatch(batch) };
  });
  if (!sent) {
    // Every candidate was taken between the read and the guarded write — nothing
    // was stamped here, so there is nothing to send (and no file to hand back).
    return conflict(
      reply,
      "every candidate payment voucher was exported by a concurrent batch — " +
        "nothing left to send",
    );
  }

  const { rows, file } = sent;
  const totalAmount = round2(rows.reduce((sum, pv) => sum + num(pv.net), 0));
  const currency = rows[0]?.currencyCode ?? "THB";

  return reply.code(200).send({
    batch_id: batchId,
    format: bankFileFormatter.format,
    file_name: file.fileName,
    content: file.content,
    encoding: file.encoding,
    value_date: valueDate,
    debit_account_no: debitAccountNo || null,
    pv_count: rows.length,
    pv_ids: rows.map((pv) => pv.id),
    total_amount: totalAmount,
    currency_code: currency,
  });
}

// ---------------------------------------------------------------------------
// POST /bank/statements/import — import a statement file → auto-match (F-BANK1)
// ---------------------------------------------------------------------------
// Import format (fake-first, mock-first PLAN.md §4 — there is NO real bank layout
// in the prototype: bank.jsx openBankImport was a decorative "42 rows · 38
// auto-matched" toast). The uploaded statement is a SIMPLE deterministic CSV:
//     date,description,amount
// one row per line; an optional header row (`date,description,amount`) is
// skipped; `amount` is SIGNED — a deposit is positive, a withdrawal negative
// (bank.jsx STMT `v`). In prod a multipart parser fills the contract's `file`
// field with the uploaded bytes; in THIS skeleton no multipart parser is wired
// (mirrors files.ts, which reads its field from the body), so the CSV text is
// read from the request body `file` (or `content`) string field. A structured,
// already-parsed `lines: [{date, description, amount}]` array is also accepted.
// Optional top-level fields: `period` (YYYY-MM) + `currency_code` (default THB).
// A real bank-specific statement parser (KBANK/SCB/BBL layouts) is a future
// integration behind this same endpoint.
//
// The import (c) runs the SAME F-BANK1 buildSuggestions (exact-amount +
// ±date-window) over this tenant's pv/cheque/rv pool to PRE-mark a line matched
// ONLY when it has EXACTLY ONE candidate doc that no earlier row in this same
// import already consumed, then (a) creates the bank_statement (scoped insert
// door — company_id force-set) keeping the raw parsed rows in the additive
// `lines` jsonb, and (b) creates one normalized bank_statement_line per row
// THROUGH the statement (insertThrough re-proves this tenant owns the parent). A
// row with zero or multiple candidates stays unmatched for the user to resolve
// via POST /bank/lines/{id}/match — the import NEVER fabricates or guesses a
// match (C10).
//
// B-096 fix 1 (graceful reverse-uniqueness): the auto-match pool EXCLUDES any
// doc already linked to an existing matched bank_statement_line (loadConsumedDocs
// — the import-side mirror of matchLine's B-094-2 scoped reverse-check). Without
// this, a second import auto-matching an already-consumed pv/cheque/rv would hit
// the migration-0028 partial-unique index and 500; instead the consumed doc is
// simply left unmatched for the manual flow (still C10-honest — never guessed).
//
// B-096 fix 2 (atomicity / no orphaned statement): TenantDb exposes NO
// transaction door (see tenant-db.ts — the base handle is private and there is
// no db.transaction()), so a true all-or-nothing statement+lines write is a
// B-085-class door-layer fix flagged separately, NOT invented here. As a partial
// mitigation the reads + the auto-match DECISIONS are all computed FIRST and the
// statement is created LAST among the writes, so a failure in the read/compute
// phase leaves no orphaned statement — the only residual orphan window is a
// failing insertThrough (whose common consumed-doc collision fix 1 removes; a
// concurrent-race collision remains the transactional-door concern).
//
// A malformed file (no lines, or a row whose amount is not a finite number) →
// 400. Returns { statement_id, period, line_count, matched_count, currency_code }.

/** One parsed import row (pre-insert): SIGNED amount + calendar date + memo. */
interface ImportLine {
  lineDate: string | null;
  description: string | null;
  amount: number; // SIGNED — deposit +, withdrawal −
}

/** A parse failure carrying a client-facing 400 message. */
interface ParseError {
  error: string;
}

/** Stable dedup key for a candidate doc (type+id) within one import. */
function docKey(doc: DocRef): string {
  return `${doc.type}:${doc.id}`;
}

/** Parse a CSV `date,description,amount` body into import lines (header skipped). */
function parseCsv(text: string): ImportLine[] | ParseError {
  const rows = text
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter((r) => r !== "");
  const out: ImportLine[] = [];
  for (const [i, row] of rows.entries()) {
    const parts = row.split(",");
    if (parts.length < 2) {
      return { error: `malformed CSV row ${i + 1}: expected date,description,amount` };
    }
    const date = parts[0]!.trim();
    const amountRaw = parts[parts.length - 1]!.trim();
    const description = parts.slice(1, -1).join(",").trim();
    const amount = toNum(amountRaw);
    if (amount === null) {
      // A first row whose amount column is non-numeric is a header → skip it;
      // any OTHER non-numeric amount is malformed data.
      if (i === 0 && date.toLowerCase() === "date") continue;
      return { error: `malformed CSV row ${i + 1}: amount "${amountRaw}" is not a number` };
    }
    out.push({ lineDate: date || null, description: description || null, amount });
  }
  return out;
}

/** Parse a structured `lines:[{date,description,amount}]` array into import lines. */
function parseLines(raw: unknown): ImportLine[] | ParseError {
  if (!Array.isArray(raw)) return { error: "lines must be an array" };
  const out: ImportLine[] = [];
  for (const [i, item] of raw.entries()) {
    if (typeof item !== "object" || item === null) {
      return { error: `line ${i + 1} is not an object` };
    }
    const rec = item as Record<string, unknown>;
    const amount = toNum(pick(rec, "amount"));
    if (amount === null) return { error: `line ${i + 1}: amount is not a number` };
    const date = str(pick(rec, "date", "line_date", "lineDate")).trim();
    const description = str(pick(rec, "description", "desc")).trim();
    out.push({ lineDate: date || null, description: description || null, amount });
  }
  return out;
}

/**
 * The pv / cheque / rv already linked to a MATCHED bank_statement_line, keyed by
 * type — the import-side mirror of matchLine's B-094-2 reverse-uniqueness guard
 * (B-096 fix 1). Scoped THROUGH the statement (LINE_HOPS anchors company_id on
 * the tenant root), so a foreign line is invisible → fail closed. The `matched`
 * predicate is authoritative in prod; the in-memory re-check keeps it correct
 * where a stub/candidate row is returned unfiltered (same pattern matchLine uses).
 * The import filters these out of its auto-match pool so a consumed doc is never
 * re-linked (the migration-0028 partial-unique index would otherwise 500).
 */
async function loadConsumedDocs(
  db: TenantDb,
): Promise<{ pv: Set<string>; cheque: Set<string>; rv: Set<string> }> {
  const matchedLines = (await db.selectThrough(
    bankStatementLines,
    LINE_HOPS,
    eq(bankStatementLines.matched, true),
  )) as BankStatementLineRow[];
  const consumed = {
    pv: new Set<string>(),
    cheque: new Set<string>(),
    rv: new Set<string>(),
  };
  for (const l of matchedLines) {
    if (!l.matched) continue; // in-memory re-check (the WHERE is authoritative)
    if (l.pvId) consumed.pv.add(l.pvId);
    if (l.chequeId) consumed.cheque.add(l.chequeId);
    if (l.rvId) consumed.rv.add(l.rvId);
  }
  return consumed;
}

async function importStatement(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  // The uploaded file (CSV text in `file`/`content`) OR a structured `lines[]`.
  const fileText = str(pick(body, "file", "content", "csv")).trim();
  const linesRaw = pick(body, "lines");
  let parsed: ImportLine[] | ParseError;
  if (fileText !== "") {
    parsed = parseCsv(fileText);
  } else if (linesRaw !== undefined) {
    parsed = parseLines(linesRaw);
  } else {
    return badRequest(reply, "no statement file provided (send `file` CSV text or `lines[]`)");
  }
  if ("error" in parsed) return badRequest(reply, parsed.error);
  if (parsed.length === 0) {
    return badRequest(reply, "statement is empty — no lines to import");
  }

  const period = str(pick(body, "period")).trim() || null;
  const currency = str(pick(body, "currency_code", "currencyCode")).trim() || "THB";

  // Read + compute the auto-match DECISIONS BEFORE writing anything, so a failure
  // in this phase leaves NO orphaned statement (B-096 fix 2 — TenantDb has no
  // transaction door; the statement is created LAST among the writes).
  //
  // (c) F-BANK1 auto-match candidate pools (this tenant's pv/cheque/rv), MINUS
  // any doc already consumed by a matched line (B-096 fix 1 — the migration-0028
  // partial-unique index would reject a duplicate FK; a consumed doc is left
  // unmatched for the manual flow, never guessed — C10).
  const [pvAll, chequeAll, rvAll, consumed] = await Promise.all([
    db.select(pvs) as Promise<PvRow[]>,
    db.select(cheques) as Promise<ChequeRow[]>,
    db.select(rvs) as Promise<RvRow[]>,
    loadConsumedDocs(db),
  ]);
  const pools: DocPools = {
    pv: pvAll.filter((p) => !consumed.pv.has(p.id)),
    cheque: chequeAll.filter((c) => !consumed.cheque.has(c.id)),
    rv: rvAll.filter((r) => !consumed.rv.has(r.id)),
  };

  // (b′) Decide each row's auto-match while the statement does NOT yet exist —
  // pure in-memory over the read pools: PRE-mark a match ONLY on an unambiguous
  // single candidate not already consumed EARLIER IN THIS import (never guess).
  const usedDocs = new Set<string>();
  const decisions = parsed.map((row) => {
    const amountStr = moneyStr(row.amount); // SIGNED numeric-column string
    const suggestions = buildSuggestions({ amount: amountStr, lineDate: row.lineDate }, pools);
    const only = suggestions.length === 1 ? suggestions[0]! : null;
    const autoDoc = only && !usedDocs.has(docKey(only)) ? only : null;
    if (autoDoc) usedDocs.add(docKey(autoDoc));
    return { row, amountStr, autoDoc };
  });
  const matchedCount = decisions.filter((d) => d.autoDoc !== null).length;

  // (a) B-097: statement header + its lines are ONE import — write them in a
  // single transaction (scoped insert → company_id force-set; raw rows kept in
  // the additive `lines` jsonb). If a line insert fails (e.g. the migration-0028
  // reverse-unique index rejecting a doc consumed by a concurrent import), the
  // whole block rolls back, leaving no orphaned bank_statement row. This
  // supersedes the earlier create-last mitigation. insertThrough re-proves this
  // tenant owns the parent inside the same transaction (tx carries company_id).
  const statementId = await db.transaction(async (tx) => {
    const [statement] = (await tx
      .insert(bankStatements, {
        period,
        lines: parsed as unknown[],
        locked: false,
      })
      .returning()) as BankStatementRow[];
    const sid = statement!.id;

    // (b) Materialize the decided lines under the created statement.
    const lineRows = decisions.map((d) => ({
      statementId: sid,
      lineDate: d.row.lineDate,
      description: d.row.description,
      amount: d.amountStr,
      currencyCode: currency,
      matched: d.autoDoc !== null,
      pvId: d.autoDoc?.type === "pv" ? d.autoDoc.id : null,
      chequeId: d.autoDoc?.type === "cheque" ? d.autoDoc.id : null,
      rvId: d.autoDoc?.type === "rv" ? d.autoDoc.id : null,
    }));
    await tx.insertThrough(bankStatementLines, bankStatements, sid, lineRows);
    return sid;
  });

  return reply.code(200).send({
    statement_id: statementId,
    period,
    line_count: decisions.length,
    matched_count: matchedCount,
    currency_code: currency,
  });
}

// ---------------------------------------------------------------------------
// POST /bank/reconcile — lock/close a period's reconciliation (bank.jsx confirm)
// ---------------------------------------------------------------------------
// Body: { period } (YYYY-MM). Closing a period sets bank_statement.locked = true
// on every statement in that period (tenant-scoped). The lock is REAL: the
// match-confirm write (POST /bank/lines/{id}/match) reads statement.locked and
// rejects a back-dated match with 409 once the period is closed. Rejections:
// no period → 400; the period has no statement → 404; the period is already
// fully locked → 409. The lock lives on bank_statement.locked (the statement
// carries `period` directly) rather than the reconcile table — no
// accounting_period rows exist in this scope, and the statement's own lock is
// the self-consistent source both statementWire (KPIs) and the match guard read.
// Returns { period, locked, statement_count, line_count, matched_count,
// matched_pct } (matched_pct honest-null when the period has zero lines).

async function reconcileBank(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const period = str(pick(body, "period")).trim();
  if (period === "") return badRequest(reply, "period is required");

  // Tenant-scoped: a foreign statement is absent from this select (fail closed).
  const statements = (await db.select(
    bankStatements,
    eq(bankStatements.period, period),
  )) as BankStatementRow[];
  if (statements.length === 0) {
    return notFound(reply, `no bank statement for period ${period}`);
  }
  if (statements.every((s) => s.locked)) {
    return conflict(reply, `period ${period} is already reconciled (locked)`);
  }

  // Lock every UNLOCKED statement in the period, scoped to this tenant — a foreign
  // statement in the same period is untouched. B-149 optimistic guard: fold the
  // unlocked pre-state into the WHERE — a concurrent reconcile that already locked
  // the whole period matches 0 rows here → 409 (consistent with the all-locked
  // pre-check above; the concurrent window can no longer both-succeed).
  const locked = (await db
    .update(
      bankStatements,
      { locked: true },
      and(eq(bankStatements.period, period), eq(bankStatements.locked, false)),
    )
    .returning()) as BankStatementRow[];
  if (locked.length === 0) {
    return conflict(reply, `period ${period} is already reconciled (locked)`);
  }

  // Honest matched_pct across the period's lines (Σ matched / Σ lines). Lines are
  // scoped THROUGH their statement (no company_id column of their own).
  const statementIds = statements.map((s) => s.id);
  const lines = (await db.selectThrough(
    bankStatementLines,
    LINE_HOPS,
    inArray(bankStatementLines.statementId, statementIds),
  )) as BankStatementLineRow[];
  const lineCount = lines.length;
  const matchedCount = lines.filter((l) => l.matched).length;

  return reply.code(200).send({
    period,
    locked: true,
    statement_count: statements.length,
    line_count: lineCount,
    matched_count: matchedCount,
    matched_pct: lineCount === 0 ? null : round2((matchedCount / lineCount) * 100),
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the bank (recon + cheque + export) routes on the /api/v1 scope. */
export function registerBankRoute(app: FastifyInstance): void {
  const withTenantList =
    (run: (db: TenantDb) => Promise<Record<string, unknown>[]>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const db = request.db;
      if (!db) return unauthenticated(reply);
      return reply.code(200).send(listEnvelope(await run(db)));
    };

  app.get("/bank/statements", withTenantList(listStatements));
  app.get("/bank/cheque", withTenantList(listCheque));

  app.get("/bank/statements/:id/lines", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    const { id } = request.params as { id: string };
    return listStatementLines(db, id, reply);
  });

  app.post("/bank/lines/:id/match", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    // B-084 (authz-reaudit GAP-2): matching a bank statement line to a document
    // is finance-staff bookkeeping — gate on the finance `create` perm (mirrors
    // /bank/statements/import). Fail-closed: an unattributable caller, or one
    // lacking the perm, is denied 403 before the ledger link is written.
    const caller = await loadCaller(request);
    if (!caller || !permAllowed(caller.perms, FINANCE_MODULE, "create")) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: "bank line match requires the finance create permission",
      });
    }
    const { id } = request.params as { id: string };
    return matchLine(db, id, (request.body ?? {}) as Record<string, unknown>, reply);
  });

  app.post("/bank/export-batch", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    // B-400: export-batch is the money-OUT instrument — it emits the payment
    // instruction a bank executes, and since B-397 it also takes a one-way lock
    // (stamping pv.batch_id, so a sent voucher can never be exported again:
    // bank.jsx:226 "ถ้าต้องแก้ ต้องสร้างใบใหม่"). That is at least as consequential
    // as /bank/reconcile below, which already requires finance `approve`, and
    // strictly more than the create-tier data-entry doors above — same house rule
    // as gl.ts /gl/post ("posting LOCKS money into the ledger"). Fail-closed and
    // BEFORE the body is parsed: an unattributable caller, or one lacking the
    // perm, is denied 403 before anything is read, emitted or stamped.
    const caller = await loadCaller(request);
    if (!caller) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: "caller cannot be attributed" });
    }
    if (!permAllowed(caller.perms, FINANCE_MODULE, "approve")) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: "bank batch export requires the finance approve permission",
      });
    }
    return exportBatch(db, (request.body ?? {}) as Record<string, unknown>, reply);
  });

  app.post("/bank/statements/import", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    // Statement import is finance-staff work (loads a statement + auto-matches);
    // gate on the finance `create` perm. Fail-closed: an unattributable caller,
    // or one lacking the perm, is denied 403 (mirrors ap.ts PV-approve).
    const caller = await loadCaller(request);
    if (!caller || !permAllowed(caller.perms, FINANCE_MODULE, "create")) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: "bank statement import requires the finance create permission",
      });
    }
    return importStatement(db, (request.body ?? {}) as Record<string, unknown>, reply);
  });

  app.post("/bank/reconcile", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    // Reconcile LOCKS the period (closes the books) — the priority gate. Require
    // the finance `approve` perm. Fail-closed: an unattributable caller is denied
    // 403 before the period can be locked (mirrors ap.ts PV-approve).
    const caller = await loadCaller(request);
    if (!caller) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: "caller cannot be attributed" });
    }
    if (!permAllowed(caller.perms, FINANCE_MODULE, "approve")) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: "bank reconciliation lock requires the finance approve permission",
      });
    }
    return reconcileBank(db, (request.body ?? {}) as Record<string, unknown>, reply);
  });
}

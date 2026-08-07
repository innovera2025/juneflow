// Land / Sales handlers — Program-3 (land acquisition + sales CRM/booking).
// Wave-0 wired the two reads (GET /sales/leads + GET /land/plots); this file now
// completes the Program-3 Wave-1 batch-1 write surface (B-157/158/159, Wei=ก) on
// the SAME registerLandSalesRoute scope (wired in app.ts by the orchestrator):
//
// Contract (openapi.yaml — declared opaque; NO openapi/migration/schema edit here):
//   POST /sales/leads                     → EntityCreated — create a CRM lead
//   POST /land/plots                      → EntityCreated — create a land plot
//   POST /land/plots/:id/advance-stage    → ActionOk      — advance the pipeline stage
//   PUT  /land/plots/:id/dd               → ActionOk      — merge the DD checklist
//   POST /sales/loans                     → EntityCreated — record a loan application
//   POST /sales/contracts                 → EntityOk      — sign the sales contract
//   POST /sales/bookings                  → EntityCreated — book a unit (+ receipt JV)
//   POST /sales/downs                     → EntityCreated — record a down instalment (+ JV)
//   POST /land/plots/:id/deal             → ActionOk      — buy deal (+ deposit JV)
//   GET  /sales/loans | /sales/bookings | /sales/contracts | /sales/downs → EntityList
// Each body/row is the opaque Entity (snake_case wire of the REAL columns). A read
// or POST/PUT on an opaque endpoint needs no contract change (FLOW-A opaque-Entity).
//
// MONEY = SERVER AUTHORITY (gate-4.5 hard rule — the honest reading): the handler
// owns the JV STRUCTURE (accounts, Dr/Cr direction) and never trusts the client for
// a DERIVED value. A pure receipt's received amount (a booking, a down instalment)
// is a legitimate client-supplied figure that the server VALIDATES (finite, > 0) and
// posts as-is; a land buy-deal's deposit is COMPUTED server-side from the plot's
// stored area × price × 10%. Every JV is balance-asserted (ΣDr === ΣCr) before the
// insert, keyed by a unique source_doc (idempotent + race-safe via the 0037/0042
// jv_source_doc_uq index → a duplicate post trips 23505 → the same 409), and never
// posts against an invented COA account (a missing code is an honest 409).
//   booking  Dr 1020 bank / Cr 2040 advance-received = received     source booking:<unitId>
//   down     Dr 1020 bank / Cr 2040 advance-received = received     source down:<unitId>:<seq>
//   deal     Dr 1150 land-held / Cr 2010 AP          = 10% deposit  source deal:<plotId>
//     ^ B-164 (Wei=ก): also writes an ap_billing (kind=deposit) subledger row in the
//       SAME tx so the Cr 2010 payable shows in AP aging, not only the GL JV.
// A loan application (SA-6) is a RECORDED document, NOT a GL posting — its ask/
// approved amounts are stored as supplied, no JV. A contract signing (B-161(c)) is
// unit metadata only — no JV.
//
// Tenant scope (fail closed): lead / land_plot / sales_unit / loan_application / jv
// all carry company_id → the scoped TenantDb.select()/insert()/update() doors. jv_
// line hangs off jv (no company_id) → written through insertThrough() (re-verifies
// this tenant owns the just-created parent jv). Without a resolved tenant, request.db
// is absent and every handler answers a flat 401 (mirrors the Wave-0 read pattern).
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import {
  apBillings,
  downPaymentTxns,
  jvLines,
  jvs,
  landPlots,
  leadStage,
  leads,
  loanApplications,
  projectNodes,
  projects,
  salesUnits,
} from "@juneflow/db/schema";
import { THAILAND_RATES } from "@juneflow/tax-engine/thailand";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";
import { pick, str, toNum } from "./procurement.js";
import { listEnvelope } from "./list-envelope.js";
import {
  ACCT,
  allocJvNo,
  docNoExhausted,
  DocNoExhaustedError,
  isUniqueViolation,
  resolveAccountIds,
  withDocNoRetry,
} from "./gl-post.js";
import { loadCaller, permAllowed } from "./authz.js";

/** Financial-authz module key (B-082 F1). */
const FINANCE_MODULE = "finance";

type LeadRow = typeof leads.$inferSelect;
type LandPlotRow = typeof landPlots.$inferSelect;
type SalesUnitRow = typeof salesUnits.$inferSelect;
type LoanRow = typeof loanApplications.$inferSelect;
type DownPaymentTxnRow = typeof downPaymentTxns.$inferSelect;
type JvRow = typeof jvs.$inferSelect;
type LeadStage = (typeof leadStage.enumValues)[number];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The land-acquisition pipeline stages, in order (pototype/land.jsx LAND_STAGES).
 * advance-stage moves a plot one column to the right; the terminal stage is
 * `close` (ปิดดีล / โอน). Stored as free text on land_plot.stage.
 */
const LAND_STAGES = [
  "source",
  "survey",
  "feas",
  "dd",
  "nego",
  "deal",
  "close",
] as const;

/** Square metres per rai (Thai land unit) — area_sqm / 1600 = area in rai. */
const SQM_PER_RAI = 1600;

/** A land buy-deal deposit is 10% of the plot's total price (B-161 buy branch). */
const DEAL_DEPOSIT_RATE = 0.1;

/**
 * A plot's total assessed value in FULL units — area-in-rai × price/rai, 2 dp.
 * The deposit's base; also shipped on plotWire so the browser never recomputes it.
 */
function plotTotalValue(areaSqm: number, pricePerRai: number): number {
  return round2((areaSqm / SQM_PER_RAI) * pricePerRai);
}

/**
 * The buy-deal deposit in FULL units — DEAL_DEPOSIT_RATE of the plot total, 2 dp.
 *
 * B-316/A2 — money=SERVER, SINGLE SOURCE. This is the ONLY deposit formula in the repo:
 * both the read (plotWire.deal_deposit, what land.dd renders) and the write
 * (POST /land/plots/:id/deal, what the Dr 1150 / Cr 2010 JV books) call it, so the
 * number a person reads on the due-diligence screen is by construction the number the
 * ledger posts. Before this, the browser rounded its own copy to whole baht
 * (Math.round) while this side rounded to 2 dp — up to a 0.50 baht disagreement, and a
 * 1-baht disagreement in the rendered string. Reintroducing a second copy anywhere
 * re-opens that seam; land-sales.test.ts asserts read === write on the same plot.
 */
function plotDealDeposit(areaSqm: number, pricePerRai: number): number {
  return round2(plotTotalValue(areaSqm, pricePerRai) * DEAL_DEPOSIT_RATE);
}

/**
 * The Land-Department transfer fee on a plot, in FULL units — THAILAND_RATES
 * .landTransferFeePercent of the plot total, 2 dp.
 *
 * B-319 (Wei = ก) — money=SERVER. This and plotSbt() used to be float literals in a
 * REACT SCREEN FILE (land-dd-rows.ts `TRANSFER_FEE_RATE = 0.02` / `SBT_RATE = 0.033`):
 * two statutory rates with no server counterpart, no spec entry and nothing that would
 * notice if the law changed. The rate now lives in @juneflow/tax-engine/thailand beside
 * the compliance interface; the browser reads plotWire.transfer_fee and computes nothing.
 *
 * The rate is UNCONDITIONAL and prototype-traceable, not statute-sourced — read the
 * rates.ts docstring before trusting the figure. Nothing posts this number today (the
 * buy JV books only the deposit); it is a displayed ESTIMATE. It is computed here so the
 * future contract-confirm / transfer write inherits it instead of re-deriving it.
 */
function plotTransferFee(areaSqm: number, pricePerRai: number): number {
  return round2(
    (plotTotalValue(areaSqm, pricePerRai) * THAILAND_RATES.landTransferFeePercent) / 100,
  );
}

/**
 * The specific business tax (ภาษีธุรกิจเฉพาะ) on a plot, in FULL units —
 * THAILAND_RATES.specificBusinessTaxPercent of the plot total, 2 dp. See plotTransferFee.
 *
 * Estimate, not a liability: whether SBT applies at all can turn on a holding period,
 * and where it does not a stamp duty does instead — none of which the spec states and
 * land_plot has no acquisition date to evaluate. Flat rate, per B-319.
 */
function plotSbt(areaSqm: number, pricePerRai: number): number {
  return round2(
    (plotTotalValue(areaSqm, pricePerRai) * THAILAND_RATES.specificBusinessTaxPercent) / 100,
  );
}

// ---------------------------------------------------------------------------
// Reply helpers (flat contract Error shape {code,message})
// ---------------------------------------------------------------------------

/** Flat 401 (fail closed) when no tenant was resolved onto the request. */
function unauthenticated(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
}

/** Flat 400 VALIDATION error. */
function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ code: "VALIDATION", message });
}

/** Flat 404 NOT_FOUND error. */
function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ code: "NOT_FOUND", message });
}

/** Flat 409 INVALID_STATE error. */
function conflict(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(409).send({ code: "INVALID_STATE", message });
}

/** Flat 403 FORBIDDEN (financial-authz fail-closed). */
function forbidden(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(403).send({ code: "FORBIDDEN", message });
}

/**
 * B-082 F1 financial gate for the JV-POSTING handlers (booking / down / deal). A
 * money posting requires the finance `create` permission — not merely a resolved
 * tenant — so a non-finance in-tenant user cannot post a receipt/deposit JV. The
 * non-posting CRM/land writes (lead/plot/loan/contract/advance-stage/dd) stay
 * tenant-only (operational). Sends the 403 and returns false on failure.
 */
async function requireFinanceCreate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const caller = await loadCaller(request);
  if (!caller) {
    forbidden(reply, "caller cannot be attributed");
    return false;
  }
  if (!permAllowed(caller.perms, FINANCE_MODULE, "create")) {
    forbidden(reply, "posting a sales/land JV requires the finance create permission");
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Money + parse helpers
// ---------------------------------------------------------------------------

/** Coerce a drizzle numeric (string) / number / null to a finite number, else null. */
function num(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A computed 2-dp money magnitude as the numeric-column string ("184500.00"). */
function moneyStr(n: number): string {
  return round2(n).toFixed(2);
}

/** ΣDr === ΣCr across a JV's line rows (2-dp compared) — the pre-insert balance assert. */
function isBalanced(
  lines: readonly { dr?: string | undefined; cr?: string | undefined }[],
): boolean {
  const sumDr = round2(lines.reduce((s, l) => s + Number(l.dr ?? 0), 0));
  const sumCr = round2(lines.reduce((s, l) => s + Number(l.cr ?? 0), 0));
  return sumDr === sumCr;
}

function byCreatedDesc(a: { createdAt: Date | null }, b: { createdAt: Date | null }): number {
  const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return bt - at;
}

// ---------------------------------------------------------------------------
// Wire serializers (snake_case wire of the REAL columns)
// ---------------------------------------------------------------------------

// GET /sales/leads — the sales lead register (sales.jsx). Wire = REAL columns.
// Ordered newest-first (created_at desc). hot flags a priority lead.
function leadWire(l: LeadRow): Record<string, unknown> {
  return {
    id: l.id,
    name: l.name,
    phone: l.phone,
    source: l.source,
    interest: l.interest,
    stage: l.stage, // 5-stage CRM funnel (lead/visit/quote/booking/contract) — the kanban axis
    hot: l.hot, // retained for back-compat (SA-1: superseded by warmth 3-state)
    warmth: l.warmth, // SA-1 (0042): hot/warm/cold — the CRM warmth signal
    last_contact_at: l.lastContactAt,
    note: l.note,
    owner_user_id: l.ownerUserId,
    days: l.days,
    created_at: l.createdAt,
  };
}

// GET /land/plots — the land-plot register (land.jsx). price_per_rai is money →
// currency_code. area_sqm is the plot area. Ordered newest-first.
//
// B-316/A2: total_value + deal_deposit are money the DUE-DILIGENCE screen displays
// (land.dd buy tab). They are computed HERE, by the same helpers the deal write posts
// with, so the browser has nothing left to compute. Both are null when area_sqm or
// price_per_rai is absent — the screen renders an em-dash for a null and NEVER falls
// back to a local formula (a fallback formula is the same defect with a nicer name).
//
// B-319: transfer_fee + sbt complete that set — the last two figures on land.dd the
// browser still computed, off statutory rates that lived only in the screen file. The
// rates now come from @juneflow/tax-engine/thailand; all four buy terms are server money.
function plotWire(p: LandPlotRow): Record<string, unknown> {
  const areaSqm = num(p.areaSqm);
  const pricePerRai = num(p.pricePerRai);
  const priced = areaSqm != null && pricePerRai != null;
  return {
    id: p.id,
    project_id: p.projectId,
    deed_no: p.deedNo,
    area_sqm: areaSqm,
    gps: p.gps,
    price_per_rai: pricePerRai,
    currency_code: p.currencyCode,
    // money=SERVER (B-316/A2, B-319) — null when the plot carries no area/price.
    total_value: priced ? plotTotalValue(areaSqm, pricePerRai) : null,
    deal_deposit: priced ? plotDealDeposit(areaSqm, pricePerRai) : null,
    transfer_fee: priced ? plotTransferFee(areaSqm, pricePerRai) : null,
    sbt: priced ? plotSbt(areaSqm, pricePerRai) : null,
    stage: p.stage,
    tenure: p.tenure,
    // LA-2 (0042): Land Bank registry columns (null → em-dash in the UI).
    title: p.title,
    tambon: p.tambon,
    amphoe: p.amphoe,
    prov: p.prov,
    owner: p.owner,
    dd_checklist: p.ddChecklist,
    created_at: p.createdAt,
  };
}

// The sales-unit wire (sales.jsx / sales-process.jsx). booking / contract / loan are
// money → currency_code; down is the instalment jsonb array (each { seq, amount,
// paid_at }). unit_id → the sold project_node; customer_id → the buyer.
function unitWire(u: SalesUnitRow): Record<string, unknown> {
  return {
    id: u.id,
    unit_id: u.unitId,
    customer_id: u.customerId,
    stage: u.stage,
    booking: num(u.booking),
    contract: num(u.contract),
    loan: num(u.loan),
    currency_code: u.currencyCode,
    down: Array.isArray(u.down) ? u.down : [],
    transfer_at: u.transferAt,
    created_at: u.createdAt,
  };
}

// The loan-application wire (SA-6 sales.jsx SalesLoan). ask_amt / approved_amt are
// money → currency_code, RECORDED as supplied (no server recompute — not a GL doc).
function loanWire(l: LoanRow): Record<string, unknown> {
  return {
    id: l.id,
    sales_unit_id: l.salesUnitId,
    bank: l.bank,
    ask_amt: num(l.askAmt),
    approved_amt: num(l.approvedAmt),
    currency_code: l.currencyCode,
    term: l.term,
    submit_date: l.submitDate,
    result_date: l.resultDate,
    status: l.status,
    created_at: l.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Reads (company-scoped select + the B-014 list envelope)
// ---------------------------------------------------------------------------

async function listLeads(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(leads)) as LeadRow[];
  return [...rows].sort(byCreatedDesc).map(leadWire);
}

async function listPlots(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(landPlots)) as LandPlotRow[];
  return [...rows].sort(byCreatedDesc).map(plotWire);
}

async function listLoans(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(loanApplications)) as LoanRow[];
  return [...rows].sort(byCreatedDesc).map(loanWire);
}

// GET /sales/bookings — the booked units (booking IS NOT NULL). Newest-first.
async function listBookings(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(salesUnits)) as SalesUnitRow[];
  return [...rows]
    .sort(byCreatedDesc)
    .filter((u) => u.booking != null)
    .map(unitWire);
}

// GET /sales/contracts — the units with a signed contract (contract IS NOT NULL).
async function listContracts(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(salesUnits)) as SalesUnitRow[];
  return [...rows]
    .sort(byCreatedDesc)
    .filter((u) => u.contract != null)
    .map(unitWire);
}

// GET /sales/downs — every down-payment instalment, one row each. B-167: reads the
// AUTHORITATIVE down_payment_txn table (NOT the sales_unit.down jsonb mirror, whose
// wholesale-overwrite lost updates under concurrency — audit-confirmed). unit_id is
// resolved via a single sales_unit fetch (Map · no N+1). Newest instalment first.
async function listDowns(db: TenantDb): Promise<Record<string, unknown>[]> {
  const txns = (await db.select(downPaymentTxns)) as DownPaymentTxnRow[];
  const units = (await db.select(salesUnits)) as SalesUnitRow[];
  const unitById = new Map(units.map((u) => [u.id, u]));
  return [...txns].sort(byCreatedDesc).map((t) => ({
    sales_unit_id: t.salesUnitId,
    unit_id: unitById.get(t.salesUnitId)?.unitId ?? null,
    seq: t.seq,
    amount: num(t.amount),
    paid_at: t.paidAt,
    currency_code: t.currencyCode,
  }));
}

// ---------------------------------------------------------------------------
// WAVE A — no-JV company-scoped writes
// ---------------------------------------------------------------------------

// POST /sales/leads — create a CRM lead (sales-crm.jsx). name is required (400
// else); stage is validated against the 5-stage funnel enum (else the DB default
// `lead` applies); warmth/hot/days/note stored as supplied. company_id force-set.
async function createSalesLead(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const name = str(pick(body, "name")).trim();
  if (!name) return badRequest(reply, "name is required");

  const daysRaw = toNum(pick(body, "days"));
  const values: Omit<typeof leads.$inferInsert, "companyId"> = {
    name,
    phone: str(pick(body, "phone")).trim() || null,
    source: str(pick(body, "source")).trim() || null,
    interest: str(pick(body, "interest")).trim() || null,
    warmth: str(pick(body, "warmth")).trim() || null,
    note: str(pick(body, "note")).trim() || null,
    lastContactAt: str(pick(body, "last_contact_at", "lastContactAt")).trim() || null,
    days: daysRaw == null ? null : Math.trunc(daysRaw),
    ownerUserId: str(pick(body, "owner_user_id", "ownerUserId")).trim() || null,
  };
  const stageRaw = str(pick(body, "stage")).trim();
  if ((leadStage.enumValues as readonly string[]).includes(stageRaw)) {
    values.stage = stageRaw as LeadStage;
  }
  const hotVal = pick(body, "hot");
  if (typeof hotVal === "boolean") values.hot = hotVal;

  const [created] = (await db.insert(leads, values).returning()) as LeadRow[];
  return reply.code(201).send(leadWire(created!));
}

// POST /land/plots — create a land plot (land.jsx LandPlotForm). area_sqm /
// price_per_rai stored as numeric strings; the rest are the Land Bank registry
// columns. company_id force-set; nothing computed (this is a plain create).
async function createLandPlot(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const area = toNum(pick(body, "area_sqm", "areaSqm"));
  const price = toNum(pick(body, "price_per_rai", "pricePerRai"));
  const values: Omit<typeof landPlots.$inferInsert, "companyId"> = {
    deedNo: str(pick(body, "deed_no", "deedNo")).trim() || null,
    areaSqm: area == null ? null : String(area),
    gps: str(pick(body, "gps")).trim() || null,
    pricePerRai: price == null ? null : moneyStr(price),
    stage: str(pick(body, "stage")).trim() || null,
    tenure: str(pick(body, "tenure")).trim() || null,
    title: str(pick(body, "title")).trim() || null,
    tambon: str(pick(body, "tambon")).trim() || null,
    amphoe: str(pick(body, "amphoe")).trim() || null,
    prov: str(pick(body, "prov")).trim() || null,
    owner: str(pick(body, "owner")).trim() || null,
    projectId: str(pick(body, "project_id", "projectId")).trim() || null,
  };
  const currency = str(pick(body, "currency_code", "currencyCode")).trim();
  if (currency) values.currencyCode = currency;

  const [created] = (await db.insert(landPlots, values).returning()) as LandPlotRow[];
  return reply.code(201).send(plotWire(created!));
}

// POST /land/plots/:id/advance-stage — move a plot along the pipeline (land.jsx
// "เลื่อนขั้นถัดไป"). Load the plot (404). A body `stage` sets an explicit target;
// otherwise advance one LAND_STAGES step. The terminal stage (`close`) cannot
// advance (409). company_id-scoped update.
async function advanceLandPlotStage(
  db: TenantDb,
  plotId: string,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [plot] = (await db.select(landPlots, eq(landPlots.id, plotId))) as LandPlotRow[];
  if (!plot) return notFound(reply, `land plot ${plotId} not found`);

  const target = str(pick(body, "stage")).trim();
  let nextStage: string;
  if (target) {
    nextStage = target;
  } else {
    const idx = LAND_STAGES.indexOf(plot.stage as (typeof LAND_STAGES)[number]);
    if (idx >= LAND_STAGES.length - 1) {
      return conflict(reply, "land plot is already at the final stage (closed)");
    }
    // idx === -1 (unknown stored stage) → idx + 1 === 0 → the first stage, mirroring
    // the prototype's LAND_STAGES[idx + 1] advance.
    nextStage = LAND_STAGES[idx + 1]!;
  }

  const [updated] = (await db
    .update(landPlots, { stage: nextStage }, eq(landPlots.id, plotId))
    .returning()) as LandPlotRow[];
  return reply.code(200).send({ id: plotId, stage: updated?.stage ?? nextStage });
}

// PUT /land/plots/:id/dd — merge a partial DD checklist into the plot's
// dd_checklist jsonb (land.jsx Due-Diligence). Load (404), shallow-merge the body
// `dd` object over the stored checklist, company_id-scoped update.
async function updateLandPlotDd(
  db: TenantDb,
  plotId: string,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [plot] = (await db.select(landPlots, eq(landPlots.id, plotId))) as LandPlotRow[];
  if (!plot) return notFound(reply, `land plot ${plotId} not found`);

  const stored =
    plot.ddChecklist && typeof plot.ddChecklist === "object" && !Array.isArray(plot.ddChecklist)
      ? (plot.ddChecklist as Record<string, unknown>)
      : {};
  const rawPatch = pick(body, "dd", "dd_checklist", "ddChecklist");
  const patch =
    rawPatch && typeof rawPatch === "object" && !Array.isArray(rawPatch)
      ? (rawPatch as Record<string, unknown>)
      : {};
  const merged = { ...stored, ...patch };

  const [updated] = (await db
    .update(landPlots, { ddChecklist: merged }, eq(landPlots.id, plotId))
    .returning()) as LandPlotRow[];
  return reply.code(200).send({ id: plotId, dd_checklist: updated?.ddChecklist ?? merged });
}

// POST /sales/loans — record a mortgage application (SA-6 sales.jsx SalesLoan). NO
// JV, NO money recompute: ask/approved amounts are stored AS SUPPLIED (a recorded
// application, not a GL posting — B-157). company_id force-set; status default
// `submitted` unless supplied.
async function createSalesLoan(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const ask = toNum(pick(body, "ask_amt", "askAmt", "ask"));
  const approved = toNum(pick(body, "approved_amt", "approvedAmt", "approved"));
  const termRaw = toNum(pick(body, "term"));
  const values: Omit<typeof loanApplications.$inferInsert, "companyId"> = {
    salesUnitId: str(pick(body, "sales_unit_id", "salesUnitId")).trim() || null,
    bank: str(pick(body, "bank")).trim() || null,
    askAmt: ask == null ? null : moneyStr(ask),
    approvedAmt: approved == null ? null : moneyStr(approved),
    term: termRaw == null ? null : Math.trunc(termRaw),
    submitDate: str(pick(body, "submit_date", "submitDate")).trim() || null,
    resultDate: str(pick(body, "result_date", "resultDate")).trim() || null,
  };
  const statusVal = str(pick(body, "status")).trim();
  if (statusVal) values.status = statusVal;
  const currency = str(pick(body, "currency_code", "currencyCode")).trim();
  if (currency) values.currencyCode = currency;

  const [created] = (await db.insert(loanApplications, values).returning()) as LoanRow[];
  return reply.code(201).send(loanWire(created!));
}

// POST /sales/contracts — sign the sales contract for a unit (sales.jsx). NO JV
// (B-161(c): the contract record is unit metadata only). Load the sales_unit by its
// id (404), set contract = the signing amount + stage = `contract`. company-scoped.
async function createSalesContract(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const unitId = str(
    pick(body, "unit_id", "sales_unit_id", "unitId", "salesUnitId"),
  ).trim();
  if (!unitId) return badRequest(reply, "unit_id is required");

  const amount = toNum(pick(body, "contract", "amount", "signing"));
  if (amount == null || amount <= 0) {
    return badRequest(reply, "contract signing amount is required and must be greater than zero");
  }

  const [unit] = (await db.select(salesUnits, eq(salesUnits.id, unitId))) as SalesUnitRow[];
  if (!unit) return notFound(reply, `sales unit ${unitId} not found`);

  await db
    .update(salesUnits, { contract: moneyStr(amount), stage: "contract" }, eq(salesUnits.id, unitId))
    .returning();
  return reply
    .code(200)
    .send(unitWire({ ...unit, contract: moneyStr(amount), stage: "contract" }));
}

// ---------------------------------------------------------------------------
// WAVE B — receipt JV (Dr 1020 bank / Cr 2040 advance-received = received amount)
// ---------------------------------------------------------------------------

// POST /sales/bookings — book a unit + post its booking-receipt JV (sales.jsx).
// Resolves the sales_unit for (company, unit_id): a row already carrying a booking
// → 409 (already booked). The received booking amount is a legitimate client value
// (validated finite > 0); the server posts Dr 1020 bank / Cr 2040 advance-received =
// amount, keyed source_doc `booking:<unitId>` (the STABLE project_node id — NOT the
// per-row salesUnitId, which is fresh per first booking). Unit write + JV are ONE
// transaction: two CONCURRENT first-bookings of the same unit compute the same
// source_doc, so the jv_source_doc_uq unique index lets one commit and the other
// trips 23505 → the loser's whole tx rolls back (no second unit, no second JV) → 409.
async function createSalesBooking(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const unitId = str(pick(body, "unit_id", "unitId")).trim();
  if (!unitId) return badRequest(reply, "unit_id is required");

  const amt = toNum(pick(body, "amount", "booking"));
  if (amt == null || amt <= 0) {
    return badRequest(reply, "amount (booking received) is required and must be greater than zero");
  }
  const customerId = str(pick(body, "customer_id", "customerId")).trim() || null;

  // Resolve the sales_unit for this project_node (scoped decide-read). An existing
  // booking is a hard 409 (a unit is booked at most once).
  const [existing] = (await db.select(salesUnits, eq(salesUnits.unitId, unitId))) as SalesUnitRow[];
  if (existing && existing.booking != null) {
    return conflict(reply, `unit ${unitId} is already booked`);
  }
  // B-169: a NEW booking creates a sales_unit for this project_node — verify the node
  // belongs to THIS tenant first. project_node has no company_id (FK-existence alone
  // does not prove tenancy), so scope it THROUGH its project root; a foreign node id
  // resolves to nothing → 404 (it would otherwise be booked in the caller's own books).
  if (!existing) {
    const inTenant = await db.selectThrough(
      projectNodes,
      [{ fk: projectNodes.projectId, parent: projects }],
      eq(projectNodes.id, unitId),
    );
    if (inTenant.length === 0) {
      return notFound(reply, `unit ${unitId} not found in this tenant`);
    }
  }
  const salesUnitId = existing?.id ?? randomUUID();

  // Idempotency + RACE key: source_doc = booking:<unitId> — the STABLE project_node
  // id, NOT the per-row salesUnitId (which is a fresh randomUUID on a first booking).
  // Two concurrent first-bookings of the same unit therefore compute the SAME
  // source_doc → the jv_source_doc_uq unique index lets exactly one commit; the
  // loser's jv insert trips 23505 and, because the sales_unit insert + jv are ONE
  // transaction (below), the loser's whole tx rolls back → no second unit, no second
  // JV (fixes the gate-4.5 new-unit double-post race). The pre-check is the fast path.
  const sourceDoc = `booking:${unitId}`;
  const priorJv = (await db.select(jvs, eq(jvs.sourceDoc, sourceDoc))) as JvRow[];
  if (priorJv.length > 0) return conflict(reply, `unit ${unitId} is already booked`);

  // Resolve the posting accounts in THIS tenant's COA; a missing code → honest 409.
  const acctIds = await resolveAccountIds(db, [ACCT.bank, ACCT.advanceReceived]);
  const bankId = acctIds.get(ACCT.bank);
  const advanceId = acctIds.get(ACCT.advanceReceived);
  if (!bankId || !advanceId) {
    return conflict(
      reply,
      "the tenant chart of accounts is missing a required posting account (bank / advance-received)",
    );
  }

  // B-318: assigned INSIDE the retried closure below (a retry must re-read the max).
  let jvNo = "";
  const jvId = randomUUID();
  const currencyCode = existing?.currencyCode ?? "THB";
  const lineRows: (typeof jvLines.$inferInsert)[] = [
    { jvId, accountId: bankId, dr: moneyStr(amt), cr: moneyStr(0), currencyCode },
    { jvId, accountId: advanceId, dr: moneyStr(0), cr: moneyStr(amt), currencyCode },
  ];
  if (!isBalanced(lineRows)) {
    return conflict(reply, "internal: booking journal entry does not balance");
  }

  // B-318: allocate + post is ONE retryable unit (see withDocNoRetry). The
  // jv_source_doc_uq `booking:<unit>` 23505 names a DIFFERENT constraint, so a real
  // double-booking still lands on the 409 below on its FIRST throw.
  const allocThenBook = async (): Promise<SalesUnitRow> => {
    jvNo = await allocJvNo(db);
    return db.transaction(async (tx) => {
      let unit: SalesUnitRow;
      if (existing) {
        const set: Partial<Omit<typeof salesUnits.$inferInsert, "companyId">> = {
          booking: moneyStr(amt),
          stage: "booked",
        };
        if (customerId) set.customerId = customerId;
        const [u] = (await tx
          .update(salesUnits, set, eq(salesUnits.id, salesUnitId))
          .returning()) as SalesUnitRow[];
        unit = u!;
      } else {
        const [u] = (await tx
          .insert(salesUnits, {
            id: salesUnitId,
            unitId,
            customerId,
            stage: "booked",
            booking: moneyStr(amt),
            currencyCode,
          })
          .returning()) as SalesUnitRow[];
        unit = u!;
      }
      await tx.insert(jvs, { id: jvId, no: jvNo, sourceDoc, memo: `sales-booking ${unitId}` }).returning();
      await tx.insertThrough(jvLines, jvs, jvId, lineRows);
      return unit;
    });
  };
  try {
    const savedUnit = await withDocNoRetry(allocThenBook);
    return reply.code(201).send({ ...unitWire(savedUnit), jv_no: jvNo });
  } catch (err) {
    // B-318 FIRST: JV-number allocation lost the race to exhaustion. Nothing
    // committed — a 409 here would falsely claim the unit was already booked.
    if (err instanceof DocNoExhaustedError) return docNoExhausted(reply);
    if (isUniqueViolation(err)) {
      return reply
        .code(409)
        .send({ code: "INVALID_STATE", message: `unit ${unitId} is already booked` });
    }
    throw err;
  }
}

// POST /sales/downs — record one down-payment instalment + its receipt JV
// (sales-process.jsx SalesDown / DownPaymentReceiveForm — the "งวดที่ N จาก total"
// selector). Load the sales_unit by id (404). The received amount (validated finite
// > 0) posts Dr 1020 bank / Cr 2040 advance-received = amount, keyed source_doc
// `down:<salesUnitId>:<instalment_no>`.
//
// B-167 (Wei=ข-ขยาย · NATURAL KEY): the client SELECTS the instalment number and sends
// it as `instalment_no` — a STABLE per-instalment key. down_payment_txn's
// unique(sales_unit_id, seq=instalment_no) then makes two concurrent submits of the
// SAME instalment collide → 23505 → 409 (exactly one recorded). This replaces the
// B-165 in-tx count+1, which still ESCAPED under partial serialization (b163 live
// [201,409,201]: a late reader saw the committed prior row → count+1 → a distinct seq
// → a duplicate). A count is not a stable key; the client-chosen instalment number is.
// down_payment_txn is the AUTHORITATIVE store (GET /sales/downs derives from it — no
// jsonb mirror, closing the separate jsonb lost-update the audit confirmed).
async function createSalesDown(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const salesUnitId = str(
    pick(body, "sales_unit_id", "salesUnitId", "unit_id", "unitId"),
  ).trim();
  if (!salesUnitId) return badRequest(reply, "sales_unit_id is required");

  const amt = toNum(pick(body, "amount"));
  if (amt == null || amt <= 0) {
    return badRequest(reply, "amount (down received) is required and must be greater than zero");
  }

  // The client-selected instalment number is the stable idempotency key (B-167). A
  // positive integer is required; the upper bound (plan_total) is a batch-2 down-plan
  // model (there is no plan_total column today — B-161).
  const seqRaw = toNum(pick(body, "instalment_no", "installment_no", "instalmentNo", "seq"));
  if (seqRaw == null || seqRaw < 1 || !Number.isInteger(seqRaw)) {
    return badRequest(reply, "instalment_no is required and must be a positive integer");
  }
  const seq = seqRaw;

  const [unit] = (await db.select(salesUnits, eq(salesUnits.id, salesUnitId))) as SalesUnitRow[];
  if (!unit) return notFound(reply, `sales unit ${salesUnitId} not found`);

  const paidAt =
    str(pick(body, "paid_at", "paidAt")).trim() || new Date().toISOString().slice(0, 10);

  const acctIds = await resolveAccountIds(db, [ACCT.bank, ACCT.advanceReceived]);
  const bankId = acctIds.get(ACCT.bank);
  const advanceId = acctIds.get(ACCT.advanceReceived);
  if (!bankId || !advanceId) {
    return conflict(
      reply,
      "the tenant chart of accounts is missing a required posting account (bank / advance-received)",
    );
  }

  // B-318: assigned INSIDE allocThenRecord below (a retry must re-read the max).
  let jvNo = "";
  const jvId = randomUUID();
  const currencyCode = unit.currencyCode ?? "THB";
  const sourceDoc = `down:${salesUnitId}:${seq}`;
  const lineRows: (typeof jvLines.$inferInsert)[] = [
    { jvId, accountId: bankId, dr: moneyStr(amt), cr: moneyStr(0), currencyCode },
    { jvId, accountId: advanceId, dr: moneyStr(0), cr: moneyStr(amt), currencyCode },
  ];
  if (!isBalanced(lineRows)) {
    return conflict(reply, "internal: down journal entry does not balance");
  }

  // The instalment row (down_payment_txn = authoritative) + the balanced receipt JV
  // in ONE tx. unique(sales_unit_id, seq) on the CLIENT instalment_no is the dedup
  // point: a concurrent/duplicate submit of the same instalment trips 23505 → the
  // whole tx rolls back → 409 (no duplicate instalment, no duplicate receipt JV).
  // B-318: allocate + record is ONE retryable unit. That B-167 instalment 23505
  // names a DIFFERENT constraint, so it is never retried — the dedup still fires on
  // the FIRST throw and a duplicate instalment is still a 409, not a re-attempt.
  const allocThenRecord = async (): Promise<void> => {
    jvNo = await allocJvNo(db);
    await db.transaction(async (tx) => {
      await tx
        .insert(downPaymentTxns, { salesUnitId, seq, amount: moneyStr(amt), currencyCode, paidAt })
        .returning();
      await tx
        .insert(jvs, { id: jvId, no: jvNo, sourceDoc, memo: `sales-down ${salesUnitId}:${seq}` })
        .returning();
      await tx.insertThrough(jvLines, jvs, jvId, lineRows);
    });
  };
  try {
    await withDocNoRetry(allocThenRecord);
    return reply.code(201).send({
      sales_unit_id: salesUnitId,
      unit_id: unit.unitId,
      seq,
      amount: round2(amt),
      paid_at: paidAt,
      currency_code: currencyCode,
      jv_no: jvNo,
    });
  } catch (err) {
    // B-318 FIRST: JV-number allocation lost the race to exhaustion. Nothing
    // committed — a 409 would falsely claim this instalment was already recorded,
    // and mobile dead-letters every 4xx permanently.
    if (err instanceof DocNoExhaustedError) return docNoExhausted(reply);
    if (isUniqueViolation(err)) {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: `down instalment ${seq} for unit ${salesUnitId} is already recorded`,
      });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// WAVE C — computed JV (land buy deal only)
// ---------------------------------------------------------------------------

// POST /land/plots/:id/deal — close a land deal (land.jsx). Load the plot (404).
// `type === "buy"`: the deposit is COMPUTED server-side by plotDealDeposit() — the same
// helper plotWire ships as `deal_deposit`, so what land.dd DISPLAYS is by construction
// what this posts (B-316/A2; money=SERVER — the client terms are never read for the
// amount, and the client no longer holds a formula). A null area/price → honest 409. Posts
// Dr 1150 land-held / Cr 2010 AP = deposit, keyed source_doc `deal:<plotId>`.
// `type === "lease"` (B-161 · Wei=ง, rent code B-173=ก): the first-period land-lease
// rent is an OPERATING EXPENSE. money=SERVER posts the CLIENT-supplied rent verbatim
// (no invented amortization/escalation, no lease entity) → Dr 5100 admin-expense
// (cost-center scoped) / Cr 2010 AP + an ap_billing subledger row, keyed source_doc
// `deal:<plotId>:lease` (keeps the ^deal: prefix so jv_source_doc_uq covers it →
// idempotent, yet distinct from a buy deal on the same plot). Any other type → 400.
async function createLandPlotDeal(
  db: TenantDb,
  plotId: string,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const type = str(pick(body, "type")).trim();

  const [plot] = (await db.select(landPlots, eq(landPlots.id, plotId))) as LandPlotRow[];
  if (!plot) return notFound(reply, `land plot ${plotId} not found`);

  if (type === "lease") {
    // The client supplies the first-period rent (money=SERVER = post what is received,
    // invent no formula). A missing/non-positive rent is a client-input error → 400.
    const rent = toNum(pick(body, "amount"));
    if (rent == null || rent <= 0) {
      return badRequest(reply, "amount (first-period rent) is required and must be greater than zero");
    }
    const rentAmt = round2(rent);
    // Cost-center attribution rides on the expense (Dr) line only — the AP liability is
    // not cost-center scoped. Stored as-is, mirroring the labor/inventory/fa jv cc_id.
    const ccId = str(pick(body, "cc_id", "ccId")).trim() || null;

    const sourceDoc = `deal:${plotId}:lease`;
    const priorJv = (await db.select(jvs, eq(jvs.sourceDoc, sourceDoc))) as JvRow[];
    if (priorJv.length > 0) return conflict(reply, `land plot ${plotId} lease deal already posted`);

    const acctIds = await resolveAccountIds(db, [ACCT.adminExpense, ACCT.ap]);
    const expId = acctIds.get(ACCT.adminExpense);
    const apId = acctIds.get(ACCT.ap);
    if (!expId || !apId) {
      return conflict(
        reply,
        "the tenant chart of accounts is missing a required posting account (rent-expense / AP)",
      );
    }

    // B-318: assigned INSIDE allocThenPost below (a retry must re-read the max).
    let jvNo = "";
    const jvId = randomUUID();
    const currencyCode = plot.currencyCode ?? "THB";
    const lineRows: (typeof jvLines.$inferInsert)[] = [
      { jvId, accountId: expId, dr: moneyStr(rentAmt), cr: moneyStr(0), currencyCode, ccId },
      { jvId, accountId: apId, dr: moneyStr(0), cr: moneyStr(rentAmt), currencyCode },
    ];
    if (!isBalanced(lineRows)) {
      return conflict(reply, "internal: lease deal journal entry does not balance");
    }

    // B-318: allocate + post is ONE retryable unit (see withDocNoRetry).
    const allocThenPost = async (): Promise<void> => {
      jvNo = await allocJvNo(db);
      await db.transaction(async (tx) => {
        await tx
          .insert(apBillings, {
            vendorId: null,
            amount: moneyStr(rentAmt),
            vat: "0",
            currencyCode,
            status: "draft",
            kind: "progress",
          })
          .returning();
        await tx
          .insert(jvs, { id: jvId, no: jvNo, sourceDoc, memo: `land-lease ${plotId}` })
          .returning();
        await tx.insertThrough(jvLines, jvs, jvId, lineRows);
      });
    };
    try {
      await withDocNoRetry(allocThenPost);
      return reply.code(200).send({ plot_id: plotId, type, amount: rentAmt, jv_no: jvNo });
    } catch (err) {
      // B-318 FIRST: allocation exhausted — nothing committed, so never a 409.
      if (err instanceof DocNoExhaustedError) return docNoExhausted(reply);
      if (isUniqueViolation(err)) {
        return reply
          .code(409)
          .send({ code: "INVALID_STATE", message: `land plot ${plotId} lease deal already posted` });
      }
      throw err;
    }
  }
  if (type !== "buy") {
    return badRequest(reply, "type must be 'buy' or 'lease'");
  }

  const area = toNum(plot.areaSqm);
  const price = toNum(plot.pricePerRai);
  if (area == null || price == null) {
    return conflict(
      reply,
      "land plot is missing area_sqm or price_per_rai — cannot compute a deal deposit",
    );
  }
  // B-316/A2: the SAME helper plotWire ships as deal_deposit — read and write cannot drift.
  const deposit = plotDealDeposit(area, price);
  if (deposit <= 0) {
    return conflict(reply, "computed deal deposit is not positive");
  }

  const sourceDoc = `deal:${plotId}`;
  const priorJv = (await db.select(jvs, eq(jvs.sourceDoc, sourceDoc))) as JvRow[];
  if (priorJv.length > 0) return conflict(reply, `land plot ${plotId} deal already posted`);

  const acctIds = await resolveAccountIds(db, [ACCT.landHeldForDev, ACCT.ap]);
  const landId = acctIds.get(ACCT.landHeldForDev);
  const apId = acctIds.get(ACCT.ap);
  if (!landId || !apId) {
    return conflict(
      reply,
      "the tenant chart of accounts is missing a required posting account (land-held / AP)",
    );
  }

  // B-318: assigned INSIDE allocThenPost below (a retry must re-read the max).
  let jvNo = "";
  const jvId = randomUUID();
  const currencyCode = plot.currencyCode ?? "THB";
  const lineRows: (typeof jvLines.$inferInsert)[] = [
    { jvId, accountId: landId, dr: moneyStr(deposit), cr: moneyStr(0), currencyCode },
    { jvId, accountId: apId, dr: moneyStr(0), cr: moneyStr(deposit), currencyCode },
  ];
  if (!isBalanced(lineRows)) {
    return conflict(reply, "internal: deal journal entry does not balance");
  }

  // B-318: allocate + post is ONE retryable unit (see withDocNoRetry).
  const allocThenPost = async (): Promise<void> => {
    jvNo = await allocJvNo(db);
    await db.transaction(async (tx) => {
      // B-164 (Wei=ก): the Cr 2010 AP is a real payable to the land owner — record it
      // in the AP subledger (ap_billing) so it surfaces in GET /ap/billings + aging,
      // not just the GL. Same tx as the JV: the jv_source_doc_uq 23505 on a concurrent
      // double-post rolls this row back too (ap_billing carries no own unique key), so
      // there is never an orphan subledger row. A land deal has no vendor FK
      // (plot.owner is free text), so vendor_id/due_date stay null (never invented).
      await tx
        .insert(apBillings, {
          vendorId: null,
          amount: moneyStr(deposit),
          vat: "0",
          currencyCode,
          status: "draft",
          kind: "deposit",
        })
        .returning();
      await tx.insert(jvs, { id: jvId, no: jvNo, sourceDoc, memo: `land-deal ${plotId}` }).returning();
      await tx.insertThrough(jvLines, jvs, jvId, lineRows);
    });
  };
  try {
    await withDocNoRetry(allocThenPost);
    return reply.code(200).send({ plot_id: plotId, type, deposit, jv_no: jvNo });
  } catch (err) {
    // B-318 FIRST: allocation exhausted — nothing committed, so never a 409.
    if (err instanceof DocNoExhaustedError) return docNoExhausted(reply);
    if (isUniqueViolation(err)) {
      return reply
        .code(409)
        .send({ code: "INVALID_STATE", message: `land plot ${plotId} deal already posted` });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the land/sales routes on the given (/api/v1-prefixed) scope. */
export function registerLandSalesRoute(app: FastifyInstance): void {
  const body = (request: FastifyRequest): Record<string, unknown> =>
    (request.body ?? {}) as Record<string, unknown>;
  const idParam = (request: FastifyRequest): string =>
    (request.params as { id?: string }).id ?? "";

  const withTenantList =
    (run: (db: TenantDb) => Promise<Record<string, unknown>[]>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const db = request.db;
      if (!db) return unauthenticated(reply);
      return reply.code(200).send(listEnvelope(await run(db)));
    };

  // --- reads ----------------------------------------------------------------
  app.get("/sales/leads", withTenantList(listLeads));
  app.get("/land/plots", withTenantList(listPlots));
  app.get("/sales/loans", withTenantList(listLoans));
  app.get("/sales/bookings", withTenantList(listBookings));
  app.get("/sales/contracts", withTenantList(listContracts));
  app.get("/sales/downs", withTenantList(listDowns));

  // --- Wave A: no-JV writes -------------------------------------------------
  app.post("/sales/leads", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createSalesLead(db, body(request), reply);
  });

  app.post("/land/plots", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createLandPlot(db, body(request), reply);
  });

  app.post("/land/plots/:id/advance-stage", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return advanceLandPlotStage(db, idParam(request), body(request), reply);
  });

  app.put("/land/plots/:id/dd", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return updateLandPlotDd(db, idParam(request), body(request), reply);
  });

  app.post("/sales/loans", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createSalesLoan(db, body(request), reply);
  });

  app.post("/sales/contracts", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createSalesContract(db, body(request), reply);
  });

  // --- Wave B: receipt JV (B-082 F1 finance.create gate — posts money) ------
  app.post("/sales/bookings", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    if (!(await requireFinanceCreate(request, reply))) return reply;
    return createSalesBooking(db, body(request), reply);
  });

  app.post("/sales/downs", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    if (!(await requireFinanceCreate(request, reply))) return reply;
    return createSalesDown(db, body(request), reply);
  });

  // --- Wave C: computed JV (B-082 F1 finance.create gate — posts money) -----
  app.post("/land/plots/:id/deal", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    if (!(await requireFinanceCreate(request, reply))) return reply;
    return createLandPlotDeal(db, idParam(request), body(request), reply);
  });
}

// FA (Fixed Assets) handlers — Phase-3 Finance (GL + FA lane). Wave-0 wired the
// fa.assets register/list screen; round-A adds the depreciation-posting + adjust
// op-set (migrations 0035/0036): run-depreciation, PUT edit, adjustments list,
// write-off, revalue, and bulk import. The schema (finance.ts fixed_asset
// superset + fa_adjustment) and the contract paths (openapi.yaml — opaque ops)
// ALL pre-exist. This file wires the handlers and is registered in app.ts.
//
// Contract (openapi.yaml §Finance-Accounting):
//   GET  /fa/assets            → EntityList     — fixed assets       (listFaAssets)
//   POST /fa/assets            → EntityCreated  — register an asset  (createFaAsset)
//   PUT  /fa/assets/{id}       → EntityOk       — edit an asset      (updateFaAsset)
//   POST /fa/run-depreciation  → ActionOk       — monthly depr → JV  (runFaDepreciation)
//   GET  /fa/adjustments       → EntityList     — fa_adjustment      (listFaAdjustments)
//   POST /fa/write-off         → ActionOk       — dispose an asset   (writeOffFaAsset)
//   POST /fa/revalue           → ActionOk       — revalue an asset   (revalueFaAsset)
//   POST /fa/import            → EntityCreated  — bulk register      (importFaAssets)
// Each row/body is the opaque Entity (snake_case wire of REAL columns). Reads on
// an opaque endpoint need no contract change (FLOW-A opaque-Entity finding).
//
// MONEY = SERVER AUTHORITY (gate-4.5 hard rule): every depreciation / write-off
// amount is COMPUTED server-side from stored asset columns via the fixed straight-
// line formula — NEVER a client value. Depreciation monthly = (cost − salvage) /
// life_years / 12 (Wei B-123 Q1); the prototype's cost/(life×12) at fa.jsx L491 is
// a MOCK BUG (drops salvage) and is deliberately NOT used. A write-off removes the
// server-derived carrying amount book_value = cost − accumulated_depr.
//
// C10 HONEST-EMPTY (flag, don't fabricate): a posting that needs a COA account
// the tenant's COA_SEED does not carry is NEVER posted against an invented
// account — the change is recorded and the GL posting is flagged deferred
// (jvId=null). Depreciation / write-off post Dr 5100 admin-expense / Cr 1210 PP&E
// (the REAL JV_BOOKS "FA auto" exemplar JV-2026-0414). Revalue has NO
// revaluation-surplus account in COA_SEED, so its GL posting is deferred by
// policy (jvId=null) rather than mis-accounted.
//
// Tenant scope (fail closed): fixed_asset + fa_adjustment carry company_id → the
// scoped TenantDb.select()/insert()/update() doors. jv_line hangs off jv (no
// company_id) → written through insertThrough(jvLines, jvs, jvId, rows) which
// re-verifies this tenant owns the parent jv. cost_center carries NO company_id —
// it anchors through project (CC_HOPS), so a supplied cc_id is tenant-verified via
// selectThrough. Without a resolved tenant, request.db is absent → flat 401.
//
// Financial-authz (B-082 / F1): money-locking ops (run-depreciation, write-off,
// revalue) gate the finance `approve` right; edits + registration + import gate
// finance `create`. Reuses authz.ts loadCaller/permAllowed (invents no policy).
// Fail-closed: an unattributable caller, or one lacking the perm, is denied 403.
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import {
  costCenters,
  faAdjustments,
  fixedAssets,
  jvLines,
  jvs,
  projects,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";
import { listEnvelope } from "./list-envelope.js";
import { has, pick, str, toNum } from "./procurement.js";
import { loadCaller, permAllowed } from "./authz.js";
import {
  ACCT,
  allocJvNo,
  docNoExhausted,
  DocNoExhaustedError,
  isUniqueViolation,
  resolveAccountIds,
  withDocNoRetry,
} from "./gl-post.js";

type FixedAssetRow = typeof fixedAssets.$inferSelect;
type FaAdjustmentRow = typeof faAdjustments.$inferSelect;
type JvRow = typeof jvs.$inferSelect;

/** The perms-matrix module (seed MODULE_IDS) that governs finance actions. */
const FINANCE_MODULE = "finance";

/** The one hop that scopes a cost_center through its project to a tenant root. */
const CC_HOPS = [{ fk: costCenters.projectId, parent: projects }];

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

/** Coerce a drizzle numeric (string) / number / null to a finite number, else 0. */
function num(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** A 2-dp money magnitude as the numeric-column string ("920000.00"). */
function moneyStr(n: number): string {
  return round2(n).toFixed(2);
}

/**
 * A STRICT CE 'YYYY-MM' key — 4-digit CE year (2000–2100) + month 01–12. A
 * Buddhist-Era year (25xx/26xx) falls outside the CE window and is rejected
 * (mirrors gl.ts closeGlPeriod so the depreciation period cannot silently target
 * a BE-labelled seed period).
 */
function isValidCePeriod(period: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12;
}

/** The current CE month as a 'YYYY-MM' key (UTC), the run-depreciation default. */
function currentCePeriod(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${mo}`;
}

/**
 * Fail-closed finance-authz gate. Sends a 403 and returns false when the caller
 * cannot be attributed OR lacks perms[finance][right]; returns true otherwise.
 * `right` = "approve" for money-locking ops, "create" for edits/registration.
 */
async function requireFinance(
  request: FastifyRequest,
  reply: FastifyReply,
  right: "create" | "approve",
  action: string,
): Promise<boolean> {
  const caller = await loadCaller(request);
  if (!caller || !permAllowed(caller.perms, FINANCE_MODULE, right)) {
    reply.code(403).send({
      code: "FORBIDDEN",
      message: `${action} requires the finance ${right} permission`,
    });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// GET /fa/assets — list fixed assets (fa.jsx FixedAssetRegister)
// ---------------------------------------------------------------------------
// Real source: fixed_asset (company-scoped). The wire carries the REAL columns
// plus the migration-0035 superset. book_value is DERIVED (cost −
// accumulated_depr) and never stored, to avoid drift (schema note B-123 Q4).
// Ordered newest-first, mirroring the sibling list routes.
function assetWire(a: FixedAssetRow): Record<string, unknown> {
  const cost = num(a.cost);
  const accumulatedDepr = num(a.accumulatedDepr);
  return {
    id: a.id,
    name: a.name,
    cost,
    currency_code: a.currencyCode,
    life_years: a.lifeYears,
    cc_id: a.ccId,
    depr_method: a.deprMethod,
    salvage: num(a.salvage),
    acquired_date: a.acquiredDate ?? null,
    accumulated_depr: accumulatedDepr,
    status: a.status ?? "active",
    // DERIVED carrying amount — cost minus the running accumulated depreciation.
    book_value: round2(cost - accumulatedDepr),
  };
}

async function listAssets(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(fixedAssets)) as FixedAssetRow[];
  return [...rows]
    .sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    })
    .map(assetWire);
}

// ---------------------------------------------------------------------------
// POST /fa/assets — register a fixed asset (fa.jsx FixedAssetForm)
// ---------------------------------------------------------------------------
// Body (opaque Entity): { name (required), cost?, salvage?, acquired_date?, life_years?, cc_id?,
//   depr_method? }. Enforced, in order (the route gates finance.create first):
//   - name required (400 else).
//   - cost is INPUT data (the asset's acquisition cost — a registration, NOT a
//     computed money-derivation), stored as-is (2-dp normalized).
//   - a supplied cc_id must resolve to THIS tenant — cost_center scopes through
//     project (a foreign id resolves to nothing through the hop → 400, fail
//     closed).
// company_id is force-set by the scoped insert.
async function createAsset(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const name = str(pick(body, "name")).trim();
  if (!name) return badRequest(reply, "name is required");

  const costRaw = toNum(pick(body, "cost"));
  const lifeYearsRaw = toNum(pick(body, "life_years", "lifeYears"));
  // salvage + acquired_date are registration inputs (not money-derivations) that
  // feed the depreciation base (cost − salvage) — accept them at create so a
  // depreciable asset can be registered in one call (else a POST-then-PUT is
  // forced). salvage defaults to 0 (the schema default) when omitted.
  const salvageRaw = toNum(pick(body, "salvage"));
  const acquiredDate = str(pick(body, "acquired_date", "acquiredDate")).trim() || null;
  const ccId = str(pick(body, "cc_id", "ccId")).trim() || null;
  const deprMethod = str(pick(body, "depr_method", "deprMethod")).trim() || null;

  // A supplied cc_id must belong to this tenant — cost_center anchors through
  // project (fail closed: a foreign id resolves to nothing through the hop).
  if (ccId) {
    const [cc] = await db.selectThrough(costCenters, CC_HOPS, eq(costCenters.id, ccId));
    if (!cc) return badRequest(reply, "cc_id not found in this tenant");
  }

  const [created] = (await db
    .insert(fixedAssets, {
      name,
      cost: costRaw != null ? moneyStr(costRaw) : "0",
      salvage: salvageRaw != null ? moneyStr(salvageRaw) : "0",
      acquiredDate,
      lifeYears: lifeYearsRaw != null ? Math.round(lifeYearsRaw) : null,
      ccId,
      deprMethod,
    })
    .returning()) as FixedAssetRow[];

  return reply.code(201).send(assetWire(created!));
}

// ---------------------------------------------------------------------------
// PUT /fa/assets/{id} — edit a fixed asset (fa.jsx FixedAssetForm edit)
// ---------------------------------------------------------------------------
// Body (opaque Entity, all optional): { name?, cost?, life_years?, salvage?,
//   acquired_date?, cc_id?, depr_method? }. ONLY the keys PRESENT in the body are
//   updated (a partial edit). Enforced (the route gates finance.create first):
//   - the asset must exist in THIS tenant (scoped 404 else).
//   - cost / salvage are 2-dp normalized (input data, not a money-derivation).
//   - a supplied non-empty cc_id must resolve to THIS tenant (CC_HOPS, fail closed).
// company_id is immutable (the scoped update strips any smuggled value).
async function updateAsset(
  db: TenantDb,
  id: string,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [asset] = (await db.select(
    fixedAssets,
    eq(fixedAssets.id, id),
  )) as FixedAssetRow[];
  if (!asset) return notFound(reply, "fixed asset not found in this tenant");

  const set: Partial<Omit<typeof fixedAssets.$inferInsert, "companyId">> = {};

  if (has(body, "name")) {
    const name = str(pick(body, "name")).trim();
    if (!name) return badRequest(reply, "name must not be empty");
    set.name = name;
  }
  if (has(body, "cost")) {
    const cost = toNum(pick(body, "cost"));
    if (cost == null) return badRequest(reply, "cost must be a number");
    set.cost = moneyStr(cost);
  }
  if (has(body, "salvage")) {
    const salvage = toNum(pick(body, "salvage"));
    if (salvage == null) return badRequest(reply, "salvage must be a number");
    set.salvage = moneyStr(salvage);
  }
  if (has(body, "life_years", "lifeYears")) {
    const life = toNum(pick(body, "life_years", "lifeYears"));
    set.lifeYears = life != null ? Math.round(life) : null;
  }
  if (has(body, "acquired_date", "acquiredDate")) {
    set.acquiredDate = str(pick(body, "acquired_date", "acquiredDate")).trim() || null;
  }
  if (has(body, "depr_method", "deprMethod")) {
    set.deprMethod = str(pick(body, "depr_method", "deprMethod")).trim() || null;
  }
  if (has(body, "cc_id", "ccId")) {
    const ccId = str(pick(body, "cc_id", "ccId")).trim() || null;
    if (ccId) {
      const [cc] = await db.selectThrough(costCenters, CC_HOPS, eq(costCenters.id, ccId));
      if (!cc) return badRequest(reply, "cc_id not found in this tenant");
    }
    set.ccId = ccId;
  }

  // No editable field supplied → return the current wire (nothing to write; an
  // empty SET would be an invalid UPDATE).
  if (Object.keys(set).length === 0) {
    return reply.code(200).send(assetWire(asset));
  }

  const [updated] = (await db
    .update(fixedAssets, set, eq(fixedAssets.id, id))
    .returning()) as FixedAssetRow[];
  return reply.code(200).send(assetWire(updated ?? asset));
}

// ---------------------------------------------------------------------------
// POST /fa/run-depreciation — monthly straight-line depreciation → auto JV
// (fa.jsx FADepreciationRun; data-dictionary "ค่าเสื่อมรายเดือน → JV อัตโนมัติ")
// ---------------------------------------------------------------------------
// Body: { period? } — a CE 'YYYY-MM' (default: the current CE month). For EACH
// eligible asset (status='active', life_years>0, cost>salvage) it posts ONE
// month of straight-line depreciation:
//   monthly = round2((cost − salvage) / life_years / 12)   [SERVER-authoritative,
//   Wei B-123 Q1 — the prototype's cost/(life×12) MOCK BUG is NOT used].
// IDEMPOTENT per (asset, period): skips when a jv already exists (this tenant)
// with source_doc = `fa:<assetId>:<period>` (the in-memory pre-check); the 0037
// source_doc UNIQUE index makes it atomic — a racing post trips 23505 and is
// mapped to the same skip (isUniqueViolation). Book-value FLOOR:
// accumulated_depr may never exceed (cost − salvage) — the final period's monthly
// is capped to the remainder, and a fully-depreciated asset is skipped. Each post
// is ONE transaction: Dr 5100 admin-expense / Cr 1210 PP&E = monthly (both REAL
// COA), and the asset's accumulated_depr advances by monthly. A missing required
// COA account skips + reports (C10 — never invented). Returns ActionOk {period,
// posted:[{asset_id, amount, jv_no}], skipped:[{asset_id, reason}], currency_code}.

/**
 * Post one month of depreciation for one asset in a single transaction.
 *
 * B-318 note: unlike every other posting handler, allocJvNo runs INSIDE the
 * transaction here. That is fine — the retry wraps the CALL to this function (see
 * the caller), so a rolled-back attempt re-enters with a fresh BEGIN and re-reads
 * the advanced max. No SAVEPOINT: `db.transaction()` is top-level over the pool.
 */
async function postDepreciation(
  db: TenantDb,
  asset: FixedAssetRow,
  monthly: number,
  period: string,
  exprId: string,
  ppeId: string,
  currentAccum: number,
): Promise<string> {
  const currency = asset.currencyCode ?? "THB";
  const jvId = randomUUID();
  const amount = moneyStr(monthly);
  // Dr 5100 admin-expense / Cr 1210 PP&E — balanced double entry (Σ dr = Σ cr).
  const lineRows: (typeof jvLines.$inferInsert)[] = [
    { jvId, accountId: exprId, dr: amount, cr: "0.00", currencyCode: currency },
    { jvId, accountId: ppeId, dr: "0.00", cr: amount, currencyCode: currency },
  ];
  return db.transaction(async (tx) => {
    const no = await allocJvNo(tx);
    await tx
      .insert(jvs, {
        id: jvId,
        no,
        // P2-BE-52: source_doc encodes (asset, period) so it is UNIQUE per post —
        // the jv.source_doc partial UNIQUE index (0037) then makes double-posting
        // the same asset+period impossible even under a race (idempotency was
        // previously only the in-memory check below). memo stays the human label.
        sourceDoc: `fa:${asset.id}:${period}`,
        memo: `depr:${period}`,
      })
      .returning();
    // jv_line has no company_id → insertThrough re-proves this tenant owns the
    // parent jv INSIDE the same transaction.
    await tx.insertThrough(jvLines, jvs, jvId, lineRows);
    // Advance the running accumulated depreciation by the posted amount.
    await tx
      .update(
        fixedAssets,
        { accumulatedDepr: moneyStr(currentAccum + monthly) },
        eq(fixedAssets.id, asset.id),
      )
      .returning();
    return no;
  });
}

async function runDepreciation(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const periodRaw = str(pick(body, "period")).trim();
  const period = periodRaw || currentCePeriod();
  if (!isValidCePeriod(period)) {
    return badRequest(
      reply,
      "period must be a CE 'YYYY-MM' key (e.g. 2026-05); a Buddhist-Era year is not accepted",
    );
  }

  const assets = (await db.select(fixedAssets)) as FixedAssetRow[];

  // Idempotency index (per asset, per period): a prior depreciation post is a jv
  // whose source_doc = `fa:<assetId>:<period>` (P2-BE-52 — the source_doc alone is
  // now the key; the 0037 UNIQUE index enforces it atomically). Read the tenant's
  // jvs once and key the existing posts by source_doc.
  const existingJvs = (await db.select(jvs)) as JvRow[];
  const postedKeys = new Set(
    existingJvs.map((jv) => jv.sourceDoc ?? ""),
  );

  // Resolve the two posting accounts ONCE (COA is tenant-global). A missing code
  // is simply absent from the map → C10 honest skip (never an invented account).
  const acctIds = await resolveAccountIds(db, [ACCT.adminExpense, ACCT.ppe]);
  const exprId = acctIds.get(ACCT.adminExpense);
  const ppeId = acctIds.get(ACCT.ppe);
  const accountsPresent = exprId != null && ppeId != null;

  const posted: { asset_id: string; amount: number; jv_no: string }[] = [];
  const skipped: { asset_id: string; reason: string }[] = [];
  let currency = "THB";
  let currencySet = false;

  for (const asset of assets) {
    if (asset.status !== "active") {
      skipped.push({ asset_id: asset.id, reason: "asset is not active" });
      continue;
    }
    const life = asset.lifeYears ?? 0;
    if (life <= 0) {
      skipped.push({ asset_id: asset.id, reason: "life_years is not positive" });
      continue;
    }
    const cost = num(asset.cost);
    const salvage = num(asset.salvage);
    // Straight-line depreciable base (Wei B-123 Q1: salvage IS subtracted).
    const base = round2(cost - salvage);
    if (base <= 0) {
      skipped.push({ asset_id: asset.id, reason: "cost does not exceed salvage" });
      continue;
    }

    const key = `fa:${asset.id}:${period}`;
    if (postedKeys.has(key)) {
      skipped.push({ asset_id: asset.id, reason: `already depreciated for ${period}` });
      continue;
    }

    // Book-value floor: accumulated_depr may never exceed the depreciable base.
    const accum = num(asset.accumulatedDepr);
    const remaining = round2(base - accum);
    if (remaining <= 0) {
      skipped.push({ asset_id: asset.id, reason: "fully depreciated" });
      continue;
    }
    let monthly = round2(base / life / 12);
    // Cap the final period's monthly to the remaining depreciable amount.
    if (monthly > remaining) monthly = remaining;
    if (monthly <= 0) {
      skipped.push({ asset_id: asset.id, reason: "computed monthly depreciation is zero" });
      continue;
    }

    if (!accountsPresent) {
      // C10 honest-empty: a required COA account is missing → record the skip,
      // never post against an invented account.
      skipped.push({
        asset_id: asset.id,
        reason: `GL accounts ${ACCT.adminExpense}/${ACCT.ppe} not found in COA — posting deferred`,
      });
      continue;
    }

    if (!currencySet) {
      currency = asset.currencyCode ?? "THB";
      currencySet = true;
    }

    try {
      // B-318: the whole transaction (which allocates its own JV number inside) is
      // the retried unit — a concurrent post of another money doc that read the same
      // JV max trips jv_company_no_uq → roll back → re-enter → re-allocate.
      const jvNo = await withDocNoRetry(() =>
        postDepreciation(db, asset, monthly, period, exprId, ppeId, accum),
      );
      posted.push({ asset_id: asset.id, amount: monthly, jv_no: jvNo });
      postedKeys.add(key); // reflect this post (defensive against a duplicate row)
    } catch (err) {
      // B-318 FIRST, and it must NOT reuse the "already depreciated" reason: nothing
      // was posted for this asset. This endpoint answers 200 with posted/skipped
      // (some assets in the batch DID commit), so an honest per-asset skip is the
      // truthful analogue of the 503 the single-doc handlers return — never a claim
      // that the depreciation exists.
      if (err instanceof DocNoExhaustedError) {
        skipped.push({
          asset_id: asset.id,
          reason: "document-number allocation contended — nothing posted, retry",
        });
        continue;
      }
      // P2-BE-52: a concurrent run posted this asset+period first — the 0037
      // source_doc UNIQUE index tripped. Map to the same idempotent skip as the
      // pre-check (never a 500, never a double post).
      if (isUniqueViolation(err)) {
        skipped.push({ asset_id: asset.id, reason: `already depreciated for ${period}` });
        continue;
      }
      throw err;
    }
  }

  return reply.code(200).send({ period, posted, skipped, currency_code: currency });
}

// ---------------------------------------------------------------------------
// GET /fa/adjustments — list fixed-asset adjustments (fa.jsx FA adjust history)
// ---------------------------------------------------------------------------
// Real source: fa_adjustment (company-scoped — its own aggregate-root company_id,
// mirrors ar_invoice). Wire = the REAL columns. Ordered newest-first.
function adjustmentWire(a: FaAdjustmentRow): Record<string, unknown> {
  return {
    id: a.id,
    asset_id: a.assetId,
    kind: a.kind,
    amount: num(a.amount),
    currency_code: a.currencyCode,
    jv_id: a.jvId,
    status: a.status,
    memo: a.memo,
    created_at: a.createdAt,
  };
}

async function listAdjustments(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(faAdjustments)) as FaAdjustmentRow[];
  return [...rows]
    .sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    })
    .map(adjustmentWire);
}

// ---------------------------------------------------------------------------
// POST /fa/write-off — dispose a fixed asset (fa.jsx FAWriteOff)
// ---------------------------------------------------------------------------
// Body: { asset_id }. Enforced (the route gates finance.approve first):
//   - the asset must exist in THIS tenant (scoped 404 else).
// book_value = round2(cost − accumulated_depr) [SERVER-authoritative carrying
// amount — never a client value]. In ONE transaction: flip status='written_off',
// record an fa_adjustment {kind:'write_off', amount: book_value}, and post JV Dr
// 5100 (loss) / Cr 1210 (PP&E) = book_value (both REAL COA), source_doc =
// `fa:<adjustmentId>`, back-linking fa_adjustment.jvId. C10: a missing COA account
// (or a zero carrying amount → no ledger effect) records the write-off with the
// GL posting DEFERRED (jvId=null) rather than a fabricated / degenerate zero JV.
// Returns ActionOk {id, asset_id, kind:'write_off', amount: book_value, jv_no}.
/**
 * B-149 optimistic-lock miss: the guarded status flip matched 0 rows because a
 * concurrent call already moved the asset out of its 'active' pre-state. Thrown
 * inside the write-off transaction so the whole post rolls back → mapped to 409.
 */
class StaleStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleStateError";
  }
}

async function writeOff(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const assetId = str(pick(body, "asset_id", "assetId")).trim();
  if (!assetId) return badRequest(reply, "asset_id is required");

  const [asset] = (await db.select(
    fixedAssets,
    eq(fixedAssets.id, assetId),
  )) as FixedAssetRow[];
  if (!asset) return notFound(reply, "fixed asset not found in this tenant");

  const currency = asset.currencyCode ?? "THB";
  // SERVER-authoritative carrying amount — both operands are stored columns.
  const bookValue = round2(num(asset.cost) - num(asset.accumulatedDepr));

  const acctIds = await resolveAccountIds(db, [ACCT.adminExpense, ACCT.ppe]);
  const exprId = acctIds.get(ACCT.adminExpense);
  const ppeId = acctIds.get(ACCT.ppe);
  // Post a JV only when the accounts exist AND there is a carrying amount to
  // remove — a zero book value has no ledger effect (C10 honest, no zero JV).
  const canPost = exprId != null && ppeId != null && bookValue > 0;

  const adjustmentId = randomUUID();
  const jvId = randomUUID();

  let jvNo: string | null;
  try {
    // B-318: the whole transaction is the retried unit (allocJvNo runs inside it, at
    // the bottom). A rolled-back attempt also un-does the status flip, so the B-149
    // 'active' guard sees the original state again on the next attempt.
    jvNo = await withDocNoRetry(() =>
      db.transaction(async (tx): Promise<string | null> => {
        // Take the asset out of service. B-149 optimistic guard: only an 'active'
        // asset can be written off — a concurrent write-off that already flipped it
        // matches 0 rows here → roll back (no duplicate adjustment/JV) → 409. The
        // source_doc fa:<adjustmentId> is a FRESH uuid per call, so the unique index
        // does NOT block a double-write-off; this guard is what does.
        const flipped = await tx
          .update(
            fixedAssets,
            { status: "written_off" },
            and(eq(fixedAssets.id, assetId), eq(fixedAssets.status, "active")),
          )
          .returning();
        if (flipped.length === 0) {
          throw new StaleStateError(
            `fixed asset ${assetId} is not active (already written off or disposed)`,
          );
        }
        // Record the adjustment FIRST so the JV's source_doc can reference it.
        await tx
          .insert(faAdjustments, {
            id: adjustmentId,
            assetId,
            kind: "write_off",
            amount: moneyStr(bookValue),
            currencyCode: currency,
            status: "approved",
            memo: `write-off ${asset.name}`,
            jvId: null,
          })
          .returning();

        if (!canPost) {
          // C10 honest-empty: no REAL account to post against, or nothing to remove.
          return null; // GAP: GL posting deferred (jvId stays null).
        }

        const amount = moneyStr(bookValue);
        const no = await allocJvNo(tx);
        const lineRows: (typeof jvLines.$inferInsert)[] = [
          { jvId, accountId: exprId, dr: amount, cr: "0.00", currencyCode: currency },
          { jvId, accountId: ppeId, dr: "0.00", cr: amount, currencyCode: currency },
        ];
        await tx
          .insert(jvs, { id: jvId, no, sourceDoc: `fa:${adjustmentId}`, memo: `writeoff:${assetId}` })
          .returning();
        await tx.insertThrough(jvLines, jvs, jvId, lineRows);
        // Back-link the adjustment to its posted JV.
        await tx
          .update(faAdjustments, { jvId }, eq(faAdjustments.id, adjustmentId))
          .returning();
        return no;
      }),
    );
  } catch (err) {
    // B-318 FIRST: allocation exhausted — the asset is still active, nothing was
    // written off, so a 409 "already written off" would be a lie.
    if (err instanceof DocNoExhaustedError) return docNoExhausted(reply);
    if (err instanceof StaleStateError) {
      return reply.code(409).send({ code: "INVALID_STATE", message: err.message });
    }
    throw err;
  }

  return reply.code(200).send({
    id: adjustmentId,
    asset_id: assetId,
    kind: "write_off",
    amount: bookValue,
    jv_no: jvNo,
  });
}

// ---------------------------------------------------------------------------
// POST /fa/revalue — revalue a fixed asset (fa.jsx FARevalue)
// ---------------------------------------------------------------------------
// Body: { asset_id, new_value }. Enforced (the route gates finance.approve first):
//   - the asset must exist in THIS tenant (scoped 404 else).
//   - new_value > 0 (400 else).
// Sets the asset cost = new_value and records an fa_adjustment {kind:'revalue',
// amount: new_value}. HONEST GAP (C10 / accounting-policy-not-guessed): COA_SEED
// carries NO revaluation-surplus account, so the GL posting is DEFERRED (jvId=null)
// rather than posted against a fabricated account. Returns ActionOk {id, asset_id,
// kind:'revalue', amount: new_value, jv_no:null, posting_deferred:true}.
async function revalue(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const assetId = str(pick(body, "asset_id", "assetId")).trim();
  if (!assetId) return badRequest(reply, "asset_id is required");
  const newValue = toNum(pick(body, "new_value", "newValue"));
  if (newValue == null || newValue <= 0) {
    return badRequest(reply, "new_value must be a number greater than zero");
  }

  const [asset] = (await db.select(
    fixedAssets,
    eq(fixedAssets.id, assetId),
  )) as FixedAssetRow[];
  if (!asset) return notFound(reply, "fixed asset not found in this tenant");

  const currency = asset.currencyCode ?? "THB";
  const value = round2(newValue);
  const adjustmentId = randomUUID();

  await db.transaction(async (tx) => {
    await tx
      .update(fixedAssets, { cost: moneyStr(value) }, eq(fixedAssets.id, assetId))
      .returning();
    await tx
      .insert(faAdjustments, {
        id: adjustmentId,
        assetId,
        kind: "revalue",
        amount: moneyStr(value),
        currencyCode: currency,
        status: "approved",
        // GAP: no revaluation-surplus account in COA_SEED → GL posting deferred.
        jvId: null,
        memo: `revalue → ${value} (GL posting deferred: no revaluation-surplus account in COA_SEED)`,
      })
      .returning();
  });

  return reply.code(200).send({
    id: adjustmentId,
    asset_id: assetId,
    kind: "revalue",
    amount: value,
    jv_no: null,
    posting_deferred: true,
  });
}

// ---------------------------------------------------------------------------
// POST /fa/import — bulk register fixed assets (fa.jsx FAImport)
// ---------------------------------------------------------------------------
// Body: { rows: [{ name (required), cost?, life_years?, salvage?, acquired_date?,
//   cc_id?, depr_method? }] }. ALL rows are validated FIRST (name required per
//   row; every referenced cc_id resolves to THIS tenant via CC_HOPS) → a single
//   invalid row 400s and NOTHING is imported (atomic). Then all rows are inserted
//   (company_id force-set) inside one transaction. Route gates finance.create.
// Returns 201 { imported: N, ids: [...] }.
interface ImportRow {
  name: string;
  cost: string;
  lifeYears: number | null;
  salvage: string;
  acquiredDate: string | null;
  ccId: string | null;
  deprMethod: string | null;
}

async function importAssets(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const rawRows = pick(body, "rows");
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return badRequest(reply, "rows must be a non-empty array");
  }

  // Phase 1 — validate EVERY row before writing anything (atomic all-or-nothing).
  const parsed: ImportRow[] = [];
  const ccIds: string[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const raw = (rawRows[i] ?? {}) as Record<string, unknown>;
    const name = str(pick(raw, "name")).trim();
    if (!name) return badRequest(reply, `row ${i + 1}: name is required`);
    const cost = toNum(pick(raw, "cost"));
    const salvage = toNum(pick(raw, "salvage"));
    const life = toNum(pick(raw, "life_years", "lifeYears"));
    const ccId = str(pick(raw, "cc_id", "ccId")).trim() || null;
    const acquiredDate = str(pick(raw, "acquired_date", "acquiredDate")).trim() || null;
    const deprMethod = str(pick(raw, "depr_method", "deprMethod")).trim() || null;
    if (ccId) ccIds.push(ccId);
    parsed.push({
      name,
      cost: cost != null ? moneyStr(cost) : "0",
      lifeYears: life != null ? Math.round(life) : null,
      salvage: salvage != null ? moneyStr(salvage) : "0",
      acquiredDate,
      ccId,
      deprMethod,
    });
  }

  // Every referenced cc_id must belong to THIS tenant — one scoped selectThrough
  // (fail closed: a foreign id resolves to nothing → 400, nothing imported).
  const distinctCc = [...new Set(ccIds)];
  if (distinctCc.length > 0) {
    const owned = await db.selectThrough(
      costCenters,
      CC_HOPS,
      inArray(costCenters.id, distinctCc),
    );
    const ownedSet = new Set(owned.map((c) => c.id));
    const foreign = distinctCc.find((id) => !ownedSet.has(id));
    if (foreign) return badRequest(reply, `cc_id ${foreign} not found in this tenant`);
  }

  // Phase 2 — insert all rows in one transaction (company_id force-set per row).
  const ids: string[] = [];
  await db.transaction(async (tx) => {
    for (const p of parsed) {
      const [created] = (await tx
        .insert(fixedAssets, {
          name: p.name,
          cost: p.cost,
          lifeYears: p.lifeYears,
          salvage: p.salvage,
          acquiredDate: p.acquiredDate,
          ccId: p.ccId,
          deprMethod: p.deprMethod,
        })
        .returning()) as FixedAssetRow[];
      ids.push(created!.id);
    }
  });

  return reply.code(201).send({ imported: ids.length, ids });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the FA (fixed-asset) routes on the given (/api/v1-prefixed) scope. */
export function registerFaRoute(app: FastifyInstance): void {
  const withTenantList =
    (run: (db: TenantDb) => Promise<Record<string, unknown>[]>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const db = request.db;
      if (!db) return unauthenticated(reply);
      return reply.code(200).send(listEnvelope(await run(db)));
    };

  app.get("/fa/assets", withTenantList(listAssets));
  app.get("/fa/adjustments", withTenantList(listAdjustments));

  app.post("/fa/assets", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    // Registering a fixed asset is finance-staff work — gate on the finance
    // `create` perm. Fail-closed: an unattributable caller, or one lacking the
    // perm, is denied 403 before the asset is written (mirrors ap.ts / bank.ts).
    const caller = await loadCaller(request);
    if (!caller || !permAllowed(caller.perms, FINANCE_MODULE, "create")) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: "fixed asset registration requires the finance create permission",
      });
    }
    return createAsset(db, (request.body ?? {}) as Record<string, unknown>, reply);
  });

  app.put("/fa/assets/:id", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    // Editing an asset is finance-staff work — gate on finance `create`.
    if (!(await requireFinance(request, reply, "create", "editing a fixed asset"))) {
      return reply;
    }
    const { id } = request.params as { id: string };
    return updateAsset(db, id, (request.body ?? {}) as Record<string, unknown>, reply);
  });

  app.post("/fa/import", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    // Bulk registration is finance-staff work — gate on finance `create`.
    if (!(await requireFinance(request, reply, "create", "importing fixed assets"))) {
      return reply;
    }
    return importAssets(db, (request.body ?? {}) as Record<string, unknown>, reply);
  });

  app.post("/fa/run-depreciation", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    // Depreciation LOCKS money (posts a JV) — require finance `approve`.
    if (!(await requireFinance(request, reply, "approve", "running depreciation"))) {
      return reply;
    }
    return runDepreciation(db, (request.body ?? {}) as Record<string, unknown>, reply);
  });

  app.post("/fa/write-off", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    // A write-off LOCKS money (posts a JV) — require finance `approve`.
    if (!(await requireFinance(request, reply, "approve", "writing off a fixed asset"))) {
      return reply;
    }
    return writeOff(db, (request.body ?? {}) as Record<string, unknown>, reply);
  });

  app.post("/fa/revalue", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    // A revalue changes the asset's carrying value — require finance `approve`.
    if (!(await requireFinance(request, reply, "approve", "revaluing a fixed asset"))) {
      return reply;
    }
    return revalue(db, (request.body ?? {}) as Record<string, unknown>, reply);
  });
}

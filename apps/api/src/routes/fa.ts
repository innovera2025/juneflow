// FA (Fixed Assets) handlers — Phase-3 Finance Wave-0 (GL + FA lane). Wires the
// fa.assets register/list screen: list the tenant's fixed assets and register a
// new one. The schema (finance.ts fixed_asset: name, cost, currency_code,
// life_years, cc_id, depr_method) and the contract paths (openapi.yaml — the two
// opaque ops, declared) ALL pre-exist. This file wires the handlers and is
// registered in app.ts (registerFaRoute).
//
// Contract (openapi.yaml §Finance-Accounting):
//   GET  /fa/assets   → EntityList     — fixed assets      (listFaAssets)
//   POST /fa/assets   → EntityCreated  — register an asset (createFaAsset)
// Each row/body is the opaque Entity (snake_case wire of REAL columns). Reads on
// an opaque endpoint need no contract change (FLOW-A opaque-Entity finding).
//
// Tenant scope (fail closed): fixed_asset carries company_id → the scoped
// TenantDb.select() / insert() doors. cost_center carries NO company_id — it
// anchors through project (cc → project.company_id), so a supplied cc_id is
// tenant-verified via selectThrough (a foreign id resolves to nothing → 400).
// Without a resolved tenant, request.db is absent and every handler answers a
// flat 401.
//
// Financial-authz (B-082 / F1): registering an asset is finance-staff work, so
// POST /fa/assets gates on the EXISTING perms matrix — the `finance` module's
// `create` right (reuses authz.ts loadCaller/permAllowed; it invents no policy).
// Fail-closed: an unattributable caller, or one lacking the perm, is denied 403.
//
// OUT OF SCOPE (Wave-0, do NOT add here): depreciation math (runFaDepreciation —
// the gated post-Wave-0 straight-line (cost − salvage)/life posting per Wei
// B-123) and the fixed_asset superset columns (salvage / accumulated / status —
// the post-Wave-0 migration 0035). This file writes EXISTING columns only.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { costCenters, fixedAssets, projects } from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";
import { listEnvelope } from "./list-envelope.js";
import { pick, str, toNum } from "./procurement.js";
import { loadCaller, permAllowed } from "./authz.js";

type FixedAssetRow = typeof fixedAssets.$inferSelect;

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

// ---------------------------------------------------------------------------
// GET /fa/assets — list fixed assets (fa.jsx FixedAssetRegister)
// ---------------------------------------------------------------------------
// Real source: fixed_asset (company-scoped). The wire carries the REAL columns
// only (no depreciation is computed in Wave-0). Ordered newest-first, mirroring
// the sibling list routes.
function assetWire(a: FixedAssetRow): Record<string, unknown> {
  return {
    id: a.id,
    name: a.name,
    cost: num(a.cost),
    currency_code: a.currencyCode,
    life_years: a.lifeYears,
    cc_id: a.ccId,
    depr_method: a.deprMethod,
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
// Body (opaque Entity): { name (required), cost?, life_years?, cc_id?,
//   depr_method? }. Enforced, in order (the route gates finance.create first):
//   - name required (400 else).
//   - cost is INPUT data (the asset's acquisition cost — a registration, NOT a
//     computed money-derivation), stored as-is (2-dp normalized); no
//     depreciation is derived in Wave-0.
//   - a supplied cc_id must resolve to THIS tenant — cost_center scopes through
//     project (a foreign id resolves to nothing through the hop → 400, fail
//     closed).
// company_id is force-set by the scoped insert. EXISTING columns only (no
// salvage / accumulated / status — those are the post-Wave-0 migration 0035).
async function createAsset(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const name = str(pick(body, "name")).trim();
  if (!name) return badRequest(reply, "name is required");

  const costRaw = toNum(pick(body, "cost"));
  const lifeYearsRaw = toNum(pick(body, "life_years", "lifeYears"));
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
      lifeYears: lifeYearsRaw != null ? Math.round(lifeYearsRaw) : null,
      ccId,
      deprMethod,
    })
    .returning()) as FixedAssetRow[];

  return reply.code(201).send(assetWire(created!));
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
}

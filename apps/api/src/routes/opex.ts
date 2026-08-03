// GET + POST /opex/budgets — the tenant's OPEX budgets by dept + year
// (accounting-extra opex compare · openapi listOpexBudgets / createOpexBudget).
//
// Contract (openapi.yaml /opex/budgets): GET → the B-014 paginated list envelope
// {data, page, page_size, total} (EntityList), each row an opaque Entity; POST →
// 201 EntityCreated. The wire row is the snake_case shape of the REAL opex_budget
// columns {id, dept, year, months, currency_code}. `months` is the 12-month figure
// array (jsonb number[]) — planning INPUT (a budget), so the client supplies the
// figures; there is no server VAT/total/JV to compute. currency_code is server-set
// (THB, the per-column currency rule) and unique(company_id, dept, year) is
// enforced — a duplicate is a 409, never a silent overwrite.
//
// opex_budget carries its OWN company_id (NOT NULL FK → company) → read/write
// through the scoped TenantDb.select()/insert() door (auto-injects WHERE
// company_id = <this tenant>; insert force-sets it). Without a resolved tenant,
// request.db is absent → flat 401.
//
// ?year= filters the list to one budget year (accounting compares years); filter/
// page are accepted per the contract but not interpreted (the full tenant list is
// returned as one page). money=NONE — a budget is a plan, it posts no GL/JV.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import { opexBudgets } from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";
import { isUniqueViolation } from "./gl-post.js";
import { pick, str, toNum } from "./procurement.js";

type OpexBudgetRow = typeof opexBudgets.$inferSelect;

function unauthenticated(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
}
function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ code: "VALIDATION", message });
}
function conflict(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(409).send({ code: "INVALID_STATE", message });
}

/** The opaque Entity wire of a real opex_budget row (timestamps dropped). */
function budgetWire(r: OpexBudgetRow): Record<string, unknown> {
  return {
    id: r.id,
    dept: r.dept,
    year: r.year,
    months: r.months,
    currency_code: r.currencyCode,
  };
}

/** GET /opex/budgets — tenant-scoped list, optional ?year= filter, year+dept order. */
async function listBudgets(
  db: TenantDb,
  year: number | null,
): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(opexBudgets)) as OpexBudgetRow[];
  const filtered = year != null ? rows.filter((r) => r.year === year) : rows;
  return [...filtered]
    .sort((a, b) => a.year - b.year || (a.dept < b.dept ? -1 : a.dept > b.dept ? 1 : 0))
    .map(budgetWire);
}

/** POST /opex/budgets — create a dept+year budget (unique per tenant). */
async function createBudget(
  db: TenantDb,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const dept = str(pick(body, "dept")).trim();
  if (!dept) return badRequest(reply, "dept is required");
  const yearRaw = toNum(pick(body, "year"));
  if (yearRaw == null) return badRequest(reply, "year is required");
  const year = Math.trunc(yearRaw);

  // months = the 12-month budget figures (client-supplied planning input). Each is
  // coerced to a finite number; a non-array → an empty budget (never fabricated).
  const rawMonths = pick(body, "months");
  const months = Array.isArray(rawMonths) ? rawMonths.map((m) => toNum(m) ?? 0) : [];

  // unique(company_id, dept, year): a duplicate is a 409 (scoped pre-check; the
  // opex_budget_company_dept_year_uq index closes the concurrent-race window).
  const dup = (await db.select(
    opexBudgets,
    and(eq(opexBudgets.dept, dept), eq(opexBudgets.year, year)),
  )) as OpexBudgetRow[];
  if (dup.length > 0) {
    return conflict(reply, `a budget for ${dept} ${year} already exists`);
  }

  try {
    const [created] = (await db
      .insert(opexBudgets, { dept, year, months, currencyCode: "THB" })
      .returning()) as OpexBudgetRow[];
    return reply.code(201).send(budgetWire(created!));
  } catch (err) {
    // A concurrent create raced past the pre-check → the unique index tripped
    // 23505 → the same 409 (never a 500 / a duplicate budget).
    if (isUniqueViolation(err)) {
      return conflict(reply, `a budget for ${dept} ${year} already exists`);
    }
    throw err;
  }
}

/** Register GET + POST /opex/budgets on the given (already /api/v1-prefixed) scope. */
export function registerOpexRoute(app: FastifyInstance): void {
  app.get("/opex/budgets", async (request: FastifyRequest, reply: FastifyReply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    const yearRaw = (request.query as { year?: unknown }).year;
    const parsed = yearRaw == null || yearRaw === "" ? NaN : Number(yearRaw);
    const year = Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    return reply.code(200).send(listEnvelope(await listBudgets(db, year)));
  });

  app.post("/opex/budgets", async (request: FastifyRequest, reply: FastifyReply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    const body = (request.body ?? {}) as Record<string, unknown>;
    return createBudget(db, body, reply);
  });
}

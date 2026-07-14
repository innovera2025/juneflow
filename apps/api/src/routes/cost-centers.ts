// GET + POST /cost-centers — the tenant's cost centers (P1-BE-07 + P1-BE-11,
// B-059; master.jsx MasterCC/CCAddForm L584-731, docs/extract/MOCK-DATA.md).
//
// Contract (openapi.yaml /cost-centers): GET → the B-014 paginated list
// envelope {data, page, page_size, total} (EntityList) where each `data` row is
// an opaque Entity; POST → 201 EntityCreated. Field semantics are locked by
// B-059(ก) (schema cost_center in project.ts — the approved superset of the
// mock's 7 columns): the wire row is
//   {id, code, name, project_id, type, link, owner, budget, currency_code,
//    status}
// where
//   type   = Project | Overhead | Dept (cost_center_type enum, mock badge).
//   link   = the "ผูกกับ (เฟส / Block / แผนก)" display text.
//   owner  = the responsible person's display name (mock หัวหน้า).
//   budget = money in FULL baht (numeric + currency_code — never the mock's
//            comma-formatted string). Emitted as a Number, like GET /projects
//            does for budget and GET /models does for price.
//   status = draft | approved (cost_center_status enum). A PLAIN field, not a
//            workflow: creation always lands `draft` (B-059 — no approval flow
//            exists; the mock notify says "สถานะ ร่าง (รออนุมัติงบ)").
// Timestamps are dropped, exactly like GET /project-types.
//
// The screen has Add ONLY (B-059 "Add เท่านั้นตาม jsx" — the mock has no edit
// modal), so POST is the only mutation registered here.
//
// cost_center carries NO company_id of its own — it hangs off project_id
// (NOT NULL FK → project, erd.html), so it is a PARENT-FK-scoped tenant table
// (like project_node / boq_doc), NOT a platform-global reference table. Reads
// go through TenantDb.selectThrough() anchored on the company_id-scoped
// project root:
//
//   SELECT cost_center.* FROM cost_center
//     INNER JOIN project ON cost_center.project_id = project.id
//   WHERE project.company_id = <this tenant>
//
// and writes go through the scoped insertThrough() door, which FIRST verifies
// this tenant owns the target project (fail-closed) — a cost center can never
// be created under (or read from) another tenant's project. selectReference()
// would throw for it (cost_center is not on the REFERENCE_TABLES allowlist),
// and it must never be read bare. Without a resolved tenant, request.db is
// absent and the handler answers 401 (same posture as GET /projects &
// /companies).
//
// filter/page query params are accepted per the contract but not interpreted
// (their semantics are undefined — inventing filter behavior would violate
// PLAN.md §0 rule 4); the full tenant-scoped list is returned as one page.
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { costCenters, projects } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";

type CostCenterRow = typeof costCenters.$inferSelect;

/** cost_center_type enum values (B-059 — mock CCAddForm dropdown, verbatim). */
const CC_TYPES = new Set(["Project", "Overhead", "Dept"]);

/** numeric column (string | null) → Number | null on the wire (like projects.ts). */
function num(value: string | null): number | null {
  return value == null ? null : Number(value);
}

/** The opaque Entity wire shape for one cost center (B-059 full field set). */
function toWire(c: CostCenterRow): Record<string, unknown> {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    project_id: c.projectId,
    type: c.type,
    link: c.link,
    owner: c.owner,
    budget: num(c.budget),
    currency_code: c.currencyCode,
    status: c.status,
  };
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Parse the mock budget input: number, or string with the mock's thousands
 * commas stripped (CCAddForm: `Number(budget.replace(/,/g, ""))`). Returns
 * null for a non-numeric value (→ 400, mock "งบต้องเป็นตัวเลข").
 */
function toBudget(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Register GET + POST /cost-centers on the given (already /api/v1-prefixed) scope. */
export function registerCostCentersRoute(app: FastifyInstance): void {
  app.get("/cost-centers", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    // cost_center has no company_id — scope it through its project root.
    const rows = await db.selectThrough(costCenters, [
      { fk: costCenters.projectId, parent: projects },
    ]);

    return reply.code(200).send(
      // B-014: wrap the cost centers in the paginated list envelope
      // ({data, page, page_size, total}). The full tenant-scoped list is
      // returned as one page (filter/page/page_size accepted but not
      // interpreted) — see list-envelope.ts.
      listEnvelope(rows.map(toWire)),
    );
  });

  app.post("/cost-centers", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const code = str(body.code).trim();
    const name = str(body.name).trim();
    // `type` defaults to Project — the CCAddForm's initial dropdown value.
    const type = str(body.type).trim() || "Project";
    // link/owner default to the mock's "—" placeholder (CCAddForm submit:
    // `link.trim() || "—"`, `owner.trim() || "—"`).
    const link = str(body.link).trim() || "—";
    const owner = str(body.owner).trim() || "—";
    const projectId = str(body.project_id ?? body.projectId).trim();

    // Validation mirrors CCAddForm.submit (master.jsx:617-628). The mock's
    // untouched "CC-" prefill counts as no code entered.
    if (!code || code === "CC-") {
      return reply.code(400).send({ code: "VALIDATION", message: "code is required" });
    }
    if (!name) {
      return reply.code(400).send({ code: "VALIDATION", message: "name is required" });
    }
    if (!CC_TYPES.has(type)) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: "type must be one of Project, Overhead, Dept",
      });
    }
    // Budget optional — omitted/empty means 0 (mock: `Number((budget || "0"))`).
    const rawBudget = body.budget;
    const budgetOmitted = rawBudget == null || rawBudget === "";
    const budget = budgetOmitted ? 0 : toBudget(rawBudget);
    if (budget == null) {
      return reply.code(400).send({ code: "VALIDATION", message: "budget must be a number" });
    }
    if (!projectId) {
      return reply.code(400).send({ code: "VALIDATION", message: "project_id is required" });
    }

    // The target project must belong to this tenant (scoped select — a foreign
    // project id resolves to nothing, so nothing about it leaks; models.ts
    // treats a body-supplied reference the same way).
    const [project] = await db.select(projects, eq(projects.id, projectId));
    if (!project) {
      return reply.code(400).send({ code: "VALIDATION", message: "project not found" });
    }

    // Duplicate code check across the tenant's full list — the mock validates
    // "รหัสนี้มีอยู่แล้ว" against every visible row, not per project.
    const existing = await db.selectThrough(costCenters, [
      { fk: costCenters.projectId, parent: projects },
    ]);
    if (existing.some((c) => c.code === code)) {
      return reply.code(409).send({
        code: "DUPLICATE_CODE",
        message: `cost center code ${code} already exists`,
      });
    }

    // insertThrough re-verifies tenant ownership of the project before writing
    // (fail-closed) — the row can never land under a foreign project. The
    // server owns status: a new cost center ALWAYS starts draft (B-059 —
    // mock notify "สถานะ ร่าง (รออนุมัติงบ)"); any client value is ignored.
    const [created] = await db.insertThrough(costCenters, projects, projectId, [
      {
        projectId,
        code,
        name,
        type: type as "Project" | "Overhead" | "Dept",
        link,
        owner,
        // full baht; stored as the numeric column's 2-decimal string.
        budget: budget.toFixed(2),
        status: "draft",
      },
    ]);

    return reply.code(201).send(toWire(created!));
  });
}

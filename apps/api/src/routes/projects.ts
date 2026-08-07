// GET /projects — first resource list route (P1-BE-01, extended P1-BE-03).
//
// Contract (openapi.yaml /projects GET): the B-014 paginated list envelope
// {data, page, page_size, total} where each `data` row is a Project
// {id, name, type, budget, currency_code, status} + the B-041(ก+) approved
// ProjectSwitcher extensions {short, color, company_id, units, phases[]} —
// required [id, name, type, status].
//
// `type` is the project_type KEY (realestate|solar|civil|service, or a tenant's
// custom "custom_…"): the table stores type_id → project_type (erd.html), so we
// resolve keys via project_type. Since B-065 project_type is a HYBRID table
// (global defaults + tenant-owned custom types), it is read through the
// TenantDb.selectGlobalOrOwned() door (global OR own — never another tenant's),
// NOT the old reference door. Every project read is tenant-scoped through
// request.db — project_node rows (no company_id column) go through the scoped
// selectThrough door anchored on project.
//
// Derived fields (B-041(ก+), numbers come from seed rows — never hardcoded):
//   units      = project_node kind='unit' rows of the project
//   phases[]   = project_node kind='phase' rows: {id, name, units, sold_pct,
//                sale_status} where units counts unit-kind DESCENDANTS of the
//                phase (units may hang under intermediate block nodes) and
//                sold_pct = round(100 × sales_unit stage ∈ {sold, soldBuilt}
//                / units) (0 when the phase has no units).
//
// filter/page query params are accepted per the contract but not interpreted:
// the contract gives them no semantics ("free-text/structured" — undefined),
// and inventing filter behavior would violate PLAN.md §0 rule 4. The full
// list is what the shell (B-020 ProjectSwitcher) consumes.
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  projectNodes,
  projects,
  projectTypes,
  salesUnits,
} from "@juneflow/db/schema";
import { sendQuotaExceeded, type QuotaGuard } from "../plugins/quota.js";
import { listEnvelope } from "./list-envelope.js";
import { entryOrder, stampEntryOrder } from "./list-order.js";

type ProjectNodeRow = typeof projectNodes.$inferSelect;

/** Sales-unit stages that count as sold (B-041(ก+): sold_pct numerator). */
const SOLD_STAGES = new Set(["sold", "soldBuilt"]);

/**
 * The 4 product project_type keys (ProjectInput.type enum, openapi.yaml). A
 * create must name one — it resolves to the NOT-NULL type_id FK.
 */
const PROJECT_TYPE_KEYS = new Set(["realestate", "solar", "civil", "service"]);

/**
 * Safety cap on the unit count POST /projects will materialize under the
 * wizard's first phase — the same per-block ceiling POST /projects/{id}/nodes
 * enforces (project-nodes.ts MAX_UNITS_PER_BLOCK; mock BlockAddForm "สูงสุด 200").
 * The wizard's step-3 unit count seeds that first block-sized batch (~84 in the
 * mock placeholder), so the same bound applies here.
 */
const MAX_UNITS_PER_PHASE = 200;

/**
 * Phase rows for one project: unit-kind descendants are collected per phase
 * through the parent_id tree (units sit under blocks under phases — seed
 * B-009), and sold_pct comes from the sales_unit stage per unit node.
 */
function derivePhases(
  nodes: ProjectNodeRow[],
  stageByUnitId: Map<string, string | null>,
) {
  const childrenByParent = new Map<string, ProjectNodeRow[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenByParent.get(node.parentId);
    if (siblings) siblings.push(node);
    else childrenByParent.set(node.parentId, [node]);
  }

  const collectUnitIds = (nodeId: string, out: string[]): string[] => {
    for (const child of childrenByParent.get(nodeId) ?? []) {
      if (child.kind === "unit") out.push(child.id);
      collectUnitIds(child.id, out);
    }
    return out;
  };

  return nodes
    .filter((n) => n.kind === "phase")
    .map((phase) => {
      const unitIds = collectUnitIds(phase.id, []);
      const sold = unitIds.filter((id) => {
        const stage = stageByUnitId.get(id);
        return stage != null && SOLD_STAGES.has(stage);
      }).length;
      return {
        id: phase.id,
        name: phase.name,
        units: unitIds.length,
        sold_pct:
          unitIds.length === 0
            ? 0
            : Math.round((100 * sold) / unitIds.length),
        sale_status: phase.saleStatus,
      };
    });
}

export interface ProjectsRouteOptions {
  /** Quota guard — POST /projects → 402 when over the package project quota. */
  quota: QuotaGuard;
}

/** Register GET + POST /projects on the given (already /api/v1-prefixed) scope. */
export function registerProjectsRoute(
  app: FastifyInstance,
  options: ProjectsRouteOptions,
): void {
  app.get("/projects", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    const [rows, typeRows, nodeRows, saleRows] = await Promise.all([
      db.select(projects),
      // project_type is a hybrid table (B-065) — read global defaults + own
      // custom types (never another tenant's) to resolve every project's key.
      db.selectGlobalOrOwned(projectTypes),
      // project_node carries no company_id — scoped through its project root.
      db.selectThrough(projectNodes, [
        { fk: projectNodes.projectId, parent: projects },
      ]),
      db.select(salesUnits),
    ]);
    const typeKeyById = new Map(typeRows.map((t) => [t.id, t.key]));

    const nodesByProject = new Map<string, ProjectNodeRow[]>();
    for (const node of nodeRows) {
      const list = nodesByProject.get(node.projectId);
      if (list) list.push(node);
      else nodesByProject.set(node.projectId, [node]);
    }
    const stageByUnitId = new Map<string, string | null>();
    for (const su of saleRows) {
      if (su.unitId) stageByUnitId.set(su.unitId, su.stage);
    }

    return reply.code(200).send(
      // B-014: wrap the project rows in the paginated list envelope
      // ({data, page, page_size, total}). The full list is returned as one
      // page (filter/page/page_size are accepted but not interpreted) — see
      // list-envelope.ts.
      // B-323: ENTRY order (created_at ASC), NOT newestFirst — this is the one master
      // list where newest-first would be actively wrong. `project` is in the seed's
      // ASCENDING_STAGGER_TABLES because the app treats the OLDEST project as the
      // primary one (dashboard.ts resolvePrimaryProject sorts created_at ASC and takes
      // [0] to find the hero project `project:rjp`, seed index 0). Ordering this list
      // newest-first would render it upside-down relative to that same anchor.
      listEnvelope(
        entryOrder(rows).map((p) => {
          const nodes = nodesByProject.get(p.id) ?? [];
          return {
            id: p.id,
            name: p.name,
            // type_id is NOT NULL + FK-restrict onto project_type, so the key
            // always resolves for a well-formed row.
            type: typeKeyById.get(p.typeId),
            budget: p.budget == null ? null : Number(p.budget),
            currency_code: p.currencyCode,
            status: p.status,
            short: p.short,
            color: p.color,
            company_id: p.companyId,
            units: nodes.filter((n) => n.kind === "unit").length,
            phases: derivePhases(nodes, stageByUnitId),
          };
        }),
      ),
    );
  });

  // POST /projects (operationId createProject) — the create-project wizard's
  // backend (P1-BE-13, B-058; CreateProjectForm master.jsx:1242-1338). Body is
  // ProjectInput {name*, type*, short?, budget?, currency_code?, units?,
  // phases:[{label, units}]?}. The wizard's `finish()` sends the trimmed name,
  // the project_type key, the uppercased short code, and — when the user did NOT
  // skip structure — a single first phase carrying its unit count.
  //
  // The project row carries its own company_id (scoped insert door force-sets
  // it). The wizard's first phase is materialized as project_node rows so the
  // number the user entered survives a round-trip: the project table has no
  // units column — GET /projects DERIVES units/phases from project_node, so the
  // only faithful way to persist "84 units in เฟส 1" is 84 kind='unit' nodes
  // (saleStatus 'empty', exactly like a fresh block in POST /projects/{id}/nodes).
  // Units hang directly under the phase; derivePhases counts unit descendants of
  // a phase (direct or nested). Package project quota gates creation → 402.
  app.post("/projects", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    // Package project quota gates creation (contract POST /projects → 402). The
    // usage count lives in the injected resolver (files.ts uses the same door);
    // the route only asks whether one more project fits.
    const status = await options.quota.check(db.companyId, "projects");
    if (!status.ok) {
      return sendQuotaExceeded(reply, "projects", options.quota.upgradeUrl);
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = str(body.name).trim();
    const typeKey = str(body.type).trim();
    // Wizard sends an already-uppercased short (`code.trim().toUpperCase() ||
    // undefined`); uppercase defensively. Empty → null (display-only master col).
    const short = str(body.short).trim().toUpperCase() || null;
    const currencyCode =
      str(body.currency_code ?? body.currencyCode).trim() || "THB";

    // ProjectInput.required = [name, type].
    if (!name) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "name is required" });
    }
    if (!PROJECT_TYPE_KEYS.has(typeKey)) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: "type must be one of realestate, solar, civil, service",
      });
    }

    // budget optional; a supplied non-numeric value is a 400 (money column).
    const rawBudget = body.budget;
    const budgetOmitted = rawBudget == null || rawBudget === "";
    const budget = budgetOmitted ? null : toMoney(rawBudget);
    if (!budgetOmitted && budget == null) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "budget must be a number" });
    }

    // phases[] → the wizard's optional first phase (label + unit count). Blank
    // labels are dropped (the wizard only emits a phase when phName.trim()).
    const phasesInput = Array.isArray(body.phases) ? body.phases : [];
    const phaseSpecs: { label: string; units: number }[] = [];
    for (const raw of phasesInput) {
      const ph = (raw ?? {}) as Record<string, unknown>;
      const label = str(ph.label ?? ph.l ?? ph.name).trim();
      if (!label) continue;
      const units = toInt(ph.units) ?? 0;
      if (units < 0) {
        return reply
          .code(400)
          .send({ code: "VALIDATION", message: "phase units must be >= 0" });
      }
      if (units > MAX_UNITS_PER_PHASE) {
        return reply.code(400).send({
          code: "VALIDATION",
          message: `at most ${MAX_UNITS_PER_PHASE} units per phase`,
        });
      }
      phaseSpecs.push({ label, units });
    }

    // Resolve the project_type key → type_id (NOT-NULL FK). project_type is a
    // hybrid table (B-065): a project may reference a global default OR this
    // tenant's own custom type, so resolve against global + own (the hybrid
    // door), never another tenant's types.
    const typeRows = await db.selectGlobalOrOwned(projectTypes);
    const typeId = typeRows.find((t) => t.key === typeKey)?.id;
    if (!typeId) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: `project type ${typeKey} not found`,
      });
    }

    // Create the project (company_id force-set by the scoped insert door). The
    // server owns status: a new project starts `active` (mock projects are
    // active — CreateProjectForm sets no status).
    const [created] = await db
      .insert(projects, {
        typeId,
        name,
        short,
        budget: budget == null ? null : budget.toFixed(2),
        currencyCode,
        status: "active",
      })
      .returning();

    // Materialize the first phase(s) + their units as project_node rows.
    const createdPhases: { id: string; name: string; units: number }[] = [];
    if (phaseSpecs.length > 0) {
      const nodeRows: (typeof projectNodes.$inferInsert)[] = [];
      for (const spec of phaseSpecs) {
        const phaseId = randomUUID();
        nodeRows.push({
          id: phaseId,
          projectId: created!.id,
          parentId: null,
          kind: "phase",
          name: spec.label,
          saleStatus: null,
        });
        for (let j = 0; j < spec.units; j++) {
          nodeRows.push({
            id: randomUUID(),
            projectId: created!.id,
            parentId: phaseId,
            kind: "unit",
            name: String(j + 1).padStart(2, "0"),
            saleStatus: "empty",
          });
        }
        createdPhases.push({ id: phaseId, name: spec.label, units: spec.units });
      }
      // insertThrough re-verifies this tenant owns the just-created project
      // before writing (fail-closed) — the nodes can never land under a foreign
      // project.
      //
      // B-323: nodeRows is the whole phase→unit ladder of a new project in ONE
      // insert — one now(), every node tied. project_node has no `seq`, and
      // dashboard.ts reads it with entryOrder to build the phase ladder top-down, so
      // an unstamped batch renders that ladder in `defaultRandom()` uuid order.
      // (project-nodes.ts's own bySibling tiebreaks on name, so it survives a tie;
      // the dashboard reader does not — stamping fixes the table for both.)
      await db.insertThrough(
        projectNodes,
        projects,
        created!.id,
        stampEntryOrder(nodeRows),
      );
    }

    const totalUnits = createdPhases.reduce((n, p) => n + p.units, 0);

    // 201 Project — the same wire shape GET /projects emits. A brand-new
    // project's units are all `empty`, so every phase sold_pct is 0.
    return reply.code(201).send({
      id: created!.id,
      name: created!.name,
      type: typeKey,
      budget: created!.budget == null ? null : Number(created!.budget),
      currency_code: created!.currencyCode,
      status: created!.status,
      short: created!.short ?? null,
      color: created!.color ?? null,
      company_id: created!.companyId,
      units: totalUnits,
      phases: createdPhases.map((p) => ({
        id: p.id,
        name: p.name,
        units: p.units,
        sold_pct: 0,
        sale_status: null,
      })),
    });
  });
}

/** JSON string coercion (opaque body field → string, else ""). */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Parse an integer from opaque JSON (number | numeric string), else null. */
function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Parse a money amount (number | numeric string) from opaque JSON, else null. */
function toMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

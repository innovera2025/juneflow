// GET + POST /models — the tenant's house models (P1-BE-09, B-050;
// master.jsx MasterModel/ModelAddForm L426-578, SACRED-EDITS-QUEUE §4a/§4c).
//
// Contract (openapi.yaml /models): GET → the B-014 list envelope
// {data, page, page_size, total} of opaque Entity rows; POST → 201 EntityCreated
// (a new model always starts `draft`). Field semantics are locked by B-050 (DB
// schema `model` in project.ts): the wire row is
//   {id, code, type, area, bed, bath, parking, price, currency_code, status,
//    color, unit_count, bom_item_count}
// where
//   code           = the model code (e.g. "A-1"), unique within the company.
//   type           = the display name (schema column `name`, e.g. "บ้านเดี่ยว
//                    2 ชั้น") — exposed under the mock's `type` key (master.jsx).
//   price          = starting price in FULL baht (schema stores baht +
//                    currency_code; the FE divides by 1e6 for the "M ฿" card,
//                    master.jsx:559). Emitted as a Number, like GET /projects
//                    does for budget.
//   unit_count     = DERIVED (C10): project_node kind='unit' rows whose model_id
//                    is this model — NEVER the mock's hardcoded `count`.
//   bom_item_count = DERIVED (C10): the length of the model's BOM template
//                    (bom.items where bom.unit_type = model.code) — NEVER the
//                    mock's hardcoded `248 + i*30` (master.jsx:563).
//
// `model` carries its OWN company_id column (project.ts), so it is read/written
// through the scoped TenantDb.select()/insert() door (auto-injects / force-sets
// WHERE|SET company_id = <this tenant>) — a bare read is impossible, so another
// tenant's models can never leak. project_node has NO company_id and is read
// through the scoped selectThrough() door anchored on its project root; bom
// carries its own company_id (boq.ts) so it is a scoped select(). Without a
// resolved tenant, request.db is absent and the handler answers 401 (same
// posture as GET /projects, /doc-numbering).
//
// filter/page query params are accepted per the contract but not interpreted
// (their semantics are undefined — inventing filter behavior would violate
// PLAN.md §0 rule 4); the full tenant-scoped list is returned as one page.
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { models, projectNodes, projects, boms } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";

/** Model card accent palette — server rotates it at create time (master.jsx:449). */
const MODEL_COLORS = [
  "#0B2A4A",
  "#0F766E",
  "#1D4ED8",
  "#B45309",
  "#7C3AED",
  "#BE185D",
  "#0891B2",
];

type ModelRow = typeof models.$inferSelect;

/** numeric column (string | null) → Number | null on the wire (like projects.ts). */
function num(value: string | null): number | null {
  return value == null ? null : Number(value);
}

/**
 * The opaque Entity wire shape for one model. Derived counts come from real
 * per-tenant queries (C10): units by model_id, BOM items by unit_type = code.
 */
function toWire(
  m: ModelRow,
  unitCount: number,
  bomItemCount: number,
): Record<string, unknown> {
  return {
    id: m.id,
    code: m.code,
    type: m.name,
    area: num(m.area),
    bed: m.bed,
    bath: m.bath,
    parking: m.parking,
    price: num(m.price),
    currency_code: m.currencyCode,
    status: m.status,
    color: m.color,
    unit_count: unitCount,
    bom_item_count: bomItemCount,
  };
}

/** Register GET + POST /models on the given (already /api/v1-prefixed) scope. */
export function registerModelsRoute(app: FastifyInstance): void {
  app.get("/models", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    // model → own company_id (scoped select). project_node → no company_id, read
    // through the scoped selectThrough() door on its project root. bom → own
    // company_id (scoped select).
    const [rows, nodeRows, bomRows] = await Promise.all([
      db.select(models),
      db.selectThrough(projectNodes, [
        { fk: projectNodes.projectId, parent: projects },
      ]),
      db.select(boms),
    ]);

    // unit_count: unit-kind nodes grouped by model_id (C10 — real rows only).
    const unitsByModel = new Map<string, number>();
    for (const node of nodeRows) {
      if (node.kind !== "unit" || !node.modelId) continue;
      unitsByModel.set(node.modelId, (unitsByModel.get(node.modelId) ?? 0) + 1);
    }
    // bom_item_count: BOM template line count keyed by unit_type (= model code).
    const bomItemsByType = new Map<string, number>();
    for (const bom of bomRows) {
      bomItemsByType.set(bom.unitType, bom.items.length);
    }

    return reply.code(200).send(
      // B-014 list envelope; the full tenant-scoped list is one page.
      listEnvelope(
        rows.map((m) =>
          toWire(
            m,
            unitsByModel.get(m.id) ?? 0,
            m.code == null ? 0 : bomItemsByType.get(m.code) ?? 0,
          ),
        ),
      ),
    );
  });

  app.post("/models", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    // `type` is the mock's display-name field; also accept `name` as an alias.
    const rawType = body.type ?? body.name;
    const type = typeof rawType === "string" ? rawType.trim() : "";
    const area = toInt(body.area);
    const price = toMoney(body.price);

    // Validation mirrors ModelAddForm.submit (master.jsx:451-461).
    if (!code) {
      return reply.code(400).send({ code: "VALIDATION", message: "code is required" });
    }
    if (!type) {
      return reply.code(400).send({ code: "VALIDATION", message: "type is required" });
    }
    if (area == null || area < 1) {
      return reply.code(400).send({ code: "VALIDATION", message: "area must be a positive integer" });
    }
    if (body.price != null && body.price !== "" && (price == null || price <= 0)) {
      return reply.code(400).send({ code: "VALIDATION", message: "price must be greater than 0" });
    }

    // One scoped read serves both the uniqueness check and the palette rotation
    // (existing model count) — company_id is auto-injected by select().
    const existing = await db.select(models);
    if (existing.some((m) => m.code?.toUpperCase() === code)) {
      return reply.code(409).send({
        code: "DUPLICATE_CODE",
        message: `model code ${code} already exists`,
      });
    }

    const color = MODEL_COLORS[existing.length % MODEL_COLORS.length];
    const [created] = await db
      .insert(models, {
        code,
        name: type,
        area: String(area),
        bed: toInt(body.bed) ?? 0,
        bath: toInt(body.bath) ?? 0,
        parking: toInt(body.parking) ?? 0,
        // full baht; null when the optional price was omitted.
        price: price == null ? null : price.toFixed(2),
        // server owns status + color: a new model always starts draft.
        status: "draft",
        color,
      })
      .returning();

    // A brand-new model provably has no units and no BOM yet (master.jsx: "สร้าง
    // BOM ได้หลังบันทึก") — the derived counts are 0.
    return reply.code(201).send(toWire(created!, 0, 0));
  });

  // GET /models/:id/bom — the BOM template lines for a house model (boq.bom /
  // BOMTemplates, P2-WEB-05). The BOM lines already live in bom.items (jsonb),
  // keyed by unit_type = model.code (data-completeness gap-6 / F5 — no seed
  // change, only this read). Both model + bom carry their own company_id (scoped
  // select), so a foreign model resolves to nothing. Contract getModelBom →
  // EntityList; a model with no matching BOM returns an empty list honestly (the
  // screen's "no-BOM" empty state), never fabricated lines. (404 for a missing
  // model is undocumented — the contract declares only 200/401 — but honest.)
  app.get("/models/:id/bom", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    const { id } = request.params as { id: string };
    const [model] = await db.select(models, eq(models.id, id));
    if (!model) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `model ${id} not found` });
    }

    // BOM template lines keyed by unit_type = model.code (bom.items jsonb).
    const bomRows = model.code
      ? await db.select(boms, eq(boms.unitType, model.code))
      : [];
    const items = bomRows[0]?.items ?? [];
    return reply.code(200).send(listEnvelope(items));
  });
}

/** Parse an integer from opaque JSON (number | numeric string), else null. */
function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
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

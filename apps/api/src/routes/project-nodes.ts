// POST /projects/{id}/nodes + GET /projects/{id}/hierarchy — the project
// structure tree write side + real hierarchy read (P1-BE-10, B-053; master.jsx
// MasterProject/BlockAddForm L240-420, SACRED-EDITS-QUEUE §6b/§6c/§6f).
//
// Contract (openapi.yaml):
//   POST /projects/{id}/nodes → 201 EntityCreated. Creates a BLOCK node under the
//     project's first/active phase and auto-generates N unit nodes (status
//     "empty"), capped at 200 per block. Unit code = "{blockCode}-{NN}" (padStart
//     2), matching the mock's unit tooltip generator (master.jsx:391).
//   GET /projects/{id}/hierarchy → 200 {data: HierarchyNode[]}. A FLAT PRE-ORDER
//     tree (phase → block → unit): each node followed by its subtree. sold/built
//     are REAL counts from the unit nodes' sale status (C10 — never the mock's
//     hardcoded BLOCK_SEED numbers).
//
// Tenant scope: project_node carries NO company_id — it hangs off project_id
// (NOT NULL FK → project). Reads go through the scoped selectThrough() door
// anchored on the company_id-scoped project root; writes go through the scoped
// insertThrough() door, which first verifies this tenant owns the project. Both
// operations also verify the project itself via a scoped project select (→ 404
// when the id is outside the tenant). Without a resolved tenant, request.db is
// absent and the handler answers 401.
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { models, projectNodes, projects } from "@juneflow/db/schema";
import { stampEntryOrder } from "./list-order.js";

type NodeRow = typeof projectNodes.$inferSelect;

/** Max unit nodes auto-generated per block (mock BlockAddForm "สูงสุด 200"). */
const MAX_UNITS_PER_BLOCK = 200;

/** Sale statuses that count as sold / built (mirrors projects.ts derivePhases). */
const SOLD_STATUSES = new Set(["sold", "soldBuilt"]);
const BUILT_STATUSES = new Set(["built", "soldBuilt"]);

/** Stable sibling order: creation time, then name, then id (deterministic even
 *  for seed rows that share a transaction timestamp — unit names sort naturally). */
function bySibling(a: NodeRow, b: NodeRow): number {
  const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
  const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
  if (ta !== tb) return ta - tb;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Register the project-tree write/read routes on the /api/v1 scope. */
export function registerProjectNodesRoute(app: FastifyInstance): void {
  app.get("/projects/:id/hierarchy", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };

    // Verify the project is this tenant's (scoped select → 404 otherwise).
    const [project] = await db.select(projects, eq(projects.id, id));
    if (!project) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `project ${id} not found` });
    }

    // Nodes of THIS project, read through the scoped door (join to the tenant's
    // project root, plus the project_id filter).
    const nodes = await db.selectThrough(
      projectNodes,
      [{ fk: projectNodes.projectId, parent: projects }],
      eq(projectNodes.projectId, id),
    );

    return reply.code(200).send({ data: buildHierarchy(nodes) });
  });

  app.post("/projects/:id/nodes", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };

    // Verify the project is this tenant's (scoped select → 404 otherwise).
    const [project] = await db.select(projects, eq(projects.id, id));
    if (!project) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `project ${id} not found` });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = str(body.name).trim();
    const code = str(body.code).trim().toUpperCase();
    const units = toInt(body.units);
    const modelIdInput = str(body.model_id ?? body.modelId).trim() || null;

    // Validation mirrors BlockAddForm.submit (master.jsx:260-278).
    if (!name) {
      return reply.code(400).send({ code: "VALIDATION", message: "name is required" });
    }
    if (!code) {
      return reply.code(400).send({ code: "VALIDATION", message: "code is required" });
    }
    if (units == null || units < 1) {
      return reply.code(400).send({ code: "VALIDATION", message: "units must be at least 1" });
    }
    if (units > MAX_UNITS_PER_BLOCK) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: `at most ${MAX_UNITS_PER_BLOCK} units per block`,
      });
    }

    // The project's existing nodes: pick the first phase to attach under + check
    // block-code uniqueness within the project.
    const existing = await db.selectThrough(
      projectNodes,
      [{ fk: projectNodes.projectId, parent: projects }],
      eq(projectNodes.projectId, id),
    );

    const firstPhase = existing
      .filter((n) => n.kind === "phase")
      .sort(bySibling)[0];
    if (!firstPhase) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: "project has no phase to attach the block to",
      });
    }

    if (
      existing.some(
        (n) => n.kind === "block" && (n.code ?? "").toUpperCase() === code,
      )
    ) {
      return reply.code(409).send({
        code: "DUPLICATE_CODE",
        message: `block code ${code} already exists in this project`,
      });
    }

    // A supplied model must belong to this tenant (scoped select). Absent → null.
    let modelId: string | null = null;
    if (modelIdInput) {
      const [model] = await db.select(models, eq(models.id, modelIdInput));
      if (!model) {
        return reply.code(400).send({ code: "VALIDATION", message: "model not found" });
      }
      modelId = model.id;
    }

    // Build the block + its N empty unit nodes in one scoped insert. The block id
    // is generated up front so the units can reference it as parent_id.
    const blockId = randomUUID();
    const rows: (typeof projectNodes.$inferInsert)[] = [
      {
        id: blockId,
        projectId: id,
        parentId: firstPhase.id,
        modelId,
        kind: "block",
        name,
        code,
        saleStatus: null,
      },
    ];
    for (let j = 0; j < units; j++) {
      const unitCode = `${code}-${String(j + 1).padStart(2, "0")}`;
      rows.push({
        id: randomUUID(),
        projectId: id,
        parentId: blockId,
        modelId,
        kind: "unit",
        name: unitCode,
        code: unitCode,
        saleStatus: "empty",
      });
    }

    // insertThrough re-verifies tenant ownership of the project before writing
    // (fail-closed) — the child rows can never land under a foreign project.
    //
    // B-323: the block + all its units go in ONE insert, so without the stamp they
    // share a created_at. bySibling (this file) tiebreaks on name and survives that,
    // but dashboard.ts reads the same table with entryOrder and would fall through to
    // the random uuid. project_node has no `seq` — stamp the batch apart.
    await db.insertThrough(projectNodes, projects, id, stampEntryOrder(rows));

    // Echo the created block as a HierarchyNode: brand-new units are all empty →
    // sold/built are provably 0.
    return reply.code(201).send({
      id: blockId,
      parent_id: firstPhase.id,
      kind: "block",
      code,
      name,
      model_id: modelId,
      units,
      sold: 0,
      built: 0,
    });
  });
}

/**
 * Flatten the project's nodes into a pre-order HierarchyNode tree (phase → block
 * → unit). Each phase/block carries REAL units/sold/built counts derived from its
 * descendant unit nodes (C10); each unit carries its sale status.
 */
export function buildHierarchy(nodes: NodeRow[]): Record<string, unknown>[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, NodeRow[]>();
  const roots: NodeRow[] = [];
  for (const n of nodes) {
    // A node is a root when it has no parent, or its parent is outside this set
    // (phases are the roots — seed gives them parent_id null).
    if (n.parentId && byId.has(n.parentId)) {
      const list = childrenOf.get(n.parentId);
      if (list) list.push(n);
      else childrenOf.set(n.parentId, [n]);
    } else {
      roots.push(n);
    }
  }
  for (const list of childrenOf.values()) list.sort(bySibling);
  roots.sort(bySibling);

  // All unit-kind descendants of a node (through intermediate blocks).
  const collectUnits = (nodeId: string, out: NodeRow[]): NodeRow[] => {
    for (const child of childrenOf.get(nodeId) ?? []) {
      if (child.kind === "unit") out.push(child);
      collectUnits(child.id, out);
    }
    return out;
  };

  // HierarchyNode types its optional fields as string/uuid (not nullable), so
  // null-valued fields are OMITTED rather than emitted as null — only real values
  // reach the wire. required [id, kind, name] are always present.
  const wire = (node: NodeRow): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      id: node.id,
      kind: node.kind,
      name: node.name,
    };
    if (node.parentId) base.parent_id = node.parentId;
    if (node.code != null) base.code = node.code;
    if (node.modelId) base.model_id = node.modelId;
    if (node.kind === "unit") {
      if (node.saleStatus != null) base.status = node.saleStatus;
      return base;
    }
    // phase / block: aggregate the descendant unit sale statuses (C10).
    const units = collectUnits(node.id, []);
    base.units = units.length;
    base.sold = units.filter((u) => SOLD_STATUSES.has(u.saleStatus ?? "")).length;
    base.built = units.filter((u) => BUILT_STATUSES.has(u.saleStatus ?? "")).length;
    return base;
  };

  const out: Record<string, unknown>[] = [];
  const visited = new Set<string>();
  const walk = (node: NodeRow): void => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    out.push(wire(node));
    for (const child of childrenOf.get(node.id) ?? []) walk(child);
  };
  for (const root of roots) walk(root);
  return out;
}

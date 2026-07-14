// GET + POST /org-units + PUT + DELETE /org-units/{id} — the tenant's company /
// org-structure tree (P1-BE-10, B-052; master.jsx MasterCompany/OrgAddForm
// L7-234, SACRED-EDITS-QUEUE §6a/§6f).
//
// Contract (openapi.yaml /org-units, /org-units/{id}): GET → the B-014 list
// envelope of opaque Entity rows; POST → 201 EntityCreated; PUT → 200 EntityOk;
// DELETE → 200 ActionOk. Field semantics are locked by B-052 (schema `org_unit`,
// extensions.ts). The wire row is
//   {id, parent_id, level, icon, name, code, note}
// where every node of every level (company lvl0 + department/team lvl1-2) is one
// org_unit row; `parent_id` is the self-referential tree link and `note` is the
// mock's composed subtitle text stored verbatim (client composes it).
//
// GET returns a FLAT list in PRE-ORDER tree traversal (each parent immediately
// followed by its whole subtree — the mock's document order, master.jsx renders
// ORG_SEED in array order). Siblings/roots are ordered by (created_at, id) so a
// newly created child lands after its existing siblings, exactly like the mock
// inserts a new row after the parent's existing subtree (MasterCompany.handleSubmit).
//
// `org_unit` carries its OWN company_id column (extensions.ts), so it is
// read/written through the scoped TenantDb.select()/insert()/update()/delete()
// door (auto-injects / force-sets WHERE|SET company_id = <this tenant>) — a bare
// read is impossible and a foreign tenant's id never matches (→ 404). Without a
// resolved tenant, request.db is absent and the handler answers 401.
//
// Server rules (B-052 / §6f):
//   - level  = 0 for a company (no parent); min(parent.level+1, 2) for a dept.
//   - a department (non-company) MUST have a parent (400 otherwise).
//   - tax_id is validated `^\d{10,13}$` (digits only) ONLY when sent, company only.
//   - code is unique per tenant across ALL levels, case-insensitively (409 dup);
//     the DB backs it with a partial unique index on upper(code) (migration 0011).
//   - PUT is a PARTIAL merge: omitted fields keep their current values.
//   - re-parenting is guarded against cycles (a new parent may not be the node
//     itself nor any of its descendants) → 409.
//   - DELETE cascades the WHOLE subtree (node + all descendants); the mock's
//     single-level delete quirk is a bug, not spec (SACRED-EDITS-QUEUE §6).
import type { FastifyInstance } from "fastify";
import { eq, inArray } from "drizzle-orm";
import { orgUnits } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";

type OrgRow = typeof orgUnits.$inferSelect;

/** Default node icon by level, mirroring the mock (building/users/user). */
function iconForLevel(level: number): string {
  return level === 0 ? "building" : level === 1 ? "users" : "user";
}

/** The opaque Entity wire shape for one org unit. */
function toWire(o: OrgRow): Record<string, unknown> {
  return {
    id: o.id,
    parent_id: o.parentId,
    level: o.level,
    icon: o.icon,
    name: o.name,
    code: o.code,
    note: o.note,
  };
}

/** Stable order for roots/siblings: creation time, then id as a deterministic
 *  tiebreak (seed rows share a transaction timestamp — see seed stagger). */
function byCreatedThenId(a: OrgRow, b: OrgRow): number {
  const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
  const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Flatten the org rows into pre-order tree traversal: each node emitted, then
 * its children (ordered), recursively. Defensive against cycles (visited set)
 * and orphans (rows whose parent is absent are appended at the end).
 */
function preOrder(rows: OrgRow[]): OrgRow[] {
  const childrenOf = new Map<string, OrgRow[]>();
  const roots: OrgRow[] = [];
  for (const r of rows) {
    if (r.parentId) {
      const list = childrenOf.get(r.parentId);
      if (list) list.push(r);
      else childrenOf.set(r.parentId, [r]);
    } else {
      roots.push(r);
    }
  }
  for (const list of childrenOf.values()) list.sort(byCreatedThenId);
  roots.sort(byCreatedThenId);

  const out: OrgRow[] = [];
  const visited = new Set<string>();
  const walk = (node: OrgRow): void => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    out.push(node);
    for (const child of childrenOf.get(node.id) ?? []) walk(child);
  };
  for (const root of roots) walk(root);
  // Orphans (parent points outside the tenant's set — should not happen): keep
  // them rather than silently drop a real row.
  for (const r of rows.slice().sort(byCreatedThenId)) if (!visited.has(r.id)) walk(r);
  return out;
}

/** ids of a node's whole subtree (itself + all descendants) via the children map. */
function subtreeIds(rows: OrgRow[], rootId: string): string[] {
  const childrenOf = new Map<string, OrgRow[]>();
  for (const r of rows) {
    if (!r.parentId) continue;
    const list = childrenOf.get(r.parentId);
    if (list) list.push(r);
    else childrenOf.set(r.parentId, [r]);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    for (const child of childrenOf.get(id) ?? []) stack.push(child.id);
  }
  return ids;
}

/** Does the opaque body explicitly carry this key (present → part of the merge)? */
function has(body: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((k) => Object.prototype.hasOwnProperty.call(body, k));
}

/** First present value among the given keys (opaque field aliases). */
function pick(body: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(body, k)) return body[k];
  }
  return undefined;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Register GET/POST /org-units + PUT/DELETE /org-units/:id on the /api/v1 scope. */
export function registerOrgUnitsRoute(app: FastifyInstance): void {
  app.get("/org-units", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    // org_unit → own company_id (scoped select). Pre-order the flat tenant set.
    const rows = await db.select(orgUnits);
    return reply.code(200).send(listEnvelope(preOrder(rows).map(toWire)));
  });

  app.post("/org-units", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = str(pick(body, "name")).trim();
    const code = str(pick(body, "code")).trim().toUpperCase();
    const parentId = str(pick(body, "parent_id", "parentId")).trim() || null;
    const kind = str(pick(body, "kind")).trim().toLowerCase();
    // company vs department: an explicit kind wins; otherwise a parent implies a
    // department (mock toggle: OrgAddForm `kind`).
    const isCompany = kind ? kind === "company" : !parentId;

    if (!name) {
      return reply.code(400).send({ code: "VALIDATION", message: "name is required" });
    }
    if (!code) {
      return reply.code(400).send({ code: "VALIDATION", message: "code is required" });
    }
    if (!isCompany && !parentId) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: "a department must have a parent",
      });
    }

    // tax_id: company only, validated ONLY when sent (mock strips non-digits).
    if (isCompany && has(body, "tax_id", "taxId")) {
      const rawTax = str(pick(body, "tax_id", "taxId")).replace(/\D/g, "");
      if (rawTax !== "" && !/^\d{10,13}$/.test(rawTax)) {
        return reply.code(400).send({ code: "VALIDATION", message: "invalid tax id" });
      }
    }

    // One scoped read serves uniqueness + parent resolution (company_id injected).
    const rows = await db.select(orgUnits);
    if (rows.some((r) => (r.code ?? "").toUpperCase() === code)) {
      return reply.code(409).send({
        code: "DUPLICATE_CODE",
        message: `org code ${code} already exists`,
      });
    }

    let level = 0;
    let resolvedParent: string | null = null;
    if (!isCompany) {
      const parent = rows.find((r) => r.id === parentId);
      if (!parent) {
        return reply.code(400).send({ code: "VALIDATION", message: "parent not found" });
      }
      level = Math.min((parent.level ?? 0) + 1, 2);
      resolvedParent = parent.id;
    }

    const icon = has(body, "icon")
      ? str(pick(body, "icon")) || iconForLevel(level)
      : iconForLevel(level);
    const note = has(body, "note") ? str(pick(body, "note")) || null : null;

    const [created] = await db
      .insert(orgUnits, {
        parentId: resolvedParent,
        level,
        icon,
        name,
        code,
        note,
      })
      .returning();

    return reply.code(201).send(toWire(created!));
  });

  app.put("/org-units/:id", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;

    // Load the tenant tree once: needed for the 404, the parent resolution, and
    // the cycle guard. A scoped select can only ever return this tenant's rows.
    const rows = await db.select(orgUnits);
    const current = rows.find((r) => r.id === id);
    if (!current) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `org unit ${id} not found` });
    }

    // PARTIAL merge — only keys present in the body are updated.
    const set: Record<string, unknown> = {};
    if (has(body, "name")) set.name = str(pick(body, "name")).trim();
    if (has(body, "code")) set.code = str(pick(body, "code")).trim().toUpperCase();
    if (has(body, "note")) set.note = str(pick(body, "note")) || null;
    if (has(body, "icon")) set.icon = str(pick(body, "icon")) || null;

    if (has(body, "parent_id", "parentId")) {
      const newParentId = str(pick(body, "parent_id", "parentId")).trim() || null;
      if (newParentId === null) {
        // Re-parent to a root (company level).
        set.parentId = null;
        set.level = 0;
      } else {
        // Cycle guard: the new parent must not be the node itself nor a
        // descendant of it (that would detach a loop from the tree).
        const descendants = new Set(subtreeIds(rows, id));
        if (descendants.has(newParentId)) {
          return reply.code(409).send({
            code: "CIRCULAR_PARENT",
            message: "a node cannot be re-parented under itself or a descendant",
          });
        }
        const parent = rows.find((r) => r.id === newParentId);
        if (!parent) {
          return reply.code(400).send({ code: "VALIDATION", message: "parent not found" });
        }
        set.parentId = parent.id;
        set.level = Math.min((parent.level ?? 0) + 1, 2);
      }
    }

    if (Object.keys(set).length === 0) {
      // Nothing to merge — echo the current row (partial-merge no-op).
      return reply.code(200).send(toWire(current));
    }

    const [updated] = await db
      .update(orgUnits, set, eq(orgUnits.id, id))
      .returning();
    if (!updated) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `org unit ${id} not found` });
    }
    return reply.code(200).send(toWire(updated));
  });

  app.delete("/org-units/:id", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };

    // Load the tenant tree to compute the subtree; a scoped select is the only
    // door, so ids from another tenant are simply absent (→ 404).
    const rows = await db.select(orgUnits);
    const target = rows.find((r) => r.id === id);
    if (!target) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `org unit ${id} not found` });
    }

    // Cascade the WHOLE subtree (node + all descendants). The delete is scoped by
    // company_id, so it can only ever touch this tenant's rows.
    const ids = subtreeIds(rows, id);
    await db.delete(orgUnits, inArray(orgUnits.id, ids));

    return reply.code(200).send({ ...toWire(target), deleted_count: ids.length });
  });
}

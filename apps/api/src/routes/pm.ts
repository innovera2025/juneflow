// PM / CMMS handlers — Phase-4 FLOW-C PM Wave-0 (assets, checklist templates,
// work orders, check-in, checklist fill). Sources: pototype/pm.jsx (Asset
// Registry + PMAssetForm), pototype/pm-checklist.jsx (checklist templates +
// picker), pototype/pm3.jsx (Work Orders list/detail, PMWOForm, check-in +
// checklist fill), packages/db/src/schema/pm.ts (tables + PmChecklistRow),
// data-dictionary "PM (CMMS)".
//
// Contract (openapi.yaml /pm …, FROZEN — bodies are the opaque Entity):
//   listPmAssets (GET /pm/assets)                       → EntityList
//   createPmAsset (POST /pm/assets)                      → 201 EntityCreated
//   listPmChecklistTemplates (GET /pm/checklist-templates)  → EntityList
//   createPmChecklistTemplate (POST /pm/checklist-templates) → 201 EntityCreated
//   listPmWorkorders (GET /pm/workorders)                → EntityList
//   createPmWorkorder (POST /pm/workorders)              → 201 EntityCreated
//   checkinPmWorkorder (POST /pm/workorders/{id}/checkin {gps})    → ActionOk
//   updatePmWorkorderChecklist (PUT /pm/workorders/{id}/checklist) → EntityOk
// GATED to Wave-2 (B-108) and intentionally left UNREGISTERED here:
//   /pm/contracts (POST autogen), /pm/workorders/{id}/close, /pm/quotes*.
//
// C10 (PLAN.md §0 rule 4): the wire carries REAL DB columns only. The schema is
// deliberately minimal vs the mock — PMAsset models only {kind,site,cycle,
// next_due} (data-dictionary), so the mock's presentational asset code/name/
// last-PM/status are NOT columns and are not fabricated. ChecklistTemplate models
// only {kind,items[]} — the mock's template `name` has no backing column, so it is
// dropped (flagged, not invented). PMWorkOrder models {asset_id,template_id,tech,
// checkin_gps,items,cause,fix,advice,customer_sign} — the mock's type/site/zone/
// date/sla are derived/presentational and not stored. None of these tables carry
// money, so no currency_code rides the wire.
//
// Tenant scope (CRITICAL): three of the four tables have NO company_id column and
// are PARENT-FK-scoped through project_id → project.company_id (like boq_doc):
//   pm_contract → project                (1 hop)
//   pm_asset    → pm_contract → project  (2 hops)
//   pm_workorder→ pm_asset → pm_contract → project (3 hops)
// so their reads go through TenantDb.selectThrough() and their writes through
// insertThrough()/updateThroughChain(), each anchored on (and re-verifying) the
// company_id-scoped project root — a foreign id resolves to nothing (→ 404) and
// can never be written. checklist_template is the one company-scoped MASTER (it
// carries company_id directly), so it uses the plain select()/insert() doors like
// cost_center's sibling masters. Without a resolved tenant, request.db is absent →
// 401 (same posture as GET /projects & /cost-centers).
//
// AuditLog: every successful mutation is logged by the onResponse middleware
// (plugins/audit-log.ts) — never hand-written here. A failed guard (401/400/404)
// returns >= 400, so the hook does not log it (no false trail).
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  checklistTemplates,
  pmAssets,
  pmContracts,
  pmWorkOrders,
  projects,
} from "@juneflow/db/schema";
import type { PmChecklistRow } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";

type PmAssetRow = typeof pmAssets.$inferSelect;
type ChecklistTemplateRow = typeof checklistTemplates.$inferSelect;
type PmWorkOrderRow = typeof pmWorkOrders.$inferSelect;

/** PmChecklistRow.result enum (schema pm.ts): the three real filled states.
 * The mock's "none" is the not-yet-checked UI state (pm3.jsx RESULT_OPTS) — it is
 * NOT a stored value, so an unchecked row simply omits `result` (honest). */
const CHECKLIST_RESULTS = new Set<PmChecklistRow["result"]>([
  "normal",
  "adjust",
  "repair",
]);

// Scope hop chains anchoring each parent-FK-scoped PM table on the company_id-
// scoped project root (the final hop's parent MUST be a tenant table — project).
const CONTRACT_HOPS = [{ fk: pmContracts.projectId, parent: projects }];
const ASSET_HOPS = [
  { fk: pmAssets.contractId, parent: pmContracts },
  { fk: pmContracts.projectId, parent: projects },
];
const WO_HOPS = [
  { fk: pmWorkOrders.assetId, parent: pmAssets },
  { fk: pmAssets.contractId, parent: pmContracts },
  { fk: pmContracts.projectId, parent: projects },
];

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Does the opaque body explicitly carry any of these keys? */
function has(body: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((k) => Object.prototype.hasOwnProperty.call(body, k));
}

/** First present value among the given opaque field aliases. */
function pick(body: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(body, k)) return body[k];
  }
  return undefined;
}

/**
 * Normalize opaque checklist template items into stored PmChecklistRow[] — the
 * data-dictionary models template items as check LABELS (pm-checklist.jsx items
 * are plain strings). Accepts either bare label strings or {label} objects;
 * empty/blank labels are dropped. Templates store only labels (no result/photos
 * — those are filled per work order, not on the reusable template).
 */
function normalizeTemplateItems(raw: unknown): PmChecklistRow[] {
  if (!Array.isArray(raw)) return [];
  const out: PmChecklistRow[] = [];
  for (const entry of raw) {
    const label =
      typeof entry === "string"
        ? entry.trim()
        : entry && typeof entry === "object"
          ? str((entry as Record<string, unknown>).label).trim()
          : "";
    if (label) out.push({ label });
  }
  return out;
}

/**
 * Merge one filled checklist line from the PUT body onto its snapshot row (by
 * position) — the mock fills `result` + before/after photos against the labels
 * captured at create time (pm3.jsx: labels are fixed, the tech cycles result and
 * attaches photos). label comes from the body when the tech added a fresh line,
 * else from the existing snapshot row at the same index. Only real stored values
 * survive: "none"/absent result and blank photos are omitted (never fabricated).
 */
function mergeChecklistRow(
  raw: unknown,
  existing: PmChecklistRow | undefined,
): PmChecklistRow {
  const it = (raw ?? {}) as Record<string, unknown>;
  const label = str(pick(it, "label")).trim() || existing?.label || "";
  const row: PmChecklistRow = { label };
  const result = str(pick(it, "result")).trim() as PmChecklistRow["result"];
  if (CHECKLIST_RESULTS.has(result)) row.result = result;
  const before = str(pick(it, "before")).trim();
  if (before) row.before = before;
  const after = str(pick(it, "after")).trim();
  if (after) row.after = after;
  return row;
}

/** The opaque Entity wire shape for one PM asset (real pm_asset columns only). */
function assetWire(a: PmAssetRow): Record<string, unknown> {
  return {
    id: a.id,
    contract_id: a.contractId,
    kind: a.kind,
    site: a.site,
    cycle: a.cycle,
    next_due: a.nextDue,
  };
}

/** The opaque Entity wire shape for one checklist template (real columns only). */
function templateWire(t: ChecklistTemplateRow): Record<string, unknown> {
  return {
    id: t.id,
    kind: t.kind,
    items: t.items,
  };
}

/** The opaque Entity wire shape for one PM work order (real columns only). */
function workOrderWire(w: PmWorkOrderRow): Record<string, unknown> {
  return {
    id: w.id,
    asset_id: w.assetId,
    template_id: w.templateId,
    tech: w.tech,
    checkin_gps: w.checkinGps,
    items: w.items,
    cause: w.cause,
    fix: w.fix,
    advice: w.advice,
    customer_sign: w.customerSign,
  };
}

/** Register the PM routes on the given (already /api/v1-prefixed) scope. */
export function registerPmRoute(app: FastifyInstance): void {
  // GET /pm/assets — the tenant's maintained assets (pm.jsx PMAssets). pm_asset
  // has no company_id → scope it through pm_contract → project.
  app.get("/pm/assets", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }
    // filter/page accepted per the contract but not interpreted (their semantics
    // are undefined — inventing filter behavior would violate PLAN.md §0 rule 4);
    // the full tenant-scoped list is returned as one page (like cost-centers.ts).
    const rows = await db.selectThrough(pmAssets, ASSET_HOPS);
    return reply.code(200).send(listEnvelope(rows.map(assetWire)));
  });

  // POST /pm/assets — register an asset under a PM contract (pm.jsx PMAssetForm).
  // The body carries contract_id; the asset scope is anchored on the contract's
  // (tenant-owned) project via insertThrough (fail-closed).
  app.post("/pm/assets", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const contractId = str(pick(body, "contract_id", "contractId")).trim();
    const kind = str(pick(body, "kind")).trim();
    const site = has(body, "site") ? str(pick(body, "site")).trim() || null : null;
    const cycle = has(body, "cycle") ? str(pick(body, "cycle")).trim() || null : null;
    const nextDue = has(body, "next_due", "nextDue")
      ? str(pick(body, "next_due", "nextDue")).trim() || null
      : null;

    if (!contractId) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "contract_id is required" });
    }
    if (!kind) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "kind is required" });
    }

    // Resolve the parent contract THROUGH its project root (scoped read) — a
    // foreign/absent contract id resolves to nothing → 404, so nothing leaks and
    // the asset can never be anchored under another tenant's contract.
    const [contract] = await db.selectThrough(
      pmContracts,
      CONTRACT_HOPS,
      eq(pmContracts.id, contractId),
    );
    if (!contract) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `PM contract ${contractId} not found` });
    }

    // insertThrough re-verifies tenant ownership of the anchoring project before
    // writing (fail-closed) — the asset can never land under a foreign project.
    const [created] = await db.insertThrough(pmAssets, projects, contract.projectId, [
      { contractId, kind, site, cycle, nextDue },
    ]);
    return reply.code(201).send(assetWire(created!));
  });

  // GET /pm/checklist-templates — the tenant's checklist templates
  // (pm-checklist.jsx ChecklistManager). checklist_template carries company_id
  // directly → the plain company-scoped select door.
  app.get("/pm/checklist-templates", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }
    const rows = await db.select(checklistTemplates);
    return reply.code(200).send(listEnvelope(rows.map(templateWire)));
  });

  // POST /pm/checklist-templates — create a reusable checklist set
  // (pm-checklist.jsx ChecklistEditor). company-scoped write (insert force-sets
  // company_id). kind defaults to "ทั่วไป" exactly like the mock's
  // `kind.trim() || "ทั่วไป"`; at least one non-blank item is required (the mock
  // rejects an empty set). The mock's template `name` has no backing column
  // (data-dictionary ChecklistTemplate = kind + items[] only) — dropped, not
  // invented (flagged schema gap for a later wave).
  app.post("/pm/checklist-templates", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const kind = str(pick(body, "kind")).trim() || "ทั่วไป";
    const items = normalizeTemplateItems(pick(body, "items"));
    if (items.length === 0) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "at least one checklist item is required" });
    }

    const [created] = await db
      .insert(checklistTemplates, { kind, items })
      .returning();
    return reply.code(201).send(templateWire(created!));
  });

  // GET /pm/workorders — the tenant's work orders (pm3.jsx PMWorkOrders).
  // pm_workorder has no company_id → scope it 3 hops to the project root.
  app.get("/pm/workorders", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }
    const rows = await db.selectThrough(pmWorkOrders, WO_HOPS);
    return reply.code(200).send(listEnvelope(rows.map(workOrderWire)));
  });

  // POST /pm/workorders — open a work order on an asset (pm3.jsx PMWOForm). The
  // body carries asset_id (required) + an optional template_id + tech. The WO's
  // checklist items are a REAL SNAPSHOT of the chosen template's items at create
  // time: the labels are copied into the WO's own items column, so later
  // checklist edits (PUT) never mutate the reusable template. With no template_id,
  // items = [] (honest — the mock starts an `open` WO with an empty checklist and
  // the tech picks a set afterwards).
  app.post("/pm/workorders", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const assetId = str(pick(body, "asset_id", "assetId")).trim();
    const templateId = str(pick(body, "template_id", "templateId")).trim();
    const tech = has(body, "tech") ? str(pick(body, "tech")).trim() || null : null;

    if (!assetId) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "asset_id is required" });
    }

    // Resolve the asset THROUGH its hop chain to the project root (scoped read) —
    // a foreign/absent asset id resolves to nothing → 404.
    const [asset] = await db.selectThrough(
      pmAssets,
      ASSET_HOPS,
      eq(pmAssets.id, assetId),
    );
    if (!asset) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `PM asset ${assetId} not found` });
    }
    // The asset's owning contract carries the anchoring project (scoped read).
    const [contract] = await db.selectThrough(
      pmContracts,
      CONTRACT_HOPS,
      eq(pmContracts.id, asset.contractId),
    );
    if (!contract) {
      return reply.code(404).send({
        code: "NOT_FOUND",
        message: `PM contract ${asset.contractId} not found`,
      });
    }

    // Snapshot the chosen template's items (company-scoped read — a foreign/absent
    // template id resolves to nothing → 404). Copy each row so the WO's checklist
    // is independent of the template row (a true snapshot). No template → items [].
    let items: PmChecklistRow[] = [];
    if (templateId) {
      const [template] = await db.select(
        checklistTemplates,
        eq(checklistTemplates.id, templateId),
      );
      if (!template) {
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: `checklist template ${templateId} not found`,
        });
      }
      items = (template.items ?? []).map((row) => ({ ...row }));
    }

    // insertThrough re-verifies tenant ownership of the anchoring project before
    // writing (fail-closed). template_id is stored so the WO records which set it
    // was seeded from; items is the snapshot (independent of that template).
    const [created] = await db.insertThrough(
      pmWorkOrders,
      projects,
      contract.projectId,
      [{ assetId, templateId: templateId || null, tech, items }],
    );
    return reply.code(201).send(workOrderWire(created!));
  });

  // POST /pm/workorders/:id/checkin — the tech checks in on site with a GPS fix
  // (pm3.jsx "Check-in หน้างาน"). Resolves the WO through its full 3-hop chain
  // (404 for a foreign id), then records checkin_gps. Returns the updated WO.
  app.post("/pm/workorders/:id/checkin", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const gps = str(pick(body, "gps")).trim();
    if (!gps) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "gps is required" });
    }

    // updateThroughChain resolves the WO's ownership THROUGH the hop chain
    // (company_id anchored on the project root) and updates strictly the resolved
    // id — a foreign id resolves to nothing and returns [] → 404 (never written).
    const [updated] = await db.updateThroughChain(
      pmWorkOrders,
      WO_HOPS,
      { checkinGps: gps },
      eq(pmWorkOrders.id, id),
    );
    if (!updated) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `PM work order ${id} not found` });
    }
    return reply.code(200).send(workOrderWire(updated));
  });

  // PUT /pm/workorders/:id/checklist — fill in the checklist results + photos
  // (pm3.jsx checklist: cycle result normal/adjust/repair, attach before/after).
  // The body's items[] are merged POSITIONALLY onto the WO's snapshot rows so the
  // labels captured at create time are preserved (the tech fills, does not
  // rename). Resolves the WO through its full 3-hop chain first (404 for a foreign
  // id). Returns the updated WO.
  app.put("/pm/workorders/:id/checklist", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as Record<string, unknown>;
    const rawItems = pick(body, "items");
    if (!Array.isArray(rawItems)) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "items[] is required" });
    }

    // Resolve the WO through its hop chain (404 for a foreign id) so the snapshot
    // labels are available for the positional merge.
    const [wo] = await db.selectThrough(
      pmWorkOrders,
      WO_HOPS,
      eq(pmWorkOrders.id, id),
    );
    if (!wo) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `PM work order ${id} not found` });
    }

    const existing = wo.items ?? [];
    const items = rawItems.map((raw, i) => mergeChecklistRow(raw, existing[i]));

    const [updated] = await db.updateThroughChain(
      pmWorkOrders,
      WO_HOPS,
      { items },
      eq(pmWorkOrders.id, id),
    );
    // updated is present: the same scoped `where` just resolved `wo` above.
    return reply.code(200).send(workOrderWire(updated!));
  });
}

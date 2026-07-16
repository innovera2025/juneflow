// BOQ handlers — list/create/detail, item add/list, and the submit→approve→
// revise state machine (P2-BE-02, B-070; pototype/boq.jsx BOQEditor + boq-list.jsx
// BOQList, docs/handoff/flows.html FLOW-A + MATRIX row "BOQ / Revise",
// data-dictionary "BOQDoc.status draft | pending | approved(ล็อก) | revise").
//
// Contract (openapi.yaml /boq …): listBoq → EntityList; createBoq → 201
// EntityCreated; listBoqItems (GET /boq/{id}/items?group) → EntityList;
// addBoqItems (POST /boq/{id}/items) → 201 EntityCreated; submitBoq/approveBoq/
// reviseBoq (POST /boq/{id}/{submit|approve|revise}) → ActionOk. Every body is
// the opaque Entity (additionalProperties) — wire fields below are REAL DB
// columns + derived aggregates only (C10: totals from a real query, never the
// mock's hardcoded 12.4M; no invented columns — PLAN.md §0 rule 4).
//
// GAP flagged to Wei (do NOT change the contract from this task): GET /boq/{id}
// (single-doc detail with per-group CBS) is implemented because the editor needs
// it, but the contract declares no such operation yet — the generated FE client
// will not include it until the contract adds it. Likewise the action endpoints
// declare only 200/401/404, so the 409 (invalid state transition) and 403
// (insufficient approval authority) this handler must return are undocumented
// statuses — both still use the flat Error envelope {code,message}.
//
// Tenant scope: the whole BOQ tree is scoped through project_id on the doc
// (boq.ts schema header: "Company scope flows through project_id on documents").
// boq_doc / boq_group / boq_item / cbs_budget carry NO company_id of their own,
// so reads go through the scoped selectThrough() door anchored on the
// company_id-scoped project root, doc creation + item bulk-add go through
// insertThrough() (re-verifies project ownership, fail-closed), and the state
// machine mutates boq_doc through updateThrough() (the update counterpart added
// with this task). A foreign tenant's id resolves to nothing (→ 404) and can
// never be written. Without a resolved tenant, request.db is absent → 401.
//
// State machine (data-dictionary + flows.html FLOW-A "BOQ อนุมัติ (ล็อก)"):
//   draft|revise --submit--> pending --approve--> approved (LOCKED)
//   approved --revise--> revise (version += 1, editable again)
// approved is immutable: item add is rejected until a Revise spins v+1.
//
// Approval authority (flows.html MATRIX row "BOQ / Revise"): submit by the
// estimator (ผู้ประมาณราคา), then ผจก.โครงการ, then MD — MD approves EVERY
// revise — with NO baht threshold (thresholds are a PR/PO concern, never BOQ).
// The single durable `approve` here is the terminal lock, so it requires the
// caller's role.approvalLevel to reach the MD tier (level 4 in packages/db seed
// ROLE_DEFS — only role `dir`/Director carries boq.approve). The intermediate
// ผจก.โครงการ step cannot be persisted per-doc: boq_doc has no approval_step
// column (only `pr` does) — flagged as a schema gap, NOT worked around here.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import {
  boqDocs,
  boqGroups,
  boqItems,
  cbsBudgets,
  projects,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";
import { loadRole, loadUserByEmail } from "./profile-data.js";

type BoqDocRow = typeof boqDocs.$inferSelect;
type BoqItemRow = typeof boqItems.$inferSelect;
type CbsRow = typeof cbsBudgets.$inferSelect;

/** boq_item_cat enum values (boq.ts): M material · L labor · S lump-sum. */
const BOQ_ITEM_CATS = new Set(["M", "L", "S"]);

/**
 * Minimum role.approvalLevel to APPROVE (lock) a BOQ — the MD tier. flows.html
 * MATRIX row "BOQ / Revise" col 3 = "MD (ทุก revise)": MD must approve every BOQ
 * and every revise, with no baht threshold. MD = the top approval tier
 * (approvalLevel 4, seed role `dir`, the only role granted boq.approve).
 */
const BOQ_APPROVAL_MIN_LEVEL = 4;

// Scope hop chains anchoring each parent-FK-scoped BOQ table on the company_id-
// scoped project root (the final hop's parent MUST be a tenant table — project).
const DOC_HOPS = [{ fk: boqDocs.projectId, parent: projects }];
const GROUP_HOPS = [
  { fk: boqGroups.boqId, parent: boqDocs },
  { fk: boqDocs.projectId, parent: projects },
];
const ITEM_HOPS = [
  { fk: boqItems.groupId, parent: boqGroups },
  { fk: boqGroups.boqId, parent: boqDocs },
  { fk: boqDocs.projectId, parent: projects },
];
const CBS_HOPS = [
  { fk: cbsBudgets.groupId, parent: boqGroups },
  { fk: boqGroups.boqId, parent: boqDocs },
  { fk: boqDocs.projectId, parent: projects },
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

/** Parse a non-negative number (number | numeric string) from opaque JSON, else null. */
function toNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Line amount for a BOQ item = qty × unit price (BOQ total is the Σ of these). */
function itemAmount(it: BoqItemRow): number {
  return Number(it.qty) * Number(it.price);
}

/**
 * The opaque Entity wire shape for a BOQ doc: real boq_doc columns + the derived
 * `total` (Σ qty×price over its items — C10, from a real query) and the currency
 * those items are priced in. The mock's presentational value/owner/updated/"v3"
 * strings are NOT stored, so they are not returned.
 */
function docWire(
  doc: BoqDocRow,
  total: number,
  currency: string,
): Record<string, unknown> {
  return {
    id: doc.id,
    no: doc.no,
    name: doc.name,
    scope: doc.scope,
    project_id: doc.projectId,
    version: doc.version,
    status: doc.status,
    currency_code: currency,
    total,
  };
}

/** The opaque Entity wire shape for one BOQ item (real boq_item columns only). */
function itemWire(it: BoqItemRow): Record<string, unknown> {
  return {
    id: it.id,
    group_id: it.groupId,
    code: it.code,
    name: it.name,
    cat: it.cat,
    qty: Number(it.qty),
    unit: it.unit,
    price: Number(it.price),
    currency_code: it.currencyCode,
    cc_id: it.ccId,
    remain_qty: Number(it.remainQty),
    element_id: it.elementId,
  };
}

/**
 * Per-group CBS budget control: real cbs_budget columns + the derived
 * `available` = budget − used − committed (C10; may go negative when a group is
 * over budget — the editor shows that as a warning, boq.jsx BudgetControlBar).
 */
function cbsWire(c: CbsRow): Record<string, unknown> {
  const budget = Number(c.budget);
  const used = Number(c.used);
  const committed = Number(c.committed);
  return {
    budget,
    used,
    committed,
    available: budget - used - committed,
    currency_code: c.currencyCode,
  };
}

/** Sum a doc's items into (total, currency) — currency = its items' currency. */
function docTotal(items: BoqItemRow[]): { total: number; currency: string } {
  const total = items.reduce((sum, it) => sum + itemAmount(it), 0);
  return { total, currency: items[0]?.currencyCode ?? "THB" };
}

/** Re-read a doc's items to build its wire shape with a fresh derived total. */
async function docWireWithTotal(
  db: TenantDb,
  doc: BoqDocRow,
): Promise<Record<string, unknown>> {
  const items = await db.selectThrough(boqItems, ITEM_HOPS, eq(boqDocs.id, doc.id));
  const { total, currency } = docTotal(items);
  return docWire(doc, total, currency);
}

/**
 * The caller's role.approvalLevel, or null when it cannot be attributed (no
 * session user / no dictionary row / no role). Resolved the same way as GET /me
 * (authUser.email → tenant user row → role), so it is tenant-scoped throughout.
 */
async function callerApprovalLevel(
  request: FastifyRequest,
): Promise<number | null> {
  const db = request.db;
  const authUser = request.authUser;
  if (!db || !authUser) return null;
  const user = await loadUserByEmail(db, authUser.email);
  if (!user) return null;
  const role = await loadRole(db, user.roleId);
  return role?.approvalLevel ?? null;
}

/** Register the BOQ routes on the given (already /api/v1-prefixed) scope. */
export function registerBoqRoute(app: FastifyInstance): void {
  // GET /boq — the tenant's BOQ docs (boq-list.jsx BOQList). Each doc's `total`
  // is the Σ of its items (real query, never the mock's hardcoded value).
  app.get("/boq", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const [docs, groups, items] = await Promise.all([
      db.selectThrough(boqDocs, DOC_HOPS),
      db.selectThrough(boqGroups, GROUP_HOPS),
      db.selectThrough(boqItems, ITEM_HOPS),
    ]);

    // item → group → doc, so each item's amount lands on its owning doc.
    const docIdByGroup = new Map(groups.map((g) => [g.id, g.boqId]));
    const totalByDoc = new Map<string, number>();
    const currencyByDoc = new Map<string, string>();
    for (const it of items) {
      const docId = docIdByGroup.get(it.groupId);
      if (!docId) continue;
      totalByDoc.set(docId, (totalByDoc.get(docId) ?? 0) + itemAmount(it));
      if (!currencyByDoc.has(docId)) currencyByDoc.set(docId, it.currencyCode);
    }

    return reply.code(200).send(
      listEnvelope(
        docs.map((d) =>
          docWire(d, totalByDoc.get(d.id) ?? 0, currencyByDoc.get(d.id) ?? "THB"),
        ),
      ),
    );
  });

  // POST /boq — create a BOQ doc (boq-list.jsx NewBOQForm). Server owns
  // status (always starts `draft`) + version (1). The scope is anchored on the
  // tenant-owned project via insertThrough (fail-closed).
  app.post("/boq", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const no = str(pick(body, "no")).trim();
    const name = str(pick(body, "name")).trim();
    const scope = has(body, "scope") ? str(pick(body, "scope")).trim() || null : null;
    const projectId = str(pick(body, "project_id", "projectId")).trim();

    if (!no) {
      return reply.code(400).send({ code: "VALIDATION", message: "no is required" });
    }
    if (!name) {
      return reply.code(400).send({ code: "VALIDATION", message: "name is required" });
    }
    if (!projectId) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "project_id is required" });
    }

    // The target project must belong to this tenant (scoped select — a foreign
    // id resolves to nothing, so nothing about it leaks).
    const [project] = await db.select(projects, eq(projects.id, projectId));
    if (!project) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "project not found" });
    }

    // Duplicate `no` across the tenant's docs (NewBOQForm "รหัสนี้มีอยู่แล้ว").
    const existing = await db.selectThrough(boqDocs, DOC_HOPS);
    if (existing.some((d) => d.no === no)) {
      return reply.code(409).send({
        code: "DUPLICATE_CODE",
        message: `BOQ no ${no} already exists`,
      });
    }

    const [created] = await db.insertThrough(boqDocs, projects, projectId, [
      { projectId, no, name, scope, version: 1, status: "draft" },
    ]);

    // A brand-new doc has no items yet → total 0.
    return reply.code(201).send(docWire(created!, 0, "THB"));
  });

  // GET /boq/:id — single-doc detail with per-group CBS budget control (the
  // editor's BudgetControlBar). NOT a contract operation yet (see header GAP).
  app.get("/boq/:id", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [doc] = await db.selectThrough(boqDocs, DOC_HOPS, eq(boqDocs.id, id));
    if (!doc) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `BOQ ${id} not found` });
    }

    const [groups, items, cbs] = await Promise.all([
      db.selectThrough(boqGroups, GROUP_HOPS, eq(boqGroups.boqId, id)),
      db.selectThrough(boqItems, ITEM_HOPS, eq(boqDocs.id, id)),
      db.selectThrough(cbsBudgets, CBS_HOPS, eq(boqDocs.id, id)),
    ]);

    const { total, currency } = docTotal(items);
    const cbsByGroup = new Map(cbs.map((c) => [c.groupId, c]));
    const wireGroups = [...groups]
      .sort((a, b) => a.seq - b.seq)
      .map((g) => {
        const c = cbsByGroup.get(g.id);
        return { id: g.id, name: g.name, seq: g.seq, cbs: c ? cbsWire(c) : null };
      });

    return reply
      .code(200)
      .send({ ...docWire(doc, total, currency), groups: wireGroups });
  });

  // GET /boq/:id/items?group= — the doc's priced lines, optionally narrowed to
  // one group (the editor's active-group table). ?group is a boq_group id.
  app.get("/boq/:id/items", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [doc] = await db.selectThrough(boqDocs, DOC_HOPS, eq(boqDocs.id, id));
    if (!doc) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `BOQ ${id} not found` });
    }

    const group = str((request.query as Record<string, unknown>)?.group).trim();
    const where = group
      ? and(eq(boqDocs.id, id), eq(boqItems.groupId, group))
      : eq(boqDocs.id, id);
    const items = await db.selectThrough(boqItems, ITEM_HOPS, where);

    return reply.code(200).send(listEnvelope(items.map(itemWire)));
  });

  // POST /boq/:id/items — bulk add priced lines (from BOM / Excel / AI QTO).
  // Body is an items[] array (or {items:[…]}). Each line targets a group of this
  // doc. Rejected once the doc is approved/locked (immutable until a Revise).
  app.post("/boq/:id/items", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [doc] = await db.selectThrough(boqDocs, DOC_HOPS, eq(boqDocs.id, id));
    if (!doc) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `BOQ ${id} not found` });
    }
    // Immutable after approve — the whole point of the lock (flows.html: "BOQ ที่
    // อนุมัติแล้วแก้ไม่ได้ ต้องเปิด Revise").
    if (doc.status === "approved") {
      return reply.code(409).send({
        code: "BOQ_LOCKED",
        message: "approved BOQ is locked — create a Revise to edit",
      });
    }

    const body = request.body ?? {};
    const rawItems = Array.isArray(body)
      ? body
      : Array.isArray((body as Record<string, unknown>).items)
        ? ((body as Record<string, unknown>).items as unknown[])
        : [];
    if (rawItems.length === 0) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "items[] is required" });
    }

    // The doc's own groups — every added line must target one of them.
    const groups = await db.selectThrough(
      boqGroups,
      GROUP_HOPS,
      eq(boqGroups.boqId, id),
    );
    const validGroupIds = new Set(groups.map((g) => g.id));

    const rows: (typeof boqItems.$inferInsert)[] = [];
    for (const raw of rawItems) {
      const it = (raw ?? {}) as Record<string, unknown>;
      const groupId = str(pick(it, "group_id", "groupId")).trim();
      const code = str(pick(it, "code")).trim();
      const name = str(pick(it, "name")).trim();
      const cat = str(pick(it, "cat")).trim().toUpperCase();
      const qty = toNum(pick(it, "qty"));
      const price = toNum(pick(it, "price"));
      const unit = has(it, "unit") ? str(pick(it, "unit")).trim() || null : null;
      const currencyCode =
        str(pick(it, "currency_code", "currencyCode")).trim() || "THB";

      if (!validGroupIds.has(groupId)) {
        return reply.code(400).send({
          code: "VALIDATION",
          message: "group_id must be a group of this BOQ",
        });
      }
      if (!code) {
        return reply
          .code(400)
          .send({ code: "VALIDATION", message: "item code is required" });
      }
      if (!name) {
        return reply
          .code(400)
          .send({ code: "VALIDATION", message: "item name is required" });
      }
      if (!BOQ_ITEM_CATS.has(cat)) {
        return reply
          .code(400)
          .send({ code: "VALIDATION", message: "cat must be one of M, L, S" });
      }
      if (qty == null || qty < 0) {
        return reply
          .code(400)
          .send({ code: "VALIDATION", message: "qty must be a number >= 0" });
      }
      if (price == null || price < 0) {
        return reply
          .code(400)
          .send({ code: "VALIDATION", message: "price must be a number >= 0" });
      }

      rows.push({
        groupId,
        code,
        name,
        cat: cat as "M" | "L" | "S",
        qty: String(qty),
        unit,
        price: price.toFixed(2),
        currencyCode,
        // A freshly added line has nothing consumed yet → remain = qty
        // (data-dictionary "remain_qty ตัดเมื่อเปิด PR").
        remainQty: String(qty),
      });
    }

    // The whole BOQ tree is tenant-scoped through the project; every target group
    // was proven to belong to THIS doc above, so anchoring the scoped insert on
    // the doc's (tenant-owned) project keeps the write fail-closed.
    const created = await db.insertThrough(boqItems, projects, doc.projectId, rows);

    // Echo the created lines + the doc's refreshed total.
    const wireItems = created.map(itemWire);
    const total = (await db.selectThrough(boqItems, ITEM_HOPS, eq(boqDocs.id, id)))
      .reduce((sum, it) => sum + itemAmount(it), 0);
    return reply.code(201).send({
      ...docWire(doc, total, created[0]?.currencyCode ?? "THB"),
      items: wireItems,
    });
  });

  // POST /boq/:id/submit — draft|revise → pending (estimator sends to approval).
  app.post("/boq/:id/submit", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [doc] = await db.selectThrough(boqDocs, DOC_HOPS, eq(boqDocs.id, id));
    if (!doc) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `BOQ ${id} not found` });
    }
    if (doc.status !== "draft" && doc.status !== "revise") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a draft or revise BOQ can be submitted",
      });
    }

    const [updated] = await db.updateThrough(
      boqDocs,
      projects,
      boqDocs.projectId,
      doc.projectId,
      { status: "pending" },
      eq(boqDocs.id, id),
    );
    return reply.code(200).send(await docWireWithTotal(db, updated!));
  });

  // POST /boq/:id/approve — pending → approved (LOCK). Requires MD-tier authority
  // (flows.html MATRIX "BOQ / Revise" → MD, every revise; NO baht threshold).
  app.post("/boq/:id/approve", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [doc] = await db.selectThrough(boqDocs, DOC_HOPS, eq(boqDocs.id, id));
    if (!doc) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `BOQ ${id} not found` });
    }

    // Terminal BOQ/revise approval is MD's (approvalLevel >= 4). A lower tier
    // (or an unattributable caller) cannot lock the BOQ.
    const level = await callerApprovalLevel(request);
    if (level == null || level < BOQ_APPROVAL_MIN_LEVEL) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: `BOQ approval requires MD authority (approval level ${BOQ_APPROVAL_MIN_LEVEL})`,
      });
    }
    if (doc.status !== "pending") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a pending BOQ can be approved",
      });
    }

    const [updated] = await db.updateThrough(
      boqDocs,
      projects,
      boqDocs.projectId,
      doc.projectId,
      { status: "approved" },
      eq(boqDocs.id, id),
    );
    return reply.code(200).send(await docWireWithTotal(db, updated!));
  });

  // POST /boq/:id/revise — approved → revise, version += 1 (a new editable
  // version of the whole doc; data-dictionary "Revise = เวอร์ชันใหม่ทั้ง doc").
  app.post("/boq/:id/revise", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [doc] = await db.selectThrough(boqDocs, DOC_HOPS, eq(boqDocs.id, id));
    if (!doc) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `BOQ ${id} not found` });
    }
    if (doc.status !== "approved") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only an approved BOQ can be revised",
      });
    }

    const [updated] = await db.updateThrough(
      boqDocs,
      projects,
      boqDocs.projectId,
      doc.projectId,
      { status: "revise", version: doc.version + 1 },
      eq(boqDocs.id, id),
    );
    return reply.code(200).send(await docWireWithTotal(db, updated!));
  });
}

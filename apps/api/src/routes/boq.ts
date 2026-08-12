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
import { and, eq, inArray } from "drizzle-orm";
import {
  boqDocs,
  boqVersionHistory,
  boqGroups,
  boqItems,
  cbsBudgets,
  projects,
  prItems,
  prs,
  users,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";
import { byIdAsc, entryOrder, newestFirst, stampEntryOrder } from "./list-order.js";
import { round2 } from "./money.js";
import { loadRole, loadUserByEmail } from "./profile-data.js";
import { loadCaller, permAllowed } from "./authz.js";

type BoqDocRow = typeof boqDocs.$inferSelect;
type BoqItemRow = typeof boqItems.$inferSelect;
type CbsRow = typeof cbsBudgets.$inferSelect;
type VersionHistoryRow = typeof boqVersionHistory.$inferSelect;

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
// boq_version_history → boq_doc → project (B-081 / F4): the Revise/approve log.
const VH_HOPS = [
  { fk: boqVersionHistory.docId, parent: boqDocs },
  { fk: boqDocs.projectId, parent: projects },
];
// PR is scoped through its own project (the whole PR tree, like the BOQ tree,
// carries no company_id column — pr.ts PR_HOPS).
const PR_HOPS = [{ fk: prs.projectId, parent: projects }];

/**
 * generate-PR category split (boq-extra.jsx BOQtoPRForm): Material items (cat M)
 * → a supplier "PR ปกติ" (pr_type material); Subcon/Labor items (cat S or L) →
 * a "PR-Subcon" (pr_type subcon). Mirrors matRows = cat M · subRows = cat S|L,
 * and the prototype's auto-split into two PRs when both kinds are selected.
 */
const PR_BUCKETS = [
  { cats: new Set(["M"]), type: "material" as const, prefix: "PR" },
  { cats: new Set(["S", "L"]), type: "subcon" as const, prefix: "PR-S" },
];

/**
 * B-149 optimistic-lock miss: a guarded status flip matched 0 rows because a
 * concurrent submit/approve/revise already moved the BOQ out of its expected
 * pre-state. Thrown inside the approve/revise transaction so the status flip and
 * its version-history row roll back together → mapped to 409.
 */
class StaleStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleStateError";
  }
}

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
 * Next running PR no for a prefix within the tenant: the max numeric tail among
 * the tenant's existing PR nos of that prefix/year, + 1, zero-padded (e.g.
 * PR-2026-0007 · PR-S-2026-0003). Derived from REAL existing nos (never the
 * mock's hardcoded PR-2026-0419), so repeated partial generations from the same
 * BOQ never collide. NOTE (gap): a full running-number service (reset rules,
 * dept/warehouse locking) is deferred to the Phase-2 numbering service —
 * doc-numbering.ts is read-only today; this is the stopgap issuer.
 */
function nextPrNo(existingNos: string[], prefix: string, year: number): string {
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  let max = 0;
  for (const no of existingNos) {
    const m = re.exec(no);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${year}-${String(max + 1).padStart(4, "0")}`;
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
  approverName: string | null = null,
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
    // Σ(qty × price) over the doc's items is a JS-float product-sum → round to
    // the 2-dp minor unit at the wire so accumulation drift never surfaces to the
    // BOQ list/detail (B-085 fix 3).
    total: round2(total),
    // B-081 (F4, migration 0021): the archive approver + approval timestamp. id +
    // timestamp are real columns; the display name is resolved for list/detail.
    approved_by: doc.approvedBy,
    approved_by_name: approverName,
    approved_at: doc.approvedAt,
  };
}

/**
 * The opaque Entity wire shape for one BOQ item: real boq_item columns incl.
 * `detail` (the editor's per-line note — migration 0023, gap-5).
 */
function itemWire(it: BoqItemRow): Record<string, unknown> {
  return {
    id: it.id,
    group_id: it.groupId,
    code: it.code,
    name: it.name,
    detail: it.detail,
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
 * The opaque Entity wire shape for one version-history row (B-081 / F4): the
 * archive's Revise/approve log. `by` is the real actor id; `by_name` is the
 * resolved display name (null when the actor is a system entry or unresolvable).
 */
function versionHistoryWire(
  v: VersionHistoryRow,
  byName: string | null,
): Record<string, unknown> {
  return {
    id: v.id,
    version: v.version,
    action: v.action,
    by: v.by,
    by_name: byName,
    at: v.at,
    delta: v.delta,
    note: v.note,
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
    // budget − used − committed is a JS-float difference → round to the 2-dp
    // minor unit at the wire so subtraction drift never surfaces (B-085 fix 3).
    available: round2(budget - used - committed),
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
  approverName: string | null = null,
): Promise<Record<string, unknown>> {
  const items = await db.selectThrough(boqItems, ITEM_HOPS, eq(boqDocs.id, doc.id));
  const { total, currency } = docTotal(items);
  return docWire(doc, total, currency, approverName);
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

    const [docs, groups, items, userRows] = await Promise.all([
      db.selectThrough(boqDocs, DOC_HOPS),
      db.selectThrough(boqGroups, GROUP_HOPS),
      db.selectThrough(boqItems, ITEM_HOPS),
      // user carries its own company_id (scoped select) — resolve the archive
      // approver display name (B-081 / F4).
      db.select(users),
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
    const userNameById = new Map(userRows.map((u) => [u.id, u.name]));

    // B-323: `docs` is a selectThrough (INNER JOIN, no ORDER BY) — total-order it.
    return reply.code(200).send(
      listEnvelope(
        newestFirst(docs).map((d) =>
          docWire(
            d,
            totalByDoc.get(d.id) ?? 0,
            currencyByDoc.get(d.id) ?? "THB",
            d.approvedBy ? userNameById.get(d.approvedBy) ?? null : null,
          ),
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

    const [groups, items, cbs, history, userRows] = await Promise.all([
      db.selectThrough(boqGroups, GROUP_HOPS, eq(boqGroups.boqId, id)),
      db.selectThrough(boqItems, ITEM_HOPS, eq(boqDocs.id, id)),
      db.selectThrough(cbsBudgets, CBS_HOPS, eq(boqDocs.id, id)),
      // B-081 (F4): the doc's Revise/approve history so the archive expander +
      // version-diff render from real rows (newest version first).
      db.selectThrough(boqVersionHistory, VH_HOPS, eq(boqVersionHistory.docId, id)),
      db.select(users),
    ]);

    const { total, currency } = docTotal(items);
    const cbsByGroup = new Map(cbs.map((c) => [c.groupId, c]));
    const wireGroups = [...groups]
      // B-323: boq_group.seq carries no unique constraint (a Revise can duplicate one),
      // and it is `integer NOT NULL DEFAULT 0` (packages/db/src/schema/boq.ts) — never
      // null, but groups added without an explicit seq all tie at 0. Both cases reach
      // the id floor, which is what actually decides them.
      .sort((a, b) => a.seq - b.seq || byIdAsc(a, b))
      .map((g) => {
        const c = cbsByGroup.get(g.id);
        return { id: g.id, name: g.name, seq: g.seq, cbs: c ? cbsWire(c) : null };
      });
    const userNameById = new Map(userRows.map((u) => [u.id, u.name]));
    const wireHistory = [...history]
      // B-323: two history rows can share a version (the same revision recorded twice).
      .sort((a, b) => b.version - a.version || byIdAsc(a, b))
      .map((v) =>
        versionHistoryWire(v, v.by ? userNameById.get(v.by) ?? null : null),
      );

    return reply.code(200).send({
      ...docWire(
        doc,
        total,
        currency,
        doc.approvedBy ? userNameById.get(doc.approvedBy) ?? null : null,
      ),
      groups: wireGroups,
      version_history: wireHistory,
    });
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

    // B-323: these are a DOCUMENT'S LINES, not a document list — the editor renders
    // them as the ordered body of one BOQ. entryOrder (created_at ASC), never
    // newestFirst, which would print the priced lines bottom-to-top. boq_item has no
    // `seq`, so entry order lives only in what the writer records — and BOTH writers
    // of this table stamp the batch apart (stampEntryOrder): POST /boq/:id/items
    // (boq.ts) and POST /ai-qto/create-boq (ai-qto.ts). A reader ordered ASC over an
    // unstamped batch is not ordered at all: one insert = one now() = every line tied
    // = the uuid tiebreak decides. Both halves or neither.
    return reply.code(200).send(listEnvelope(entryOrder(items).map(itemWire)));
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
    //
    // B-323: stampEntryOrder is the WRITE half of the entryOrder read at GET
    // /boq/:id/items. insertThrough is ONE `.insert().values(rows)` — one statement,
    // one `now()` — so a bulk add (from BOM / Excel / AI QTO) would give every line of
    // the batch the SAME created_at, the ASC comparator would fall through to the
    // `defaultRandom()` uuid, and the priced body of the BOQ would render in uuid
    // order. boq_item has no `seq`, so entry order lives ONLY in what this write
    // records. The 1 ms spacing moves no rendered date (timestamptz keeps µs).
    const created = await db.insertThrough(
      boqItems,
      projects,
      doc.projectId,
      stampEntryOrder(rows),
    );

    // Echo the created lines + the doc's refreshed total.
    const wireItems = created.map(itemWire);
    const total = (await db.selectThrough(boqItems, ITEM_HOPS, eq(boqDocs.id, id)))
      .reduce((sum, it) => sum + itemAmount(it), 0);
    return reply.code(201).send({
      ...docWire(doc, total, created[0]?.currencyCode ?? "THB"),
      items: wireItems,
    });
  });

  // POST /boq/:id/generate-pr — create PR(s) from selected APPROVED-BOQ items
  // (boq-extra.jsx BOQtoPRForm; contract generateBoqPr). Body {item_ids[],
  // qty{item_id:qty}}. Auto-splits Material (cat M) → a supplier PR and
  // Subcon/Labor (cat S|L) → a PR-Subcon (mirrors the prototype's M/S split).
  // Each PR line carries boq_item_id + qty; its price DERIVES from the BOQ item
  // at read time (pr_item has no price column — same as pr.ts, C10). Cut-remain:
  // each item's remain_qty is decremented by the generated qty, so a BOQ item
  // can be partially PR'd across several generations.
  //
  // No quota is wired: the quota keys are projects/users/storage_gb/ai_per_month
  // (plugins/quota.ts) — there is NO `pr` dimension, and generateBoqPr declares
  // no 402 in the contract. So per the task ruling ("if none, skip"), skip.
  app.post("/boq/:id/generate-pr", async (request, reply) => {
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

    // B-084 (matrix GAP-2): generate-PR mints real draft PR / PR-Subcon docs and
    // IRREVERSIBLY decrements each item's remain_qty — a financial-commitment
    // initiation + a budget-consumption vector. It was gated by doc status only,
    // so any tenant member (even a zero-perms role) could initiate spend and burn
    // down the remaining budget. Since it creates PRs, gate it on the `pr.create`
    // right of the tenant's 11×5 perms matrix — reusing the exact F1 mechanism
    // (loadCaller/permAllowed), inventing no new policy. Fail-closed: an
    // unattributable caller (no session / no dictionary user / no role) has no
    // perms and is denied.
    const caller = await loadCaller(request);
    if (!permAllowed(caller?.perms, "pr", "create")) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: "generating PRs requires pr.create permission",
      });
    }

    // Only an APPROVED (locked) BOQ can be PR'd — you buy against the approved
    // budget, never a draft/pending/revise doc (flows.html FLOW-A).
    if (doc.status !== "approved") {
      return reply.code(409).send({
        code: "BOQ_NOT_APPROVED",
        message: "PR can only be generated from an approved BOQ",
      });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const itemIds = Array.isArray(body.item_ids)
      ? // de-dup: a repeated id must not create a double line / double cut-remain.
        [...new Set((body.item_ids as unknown[]).map((v) => str(v).trim()).filter(Boolean))]
      : [];
    if (itemIds.length === 0) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "item_ids[] is required" });
    }
    const qtyMap = (body.qty ?? {}) as Record<string, unknown>;

    // The doc's own items — every selected id must be one of them (tenant-scoped
    // read; a foreign item id simply is not in this set → 404).
    const items = await db.selectThrough(boqItems, ITEM_HOPS, eq(boqDocs.id, id));
    const itemById = new Map(items.map((it) => [it.id, it]));

    // Resolve + validate each selection: belongs to the doc, and qty is within
    // the item's remaining un-PR'd quantity (defaults to the full remainder).
    const lines: { item: BoqItemRow; qty: number }[] = [];
    for (const itemId of itemIds) {
      const it = itemById.get(itemId);
      if (!it) {
        return reply.code(404).send({
          code: "NOT_FOUND",
          message: `BOQ item ${itemId} is not in this BOQ`,
        });
      }
      const remain = Number(it.remainQty);
      const requested = toNum(qtyMap[itemId]);
      const qty = requested == null ? remain : requested;
      if (qty <= 0) {
        return reply.code(400).send({
          code: "VALIDATION",
          message: `qty for BOQ item ${itemId} must be > 0`,
        });
      }
      if (qty > remain) {
        return reply.code(409).send({
          code: "QTY_EXCEEDS_REMAIN",
          message: `qty ${qty} exceeds remain_qty ${remain} for BOQ item ${itemId}`,
        });
      }
      lines.push({ item: it, qty });
    }

    // Split the selection by category into (at most) a material PR + a subcon PR.
    const buckets = PR_BUCKETS.map((def) => ({
      def,
      lines: lines.filter((l) => def.cats.has(l.item.cat)),
    })).filter((b) => b.lines.length > 0);

    // Running PR nos derive from the tenant's existing PR nos (never hardcoded).
    const existingNos = (await db.selectThrough(prs, PR_HOPS)).map((p) => p.no);
    const year = new Date().getUTCFullYear();

    // Cut-remain plan (pure — decided from the read `lines`): the OLD remain_qty
    // each cut was decided against, and the new one it must become. `lines` holds
    // distinct item ids (item_ids[] was de-duped above), so no id repeats.
    //
    // B-379 — ASCENDING BY ITEM ID, and that is a deadlock rule, not tidiness.
    //
    // The cut below is N SEPARATE statements where the code it replaces was ONE
    // bulk CASE UPDATE (updateThroughChainMany). A single statement locks the rows
    // it touches in ITS OWN scan order, which two concurrent copies of that same
    // statement share; N statements take the order the CALLER wrote them in, which
    // is the client's `item_ids[]` body order — so two generate-PR calls whose
    // selections OVERLAP could take the same two rows in opposite directions. This
    // loop introduces the ordering hazard; ascending removes it, because a waiter
    // then only ever holds ids BELOW the one it waits on.
    //
    // MEASURED, on this stack, rather than asserted: two psql sessions updating
    // boq_item rows X then Y and Y then X, with a sleep between, produced
    // `ERROR: deadlock detected … while updating tuple in relation "boq_item"` and
    // a ROLLBACK on the second. There is no deadlock handler in apps/api
    // (`grep -rn "40P01\|deadlock" apps/api/src` finds none), so a victim surfaces
    // as a 500 — and sync_processor.dart DEFERS a 5xx, wedging a field phone's whole
    // offline drain. Same invariant lock-order.ts holds for inventory_item; the
    // boq_item edge is written up there too.
    //
    // `byIdAsc` is the repo's own id-ASC total order (list-order.ts). Its doc warns
    // against using it as a WHOLE comparator — that warning is about RENDERED lists,
    // where id order means nothing to a reader. Nothing here is rendered: this array
    // is a lock order, and id ASC is exactly the order intended, the same note
    // inventory.ts createTransfer carries about its own sorted-but-not-rendered rows.
    const cuts = lines
      .map((l) => ({
        id: l.item.id,
        // The exact string read out of Postgres — the compare-and-swap predicate.
        was: l.item.remainQty,
        now: String(Number(l.item.remainQty) - l.qty),
      }))
      .sort(byIdAsc);

    // B-098: the PRs (headers + lines) AND the remain_qty cut are ONE issuance —
    // wrap them in a single transaction (the B-097 door) so a failed remain-cut
    // can never leave issued PRs against un-decremented remain_qty (double-issue:
    // the same BOQ qty could be requisitioned twice). The reads that DECIDE the
    // writes (existingNos, buckets, cuts) stay outside; the tx wrapper carries the
    // same company_id, so every write inside is still tenant-scoped. B-379: those
    // outside reads are exactly why the cut has to be a compare-and-swap — the
    // value they decided against can move before the transaction commits.
    let createdPrs: Record<string, unknown>[];
    try {
      createdPrs = await db.transaction(async (tx) => {
        // -------------------------------------------------------------------
        // B-379 — THE CUT IS A COMPARE-AND-SWAP, AND IT RUNS FIRST.
        // -------------------------------------------------------------------
        // WHAT THIS CLOSES, measured live on the seeded stack at 2245b73 before this
        // guard: 8 separate OS curl processes released on one epoch-ms barrier, each
        // asking for the FULL remaining 1240 of BOQ item MAT-CEM-002, answered
        // 201 x7 + 409 x1. Read back out of Postgres: remain_qty 0, seven pr_item
        // rows, Σ pr_item.qty = 8680 against an ordered qty of 1240 — seven times the
        // budget requisitioned, the ceiling above passed by every one of them.
        //
        // The old write took the shape that makes that inevitable: the ceiling was
        // checked against a remain_qty read OUTSIDE the transaction, and the write
        // was an ABSOLUTE new value (`updateThroughChainMany`) whose WHERE said only
        // `id IN (…)` — nothing about what the value had been. Under READ COMMITTED
        // every racer's UPDATE therefore matched, and the last writer's absolute
        // value won. Same shape as B-149's status flip and B-342's stock read.
        //
        // The fix is the B-149 shape the repo already requires and that inventory.ts,
        // gr.ts, subcon.ts approve-payment and revrec.ts all follow: fold the value
        // the decision was made against into the FINAL UPDATE's own WHERE. The loser
        // re-matches `id = … AND remain_qty = <what I read>` against the committed
        // row, gets 0 rows, and throws — rolling back its PRs with it. Nothing is
        // ever half-issued, because the cut and the PRs are one transaction (B-098).
        //
        // A CONSERVATIVE 409 IS THE POINT, not a shortcoming. Two callers who each
        // ask for 30 of 100 would both fit, yet the second is refused because the
        // number it decided against moved. That is fail-closed: it never issues a PR
        // the budget cannot cover, and the caller retries against the fresh remainder
        // (the same answer the 409 above already gives when the qty genuinely no
        // longer fits). Inventing a relative `remain_qty = remain_qty - qty` write
        // instead would let both through, but it would also silently re-decide the
        // ceiling the handler already answered on — the client would be told 201 for
        // a quantity nobody checked against the value that was actually there.
        //
        // COST, stated honestly: this is N guarded round-trips where the 0024 perf
        // audit had got the cut down to ONE bulk CASE statement
        // (updateThroughChainMany, which takes no predicate). N here is the number of
        // BOQ lines in a single generate-PR, and correctness at a money door outranks
        // the two-query win. If the bulk door ever grows a per-row predicate this
        // should move back onto it.
        //
        // IT RUNS BEFORE THE PR INSERTS SO A LOSER FAILS FAST — and that is a
        // preference, NOT the deadlock rule it first looked like. The tempting
        // claim was: `pr_item.boq_item_id` is an FK, so INSERT INTO pr_item takes
        // `FOR KEY SHARE` on the boq_item row, and this UPDATE would have to
        // UPGRADE that to an exclusive lock — two callers each holding KEY SHARE
        // and each wanting the upgrade is PG 40P01 (the gr.ts / lock-order.ts
        // shape). PROBED, and it is false HERE: two psql sessions that each
        // inserted a pr_item referencing the same boq_item and then updated
        // `remain_qty` on it BOTH committed. `remain_qty` is in no key, so the
        // UPDATE takes FOR NO KEY UPDATE, which does not conflict with the FK's
        // FOR KEY SHARE — the upgrade lock-order.ts describes exists there because
        // inventory.ts takes an explicit FOR UPDATE (selectForUpdate), and this
        // handler takes none. Order still earns its place: a caller whose cut is
        // going to be refused does no PR/pr_item work first, and the rollback it
        // triggers has less to undo.
        for (const cut of cuts) {
          const [swapped] = await tx.updateThroughChain(
            boqItems,
            ITEM_HOPS,
            { remainQty: cut.now },
            and(eq(boqItems.id, cut.id), eq(boqItems.remainQty, cut.was)),
            // The CAS, on the FINAL UPDATE — not only the resolve SELECT. The resolve
            // → update is two round-trips, so a predicate placed only in `where` does
            // NOT close the race: the loser's UPDATE would re-check `id IN (ids)`
            // alone and still match (B-149's exact lesson, subcon.ts:1171-1179).
            eq(boqItems.remainQty, cut.was),
          );
          if (!swapped) {
            throw new StaleStateError(
              `remain_qty for BOQ item ${cut.id} changed while this PR was being ` +
                `generated — re-read the BOQ and retry`,
            );
          }
        }

        const createdPrs: Record<string, unknown>[] = [];
        for (const bucket of buckets) {
          const no = nextPrNo(existingNos, bucket.def.prefix, year);
          existingNos.push(no); // reserve so a 2nd bucket this call cannot reuse it

          const [pr] = await tx.insertThrough(prs, projects, doc.projectId, [
            {
              projectId: doc.projectId,
              no,
              type: bucket.def.type,
              needDate: null,
              status: "draft",
              approvalStep: 0,
            },
          ]);
          const createdLines = await tx.insertThrough(
            prItems,
            projects,
            doc.projectId,
            bucket.lines.map((l) => ({
              prId: pr!.id,
              boqItemId: l.item.id,
              qty: String(l.qty),
            })),
          );
          const lineById = new Map(createdLines.map((ln) => [ln.boqItemId, ln]));

          // amount = Σ qty × the referenced BOQ item's real unit price (C10).
          let amount = 0;
          let currency = "THB";
          let currencySet = false;
          const wireLines = bucket.lines.map((l) => {
            const price = Number(l.item.price);
            amount += l.qty * price;
            if (!currencySet) {
              currency = l.item.currencyCode;
              currencySet = true;
            }
            return {
              id: lineById.get(l.item.id)?.id ?? null,
              pr_id: pr!.id,
              boq_item_id: l.item.id,
              qty: l.qty,
              price,
              amount: l.qty * price,
            };
          });

          createdPrs.push({
            id: pr!.id,
            no: pr!.no,
            type: pr!.type,
            project_id: pr!.projectId,
            boq_id: id,
            status: pr!.status,
            approval_step: pr!.approvalStep,
            currency_code: currency,
            amount,
            items: wireLines,
          });
        }

        // The cut-remain already ran, at the TOP of this transaction — see B-379
        // above for why it is a compare-and-swap, and why going first is a
        // fail-fast preference rather than the deadlock rule it first looked like.
        return createdPrs;
      });
    } catch (err) {
      // B-379: a cut whose compare-and-swap matched 0 rows. The whole transaction
      // is already rolled back (no PR, no pr_item, no partial cut), so this is a
      // clean, retryable client answer — 409 and NOT 5xx, because
      // sync_processor.dart dead-letters a 4xx but DEFERS a 5xx and stops the
      // phone's entire offline drain behind it (lock-order.ts states this at length).
      if (err instanceof StaleStateError) {
        return reply.code(409).send({ code: "CONCURRENT_UPDATE", message: err.message });
      }
      throw err;
    }

    return reply.code(201).send({ prs: createdPrs });
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

    // B-149 optimistic guard: fold the submittable pre-state into the WHERE so a
    // concurrent submit/approve that already moved this BOQ matches 0 rows → 409.
    const [updated] = await db.updateThrough(
      boqDocs,
      projects,
      boqDocs.projectId,
      doc.projectId,
      { status: "pending" },
      and(eq(boqDocs.id, id), inArray(boqDocs.status, ["draft", "revise"])),
    );
    if (!updated) {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a draft or revise BOQ can be submitted",
      });
    }
    return reply.code(200).send(await docWireWithTotal(db, updated));
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

    // The approving user (B-081 / F4): level != null already implies the caller
    // resolved to a tenant user + role, so re-resolve the row for its id/name to
    // stamp the archive approver + write the version-history entry.
    const approver = request.authUser
      ? await loadUserByEmail(db, request.authUser.email)
      : null;
    const approvedAt = new Date();

    // B-097: the status flip + its version-history row are ONE approval — write
    // them in a single transaction so an approved (locked) BOQ can never exist
    // without its archive log entry (the archive's Revise-history + version-diff
    // render from that row; a partial write would show an approval with no
    // history). The tx wrapper carries the same company_id.
    try {
      const updated = await db.transaction(async (tx) => {
        // B-149 optimistic guard: only a pending BOQ can be approved — a concurrent
        // approve that already locked it matches 0 rows here → throw (roll back the
        // flip + its version-history row) → 409.
        const [updated] = await tx.updateThrough(
          boqDocs,
          projects,
          boqDocs.projectId,
          doc.projectId,
          // Stamp the archive approver + timestamp so the archive screen reads real
          // rows (audit_log cannot source these — its entity is a route template).
          { status: "approved", approvedBy: approver?.id ?? null, approvedAt },
          and(eq(boqDocs.id, id), eq(boqDocs.status, "pending")),
        );
        if (!updated) {
          throw new StaleStateError("only a pending BOQ can be approved");
        }
        await tx.insertThrough(boqVersionHistory, projects, doc.projectId, [
          {
            docId: id,
            version: doc.version,
            action: "approve",
            by: approver?.id ?? null,
            at: approvedAt,
            delta: null,
            note: null,
          },
        ]);
        return updated;
      });

      return reply
        .code(200)
        .send(await docWireWithTotal(db, updated, approver?.name ?? null));
    } catch (err) {
      if (err instanceof StaleStateError) {
        return reply.code(409).send({ code: "INVALID_STATE", message: err.message });
      }
      throw err;
    }
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

    // B-084 (authz-reaudit GAP-1): revise RE-OPENS an approved BOQ for a new
    // editable version — the same MD authority that LOCKED it (the /approve gate
    // above) must authorize un-locking it. Without this any in-tenant member
    // could silently un-approve a BOQ, bypassing the terminal approval. Mirrors
    // /approve. Fail-closed: a sub-MD or unattributable caller is denied 403.
    const reviseLevel = await callerApprovalLevel(request);
    if (reviseLevel == null || reviseLevel < BOQ_APPROVAL_MIN_LEVEL) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: `Revising an approved BOQ requires MD authority (approval level ${BOQ_APPROVAL_MIN_LEVEL})`,
      });
    }

    // Resolve the revising user (mirrors /approve) so the version-history row is
    // attributed to a real actor; a system/unresolvable caller stamps `by` null.
    const reviser = request.authUser
      ? await loadUserByEmail(db, request.authUser.email)
      : null;
    const revisedAt = new Date();
    const newVersion = doc.version + 1;

    // B-097: version bump + its version-history row are ONE revise — write them
    // atomically so the archive timeline can never show a revised doc whose new
    // version has no matching history entry (mirrors /approve).
    try {
      const updated = await db.transaction(async (tx) => {
        // B-149 optimistic guard: only an approved BOQ can be revised — a concurrent
        // revise that already re-opened it matches 0 rows here → throw (roll back the
        // version bump + its history row) → 409.
        const [updated] = await tx.updateThrough(
          boqDocs,
          projects,
          boqDocs.projectId,
          doc.projectId,
          { status: "revise", version: newVersion },
          and(eq(boqDocs.id, id), eq(boqDocs.status, "approved")),
        );
        if (!updated) {
          throw new StaleStateError("only an approved BOQ can be revised");
        }
        // version = the freshly bumped version so it never collides with this
        // doc's approve-history keys (B-085 fix 1; previously only /approve logged).
        await tx.insertThrough(boqVersionHistory, projects, doc.projectId, [
          {
            docId: id,
            version: newVersion,
            action: "revise",
            by: reviser?.id ?? null,
            at: revisedAt,
            delta: null,
            note: null,
          },
        ]);
        return updated;
      });

      return reply.code(200).send(await docWireWithTotal(db, updated));
    } catch (err) {
      if (err instanceof StaleStateError) {
        return reply.code(409).send({ code: "INVALID_STATE", message: err.message });
      }
      throw err;
    }
  });
}

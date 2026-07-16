// PO (purchase order) handlers — list/create-from-approved-PR/detail, the
// submit→approve→reject state machine with B-070 TIERED approval authority, and
// the variation-order amendment (P2-BE-05; po-wo.jsx POList + POForm, flows.html
// FLOW-A + MATRIX "PO ใบสั่งซื้อ", data-dictionary "PR อนุมัติ -> PO(วัสดุ)").
//
// Contract (openapi.yaml /po …): listPo → EntityList; createPo → 201
// EntityCreated; submitPo/approvePo (POST /po/{id}/{submit|approve}) → ActionOk;
// rejectPo (POST /po/{id}/reject {reason}) → ActionOk; createPoVariationOrder
// (POST /po/{id}/variation-order {dir,amount,reason}) → ActionOk. Every body is
// the opaque Entity (additionalProperties); wire fields below are REAL po columns.
//
// Schema (migration 0015, P2-BE-05, B-070): po gained `no` / `status` /
// `approval_step` so it mirrors the pr state machine EXACTLY. GAPs flagged to Wei
// (NOT worked around with invented columns):
//   1) po has NO line-item table (there is no `po_item`, unlike pr_item). So a
//      PO's `amount` cannot be a live Σ of PO lines. Instead pos.total is seeded
//      AT CREATE-TIME from the SOURCE PR's priced lines (prLineAmount → C10, real
//      rows), and the read path returns that STORED total. Partial-PR→PO and
//      vendor-negotiated per-line prices are therefore NOT modelled — the full
//      source-PR line total is used. (Amount is real-derived at creation, then
//      stored; it is not a live re-sum.)
//   2) po has NO deposit / down-payment / paid columns — the prototype's
//      มัดจำ (downPct/downPaid) + งวด payment-schedule + GR% panels are
//      presentational and are NOT persisted here.
//   3) The action endpoints declare only 200/401/404, so the 409 (invalid state)
//      and 403 (insufficient approval authority) returned here are undocumented
//      statuses — both still use the flat Error envelope.
//
// Tenant scope (CAVEAT — keep prominent for gate-4.5): po carries NO company_id
// and NO project_id of its own. Its ONLY tenant anchor is pr_id → pr →
// project_id → project (company_id). Reads/updates therefore go THROUGH that
// 2-hop chain (selectThrough / updateThroughChain — the multi-hop update door,
// because po has no direct tenant-FK column for updateThrough); creation anchors
// insertThrough on the SOURCE PR's project. A po whose pr_id is NULL has NO
// tenant anchor and would be invisible to every scoped read — so POST /po
// REQUIRES an approved pr_id of this tenant (rejects a null / foreign /
// non-approved PR ref), which keeps every po tenant-anchored BY CONSTRUCTION.
// (A consequence: any po returned by selectThrough is guaranteed to have a
// non-null pr_id — the INNER JOIN on pr_id filters out null-anchored rows.)
//
// State machine (flows.html "สถานะ PR/PO/PV: draft → pending → approved | rejected"):
//   draft --submit--> pending --approve--> approved
//                     pending --reject({reason})--> rejected
// Out-of-order transitions → 409 INVALID_STATE (mirrors pr.ts).
//
// Approval authority (flows.html MATRIX "PO ใบสั่งซื้อ", B-070 authoritative):
//   หน.จัดซื้อ (Procurement head) approves EVERY PO             → approvalLevel 2
//   ผจก.โครงการ (Project Manager) required WHEN amount > 1,000,000 → approvalLevel 3
//   MD required WHEN amount > 5,000,000 (THB, strict >)          → approvalLevel 4
// The caller's role.approvalLevel must reach the tier the PO's amount demands
// (the highest triggered tier); a lower tier — or an unattributable caller — 403.
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { pos, prs, projects, variationOrders, vendors } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";
import {
  callerApprovalLevel,
  has,
  pick,
  prLineAmount,
  requiredApprovalLevel,
  requiredTierCount,
  str,
  toNum,
} from "./procurement.js";

type PoRow = typeof pos.$inferSelect;
type VariationOrderRow = typeof variationOrders.$inferSelect;

// The tenant anchor for a po: pr_id → pr → project (company_id-scoped root).
const PO_HOPS = [
  { fk: pos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
// The PR itself is scoped by its direct project_id FK (mirror pr.ts PR_HOPS).
const PR_HOPS = [{ fk: prs.projectId, parent: projects }];

/**
 * The opaque Entity wire shape for a PO doc: real po columns + `amount` (= the
 * stored total; see header GAP 1). The mock's presentational vendor-name /
 * requester / มัดจำ / GR% strings are NOT stored, so they are not returned.
 */
function poWire(po: PoRow): Record<string, unknown> {
  const total = Number(po.total);
  return {
    id: po.id,
    no: po.no,
    pr_id: po.prId,
    vendor_id: po.vendorId,
    status: po.status,
    approval_step: po.approvalStep,
    currency_code: po.currencyCode,
    credit_term: po.creditTerm,
    total,
    vat: Number(po.vat),
    amount: total,
  };
}

/** The opaque Entity wire shape for one variation order (real variation_order columns). */
function voWire(vo: VariationOrderRow): Record<string, unknown> {
  return {
    id: vo.id,
    po_id: vo.poId,
    dir: vo.dir,
    amount: Number(vo.amount),
    currency_code: vo.currencyCode,
    reason: vo.reason,
  };
}

/** Register the PO routes on the given (already /api/v1-prefixed) scope. */
export function registerPoRoute(app: FastifyInstance): void {
  // GET /po — the tenant's POs (po-wo.jsx POList). Scoped through pr → project.
  app.get("/po", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }
    const docs = await db.selectThrough(pos, PO_HOPS);
    return reply.code(200).send(listEnvelope(docs.map(poWire)));
  });

  // POST /po — raise a PO from an APPROVED PR (po-wo.jsx POForm; data-dictionary
  // "PR อนุมัติ -> PO"). Server owns status (draft) + approval_step (0). total is
  // seeded from the source PR's priced lines (real-derived, C10). pr_id is
  // REQUIRED and must resolve to an approved PR of this tenant (see header
  // tenant-scope caveat), and vendor_id must be this tenant's vendor.
  app.post("/po", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const prId = str(pick(body, "pr_id", "prId")).trim();
    const vendorId = str(pick(body, "vendor_id", "vendorId")).trim();
    const no = has(body, "no") ? str(pick(body, "no")).trim() || null : null;
    const creditTerm = toNum(pick(body, "credit_term", "creditTerm"));
    const vat = toNum(pick(body, "vat"));

    if (!prId) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: "pr_id is required (a PO is raised from an approved PR)",
      });
    }
    if (!vendorId) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "vendor_id is required" });
    }

    // The source PR must belong to this tenant (scoped read — a foreign id
    // resolves to nothing) AND be approved (business rule: PO from approved PR).
    const [pr] = await db.selectThrough(prs, PR_HOPS, eq(prs.id, prId));
    if (!pr) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "pr not found" });
    }
    if (pr.status !== "approved") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "a PO can only be raised from an approved PR",
      });
    }

    // The vendor must be this tenant's vendor (scoped select — no cross-tenant leak).
    const [vendor] = await db.select(vendors, eq(vendors.id, vendorId));
    if (!vendor) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "vendor not found" });
    }

    // Duplicate `no` across the tenant's POs (when a number is supplied).
    if (no) {
      const existing = await db.selectThrough(pos, PO_HOPS);
      if (existing.some((d) => d.no === no)) {
        return reply.code(409).send({
          code: "DUPLICATE_CODE",
          message: `PO no ${no} already exists`,
        });
      }
    }

    // total is seeded from the source PR's priced lines (C10, real-derived).
    const { amount, currency } = await prLineAmount(db, prId);

    const [created] = await db.insertThrough(pos, projects, pr.projectId, [
      {
        prId,
        vendorId,
        no,
        total: String(amount),
        vat: vat != null ? String(vat) : "0",
        currencyCode: currency,
        creditTerm: creditTerm != null ? Math.trunc(creditTerm) : null,
        status: "draft",
        approvalStep: 0,
      },
    ]);
    return reply.code(201).send(poWire(created!));
  });

  // GET /po/:id — single-doc detail with its variation orders (po-wo.jsx PO panel).
  app.get("/po/:id", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [po] = await db.selectThrough(pos, PO_HOPS, eq(pos.id, id));
    if (!po) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `PO ${id} not found` });
    }

    const vos = await db.selectThrough(
      variationOrders,
      [
        { fk: variationOrders.poId, parent: pos },
        { fk: pos.prId, parent: prs },
        { fk: prs.projectId, parent: projects },
      ],
      eq(variationOrders.poId, id),
    );
    return reply
      .code(200)
      .send({ ...poWire(po), variation_orders: vos.map(voWire) });
  });

  // POST /po/:id/submit — draft → pending.
  app.post("/po/:id/submit", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [po] = await db.selectThrough(pos, PO_HOPS, eq(pos.id, id));
    if (!po) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `PO ${id} not found` });
    }
    if (po.status !== "draft") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a draft PO can be submitted",
      });
    }

    const [updated] = await db.updateThroughChain(
      pos,
      PO_HOPS,
      { status: "pending" },
      eq(pos.id, id),
    );
    return reply.code(200).send(poWire(updated!));
  });

  // POST /po/:id/approve — pending → approved (terminal). The caller's
  // role.approvalLevel must reach the tier the PO's amount demands (B-070:
  // หน.จัดซื้อ every PO; ผจก.โครงการ > 1M; MD > 5M, strict >).
  app.post("/po/:id/approve", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [po] = await db.selectThrough(pos, PO_HOPS, eq(pos.id, id));
    if (!po) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `PO ${id} not found` });
    }

    // The stored total fixes which approval tier must sign off (see header GAP 1).
    const amount = Number(po.total);
    const needed = requiredApprovalLevel(amount);
    const level = await callerApprovalLevel(request);
    if (level == null || level < needed) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: `PO approval of ${amount} requires approval level ${needed}`,
      });
    }
    if (po.status !== "pending") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a pending PO can be approved",
      });
    }

    const [updated] = await db.updateThroughChain(
      pos,
      PO_HOPS,
      { status: "approved", approvalStep: requiredTierCount(amount) },
      eq(pos.id, id),
    );
    return reply.code(200).send(poWire(updated!));
  });

  // POST /po/:id/reject — pending → rejected. reason is REQUIRED by the contract
  // (rejectPo {reason}); validated here but not persisted (po has no reason
  // column; the AuditLog middleware still records the mutation).
  app.post("/po/:id/reject", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [po] = await db.selectThrough(pos, PO_HOPS, eq(pos.id, id));
    if (!po) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `PO ${id} not found` });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const reason = str(pick(body, "reason")).trim();
    if (!reason) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "reason is required" });
    }
    if (po.status !== "pending") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a pending PO can be rejected",
      });
    }

    const [updated] = await db.updateThroughChain(
      pos,
      PO_HOPS,
      { status: "rejected" },
      eq(pos.id, id),
    );
    return reply.code(200).send(poWire(updated!));
  });

  // POST /po/:id/variation-order — attach an add/cut amendment (data-dictionary
  // "+ VariationOrder (dir add|cut, amount, reason)") and AMEND the PO's stored
  // total accordingly (add → +amount, cut → −amount). The VO row is written
  // through insertThrough anchored on the source PR's project (scoped).
  app.post("/po/:id/variation-order", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [po] = await db.selectThrough(pos, PO_HOPS, eq(pos.id, id));
    if (!po) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `PO ${id} not found` });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const dir = str(pick(body, "dir")).trim().toLowerCase();
    const amount = toNum(pick(body, "amount"));
    const reason = has(body, "reason")
      ? str(pick(body, "reason")).trim() || null
      : null;
    if (dir !== "add" && dir !== "cut") {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "dir must be add or cut" });
    }
    if (amount == null || amount < 0) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "amount must be a number >= 0" });
    }

    // Resolve the source PR's project to anchor the scoped VO insert. po.prId is
    // guaranteed non-null (the PO_HOPS INNER JOIN filters null-anchored rows).
    const [pr] = await db.selectThrough(prs, PR_HOPS, eq(prs.id, po.prId!));
    if (!pr) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: `PO ${id} not found` });
    }

    const [vo] = await db.insertThrough(variationOrders, projects, pr.projectId, [
      {
        poId: po.id,
        dir,
        amount: String(amount),
        currencyCode: po.currencyCode,
        reason,
      },
    ]);

    const newTotal =
      dir === "add" ? Number(po.total) + amount : Number(po.total) - amount;
    const [updated] = await db.updateThroughChain(
      pos,
      PO_HOPS,
      { total: String(newTotal) },
      eq(pos.id, id),
    );
    return reply
      .code(200)
      .send({ ok: true, variation_order: voWire(vo!), po: poWire(updated!) });
  });
}

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
//   2) RESOLVED (B-079 / F2, migration 0019): the prototype's มัดจำ / จ่ายไป
//      split now comes from real AP data — ap_billing.kind (deposit|progress|
//      final) lets the read derive paid = Σ(all ap_billing on this PO) and
//      deposit = Σ(kind=deposit). Both are real sums (a PO with no billing rows
//      reports 0/0 honestly). doc_date = created_at. The งวด payment-schedule +
//      GR% panels remain presentational and are still NOT persisted here.
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
import {
  pos,
  prs,
  projects,
  variationOrders,
  vendors,
  apBillings,
} from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";
import { round2 } from "./money.js";
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
type ApBillingRow = typeof apBillings.$inferSelect;

/**
 * The PO payment split from real AP data (B-079 / F2): paid = Σ of every
 * ap_billing on this PO; deposit = Σ of the down-payment billings (kind=deposit).
 * Both are real sums — a PO with no ap_billing rows reports 0/0 honestly, never
 * a fabricated มัดจำ/จ่ายไป figure (the old poWire GAP-2 em-dash).
 */
function sumBillings(bills: ApBillingRow[]): { paid: number; deposit: number } {
  let paid = 0;
  let deposit = 0;
  for (const b of bills) {
    const amount = Number(b.amount);
    paid += amount;
    if (b.kind === "deposit") deposit += amount;
  }
  // Σ ap_billing is a JS-float sum → round both to the 2-dp minor unit at the
  // wire so accumulation drift never surfaces (B-085 fix 3).
  return { paid: round2(paid), deposit: round2(deposit) };
}

// The tenant anchor for a po: pr_id → pr → project (company_id-scoped root).
const PO_HOPS = [
  { fk: pos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
// The PR itself is scoped by its direct project_id FK (mirror pr.ts PR_HOPS).
const PR_HOPS = [{ fk: prs.projectId, parent: projects }];

/**
 * The opaque Entity wire shape for a PO doc: real po columns + `amount` (= the
 * stored total; see header GAP 1) + `doc_date` (= created_at). When AP billing
 * data is resolved (list / detail), it also carries the real `paid` / `deposit`
 * split (B-079 / F2 — Σ ap_billing / Σ kind=deposit); the state-machine echoes
 * omit those two rather than fabricate 0 for a mid-flow PO (the FE re-reads the
 * list after an action).
 */
function poWire(
  po: PoRow,
  billing?: { paid: number; deposit: number },
): Record<string, unknown> {
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
    doc_date: po.createdAt,
    ...(billing ? { paid: billing.paid, deposit: billing.deposit } : {}),
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
    // pos through pr → project; ap_billing carries its own company_id (scoped
    // select). Group the billings by po_id in memory to compute paid/deposit — no
    // N+1.
    const [docs, bills] = await Promise.all([
      db.selectThrough(pos, PO_HOPS),
      db.select(apBillings),
    ]);
    const billsByPo = new Map<string, ApBillingRow[]>();
    for (const b of bills) {
      if (!b.poId) continue;
      const list = billsByPo.get(b.poId) ?? [];
      list.push(b);
      billsByPo.set(b.poId, list);
    }
    return reply
      .code(200)
      .send(
        listEnvelope(
          docs.map((po) => poWire(po, sumBillings(billsByPo.get(po.id) ?? []))),
        ),
      );
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

    const [vos, bills] = await Promise.all([
      db.selectThrough(
        variationOrders,
        [
          { fk: variationOrders.poId, parent: pos },
          { fk: pos.prId, parent: prs },
          { fk: prs.projectId, parent: projects },
        ],
        eq(variationOrders.poId, id),
      ),
      db.select(apBillings, eq(apBillings.poId, id)),
    ]);
    return reply.code(200).send({
      ...poWire(po, sumBillings(bills)),
      variation_orders: vos.map(voWire),
    });
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

    // B-084 hardening — this endpoint was the CRITICAL FLOW-A authz gap: it
    // rewrites the PO's stored `total`, and that stored total is exactly what the
    // /approve gate reads to decide which tier must sign off (po.ts:350). Left
    // ungated, a low-tier caller could cut a PO below its tier, get it approved
    // cheaply, then add the amount back after approval — turning the working
    // approve-ladder into a full in-tenant financial-authorization bypass
    // (matrix GAP-1 exploit-B). Three defenses (matrix Option C):
    //
    //  (1) status guard — only a draft or an approved PO may be amended; a
    //      pending doc is mid-approval and a rejected/closed one is terminal
    //      (mirrors how submit/approve/reject 409 on the wrong state).
    //  (2) non-negative floor — a `cut` may not drive the stored total below 0
    //      (a negative total would otherwise resolve to the lowest tier).
    //  (3) approval-authority gate — the caller must hold approval authority for
    //      the HIGHER of the current total and the resulting total, computed with
    //      the SAME B-070 thresholds /approve uses (requiredApprovalLevel). This
    //      makes amending a PO cost at least as much authority as approving it at
    //      either amount, so the cut-then-add tier-downgrade is denied at the
    //      FIRST step. Fail-closed: an unattributable caller (no session / no
    //      dictionary user / no role) resolves to null and is denied.
    if (po.status !== "draft" && po.status !== "approved") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a draft or approved PO can be amended",
      });
    }

    const currentTotal = Number(po.total);
    const newTotal = dir === "add" ? currentTotal + amount : currentTotal - amount;
    if (newTotal < 0) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: "a cut cannot drive the PO total below 0",
      });
    }

    const needed = Math.max(
      requiredApprovalLevel(currentTotal),
      requiredApprovalLevel(newTotal),
    );
    const level = await callerApprovalLevel(request);
    if (level == null || level < needed) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: `amending this PO requires approval level ${needed}`,
      });
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

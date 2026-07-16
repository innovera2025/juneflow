// WO (work order) handlers — list/create-from-approved-PR/detail, and the
// submit→approve→reject state machine with B-070 TIERED approval authority
// (P2-BE-05; po-wo.jsx WOList + WOForm, flows.html FLOW-A + MATRIX "WO ใบสั่งจ้าง",
// data-dictionary "WO(เหมา)"). A WO is the subcon counterpart of a PO.
//
// Contract (openapi.yaml /wo …): listWo → EntityList; createWo → 201
// EntityCreated; submitWo/approveWo (POST /wo/{id}/{submit|approve}) → ActionOk;
// rejectWo (POST /wo/{id}/reject {reason}) → ActionOk. Bodies are the opaque
// Entity (additionalProperties); wire fields below are REAL wo columns.
//
// Schema (migration 0015, P2-BE-05, B-070): wo gained `no` / `status` /
// `approval_step` (same state machine as PO/PR) and `retention_pct` (mirror of
// subcon_contract.retention_pct) so the WO carries its own retention hold-back
// rate. GAPs flagged to Wei (NOT invented columns):
//   1) wo has NO line/installment table. The prototype's งวดงาน (installment)
//      breakdown is modelled elsewhere (subcon_contract → work_period, subcon.ts)
//      with NO FK from wo, and มัดจำ (downPct) is presentational — neither is
//      persisted here. A WO's `value` is the client-supplied contract value
//      (no BOQ line source exists for lump-sum subcon work — งานเหมา).
//   2) The action endpoints declare only 200/401/404, so the 409/403 returned
//      here are undocumented statuses — both use the flat Error envelope.
//
// Retention: retention_amount = value × retention_pct / 100 (derived at read
// time; retention_pct is a percentage, e.g. 10.000 = 10%, mirroring
// subcon_contract). po-wo.jsx WO list shows this held-back amount.
//
// Tenant scope (CAVEAT — keep prominent for gate-4.5): identical to po.ts — wo
// carries NO company_id / project_id; its ONLY anchor is pr_id → pr → project
// (company_id). Reads/updates go THROUGH that 2-hop chain (selectThrough /
// updateThroughChain); creation anchors insertThrough on the source PR's
// project. POST /wo REQUIRES an approved pr_id of this tenant so every wo is
// tenant-anchored by construction (a null-pr_id wo would be invisible/unwritable).
//
// State machine + approval authority: identical shape + thresholds to PO
// (flows.html MATRIX "WO ใบสั่งจ้าง"): หน.จัดซื้อ every WO; ผจก.โครงการ > 1,000,000;
// MD > 5,000,000 (THB, strict >). Amount = the WO's stored `value`.
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { wos, prs, projects, vendors } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";
import {
  callerApprovalLevel,
  has,
  pick,
  requiredApprovalLevel,
  requiredTierCount,
  str,
  toNum,
} from "./procurement.js";

type WoRow = typeof wos.$inferSelect;

// The tenant anchor for a wo: pr_id → pr → project (company_id-scoped root).
const WO_HOPS = [
  { fk: wos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
const PR_HOPS = [{ fk: prs.projectId, parent: projects }];

/**
 * The opaque Entity wire shape for a WO doc: real wo columns + the derived
 * retention_amount (value × retention_pct / 100) and `amount` (= value).
 */
function woWire(wo: WoRow): Record<string, unknown> {
  const value = Number(wo.value);
  const retentionPct = Number(wo.retentionPct);
  return {
    id: wo.id,
    no: wo.no,
    pr_id: wo.prId,
    vendor_id: wo.vendorId,
    status: wo.status,
    approval_step: wo.approvalStep,
    currency_code: wo.currencyCode,
    value,
    retention_pct: retentionPct,
    retention_amount: (value * retentionPct) / 100,
    amount: value,
  };
}

/** Register the WO routes on the given (already /api/v1-prefixed) scope. */
export function registerWoRoute(app: FastifyInstance): void {
  // GET /wo — the tenant's WOs (po-wo.jsx WOList). Scoped through pr → project.
  app.get("/wo", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }
    const docs = await db.selectThrough(wos, WO_HOPS);
    return reply.code(200).send(listEnvelope(docs.map(woWire)));
  });

  // POST /wo — raise a WO from an APPROVED PR (po-wo.jsx WOForm). Server owns
  // status (draft) + approval_step (0). `value` (contract value) + `retention_pct`
  // come from the body (no BOQ line source for lump-sum subcon work). pr_id is
  // REQUIRED and must resolve to an approved PR of this tenant; vendor_id must be
  // this tenant's vendor (the subcon firm).
  app.post("/wo", async (request, reply) => {
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
    const value = toNum(pick(body, "value")) ?? 0;
    const retentionPct = toNum(pick(body, "retention_pct", "retentionPct")) ?? 0;
    const currencyCode = has(body, "currency_code", "currencyCode")
      ? str(pick(body, "currency_code", "currencyCode")).trim() || "THB"
      : "THB";

    if (!prId) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: "pr_id is required (a WO is raised from an approved PR)",
      });
    }
    if (!vendorId) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "vendor_id is required" });
    }
    if (value < 0) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "value must be a number >= 0" });
    }
    if (retentionPct < 0 || retentionPct > 100) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: "retention_pct must be between 0 and 100",
      });
    }

    // Source PR must belong to this tenant AND be approved.
    const [pr] = await db.selectThrough(prs, PR_HOPS, eq(prs.id, prId));
    if (!pr) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "pr not found" });
    }
    if (pr.status !== "approved") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "a WO can only be raised from an approved PR",
      });
    }

    // Vendor must be this tenant's vendor (scoped select — no cross-tenant leak).
    const [vendor] = await db.select(vendors, eq(vendors.id, vendorId));
    if (!vendor) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "vendor not found" });
    }

    if (no) {
      const existing = await db.selectThrough(wos, WO_HOPS);
      if (existing.some((d) => d.no === no)) {
        return reply.code(409).send({
          code: "DUPLICATE_CODE",
          message: `WO no ${no} already exists`,
        });
      }
    }

    const [created] = await db.insertThrough(wos, projects, pr.projectId, [
      {
        prId,
        vendorId,
        no,
        value: String(value),
        retentionPct: String(retentionPct),
        currencyCode,
        status: "draft",
        approvalStep: 0,
      },
    ]);
    return reply.code(201).send(woWire(created!));
  });

  // GET /wo/:id — single-doc detail (po-wo.jsx WO panel).
  app.get("/wo/:id", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [wo] = await db.selectThrough(wos, WO_HOPS, eq(wos.id, id));
    if (!wo) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `WO ${id} not found` });
    }
    return reply.code(200).send(woWire(wo));
  });

  // POST /wo/:id/submit — draft → pending.
  app.post("/wo/:id/submit", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [wo] = await db.selectThrough(wos, WO_HOPS, eq(wos.id, id));
    if (!wo) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `WO ${id} not found` });
    }
    if (wo.status !== "draft") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a draft WO can be submitted",
      });
    }

    const [updated] = await db.updateThroughChain(
      wos,
      WO_HOPS,
      { status: "pending" },
      eq(wos.id, id),
    );
    return reply.code(200).send(woWire(updated!));
  });

  // POST /wo/:id/approve — pending → approved (terminal). The caller's
  // role.approvalLevel must reach the tier the WO's value demands (B-070:
  // หน.จัดซื้อ every WO; ผจก.โครงการ > 1M; MD > 5M, strict >).
  app.post("/wo/:id/approve", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [wo] = await db.selectThrough(wos, WO_HOPS, eq(wos.id, id));
    if (!wo) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `WO ${id} not found` });
    }

    const amount = Number(wo.value);
    const needed = requiredApprovalLevel(amount);
    const level = await callerApprovalLevel(request);
    if (level == null || level < needed) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: `WO approval of ${amount} requires approval level ${needed}`,
      });
    }
    if (wo.status !== "pending") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a pending WO can be approved",
      });
    }

    const [updated] = await db.updateThroughChain(
      wos,
      WO_HOPS,
      { status: "approved", approvalStep: requiredTierCount(amount) },
      eq(wos.id, id),
    );
    return reply.code(200).send(woWire(updated!));
  });

  // POST /wo/:id/reject — pending → rejected. reason REQUIRED (rejectWo {reason});
  // validated but not persisted (wo has no reason column; AuditLog still records it).
  app.post("/wo/:id/reject", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const [wo] = await db.selectThrough(wos, WO_HOPS, eq(wos.id, id));
    if (!wo) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `WO ${id} not found` });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const reason = str(pick(body, "reason")).trim();
    if (!reason) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "reason is required" });
    }
    if (wo.status !== "pending") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a pending WO can be rejected",
      });
    }

    const [updated] = await db.updateThroughChain(
      wos,
      WO_HOPS,
      { status: "rejected" },
      eq(wos.id, id),
    );
    return reply.code(200).send(woWire(updated!));
  });
}

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
//   1) RESOLVED (B-080 / F3, migration 0020): wo gained `contract_id` FK →
//      subcon_contract, so the prototype's งวดงาน (installment) breakdown is read
//      by reusing the existing subcon_contract → work_period model (subcon.ts) —
//      no duplicate wo_installment table. woWire (list/detail) resolves the
//      installments[], the derived `progress` (Σ done-installment amount / Σ plan
//      amount), and `scope` (= the source PR's title — the only real description
//      of งานเหมา). A WO with contract_id NULL honestly returns an empty plan /
//      null progress. มัดจำ (downPct) stays presentational (not persisted).
//      A WO's `value` is still the client-supplied contract value.
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
import { and, eq } from "drizzle-orm";
import {
  wos,
  prs,
  projects,
  vendors,
  subconContracts,
  workPeriods,
} from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";
import { round2 } from "./money.js";
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
type WorkPeriodRow = typeof workPeriods.$inferSelect;

// The tenant anchor for a wo: pr_id → pr → project (company_id-scoped root).
const WO_HOPS = [
  { fk: wos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
const PR_HOPS = [{ fk: prs.projectId, parent: projects }];
// work_period → subcon_contract → project (B-080 / F3): the installment plan a WO
// reuses via wo.contract_id. subcon_contract carries the tenant project_id FK.
const WP_HOPS = [
  { fk: workPeriods.contractId, parent: subconContracts },
  { fk: subconContracts.projectId, parent: projects },
];

/** A work_period is "done" once it has passed inspection or been paid. */
function isPeriodDone(status: string): boolean {
  return status === "passed" || status === "paid";
}

/** The opaque Entity wire shape for one installment (real work_period columns). */
function installmentWire(p: WorkPeriodRow): Record<string, unknown> {
  return {
    id: p.id,
    seq: p.seq,
    basis: p.basis,
    target: Number(p.target),
    pct: Number(p.pct),
    amount: Number(p.amount),
    status: p.status,
    currency_code: p.currencyCode,
  };
}

/**
 * The opaque Entity wire shape for a WO doc: real wo columns + the derived
 * retention_amount (value × retention_pct / 100), `amount` (= value), and the
 * `contract_id` link (B-080 / F3). When the subcon installment plan is resolved
 * (list / detail), it also carries `scope` (the source PR's title — the only real
 * description of งานเหมา; WO/subcon carry no scope column), the derived `progress`
 * (Σ done-installment amount / Σ plan amount, null when there is no plan), and the
 * `installments[]` (work_period rows). A WO whose contract_id is null honestly
 * reports an empty plan / null progress. NOTE (gap): work_period has no `label`
 * column — the FE composes the งวด label from seq/basis (never fabricated here).
 */
function woWire(
  wo: WoRow,
  plan?: { scope: string | null; installments: WorkPeriodRow[] },
): Record<string, unknown> {
  const value = Number(wo.value);
  const retentionPct = Number(wo.retentionPct);
  const base: Record<string, unknown> = {
    id: wo.id,
    no: wo.no,
    pr_id: wo.prId,
    vendor_id: wo.vendorId,
    contract_id: wo.contractId,
    status: wo.status,
    approval_step: wo.approvalStep,
    currency_code: wo.currencyCode,
    value,
    retention_pct: retentionPct,
    // value × pct / 100 is a JS-float product → round to the 2-dp minor unit at
    // the wire so the held-back figure never shows drift (B-085 fix 3).
    retention_amount: round2((value * retentionPct) / 100),
    amount: value,
  };
  if (!plan) return base;

  const installments = [...plan.installments].sort((a, b) => a.seq - b.seq);
  const totalPlan = installments.reduce((s, p) => s + Number(p.amount), 0);
  const donePlan = installments
    .filter((p) => isPeriodDone(p.status))
    .reduce((s, p) => s + Number(p.amount), 0);
  return {
    ...base,
    scope: plan.scope,
    progress:
      installments.length === 0
        ? null
        : totalPlan > 0
          ? Math.round((donePlan / totalPlan) * 100)
          : 0,
    installments: installments.map(installmentWire),
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
    // wos through pr → project; the installment plans (work_period) through
    // subcon_contract → project; the source PRs (for scope = title) through
    // project. Grouped in memory — no N+1.
    const [docs, periods, prRows] = await Promise.all([
      db.selectThrough(wos, WO_HOPS),
      db.selectThrough(workPeriods, WP_HOPS),
      db.selectThrough(prs, PR_HOPS),
    ]);
    const periodsByContract = new Map<string, WorkPeriodRow[]>();
    for (const p of periods) {
      const list = periodsByContract.get(p.contractId) ?? [];
      list.push(p);
      periodsByContract.set(p.contractId, list);
    }
    const prTitleById = new Map(prRows.map((p) => [p.id, p.title]));
    return reply.code(200).send(
      listEnvelope(
        docs.map((wo) =>
          woWire(wo, {
            scope: wo.prId ? prTitleById.get(wo.prId) ?? null : null,
            installments: wo.contractId
              ? periodsByContract.get(wo.contractId) ?? []
              : [],
          }),
        ),
      ),
    );
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

    // The subcon installment plan (only when this WO is linked to a contract) +
    // the source PR's title for scope. contract_id null → empty plan honestly.
    const [installments, scope] = await Promise.all([
      wo.contractId
        ? db.selectThrough(workPeriods, WP_HOPS, eq(workPeriods.contractId, wo.contractId))
        : Promise.resolve([] as WorkPeriodRow[]),
      wo.prId
        ? db
            .selectThrough(prs, PR_HOPS, eq(prs.id, wo.prId))
            .then((rows) => rows[0]?.title ?? null)
        : Promise.resolve(null),
    ]);
    return reply.code(200).send(woWire(wo, { scope, installments }));
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
      and(eq(wos.id, id), eq(wos.status, "pending")),
      // B-149 optimistic guard — the pending pre-state re-applied to the FINAL
      // UPDATE (updateThroughChain resolves then updates in two round-trips, so a
      // guard only in the resolve `where` above would NOT be atomic). A concurrent
      // approve/reject that already moved this WO re-matches 0 rows here → 409.
      eq(wos.status, "pending"),
    );
    if (!updated) {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a pending WO can be approved",
      });
    }
    return reply.code(200).send(woWire(updated));
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

    // B-084-reject: reject is the approver's counterpart to approve — gate it on
    // the SAME B-070 approval authority the WO's value demands, so a low-tier
    // member cannot sabotage a high-value pending doc by rejecting it. Fail-closed:
    // an unattributable caller (or one below the tier) is denied 403.
    const rejectAmount = Number(wo.value);
    const rejectNeeded = requiredApprovalLevel(rejectAmount);
    const rejectLevel = await callerApprovalLevel(request);
    if (rejectLevel == null || rejectLevel < rejectNeeded) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: `WO rejection of ${rejectAmount} requires approval level ${rejectNeeded}`,
      });
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
      and(eq(wos.id, id), eq(wos.status, "pending")),
      // B-149 atomic guard on the FINAL UPDATE — a concurrent approve+reject can't
      // leave a money-approved WO flipped to rejected (loser re-matches 0 rows → 409).
      eq(wos.status, "pending"),
    );
    if (!updated) {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a pending WO can be rejected",
      });
    }
    return reply.code(200).send(woWire(updated));
  });
}

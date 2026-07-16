// GR (goods receipt) handlers — list, create-against-PO-or-WO, and the
// return/cancel state machine (P2-BE-06, B-070; gr.jsx GRList + forms.jsx
// GRCreateForm/ReturnForm, data-dictionary "ตีกลับ -> DefectReport + แจ้งผู้ขาย").
// A GR records goods received against a material PO or work received against a
// subcon WO (gr.jsx "รับจาก PO" + "รับงาน WO" tabs).
//
// Contract (openapi.yaml /gr …): listGr → EntityList; createGr (POST /gr
// {po_id|wo_id, lines[{qty_ok,qty_rejected,photos[]}]}) → 201 EntityCreated,
// "rejects gen defect-report"; returnGr / cancelGr (POST /gr/{id}/{return|cancel})
// → ActionOk. Bodies are the opaque Entity (additionalProperties); wire fields
// below are REAL gr columns.
//
// Schema (migration 0016, P2-BE-06, B-070): gr gained `wo_id` (nullable) / `no`
// / `status`, and `po_id` was made NULLABLE, so a receipt anchors on EITHER a PO
// or a WO (exactly one is set). GAPs flagged to Wei (NOT invented columns):
//   1) gr has NO per-line table. The createGr body's lines[] are AGGREGATED into
//      the single gr row: received = Σ qty_ok, rejected = Σ qty_rejected, photos
//      = every line's photos[] flattened. Per-item receive/short/condition (the
//      prototype's per-row grid) is therefore NOT persisted line-by-line — only
//      the receipt totals are. (Mirrors the po-has-no-line-table shape.)
//   2) gr has NO money column. The prototype's มูลค่า (฿) is qty × unit-price,
//      presentational — the GR stores quantities only, so no `amount` is returned.
//   3) partial-vs-full is derived from the SOURCE PR's ordered qty (Σ pr_item.qty
//      — the only real "ordered" quantity, since PO/WO carry no line quantities).
//      A WO's lump-sum work (งานเหมา, the prototype's 92% progress) has no BOQ
//      qty source, so an un-quantified order (ordered = 0) never auto-closes —
//      flagged, not worked around.
//   4) The action endpoints declare only 200/401/404, so the 400/404/409 returned
//      here are undocumented statuses — all use the flat Error envelope. There is
//      NO GR approval endpoint, so the prototype's "approved" badge maps to the
//      recorded `received` state.
//
// Tenant scope (CAVEAT — keep prominent for gate-4.5): gr carries NO company_id /
// project_id. Its anchor is po_id → po → pr → project OR wo_id → wo → pr →
// project (a 3-hop chain — one hop deeper than po/wo, whose anchor is pr →
// project). Because a GR can hang off EITHER anchor, reads UNION the two chains
// (each INNER JOIN naturally selects only the rows carrying that FK); a single
// GR is resolved by trying the PO chain then the WO chain. Creation REQUIRES a PO
// or WO of this tenant (a foreign/absent id resolves to nothing → reject), and
// insertThrough anchors the new gr + any defect_report on the source PR's
// project, so every gr is tenant-anchored BY CONSTRUCTION.
//
// State machine (return/cancel):
//   received --return--> returned      received --cancel--> cancelled
// A GR that is already returned/cancelled cannot be re-actioned → 409.
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { grs, defectReports, pos, wos, prs, projects } from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";
import { has, pick, prOrderedQty, str, toNum } from "./procurement.js";

type GrRow = typeof grs.$inferSelect;

// GR anchors: po_id → po → pr → project, and wo_id → wo → pr → project. Each is
// a 3-hop chain ending at the company_id-scoped project root.
const GR_PO_HOPS = [
  { fk: grs.poId, parent: pos },
  { fk: pos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
const GR_WO_HOPS = [
  { fk: grs.woId, parent: wos },
  { fk: wos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
// The PO / WO themselves are scoped by pr_id → project (mirror po.ts / wo.ts).
const PO_HOPS = [
  { fk: pos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
const WO_HOPS = [
  { fk: wos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
const PR_HOPS = [{ fk: prs.projectId, parent: projects }];

/**
 * The opaque Entity wire shape for a GR doc: real gr columns. received/rejected
 * are the receipt totals (see header GAP 1); there is no money `amount` (GAP 2).
 */
function grWire(gr: GrRow): Record<string, unknown> {
  return {
    id: gr.id,
    no: gr.no,
    po_id: gr.poId,
    wo_id: gr.woId,
    status: gr.status,
    received: Number(gr.received),
    rejected: Number(gr.rejected),
    photos: gr.photos ?? [],
  };
}

/**
 * Resolve a single GR by id within this tenant, trying the PO anchor chain then
 * the WO anchor chain. A GR against a PO has po_id set (the PO chain's INNER
 * JOIN matches it); a GR against a WO has wo_id set (only the WO chain matches).
 * A foreign/absent id resolves to nothing in both → null.
 */
async function findGr(db: TenantDb, id: string): Promise<GrRow | null> {
  const [viaPo] = await db.selectThrough(grs, GR_PO_HOPS, eq(grs.id, id));
  if (viaPo) return viaPo;
  const [viaWo] = await db.selectThrough(grs, GR_WO_HOPS, eq(grs.id, id));
  return viaWo ?? null;
}

/** Register the GR routes on the given (already /api/v1-prefixed) scope. */
export function registerGrRoute(app: FastifyInstance): void {
  // GET /gr — the tenant's goods receipts (gr.jsx GRList). A GR hangs off EITHER
  // a PO or a WO, so the two scoped chains are UNIONed (each INNER JOIN selects
  // only the rows carrying that anchor FK — no cross-tenant leak on either).
  app.get("/gr", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }
    const [poGrs, woGrs] = await Promise.all([
      db.selectThrough(grs, GR_PO_HOPS),
      db.selectThrough(grs, GR_WO_HOPS),
    ]);
    return reply.code(200).send(listEnvelope([...poGrs, ...woGrs].map(grWire)));
  });

  // POST /gr — record a receipt against a PO (material) OR a WO (subcon work).
  // Server owns status (received). The body's lines[] aggregate into
  // received/rejected (GAP 1); any rejected qty generates a defect_report
  // (data-dictionary). Exactly one of po_id / wo_id is required and must resolve
  // to an APPROVED (open) PO/WO of this tenant. Partial (received < ordered)
  // leaves the PO/WO open; full receipt closes it (status → closed).
  app.post("/gr", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const poId = str(pick(body, "po_id", "poId")).trim();
    const woId = str(pick(body, "wo_id", "woId")).trim();
    const no = has(body, "no") ? str(pick(body, "no")).trim() || null : null;
    const rawLines = pick(body, "lines");

    // Exactly one anchor.
    if (poId && woId) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: "provide either po_id or wo_id, not both",
      });
    }
    if (!poId && !woId) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "po_id or wo_id is required" });
    }
    if (!Array.isArray(rawLines) || rawLines.length === 0) {
      return reply
        .code(400)
        .send({ code: "VALIDATION", message: "lines[] is required" });
    }

    // Aggregate the receipt lines into the single gr row (GAP 1).
    let received = 0;
    let rejected = 0;
    const photos: string[] = [];
    for (const raw of rawLines) {
      const line = (raw ?? {}) as Record<string, unknown>;
      const qtyOk = toNum(pick(line, "qty_ok", "qtyOk")) ?? 0;
      const qtyRejected = toNum(pick(line, "qty_rejected", "qtyRejected")) ?? 0;
      if (qtyOk < 0 || qtyRejected < 0) {
        return reply.code(400).send({
          code: "VALIDATION",
          message: "qty_ok / qty_rejected must be >= 0",
        });
      }
      received += qtyOk;
      rejected += qtyRejected;
      const linePhotos = pick(line, "photos");
      if (Array.isArray(linePhotos)) {
        for (const p of linePhotos) if (typeof p === "string") photos.push(p);
      }
    }

    // Resolve the anchor doc (scoped) + its source PR — a foreign/absent id
    // resolves to nothing. Only an APPROVED (issued, still-open) PO/WO may be
    // received against; a draft/pending/rejected/already-closed one is 409.
    let prId: string;
    if (poId) {
      const [po] = await db.selectThrough(pos, PO_HOPS, eq(pos.id, poId));
      if (!po) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "po not found" });
      }
      if (po.status !== "approved") {
        return reply.code(409).send({
          code: "INVALID_STATE",
          message: "goods can only be received against an approved (open) PO",
        });
      }
      prId = po.prId!;
    } else {
      const [wo] = await db.selectThrough(wos, WO_HOPS, eq(wos.id, woId));
      if (!wo) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "wo not found" });
      }
      if (wo.status !== "approved") {
        return reply.code(409).send({
          code: "INVALID_STATE",
          message: "work can only be received against an approved (open) WO",
        });
      }
      prId = wo.prId!;
    }

    // The source PR's project anchors the scoped gr + defect insert.
    const [pr] = await db.selectThrough(prs, PR_HOPS, eq(prs.id, prId));
    if (!pr) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "source pr not found" });
    }
    const projectId = pr.projectId;

    const [created] = await db.insertThrough(grs, projects, projectId, [
      {
        poId: poId || null,
        woId: woId || null,
        no,
        received: String(received),
        rejected: String(rejected),
        photos,
        status: "received",
      },
    ]);

    // Rejected qty → a defect_report (data-dictionary "ตีกลับ -> DefectReport").
    let defect: Record<string, unknown> | undefined;
    if (rejected > 0) {
      const [dr] = await db.insertThrough(defectReports, projects, projectId, [
        {
          grId: created!.id,
          note: `GR ${created!.no ?? created!.id}: ${rejected} rejected (ตีกลับ)`,
        },
      ]);
      defect = { id: dr!.id, gr_id: dr!.grId, note: dr!.note };
    }

    // Partial vs full: compare cumulative received (active GRs only) against the
    // source PR's ordered qty. Full receipt closes the PO/WO; partial leaves it
    // open. An un-quantified order (ordered = 0) never auto-closes (GAP 3).
    const ordered = await prOrderedQty(db, prId);
    const anchorGrs = poId
      ? await db.selectThrough(grs, GR_PO_HOPS, eq(grs.poId, poId))
      : await db.selectThrough(grs, GR_WO_HOPS, eq(grs.woId, woId));
    const receivedTotal = anchorGrs
      .filter((g) => g.status !== "cancelled")
      .reduce((sum, g) => sum + Number(g.received), 0);
    const full = ordered > 0 && receivedTotal >= ordered;
    if (full) {
      if (poId) {
        await db.updateThroughChain(
          pos,
          PO_HOPS,
          { status: "closed" },
          eq(pos.id, poId),
        );
      } else {
        await db.updateThroughChain(
          wos,
          WO_HOPS,
          { status: "closed" },
          eq(wos.id, woId),
        );
      }
    }

    return reply.code(201).send({
      ...grWire(created!),
      partial: !full,
      ordered_total: ordered,
      received_total: receivedTotal,
      ...(defect ? { defect_report: defect } : {}),
    });
  });

  // POST /gr/:id/return — received → returned (gr.jsx "คืนสินค้า"). Only a
  // received GR can be returned.
  app.post("/gr/:id/return", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const found = await findGr(db, id);
    if (!found) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `GR ${id} not found` });
    }
    if (found.status !== "received") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a received GR can be returned",
      });
    }
    const hops = found.poId ? GR_PO_HOPS : GR_WO_HOPS;
    const [updated] = await db.updateThroughChain(
      grs,
      hops,
      { status: "returned" },
      eq(grs.id, id),
    );
    return reply.code(200).send(grWire(updated!));
  });

  // POST /gr/:id/cancel — received → cancelled (gr.jsx "ยกเลิก"). Only a received
  // GR can be cancelled. (The prototype's "คืนงบ + ยกเลิกการผูกพัน" budget
  // restore / PO reopen is presentational and NOT modelled here — flagged.)
  app.post("/gr/:id/cancel", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const { id } = request.params as { id: string };
    const found = await findGr(db, id);
    if (!found) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `GR ${id} not found` });
    }
    if (found.status !== "received") {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a received GR can be cancelled",
      });
    }
    const hops = found.poId ? GR_PO_HOPS : GR_WO_HOPS;
    const [updated] = await db.updateThroughChain(
      grs,
      hops,
      { status: "cancelled" },
      eq(grs.id, id),
    );
    return reply.code(200).send(grWire(updated!));
  });
}

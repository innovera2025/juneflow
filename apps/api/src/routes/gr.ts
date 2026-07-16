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
// Schema (migration 0016, P2-BE-06, B-070; migration 0018, B-078/F1): gr gained
// `wo_id` (nullable) / `no` / `status`, `po_id` was made NULLABLE (a receipt
// anchors on EITHER a PO or a WO), and the gr_item child table was added so a
// receipt carries per-line detail. Data-completeness (B-078 / F1) closes the two
// former GAPs:
//   1) RESOLVED — gr_item is the per-line table. createGr writes one gr_item per
//      widened line that carries a `name` (name/ordered_qty/received_qty/unit/
//      price + boq_item_id); the gr row still keeps the aggregate received =
//      Σ qty_ok / rejected = Σ qty_rejected / flattened photos. A bare qty-only
//      line writes no gr_item (its per-line detail is honestly absent).
//   2) RESOLVED — money is derived at read time as Σ line (received_qty × price)
//      over the gr_item rows (the prototype's มูลค่า ฿) + the resolved vendor name
//      (gr → po/wo → vendor) + the receipt date (= created_at). A receipt with no
//      gr_item lines reports money 0 / ordered 0 honestly (never fabricated).
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
import {
  grs,
  grItems,
  defectReports,
  pos,
  wos,
  prs,
  projects,
  vendors,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";
import { has, pick, prOrderedQty, str, toNum } from "./procurement.js";

type GrRow = typeof grs.$inferSelect;
type GrItemRow = typeof grItems.$inferSelect;

/** uuid matcher — a widened gr line's boq_item_id must be a real uuid, else null. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A valid uuid → itself, else null (a non-uuid textual line ref is not an FK). */
function uuidOrNull(value: unknown): string | null {
  const s = str(value).trim();
  return UUID_RE.test(s) ? s : null;
}

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
// gr_item anchors one hop deeper than gr: gr_item → gr → po → pr → project, and
// gr_item → gr → wo → pr → project (B-078 / F1). A gr_item hangs off a gr that is
// itself PO- or WO-anchored, so its reads UNION the two chains exactly like gr.
const GR_ITEM_PO_HOPS = [
  { fk: grItems.grId, parent: grs },
  { fk: grs.poId, parent: pos },
  { fk: pos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
const GR_ITEM_WO_HOPS = [
  { fk: grItems.grId, parent: grs },
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

/** The opaque Entity wire shape for one GR received line (real gr_item columns). */
function grItemWire(it: GrItemRow): Record<string, unknown> {
  return {
    id: it.id,
    name: it.name,
    boq_item_id: it.boqItemId,
    ordered_qty: Number(it.orderedQty),
    received_qty: Number(it.receivedQty),
    unit: it.unit,
    price: Number(it.price),
    currency_code: it.currencyCode,
  };
}

/**
 * The opaque Entity wire shape for a GR doc (B-078 / F1 — now data-complete):
 * real gr columns + the resolved vendor name (gr → po/wo → vendor), the receipt
 * `date` (= created_at), the per-line `items` from the gr_item child table, the
 * derived `ordered_qty` (Σ line ordered) and `money` (Σ line received × price —
 * the prototype's มูลค่า ฿, now real from gr_item, not the old GAP-2 em-dash).
 * received/rejected remain the receipt totals (header GAP 1). vendor/items are
 * resolved by the caller; a receipt with no gr_item lines honestly reports
 * money 0 / ordered 0 / items [] (never fabricated).
 */
function grWire(
  gr: GrRow,
  extra: { vendor?: string | null; items?: GrItemRow[] } = {},
): Record<string, unknown> {
  const items = extra.items ?? [];
  const money = items.reduce(
    (sum, it) => sum + Number(it.receivedQty) * Number(it.price),
    0,
  );
  const orderedQty = items.reduce((sum, it) => sum + Number(it.orderedQty), 0);
  return {
    id: gr.id,
    no: gr.no,
    po_id: gr.poId,
    wo_id: gr.woId,
    status: gr.status,
    received: Number(gr.received),
    rejected: Number(gr.rejected),
    photos: gr.photos ?? [],
    vendor: extra.vendor ?? null,
    date: gr.createdAt,
    ordered_qty: orderedQty,
    money,
    currency_code: items[0]?.currencyCode ?? "THB",
    items: items.map(grItemWire),
  };
}

/**
 * Resolve a single GR's vendor name through its anchor: gr → po → po.vendor_id →
 * vendor.name, or gr → wo → wo.vendor_id → vendor.name (tenant-scoped throughout).
 * Returns null when the anchor / vendor cannot be resolved (honest, never faked).
 */
async function grVendorName(db: TenantDb, gr: GrRow): Promise<string | null> {
  let vendorId: string | null = null;
  if (gr.poId) {
    const [po] = await db.selectThrough(pos, PO_HOPS, eq(pos.id, gr.poId));
    vendorId = po?.vendorId ?? null;
  } else if (gr.woId) {
    const [wo] = await db.selectThrough(wos, WO_HOPS, eq(wos.id, gr.woId));
    vendorId = wo?.vendorId ?? null;
  }
  if (!vendorId) return null;
  const [vendor] = await db.select(vendors, eq(vendors.id, vendorId));
  return vendor?.name ?? null;
}

/** The gr_item received lines of a single GR (scoped through its PO/WO anchor). */
async function grItemsFor(db: TenantDb, gr: GrRow): Promise<GrItemRow[]> {
  const hops = gr.poId ? GR_ITEM_PO_HOPS : GR_ITEM_WO_HOPS;
  return db.selectThrough(grItems, hops, eq(grItems.grId, gr.id));
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
    // A GR row + its resolved vendor + per-line gr_items. The two scoped chains
    // are read once each (PO- and WO-anchored) and joined in memory — no N+1.
    const [poGrs, woGrs, poItems, woItems, poDocs, woDocs, vendorRows] =
      await Promise.all([
        db.selectThrough(grs, GR_PO_HOPS),
        db.selectThrough(grs, GR_WO_HOPS),
        db.selectThrough(grItems, GR_ITEM_PO_HOPS),
        db.selectThrough(grItems, GR_ITEM_WO_HOPS),
        db.selectThrough(pos, PO_HOPS),
        db.selectThrough(wos, WO_HOPS),
        db.select(vendors),
      ]);

    const itemsByGr = new Map<string, GrItemRow[]>();
    for (const it of [...poItems, ...woItems]) {
      const list = itemsByGr.get(it.grId) ?? [];
      list.push(it);
      itemsByGr.set(it.grId, list);
    }
    const vendorNameById = new Map(vendorRows.map((v) => [v.id, v.name]));
    const poVendorById = new Map(poDocs.map((p) => [p.id, p.vendorId]));
    const woVendorById = new Map(woDocs.map((w) => [w.id, w.vendorId]));
    const vendorOf = (gr: GrRow): string | null => {
      const vid = gr.poId
        ? poVendorById.get(gr.poId)
        : gr.woId
          ? woVendorById.get(gr.woId)
          : null;
      return vid ? vendorNameById.get(vid) ?? null : null;
    };

    return reply.code(200).send(
      listEnvelope(
        [...poGrs, ...woGrs].map((gr) =>
          grWire(gr, { vendor: vendorOf(gr), items: itemsByGr.get(gr.id) ?? [] }),
        ),
      ),
    );
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

    // Aggregate the receipt lines into the single gr row (GAP 1) AND capture the
    // widened per-line detail (B-078 / F1): a line that carries a `name` becomes a
    // gr_item child row (name/ordered/received/unit/price). A bare line (qty only,
    // no name — the legacy shape) writes no gr_item, so the per-line detail is
    // honestly absent rather than fabricated.
    let received = 0;
    let rejected = 0;
    const photos: string[] = [];
    const itemDrafts: Omit<typeof grItems.$inferInsert, "grId">[] = [];
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

      const name = str(pick(line, "name")).trim();
      if (name) {
        const orderedQty = toNum(pick(line, "ordered_qty", "orderedQty")) ?? qtyOk;
        const price = toNum(pick(line, "price")) ?? 0;
        const unit = has(line, "unit") ? str(pick(line, "unit")).trim() || null : null;
        itemDrafts.push({
          boqItemId: uuidOrNull(pick(line, "boq_item_id", "boqItemId")),
          name,
          orderedQty: String(orderedQty),
          // received_qty of the line = its good-received quantity (qty_ok).
          receivedQty: String(qtyOk),
          unit,
          price: price.toFixed(2),
          currencyCode:
            str(pick(line, "currency_code", "currencyCode")).trim() || "THB",
        });
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

    // Persist the per-line detail (B-078 / F1) — anchored on the same tenant-owned
    // project as the gr, so the write is fail-closed by construction.
    let createdItems: GrItemRow[] = [];
    if (itemDrafts.length) {
      createdItems = await db.insertThrough(
        grItems,
        projects,
        projectId,
        itemDrafts.map((d) => ({ ...d, grId: created!.id })),
      );
    }

    // Resolve the receipt's vendor name through the anchor doc (scoped).
    const vendorName = await grVendorName(db, created!);

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
      .filter((g) => g.status === "received")
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
      ...grWire(created!, { vendor: vendorName, items: createdItems }),
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
    const [vendor, items] = await Promise.all([
      grVendorName(db, updated!),
      grItemsFor(db, updated!),
    ]);
    return reply.code(200).send(grWire(updated!, { vendor, items }));
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
    const [vendor, items] = await Promise.all([
      grVendorName(db, updated!),
      grItemsFor(db, updated!),
    ]);
    return reply.code(200).send(grWire(updated!, { vendor, items }));
  });
}

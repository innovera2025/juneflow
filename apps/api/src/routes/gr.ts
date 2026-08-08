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
import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import {
  grs,
  grItems,
  defectReports,
  pos,
  wos,
  prs,
  projects,
  vendors,
  inventoryItems,
  stockLedgers,
  warehouses,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";
import { entryOrder, newestFirst, stampEntryOrder } from "./list-order.js";
import { round2 } from "./money.js";
import { isUniqueViolation, violatedConstraint } from "./gl-post.js";
import {
  has,
  pick,
  prOrderedQty,
  readIdempotencyKey,
  str,
  toNum,
} from "./procurement.js";

type GrRow = typeof grs.$inferSelect;
type GrItemRow = typeof grItems.$inferSelect;

/**
 * The partial unique index (migration 0056, packages/db/src/schema/boq.ts) that
 * dedups a replayed POST /gr. B-263: the replay catch gates on THIS name, not on
 * SQLSTATE 23505 alone — see the catch below.
 */
const GR_IDEMPOTENCY_CONSTRAINT = "gr_idempotency_uq";

// ---------------------------------------------------------------------------
// B-340 — the goods receipt is the stock_ledger's INBOUND writer
// ---------------------------------------------------------------------------
// Until this round `insert(stockLedgers` existed at exactly TWO sites, both in
// inventory.ts: transfer-approve (two legs, NET ZERO) and material-issue (−qty
// only). Nothing ever added stock. Proven live on a freshly seeded stack at
// 2f42244: GET /inventory/stock returned an EMPTY list, and an issue of 10 against
// a seeded item answered `409 insufficient stock … on-hand 0`. Σ(qty) was 0 for
// every (item, warehouse), so stock could only ever go DOWN, a transfer could not
// manufacture stock (its own source is 0 too), and the merged `field-stock` mobile
// screen was correct against the wire and honest-empty forever.
//
// WHERE THE STOCK LANDS, and why it is NOT a column on `gr`.
// stock_ledger needs (item_id, warehouse_id, qty) with BOTH FKs NOT NULL. A receipt
// knew NEITHER: `gr` has no warehouse column (grep for "warehouse" across every
// schema file but extensions.ts → 0 hits — not on project, po/wo/pr, or vendor), and
// `gr_item` carries boq_item_id + free-text name, with no column linking a line to an
// inventory_item. So BOTH axes arrive as REQUEST fields, and the movement is
// addressed by ref_doc (`gr:<id>`) exactly as transfers and issues already are.
//
// The column was considered and deliberately refused: `extensions.ts` already imports
// `boq.ts`, so declaring gr.warehouseId.references(() => warehouses.id) would create
// the schema layer's FIRST import cycle. stock_ledger already stores both axes as
// NOT NULL FKs, so the ledger row is a strictly better home than a nullable column
// that would duplicate it. TRADE-OFF, stated rather than hidden: attribution is
// PER-RECEIPT, not per gr_item row, and a receipt that names a warehouse but
// identifies no stocked line stores its destination nowhere (nothing moved, so there
// is no movement to attribute).
//
// WHY THE ITEM IS NEVER INFERRED. Matching a received line to an inventory_item by
// code or name was refused on evidence, not taste: the seed's BOQ and inventory
// catalogues genuinely diverge — BOQ has MAT-WIRE-22, inventory has MAT-WIRE-25 with
// the SAME name and a different code, and BOQ's MAT-CEM-002 / MAT-PLB-018 / every
// SUB-*/LAB-*/SITE-* have no inventory counterpart at all. A fuzzy match on a
// stock-and-money path would silently credit the wrong material. A line without an
// explicit item_id therefore moves NO stock, and says so.

/** A quantity as the stock_ledger numeric(18,4) column string (inventory.ts idiom). */
function qtyStr(n: number): string {
  return n.toFixed(4);
}

/**
 * THE REPO-WIDE LOCK ORDER on `inventory_item`: ASCENDING id. Both stock_ledger writers
 * in this file sort through here before they start inserting.
 *
 * WHY A LEDGER INSERT IS A LOCK-TAKER AT ALL — invisible at the call site, and what this
 * round shipped without. `stock_ledger.item_id` is an FK, so every INSERT takes an
 * implicit `SELECT 1 FROM inventory_item … FOR KEY SHARE` on the referenced row. FOR KEY
 * SHARE CONFLICTS with the FOR UPDATE that TenantDb.selectForUpdate takes on the same
 * rows (inventory.ts transfer-approve + createIssue, B-342, this same round).
 * selectForUpdate sorts (ORDER BY id); this file inserted in BODY-LINE order, so a
 * receipt whose lines ran opposite to an issue's grabbed the same rows in the opposite
 * order.
 *
 * MEASURED at 87e10c2, API-vs-API, 2 SEPARATE OS PROCESSES on one epoch-ms barrier, 14
 * rounds, 8 overlapping items, GR lines DESCENDING vs issue lines ASCENDING: 8 rounds
 * ended in a 500 and the api log carried 8 PG "deadlock detected" (40P01) — the two
 * failing statements being exactly the two this round added, and EITHER side able to be
 * the victim (7 issue, 1 gr). `grep -rn "40P01\|deadlock" apps/api/src` finds no handler,
 * so 40P01 rethrows to the 500 handler, and sync_processor.dart DEFERS a 5xx: one
 * receipt that deadlocks stops the phone's ENTIRE offline drain and deadlocks again on
 * every retry. That is the exact wedge labor.ts's ATTENDANCE_COSTED_DAY_CONSTRAINT
 * comment was written to avoid ("WITHOUT this name the pair would answer 500 … and
 * sync_processor.dart DEFERS a 5xx and stops the whole offline drain"), reintroduced one
 * file over by a different mechanism.
 *
 * WHY SORTING AND NOT `selectForUpdate` HERE — both close the cycle; this is the reason
 * for the choice:
 *   - a receipt needs no consistent read. It only ever RAISES a balance, so there is no
 *     read-then-write invariant to protect. FOR UPDATE would take a STRONGER lock than
 *     the FK requires and queue a storekeeper's receipt behind a site issue of the same
 *     material for zero correctness gain;
 *   - it would add a failure mode (the `locked.length !== itemIds.length` throw) to a
 *     path that already resolved ownership above, plus a round trip per receipt;
 *   - and it would NOT cover reverseGrMovements, whose reversal has nothing to guard and
 *     no honest place to take a guard lock — so the return/cancel path would still need
 *     a sort. One mechanism for both writers beats two.
 * Sorting restores the invariant selectForUpdate's own comment already depends on,
 * instead of adding a second, competing one.
 *
 * WHY ASCENDING *STRING* ORDER IS THE ORDER POSTGRES USES: `uuid` compares as its 16 raw
 * bytes, and the canonical LOWERCASE hex text form sorts identically byte for byte (hex
 * digits 0-9 then a-f are ASCII-ordered). uuidOrNull therefore lower-cases — a client
 * sending `A0…` would otherwise sort before `b0…` in ASCII while Postgres puts it after,
 * which is exactly the mismatch this ordering exists to remove. Verified live:
 * `array_agg(id ORDER BY id)` = `array_agg(id ORDER BY id::text)` over the catalogue.
 */
function inLockOrder<T extends { itemId: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
}

/**
 * REVERSE every movement a receipt made (B-340) — used by return AND cancel.
 *
 * Shipping the inbound leg ALONE would create a defect that does not exist today:
 * goods returned to the vendor would stay on the shelf forever, removable only by
 * issuing them to a project, i.e. by lying twice. The round that adds the increment
 * owns the decrement.
 *
 * TWO details are load-bearing:
 *   - the reversal rows carry a DIFFERENT ref_doc (`gr-return:` / `gr-cancel:`), so a
 *     later read of `gr:<id>` cannot pick up its own negations and re-negate them;
 *   - the caller must have ALREADY won the guarded status UPDATE before calling this,
 *     so the loser of a concurrent return/cancel writes nothing.
 *
 * NO NEGATIVE-STOCK GUARD, deliberately. If the received 100 were already issued
 * (Σ = 0) and the receipt is then returned, this drives Σ to −100. Guarding it would
 * REFUSE a legitimate return because of a downstream issue the storekeeper cannot
 * undo — rejecting real work at the door. Allowing it records the truth: the goods
 * left twice, and the books say so loudly instead of quietly.
 *
 * THE INSERTS ARE SORTED (inLockOrder — see its comment). The read above has no ORDER BY
 * at all, so without the sort this loop takes its FK row locks on `inventory_item` in
 * whatever order the plan returned the rows — the same deadlock the create path was
 * measured deadlocking with, on a path where a 40P01 would 500 a RETURN.
 */
async function reverseGrMovements(
  tx: TenantDb,
  grId: string,
  refPrefix: "gr-return" | "gr-cancel",
): Promise<void> {
  const originals = await tx.select(stockLedgers, eq(stockLedgers.refDoc, `gr:${grId}`));
  for (const row of inLockOrder(originals)) {
    await tx.insert(stockLedgers, {
      itemId: row.itemId,
      warehouseId: row.warehouseId,
      qty: qtyStr(-Number(row.qty)),
      refDoc: `${refPrefix}:${grId}`,
    });
  }
}

/** uuid matcher — a widened gr line's boq_item_id must be a real uuid, else null. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A valid uuid → its CANONICAL LOWERCASE form, else null (a non-uuid textual line ref is
 * not an FK). The regex is case-insensitive and Postgres accepts either case on input,
 * so the case was previously carried through verbatim; it is normalised here because
 * inLockOrder sorts these strings and only the lowercase form sorts the way `uuid` does.
 * Nothing else observes the difference — both call sites feed `uuid` columns.
 */
function uuidOrNull(value: unknown): string | null {
  const s = str(value).trim();
  return UUID_RE.test(s) ? s.toLowerCase() : null;
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
// defect_report anchors exactly like gr_item — defect_report → gr → po/wo → pr →
// project — so an idempotency REPLAY (B-261) re-reads the ORIGINAL receipt's
// defect through the tenant-scoped chain (never a bare global select).
const DEFECT_PO_HOPS = [
  { fk: defectReports.grId, parent: grs },
  { fk: grs.poId, parent: pos },
  { fk: pos.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
const DEFECT_WO_HOPS = [
  { fk: defectReports.grId, parent: grs },
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
  // Σ(received_qty × price) is a JS-float product-sum → round to the 2-dp minor
  // unit at the wire so accumulation drift never surfaces (B-085 fix 3).
  const money = round2(
    items.reduce((sum, it) => sum + Number(it.receivedQty) * Number(it.price), 0),
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

/**
 * The gr_item received lines of a single GR (scoped through its PO/WO anchor), in
 * ENTRY order — the order they were typed into the receipt form. `selectThrough`
 * emits INNER JOINs with no ORDER BY, so the raw row order is a join-plan artefact.
 */
async function grItemsFor(db: TenantDb, gr: GrRow): Promise<GrItemRow[]> {
  const hops = gr.poId ? GR_ITEM_PO_HOPS : GR_ITEM_WO_HOPS;
  return entryOrder(await db.selectThrough(grItems, hops, eq(grItems.grId, gr.id)));
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

/** The derived pieces of a GR create/replay response beyond the receipt itself. */
type GrEnvelopeParts = {
  vendor: string | null;
  items: GrItemRow[];
  ordered: number;
  receivedTotal: number;
  full: boolean;
  defect?: Record<string, unknown>;
};

/**
 * The 201 create/replay response shape: grWire (the receipt — id, no,
 * received/rejected, vendor, per-line items, derived money) plus the cumulative
 * partial / ordered_total / received_total envelope and any defect_report. Shared
 * by the fresh create AND the B-261 idempotency REPLAY so a replayed POST returns
 * the SAME shape as the original — the client sees its own receipt, never a dup.
 */
function grCreateEnvelope(
  gr: GrRow,
  parts: GrEnvelopeParts,
): Record<string, unknown> {
  return {
    ...grWire(gr, { vendor: parts.vendor, items: parts.items }),
    partial: !parts.full,
    ordered_total: parts.ordered,
    received_total: parts.receivedTotal,
    ...(parts.defect ? { defect_report: parts.defect } : {}),
  };
}

/**
 * The ORIGINAL receipt's defect_report (tenant-scoped), for a B-261 replay — READ,
 * never re-created: a replay is the same logical receipt, not a new rejection.
 */
async function existingGrDefect(
  db: TenantDb,
  gr: GrRow,
): Promise<Record<string, unknown> | undefined> {
  const hops = gr.poId ? DEFECT_PO_HOPS : DEFECT_WO_HOPS;
  const [dr] = await db.selectThrough(
    defectReports,
    hops,
    eq(defectReports.grId, gr.id),
  );
  return dr ? { id: dr.id, gr_id: dr.grId, note: dr.note } : undefined;
}

/**
 * Resolve the ORIGINAL receipt behind a client idempotency_key, scoped through the
 * SAME po/wo → pr → project chain every other read in this file uses (selectThrough
 * with GR_PO_HOPS / GR_WO_HOPS — identical to findGr / grItemsFor / the create's own
 * anchorGrs read). Two filters, BOTH load-bearing:
 *   - the tenant chain — a key-only lookup would let one company's replay resolve
 *     ANOTHER company's receipt (gr_idempotency_uq is a GLOBAL partial index on
 *     idempotency_key alone, so a cross-tenant key clash is physically possible);
 *   - the ANCHOR (po_id / wo_id) — the same key replayed against a DIFFERENT PO must
 *     NOT hand back the first PO's receipt. Handing back someone else's document is
 *     worse than a 409, so a non-matching anchor deliberately resolves to null: the
 *     caller falls through to the insert, trips the global index, and the catch
 *     answers the honest 409 "idempotency_key already used".
 * Used by BOTH the B-264 pre-check and the B-261 23505 catch — one resolver, so the
 * two paths can never diverge on what counts as "the client's own receipt".
 */
async function findGrByIdempotencyKey(
  db: TenantDb,
  args: { idempotencyKey: string; poId: string; woId: string },
): Promise<GrRow | null> {
  const { idempotencyKey, poId, woId } = args;
  const hops = poId ? GR_PO_HOPS : GR_WO_HOPS;
  const anchorEq = poId ? eq(grs.poId, poId) : eq(grs.woId, woId);
  const [existing] = await db.selectThrough(
    grs,
    hops,
    and(eq(grs.idempotencyKey, idempotencyKey), anchorEq),
  );
  return existing ?? null;
}

/**
 * Rebuild and send the 201 create envelope for an ALREADY-PERSISTED receipt — same
 * id, same received/rejected, money re-read not recomputed, never a second write.
 * The ONLY place a replay 201 is produced (both the B-264 pre-check and the B-261
 * 23505 catch call it), so a replayed POST is byte-identical to the original create
 * BY CONSTRUCTION rather than by two hand-built shapes happening to agree today.
 */
async function sendExistingGr(
  db: TenantDb,
  reply: FastifyReply,
  existing: GrRow,
  args: { poId: string; woId: string; prId: string },
): Promise<FastifyReply> {
  const { poId, woId, prId } = args;
  // Re-derive the envelope from persisted state (never a second write): the
  // per-line items, the resolved vendor, the cumulative partial/full against the
  // source PR, and the receipt's existing defect_report (if a rejection).
  const items = await grItemsFor(db, existing);
  const vendor = await grVendorName(db, existing);
  const ordered = await prOrderedQty(db, prId);
  const anchorGrs = poId
    ? await db.selectThrough(grs, GR_PO_HOPS, eq(grs.poId, poId))
    : await db.selectThrough(grs, GR_WO_HOPS, eq(grs.woId, woId));
  const receivedTotal = anchorGrs
    .filter((g) => g.status === "received")
    .reduce((sum, g) => sum + Number(g.received), 0);
  const full = ordered > 0 && receivedTotal >= ordered;
  const defect = await existingGrDefect(db, existing);
  return reply.code(201).send(
    grCreateEnvelope(existing, {
      vendor,
      items,
      ordered,
      receivedTotal,
      full,
      defect,
    }),
  );
}

/**
 * B-261 idempotency REPLAY, reached from the 23505 CATCH. The gr insert tripped
 * gr_idempotency_uq: a POST /gr carrying a previously-seen idempotency_key is the
 * mobile SyncProcessor's at-least-once retry, NOT a new receipt. This is the
 * CONCURRENCY BACKSTOP for the B-264 pre-check — the pre-check read nothing, then a
 * racing replay of the same key committed before our insert. A key that collided at
 * the DB layer but resolves to nothing in THIS tenant/anchor (a cross-tenant clash,
 * or the same key against a different PO) is a 409 — never a leak, never a
 * fabricated receipt. Kept deliberately: a pre-check is NOT a substitute for the
 * unique index + catch (money-post-idempotency lesson).
 */
async function replayExistingGr(
  db: TenantDb,
  reply: FastifyReply,
  args: { idempotencyKey: string; poId: string; woId: string; prId: string },
): Promise<FastifyReply> {
  const existing = await findGrByIdempotencyKey(db, args);
  if (!existing) {
    return reply.code(409).send({
      code: "INVALID_STATE",
      message: "idempotency_key already used",
    });
  }
  return sendExistingGr(db, reply, existing, args);
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

    // B-323: the two item chains are read as separate INNER-JOIN queries whose
    // relative row order is a join-plan artefact, so a GR's lines could arrive
    // interleaved differently on two stacks. That is not cosmetic — grWire labels
    // the whole receipt with `items[0].currency_code`.
    //
    // ENTRY order, not newest-first. A receipt's lines are its ordered body, and
    // round 1's `newestFirst` here was the exact mistake this module's header warns
    // about: it is a no-op under the seed's stagger, but in production one
    // `insertThrough` gives every line the same `now()` and the comparator falls
    // through to the random uuid. POST /gr stamps the lines apart (stampEntryOrder)
    // so ascending time IS entry order; this read puts them back in it.
    const itemsByGr = new Map<string, GrItemRow[]>();
    for (const it of entryOrder([...poItems, ...woItems])) {
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

    // B-323: sort AFTER the concat, never per-arm. Ordering each chain and shipping
    // `[...poGrs, ...woGrs]` still yields "every PO-anchored receipt, then every
    // WO-anchored one" — deterministic-looking but not a date order, and a
    // plausible non-fix.
    return reply.code(200).send(
      listEnvelope(
        newestFirst([...poGrs, ...woGrs]).map((gr) =>
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
    // B-261: the client's idempotency key for the mobile offline SyncProcessor's
    // at-least-once replay. Absent / null / blank → null (web clients are unchanged;
    // the partial unique index exempts nulls, so no dedup path fires without a key).
    // B-309: a PRESENT but non-string key is a 400 — it used to be swallowed by str()
    // and silently turn dedup OFF while the client believed it had sent a key. Shared
    // parser (readIdempotencyKey) so this handler and POST /labor/attendance cannot
    // drift on what counts as a key. The guard sits AT the read on purpose: no insert,
    // no read, and no state gate can run ahead of it.
    const idem = readIdempotencyKey(body);
    if (!idem.ok) {
      return reply.code(400).send({ code: "VALIDATION", message: idem.message });
    }
    const idempotencyKey = idem.key;
    // B-340: the destination warehouse for the received goods. Optional at the wire —
    // a receipt that identifies no stocked line is recorded exactly as it was before
    // this round — but REQUIRED the moment any line carries an item_id (checked below,
    // after the lines are parsed).
    const warehouseId = str(pick(body, "warehouse_id", "warehouseId")).trim();
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
    // B-340: the stock movements this receipt will make, accumulated as the lines are
    // parsed and written INSIDE the create transaction below.
    const stockDrafts: { itemId: string; qty: number }[] = [];
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

      // B-340: a line that names an inventory_item MOVES STOCK. qty_ok only —
      // REJECTED QUANTITY IS NOT RECEIVED INTO STOCK (it generates the defect report
      // below and goes back to the vendor), so a receipt of 100 with 10 rejected adds
      // 90, not 100. A zero-qty_ok line is skipped rather than writing a no-op 0 row.
      const itemId = uuidOrNull(pick(line, "item_id", "itemId"));
      if (itemId && qtyOk > 0) stockDrafts.push({ itemId, qty: qtyOk });
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

    // Mixed-currency guard (B-085 fix 4): grWire sums Σ(received_qty × price)
    // across ALL lines but labels the receipt with items[0].currency_code — so a
    // receipt whose lines carry more than one currency would silently sum across
    // currencies under a single (wrong) label. One receipt = one currency: reject
    // at create rather than emit a meaningless cross-currency total.
    const currencies = new Set(itemDrafts.map((d) => d.currencyCode));
    if (currencies.size > 1) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: "all received lines must share one currency_code (one receipt = one currency)",
      });
    }

    // Resolve the anchor doc (scoped) + its source PR — a foreign/absent id
    // resolves to nothing (404 regardless of any idempotency key: a replay against
    // an anchor that is not ours must never be answered from our data).
    let prId: string;
    let anchorStatus: string;
    if (poId) {
      const [po] = await db.selectThrough(pos, PO_HOPS, eq(pos.id, poId));
      if (!po) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "po not found" });
      }
      prId = po.prId!;
      anchorStatus = po.status;
    } else {
      const [wo] = await db.selectThrough(wos, WO_HOPS, eq(wos.id, woId));
      if (!wo) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "wo not found" });
      }
      prId = wo.prId!;
      anchorStatus = wo.status;
    }

    // B-340: resolve the STOCK axes, and do it HERE — after the anchor, before the
    // idempotency pre-check — for the same reason createIssue does: a foreign
    // warehouse or item is a 400 REGARDLESS of any key, because a replay against
    // something that is not ours must never be answered from our data.
    //
    // The warehouse is REQUIRED as soon as any line identifies stock: stock_ledger's
    // warehouse_id is NOT NULL and there is nothing honest to default it to.
    // DELIBERATELY NOT FABRICATED — inventory_item.warehouse_id (a nullable "home"
    // warehouse on master data) would silently route a Block-B delivery into the
    // central store, and the anchor chain carries no warehouse at any hop.
    if (stockDrafts.length > 0 && !warehouseId) {
      return reply.code(400).send({
        code: "VALIDATION",
        message:
          "warehouse_id is required when a line carries item_id (received stock must land somewhere)",
      });
    }
    if (warehouseId) {
      const [wh] = await db.select(warehouses, eq(warehouses.id, warehouseId));
      if (!wh) {
        return reply.code(400).send({
          code: "VALIDATION",
          message: "warehouse_id not found in this tenant",
        });
      }
    }
    if (stockDrafts.length > 0) {
      const itemIds = [...new Set(stockDrafts.map((d) => d.itemId))];
      const owned = await db.select(inventoryItems, inArray(inventoryItems.id, itemIds));
      const ownedIds = new Set(owned.map((it) => it.id));
      for (const id of itemIds) {
        if (!ownedIds.has(id)) {
          return reply.code(400).send({
            code: "VALIDATION",
            message: `item ${id} not found in this tenant`,
          });
        }
      }
    }

    // B-264: the idempotency PRE-CHECK, deliberately placed BEFORE the anchor
    // status gate below. A FULL (order-closing) receipt — st-receive's default,
    // since mobile-field.jsx defaults recv = ordered — sets the PO/WO to `closed`
    // in this very handler, so a SyncProcessor replay of that receipt would hit the
    // gate and be told 409 INVALID_STATE for goods that were actually received;
    // sync_processor.dart dead-letters every 4xx permanently, so the storekeeper
    // saw FAILED with no in-app recovery. Resolving the client's OWN receipt first
    // makes the replay reachable on the happy path. Fall through when nothing
    // resolves — a key that is new (or belongs to another anchor/tenant) still
    // meets the full gate below, so a FRESH receipt against a closed PO is still
    // 409, and the 23505 catch remains the concurrency backstop.
    if (idempotencyKey) {
      const existing = await findGrByIdempotencyKey(db, { idempotencyKey, poId, woId });
      if (existing) {
        return sendExistingGr(db, reply, existing, { poId, woId, prId });
      }
    }

    // Only an APPROVED (issued, still-open) PO/WO may be received against; a
    // draft/pending/rejected/already-closed one is 409.
    if (anchorStatus !== "approved") {
      return reply.code(409).send(
        poId
          ? {
              code: "INVALID_STATE",
              message: "goods can only be received against an approved (open) PO",
            }
          : {
              code: "INVALID_STATE",
              message: "work can only be received against an approved (open) WO",
            },
      );
    }

    // The source PR's project anchors the scoped gr + defect insert.
    const [pr] = await db.selectThrough(prs, PR_HOPS, eq(prs.id, prId));
    if (!pr) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "source pr not found" });
    }
    const projectId = pr.projectId;

    // B-261: the receipt insert carries the client idempotency_key. A REPLAY (the
    // SyncProcessor retrying a create it never heard back on) trips the
    // gr_idempotency_uq partial unique index → 23505; we catch it and return the
    // ORIGINAL receipt instead of creating a duplicate. Entering that branch needs
    // ALL THREE of: a key present (the partial index exempts nulls, so a keyless
    // insert can never dedup), SQLSTATE 23505, and — B-263 — the violated
    // constraint being gr_idempotency_uq BY NAME. The name check is the
    // load-bearing hardening: 23505 alone only says "some unique constraint", so a
    // future unique index on gr (say a unique `no`) would otherwise inherit the
    // replay path and answer a wrong-ish 409/receipt for an unrelated collision.
    // Anything else — including a 23505 that names another constraint — rethrows to
    // the 500 handler, which is the safe failure for a money write (no row written,
    // client retries) rather than a confidently wrong answer.
    //
    // B-340 MADE THIS TRANSACTIONAL, and the ORDER inside it is the whole guarantee.
    // Before this round the receipt path was FOUR independent statements (header,
    // gr_item, defect, PO/WO auto-close). That was tolerable while nothing moved
    // stock; the moment a +qty row exists it is not.
    //
    // The header insert is the FIRST statement in the block — the same construction
    // and the same reason as createIssue (inventory.ts): the 23505 on
    // gr_idempotency_uq then rolls the WHOLE block back BEFORE any stock_ledger row
    // exists, so replay-safety of the stock movement is STRUCTURAL rather than a
    // compensating action. The ledger write sits INSIDE the guard that makes the
    // receipt idempotent, not beside it (the B-340 ruling's explicit requirement).
    //
    // THE REPLAY, all four interleavings:
    //  1. SEQUENTIAL replay — the B-264 pre-check above resolves the original and
    //     returns it. This transaction is NEVER ENTERED, so no second ledger row.
    //  2. CONCURRENT replay — both pass the pre-check and enter; one commits, the
    //     other's HEADER insert trips gr_idempotency_uq → 23505 → its whole tx rolls
    //     back INCLUDING its ledger rows → the catch replays the original. Σ unchanged.
    //  3. Same key, DIFFERENT anchor — the pre-check filters on the anchor and
    //     resolves null; the insert trips the GLOBAL partial index; replayExistingGr
    //     re-resolves with the new anchor, finds nothing → 409, tx rolled back, no
    //     ledger row.
    //  4. KEYLESS duplicate — two receipts, two movements. This is the pre-existing
    //     B-261 contract (the index is PARTIAL), and it is NOT a replay: two genuine
    //     deliveries against one PO on one day are legitimate, which is why no index
    //     can close it. But it now inflates STOCK as well as receipt count, and the
    //     web GR form sends no key — reported, and fixable only client-side.
    let created: GrRow | undefined;
    let createdItems: GrItemRow[] = [];
    let defect: Record<string, unknown> | undefined;
    try {
      await db.transaction(async (tx) => {
        [created] = await tx.insertThrough(grs, projects, projectId, [
          {
            poId: poId || null,
            woId: woId || null,
            no,
            received: String(received),
            rejected: String(rejected),
            photos,
            status: "received",
            idempotencyKey,
          },
        ]);

        // Persist the per-line detail (B-078 / F1) — anchored on the same tenant-owned
        // project as the gr, so the write is fail-closed by construction.
        //
        // B-323: RECORD the entry order. This is one INSERT, so `defaultNow()` would give
        // all N lines the transaction's single `now()`; every reader then falls through to
        // the `defaultRandom()` uuid and a 3-line receipt renders in uuid order. gr_item
        // has no `seq` column, so `created_at` is the only place entry order can live —
        // stampEntryOrder spaces the lines 1 ms apart in body order.
        if (itemDrafts.length) {
          createdItems = await tx.insertThrough(
            grItems,
            projects,
            projectId,
            stampEntryOrder(itemDrafts.map((d) => ({ ...d, grId: created!.id }))),
          );
        }

        // B-340: THE INBOUND MOVEMENT. One +qty row per line that identified stock,
        // ref_doc `gr:<id>` — mirroring `transfer:<id>` / `issue:<id>` exactly. qty is
        // SIGNED and this is the only writer that emits a POSITIVE one. NO negative-
        // stock guard: a receipt only ever RAISES a balance, so it can neither drive Σ
        // below zero nor race an issue into doing so (an issue that commits either
        // before or after this one simply sees less or more stock, and is honest either
        // way). stock_ledger carries company_id → the scoped insert door force-sets it;
        // there is no bulk door, so this is a loop, exactly as at inventory.ts
        // transfer-approve / issue-post.
        //
        // IN LOCK ORDER, and the earlier claim of "NO lock" here was FALSE — see
        // inLockOrder. This loop takes an FK `FOR KEY SHARE` on each referenced
        // inventory_item, which conflicts with selectForUpdate's FOR UPDATE, so it must
        // acquire ASCENDING by item id like every other lock taker. Body-line order
        // deadlocked 8 of 14 measured rounds against a concurrent issue (40P01 → 500 →
        // the phone's whole offline drain wedged, because sync_processor.dart defers a
        // 5xx and the retry deadlocks again).
        for (const d of inLockOrder(stockDrafts)) {
          await tx.insert(stockLedgers, {
            itemId: d.itemId,
            warehouseId,
            qty: qtyStr(d.qty),
            refDoc: `gr:${created!.id}`,
          });
        }

        // Rejected qty → a defect_report (data-dictionary "ตีกลับ -> DefectReport").
        if (rejected > 0) {
          const [dr] = await tx.insertThrough(defectReports, projects, projectId, [
            {
              grId: created!.id,
              note: `GR ${created!.no ?? created!.id}: ${rejected} rejected (ตีกลับ)`,
            },
          ]);
          defect = { id: dr!.id, gr_id: dr!.grId, note: dr!.note };
        }
      });
    } catch (err) {
      if (
        idempotencyKey &&
        isUniqueViolation(err) &&
        violatedConstraint(err) === GR_IDEMPOTENCY_CONSTRAINT
      ) {
        return replayExistingGr(db, reply, { idempotencyKey, poId, woId, prId });
      }
      throw err;
    }

    // Resolve the receipt's vendor name through the anchor doc (scoped).
    const vendorName = await grVendorName(db, created!);

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
      // B-156: auto-close is an idempotent side-effect — guard on the receivable
      // 'approved' pre-state (5th arg) so two concurrent fully-receiving GRs close
      // the PO/WO exactly once (the loser matches 0 rows → harmless no-op, no error).
      if (poId) {
        await db.updateThroughChain(
          pos,
          PO_HOPS,
          { status: "closed" },
          eq(pos.id, poId),
          eq(pos.status, "approved"),
        );
      } else {
        await db.updateThroughChain(
          wos,
          WO_HOPS,
          { status: "closed" },
          eq(wos.id, woId),
          eq(wos.status, "approved"),
        );
      }
    }

    // B-261: the fresh create and the replay share ONE envelope shape — a replayed
    // POST returns byte-for-byte what the original create returned.
    return reply.code(201).send(
      grCreateEnvelope(created!, {
        vendor: vendorName,
        items: createdItems,
        ordered,
        receivedTotal,
        full,
        defect,
      }),
    );
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
    // B-156: fold the 'received' pre-state into the FINAL update (5th guard arg) so a
    // concurrent return/cancel of the same GR re-matches 0 rows → 409 (atomic; the
    // updateThroughChain resolve-then-update is otherwise a TOCTOU).
    //
    // B-340: the status flip and the STOCK REVERSAL are now ONE transaction, and the
    // guarded UPDATE goes FIRST. Exactly-once was already solved here — only one
    // concurrent caller can ever match the 'received' pre-state — so the loser writes
    // no reversal rows at all, and a returned receipt's goods leave the shelf exactly
    // once. Without this a returned delivery would stay on the shelf forever,
    // removable only by issuing it to a project.
    let updated: GrRow | undefined;
    await db.transaction(async (tx) => {
      [updated] = await tx.updateThroughChain(
        grs,
        hops,
        { status: "returned" },
        eq(grs.id, id),
        eq(grs.status, "received"),
      );
      if (!updated) return;
      await reverseGrMovements(tx, id, "gr-return");
    });
    if (!updated) {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a received GR can be returned",
      });
    }
    const [vendor, items] = await Promise.all([
      grVendorName(db, updated),
      grItemsFor(db, updated),
    ]);
    return reply.code(200).send(grWire(updated, { vendor, items }));
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
    // B-156: 'received' pre-state folded into the FINAL update (atomic guard).
    // B-340: same shape as return — guarded UPDATE first, then the stock reversal,
    // both in one transaction. A cancelled receipt's goods leave the shelf too;
    // the only difference is the ref_doc that records why.
    let updated: GrRow | undefined;
    await db.transaction(async (tx) => {
      [updated] = await tx.updateThroughChain(
        grs,
        hops,
        { status: "cancelled" },
        eq(grs.id, id),
        eq(grs.status, "received"),
      );
      if (!updated) return;
      await reverseGrMovements(tx, id, "gr-cancel");
    });
    if (!updated) {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "only a received GR can be cancelled",
      });
    }
    const [vendor, items] = await Promise.all([
      grVendorName(db, updated),
      grItemsFor(db, updated),
    ]);
    return reply.code(200).send(grWire(updated, { vendor, items }));
  });
}

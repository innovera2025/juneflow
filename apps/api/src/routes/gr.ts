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
//
// B-348 — THE RECEIPT NOW CARRIES MONEY, AND THE MONEY IS THE SERVER'S.
//   1. `gr_item.price` is DERIVED at create from `boq_item.price` through the
//      line's own `boq_item_id`, resolved via the scoped BOQ_ITEM_HOPS door. Any
//      `price` / `currency_code` in the body is IGNORED. Before this, both came
//      straight off the request, which was harmless only while the column fed a
//      display field; gl-posting.ts now derives a POSTED GL amount from these
//      rows, so a client value would originate a money figure.
//      B-360 NARROWED THE SOURCE SET: tenant scope alone let the client pick
//      WHICH of the tenant's prices to charge (proven live: 3.68M booked on a
//      612K order). The id must now be a line of the receipt's OWN order —
//      `pr_item.boq_item_id` of its source PR — or the request is 400.
//   2. A named line with no `boq_item_id` has no server price source and stores
//      0.00 — "unknown", not "zero baht" — and gl-posting refuses to post a
//      receipt whose measurable total is 0.
//   3. A POSTED receipt can no longer be returned or cancelled (409). See the
//      note above GrAlreadyPostedError for why, what it costs, and the residual
//      race that is filed rather than hidden.
import type { FastifyInstance, FastifyReply } from "fastify";
import { and, eq, inArray } from "drizzle-orm";
import {
  grs,
  grItems,
  boqDocs,
  boqGroups,
  boqItems,
  defectReports,
  jvs,
  pos,
  wos,
  prs,
  prItems,
  projects,
  vendors,
  inventoryItems,
  stockLedgers,
  warehouses,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";
import { entryOrder, newestFirst, stampEntryOrder } from "./list-order.js";
import { inLockOrder } from "./lock-order.js";
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

/**
 * How far ABOVE the ordered quantity a receipt may cumulatively go, in percent of
 * what was ordered. 10 means a line ordered at 100 may be received up to 110.
 *
 * THIS NUMBER IS A RULING, NOT A SPEC VALUE, AND THE DISTINCTION MATTERS.
 * The spec supplies no tolerance, no ceiling and no over-receipt rule anywhere —
 * searched across pototype/**\/*.jsx, docs/extract/* and docs/handoff/* for
 * เกิน / ส่วนเกิน / รับเกิน / tolerance / variance / เผื่อ / คลาดเคลื่อน / ± /
 * threshold / allowance / 3-way match. Every เกิน hit is a different domain
 * (เกินงบ, เกินกำหนด, ชำระเกิน, เกินจำนวน Seats). FLOW-A's only "over" rule is
 * ราคาเกิน BOQ ต้องแนบเหตุผล — PRICE at PR stage, not QUANTITY at GR
 * (docs/handoff/flows.html:38) — and the approval matrix (flows.html:86-93) has no
 * GR row at all.
 *
 * So 10 is an ORCHESTRATOR-SET DEFAULT pending Wei's final figure (B-TBD-QTY), not
 * a number the domain handed us. It is a single named constant precisely so that
 * final figure costs one line: every test in this repo asserts against the CONSTANT
 * and never against a literal, so changing it here changes the tests with it.
 */
export const GR_OVER_RECEIPT_TOLERANCE_PCT = 10;

/**
 * Thrown INSIDE the create transaction when a line's cumulative received quantity
 * would exceed its ordered quantity by more than the tolerance. It has to be an
 * exception rather than an early `return reply…` because the check runs inside
 * db.transaction() — throwing is what rolls the receipt, its lines and its stock
 * movements back together. Caught at the transaction boundary and rendered as the
 * 400 VALIDATION below (mirrors GrAlreadyPostedError's shape).
 */
class GrOverReceiptError extends Error {
  constructor(readonly detail: string) {
    super(detail);
    this.name = "GrOverReceiptError";
  }
}

/**
 * Round to the 4 dp `numeric(18,4)` scale that pr_item.qty / gr_item.received_qty
 * are stored at. The cumulative comparison sums JS floats read back from those
 * columns, so both sides are rounded to the column's own precision before they are
 * compared — otherwise 0.1 + 0.2 style drift decides a boundary case, and the
 * boundary is exactly where this guard is asserted.
 */
function round4(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Number(x.toFixed(4));
}

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

// WHY BOTH stock_ledger WRITERS IN THIS FILE SORT (inLockOrder, lock-order.ts) rather
// than taking selectForUpdate's guard lock — both close the cycle; this is the reason for
// the choice:
//   - a receipt needs no consistent read. It only ever RAISES a balance, so there is no
//     read-then-write invariant to protect. FOR UPDATE would take a STRONGER lock than
//     the FK requires and queue a storekeeper's receipt behind a site issue of the same
//     material for zero correctness gain;
//   - it would add a failure mode (the `locked.length !== itemIds.length` throw) to a
//     path that already resolved ownership above, plus a round trip per receipt;
//   - and it would NOT cover reverseGrMovements, whose reversal has nothing to guard and
//     no honest place to take a guard lock — so the return/cancel path would still need
//     a sort. One mechanism for both writers beats two.

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
/**
 * B-360: pr_item → pr → project (mirror pr.ts PR_ITEM_HOPS). The receipt's own
 * order lines — the ONLY set a receipt may price from. See the long note at the
 * derivation.
 */
const PR_ITEM_HOPS = [
  { fk: prItems.prId, parent: prs },
  { fk: prs.projectId, parent: projects },
];
/**
 * B-348: boq_item → group → doc → project — the SAME chain pr.ts / dashboard.ts
 * price a PR through. gr_item.price is derived from `boq_item.price` reached this
 * way, so the price a receipt posts can only ever come from a BOQ line THIS tenant
 * owns (a foreign id resolves to nothing → 400, never a silently-priced receipt).
 *
 * B-360: tenant ownership is NOT enough — see the ordered-line gate at the
 * derivation. This chain now runs SECOND, as the price read, after the id has
 * already been proved to be a line of the receipt's own order.
 */
const BOQ_ITEM_HOPS = [
  { fk: boqItems.groupId, parent: boqGroups },
  { fk: boqGroups.boqId, parent: boqDocs },
  { fk: boqDocs.projectId, parent: projects },
];

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

// ---------------------------------------------------------------------------
// B-348 — a POSTED receipt can no longer be returned or cancelled
// ---------------------------------------------------------------------------
// This guard exists because THIS ROUND created the hazard. Until now a gr row
// carried `amount: null` and could never post, so return/cancel had nothing to
// contradict. Now that a receipt posts Dr 5020 / Cr 2010 for what arrived, a
// return AFTER the post would leave a standing JV booking cost and an AP
// liability for goods that went back to the vendor — and nothing in the
// return/cancel path touches `jv`.
//
// Two coherent answers existed: (i) refuse the return once posted, or (ii)
// auto-write a REVERSING JV. (ii) is a NEW money write needing its own
// idempotency key and its own posting rule, so it is a ruling, not an
// implementer's call — filed rather than guessed. (i) ships because it makes the
// contradictory state unreachable and is fully reversible once (ii) is ruled.
//
// The OPERATIONAL COST is real and is not hidden: a receipt that has been posted
// can no longer have its stock reversed through this door either (B-340 put the
// ledger reversal in the same transaction). A warehouse that must return posted
// goods is blocked until (ii) lands. That is why the refusal is a 409 with a
// message naming the reason, not a silent no-op.
//
// THE RACE THIS ONCE LEAKED, and how the pair closes it now (B-361).
//
// The JV check runs BEFORE the flip and AGAIN inside the transaction after the
// guarded UPDATE, which closes the ordering "the post committed first". B-348
// shipped ONLY that half and filed the mirror as a one-statement residual between
// "humans at operating pace": a concurrent /gl/post read `gr.status` with a plain
// SELECT (in listGlPostingDocs, outside any transaction), so under READ COMMITTED
// it saw `received` while this transaction's UPDATE was uncommitted and could
// post between the re-check and the COMMIT.
//
// THAT ESTIMATE WAS WRONG, and measurably so. Two OS PROCESSES on a 700 ms
// barrier, fresh postable receipt each round: rounds 2-6 committed the post AND
// the return — 5 of 6, i.e. the DEFAULT outcome at ~0 ms offset, not a corner. And
// it is the one race that matters most here, because this freeze is the ENTIRE
// mitigation for the deferred reversing-JV ruling: while it leaked, a `returned`
// receipt could stand against a live Dr 5020 / Cr 2010.
//
// gl-posting.ts lockPostableGr now takes the SAME row lock this handler's guarded
// UPDATE takes, re-asserting `status = 'received'` on its own FINAL update, as the
// first statement of the posting transaction. Whoever gets the row decides:
// return-first → the post matches 0 rows and skips; post-first → the
// in-transaction re-check below sees the committed JV and rolls this back → 409.
// The re-check below is therefore LOAD-BEARING, not belt-and-braces: it is the
// half that answers when the poster wins the lock. Measured after the fix: 6/6
// rounds exactly one winner, never both, never a 500.

/** A GR whose posting JV already exists (thrown from inside the return/cancel tx). */
class GrAlreadyPostedError extends Error {}

/**
 * The posting JV of this receipt, if any — resolved through the SAME
 * `jv.source_doc = "gr:<uuid>"` convention gl-posting.ts reads posted-ness from,
 * so the two can never disagree about whether a receipt has posted. `jv` carries
 * company_id → the scoped select() door.
 */
async function grPostingJvNo(db: TenantDb, grId: string): Promise<string | null> {
  const [jv] = await db.select(jvs, eq(jvs.sourceDoc, `gr:${grId}`));
  return jv ? (jv.no ?? "") : null;
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
        const unit = has(line, "unit") ? str(pick(line, "unit")).trim() || null : null;
        itemDrafts.push({
          boqItemId: uuidOrNull(pick(line, "boq_item_id", "boqItemId")),
          name,
          orderedQty: String(orderedQty),
          // received_qty of the line = its good-received quantity (qty_ok).
          receivedQty: String(qtyOk),
          unit,
          // B-348: price + currency are NOT read from the body — they are DERIVED
          // below from this line's boq_item. See the block after the anchor resolve.
          price: "0.00",
          currencyCode: "THB",
        });
      }
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

    // -----------------------------------------------------------------------
    // B-348 — THE LINE'S MONEY IS SERVER-OWNED. Here, and only here.
    // -----------------------------------------------------------------------
    // What this replaces: `const price = toNum(pick(line, "price")) ?? 0`, taken
    // straight from the request body and persisted verbatim. That was tolerable
    // only for as long as gr_item.price fed nothing but a display column. It now
    // feeds a GL accrual (gl-posting.ts derives the receipt's postable amount from
    // exactly these rows), so a client-supplied `price` would ORIGINATE a posted
    // money figure — the shape that once let an approver settle 3,000,000 by
    // sending 500,000. The mobile lane already refused to send one and wrote down
    // why (apps/mobile/lib/screens/st_receive/st_receive_agg.dart: "There is no
    // server-side price source in that path, so a client that sends `price`
    // originates the receipt's monetary value"). The API now refuses to READ one.
    //
    // THE SERVER'S PRICE SOURCE is `boq_item.price`, reached through the line's own
    // `boq_item_id`. It is the ONLY per-line price in the schema — there is no
    // `po_item` table; a PO carries a header `total` and nothing else — and it is
    // the same source the seed derives its gr_item prices from
    // (packages/db/src/seed/index.ts:1322) and the same one pr.ts prices a PR with.
    //
    // AND THE ID IS RESOLVED AGAINST THIS ORDER'S OWN LINES — B-360, and the
    // TENANT DOOR ALONE WAS NOT ENOUGH.
    //
    // B-348 resolved `boq_item_id` through BOQ_ITEM_HOPS, which proves only that the
    // line belongs to THIS TENANT. That closed cross-tenant pricing and left
    // cross-ORDER pricing wide open, which is the same defect one indirection down:
    // the client no longer TYPES the price, it PICKS which of the tenant's prices to
    // charge. Measured live on the seeded stack at 3e25eec, before this fix: a
    // receipt of 2 units against PO-2026-0289 (total 612,400), naming the
    // 1,840,000/unit lump-sum line SUB-STR-001 from a different PR entirely, was
    // accepted 201 with money 3,680,000 and posted JV-2026-0422 Dr 5020 3,680,000 /
    // Cr 2010 3,680,000 — 3.68M of cost and trade payable booked on a 612K order.
    //
    // THE SET A RECEIPT MAY PRICE FROM is the ordered lines of its OWN source PR:
    // `pr_item.boq_item_id` for the PR this PO/WO was raised from. That is not a
    // proxy for the right answer, it IS the right answer — pr_item is the only
    // ORDERED line table in the schema (a PO carries a header `total` and no lines
    // at all), so "what was ordered" and "what may be received" are the same set by
    // construction. Project scope was considered and rejected as the primary gate:
    // every BOQ line in the seeded tenant lives under ONE project, so a project
    // check would have accepted the exploit above unchanged.
    //
    // AN ORDER WITH NO LINES CAN PRICE NOTHING, and that is deliberate rather than
    // an oversight. Some PRs carry no pr_item rows (a WO's lump-sum งานเหมา has no
    // BOQ qty source — the header note above says so, and the seed has such PRs), so
    // there is no ordered price basis anywhere for a receipt against them. Pricing
    // such a receipt off ANY BOQ line would be inventing the basis, so a named
    // `boq_item_id` is refused: the receipt is still recorded, its lines still store
    // 0.00 = "unknown", and gl-posting.ts refuses to post it. FLOW-A therefore
    // becomes a cost chain exactly where a real ordered line exists, and nowhere else.
    //
    // THE REFUSAL IS 400 VALIDATION, not 404 and not 409. The boq_item may well
    // EXIST and be visible to this tenant — the request is what is incoherent: it
    // claims to receive against an order that never contained that line. 409 would
    // read as "state conflict, try later" and nothing about that receipt body will
    // ever become valid, and apps/mobile sync_processor.dart dead-letters every 4xx
    // permanently, so the honest terminal answer is the one that names the request.
    // Like the stock axes above, it is a 400 REGARDLESS of any idempotency key —
    // which is why this sits BEFORE the pre-check: a replay naming a line that is
    // not on this order must never be answered from our data.
    //
    // Both gates stay, and they prove different things: the ordered-line gate
    // (which order is this?) and the scoped BOQ read (whose line is this?). A
    // pr_item.boq_item_id is an FK with no tenant predicate of its own, so an order
    // line CAN in principle name a row this tenant cannot read; the price read is
    // what refuses that, and it is defence in depth, not a duplicate.
    //
    // A NAMED LINE WITH NO boq_item_id keeps price 0.00. That is "unknown", not
    // "zero baht" — the same reading apps/web already applies to a zero
    // (gr-rows.ts hasLineDetail, "Those zeroes mean 'unknown', not 'zero baht'") —
    // and gl-posting.ts refuses to post a receipt whose measurable total is 0
    // rather than booking a meaningless balanced pair of zero legs. It is NOT
    // rejected here, because the contract declares a bare `{name, qty}` line and no
    // shipped client sends `price` at all (apps/web buildLines sends only
    // qty_ok/qty_rejected; mobile sends neither name nor price), so refusing it
    // would break a documented shape to fix a hole that closing the READ already
    // closes.
    const boqItemIds = [
      ...new Set(itemDrafts.map((d) => d.boqItemId).filter((v): v is string => v != null)),
    ];
    // B-TBD-QTY: the ORDERED QUANTITY per boq_item, Σ pr_item.qty. Populated from
    // the SAME B-360 read below — those rows were already being loaded and their
    // `qty` already being discarded (only `boqItemId` was kept), which is precisely
    // how the quantity hole survived the round that closed the price hole.
    //
    // Σ rather than a single row because nothing stops a PR from carrying the same
    // boq_item on two lines; the order's total commitment to that material is the
    // sum, and that is what a receipt is measured against.
    const orderedQtyByBoqItem = new Map<string, number>();
    if (boqItemIds.length > 0) {
      // B-360: what this order actually ORDERED. Scoped through pr_item → pr →
      // project, so the set itself can only ever describe a PR of this tenant.
      const orderedLines = await db.selectThrough(
        prItems,
        PR_ITEM_HOPS,
        eq(prItems.prId, prId),
      );
      for (const l of orderedLines) {
        if (l.boqItemId == null) continue;
        orderedQtyByBoqItem.set(
          l.boqItemId,
          (orderedQtyByBoqItem.get(l.boqItemId) ?? 0) + Number(l.qty),
        );
      }
      const orderable = new Set(
        orderedLines.map((l) => l.boqItemId).filter((v): v is string => v != null),
      );
      for (const id of boqItemIds) {
        if (!orderable.has(id)) {
          return reply.code(400).send({
            code: "VALIDATION",
            message: `boq_item ${id} is not a line of this order (a receipt is priced ONLY from what its own PR ordered)`,
          });
        }
      }
      const priced = await db.selectThrough(
        boqItems,
        BOQ_ITEM_HOPS,
        inArray(boqItems.id, boqItemIds),
      );
      const byId = new Map(priced.map((b) => [b.id, b]));
      for (const id of boqItemIds) {
        if (!byId.has(id)) {
          return reply.code(400).send({
            code: "VALIDATION",
            message: `boq_item ${id} not found in this tenant`,
          });
        }
      }
      for (const draft of itemDrafts) {
        const source = draft.boqItemId ? byId.get(draft.boqItemId) : undefined;
        if (!source) continue;
        // Both fields come from the SAME row: a price without its own currency is
        // not a money value, and taking the amount from the server while taking its
        // label from the client is the same defect one field down.
        draft.price = Number(source.price).toFixed(2);
        draft.currencyCode = source.currencyCode;
      }
    }

    // Mixed-currency guard (B-085 fix 4): grWire sums Σ(received_qty × price)
    // across ALL lines but labels the receipt with items[0].currency_code — so a
    // receipt whose lines carry more than one currency would silently sum across
    // currencies under a single (wrong) label. One receipt = one currency: reject
    // at create rather than emit a meaningless cross-currency total.
    //
    // B-348 MOVED IT HERE, after the derivation, and that is what makes it mean
    // anything now: it used to compare currencies the CLIENT chose, which the
    // handler no longer reads. It now compares the currencies of the BOQ lines the
    // receipt actually prices from. (Lines with no boq_item are all "THB" by
    // default and contribute 0 to the total, so they cannot trip it alone.)
    const currencies = new Set(itemDrafts.map((d) => d.currencyCode));
    if (currencies.size > 1) {
      return reply.code(400).send({
        code: "VALIDATION",
        message: "all received lines must share one currency_code (one receipt = one currency)",
      });
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
    // The header insert PRECEDES EVERY STOCK WRITE — the same construction and the
    // same reason as createIssue (inventory.ts): the 23505 on gr_idempotency_uq
    // rolls the WHOLE block back BEFORE any stock_ledger row exists, so
    // replay-safety of the stock movement is STRUCTURAL rather than a compensating
    // action. The ledger write sits INSIDE the guard that makes the receipt
    // idempotent, not beside it (the B-340 ruling's explicit requirement).
    //
    // B-TBD-QTY MOVED THE ANCHOR LOCK IN FRONT OF IT, and the header insert is no
    // longer literally the first statement. That reordering is FORCED, not
    // stylistic — see the lock note below. What B-340 needs is only that the header
    // precede the ledger rows, which it still does; the lock is an UPDATE on po/wo
    // that rolls back with everything else.
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
        // -------------------------------------------------------------------
        // B-TBD-QTY — THE PR LOCK. Taken FIRST, and the order is forced.
        // -------------------------------------------------------------------
        // The over-receipt guard below is read-then-write: it sums what has
        // already been received and compares. Under READ COMMITTED two receipts
        // that each fit under the ceiling read the same total, both pass, and both
        // commit — the exact shape B-342 closed for stock and B-149 for the
        // approval chain. So the read must happen while holding a row both writers
        // must pass through.
        //
        // THE ROW IS THE SOURCE PR, NOT THE ANCHOR PO/WO, and this is the second
        // half of the grain fix below. The basis is the PR's ordered lines and the
        // accumulator now sums the PR's receipts, so the PR is the only row EVERY
        // racing receipt against that order passes through. Locking the anchor
        // instead left the race wide open one level up: two receipts against two
        // DIFFERENT POs of the same PR would take two DIFFERENT locks, never block,
        // and both commit — which is exactly the N-POs hole, arrived at by racing
        // rather than by sequencing.
        //
        // The lock is a guarded UPDATE rather than a FOR UPDATE — the B-361
        // pattern, for the same reason: `pr` carries no company_id (it scopes
        // through project), so TenantDb.selectForUpdate cannot reach it, while an
        // UPDATE takes the same row-level exclusive lock. `updated_at` is the only
        // column it touches, which is honest (a receipt against this PR's order
        // does advance that order's fulfilment) and invents no state — nothing
        // reads it, and no list orders by it (newestFirst sorts on created_at).
        //
        // IT MUST PRECEDE THE HEADER INSERT, and getting this backwards is a
        // DEADLOCK, not a style point. `gr.po_id` is an FK, so INSERT INTO gr takes
        // an implicit `FOR KEY SHARE` on the anchor row, and `po.pr_id` is an FK so
        // INSERT INTO po takes one on the PR. KEY SHARE does not conflict with KEY
        // SHARE, so two writers would BOTH acquire it and then both try to upgrade
        // to the exclusive lock this UPDATE needs — each waiting on the other's.
        // That is PG 40P01, and a 40P01 here is strictly worse than the hole it
        // would be guarding: there is no deadlock handler in apps/api, so it
        // surfaces as a 500, and sync_processor.dart DEFERS a 5xx — one deadlocked
        // receipt stops a field phone's entire offline drain and deadlocks again on
        // every retry (lock-order.ts says this at length). Taking the exclusive
        // lock BEFORE any KEY SHARE exists makes the upgrade impossible: the second
        // receipt waits at the very first statement.
        //
        // THE REPO-WIDE ORDER this joins is: pr → gr → inventory_item.
        // Registered in lock-order.ts and pinned by lock-order.enforce.test.ts.
        //
        // ONLY WHEN THERE IS SOMETHING TO GUARD. A receipt with no priced line
        // (mobile's bare `{qty_ok}` shape) has no ordered-quantity basis and writes
        // no gr_item, so locking would serialise storekeepers for nothing. Such a
        // receipt still blocks on the holder's lock at its own header insert, which
        // is a wait and never a cycle — it takes KEY SHARE and never upgrades.
        if (orderedQtyByBoqItem.size > 0) {
          await tx.updateThroughChain(prs, PR_HOPS, { updatedAt: new Date() }, eq(prs.id, prId));
        }

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

        // -------------------------------------------------------------------
        // B-TBD-QTY — THE OVER-RECEIPT CEILING, per line, cumulative.
        // -------------------------------------------------------------------
        // WHAT THIS CLOSES. B-360 made the server own the receipt's PRICE and the
        // set of lines it may price from. It left the QUANTITY wide open: `qty_ok`
        // came off the body with no ceiling and was stored verbatim, and
        // gl-posting.ts posts Σ(received_qty × price). Measured live on the seeded
        // stack at 80084a7, before this guard: an order of 10,000 × 142 (PO total
        // 1,420,000), received with `qty_ok: 99999999`, answered 201, surfaced
        // 14,199,999,858 in the posting inbox and posted JV-2026-0435
        // Dr 5020 14,199,999,858.00 / Cr 2010 14,199,999,858.00 — read back out of
        // Postgres. Same defect family as the 3.68M-on-612K exploit B-360 closed,
        // three orders of magnitude larger.
        //
        // THE BASIS IS pr_item.qty AND CAN BE NOTHING ELSE. gr_item.ordered_qty is
        // CLIENT-SUPPLIED and falls back to the client's own qty_ok
        // (`toNum(pick(line,"ordered_qty","orderedQty")) ?? qtyOk`), so a guard
        // written as `received <= ordered_qty × (1+tol)` would compare the client's
        // number to the client's number — vacuous, and it would have passed the
        // 99,999,999 exploit unchanged. pr_item.qty is the only server-owned ordered
        // quantity in the schema (a PO carries a header `total` and no lines), which
        // is the same reason B-360's orderable set is pr_item.boq_item_id.
        //
        // CUMULATIVE PER LINE, ACROSS THE ANCHOR'S ACTIVE RECEIPTS — and the shape
        // is the spec's, not a preference. data-dictionary.html:65 states `PO → N
        // GR`; gr.create.balanceRemaining ("คงเหลือต้องรับ: {balance}") draws a
        // running balance down across receipts, seeded PER LINE (forms.jsx:376-378,
        // "ปูน 920/1840 ถุง"); po-wo.jsx:21 auto-closes the PO เมื่อรับครบ. So
        // partial receipts are normal and 40-then-60 against 100 must both succeed
        // — which a PER-REQUEST check would also allow, along with 40-then-100. And
        // a WHOLE-PR sum would let one line be over-received enormously while
        // another was under-received. Per line, cumulative, is the only shape that
        // matches the frame the spec already draws.
        //
        // ONLY `received` RECEIPTS COUNT, mirroring the auto-close read below: a
        // returned or cancelled receipt has had its stock reversed
        // (reverseGrMovements) and its goods have gone back to the vendor, so it
        // must free its quantity again. Verified against the return/cancel handlers
        // in this file — both flip `status` away from 'received' inside their own
        // transaction, so the flip and the reversal are one atom and this filter
        // sees them together.
        //
        // THE PROTOTYPE DELIBERATELY PERMITS OVER-RECEIPT, and this guard does not
        // pretend otherwise. mobile-field.jsx:46 clamps the LOWER bound only
        // (`Math.max(0, v + d)`), :76 renders `เกิน {n} {unit}` in INFO tone (while
        // under-receipt gets warn), and :47/:86 compute `short` from `< ordered`
        // only — so an over-receipt takes the green "ยืนยันรับของครบ" path and
        // saves. The same prototype clamps hard wherever a ceiling IS meant
        // (mobile-field.jsx:102 `Math.min(100, …)`; inventory.jsx:601
        // `Math.min(val, it.stock)` with a danger row), so it knows how to express a
        // cap and chose not to here. The web form is looser still: forms.jsx:484-492
        // is an uncontrolled defaultValue with no `max` and a one-sided colour rule.
        // The server nonetheless refuses beyond the tolerance because that figure
        // now POSTS TO THE LEDGER, which it did not when the prototype was drawn.
        // The two are reconciled by the TOLERANCE — real sites over-deliver — rather
        // than by either overruling the other. That is why this is not a hard cap.
        //
        // 400 VALIDATION, matching B-360's refusal on this same endpoint: 4xx
        // because sync_processor.dart dead-letters a 4xx but DEFERS a 5xx and stops
        // the drain, so a 500 here would wedge a field phone's whole offline queue.
        // The message is a server string in English, deliberately WITHOUT an i18n
        // key: the entire gr.* keyspace carries only under-receipt vocabulary
        // (shortReceived / partialWarning / balanceRemaining / fullyReceived) and no
        // over-receipt, error or refusal key at all — and i18n-full.json is sacred.
        // The honest consequence, reported rather than papered over: no client can
        // render this refusal in Thai today.
        if (orderedQtyByBoqItem.size > 0) {
          // What THIS request adds, per line — two drafts naming the same
          // boq_item must be summed, or splitting one line in two evades the check.
          const requestedByBoqItem = new Map<string, number>();
          for (const d of itemDrafts) {
            if (!d.boqItemId) continue;
            requestedByBoqItem.set(
              d.boqItemId,
              (requestedByBoqItem.get(d.boqItemId) ?? 0) + Number(d.receivedQty),
            );
          }
          // What THE PR's ACTIVE receipts already hold, per line.
          //
          // THE ACCUMULATOR IS PR-GRAINED BECAUSE THE BASIS IS. This read used to
          // filter on the ANCHOR (`eq(grs.poId, poId)`) while the basis above came
          // from `pr_item` of the source PR — two different grains compared against
          // each other. po.ts places NO cap on how many POs are raised from one PR,
          // so the effective ceiling was `N × 1.1 × ordered` with N chosen by the
          // caller. Proven live at 016308e: one PR ordering 10,000 → two approved
          // POs → 11,000 received on each → 22,000 against a ceiling of 11,000,
          // both receipts 201. The earlier note here argued per-line-cumulative was
          // "the only shape the spec draws" — that argument was about per-line vs
          // whole-PR and never addressed WHICH DOCUMENTS a line's receipts are
          // summed over. Ordered by the PR, so received by the PR.
          //
          // BOTH ANCHOR CHAINS, UNIONED, because one PR can raise a PO *and* a WO
          // (the seed does exactly that — po:i and wo:i-1 share a PR, and 5 such
          // PRs exist on the live stack). Reading only the chain this receipt
          // happens to arrive on would leave the other document's receipts
          // uncounted, which is the same hole one door over. There is no double
          // counting: a gr row carries EITHER po_id or wo_id (enforced at the top
          // of this handler) and each chain INNER JOINs on its own FK, so a
          // WO-anchored receipt cannot appear in the PO chain or vice versa.
          //
          // Read INSIDE the transaction, AFTER the lock: under READ COMMITTED each
          // statement takes a fresh snapshot, so a rival that committed while we
          // waited on the lock is visible here. (That is also the hazard: under
          // REPEATABLE READ the snapshot would be fixed at the first statement and
          // this guard would silently stop working — the same warning tenant-db.ts
          // carries over selectForUpdate.) The receipt inserted just above
          // contributes nothing: its gr_item rows do not exist yet, and the INNER
          // JOIN drops it.
          const activeOfThisPr = and(eq(prs.id, prId), eq(grs.status, "received"));
          const priorLines = [
            ...(await tx.selectThrough(grItems, GR_ITEM_PO_HOPS, activeOfThisPr)),
            ...(await tx.selectThrough(grItems, GR_ITEM_WO_HOPS, activeOfThisPr)),
          ];
          const priorByBoqItem = new Map<string, number>();
          for (const l of priorLines) {
            if (l.boqItemId == null) continue;
            priorByBoqItem.set(
              l.boqItemId,
              (priorByBoqItem.get(l.boqItemId) ?? 0) + Number(l.receivedQty),
            );
          }

          for (const [boqItemId, requested] of requestedByBoqItem) {
            const ordered = orderedQtyByBoqItem.get(boqItemId) ?? 0;
            // AN UN-QUANTIFIED LINE HAS NO CEILING, and that is deliberate.
            // pr_item.qty defaults to '0', and a tolerance applied to 0 is 0 — a
            // naive guard would make every un-quantified line IMPOSSIBLE TO RECEIVE
            // AT ALL, which is a worse break than the hole. This is the same answer
            // the auto-close below already gives ("An un-quantified order
            // (ordered = 0) never auto-closes (GAP 3)"). THE RESIDUAL, stated
            // rather than papered over: such a line still has no quantity ceiling,
            // so the exploit above remains open on an order whose pr_item.qty is 0.
            // Inventing a ceiling for it would be inventing the basis.
            if (ordered <= 0) continue;
            const ceiling = round4((ordered * (100 + GR_OVER_RECEIPT_TOLERANCE_PCT)) / 100);
            const cumulative = round4((priorByBoqItem.get(boqItemId) ?? 0) + requested);
            if (cumulative > ceiling) {
              throw new GrOverReceiptError(
                `boq_item ${boqItemId}: receiving ${requested} would bring the cumulative ` +
                  `received quantity to ${cumulative}, above the ${ordered} ordered plus the ` +
                  `${GR_OVER_RECEIPT_TOLERANCE_PCT}% over-receipt tolerance (ceiling ${ceiling})`,
              );
            }
          }
        }

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
      // B-TBD-QTY: the over-receipt ceiling. The throw is what rolled the receipt,
      // its lines and its stock movements back; this only renders the answer. It is
      // ordered AFTER the replay branch on purpose — a 23505 and this are mutually
      // exclusive (the ceiling is checked after the header insert has already
      // succeeded), so the order is documentation rather than precedence.
      if (err instanceof GrOverReceiptError) {
        return reply.code(400).send({ code: "VALIDATION", message: err.detail });
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
    // B-348: a receipt whose cost is already in the ledger cannot be returned —
    // see the note above GrAlreadyPostedError.
    if ((await grPostingJvNo(db, found.id)) != null) {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "a posted GR cannot be returned (its JV would stand against returned goods)",
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
    try {
      await db.transaction(async (tx) => {
        [updated] = await tx.updateThroughChain(
          grs,
          hops,
          { status: "returned" },
          eq(grs.id, id),
          eq(grs.status, "received"),
        );
        if (!updated) return;
        // B-348: re-ask INSIDE the transaction. A /gl/post that committed between
        // the pre-check and here must roll this whole return back — the stock
        // reversal included — rather than leave the JV standing alone.
        if ((await grPostingJvNo(tx, found.id)) != null) throw new GrAlreadyPostedError();
        await reverseGrMovements(tx, id, "gr-return");
      });
    } catch (err) {
      if (err instanceof GrAlreadyPostedError) {
        return reply.code(409).send({
          code: "INVALID_STATE",
          message: "a posted GR cannot be returned (its JV would stand against returned goods)",
        });
      }
      throw err;
    }
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
    // B-348: identical to return — a posted receipt's cost is in the ledger.
    if ((await grPostingJvNo(db, found.id)) != null) {
      return reply.code(409).send({
        code: "INVALID_STATE",
        message: "a posted GR cannot be cancelled (its JV would stand against cancelled goods)",
      });
    }
    const hops = found.poId ? GR_PO_HOPS : GR_WO_HOPS;
    // B-156: 'received' pre-state folded into the FINAL update (atomic guard).
    // B-340: same shape as return — guarded UPDATE first, then the stock reversal,
    // both in one transaction. A cancelled receipt's goods leave the shelf too;
    // the only difference is the ref_doc that records why.
    let updated: GrRow | undefined;
    try {
      await db.transaction(async (tx) => {
        [updated] = await tx.updateThroughChain(
          grs,
          hops,
          { status: "cancelled" },
          eq(grs.id, id),
          eq(grs.status, "received"),
        );
        if (!updated) return;
        // B-348: re-ask INSIDE the transaction (see the return handler).
        if ((await grPostingJvNo(tx, found.id)) != null) throw new GrAlreadyPostedError();
        await reverseGrMovements(tx, id, "gr-cancel");
      });
    } catch (err) {
      if (err instanceof GrAlreadyPostedError) {
        return reply.code(409).send({
          code: "INVALID_STATE",
          message: "a posted GR cannot be cancelled (its JV would stand against cancelled goods)",
        });
      }
      throw err;
    }
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

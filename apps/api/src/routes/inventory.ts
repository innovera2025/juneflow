// Inventory handlers — Program-2 Inventory (B-141). Wires the inventory.jsx
// ITEMS / WH / TRANSFERS / ISSUES registers plus the two stock-moving actions
// (transfer approve, material issue). The schema (extensions.ts inventory_item /
// warehouse / stock_transfer / material_issue + the migration-0041 additions:
// stock_ledger append-only movement ledger, transfer_line / issue_line children,
// warehouse superset code/type/owner/capacity) and the contract paths
// (openapi.yaml §finance — 13 opaque /inventory ops + a 409 Conflict component)
// ALL pre-exist. This file wires the handlers and is registered in app.ts
// (registerInventoryRoute) by the orchestrator — NO app.ts / openapi / migration /
// gl-post.ts edits here.
//
// Contract (openapi.yaml §finance — opaque Entity, NO openapi edit this task):
//   READS
//     GET  /inventory/items                  → EntityList   (listItems)
//     GET  /inventory/items/{id}             → Entity       (getItem)
//     GET  /inventory/warehouses             → EntityList   (listWarehouses)
//     GET  /inventory/stock                  → EntityList   (listStock)  ?warehouse_id
//     GET  /inventory/transfers              → EntityList   (listTransfers)
//     GET  /inventory/transfers/{id}         → Entity       (getTransfer)
//     GET  /inventory/issues                 → EntityList   (listIssues)
//     GET  /inventory/issues/{id}            → Entity       (getIssue)
//   CREATES (finance.create)
//     POST /inventory/items                  → EntityCreated (createItem)
//     POST /inventory/warehouses             → EntityCreated (createWarehouse)
//     POST /inventory/transfers              → EntityCreated (createTransfer)
//     POST /inventory/issues                 → EntityCreated (createIssue)   * finance.approve
//   ACTIONS (finance.approve)
//     POST /inventory/transfers/{id}/approve → ActionOk      (approveTransfer)
// Each row/body is the opaque Entity (snake_case wire of the REAL columns + honest
// server-computed derivations). A read/POST on an opaque endpoint needs no
// contract change (FLOW-A opaque-Entity precedent).
//
// MONEY = SERVER AUTHORITY (gate-4.5 hard rule · B1 standard-cost): EVERY money
// figure is COMPUTED server-side as inventory_item.price × qty — a STANDARD cost,
// never FIFO, never a client value. A per-item on-hand is Σ(stock_ledger.qty) over
// the item; a per-(item,warehouse) balance is Σ(qty) GROUP BY (item, warehouse);
// its value = price × on-hand. A transfer/issue header `value` is
// round2(Σ qty × item.price[resolved per item, tenant-scoped]). No handler ever
// trusts a client-supplied value/qty-total for a computed figure.
//
// STOCK LEDGER (B2, migration 0041) is APPEND-ONLY and the sole source of on-hand:
// on-hand(item, warehouse) = Σ(qty) over its rows (qty SIGNED — + receipt/in,
// − issue/out). It is UNSEEDED, so every balance read is honest-empty until a
// movement is posted (C10). Movements are written ONLY by the two actions below:
//   - transfer approve (B4): TWO atomic rows per line — (−qty @ from) + (+qty @ to).
//   - material issue (B5): ONE (−qty @ from) row per line.
// Both guard NEGATIVE STOCK (B6) before a −qty write: Σ(qty) for (item, from_wh)
// − qty ≥ 0, else 409 Conflict rolling back the WHOLE action.
//
// TENANT SCOPE (fail closed · PLAN.md §5): the aggregate roots (inventory_item /
// warehouse / stock_transfer / material_issue / stock_ledger / project) carry
// company_id → the scoped TenantDb.select()/insert()/update() doors bind it by
// construction. The child lines carry NO company_id — transfer_line scopes through
// stock_transfer, issue_line through material_issue, jv_line through jv → read via
// selectThrough / written via insertThrough (which re-proves this tenant owns the
// just-created parent). A supplied warehouse_id / item_id / project_id is
// re-verified against the tenant (a foreign id resolves to nothing → 400). Without
// a resolved tenant, request.db is absent → flat 401.
//
// FINANCIAL AUTHZ (B-082 F1 lineage): creating an item / warehouse / transfer gates
// finance.create; a transfer approve and a material issue MOVE stock (and the issue
// POSTS money) → finance.approve. Fail-closed 403 for an unattributable caller or
// one lacking the perm. Reads gate on the resolved tenant only. AuditLog fires
// automatically (middleware) on a 2xx.
//
// ISSUE → GL (B5 · server money): posting a material issue capitalises the project
// material cost into WIP — Dr 1140 งานระหว่างก่อสร้าง (WIP/CIP) / Cr 5020
// materials-cost = value, source_doc `issue:<id>`, carrying the issue's project_id
// (and a single distinct cc_id, when present) on both legs. 1140 + 5020 are real
// COA_SEED codes (resolved per-tenant at post time — never invented, C-177; a
// missing code → honest 409). The JV posts EXACTLY ONCE at create (the issue id is
// fresh), so there is no idempotency pre-check to make.
//   ⚠ ORCHESTRATOR-FLAG (Wei-ratify, do NOT block): the prototype draft's
//     "Cr inventory asset" leg has NO dedicated COA account in COA_SEED. Cr 5020
//     materials-cost (reclassify the GR-expensed material pool into project WIP) is
//     the coherent existing-account choice; stated here so a ratify blocker is filed.
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq } from "drizzle-orm";
import {
  inventoryItems,
  issueLines,
  jvLines,
  jvs,
  materialIssues,
  projects,
  stockLedgers,
  stockTransfers,
  transferLines,
  warehouses,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { round2 } from "./money.js";
import { pick, str, toNum } from "./procurement.js";
import { loadCaller, permAllowed, type CallerAuthz } from "./authz.js";
import { listEnvelope } from "./list-envelope.js";
import { ACCT, allocJvNo, resolveAccountIds } from "./gl-post.js";

type InventoryItemRow = typeof inventoryItems.$inferSelect;
type WarehouseRow = typeof warehouses.$inferSelect;
type StockTransferRow = typeof stockTransfers.$inferSelect;
type MaterialIssueRow = typeof materialIssues.$inferSelect;
type StockLedgerRow = typeof stockLedgers.$inferSelect;
type TransferLineRow = typeof transferLines.$inferSelect;
type IssueLineRow = typeof issueLines.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The perms-matrix module (seed MODULE_IDS) that governs finance mutations. */
const FINANCE_MODULE = "finance";

/**
 * The WIP/CIP account a material issue capitalises project material cost into —
 * 1140 งานระหว่างก่อสร้าง (a real COA_SEED code, NOT a named ACCT const in
 * gl-post.ts — same as labor.ts). Resolved per-tenant at post time; a tenant whose
 * COA lacks it → honest 409 (C-177).
 */
const WIP_MATERIAL = "1140";

// ---------------------------------------------------------------------------
// Reply helpers (flat contract Error shape {code,message})
// ---------------------------------------------------------------------------

/** Flat 401 (fail closed) when no tenant was resolved onto the request. */
function unauthenticated(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
}

/** Flat 400 VALIDATION error. */
function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ code: "VALIDATION", message });
}

/** Flat 403 FORBIDDEN error. */
function forbidden(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(403).send({ code: "FORBIDDEN", message });
}

/** Flat 404 NOT_FOUND error. */
function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ code: "NOT_FOUND", message });
}

/** Flat 409 INVALID_STATE error. */
function conflict(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(409).send({ code: "INVALID_STATE", message });
}

// ---------------------------------------------------------------------------
// Money / qty / parse helpers
// ---------------------------------------------------------------------------

/** A computed 2-dp money magnitude as the numeric-column string ("38040.00"). */
function moneyStr(n: number): string {
  return round2(n).toFixed(2);
}

/** A quantity as the numeric(18,4) column string ("12.5000" / "-5.0000"). */
function qtyStr(n: number): string {
  return n.toFixed(4);
}

/** Coerce a drizzle numeric (string) / number / null to a finite number, else 0. */
function num(value: unknown): number {
  if (value == null) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Epoch ms of a stored timestamp/date, else 0 (a malformed value sorts last). */
function msOf(ts: unknown): number {
  if (ts == null) return 0;
  const t = new Date(ts as string | Date).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Sort a set of rows carrying `createdAt` newest-first (mock list order). */
function newestFirst<T extends { createdAt?: unknown }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => msOf(b.createdAt) - msOf(a.createdAt));
}

/** The on-hand rollup key for a (item, warehouse) pair. */
function balanceKey(itemId: string, warehouseId: string): string {
  return `${itemId}::${warehouseId}`;
}

/**
 * Thrown by the negative-stock guard INSIDE a transaction to roll back the whole
 * action (B6). Caught by the handler and mapped to a 409 Conflict — a −qty write
 * that would drive a (item, warehouse) balance below zero is never committed.
 */
class NegativeStockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NegativeStockError";
  }
}

/**
 * B-149 optimistic-lock miss: the guarded status UPDATE matched 0 rows because a
 * concurrent call already advanced the doc out of its pending pre-state. Thrown
 * inside the approve transaction so the whole action rolls back → mapped to 409.
 */
class StaleStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleStateError";
  }
}

// ---------------------------------------------------------------------------
// Financial-authz gate (B-082 F1 model — invents no new policy)
// ---------------------------------------------------------------------------

/**
 * Fail-closed gate: the caller must be attributable AND carry the given finance
 * right. Returns the resolved caller (so the handler can attribute by_user_id) or
 * null after sending the 403. Mirrors ar.ts / labor.ts requireFinance*.
 */
async function requireFinance(
  request: FastifyRequest,
  reply: FastifyReply,
  right: "create" | "approve",
): Promise<CallerAuthz | null> {
  const caller = await loadCaller(request);
  if (!caller) {
    forbidden(reply, "caller cannot be attributed");
    return null;
  }
  if (!permAllowed(caller.perms, FINANCE_MODULE, right)) {
    forbidden(reply, `this action requires the finance ${right} permission`);
    return null;
  }
  return caller;
}

// ---------------------------------------------------------------------------
// Doc-number allocators — TR-/MI-<year>-<NNNN> (mirror gl-post.ts allocJvNo)
// ---------------------------------------------------------------------------

/** Allocate the next running `no` for a tenant table's `no` column under a prefix. */
function nextNo(existing: readonly string[], prefix: string): string {
  let max = 0;
  for (const no of existing) {
    if (!no.startsWith(prefix)) continue;
    const m = /-(\d+)$/.exec(no);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

/** TR-<year>-<NNNN>, one past the tenant's max stock-transfer suffix for the year. */
async function allocTransferNo(db: TenantDb): Promise<string> {
  const rows = (await db.select(stockTransfers)) as StockTransferRow[];
  return nextNo(
    rows.map((r) => r.no ?? ""),
    `TR-${new Date().getFullYear()}-`,
  );
}

/** MI-<year>-<NNNN>, one past the tenant's max material-issue suffix for the year. */
async function allocIssueNo(db: TenantDb): Promise<string> {
  const rows = (await db.select(materialIssues)) as MaterialIssueRow[];
  return nextNo(
    rows.map((r) => r.no ?? ""),
    `MI-${new Date().getFullYear()}-`,
  );
}

// ---------------------------------------------------------------------------
// Ledger rollups (the on-hand source of truth — Σ signed qty)
// ---------------------------------------------------------------------------

/** on-hand per item = Σ(stock_ledger.qty) over the item (all warehouses). */
function onHandByItem(ledgers: readonly StockLedgerRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const l of ledgers) {
    map.set(l.itemId, round2(num(map.get(l.itemId)) + num(l.qty)));
  }
  return map;
}

/** on-hand per (item, warehouse) = Σ(qty) GROUP BY (item, warehouse). */
function onHandByItemWarehouse(
  ledgers: readonly StockLedgerRow[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const l of ledgers) {
    const key = balanceKey(l.itemId, l.warehouseId);
    map.set(key, num(map.get(key)) + num(l.qty));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Wire serializers (snake_case wire of REAL columns + honest server derivations)
// ---------------------------------------------------------------------------

/**
 * Inventory-item wire (inventory.jsx ITEMS). STORED columns + the AUTHORITATIVE
 * on-hand (Σ ledger — the legacy `inventory_item.stock` scalar is superseded and
 * NOT emitted) + standard-cost value (price × on_hand). `stock` mirrors `on_hand`
 * for the prototype table's column name; both read honest-empty until the ledger
 * carries a movement.
 */
function itemWire(item: InventoryItemRow, onHand: number): Record<string, unknown> {
  const price = num(item.price);
  const value = round2(price * onHand);
  return {
    id: item.id,
    code: item.code,
    cat: item.cat,
    name: item.name,
    unit: item.unit,
    price,
    currency_code: item.currencyCode,
    low_point: item.lowPoint == null ? null : num(item.lowPoint),
    status: item.status,
    warehouse_id: item.warehouseId,
    // SERVER-authoritative on-hand (Σ ledger) — supersedes the legacy scalar.
    on_hand: onHand,
    stock: onHand,
    value,
    created_at: item.createdAt,
  };
}

/** Warehouse wire (inventory.jsx WH) — the stored superset columns. */
function warehouseWire(w: WarehouseRow): Record<string, unknown> {
  return {
    id: w.id,
    code: w.code,
    name: w.name,
    type: w.type,
    owner: w.owner,
    capacity: w.capacity == null ? null : num(w.capacity),
    location: w.location,
    created_at: w.createdAt,
  };
}

/** Per-(item, warehouse) balance wire — server on-hand + standard-cost value. */
function stockWire(
  itemId: string,
  warehouseId: string,
  onHand: number,
  item: InventoryItemRow | undefined,
  warehouseName: string | null,
): Record<string, unknown> {
  const price = item ? num(item.price) : 0;
  return {
    item_id: itemId,
    warehouse_id: warehouseId,
    item_code: item?.code ?? null,
    item_name: item?.name ?? null,
    unit: item?.unit ?? null,
    warehouse_name: warehouseName,
    price,
    currency_code: item?.currencyCode ?? "THB",
    on_hand: onHand,
    value: round2(price * onHand),
  };
}

/** Stock-transfer header wire (inventory.jsx TRANSFERS) — stored columns. */
function transferWire(
  t: StockTransferRow,
  fromName: string | null,
  toName: string | null,
): Record<string, unknown> {
  return {
    id: t.id,
    no: t.no,
    from_warehouse_id: t.fromWarehouseId,
    to_warehouse_id: t.toWarehouseId,
    from_warehouse_name: fromName,
    to_warehouse_name: toName,
    qty: num(t.qty),
    value: num(t.value),
    currency_code: t.currencyCode,
    transfer_date: t.transferDate,
    by_user_id: t.byUserId,
    status: t.status,
    created_at: t.createdAt,
  };
}

/** Transfer-line wire (child of stock_transfer). */
function transferLineWire(l: TransferLineRow): Record<string, unknown> {
  return {
    id: l.id,
    item_id: l.itemId,
    qty: num(l.qty),
    from_wh: l.fromWh,
    to_wh: l.toWh,
  };
}

/** Material-issue header wire (inventory.jsx ISSUES) — stored columns. */
function issueWire(
  i: MaterialIssueRow,
  projectName: string | null,
): Record<string, unknown> {
  return {
    id: i.id,
    no: i.no,
    project_id: i.projectId,
    project_name: projectName,
    from_warehouse_id: i.fromWarehouseId,
    value: num(i.value),
    currency_code: i.currencyCode,
    issue_date: i.issueDate,
    by_user_id: i.byUserId,
    status: i.status,
    created_at: i.createdAt,
  };
}

/** Issue-line wire (child of material_issue). */
function issueLineWire(l: IssueLineRow): Record<string, unknown> {
  return {
    id: l.id,
    item_id: l.itemId,
    qty: num(l.qty),
    cc_id: l.ccId,
  };
}

// ---------------------------------------------------------------------------
// READS
// ---------------------------------------------------------------------------

/**
 * GET /inventory/items — the tenant's inventory items (company-scoped) each with
 * its SERVER on-hand (Σ ledger, all warehouses) + standard-cost value. Honest-empty
 * on-hand until the ledger carries a movement. Newest-first, one B-014 page.
 */
async function listItems(db: TenantDb): Promise<Record<string, unknown>[]> {
  const [items, ledgers] = await Promise.all([
    db.select(inventoryItems) as Promise<InventoryItemRow[]>,
    db.select(stockLedgers) as Promise<StockLedgerRow[]>,
  ]);
  const onHand = onHandByItem(ledgers);
  return newestFirst(items).map((it) => itemWire(it, num(onHand.get(it.id))));
}

/** GET /inventory/items/{id} — one item (scoped 404) + on-hand + value. */
async function getItem(
  db: TenantDb,
  itemId: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [item] = (await db.select(
    inventoryItems,
    eq(inventoryItems.id, itemId),
  )) as InventoryItemRow[];
  if (!item) return notFound(reply, `inventory item ${itemId} not found`);
  const ledgers = (await db.select(
    stockLedgers,
    eq(stockLedgers.itemId, itemId),
  )) as StockLedgerRow[];
  const onHand = ledgers.reduce((s, l) => round2(s + num(l.qty)), 0);
  return reply.code(200).send(itemWire(item, onHand));
}

/** GET /inventory/warehouses — the tenant's warehouses (company-scoped superset). */
async function listWarehouses(db: TenantDb): Promise<Record<string, unknown>[]> {
  const rows = (await db.select(warehouses)) as WarehouseRow[];
  return newestFirst(rows).map(warehouseWire);
}

/**
 * GET /inventory/stock — per-(item, warehouse) balances derived from the ledger
 * (Σ qty GROUP BY item,warehouse) + standard-cost value. Honest-empty when the
 * ledger is empty (no synthetic zero rows). Optional ?warehouse_id filter.
 */
async function listStock(
  db: TenantDb,
  warehouseFilter: string | null,
): Promise<Record<string, unknown>[]> {
  const [ledgers, items, whRows] = await Promise.all([
    (warehouseFilter
      ? db.select(stockLedgers, eq(stockLedgers.warehouseId, warehouseFilter))
      : db.select(stockLedgers)) as Promise<StockLedgerRow[]>,
    db.select(inventoryItems) as Promise<InventoryItemRow[]>,
    db.select(warehouses) as Promise<WarehouseRow[]>,
  ]);
  const itemById = new Map(items.map((it) => [it.id, it]));
  const whName = new Map(whRows.map((w) => [w.id, w.name]));
  const balances = onHandByItemWarehouse(ledgers);
  const rows: Record<string, unknown>[] = [];
  for (const [key, onHand] of balances) {
    const [itemId, warehouseId] = key.split("::");
    rows.push(
      stockWire(
        itemId!,
        warehouseId!,
        onHand,
        itemById.get(itemId!),
        whName.get(warehouseId!) ?? null,
      ),
    );
  }
  return rows;
}

/** GET /inventory/transfers — the tenant's stock transfers (company-scoped). */
async function listTransfers(db: TenantDb): Promise<Record<string, unknown>[]> {
  const [transfers, whRows] = await Promise.all([
    db.select(stockTransfers) as Promise<StockTransferRow[]>,
    db.select(warehouses) as Promise<WarehouseRow[]>,
  ]);
  const whName = new Map(whRows.map((w) => [w.id, w.name]));
  return newestFirst(transfers).map((t) =>
    transferWire(
      t,
      t.fromWarehouseId ? whName.get(t.fromWarehouseId) ?? null : null,
      t.toWarehouseId ? whName.get(t.toWarehouseId) ?? null : null,
    ),
  );
}

/** GET /inventory/transfers/{id} — header (scoped 404) + its transfer_line rows. */
async function getTransfer(
  db: TenantDb,
  transferId: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [transfer] = (await db.select(
    stockTransfers,
    eq(stockTransfers.id, transferId),
  )) as StockTransferRow[];
  if (!transfer) return notFound(reply, `stock transfer ${transferId} not found`);
  const [lines, whRows] = await Promise.all([
    // transfer_line carries no company_id — scoped THROUGH stock_transfer.
    db.selectThrough(
      transferLines,
      [{ fk: transferLines.transferId, parent: stockTransfers }],
      eq(stockTransfers.id, transferId),
    ) as Promise<TransferLineRow[]>,
    db.select(warehouses) as Promise<WarehouseRow[]>,
  ]);
  const whName = new Map(whRows.map((w) => [w.id, w.name]));
  return reply.code(200).send({
    ...transferWire(
      transfer,
      transfer.fromWarehouseId ? whName.get(transfer.fromWarehouseId) ?? null : null,
      transfer.toWarehouseId ? whName.get(transfer.toWarehouseId) ?? null : null,
    ),
    lines: lines.map(transferLineWire),
  });
}

/** GET /inventory/issues — the tenant's material issues (company-scoped). */
async function listIssues(db: TenantDb): Promise<Record<string, unknown>[]> {
  const [issues, projectRows] = await Promise.all([
    db.select(materialIssues) as Promise<MaterialIssueRow[]>,
    db.select(projects) as Promise<ProjectRow[]>,
  ]);
  const projectName = new Map(projectRows.map((p) => [p.id, p.name]));
  return newestFirst(issues).map((i) =>
    issueWire(i, i.projectId ? projectName.get(i.projectId) ?? null : null),
  );
}

/** GET /inventory/issues/{id} — header (scoped 404) + its issue_line rows. */
async function getIssue(
  db: TenantDb,
  issueId: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const [issue] = (await db.select(
    materialIssues,
    eq(materialIssues.id, issueId),
  )) as MaterialIssueRow[];
  if (!issue) return notFound(reply, `material issue ${issueId} not found`);
  const [lines, projectRows] = await Promise.all([
    // issue_line carries no company_id — scoped THROUGH material_issue.
    db.selectThrough(
      issueLines,
      [{ fk: issueLines.issueId, parent: materialIssues }],
      eq(materialIssues.id, issueId),
    ) as Promise<IssueLineRow[]>,
    db.select(projects) as Promise<ProjectRow[]>,
  ]);
  const projectName = new Map(projectRows.map((p) => [p.id, p.name]));
  return reply.code(200).send({
    ...issueWire(issue, issue.projectId ? projectName.get(issue.projectId) ?? null : null),
    lines: lines.map(issueLineWire),
  });
}

// ---------------------------------------------------------------------------
// Line-body parsing (opaque JSON → {item_id, qty, cc_id?})
// ---------------------------------------------------------------------------

interface ParsedLine {
  itemId: string;
  qty: number;
  ccId: string | null;
}

/**
 * Parse + validate the create body's `lines` array. Every line needs a non-empty
 * item_id and a finite qty > 0. Returns the parsed lines, or an error message the
 * caller sends as a 400.
 */
function parseLines(
  body: Record<string, unknown>,
): { lines: ParsedLine[] } | { error: string } {
  const raw = pick(body, "lines");
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "lines is required and must be a non-empty array" };
  }
  const lines: ParsedLine[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      return { error: "each line must be an object { item_id, qty }" };
    }
    const line = entry as Record<string, unknown>;
    const itemId = str(pick(line, "item_id", "itemId")).trim();
    if (!itemId) return { error: "each line requires an item_id" };
    const qty = toNum(pick(line, "qty"));
    if (qty == null || qty <= 0) {
      return { error: "each line requires a qty greater than zero" };
    }
    const ccId = str(pick(line, "cc_id", "ccId")).trim() || null;
    lines.push({ itemId, qty, ccId });
  }
  return { lines };
}

// ---------------------------------------------------------------------------
// CREATES
// ---------------------------------------------------------------------------

/**
 * POST /inventory/items — create an inventory item (inventory.jsx ItemAddForm).
 * finance.create. code + name required; price is the STANDARD cost (finite, > 0 —
 * it drives every valuation, money=SERVER). warehouse_id (optional) must resolve to
 * this tenant. The legacy `stock` scalar seeds at 0 (on-hand lives in the ledger).
 */
async function createItem(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (!(await requireFinance(request, reply, "create"))) return reply;

  const code = str(pick(body, "code")).trim();
  if (!code) return badRequest(reply, "code is required");
  const name = str(pick(body, "name")).trim();
  if (!name) return badRequest(reply, "name is required");
  const rawPrice = toNum(pick(body, "price"));
  if (rawPrice == null || rawPrice <= 0) {
    return badRequest(reply, "price is required and must be greater than zero");
  }
  const cat = str(pick(body, "cat")).trim() || null;
  const unit = str(pick(body, "unit")).trim() || null;
  const currencyCode = str(pick(body, "currency_code", "currencyCode")).trim() || "THB";
  const lowRaw = toNum(pick(body, "low_point", "lowPoint"));
  const lowPoint = lowRaw != null ? qtyStr(lowRaw) : null;
  const warehouseId = str(pick(body, "warehouse_id", "warehouseId")).trim() || null;

  if (warehouseId) {
    const [wh] = (await db.select(
      warehouses,
      eq(warehouses.id, warehouseId),
    )) as WarehouseRow[];
    if (!wh) return badRequest(reply, "warehouse_id not found in this tenant");
  }

  const [created] = (await db
    .insert(inventoryItems, {
      code,
      name,
      cat,
      unit,
      price: moneyStr(rawPrice),
      currencyCode,
      stock: "0",
      lowPoint,
      warehouseId,
      status: "active",
    })
    .returning()) as InventoryItemRow[];
  // A brand-new item has no ledger movement yet → on-hand 0.
  return reply.code(201).send(itemWire(created!, 0));
}

/**
 * POST /inventory/warehouses — create a warehouse (inventory.jsx WarehouseAddForm).
 * finance.create. code + name required; type/owner/capacity/location are the
 * superset columns (migration 0041).
 */
async function createWarehouse(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (!(await requireFinance(request, reply, "create"))) return reply;

  const code = str(pick(body, "code")).trim();
  if (!code) return badRequest(reply, "code is required");
  const name = str(pick(body, "name")).trim();
  if (!name) return badRequest(reply, "name is required");
  const type = str(pick(body, "type")).trim() || null;
  const owner = str(pick(body, "owner")).trim() || null;
  const location = str(pick(body, "location")).trim() || null;
  const capRaw = toNum(pick(body, "capacity"));
  const capacity = capRaw != null ? qtyStr(capRaw) : null;

  const [created] = (await db
    .insert(warehouses, { code, name, type, owner, location, capacity })
    .returning()) as WarehouseRow[];
  return reply.code(201).send(warehouseWire(created!));
}

/**
 * POST /inventory/transfers — create a PENDING warehouse-to-warehouse transfer
 * (inventory.jsx TransferAddForm). finance.create. from/to warehouses + a non-empty
 * lines[] required; every warehouse + item must resolve to this tenant. In ONE
 * db.transaction: header `value` = round2(Σ qty × item.price) [standard-cost,
 * server — never a client value], qty = Σ qty, status 'pending'; the per-line
 * children are written via insertThrough (transfer_line carries no company_id).
 * NO stock movement + NO JV on create — both are deferred to approve.
 */
async function createTransfer(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const caller = await requireFinance(request, reply, "create");
  if (!caller) return reply;

  const fromWarehouseId = str(pick(body, "from_warehouse_id", "fromWarehouseId")).trim();
  if (!fromWarehouseId) return badRequest(reply, "from_warehouse_id is required");
  const toWarehouseId = str(pick(body, "to_warehouse_id", "toWarehouseId")).trim();
  if (!toWarehouseId) return badRequest(reply, "to_warehouse_id is required");
  if (fromWarehouseId === toWarehouseId) {
    return badRequest(reply, "from_warehouse_id and to_warehouse_id must differ");
  }
  const transferDate = str(pick(body, "transfer_date", "transferDate")).trim() || null;

  const parsed = parseLines(body);
  if ("error" in parsed) return badRequest(reply, parsed.error);
  const lines = parsed.lines;

  // Tenant ownership: both warehouses + every line item must be this tenant's.
  const [whRows, items] = await Promise.all([
    db.select(warehouses) as Promise<WarehouseRow[]>,
    db.select(inventoryItems) as Promise<InventoryItemRow[]>,
  ]);
  const whIds = new Set(whRows.map((w) => w.id));
  if (!whIds.has(fromWarehouseId)) {
    return badRequest(reply, "from_warehouse_id not found in this tenant");
  }
  if (!whIds.has(toWarehouseId)) {
    return badRequest(reply, "to_warehouse_id not found in this tenant");
  }
  const priceById = new Map(items.map((it) => [it.id, num(it.price)]));
  for (const line of lines) {
    if (!priceById.has(line.itemId)) {
      return badRequest(reply, `item ${line.itemId} not found in this tenant`);
    }
  }

  // SERVER money (standard-cost): value = Σ qty × item.price (resolved per item).
  const value = round2(
    lines.reduce((sum, l) => sum + l.qty * num(priceById.get(l.itemId)), 0),
  );
  const totalQty = round2(lines.reduce((sum, l) => sum + l.qty, 0));
  const transferId = randomUUID();
  const no = await allocTransferNo(db);

  const created = await db.transaction(async (tx) => {
    const [header] = (await tx
      .insert(stockTransfers, {
        id: transferId,
        no,
        fromWarehouseId,
        toWarehouseId,
        qty: qtyStr(totalQty),
        value: moneyStr(value),
        currencyCode: "THB",
        transferDate,
        byUserId: caller.userId,
        status: "pending",
      })
      .returning()) as StockTransferRow[];
    await tx.insertThrough(
      transferLines,
      stockTransfers,
      transferId,
      lines.map((l) => ({
        transferId,
        itemId: l.itemId,
        qty: qtyStr(l.qty),
        fromWh: fromWarehouseId,
        toWh: toWarehouseId,
      })),
    );
    return header!;
  });

  const fromName = whRows.find((w) => w.id === fromWarehouseId)?.name ?? null;
  const toName = whRows.find((w) => w.id === toWarehouseId)?.name ?? null;
  return reply.code(201).send({
    ...transferWire(created, fromName, toName),
    lines: lines.map((l) => ({
      item_id: l.itemId,
      qty: l.qty,
      from_wh: fromWarehouseId,
      to_wh: toWarehouseId,
    })),
  });
}

/**
 * POST /inventory/transfers/{id}/approve — B4 ATOMIC dual-warehouse relocation
 * (ONE db.transaction · B-097). finance.approve. Loads the pending transfer (scoped
 * 404); a non-pending transfer → 409. Inside the tx, for each line: the NEGATIVE-
 * STOCK GUARD (B6) asserts Σ ledger.qty for (item, from_warehouse) − qty ≥ 0 (else
 * 409 rolling back the WHOLE approve), then TWO stock_ledger rows are written
 * atomically — (−qty @ from) + (+qty @ to), refDoc `transfer:<id>`. status flips
 * pending → approved. NO JV (an internal relocation touches no P&L). Returns ActionOk.
 */
async function approveTransfer(
  db: TenantDb,
  request: FastifyRequest,
  transferId: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (!(await requireFinance(request, reply, "approve"))) return reply;

  const [transfer] = (await db.select(
    stockTransfers,
    eq(stockTransfers.id, transferId),
  )) as StockTransferRow[];
  if (!transfer) return notFound(reply, `stock transfer ${transferId} not found`);
  if (transfer.status !== "pending") {
    return conflict(reply, `stock transfer ${transferId} is not pending`);
  }
  const fromWarehouseId = transfer.fromWarehouseId;
  const toWarehouseId = transfer.toWarehouseId;
  if (!fromWarehouseId || !toWarehouseId) {
    return conflict(reply, "stock transfer is missing a source/destination warehouse");
  }
  const lines = (await db.selectThrough(
    transferLines,
    [{ fk: transferLines.transferId, parent: stockTransfers }],
    eq(stockTransfers.id, transferId),
  )) as TransferLineRow[];
  if (lines.length === 0) {
    return conflict(reply, "stock transfer has no lines to move");
  }

  try {
    await db.transaction(async (tx) => {
      // Read the ledger INSIDE the tx so the guard is consistent with the writes.
      const ledgers = (await tx.select(stockLedgers)) as StockLedgerRow[];
      const running = onHandByItemWarehouse(ledgers);
      const ledgerRows: Omit<typeof stockLedgers.$inferInsert, "companyId">[] = [];
      for (const line of lines) {
        const lineFrom = line.fromWh ?? fromWarehouseId;
        const lineTo = line.toWh ?? toWarehouseId;
        const qty = num(line.qty);
        // NEGATIVE-STOCK GUARD (B6): the source balance may not go below zero.
        const fromKey = balanceKey(line.itemId, lineFrom);
        const available = num(running.get(fromKey));
        const remaining = round2(available - qty);
        if (remaining < 0) {
          throw new NegativeStockError(
            `insufficient stock for item ${line.itemId} in warehouse ${lineFrom}: ` +
              `on-hand ${available}, transfer ${qty}`,
          );
        }
        running.set(fromKey, remaining);
        // TWO atomic legs: −qty out of the source, +qty into the destination.
        ledgerRows.push(
          {
            itemId: line.itemId,
            warehouseId: lineFrom,
            qty: qtyStr(-qty),
            refDoc: `transfer:${transferId}`,
          },
          {
            itemId: line.itemId,
            warehouseId: lineTo,
            qty: qtyStr(qty),
            refDoc: `transfer:${transferId}`,
          },
        );
      }
      // stock_ledger carries company_id → the scoped insert door force-sets it;
      // it takes one row at a time (no bulk door), so each leg is a scoped insert.
      for (const row of ledgerRows) {
        await tx.insert(stockLedgers, row).returning();
      }
      // B-149 optimistic guard: fold the pending pre-state into the WHERE so the
      // flip is atomic. If a concurrent approve already advanced this transfer, 0
      // rows match here → roll the whole move back (the ledger legs above) and 409.
      const advanced = await tx
        .update(
          stockTransfers,
          { status: "approved" },
          and(eq(stockTransfers.id, transferId), eq(stockTransfers.status, "pending")),
        )
        .returning();
      if (advanced.length === 0) {
        throw new StaleStateError(`stock transfer ${transferId} is no longer pending`);
      }
    });
  } catch (err) {
    if (err instanceof NegativeStockError) return conflict(reply, err.message);
    if (err instanceof StaleStateError) return conflict(reply, err.message);
    throw err;
  }

  return reply.code(200).send({ id: transferId, status: "approved" });
}

/**
 * POST /inventory/issues — issue stock out to a project + post the cost to WIP
 * (inventory.jsx IssueAddForm). finance.approve (it MOVES stock and POSTS money).
 * project_id + from_warehouse_id + a non-empty lines[] required; project/warehouse/
 * items must resolve to this tenant. In ONE db.transaction (B-097): header `value` =
 * round2(Σ qty × item.price) [standard-cost, server]; per line the NEGATIVE-STOCK
 * GUARD (B6) then a (−qty @ from) stock_ledger row (refDoc `issue:<id>`); the issue
 * (status 'approved') + issue_line children via insertThrough; and the cost-to-WIP
 * JV (B5): Dr 1140 WIP / Cr 5020 materials-cost = value, source_doc `issue:<id>`,
 * carrying project_id + a single distinct cc (when present) on both legs. Returns
 * 201 with the created issue + jv_no.
 */
async function createIssue(
  db: TenantDb,
  request: FastifyRequest,
  body: Record<string, unknown>,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const caller = await requireFinance(request, reply, "approve");
  if (!caller) return reply;

  const projectId = str(pick(body, "project_id", "projectId")).trim();
  if (!projectId) return badRequest(reply, "project_id is required");
  const fromWarehouseId = str(pick(body, "from_warehouse_id", "fromWarehouseId")).trim();
  if (!fromWarehouseId) return badRequest(reply, "from_warehouse_id is required");
  const issueDate = str(pick(body, "issue_date", "issueDate")).trim() || null;

  const parsed = parseLines(body);
  if ("error" in parsed) return badRequest(reply, parsed.error);
  const lines = parsed.lines;

  // Tenant ownership: project, source warehouse + every line item.
  const [project] = (await db.select(
    projects,
    eq(projects.id, projectId),
  )) as ProjectRow[];
  if (!project) return badRequest(reply, "project_id not found in this tenant");
  const [warehouseRows, items] = await Promise.all([
    db.select(warehouses, eq(warehouses.id, fromWarehouseId)) as Promise<WarehouseRow[]>,
    db.select(inventoryItems) as Promise<InventoryItemRow[]>,
  ]);
  if (warehouseRows.length === 0) {
    return badRequest(reply, "from_warehouse_id not found in this tenant");
  }
  const priceById = new Map(items.map((it) => [it.id, num(it.price)]));
  for (const line of lines) {
    if (!priceById.has(line.itemId)) {
      return badRequest(reply, `item ${line.itemId} not found in this tenant`);
    }
  }

  // SERVER money (standard-cost): value = Σ qty × item.price.
  const value = round2(
    lines.reduce((sum, l) => sum + l.qty * num(priceById.get(l.itemId)), 0),
  );
  if (value <= 0) return conflict(reply, "material issue has no value to post");

  // Accounts resolved BEFORE the tx (a read to decide) — a missing code is an
  // honest 409, never a post against an invented account (C-177).
  const acctIds = await resolveAccountIds(db, [WIP_MATERIAL, ACCT.materials]);
  const wipId = acctIds.get(WIP_MATERIAL);
  const materialsId = acctIds.get(ACCT.materials);
  if (!wipId || !materialsId) {
    return conflict(
      reply,
      "the tenant chart of accounts is missing a required posting account (WIP / materials-cost)",
    );
  }

  // A single distinct non-null cc across the lines carries onto the summary JV
  // legs (the labor precedent); a mixed / absent cc → null (the granular cc stays
  // on the issue_line rows). project_id always carries (project material → WIP).
  const distinctCc = new Set(lines.map((l) => l.ccId).filter((c): c is string => c != null));
  const jvCcId = distinctCc.size === 1 ? [...distinctCc][0]! : null;

  const issueId = randomUUID();
  const no = await allocIssueNo(db);
  const jvNo = await allocJvNo(db);
  const jvId = randomUUID();
  const jvLineRows: (typeof jvLines.$inferInsert)[] = [
    { jvId, accountId: wipId, dr: moneyStr(value), cr: moneyStr(0), currencyCode: "THB", ccId: jvCcId, projectId },
    { jvId, accountId: materialsId, dr: moneyStr(0), cr: moneyStr(value), currencyCode: "THB", ccId: jvCcId, projectId },
  ];

  let created: MaterialIssueRow;
  try {
    created = await db.transaction(async (tx) => {
      // NEGATIVE-STOCK GUARD (B6): read the ledger inside the tx for consistency.
      const ledgers = (await tx.select(stockLedgers)) as StockLedgerRow[];
      const running = onHandByItemWarehouse(ledgers);
      const ledgerRows: Omit<typeof stockLedgers.$inferInsert, "companyId">[] = [];
      for (const line of lines) {
        const key = balanceKey(line.itemId, fromWarehouseId);
        const available = num(running.get(key));
        const remaining = round2(available - line.qty);
        if (remaining < 0) {
          throw new NegativeStockError(
            `insufficient stock for item ${line.itemId} in warehouse ${fromWarehouseId}: ` +
              `on-hand ${available}, issue ${line.qty}`,
          );
        }
        running.set(key, remaining);
        ledgerRows.push({
          itemId: line.itemId,
          warehouseId: fromWarehouseId,
          qty: qtyStr(-line.qty),
          refDoc: `issue:${issueId}`,
        });
      }
      const [header] = (await tx
        .insert(materialIssues, {
          id: issueId,
          no,
          projectId,
          fromWarehouseId,
          value: moneyStr(value),
          currencyCode: "THB",
          issueDate,
          byUserId: caller.userId,
          status: "approved",
        })
        .returning()) as MaterialIssueRow[];
      await tx.insertThrough(
        issueLines,
        materialIssues,
        issueId,
        lines.map((l) => ({ issueId, itemId: l.itemId, qty: qtyStr(l.qty), ccId: l.ccId })),
      );
      // stock_ledger carries company_id → scoped insert door, one row at a time.
      for (const row of ledgerRows) {
        await tx.insert(stockLedgers, row).returning();
      }
      // Cost-to-WIP JV (B5): Dr 1140 WIP / Cr 5020 materials-cost = value.
      await tx
        .insert(jvs, {
          id: jvId,
          no: jvNo,
          sourceDoc: `issue:${issueId}`,
          memo: `material-issue ${no}`,
        })
        .returning();
      await tx.insertThrough(jvLines, jvs, jvId, jvLineRows);
      return header!;
    });
  } catch (err) {
    if (err instanceof NegativeStockError) return conflict(reply, err.message);
    throw err;
  }

  return reply.code(201).send({
    ...issueWire(created, project.name),
    jv_no: jvNo,
    value,
    lines: lines.map((l) => ({ item_id: l.itemId, qty: l.qty, cc_id: l.ccId })),
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/** Register the inventory read + write + action routes on the (/api/v1) scope. */
export function registerInventoryRoute(app: FastifyInstance): void {
  const withTenantList =
    (run: (db: TenantDb) => Promise<Record<string, unknown>[]>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const db = request.db;
      if (!db) return unauthenticated(reply);
      return reply.code(200).send(listEnvelope(await run(db)));
    };

  const body = (request: FastifyRequest): Record<string, unknown> =>
    (request.body ?? {}) as Record<string, unknown>;

  const idParam = (request: FastifyRequest): string =>
    (request.params as { id: string }).id;

  // READS ---------------------------------------------------------------------
  app.get("/inventory/items", withTenantList(listItems));
  app.get("/inventory/items/:id", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return getItem(db, idParam(request), reply);
  });
  app.get("/inventory/warehouses", withTenantList(listWarehouses));
  app.get("/inventory/stock", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    const q = (request.query ?? {}) as Record<string, unknown>;
    const warehouseFilter = str(pick(q, "warehouse_id", "warehouseId")).trim() || null;
    return reply.code(200).send(listEnvelope(await listStock(db, warehouseFilter)));
  });
  app.get("/inventory/transfers", withTenantList(listTransfers));
  app.get("/inventory/transfers/:id", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return getTransfer(db, idParam(request), reply);
  });
  app.get("/inventory/issues", withTenantList(listIssues));
  app.get("/inventory/issues/:id", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return getIssue(db, idParam(request), reply);
  });

  // CREATES -------------------------------------------------------------------
  app.post("/inventory/items", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createItem(db, request, body(request), reply);
  });
  app.post("/inventory/warehouses", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createWarehouse(db, request, body(request), reply);
  });
  app.post("/inventory/transfers", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createTransfer(db, request, body(request), reply);
  });
  app.post("/inventory/issues", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return createIssue(db, request, body(request), reply);
  });

  // ACTIONS -------------------------------------------------------------------
  app.post("/inventory/transfers/:id/approve", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    return approveTransfer(db, request, idParam(request), reply);
  });
}

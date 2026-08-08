// B-340 (G4, live seeded stack, money=SERVER) — the goods receipt is the
// stock_ledger's INBOUND writer, and a replayed receipt does not double-increment.
//
// THE DEFECT THIS CLOSES, measured live on a freshly seeded stack at 2f42244 before
// any code changed: `insert(stockLedgers` existed at exactly TWO sites, both in
// inventory.ts — transfer-approve (two legs, NET ZERO) and material-issue (−qty only).
// `grep -c "stockLedger" apps/api/src/routes/gr.ts` was 0 and the seed wrote none, so
// Σ(qty) was 0 for every (item, warehouse). GET /inventory/stock returned an EMPTY
// list and an issue of 10 against a seeded item answered
// `409 insufficient stock … on-hand 0`. Stock could only ever go DOWN.
//
// WHAT DIES WHEN THE GUARD IS REMOVED — stated per test rather than claimed in
// aggregate, because a suite that cannot fail is not evidence (the B-332 lesson: four
// api tests carried an index's name and NOT ONE died when the index was deleted):
//   - "a receipt RAISES on-hand"            → dies if the ledger insert is deleted
//   - "a replay does NOT raise it twice"    → dies if the ledger write is moved OUTSIDE
//                                             the transaction, or above the header
//                                             insert. Does NOT die if the write is
//                                             deleted entirely (0 == 0), which is why
//                                             the test above it is the one that
//                                             detects deletion. The pair is the guard.
//   - "a return REVERSES it"                → dies if reverseGrMovements is deleted, or
//                                             moved above the guarded status UPDATE
//   - "a second return is 409 and moves no stock" → dies if the reversal is moved above
//                                             the guarded UPDATE
//
// E2E_LIVE-gated + F4-safe (login 429 → graceful skip). DATABASE_URL is needed only to
// read balances back independently of the API's own read path; without it those
// assertions skip rather than pass vacuously.
import { test, expect, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import { clientFor, isRateLimited, okJson, USER_MD_L4 } from "./_api-client.js";

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;
const PG_URL = process.env.DATABASE_URL ?? "";

const rowsOf = (b: Record<string, unknown>): Array<Record<string, unknown>> => {
  const d = (b.data ?? b) as unknown;
  return Array.isArray(d) ? (d as Array<Record<string, unknown>>) : [];
};

const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const key = (suffix: string): string => `b340-${RUN}-${suffix}`;

liveDescribe("B-340 — the goods receipt writes stock_ledger", () => {
  let md: APIRequestContext;
  let rateLimited = false;
  let warehouseId = "";
  let itemId = "";
  let projectId = "";

  /**
   * An APPROVED (open) PO, resolved fresh at call time rather than from a pool taken
   * once in beforeAll. A receipt that reaches the ordered quantity AUTO-CLOSES its PO
   * (status → closed), so a cached list goes stale mid-run — and a stale id produces a
   * "goods can only be received against an approved (open) PO" 409 that looks like a
   * defect in the code under test. Re-reading makes the fixture say what it means.
   */
  const openPo = async (): Promise<string> => {
    const pos = rowsOf(await okJson(await md.get("/api/v1/po"), "GET /po"));
    const open = pos.find((p) => p.status === "approved");
    expect(open, "the seeded stack must carry at least one approved (open) PO").toBeDefined();
    return String(open!.id);
  };

  /** Σ(qty) for (item, warehouse), read straight from Postgres — never from the API
   *  read path the fix also touches, so the assertion cannot be satisfied by a
   *  cosmetic change to how the balance is presented. */
  const balance = async (): Promise<number> => {
    const pg = new Client({ connectionString: PG_URL });
    await pg.connect();
    try {
      const r = await pg.query(
        `SELECT coalesce(sum(qty),0) AS q FROM stock_ledger WHERE item_id=$1 AND warehouse_id=$2`,
        [itemId, warehouseId],
      );
      return Number(r.rows[0].q);
    } finally {
      await pg.end();
    }
  };

  test.beforeAll(async () => {
    try {
      md = await clientFor(USER_MD_L4);
    } catch (e) {
      if (isRateLimited(e)) {
        rateLimited = true;
        return;
      }
      throw e;
    }
    const whs = rowsOf(
      await okJson(await md.get("/api/v1/inventory/warehouses"), "GET /inventory/warehouses"),
    );
    warehouseId = String(whs[0]!.id);
    const items = rowsOf(
      await okJson(await md.get("/api/v1/inventory/items"), "GET /inventory/items"),
    );
    itemId = String(items[0]!.id);
    const projects = rowsOf(await okJson(await md.get("/api/v1/projects"), "GET /projects"));
    projectId = String(projects[0]!.id);
  });

  test.beforeEach(() => {
    test.skip(rateLimited, "login rate-limited (F4 / B-099) — skipping rather than failing");
  });

  /** Receive `qty` of the fixture item against a fresh open PO. */
  const receive = async (
    qty: number,
    opts: { idempotencyKey?: string; rejected?: number; poId?: string } = {},
  ) => {
    const poId = opts.poId ?? (await openPo());
    const body: Record<string, unknown> = {
      po_id: poId,
      warehouse_id: warehouseId,
      lines: [
        {
          item_id: itemId,
          qty_ok: qty,
          qty_rejected: opts.rejected ?? 0,
          name: "B-340 fixture line",
          price: 10,
        },
      ],
    };
    if (opts.idempotencyKey) body.idempotency_key = opts.idempotencyKey;
    const res = await md.post("/api/v1/gr", { data: body });
    return { res, poId };
  };

  test("a receipt RAISES on-hand — and the REJECTED quantity is not received into stock", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to read Σ(qty) independently of the API");
    const before = await balance();
    // 40 good, 10 rejected. Only qty_ok moves: rejected goods go back to the vendor
    // and generate the defect report — receiving them would put goods on the shelf
    // that the storekeeper has already refused.
    const { res } = await receive(40, { rejected: 10, idempotencyKey: key("raise") });
    expect(res.status()).toBe(201);
    expect(await balance()).toBe(before + 40);
  });

  test("the received stock is VISIBLE on GET /inventory/stock — the screen's own read path", async () => {
    // Before this round this endpoint returned an empty list on every real stack, for
    // every item, forever. This is the assertion that `field-stock` renders a shelf.
    const rows = rowsOf(
      await okJson(await md.get("/api/v1/inventory/stock"), "GET /inventory/stock"),
    );
    const mine = rows.find((r) => r.item_id === itemId && r.warehouse_id === warehouseId);
    expect(mine, "the received (item, warehouse) must appear in the stock list").toBeDefined();
    expect(Number(mine!.on_hand)).toBeGreaterThan(0);
  });

  test("a REPLAY does not raise on-hand twice — the ledger write is inside the idempotency guard", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to read Σ(qty) independently of the API");
    const k = key("replay");
    const { res: first, poId } = await receive(25, { idempotencyKey: k });
    expect(first.status()).toBe(201);
    const firstId = String((await first.json()).id);
    const afterFirst = await balance();

    // The SyncProcessor retrying a create it never heard back on. Same key, same
    // anchor, same body.
    const { res: replay } = await receive(25, { idempotencyKey: k, poId });
    expect(replay.status()).toBe(201);
    expect(String((await replay.json()).id), "a replay must return the ORIGINAL receipt").toBe(
      firstId,
    );
    // THE ASSERTION THAT MATTERS: the balance is byte-identical, not merely "close".
    expect(await balance()).toBe(afterFirst);
  });

  test("a RETURN reverses the movement, and a SECOND return is 409 that moves nothing", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to read Σ(qty) independently of the API");
    const { res } = await receive(30, { idempotencyKey: key("return") });
    expect(res.status()).toBe(201);
    const grId = String((await res.json()).id);
    const afterReceipt = await balance();

    const ret = await md.post(`/api/v1/gr/${grId}/return`);
    expect(ret.status()).toBe(200);
    // Without the reversal the returned goods stay on the shelf forever, removable
    // only by issuing them to a project — i.e. by lying twice.
    expect(await balance()).toBe(afterReceipt - 30);
    const afterReturn = await balance();

    // Exactly-once: the 'received' pre-state is folded into the FINAL guarded UPDATE
    // (B-156), so the second caller matches 0 rows and writes no reversal at all.
    const again = await md.post(`/api/v1/gr/${grId}/return`);
    expect(again.status()).toBe(409);
    expect(await balance()).toBe(afterReturn);
  });

  test("an ISSUE against received stock now SUCCEEDS — the 409 that blocked every issue is gone", async () => {
    // The B-339-item-1 consequence, asserted end to end: before this round EVERY issue
    // 409'd on the negative-stock guard because Σ was 0 everywhere, which is why
    // `field-stock`'s failure copy was written around the 409 as the COMMON path.
    const { res } = await receive(60, { idempotencyKey: key("issue") });
    expect(res.status()).toBe(201);
    const issue = await md.post("/api/v1/inventory/issues", {
      data: {
        project_id: projectId,
        from_warehouse_id: warehouseId,
        lines: [{ item_id: itemId, qty: 5 }],
      },
    });
    expect(issue.status(), await issue.text()).toBe(201);
  });

  test("a line with NO item_id moves no stock — an unidentified receipt is recorded, never fuzzy-matched", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to read Σ(qty) independently of the API");
    const before = await balance();
    const poId = await openPo();
    const res = await md.post("/api/v1/gr", {
      data: {
        po_id: poId,
        idempotency_key: key("noitem"),
        lines: [{ qty_ok: 99, name: "unidentified line", price: 10 }],
      },
    });
    // The receipt itself is perfectly legal — this is the legacy/web shape.
    expect(res.status()).toBe(201);
    // But nothing moved. The BOQ and inventory catalogues genuinely diverge (BOQ
    // MAT-WIRE-22 vs inventory MAT-WIRE-25 — same name, different code), so a fuzzy
    // match on a stock-and-money path would silently credit the wrong material.
    expect(await balance()).toBe(before);
  });

  test("a line WITH item_id but no warehouse_id is 400 — a destination is never fabricated", async () => {
    const poId = await openPo();
    const res = await md.post("/api/v1/gr", {
      data: {
        po_id: poId,
        idempotency_key: key("nowh"),
        lines: [{ item_id: itemId, qty_ok: 10, name: "x", price: 10 }],
      },
    });
    expect(res.status()).toBe(400);
    expect(String((await res.json()).message)).toMatch(/warehouse_id is required/i);
  });

  test("a FOREIGN warehouse is 400 — tenant ownership is re-checked at the door", async () => {
    const poId = await openPo();
    const res = await md.post("/api/v1/gr", {
      data: {
        po_id: poId,
        warehouse_id: "00000000-0000-4000-8000-000000000000",
        idempotency_key: key("foreignwh"),
        lines: [{ item_id: itemId, qty_ok: 10, name: "x", price: 10 }],
      },
    });
    expect(res.status()).toBe(400);
  });
});

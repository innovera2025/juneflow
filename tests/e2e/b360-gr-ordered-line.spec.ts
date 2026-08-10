// B-360 (G4, live seeded stack, money = SERVER) — a receipt is priced ONLY from a
// line its own order ordered.
//
// WHAT THIS CLOSES, measured on the seeded stack at 3e25eec BEFORE the fix. B-368
// moved the receipt's price server-side and resolved `boq_item_id` through the
// tenant-scoped BOQ door. That proved WHOSE line it is and nothing about WHICH
// ORDER it belongs to, so the client stopped TYPING the price and started PICKING
// it:
//
//   POST /gr  po_id=<PO-2026-0289, total 612,400>  qty_ok 2
//             boq_item_id=<SUB-STR-001, 1,840,000/unit, from a different PR>
//     → 201  money 3,680,000
//   GET  /gl/posting-inbox → amount 3,680,000
//   POST /gl/post          → JV-2026-0422
//     5020 ต้นทุนวัสดุก่อสร้าง  dr 3,680,000.00
//     2010 เจ้าหนี้การค้า       cr 3,680,000.00
//
// A 2-unit delivery booked 3.68M of cost and 3.68M of trade payable on a 612K
// order. Every seeded BOQ line lives under ONE project, so a project-scope check
// would have accepted that unchanged — the constraint has to be the ORDERED LINE
// SET (pr_item.boq_item_id of the receipt's own PR).
//
// WHY LIVE AND NOT UNIT. The refusal direction is provable against the stub (and
// gr.test.ts proves it), but the PERMIT direction is not: it needs a real PR →
// approve → PO → approve → receive chain, a real pr_item row, and the posted JV
// read back OUT OF POSTGRES rather than from the API's own response.
//
// E2E_LIVE-gated + F4-safe (login 429 → graceful skip), mirroring b368.
import { test, expect, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import {
  boqItemsByPrice,
  clientFor,
  firstVendorId,
  isRateLimited,
  okJson,
  round2,
  USER_MD_L4,
} from "./_api-client.js";

const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;
const PG_URL = process.env.DATABASE_URL ?? "";

const rowsOf = (b: Record<string, unknown>): Array<Record<string, unknown>> => {
  const d = (b.data ?? b) as unknown;
  return Array.isArray(d) ? (d as Array<Record<string, unknown>>) : [];
};

const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

liveDescribe("B-360 — the receipt's price source is its own order's lines", () => {
  let md: APIRequestContext;
  let rateLimited = false;
  /** The line the order ORDERS (cheap — receipts stay far from the ordered qty). */
  let ordered = { id: "", price: 0 };
  /** A line the order does NOT order, and the more expensive of the two. */
  let unordered = { id: "", price: 0 };
  /** The approved PO minted against a PR that ordered `ordered` and nothing else. */
  let poId = "";
  /** A vendor of this tenant (a PO must reference one). */
  let vendorId = "";

  /** The posting-inbox row for a receipt (the shared source of the list AND badge). */
  const inboxRow = async (grId: string): Promise<Record<string, unknown> | undefined> => {
    const body = await okJson(
      await md.get("/api/v1/gl/posting-inbox"),
      "GET /gl/posting-inbox",
    );
    return rowsOf(body).find((r) => r.id === grId && r.source === "gr");
  };

  /** The JV legs Postgres actually holds for a source doc — never the API's echo. */
  const jvLegsOf = async (
    sourceDoc: string,
  ): Promise<{ code: string; dr: number; cr: number }[]> => {
    const pg = new Client({ connectionString: PG_URL });
    await pg.connect();
    try {
      const r = await pg.query(
        `SELECT a.code AS code, l.dr::float8 AS dr, l.cr::float8 AS cr
           FROM jv_line l
           JOIN jv j ON j.id = l.jv_id
           JOIN gl_account a ON a.id = l.account_id
          WHERE j.source_doc = $1
          ORDER BY l.dr DESC`,
        [sourceDoc],
      );
      return r.rows as { code: string; dr: number; cr: number }[];
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
    const items = await boqItemsByPrice(md); // ascending by price
    ordered = items[0]!;
    unordered = items[items.length - 1]!; // the most expensive line in the tenant
    expect(ordered.price).toBeGreaterThan(0);
    expect(unordered.price).toBeGreaterThan(ordered.price);

    // Mint the order: a PR that orders ONE line, approved, and the PO raised from
    // it, approved. 10,000 units ordered against receipts of ≤ 3, so no receipt
    // here can reach the ordered quantity and auto-close the PO mid-file.
    vendorId = await firstVendorId(md);
    const projects = rowsOf(await okJson(await md.get("/api/v1/projects"), "GET /projects"));
    const pr = await okJson(
      await md.post("/api/v1/pr", {
        data: {
          no: `B360-PR-${RUN}`,
          type: "material",
          project_id: String(projects[0]!.id),
          items: [{ boq_item_id: ordered.id, qty: 10_000 }],
        },
      }),
      "POST /pr",
    );
    const prId = String(pr.id);
    await okJson(await md.post(`/api/v1/pr/${prId}/submit`, { data: {} }), "submit PR");
    await okJson(await md.post(`/api/v1/pr/${prId}/approve`, { data: {} }), "approve PR");
    const po = await okJson(
      await md.post("/api/v1/po", { data: { pr_id: prId, no: `B360-PO-${RUN}`, vendor_id: vendorId } }),
      "POST /po",
    );
    poId = String(po.id);
    await okJson(await md.post(`/api/v1/po/${poId}/submit`, { data: {} }), "submit PO");
    await okJson(await md.post(`/api/v1/po/${poId}/approve`, { data: {} }), "approve PO");

    // The order's own lines, as the API reports them — the assertion below about
    // what is and is not orderable is anchored on the server's answer, not ours.
    const detail = await okJson(await md.get(`/api/v1/pr/${prId}`), "GET /pr/:id");
    const lineIds = (detail.items as Array<Record<string, unknown>>).map((l) =>
      String(l.boq_item_id),
    );
    expect(lineIds).toContain(ordered.id);
    expect(lineIds).not.toContain(unordered.id);
  });

  test.beforeEach(() => {
    test.skip(rateLimited, "login rate-limited (B-082 F4 / B-099) — skipping, not failing");
  });

  // -------------------------------------------------------------------------
  test("PERMIT — the line this order ordered still resolves, and prices from the server", async () => {
    const qty = 3;
    const res = await md.post("/api/v1/gr", {
      data: {
        po_id: poId,
        idempotency_key: `b360-${RUN}-permit`,
        lines: [
          {
            qty_ok: qty,
            qty_rejected: 0,
            name: "b360 ordered line",
            ordered_qty: qty,
            boq_item_id: ordered.id,
            price: 999999, // still ignored — money is the server's (B-368)
          },
        ],
      },
    });
    const body = await okJson(res, "POST /gr (ordered line)");
    expect(res.status()).toBe(201);

    const expected = round2(qty * ordered.price);
    expect(body.money).toBe(expected);
    expect(body.currency_code).toBe("THB");

    // …and it reaches the GL with the same figure, and posts a balanced JV.
    const id = String(body.id);
    expect((await inboxRow(id))!.amount).toBe(expected);
    const posted = await okJson(
      await md.post("/api/v1/gl/post", { data: { doc_ids: [id] } }),
      "POST /gl/post",
    );
    expect(posted.skipped).toEqual([]);
    expect(posted.posted).toEqual([
      { doc_id: id, source: "gr", jv_no: expect.any(String), amount: expected },
    ]);

    test.skip(!PG_URL, "DATABASE_URL not set — skipping the independent ledger read-back");
    const legs = await jvLegsOf(`gr:${id}`);
    expect(legs).toHaveLength(2);
    expect(legs.find((l) => l.dr > 0)!.code).toBe("5020");
    expect(legs.find((l) => l.cr > 0)!.code).toBe("2010");
    expect(round2(legs.find((l) => l.dr > 0)!.dr)).toBe(expected);
  });

  test("REFUSE — a line this order never ordered is 400, and nothing is written", async () => {
    const before = rowsOf(await okJson(await md.get("/api/v1/gr"), "GET /gr")).length;
    const qty = 2;
    const res = await md.post("/api/v1/gr", {
      data: {
        po_id: poId,
        idempotency_key: `b360-${RUN}-refuse`,
        lines: [
          {
            qty_ok: qty,
            qty_rejected: 0,
            name: "b360 someone else's line",
            ordered_qty: qty,
            boq_item_id: unordered.id, // the 1,840,000/unit shape
          },
        ],
      },
    });
    // 400 VALIDATION, not 404 and not 409: the line EXISTS and this tenant can see
    // it — the REQUEST is what is incoherent, and nothing about that body will ever
    // become valid (sync_processor.dart dead-letters 4xx permanently, which is the
    // correct outcome for a receipt that must be re-typed, not retried).
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("VALIDATION");
    expect(body.message).toContain("not a line of this order");
    // The probe is discriminating: this is the money that WOULD have been booked.
    expect(round2(qty * unordered.price)).toBeGreaterThan(round2(qty * ordered.price));

    // Nothing was written — no receipt, and therefore nothing to post.
    expect(rowsOf(await okJson(await md.get("/api/v1/gr"), "GET /gr")).length).toBe(before);
  });

  test("REFUSE — the same line, replayed with a key ALREADY stored, is still 400", async () => {
    // The refusal sits BEFORE the idempotency pre-check on purpose: a replay naming
    // a line that is not on this order must never be answered from our data.
    const key = `b360-${RUN}-replay`;
    const first = await md.post("/api/v1/gr", {
      data: {
        po_id: poId,
        idempotency_key: key,
        lines: [
          {
            qty_ok: 1,
            name: "b360 replayed",
            ordered_qty: 1,
            boq_item_id: ordered.id,
          },
        ],
      },
    });
    expect(first.status()).toBe(201);

    const replay = await md.post("/api/v1/gr", {
      data: {
        po_id: poId,
        idempotency_key: key, // the SAME key — the pre-check would resolve it
        lines: [
          {
            qty_ok: 1,
            name: "b360 replayed",
            ordered_qty: 1,
            boq_item_id: unordered.id, // …but the line is not on this order
          },
        ],
      },
    });
    expect(replay.status()).toBe(400);
    expect((await replay.json()).message).toContain("not a line of this order");
  });

  test("an order with NO ordered lines can price nothing (the lump-sum shape)", async () => {
    // A PR with no items[] — the honest state of a lump-sum งานเหมา order, and the
    // shape most seeded PRs carry. There is no ordered price basis anywhere, so a
    // named boq_item is refused rather than priced off an unrelated line.
    const projects = rowsOf(await okJson(await md.get("/api/v1/projects"), "GET /projects"));
    const pr = await okJson(
      await md.post("/api/v1/pr", {
        data: {
          no: `B360-PR-LUMP-${RUN}`,
          type: "subcon",
          project_id: String(projects[0]!.id),
          items: [],
        },
      }),
      "POST /pr (lump sum)",
    );
    const prId = String(pr.id);
    await okJson(await md.post(`/api/v1/pr/${prId}/submit`, { data: {} }), "submit PR");
    await okJson(await md.post(`/api/v1/pr/${prId}/approve`, { data: {} }), "approve PR");
    const po = await okJson(
      await md.post("/api/v1/po", { data: { pr_id: prId, no: `B360-PO-LUMP-${RUN}`, vendor_id: vendorId } }),
      "POST /po (lump sum)",
    );
    const lumpPo = String(po.id);
    await okJson(await md.post(`/api/v1/po/${lumpPo}/submit`, { data: {} }), "submit PO");
    await okJson(await md.post(`/api/v1/po/${lumpPo}/approve`, { data: {} }), "approve PO");

    const res = await md.post("/api/v1/gr", {
      data: {
        po_id: lumpPo,
        idempotency_key: `b360-${RUN}-lump`,
        lines: [{ qty_ok: 1, name: "b360 lump", ordered_qty: 1, boq_item_id: ordered.id }],
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toContain("not a line of this order");

    // …and the SAME receipt without a boq_item_id is still recorded — it simply
    // carries no postable money (0.00 = "unknown", never "zero baht").
    const bare = await md.post("/api/v1/gr", {
      data: {
        po_id: lumpPo,
        idempotency_key: `b360-${RUN}-lump-bare`,
        lines: [{ qty_ok: 1, name: "b360 lump bare", ordered_qty: 1 }],
      },
    });
    const bareBody = await okJson(bare, "POST /gr (bare lump line)");
    expect(bare.status()).toBe(201);
    expect(bareBody.money).toBe(0);
    const inbox = await inboxRow(String(bareBody.id));
    expect(inbox!.amount).toBeNull(); // not postable, and not fabricated as 0
  });
});

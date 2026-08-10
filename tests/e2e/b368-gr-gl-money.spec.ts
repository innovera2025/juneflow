// B-368 (G4, live seeded stack, money = SERVER) — the goods receipt carries a COST
// onto the GL, that cost is the server's, and a posted receipt is frozen.
//
// WHAT THIS CLOSES, measured on the seeded stack before any code changed:
//   · `gl-posting.ts` set `amount: null` for every gr row with the comment "GAP: gr
//     carries received/rejected QUANTITY, not a money value", so POST /gl/post always
//     answered `{reason: "no postable money amount"}` for a receipt. FLOW-A was a
//     document chain with no cost in it.
//   · The value was there the whole time — `gr.ts` already derives Σ(received × price)
//     for the LIST wire — but `gr_item.price` came STRAIGHT OFF THE REQUEST BODY
//     (`const price = toNum(pick(line, "price")) ?? 0`). Lifting that into a posted GL
//     amount without moving the price server-side would have made a client the origin
//     of a money figure, which is the 3,000,000-approved-by-sending-500,000 shape.
//
// WHY THESE ASSERTIONS ARE LIVE AND NOT UNIT. Three of them cannot be proved against
// the stub: the JV legs are read back OUT OF POSTGRES rather than from the API's own
// response (a cosmetic change to the response could otherwise satisfy them); the
// derived amount is compared against the BOQ price the API itself served from a
// DIFFERENT endpoint; and the posted-freeze needs a real committed JV row.
//
// E2E_LIVE-gated + F4-safe (login 429 → graceful skip), mirroring b340/b342.
// DATABASE_URL is needed only for the independent ledger read-back; without it those
// assertions SKIP rather than pass vacuously.
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

liveDescribe("B-368 — the goods receipt posts a real cost, and the cost is the server's", () => {
  let md: APIRequestContext;
  let rateLimited = false;
  /** A priced BOQ line of this tenant — the ONLY server price source for a gr line. */
  let boq = { id: "", price: 0 };

  /**
   * The APPROVED (open) PO every priced receipt in this file is received against,
   * MINTED here rather than picked off the seed — B-360.
   *
   * A receipt may now only be priced from a BOQ line its own order actually
   * ORDERED (pr_item.boq_item_id of the source PR), so "some approved PO" is no
   * longer a sufficient anchor: most seeded PRs carry no pr_item rows at all, and
   * the one that does (PR-2026-0418) auto-closes on the first receipt because its
   * ordered quantity is already exceeded by the seeded GRs. Minting the order makes
   * the anchor's ordered set KNOWN, and the ordered quantity is deliberately far
   * above anything received here so the PO cannot close mid-run.
   *
   * It also exercises the real chain end to end (PR → approve → PO → approve →
   * receive) instead of assuming a seeded shortcut.
   */
  const mintOrderedPo = async (qtyOrdered: number): Promise<string> => {
    const projects = rowsOf(await okJson(await md.get("/api/v1/projects"), "GET /projects"));
    expect(projects.length, "the seeded stack must carry a project").toBeGreaterThan(0);
    const pr = await okJson(
      await md.post("/api/v1/pr", {
        data: {
          no: `B348-PR-${RUN}`,
          type: "material",
          project_id: String(projects[0]!.id),
          items: [{ boq_item_id: boq.id, qty: qtyOrdered }],
        },
      }),
      "POST /pr",
    );
    const prId = String(pr.id);
    await okJson(await md.post(`/api/v1/pr/${prId}/submit`, { data: {} }), "submit PR");
    await okJson(await md.post(`/api/v1/pr/${prId}/approve`, { data: {} }), "approve PR");
    const po = await okJson(
      await md.post("/api/v1/po", { data: { pr_id: prId, no: `B348-PO-${RUN}`, vendor_id: await firstVendorId(md) } }),
      "POST /po",
    );
    const poId = String(po.id);
    await okJson(await md.post(`/api/v1/po/${poId}/submit`, { data: {} }), "submit PO");
    const approved = await okJson(
      await md.post(`/api/v1/po/${poId}/approve`, { data: {} }),
      "approve PO",
    );
    expect(approved.status).toBe("approved");
    return poId;
  };

  /** The minted anchor (one per run — its ordered qty is never reached). */
  let orderedPo = "";

  /** The posting-inbox row for a receipt (the shared source of the list AND the badge). */
  const inboxRow = async (grId: string): Promise<Record<string, unknown> | undefined> => {
    const body = await okJson(
      await md.get("/api/v1/gl/posting-inbox"),
      "GET /gl/posting-inbox",
    );
    return rowsOf(body).find((r) => r.id === grId && r.source === "gr");
  };

  /** The receipt's own list-wire row (what the GR screen shows). */
  const grRow = async (grId: string): Promise<Record<string, unknown>> => {
    const body = await okJson(await md.get("/api/v1/gr"), "GET /gr");
    const row = rowsOf(body).find((r) => r.id === grId);
    expect(row, `GR ${grId} must appear on GET /gr`).toBeDefined();
    return row!;
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

  /** Create a receipt against a fresh open PO and return its id + response body. */
  const createGr = async (
    lines: Record<string, unknown>[],
    suffix: string,
  ): Promise<{ id: string; body: Record<string, unknown> }> => {
    const res = await md.post("/api/v1/gr", {
      data: { po_id: orderedPo, idempotency_key: `b368-${RUN}-${suffix}`, lines },
    });
    const body = await okJson(res, `POST /gr (${suffix})`);
    expect(res.status()).toBe(201);
    return { id: String(body.id), body };
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
    const items = await boqItemsByPrice(md);
    // The CHEAPEST priced line: quantities stay small, so a receipt cannot
    // accidentally reach the PO's ordered qty and auto-close it mid-suite.
    boq = items[0]!;
    expect(boq.price).toBeGreaterThan(0);
    // B-360: the anchor must have ORDERED this line. 10,000 units ordered against
    // receipts of ≤ 7 — the PO cannot close inside this file.
    orderedPo = await mintOrderedPo(10_000);
  });

  test.beforeEach(() => {
    test.skip(rateLimited, "login rate-limited (B-082 F4 / B-099) — skipping, not failing");
  });

  // -------------------------------------------------------------------------
  test("a priced receipt reaches the GL inbox with the SAME figure the GR screen shows", async () => {
    const qty = 7;
    const { id, body } = await createGr(
      [{ qty_ok: qty, qty_rejected: 0, name: "b368 cement", ordered_qty: qty, unit: "ถุง", boq_item_id: boq.id }],
      "priced",
    );

    // The expected value is computed from the price GET /boq/{id}/items served —
    // a different endpoint than either of the two under test.
    const expected = round2(qty * boq.price);
    expect(expected).toBeGreaterThan(0);

    expect(body.money).toBe(expected);
    expect((await grRow(id)).money).toBe(expected);

    const row = await inboxRow(id);
    expect(row, "a received PO-anchored GR must appear in the posting inbox").toBeDefined();
    expect(row!.amount).toBe(expected); // NOT null — the old GAP
    expect(row!.posted).toBe(false);
    // The GL and the GR screen quote ONE number for one receipt.
    expect(row!.amount).toBe((await grRow(id)).money);
  });

  test("the SERVER owns the price: a client `price` of 999999 changes nothing", async () => {
    const qty = 3;
    const { id, body } = await createGr(
      [
        {
          qty_ok: qty,
          qty_rejected: 0,
          name: "b368 forged",
          ordered_qty: qty,
          unit: "ถุง",
          boq_item_id: boq.id,
          price: 999999, // the attack
          currency_code: "USD", // …and its label
        },
      ],
      "forged",
    );

    const expected = round2(qty * boq.price);
    expect(expected).toBeLessThan(999999 * qty); // the probe is discriminating
    expect(body.money).toBe(expected);
    expect(body.currency_code).toBe("THB");
    expect((await inboxRow(id))!.amount).toBe(expected);
    expect((await inboxRow(id))!.currency_code).toBe("THB");
  });

  test("an unresolvable boq_item_id is refused (400) and nothing is written", async () => {
    const before = rowsOf(await okJson(await md.get("/api/v1/gr"), "GET /gr")).length;
    const res = await md.post("/api/v1/gr", {
      data: {
        po_id: orderedPo,
        idempotency_key: `b368-${RUN}-foreign`,
        lines: [
          {
            qty_ok: 1,
            name: "b368 foreign",
            ordered_qty: 1,
            // A well-formed uuid that is no BOQ item at all.
            boq_item_id: "00000000-0000-4000-8000-000000000348",
          },
        ],
      },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION");
    // B-360 answers FIRST for an id like this: it is refused for not being on this
    // ORDER, before the tenant-scoped price read is ever issued. The tenant-scope
    // refusal itself (an id this tenant cannot see, but which the order DOES name)
    // is a shape only the stub can build, and gr.test.ts covers it.
    expect((await res.json()).message).toContain("not a line of this order");
    const after = rowsOf(await okJson(await md.get("/api/v1/gr"), "GET /gr")).length;
    expect(after).toBe(before);
  });

  test("POST /gl/post books a BALANCED Dr 5020 / Cr 2010 for the derived amount", async () => {
    const qty = 5;
    const { id } = await createGr(
      [{ qty_ok: qty, qty_rejected: 0, name: "b368 post", ordered_qty: qty, unit: "ถุง", boq_item_id: boq.id }],
      "post",
    );
    const expected = round2(qty * boq.price);

    const res = await md.post("/api/v1/gl/post", { data: { doc_ids: [id] } });
    const body = await okJson(res, "POST /gl/post");
    expect(body.skipped).toEqual([]);
    expect(body.posted).toEqual([
      { doc_id: id, source: "gr", jv_no: expect.any(String), amount: expected },
    ]);

    // The inbox now reads it back as posted through the shared source_doc ref.
    const row = await inboxRow(id);
    expect(row!.posted).toBe(true);
    expect(row!.jv_no).toBe((body.posted as { jv_no: string }[])[0]!.jv_no);

    // …and Postgres holds the two legs. Read independently of the API.
    test.skip(!PG_URL, "DATABASE_URL not set — skipping the independent ledger read-back");
    const legs = await jvLegsOf(`gr:${id}`);
    expect(legs).toHaveLength(2);
    const dr = legs.find((l) => l.dr > 0)!;
    const cr = legs.find((l) => l.cr > 0)!;
    expect(dr.code).toBe("5020"); // material cost
    expect(cr.code).toBe("2010"); // trade AP
    expect(round2(dr.dr)).toBe(expected);
    expect(round2(cr.cr)).toBe(expected);
    expect(round2(dr.dr - cr.cr)).toBe(0); // balanced
  });

  test("a POSTED receipt can no longer be returned or cancelled (409, never 500)", async () => {
    const qty = 2;
    const { id } = await createGr(
      [{ qty_ok: qty, qty_rejected: 0, name: "b368 frozen", ordered_qty: qty, unit: "ถุง", boq_item_id: boq.id }],
      "frozen",
    );
    await okJson(await md.post("/api/v1/gl/post", { data: { doc_ids: [id] } }), "POST /gl/post");
    expect((await inboxRow(id))!.posted).toBe(true);

    for (const verb of ["return", "cancel"]) {
      const res = await md.post(`/api/v1/gr/${id}/${verb}`);
      // 409, not 500: sync_processor.dart DEFERS a 5xx and stops the drain, so a
      // 500 here would wedge a phone's whole offline queue.
      expect(res.status(), `${verb} on a posted GR`).toBe(409);
      const body = (await res.json()) as { code: string; message: string };
      expect(body.code).toBe("INVALID_STATE");
      expect(body.message).toContain("posted");
    }
    // The receipt is untouched — still received, still posted.
    expect((await grRow(id)).status).toBe("received");
  });

  test("an UNPOSTED receipt still returns, and a returned receipt leaves the inbox", async () => {
    const qty = 2;
    const { id } = await createGr(
      [{ qty_ok: qty, qty_rejected: 0, name: "b368 returnable", ordered_qty: qty, unit: "ถุง", boq_item_id: boq.id }],
      "returnable",
    );
    expect(await inboxRow(id)).toBeDefined();

    const res = await md.post(`/api/v1/gr/${id}/return`);
    expect(res.status()).toBe(200);
    expect((await res.json()).status).toBe("returned");

    // The inbox enumerates `status = 'received'` only — a returned receipt is not
    // awaiting posting, and the gl.inbox BADGE derives from the same function.
    expect(await inboxRow(id)).toBeUndefined();
  });

  test("the MOBILE shape (bare qty lines) has no postable amount and is skipped, not zero-posted", async () => {
    // st_receive posts {qty_ok} with no `name` and deliberately no `price`, so no
    // gr_item is written at all. Σ over an empty line set is 0 — and 0 here would
    // mean "this delivery was worth nothing", not "nobody recorded what it was worth".
    const { id } = await createGr([{ qty_ok: 4, qty_rejected: 0 }], "mobile");

    const row = await inboxRow(id);
    expect(row!.amount).toBeNull();

    const body = await okJson(
      await md.post("/api/v1/gl/post", { data: { doc_ids: [id] } }),
      "POST /gl/post (mobile shape)",
    );
    expect(body.posted).toEqual([]);
    expect(body.skipped).toEqual([{ doc_id: id, reason: "no postable money amount" }]);

    test.skip(!PG_URL, "DATABASE_URL not set — skipping the independent ledger read-back");
    expect(await jvLegsOf(`gr:${id}`)).toHaveLength(0); // no zero-amount JV was written
  });

  test("posting the same receipt twice books ONE JV (idempotent, never a double cost)", async () => {
    const qty = 3;
    const { id } = await createGr(
      [{ qty_ok: qty, qty_rejected: 0, name: "b368 twice", ordered_qty: qty, unit: "ถุง", boq_item_id: boq.id }],
      "twice",
    );

    const first = await okJson(
      await md.post("/api/v1/gl/post", { data: { doc_ids: [id] } }),
      "POST /gl/post #1",
    );
    expect((first.posted as unknown[]).length).toBe(1);

    const second = await okJson(
      await md.post("/api/v1/gl/post", { data: { doc_ids: [id] } }),
      "POST /gl/post #2",
    );
    expect(second.posted).toEqual([]);
    expect(second.skipped).toEqual([{ doc_id: id, reason: "already posted" }]);

    test.skip(!PG_URL, "DATABASE_URL not set — skipping the independent ledger read-back");
    expect(await jvLegsOf(`gr:${id}`)).toHaveLength(2); // still exactly one 2-leg JV
  });
});

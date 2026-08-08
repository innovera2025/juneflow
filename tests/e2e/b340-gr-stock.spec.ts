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
// WHAT DIES WHEN THE GUARD IS REMOVED — measured by actually reverting each guard and
// counting, not asserted, because a suite that cannot fail is not evidence (the B-332
// lesson: four api tests carried an index's name and NOT ONE died when the index was
// deleted). Every line below is a probe that was RUN:
//   - "a receipt RAISES on-hand"          → DIES (with "a RETURN reverses") if the
//                                           ledger insert is deleted: 2 failed / 14 passed
//   - "a CONCURRENT replay"               → DIES if the ledger write is moved outside the
//                                           transaction AND above the header insert
//   - "a RETURN reverses …"               → DIES if reverseGrMovements is deleted, and
//                                           also if the write is misplaced (the ref_doc
//                                           stops matching the receipt)
//   - "cannot DEADLOCK"                   → DIES if gr.ts stops sorting its ledger inserts
//                                           into inLockOrder: 8 of 14 measured rounds
//                                           answered 500 on a PG 40P01, which nothing
//                                           catches and which wedges the phone's drain
//
// ONE CORRECTION, kept visible because the first version of this header was WRONG and a
// probe caught it. It claimed the SEQUENTIAL replay test dies if the ledger write leaves
// the transaction. It does not, and cannot: on a sequential replay the B-264 pre-check
// resolves the original and RETURNS — the transaction is never entered, so no write of
// any kind runs and its placement is unobservable. Moving the write after the try/catch
// scored 16/16 GREEN. Only a CONCURRENT replay, where both callers pass the pre-check
// and one loses on the 23505, can see where the write sits. That test was added as a
// result, and the sequential one is honestly labelled as covering the pre-check instead.
//
// E2E_LIVE-gated + F4-safe (login 429 → graceful skip). DATABASE_URL is needed only to
// read balances back independently of the API's own read path; without it those
// assertions skip rather than pass vacuously.
import { test, expect, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { clientFor, isRateLimited, okJson, USER_MD_L4, API_URL } from "./_api-client.js";

const execFileAsync = promisify(execFile);

/**
 * Fire N POSTs from N SEPARATE OS PROCESSES on one wall-clock deadline. A Promise.all
 * in this process would share undici's connection scheduler and stagger into a clean
 * pass — that is measurably how B-336's first measurement under-reported.
 */
async function burst(
  path: string,
  token: string,
  bodies: Record<string, unknown>[],
): Promise<number[]> {
  const dir = mkdtempSync(join(tmpdir(), "b340-"));
  try {
    bodies.forEach((b, i) => writeFileSync(join(dir, `body.${i}`), JSON.stringify(b)));
    const script = `
set -u
START=$(( $(python3 -c 'import time; print(int(time.time()*1000))') + 900 ))
for i in $(seq 0 ${bodies.length - 1}); do
  (
    while [ "$(python3 -c 'import time; print(int(time.time()*1000))')" -lt "$START" ]; do :; done
    curl -s -o /dev/null -w "%{http_code}" -X POST "${API_URL}${path}" \
      -H "authorization: Bearer ${token}" -H 'content-type: application/json' \
      --data-binary "@${dir}/body.$i" > "${dir}/code.$i"
  ) &
done
wait
for i in $(seq 0 ${bodies.length - 1}); do cat "${dir}/code.$i"; echo; done
`;
    const { stdout } = await execFileAsync("bash", ["-c", script], { timeout: 60_000 });
    return stdout.trim().split("\n").map(Number);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Fire TWO DIFFERENT posts — different paths, different bodies — from two SEPARATE OS
 * PROCESSES on one wall-clock deadline, and return [codeA, codeB].
 *
 * burst() above races N copies of ONE op; a lock-order deadlock needs two DIFFERENT ops
 * whose lock sets overlap, so it needs its own helper. Separate processes for the same
 * reason as burst: undici's shared scheduler in this process staggers a Promise.all into
 * a clean pass, and the whole point is that both transactions are open at once.
 */
async function raceTwo(
  token: string,
  a: { path: string; body: Record<string, unknown> },
  b: { path: string; body: Record<string, unknown> },
): Promise<[number, number]> {
  const dir = mkdtempSync(join(tmpdir(), "b340lo-"));
  try {
    writeFileSync(join(dir, "body.0"), JSON.stringify(a.body));
    writeFileSync(join(dir, "body.1"), JSON.stringify(b.body));
    const paths = [a.path, b.path];
    const script = `
set -u
START=$(( $(python3 -c 'import time; print(int(time.time()*1000))') + 900 ))
${[0, 1]
  .map(
    (i) => `(
  while [ "$(python3 -c 'import time; print(int(time.time()*1000))')" -lt "$START" ]; do :; done
  curl -s -o /dev/null -w "%{http_code}" -X POST "${API_URL}${paths[i]}" \
    -H "authorization: Bearer ${token}" -H 'content-type: application/json' \
    --data-binary "@${dir}/body.${i}" > "${dir}/code.${i}"
) &`,
  )
  .join("\n")}
wait
for i in 0 1; do cat "${dir}/code.$i"; echo; done
`;
    const { stdout } = await execFileAsync("bash", ["-c", script], { timeout: 60_000 });
    const [x, y] = stdout.trim().split("\n").map(Number);
    return [x!, y!];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A raw bearer token — the burst runs outside Playwright's request context. */
async function bearerFor(email: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "juneflow-dev" }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  return String(body.token ?? body.access_token);
}

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
  let token = "";
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
      token = await bearerFor(USER_MD_L4);
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

  test("a SEQUENTIAL replay does not raise on-hand twice (this covers the B-264 PRE-CHECK, not the write's placement)", async () => {
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

  test("a CONCURRENT replay does not raise on-hand twice — the ledger write is INSIDE the idempotency guard", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to read Σ(qty) independently of the API");
    test.setTimeout(120_000);
    // THE TEST THAT ACTUALLY CONSTRAINS WHERE THE WRITE SITS. On a sequential replay the
    // pre-check returns before the transaction is entered, so the write never runs and
    // its placement is unobservable — proven by probe, 16/16 green with the write moved
    // out. Here all four callers pass the pre-check together; three lose on
    // gr_idempotency_uq, and ONLY a write inside the same transaction as the header
    // insert is rolled back with them. Outside it, three extra movements commit.
    const before = await balance();
    const body = {
      po_id: await openPo(),
      warehouse_id: warehouseId,
      idempotency_key: key("concurrent"),
      lines: [{ item_id: itemId, qty_ok: 7, name: "B-340 concurrent", price: 10 }],
    };
    const codes = await burst("/api/v1/gr", token, [body, body, body, body]);
    expect(codes, `every copy of one replayed op must be answered 201`).toEqual([201, 201, 201, 201]);
    // +7 exactly, not +28.
    expect(await balance()).toBe(before + 7);
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

  test("a receipt and a concurrent ISSUE of the same materials cannot DEADLOCK — 8 of 14 rounds were 500 before the sort", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to stock the items and reopen the PO");
    test.setTimeout(180_000);

    // B-340 gate-4.5 finding 1. THE SHAPE, and every part of it is load-bearing:
    //   - TWO DIFFERENT ops, not two copies of one. POST /gr inserts stock_ledger rows
    //     (each taking an FK `FOR KEY SHARE` on inventory_item); POST /inventory/issues
    //     takes `FOR UPDATE` on the same rows through TenantDb.selectForUpdate. The two
    //     lock modes CONFLICT;
    //   - the GR's lines run DESCENDING by item id and the issue's ASCENDING. Before the
    //     fix the receipt inserted in BODY-LINE order, so the two walked the same rows in
    //     opposite directions — the textbook cycle;
    //   - EIGHT overlapping items, to widen the window between the first lock and the
    //     last;
    //   - SEPARATE OS PROCESSES on one barrier (see raceTwo), because a Promise.all in
    //     this process serialises through undici and never overlaps the transactions.
    // MEASURED at 87e10c2 (pre-fix): 14 rounds → 8 ended in a 500 and the api log carried
    // 8 PG "deadlock detected" (40P01), naming exactly the two statements this round
    // added. EITHER side can be the victim (7 issue, 1 gr). Nothing catches 40P01
    // (`grep -rn "40P01\|deadlock" apps/api/src` → comments only), and sync_processor.dart
    // DEFERS a 5xx: one deadlocked receipt stops the phone's entire offline drain and
    // deadlocks again on every retry.
    // THIS TEST DIES if inLockOrder() is removed from gr.ts — verified by reverting it.
    const items = rowsOf(
      await okJson(await md.get("/api/v1/inventory/items"), "GET /inventory/items"),
    )
      .map((i) => String(i.id))
      .sort();
    expect(items.length, "the race needs several overlapping items to open a window")
      .toBeGreaterThanOrEqual(4);

    const pg = new Client({ connectionString: PG_URL });
    await pg.connect();
    try {
      // FIXTURE, not the path under test: enough stock that the issue passes its
      // negative-stock guard and runs its whole transaction (a guard refusal rolls back
      // early and releases the locks, which would hide the very race being measured).
      await pg.query(`DELETE FROM stock_ledger WHERE ref_doc = 'b340-lockorder-fixture'`);
      for (const id of items) {
        await pg.query(
          `INSERT INTO stock_ledger (company_id,item_id,warehouse_id,qty,ref_doc)
           SELECT company_id,$1,$2,100000,'b340-lockorder-fixture' FROM warehouse WHERE id=$2`,
          [id, warehouseId],
        );
      }
      const poId = await openPo();

      const codes: Array<[number, number]> = [];
      for (let round = 0; round < 8; round++) {
        // Also fixture: a full receipt AUTO-CLOSES its PO, and a closed PO answers 409 —
        // which would look like a pass. Reopening keeps every round's refusal honest.
        await pg.query(`UPDATE po SET status='approved' WHERE id=$1`, [poId]);
        codes.push(
          await raceTwo(
            token,
            {
              path: "/api/v1/gr",
              body: {
                po_id: poId,
                warehouse_id: warehouseId,
                // DESCENDING — the opposite of the lock order the issue path uses.
                lines: [...items].reverse().map((id) => ({ item_id: id, qty_ok: 1 })),
              },
            },
            {
              path: "/api/v1/inventory/issues",
              body: {
                project_id: projectId,
                from_warehouse_id: warehouseId,
                lines: items.map((id) => ({ item_id: id, qty: 1 })),
              },
            },
          ),
        );
      }

      const server5xx = codes.flat().filter((c) => c >= 500);
      expect(
        server5xx,
        `a receipt and an issue of the same materials deadlocked: ${JSON.stringify(codes)}`,
      ).toEqual([]);
      // And the receipt is not merely "not a 500" — it is accepted every round.
      expect(codes.map((c) => c[0]).filter((c) => c !== 201), JSON.stringify(codes)).toEqual([]);
    } finally {
      await pg.query(`DELETE FROM stock_ledger WHERE ref_doc = 'b340-lockorder-fixture'`);
      await pg.end();
    }
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

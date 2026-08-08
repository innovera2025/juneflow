// B-342 (G4, live seeded stack, money=SERVER) — the two unlocked money guards.
//
// Wei ruled B-338 and B-339 item 2 are one class and get one round: "a guard that
// reads and never locks". They are NOT one fix, and the round had to decide per case
// whether an index is even expressible. It answered:
//
//   CASE 1 (B-338, attendance) — an index IS expressible. `attendance_costed_day_uq`,
//     UNIQUE (worker_id, day, cc_id) WHERE cc_id IS NOT NULL: the complement of
//     B-336's `WHERE cc_id IS NULL`, so the two together cover every row. Within its
//     coverage all three key columns are NOT NULL, so there is nothing to escape
//     through — the B-336 inversion, not the B-307 trap.
//
//   CASE 2 (B-339 item 2, stock) — an index is NOT expressible, and this file says so
//     rather than shipping something that looks like one. The invariant is Σ(qty) ≥ 0
//     OVER A SET OF ROWS. A unique index constrains tuple EQUALITY; a CHECK constrains
//     a SINGLE ROW. Neither can state an inequality over an aggregate. Nor can the
//     ledger be locked: SELECT … FOR UPDATE locks rows that EXIST and cannot block
//     another transaction's INSERT under READ COMMITTED, and on a first movement there
//     are no rows at all. The lock is therefore taken on `inventory_item` — a row that
//     already exists and that both writers must pass through.
//
// A NOTE THE ROUND FOUND AND DID NOT EXPECT, kept here because it changes what these
// tests are worth. B-339 item 2 named the ISSUE guard. Measured live at 2f42244 the
// issue path did NOT reproduce the race in 6 rounds — it is serialised BY ACCIDENT,
// because allocJvNo runs outside the tx, a concurrent pair builds the same jv.no, and
// the loser trips jv_company_no_uq (added for the unrelated B-318 defect), rolls back
// ledger row and all, and its RETRY re-reads the ledger and sees the winner's commit.
// The TRANSFER path posts no JV, has no such accident, and failed 5 OF 6 ROUNDS with
// [200,200] and a source balance of −100. Both paths are locked explicitly: resting a
// money guard on a side effect of document numbering is not a guarantee.
//
// HOW THE RACES ARE CONSTRUCTED, and why it is not a Promise.all. undici's shared
// scheduler in one Node process SERIALISES a parallel burst — measurably: B-336's
// first measurement under-reported because of it (a burst of 10 passed 3/3 while a
// burst of 2 failed 2/3). Every burst here is N SEPARATE OS PROCESSES (`curl`) spinning
// on one shared absolute epoch-ms deadline, plus one CONSTRUCTED race that holds an
// uncommitted lock open in a second psql session — which is deterministic and does not
// depend on timing at all.
//
// WHAT DIES WHEN EACH GUARD IS REMOVED — per test, per guard:
//   - "a costed duplicate is refused" / "payroll pays ONE day"  → die if
//     attendance_costed_day_uq is dropped
//   - "a costed duplicate answers 409, never 500"               → dies if labor.ts stops
//     naming the constraint (the 5xx that wedges the phone's whole offline drain)
//   - "the cost-centre split still passes" / "the mixed split"  → guard tests: they must
//     pass BEFORE and AFTER, and they are what proves the index did not close real work
//   - "a concurrent replay still wins its 201"                  → dies if the
//     replay-first ordering in resolveAttendanceConflict is removed
//   - "concurrent transfers cannot drive stock negative"        → dies if
//     selectForUpdate is removed from approveTransfer
//   - "the API BLOCKS on a held inventory_item lock"            → dies if selectForUpdate
//     is removed from createIssue. This is the discriminator: it asserts ELAPSED TIME
//     against a lock held by another session and cannot pass by accident.
import { test, expect, type APIRequestContext } from "@playwright/test";
import { Client } from "pg";
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { clientFor, isRateLimited, okJson, USER_MD_L4, API_URL } from "./_api-client.js";

const execFileAsync = promisify(execFile);
const LIVE = Boolean(process.env.E2E_LIVE);
const liveDescribe = LIVE ? test.describe : test.describe.skip;
const PG_URL = process.env.DATABASE_URL ?? "";

const rowsOf = (b: Record<string, unknown>): Array<Record<string, unknown>> => {
  const d = (b.data ?? b) as unknown;
  return Array.isArray(d) ? (d as Array<Record<string, unknown>>) : [];
};

const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const key = (s: string): string => `b342-${RUN}-${s}`;
/** A randomised year keeps each run's payroll SUM covering only its own rows. */
const YEAR = 2100 + Math.floor(Math.random() * 400);
const DAY_RATE = 500;

async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const pg = new Client({ connectionString: PG_URL });
  await pg.connect();
  try {
    return (await pg.query(q, params)).rows as T[];
  } finally {
    await pg.end();
  }
}

/**
 * Fire N POSTs from N SEPARATE OS PROCESSES, all released on one wall-clock deadline.
 *
 * THE POINT OF THE SUBPROCESSES: a Promise.all in this process would share undici's
 * connection scheduler and stagger into a clean pass. Each curl here has its own
 * process and its own TCP connection, and every one spins (not sleeps) until the same
 * absolute epoch-ms before calling connect().
 */
async function burst(
  path: string,
  token: string,
  bodies: Record<string, unknown>[],
): Promise<number[]> {
  const dir = mkdtempSync(join(tmpdir(), "b342-"));
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

/** The Director's raw bearer token — the burst runs outside Playwright's context. */
async function bearerFor(email: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "juneflow-dev" }),
  });
  const body = (await res.json()) as Record<string, unknown>;
  return String(body.token ?? body.access_token);
}

liveDescribe("B-342 case 1 (B-338) — the costed duplicate on the roster door", () => {
  let md: APIRequestContext;
  let token = "";
  let ccA = "";
  let ccB = "";
  let rateLimited = false;

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
    const ccs = rowsOf(await okJson(await md.get("/api/v1/cost-centers"), "GET /cost-centers"));
    ccA = String(ccs[0]!.id);
    ccB = String(ccs[1]!.id);
  });

  test.beforeEach(() => {
    test.skip(rateLimited, "login rate-limited (F4 / B-099) — skipping rather than failing");
  });

  const newWorker = async (name: string): Promise<string> => {
    const w = await okJson(
      await md.post("/api/v1/labor/workers", { data: { name: `${name} ${RUN}`, day_rate: DAY_RATE } }),
      "POST /labor/workers",
    );
    return String(w.id);
  };

  test("a costed duplicate is REFUSED — one 201, and payroll pays ONE day, not two", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to isolate the period SUM");
    const worker = await newWorker("costed-dup");
    const day = `${YEAR}-05-11`;
    // TWO `full` rows, one worker, one day, the SAME cost centre. Before the index this
    // answered [201,201] → day_fraction 2.00 → payroll 1000 for one day at 500/day.
    const codes = await burst("/api/v1/labor/attendance", token, [
      { worker_id: worker, day, status: "full", cc_id: ccA },
      { worker_id: worker, day, status: "full", cc_id: ccA },
    ]);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(1);

    const rows = await sql<{ n: string; df: string }>(
      `SELECT count(*) n, coalesce(sum(day_fraction),0) df FROM attendance WHERE worker_id=$1 AND day=$2`,
      [worker, day],
    );
    expect(Number(rows[0]!.n)).toBe(1);
    expect(Number(rows[0]!.df)).toBe(1);

    const pay = await okJson(
      await md.post("/api/v1/labor/payroll", { data: { period: `${YEAR}-05`, worker_id: worker } }),
      "POST /labor/payroll",
    );
    expect(Number(pay.amount), "one day worked must pay one day").toBe(DAY_RATE);
  });

  test("the refusal is a 409, NEVER a 500 — a 5xx wedges the phone's entire offline drain", async () => {
    // THE REGRESSION B-336 NEARLY SHIPPED (its break-attempt #4): with the index but
    // without the constraint NAMED in labor.ts, the duplicate rethrows to the 500
    // handler, and sync_processor.dart DEFERS a 5xx and stops draining — so one
    // duplicate strands every queued write behind it. This test is what makes the
    // three-line catch edit non-optional.
    const worker = await newWorker("no-500");
    const day = `${YEAR}-06-11`;
    const first = await md.post("/api/v1/labor/attendance", {
      data: { worker_id: worker, day, status: "full", cc_id: ccA },
    });
    expect(first.status()).toBe(201);
    const second = await md.post("/api/v1/labor/attendance", {
      data: { worker_id: worker, day, status: "half", cc_id: ccA },
    });
    expect(second.status(), await second.text()).toBe(409);
    expect(String((await second.json()).message)).toMatch(/already recorded/i);
  });

  test("LEGITIMATE — the cost-centre SPLIT still passes (this is what the predicate protects)", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to count the rows");
    // The load-bearing refusal of a full natural key: a worker genuinely splits one day
    // across two sites. Both rows carry a NOT NULL cc_id, and the tuples differ, so the
    // index does not see a conflict. A guard test — it must pass before AND after.
    const worker = await newWorker("split");
    const day = `${YEAR}-07-11`;
    const codes = await burst("/api/v1/labor/attendance", token, [
      { worker_id: worker, day, status: "half", cc_id: ccA },
      { worker_id: worker, day, status: "half", cc_id: ccB },
    ]);
    expect(codes).toEqual([201, 201]);
    const rows = await sql<{ n: string; df: string }>(
      `SELECT count(*) n, sum(day_fraction) df FROM attendance WHERE worker_id=$1 AND day=$2`,
      [worker, day],
    );
    expect(Number(rows[0]!.n)).toBe(2);
    expect(Number(rows[0]!.df), "0.5 + 0.5 — one day's pay, correctly allocated").toBe(1);
  });

  test("LEGITIMATE — the MIXED split (one costed, one uncosted) still passes: one row under EACH index", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to count the rows");
    // The case that proves the two predicates are complements rather than overlapping:
    // the uncosted row is covered only by attendance_self_day_uq, the costed one only
    // by attendance_costed_day_uq, and neither collides.
    const worker = await newWorker("mixed");
    const day = `${YEAR}-08-11`;
    const codes = await burst("/api/v1/labor/attendance", token, [
      { worker_id: worker, day, status: "half", cc_id: ccA },
      { worker_id: worker, day, status: "half" },
    ]);
    expect(codes).toEqual([201, 201]);
    const rows = await sql<{ n: string }>(
      `SELECT count(*) n FROM attendance WHERE worker_id=$1 AND day=$2`,
      [worker, day],
    );
    expect(Number(rows[0]!.n)).toBe(2);
  });

  test("a concurrent REPLAY still wins its 201 — the phone dead-letters a 4xx permanently", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to count the rows");
    // One INSERT can violate BOTH the key index and a day index, and Postgres names
    // only one of them. resolveAttendanceConflict therefore resolves the caller's OWN
    // key BEFORE consulting the name — so a legitimate retry of the same op gets its
    // original row's 201 rather than a 409 the SyncProcessor would dead-letter,
    // silently losing a worker's day.
    const worker = await newWorker("replay");
    const day = `${YEAR}-09-11`;
    const k = key("replay");
    const one = { worker_id: worker, day, status: "full", cc_id: ccA, idempotency_key: k };
    const codes = await burst("/api/v1/labor/attendance", token, [one, one, one, one]);
    expect(codes).toEqual([201, 201, 201, 201]);
    const rows = await sql<{ n: string }>(
      `SELECT count(*) n FROM attendance WHERE worker_id=$1 AND day=$2`,
      [worker, day],
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });
});

liveDescribe("B-342 case 2 (B-339 item 2) — the unlocked negative-stock guard", () => {
  let md: APIRequestContext;
  let token = "";
  let fromWh = "";
  let toWh = "";
  let itemId = "";
  let projectId = "";
  let rateLimited = false;
  const QTY = 100;

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
    fromWh = String(whs[0]!.id);
    toWh = String(whs[1]!.id);
    // A dedicated item so these tests never interact with another spec's balance.
    const items = rowsOf(
      await okJson(await md.get("/api/v1/inventory/items"), "GET /inventory/items"),
    );
    itemId = String(items[items.length - 1]!.id);
    projectId = String(
      rowsOf(await okJson(await md.get("/api/v1/projects"), "GET /projects"))[0]!.id,
    );
  });

  test.beforeEach(() => {
    test.skip(rateLimited, "login rate-limited (F4 / B-099) — skipping rather than failing");
  });

  /** Reset the fixture (item, warehouse) to exactly QTY. Raw SQL is the HARNESS here,
   *  not the path under test — the paths under test are the two decrements. */
  const resetStock = async (): Promise<void> => {
    await sql(`DELETE FROM stock_ledger WHERE item_id=$1`, [itemId]);
    await sql(
      `INSERT INTO stock_ledger (company_id,item_id,warehouse_id,qty,ref_doc)
       SELECT company_id,$1,$2,$3,'b342-fixture' FROM warehouse WHERE id=$2`,
      [itemId, fromWh, QTY],
    );
  };
  const sourceBalance = async (): Promise<number> => {
    const r = await sql<{ q: string }>(
      `SELECT coalesce(sum(qty),0) q FROM stock_ledger WHERE item_id=$1 AND warehouse_id=$2`,
      [itemId, fromWh],
    );
    return Number(r[0]!.q);
  };

  test("concurrent TRANSFERS of the whole balance cannot drive stock negative — 5 of 6 rounds were RED before the lock", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to seed and read the balance");
    test.setTimeout(120_000);
    await resetStock();

    // Two pending transfers, each moving the ENTIRE balance out of the source.
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const t = await okJson(
        await md.post("/api/v1/inventory/transfers", {
          data: {
            from_warehouse_id: fromWh,
            to_warehouse_id: toWh,
            lines: [{ item_id: itemId, qty: QTY }],
          },
        }),
        "POST /inventory/transfers",
      );
      ids.push(String(t.id));
    }

    // Approve both at the same instant, from separate processes. This path posts NO JV,
    // so nothing serialises it by accident — it is the one that actually failed.
    const dir = mkdtempSync(join(tmpdir(), "b342t-"));
    let codes: number[];
    try {
      const script = `
set -u
START=$(( $(python3 -c 'import time; print(int(time.time()*1000))') + 900 ))
${ids
  .map(
    (id, i) => `(
  while [ "$(python3 -c 'import time; print(int(time.time()*1000))')" -lt "$START" ]; do :; done
  curl -s -o /dev/null -w "%{http_code}" -X POST "${API_URL}/api/v1/inventory/transfers/${id}/approve" \
    -H "authorization: Bearer ${token}" > "${dir}/c.${i}"
) &`,
  )
  .join("\n")}
wait
for i in 0 1; do cat "${dir}/c.$i"; echo; done
`;
      const { stdout } = await execFileAsync("bash", ["-c", script], { timeout: 60_000 });
      codes = stdout.trim().split("\n").map(Number);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(codes.filter((c) => c === 200), `codes were ${codes}`).toHaveLength(1);
    expect(await sourceBalance(), "the source balance must never go negative").toBeGreaterThanOrEqual(0);
  });

  test("the API BLOCKS on a held inventory_item lock, then answers an HONEST 409 — the constructed race", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to hold a colliding transaction open");
    test.setTimeout(120_000);
    await resetStock();

    // THE DISCRIMINATOR. Session 2 takes the row lock and holds it, then consumes the
    // whole balance and commits. If selectForUpdate is real the API must WAIT on it;
    // without the lock the request sails past and returns immediately. The assertion is
    // ELAPSED TIME against another session's uncommitted work, which is deterministic
    // and cannot pass by accident.
    const holder = new Client({ connectionString: PG_URL });
    await holder.connect();
    await holder.query("BEGIN");
    await holder.query("SELECT id FROM inventory_item WHERE id=$1 FOR UPDATE", [itemId]);

    const started = Date.now();
    const pending = md.post("/api/v1/inventory/issues", {
      data: {
        project_id: projectId,
        from_warehouse_id: fromWh,
        lines: [{ item_id: itemId, qty: QTY }],
      },
    });

    // Hold the lock well past any plausible request latency, then take all the stock.
    await new Promise((r) => setTimeout(r, 3000));
    await holder.query(
      `INSERT INTO stock_ledger (company_id,item_id,warehouse_id,qty,ref_doc)
       SELECT company_id,$1,$2,$3,'b342-held-lock' FROM warehouse WHERE id=$2`,
      [itemId, fromWh, -QTY],
    );
    await holder.query("COMMIT");
    await holder.end();

    const res = await pending;
    const elapsed = Date.now() - started;
    expect(elapsed, "the request must have BLOCKED on the held row lock").toBeGreaterThan(2000);
    // Having waited, it re-reads the ledger in a FRESH statement snapshot (READ
    // COMMITTED), sees the other session's −QTY, and refuses honestly.
    expect(res.status(), await res.text()).toBe(409);
    expect(String((await res.json()).message)).toMatch(/insufficient stock/i);
    expect(await sourceBalance()).toBeGreaterThanOrEqual(0);
  });

  test("concurrent ISSUES of the whole balance post exactly ONE JV", async () => {
    test.skip(!PG_URL, "needs DATABASE_URL to seed and read the balance");
    test.setTimeout(120_000);
    await resetStock();
    await sql(`DELETE FROM jv_line WHERE jv_id IN (SELECT id FROM jv WHERE source_doc LIKE 'issue:%')`);
    await sql(`DELETE FROM jv WHERE source_doc LIKE 'issue:%'`);

    const body = {
      project_id: projectId,
      from_warehouse_id: fromWh,
      lines: [{ item_id: itemId, qty: QTY }],
    };
    const codes = await burst("/api/v1/inventory/issues", token, [body, body, body, body]);
    expect(codes.filter((c) => c === 201), `codes were ${codes}`).toHaveLength(1);
    expect(await sourceBalance()).toBeGreaterThanOrEqual(0);
    // Negative stock with two JVs behind it is the money consequence; one issue = one JV.
    const jvs = await sql<{ n: string }>(
      `SELECT count(*) n FROM jv WHERE source_doc LIKE 'issue:%'`,
    );
    expect(Number(jvs[0]!.n)).toBe(1);
  });
});

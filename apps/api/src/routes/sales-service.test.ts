// G2/G3 tests (PLAN.md §9) — sales after-sales-service handlers (Program-3 SV-1,
// B-159). Covers:
//   - the company-scoped list + detail reads, each carrying the DERIVED
//     warranty_months_remaining (SV-2: 12 − months since sales_unit.transfer_at,
//     null when the unit has no transfer_at / no sales_unit row) + fail-closed 401.
//   - create: 201 with status defaulting to 'received', a server-allocated
//     SR-YYYY-#### `no`, title-required 400, and money-free (no JV, tenant-only gate).
//   - the SV-3 status machine (received → scheduled → fixing → fixed → closed): each
//     action's happy path (predecessor → next), a wrong-state 409, and an unknown-id
//     404. The flip folds the predecessor into the guarded UPDATE WHERE (B-149).
// Warranty derivation is pinned with vi.setSystemTime so the month math is
// deterministic. Routes are wired in app.ts (registerSalesServiceRoute) → buildApp
// mounts them (no sibling re-registration here).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { salesUnits, serviceTickets } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "suda@rungrueang.co.th", name: "สุดา" },
};
const D0 = new Date(1_700_000_000_000);
const D1 = new Date(1_700_100_000_000);

// Pin "now" so the SV-2 warranty month arithmetic is deterministic across runs.
const NOW = new Date("2026-07-27T00:00:00Z");

type RowSource = unknown[] | ((where: SQL | undefined) => unknown[]);
interface Inserted {
  table: unknown;
  values: Record<string, unknown> | Record<string, unknown>[];
}
interface Updated {
  table: unknown;
  set: Record<string, unknown>;
  where: SQL;
}
interface StubOpts {
  rows: Array<[unknown, RowSource]>;
  inserted?: Inserted[];
  updated?: Updated[];
  /** Force the guarded UPDATE to return 0 rows (the concurrent-flip race path). */
  updateReturnsEmpty?: boolean;
}

/** Db stub: canned rows per table + write capture. Mirrors land-sales.test.ts. */
function stubDb(opts: StubOpts): Db {
  const { rows, inserted = [], updated = [], updateReturnsEmpty = false } = opts;
  const rowsFor = (table: unknown, where: SQL | undefined): unknown[] => {
    for (const [t, r] of rows) {
      if (t === table) return typeof r === "function" ? r(where) : r;
    }
    return [];
  };
  const builderFor = (table: unknown) => {
    const builder = {
      $dynamic: () => builder,
      innerJoin: () => builder,
      where: (where: SQL) => Promise.resolve(rowsFor(table, where)),
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) =>
        Promise.resolve(rowsFor(table, undefined)).then(onOk, onErr),
    };
    return builder;
  };
  let seq = 0;
  const raw: Record<string, unknown> = {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
    insert: (table: unknown) => ({
      // B-388 · BOTH insert doors. TenantDb.insert() returns the builder WITHOUT
      // .returning() and the caller awaits it directly, so a `.returning()`-only
      // stub records nothing for such a write and every absence assertion about
      // it is vacuous. One `record()` closure sits behind both doors — invoked
      // once per DOOR CALL, never in the `values(...)` body (which would make
      // `.returning()` double-count). Evidence at the foot of this file.
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        const record = (): Record<string, unknown>[] => {
          inserted.push({ table, values });
          const arr = Array.isArray(values) ? values : [values];
          return arr.map((v) => {
            const row = v as Record<string, unknown>;
            return { id: row.id ?? `new-${seq++}`, createdAt: D0, ...row };
          });
        };
        return {
          returning: () => Promise.resolve(record()),
          // The awaited-directly door (plain scoped insert, no .returning()).
          then: (onOk: (r: unknown) => unknown, onErr: (e: unknown) => unknown) =>
            Promise.resolve(record()).then(onOk, onErr),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: () => {
            updated.push({ table, set, where });
            return Promise.resolve(updateReturnsEmpty ? [] : [{ id: "upd", ...set }]);
          },
        }),
      }),
    }),
  };
  raw.transaction = (cb: (tx: unknown) => unknown) => cb(raw);
  return raw as unknown as Db;
}

// --- seed-shaped canned rows -----------------------------------------------
const ticket = (
  id: string,
  extra: Partial<typeof serviceTickets.$inferSelect> = {},
): typeof serviceTickets.$inferSelect =>
  ({
    id, companyId: COMPANY, no: `SR-2026-00${id.slice(-2)}`, unitId: "node-1", customerId: "cust-1",
    channel: "LINE", category: "ระบบประปา", title: "ก๊อกน้ำรั่ว", priority: "high",
    status: "received", assigneeUserId: null, openedDate: "2026-07-01", scheduledDate: null,
    warranty: true, createdAt: D0, updatedAt: D0, ...extra,
  }) as typeof serviceTickets.$inferSelect;

const unit = (
  unitId: string | null,
  transferAt: string | null,
): typeof salesUnits.$inferSelect =>
  ({
    id: `su-${unitId}`, companyId: COMPANY, unitId, customerId: "cust-1", stage: "transferred",
    booking: null, contract: null, loan: null, currencyCode: "THB", down: [],
    transferAt, createdAt: D0, updatedAt: D0,
  }) as typeof salesUnits.$inferSelect;

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
  vi.useRealTimers();
});

async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<FastifyInstance> {
  app = await buildApp({
    db: overrides.db ?? stubDb({ rows: [] }),
    resolveTenant: overrides.resolveTenant ?? (async () => null),
    signIn: overrides.signIn ?? (async () => null),
    storage: overrides.storage ?? createFakeR2Storage("https://r2.test"),
    quota:
      overrides.quota ??
      new QuotaGuard({ resolver: unlimitedQuotaResolver, upgradeUrl: "https://upgrade.test" }),
    auditSink: overrides.auditSink ?? (async () => {}),
    logger: false,
  });
  await app.ready();
  return app;
}

// ===========================================================================
// Reads
// ===========================================================================
describe("GET /api/v1/sales/service", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/sales/service" });
    expect(res.statusCode).toBe(401);
  });

  it("lists tickets newest-first with the DERIVED warranty (transfer_at → months, null when no unit)", async () => {
    vi.setSystemTime(NOW);
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [
              serviceTickets,
              [
                ticket("t01", { unitId: "node-1", createdAt: D0 }), // older, has a sold unit
                ticket("t02", { unitId: "node-2", createdAt: D1 }), // newer, no sales_unit
              ],
            ],
            // node-1 transferred 2026-01-27 → 6 months elapsed → 12 − 6 = 6 remaining.
            [salesUnits, [unit("node-1", "2026-01-27")]],
          ],
        }),
      })
    ).inject({ method: "GET", url: "/api/v1/sales/service" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    // newest-first (created_at desc): t02 (D1) then t01 (D0).
    expect(body.data[0]).toMatchObject({ id: "t02", warranty_months_remaining: null });
    expect(body.data[1]).toMatchObject({ id: "t01", warranty: true, warranty_months_remaining: 6 });
    // opaque snake_case wire of the real columns.
    expect(body.data[1]).toMatchObject({ unit_id: "node-1", channel: "LINE", status: "received" });
  });

  it("honest-empty when there are no tickets", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[serviceTickets, []]] }) })
    ).inject({ method: "GET", url: "/api/v1/sales/service" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
  });
});

describe("GET /api/v1/sales/service/:id", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/sales/service/t01" });
    expect(res.statusCode).toBe(401);
  });

  it("returns one ticket with the derived warranty (expired unit → 0, floored at zero)", async () => {
    vi.setSystemTime(NOW);
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [serviceTickets, [ticket("t01", { unitId: "node-1" })]],
            // transferred in 2020 → far past 12 months → remaining floored at 0.
            [salesUnits, [unit("node-1", "2020-01-01")]],
          ],
        }),
      })
    ).inject({ method: "GET", url: "/api/v1/sales/service/t01" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: "t01", warranty_months_remaining: 0, title: "ก๊อกน้ำรั่ว" });
  });

  it("404s a ticket not in this tenant", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[serviceTickets, []]] }) })
    ).inject({ method: "GET", url: "/api/v1/sales/service/nope" });
    expect(res.statusCode).toBe(404);
  });
});

// ===========================================================================
// Create
// ===========================================================================
describe("POST /api/v1/sales/service", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST", url: "/api/v1/sales/service", payload: { title: "ก๊อกน้ำรั่ว" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("400s when title is missing", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [] }) })
    ).inject({ method: "POST", url: "/api/v1/sales/service", payload: { channel: "LINE" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/title is required/);
  });

  it("creates a ticket (201): status defaults 'received', no=SR-YYYY-####, company_id force-set", async () => {
    vi.setSystemTime(NOW);
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        // no existing tickets → allocator starts at 0001; no sales_unit → warranty null.
        db: stubDb({ rows: [[serviceTickets, []], [salesUnits, []]], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/sales/service",
      payload: {
        unit_id: "node-9", customer_id: "cust-9", channel: "App", category: "ระบบไฟฟ้า",
        title: "เบรกเกอร์ตัดบ่อย", priority: "high", note: "ไม่บันทึก (ไม่มีคอลัมน์)",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ title: "เบรกเกอร์ตัดบ่อย", status: "received", warranty_months_remaining: null });
    expect(String(body.no)).toMatch(/^SR-\d{4}-\d{4}$/);
    const v = inserted.find((i) => i.table === serviceTickets)!.values as Record<string, unknown>;
    expect(v.status).toBe("received"); // start state
    expect(String(v.no)).toBe("SR-2026-0001"); // running-doc allocated (tenant-scoped)
    expect(v.companyId).toBe(COMPANY); // tenant force-set by the scoped insert door
    expect(v.title).toBe("เบรกเกอร์ตัดบ่อย");
    expect("note" in v).toBe(false); // free-text note is not persisted (no column)
  });

  it("continues the running SR sequence past the tenant's max", async () => {
    const inserted: Inserted[] = [];
    const year = new Date().getFullYear();
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [serviceTickets, [ticket("t48", { no: `SR-${year}-0048` }), ticket("t47", { no: `SR-${year}-0047` })]],
            [salesUnits, []],
          ],
          inserted,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/sales/service", payload: { title: "ใหม่" } });
    const v = inserted.find((i) => i.table === serviceTickets)!.values as Record<string, unknown>;
    expect(String(v.no)).toBe(`SR-${year}-0049`); // one past 0048
  });
});

// ===========================================================================
// Status machine (SV-3 · received → scheduled → fixing → fixed → closed)
// ===========================================================================
describe("POST /api/v1/sales/service/:id status actions", () => {
  const oneTicket = (status: string, inserted: Updated[] = []) =>
    stubDb({ rows: [[serviceTickets, [ticket("t01", { status })]]], updated: inserted });

  it("401s flat without a session (schedule)", async () => {
    const res = await (await buildTestApp()).inject({ method: "POST", url: "/api/v1/sales/service/t01/schedule" });
    expect(res.statusCode).toBe(401);
  });

  it("schedule: received → scheduled, setting assignee + scheduled_date in the same update", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: oneTicket("received", updated) })
    ).inject({
      method: "POST",
      url: "/api/v1/sales/service/t01/schedule",
      payload: { assignee_user_id: "user-7", scheduled_date: "2026-07-30" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: "t01", status: "scheduled" });
    const upd = updated.find((u) => u.table === serviceTickets)!;
    expect(upd.set.status).toBe("scheduled");
    expect(upd.set.assigneeUserId).toBe("user-7");
    expect(upd.set.scheduledDate).toBe("2026-07-30");
  });

  it("start: scheduled → fixing", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: oneTicket("scheduled") })
    ).inject({ method: "POST", url: "/api/v1/sales/service/t01/start" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: "t01", status: "fixing" });
  });

  it("fix: fixing → fixed", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: oneTicket("fixing") })
    ).inject({ method: "POST", url: "/api/v1/sales/service/t01/fix" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: "t01", status: "fixed" });
  });

  it("close: fixed → closed (terminal; an optional rating is ignored — no column)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: oneTicket("fixed", updated) })
    ).inject({ method: "POST", url: "/api/v1/sales/service/t01/close", payload: { rating: 5 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: "t01", status: "closed" });
    const upd = updated.find((u) => u.table === serviceTickets)!;
    expect(upd.set.status).toBe("closed");
    expect("rating" in upd.set).toBe(false); // never invented a column
  });

  it("409s a wrong-state transition (start on a 'received' ticket — needs 'scheduled')", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: oneTicket("received") })
    ).inject({ method: "POST", url: "/api/v1/sales/service/t01/start" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("409s a concurrent flip (guarded UPDATE matches 0 rows after the existence read)", async () => {
    // The ticket reads as 'received' but the guarded UPDATE returns 0 rows (a
    // concurrent schedule advanced it first) → race-safe 409, no false 200.
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[serviceTickets, [ticket("t01", { status: "received" })]]],
          updateReturnsEmpty: true,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/sales/service/t01/schedule" });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/no longer in status received/);
  });

  it("404s an unknown ticket id", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[serviceTickets, []]] }) })
    ).inject({ method: "POST", url: "/api/v1/sales/service/nope/schedule" });
    expect(res.statusCode).toBe(404);
  });
});

// ===========================================================================
// B-388 · SINGLE-RECORDING EVIDENCE for the both-doors insert stub.
//
// Converting a `.returning()`-only stub is behaviourally INERT in this file —
// nothing this route does today writes through the bare TenantDb.insert() door,
// so no assertion above changed verdict when this landed and a green suite is
// NOT evidence the conversion is right. The defect a conversion can introduce is
// a DOUBLE-count (the recording closure invoked on the way in as well as per
// door) or a second door that records somewhere else. Neither is visible to
// stub-insert-door.enforce.test.ts, which proves a `then` KEY EXISTS — not that
// it records correctly. So the recording is asserted here, directly.
// ===========================================================================
describe("B-388 · stubDb's two insert doors record identically, once each", () => {
  interface Door {
    values: (
      v: Record<string, unknown> | Record<string, unknown>[],
    ) => PromiseLike<Record<string, unknown>[]> & {
      returning: () => Promise<Record<string, unknown>[]>;
    };
  }
  const doorOf = (db: Db, table: unknown): Door =>
    (db as unknown as { insert: (t: unknown) => Door }).insert(table);

  it("records exactly +1 per write and resolves identically, through EITHER door", async () => {
    const inserted: Inserted[] = [];
    const db = stubDb({ rows: [], inserted });

    expect(inserted).toHaveLength(0);
    // The awaited-directly door (what the plain scoped TenantDb.insert() hits).
    const bare = await doorOf(db, serviceTickets).values({ no: "bare" });
    expect(inserted).toHaveLength(1);
    // The .returning() door (insertThrough / insert(...).returning()).
    const ret = await doorOf(db, serviceTickets).values({ no: "ret" }).returning();
    expect(inserted).toHaveLength(2);

    expect(inserted).toEqual([
      { table: serviceTickets, values: { no: "bare" } },
      { table: serviceTickets, values: { no: "ret" } },
    ]);
    // Identical resolution shape. The ids prove `seq` advanced exactly ONCE per
    // write, so neither door invoked the recording closure twice.
    expect(bare).toEqual([{ id: "new-0", createdAt: D0, no: "bare" }]);
    expect(ret).toEqual([{ id: "new-1", createdAt: D0, no: "ret" }]);
  });

  it("expands an ARRAY of child rows identically through EITHER door", async () => {
    const insertedBare: Inserted[] = [];
    const bare = await doorOf(stubDb({ rows: [], inserted: insertedBare }), serviceTickets).values([
      { no: "a" },
      { no: "b" },
    ]);
    const insertedRet: Inserted[] = [];
    const ret = await doorOf(stubDb({ rows: [], inserted: insertedRet }), serviceTickets)
      .values([{ no: "a" }, { no: "b" }])
      .returning();

    // ONE recording for the batch (not one per row), and the SAME shape from both
    // doors — a divergence here is what a hand-copied `then` typically gets wrong.
    expect(insertedBare).toEqual(insertedRet);
    expect(insertedBare).toHaveLength(1);
    expect(insertedBare[0]).toEqual({ table: serviceTickets, values: [{ no: "a" }, { no: "b" }] });
    expect(bare).toEqual(ret);
    expect(bare).toHaveLength(2);
  });
});

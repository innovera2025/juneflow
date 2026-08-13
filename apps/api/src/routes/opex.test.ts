// GET + POST /opex/budgets — tenant-scoped list/create of OPEX budgets (opex.ts).
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { opexBudgets } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย" },
};
const D = new Date(1_700_000_000_000);

type RowSource = unknown[] | ((where: SQL | undefined) => unknown[]);
interface Captured {
  table: unknown;
  where: SQL | undefined;
}
interface Inserted {
  table: unknown;
  values: Record<string, unknown> | Record<string, unknown>[];
}
interface StubOpts {
  rows: Array<[unknown, RowSource]>;
  captured?: Captured[];
  inserted?: Inserted[];
}

/** Db stub: canned rows per table (reads) + insert capture (mirrors ar.test.ts). */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [] } = opts;
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
      where: (where: SQL) => {
        captured.push({ table, where });
        return Promise.resolve(rowsFor(table, where));
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) => {
        captured.push({ table, where: undefined });
        return Promise.resolve(rowsFor(table, undefined)).then(onOk, onErr);
      },
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
            return { id: row.id ?? `new-${seq++}`, createdAt: D, updatedAt: D, ...row };
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
  };
  return raw as unknown as Db;
}

function paramsOf(where: SQL | undefined): unknown[] {
  if (!where) return [];
  return new PgDialect().sqlToQuery(where).params;
}

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
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
  return app;
}

const budget = (dept: string, year: number, months: number[] = []) => ({
  id: `ob-${dept}-${year}`,
  companyId: COMPANY,
  dept,
  year,
  months,
  currencyCode: "THB",
  createdAt: D,
  updatedAt: D,
});

// ===========================================================================
// GET /api/v1/opex/budgets
// ===========================================================================
describe("GET /api/v1/opex/budgets", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/opex/budgets" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("lists the tenant's budgets as a list envelope, year+dept ordered", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [
              opexBudgets,
              [
                budget("การตลาด", 2569, [1, 2, 3]),
                budget("บริหาร", 2568),
                budget("บริหาร", 2569),
              ],
            ],
          ],
        }),
      })
    ).inject({ url: "/api/v1/opex/budgets" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // year asc, then dept — the 2568 บริหาร sorts first.
    expect(body.data.map((r: { dept: string; year: number }) => `${r.year}:${r.dept}`)).toEqual([
      "2568:บริหาร",
      "2569:การตลาด",
      "2569:บริหาร",
    ]);
    expect(body.data[1].months).toEqual([1, 2, 3]);
    expect(body.data[0].currency_code).toBe("THB");
  });

  it("?year= filters to a single budget year", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[opexBudgets, [budget("บริหาร", 2568), budget("บริหาร", 2569)]]],
        }),
      })
    ).inject({ url: "/api/v1/opex/budgets?year=2569" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].year).toBe(2569);
  });
});

// ===========================================================================
// POST /api/v1/opex/budgets
// ===========================================================================
describe("POST /api/v1/opex/budgets", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/opex/budgets",
      payload: { dept: "บริหาร", year: 2569 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates a budget (dept/year/months · currency THB · company_id force-set)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[opexBudgets, []]], inserted }), // no dup → insert
      })
    ).inject({
      method: "POST",
      url: "/api/v1/opex/budgets",
      payload: { dept: "บริหาร", year: 2569, months: [100, 200, 300], currency_code: "USD" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.dept).toBe("บริหาร");
    expect(body.year).toBe(2569);
    expect(body.months).toEqual([100, 200, 300]);
    expect(body.currency_code).toBe("THB"); // server-set, the client "USD" is IGNORED
    const ins = inserted.find((i) => i.table === opexBudgets)!.values as Record<string, unknown>;
    expect(ins.companyId).toBe(COMPANY); // force-set by the scoped insert
    expect(ins.currencyCode).toBe("THB");
  });

  it("400s when dept or year is missing", async () => {
    const app1 = await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [] }) });
    const noDept = await app1.inject({
      method: "POST",
      url: "/api/v1/opex/budgets",
      payload: { year: 2569 },
    });
    expect(noDept.statusCode).toBe(400);
    expect(noDept.json().message).toMatch(/dept is required/);
    const noYear = await app1.inject({
      method: "POST",
      url: "/api/v1/opex/budgets",
      payload: { dept: "บริหาร" },
    });
    expect(noYear.statusCode).toBe(400);
    expect(noYear.json().message).toMatch(/year is required/);
  });

  it("409s a duplicate (company_id, dept, year) with no insert", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[opexBudgets, [budget("บริหาร", 2569)]]], inserted }), // dup exists
      })
    ).inject({
      method: "POST",
      url: "/api/v1/opex/budgets",
      payload: { dept: "บริหาร", year: 2569, months: [1] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already exists/);
    expect(inserted.find((i) => i.table === opexBudgets)).toBeFalsy(); // no double-write
  });

  it("scopes the dup pre-check to this company (company_id in the WHERE)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[opexBudgets, []]], captured }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/opex/budgets",
      payload: { dept: "บริหาร", year: 2569 },
    });
    const read = captured.find((c) => c.table === opexBudgets);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY); // tenant scope is load-bearing
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
    const bare = await doorOf(db, opexBudgets).values({ no: "bare" });
    expect(inserted).toHaveLength(1);
    // The .returning() door (insertThrough / insert(...).returning()).
    const ret = await doorOf(db, opexBudgets).values({ no: "ret" }).returning();
    expect(inserted).toHaveLength(2);

    expect(inserted).toEqual([
      { table: opexBudgets, values: { no: "bare" } },
      { table: opexBudgets, values: { no: "ret" } },
    ]);
    // Identical resolution shape. The ids prove `seq` advanced exactly ONCE per
    // write, so neither door invoked the recording closure twice.
    expect(bare).toEqual([{ id: "new-0", createdAt: D, updatedAt: D, no: "bare" }]);
    expect(ret).toEqual([{ id: "new-1", createdAt: D, updatedAt: D, no: "ret" }]);
  });

  it("expands an ARRAY of child rows identically through EITHER door", async () => {
    const insertedBare: Inserted[] = [];
    const bare = await doorOf(stubDb({ rows: [], inserted: insertedBare }), opexBudgets).values([
      { no: "a" },
      { no: "b" },
    ]);
    const insertedRet: Inserted[] = [];
    const ret = await doorOf(stubDb({ rows: [], inserted: insertedRet }), opexBudgets)
      .values([{ no: "a" }, { no: "b" }])
      .returning();

    // ONE recording for the batch (not one per row), and the SAME shape from both
    // doors — a divergence here is what a hand-copied `then` typically gets wrong.
    expect(insertedBare).toEqual(insertedRet);
    expect(insertedBare).toHaveLength(1);
    expect(insertedBare[0]).toEqual({ table: opexBudgets, values: [{ no: "a" }, { no: "b" }] });
    expect(bare).toEqual(ret);
    expect(bare).toHaveLength(2);
  });
});

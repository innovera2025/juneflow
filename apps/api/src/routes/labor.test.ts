// G2/G3 tests (PLAN.md §9) — labor read handlers (Program-2 Op-Core Wave-0).
// Covers GET /labor/workers|attendance|payroll: the company-scoped list-envelope
// reads (sorted, opaque Entity wire of the REAL columns) + fail-closed 401 without
// a tenant. Expected values come from the stub — never hand-computed against the
// impl. The routes are wired in app.ts (registerLaborRoute) → buildApp mounts them.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { workers, attendances, payrolls } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "suda@rungrueang.co.th", name: "สุดา" },
};
const D = new Date(1_700_000_000_000);

interface Captured {
  table: unknown;
  where: SQL | undefined;
}

/** Keyed multi-table Db stub: db.select(table) resolves that table's canned rows,
 *  and records the (table, where) so tenant-scope can be asserted. */
function stubDb(rows: Array<[unknown, unknown[]]>, captured: Captured[] = []): Db {
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  const builderFor = (table: unknown) => {
    const builder = {
      $dynamic: () => builder,
      where: (where: SQL) => {
        captured.push({ table, where });
        return Promise.resolve(rowsFor(table));
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) => {
        captured.push({ table, where: undefined });
        return Promise.resolve(rowsFor(table)).then(onOk, onErr);
      },
    };
    return builder;
  };
  return {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
  } as unknown as Db;
}

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<FastifyInstance> {
  app = await buildApp({
    db: overrides.db ?? stubDb([]),
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

// --- seed-shaped canned rows ------------------------------------------------
const W1 = "w1111111-0000-0000-0000-0000000000w1";
const W2 = "w2222222-0000-0000-0000-0000000000w2";
const worker = (id: string, name: string, dayRate: string | null): typeof workers.$inferSelect =>
  ({ id, companyId: COMPANY, name, dayRate, currencyCode: "THB", createdAt: D, updatedAt: D }) as typeof workers.$inferSelect;
const attendance = (id: string, day: string): typeof attendances.$inferSelect =>
  ({ id, companyId: COMPANY, workerId: W1, day, ot: "1.50", ccId: null, createdAt: D, updatedAt: D }) as typeof attendances.$inferSelect;
const payroll = (id: string, period: string): typeof payrolls.$inferSelect =>
  ({ id, companyId: COMPANY, workerId: W1, period, amount: "12000.00", currencyCode: "THB", ccId: null, createdAt: D, updatedAt: D }) as typeof payrolls.$inferSelect;

describe("GET /api/v1/labor/workers", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/labor/workers" });
    expect(res.statusCode).toBe(401);
  });

  it("lists the tenant's workers as a name-sorted list envelope (company-scoped)", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[workers, [worker(W2, "บุญมี", "420"), worker(W1, "สมหมาย", "450")]]], captured),
      })
    ).inject({ method: "GET", url: "/api/v1/labor/workers" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2); // list-envelope {data,page,page_size,total}
    expect(body.data.map((w: { name: string }) => w.name)).toEqual(["บุญมี", "สมหมาย"]);
    // wire = REAL columns (day_rate coerced to number, currency_code) — no fabrication.
    expect(body.data[1]).toMatchObject({ id: W1, name: "สมหมาย", day_rate: 450, currency_code: "THB" });
    // tenant-scoped read: the workers select ran (company_id bound by the door).
    expect(captured.some((c) => c.table === workers)).toBe(true);
  });
});

describe("GET /api/v1/labor/attendance", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/labor/attendance" });
    expect(res.statusCode).toBe(401);
  });

  it("lists attendance newest-first (day desc) as a list envelope", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[attendances, [attendance("a1", "2026-05-01"), attendance("a2", "2026-05-03")]]]),
      })
    ).inject({ method: "GET", url: "/api/v1/labor/attendance" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data.map((a: { day: string }) => a.day)).toEqual(["2026-05-03", "2026-05-01"]);
    expect(body.data[0]).toMatchObject({ worker_id: W1, ot: 1.5 });
  });

  it("honest-empty when there is no attendance (no seed)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb([[attendances, []]]) })
    ).inject({ method: "GET", url: "/api/v1/labor/attendance" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
    expect(res.json().data).toEqual([]);
  });
});

describe("GET /api/v1/labor/payroll", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/labor/payroll" });
    expect(res.statusCode).toBe(401);
  });

  it("lists payroll as a list envelope with the REAL columns", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[payrolls, [payroll("p1", "2026-05")]]]),
      })
    ).inject({ method: "GET", url: "/api/v1/labor/payroll" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data[0]).toMatchObject({ worker_id: W1, period: "2026-05", amount: 12000, currency_code: "THB" });
  });
});

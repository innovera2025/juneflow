// G2/G3 tests (PLAN.md §9 · Phase-6 Wave-0, B-181) — the tenant subscription
// reads. GET /subscription/plans lists the global plan catalog; GET
// /subscription/invoices lists ONLY the caller's own platform invoices, scoped
// THROUGH subscription.company_id (platform_invoice has no company_id) — the
// load-bearing assertion is paramsOf(where).toContain(COMPANY). Money on read
// (price, amount) but NO GL. Fail-closed 401 without a session.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { aiUsage, packages, platformInvoices, projects, subscriptions, users } from "@juneflow/db";
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

type RowSource = unknown[] | ((where: SQL | undefined) => unknown[]);
interface Captured {
  table: unknown;
  where: SQL | undefined;
}
interface StubOpts {
  rows: Array<[unknown, RowSource]>;
  captured?: Captured[];
}
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [] } = opts;
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
  const raw: Record<string, unknown> = {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
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
  await app.ready();
  return app;
}

const pkg = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id, size: "M", name: "Medium", priceM: "7900.00", priceY: "79000.00", currencyCode: "THB",
    limits: { users: 20 }, menus: ["dashboard"], subRules: {}, createdAt: D0, updatedAt: D0, ...extra,
  }) as typeof packages.$inferSelect;

const invoice = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id, subscriptionId: "sub-1", amount: "7900.00", currencyCode: "THB", status: "paid",
    createdAt: D0, updatedAt: D0, ...extra,
  }) as typeof platformInvoices.$inferSelect;

const sub = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id, companyId: COMPANY, packageId: "pkg-1", cycle: "yearly", renewAt: D0, status: "active",
    createdAt: D0, updatedAt: D0, ...extra,
  }) as typeof subscriptions.$inferSelect;

/** N blank rows for a count-only usage table (projects / users). */
const blanks = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r-${i}` }));

describe("GET /api/v1/subscription/plans", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/subscription/plans" });
    expect(res.statusCode).toBe(401);
  });

  it("lists the global plan catalog with price + currency_code as an envelope", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[packages, [pkg("pkg-1"), pkg("pkg-2", { size: "L", name: "Large" })]]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/subscription/plans" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data[0]).toMatchObject({ size: "M", price_m: 7900, currency_code: "THB" });
  });
});

describe("GET /api/v1/subscription/me", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/subscription/me" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the tenant's own subscription + package + live usage (sub.mine)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [subscriptions, [sub("sub-1", { cycle: "yearly", status: "active" })]],
            [packages, [pkg("pkg-1")]],
            [aiUsage, [{ used: 18 }]],
            [projects, blanks(7)],
            [users, blanks(12)],
          ],
        }),
      })
    ).inject({ method: "GET", url: "/api/v1/subscription/me" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ id: "sub-1", package_id: "pkg-1", cycle: "yearly", status: "active" });
    expect(body.package).toMatchObject({ size: "M", name: "Medium", price_y: 79000, currency_code: "THB" });
    // live usage vs the package limits — storage is the honest byte-accounting gap.
    expect(body.usage).toEqual({ projects: 7, users: 12, storage: 0, ai: 18 });
  });

  it("prefers the active/trial subscription over a cancelled one", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [subscriptions, [sub("sub-old", { status: "cancelled" }), sub("sub-cur", { status: "active" })]],
            [packages, [pkg("pkg-1")]],
            [aiUsage, []],
            [projects, []],
            [users, []],
          ],
        }),
      })
    ).inject({ method: "GET", url: "/api/v1/subscription/me" });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("sub-cur"); // the active one, not the cancelled first row
    expect(res.json().usage.ai).toBe(0); // no ai_usage rows → 0, not invented
  });

  it("404s a tenant with no subscription", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[subscriptions, []]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/subscription/me" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/v1/subscription/invoices", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/subscription/invoices" });
    expect(res.statusCode).toBe(401);
  });

  it("lists ONLY the tenant's own platform invoices, scoped through subscription.company_id", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[platformInvoices, [invoice("inv-1")]]], captured }),
      })
    ).inject({ method: "GET", url: "/api/v1/subscription/invoices" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({ id: "inv-1", amount: 7900, currency_code: "THB", status: "paid" });
    // load-bearing: the read is anchored on this tenant's company_id (via the
    // platform_invoice → subscription join) — never another tenant's invoices.
    const where = captured.find((c) => c.table === platformInvoices)?.where;
    expect(paramsOf(where)).toContain(COMPANY);
  });
});

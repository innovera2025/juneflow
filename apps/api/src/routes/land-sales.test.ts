// G2/G3 tests (PLAN.md §9) — land/sales read handlers (Program-3 Wave-0).
// Covers GET /sales/leads + GET /land/plots: company-scoped list-envelope reads
// (newest-first, opaque Entity wire of the REAL columns incl. currency_code on
// price_per_rai) + fail-closed 401 without a tenant. Expected values come from the
// stub. Routes are wired in app.ts (registerLandSalesRoute) → buildApp mounts them.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { leads, landPlots } from "@juneflow/db";
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

interface Captured {
  table: unknown;
  where: SQL | undefined;
}

/** Keyed multi-table Db stub (mirrors labor.test.ts). */
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

const lead = (id: string, name: string, createdAt: Date): typeof leads.$inferSelect =>
  ({
    id, companyId: COMPANY, name, phone: "081-000-0000", source: "walk-in", interest: "บ้านเดี่ยว",
    stage: "visit", hot: true, lastContactAt: "2026-05-01", note: null, ownerUserId: null, days: 3,
    createdAt, updatedAt: createdAt,
  }) as typeof leads.$inferSelect;

const plot = (id: string, deedNo: string, createdAt: Date): typeof landPlots.$inferSelect =>
  ({
    id, companyId: COMPANY, projectId: null, deedNo, areaSqm: "1600.0000", gps: "13.7,100.5",
    pricePerRai: "2500000.00", currencyCode: "THB", stage: "negotiating", tenure: "freehold",
    ddChecklist: {}, createdAt, updatedAt: createdAt,
  }) as typeof landPlots.$inferSelect;

describe("GET /api/v1/sales/leads", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/sales/leads" });
    expect(res.statusCode).toBe(401);
  });

  it("lists the tenant's leads newest-first as a list envelope (company-scoped)", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[leads, [lead("l0", "เก่า", D0), lead("l1", "ใหม่", D1)]]], captured),
      })
    ).inject({ method: "GET", url: "/api/v1/sales/leads" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data.map((l: { name: string }) => l.name)).toEqual(["ใหม่", "เก่า"]); // newest-first
    expect(body.data[0]).toMatchObject({ id: "l1", name: "ใหม่", stage: "visit", hot: true, source: "walk-in" });
    expect(captured.some((c) => c.table === leads)).toBe(true);
  });
});

describe("GET /api/v1/land/plots", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/land/plots" });
    expect(res.statusCode).toBe(401);
  });

  it("lists land plots with price_per_rai (money) + currency_code as a list envelope", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[landPlots, [plot("p0", "นส.3ก-101", D0)]]]),
      })
    ).inject({ method: "GET", url: "/api/v1/land/plots" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data[0]).toMatchObject({
      id: "p0", deed_no: "นส.3ก-101", price_per_rai: 2500000, currency_code: "THB", area_sqm: 1600,
    });
  });

  it("honest-empty when there are no plots", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb([[landPlots, []]]) })
    ).inject({ method: "GET", url: "/api/v1/land/plots" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
    expect(res.json().data).toEqual([]);
  });
});

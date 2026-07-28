// G2/G3 tests (PLAN.md §9) — solar Wave-0 read-only handlers (B-174). Covers the
// six company-scoped list envelopes (inverters, om-tickets, ppa-invoices, roi,
// permit-steps, warranties) + fail-closed 401. All money-free (R1=read-only);
// ppa/roi SURFACE money values + currency_code on read but post NO JV. The
// load-bearing assertion is paramsOf(where).toContain(COMPANY): every read is
// tenant-scoped (no cross-tenant leak). Routes wired via registerSolarRoute.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  ppaInvoices,
  solarInverters,
  solarOmTickets,
  solarPermitSteps,
  solarRois,
  solarWarranties,
} from "@juneflow/db";
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

// --- stub (mirrors land-sales.test.ts) -------------------------------------
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

/** Bound SQL params of a where clause — used to prove the company_id predicate. */
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

// --- seed-shaped canned rows -----------------------------------------------
const inverter = (id: string, createdAt: Date, extra: Record<string, unknown> = {}) =>
  ({
    id, companyId: COMPANY, projectId: null, zone: "A1", kw: "500.000", outputKw: "420.500",
    perf: "84.10", temp: "41.20", status: "online", createdAt, updatedAt: createdAt, ...extra,
  }) as typeof solarInverters.$inferSelect;

const omTicket = (id: string, createdAt: Date, extra: Record<string, unknown> = {}) =>
  ({
    id, companyId: COMPANY, inverterId: "inv-1", no: "OM-2026-001", title: "แผงสกปรก",
    priority: "high", assigneeUserId: null, status: "open", createdAt, updatedAt: createdAt, ...extra,
  }) as typeof solarOmTickets.$inferSelect;

const ppaInvoice = (id: string, createdAt: Date, extra: Record<string, unknown> = {}) =>
  ({
    id, companyId: COMPANY, projectId: null, month: "2026-05", mwh: "1200.0000", rate: "4.1200",
    amount: "4944000.00", currencyCode: "THB", status: "issued", createdAt, updatedAt: createdAt, ...extra,
  }) as typeof ppaInvoices.$inferSelect;

const roi = (id: string, createdAt: Date, extra: Record<string, unknown> = {}) =>
  ({
    id, companyId: COMPANY, projectId: null, year: 1, revenue: "24000000.00", opex: "1800000.00",
    cumulative: "22200000.00", currencyCode: "THB", createdAt, updatedAt: createdAt, ...extra,
  }) as typeof solarRois.$inferSelect;

const permitStep = (id: string, createdAt: Date, extra: Record<string, unknown> = {}) =>
  ({
    id, companyId: COMPANY, projectId: null, name: "รง.4", org: "กรมโรงงาน", status: "approved",
    stepDate: "2026-01-15", createdAt, updatedAt: createdAt, ...extra,
  }) as typeof solarPermitSteps.$inferSelect;

const warranty = (id: string, createdAt: Date, extra: Record<string, unknown> = {}) =>
  ({
    id, companyId: COMPANY, projectId: null, item: "แผงโซลาร์", brand: "JA Solar", qty: 14400,
    perf: "87.40", prodDate: "2025-06-01", expiryDate: "2050-06-01", status: "active",
    createdAt, updatedAt: createdAt, ...extra,
  }) as typeof solarWarranties.$inferSelect;

// ===========================================================================
// Reads — one describe per endpoint: 401 fail-closed + company-scoped list.
// ===========================================================================

describe("GET /api/v1/solar/inverters", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/solar/inverters" });
    expect(res.statusCode).toBe(401);
  });

  it("lists the tenant's inverters newest-first as a company-scoped list envelope", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[solarInverters, [inverter("i0", D0), inverter("i1", D1)]]], captured }),
      })
    ).inject({ method: "GET", url: "/api/v1/solar/inverters" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data.map((r: { id: string }) => r.id)).toEqual(["i1", "i0"]); // newest-first
    expect(body.data[0]).toMatchObject({ id: "i1", zone: "A1", kw: 500, output_kw: 420.5, status: "online" });
    // load-bearing: the read is tenant-scoped (company_id bound into the WHERE).
    const where = captured.find((c) => c.table === solarInverters)?.where;
    expect(paramsOf(where)).toContain(COMPANY);
  });

  it("returns an honest-empty envelope when the tenant has no inverters", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[solarInverters, []]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/solar/inverters" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 0, data: [] });
  });
});

describe("GET /api/v1/solar/om-tickets", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/solar/om-tickets" });
    expect(res.statusCode).toBe(401);
  });

  it("lists the tenant's O&M tickets company-scoped", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[solarOmTickets, [omTicket("t0", D0)]]], captured }),
      })
    ).inject({ method: "GET", url: "/api/v1/solar/om-tickets" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({ id: "t0", no: "OM-2026-001", priority: "high", status: "open" });
    expect(paramsOf(captured.find((c) => c.table === solarOmTickets)?.where)).toContain(COMPANY);
  });
});

describe("GET /api/v1/solar/ppa-invoices", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/solar/ppa-invoices" });
    expect(res.statusCode).toBe(401);
  });

  it("lists PPA invoices with money (amount/rate/mwh) + currency_code on read, no JV", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[ppaInvoices, [ppaInvoice("p0", D0)]]], captured }),
      })
    ).inject({ method: "GET", url: "/api/v1/solar/ppa-invoices" });
    expect(res.statusCode).toBe(200);
    // money surfaced on READ (like plotWire.price_per_rai) — coerced to numbers, currency paired.
    expect(res.json().data[0]).toMatchObject({
      id: "p0", month: "2026-05", mwh: 1200, rate: 4.12, amount: 4944000, currency_code: "THB",
    });
    expect(paramsOf(captured.find((c) => c.table === ppaInvoices)?.where)).toContain(COMPANY);
  });
});

describe("GET /api/v1/solar/roi", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/solar/roi" });
    expect(res.statusCode).toBe(401);
  });

  it("lists ROI rows with money (revenue/opex/cumulative) + currency_code, company-scoped", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[solarRois, [roi("r0", D0)]]], captured }),
      })
    ).inject({ method: "GET", url: "/api/v1/solar/roi" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({
      id: "r0", year: 1, revenue: 24000000, opex: 1800000, cumulative: 22200000, currency_code: "THB",
    });
    expect(paramsOf(captured.find((c) => c.table === solarRois)?.where)).toContain(COMPANY);
  });
});

describe("GET /api/v1/solar/permit-steps", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/solar/permit-steps" });
    expect(res.statusCode).toBe(401);
  });

  it("lists permit steps company-scoped (no money)", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[solarPermitSteps, [permitStep("s0", D0)]]], captured }),
      })
    ).inject({ method: "GET", url: "/api/v1/solar/permit-steps" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({ id: "s0", name: "รง.4", org: "กรมโรงงาน", status: "approved", step_date: "2026-01-15" });
    expect(paramsOf(captured.find((c) => c.table === solarPermitSteps)?.where)).toContain(COMPANY);
  });
});

describe("GET /api/v1/solar/warranties", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/solar/warranties" });
    expect(res.statusCode).toBe(401);
  });

  it("lists warranties company-scoped (no money)", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[solarWarranties, [warranty("w0", D0)]]], captured }),
      })
    ).inject({ method: "GET", url: "/api/v1/solar/warranties" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({ id: "w0", item: "แผงโซลาร์", brand: "JA Solar", qty: 14400, status: "active" });
    expect(paramsOf(captured.find((c) => c.table === solarWarranties)?.where)).toContain(COMPANY);
  });
});

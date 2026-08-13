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
  projects,
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
interface Inserted {
  table: unknown;
  values: Record<string, unknown>;
}
interface Updated {
  table: unknown;
  set: Record<string, unknown>;
  where: SQL;
}
interface StubOpts {
  rows: Array<[unknown, RowSource]>;
  captured?: Captured[];
  inserted?: Inserted[];
  updated?: Updated[];
  /** When true, an UPDATE … RETURNING yields 0 rows — models the close guard's
   *  FINAL-UPDATE WHERE status != 'closed' matching nothing (a concurrent flip). */
  updateEmpty?: boolean;
}

function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [], updated = [], updateEmpty = false } = opts;
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
    insert: (table: unknown) => ({
      // B-388 · BOTH insert doors. TenantDb.insert() returns the builder WITHOUT
      // .returning() and the caller awaits it directly, so a `.returning()`-only
      // stub records nothing for such a write and every absence assertion about
      // it is vacuous. One `record()` closure sits behind both doors — invoked
      // once per DOOR CALL, never in the `values(...)` body (which would make
      // `.returning()` double-count). Evidence at the foot of this file.
      values: (values: Record<string, unknown>) => {
        const record = (): Record<string, unknown>[] => {
          inserted.push({ table, values });
          return [{ id: "new-1", ...values }];
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
            return Promise.resolve(
              updateEmpty ? [] : rowsFor(table, where).map((r) => ({ ...(r as object), ...set })),
            );
          },
        }),
      }),
    }),
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
    priority: "high", assigneeUserId: null, team: "ทีม O&M A", status: "open", createdAt, updatedAt: createdAt, ...extra,
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
    perf: "87.40", years: 10, prodDate: "2025-06-01", expiryDate: "2050-06-01", status: "active",
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

// ===========================================================================
// Wave-1a workflow writes (B-212/B-215) — money=NONE, tenant-scoped.
// ===========================================================================
describe("POST /api/v1/solar/om-tickets (create)", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "POST", url: "/api/v1/solar/om-tickets", payload: { title: "x" } });
    expect(res.statusCode).toBe(401);
  });

  it("201 · server-generated running no (OM-YYYY-0001) · status=open · company_id force-set", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[solarOmTickets, []]], inserted }), // empty → allocOmNo = 0001
      })
    ).inject({ method: "POST", url: "/api/v1/solar/om-tickets", payload: { title: "อินเวอร์เตอร์ offline", priority: "high", team: "ทีม O&M B" } });
    expect(res.statusCode).toBe(201);
    const v = inserted.find((i) => i.table === solarOmTickets)!.values;
    expect(String(v.no)).toMatch(/^OM-\d{4}-0001$/); // server-generated, not the mock literal
    expect(v.title).toBe("อินเวอร์เตอร์ offline");
    expect(v.team).toBe("ทีม O&M B"); // B-223: the form's responsible team is stored
    expect(v.status).toBe("open");
    expect(v.companyId).toBe(COMPANY); // TenantDb force-set
    expect(res.json().status).toBe("open");
  });

  it("400 without a title", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[solarOmTickets, []]] }) })
    ).inject({ method: "POST", url: "/api/v1/solar/om-tickets", payload: { priority: "high" } });
    expect(res.statusCode).toBe(400);
  });

  it("404 a foreign inverter_id (in-tenant FK check → clean 404, not 500)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[solarInverters, []], [solarOmTickets, []]] }), // inverter not in tenant
      })
    ).inject({ method: "POST", url: "/api/v1/solar/om-tickets", payload: { title: "x", inverter_id: "ghost" } });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/v1/solar/om-tickets/{id}/close (idempotent)", () => {
  it("200 open→closed (guard status != 'closed' on the FINAL update)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[solarOmTickets, [omTicket("t1", D0, { status: "open" })]]], updated }),
      })
    ).inject({ method: "POST", url: "/api/v1/solar/om-tickets/t1/close" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("closed");
    expect(updated.find((u) => u.table === solarOmTickets)!.set.status).toBe("closed");
  });

  it("409 already-closed (JS pre-check)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[solarOmTickets, [omTicket("t1", D0, { status: "closed" })]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/solar/om-tickets/t1/close" });
    expect(res.statusCode).toBe(409);
  });

  it("409 via the FINAL-UPDATE guard 0-row (read said open, but a concurrent close raced)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[solarOmTickets, [omTicket("t1", D0, { status: "open" })]]], updateEmpty: true }),
      })
    ).inject({ method: "POST", url: "/api/v1/solar/om-tickets/t1/close" });
    expect(res.statusCode).toBe(409);
  });

  it("404 an unknown ticket", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[solarOmTickets, []]] }) })
    ).inject({ method: "POST", url: "/api/v1/solar/om-tickets/ghost/close" });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/v1/solar/permit-steps + /warranties (create · money=NONE)", () => {
  it("permit: 201 · status=pending · company_id force-set", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [], inserted }) })
    ).inject({ method: "POST", url: "/api/v1/solar/permit-steps", payload: { name: "รง.4", org: "กรมโรงงาน" } });
    expect(res.statusCode).toBe(201);
    const v = inserted.find((i) => i.table === solarPermitSteps)!.values;
    expect(v.name).toBe("รง.4");
    expect(v.status).toBe("pending");
    expect(v.companyId).toBe(COMPANY);
  });

  it("permit: 400 without a name; 404 a foreign project_id", async () => {
    const noName = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [] }) })
    ).inject({ method: "POST", url: "/api/v1/solar/permit-steps", payload: { org: "x" } });
    expect(noName.statusCode).toBe(400);
    const foreign = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[projects, []]] }) })
    ).inject({ method: "POST", url: "/api/v1/solar/permit-steps", payload: { name: "x", project_id: "ghost" } });
    expect(foreign.statusCode).toBe(404);
  });

  it("warranty: 201 · item + qty + years stored · status=active", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [], inserted }) })
    ).inject({ method: "POST", url: "/api/v1/solar/warranties", payload: { item: "SCADA Server Dell R650", qty: 2, years: 10 } });
    expect(res.statusCode).toBe(201);
    const v = inserted.find((i) => i.table === solarWarranties)!.values;
    expect(v.item).toBe("SCADA Server Dell R650");
    expect(v.qty).toBe(2);
    expect(v.years).toBe(10); // B-219: the form's product-warranty years is stored
    expect(v.status).toBe("active");
    expect(v.companyId).toBe(COMPANY);
  });

  it("warranty: 400 without an item", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [] }) })
    ).inject({ method: "POST", url: "/api/v1/solar/warranties", payload: { qty: 2 } });
    expect(res.statusCode).toBe(400);
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
    values: (v: Record<string, unknown>) => PromiseLike<Record<string, unknown>[]> & {
      returning: () => Promise<Record<string, unknown>[]>;
    };
  }
  const doorOf = (db: Db, table: unknown): Door =>
    (db as unknown as { insert: (t: unknown) => Door }).insert(table);

  it("records exactly +1 per write and resolves identically, through EITHER door", async () => {
    const inserted: Inserted[] = [];
    const db = stubDb({ rows: [], inserted });

    expect(inserted).toHaveLength(0);
    const bare = await doorOf(db, solarOmTickets).values({ title: "bare" });
    expect(inserted).toHaveLength(1);
    const ret = await doorOf(db, solarOmTickets).values({ title: "ret" }).returning();
    expect(inserted).toHaveLength(2);

    expect(inserted).toEqual([
      { table: solarOmTickets, values: { title: "bare" } },
      { table: solarOmTickets, values: { title: "ret" } },
    ]);
    // This stub mints a CONSTANT id (no seq), so exactly-once rests on the +1
    // length checks above rather than on an advancing id.
    expect(bare).toEqual([{ id: "new-1", title: "bare" }]);
    expect(ret).toEqual([{ id: "new-1", title: "ret" }]);
  });
});

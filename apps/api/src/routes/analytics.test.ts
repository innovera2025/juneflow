// G3 unit tests (PLAN.md §9) — GET /analytics/portfolio (group-C Wave-2, B-101).
// The executive cross-project rollup (exec-audit.jsx ExecDashboard). Each test
// proves (a) the real-data field shape, (b) company_id scope bound on EVERY query
// (tenant isolation, C10) with parent-FK tables read THROUGH join hops, (c) 401
// without a session, the exec health rule flipping at the 0.9 utilisation
// threshold, and the honest-empty / honest-null behaviours (no projects → zeros;
// a project with no sales units → sold_pct null, never fabricated).
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  boqDocs,
  boqGroups,
  cbsBudgets,
  projectNodes,
  projects,
  projectTypes,
  salesUnits,
} from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย" },
};

interface Captured {
  table: unknown;
  joins: unknown[];
  where: SQL | undefined;
}

function stubJoinDb(
  rows: Array<[unknown, unknown[]]>,
  captured: Captured[] = [],
): Db {
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  return {
    select: () => ({
      from: (table: unknown) => {
        const joins: unknown[] = [];
        const builder = {
          $dynamic: () => builder,
          innerJoin: (parent: unknown) => {
            joins.push(parent);
            return builder;
          },
          where: (where: SQL) => {
            captured.push({ table, joins, where });
            return Promise.resolve(rowsFor(table));
          },
          then: (
            onOk: (rows: unknown[]) => unknown,
            onErr: (err: unknown) => unknown,
          ) => {
            captured.push({ table, joins, where: undefined });
            return Promise.resolve(rowsFor(table)).then(onOk, onErr);
          },
        };
        return builder;
      },
    }),
  } as unknown as Db;
}

function paramsOf(where: SQL | undefined): unknown[] {
  if (!where) return [];
  return new PgDialect().sqlToQuery(where).params;
}

/** Assert company_id is bound on every captured read (tenant scope, C10). */
function expectTenantScoped(captured: Captured[]): void {
  expect(captured.length).toBeGreaterThan(0);
  for (const call of captured) {
    expect(paramsOf(call.where)).toContain(COMPANY);
  }
}

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

async function buildTestApp(
  overrides: Partial<AppDeps> = {},
): Promise<FastifyInstance> {
  app = await buildApp({
    db: overrides.db ?? stubJoinDb([]),
    resolveTenant: overrides.resolveTenant ?? (async () => null),
    signIn: overrides.signIn ?? (async () => null),
    storage: overrides.storage ?? createFakeR2Storage("https://r2.test"),
    quota:
      overrides.quota ??
      new QuotaGuard({
        resolver: unlimitedQuotaResolver,
        upgradeUrl: "https://upgrade.test",
      }),
    auditSink: overrides.auditSink ?? (async () => {}),
    logger: false,
  });
  return app;
}

const D = new Date("2026-05-01T00:00:00.000Z");

async function get(url: string, db: Db) {
  const instance = await buildTestApp({ resolveTenant: async () => SESSION, db });
  return instance.inject({ url });
}

// ===========================================================================
// auth (fail closed)
// ===========================================================================
describe("GET /api/v1/analytics/portfolio — auth (fail closed)", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      url: "/api/v1/analytics/portfolio",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Missing tenant context",
    });
  });
});

// ===========================================================================
// portfolio — per-project rollup + totals + type-mix (all live, no mock roll)
// ===========================================================================
describe("GET /api/v1/analytics/portfolio", () => {
  // p1 realestate: 10M budget / 2M used; curated health ดี; 1 phase, 2 units (1 sold).
  // p2 solar: 5M budget / 4.8M used; curated health เฝ้าระวัง (B-102: stored, not derived).
  const db = (captured: Captured[] = []) =>
    stubJoinDb(
      [
        [projects, [
          { id: "p1", companyId: COMPANY, typeId: "t-re", name: "ราชพฤกษ์", currencyCode: "THB", health: "ดี", createdAt: D },
          { id: "p2", companyId: COMPANY, typeId: "t-slr", name: "โซลาร์", currencyCode: "THB", health: "เฝ้าระวัง", createdAt: D },
        ]],
        [projectTypes, [
          { id: "t-re", key: "realestate", name: "อสังหาฯ" },
          { id: "t-slr", key: "solar", name: "โซลาร์" },
        ]],
        [cbsBudgets, [
          { groupId: "g1", budget: "10000000.00", used: "2000000.00", committed: "0" },
          { groupId: "g2", budget: "5000000.00", used: "4800000.00", committed: "0" },
        ]],
        [boqGroups, [
          { id: "g1", boqId: "d1" },
          { id: "g2", boqId: "d2" },
        ]],
        [boqDocs, [
          { id: "d1", projectId: "p1" },
          { id: "d2", projectId: "p2" },
        ]],
        [projectNodes, [
          { id: "ph1", kind: "phase", name: "เฟส 1", parentId: null, projectId: "p1" },
          { id: "u1", kind: "unit", name: "U1", parentId: "ph1", projectId: "p1" },
          { id: "u2", kind: "unit", name: "U2", parentId: "ph1", projectId: "p1" },
        ]],
        [salesUnits, [
          { unitId: "u1", stage: "soldBuilt" }, // sold AND built
          { unitId: "u2", stage: "built" }, // built only
        ]],
      ],
      captured,
    );

  it("derives per-project budget/actual/progress/health/sold + totals + type_mix (no mock roll)", async () => {
    const res = await get("/api/v1/analytics/portfolio", db());
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.projects).toEqual([
      { project_id: "p1", name: "ราชพฤกษ์", type_key: "realestate", budget: 10000000, actual: 2000000, progress_pct: 100, health: "ดี", sold_pct: 50 },
      { project_id: "p2", name: "โซลาร์", type_key: "solar", budget: 5000000, actual: 4800000, progress_pct: 0, health: "เฝ้าระวัง", sold_pct: null },
    ]);
    expect(b.totals).toEqual({
      budget_total: 15000000,
      actual_total: 6800000,
      avg_progress: 50, // round((100+0)/2)
      at_risk_count: 1, // only p2 is เฝ้าระวัง
      currency_code: "THB",
    });
    expect(b.type_mix).toEqual([
      { type_key: "realestate", budget_sum: 10000000 },
      { type_key: "solar", budget_sum: 5000000 },
    ]);
  });

  it("binds company_id on every read + scopes cbs(3)/group(2)/doc(1)/node(1) through join hops", async () => {
    const captured: Captured[] = [];
    await get("/api/v1/analytics/portfolio", db(captured));
    expectTenantScoped(captured);
    expect(captured.find((c) => c.table === projects)?.joins.length).toBe(0);
    expect(captured.find((c) => c.table === cbsBudgets)?.joins.length).toBe(3);
    expect(captured.find((c) => c.table === boqGroups)?.joins.length).toBe(2);
    expect(captured.find((c) => c.table === boqDocs)?.joins.length).toBe(1);
    expect(captured.find((c) => c.table === projectNodes)?.joins.length).toBe(1);
    expect(captured.find((c) => c.table === salesUnits)?.joins.length).toBe(0);
  });

  // --- (e) health = STORED curated label, surfaced verbatim (B-102 Wei = ก) ---
  // The mock's own data disproves any budget formula: slr is over-utilised yet
  // "ดี"; rama is under-utilised yet "เฝ้าระวัง" (exec-audit.jsx:14-20). These
  // two stubs reproduce exactly those disproof rows — a derivation would flip
  // them; verbatim surfacing must NOT.
  it("health surfaces the stored curated label verbatim — never derived from spend", async () => {
    const res = await get(
      "/api/v1/analytics/portfolio",
      stubJoinDb([
        [projects, [
          // over-utilised (232/248 > 0.9×) yet curated ดี — the slr disproof.
          { id: "pa", companyId: COMPANY, typeId: "t", name: "OverButGood", currencyCode: "THB", health: "ดี", createdAt: D },
          // under-utilised (248/312 < 0.9×) yet curated เฝ้าระวัง — the rama disproof.
          { id: "pb", companyId: COMPANY, typeId: "t", name: "UnderButWatch", currencyCode: "THB", health: "เฝ้าระวัง", createdAt: D },
          // no curated label → honest null, NOT counted at-risk (mock r() defaults ดี).
          { id: "pc", companyId: COMPANY, typeId: "t", name: "Uncurated", currencyCode: "THB", health: null, createdAt: D },
        ]],
        [projectTypes, [{ id: "t", key: "civil", name: "โยธา" }]],
        [cbsBudgets, [
          { groupId: "ga", budget: "248000000.00", used: "232000000.00", committed: "0" },
          { groupId: "gb", budget: "312000000.00", used: "248000000.00", committed: "0" },
        ]],
        [boqGroups, [{ id: "ga", boqId: "da" }, { id: "gb", boqId: "db" }]],
        [boqDocs, [{ id: "da", projectId: "pa" }, { id: "db", projectId: "pb" }]],
        [projectNodes, []],
        [salesUnits, []],
      ]),
    );
    const b = res.json();
    const byId = Object.fromEntries(
      b.projects.map((p: { project_id: string }) => [p.project_id, p]),
    );
    expect(byId.pa.health).toBe("ดี"); // stored wins over the (wrong) 0.9 rule
    expect(byId.pb.health).toBe("เฝ้าระวัง"); // stored wins in the other direction
    expect(byId.pc.health).toBe(null); // honest null, no fabrication
    expect(b.totals.at_risk_count).toBe(1); // only pb (≠ ดี); null is not at risk
  });

  // --- (f) honest-empty / honest-null behaviours ---
  it("honest-empty: no projects → zero totals, empty projects + type_mix", async () => {
    const res = await get("/api/v1/analytics/portfolio", stubJoinDb([]));
    const b = res.json();
    expect(b.projects).toEqual([]);
    expect(b.type_mix).toEqual([]);
    expect(b.totals).toEqual({
      budget_total: 0,
      actual_total: 0,
      avg_progress: 0,
      at_risk_count: 0,
      currency_code: "THB",
    });
  });

  it("honest-null sold_pct for a project with no sales units (never fabricated)", async () => {
    const res = await get(
      "/api/v1/analytics/portfolio",
      stubJoinDb([
        [projects, [{ id: "p1", companyId: COMPANY, typeId: "t", name: "NoSales", currencyCode: "THB", createdAt: D }]],
        [projectTypes, [{ id: "t", key: "service", name: "บริการ" }]],
        [cbsBudgets, [{ groupId: "g1", budget: "1000000.00", used: "100000.00", committed: "0" }]],
        [boqGroups, [{ id: "g1", boqId: "d1" }]],
        [boqDocs, [{ id: "d1", projectId: "p1" }]],
        // has unit nodes but NO sales_unit rows → sold_pct honest null.
        [projectNodes, [
          { id: "ph1", kind: "phase", name: "P", parentId: null, projectId: "p1" },
          { id: "u1", kind: "unit", name: "U1", parentId: "ph1", projectId: "p1" },
        ]],
        [salesUnits, []],
      ]),
    );
    const b = res.json();
    expect(b.projects[0].sold_pct).toBeNull();
  });
});

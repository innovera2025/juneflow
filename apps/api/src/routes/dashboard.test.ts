// G3 unit tests (PLAN.md §9) — GET /dashboard/* (P1-BE-15, B-049): the 7
// dashboard aggregation widgets. Each test proves (a) the widget's real-data
// field shape, (b) company_id scope bound on EVERY query (tenant isolation,
// C10), (c) parent-FK tables are read THROUGH join hops (never bare), (d) 401
// without a session, plus the type-aware summary branch (realestate vs solar)
// and the honest-empty behaviour where seed source data is absent.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  apBillings,
  arInvoices,
  boqGroups,
  boqItems,
  cbsBudgets,
  ppaInvoices,
  prItems,
  projectNodes,
  projects,
  projectTypes,
  prs,
  salesUnits,
  solarInverters,
  subconContracts,
  vendors,
  workPeriods,
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

// --- stub Db supporting plain scoped selects, selectGlobalOrOwned, and
// selectThrough joins (rows are keyed by the FROM table; the stub returns the
// canned post-WHERE rows). Mirrors counts.test.ts / projects.test.ts. ---------
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

async function get(url: string, db: Db, captured?: Captured[]) {
  void captured;
  const instance = await buildTestApp({ resolveTenant: async () => SESSION, db });
  return instance.inject({ url });
}

// ===========================================================================
// auth (fail closed) — all 7 ops 401 without a tenant
// ===========================================================================
describe("GET /api/v1/dashboard/* — auth (fail closed)", () => {
  const URLS = [
    "/api/v1/dashboard/summary",
    "/api/v1/dashboard/budget-actual",
    "/api/v1/dashboard/approvals-inbox",
    "/api/v1/dashboard/phase-progress",
    "/api/v1/dashboard/alerts",
    "/api/v1/dashboard/cashflow-forecast",
    "/api/v1/dashboard/contractors",
  ];
  for (const url of URLS) {
    it(`401s flat without a session: ${url}`, async () => {
      const res = await (await buildTestApp()).inject({ url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    });
  }
});

// ===========================================================================
// 1. summary — type-aware KPIs + header + health
// ===========================================================================
describe("GET /api/v1/dashboard/summary", () => {
  const budgetDb = (captured: Captured[] = []) =>
    stubJoinDb(
      [
        [projects, [{ id: "p-re", companyId: COMPANY, typeId: "t-re", name: "RE", short: "RE", color: null, status: "active", currencyCode: "THB", budget: "50000000.00", createdAt: D }]],
        [projectTypes, [{ id: "t-re", key: "realestate", name: "อสังหาฯ" }]],
        [projectNodes, [{ id: "ph1", kind: "phase", name: "เฟส 1", parentId: null, projectId: "p-re" }]],
        // 3M budget · 600k used · 300k committed → remaining 2.1M · health 70
        [cbsBudgets, [
          { id: "cbs1", groupId: "g1", budget: "1000000.00", used: "200000.00", committed: "100000.00" },
          { id: "cbs2", groupId: "g2", budget: "2000000.00", used: "400000.00", committed: "200000.00" },
        ]],
      ],
      captured,
    );

  it("realestate → budget KPI block from cbs_budget (never mock constants)", async () => {
    const res = await get("/api/v1/dashboard/summary", budgetDb());
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b).toMatchObject({
      project_id: "p-re",
      project_name: "RE",
      project_type: "realestate",
      active_phase_label: "เฟส 1",
      status_label: "active",
      kpi_kind: "budget",
      budget_total: 3000000,
      actual_total: 600000,
      committed_total: 300000,
      remaining_total: 2100000,
      currency_code: "THB",
      health_score: 70,
    });
    expect(typeof b.as_of).toBe("string");
  });

  it("solar → solar KPI block from solar_inverter + ppa_invoice", async () => {
    const res = await get(
      "/api/v1/dashboard/summary",
      stubJoinDb([
        [projects, [{ id: "p-slr", companyId: COMPANY, typeId: "t-slr", name: "Solar", status: "active", currencyCode: "THB", createdAt: D }]],
        [projectTypes, [{ id: "t-slr", key: "solar", name: "โซลาร์" }]],
        [projectNodes, [{ id: "z1", kind: "phase", name: "โซน A", parentId: null, projectId: "p-slr" }]],
        [solarInverters, [{ kw: "500.000", perf: "92" }, { kw: "500.000", perf: "94" }]],
        [ppaInvoices, [{ mwh: "500" }, { mwh: "520" }]],
      ]),
    );
    expect(res.json()).toMatchObject({
      project_type: "solar",
      kpi_kind: "solar",
      installed_capacity: 1000,
      energy_ytd: 1020,
      performance_ratio: 93,
      health_score: 93,
    });
  });

  it("binds company_id on every summary query + scopes cbs_budget through 3 join hops", async () => {
    const captured: Captured[] = [];
    await get("/api/v1/dashboard/summary", budgetDb(captured));
    expectTenantScoped(captured);
    expect(captured.find((c) => c.table === cbsBudgets)?.joins.length).toBe(3);
    expect(captured.find((c) => c.table === projectNodes)?.joins.length).toBe(1);
    expect(captured.find((c) => c.table === projects)?.joins.length).toBe(0);
  });

  it("no projects → honest zero KPI block", async () => {
    const res = await get("/api/v1/dashboard/summary", stubJoinDb([]));
    expect(res.json()).toMatchObject({
      project_name: null,
      kpi_kind: "budget",
      budget_total: 0,
      health_score: 0,
    });
  });
});

// ===========================================================================
// 2. budget-actual — cost-category breakdown (real) + empty time-series (gap)
// ===========================================================================
describe("GET /api/v1/dashboard/budget-actual", () => {
  const db = (captured: Captured[] = []) =>
    stubJoinDb(
      [
        [projects, [{ id: "p", companyId: COMPANY, typeId: "t", name: "X", status: "active", currencyCode: "THB", createdAt: D }]],
        [cbsBudgets, [
          { groupId: "g1", budget: "1000000.00", used: "200000.00", committed: "100000.00" },
          { groupId: "g2", budget: "2000000.00", used: "400000.00", committed: "200000.00" },
        ]],
        [boqGroups, [{ id: "g1", name: "งานเตรียม" }, { id: "g2", name: "งานโครงสร้าง" }]],
      ],
      captured,
    );

  it("cost_categories from cbs_budget + boq_group; time-series honestly empty", async () => {
    const res = await get("/api/v1/dashboard/budget-actual", db());
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.cost_categories).toEqual([
      { category_label: "งานเตรียม", actual_value: 200000, plan_value: 1000000 },
      { category_label: "งานโครงสร้าง", actual_value: 400000, plan_value: 2000000 },
    ]);
    expect(b.period_label).toEqual([]);
    expect(b.budget_amount).toEqual([]);
    expect(b.currency_code).toBe("THB");
  });

  it("echoes ?range and binds tenant scope on every query", async () => {
    const captured: Captured[] = [];
    const res = await get("/api/v1/dashboard/budget-actual?range=quarter", db(captured));
    expect(res.json().range).toBe("quarter");
    expectTenantScoped(captured);
  });
});

// ===========================================================================
// 3. approvals-inbox — pending PRs, amount derived from pr_item × boq_item
// ===========================================================================
describe("GET /api/v1/dashboard/approvals-inbox", () => {
  const db = (captured: Captured[] = []) =>
    stubJoinDb(
      [
        [prs, [
          { id: "pr-0", no: "PR-0418", status: "pending", createdAt: D },
          { id: "pr-6", no: "PR-0412", status: "pending", createdAt: D },
        ]],
        [prItems, [
          { prId: "pr-0", boqItemId: "bi-0", qty: "5" },
          { prId: "pr-0", boqItemId: "bi-1", qty: "6" },
        ]],
        [boqItems, [
          { id: "bi-0", price: "280000.00", currencyCode: "THB" },
          { id: "bi-1", price: "850.00", currencyCode: "THB" },
        ]],
      ],
      captured,
    );

  it("returns pending PRs with derived amount + honest null gap fields", async () => {
    const res = await get("/api/v1/dashboard/approvals-inbox", db());
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.total).toBe(2);
    // pr-0: 5×280000 + 6×850 = 1,405,100 (real derived line total)
    expect(b.data[0]).toMatchObject({
      kind: "PR",
      doc_no: "PR-0418",
      title: null,
      requester: null,
      amount: 1405100,
      currency_code: "THB",
      urgent: false,
    });
    // pr-6 has no priced lines → honest null amount/currency
    expect(b.data[1]).toMatchObject({ doc_no: "PR-0412", amount: null, currency_code: null });
  });

  it("scopes pr(1)/pr_item(2)/boq_item(3) through join hops + tenant scope", async () => {
    const captured: Captured[] = [];
    await get("/api/v1/dashboard/approvals-inbox", db(captured));
    expectTenantScoped(captured);
    expect(captured.find((c) => c.table === prs)?.joins.length).toBe(1);
    expect(captured.find((c) => c.table === prItems)?.joins.length).toBe(2);
    expect(captured.find((c) => c.table === boqItems)?.joins.length).toBe(3);
    // the pending filter is bound alongside company_id
    expect(paramsOf(captured.find((c) => c.table === prs)?.where)).toContain("pending");
  });
});

// ===========================================================================
// 4. phase-progress — built% ≠ sold% (distinct real metrics), no mock formula
// ===========================================================================
describe("GET /api/v1/dashboard/phase-progress", () => {
  const db = (captured: Captured[] = []) =>
    stubJoinDb(
      [
        [projectNodes, [
          { id: "ph", kind: "phase", name: "เฟส 2", parentId: null, projectId: "p" },
          { id: "blk", kind: "block", name: "Block B", parentId: "ph", projectId: "p" },
          { id: "u0", kind: "unit", parentId: "blk", projectId: "p" },
          { id: "u1", kind: "unit", parentId: "blk", projectId: "p" },
          { id: "u2", kind: "unit", parentId: "blk", projectId: "p" },
          { id: "u3", kind: "unit", parentId: "blk", projectId: "p" },
          { id: "ph2", kind: "phase", name: "เฟส 3", parentId: null, projectId: "p" },
        ]],
        [salesUnits, [
          { unitId: "u0", stage: "soldBuilt" }, // sold AND built
          { unitId: "u1", stage: "sold" }, // sold only
          { unitId: "u2", stage: "built" }, // built only
          { unitId: "u3", stage: "empty" },
        ]],
      ],
      captured,
    );

  it("derives units + distinct sold%/built% from sales_unit.stage; budget_used/status null", async () => {
    const res = await get("/api/v1/dashboard/phase-progress", db());
    const b = res.json();
    expect(b.total).toBe(2);
    // sold = {u0,u1}=2/4=50 ; built = {u0,u2}=2/4=50 (distinct sets, NOT built=sold)
    expect(b.data[0]).toEqual({
      name: "เฟส 2",
      units: 4,
      sold: 50,
      built: 50,
      budget_used: null,
      status: null,
    });
    expect(b.data[1]).toMatchObject({ name: "เฟส 3", units: 0, sold: 0, built: 0 });
  });

  it("scopes project_node through a join + tenant scope on every read", async () => {
    const captured: Captured[] = [];
    await get("/api/v1/dashboard/phase-progress", db(captured));
    expectTenantScoped(captured);
    expect(captured.find((c) => c.table === projectNodes)?.joins.length).toBe(1);
    expect(captured.find((c) => c.table === salesUnits)?.joins.length).toBe(0);
  });
});

// ===========================================================================
// 5. alerts — real rules; empty on seed-shaped data (honest)
// ===========================================================================
describe("GET /api/v1/dashboard/alerts", () => {
  it("trips over-budget + overdue rules on tripping data", async () => {
    const res = await get(
      "/api/v1/dashboard/alerts",
      stubJoinDb([
        [cbsBudgets, [
          { groupId: "g1", budget: "1000000.00", used: "900000.00", committed: "200000.00" }, // 1.1M > 1M → trip
          { groupId: "g2", budget: "2000000.00", used: "100000.00", committed: "100000.00" }, // under → no trip
        ]],
        [boqGroups, [{ id: "g1", name: "งานไฟฟ้า" }, { id: "g2", name: "งานเตรียม" }]],
        [apBillings, [{ invoiceNo: "AP-1", dueDate: "2020-01-01", status: "pending", amount: "500000.00", vat: "0" }]],
      ]),
    );
    const b = res.json();
    expect(b.total).toBe(2);
    expect(b.data.map((a: { code: string }) => a.code).sort()).toEqual([
      "OVERDUE_PAYABLE",
      "OVER_BUDGET_CATEGORY",
    ]);
    expect(b.data.find((a: { code: string }) => a.code === "OVER_BUDGET_CATEGORY")).toMatchObject({
      tone: "danger",
      title: "งานไฟฟ้า",
    });
  });

  it("empty on seed-shaped data (used+committed < budget · due_date null) — honest", async () => {
    const res = await get(
      "/api/v1/dashboard/alerts",
      stubJoinDb([
        [cbsBudgets, [{ groupId: "g1", budget: "1000000.00", used: "200000.00", committed: "100000.00" }]],
        [boqGroups, [{ id: "g1", name: "งานเตรียม" }]],
        [apBillings, [{ invoiceNo: "AP", dueDate: null, status: "approved", amount: "645000.00", vat: "0" }]],
      ]),
    );
    expect(res.json().data).toEqual([]);
    expect(res.json().total).toBe(0);
  });

  it("scopes cbs(3)/boq_group(2)/ap_billing(0) + tenant scope", async () => {
    const captured: Captured[] = [];
    await get(
      "/api/v1/dashboard/alerts",
      stubJoinDb(
        [
          [cbsBudgets, [{ groupId: "g1", budget: "1000000.00", used: "1.00", committed: "1.00" }]],
          [boqGroups, [{ id: "g1", name: "x" }]],
          [apBillings, []],
        ],
        captured,
      ),
    );
    expectTenantScoped(captured);
    expect(captured.find((c) => c.table === cbsBudgets)?.joins.length).toBe(3);
    expect(captured.find((c) => c.table === boqGroups)?.joins.length).toBe(2);
    expect(captured.find((c) => c.table === apBillings)?.joins.length).toBe(0);
  });
});

// ===========================================================================
// 6. cashflow-forecast — 7-day window over ap_billing + ar_invoice
// ===========================================================================
describe("GET /api/v1/dashboard/cashflow-forecast", () => {
  const soon = new Date();
  soon.setUTCDate(soon.getUTCDate() + 2);
  const soonDate = soon.toISOString().slice(0, 10);
  const now = new Date();

  it("nets signed payables/receivables due within 7 days", async () => {
    const res = await get(
      "/api/v1/dashboard/cashflow-forecast",
      stubJoinDb([
        [apBillings, [
          { invoiceNo: "AP-due", dueDate: soonDate, status: "pending", amount: "100000.00", vat: "7000.00" },
          { invoiceNo: "AP-null", dueDate: null, status: "pending", amount: "1.00", vat: "0" },
        ]],
        [arInvoices, [
          { no: "AR-in", createdAt: now, creditTerm: 3, amount: "50000.00" }, // due +3d → in window
          { no: "AR-far", createdAt: now, creditTerm: 30, amount: "80000.00" }, // due +30d → out
        ]],
      ]),
    );
    const b = res.json();
    expect(b.rows).toHaveLength(2);
    expect(b.net_total).toBe(-57000); // -(100000+7000) + 50000
    expect(b.currency_code).toBe("THB");
  });

  it("empty on seed-shaped data (ap due null · ar due = +30d outside window)", async () => {
    const res = await get(
      "/api/v1/dashboard/cashflow-forecast",
      stubJoinDb([
        [apBillings, [{ invoiceNo: "AP", dueDate: null, status: "approved", amount: "920000.00", vat: "0" }]],
        [arInvoices, [{ no: "AR", createdAt: now, creditTerm: 30, amount: "728000.00" }]],
      ]),
    );
    expect(res.json()).toMatchObject({ net_total: 0, rows: [] });
  });

  it("binds tenant scope on ap_billing + ar_invoice (direct company tables)", async () => {
    const captured: Captured[] = [];
    await get(
      "/api/v1/dashboard/cashflow-forecast",
      stubJoinDb([[apBillings, []], [arInvoices, []]], captured),
    );
    expectTenantScoped(captured);
    expect(captured.find((c) => c.table === apBillings)?.joins.length).toBe(0);
    expect(captured.find((c) => c.table === arInvoices)?.joins.length).toBe(0);
  });
});

// ===========================================================================
// 7. contractors — active subcontracts + real progress + retention
// ===========================================================================
describe("GET /api/v1/dashboard/contractors", () => {
  const db = (captured: Captured[] = []) =>
    stubJoinDb(
      [
        [subconContracts, [
          { id: "c0", vendorId: "v0", value: "2000000.00", retentionPct: "10.000", currencyCode: "THB", end: "2026-12-31" },
          { id: "c1", vendorId: "v1", value: "1000000.00", retentionPct: "5.000", currencyCode: "THB", end: "2026-12-31" },
          { id: "c2", vendorId: "v0", value: "500000.00", retentionPct: "0", currencyCode: "THB", end: "2020-01-01" }, // ended → excluded
        ]],
        [workPeriods, [
          { contractId: "c0", status: "passed", amount: "500000.00" },
          { contractId: "c0", status: "passed", amount: "500000.00" },
          { contractId: "c0", status: "pending", amount: "1000000.00" },
          { contractId: "c1", status: "delivered", amount: "100000.00" },
        ]],
        [vendors, [{ id: "v0", name: "บจก. รุ่งเรือง" }, { id: "v1", name: "หจก. ช่างไทย" }]],
      ],
      captured,
    );

  it("progress = Σ passed / value; retention = value × pct; ended contracts excluded", async () => {
    const res = await get("/api/v1/dashboard/contractors", db());
    const b = res.json();
    expect(b.total).toBe(2); // c2 (ended) excluded
    expect(b.data[0]).toEqual({
      vendor_name: "บจก. รุ่งเรือง",
      work_scope: null,
      progress_pct: 50, // 1,000,000 / 2,000,000
      retention_amount: 200000, // 2,000,000 × 10%
      currency_code: "THB",
    });
    expect(b.data[1]).toMatchObject({
      vendor_name: "หจก. ช่างไทย",
      progress_pct: 0, // no passed periods
      retention_amount: 50000, // 1,000,000 × 5%
    });
  });

  it("scopes subcon(1)/work_period(2)/vendor(0) + tenant scope on every read", async () => {
    const captured: Captured[] = [];
    await get("/api/v1/dashboard/contractors", db(captured));
    expectTenantScoped(captured);
    expect(captured.find((c) => c.table === subconContracts)?.joins.length).toBe(1);
    expect(captured.find((c) => c.table === workPeriods)?.joins.length).toBe(2);
    expect(captured.find((c) => c.table === vendors)?.joins.length).toBe(0);
  });
});

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
  evmSnapshots,
  pos,
  ppaInvoices,
  prItems,
  projectNodes,
  projects,
  projectTypes,
  prs,
  roles,
  salesUnits,
  solarInverters,
  subconContracts,
  users,
  vendors,
  workPeriods,
  wos,
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

  it("cost_categories from cbs_budget + boq_group; time-series honestly empty when no snapshots", async () => {
    // db() seeds NO evm_snapshot rows → the series stays honestly empty (C10).
    const res = await get("/api/v1/dashboard/budget-actual", db());
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.cost_categories).toEqual([
      { category_label: "งานเตรียม", actual_value: 200000, plan_value: 1000000 },
      { category_label: "งานโครงสร้าง", actual_value: 400000, plan_value: 2000000 },
    ]);
    expect(b.period_label).toEqual([]);
    expect(b.budget_amount).toEqual([]);
    expect(b.actual_amount).toEqual([]);
    expect(b.plan_amount).toEqual([]);
    // currency stays non-null (project currency) even with an empty series.
    expect(b.currency_code).toBe("THB");
  });

  it("backfills the period series from evm_snapshot, ordered by period ASC (group-C Wave-3)", async () => {
    const captured: Captured[] = [];
    const res = await get(
      "/api/v1/dashboard/budget-actual",
      stubJoinDb(
        [
          [projects, [{ id: "p", companyId: COMPANY, typeId: "t", name: "X", status: "active", currencyCode: "THB", createdAt: D }]],
          [cbsBudgets, []],
          [boqGroups, []],
          // deliberately OUT OF ORDER → the handler must sort by period ASC.
          [evmSnapshots, [
            { period: "2026-02", periodEnd: "2026-02-28", pv: "2000000.00", ev: "1880000.00", ac: "2100000.00", budget: "2000000.00", bac: "21000000.00", currencyCode: "THB" },
            { period: "2026-01", periodEnd: "2026-01-31", pv: "1000000.00", ev: "940000.00", ac: "920000.00", budget: "1000000.00", bac: "21000000.00", currencyCode: "THB" },
          ]],
        ],
        captured,
      ),
    );
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.period_label).toEqual(["2026-01", "2026-02"]);
    expect(b.plan_amount).toEqual([1000000, 2000000]); // pv
    expect(b.budget_amount).toEqual([1000000, 2000000]); // budget
    expect(b.actual_amount).toEqual([920000, 2100000]); // ac (2026-02 is a danger period: ac > budget)
    // evm_snapshot is project-anchored → read THROUGH the projects hop (1 join),
    // company_id bound on the joined project root (no cross-tenant leak).
    const evm = captured.find((c) => c.table === evmSnapshots);
    expect(evm?.joins.length).toBe(1);
    expect(paramsOf(evm?.where)).toContain(COMPANY);
  });

  it("echoes ?range and binds tenant scope on every query", async () => {
    const captured: Captured[] = [];
    const res = await get("/api/v1/dashboard/budget-actual?range=quarter", db(captured));
    expect(res.json().range).toBe("quarter");
    expectTenantScoped(captured);
  });
});

// ===========================================================================
// 3. approvals-inbox — UNION of pending PR+PO+WO the CALLER may approve (B-070).
// The caller's role.approvalLevel (resolved authUser.email → user → role) must
// reach the tier each doc's amount demands (the same gate the approve handlers
// enforce). PR tiers 500K/2M; PO/WO tiers 1M/5M (procurement.ts / pr.ts).
// ===========================================================================
/** Seed a session user + role at the given approvalLevel (loadUser/Role → row[0]). */
const approver = (level: number): Array<[unknown, unknown[]]> => [
  [users, [{ id: "au-0", email: SESSION.user.email, roleId: "role-x", companyId: COMPANY, name: "สมชาย", status: "active" }]],
  [roles, [{ id: "role-x", companyId: COMPANY, approvalLevel: level }]],
];

describe("GET /api/v1/dashboard/approvals-inbox", () => {
  // A director (level 4) clears every tier → sees every pending PR/PO/WO.
  const unionDb = (captured: Captured[] = []) =>
    stubJoinDb(
      [
        ...approver(4),
        [prs, [{ id: "pr-0", no: "PR-0418", status: "pending", createdAt: D }]],
        [prItems, [
          { prId: "pr-0", boqItemId: "bi-0", qty: "5" },
          { prId: "pr-0", boqItemId: "bi-1", qty: "6" },
        ]],
        [boqItems, [
          { id: "bi-0", price: "280000.00", currencyCode: "THB" },
          { id: "bi-1", price: "850.00", currencyCode: "THB" },
        ]],
        [pos, [{ id: "po-0", no: "PO-2201", status: "pending", total: "2000000.00", currencyCode: "THB", createdAt: D }]],
        // wo.no is a nullable real column → doc_no is legitimately null here.
        [wos, [{ id: "wo-0", no: null, status: "pending", value: "1000000.00", currencyCode: "THB", createdAt: D }]],
      ],
      captured,
    );

  it("returns the pending PR+PO+WO union for an approver, with honest null gaps", async () => {
    const res = await get("/api/v1/dashboard/approvals-inbox", unionDb());
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.total).toBe(3);
    const byKind = Object.fromEntries(
      b.data.map((r: { kind: string }) => [r.kind, r]),
    );
    // PR: 5×280000 + 6×850 = 1,405,100 (real derived line total); title/requester/urgent honest null.
    // id is the doc id the mobile inbox (B-259) navigates to detail with — carried per kind.
    expect(byKind.PR).toMatchObject({
      id: "pr-0", kind: "PR", doc_no: "PR-0418", title: null, requester: null,
      amount: 1405100, currency_code: "THB", urgent: null,
    });
    // PO: stored total (po has no line table). WO: stored value; its null `no` → null doc_no.
    expect(byKind.PO).toMatchObject({ id: "po-0", kind: "PO", doc_no: "PO-2201", amount: 2000000, currency_code: "THB" });
    expect(byKind.WO).toMatchObject({ id: "wo-0", kind: "WO", doc_no: null, amount: 1000000, currency_code: "THB", urgent: null });
  });

  it("scopes pr(1)/po(2)/wo(2)/pr_item(2)/boq_item(3) + pending filter + tenant scope on every read", async () => {
    const captured: Captured[] = [];
    await get("/api/v1/dashboard/approvals-inbox", unionDb(captured));
    expectTenantScoped(captured); // company_id bound on user/role/pr/po/wo/pr_item/boq_item
    expect(captured.find((c) => c.table === prs)?.joins.length).toBe(1);
    expect(captured.find((c) => c.table === pos)?.joins.length).toBe(2);
    expect(captured.find((c) => c.table === wos)?.joins.length).toBe(2);
    expect(captured.find((c) => c.table === prItems)?.joins.length).toBe(2);
    expect(captured.find((c) => c.table === boqItems)?.joins.length).toBe(3);
    // the pending filter is bound alongside company_id on every doc query
    expect(paramsOf(captured.find((c) => c.table === prs)?.where)).toContain("pending");
    expect(paramsOf(captured.find((c) => c.table === pos)?.where)).toContain("pending");
    expect(paramsOf(captured.find((c) => c.table === wos)?.where)).toContain("pending");
  });

  it("pr with no priced lines → honest null amount/currency, tier from a real 0 (proc sees it)", async () => {
    const res = await get(
      "/api/v1/dashboard/approvals-inbox",
      stubJoinDb([
        ...approver(2), // หน.จัดซื้อ — clears the level-2 tier an unpriced (amount 0) PR needs
        [prs, [{ id: "pr-x", no: "PR-0412", status: "pending", createdAt: D }]],
        [prItems, []],
        [boqItems, []],
      ]),
    );
    const b = res.json();
    expect(b.total).toBe(1);
    expect(b.data[0]).toMatchObject({ doc_no: "PR-0412", amount: null, currency_code: null });
  });

  // --- tier authority: a doc appears iff callerLevel >= requiredLevel(amount) ---
  // small docs need level 2; big docs need level 4 (PR>2M, PO/WO>5M).
  const tierDb = (level: number) =>
    stubJoinDb([
      ...approver(level),
      [prs, [
        { id: "pr-s", no: "PR-S", status: "pending", createdAt: D },
        { id: "pr-b", no: "PR-B", status: "pending", createdAt: D },
      ]],
      [prItems, [
        { prId: "pr-s", boqItemId: "bi-s", qty: "1" }, // 1×100000 = 100,000 → tier 2
        { prId: "pr-b", boqItemId: "bi-b", qty: "10" }, // 10×300000 = 3,000,000 → tier 4 (>2M)
      ]],
      [boqItems, [
        { id: "bi-s", price: "100000.00", currencyCode: "THB" },
        { id: "bi-b", price: "300000.00", currencyCode: "THB" },
      ]],
      [pos, [
        { id: "po-s", no: "PO-S", status: "pending", total: "500000.00", currencyCode: "THB", createdAt: D }, // tier 2
        { id: "po-b", no: "PO-B", status: "pending", total: "6000000.00", currencyCode: "THB", createdAt: D }, // tier 4 (>5M)
      ]],
      [wos, [
        { id: "wo-s", no: "WO-S", status: "pending", value: "800000.00", currencyCode: "THB", createdAt: D }, // tier 2
        { id: "wo-b", no: "WO-B", status: "pending", value: "6000000.00", currencyCode: "THB", createdAt: D }, // tier 4 (>5M)
      ]],
    ]);

  it("level-2 (หน.จัดซื้อ) sees only the docs at its tier — big docs excluded", async () => {
    const res = await get("/api/v1/dashboard/approvals-inbox", tierDb(2));
    const b = res.json();
    expect(b.total).toBe(3);
    expect(b.data.map((r: { doc_no: string }) => r.doc_no).sort()).toEqual(["PO-S", "PR-S", "WO-S"]);
  });

  it("level-4 (MD) clears every tier → sees all 6 pending docs", async () => {
    const res = await get("/api/v1/dashboard/approvals-inbox", tierDb(4));
    const b = res.json();
    expect(b.total).toBe(6);
    expect(b.data.map((r: { doc_no: string }) => r.doc_no).sort())
      .toEqual(["PO-B", "PO-S", "PR-B", "PR-S", "WO-B", "WO-S"]);
  });

  it("empty inbox when nothing is pending (honest zero — the badge is live, never 17)", async () => {
    const res = await get(
      "/api/v1/dashboard/approvals-inbox",
      stubJoinDb([...approver(4), [prs, []], [pos, []], [wos, []], [prItems, []], [boqItems, []]]),
    );
    expect(res.json()).toMatchObject({ total: 0, data: [] });
  });

  it("unattributable caller (no user/role row) → empty even with pending docs", async () => {
    const res = await get(
      "/api/v1/dashboard/approvals-inbox",
      // no users/roles seeded → callerApprovalLevel null → clears no tier
      stubJoinDb([
        [prs, [{ id: "pr-0", no: "PR-0418", status: "pending", createdAt: D }]],
        [prItems, []], [boqItems, []],
        [pos, [{ id: "po-0", no: "PO-1", status: "pending", total: "100.00", currencyCode: "THB", createdAt: D }]],
        [wos, [{ id: "wo-0", no: "WO-1", status: "pending", value: "100.00", currencyCode: "THB", createdAt: D }]],
      ]),
    );
    expect(res.json()).toMatchObject({ total: 0, data: [] });
  });

  it("level-0 caller (no approval rights) → empty even with pending docs", async () => {
    const res = await get(
      "/api/v1/dashboard/approvals-inbox",
      stubJoinDb([
        ...approver(0),
        [prs, [{ id: "pr-0", no: "PR-0418", status: "pending", createdAt: D }]],
        [prItems, []], [boqItems, []], [pos, []], [wos, []],
      ]),
    );
    expect(res.json()).toMatchObject({ total: 0, data: [] });
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

// ===========================================================================
// project_id scope (contract amendment, B-049): provided → that project,
// tenant-verified; foreign/absent → 404 (EntityOk) / empty (EntityList);
// omitted → default behaviour (covered by the suites above).
// ===========================================================================
describe("GET /api/v1/dashboard/* — ?project_id scope + ownership", () => {
  const RJP = "f84b0f07-ed67-522c-8ced-df72a883aaee";
  const FOREIGN = "99999999-9999-9999-9999-999999999999";

  // summary/budget-actual data-bearing project (rjp) — ownership select returns it.
  const rjpDb = (captured: Captured[] = []) =>
    stubJoinDb(
      [
        [projects, [{ id: RJP, companyId: COMPANY, typeId: "t-re", name: "ราชพฤกษ์", status: "active", currencyCode: "THB", createdAt: D }]],
        [projectTypes, [{ id: "t-re", key: "realestate", name: "อสังหาฯ" }]],
        [projectNodes, [{ id: "ph", kind: "phase", name: "เฟส 1", parentId: null, projectId: RJP }]],
        [cbsBudgets, [
          { groupId: "g1", budget: "10000000.00", used: "2000000.00", committed: "1000000.00" },
          { groupId: "g2", budget: "11000000.00", used: "2200000.00", committed: "1100000.00" },
        ]],
        [boqGroups, [{ id: "g1", name: "งานเตรียม" }, { id: "g2", name: "งานโครงสร้าง" }]],
      ],
      captured,
    );

  it("summary?project_id=<owned> → non-empty budget KPIs for that project", async () => {
    const captured: Captured[] = [];
    const res = await get(`/api/v1/dashboard/summary?project_id=${RJP}`, rjpDb(captured));
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b).toMatchObject({
      project_id: RJP,
      project_name: "ราชพฤกษ์",
      kpi_kind: "budget",
      budget_total: 21000000,
      actual_total: 4200000,
      committed_total: 2100000,
      remaining_total: 14700000,
      health_score: 70,
    });
    // the cbs aggregation is bound to BOTH company_id and the requested project.
    const cbsWhere = paramsOf(captured.find((c) => c.table === cbsBudgets)?.where);
    expect(cbsWhere).toContain(COMPANY);
    expect(cbsWhere).toContain(RJP);
  });

  it("summary?project_id=<foreign/absent> → 404 (ownership select returns nothing)", async () => {
    const res = await get(`/api/v1/dashboard/summary?project_id=${FOREIGN}`, stubJoinDb([[projects, []]]));
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: "NOT_FOUND", message: "Project not found" });
  });

  it("budget-actual?project_id=<owned> → cost_categories for that project (scope bound)", async () => {
    const captured: Captured[] = [];
    const res = await get(`/api/v1/dashboard/budget-actual?project_id=${RJP}`, rjpDb(captured));
    expect(res.statusCode).toBe(200);
    expect(res.json().cost_categories).toEqual([
      { category_label: "งานเตรียม", actual_value: 2000000, plan_value: 10000000 },
      { category_label: "งานโครงสร้าง", actual_value: 2200000, plan_value: 11000000 },
    ]);
    expect(paramsOf(captured.find((c) => c.table === cbsBudgets)?.where)).toContain(RJP);
  });

  it("budget-actual?project_id=<foreign> → 404", async () => {
    const res = await get(`/api/v1/dashboard/budget-actual?project_id=${FOREIGN}`, stubJoinDb([[projects, []]]));
    expect(res.statusCode).toBe(404);
  });

  it("cashflow-forecast?project_id=<owned> → ar scoped to project, payables leg omitted", async () => {
    const captured: Captured[] = [];
    const res = await get(
      `/api/v1/dashboard/cashflow-forecast?project_id=${RJP}`,
      stubJoinDb([[projects, [{ id: RJP, companyId: COMPANY, createdAt: D }]], [arInvoices, []]], captured),
    );
    expect(res.statusCode).toBe(200);
    // ar_invoice read is scoped to the project; ap_billing is NOT read (no project_id column).
    expect(paramsOf(captured.find((c) => c.table === arInvoices)?.where)).toContain(RJP);
    expect(captured.find((c) => c.table === apBillings)).toBeUndefined();
  });

  it("cashflow-forecast?project_id=<foreign> → 404", async () => {
    const res = await get(`/api/v1/dashboard/cashflow-forecast?project_id=${FOREIGN}`, stubJoinDb([[projects, []]]));
    expect(res.statusCode).toBe(404);
  });

  it("approvals-inbox?project_id binds company + project + pending on the pr/po/wo queries", async () => {
    const captured: Captured[] = [];
    await get(
      `/api/v1/dashboard/approvals-inbox?project_id=${RJP}`,
      stubJoinDb([[prs, []], [pos, []], [wos, []], [prItems, []], [boqItems, []]], captured),
    );
    // Each doc kind is scoped to company_id AND the requested project (po/wo via
    // the joined pr.project_id root) AND the pending state — no cross-tenant/-project leak.
    for (const table of [prs, pos, wos]) {
      const w = paramsOf(captured.find((c) => c.table === table)?.where);
      expect(w).toContain(COMPANY);
      expect(w).toContain(RJP);
      expect(w).toContain("pending");
    }
  });

  it("phase-progress?project_id binds company + project on the project_node query", async () => {
    const captured: Captured[] = [];
    await get(
      `/api/v1/dashboard/phase-progress?project_id=${RJP}`,
      stubJoinDb([[projectNodes, []], [salesUnits, []]], captured),
    );
    const w = paramsOf(captured.find((c) => c.table === projectNodes)?.where);
    expect(w).toContain(COMPANY);
    expect(w).toContain(RJP);
  });

  it("alerts?project_id scopes cbs to project + omits the ap_billing (no project link)", async () => {
    const captured: Captured[] = [];
    await get(
      `/api/v1/dashboard/alerts?project_id=${RJP}`,
      stubJoinDb([[cbsBudgets, []], [boqGroups, []], [apBillings, []]], captured),
    );
    expect(paramsOf(captured.find((c) => c.table === cbsBudgets)?.where)).toContain(RJP);
    // ap_billing has no project_id column → not read under project scope (GAP).
    expect(captured.find((c) => c.table === apBillings)).toBeUndefined();
  });

  it("contractors?project_id binds project on subcon_contract AND work_period (no cross-tenant leak)", async () => {
    const captured: Captured[] = [];
    await get(
      `/api/v1/dashboard/contractors?project_id=${FOREIGN}`,
      stubJoinDb([[subconContracts, []], [workPeriods, []], [vendors, []]], captured),
    );
    // a foreign project id is bound alongside company_id on every scoped read →
    // in real PG the join yields zero rows (empty list), never another tenant's data.
    const sc = paramsOf(captured.find((c) => c.table === subconContracts)?.where);
    const wp = paramsOf(captured.find((c) => c.table === workPeriods)?.where);
    expect(sc).toEqual(expect.arrayContaining([COMPANY, FOREIGN]));
    expect(wp).toEqual(expect.arrayContaining([COMPANY, FOREIGN]));
  });
});

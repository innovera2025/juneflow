// G3 unit tests (PLAN.md §9) — GET /boq/reports/* (group-C Wave-2, B-101). The
// two BOQ analytics report cards (RPT-003 cost-type, RPT-001 BOQ-vs-Non-BOQ).
// Each test proves (a) the report's real-data field shape, (b) company_id scope
// bound on EVERY query (tenant isolation, C10) with parent-FK tables read THROUGH
// join hops, (c) 401 without a session, plus the Non-BOQ routing rule (Wei D1:
// null boq_item_id lands in the synthetic non_boq row, never in a group row) and
// the honest-empty behaviour where seed source data is absent.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { boqDocs, boqGroups, boqItems, evmSnapshots, prItems } from "@juneflow/db";
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

async function get(url: string, db: Db) {
  const instance = await buildTestApp({ resolveTenant: async () => SESSION, db });
  return instance.inject({ url });
}

// ===========================================================================
// auth (fail closed) — both ops 401 without a tenant
// ===========================================================================
describe("GET /api/v1/boq/reports/* — auth (fail closed)", () => {
  const URLS = [
    "/api/v1/boq/reports/cost-type",
    "/api/v1/boq/reports/boq-vs-nonboq",
    "/api/v1/boq/reports/evm",
    "/api/v1/boq/reports/variance",
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
// RPT-003 cost-type — Material/Subcon/Labor by work category (real cat column)
// ===========================================================================
describe("GET /api/v1/boq/reports/cost-type", () => {
  const db = (captured: Captured[] = []) =>
    stubJoinDb(
      [
        [boqGroups, [
          { id: "g1", name: "02 งานโครงสร้าง" },
          { id: "g2", name: "04 งานระบบไฟฟ้า" },
        ]],
        [boqItems, [
          { id: "i1", groupId: "g1", cat: "M", qty: "2", price: "100000.00", currencyCode: "THB" },
          { id: "i2", groupId: "g1", cat: "S", qty: "1", price: "50000.00", currencyCode: "THB" },
          { id: "i3", groupId: "g1", cat: "L", qty: "1", price: "10000.00", currencyCode: "THB" },
          { id: "i4", groupId: "g2", cat: "M", qty: "1", price: "20000.00", currencyCode: "THB" },
        ]],
      ],
      captured,
    );

  it("splits M/S/L per group from the real boq_item.cat column + integer ratio", async () => {
    const res = await get("/api/v1/boq/reports/cost-type", db());
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.rows).toEqual([
      { group_id: "g1", category_label: "02 งานโครงสร้าง", material: 200000, subcon: 50000, labor: 10000, total: 260000, currency_code: "THB" },
      { group_id: "g2", category_label: "04 งานระบบไฟฟ้า", material: 20000, subcon: 0, labor: 0, total: 20000, currency_code: "THB" },
    ]);
    expect(b.totals).toEqual({ material: 220000, subcon: 50000, labor: 10000, grand: 280000 });
    // 220000/280000=78.57→79 ; 50000/280000=17.86→18 ; 10000/280000=3.57→4
    expect(b.ratio).toEqual({ material_pct: 79, subcon_pct: 18, labor_pct: 4 });
    expect(b.currency_code).toBe("THB");
  });

  it("scopes boq_group(2 hops)/boq_item(3 hops) + tenant scope on every read", async () => {
    const captured: Captured[] = [];
    await get("/api/v1/boq/reports/cost-type", db(captured));
    expectTenantScoped(captured);
    expect(captured.find((c) => c.table === boqGroups)?.joins.length).toBe(2);
    expect(captured.find((c) => c.table === boqItems)?.joins.length).toBe(3);
  });

  it("binds project_id + boq_id filters alongside company on the scoped reads", async () => {
    const captured: Captured[] = [];
    const RJP = "f84b0f07-ed67-522c-8ced-df72a883aaee";
    const BOQ = "aaaaaaaa-1111-2222-3333-444444444444";
    await get(
      `/api/v1/boq/reports/cost-type?project_id=${RJP}&boq_id=${BOQ}`,
      db(captured),
    );
    const w = paramsOf(captured.find((c) => c.table === boqItems)?.where);
    expect(w).toEqual(expect.arrayContaining([COMPANY, RJP, BOQ]));
  });

  it("honest-empty: no items → empty rows, zero totals, null ratio (never fabricated)", async () => {
    const res = await get(
      "/api/v1/boq/reports/cost-type",
      stubJoinDb([[boqGroups, [{ id: "g1", name: "x" }]], [boqItems, []]]),
    );
    const b = res.json();
    expect(b.rows).toEqual([]);
    expect(b.totals).toEqual({ material: 0, subcon: 0, labor: 0, grand: 0 });
    expect(b.ratio).toEqual({ material_pct: null, subcon_pct: null, labor_pct: null });
  });
});

// ===========================================================================
// RPT-001 boq-vs-nonboq — Wei D1: null boq_item_id = Non-BOQ (synthetic row);
// boq_item_id set = BOQ-attributed spend rolled to the item's group.
// ===========================================================================
describe("GET /api/v1/boq/reports/boq-vs-nonboq", () => {
  const db = (captured: Captured[] = []) =>
    stubJoinDb(
      [
        [boqGroups, [
          { id: "g1", name: "02 งานโครงสร้าง" },
          { id: "g2", name: "04 งานระบบไฟฟ้า" },
        ]],
        [boqItems, [
          { id: "bi1", groupId: "g1", qty: "10", price: "100000.00" }, // plan g1 = 1,000,000
          { id: "bi2", groupId: "g2", qty: "5", price: "50000.00" }, //  plan g2 =   250,000
        ]],
        [prItems, [
          { id: "pl1", prId: "pr1", boqItemId: "bi1", qty: "5" }, // BOQ-attributed → within plan, not counted
          { id: "pl2", prId: "pr1", boqItemId: null, qty: "3" }, //  Non-BOQ → synthetic row
        ]],
      ],
      captured,
    );

  it("boq per group = the BOQ plan (Σ qty×price); null boq_item_id → a synthetic Non-BOQ row", async () => {
    const res = await get("/api/v1/boq/reports/boq-vs-nonboq", db());
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.rows).toEqual([
      { group_id: "g1", category_label: "02 งานโครงสร้าง", boq: 1000000, non_boq: 0, total_actual: 1000000, pct_over: 0 },
      { group_id: "g2", category_label: "04 งานระบบไฟฟ้า", boq: 250000, non_boq: 0, total_actual: 250000, pct_over: 0 },
      // Non-BOQ synthetic row — honest null label; non_boq is an HONEST 0 (a
      // non-BOQ pr_item carries no priceable amount — the C10 DATA GAP).
      { group_id: null, category_label: null, boq: 0, non_boq: 0, total_actual: 0, pct_over: null },
    ]);
    expect(b.totals).toEqual({ boq: 1250000, non_boq: 0, total_actual: 1250000, pct_over: 0 });
    expect(b.currency_code).toBe("THB");
  });

  it("null-boq_item_id rows land in the non_boq synthetic row and NOT in any group row (Wei D1)", async () => {
    const res = await get("/api/v1/boq/reports/boq-vs-nonboq", db());
    const b = res.json();
    // exactly ONE synthetic Non-BOQ row (group_id null) because ONE null line exists.
    const synthetic = b.rows.filter((r: { group_id: string | null }) => r.group_id === null);
    expect(synthetic).toHaveLength(1);
    // the null line never inflated a group row, AND the BOQ-attributed pr line
    // (5×100000=500000) was NOT rolled into g1's boq — boq stays the plan 1,000,000.
    const g1 = b.rows.find((r: { group_id: string | null }) => r.group_id === "g1");
    expect(g1.boq).toBe(1000000);
    const g2 = b.rows.find((r: { group_id: string | null }) => r.group_id === "g2");
    expect(g2.boq).toBe(250000);
  });

  it("no synthetic row when every pr_item is BOQ-attributed (no null boq_item_id)", async () => {
    const res = await get(
      "/api/v1/boq/reports/boq-vs-nonboq",
      stubJoinDb([
        [boqGroups, [{ id: "g1", name: "A" }]],
        [boqItems, [{ id: "bi1", groupId: "g1", qty: "2", price: "100000.00" }]], // plan = 200,000
        [prItems, [{ id: "pl1", prId: "pr1", boqItemId: "bi1", qty: "2" }]],
      ]),
    );
    const b = res.json();
    expect(b.rows.some((r: { group_id: string | null }) => r.group_id === null)).toBe(false);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0]).toMatchObject({ group_id: "g1", boq: 200000 });
  });

  it("category filter keeps only the matching group and drops the synthetic Non-BOQ row", async () => {
    const res = await get(
      "/api/v1/boq/reports/boq-vs-nonboq?category=" + encodeURIComponent("02 งานโครงสร้าง"),
      db(),
    );
    const b = res.json();
    expect(b.rows).toEqual([
      { group_id: "g1", category_label: "02 งานโครงสร้าง", boq: 1000000, non_boq: 0, total_actual: 1000000, pct_over: 0 },
    ]);
  });

  it("scopes boq_group(2)/boq_item(3)/pr_item(2 hops) + tenant scope on every read", async () => {
    const captured: Captured[] = [];
    await get("/api/v1/boq/reports/boq-vs-nonboq", db(captured));
    expectTenantScoped(captured);
    expect(captured.find((c) => c.table === boqGroups)?.joins.length).toBe(2);
    expect(captured.find((c) => c.table === boqItems)?.joins.length).toBe(3);
    expect(captured.find((c) => c.table === prItems)?.joins.length).toBe(2);
  });

  it("binds project_id + from/to on the pr_item read alongside company", async () => {
    const captured: Captured[] = [];
    const RJP = "f84b0f07-ed67-522c-8ced-df72a883aaee";
    await get(
      `/api/v1/boq/reports/boq-vs-nonboq?project_id=${RJP}&from=2026-01-01&to=2026-06-30`,
      db(captured),
    );
    const w = paramsOf(captured.find((c) => c.table === prItems)?.where);
    expect(w).toEqual(expect.arrayContaining([COMPANY, RJP]));
    // the from/to Date bounds are bound as query params (2 extra beyond company+project).
    expect(w.length).toBeGreaterThanOrEqual(4);
  });

  it("honest-empty: no BOQ + no PR → empty rows, zero totals, null pct_over", async () => {
    const res = await get(
      "/api/v1/boq/reports/boq-vs-nonboq",
      stubJoinDb([[boqGroups, []], [boqItems, []], [prItems, []]]),
    );
    const b = res.json();
    expect(b.rows).toEqual([]);
    expect(b.totals).toEqual({ boq: 0, non_boq: 0, total_actual: 0, pct_over: null });
    expect(b.currency_code).toBe("THB");
  });
});

// ===========================================================================
// RPT-005 evm — PV/EV/AC series + SPI/CPI, sourced from the ONE build-once
// loadEvmSeries helper (evm_snapshot read THROUGH the projects door — B-101 D3).
// ===========================================================================
describe("GET /api/v1/boq/reports/evm", () => {
  const PROJECT = "f84b0f07-ed67-522c-8ced-df72a883aaee";
  // Two periods GIVEN OUT OF ORDER — loadEvmSeries must return them period ASC.
  const db = (captured: Captured[] = []) =>
    stubJoinDb(
      [
        [evmSnapshots, [
          { projectId: PROJECT, period: "2026-06", periodEnd: "2026-06-30", pv: "12400000.00", ev: "11600000.00", ac: "12300000.00", budget: "12000000.00", bac: "26400000.00", currencyCode: "THB" },
          { projectId: PROJECT, period: "2026-02", periodEnd: "2026-02-28", pv: "2800000.00", ev: "2700000.00", ac: "2720000.00", budget: "2800000.00", bac: "26400000.00", currencyCode: "THB" },
        ]],
      ],
      captured,
    );

  it("series ordered period ASC; SPI/CPI = EV/PV & EV/AC of the LAST period, rounded 2dp", async () => {
    const res = await get("/api/v1/boq/reports/evm", db());
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.series).toEqual([
      { period_label: "2026-02", pv: 2800000, ev: 2700000, ac: 2720000 },
      { period_label: "2026-06", pv: 12400000, ev: 11600000, ac: 12300000 },
    ]);
    // last period: SPI = 11.6/12.4 = 0.9355→0.94 ; CPI = 11.6/12.3 = 0.9431→0.94
    expect(b.spi).toBe(0.94);
    expect(b.cpi).toBe(0.94);
    expect(b.currency_code).toBe("THB");
  });

  it("honest em-dash: no snapshots → empty series + null SPI/CPI (never fabricated)", async () => {
    const res = await get(
      "/api/v1/boq/reports/evm",
      stubJoinDb([[evmSnapshots, []]]),
    );
    const b = res.json();
    expect(b.series).toEqual([]);
    expect(b.spi).toBeNull();
    expect(b.cpi).toBeNull();
    expect(b.currency_code).toBe("THB");
  });

  it("zero PV on the last period → SPI null; CPI still computed; series still renders", async () => {
    const res = await get(
      "/api/v1/boq/reports/evm",
      stubJoinDb([[evmSnapshots, [
        { projectId: PROJECT, period: "2026-02", periodEnd: "2026-02-28", pv: "0", ev: "2700000.00", ac: "2720000.00", budget: "0", bac: "0", currencyCode: "THB" },
      ]]]),
    );
    const b = res.json();
    expect(b.series).toHaveLength(1);
    expect(b.spi).toBeNull();
    // CPI = 2.7M/2.72M = 0.9926 → 0.99 (a zero denominator nulls ONLY its index)
    expect(b.cpi).toBe(0.99);
  });

  it("zero AC on the last period → CPI null; SPI still computed", async () => {
    const res = await get(
      "/api/v1/boq/reports/evm",
      stubJoinDb([[evmSnapshots, [
        { projectId: PROJECT, period: "2026-02", periodEnd: "2026-02-28", pv: "2800000.00", ev: "2700000.00", ac: "0", budget: "0", bac: "0", currencyCode: "THB" },
      ]]]),
    );
    const b = res.json();
    expect(b.cpi).toBeNull();
    // SPI = 2.7M/2.8M = 0.9643 → 0.96
    expect(b.spi).toBe(0.96);
    expect(b.series).toHaveLength(1);
  });

  it("reads evm_snapshot THROUGH the projects hop with company bound (tenant scope)", async () => {
    const captured: Captured[] = [];
    await get("/api/v1/boq/reports/evm", db(captured));
    expectTenantScoped(captured);
    expect(captured.find((c) => c.table === evmSnapshots)?.joins.length).toBe(1);
  });

  it("project_id given → filters the series by that project directly (no doc lookup)", async () => {
    const captured: Captured[] = [];
    const RJP = "f84b0f07-ed67-522c-8ced-df72a883aaee";
    await get(`/api/v1/boq/reports/evm?project_id=${RJP}`, db(captured));
    // project_id is used directly — no boq_doc resolution happens
    expect(captured.find((c) => c.table === boqDocs)).toBeUndefined();
    const evmRead = captured.find((c) => c.table === evmSnapshots);
    expect(paramsOf(evmRead?.where)).toEqual(expect.arrayContaining([COMPANY, RJP]));
  });

  it("boq_id → resolves the doc's OWNING project (scoped doc read), then filters the series by it", async () => {
    const captured: Captured[] = [];
    const BOQ = "aaaaaaaa-1111-2222-3333-444444444444";
    const RESOLVED = "b2b2b2b2-1111-2222-3333-444444444444";
    await get(
      `/api/v1/boq/reports/evm?boq_id=${BOQ}`,
      stubJoinDb([
        [boqDocs, [{ projectId: RESOLVED }]],
        [evmSnapshots, [
          { projectId: RESOLVED, period: "2026-02", periodEnd: "2026-02-28", pv: "1", ev: "1", ac: "1", budget: "1", bac: "1", currencyCode: "THB" },
        ]],
      ], captured),
    );
    // the doc lookup is tenant-scoped (company + boq_id) and reads doc→project (1 hop)
    const docRead = captured.find((c) => c.table === boqDocs);
    expect(docRead?.joins.length).toBe(1);
    expect(paramsOf(docRead?.where)).toEqual(expect.arrayContaining([COMPANY, BOQ]));
    // the series is then filtered by the RESOLVED project id (never tenant-wide)
    const evmRead = captured.find((c) => c.table === evmSnapshots);
    expect(paramsOf(evmRead?.where)).toEqual(
      expect.arrayContaining([COMPANY, RESOLVED]),
    );
  });
});

// ===========================================================================
// RPT-004 variance — Plan(budget) vs Actual(ac) per period (Wei D3), from the
// SAME loadEvmSeries store. status is derived from the REAL time fact period_end
// vs now; a pending row mirrors the mock's "—" with honest-null variance/pct.
// ===========================================================================
describe("GET /api/v1/boq/reports/variance", () => {
  const PROJECT = "f84b0f07-ed67-522c-8ced-df72a883aaee";
  const db = (captured: Captured[] = []) =>
    stubJoinDb(
      [
        [evmSnapshots, [
          // done + UNDER budget (period_end far past): variance = 2.72M−2.8M = −80,000
          { projectId: PROJECT, period: "2026-01", periodEnd: "2020-01-31", budget: "2800000.00", ac: "2720000.00", pv: "0", ev: "0", bac: "0", currencyCode: "THB" },
          // done + OVER budget: variance = 2.98M−2.6M = +380,000
          { projectId: PROJECT, period: "2026-04", periodEnd: "2020-04-30", budget: "2600000.00", ac: "2980000.00", pv: "0", ev: "0", bac: "0", currencyCode: "THB" },
          // pending (period_end far future): variance/pct null, status pending, actual = ac (D3)
          { projectId: PROJECT, period: "2999-05", periodEnd: "2999-12-31", budget: "2700000.00", ac: "0", pv: "0", ev: "0", bac: "0", currencyCode: "THB" },
        ]],
      ],
      captured,
    );

  it("plan=budget, actual=ac; variance sign + pct_dev per mock; status from period_end vs now", async () => {
    const res = await get("/api/v1/boq/reports/variance", db());
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.rows).toEqual([
      // under budget → negative variance ; −80000/2800000×100 = −2.857 → −2.86
      { period_label: "2026-01", plan: 2800000, actual: 2720000, variance: -80000, pct_dev: -2.86, status: "done" },
      // over budget → positive variance ; 380000/2600000×100 = 14.615 → 14.62
      { period_label: "2026-04", plan: 2600000, actual: 2980000, variance: 380000, pct_dev: 14.62, status: "done" },
      // future/current period → pending; variance/pct null (mock "—"); actual = ac (D3)
      { period_label: "2999-05", plan: 2700000, actual: 0, variance: null, pct_dev: null, status: "pending" },
    ]);
    expect(b.currency_code).toBe("THB");
  });

  it("pct_dev null when plan (budget) is 0 on a done period — no ratio without a baseline (never ÷0)", async () => {
    const res = await get(
      "/api/v1/boq/reports/variance",
      stubJoinDb([[evmSnapshots, [
        { projectId: PROJECT, period: "2026-03", periodEnd: "2020-03-31", budget: "0", ac: "50000.00", pv: "0", ev: "0", bac: "0", currencyCode: "THB" },
      ]]]),
    );
    const b = res.json();
    expect(b.rows).toEqual([
      { period_label: "2026-03", plan: 0, actual: 50000, variance: 50000, pct_dev: null, status: "done" },
    ]);
  });

  it("honest-empty: no snapshots → empty rows", async () => {
    const res = await get(
      "/api/v1/boq/reports/variance",
      stubJoinDb([[evmSnapshots, []]]),
    );
    const b = res.json();
    expect(b.rows).toEqual([]);
    expect(b.currency_code).toBe("THB");
  });

  it("reads evm_snapshot THROUGH the projects hop with company bound (tenant scope)", async () => {
    const captured: Captured[] = [];
    await get("/api/v1/boq/reports/variance", db(captured));
    expectTenantScoped(captured);
    expect(captured.find((c) => c.table === evmSnapshots)?.joins.length).toBe(1);
  });

  it("boq_id → resolves the doc's OWNING project (scoped doc read), then filters the series by it", async () => {
    const captured: Captured[] = [];
    const BOQ = "aaaaaaaa-1111-2222-3333-444444444444";
    const RESOLVED = "b2b2b2b2-1111-2222-3333-444444444444";
    await get(
      `/api/v1/boq/reports/variance?boq_id=${BOQ}`,
      stubJoinDb([
        [boqDocs, [{ projectId: RESOLVED }]],
        [evmSnapshots, [
          { projectId: RESOLVED, period: "2026-01", periodEnd: "2020-01-31", budget: "1", ac: "1", pv: "0", ev: "0", bac: "0", currencyCode: "THB" },
        ]],
      ], captured),
    );
    const docRead = captured.find((c) => c.table === boqDocs);
    expect(docRead?.joins.length).toBe(1);
    expect(paramsOf(docRead?.where)).toEqual(expect.arrayContaining([COMPANY, BOQ]));
    const evmRead = captured.find((c) => c.table === evmSnapshots);
    expect(paramsOf(evmRead?.where)).toEqual(
      expect.arrayContaining([COMPANY, RESOLVED]),
    );
  });
});

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
import { boqGroups, boqItems, prItems } from "@juneflow/db";
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

// G3 unit tests (PLAN.md §9) — GET /cost-centers (P1-BE-07, master.jsx CC_SEED):
// the tenant's cost centers with their {id, code, name, project_id} wire shape,
// wrapped in the B-014 list envelope, fail-closed 401 without a tenant, and
// tenant-scoped THROUGH the project root (cost_center has no company_id — it is
// a parent-FK-scoped table read via selectThrough with an INNER JOIN onto
// project WHERE project.company_id = <tenant>, never a bare read → no leak).
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { costCenters, projects } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย วัฒนกุล" },
};

// --- join-capable capturing stub Db: records the table, its join hops, and the
// WHERE predicate for every selectThrough read (cost_center joins onto project).
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

// --- seed-shaped canned rows (cost_center schema / CC_SEED). The stub returns
// post-JOIN/WHERE rows, so these transcribe the schema columns the route reads.
const PROJECT_RJP = "pr-rjp-0000-0000-0000-000000000001";
const ccRow = (code: string, name: string) => ({
  id: `cc-${code}`,
  projectId: PROJECT_RJP,
  code,
  name,
  createdAt: new Date(),
  updatedAt: new Date(),
});
const seedCostCenters = [
  ccRow("CC-CONS-RJP-01", "โครงการ ราชพฤกษ์ เฟส 1"),
  ccRow("CC-CONS-RJP-02", "โครงการ ราชพฤกษ์ เฟส 2"),
  ccRow("CC-CONS-OH", "Overhead งานก่อสร้าง"),
  ccRow("CC-PROC", "ฝ่ายจัดซื้อ"),
];

describe("GET /api/v1/cost-centers — auth", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      url: "/api/v1/cost-centers",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Missing tenant context",
    });
  });
});

describe("GET /api/v1/cost-centers — cost centers in the B-014 list envelope", () => {
  it("wraps the cost centers with {id, code, name, project_id}", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubJoinDb([[costCenters, seedCostCenters]]),
      })
    ).inject({ url: "/api/v1/cost-centers" });

    expect(res.statusCode).toBe(200);
    // B-014: 4 rows returned as a single full page (page_size = max(4, 50) = 50).
    expect(res.json()).toEqual({
      data: [
        { id: "cc-CC-CONS-RJP-01", code: "CC-CONS-RJP-01", name: "โครงการ ราชพฤกษ์ เฟส 1", project_id: PROJECT_RJP },
        { id: "cc-CC-CONS-RJP-02", code: "CC-CONS-RJP-02", name: "โครงการ ราชพฤกษ์ เฟส 2", project_id: PROJECT_RJP },
        { id: "cc-CC-CONS-OH", code: "CC-CONS-OH", name: "Overhead งานก่อสร้าง", project_id: PROJECT_RJP },
        { id: "cc-CC-PROC", code: "CC-PROC", name: "ฝ่ายจัดซื้อ", project_id: PROJECT_RJP },
      ],
      page: 1,
      page_size: 50,
      total: 4,
    });
  });

  it("returns only the schema columns (no timestamp / extra columns leak)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubJoinDb([[costCenters, [seedCostCenters[0]]]]),
      })
    ).inject({ url: "/api/v1/cost-centers" });

    const row = res.json().data[0];
    expect(Object.keys(row).sort()).toEqual(["code", "id", "name", "project_id"]);
  });

  it("empty set still yields a valid one-page envelope (page_size >= 1)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubJoinDb([[costCenters, []]]),
      })
    ).inject({ url: "/api/v1/cost-centers" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [],
      page: 1,
      page_size: 50,
      total: 0,
    });
  });
});

describe("GET /api/v1/cost-centers — tenant scope (no leak)", () => {
  it("reads cost_center THROUGH a join on project, bound to company_id", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubJoinDb([[costCenters, seedCostCenters]], captured),
      })
    ).inject({ url: "/api/v1/cost-centers" });

    // exactly one read: cost_center, joined onto its project root (never bare).
    expect(captured).toHaveLength(1);
    const call = captured[0];
    expect(call.table).toBe(costCenters);
    expect(call.joins).toEqual([projects]); // → project (parent-FK scope hop)
    // the tenant predicate anchors on project.company_id = <this tenant>.
    expect(paramsOf(call.where)).toContain(COMPANY);
  });

  it("is tenant-bound: a different tenant's predicate carries ITS company_id", async () => {
    const other = {
      companyId: "99999999-9999-9999-9999-999999999999",
      user: { id: "au-9", email: "other@x.co.th", name: "อื่น" },
    };
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => other,
        db: stubJoinDb([[costCenters, seedCostCenters]], captured),
      })
    ).inject({ url: "/api/v1/cost-centers" });

    expect(captured).toHaveLength(1);
    expect(paramsOf(captured[0].where)).toContain(other.companyId);
    expect(paramsOf(captured[0].where)).not.toContain(COMPANY);
  });
});

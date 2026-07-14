// G3 unit tests (PLAN.md §9) — GET /project-types (P1-BE-06,
// docs/extract/PROJECT-TYPES.md): the 4 product project types with their
// {id, key, name, hierarchy, modules} wire shape, wrapped in the B-014 list
// envelope, fail-closed 401 without a tenant, and reference-only reads (the
// platform-global project_type table has no company_id — no tenant-owned table
// is ever touched, so there is no scope to leak).
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { companies, projectTypes, projects } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย วัฒนกุล" },
};

// --- capturing stub Db: per-table canned rows + which tables were read --------
function stubDb(
  rows: Array<[unknown, unknown[]]>,
  readTables: unknown[] = [],
): Db {
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  return {
    select: () => ({
      from: (table: unknown) => {
        const builder = {
          $dynamic: () => builder,
          innerJoin: () => builder,
          where: () => {
            readTables.push(table);
            return Promise.resolve(rowsFor(table));
          },
          then: (
            onOk: (rows: unknown[]) => unknown,
            onErr: (err: unknown) => unknown,
          ) => {
            // selectReference() reads with no where() — the builder itself is
            // awaited, so record the table here.
            readTables.push(table);
            return Promise.resolve(rowsFor(table)).then(onOk, onErr);
          },
        };
        return builder;
      },
    }),
  } as unknown as Db;
}

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

async function buildTestApp(
  overrides: Partial<AppDeps> = {},
): Promise<FastifyInstance> {
  app = await buildApp({
    db: overrides.db ?? stubDb([]),
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

// --- seed-shaped canned rows (project_type schema / PROJECT-TYPES.md) ---------
// hierarchy + modules are persisted as string[] (seed) — the route returns them
// verbatim; these fixtures transcribe them independently of the route mapping.
const realestateRow = {
  id: "pt-realestate",
  key: "realestate",
  name: "อสังหาริมทรัพย์",
  hierarchy: ["โครงการ", "เฟส", "บล็อก / อาคาร", "ยูนิต", "Model / แบบ"],
  modules: ["land", "boq", "proc", "subcon", "timeline", "inv", "petty", "pm", "sales_re", "aftersales", "lineoa"],
  createdAt: new Date(),
  updatedAt: new Date(),
};
const solarRow = {
  id: "pt-solar",
  key: "solar",
  name: "โซลาเซลล์ / พลังงาน (EPC)",
  hierarchy: ["ไซต์", "โซน / Array", "String", "Inverter"],
  modules: ["land", "boq", "proc", "subcon", "timeline", "inv", "petty", "pm", "om", "ppa", "roi", "permit", "warranty"],
  createdAt: new Date(),
  updatedAt: new Date(),
};
const civilRow = {
  id: "pt-civil",
  key: "civil",
  name: "ก่อสร้างทั่วไป / โยธา",
  hierarchy: ["โครงการ", "ส่วนงาน / โซน", "WBS"],
  modules: ["land", "boq", "proc", "subcon", "timeline", "inv", "petty", "pm"],
  createdAt: new Date(),
  updatedAt: new Date(),
};
const serviceRow = {
  id: "pt-service",
  key: "service",
  name: "โครงการบริการ / ทั่วไป",
  hierarchy: ["โครงการ", "เฟส", "งาน (WBS)"],
  modules: ["land", "proc", "timeline", "petty", "pm"],
  createdAt: new Date(),
  updatedAt: new Date(),
};
const allTypes = [realestateRow, solarRow, civilRow, serviceRow];

describe("GET /api/v1/project-types — auth", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      url: "/api/v1/project-types",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Missing tenant context",
    });
  });
});

describe("GET /api/v1/project-types — the 4 types in the B-014 list envelope", () => {
  it("wraps the project types with {id, key, name, hierarchy, modules}", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[projectTypes, allTypes]]),
      })
    ).inject({ url: "/api/v1/project-types" });

    expect(res.statusCode).toBe(200);
    // B-014: 4 rows returned as a single full page (page_size = max(4, 50) = 50).
    expect(res.json()).toEqual({
      data: [
        {
          id: "pt-realestate",
          key: "realestate",
          name: "อสังหาริมทรัพย์",
          hierarchy: ["โครงการ", "เฟส", "บล็อก / อาคาร", "ยูนิต", "Model / แบบ"],
          modules: ["land", "boq", "proc", "subcon", "timeline", "inv", "petty", "pm", "sales_re", "aftersales", "lineoa"],
        },
        {
          id: "pt-solar",
          key: "solar",
          name: "โซลาเซลล์ / พลังงาน (EPC)",
          hierarchy: ["ไซต์", "โซน / Array", "String", "Inverter"],
          modules: ["land", "boq", "proc", "subcon", "timeline", "inv", "petty", "pm", "om", "ppa", "roi", "permit", "warranty"],
        },
        {
          id: "pt-civil",
          key: "civil",
          name: "ก่อสร้างทั่วไป / โยธา",
          hierarchy: ["โครงการ", "ส่วนงาน / โซน", "WBS"],
          modules: ["land", "boq", "proc", "subcon", "timeline", "inv", "petty", "pm"],
        },
        {
          id: "pt-service",
          key: "service",
          name: "โครงการบริการ / ทั่วไป",
          hierarchy: ["โครงการ", "เฟส", "งาน (WBS)"],
          modules: ["land", "proc", "timeline", "petty", "pm"],
        },
      ],
      page: 1,
      page_size: 50,
      total: 4,
    });
  });

  it("returns hierarchy + modules verbatim (opaque pass-through, no reshape)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[projectTypes, [solarRow]]]),
      })
    ).inject({ url: "/api/v1/project-types" });

    const row = res.json().data[0];
    // modules stays a string[] of enabled nav ids (never coerced to a map/{}).
    expect(row.modules).toEqual(solarRow.modules);
    expect(row.hierarchy).toEqual(solarRow.hierarchy);
    // no timestamp / extra columns leak into the wire row.
    expect(Object.keys(row).sort()).toEqual(
      ["hierarchy", "id", "key", "modules", "name"],
    );
  });

  it("empty set still yields a valid one-page envelope (page_size >= 1)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[projectTypes, []]]),
      })
    ).inject({ url: "/api/v1/project-types" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [],
      page: 1,
      page_size: 50,
      total: 0,
    });
  });
});

describe("GET /api/v1/project-types — tenant scope (no leak)", () => {
  it("reads ONLY the project_type reference table (no tenant-owned table touched)", async () => {
    const readTables: unknown[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[projectTypes, allTypes]], readTables),
      })
    ).inject({ url: "/api/v1/project-types" });

    // The only table the handler reads is the platform-global reference table.
    // No company/project (tenant-owned) read happens — so nothing can leak.
    expect(readTables).toEqual([projectTypes]);
    expect(readTables).not.toContain(companies);
    expect(readTables).not.toContain(projects);
  });

  it("is tenant-independent: a different tenant sees the same 4 global types", async () => {
    const other = {
      companyId: "99999999-9999-9999-9999-999999999999",
      user: { id: "au-9", email: "other@x.co.th", name: "อื่น" },
    };
    const res = await (
      await buildTestApp({
        resolveTenant: async () => other,
        db: stubDb([[projectTypes, allTypes]]),
      })
    ).inject({ url: "/api/v1/project-types" });

    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(4);
    expect(res.json().data.map((r: { key: string }) => r.key)).toEqual([
      "realestate",
      "solar",
      "civil",
      "service",
    ]);
  });
});

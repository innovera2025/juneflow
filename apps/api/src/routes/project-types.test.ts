// G3 unit tests (PLAN.md §9) — GET/POST/PUT /project-types.
//
// GET (P1-BE-06): the 4 product project types with their {id, key, name,
// hierarchy, modules} wire shape, wrapped in the B-014 list envelope,
// fail-closed 401 without a tenant.
//
// TENANT SCOPE (P1-BE-14, B-065): project_type is now a HYBRID global/tenant
// table — GET reads global defaults (company_id IS NULL) + this tenant's own
// custom types (never another tenant's) via selectGlobalOrOwned(); POST creates
// a tenant-OWNED custom type (company_id force-set); PUT edits ONLY an own type
// and 404s on a global default / another tenant's type. The scoping SQL is
// proven in db/tenant-db.test.ts; these tests drive the handler logic
// (validation, dup-key 409, 404-on-default, wire shape, tenant-ownership).
import { afterEach, describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
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
  it("reads ONLY project_type (via the hybrid door — no other table touched)", async () => {
    const readTables: unknown[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[projectTypes, allTypes]], readTables),
      })
    ).inject({ url: "/api/v1/project-types" });

    // The only table the handler reads is project_type (through the hybrid
    // selectGlobalOrOwned door). No company/project read happens.
    expect(readTables).toEqual([projectTypes]);
    expect(readTables).not.toContain(companies);
    expect(readTables).not.toContain(projects);
  });

  it("shows the shared global defaults to any tenant (company_id IS NULL rows)", async () => {
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

// --- read-write stub: canned selectGlobalOrOwned rows + captured insert/update -
interface WriteSink {
  inserted?: Record<string, unknown>[];
  updateWhere?: SQL;
}
function rwStub(opts: {
  visible?: unknown[];
  updateRows?: unknown[];
  sink?: WriteSink;
} = {}): Db {
  const visible = opts.visible ?? [];
  const updateRows = opts.updateRows ?? [];
  const sink = opts.sink ?? {};
  let seq = 0;
  return {
    // selectGlobalOrOwned → select().from(table).where(hybridScope)
    select: () => ({
      from: () => ({ where: () => Promise.resolve(visible) }),
    }),
    // TenantDb.insert force-sets company_id; the route chains .returning()
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          sink.inserted = [values];
          return Promise.resolve([{ id: `pt-new-${seq++}`, ...values }]);
        },
      }),
    }),
    // TenantDb.update scopes WHERE company_id = tenant AND id = :id; .returning()
    update: () => ({
      set: () => ({
        where: (where: SQL) => ({
          returning: () => {
            sink.updateWhere = where;
            return Promise.resolve(updateRows);
          },
        }),
      }),
    }),
  } as unknown as Db;
}

function paramsOf(where: SQL | undefined): unknown[] {
  if (!where) return [];
  return new PgDialect().sqlToQuery(where).params;
}

describe("POST /api/v1/project-types — create a tenant-owned custom type", () => {
  it("401s without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/project-types",
      payload: { name: "คลังสินค้า", hierarchy: ["โครงการ", "โซน"] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates a custom type: 201, company_id force-set (tenant-owned), wire shape", async () => {
    const sink: WriteSink = {};
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rwStub({ visible: allTypes, sink }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/project-types",
      payload: {
        key: "custom_warehouse",
        name: "คลังสินค้า / โรงงาน",
        hierarchy: ["โครงการ", "โซน", "งาน"],
        // the mock submits `modules` as a {navId: boolean} map — truthy keys win.
        modules: { land: true, boq: false, proc: true, timeline: true },
      },
    });

    expect(res.statusCode).toBe(201);
    // Tenant ownership: the insert row carries THIS tenant's company_id.
    expect(sink.inserted?.[0]?.companyId).toBe(COMPANY);
    // Wire row is the opaque {id, key, name, hierarchy, modules} — no company_id.
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(["hierarchy", "id", "key", "modules", "name"]);
    expect(body.key).toBe("custom_warehouse");
    expect(body.name).toBe("คลังสินค้า / โรงงาน");
    expect(body.hierarchy).toEqual(["โครงการ", "โซน", "งาน"]);
    expect(body.modules).toEqual(["land", "proc", "timeline"]);
  });

  it("rejects a duplicate key against the tenant's visible set (409)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        // "realestate" is a visible global default — a custom type may not shadow it.
        db: rwStub({ visible: allTypes }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/project-types",
      payload: { key: "realestate", name: "ซ้ำ", hierarchy: ["a", "b"] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_KEY");
  });

  it("400s when name is missing", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rwStub({ visible: [] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/project-types",
      payload: { hierarchy: ["a", "b"] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
  });

  it("400s when hierarchy is empty", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rwStub({ visible: [] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/project-types",
      payload: { name: "ไม่มีลำดับชั้น" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
  });
});

describe("PUT /api/v1/project-types/:id — edit only an OWN custom type", () => {
  const OWN_ID = "pt-own-0000-0000-0000-000000000001";
  const ownUpdated = {
    id: OWN_ID,
    companyId: COMPANY,
    key: "custom_warehouse",
    name: "คลังสินค้า (แก้ไข)",
    hierarchy: ["โครงการ", "โซน"],
    modules: ["land", "proc"],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("401s without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "PUT",
      url: `/api/v1/project-types/${OWN_ID}`,
      payload: { name: "x", hierarchy: ["a"] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("updates an own type: 200, scoped by company_id, wire shape", async () => {
    const sink: WriteSink = {};
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rwStub({ updateRows: [ownUpdated], sink }),
      })
    ).inject({
      method: "PUT",
      url: `/api/v1/project-types/${OWN_ID}`,
      payload: { name: "คลังสินค้า (แก้ไข)", hierarchy: ["โครงการ", "โซน"], modules: ["land", "proc"] },
    });

    expect(res.statusCode).toBe(200);
    // The scoped update WHERE binds THIS tenant (company_id) + the id.
    expect(paramsOf(sink.updateWhere)).toContain(COMPANY);
    expect(paramsOf(sink.updateWhere)).toContain(OWN_ID);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(["hierarchy", "id", "key", "modules", "name"]);
    expect(body.name).toBe("คลังสินค้า (แก้ไข)");
  });

  it("404s on a global default / another tenant's type (scoped update matches 0 rows)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        // A global default (company_id NULL) is outside the tenant scope, so the
        // scoped update returns NO rows — the handler answers 404 (no-leak-safe).
        db: rwStub({ updateRows: [] }),
      })
    ).inject({
      method: "PUT",
      url: "/api/v1/project-types/pt-realestate",
      payload: { name: "hijack", hierarchy: ["a", "b"] },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("400s on invalid body (missing name)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rwStub({ updateRows: [] }),
      })
    ).inject({
      method: "PUT",
      url: `/api/v1/project-types/${OWN_ID}`,
      payload: { hierarchy: ["a"] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
  });
});

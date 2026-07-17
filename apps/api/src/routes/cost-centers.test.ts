// G3 unit tests (PLAN.md §9) — GET + POST /cost-centers (P1-BE-07 + P1-BE-11,
// B-059; master.jsx MasterCC/CCAddForm): the tenant's cost centers with the
// B-059 full wire shape {id, code, name, project_id, type, link, owner, budget,
// currency_code, status}, wrapped in the B-014 list envelope, fail-closed 401
// without a tenant, and tenant-scoped THROUGH the project root (cost_center has
// no company_id — reads join onto project WHERE project.company_id = <tenant>,
// writes go through insertThrough's verified parent, never bare → no leak).
// Create rules: the server owns status (a new cost center ALWAYS starts
// `draft`), CCAddForm defaults (type Project, link/owner "—", budget 0), the
// mock's comma-stripped numeric budget, and code uniqueness across the
// tenant's list (409).
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { costCenters, projects, users, roles } from "@juneflow/db";
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
// WHERE predicate for every read (cost_center reads join onto project; the
// insertThrough parent verify is a bare scoped select on project), plus every
// inserted row set.
interface Captured {
  table: unknown;
  joins: unknown[];
  where: SQL | undefined;
}
interface Inserted {
  table: unknown;
  values: Record<string, unknown>[];
}

function stubJoinDb(
  rows: Array<[unknown, unknown[]]>,
  captured: Captured[] = [],
  inserted: Inserted[] = [],
): Db {
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  let seq = 0;
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
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>[]) => ({
        returning: () => {
          inserted.push({ table, values });
          // Echo the inserted rows + a synthetic id + column defaults a real
          // INSERT ... RETURNING would fill (currency_code).
          return Promise.resolve(
            values.map((v) => ({ id: `new-${seq++}`, currencyCode: "THB", ...v })),
          );
        },
      }),
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

// --- seed-shaped canned rows (cost_center schema / CC_SEED — B-059 superset).
// The stub returns post-JOIN/WHERE rows, so these transcribe the schema columns
// the route reads (budget = the numeric column's 2-decimal string).
const PROJECT_RJP = "pr-rjp-0000-0000-0000-000000000001";
const PROJECT_ROW = { id: PROJECT_RJP, companyId: COMPANY, name: "ราชพฤกษ์" };

// B-084 (matrix GAP-8): creating a cost center is master-data administration,
// now gated on master.create (F1 consistency with /users + /roles). The
// caller's role carries it; the session email resolves to this scoped user.
const masterRole = {
  id: "role-admin", companyId: COMPANY, name: "Admin", approvalLimits: {},
  perms: { master: { view: true, create: true, edit: true, approve: true, cancel: true } },
  approvalLevel: 4, approvalLimit: null, currencyCode: "THB",
  createdAt: new Date(), updatedAt: new Date(),
};
const callerUser = {
  id: "u-caller", companyId: COMPANY, email: SESSION.user.email, name: "สมชาย",
  roleId: "role-admin", status: "active", department: null,
  createdAt: new Date(), updatedAt: new Date(),
};
const ccRow = (
  code: string,
  name: string,
  type: "Project" | "Overhead" | "Dept",
  link: string,
  owner: string,
  budget: string,
  status: "draft" | "approved",
) => ({
  id: `cc-${code}`,
  projectId: PROJECT_RJP,
  code,
  name,
  type,
  link,
  owner,
  budget,
  currencyCode: "THB",
  status,
  createdAt: new Date(),
  updatedAt: new Date(),
});
const seedCostCenters = [
  ccRow("CC-CONS-RJP-01", "โครงการ ราชพฤกษ์ เฟส 1", "Project", "เฟส 1 / Block A", "สมชาย", "84400000.00", "approved"),
  ccRow("CC-CONS-RJP-02", "โครงการ ราชพฤกษ์ เฟส 2", "Project", "เฟส 2 / Block B+C", "สมชาย", "124800000.00", "approved"),
  ccRow("CC-CONS-OH", "Overhead งานก่อสร้าง", "Overhead", "ฝ่ายก่อสร้าง · ทุกโครงการ", "ผอ.สมพร", "8400000.00", "approved"),
  ccRow("CC-PROC", "ฝ่ายจัดซื้อ", "Dept", "—", "ธีรพงษ์", "1200000.00", "approved"),
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

  it("401s flat on POST without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/cost-centers",
      payload: { code: "CC-X", name: "x", project_id: PROJECT_RJP },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Missing tenant context",
    });
  });
});

describe("GET /api/v1/cost-centers — cost centers in the B-014 list envelope", () => {
  it("wraps the cost centers with the B-059 full field set", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubJoinDb([[costCenters, seedCostCenters]]),
      })
    ).inject({ url: "/api/v1/cost-centers" });

    expect(res.statusCode).toBe(200);
    // B-014: 4 rows returned as a single full page (page_size = max(4, 50) = 50).
    // budget goes on the wire as a Number in FULL baht (like GET /projects).
    expect(res.json()).toEqual({
      data: [
        { id: "cc-CC-CONS-RJP-01", code: "CC-CONS-RJP-01", name: "โครงการ ราชพฤกษ์ เฟส 1", project_id: PROJECT_RJP, type: "Project", link: "เฟส 1 / Block A", owner: "สมชาย", budget: 84400000, currency_code: "THB", status: "approved" },
        { id: "cc-CC-CONS-RJP-02", code: "CC-CONS-RJP-02", name: "โครงการ ราชพฤกษ์ เฟส 2", project_id: PROJECT_RJP, type: "Project", link: "เฟส 2 / Block B+C", owner: "สมชาย", budget: 124800000, currency_code: "THB", status: "approved" },
        { id: "cc-CC-CONS-OH", code: "CC-CONS-OH", name: "Overhead งานก่อสร้าง", project_id: PROJECT_RJP, type: "Overhead", link: "ฝ่ายก่อสร้าง · ทุกโครงการ", owner: "ผอ.สมพร", budget: 8400000, currency_code: "THB", status: "approved" },
        { id: "cc-CC-PROC", code: "CC-PROC", name: "ฝ่ายจัดซื้อ", project_id: PROJECT_RJP, type: "Dept", link: "—", owner: "ธีรพงษ์", budget: 1200000, currency_code: "THB", status: "approved" },
      ],
      page: 1,
      page_size: 50,
      total: 4,
    });
  });

  it("returns only the wire fields (no timestamp / scope-column leak)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubJoinDb([[costCenters, [seedCostCenters[0]]]]),
      })
    ).inject({ url: "/api/v1/cost-centers" });

    const row = res.json().data[0];
    expect(Object.keys(row).sort()).toEqual([
      "budget", "code", "currency_code", "id", "link", "name", "owner", "project_id", "status", "type",
    ]);
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

describe("POST /api/v1/cost-centers — create is Add-only, server-owned draft status", () => {
  it("creates with status draft — the server ignores a client-sent status", async () => {
    const captured: Captured[] = [];
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubJoinDb(
          [[costCenters, seedCostCenters], [projects, [PROJECT_ROW]], [users, [callerUser]], [roles, [masterRole]]],
          captured,
          inserted,
        ),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/cost-centers",
      payload: {
        code: "CC-CONS-RJP-04",
        name: "โครงการ ราชพฤกษ์ เฟส 4",
        type: "Project",
        link: "เฟส 4 / Block E",
        owner: "สมชาย",
        budget: "5,000,000", // mock input keeps thousands commas
        project_id: PROJECT_RJP,
        status: "approved", // must be ignored — creation ALWAYS lands draft
      },
    });

    expect(res.statusCode).toBe(201);
    // server-owned fields on the INSERT: status draft (B-059 — no approval
    // flow), budget = comma-stripped FULL baht as the numeric 2-decimal string.
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.table).toBe(costCenters);
    const values = inserted[0]!.values[0]!;
    expect(values.status).toBe("draft");
    expect(values.budget).toBe("5000000.00");
    expect(values.projectId).toBe(PROJECT_RJP);
    // insertThrough verified the parent project ownership before writing:
    // a scoped read on project carrying BOTH the project id and the tenant.
    const parentVerify = captured.filter(
      (c) => c.table === projects && paramsOf(c.where).includes(PROJECT_RJP),
    );
    expect(parentVerify.length).toBeGreaterThan(0);
    for (const call of parentVerify) {
      expect(paramsOf(call.where)).toContain(COMPANY);
    }
    // response echoes the created row in the B-059 full wire shape.
    expect(res.json()).toMatchObject({
      code: "CC-CONS-RJP-04",
      name: "โครงการ ราชพฤกษ์ เฟส 4",
      project_id: PROJECT_RJP,
      type: "Project",
      link: "เฟส 4 / Block E",
      owner: "สมชาย",
      budget: 5000000,
      currency_code: "THB",
      status: "draft",
    });
  });

  it("applies the CCAddForm defaults: type Project, link/owner —, budget 0", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubJoinDb(
          [[costCenters, []], [projects, [PROJECT_ROW]], [users, [callerUser]], [roles, [masterRole]]],
          [],
          inserted,
        ),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/cost-centers",
      payload: { code: "CC-NEW", name: "ศูนย์ใหม่", project_id: PROJECT_RJP },
    });

    expect(res.statusCode).toBe(201);
    const values = inserted[0]!.values[0]!;
    expect(values).toMatchObject({
      type: "Project",
      link: "—",
      owner: "—",
      budget: "0.00",
      status: "draft",
    });
  });

  it("409s a duplicate code (checked across the tenant's full list, like the mock)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubJoinDb([[costCenters, seedCostCenters], [projects, [PROJECT_ROW]], [users, [callerUser]], [roles, [masterRole]]]),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/cost-centers",
      payload: { code: "CC-CONS-RJP-01", name: "ซ้ำ", project_id: PROJECT_RJP },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_CODE");
  });

  it("400s on missing code (or the untouched CC- prefill) / name / project_id / bad type / bad budget", async () => {
    const build = async () =>
      buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubJoinDb([[costCenters, []], [projects, [PROJECT_ROW]], [users, [callerUser]], [roles, [masterRole]]]),
      });

    const noCode = await (await build()).inject({ method: "POST", url: "/api/v1/cost-centers", payload: { code: "CC-", name: "x", project_id: PROJECT_RJP } });
    expect(noCode.statusCode).toBe(400);
    await app.close();

    const noName = await (await build()).inject({ method: "POST", url: "/api/v1/cost-centers", payload: { code: "CC-X", project_id: PROJECT_RJP } });
    expect(noName.statusCode).toBe(400);
    await app.close();

    const noProject = await (await build()).inject({ method: "POST", url: "/api/v1/cost-centers", payload: { code: "CC-X", name: "x" } });
    expect(noProject.statusCode).toBe(400);
    await app.close();

    const badType = await (await build()).inject({ method: "POST", url: "/api/v1/cost-centers", payload: { code: "CC-X", name: "x", type: "Workflow", project_id: PROJECT_RJP } });
    expect(badType.statusCode).toBe(400);
    await app.close();

    const badBudget = await (await build()).inject({ method: "POST", url: "/api/v1/cost-centers", payload: { code: "CC-X", name: "x", budget: "ไม่ใช่เลข", project_id: PROJECT_RJP } });
    expect(badBudget.statusCode).toBe(400);
  });

  it("rejects a project outside the tenant (scoped read finds nothing — no leak)", async () => {
    const captured: Captured[] = [];
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        // No project row canned → the scoped project read resolves nothing,
        // exactly what a foreign tenant's project id looks like through the
        // scoped door.
        db: stubJoinDb([[costCenters, seedCostCenters], [users, [callerUser]], [roles, [masterRole]]], captured, inserted),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/cost-centers",
      payload: {
        code: "CC-EVIL",
        name: "ข้ามเขต",
        project_id: "pr-foreign-0000-0000-000000000009",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: "VALIDATION", message: "project not found" });
    // nothing was written.
    expect(inserted).toHaveLength(0);
    // the project lookup was tenant-scoped (carried company_id = <this tenant>).
    const projectRead = captured.find((c) => c.table === projects);
    expect(projectRead).toBeTruthy();
    expect(paramsOf(projectRead!.where)).toContain(COMPANY);
    expect(paramsOf(projectRead!.where)).toContain("pr-foreign-0000-0000-000000000009");
  });

  it("403s a caller whose role lacks master.create (B-084 GAP-8 F1 consistency)", async () => {
    const lowRole = { ...masterRole, id: "role-low", perms: { boq: { view: true, create: true, edit: false, approve: false, cancel: false } } };
    const lowUser = { ...callerUser, roleId: "role-low" };
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubJoinDb(
          [[costCenters, seedCostCenters], [projects, [PROJECT_ROW]], [users, [lowUser]], [roles, [lowRole]]],
          [],
          inserted,
        ),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/cost-centers",
      payload: { code: "CC-NEW", name: "ศูนย์ใหม่", project_id: PROJECT_RJP },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    // fail-closed: nothing was written.
    expect(inserted).toHaveLength(0);
  });
});

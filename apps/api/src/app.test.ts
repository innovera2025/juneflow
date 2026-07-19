// G3 unit tests (PLAN.md §9) — P1-BE-01 app assembly: contract routes under
// /api/v1, auth guard (401 flat), GET /me + GET /projects response shapes from
// seed-shaped rows, POST /auth/login contract behavior, flat {code,message}
// not-found + error handlers, and tenant scope on every tenant-table query
// (asserted on the captured WHERE SQL — the company_id param must be bound).
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  aiUsage,
  companies,
  packages,
  projectNodes,
  projects,
  projectTypes,
  roles,
  salesUnits,
  subscriptions,
  users,
} from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "./app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "./plugins/quota.js";
import { createFakeR2Storage } from "./routes/files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย วัฒนกุล" },
};

// --- seed-shaped canned rows (values mirror the central seed for T-1001) ----
const userRow = {
  id: "u-0",
  companyId: COMPANY,
  email: "somchai@rungrueang.co.th",
  name: "สมชาย วัฒนกุล",
  roleId: "r-pm",
  status: "active",
};
const roleRow = {
  id: "r-pm",
  companyId: COMPANY,
  name: "Project Manager",
  approvalLimits: { default: 1_000_000 },
  perms: { dashboard: { view: true } },
};
const subRow = {
  id: "s-0",
  companyId: COMPANY,
  packageId: "pkg-m",
  cycle: "yearly",
  status: "active",
};
const pkgRow = {
  id: "pkg-m",
  size: "M",
  name: "Professional",
  limits: { projects: 10, users: 25, storage_gb: 100, ai_per_month: 50 },
  menus: ["boq", "proc", "petty"],
  subRules: { "boq.aiqto": "M" },
};
const companyRow = {
  id: COMPANY,
  name: "บจก. รุ่งเรืองก่อสร้าง",
  taxId: null,
  address: null,
  short: null,
  color: null,
  docPrefix: null,
  biz: null,
  status: "active",
};
const projectRow = {
  id: "pj-rjp",
  companyId: COMPANY,
  typeId: "pt-re",
  name: "juneflow พาร์ค ราชพฤกษ์",
  short: "RJP",
  color: "#0B2A4A",
  budget: "50000000.00",
  currencyCode: "THB",
  status: "active",
};
const typeRow = { id: "pt-re", key: "realestate", name: "อสังหาริมทรัพย์" };
// project_node tree (B-041(ก+)): phase → block → 3 units (units hang under an
// intermediate block node, mirroring the central seed's B-009 layout).
const nodeRows = [
  { id: "n-p1", projectId: "pj-rjp", parentId: null, kind: "phase", name: "เฟส 2 · Block B+C (ทาวน์โฮม)", saleStatus: null },
  { id: "n-b", projectId: "pj-rjp", parentId: "n-p1", kind: "block", name: "Block B", saleStatus: null },
  { id: "n-u1", projectId: "pj-rjp", parentId: "n-b", kind: "unit", name: "B-01", saleStatus: "sold" },
  { id: "n-u2", projectId: "pj-rjp", parentId: "n-b", kind: "unit", name: "B-02", saleStatus: "soldBuilt" },
  { id: "n-u3", projectId: "pj-rjp", parentId: "n-b", kind: "unit", name: "B-03", saleStatus: "booked" },
];
const salesUnitRows = [
  { id: "su-1", companyId: COMPANY, unitId: "n-u1", stage: "sold" },
  { id: "su-2", companyId: COMPANY, unitId: "n-u2", stage: "soldBuilt" },
  { id: "su-3", companyId: COMPANY, unitId: "n-u3", stage: "booked" },
];

// --- stub Db: canned rows per table + captured (table, where) pairs ---------
interface Captured {
  table: unknown;
  where: SQL | undefined;
}

function stubDb(
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
        const builder = {
          // selectThrough joins (P1-BE-02): the stub answers the child
          // table's canned rows regardless of join chain.
          $dynamic: () => builder,
          innerJoin: () => builder,
          where: (where: SQL) => {
            captured.push({ table, where });
            return Promise.resolve(rowsFor(table));
          },
          // selectReference without a predicate awaits the builder directly.
          then: (
            onOk: (rows: unknown[]) => unknown,
            onErr: (err: unknown) => unknown,
          ) => {
            captured.push({ table, where: undefined });
            return Promise.resolve(rowsFor(table)).then(onOk, onErr);
          },
        };
        return builder;
      },
    }),
  } as unknown as Db;
}

/** Bound params of a captured WHERE (drizzle serialization, no DB). */
function paramsOf(where: SQL | undefined): unknown[] {
  if (!where) return [];
  return new PgDialect().sqlToQuery(where).params;
}

function capturedFor(captured: Captured[], table: unknown): Captured[] {
  return captured.filter((c) => c.table === table);
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

const fullDb = (captured: Captured[] = []) =>
  stubDb(
    [
      [users, [userRow]],
      [roles, [roleRow]],
      [subscriptions, [subRow]],
      [packages, [pkgRow]],
      [companies, [companyRow]],
      [aiUsage, [{ month: "2026-07", used: 3 }, { month: "2026-07", used: 4 }]],
      [projects, [projectRow]],
      [projectTypes, [typeRow]],
      [projectNodes, nodeRows],
      [salesUnits, salesUnitRows],
    ],
    captured,
  );

describe("public surface", () => {
  it("serves /health without auth (compose healthcheck probe)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe("auth guard — every /api/v1 resource 401s flat without a session", () => {
  it.each(["/api/v1/me", "/api/v1/projects"])(
    "GET %s → 401 flat contract Error",
    async (url) => {
      const res = await (await buildTestApp()).inject({ url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    },
  );
});

describe("flat error envelopes (audit debts 1+2)", () => {
  it("unknown route with a session → 404 flat NOT_FOUND", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION })
    ).inject({ url: "/api/v1/does-not-exist" });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(typeof body.message).toBe("string");
    expect(Object.keys(body).sort()).toEqual(["code", "message"]);
  });

  it("a crashing resolver → 500 flat INTERNAL_ERROR without leaking details", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => {
          throw new Error("secret internal detail");
        },
      })
    ).inject({ url: "/api/v1/me" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  });
});

describe("GET /api/v1/me", () => {
  it("answers the Me shape from seed-backed rows", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: fullDb(),
      })
    ).inject({ url: "/api/v1/me" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      user: {
        id: "u-0",
        email: "somchai@rungrueang.co.th",
        name: "สมชาย วัฒนกุล",
        role_id: "r-pm",
        status: "active",
      },
      role: {
        id: "r-pm",
        name: "Project Manager",
        perms: { dashboard: { view: true } },
      },
      approval_limits: { default: 1_000_000 },
      package: {
        id: "pkg-m",
        size: "M",
        name: "Professional",
        menus: ["boq", "proc", "petty"],
        limits: { projects: 10, users: 25, storage_gb: 100, ai_per_month: 50 },
        sub_rules: { "boq.aiqto": "M" },
        ai_used: 7,
      },
    });
  });

  it("binds company_id on EVERY tenant-table query it makes", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: fullDb(captured),
      })
    ).inject({ url: "/api/v1/me" });

    // users, roles, subscriptions, ai_usage are tenant-owned: each captured
    // WHERE must carry the tenant as a bound param (TenantDb injects it).
    for (const table of [users, roles, subscriptions, aiUsage]) {
      const calls = capturedFor(captured, table);
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(paramsOf(call.where)).toContain(COMPANY);
      }
    }
    // packages is a platform-global reference table — resolved by the
    // tenant's own package_id, never enumerated by company (it has none).
    const pkgCalls = capturedFor(captured, packages);
    expect(pkgCalls.length).toBe(1);
    expect(paramsOf(pkgCalls[0]?.where)).toEqual(["pkg-m"]);
  });

  it("fails closed 401 when the session user has no dictionary row", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[users, []]]),
      })
    ).inject({ url: "/api/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "No user record for this session in the tenant",
    });
  });
});

describe("GET /api/v1/projects", () => {
  it("answers the Project rows (B-014 envelope) with the project_type KEY", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: fullDb(),
      })
    ).inject({ url: "/api/v1/projects" });

    expect(res.statusCode).toBe(200);
    // B-014: the list is wrapped in the paginated envelope. One row is returned
    // as a single full page (page_size = max(rows, DEFAULT_PAGE_SIZE) = 50).
    expect(res.json()).toEqual({
      data: [
        {
          id: "pj-rjp",
          name: "juneflow พาร์ค ราชพฤกษ์",
          type: "realestate",
          budget: 50_000_000,
          currency_code: "THB",
          status: "active",
          // B-041(ก+) ProjectSwitcher extensions
          short: "RJP",
          color: "#0B2A4A",
          company_id: COMPANY,
          units: 3,
          phases: [
            {
              id: "n-p1",
              name: "เฟส 2 · Block B+C (ทาวน์โฮม)",
              // 3 unit descendants THROUGH the block node; 2 of 3 sales units
              // are sold/soldBuilt → round(100 × 2/3) = 67.
              units: 3,
              sold_pct: 67,
              sale_status: null,
            },
          ],
        },
      ],
      page: 1,
      page_size: 50,
      total: 1,
    });
  });

  it("scopes the project, node and sales-unit queries by company_id", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: fullDb(captured),
      })
    ).inject({ url: "/api/v1/projects" });

    const projectCalls = capturedFor(captured, projects);
    expect(projectCalls.length).toBe(1);
    expect(paramsOf(projectCalls[0]?.where)).toContain(COMPANY);
    // project_node has no company_id — scoped THROUGH project (selectThrough).
    const nodeCalls = capturedFor(captured, projectNodes);
    expect(nodeCalls.length).toBe(1);
    expect(paramsOf(nodeCalls[0]?.where)).toContain(COMPANY);
    // sales_unit is company-scoped directly.
    const saleCalls = capturedFor(captured, salesUnits);
    expect(saleCalls.length).toBe(1);
    expect(paramsOf(saleCalls[0]?.where)).toContain(COMPANY);
    // project_type is a hybrid table (B-065): read once through the
    // selectGlobalOrOwned door (global defaults + this tenant's own types).
    expect(capturedFor(captured, projectTypes).length).toBe(1);
  });
});

describe("POST /api/v1/auth/login", () => {
  const signedIn = {
    token: "tok-1",
    companyId: COMPANY,
    user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย วัฒนกุล" },
  };

  it("answers AuthLoginResult {token,user,company,package} on success", async () => {
    const res = await (
      await buildTestApp({ signIn: async () => signedIn, db: fullDb() })
    ).inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: "somchai@rungrueang.co.th", password: "pw" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBe("tok-1");
    expect(body.user).toEqual({
      id: "u-0",
      email: "somchai@rungrueang.co.th",
      name: "สมชาย วัฒนกุล",
      role_id: "r-pm",
      status: "active",
    });
    expect(body.company).toMatchObject({
      id: COMPANY,
      name: "บจก. รุ่งเรืองก่อสร้าง",
    });
    expect(body.package).toMatchObject({ id: "pkg-m", ai_used: 7 });
  });

  it("rejects bad credentials with 401 flat INVALID_CREDENTIALS", async () => {
    const res = await (
      await buildTestApp({ signIn: async () => null })
    ).inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: "nobody@example.test", password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
    });
  });

  it("rejects missing fields with 401 without calling the signIn seam", async () => {
    let called = false;
    const res = await (
      await buildTestApp({
        signIn: async () => {
          called = true;
          return null;
        },
      })
    ).inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: "somchai@rungrueang.co.th" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("INVALID_CREDENTIALS");
    expect(called).toBe(false);
  });

  it("fails closed when the account has no tenant binding", async () => {
    const res = await (
      await buildTestApp({
        signIn: async () => ({ ...signedIn, companyId: null }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: "somchai@rungrueang.co.th", password: "pw" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Account has no tenant binding",
    });
  });
});

describe("POST /api/v1/auth/login — brute-force throttle (B-082 F4 · B-099)", () => {
  it("429s after too many attempts against ONE account (per-user cap) with the flat RATE_LIMITED error", async () => {
    const built = await buildTestApp({ signIn: async () => null });
    let last;
    // 11 attempts against the SAME account trip the per-user cap (10) on the 11th.
    for (let i = 0; i < 11; i++) {
      last = await built.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: "spray@example.test", password: "guess" },
      });
    }
    expect(last!.statusCode).toBe(429);
    expect(last!.json()).toEqual({
      code: "RATE_LIMITED",
      message: "Too many login attempts, please try again later",
    });
    expect(last!.headers["retry-after"]).toBe("60");
  });

  it("B-099: distinct accounts behind one office IP are NOT blocked by the per-user cap", async () => {
    // The motivating regression (orch-B finance-E2E): several approvers share one
    // office NAT egress IP and each logs in a few times. The primary cap keys on the
    // ACCOUNT, so 11 DISTINCT accounts from one IP each stay at 1 attempt — none is
    // throttled (they get 401 bad-creds), where the old per-IP-10 throttle blocked them.
    const built = await buildTestApp({ signIn: async () => null });
    let last;
    for (let i = 0; i < 11; i++) {
      last = await built.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: `approver${i}@rungrueang.co.th`, password: "pw" },
      });
    }
    expect(last!.statusCode).toBe(401); // not throttled — the office is not the attacker
    expect(last!.json().code).toBe("INVALID_CREDENTIALS");
  });

  it("B-099: a broad spray of distinct accounts from one IP still trips the coarse per-IP backstop", async () => {
    // Each distinct account stays under the per-user cap, but the per-IP backstop
    // (50) still counts every attempt from the source and cuts off a 51-wide spray.
    const built = await buildTestApp({ signIn: async () => null });
    let last;
    for (let i = 0; i < 51; i++) {
      last = await built.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: `spray${i}@example.test`, password: "guess" },
      });
    }
    expect(last!.statusCode).toBe(429); // per-IP coarse guard holds
    expect(last!.json().code).toBe("RATE_LIMITED");
  });
});

describe("contract prefix /api/v1 (audit debt 1)", () => {
  it("mounts POST /files under /api/v1", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION })
    ).inject({ method: "POST", url: "/api/v1/files?link_module=boq:1" });
    expect(res.statusCode).toBe(201);
    expect(res.json().file_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

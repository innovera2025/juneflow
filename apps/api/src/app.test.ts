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
  projects,
  projectTypes,
  roles,
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
  budget: "50000000.00",
  currencyCode: "THB",
  status: "active",
};
const typeRow = { id: "pt-re", key: "realestate", name: "อสังหาริมทรัพย์" };

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
      from: (table: unknown) => ({
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
      }),
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
  it("answers the bare Project array with the project_type KEY", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: fullDb(),
      })
    ).inject({ url: "/api/v1/projects" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: "pj-rjp",
        name: "juneflow พาร์ค ราชพฤกษ์",
        type: "realestate",
        budget: 50_000_000,
        currency_code: "THB",
        status: "active",
      },
    ]);
  });

  it("scopes the project query by company_id", async () => {
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
    // project_type is a global reference read (no company_id column exists).
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

describe("contract prefix /api/v1 (audit debt 1)", () => {
  it("mounts POST /files under /api/v1", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION })
    ).inject({ method: "POST", url: "/api/v1/files?link_module=boq:1" });
    expect(res.statusCode).toBe(201);
    expect(res.json().file_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

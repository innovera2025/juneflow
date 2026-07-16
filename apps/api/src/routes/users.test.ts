// G3 unit tests (PLAN.md §9) — GET + POST /users (P1-BE-09, B-051; master.jsx
// UsersPermissions/UserAddForm). Covers the B-014 envelope + wire shape with the
// username DERIVED from email, tenant scope (no leak), the invite create
// (status starts `invited`, department normalized, duplicate email 409, canSave
// validation), and the B-082 F1 function-level authorization guard.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { users, roles } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย วัฒนกุล" },
};

interface Captured {
  table: unknown;
  where: SQL | undefined;
}
interface Inserted {
  table: unknown;
  values: Record<string, unknown>;
}

// Realistic stub: rows keyed by table, filtered by the captured WHERE. The
// company_id predicate is always present; a non-company param (id/email/role_id)
// narrows the result, so the authz caller row can coexist with the target rows
// (F1 needs both) and the duplicate-email pre-check stays exact.
function stubDb(
  rows: Array<[unknown, unknown[]]>,
  companyId: string,
  captured: Captured[] = [],
  inserted: Inserted[] = [],
): Db {
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  const selectFrom = (table: unknown, where: SQL | undefined): unknown[] => {
    const all = rowsFor(table);
    if (!where) return all;
    const selectors = paramsOf(where).filter((p) => p !== companyId);
    if (selectors.length === 0) return all;
    return all.filter((r) => {
      const row = r as Record<string, unknown>;
      return selectors.some(
        (v) => v === row.id || v === row.email || v === row.roleId,
      );
    });
  };
  const builderFor = (table: unknown) => {
    const builder = {
      $dynamic: () => builder,
      innerJoin: () => builder,
      where: (where: SQL) => {
        captured.push({ table, where });
        return Promise.resolve(selectFrom(table, where));
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) => {
        captured.push({ table, where: undefined });
        return Promise.resolve(selectFrom(table, undefined)).then(onOk, onErr);
      },
    };
    return builder;
  };
  let seq = 0;
  return {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          inserted.push({ table, values });
          return Promise.resolve([{ id: `new-${seq++}`, ...values }]);
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

async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<FastifyInstance> {
  app = await buildApp({
    db: overrides.db ?? stubDb([], COMPANY),
    resolveTenant: overrides.resolveTenant ?? (async () => null),
    signIn: overrides.signIn ?? (async () => null),
    storage: overrides.storage ?? createFakeR2Storage("https://r2.test"),
    quota: overrides.quota ?? new QuotaGuard({ resolver: unlimitedQuotaResolver, upgradeUrl: "https://upgrade.test" }),
    auditSink: overrides.auditSink ?? (async () => {}),
    logger: false,
  });
  return app;
}

const userRow = (id: string, email: string, name: string, status: string, dept: string | null) => ({
  id, companyId: COMPANY, email, name, roleId: "role-pm", status, department: dept,
  createdAt: new Date(), updatedAt: new Date(),
});
// The session caller's role carries master.create so it may administer users
// (F1). No users.test assertion inspects perms, so this is free to widen.
const roleRow = { id: "role-pm", companyId: COMPANY, name: "Project Manager", approvalLimits: {}, perms: { master: { view: true, create: true, edit: true, approve: true, cancel: true } }, approvalLevel: 3, approvalLimit: "1000000.00", currencyCode: "THB", createdAt: new Date(), updatedAt: new Date() };
// The resolved caller (by session email) — an admin who may invite users.
const caller = { id: "u-caller", companyId: COMPANY, email: SESSION.user.email, name: "สมชาย", roleId: "role-pm", status: "active", department: null, createdAt: new Date(), updatedAt: new Date() };

describe("GET /api/v1/users — auth", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/users" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });
});

describe("GET /api/v1/users — envelope + username derived from email", () => {
  it("wraps users with {id, name, email, username, role_id, status, department}", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[users, [userRow("u1", "somchai@rungrueang.co.th", "สมชาย", "active", "CONS")]]], COMPANY),
      })
    ).inject({ url: "/api/v1/users" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [{
        id: "u1",
        name: "สมชาย",
        email: "somchai@rungrueang.co.th",
        username: "somchai", // derived from the email local part
        role_id: "role-pm",
        status: "active",
        department: "CONS",
      }],
      page: 1,
      page_size: 50,
      total: 1,
    });
  });
});

describe("GET /api/v1/users — tenant scope (no leak)", () => {
  it("reads users bound to company_id = <this tenant>", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[users, []]], COMPANY, captured),
      })
    ).inject({ url: "/api/v1/users" });
    const call = captured.find((c) => c.table === users)!;
    expect(paramsOf(call.where)).toContain(COMPANY);
  });
});

describe("POST /api/v1/users — email invite", () => {
  it("invites: status starts invited, department normalized, 201", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[roles, [roleRow]], [users, [caller]]], COMPANY, [], inserted),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/users",
      payload: { first: "นภา", last: "ศรีสุข", email: "napha@juneflow.co.th", role_id: "role-pm", department: "PROC — ฝ่ายจัดซื้อ" },
    });

    expect(res.statusCode).toBe(201);
    const values = inserted[0]!.values;
    expect(values.status).toBe("invited");
    expect(values.name).toBe("นภา ศรีสุข");
    expect(values.department).toBe("PROC"); // leading code extracted from the label
    expect(values.email).toBe("napha@juneflow.co.th");
    expect(res.json()).toMatchObject({
      email: "napha@juneflow.co.th",
      username: "napha",
      status: "invited",
      department: "PROC",
    });
  });

  it("409s a duplicate email in the same company", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[roles, [roleRow]], [users, [caller, userRow("u1", "napha@juneflow.co.th", "x", "active", null)]]], COMPANY),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/users",
      payload: { name: "นภา ศรีสุข", email: "napha@juneflow.co.th", role_id: "role-pm" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_EMAIL");
  });

  it("400s a bad email / missing name / missing role / invalid role", async () => {
    const build = async (rows: Array<[unknown, unknown[]]>) =>
      buildTestApp({ resolveTenant: async () => SESSION, db: stubDb(rows, COMPANY) });

    const badEmail = await (await build([[roles, [roleRow]], [users, [caller]]])).inject({ method: "POST", url: "/api/v1/users", payload: { name: "A B", email: "no-at", role_id: "role-pm" } });
    expect(badEmail.statusCode).toBe(400);
    await app.close();

    const noName = await (await build([[roles, [roleRow]], [users, [caller]]])).inject({ method: "POST", url: "/api/v1/users", payload: { email: "a@b.co", role_id: "role-pm" } });
    expect(noName.statusCode).toBe(400);
    await app.close();

    const noRole = await (await build([[roles, [roleRow]], [users, [caller]]])).inject({ method: "POST", url: "/api/v1/users", payload: { name: "A B", email: "a@b.co" } });
    expect(noRole.statusCode).toBe(400);
    await app.close();

    // role_id present but not a role of this tenant (scoped select → empty).
    const badRole = await (await build([[roles, [roleRow]], [users, [caller]]])).inject({ method: "POST", url: "/api/v1/users", payload: { name: "A B", email: "a@b.co", role_id: "ghost" } });
    expect(badRole.statusCode).toBe(400);
  });
});

// --- B-082 F1: only a caller with master.create may invite/create users ------
describe("POST /api/v1/users — F1 authorization", () => {
  it("403s a caller whose role lacks master.create (no backdoor-admin creation)", async () => {
    const lowRole = { ...roleRow, id: "role-low", perms: { pr: { view: true, create: true, edit: false, approve: false, cancel: false } } };
    const lowUser = { ...caller, id: "u-low", roleId: "role-low" };
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[roles, [lowRole]], [users, [lowUser]]], COMPANY),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/users",
      payload: { name: "New Admin", email: "new@x.co.th", role_id: "role-low" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });
});

// G3 unit tests (PLAN.md §9) — GET + POST /roles + PUT /roles/:id (P1-BE-09,
// B-051; master.jsx UsersPermissions/RoleAddForm). Covers the B-014 envelope,
// the perms matrix re-projection (stored module→flags map → the mock's 11×5
// number[][]), the DERIVED user_count (C10), tenant scope on every read/write
// (no leak), create (201, approval_limit as real money), update (200), and 404.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { roles, users } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const OTHER = "99999999-9999-9999-9999-999999999999";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย วัฒนกุล" },
};

interface Captured {
  table: unknown;
  where: SQL | undefined;
}
interface Mutated {
  table: unknown;
  values: Record<string, unknown>;
  kind: "insert" | "update";
}

function stubDb(
  rows: Array<[unknown, unknown[]]>,
  captured: Captured[] = [],
  mutated: Mutated[] = [],
): Db {
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  const builderFor = (table: unknown) => {
    const builder = {
      $dynamic: () => builder,
      innerJoin: () => builder,
      where: (where: SQL) => {
        captured.push({ table, where });
        return Promise.resolve(rowsFor(table));
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) =>
        Promise.resolve(rowsFor(table)).then(onOk, onErr),
    };
    return builder;
  };
  let seq = 0;
  return {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          mutated.push({ table, values, kind: "insert" });
          return Promise.resolve([{ id: `new-${seq++}`, currencyCode: "THB", approvalLimits: {}, ...values }]);
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: () => {
            captured.push({ table, where });
            mutated.push({ table, values, kind: "update" });
            const base = rowsFor(table)[0] as Record<string, unknown> | undefined;
            return Promise.resolve(base ? [{ ...base, ...values }] : []);
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

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<FastifyInstance> {
  app = await buildApp({
    db: overrides.db ?? stubDb([]),
    resolveTenant: overrides.resolveTenant ?? (async () => null),
    signIn: overrides.signIn ?? (async () => null),
    storage: overrides.storage ?? createFakeR2Storage("https://r2.test"),
    quota: overrides.quota ?? new QuotaGuard({ resolver: unlimitedQuotaResolver, upgradeUrl: "https://upgrade.test" }),
    auditSink: overrides.auditSink ?? (async () => {}),
    logger: false,
  });
  return app;
}

// canned role: dashboard view-only, boq view+create+edit; the other 9 modules
// have no flags → matrix rows of zeros.
const roleRow = {
  id: "role-pm",
  companyId: COMPANY,
  name: "Project Manager",
  approvalLimits: { default: 1000000 },
  perms: {
    dashboard: { view: true, create: false, edit: false, approve: false, cancel: false },
    boq: { view: true, create: true, edit: true, approve: false, cancel: false },
  },
  approvalLevel: 3,
  approvalLimit: "1000000.00",
  currencyCode: "THB",
  createdAt: new Date(),
  updatedAt: new Date(),
};
const userRow = (id: string, roleId: string | null) => ({
  id, companyId: COMPANY, email: `${id}@x.co.th`, name: id, roleId,
  status: "active", department: null, createdAt: new Date(), updatedAt: new Date(),
});

describe("GET /api/v1/roles — auth", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/roles" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });
});

describe("GET /api/v1/roles — envelope, perms matrix, derived user_count", () => {
  it("re-projects the perms map to the 11×5 matrix and derives user_count", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([
          [roles, [roleRow]],
          [users, [userRow("u1", "role-pm"), userRow("u2", "role-pm"), userRow("u3", null)]],
        ]),
      })
    ).inject({ url: "/api/v1/roles" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data[0]).toEqual({
      id: "role-pm",
      name: "Project Manager",
      approval_limit: 1000000,
      currency_code: "THB",
      approval_level: 3,
      approval_limits: { default: 1000000 },
      perms: [
        [1, 0, 0, 0, 0], // dashboard
        [1, 1, 1, 0, 0], // boq
        [0, 0, 0, 0, 0], // pr
        [0, 0, 0, 0, 0], // po
        [0, 0, 0, 0, 0], // wo
        [0, 0, 0, 0, 0], // gr
        [0, 0, 0, 0, 0], // subcon
        [0, 0, 0, 0, 0], // inventory
        [0, 0, 0, 0, 0], // petty
        [0, 0, 0, 0, 0], // finance
        [0, 0, 0, 0, 0], // master
      ],
      user_count: 2,
    });
  });
});

describe("GET /api/v1/roles — tenant scope (no leak)", () => {
  it("binds company_id on the role + user reads", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[roles, [roleRow]], [users, []]], captured),
      })
    ).inject({ url: "/api/v1/roles" });
    for (const t of [roles, users]) {
      const call = captured.find((c) => c.table === t);
      expect(call).toBeTruthy();
      expect(paramsOf(call!.where)).toContain(COMPANY);
    }
  });
});

describe("POST /api/v1/roles — create", () => {
  it("creates a role from the matrix + real-money approval_limit (201)", async () => {
    const mutated: Mutated[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb([], [], mutated) })
    ).inject({
      method: "POST",
      url: "/api/v1/roles",
      payload: {
        name: "Coordinator",
        approval_limit: 200000,
        approval_level: 2,
        // 11×5 matrix (mock RoleAddForm.perms): dashboard view, boq view+create.
        perms: [[1, 0, 0, 0, 0], [1, 1, 0, 0, 0]],
      },
    });
    expect(res.statusCode).toBe(201);
    const ins = mutated.find((m) => m.kind === "insert")!;
    expect(ins.values.name).toBe("Coordinator");
    expect(ins.values.approvalLimit).toBe("200000.00");
    expect(ins.values.approvalLevel).toBe(2);
    // matrix → stored module→flags map.
    expect((ins.values.perms as Record<string, unknown>).boq).toEqual({ view: true, create: true, edit: false, approve: false, cancel: false });
    expect(res.json()).toMatchObject({ name: "Coordinator", approval_limit: 200000, approval_level: 2, user_count: 0 });
  });

  it("400s a missing name and an out-of-range level", async () => {
    const noName = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb([]) })
    ).inject({ method: "POST", url: "/api/v1/roles", payload: { approval_level: 1 } });
    expect(noName.statusCode).toBe(400);
    await app.close();

    const badLevel = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb([]) })
    ).inject({ method: "POST", url: "/api/v1/roles", payload: { name: "X", approval_level: 9 } });
    expect(badLevel.statusCode).toBe(400);
  });
});

describe("PUT /api/v1/roles/:id — matrix save", () => {
  it("updates an existing role (200), binds company_id in the WHERE", async () => {
    const captured: Captured[] = [];
    const mutated: Mutated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[roles, [roleRow]], [users, [userRow("u1", "role-pm")]]], captured, mutated),
      })
    ).inject({
      method: "PUT",
      url: "/api/v1/roles/role-pm",
      payload: { name: "PM v2", approval_limit: 300000, approval_level: 3, perms: [[1, 1, 1, 1, 1]] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: "role-pm", name: "PM v2", approval_limit: 300000, user_count: 1 });
    // the UPDATE ... WHERE carries the tenant scope.
    const upd = captured.find((c) => c.table === roles)!;
    expect(paramsOf(upd.where)).toContain(COMPANY);
  });

  it("404s when the role is not in this tenant", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[roles, []], [users, []]]),
      })
    ).inject({
      method: "PUT",
      url: "/api/v1/roles/does-not-exist",
      payload: { name: "X", approval_level: 0 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("is tenant-bound: a different tenant's request carries ITS company_id", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => ({ companyId: OTHER, user: SESSION.user }),
        db: stubDb([[roles, [{ ...roleRow, companyId: OTHER }]], [users, []]], captured),
      })
    ).inject({ method: "PUT", url: "/api/v1/roles/role-pm", payload: { name: "Y", approval_level: 0 } });
    const upd = captured.find((c) => c.table === roles)!;
    expect(paramsOf(upd.where)).toContain(OTHER);
    expect(paramsOf(upd.where)).not.toContain(COMPANY);
  });
});

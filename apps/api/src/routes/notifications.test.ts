// G3 unit tests (PLAN.md §9) — notification handlers (FLOW-A data-completeness;
// the app-shell bell). Covers the B-014 list envelope of the SESSION user's
// notifications (company_id + user_id scoped — no cross-user / cross-tenant
// leak), the mark-read action (200 → read:true), the 404 on a miss, and the
// fail-closed 401 without a session. All rows come from the stub — no value is
// hand-computed against the impl.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { notifications, users } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const USER = "11111111-1111-1111-1111-111111111111";
const D = new Date(1_700_000_000_000);

const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย" },
};

interface Captured {
  table: unknown;
  where: SQL | undefined;
}
interface Updated {
  table: unknown;
  set: Record<string, unknown>;
  where: SQL | undefined;
}
interface StubOpts {
  rows: Array<[unknown, unknown[]]>;
  updateReturns?: unknown[];
  captured?: Captured[];
  updated?: Updated[];
}

/** stub Db: canned rows per table + a canned update-returning result. */
function stubDb(opts: StubOpts): Db {
  const { rows, updateReturns = [], captured = [], updated = [] } = opts;
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
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) => {
        captured.push({ table, where: undefined });
        return Promise.resolve(rowsFor(table)).then(onOk, onErr);
      },
    };
    return builder;
  };
  return {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: () => {
            updated.push({ table, set, where });
            return Promise.resolve(updateReturns);
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
    db: overrides.db ?? stubDb({ rows: [] }),
    resolveTenant: overrides.resolveTenant ?? (async () => null),
    signIn: overrides.signIn ?? (async () => null),
    storage: overrides.storage ?? createFakeR2Storage("https://r2.test"),
    quota:
      overrides.quota ??
      new QuotaGuard({ resolver: unlimitedQuotaResolver, upgradeUrl: "https://upgrade.test" }),
    auditSink: overrides.auditSink ?? (async () => {}),
    logger: false,
  });
  return app;
}

const userRow = {
  id: USER,
  companyId: COMPANY,
  email: SESSION.user.email,
  name: "สมชาย วัฒนกุล",
  roleId: "role-mgr",
  status: "active",
  createdAt: D,
  updatedAt: D,
};

const notif = (id: string, type: string, read: boolean) => ({
  id,
  companyId: COMPANY,
  userId: USER,
  type,
  ref: `pr:${id}`,
  read,
  createdAt: D,
  updatedAt: D,
});

describe("GET /api/v1/notifications", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/notifications" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("returns the B-014 envelope of the session user's notifications", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [users, [userRow]],
            [notifications, [notif("n0", "approval", false), notif("n1", "info", true)]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/notifications" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    const [n0, n1] = body.data;
    expect(n0.id).toBe("n0");
    expect(n0.type).toBe("approval");
    expect(n0.read).toBe(false);
    expect(n1.read).toBe(true);
    expect(Object.keys(n0).sort()).toEqual(["created_at", "id", "read", "ref", "type"]);
  });

  it("scopes the read by BOTH company_id (tenant) and the session user_id", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[users, [userRow]], [notifications, [notif("n0", "info", false)]]],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/notifications" });
    const read = captured.find((c) => c.table === notifications);
    expect(read).toBeTruthy();
    const params = paramsOf(read!.where);
    expect(params).toContain(COMPANY); // tenant scope (company_id)
    expect(params).toContain(USER); // user scope (user_id)
  });
});

describe("POST /api/v1/notifications/:id/read", () => {
  it("marks a notification read (200)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[users, [userRow]]],
          updateReturns: [{ ...notif("n0", "approval", true) }],
          updated,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/notifications/n0/read" });
    expect(res.statusCode).toBe(200);
    expect(res.json().read).toBe(true);
    expect(updated[0]!.table).toBe(notifications);
    expect(updated[0]!.set.read).toBe(true);
    // update scoped by BOTH company_id AND the session user_id.
    const params = paramsOf(updated[0]!.where);
    expect(params).toContain(COMPANY);
    expect(params).toContain(USER);
  });

  it("404s when no notification matches (foreign / absent id)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, [userRow]]], updateReturns: [] }),
      })
    ).inject({ method: "POST", url: "/api/v1/notifications/nope/read" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/notifications/n0/read",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });
});

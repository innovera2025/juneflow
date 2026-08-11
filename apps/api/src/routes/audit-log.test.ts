// G3 unit tests (PLAN.md §9) — GET /audit-log (group-C Wave-1, C-BE-AUDITLOG):
// the activity-feed read over audit_log. Proves (a) the B-014 envelope + row
// shape with rows ordered newest-first, (b) user_name resolution — users.name
// join, null user_id → 'ระบบ', an unresolvable user_id → honest null, (c)
// company_id bound on EVERY read (tenant isolation), (d) each contract filter
// (?entity=&user=&action=) lands in the WHERE, and (e) 401 fail-closed without
// a session. Expected values come from the stub rows + the openapi op
// (listAuditLog → EntityList), never from the implementation.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { auditLogs, users } from "@juneflow/db";
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

/** stub Db: canned rows per table (select-only — the route never writes). */
function stubDb(rows: Array<[unknown, unknown[]]>, captured: Captured[] = []): Db {
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

/** An audit_log row `minutesAgo` minutes before the fixed anchor D. */
const audit = (
  id: string,
  minutesAgo: number,
  over: Partial<{ userId: string | null; action: string; entity: string }> = {},
) => ({
  id,
  companyId: COMPANY,
  userId: over.userId === undefined ? USER : over.userId,
  action: over.action ?? "approve",
  entity: over.entity ?? "PR-2026-0418",
  before: null,
  after: null,
  ip: null,
  at: new Date(D.getTime() - minutesAgo * 60_000),
  createdAt: D,
});

describe("GET /api/v1/audit-log", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/audit-log" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("returns the B-014 envelope newest-first with resolved user_name + raw entity", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([
          [users, [userRow]],
          [
            auditLogs,
            [
              audit("a-old", 120, { entity: "BOQ-2026-B-02 v4" }),
              audit("a-new", 5), // newest — must surface first despite stub order
            ],
          ],
        ]),
      })
    ).inject({ url: "/api/v1/audit-log" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    const [first, second] = body.data;
    expect(first.id).toBe("a-new"); // at DESC (feed order)
    expect(second.id).toBe("a-old");
    expect(first.user_name).toBe("สมชาย วัฒนกุล"); // users.name join
    expect(second.entity).toBe("BOQ-2026-B-02 v4"); // raw as stored (Wei ruling)
    expect(Object.keys(first).sort()).toEqual(["action", "at", "entity", "id", "user_id", "user_name"]);
  });

  // B-323: the feed sorted on `at` alone, which returns 0 for two entries sharing an
  // instant — and here that is the NORM, not an edge: every mutation of ONE request is
  // written under the same statement timestamp. Ties fell through to the join plan, so
  // a single request's own entries could reorder between two reads of the same feed.
  it("is TOTAL when entries share an instant — one request's own rows cannot reorder", async () => {
    const ids = async (rows: unknown[]): Promise<string[]> => {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb([[users, [userRow]], [auditLogs, rows]]),
        })
      ).inject({ url: "/api/v1/audit-log" });
      return res.json().data.map((r: { id: string }) => r.id);
    };
    // Three entries of one request: identical `at`, so only the id floor can order them.
    const a = audit("aaa", 5);
    const b = audit("bbb", 5);
    const c = audit("ccc", 5);
    expect(await ids([a, b, c])).toEqual(["aaa", "bbb", "ccc"]);
    expect(await ids([c, a, b])).toEqual(["aaa", "bbb", "ccc"]);
    expect(await ids([c, b, a])).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("null user_id reads 'ระบบ'; an unresolvable user_id stays an honest null", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([
          [users, [userRow]],
          [
            auditLogs,
            [
              audit("a-sys", 10, { userId: null, action: "sync", entity: "SAP REM" }),
              audit("a-gone", 20, { userId: "99999999-9999-9999-9999-999999999999" }),
            ],
          ],
        ]),
      })
    ).inject({ url: "/api/v1/audit-log" });

    const body = res.json();
    const sys = body.data.find((r: { id: string }) => r.id === "a-sys");
    const gone = body.data.find((r: { id: string }) => r.id === "a-gone");
    expect(sys.user_name).toBe("ระบบ"); // system writer
    expect(sys.user_id).toBe(null);
    expect(gone.user_name).toBe(null); // C10 — no fabricated name
  });

  it("binds company_id on BOTH the audit_log and users reads (tenant isolation)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[users, [userRow]], [auditLogs, [audit("a0", 1)]]], captured),
      })
    ).inject({ url: "/api/v1/audit-log" });

    const logRead = captured.find((c) => c.table === auditLogs);
    const userRead = captured.find((c) => c.table === users);
    expect(logRead).toBeTruthy();
    expect(userRead).toBeTruthy();
    expect(paramsOf(logRead!.where)).toContain(COMPANY);
    expect(paramsOf(userRead!.where)).toContain(COMPANY);
  });

  it("applies each contract filter (?entity=&user=&action=) into the WHERE", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[users, [userRow]], [auditLogs, []]], captured),
      })
    ).inject({
      url: `/api/v1/audit-log?entity=${encodeURIComponent("SAP REM")}&user=${USER}&action=sync`,
    });

    const logRead = captured.find((c) => c.table === auditLogs);
    const params = paramsOf(logRead!.where);
    expect(params).toContain(COMPANY); // tenant scope survives the filters
    expect(params).toContain("SAP REM"); // entity
    expect(params).toContain(USER); // user (acting user_id)
    expect(params).toContain("sync"); // action
  });

  it("?user=<non-uuid> answers an honest empty list, never a PG cast 500", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[users, [userRow]], [auditLogs, [audit("a0", 1)]]]),
      })
    ).inject({ url: "/api/v1/audit-log?user=not-a-uuid" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0); // filter that can match nothing → empty
  });

  it("blank filter params filter nothing (honest full feed)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[users, [userRow]], [auditLogs, [audit("a0", 1), audit("a1", 2)]]]),
      })
    ).inject({ url: "/api/v1/audit-log?entity=&user=&action=" });
    expect(res.json().total).toBe(2);
  });
});

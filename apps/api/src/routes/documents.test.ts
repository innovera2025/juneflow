// G2/G3 tests (PLAN.md §9) — GET /documents, the DMS file list (B-221 · Solar-tail).
// Covers: fail-closed 401 · company-scoped list envelope newest-first · the ?cat=
// filter · the FK-resolver (by/project_name resolve to display NAMES, never a raw
// uuid; a null FK → null). The load-bearing scope assertion is
// paramsOf(where).toContain(COMPANY): the documents read is tenant-scoped (no
// cross-tenant leak). money=NONE, GET-only. Route wired via registerDocumentsRoute.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { documents, projects, users } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "suda@rungrueang.co.th", name: "สุดา" },
};
const D0 = new Date(1_700_000_000_000); // older
const D1 = new Date(1_700_100_000_000); // newer

// --- stub (mirrors solar.test.ts / land-sales.test.ts) ---------------------
type RowSource = unknown[] | ((where: SQL | undefined) => unknown[]);
interface Captured {
  table: unknown;
  where: SQL | undefined;
}

function stubDb(opts: { rows: Array<[unknown, RowSource]>; captured?: Captured[] }): Db {
  const { rows, captured = [] } = opts;
  const rowsFor = (table: unknown, where: SQL | undefined): unknown[] => {
    for (const [t, r] of rows) {
      if (t === table) return typeof r === "function" ? r(where) : r;
    }
    return [];
  };
  const builderFor = (table: unknown) => {
    const builder = {
      $dynamic: () => builder,
      innerJoin: () => builder,
      where: (where: SQL) => {
        captured.push({ table, where });
        return Promise.resolve(rowsFor(table, where));
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) => {
        captured.push({ table, where: undefined });
        return Promise.resolve(rowsFor(table, undefined)).then(onOk, onErr);
      },
    };
    return builder;
  };
  const raw: Record<string, unknown> = {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
  };
  return raw as unknown as Db;
}

/** Bound SQL params of a where clause — used to prove the company_id predicate. */
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
  await app.ready();
  return app;
}

// --- seed-shaped canned rows -----------------------------------------------
const doc = (id: string, createdAt: Date, extra: Record<string, unknown> = {}) =>
  ({
    id, companyId: COMPANY, projectId: "proj-1", cat: "contract", version: 3,
    expiry: null, linkModule: "subcon.contracts", url: `r2://documents/${id}.pdf`,
    name: "สัญญาจ้างเหมา WO-2569-012.pdf", byUserId: "user-1", size: "2.4 MB",
    status: "active", createdAt, updatedAt: createdAt, ...extra,
  }) as typeof documents.$inferSelect;

// projects / users only need id + name for the FK-resolver (opaque rows).
const project = (id: string, name: string) => ({ id, name });
const user = (id: string, name: string) => ({ id, name });

// ===========================================================================
describe("GET /api/v1/documents", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/documents" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("lists the tenant's documents newest-first as a company-scoped list envelope", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [documents, [doc("d0", D0, { name: "เก่า.pdf" }), doc("d1", D1, { name: "ใหม่.pdf" })]],
            [projects, [project("proj-1", "juneflow พาร์ค ราชพฤกษ์")]],
            [users, [user("user-1", "สมชาย")]],
          ],
          captured,
        }),
      })
    ).inject({ method: "GET", url: "/api/v1/documents" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data.map((r: { id: string }) => r.id)).toEqual(["d1", "d0"]); // newest-first
    expect(body.data[0]).toMatchObject({
      id: "d1", name: "ใหม่.pdf", cat: "contract", version: 3, size: "2.4 MB",
      status: "active", link_module: "subcon.contracts",
    });
    // load-bearing: the documents read is tenant-scoped (company_id bound into WHERE).
    const where = captured.find((c) => c.table === documents)?.where;
    expect(paramsOf(where)).toContain(COMPANY);
  });

  it("returns an honest-empty envelope when the tenant has no documents", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[documents, []], [projects, []], [users, []]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/documents" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 0, data: [] });
  });

  it("?cat=contract filters to contract documents only", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [documents, [
              doc("c0", D0, { cat: "contract" }),
              doc("dr0", D1, { cat: "drawing" }),
            ]],
            [projects, [project("proj-1", "RJP")]],
            [users, [user("user-1", "สมชาย")]],
          ],
        }),
      })
    ).inject({ method: "GET", url: "/api/v1/documents?cat=contract" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data.map((r: { cat: string }) => r.cat)).toEqual(["contract"]);
    expect(body.data[0].id).toBe("c0");
  });

  it("resolves by/project_name from their FKs (display NAMES, never a raw uuid) and nulls unset FKs", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [documents, [
              doc("resolved", D1, { projectId: "proj-1", byUserId: "user-1" }),
              doc("unset", D0, { projectId: null, byUserId: null }),
            ]],
            [projects, [project("proj-1", "juneflow พาร์ค ราชพฤกษ์")]],
            [users, [user("user-1", "สมชาย")]],
          ],
        }),
      })
    ).inject({ method: "GET", url: "/api/v1/documents" });
    expect(res.statusCode).toBe(200);
    const list = res.json().data as Array<Record<string, unknown>>;
    const resolved = list.find((r) => r.id === "resolved")!;
    const unset = list.find((r) => r.id === "unset")!;
    // resolved to display NAMES — never the raw uuid.
    expect(resolved.by).toBe("สมชาย");
    expect(resolved.project_name).toBe("juneflow พาร์ค ราชพฤกษ์");
    expect(resolved.by).not.toBe("user-1");
    expect(resolved.project_name).not.toBe("proj-1");
    // a null by_user_id / project_id → null display field (em-dash at the client).
    expect(unset.by).toBeNull();
    expect(unset.project_name).toBeNull();
  });
});

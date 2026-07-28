// SECURITY tests (PLAN.md §9 · Phase-6 Wave-0, B-176/177/178/179) — the
// platform-owner cross-tenant surface. The central invariant: a tenant bearer
// (is_platform_admin=false) must NEVER reach cross-tenant platform data. Covers:
//   - the owner gate (B-178): EVERY /admin/* GET 403s a valid tenant non-owner
//     and 401s a session-less request; strict !== true (absent flag denies).
//   - the owner-happy reads (B-178): an is_platform_admin=true caller lists
//     packages/subscribers/users/invoices + gets a package or 404.
//   - the cross-tenant door (B-177): the /admin read of `user` is UNSCOPED (no
//     company_id predicate — proven via the captured WHERE), unlike request.db;
//     and PlatformDb.selectAllTenants throws for a non-allowlisted table.
//   - B-179: the invoices read carries money + currency but posts no GL (pure
//     SELECT — grep-verified separately; here we assert the shape).
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  companies,
  packages,
  platformInvoices,
  roles,
  subscriptions,
  users,
} from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { PlatformDb } from "../db/platform-db.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const OTHER_COMPANY = "33333333-3333-3333-3333-333333333333";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "wipha@rungrueang.co.th", name: "วิภา" },
};
const D0 = new Date(1_700_000_000_000);

// --- stub (mirrors land-sales.test.ts, read-only) --------------------------
type RowSource = unknown[] | ((where: SQL | undefined) => unknown[]);
interface Captured {
  table: unknown;
  where: SQL | undefined;
}
interface StubOpts {
  rows: Array<[unknown, RowSource]>;
  captured?: Captured[];
}
function stubDb(opts: StubOpts): Db {
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

// --- rows ------------------------------------------------------------------
// The caller's OWN user row (loadCaller resolves it via request.db by email).
const caller = (isPlatformAdmin: boolean) => ({
  id: "u-0", companyId: COMPANY, email: SESSION.user.email, name: SESSION.user.name,
  roleId: null, status: "active", isPlatformAdmin, department: null, createdAt: D0, updatedAt: D0,
}) as typeof users.$inferSelect;

const pkg = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id, size: "M", name: "Medium", priceM: "7900.00", priceY: "79000.00", currencyCode: "THB",
    limits: { users: 20 }, menus: ["dashboard"], subRules: {}, createdAt: D0, updatedAt: D0, ...extra,
  }) as typeof packages.$inferSelect;

const sub = (id: string, companyId: string, extra: Record<string, unknown> = {}) =>
  ({
    id, companyId, packageId: "pkg-1", cycle: "monthly", renewAt: D0, status: "active",
    createdAt: D0, updatedAt: D0, ...extra,
  }) as typeof subscriptions.$inferSelect;

const company = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({
    id, name, taxId: null, address: null, subscriptionId: null, groupParentId: null,
    short: null, color: null, docPrefix: null, biz: null, status: "active", createdAt: D0, updatedAt: D0, ...extra,
  }) as typeof companies.$inferSelect;

const invoice = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id, subscriptionId: "sub-1", amount: "7900.00", currencyCode: "THB", status: "paid",
    createdAt: D0, updatedAt: D0, ...extra,
  }) as typeof platformInvoices.$inferSelect;

const otherUser = (id: string) =>
  ({
    id, companyId: OTHER_COMPANY, email: "someone@other.co.th", name: "Other", roleId: null,
    status: "active", isPlatformAdmin: false, department: null, createdAt: D0, updatedAt: D0,
  }) as typeof users.$inferSelect;

const ADMIN_GETS = [
  "/api/v1/admin/packages",
  "/api/v1/admin/packages/pkg-1",
  "/api/v1/admin/subscribers",
  "/api/v1/admin/users",
  "/api/v1/admin/invoices",
];

// ===========================================================================
// B-178 owner gate — fail-closed (the leak-prevention invariant).
// ===========================================================================
describe("owner gate (B-178) — a tenant bearer NEVER reaches /admin/*", () => {
  it.each(ADMIN_GETS)("403s a valid tenant non-owner on %s", async (url) => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION, // a VALID tenant (passes tenant-scope)…
        db: stubDb({ rows: [[users, [caller(false)]]] }), // …but is_platform_admin=false
      })
    ).inject({ method: "GET", url });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(res.json().message).toMatch(/platform admin/);
  });

  it.each(ADMIN_GETS)("401s a session-less request on %s (tenant-scope fail-closed)", async (url) => {
    const res = await (await buildTestApp()).inject({ method: "GET", url });
    expect(res.statusCode).toBe(401);
  });

  it("403s when the caller row carries NO is_platform_admin flag (strict !== true)", async () => {
    const noFlag = { ...caller(false) } as Record<string, unknown>;
    delete noFlag.isPlatformAdmin; // an unmigrated / legacy row → undefined, must deny
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, [noFlag]]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/admin/packages" });
    expect(res.statusCode).toBe(403);
  });
});

// ===========================================================================
// B-178 owner-happy reads (is_platform_admin=true).
// ===========================================================================
describe("owner reads (is_platform_admin=true) — cross-tenant via PlatformDb", () => {
  it("GET /admin/packages lists the plan catalog", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, [caller(true)]], [packages, [pkg("pkg-1"), pkg("pkg-2", { size: "L" })]]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/admin/packages" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data[0]).toMatchObject({ id: "pkg-1", size: "M", price_m: 7900, currency_code: "THB" });
  });

  it("GET /admin/packages/:id returns one plan, 404 when absent", async () => {
    const found = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, [caller(true)]], [packages, [pkg("pkg-1")]]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/admin/packages/pkg-1" });
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({ id: "pkg-1", name: "Medium" });

    const missing = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, [caller(true)]], [packages, []]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/admin/packages/nope" });
    expect(missing.statusCode).toBe(404);
  });

  it("GET /admin/subscribers lists every tenant's subscription, enriched with company", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [users, [caller(true)]],
            [subscriptions, [sub("sub-1", COMPANY), sub("sub-2", OTHER_COMPANY)]],
            [companies, [company(COMPANY, "รุ่งเรือง"), company(OTHER_COMPANY, "อื่น")]],
          ],
        }),
      })
    ).inject({ method: "GET", url: "/api/v1/admin/subscribers" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2); // BOTH tenants (cross-tenant)
    const other = body.data.find((r: { company_id: string }) => r.company_id === OTHER_COMPANY);
    expect(other).toMatchObject({ company_name: "อื่น", company_status: "active" });
  });

  it("GET /admin/users reads UNSCOPED cross-tenant (the door adds no company predicate)", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, [caller(true), otherUser("u-9")]]], captured }),
      })
    ).inject({ method: "GET", url: "/api/v1/admin/users" });
    expect(res.statusCode).toBe(200);
    // The admin door read of `user` carried NO WHERE (cross-tenant) — distinct from
    // loadCaller's request.db read, which is company-scoped. This is the door working.
    const userReads = captured.filter((c) => c.table === users);
    expect(userReads.some((c) => c.where === undefined)).toBe(true); // the unscoped door read
    expect(userReads.some((c) => paramsOf(c.where).includes(COMPANY))).toBe(true); // loadCaller's scoped read
  });

  it("GET /admin/users?company= applies the company FILTER (not the owner's own scope)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, [caller(true)]]], captured }),
      })
    ).inject({ method: "GET", url: `/api/v1/admin/users?company=${OTHER_COMPANY}` });
    // The door read filters by the REQUESTED company, never the owner's own COMPANY.
    const filtered = captured.filter((c) => c.table === users).find((c) => c.where !== undefined && paramsOf(c.where).includes(OTHER_COMPANY));
    expect(filtered).toBeTruthy();
  });

  it("GET /admin/invoices lists platform billing (money + currency, no GL) — B-179", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, [caller(true)]], [platformInvoices, [invoice("inv-1")]]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/admin/invoices" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({ id: "inv-1", amount: 7900, currency_code: "THB", status: "paid" });
  });
});

// ===========================================================================
// B-177 PlatformDb door — allowlist (a non-admin table can never be read).
// ===========================================================================
describe("PlatformDb door (B-177) — allowlist fail-closed", () => {
  // A minimal non-throwing Db so an ALLOWED table reaches select().from() cleanly;
  // a DENIED table throws at the allowlist check before ever touching this.
  const fake = { select: () => ({ from: () => ({}) }) } as unknown as Db;
  it("throws for a non-allowlisted (tenant ERP) table", () => {
    const pdb = new PlatformDb(fake);
    // `roles` is a tenant table, NOT on the platform-admin allowlist.
    expect(() => pdb.selectAllTenants(roles)).toThrow(/PLATFORM_ADMIN_TABLE_DENIED/);
  });

  it("permits the five platform-admin tables", () => {
    const pdb = new PlatformDb(fake);
    for (const t of [packages, companies, subscriptions, platformInvoices, users]) {
      expect(() => pdb.selectAllTenants(t)).not.toThrow();
    }
  });
});

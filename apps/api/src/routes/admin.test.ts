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
import { PlatformWriteDb } from "../db/platform-write-db.js";
import type { ResetDeliveryMessage } from "../auth-provisioning.js";
import { FakeCredentialStore } from "../auth-provisioning-fake.js";
import { computeMrrArr, type DunningNotice } from "./admin.js";
import type { AuditRecord } from "../plugins/audit-log.js";
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
interface Updated {
  table: unknown;
  set: Record<string, unknown>;
  where: SQL;
}
interface Inserted {
  table: unknown;
  values: Record<string, unknown>;
}
interface StubOpts {
  rows: Array<[unknown, RowSource]>;
  captured?: Captured[];
  updated?: Updated[];
  inserted?: Inserted[];
}
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], updated = [], inserted = [] } = opts;
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
    // UPDATE … RETURNING: echoes the table's stubbed rows with the SET applied
    // (empty when the table has no rows → models a not-found 0-row update).
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: () => {
            updated.push({ table, set, where });
            return Promise.resolve(
              rowsFor(table, where).map((r) => ({ ...(r as object), ...set })),
            );
          },
        }),
      }),
    }),
    // INSERT … RETURNING: echoes the values with a server-generated id (models
    // defaultRandom — the door strips any client id before this).
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          inserted.push({ table, values });
          return Promise.resolve([{ id: "new-pkg", createdAt: D0, ...values }]);
        },
      }),
    }),
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

// B-282: buildApp defaults `credentials` to the REAL DbCredentialStore, so a
// test touching /admin/users/{id}/reset-password opts into the fake here.
let credentials: FakeCredentialStore;
let delivered: ResetDeliveryMessage[];

async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<FastifyInstance> {
  credentials =
    (overrides.credentials as FakeCredentialStore | undefined) ?? new FakeCredentialStore();
  delivered = [];
  app = await buildApp({
    db: overrides.db ?? stubDb({ rows: [] }),
    resolveTenant: overrides.resolveTenant ?? (async () => null),
    signIn: overrides.signIn ?? (async () => null),
    storage: overrides.storage ?? createFakeR2Storage("https://r2.test"),
    quota:
      overrides.quota ??
      new QuotaGuard({ resolver: unlimitedQuotaResolver, upgradeUrl: "https://upgrade.test" }),
    auditSink: overrides.auditSink ?? (async () => {}),
    notify: overrides.notify,
    credentials,
    deliverReset: overrides.deliverReset ?? ((m) => void delivered.push(m)),
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

  it("B-183: a successful owner /admin/* read fires an audit record (action=read · who)", async () => {
    const records: Array<Record<string, unknown>> = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, [caller(true)]], [packages, [pkg("pkg-1")]]] }),
        auditSink: (r) => {
          records.push(r as unknown as Record<string, unknown>);
        },
      })
    ).inject({ method: "GET", url: "/api/v1/admin/packages" });
    expect(res.statusCode).toBe(200);
    // The cross-tenant owner read is logged end-to-end (route + audit hook + user).
    expect(records).toHaveLength(1);
    expect(records[0]!.action).toBe("read");
    expect(String(records[0]!.entity)).toContain("admin/packages");
    expect(records[0]!.userId).toBe("u-0"); // the owner's dictionary user id
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

// ===========================================================================
// W1a — PlatformWriteDb door (B-193): allowlist + field-strip (self-elevation).
// ===========================================================================
describe("PlatformWriteDb door (B-193) — allowlist + strip fail-closed", () => {
  // A fake Db whose UPDATE…RETURNING captures the SET the door actually applied.
  function captureFake() {
    const captured: Array<{ table: unknown; set: Record<string, unknown> }> = [];
    const db = {
      update: (table: unknown) => ({
        set: (set: Record<string, unknown>) => ({
          where: () => ({
            returning: () => {
              captured.push({ table, set });
              return Promise.resolve([{ id: "x", ...set }]);
            },
          }),
        }),
      }),
    } as unknown as Db;
    return { db, captured };
  }

  it("throws for a non-allowlisted (tenant ERP) table", async () => {
    const { db } = captureFake();
    const wdb = new PlatformWriteDb(db);
    // roles is a tenant table, NOT on the WRITE allowlist {user, company}.
    await expect(
      wdb.updateAllTenants(roles, "r-1", {} as Partial<typeof roles.$inferInsert>),
    ).rejects.toThrow(/PLATFORM_ADMIN_WRITE_DENIED/);
  });

  it("STRIPS is_platform_admin / company_id / id from the SET (self-elevation + tenant-move + PK defense)", async () => {
    const { db, captured } = captureFake();
    const wdb = new PlatformWriteDb(db);
    // A smuggled payload trying to mint an owner, move the tenant, and reassign the PK.
    await wdb.updateAllTenants(users, "u-victim", {
      status: "blocked",
      isPlatformAdmin: true,
      is_platform_admin: true,
      companyId: "attacker-co",
      company_id: "attacker-co",
      id: "some-other-id",
    } as unknown as Partial<typeof users.$inferInsert>);
    expect(captured).toHaveLength(1);
    // ONLY status survives — every owner-flag / tenant / PK key is dropped.
    expect(captured[0]!.set).toEqual({ status: "blocked" });
  });

  it("permits the two writable tables (user, company)", async () => {
    const { db } = captureFake();
    const wdb = new PlatformWriteDb(db);
    await expect(
      wdb.updateAllTenants(users, "u-1", { status: "active" } as Partial<typeof users.$inferInsert>),
    ).resolves.toBeDefined();
    await expect(
      wdb.updateAllTenants(companies, "c-1", { status: "active" } as Partial<typeof companies.$inferInsert>),
    ).resolves.toBeDefined();
  });
});

// ===========================================================================
// W1a — owner-gated cross-tenant writes (block/unblock/suspend/resume).
// ===========================================================================
const OWNER = caller(true);
// The caller-vs-victim discriminator: loadCaller reads `user` WHERE email=owner;
// a write reads/returns `user` WHERE id=victim. Same table, different rows.
const usersByWhere = (victimRows: unknown[]) => (where: SQL | undefined) =>
  paramsOf(where).includes(SESSION.user.email) ? [OWNER] : victimRows;

const victimUser = {
  id: "u-victim", companyId: OTHER_COMPANY, email: "victim@other.co.th", name: "Victim",
  roleId: null, status: "active", isPlatformAdmin: false, department: null, createdAt: D0, updatedAt: D0,
};

const W1A_WRITES = [
  ["/api/v1/admin/users/u-victim/block", "block"],
  ["/api/v1/admin/users/u-victim/unblock", "unblock"],
  ["/api/v1/admin/subscribers/sub-1/suspend", "suspend"],
  ["/api/v1/admin/subscribers/sub-1/resume", "resume"],
] as const;

describe("W1a owner writes (B-193) — owner flips TARGET-tenant status + target audit", () => {
  it("block: owner blocks a user in ANOTHER tenant → user.status='blocked' + audit companyId=target", async () => {
    const updated: Updated[] = [];
    const records: AuditRecord[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, usersByWhere([victimUser])]], updated }),
        auditSink: (r) => { records.push(r as AuditRecord); },
      })
    ).inject({ method: "POST", url: "/api/v1/admin/users/u-victim/block" });
    expect(res.statusCode).toBe(200);
    const w = updated.find((u) => u.table === users)!;
    expect(w.set).toEqual({ status: "blocked" }); // status flip only
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ companyId: OTHER_COMPANY, userId: "u-0", action: "block" });
    expect(String(records[0]!.entity)).toContain("admin/users");
  });

  it("unblock: → user.status='active', action=unblock, audit target company", async () => {
    const updated: Updated[] = [];
    const records: AuditRecord[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, usersByWhere([{ ...victimUser, status: "blocked" }])]], updated }),
        auditSink: (r) => { records.push(r as AuditRecord); },
      })
    ).inject({ method: "POST", url: "/api/v1/admin/users/u-victim/unblock" });
    expect(res.statusCode).toBe(200);
    expect(updated.find((u) => u.table === users)!.set).toEqual({ status: "active" });
    expect(records[0]).toMatchObject({ companyId: OTHER_COMPANY, action: "unblock" });
  });

  it("suspend: resolves subscription→company, flips companies.status='suspended' (NOT subscription), audit target", async () => {
    const updated: Updated[] = [];
    const records: AuditRecord[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [users, [OWNER]],
            [subscriptions, [sub("sub-1", OTHER_COMPANY)]],
            [companies, [company(OTHER_COMPANY, "อื่น")]],
          ],
          updated,
        }),
        auditSink: (r) => { records.push(r as AuditRecord); },
      })
    ).inject({ method: "POST", url: "/api/v1/admin/subscribers/sub-1/suspend" });
    expect(res.statusCode).toBe(200);
    const w = updated.find((u) => u.table === companies)!;
    expect(w.set).toEqual({ status: "suspended" });
    expect(updated.find((u) => u.table === subscriptions)).toBeUndefined(); // never writes subscription
    expect(records[0]).toMatchObject({ companyId: OTHER_COMPANY, action: "suspend" });
  });

  it("resume: flips companies.status='active', action=resume", async () => {
    const updated: Updated[] = [];
    const records: AuditRecord[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [users, [OWNER]],
            [subscriptions, [sub("sub-1", OTHER_COMPANY)]],
            [companies, [company(OTHER_COMPANY, "อื่น", { status: "suspended" })]],
          ],
          updated,
        }),
        auditSink: (r) => { records.push(r as AuditRecord); },
      })
    ).inject({ method: "POST", url: "/api/v1/admin/subscribers/sub-1/resume" });
    expect(res.statusCode).toBe(200);
    expect(updated.find((u) => u.table === companies)!.set).toEqual({ status: "active" });
    expect(records[0]).toMatchObject({ companyId: OTHER_COMPANY, action: "resume" });
  });

  it.each(W1A_WRITES)("403s a valid tenant NON-owner on %s (no write, no audit)", async (url) => {
    const updated: Updated[] = [];
    const records: AuditRecord[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [users, [caller(false)]], // a valid tenant, is_platform_admin=false
            [subscriptions, [sub("sub-1", OTHER_COMPANY)]],
            [companies, [company(OTHER_COMPANY, "อื่น")]],
          ],
          updated,
        }),
        auditSink: (r) => { records.push(r as AuditRecord); },
      })
    ).inject({ method: "POST", url });
    expect(res.statusCode).toBe(403);
    expect(updated).toHaveLength(0); // the write never reached the door
    expect(records).toHaveLength(0); // and nothing was audited
  });

  it("404s block on an unknown user id (0-row update)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, usersByWhere([])]] }), // caller resolves; victim id → no row
      })
    ).inject({ method: "POST", url: "/api/v1/admin/users/nope/block" });
    expect(res.statusCode).toBe(404);
  });
});

// ===========================================================================
// W1b — PlatformWriteDb.insertOne (B-197): its OWN INSERT allowlist + strip.
// ===========================================================================
describe("PlatformWriteDb.insertOne (B-197) — INSERT allowlist + strip", () => {
  function insFake() {
    const captured: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const db = {
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => ({
          returning: () => {
            captured.push({ table, values });
            return Promise.resolve([{ id: "srv-gen", ...values }]);
          },
        }),
      }),
    } as unknown as Db;
    return { db, captured };
  }

  it("throws for a non-INSERT-allowlisted table — user/company are UPDATE-only (no cross-tenant create)", async () => {
    const { db } = insFake();
    const wdb = new PlatformWriteDb(db);
    await expect(
      wdb.insertOne(users, { status: "active" } as Partial<typeof users.$inferInsert>),
    ).rejects.toThrow(/PLATFORM_ADMIN_INSERT_DENIED/);
    await expect(
      wdb.insertOne(companies, { name: "x" } as Partial<typeof companies.$inferInsert>),
    ).rejects.toThrow(/PLATFORM_ADMIN_INSERT_DENIED/);
  });

  it("permits packages + STRIPS id / is_platform_admin / company_id from the VALUES", async () => {
    const { db, captured } = insFake();
    const wdb = new PlatformWriteDb(db);
    await wdb.insertOne(packages, {
      name: "Pro",
      isPlatformAdmin: true,
      is_platform_admin: true,
      companyId: "x",
      company_id: "x",
      id: "client-pinned-pk",
    } as unknown as Partial<typeof packages.$inferInsert>);
    expect(captured).toHaveLength(1);
    // ONLY name survives — a client can't pin the PK, mint an owner, or inject a tenant.
    expect(captured[0]!.values).toEqual({ name: "Pro" });
  });
});

// ===========================================================================
// W1b — package CRUD handlers (create/edit · money=SERVER · NO delete).
// ===========================================================================
describe("W1b package CRUD (B-197) — owner-gated, money=SERVER, no delete", () => {
  const okBody = {
    size: "M", name: "Professional", price: 7900,
    menus: ["dashboard", "boq"], limits: { projects: -1, users: 20, storage: 100, ai: 50 },
  };

  it("POST create: owner → 201, price_y DERIVED 10× (ignores a client yearly), currency THB, audit=owner-own action=create", async () => {
    const inserted: Inserted[] = [];
    const records: AuditRecord[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, [caller(true)]]], inserted }),
        auditSink: (r) => { records.push(r as AuditRecord); },
      })
    ).inject({ method: "POST", url: "/api/v1/admin/packages", payload: { ...okBody, yearly: 1, price_y: 1 } });
    expect(res.statusCode).toBe(201);
    const v = inserted.find((i) => i.table === packages)!.values;
    expect(v.priceM).toBe("7900.00");
    expect(v.priceY).toBe("79000.00"); // 10× monthly — NOT the client's yearly:1 (money=SERVER)
    expect(v.currencyCode).toBe("THB");
    expect(v.color).toBe("#0B2A4A"); // the M-tier default (client omitted color)
    // A global catalog change is attributed to the owner's own tenant, action=create.
    expect(records[0]).toMatchObject({ companyId: COMPANY, action: "create" });
  });

  it("POST create: a contact/Full tier (no price) → priceM=null AND priceY=null", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, [caller(true)]]], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/admin/packages",
      payload: { size: "Full", name: "Enterprise", contact: true, menus: ["dashboard"], limits: { projects: -1, users: -1, storage: -1, ai: -1 } },
    });
    expect(res.statusCode).toBe(201);
    const v = inserted.find((i) => i.table === packages)!.values;
    expect(v.priceM).toBeNull();
    expect(v.priceY).toBeNull();
  });

  it("POST create: 400 on a missing name / empty menus / non-positive price", async () => {
    const app0 = await buildTestApp({
      resolveTenant: async () => SESSION,
      db: stubDb({ rows: [[users, [caller(true)]]] }),
    });
    const noName = await app0.inject({ method: "POST", url: "/api/v1/admin/packages", payload: { size: "M", menus: ["x"], price: 100 } });
    expect(noName.statusCode).toBe(400);
    const noMenus = await app0.inject({ method: "POST", url: "/api/v1/admin/packages", payload: { size: "M", name: "X", price: 100, menus: [] } });
    expect(noMenus.statusCode).toBe(400);
  });

  it("PUT edit: owner → 200, price_y re-derived server-side; unknown id → 404", async () => {
    const updated: Updated[] = [];
    const found = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, [caller(true)]], [packages, [pkg("pkg-1")]]], updated }),
      })
    ).inject({ method: "PUT", url: "/api/v1/admin/packages/pkg-1", payload: { ...okBody, price: 9900 } });
    expect(found.statusCode).toBe(200);
    expect(updated.find((u) => u.table === packages)!.set.priceY).toBe("99000.00");

    const missing = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, [caller(true)]], [packages, []]] }),
      })
    ).inject({ method: "PUT", url: "/api/v1/admin/packages/nope", payload: okBody });
    expect(missing.statusCode).toBe(404);
  });

  it.each([
    ["POST", "/api/v1/admin/packages"],
    ["PUT", "/api/v1/admin/packages/pkg-1"],
  ])("403s a valid tenant NON-owner on %s %s (no write reached)", async (method, url) => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, [caller(false)]], [packages, [pkg("pkg-1")]]], inserted, updated }),
      })
    ).inject({ method: method as "POST" | "PUT", url, payload: okBody });
    expect(res.statusCode).toBe(403);
    expect(inserted).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });

  it("NO delete endpoint (B-196) — DELETE /admin/packages/{id} is not registered", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, [caller(true)]]] }),
      })
    ).inject({ method: "DELETE", url: "/api/v1/admin/packages/pkg-1" });
    expect(res.statusCode).toBe(404); // no route
  });
});

// ===========================================================================
// W1c — subscriptions in the WRITE (not INSERT) allowlist + the load-bearing strip.
// ===========================================================================
describe("PlatformWriteDb — subscriptions (B-201): UPDATE-allowed, INSERT-denied, company_id strip", () => {
  function wFake() {
    const upd: Array<{ table: unknown; set: Record<string, unknown> }> = [];
    const db = {
      update: (table: unknown) => ({
        set: (set: Record<string, unknown>) => ({
          where: () => ({ returning: () => { upd.push({ table, set }); return Promise.resolve([{ id: "x", companyId: "c", ...set }]); } }),
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => ({ returning: () => Promise.resolve([{ id: "x", ...values }]) }),
      }),
    } as unknown as Db;
    return { db, upd };
  }
  it("updateAllTenants(subscriptions, …) is allowed (subscriptions ∈ WRITE_TABLES)", async () => {
    const { db } = wFake();
    await expect(
      new PlatformWriteDb(db).updateAllTenants(subscriptions, "sub-1", { packageId: "p" } as Partial<typeof subscriptions.$inferInsert>),
    ).resolves.toBeDefined();
  });
  it("insertOne(subscriptions, …) THROWS — subscriptions is NOT in INSERT_TABLES (created at signup only)", async () => {
    const { db } = wFake();
    await expect(
      new PlatformWriteDb(db).insertOne(subscriptions, { packageId: "p" } as Partial<typeof subscriptions.$inferInsert>),
    ).rejects.toThrow(/PLATFORM_ADMIN_INSERT_DENIED/);
  });
  it("STRIPS a smuggled company_id/id on a subscription UPDATE (load-bearing: no tenant re-home)", async () => {
    const { db, upd } = wFake();
    await new PlatformWriteDb(db).updateAllTenants(subscriptions, "sub-1", {
      packageId: "p-new", companyId: "attacker-co", company_id: "attacker-co", id: "other-sub",
    } as unknown as Partial<typeof subscriptions.$inferInsert>);
    expect(upd[0]!.set).toEqual({ packageId: "p-new" }); // company_id/id dropped — sub can't move tenants
  });
});

// ===========================================================================
// W1c — owner PUT /admin/subscribers/{id}/package (set plan + seats).
// ===========================================================================
describe("W1c owner set-package (B-201) — plan/seat write to a tenant-owned sub", () => {
  const stub = (o: { financeOk?: boolean; owner?: boolean; pkg?: boolean; updated?: Updated[]; captured?: Captured[] } = {}) =>
    stubDb({
      rows: [
        [users, [caller(o.owner ?? true)]],
        [packages, o.pkg === false ? [] : [pkg("pkg-new")]],
        [subscriptions, [sub("sub-1", OTHER_COMPANY, { packageId: "pkg-old" })]],
        [companies, [company(OTHER_COMPANY, "อื่น")]],
      ],
      updated: o.updated,
      captured: o.captured,
    });

  it("owner → 200, swaps package_id (+seats), audit → the TARGET tenant, action=update", async () => {
    const updated: Updated[] = [];
    const records: AuditRecord[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stub({ updated }),
        auditSink: (r) => { records.push(r as AuditRecord); },
      })
    ).inject({ method: "PUT", url: "/api/v1/admin/subscribers/sub-1/package", payload: { package_id: "pkg-new", seats: 5 } });
    expect(res.statusCode).toBe(200);
    const w = updated.find((u) => u.table === subscriptions)!;
    expect(w.set).toMatchObject({ packageId: "pkg-new", seats: 5 });
    expect(res.json().seats).toBe(5);
    expect(records[0]).toMatchObject({ companyId: OTHER_COMPANY, action: "update" }); // affected tenant, not owner
  });

  it("seats validation: -1 (unlimited) ok; 0 / 1.5 / -2 → 400", async () => {
    const app0 = await buildTestApp({ resolveTenant: async () => SESSION, db: stub({}) });
    const unlimited = await app0.inject({ method: "PUT", url: "/api/v1/admin/subscribers/sub-1/package", payload: { package_id: "pkg-new", seats: -1 } });
    expect(unlimited.statusCode).toBe(200);
    for (const bad of [0, 1.5, -2]) {
      const r = await app0.inject({ method: "PUT", url: "/api/v1/admin/subscribers/sub-1/package", payload: { package_id: "pkg-new", seats: bad } });
      expect(r.statusCode).toBe(400);
    }
  });

  it("404 on an unknown package_id (FK pre-check → clean 404, not 500)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stub({ pkg: false }) })
    ).inject({ method: "PUT", url: "/api/v1/admin/subscribers/sub-1/package", payload: { package_id: "ghost" } });
    expect(res.statusCode).toBe(404);
  });

  it("403 a valid tenant NON-owner (before any write)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stub({ owner: false, updated }) })
    ).inject({ method: "PUT", url: "/api/v1/admin/subscribers/sub-1/package", payload: { package_id: "pkg-new", seats: 5 } });
    expect(res.statusCode).toBe(403);
    expect(updated).toHaveLength(0);
  });
});

// W1c/B-200 — the package-edit quota-wipe guard folded in.
describe("W1b/B-200 — package create/edit requires a non-empty limits (no quota-wipe)", () => {
  it("400s a create/edit whose limits is omitted or empty (would zero the fleet's quota)", async () => {
    const app0 = await buildTestApp({
      resolveTenant: async () => SESSION,
      db: stubDb({ rows: [[users, [caller(true)]], [packages, [pkg("pkg-1")]]] }),
    });
    const noLimits = await app0.inject({ method: "POST", url: "/api/v1/admin/packages", payload: { size: "M", name: "X", price: 100, menus: ["d"] } });
    expect(noLimits.statusCode).toBe(400);
    const emptyLimits = await app0.inject({ method: "PUT", url: "/api/v1/admin/packages/pkg-1", payload: { size: "M", name: "X", price: 100, menus: ["d"], limits: {} } });
    expect(emptyLimits.statusCode).toBe(400);
  });
});

// ===========================================================================
// W1d — POST /admin/invoices/{id}/remind (dunning · owner-gated · audit + notify).
// ===========================================================================
describe("W1d dunning remind (B-188/189) — owner-gated, real audit, notification, no money", () => {
  const stub = (o: { owner?: boolean; status?: string; hasInvoice?: boolean; hasSub?: boolean } = {}) =>
    stubDb({
      rows: [
        [users, [caller(o.owner ?? true)]],
        [platformInvoices, o.hasInvoice === false ? [] : [invoice("inv-1", { status: o.status ?? "overdue" })]],
        [subscriptions, o.hasSub === false ? [] : [sub("sub-1", OTHER_COMPANY)]],
      ],
    });

  it("owner + overdue → 200; a REAL audit (action=remind, DUNNED tenant); notification fired once", async () => {
    const records: AuditRecord[] = [];
    const notices: DunningNotice[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stub({}),
        auditSink: (r) => { records.push(r as AuditRecord); },
        notify: (n) => { notices.push(n); },
      })
    ).inject({ method: "POST", url: "/api/v1/admin/invoices/inv-1/remind" });
    expect(res.statusCode).toBe(200);
    // the audit is REAL (the prototype toast only claimed it) — attributed to the dunned tenant.
    expect(records[0]).toMatchObject({ action: "remind", companyId: OTHER_COMPANY });
    expect(String(records[0]!.entity)).toContain("admin/invoices");
    // the side-effect notification carries SERVER-derived recipient/amount (no client text).
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ companyId: OTHER_COMPANY, invoiceId: "inv-1", amount: "7900.00" });
  });

  it("403 a valid tenant NON-owner (before any read) — no audit, no notification", async () => {
    const records: AuditRecord[] = [];
    const notices: DunningNotice[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stub({ owner: false }),
        auditSink: (r) => { records.push(r as AuditRecord); },
        notify: (n) => { notices.push(n); },
      })
    ).inject({ method: "POST", url: "/api/v1/admin/invoices/inv-1/remind" });
    expect(res.statusCode).toBe(403);
    expect(records).toHaveLength(0);
    expect(notices).toHaveLength(0);
  });

  it("404 an unknown invoice; 400 a non-overdue invoice (prototype gates the button to overdue)", async () => {
    const notFoundRes = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stub({ hasInvoice: false }) })
    ).inject({ method: "POST", url: "/api/v1/admin/invoices/ghost/remind" });
    expect(notFoundRes.statusCode).toBe(404);
    const notOverdue = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stub({ status: "paid" }) })
    ).inject({ method: "POST", url: "/api/v1/admin/invoices/inv-1/remind" });
    expect(notOverdue.statusCode).toBe(400);
  });

  it("a throwing notifier (future real LINE TODO) degrades to a log — remind still 200s + audits", async () => {
    const records: AuditRecord[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stub({}),
        auditSink: (r) => { records.push(r as AuditRecord); },
        notify: () => { throw new Error("TODO(P0-INT-03) LINE send not built"); },
      })
    ).inject({ method: "POST", url: "/api/v1/admin/invoices/inv-1/remind" });
    expect(res.statusCode).toBe(200); // the try/catch never lets the adapter 500 the remind
    expect(records[0]).toMatchObject({ action: "remind" }); // and the audit still fires
  });
});

// ===========================================================================
// B-192/B-209 — server-derived MRR/ARR (money=SERVER).
// ===========================================================================
describe("computeMrrArr (B-192/B-209) — server MRR/ARR", () => {
  it("sums active/expiring/overdue by cycle; zeros trial + cancelled; ARR=MRR×12", () => {
    const pkgById = new Map<string, ReturnType<typeof pkg>>([
      ["pkg-m", pkg("pkg-m", { priceM: "7900.00", priceY: "79000.00" })],
      ["pkg-y", pkg("pkg-y", { priceM: "10000.00", priceY: "120000.00" })],
    ]);
    const subs = [
      sub("s1", COMPANY, { packageId: "pkg-m", cycle: "monthly", status: "active" }), // +7900
      sub("s2", COMPANY, { packageId: "pkg-y", cycle: "yearly", status: "active" }), // +10000 (120000/12)
      sub("s3", COMPANY, { packageId: "pkg-m", cycle: "monthly", status: "overdue" }), // +7900 (still committed)
      sub("s4", COMPANY, { packageId: "pkg-m", cycle: "monthly", status: "trial" }), // 0
      sub("s5", COMPANY, { packageId: "pkg-y", cycle: "yearly", status: "cancelled" }), // 0
    ];
    const { mrr, arr } = computeMrrArr(subs, pkgById);
    expect(mrr).toBe(25800); // 7900 + 10000 + 7900
    expect(arr).toBe(309600); // ×12
  });

  it("a sub whose package is missing contributes 0 (no crash)", () => {
    const { mrr, arr } = computeMrrArr(
      [sub("s1", COMPANY, { packageId: "ghost", status: "active" })],
      new Map(),
    );
    expect(mrr).toBe(0);
    expect(arr).toBe(0);
  });
});

describe("GET /admin/subscribers — mrr/arr on the envelope (money=SERVER)", () => {
  it("includes server-derived mrr/arr; only committed subs count (trial=0)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [users, [caller(true)]],
            [
              subscriptions,
              [
                sub("s1", COMPANY, { packageId: "pkg-m", cycle: "monthly", status: "active" }),
                sub("s2", OTHER_COMPANY, { packageId: "pkg-m", cycle: "monthly", status: "trial" }),
              ],
            ],
            [companies, [company(COMPANY, "A"), company(OTHER_COMPANY, "B")]],
            [packages, [pkg("pkg-m", { priceM: "7900.00" })]],
          ],
        }),
      })
    ).inject({ method: "GET", url: "/api/v1/admin/subscribers" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2); // both subs still listed
    expect(body.mrr).toBe(7900); // only the active monthly; the trial is 0
    expect(body.arr).toBe(94800); // 7900 × 12
  });
});

// ===========================================================================
// B-282 — POST /admin/users/{id}/reset-password. This op was DECLARED in the
// contract (openapi.yaml L398-411) and never mounted, sitting between /block
// and /unblock, which ARE mounted: the same "declared, no handler" gap as
// /auth/forgot and /auth/reset, found by diffing every declared op against the
// registered routes rather than by fixing only the two the slice named.
// ===========================================================================
describe("POST /admin/users/{id}/reset-password — B-282", () => {
  const RESET_URL = "/api/v1/admin/users/u-other/reset-password";

  // Two different reads hit `user` in this handler: loadCaller resolves the
  // OWNER by email through request.db, and platformDb resolves the TARGET by id
  // cross-tenant. The stub returns whole tables, so discriminate on the bound
  // params — otherwise the target lookup silently returns the caller's own row.
  const userRows = (isOwner: boolean) => (where: SQL | undefined) =>
    paramsOf(where).includes("u-other") ? [otherUser("u-other")] : [caller(isOwner)];

  it("is mounted (it used to 404 for everyone, owner included)", async () => {
    const store = new FakeCredentialStore();
    store.seed({ authUserId: "au-other", companyId: OTHER_COMPANY, email: "someone@other.co.th" });
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, userRows(true)]] }),
        credentials: store,
      })
    ).inject({ method: "POST", url: RESET_URL });
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).toBe(200);
  });

  it("403s a tenant non-owner BEFORE any cross-tenant read or token issue", async () => {
    const store = new FakeCredentialStore();
    store.seed({ authUserId: "au-other", companyId: OTHER_COMPANY, email: "someone@other.co.th" });
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, userRows(false)]] }),
        credentials: store,
      })
    ).inject({ method: "POST", url: RESET_URL });
    expect(res.statusCode).toBe(403);
    expect(store.tokens.size).toBe(0);
    expect(delivered).toHaveLength(0);
  });

  it("401s a session-less request", async () => {
    const res = await (await buildTestApp()).inject({ method: "POST", url: RESET_URL });
    expect(res.statusCode).toBe(401);
  });

  it("issues a token delivered ONLY to the target user, never returned to the owner", async () => {
    const store = new FakeCredentialStore();
    store.seed({ authUserId: "au-other", companyId: OTHER_COMPANY, email: "someone@other.co.th" });
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, userRows(true)]] }),
        credentials: store,
      })
    ).inject({ method: "POST", url: RESET_URL });

    expect(res.statusCode).toBe(200);
    expect(store.tokens.size).toBe(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.kind).toBe("admin");
    expect(delivered[0]!.to).toBe("someone@other.co.th");
    // The owner never sees the token or any password.
    expect(res.body).not.toContain(delivered[0]!.token);
    expect(res.json().password).toBeUndefined();
    // The owner also never SETS a password — only a reset link is issued.
    expect(store.accounts.get("au-other")!.password).toBeNull();
  });

  it("audits the AFFECTED tenant, not the owner's own company", async () => {
    const store = new FakeCredentialStore();
    store.seed({ authUserId: "au-other", companyId: OTHER_COMPANY, email: "someone@other.co.th" });
    const audited: AuditRecord[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, userRows(true)]] }),
        credentials: store,
        auditSink: async (r) => void audited.push(r),
      })
    ).inject({ method: "POST", url: RESET_URL });

    expect(audited).toHaveLength(1);
    expect(audited[0]!.companyId).toBe(OTHER_COMPANY);
  });

  it("404s an unknown user without issuing anything", async () => {
    const store = new FakeCredentialStore();
    // A credential DOES exist for someone@other.co.th — the 404 must come from
    // the unknown user id, not from an accidentally-empty credential store.
    store.seed({ authUserId: "au-other", companyId: OTHER_COMPANY, email: "someone@other.co.th" });
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        // "ghost" matches no user row; the caller's own row still resolves.
        db: stubDb({
          rows: [
            [
              users,
              (where: SQL | undefined) =>
                paramsOf(where).includes("ghost") ? [] : [caller(true)],
            ],
          ],
        }),
        credentials: store,
      })
    ).inject({ method: "POST", url: "/api/v1/admin/users/ghost/reset-password" });
    expect(res.statusCode).toBe(404);
    expect(store.tokens.size).toBe(0);
  });

  it("404s a user that has no credential at all (a pre-B-282 invite)", async () => {
    const store = new FakeCredentialStore(); // nothing seeded
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, userRows(true)]] }),
        credentials: store,
      })
    ).inject({ method: "POST", url: RESET_URL });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    expect(store.tokens.size).toBe(0);
  });
});

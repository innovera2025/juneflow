// G3 unit tests (PLAN.md §9) — GET + POST /users (P1-BE-09, B-051; master.jsx
// UsersPermissions/UserAddForm). Covers the B-014 envelope + wire shape with the
// username DERIVED from email, tenant scope (no leak), the invite create
// (status starts `invited`, department normalized, duplicate email 409, canSave
// validation), the B-082 F1 function-level authorization guard, and — B-282 —
// the credential the invite now provisions (without which the invited user
// could never log in at all).
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { users, roles, subscriptions } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import type { ResetDeliveryMessage } from "../auth-provisioning.js";
import { FakeCredentialStore } from "../auth-provisioning-fake.js";
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
interface Deleted {
  table: unknown;
  where: SQL | undefined;
}
interface Locked {
  table: unknown;
  mode: string;
  /** How many writes had already been recorded when the lock was taken. */
  writesBefore: number;
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
  deleted: Deleted[] = [],
  // B-363: every `SELECT … FOR <mode>` the request took, in order — the seat lock
  // is a row lock, so a test has to be able to see it was taken AT ALL and on WHICH
  // table (the shape `selectForUpdate` compiles to: .where().orderBy().for("update")).
  locked: Locked[] = [],
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
  // A read result that is awaitable AND carries the locking tail
  // (`.orderBy(...).for("update")`) TenantDb.selectForUpdate appends.
  const resultFor = (table: unknown, where: SQL | undefined) => {
    const result = {
      orderBy: () => result,
      for: (mode: string) => {
        locked.push({ table, mode, writesBefore: inserted.length + deleted.length });
        return result;
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) =>
        Promise.resolve(selectFrom(table, where)).then(onOk, onErr),
    };
    return result;
  };
  const builderFor = (table: unknown) => {
    const builder = {
      $dynamic: () => builder,
      innerJoin: () => builder,
      where: (where: SQL) => {
        captured.push({ table, where });
        return resultFor(table, where);
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) => {
        captured.push({ table, where: undefined });
        return Promise.resolve(selectFrom(table, undefined)).then(onOk, onErr);
      },
    };
    return builder;
  };
  let seq = 0;
  const handle: Record<string, unknown> = {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
    insert: (table: unknown) => ({
      // B-388 · BOTH insert doors. TenantDb.insert() returns the builder WITHOUT
      // .returning() and the caller awaits it directly, so a `.returning()`-only
      // stub records nothing for such a write and every absence assertion about
      // it is vacuous. One `record()` closure sits behind both doors — invoked
      // once per DOOR CALL, never in the `values(...)` body (which would make
      // `.returning()` double-count). Evidence at the foot of this file.
      values: (values: Record<string, unknown>) => {
        const record = (): Record<string, unknown>[] => {
          inserted.push({ table, values });
          return [{ id: `new-${seq++}`, ...values }];
        };
        return {
          returning: () => Promise.resolve(record()),
          // The awaited-directly door (plain scoped insert, no .returning()).
          then: (onOk: (r: unknown) => unknown, onErr: (e: unknown) => unknown) =>
            Promise.resolve(record()).then(onOk, onErr),
        };
      },
    }),
    // B-282: the invite compensates a failed credential provision by deleting
    // the dictionary row it just wrote, so the stub has to record deletes.
    delete: (table: unknown) => ({
      where: (where: SQL) => {
        deleted.push({ table, where });
        return Promise.resolve([]);
      },
    }),
  };
  // B-363: the seat decision + the `user` insert now run inside ONE transaction.
  // The stub runs the callback against ITSELF (the gr.test.ts / inventory.test.ts
  // precedent), so every write still lands in the capture arrays.
  //
  // BE CLEAR ABOUT WHAT THIS MODELS. It gives the handler a transaction SHAPE and a
  // lock SHAPE. It does NOT roll back and it does not block, so NO test in this file
  // can prove the exactly-one-winner property — that is the live harness's job
  // (4 concurrent invites, separate OS processes, one free seat), reported in the
  // commit rather than implied here.
  handle.transaction = (cb: (tx: unknown) => unknown) => cb(handle);
  return handle as unknown as Db;
}

function paramsOf(where: SQL | undefined): unknown[] {
  if (!where) return [];
  return new PgDialect().sqlToQuery(where).params;
}

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

// B-282: buildApp defaults `credentials` to the REAL DbCredentialStore, so every
// test that reaches the invite must opt into the in-memory fake explicitly.
let credentials: FakeCredentialStore;
let delivered: ResetDeliveryMessage[];

async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<FastifyInstance> {
  credentials = (overrides.credentials as FakeCredentialStore | undefined) ?? new FakeCredentialStore();
  delivered = [];
  app = await buildApp({
    db: overrides.db ?? stubDb([], COMPANY),
    resolveTenant: overrides.resolveTenant ?? (async () => null),
    signIn: overrides.signIn ?? (async () => null),
    storage: overrides.storage ?? createFakeR2Storage("https://r2.test"),
    quota: overrides.quota ?? new QuotaGuard({ resolver: unlimitedQuotaResolver, upgradeUrl: "https://upgrade.test" }),
    auditSink: overrides.auditSink ?? (async () => {}),
    credentials,
    deliverReset: overrides.deliverReset ?? ((m) => void delivered.push(m)),
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

// --- B-282: the invite must actually provision a credential -----------------
// Before this, POST /users wrote the dictionary row and stopped: no auth_user,
// no auth_account, no token, nothing sent. The invited user could never log in.
describe("POST /api/v1/users — B-282 credential provisioning", () => {
  const invite = async (payload: Record<string, unknown>, store?: FakeCredentialStore) =>
    (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[roles, [roleRow]], [users, [caller]]], COMPANY),
        credentials: store,
      })
    ).inject({ method: "POST", url: "/api/v1/users", payload });

  it("creates the auth account bound to THIS tenant, with no password yet", async () => {
    const res = await invite({ name: "นภา ศรีสุข", email: "napha@juneflow.co.th", role_id: "role-pm" });
    expect(res.statusCode).toBe(201);

    const account = await credentials.findByEmail("napha@juneflow.co.th");
    expect(account).not.toBeNull();
    expect(account!.companyId).toBe(COMPANY);
    // Passwordless on purpose — better-auth refuses to sign in such an account,
    // so an invite cannot be used until it is completed via /auth/reset.
    expect(credentials.accounts.get(account!.authUserId)!.password).toBeNull();
    expect(credentials.signInWith("napha@juneflow.co.th", "anything")).toBeNull();
  });

  it("issues a set-your-password token and hands it to delivery — never to the client", async () => {
    const res = await invite({ name: "นภา ศรีสุข", email: "napha@juneflow.co.th", role_id: "role-pm" });

    expect(credentials.tokens.size).toBe(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.kind).toBe("invite");
    expect(delivered[0]!.to).toBe("napha@juneflow.co.th");
    // The 201 body must not carry the token in any form.
    expect(res.body).not.toContain(delivered[0]!.token);
    expect(res.json().token).toBeUndefined();
  });

  it("canonicalizes the email so the credential and the dictionary row agree", async () => {
    // A mixed-case invite must not provision a credential nobody can sign in
    // with — that is the same "can never log in" failure in a different disguise.
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[roles, [roleRow]], [users, [caller]]], COMPANY, [], inserted),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/users",
      payload: { name: "นภา ศรีสุข", email: "  Napha@Juneflow.CO.TH ", role_id: "role-pm" },
    });

    expect(res.statusCode).toBe(201);
    expect(inserted[0]!.values.email).toBe("napha@juneflow.co.th");
    expect(await credentials.findByEmail("napha@juneflow.co.th")).not.toBeNull();
  });

  it("still invites an address another TENANT holds — the B-283 block is NOT shipped", async () => {
    // auth_user.email is unique platform-wide (migration 0008), so this invite
    // cannot be credentialed. That is a schema fact, not a licence to refuse:
    // before B-282 tenant B could invite an address tenant A held, a
    // subcontractor's PM legitimately appears in two companies, and a 409 that
    // echoes the address would make any tenant admin a cross-tenant existence
    // oracle. Narrowing the index needs a SACRED migration → Wei's ruling
    // (B-283). Until then POST /users keeps its PER-COMPANY behaviour.
    const store = new FakeCredentialStore();
    store.seed({ authUserId: "au-other", companyId: "99999999-9999-9999-9999-999999999999", email: "napha@juneflow.co.th" });
    const deleted: Deleted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[roles, [roleRow]], [users, [caller]]], COMPANY, [], [], deleted),
        credentials: store,
      })
    ).inject({
      method: "POST",
      url: "/api/v1/users",
      payload: { name: "นภา ศรีสุข", email: "napha@juneflow.co.th", role_id: "role-pm" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe("invited");
    // The dictionary row stands — exactly the pre-B-282 outcome.
    expect(deleted.find((d) => d.table === users)).toBeUndefined();
    // What is genuinely new is only that this one invite has no credential yet
    // and so cannot be completed until B-283 is answered.
    expect(store.accounts.size).toBe(1); // still just the OTHER tenant's account
    expect(store.tokens.size).toBe(0);
    expect(delivered).toHaveLength(0);
  });

  it("rolls the dictionary row back when provisioning fails outright", async () => {
    const store = new FakeCredentialStore();
    store.provisionError = new Error("connection reset");
    const deleted: Deleted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[roles, [roleRow]], [users, [caller]]], COMPANY, [], [], deleted),
        credentials: store,
      })
    ).inject({
      method: "POST",
      url: "/api/v1/users",
      payload: { name: "นภา ศรีสุข", email: "napha@juneflow.co.th", role_id: "role-pm" },
    });

    expect(res.statusCode).toBe(500);
    // The dictionary row it had already written is removed, tenant-scoped — no
    // orphan user with no way in.
    const del = deleted.find((d) => d.table === users);
    expect(del).toBeDefined();
    expect(paramsOf(del!.where)).toContain(COMPANY);
  });

  it("rolls back BOTH halves when the token cannot be stored — no orphaned credential", async () => {
    // The compensator used to delete only the dictionary row, leaving auth_user
    // + auth_account behind. auth_user_email_unique is platform-wide, so that
    // address could then never be invited again in ANY tenant, and no endpoint
    // existed that could clear it — a permanent, unrecoverable brick from one
    // dropped connection.
    const store = new FakeCredentialStore();
    store.issueError = new Error("verification insert failed");
    const deleted: Deleted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[roles, [roleRow]], [users, [caller]]], COMPANY, [], [], deleted),
        credentials: store,
      })
    ).inject({
      method: "POST",
      url: "/api/v1/users",
      payload: { name: "นภา ศรีสุข", email: "napha@juneflow.co.th", role_id: "role-pm" },
    });

    expect(res.statusCode).toBe(500);
    expect(deleted.find((d) => d.table === users)).toBeDefined();
    // The credential is gone too — the address can be invited again.
    expect(store.deprovisioned).toHaveLength(1);
    expect(await store.findByEmail("napha@juneflow.co.th")).toBeNull();
    expect(store.accounts.size).toBe(0);
  });

  it("still removes the dictionary row when the credential cleanup ITSELF fails", async () => {
    // A compensator that throws must not swallow the original failure or skip
    // the rest of the rollback; the orphan it could not clear is logged, loudly.
    const store = new FakeCredentialStore();
    store.issueError = new Error("verification insert failed");
    store.deprovisionError = new Error("connection reset");
    const deleted: Deleted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[roles, [roleRow]], [users, [caller]]], COMPANY, [], [], deleted),
        credentials: store,
      })
    ).inject({
      method: "POST",
      url: "/api/v1/users",
      payload: { name: "นภา ศรีสุข", email: "napha@juneflow.co.th", role_id: "role-pm" },
    });

    expect(res.statusCode).toBe(500);
    expect(deleted.find((d) => d.table === users)).toBeDefined();
  });

  it("still creates the user when only DELIVERY fails (recoverable via forgot)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[roles, [roleRow]], [users, [caller]]], COMPANY),
        deliverReset: () => {
          throw new Error("smtp is down");
        },
      })
    ).inject({
      method: "POST",
      url: "/api/v1/users",
      payload: { name: "นภา ศรีสุข", email: "napha@juneflow.co.th", role_id: "role-pm" },
    });

    expect(res.statusCode).toBe(201);
    // The account and its token are valid; only the mail was lost.
    expect(await credentials.findByEmail("napha@juneflow.co.th")).not.toBeNull();
    expect(credentials.tokens.size).toBe(1);
  });

  it("provisions nothing when the invite is rejected (403 / 400 / same-company 409)", async () => {
    // A rejected invite must leave no credential behind.
    const lowRole = { ...roleRow, id: "role-low", perms: { pr: { view: true, create: true, edit: false, approve: false, cancel: false } } };
    const lowUser = { ...caller, id: "u-low", roleId: "role-low" };
    const forbidden = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[roles, [lowRole]], [users, [lowUser]]], COMPANY),
      })
    ).inject({ method: "POST", url: "/api/v1/users", payload: { name: "X", email: "x@y.co", role_id: "role-low" } });
    expect(forbidden.statusCode).toBe(403);
    expect(credentials.accounts.size).toBe(0);
    await app.close();

    const badEmail = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[roles, [roleRow]], [users, [caller]]], COMPANY),
      })
    ).inject({ method: "POST", url: "/api/v1/users", payload: { name: "X", email: "no-at", role_id: "role-pm" } });
    expect(badEmail.statusCode).toBe(400);
    expect(credentials.accounts.size).toBe(0);
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

// --- B-369: the seat meter -------------------------------------------------
// `quota.check(` had exactly three call sites in apps/api — ai-qto, projects,
// files — and NO `users` one, so the sold seat cap (starter 5 / pro 25 /
// business 60, PACKAGE-RULES §1) was never enforced anywhere.
describe("POST /api/v1/users — B-369 seat quota", () => {
  /** A resolver reporting a fixed dimension state (the prod resolver's shape). */
  const guardWith = (limit: number, used: number) =>
    new QuotaGuard({
      resolver: { async resolve() { return { limit, used }; } },
      upgradeUrl: "https://upgrade.test",
    });

  const inviteWith = async (
    quota: QuotaGuard,
    rows: Array<[unknown, unknown[]]> = [[roles, [roleRow]], [users, [caller]]],
    inserted: Inserted[] = [],
  ) =>
    (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(rows, COMPANY, [], inserted),
        quota,
      })
    ).inject({
      method: "POST",
      url: "/api/v1/users",
      payload: { name: "นภา ศรีสุข", email: "napha@juneflow.co.th", role_id: "role-pm" },
    });

  it("402s the contract QuotaExceededError once the seats are full", async () => {
    const inserted: Inserted[] = [];
    const res = await inviteWith(guardWith(5, 5), undefined, inserted);
    expect(res.statusCode).toBe(402);
    expect(res.json()).toEqual({
      code: "QUOTA_EXCEEDED",
      message: "Quota exceeded for users",
      upgrade_url: "https://upgrade.test",
    });
    // NOTHING is written: no dictionary row…
    expect(inserted.find((i) => i.table === users)).toBeUndefined();
    // …and no orphaned auth credential / invite token either. The two live behind
    // different handles and cannot share a transaction (B-282), so the 402 has to
    // land before either exists.
    expect(credentials.accounts.size).toBe(0);
    expect(credentials.tokens.size).toBe(0);
    expect(delivered).toHaveLength(0);
  });

  it("admits the invite while a seat remains", async () => {
    const res = await inviteWith(guardWith(5, 4));
    expect(res.statusCode).toBe(201);
  });

  it("an unlimited (-1) seat allowance never 402s", async () => {
    const res = await inviteWith(guardWith(-1, 9999));
    expect(res.statusCode).toBe(201);
  });

  it("403 BEATS 402 — a caller who may not administer users is not sold seats", async () => {
    const lowRole = { ...roleRow, id: "role-low", perms: { pr: { view: true, create: false, edit: false, approve: false, cancel: false } } };
    const lowUser = { ...caller, id: "u-low", roleId: "role-low" };
    const res = await inviteWith(guardWith(5, 5), [[roles, [lowRole]], [users, [lowUser]]]);
    expect(res.statusCode).toBe(403);
  });

  it("409 BEATS 402 — re-inviting an existing member is the more specific answer", async () => {
    const existing = { ...caller, id: "u-dup", email: "napha@juneflow.co.th" };
    const res = await inviteWith(guardWith(5, 5), [[roles, [roleRow]], [users, [caller, existing]]]);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_EMAIL");
  });
});

// --- B-363: the seat meter is no longer a TOCTOU ---------------------------
// B-369 shipped `quota.check` -> INSERT with nothing between them. Live, 4
// concurrent invites against ONE free seat produced `cap=16 before=15 after=17`
// — two 201s for one seat. ai-qto.ts consumeAiCredit had already solved exactly
// this (lock the meter row, re-decide under it) in the same commit; only one of
// the two sold dimensions got the treatment.
describe("POST /api/v1/users — B-363 the seat lock", () => {
  const guardCounting = (limit: number, used: () => number, calls: number[] = []) =>
    new QuotaGuard({
      resolver: {
        async resolve() {
          calls.push(Date.now());
          return { limit, used: used() };
        },
      },
      upgradeUrl: "https://upgrade.test",
    });

  const invite = async (opts: {
    quota: QuotaGuard;
    /** The tenant's user rows — what the count UNDER THE LOCK will see. */
    seated?: unknown[];
    inserted?: Inserted[];
    locked?: Locked[];
    deleted?: Deleted[];
  }) =>
    (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(
          [[roles, [roleRow]], [users, opts.seated ?? [caller]]],
          COMPANY,
          [],
          opts.inserted ?? [],
          opts.deleted ?? [],
          opts.locked ?? [],
        ),
        quota: opts.quota,
      })
    ).inject({
      method: "POST",
      url: "/api/v1/users",
      payload: { name: "นภา ศรีสุข", email: "napha@juneflow.co.th", role_id: "role-pm" },
    });

  it("takes a FOR UPDATE lock on `subscription` BEFORE any row is written", async () => {
    const inserted: Inserted[] = [];
    const locked: Locked[] = [];
    const res = await invite({ quota: guardCounting(5, () => 4), inserted, locked });
    expect(res.statusCode).toBe(201);

    const lock = locked.find((l) => l.table === subscriptions);
    expect(lock, "the invite must lock the subscription row").toBeTruthy();
    expect(lock!.mode).toBe("update"); // FOR UPDATE — not a plain read
    // …and it is taken before the `user` INSERT, so the decision that follows it
    // is the one the winner's commit is measured against.
    expect(lock!.writesBefore).toBe(0);
    expect(inserted.find((i) => i.table === users)).toBeTruthy();
  });

  /**
   * THE LOSER'S VIEW, which is the whole point of the lock: the pre-check saw a
   * free seat (`limit 2, used 1`), and by the time this request holds the
   * subscription row the tenant really has 2 users — the winner committed while we
   * waited. The count that decides is the one taken UNDER the lock; decide from the
   * pre-check instead and this invite is a 201 for a seat that is already sold.
   */
  const loserSetup = {
    quota: guardCounting(2, () => 1),
    seated: [caller, { ...caller, id: "u-winner", email: "winner@juneflow.co.th" }],
  };

  it("decides from the count taken UNDER the lock, not from the pre-check", async () => {
    const inserted: Inserted[] = [];
    const res = await invite({ ...loserSetup, inserted });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("QUOTA_EXCEEDED");
    expect(inserted.find((i) => i.table === users)).toBeUndefined();
  });

  it("a refusal under the lock writes NOTHING — no dictionary row, no credential, no token", async () => {
    const inserted: Inserted[] = [];
    const locked: Locked[] = [];
    const res = await invite({ ...loserSetup, inserted, locked });
    expect(res.statusCode).toBe(402);
    expect(res.json()).toEqual({
      code: "QUOTA_EXCEEDED",
      message: "Quota exceeded for users",
      upgrade_url: "https://upgrade.test",
    });
    // The lock WAS taken (the refusal is a decision, not a skipped path)…
    expect(locked.find((l) => l.table === subscriptions)).toBeTruthy();
    // …and the transaction wrote nothing.
    expect(inserted.find((i) => i.table === users)).toBeUndefined();
    expect(credentials.accounts.size).toBe(0);
    expect(credentials.tokens.size).toBe(0);
    expect(delivered).toHaveLength(0);
  });

  it("asks the RESOLVER exactly once — never a second pooled connection inside the transaction", async () => {
    // Measured hazard, not style: SubscriptionQuotaResolver builds its own TenantDb
    // over the ROOT POOLED handle. Calling it inside the transaction makes a request
    // that already holds one connection wait for another; at 12 concurrent invites
    // the first cut of this fix deadlocked the pool (pg_stat_activity: 11 active +
    // 1 "idle in transaction"). The limit is read ONCE, before the transaction.
    const calls: unknown[] = [];
    const quota = new QuotaGuard({
      resolver: {
        async resolve() {
          calls.push(1);
          return { limit: 5, used: 1 };
        },
      },
      upgradeUrl: "https://upgrade.test",
    });
    const res = await invite({ quota });
    expect(res.statusCode).toBe(201);
    expect(calls).toHaveLength(1);
  });

  it("the seat lock governs `users` only — it never locks another tenant table", async () => {
    const locked: Locked[] = [];
    await invite({ quota: guardCounting(-1, () => 0), locked });
    expect(locked.every((l) => l.table === subscriptions)).toBe(true);
  });
});

// ===========================================================================
// B-388 · SINGLE-RECORDING EVIDENCE for the both-doors insert stub.
//
// Converting a `.returning()`-only stub is behaviourally INERT in this file —
// nothing this route does today writes through the bare TenantDb.insert() door,
// so no assertion above changed verdict when this landed and a green suite is
// NOT evidence the conversion is right. The defect a conversion can introduce is
// a DOUBLE-count (the recording closure invoked on the way in as well as per
// door) or a second door that records somewhere else. Neither is visible to
// stub-insert-door.enforce.test.ts, which proves a `then` KEY EXISTS — not that
// it records correctly. So the recording is asserted here, directly.
// ===========================================================================
describe("B-388 · stubDb's two insert doors record identically, once each", () => {
  interface Door {
    values: (v: Record<string, unknown>) => PromiseLike<Record<string, unknown>[]> & {
      returning: () => Promise<Record<string, unknown>[]>;
    };
  }
  const doorOf = (db: Db, table: unknown): Door =>
    (db as unknown as { insert: (t: unknown) => Door }).insert(table);

  it("records exactly +1 per write and resolves identically, through EITHER door", async () => {
    const inserted: Inserted[] = [];
    const db = stubDb([], COMPANY, [], inserted);

    expect(inserted).toHaveLength(0);
    const bare = await doorOf(db, users).values({ email: "bare@x.test" });
    expect(inserted).toHaveLength(1);
    const ret = await doorOf(db, users).values({ email: "ret@x.test" }).returning();
    expect(inserted).toHaveLength(2);

    expect(inserted).toEqual([
      { table: users, values: { email: "bare@x.test" } },
      { table: users, values: { email: "ret@x.test" } },
    ]);
    // The ids prove `seq` advanced exactly ONCE per write — no door double-recorded.
    expect(bare).toEqual([{ id: "new-0", email: "bare@x.test" }]);
    expect(ret).toEqual([{ id: "new-1", email: "ret@x.test" }]);
  });
});

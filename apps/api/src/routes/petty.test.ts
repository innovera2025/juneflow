// G3 unit tests (PLAN.md §9) — Petty-cash claim handlers (B-233 · Wei=ก
// claim-MVP). Covers the two /petty endpoints (401 fail-closed, 403 without the
// finance.create perm, create with a SERVER-generated PT-YYYY-NNNN + status
// pending + company_id force-set + the 400/404 guards + the ≤ 10,000 cap, and the
// list envelope with FK-resolved display names + type/status filters), PLUS the
// shared /gl/post inbox path posting a pending claim to a BALANCED Dr 5100 /
// Cr 1010 JV (Wei C-177) with source_doc idempotency and the petty status flip.
// Every expected value comes from the stub — never hand-computed against the impl.
//
// The routes are registered onto the built app in buildTestApp (app.ts wiring —
// registerPettyRoute / registerGlRoute). The root tenant-scope + audit hooks
// apply to them exactly as to the other wired routes.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  costCenters,
  glAccounts,
  jvLines,
  jvs,
  pettyCashTxns,
  projects,
  roles,
  users,
} from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";
import type { AuditRecord } from "../plugins/audit-log.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "suda@rungrueang.co.th", name: "สุดา" },
};
const D = new Date(1_700_000_000_000);

/** A canned rows source: a fixed list, or a where-aware fn (a table read more than
 *  once with different predicates — e.g. jvs ownership vs list scan). */
type RowSource = unknown[] | ((where: SQL | undefined) => unknown[]);
interface Captured {
  table: unknown;
  where: SQL | undefined;
}
interface Inserted {
  table: unknown;
  values: Record<string, unknown> | Record<string, unknown>[];
}
interface Updated {
  table: unknown;
  set: Record<string, unknown>;
  where: SQL;
}
interface StubOpts {
  rows: Array<[unknown, RowSource]>;
  captured?: Captured[];
  inserted?: Inserted[];
  updated?: Updated[];
}

/** Db stub: canned rows per table (reads) + write capture (mirrors ap-cndn.test.ts). */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [], updated = [] } = opts;
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
  let seq = 0;
  const raw: Record<string, unknown> = {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
    insert: (table: unknown) => ({
      // B-388 · BOTH insert doors. TenantDb.insert() returns the builder WITHOUT
      // .returning() and the caller awaits it directly, so a `.returning()`-only
      // stub records nothing for such a write and every absence assertion about
      // it is vacuous. One `record()` closure sits behind both doors — invoked
      // once per DOOR CALL, never in the `values(...)` body (which would make
      // `.returning()` double-count). Evidence at the foot of this file.
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        const record = (): Record<string, unknown>[] => {
          inserted.push({ table, values });
          const arr = Array.isArray(values) ? values : [values];
          return arr.map((v) => {
            const row = v as Record<string, unknown>;
            return { id: row.id ?? `new-${seq++}`, createdAt: D, ...row };
          });
        };
        return {
          returning: () => Promise.resolve(record()),
          // The awaited-directly door (plain scoped insert, no .returning()).
          then: (onOk: (r: unknown) => unknown, onErr: (e: unknown) => unknown) =>
            Promise.resolve(record()).then(onOk, onErr),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: () => {
            updated.push({ table, set, where });
            return Promise.resolve([{ id: "upd", ...set }]);
          },
        }),
      }),
    }),
  };
  // B-097: the transaction door runs its callback against this SAME stub.
  raw.transaction = (cb: (tx: unknown) => unknown) => cb(raw);
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
  return app;
}

// --- seed-shaped canned rows ------------------------------------------------
// Valid hex uuids — the source_doc "petty:<uuid>" ref matches SOURCE_DOC_REF only
// for a hex-and-dash uuid (the idempotency test posts/reads that ref).
const PROJECT = "44444444-4444-4444-4444-444444444444";
const CC = "55555555-5555-5555-5555-555555555555";
const PETTY0 = "66666666-6666-6666-6666-666666666666";

const userRow = {
  id: "u-0",
  companyId: COMPANY,
  email: "suda@rungrueang.co.th",
  name: "สุดา",
  roleId: "role-0",
  status: "active",
  isPlatformAdmin: false,
};
/** A role carrying (or not) the finance.create / finance.approve perms. */
const roleRow = (financeCreate = true, financeApprove = true) => ({
  id: "role-0",
  companyId: COMPANY,
  name: "Finance",
  approvalLimits: {},
  perms: {
    finance: {
      view: true,
      create: financeCreate,
      edit: true,
      approve: financeApprove,
      cancel: false,
    },
  },
  approvalLevel: 3,
  approvalLimit: null,
  currencyCode: "THB",
  createdAt: D,
  updatedAt: D,
});

const projectRow = { id: PROJECT, companyId: COMPANY, name: "เฟส 2 · Block B", createdAt: D, updatedAt: D };
const ccRow = { id: CC, projectId: PROJECT, code: "CC-01", name: "Site B", createdAt: D, updatedAt: D };

const pettySeed = (
  id: string,
  extra: Partial<typeof pettyCashTxns.$inferSelect> = {},
): typeof pettyCashTxns.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    no: "PT-2026-0001",
    type: "claim",
    label: "ค่าน้ำดื่ม + อาหารทีมงาน Site B",
    value: "3200.00",
    currencyCode: "THB",
    byUserId: "u-0",
    txnDate: "2026-05-25",
    status: "pending",
    cat: "Welfare",
    ref: null,
    ccId: CC,
    projectId: PROJECT,
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof pettyCashTxns.$inferSelect;

// The tenant COA rows the petty JV resolves: admin-expense 5100 (Dr) + cash 1010 (Cr).
const ACC_ADMIN = "acc-5100";
const ACC_CASH = "acc-1010";
const coaRows = [
  { id: ACC_ADMIN, companyId: COMPANY, code: "5100", name: "ค่าใช้จ่ายในการบริหาร" },
  { id: ACC_CASH, companyId: COMPANY, code: "1010", name: "เงินสดในมือ" },
];

// ===========================================================================
// GET /petty
// ===========================================================================
describe("GET /api/v1/petty", () => {
  const listDb = (petty: unknown[]) =>
    stubDb({
      rows: [
        [pettyCashTxns, petty],
        [users, [userRow]],
        [projects, [projectRow]],
        [costCenters, [ccRow]],
      ],
    });

  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/petty" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("envelopes the txns newest-first with FK-resolved display names", async () => {
    const older = pettySeed("older", { createdAt: new Date("2024-01-10T00:00:00Z"), no: "PT-2026-0001" });
    const newer = pettySeed("newer", { createdAt: new Date("2024-02-10T00:00:00Z"), no: "PT-2026-0002" });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: listDb([older, newer]) })
    ).inject({ method: "GET", url: "/api/v1/petty" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data[0].id).toBe("newer"); // newest first
    const row = body.data[0];
    expect(row.value).toBe(3200);
    expect(row.currency_code).toBe("THB");
    expect(row.by).toBe("สุดา"); // by_user_id → user name, never a raw uuid
    expect(row.by_user_id).toBe("u-0");
    expect(row.project_name).toBe("เฟส 2 · Block B"); // project_id → project name
    expect(row.project_id).toBe(PROJECT);
    expect(row.cc_name).toBe("Site B"); // cc_id → cost-center name
    expect(row.status).toBe("pending");
  });

  it("filters by ?type=", async () => {
    const claim = pettySeed("c1", { type: "claim" });
    const topup = pettySeed("t1", { type: "topup", cat: "Top-up" });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: listDb([claim, topup]) })
    ).inject({ method: "GET", url: "/api/v1/petty?type=claim" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data[0].id).toBe("c1");
    expect(body.data[0].type).toBe("claim");
  });

  it("filters by ?status=", async () => {
    const pending = pettySeed("p1", { status: "pending" });
    const posted = pettySeed("p2", { status: "posted" });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: listDb([pending, posted]) })
    ).inject({ method: "GET", url: "/api/v1/petty?status=posted" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data[0].id).toBe("p2");
    expect(body.data[0].status).toBe("posted");
  });
});

// ===========================================================================
// POST /petty — create a claim
// ===========================================================================
describe("POST /api/v1/petty", () => {
  const createDb = (opts: { inserted?: Inserted[]; existing?: unknown[]; create?: boolean; project?: unknown[] } = {}) =>
    stubDb({
      rows: [
        [pettyCashTxns, opts.existing ?? []], // allocPettyNo running-number scan
        [users, [userRow]],
        [roles, [roleRow(opts.create ?? true)]],
        [projects, opts.project ?? [projectRow]],
        [costCenters, [ccRow]],
      ],
      inserted: opts.inserted,
    });

  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/petty",
      payload: { category: "Welfare", amount: 3200, description: "ค่าอาหาร" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s a caller without the finance.create perm (fail closed)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[users, [userRow]], [roles, [roleRow(false)]]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/petty",
      payload: { category: "Welfare", amount: 3200, description: "ค่าอาหาร" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance create permission/);
  });

  it("creates the claim (201) with a SERVER no PT-YYYY-NNNN, status pending, company_id force-set", async () => {
    const inserted: Inserted[] = [];
    const year = new Date().getFullYear();
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: createDb({ inserted }) })
    ).inject({
      method: "POST",
      url: "/api/v1/petty",
      payload: { category: "Welfare", amount: 3200, description: "ค่าอาหาร", project_id: PROJECT },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.no).toBe(`PT-${year}-0001`); // server-gen, first of the year
    expect(body.status).toBe("pending");
    expect(body.type).toBe("claim");
    expect(body.value).toBe(3200);
    expect(body.by).toBe("สุดา"); // attributed to the caller (server-side ผู้เบิก)
    expect(body.project_name).toBe("เฟส 2 · Block B");

    const ins = inserted.find((i) => i.table === pettyCashTxns);
    expect(ins).toBeTruthy();
    const claim = ins!.values as Record<string, unknown>;
    expect(claim.companyId).toBe(COMPANY); // force-set by the scoped insert
    expect(claim.type).toBe("claim");
    expect(claim.status).toBe("pending");
    expect(claim.value).toBe("3200.00");
    expect(claim.byUserId).toBe("u-0");
    expect(String(claim.no)).toBe(`PT-${year}-0001`);
  });

  it("server-gen no continues past the tenant's max suffix (+1)", async () => {
    const inserted: Inserted[] = [];
    const year = new Date().getFullYear();
    const existing = [
      pettySeed("e1", { no: `PT-${year}-0007` }),
      pettySeed("e2", { no: `PT-${year}-0003` }),
    ];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: createDb({ inserted, existing }) })
    ).inject({
      method: "POST",
      url: "/api/v1/petty",
      payload: { category: "Welfare", amount: 100, description: "ค่าอาหาร" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().no).toBe(`PT-${year}-0008`); // max 0007 + 1
  });

  it("400s a missing category (no insert)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: createDb({ inserted }) })
    ).inject({
      method: "POST",
      url: "/api/v1/petty",
      payload: { amount: 3200, description: "ค่าอาหาร" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/category is required/);
    expect(inserted.find((i) => i.table === pettyCashTxns)).toBeFalsy();
  });

  it("400s a missing description", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: createDb() })
    ).inject({
      method: "POST",
      url: "/api/v1/petty",
      payload: { category: "Welfare", amount: 3200 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/description is required/);
  });

  it("400s a ≤ 0 amount (no insert)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: createDb({ inserted }) })
    ).inject({
      method: "POST",
      url: "/api/v1/petty",
      payload: { category: "Welfare", amount: 0, description: "ค่าอาหาร" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/greater than zero/);
    expect(inserted.find((i) => i.table === pettyCashTxns)).toBeFalsy();
  });

  it("400s an amount over the 10,000 petty cap (no insert)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: createDb({ inserted }) })
    ).inject({
      method: "POST",
      url: "/api/v1/petty",
      payload: { category: "Vehicle", amount: 10001, description: "ซ่อมรถ" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/exceeds the petty-cash cap of 10000/);
    expect(inserted.find((i) => i.table === pettyCashTxns)).toBeFalsy();
  });

  it("404s (fail closed) a project outside the tenant (no insert)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: createDb({ inserted, project: [] }), // project absent → foreign
      })
    ).inject({
      method: "POST",
      url: "/api/v1/petty",
      payload: { category: "Welfare", amount: 3200, description: "ค่าอาหาร", project_id: PROJECT },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    expect(inserted.find((i) => i.table === pettyCashTxns)).toBeFalsy();
  });

  it("records an AuditLog row on a successful create, silent on a 4xx guard", async () => {
    const fired: AuditRecord[] = [];
    const okRes = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: createDb(),
        auditSink: (r) => { fired.push(r); },
      })
    ).inject({
      method: "POST",
      url: "/api/v1/petty",
      payload: { category: "Welfare", amount: 3200, description: "ค่าอาหาร" },
    });
    expect(okRes.statusCode).toBe(201);
    expect(fired).toHaveLength(1);

    const silent: AuditRecord[] = [];
    const badRes = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: createDb(),
        auditSink: (r) => { silent.push(r); },
      })
    ).inject({
      method: "POST",
      url: "/api/v1/petty",
      payload: { amount: 3200, description: "ค่าอาหาร" }, // missing category → 400
    });
    expect(badRes.statusCode).toBe(400);
    expect(silent).toHaveLength(0);
  });
});

// ===========================================================================
// POST /gl/post — post a pending petty claim (Dr 5100 / Cr 1010, Wei C-177)
// ===========================================================================
// jvs is read three ways: listGlPostingDocs posted-set scan (tenant scope, 1
// param) + allocJvNo (tenant scope, 1 param) → the LIST source; insertThrough
// ownership (id + company, 2 params) → an owned row. The 2-param probe is the
// ownership check; the 1-param scan returns the posted-set (empty = pending).
const jvOwnershipSource = (posted: unknown[]) => (where: SQL | undefined): unknown[] =>
  paramsOf(where).length >= 2 ? [{ id: "jv-owned", companyId: COMPANY }] : posted;

describe("POST /api/v1/gl/post — petty claim → BALANCED JV Dr 5100 / Cr 1010", () => {
  const postDb = (opts: { jv?: RowSource; inserted?: Inserted[]; updated?: Updated[]; approve?: boolean } = {}) =>
    stubDb({
      rows: [
        [pettyCashTxns, [pettySeed(PETTY0, { value: "3200.00" })]],
        [jvs, opts.jv ?? jvOwnershipSource([])],
        [glAccounts, coaRows],
        [users, [userRow]],
        [roles, [roleRow(true, opts.approve ?? true)]],
      ],
      inserted: opts.inserted,
      updated: opts.updated,
    });

  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/gl/post",
      payload: { doc_ids: [PETTY0] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s without the finance.approve perm (fail closed)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: postDb({ approve: false }) })
    ).inject({ method: "POST", url: "/api/v1/gl/post", payload: { doc_ids: [PETTY0] } });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance approve permission/);
  });

  it("posts a BALANCED 2-line JV (Dr 5100 / Cr 1010) + source_doc petty:<id> + flips the claim to posted", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const year = new Date().getFullYear();
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: postDb({ inserted, updated }) })
    ).inject({ method: "POST", url: "/api/v1/gl/post", payload: { doc_ids: [PETTY0] } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.posted).toHaveLength(1);
    expect(body.posted[0]).toMatchObject({ doc_id: PETTY0, source: "petty", jv_no: `JV-${year}-0001`, amount: 3200 });
    expect(body.skipped).toHaveLength(0);

    const jvIns = inserted.find((i) => i.table === jvs);
    expect((jvIns!.values as Record<string, unknown>).sourceDoc).toBe(`petty:${PETTY0}`);

    const lineIns = inserted.find((i) => i.table === jvLines);
    const lines = lineIns!.values as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    const sumDr = lines.reduce((s, l) => s + Number(l.dr), 0);
    const sumCr = lines.reduce((s, l) => s + Number(l.cr), 0);
    expect(sumDr).toBe(3200);
    expect(sumCr).toBe(3200); // BALANCED (C9)
    // Dr admin-expense 5100 = value, Cr cash-on-hand 1010 = value.
    expect(lines.find((l) => l.accountId === ACC_ADMIN)!.dr).toBe("3200.00");
    expect(lines.find((l) => l.accountId === ACC_CASH)!.cr).toBe("3200.00");

    // The claim status flips to `posted` in the same transaction (B-233).
    const pettyUpd = updated.find((u) => u.table === pettyCashTxns);
    expect(pettyUpd).toBeTruthy();
    expect(pettyUpd!.set.status).toBe("posted");
  });

  it("skips (idempotent) when a JV already carries the claim's source_doc — no double post", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({
          jv: jvOwnershipSource([{ id: "jv-prior", companyId: COMPANY, no: "JV-2026-0001", sourceDoc: `petty:${PETTY0}` }]),
          inserted,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/gl/post", payload: { doc_ids: [PETTY0] } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.posted).toHaveLength(0);
    expect(body.skipped[0]).toMatchObject({ doc_id: PETTY0, reason: "already posted" });
    expect(inserted.find((i) => i.table === jvs)).toBeFalsy(); // no double post
  });

  it("skips (idempotent) a concurrent double-post (23505 on the source_doc index)", async () => {
    const base = postDb({});
    const db = {
      ...(base as unknown as Record<string, unknown>),
      transaction: async () => {
        const e = new Error("duplicate key") as Error & { code: string };
        e.code = "23505";
        throw e;
      },
    } as unknown as typeof base;
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db })
    ).inject({ method: "POST", url: "/api/v1/gl/post", payload: { doc_ids: [PETTY0] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().skipped[0]).toMatchObject({ doc_id: PETTY0, reason: "already posted" });
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
    values: (
      v: Record<string, unknown> | Record<string, unknown>[],
    ) => PromiseLike<Record<string, unknown>[]> & {
      returning: () => Promise<Record<string, unknown>[]>;
    };
  }
  const doorOf = (db: Db, table: unknown): Door =>
    (db as unknown as { insert: (t: unknown) => Door }).insert(table);

  it("records exactly +1 per write and resolves identically, through EITHER door", async () => {
    const inserted: Inserted[] = [];
    const db = stubDb({ rows: [], inserted });

    expect(inserted).toHaveLength(0);
    // The awaited-directly door (what the plain scoped TenantDb.insert() hits).
    const bare = await doorOf(db, pettyCashTxns).values({ no: "bare" });
    expect(inserted).toHaveLength(1);
    // The .returning() door (insertThrough / insert(...).returning()).
    const ret = await doorOf(db, pettyCashTxns).values({ no: "ret" }).returning();
    expect(inserted).toHaveLength(2);

    expect(inserted).toEqual([
      { table: pettyCashTxns, values: { no: "bare" } },
      { table: pettyCashTxns, values: { no: "ret" } },
    ]);
    // Identical resolution shape. The ids prove `seq` advanced exactly ONCE per
    // write, so neither door invoked the recording closure twice.
    expect(bare).toEqual([{ id: "new-0", createdAt: D, no: "bare" }]);
    expect(ret).toEqual([{ id: "new-1", createdAt: D, no: "ret" }]);
  });

  it("expands an ARRAY of child rows identically through EITHER door", async () => {
    const insertedBare: Inserted[] = [];
    const bare = await doorOf(stubDb({ rows: [], inserted: insertedBare }), pettyCashTxns).values([
      { no: "a" },
      { no: "b" },
    ]);
    const insertedRet: Inserted[] = [];
    const ret = await doorOf(stubDb({ rows: [], inserted: insertedRet }), pettyCashTxns)
      .values([{ no: "a" }, { no: "b" }])
      .returning();

    // ONE recording for the batch (not one per row), and the SAME shape from both
    // doors — a divergence here is what a hand-copied `then` typically gets wrong.
    expect(insertedBare).toEqual(insertedRet);
    expect(insertedBare).toHaveLength(1);
    expect(insertedBare[0]).toEqual({ table: pettyCashTxns, values: [{ no: "a" }, { no: "b" }] });
    expect(bare).toEqual(ret);
    expect(bare).toHaveLength(2);
  });
});

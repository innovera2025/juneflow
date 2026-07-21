// G3 unit tests (PLAN.md §9) — FA (fixed asset) handlers (Phase-3 Finance
// Wave-0). Covers GET /fa/assets (list shape, EXISTING columns only, tenant
// scope) and POST /fa/assets (financial-authz finance.create gate, name
// validation, cost as stored input, cc_id tenant-ownership fail-closed, the
// company_id force-set insert, and the auto AuditLog on a successful create).
// Every expected value comes from the stub — no value is hand-computed against
// the impl.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { costCenters, fixedAssets, roles, users } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import type { AuditRecord } from "../plugins/audit-log.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "anan@rungrueang.co.th", name: "อนันต์" },
};
const D = new Date(1_700_000_000_000);

interface Captured {
  table: unknown;
  joins: unknown[];
  where: SQL | undefined;
}
interface Inserted {
  table: unknown;
  values: Record<string, unknown>[];
}
interface StubOpts {
  rows: Array<[unknown, unknown[]]>;
  captured?: Captured[];
  inserted?: Inserted[];
}

/** Db stub: canned rows per table (reads, incl. selectThrough joins) + insert capture. */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [] } = opts;
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  const builderFor = (table: unknown) => {
    const joins: unknown[] = [];
    const builder = {
      $dynamic: () => builder,
      innerJoin: (parent: unknown) => {
        joins.push(parent);
        return builder;
      },
      where: (where: SQL) => {
        captured.push({ table, joins, where });
        return Promise.resolve(rowsFor(table));
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) => {
        captured.push({ table, joins, where: undefined });
        return Promise.resolve(rowsFor(table)).then(onOk, onErr);
      },
    };
    return builder;
  };
  let seq = 0;
  return {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
        returning: () => {
          const arr = Array.isArray(values) ? values : [values];
          inserted.push({ table, values: arr });
          return Promise.resolve(
            arr.map((v, i) => ({ id: v.id ?? `new-${seq++}-${i}`, createdAt: D, ...v })),
          );
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
const CC = "cc000000-0000-0000-0000-0000000000c1";
const FA0 = "fa000000-0000-0000-0000-0000000000f0";

const faRow = (
  id: string,
  extra: Partial<typeof fixedAssets.$inferSelect> = {},
): typeof fixedAssets.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    name: "รถขุด CAT 320",
    cost: "2850000.00",
    currencyCode: "THB",
    lifeYears: 5,
    ccId: CC,
    deprMethod: "straight-line",
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof fixedAssets.$inferSelect;

// A cost_center owned by this tenant (the cc → project ownership hop resolves it).
const ccRow = { id: CC, projectId: "proj-0", code: "CC-01", name: "งานฐานราก" };

// loadCaller resolves the caller via email → dictionary user (u-0) → role.
const userRow = {
  id: "u-0",
  companyId: COMPANY,
  email: SESSION.user.email,
  name: SESSION.user.name,
  roleId: "role-0",
  status: "active",
};
/** A role carrying the finance perms the create gate reads (finance.create). */
const roleRow = (financeCreate = true) => ({
  id: "role-0",
  companyId: COMPANY,
  name: "Finance Manager",
  approvalLimits: {},
  perms: {
    finance: {
      view: true,
      create: financeCreate,
      edit: true,
      approve: true,
      cancel: false,
    },
  },
  approvalLevel: 3,
  approvalLimit: null,
  currencyCode: "THB",
  createdAt: D,
  updatedAt: D,
});

// ===========================================================================
// GET /fa/assets
// ===========================================================================
describe("GET /api/v1/fa/assets", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/fa/assets" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("returns the B-014 envelope of fixed assets — EXISTING columns only", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[fixedAssets, [faRow(FA0)]]] }),
      })
    ).inject({ url: "/api/v1/fa/assets" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    const a = body.data[0];
    expect(a.id).toBe(FA0);
    expect(a.name).toBe("รถขุด CAT 320");
    expect(a.cost).toBe(2_850_000);
    expect(a.currency_code).toBe("THB");
    expect(a.life_years).toBe(5);
    expect(a.cc_id).toBe(CC);
    expect(a.depr_method).toBe("straight-line");
    // EXISTING columns only — no salvage / accumulated / status (post-Wave-0 0035).
    expect(Object.keys(a).sort()).toEqual([
      "cc_id",
      "cost",
      "currency_code",
      "depr_method",
      "id",
      "life_years",
      "name",
    ]);
  });

  it("binds company_id on the fixed_asset read (tenant scope)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[fixedAssets, [faRow(FA0)]]], captured }),
      })
    ).inject({ url: "/api/v1/fa/assets" });
    const read = captured.find((c) => c.table === fixedAssets);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
  });
});

// ===========================================================================
// POST /fa/assets
// ===========================================================================
describe("POST /api/v1/fa/assets", () => {
  const okDb = (inserted: Inserted[] = [], captured: Captured[] = []) =>
    stubDb({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(true)]],
        [costCenters, [ccRow]],
      ],
      inserted,
      captured,
    });

  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/fa/assets",
      payload: { name: "x", cost: 1 },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });

  it("403s a caller lacking the finance-create perm (fail closed)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [users, [userRow]],
            [roles, [roleRow(/* financeCreate */ false)]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/fa/assets",
      payload: { name: "รถขุด CAT 320", cost: 2850000 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance create permission/);
    expect(inserted).toHaveLength(0); // nothing written on a denied create
  });

  it("400s when name is missing", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: okDb() })
    ).inject({ method: "POST", url: "/api/v1/fa/assets", payload: { cost: 100 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/name is required/);
  });

  it("creates an asset (201) on EXISTING columns — company_id force-set, cost stored", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: okDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/fa/assets",
      payload: {
        name: "รถขุด CAT 320",
        cost: 2850000,
        life_years: 5,
        cc_id: CC,
        depr_method: "straight-line",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("รถขุด CAT 320");
    expect(body.cost).toBe(2_850_000);
    expect(body.life_years).toBe(5);
    expect(body.cc_id).toBe(CC);
    expect(body.depr_method).toBe("straight-line");

    const ins = inserted.find((i) => i.table === fixedAssets);
    expect(ins).toBeTruthy();
    expect(ins!.values[0]!.companyId).toBe(COMPANY);
    expect(ins!.values[0]!.name).toBe("รถขุด CAT 320");
    expect(ins!.values[0]!.cost).toBe("2850000.00"); // input, 2-dp normalized
    expect(ins!.values[0]!.lifeYears).toBe(5);
    expect(ins!.values[0]!.ccId).toBe(CC);
    expect(ins!.values[0]!.deprMethod).toBe("straight-line");
  });

  it("creates a minimal asset (201) — no cc, honest nulls on the optional columns", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: okDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/fa/assets",
      payload: { name: "เครื่องผสมปูน", cost: 120000 },
    });
    expect(res.statusCode).toBe(201);
    const ins = inserted.find((i) => i.table === fixedAssets);
    expect(ins!.values[0]!.cost).toBe("120000.00");
    expect(ins!.values[0]!.lifeYears).toBeNull();
    expect(ins!.values[0]!.ccId).toBeNull();
    expect(ins!.values[0]!.deprMethod).toBeNull();
  });

  it("400s (fail closed) on a foreign cc_id — a cross-tenant cost center is never linked", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [users, [userRow]],
            [roles, [roleRow(true)]],
            [costCenters, []], // cc absent → foreign
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/fa/assets",
      payload: { name: "รถขุด CAT 320", cost: 2850000, cc_id: CC },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/cc_id not found/);
    expect(inserted).toHaveLength(0);
  });

  it("records an AuditLog row on a successful create (auto middleware)", async () => {
    const fired: AuditRecord[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: okDb(),
        auditSink: (r) => {
          fired.push(r);
        },
      })
    ).inject({
      method: "POST",
      url: "/api/v1/fa/assets",
      payload: { name: "รถขุด CAT 320", cost: 2850000 },
    });
    expect(res.statusCode).toBe(201);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.action).toBe("create");
    expect(fired[0]!.entity).toBe("/api/v1/fa/assets");
    expect(fired[0]!.companyId).toBe(COMPANY);
    expect(fired[0]!.userId).toBe("u-0"); // dictionary user via loadUserByEmail
  });
});

// G3 unit tests (PLAN.md §9) — FA (fixed asset) handlers (Phase-3 Finance).
// Wave-0 covered GET/POST /fa/assets; round-A adds the depreciation-posting +
// adjust op-set: PUT /fa/assets/{id}, POST /fa/run-depreciation, GET
// /fa/adjustments, POST /fa/write-off, POST /fa/revalue, POST /fa/import.
// Every expected value comes from the stub — no value is hand-computed against
// the impl, EXCEPT the straight-line depreciation formula (cost − salvage)/life/12
// (Wei B-123 Q1), which IS the money-authority contract under test.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  costCenters,
  faAdjustments,
  fixedAssets,
  glAccounts,
  jvLines,
  jvs,
  roles,
  users,
} from "@juneflow/db";
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
interface Updated {
  table: unknown;
  set: Record<string, unknown>;
  where: SQL | undefined;
}
interface StubOpts {
  rows: Array<[unknown, unknown[]]>;
  captured?: Captured[];
  inserted?: Inserted[];
  updated?: Updated[];
  updateBase?: Record<string, unknown>;
}

/** Db stub: canned rows per table (reads, incl. selectThrough joins) + write capture. */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [], updated = [], updateBase = {} } = opts;
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
  const raw: Record<string, unknown> = {
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
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: () => {
            updated.push({ table, set, where });
            return Promise.resolve([{ ...updateBase, ...set }]);
          },
        }),
      }),
    }),
  };
  // The transaction door runs its callback against this SAME stub, so writes
  // inside a tx still capture into inserted/updated/captured (the fake has no
  // real BEGIN/COMMIT — it proves the door threads one scoped handle).
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
const CC = "cc000000-0000-0000-0000-0000000000c1";
const FA0 = "fa000000-0000-0000-0000-0000000000f0";
// The two REAL COA accounts the FA posting map uses (JV-2026-0414 "FA auto").
const ACC_EXP = "acc00000-0000-0000-0000-000000005100"; // 5100 admin expense
const ACC_PPE = "acc00000-0000-0000-0000-000000001210"; // 1210 PP&E

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
    salvage: "0.00",
    acquiredDate: "2026-01-15",
    accumulatedDepr: "0.00",
    status: "active",
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof fixedAssets.$inferSelect;

const glAcc = (id: string, code: string, name: string) => ({
  id,
  companyId: COMPANY,
  parentId: null,
  code,
  name,
  accountType: null,
  createdAt: D,
  updatedAt: D,
});
// Both posting accounts present (the happy path resolves the 5100/1210 map).
const COA_ROWS = [
  glAcc(ACC_EXP, "5100", "ค่าใช้จ่ายบริหาร"),
  glAcc(ACC_PPE, "1210", "ที่ดิน อาคาร อุปกรณ์"),
];
// A benign existing JV so insertThrough's parent-ownership select is non-empty
// (the real DB sees the just-inserted jv in-tx; the stub reads canned rows). Its
// `no` never matches the current-year prefix, so allocJvNo starts at 0001.
const jvSeed = {
  id: "jv-seed",
  companyId: COMPANY,
  no: "OPEN-1",
  sourceDoc: "seed",
  periodId: null,
  memo: "seed",
  createdAt: D,
  updatedAt: D,
};

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
/** A role carrying the finance perms the gates read (create / approve). */
const roleRow = (financeCreate = true, financeApprove = true) => ({
  id: "role-0",
  companyId: COMPANY,
  name: "Finance Manager",
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

// ===========================================================================
// GET /fa/assets
// ===========================================================================
describe("GET /api/v1/fa/assets", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/fa/assets" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("returns the B-014 envelope of fixed assets — superset columns + derived book_value", async () => {
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
    // migration-0035 superset + derived book_value (cost − accumulated_depr).
    expect(a.salvage).toBe(0);
    expect(a.acquired_date).toBe("2026-01-15");
    expect(a.accumulated_depr).toBe(0);
    expect(a.status).toBe("active");
    expect(a.book_value).toBe(2_850_000);
    expect(Object.keys(a).sort()).toEqual([
      "accumulated_depr",
      "acquired_date",
      "book_value",
      "cc_id",
      "cost",
      "currency_code",
      "depr_method",
      "id",
      "life_years",
      "name",
      "salvage",
      "status",
    ]);
  });

  it("derives book_value from accumulated_depr (cost − accumulated)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[fixedAssets, [faRow(FA0, { cost: "100000.00", accumulatedDepr: "30000.00" })]]],
        }),
      })
    ).inject({ url: "/api/v1/fa/assets" });
    const a = res.json().data[0];
    expect(a.cost).toBe(100_000);
    expect(a.accumulated_depr).toBe(30_000);
    expect(a.book_value).toBe(70_000);
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

  it("creates an asset (201) — company_id force-set, cost + salvage + acquired_date stored", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: okDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/fa/assets",
      payload: {
        name: "รถขุด CAT 320",
        cost: 2850000,
        salvage: 150000,
        acquired_date: "2026-01-15",
        life_years: 5,
        cc_id: CC,
        depr_method: "straight-line",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("รถขุด CAT 320");
    expect(body.cost).toBe(2_850_000);
    expect(body.salvage).toBe(150_000);
    expect(body.life_years).toBe(5);
    expect(body.cc_id).toBe(CC);
    expect(body.depr_method).toBe("straight-line");

    const ins = inserted.find((i) => i.table === fixedAssets);
    expect(ins).toBeTruthy();
    expect(ins!.values[0]!.companyId).toBe(COMPANY);
    expect(ins!.values[0]!.name).toBe("รถขุด CAT 320");
    expect(ins!.values[0]!.cost).toBe("2850000.00"); // input, 2-dp normalized
    // salvage feeds the depreciation base (cost − salvage) — must persist at create.
    expect(ins!.values[0]!.salvage).toBe("150000.00");
    expect(ins!.values[0]!.acquiredDate).toBe("2026-01-15");
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

// ===========================================================================
// PUT /fa/assets/{id}
// ===========================================================================
describe("PUT /api/v1/fa/assets/:id", () => {
  const editDb = (
    opts: {
      updated?: Updated[];
      asset?: typeof fixedAssets.$inferSelect;
      cc?: unknown[];
      financeCreate?: boolean;
    } = {},
  ) =>
    stubDb({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(opts.financeCreate ?? true)]],
        [fixedAssets, opts.asset ? [opts.asset] : [faRow(FA0)]],
        [costCenters, opts.cc ?? [ccRow]],
      ],
      updated: opts.updated,
      updateBase: faRow(FA0) as unknown as Record<string, unknown>,
    });

  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      method: "PUT",
      url: `/api/v1/fa/assets/${FA0}`,
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s a caller lacking the finance-create perm", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: editDb({ updated, financeCreate: false }),
      })
    ).inject({ method: "PUT", url: `/api/v1/fa/assets/${FA0}`, payload: { name: "x" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance create permission/);
    expect(updated).toHaveLength(0);
  });

  it("404s when the asset is not in this tenant (scoped)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [users, [userRow]],
            [roles, [roleRow(true)]],
            [fixedAssets, []], // no such asset in this tenant
          ],
        }),
      })
    ).inject({ method: "PUT", url: `/api/v1/fa/assets/${FA0}`, payload: { name: "x" } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("updates ONLY the present editable columns (2-dp cost/salvage)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: editDb({ updated }) })
    ).inject({
      method: "PUT",
      url: `/api/v1/fa/assets/${FA0}`,
      payload: { name: "รถขุดใหม่", cost: 3000000, salvage: 100000, life_years: 8 },
    });
    expect(res.statusCode).toBe(200);
    const upd = updated.find((u) => u.table === fixedAssets);
    expect(upd).toBeTruthy();
    expect(upd!.set.name).toBe("รถขุดใหม่");
    expect(upd!.set.cost).toBe("3000000.00");
    expect(upd!.set.salvage).toBe("100000.00");
    expect(upd!.set.lifeYears).toBe(8);
    // depr_method / acquired_date / cc_id NOT in the body → NOT in the SET.
    expect("deprMethod" in upd!.set).toBe(false);
    expect("ccId" in upd!.set).toBe(false);
    // the tenant scope is bound on the write.
    expect(paramsOf(upd!.where)).toContain(COMPANY);
  });

  it("400s (fail closed) on a foreign cc_id — never re-parents to a cross-tenant cc", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: editDb({ updated, cc: [] }),
      })
    ).inject({
      method: "PUT",
      url: `/api/v1/fa/assets/${FA0}`,
      payload: { cc_id: CC },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/cc_id not found/);
    expect(updated).toHaveLength(0);
  });
});

// ===========================================================================
// POST /fa/run-depreciation
// ===========================================================================
describe("POST /api/v1/fa/run-depreciation", () => {
  const deprDb = (opts: {
    assets: (typeof fixedAssets.$inferSelect)[];
    jvRows?: unknown[];
    coa?: unknown[];
    inserted?: Inserted[];
    updated?: Updated[];
    financeApprove?: boolean;
  }) =>
    stubDb({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(true, opts.financeApprove ?? true)]],
        [fixedAssets, opts.assets],
        [jvs, opts.jvRows ?? [jvSeed]],
        [glAccounts, opts.coa ?? COA_ROWS],
      ],
      inserted: opts.inserted,
      updated: opts.updated,
    });

  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/fa/run-depreciation",
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s a caller lacking the finance-approve perm (money-lock gate)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: deprDb({ assets: [faRow(FA0)], inserted, financeApprove: false }),
      })
    ).inject({ method: "POST", url: "/api/v1/fa/run-depreciation", payload: { period: "2026-05" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance approve permission/);
    expect(inserted).toHaveLength(0);
  });

  it("400s on a Buddhist-Era / malformed period", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: deprDb({ assets: [faRow(FA0)] }),
      })
    ).inject({ method: "POST", url: "/api/v1/fa/run-depreciation", payload: { period: "2569-05" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/CE 'YYYY-MM'/);
  });

  it("posts (cost − salvage)/life/12 as a balanced Dr 5100 / Cr 1210 JV (NOT the mock cost/(life×12))", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    // cost 1,200,000 − salvage 200,000 = 1,000,000 base; /5/12 = 16,666.67.
    // The prototype MOCK cost/(life×12) = 1,200,000/60 = 20,000 must NOT appear.
    const asset = faRow(FA0, {
      cost: "1200000.00",
      salvage: "200000.00",
      lifeYears: 5,
      accumulatedDepr: "0.00",
    });
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: deprDb({ assets: [asset], inserted, updated }),
      })
    ).inject({ method: "POST", url: "/api/v1/fa/run-depreciation", payload: { period: "2026-05" } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period).toBe("2026-05");
    expect(body.currency_code).toBe("THB");
    expect(body.posted).toHaveLength(1);
    expect(body.posted[0].asset_id).toBe(FA0);
    expect(body.posted[0].amount).toBe(16_666.67); // server-derived, salvage-net
    expect(body.posted[0].amount).not.toBe(20_000); // NOT the fa.jsx L491 mock bug
    expect(body.posted[0].jv_no).toMatch(/^JV-\d{4}-\d{4}$/);

    // The JV lines are balanced double entry: Dr 5100 / Cr 1210 = 16,666.67.
    const lines = inserted.find((i) => i.table === jvLines);
    expect(lines).toBeTruthy();
    const [dr, cr] = lines!.values;
    expect(dr!.accountId).toBe(ACC_EXP);
    expect(dr!.dr).toBe("16666.67");
    expect(dr!.cr).toBe("0.00");
    expect(cr!.accountId).toBe(ACC_PPE);
    expect(cr!.dr).toBe("0.00");
    expect(cr!.cr).toBe("16666.67");
    // Σ dr === Σ cr.
    expect(Number(dr!.dr) + Number(cr!.dr)).toBe(Number(dr!.cr) + Number(cr!.cr));

    // The JV carries the idempotency source_doc + memo.
    const jvIns = inserted.find((i) => i.table === jvs);
    expect(jvIns!.values[0]!.sourceDoc).toBe(`fa:${FA0}`);
    expect(jvIns!.values[0]!.memo).toBe("depr:2026-05");

    // The asset's accumulated_depr advances by the posted amount.
    const upd = updated.find((u) => u.table === fixedAssets);
    expect(upd!.set.accumulatedDepr).toBe("16666.67");
  });

  it("is IDEMPOTENT per (asset, period) — skips when a matching JV already exists", async () => {
    const inserted: Inserted[] = [];
    const priorJv = {
      ...jvSeed,
      id: "jv-prior",
      no: "JV-2026-0001",
      sourceDoc: `fa:${FA0}`,
      memo: "depr:2026-05",
    };
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: deprDb({ assets: [faRow(FA0)], jvRows: [priorJv], inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/fa/run-depreciation", payload: { period: "2026-05" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.posted).toHaveLength(0);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped[0].asset_id).toBe(FA0);
    expect(body.skipped[0].reason).toMatch(/already depreciated/);
    // No JV / jv_line was inserted on an idempotent skip.
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined();
    expect(inserted.find((i) => i.table === jvLines)).toBeUndefined();
  });

  it("caps the final period's monthly to the book-value floor (accumulated ≤ cost − salvage)", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    // base = 120,000; straight monthly = 2,000; but only 1,000 remains → cap 1,000.
    const asset = faRow(FA0, {
      cost: "120000.00",
      salvage: "0.00",
      lifeYears: 5,
      accumulatedDepr: "119000.00",
    });
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: deprDb({ assets: [asset], inserted, updated }),
      })
    ).inject({ method: "POST", url: "/api/v1/fa/run-depreciation", payload: { period: "2026-06" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.posted[0].amount).toBe(1_000); // capped remainder, not 2,000
    const upd = updated.find((u) => u.table === fixedAssets);
    expect(upd!.set.accumulatedDepr).toBe("120000.00"); // floored at cost − salvage
  });

  it("skips a fully-depreciated asset (nothing remaining)", async () => {
    const inserted: Inserted[] = [];
    const asset = faRow(FA0, { cost: "120000.00", salvage: "0.00", accumulatedDepr: "120000.00" });
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: deprDb({ assets: [asset], inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/fa/run-depreciation", payload: { period: "2026-06" } });
    const body = res.json();
    expect(body.posted).toHaveLength(0);
    expect(body.skipped[0].reason).toMatch(/fully depreciated/);
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined();
  });

  it("skips a non-active / non-depreciable asset", async () => {
    const written = faRow("fa-written", { status: "written_off" });
    const noLife = faRow("fa-nolife", { lifeYears: 0 });
    const salvageHeavy = faRow("fa-salv", { cost: "100.00", salvage: "200.00" });
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: deprDb({ assets: [written, noLife, salvageHeavy] }),
      })
    ).inject({ method: "POST", url: "/api/v1/fa/run-depreciation", payload: { period: "2026-06" } });
    const body = res.json();
    expect(body.posted).toHaveLength(0);
    expect(body.skipped).toHaveLength(3);
  });

  it("C10 honest-empty: defers (skips) posting when a required COA account is absent — never invented", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: deprDb({
          assets: [faRow(FA0)],
          coa: [glAcc(ACC_EXP, "5100", "ค่าใช้จ่ายบริหาร")], // 1210 PP&E MISSING
          inserted,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/fa/run-depreciation", payload: { period: "2026-06" } });
    const body = res.json();
    expect(body.posted).toHaveLength(0);
    expect(body.skipped[0].reason).toMatch(/not found in COA/);
    // No JV posted against a fabricated account.
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined();
  });
});

// ===========================================================================
// GET /fa/adjustments
// ===========================================================================
describe("GET /api/v1/fa/adjustments", () => {
  const adjRow = (id: string, extra: Partial<typeof faAdjustments.$inferSelect> = {}) =>
    ({
      id,
      companyId: COMPANY,
      assetId: FA0,
      kind: "write_off",
      amount: "500000.00",
      currencyCode: "THB",
      jvId: "jv-1",
      memo: "write-off รถขุด CAT 320",
      status: "approved",
      createdAt: D,
      updatedAt: D,
      ...extra,
    }) as typeof faAdjustments.$inferSelect;

  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/fa/adjustments" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the envelope of adjustments (company-scoped) with the real columns", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[faAdjustments, [adjRow("adj-0")]]], captured }),
      })
    ).inject({ url: "/api/v1/fa/adjustments" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    const a = body.data[0];
    expect(a.id).toBe("adj-0");
    expect(a.asset_id).toBe(FA0);
    expect(a.kind).toBe("write_off");
    expect(a.amount).toBe(500_000);
    expect(a.currency_code).toBe("THB");
    expect(a.jv_id).toBe("jv-1");
    expect(a.status).toBe("approved");
    // company_id bound on the read (tenant scope).
    const read = captured.find((c) => c.table === faAdjustments);
    expect(paramsOf(read!.where)).toContain(COMPANY);
  });
});

// ===========================================================================
// POST /fa/write-off
// ===========================================================================
describe("POST /api/v1/fa/write-off", () => {
  const woDb = (opts: {
    asset?: typeof fixedAssets.$inferSelect;
    coa?: unknown[];
    inserted?: Inserted[];
    updated?: Updated[];
    financeApprove?: boolean;
  }) =>
    stubDb({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(true, opts.financeApprove ?? true)]],
        [fixedAssets, opts.asset === undefined ? [faRow(FA0)] : [opts.asset]],
        [jvs, [jvSeed]],
        [glAccounts, opts.coa ?? COA_ROWS],
      ],
      inserted: opts.inserted,
      updated: opts.updated,
    });

  it("403s a caller lacking finance-approve", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: woDb({ inserted, financeApprove: false }),
      })
    ).inject({ method: "POST", url: "/api/v1/fa/write-off", payload: { asset_id: FA0 } });
    expect(res.statusCode).toBe(403);
    expect(inserted).toHaveLength(0);
  });

  it("404s an asset not in this tenant", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [users, [userRow]],
            [roles, [roleRow(true, true)]],
            [fixedAssets, []],
          ],
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/fa/write-off", payload: { asset_id: FA0 } });
    expect(res.statusCode).toBe(404);
  });

  it("flips status → written_off, records the adjustment, and posts a balanced JV of book_value", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    // book_value = cost 800,000 − accumulated 300,000 = 500,000.
    const asset = faRow(FA0, { cost: "800000.00", accumulatedDepr: "300000.00" });
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: woDb({ asset, inserted, updated }),
      })
    ).inject({ method: "POST", url: "/api/v1/fa/write-off", payload: { asset_id: FA0 } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.asset_id).toBe(FA0);
    expect(body.kind).toBe("write_off");
    expect(body.amount).toBe(500_000); // server-derived carrying amount
    expect(body.jv_no).toMatch(/^JV-\d{4}-\d{4}$/);

    // status flip.
    const statusUpd = updated.find(
      (u) => u.table === fixedAssets && u.set.status === "written_off",
    );
    expect(statusUpd).toBeTruthy();

    // the fa_adjustment records the removed carrying amount.
    const adj = inserted.find((i) => i.table === faAdjustments);
    expect(adj!.values[0]!.kind).toBe("write_off");
    expect(adj!.values[0]!.amount).toBe("500000.00");
    expect(adj!.values[0]!.status).toBe("approved");
    expect(adj!.values[0]!.companyId).toBe(COMPANY);

    // balanced JV Dr 5100 / Cr 1210 = 500,000; source_doc references the adjustment.
    const lines = inserted.find((i) => i.table === jvLines);
    const [dr, cr] = lines!.values;
    expect(dr!.accountId).toBe(ACC_EXP);
    expect(dr!.dr).toBe("500000.00");
    expect(cr!.accountId).toBe(ACC_PPE);
    expect(cr!.cr).toBe("500000.00");
    const jvIns = inserted.find((i) => i.table === jvs);
    expect(String(jvIns!.values[0]!.sourceDoc)).toMatch(/^fa:/);

    // the adjustment is back-linked to its JV (jv_id set on a follow-up update).
    const backlink = updated.find(
      (u) => u.table === faAdjustments && u.set.jvId !== undefined,
    );
    expect(backlink).toBeTruthy();
  });

  it("C10 honest-empty: a zero carrying amount records the write-off but DEFERS the JV (jv_no null)", async () => {
    const inserted: Inserted[] = [];
    const asset = faRow(FA0, { cost: "100000.00", accumulatedDepr: "100000.00" }); // book_value 0
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: woDb({ asset, inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/fa/write-off", payload: { asset_id: FA0 } });
    const body = res.json();
    expect(body.amount).toBe(0);
    expect(body.jv_no).toBeNull(); // GL posting deferred (no ledger effect)
    // adjustment still recorded; no JV posted.
    expect(inserted.find((i) => i.table === faAdjustments)).toBeTruthy();
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined();
  });
});

// ===========================================================================
// POST /fa/revalue
// ===========================================================================
describe("POST /api/v1/fa/revalue", () => {
  const revalDb = (opts: {
    asset?: typeof fixedAssets.$inferSelect;
    inserted?: Inserted[];
    updated?: Updated[];
    financeApprove?: boolean;
  } = {}) =>
    stubDb({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(true, opts.financeApprove ?? true)]],
        [fixedAssets, opts.asset === undefined ? [faRow(FA0)] : [opts.asset]],
      ],
      inserted: opts.inserted,
      updated: opts.updated,
    });

  it("403s a caller lacking finance-approve", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: revalDb({ financeApprove: false }),
      })
    ).inject({ method: "POST", url: "/api/v1/fa/revalue", payload: { asset_id: FA0, new_value: 5000000 } });
    expect(res.statusCode).toBe(403);
  });

  it("400s a non-positive new_value", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: revalDb() })
    ).inject({ method: "POST", url: "/api/v1/fa/revalue", payload: { asset_id: FA0, new_value: 0 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/greater than zero/);
  });

  it("404s an asset not in this tenant", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [users, [userRow]],
            [roles, [roleRow(true, true)]],
            [fixedAssets, []], // no such asset in this tenant
          ],
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/fa/revalue", payload: { asset_id: "nope", new_value: 1 } });
    expect(res.statusCode).toBe(404);
  });

  it("sets the asset cost, records the adjustment, and DEFERS the GL posting (jvId null, C10)", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: revalDb({ inserted, updated }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/fa/revalue",
      payload: { asset_id: FA0, new_value: 5000000 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.kind).toBe("revalue");
    expect(body.amount).toBe(5_000_000);
    expect(body.jv_no).toBeNull();
    expect(body.posting_deferred).toBe(true);

    // asset cost updated to the new value.
    const costUpd = updated.find((u) => u.table === fixedAssets);
    expect(costUpd!.set.cost).toBe("5000000.00");

    // adjustment recorded with an HONEST deferred GL posting (jvId null).
    const adj = inserted.find((i) => i.table === faAdjustments);
    expect(adj!.values[0]!.kind).toBe("revalue");
    expect(adj!.values[0]!.amount).toBe("5000000.00");
    expect(adj!.values[0]!.jvId).toBeNull();
    expect(String(adj!.values[0]!.memo)).toMatch(/deferred/);

    // NO JV was posted (no revaluation-surplus account — never fabricated).
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined();
  });
});

// ===========================================================================
// POST /fa/import
// ===========================================================================
describe("POST /api/v1/fa/import", () => {
  const importDb = (opts: {
    cc?: unknown[];
    inserted?: Inserted[];
    financeCreate?: boolean;
  } = {}) =>
    stubDb({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(opts.financeCreate ?? true)]],
        [costCenters, opts.cc ?? [ccRow]],
      ],
      inserted: opts.inserted,
    });

  it("403s a caller lacking finance-create", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: importDb({ inserted, financeCreate: false }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/fa/import",
      payload: { rows: [{ name: "a" }] },
    });
    expect(res.statusCode).toBe(403);
    expect(inserted).toHaveLength(0);
  });

  it("400s (atomic) when ANY row is missing a name — nothing is imported", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: importDb({ inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/fa/import",
      payload: { rows: [{ name: "รถบด", cost: 100 }, { cost: 200 }] }, // row 2 has no name
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/row 2: name is required/);
    expect(inserted).toHaveLength(0); // atomic: NOTHING imported
  });

  it("400s (atomic) on a foreign cc_id in any row — nothing imported", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: importDb({ inserted, cc: [] }), // cc absent → foreign
      })
    ).inject({
      method: "POST",
      url: "/api/v1/fa/import",
      payload: { rows: [{ name: "รถบด", cc_id: CC }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/cc_id .* not found/);
    expect(inserted).toHaveLength(0);
  });

  it("imports all valid rows (201) — company_id force-set, 2-dp cost/salvage", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: importDb({ inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/fa/import",
      payload: {
        rows: [
          { name: "รถบดถนน", cost: 1500000, life_years: 8, salvage: 50000, cc_id: CC },
          { name: "เครื่องปั่นไฟ", cost: 90000 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.imported).toBe(2);
    expect(body.ids).toHaveLength(2);

    const assetInserts = inserted.filter((i) => i.table === fixedAssets);
    expect(assetInserts).toHaveLength(2);
    expect(assetInserts[0]!.values[0]!.companyId).toBe(COMPANY);
    expect(assetInserts[0]!.values[0]!.name).toBe("รถบดถนน");
    expect(assetInserts[0]!.values[0]!.cost).toBe("1500000.00");
    expect(assetInserts[0]!.values[0]!.salvage).toBe("50000.00");
    expect(assetInserts[0]!.values[0]!.lifeYears).toBe(8);
    expect(assetInserts[1]!.values[0]!.cost).toBe("90000.00");
    expect(assetInserts[1]!.values[0]!.salvage).toBe("0");
  });

  it("400s an empty rows array", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: importDb() })
    ).inject({ method: "POST", url: "/api/v1/fa/import", payload: { rows: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/non-empty array/);
  });
});

// G2/G3 tests (PLAN.md §9) — labor read handlers (Program-2 Op-Core Wave-0).
// Covers GET /labor/workers|attendance|payroll: the company-scoped list-envelope
// reads (sorted, opaque Entity wire of the REAL columns) + fail-closed 401 without
// a tenant. Expected values come from the stub — never hand-computed against the
// impl. The routes are wired in app.ts (registerLaborRoute) → buildApp mounts them.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  attendances,
  glAccounts,
  jvLines,
  jvs,
  payrolls,
  roles,
  users,
  workers,
} from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "suda@rungrueang.co.th", name: "สุดา" },
};
const D = new Date(1_700_000_000_000);

interface Captured {
  table: unknown;
  where: SQL | undefined;
}

/** Keyed multi-table Db stub: db.select(table) resolves that table's canned rows,
 *  and records the (table, where) so tenant-scope can be asserted. */
function stubDb(rows: Array<[unknown, unknown[]]>, captured: Captured[] = []): Db {
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  const builderFor = (table: unknown) => {
    const builder = {
      $dynamic: () => builder,
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

// --- seed-shaped canned rows ------------------------------------------------
const W1 = "w1111111-0000-0000-0000-0000000000w1";
const W2 = "w2222222-0000-0000-0000-0000000000w2";
const worker = (id: string, name: string, dayRate: string | null): typeof workers.$inferSelect =>
  ({ id, companyId: COMPANY, name, dayRate, currencyCode: "THB", createdAt: D, updatedAt: D }) as typeof workers.$inferSelect;
const attendance = (id: string, day: string): typeof attendances.$inferSelect =>
  ({ id, companyId: COMPANY, workerId: W1, day, ot: "1.50", ccId: null, createdAt: D, updatedAt: D }) as typeof attendances.$inferSelect;
const payroll = (id: string, period: string): typeof payrolls.$inferSelect =>
  ({ id, companyId: COMPANY, workerId: W1, period, amount: "12000.00", currencyCode: "THB", ccId: null, createdAt: D, updatedAt: D }) as typeof payrolls.$inferSelect;

describe("GET /api/v1/labor/workers", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/labor/workers" });
    expect(res.statusCode).toBe(401);
  });

  it("lists the tenant's workers as a name-sorted list envelope (company-scoped)", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[workers, [worker(W2, "บุญมี", "420"), worker(W1, "สมหมาย", "450")]]], captured),
      })
    ).inject({ method: "GET", url: "/api/v1/labor/workers" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2); // list-envelope {data,page,page_size,total}
    expect(body.data.map((w: { name: string }) => w.name)).toEqual(["บุญมี", "สมหมาย"]);
    // wire = REAL columns (day_rate coerced to number, currency_code) — no fabrication.
    expect(body.data[1]).toMatchObject({ id: W1, name: "สมหมาย", day_rate: 450, currency_code: "THB" });
    // tenant-scoped read: the workers select ran (company_id bound by the door).
    expect(captured.some((c) => c.table === workers)).toBe(true);
  });
});

describe("GET /api/v1/labor/attendance", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/labor/attendance" });
    expect(res.statusCode).toBe(401);
  });

  it("lists attendance newest-first (day desc) as a list envelope", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[attendances, [attendance("a1", "2026-05-01"), attendance("a2", "2026-05-03")]]]),
      })
    ).inject({ method: "GET", url: "/api/v1/labor/attendance" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data.map((a: { day: string }) => a.day)).toEqual(["2026-05-03", "2026-05-01"]);
    expect(body.data[0]).toMatchObject({ worker_id: W1, ot: 1.5 });
  });

  it("honest-empty when there is no attendance (no seed)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb([[attendances, []]]) })
    ).inject({ method: "GET", url: "/api/v1/labor/attendance" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
    expect(res.json().data).toEqual([]);
  });
});

describe("GET /api/v1/labor/payroll", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/labor/payroll" });
    expect(res.statusCode).toBe(401);
  });

  it("lists payroll as a list envelope with the REAL columns", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[payrolls, [payroll("p1", "2026-05")]]]),
      })
    ).inject({ method: "GET", url: "/api/v1/labor/payroll" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data[0]).toMatchObject({ worker_id: W1, period: "2026-05", amount: 12000, currency_code: "THB" });
  });
});

// ===========================================================================
// Write slice (B-140) — createLaborWorker / Attendance / Payroll + payroll-post.
// Uses a richer write-capable Db stub (mirrors retention.test.ts / ar.test.ts):
// canned rows per table (reads, incl. selectThrough/insertThrough ownership) +
// insert/update/transaction capture. Expected values come from the stub EXCEPT the
// server-authority contracts under test (day_fraction derived from status; payroll
// amount computed from attendance; the Dr 1140 / Cr 1020 balanced posting).
// ===========================================================================

type RowSource = unknown[] | ((where: SQL | undefined) => unknown[]);
interface Inserted {
  table: unknown;
  values: Record<string, unknown> | Record<string, unknown>[];
}
interface WriteStubOpts {
  rows: Array<[unknown, RowSource]>;
  captured?: Captured[];
  inserted?: Inserted[];
}

/** Db stub with insert/transaction doors (the read-only stubDb above cannot write). */
function writeStub(opts: WriteStubOpts): Db {
  const { rows, captured = [], inserted = [] } = opts;
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
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
        returning: () => {
          inserted.push({ table, values });
          const arr = Array.isArray(values) ? values : [values];
          return Promise.resolve(
            arr.map((v) => {
              const row = v as Record<string, unknown>;
              return { id: row.id ?? `new-${seq++}`, createdAt: D, ...row };
            }),
          );
        },
      }),
    }),
  };
  // The transaction door runs its callback against this SAME stub (no real
  // BEGIN/COMMIT — it proves the door threads one scoped handle · B-097).
  raw.transaction = (cb: (tx: unknown) => unknown) => cb(raw);
  return raw as unknown as Db;
}

function paramsOf(where: SQL | undefined): unknown[] {
  if (!where) return [];
  return new PgDialect().sqlToQuery(where).params;
}

// --- caller authz rows (loadCaller resolves users-by-email → roles-by-id) --------
const userRow = {
  id: "u-0",
  companyId: COMPANY,
  email: SESSION.user.email,
  name: SESSION.user.name,
  roleId: "role-0",
  status: "active",
};
/** A role carrying (or not) the finance create/approve perms the gates read. */
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

// --- COA + jv seeds for the payroll → GL post ------------------------------------
const ACC_WIP = "acc00000-0000-0000-0000-000000001140"; // 1140 WIP-labor
const ACC_BANK = "acc00000-0000-0000-0000-000000001020"; // 1020 bank
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
const COA_ROWS = [glAcc(ACC_WIP, "1140", "งานระหว่างก่อสร้าง (WIP/CIP)"), glAcc(ACC_BANK, "1020", "เงินฝากธนาคาร")];

// A benign existing JV so allocJvNo has a set to scan (its `no` never matches the
// current-year prefix → allocJvNo starts at 0001) and insertThrough's ownership
// select is non-empty. The idempotency probe (source_doc `payroll:...`) returns [].
const jvSeed = { id: "jv-seed", companyId: COMPANY, no: "OPEN-1", sourceDoc: "seed", periodId: null, memo: "seed", createdAt: D, updatedAt: D };
const jvSource = (where: SQL | undefined): unknown[] => {
  const isProbe = paramsOf(where).some(
    (p) => typeof p === "string" && p.startsWith("payroll:"),
  );
  return isProbe ? [] : [jvSeed];
};

// An attendance row carrying the pay factor (day_fraction) + ot the payroll sums.
const att = (day: string, dayFraction: string, ot: string): typeof attendances.$inferSelect =>
  ({ id: `at-${day}`, companyId: COMPANY, workerId: W1, day, ot, status: "full", dayFraction, ccId: null, createdAt: D, updatedAt: D }) as typeof attendances.$inferSelect;

// ===========================================================================
// POST /api/v1/labor/workers
// ===========================================================================
describe("POST /api/v1/labor/workers", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/labor/workers",
      payload: { name: "สมชาย" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });

  it("403s a caller lacking finance.create (fail closed, no insert)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({ rows: [[users, [userRow]], [roles, [roleRow(false)]]], inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/workers", payload: { name: "สมชาย" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance create permission/);
    expect(inserted).toHaveLength(0);
  });

  it("400s when name is missing", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({ rows: [[users, [userRow]], [roles, [roleRow()]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/workers", payload: { day_rate: 450 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/name is required/);
  });

  it("creates a worker storing the full WorkerForm superset (code/team/supervisor/skill/pay_type/active)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({ rows: [[users, [userRow]], [roles, [roleRow()]]], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/workers",
      payload: {
        name: "สมชาย ใจดี",
        day_rate: 450,
        code: "W-010",
        team: "ทีมโครงสร้าง",
        supervisor: "หัวหน้าเอก",
        skill: "ช่างปูน",
        pay_type: "daily",
        active: false,
      },
    });
    expect(res.statusCode).toBe(201);
    // The stored row carries the superset columns (company_id force-set by the door).
    const ins = inserted.find((i) => i.table === workers)!;
    const v = ins.values as Record<string, unknown>;
    expect(v.name).toBe("สมชาย ใจดี");
    expect(v.dayRate).toBe("450.00");
    expect(v.code).toBe("W-010");
    expect(v.team).toBe("ทีมโครงสร้าง");
    expect(v.supervisor).toBe("หัวหน้าเอก");
    expect(v.skill).toBe("ช่างปูน");
    expect(v.payType).toBe("daily");
    expect(v.active).toBe(false);
    expect(v.companyId).toBe(COMPANY);
    // The 201 wire echoes the superset.
    expect(res.json()).toMatchObject({
      name: "สมชาย ใจดี",
      day_rate: 450,
      code: "W-010",
      pay_type: "daily",
      active: false,
      currency_code: "THB",
    });
  });

  it("defaults active true when the body omits it", async () => {
    const inserted: Inserted[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({ rows: [[users, [userRow]], [roles, [roleRow()]]], inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/workers", payload: { name: "บุญมา" } });
    const v = inserted.find((i) => i.table === workers)!.values as Record<string, unknown>;
    expect(v.active).toBe(true);
    expect(v.dayRate).toBeNull();
  });
});

// ===========================================================================
// POST /api/v1/labor/attendance
// ===========================================================================
describe("POST /api/v1/labor/attendance", () => {
  const attendDb = (opts: { worker?: unknown[]; inserted?: Inserted[]; financeCreate?: boolean } = {}) =>
    writeStub({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(opts.financeCreate ?? true)]],
        [workers, opts.worker ?? [worker(W1, "สมหมาย", "450")]],
      ],
      inserted: opts.inserted,
    });

  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-05-01" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("400s a worker outside this tenant (scoped, no insert)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: attendDb({ worker: [], inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/attendance", payload: { worker_id: W1, day: "2026-05-01" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/worker not found/);
    expect(inserted).toHaveLength(0);
  });

  it("400s an invalid status", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: attendDb() })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-05-01", status: "vacation" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/full, half, absent/);
  });

  it("derives day_fraction from status SERVER-side (half → 0.5, never a client value)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: attendDb({ inserted }) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      // a bogus client day_fraction is IGNORED — the server derives it from status.
      payload: { worker_id: W1, day: "2026-05-02", status: "half", ot: 1, day_fraction: 99 },
    });
    expect(res.statusCode).toBe(201);
    const v = inserted.find((i) => i.table === attendances)!.values as Record<string, unknown>;
    expect(v.dayFraction).toBe("0.5"); // derived from status:half — NOT the client 99
    expect(v.status).toBe("half");
    expect(v.ot).toBe("1.00");
    expect(v.companyId).toBe(COMPANY);
    expect(res.json()).toMatchObject({ worker_id: W1, day: "2026-05-02", status: "half", day_fraction: 0.5, ot: 1 });
  });

  it("defaults status full → day_fraction 1 when omitted", async () => {
    const inserted: Inserted[] = [];
    await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: attendDb({ inserted }) })
    ).inject({ method: "POST", url: "/api/v1/labor/attendance", payload: { worker_id: W1, day: "2026-05-03" } });
    const v = inserted.find((i) => i.table === attendances)!.values as Record<string, unknown>;
    expect(v.status).toBe("full");
    expect(v.dayFraction).toBe("1");
    expect(v.ot).toBe("0.00");
  });
});

// ===========================================================================
// POST /api/v1/labor/payroll  (amount = SERVER-computed from attendance)
// ===========================================================================
describe("POST /api/v1/labor/payroll", () => {
  const payrollDb = (opts: { worker?: unknown[]; attendance?: unknown[]; inserted?: Inserted[]; financeCreate?: boolean } = {}) =>
    writeStub({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(opts.financeCreate ?? true)]],
        [workers, opts.worker ?? [worker(W1, "สมหมาย", "450")]],
        [attendances, opts.attendance ?? []],
      ],
      inserted: opts.inserted,
    });

  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/labor/payroll",
      payload: { worker_id: W1, period: "2026-05" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("400s a worker outside this tenant (scoped, no insert)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: payrollDb({ worker: [], inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/payroll", payload: { worker_id: W1, period: "2026-05" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/worker not found/);
    expect(inserted).toHaveLength(0);
  });

  it("400s a malformed period (not YYYY-MM)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: payrollDb() })
    ).inject({ method: "POST", url: "/api/v1/labor/payroll", payload: { worker_id: W1, period: "May 2026" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/YYYY-MM/);
  });

  it("computes amount SERVER-side from attendance — 1 full day @ 450 + 2 OT hrs = 618.75 (client amount ignored)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: payrollDb({
          // one in-period full day with 2 OT hours: 450×1 + 2×(450/8)×1.5 = 618.75.
          attendance: [att("2026-05-10", "1", "2.00")],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/payroll",
      // a client-supplied amount MUST be ignored (money = SERVER · B-140 RG-3).
      payload: { worker_id: W1, period: "2026-05", amount: 999999 },
    });
    expect(res.statusCode).toBe(201);
    const v = inserted.find((i) => i.table === payrolls)!.values as Record<string, unknown>;
    expect(v.amount).toBe("618.75"); // server-computed, NOT the client 999999
    expect(v.workerId).toBe(W1);
    expect(v.period).toBe("2026-05");
    expect(v.companyId).toBe(COMPANY);
    expect(res.json().amount).toBe(618.75);
  });

  it("excludes attendance outside the period and honours the OT premium across rows", async () => {
    const inserted: Inserted[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: payrollDb({
          attendance: [
            att("2026-05-01", "1", "0"), // 450
            att("2026-05-02", "0.5", "0"), // 225
            att("2026-04-30", "1", "8"), // OTHER period → excluded
          ],
          inserted,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/payroll", payload: { worker_id: W1, period: "2026-05" } });
    const v = inserted.find((i) => i.table === payrolls)!.values as Record<string, unknown>;
    expect(v.amount).toBe("675.00"); // 450 + 225 (the April row is excluded)
  });

  it("computes amount 0 honestly when the worker has no attendance in the period", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: payrollDb({ attendance: [], inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/payroll", payload: { worker_id: W1, period: "2026-05" } });
    expect(res.statusCode).toBe(201);
    const v = inserted.find((i) => i.table === payrolls)!.values as Record<string, unknown>;
    expect(v.amount).toBe("0.00");
    expect(res.json().amount).toBe(0);
  });
});

// ===========================================================================
// POST /api/v1/labor/payroll/:id/post  (Dr 1140 / Cr 1020 balanced JV)
// ===========================================================================
describe("POST /api/v1/labor/payroll/:id/post", () => {
  const P0 = "pay00000-0000-0000-0000-0000000000p0";
  const CC0 = "cc000000-0000-0000-0000-0000000000c0";
  const payrollRow = (extra: Partial<typeof payrolls.$inferSelect> = {}): typeof payrolls.$inferSelect =>
    ({ id: P0, companyId: COMPANY, workerId: W1, period: "2026-05", amount: "618.75", currencyCode: "THB", ccId: CC0, createdAt: D, updatedAt: D, ...extra }) as typeof payrolls.$inferSelect;

  const postDb = (opts: { payroll?: unknown[]; jv?: RowSource; coa?: unknown[]; inserted?: Inserted[]; financeApprove?: boolean } = {}) =>
    writeStub({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(true, opts.financeApprove ?? true)]],
        [payrolls, opts.payroll ?? [payrollRow()]],
        [jvs, opts.jv ?? jvSource],
        [glAccounts, opts.coa ?? COA_ROWS],
      ],
      inserted: opts.inserted,
    });

  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: `/api/v1/labor/payroll/${P0}/post`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s a caller lacking finance.approve (money-lock, fail closed, no post)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({ financeApprove: false, inserted }),
      })
    ).inject({ method: "POST", url: `/api/v1/labor/payroll/${P0}/post` });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance approve permission/);
    expect(inserted).toHaveLength(0);
  });

  it("404s a payroll not in this tenant (scoped)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({ payroll: [] }),
      })
    ).inject({ method: "POST", url: `/api/v1/labor/payroll/${P0}/post` });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("posts a BALANCED Dr 1140 / Cr 1020 JV from the STORED amount, keys source_doc payroll:<id>, carries cc_id on both legs", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({ inserted }),
      })
    ).inject({ method: "POST", url: `/api/v1/labor/payroll/${P0}/post` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(P0);
    expect(body.amount).toBe(618.75); // the STORED payroll amount (money = SERVER)
    expect(body.jv_no).toMatch(/^JV-\d{4}-\d{4}$/);

    // Balanced double entry: Dr 1140 = 618.75 / Cr 1020 = 618.75.
    const lines = inserted.find((i) => i.table === jvLines)!.values as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    const dr = lines.find((l) => l.accountId === ACC_WIP)!;
    const cr = lines.find((l) => l.accountId === ACC_BANK)!;
    expect(dr.dr).toBe("618.75");
    expect(dr.cr).toBe("0.00");
    expect(cr.dr).toBe("0.00");
    expect(cr.cr).toBe("618.75");
    // Σ dr === Σ cr (balanced).
    expect(lines.reduce((s, l) => s + Number(l.dr), 0)).toBe(618.75);
    expect(lines.reduce((s, l) => s + Number(l.cr), 0)).toBe(618.75);
    // cc_id carried on both legs.
    expect(dr.ccId).toBe(CC0);
    expect(cr.ccId).toBe(CC0);
    // The JV carries the unique source_doc payroll:<id>.
    const jvIns = inserted.find((i) => i.table === jvs)!;
    expect((jvIns.values as Record<string, unknown>).sourceDoc).toBe(`payroll:${P0}`);
  });

  it("409s (idempotent) when a JV already carries source_doc payroll:<id> (pre-check)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({
          jv: (where) =>
            paramsOf(where).some((p) => typeof p === "string" && p.startsWith("payroll:"))
              ? [{ id: "jv-prior", companyId: COMPANY, sourceDoc: `payroll:${P0}` }]
              : [jvSeed],
          inserted,
        }),
      })
    ).inject({ method: "POST", url: `/api/v1/labor/payroll/${P0}/post` });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already posted/);
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined(); // no double post
  });

  it("409s a concurrent double-post (23505 on the source_doc index → idempotent)", async () => {
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
    ).inject({ method: "POST", url: `/api/v1/labor/payroll/${P0}/post` });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already posted/);
  });

  it("409s honestly when the tenant COA lacks 1140 or 1020 (never invents)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({ coa: [glAcc(ACC_WIP, "1140", "งานระหว่างก่อสร้าง (WIP/CIP)")] }), // 1020 bank MISSING
      })
    ).inject({ method: "POST", url: `/api/v1/labor/payroll/${P0}/post` });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/missing a required posting account/);
  });

  it("409s a zero-amount payroll (nothing to post)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({ payroll: [payrollRow({ amount: "0.00" })] }),
      })
    ).inject({ method: "POST", url: `/api/v1/labor/payroll/${P0}/post` });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/no amount to post/);
  });
});

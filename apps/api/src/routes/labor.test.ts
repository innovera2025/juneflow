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
  costCenters,
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

  // B-323 (round 4): the sharpest survivor of three review rounds. This list sorted on
  // `day` alone — a DATE — six lines above the payroll comparator round 3 fixed, in the
  // adjacent function of the same file. An attendance register exists to record MANY
  // workers on ONE date, so returning 0 was the normal case, not an edge, and the tied
  // pair went back to the join plan.
  //
  // It survived because the seed emits ZERO attendance rows (seed/index.ts): no baseline
  // moves, no live order proof reaches it, nothing fails. That is exactly why this is a
  // stubbed unit test — a defect the seed hides cannot be caught by a seeded run, and a
  // unit test does not need the seed.
  it("is TOTAL when two workers clock the same day (id floor decides)", async () => {
    const ids = async (rows: unknown[]): Promise<string[]> => {
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb([[attendances, rows]]) })
      ).inject({ method: "GET", url: "/api/v1/labor/attendance" });
      return res.json().data.map((r: { id: string }) => r.id);
    };
    // Two workers on one shift — same `day`, so the day comparison returns 0 for the pair.
    const a = attendance("aaa", "2026-08-07");
    const b = attendance("bbb", "2026-08-07");
    expect(await ids([a, b])).toEqual(["aaa", "bbb"]);
    expect(await ids([b, a])).toEqual(["aaa", "bbb"]); // reversed input, same output
  });

  it("keeps day DESC ahead of the id floor (the floor only breaks ties)", async () => {
    // Guards the ORDER of the clauses: an id-first comparator would also pass the tie
    // test above while silently destroying the newest-first register.
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[attendances, [attendance("zzz", "2026-05-03"), attendance("aaa", "2026-05-01")]]]),
      })
    ).inject({ method: "GET", url: "/api/v1/labor/attendance" });
    expect(res.json().data.map((r: { id: string }) => r.id)).toEqual(["zzz", "aaa"]);
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

  // B-323: this list used an inline created_at-only comparator that returned 0 for two
  // runs sharing an instant, handing the pair back to the join plan. A payroll RUN
  // writes many rows in one transaction, so the tie is the normal case, not an edge.
  it("is TOTAL when two payroll runs share an instant (id floor decides)", async () => {
    const ids = async (rows: unknown[]): Promise<string[]> => {
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb([[payrolls, rows]]) })
      ).inject({ method: "GET", url: "/api/v1/labor/payroll" });
      return res.json().data.map((r: { id: string }) => r.id);
    };
    // `payroll()` hardcodes the same createdAt for every row — a genuine tie.
    const a = payroll("aaa", "2026-05");
    const b = payroll("bbb", "2026-06");
    expect(await ids([a, b])).toEqual(["aaa", "bbb"]);
    expect(await ids([b, a])).toEqual(["aaa", "bbb"]);
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
  /**
   * B-307: make an insert into a table THROW (models a 23505 unique-violation on the
   * attendance_idempotency_uq partial index). Receives the table and the running
   * 0-based per-table insert count, so a test can let the 1st create through and trip
   * only the replay. Return null to insert normally.
   */
  insertThrows?: (table: unknown, nth: number) => Error | null;
  /**
   * B-307: called with the rows an insert actually RETURNED (id + createdAt stamped).
   * Lets a test derive its stored-row view from what the handler really wrote instead
   * of hand-seeding it — so a handler that writes twice really is seen twice by the
   * later payroll SUM (a hand-seeded array would hide exactly the defect under test).
   */
  onInsert?: (table: unknown, rows: Record<string, unknown>[]) => void;
  /**
   * B-332: the rows an UPDATE ... RETURNING hands back. Returning [] models the
   * guarded-update MISS (`WHERE ... AND checked_out_at IS NULL` matched 0 rows) —
   * the only way to reach the checkout replay/409 branch without a real Postgres.
   * Receives the running 0-based per-table update count so a test can let the first
   * close through and starve only the second.
   */
  updateReturns?: (table: unknown, nth: number) => Record<string, unknown>[] | null;
}

/** B-332: a captured UPDATE (which table, the WHERE, and the SET payload). */
interface Updated {
  table: unknown;
  where: SQL | undefined;
  set: Record<string, unknown>;
}

/** Db stub with insert/update/transaction doors (the read-only stubDb above cannot write). */
function writeStub(opts: WriteStubOpts & { updated?: Updated[] }): Db {
  const { rows, captured = [], inserted = [], insertThrows, onInsert } = opts;
  const updated = opts.updated ?? [];
  const insertCount = new Map<unknown, number>();
  const updateCount = new Map<unknown, number>();
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
          const nth = insertCount.get(table) ?? 0;
          insertCount.set(table, nth + 1);
          const boom = insertThrows?.(table, nth);
          // Thrown BEFORE the capture: a rejected insert wrote no row, so it must not
          // be counted as one (the "exactly one row" assertions depend on that).
          if (boom) return Promise.reject(boom);
          inserted.push({ table, values });
          const arr = Array.isArray(values) ? values : [values];
          const out = arr.map((v) => {
            const row = v as Record<string, unknown>;
            return { id: row.id ?? `new-${seq++}`, createdAt: D, ...row };
          });
          onInsert?.(table, out as Record<string, unknown>[]);
          return Promise.resolve(out);
        },
      }),
    }),
  };
  // B-332: the UPDATE door. Captures the SET payload AND the composed WHERE, so a
  // test can assert the guard predicate is on the UPDATE itself (the B-149 lesson:
  // a guard on a preceding SELECT is two round trips and both writers pass it).
  raw.update = (table: unknown) => ({
    set: (set: Record<string, unknown>) => ({
      where: (where: SQL) => ({
        returning: () => {
          const nth = updateCount.get(table) ?? 0;
          updateCount.set(table, nth + 1);
          updated.push({ table, where, set });
          const canned = opts.updateReturns?.(table, nth);
          if (canned) return Promise.resolve(canned);
          // Default: the guard matched. Echo the SET over the first canned row so
          // the response reflects what was really written, never a hand-built shape.
          const base = (rowsFor(table, where)[0] ?? {}) as Record<string, unknown>;
          return Promise.resolve([{ ...base, ...set }]);
        },
      }),
    }),
  });
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
// B-307 — POST /labor/attendance idempotency (client key + partial index + replay)
// ---------------------------------------------------------------------------
// WHY this is a MONEY contract, not data hygiene: createLaborPayroll computes the
// payout by SUMMING attendance ROWS in the period — not DISTINCT days — so a
// duplicate row is a DOUBLE PAYMENT, and jv_source_doc_uq cannot see it (the
// inflated amount posts as one clean balanced JV). sync_processor.dart replays a
// create it never heard back on with the SAME SyncOperation.id, so the mobile
// check-in screen cannot ship until that replay collapses onto the original row.
// The load-bearing assertion in the first test is the PAYROLL AMOUNT — a row count
// alone would not encode the defect.
// ===========================================================================

const IDEMP_KEY = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const ATT_IDEMP_UQ = "attendance_idempotency_uq";
const OTHER_COMPANY = "99999999-9999-9999-9999-999999999999";
const DAY = "2026-05-01";
/** 450 day-rate × 1 full day + 2h OT × (450/8) × 1.5 = 450 + 168.75. ONE day's pay. */
const ONE_DAY_PAY = 618.75;

/**
 * A raw pg unique-violation (SQLSTATE 23505) — the DatabaseError node-postgres
 * throws, naming the violated index on `.constraint` (verified live against PG 16 +
 * pg 8). `null` models the defensive case of a 23505 that names nothing.
 */
const pgUniqueViolation = (constraint: string | null = ATT_IDEMP_UQ): Error =>
  Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint ?? "?"}"`),
    constraint === null ? { code: "23505" } : { code: "23505", constraint },
  );

/**
 * The shape the HANDLER actually sees: every insert goes through drizzle, which wraps
 * the driver error in a DrizzleQueryError and nests the DatabaseError under `.cause`.
 * isUniqueViolation() / violatedConstraint() must both look one level down — a suite
 * that only ever threw the FLAT shape would stay green against a gate reading
 * `err.constraint` directly while production silently lost its replay path.
 */
const uniqueViolation = (constraint: string | null = ATT_IDEMP_UQ): Error =>
  Object.assign(new Error("Failed query"), { cause: pgUniqueViolation(constraint) });

/**
 * A keyed create issues TWO kinds of attendance read — the keyed dedup resolve
 * (pre-check, and again in the 23505 catch) and payroll's unkeyed period read. The
 * row-blind stub answers both the same, so this splits them: a read whose WHERE binds
 * one of `byKey`'s keys gets that key's rows ([] = not stored, or another
 * tenant's/anchor's key we cannot see); every other read gets `unkeyed`.
 */
const keyedAtt =
  (byKey: Record<string, () => unknown[]>, unkeyed: () => unknown[]) =>
  (where: SQL | undefined): unknown[] => {
    const params = paramsOf(where);
    for (const [key, rows] of Object.entries(byKey)) {
      if (params.includes(key)) return rows();
    }
    return unkeyed();
  };

/** Every attendance read this request made whose WHERE bound the client key. */
const keyedAttReads = (captured: Captured[], key = IDEMP_KEY): Captured[] =>
  captured.filter((c) => c.table === attendances && paramsOf(c.where).includes(key));

/** The write-capable stub for the B-307 cases: caller authz + one 450/day worker. */
const idempDb = (opts: {
  stored: () => unknown[];
  byKey?: Record<string, () => unknown[]>;
  captured?: Captured[];
  inserted?: Inserted[];
  insertThrows?: (table: unknown, nth: number) => Error | null;
  onInsert?: (table: unknown, rows: Record<string, unknown>[]) => void;
}) =>
  writeStub({
    rows: [
      [users, [userRow]],
      [roles, [roleRow()]],
      [workers, [worker(W1, "สมหมาย", "450")]],
      [attendances, keyedAtt(opts.byKey ?? { [IDEMP_KEY]: opts.stored }, opts.stored)],
    ],
    captured: opts.captured,
    inserted: opts.inserted,
    insertThrows: opts.insertThrows,
    onInsert: opts.onInsert,
  });

describe("POST /api/v1/labor/attendance — B-307 idempotency (client key + replay)", () => {
  it("same idempotency_key twice → ONE row, the replay returns the ORIGINAL byte-for-byte, and PAYROLL still pays ONE day (618.75, not 1237.50)", async () => {
    const inserted: Inserted[] = [];
    // The stored view is DERIVED from what the handler actually wrote (onInsert), not
    // hand-seeded — so if the replay inserted a second row, payroll below really would
    // sum it and this test would go red. That is the whole point.
    const stored: unknown[] = [];
    const db = idempDb({
      stored: () => stored,
      inserted,
      onInsert: (table, out) => {
        if (table === attendances) stored.push(...out);
      },
    });
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db });
    const payload = { worker_id: W1, day: DAY, ot: 2, idempotency_key: IDEMP_KEY };

    const res1 = await app.inject({ method: "POST", url: "/api/v1/labor/attendance", payload });
    const res2 = await app.inject({ method: "POST", url: "/api/v1/labor/attendance", payload });

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    // The replay is idempotent — the client sees its OWN row (same id), never a 409,
    // never a duplicate. Byte-identical by construction (one sender, one wire fn).
    expect(res2.json()).toEqual(res1.json());
    expect(res2.json().id).toBe(res1.json().id);
    expect(res2.json()).toMatchObject({ worker_id: W1, day: DAY, status: "full", day_fraction: 1, ot: 2 });
    // exactly ONE row written across BOTH requests, carrying the client key.
    const attInserts = inserted.filter((i) => i.table === attendances);
    expect(attInserts).toHaveLength(1);
    expect((attInserts[0]!.values as Record<string, unknown>).idempotencyKey).toBe(IDEMP_KEY);
    expect(stored).toHaveLength(1);

    // THE MONEY ASSERTION: run payroll over the same period and prove the worker is
    // paid for ONE day. Without the dedup the period would hold two rows and the
    // SERVER-computed amount would be 1237.50 — the actual defect, invisible to every
    // downstream guard because the inflated amount posts as one balanced JV.
    const pay = await app.inject({
      method: "POST",
      url: "/api/v1/labor/payroll",
      payload: { worker_id: W1, period: "2026-05" },
    });
    expect(pay.statusCode).toBe(201);
    expect(pay.json().amount).toBe(ONE_DAY_PAY);
    expect(pay.json().amount).not.toBe(ONE_DAY_PAY * 2);
  });

  it("the 23505 backstop still fires when the PRE-CHECK misses (the real race) → 201 with the ORIGINAL, still one row", async () => {
    const inserted: Inserted[] = [];
    const captured: Captured[] = [];
    const stored: unknown[] = [];
    // The real race: reads 0 (create #1) and 1 (create #2's pre-check) happen BEFORE
    // the original is visible to us; our insert then trips the index, and read 2 (the
    // catch's resolve, after that commit) finds it. This is exactly the window an
    // app-level pre-check cannot close — which is why the catch is kept.
    let keyedReadNo = 0;
    const raceKeyed = (): unknown[] => (keyedReadNo++ < 2 ? [] : stored);
    const db = idempDb({
      stored: () => stored,
      byKey: { [IDEMP_KEY]: raceKeyed },
      captured,
      inserted,
      onInsert: (table, out) => {
        if (table === attendances) stored.push(...out);
      },
      // the 2nd insert (the replay) trips the partial unique index; the 1st is fine.
      insertThrows: (table, nth) => (table === attendances && nth >= 1 ? uniqueViolation() : null),
    });
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db });
    const payload = { worker_id: W1, day: DAY, ot: 2, idempotency_key: IDEMP_KEY };
    const res1 = await app.inject({ method: "POST", url: "/api/v1/labor/attendance", payload });
    const res2 = await app.inject({ method: "POST", url: "/api/v1/labor/attendance", payload });

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(res2.json()).toEqual(res1.json()); // the ORIGINAL, produced by the same sender
    expect(inserted.filter((i) => i.table === attendances)).toHaveLength(1);
    expect(stored).toHaveLength(1);
    // 3 keyed resolves: create#1's pre-check, create#2's pre-check (missed), the catch.
    expect(keyedAttReads(captured)).toHaveLength(3);
  });

  it("409s when a key collision resolves to NO row in this tenant (a cross-tenant clash — never a leak, never a fabricated success)", async () => {
    const inserted: Inserted[] = [];
    const db = idempDb({
      // the colliding row belongs to ANOTHER company → invisible through our scoped door
      stored: () => [],
      inserted,
      insertThrows: (table) => (table === attendances ? uniqueViolation() : null),
    });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY, idempotency_key: IDEMP_KEY },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
    expect(res.json().message).toMatch(/idempotency_key already used/);
    expect(inserted.filter((i) => i.table === attendances)).toHaveLength(0);
  });

  it("the dedup resolve is TENANT-scoped and ANCHORED (binds company_id + worker_id + day, never another company)", async () => {
    const captured: Captured[] = [];
    const db = idempDb({ stored: () => [], captured });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY, idempotency_key: IDEMP_KEY },
    });
    expect(res.statusCode).toBe(201);
    const keyed = keyedAttReads(captured);
    expect(keyed.length).toBeGreaterThan(0);
    for (const c of keyed) {
      const params = paramsOf(c.where);
      // attendance carries company_id directly → the plain scoped door binds it (zero
      // hops, no selectThrough). The anchors keep a reused key from resolving a row
      // that is not the client's own.
      expect(params).toContain(COMPANY);
      expect(params).toContain(W1);
      expect(params).toContain(DAY);
      expect(params).not.toContain(OTHER_COMPANY);
    }
  });

  it("the same key replayed for a DIFFERENT worker-day never hands back the first row — it 409s (anchors are load-bearing)", async () => {
    const inserted: Inserted[] = [];
    const first = {
      id: "at-1", companyId: COMPANY, workerId: W1, day: DAY, ot: "2.00",
      status: "full", dayFraction: "1", ccId: null, idempotencyKey: IDEMP_KEY, createdAt: D,
    };
    const db = idempDb({
      // The resolver's anchors (worker_id + day) are part of the WHERE, so a mismatched
      // anchor resolves nothing even though the row exists under this key + tenant.
      stored: () => [],
      byKey: { [IDEMP_KEY]: () => [] },
      inserted,
      insertThrows: (table) => (table === attendances ? uniqueViolation() : null),
    });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-05-09", idempotency_key: IDEMP_KEY },
    });
    // 409, NOT a 201 echoing `first` — handing back a day the client never recorded
    // would understate that day's pay while looking like a success.
    expect(res.statusCode).toBe(409);
    expect(res.json().id).toBeUndefined();
    expect(res.json()).not.toMatchObject({ day: first.day });
    expect(inserted.filter((i) => i.table === attendances)).toHaveLength(0);
  });

  it("different idempotency_keys → two distinct rows (no dedup path)", async () => {
    const inserted: Inserted[] = [];
    const db = idempDb({
      stored: () => [],
      // neither key is stored → both pre-checks miss → two real creates.
      byKey: { "key-A": () => [], "key-B": () => [] },
      inserted,
      // distinct keys never collide on a real DB → the stub never throws.
    });
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db });
    for (const key of ["key-A", "key-B"]) {
      const r = await app.inject({
        method: "POST",
        url: "/api/v1/labor/attendance",
        payload: { worker_id: W1, day: DAY, idempotency_key: key },
      });
      expect(r.statusCode).toBe(201);
    }
    const attInserts = inserted.filter((i) => i.table === attendances);
    expect(attInserts).toHaveLength(2);
    expect(attInserts.map((i) => (i.values as Record<string, unknown>).idempotencyKey)).toEqual([
      "key-A",
      "key-B",
    ]);
  });

  it("no idempotency_key → a normal single create; the key persists as null and NO dedup read is issued (web bulk-save unchanged)", async () => {
    const inserted: Inserted[] = [];
    const captured: Captured[] = [];
    const db = idempDb({ stored: () => [], captured, inserted });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY },
    });
    expect(res.statusCode).toBe(201);
    const attInserts = inserted.filter((i) => i.table === attendances);
    expect(attInserts).toHaveLength(1);
    expect((attInserts[0]!.values as Record<string, unknown>).idempotencyKey).toBe(null);
    // the create issued NO attendance read at all — the replay branch is unreachable
    // without a key, so a key-less POST cannot resolve anyone's row.
    expect(captured.filter((c) => c.table === attendances)).toHaveLength(0);
  });

  it.each([
    ["blank", ""],
    ["whitespace-only", "   "],
    ["a tab/newline", "\t\n"],
  ])("a %s idempotency_key is treated as ABSENT — persists null, issues no dedup read, and never matches a stored NULL row", async (_label, key) => {
    const inserted: Inserted[] = [];
    const captured: Captured[] = [];
    // A pre-existing row whose key is NULL (every row before this migration). SQL NULL
    // is not equal to itself AND the index is partial, so it can never be resolved —
    // this asserts the HANDLER refuses too, one layer earlier.
    const nullKeyRow = {
      id: "at-old", companyId: COMPANY, workerId: W1, day: DAY, ot: "0.00",
      status: "full", dayFraction: "1", ccId: null, idempotencyKey: null, createdAt: D,
    };
    const db = idempDb({ stored: () => [nullKeyRow], captured, inserted });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY, idempotency_key: key },
    });
    expect(res.statusCode).toBe(201);
    // a NEW row — the stored null-key row was NOT handed back as a replay.
    expect(res.json().id).not.toBe("at-old");
    const attInserts = inserted.filter((i) => i.table === attendances);
    expect(attInserts).toHaveLength(1);
    expect((attInserts[0]!.values as Record<string, unknown>).idempotencyKey).toBe(null);
    expect(captured.filter((c) => c.table === attendances)).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // B-309 — a PRESENT but NON-STRING key
  // -------------------------------------------------------------------------
  // The three blank cases above are all STRINGS: they exercise `.trim()` and never
  // the type coercion, which is exactly why str() swallowing a NUMBER survived two
  // reviews. Proven live before the fix: POST {…, idempotency_key: 123} twice → 201,
  // 201, two attendance rows, and payroll paid the day TWICE. The row-count assertion
  // is load-bearing here — a 400 that still wrote would be the same double-pay.
  it.each([
    ["a JSON number (the live-proven case)", 123],
    ["a float", 1.5],
    ["a boolean", true],
    ["an array", ["1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"]],
    ["an object", { key: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" }],
  ])(
    "B-309: %s idempotency_key → 400 VALIDATION and NOTHING is written (never a silent no-key create)",
    async (_label, key) => {
      const inserted: Inserted[] = [];
      const captured: Captured[] = [];
      const db = idempDb({ stored: () => [], captured, inserted });
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db })
      ).inject({
        method: "POST",
        url: "/api/v1/labor/attendance",
        payload: { worker_id: W1, day: DAY, idempotency_key: key },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION");
      expect(res.json().message).toMatch(/idempotency_key must be a string/);
      // THE assertion: no attendance row exists to be summed by a payroll run.
      expect(inserted.filter((i) => i.table === attendances)).toHaveLength(0);
      // and it never even looked — the dedup read is unreachable for a rejected key.
      expect(captured.filter((c) => c.table === attendances)).toHaveLength(0);
    },
  );

  it("B-309: the camelCase alias is guarded too — {idempotencyKey: 123} → 400, nothing written", async () => {
    const inserted: Inserted[] = [];
    const db = idempDb({ stored: () => [], inserted });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY, idempotencyKey: 123 },
    });
    expect(res.statusCode).toBe(400);
    expect(inserted.filter((i) => i.table === attendances)).toHaveLength(0);
  });

  it("B-309: an EXPLICIT null is ABSENT, not invalid — 201, persists null, issues no dedup read", async () => {
    const inserted: Inserted[] = [];
    const captured: Captured[] = [];
    const db = idempDb({ stored: () => [], captured, inserted });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY, idempotency_key: null },
    });
    // A null is the wire form of a nullable client field holding no key — nothing was
    // ever minted, so no client is misled and the legitimate no-key path must stand.
    expect(res.statusCode).toBe(201);
    const attInserts = inserted.filter((i) => i.table === attendances);
    expect(attInserts).toHaveLength(1);
    expect((attInserts[0]!.values as Record<string, unknown>).idempotencyKey).toBe(null);
    expect(captured.filter((c) => c.table === attendances)).toHaveLength(0);
  });

  it("B-309: a NUMERIC-LOOKING STRING is a perfectly valid key — it still dedups (the fix gates on type, not on shape)", async () => {
    const inserted: Inserted[] = [];
    const stored: unknown[] = [];
    const db = idempDb({
      stored: () => stored,
      byKey: { "123": () => stored },
      inserted,
      onInsert: (table, out) => {
        if (table === attendances) stored.push(...out);
      },
    });
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db });
    const payload = { worker_id: W1, day: DAY, idempotency_key: "123" };
    const res1 = await app.inject({ method: "POST", url: "/api/v1/labor/attendance", payload });
    const res2 = await app.inject({ method: "POST", url: "/api/v1/labor/attendance", payload });
    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(res2.json().id).toBe(res1.json().id); // the replay, not a second day
    expect(inserted.filter((i) => i.table === attendances)).toHaveLength(1);
    expect((inserted.find((i) => i.table === attendances)!.values as Record<string, unknown>)
      .idempotencyKey).toBe("123");
  });

  // Each case pairs the NEGATIVE (this error must NOT replay) with the POSITIVE
  // CONTROL (attendance_idempotency_uq on the very same stub MUST replay). Both
  // halves are needed: the negative alone is green against a handler with no catch at
  // all (an uncaught throw is also a 500), so it would pin nothing; the pair dies on a
  // revert AND dies if the name gate is dropped.
  it.each([
    ["a 23505 naming another constraint (a future unique index on this table)", uniqueViolation("attendance_worker_day_uq")],
    ["a 23505 naming no constraint at all", uniqueViolation(null)],
    ["a non-unique driver failure (connection lost)", Object.assign(new Error("connection lost"), { code: "08006" })],
  ])("B-263: %s is NOT a replay — it rethrows (500) while the SAME stub replays on attendance_idempotency_uq", async (_label, boom) => {
    // The key DOES resolve a row — so a catch that skipped the name gate would happily
    // answer 201 with it. Only the name check keeps the negative case a 500.
    const original = {
      id: "at-1", companyId: COMPANY, workerId: W1, day: DAY, ot: "2.00",
      status: "full", dayFraction: "1", ccId: null, idempotencyKey: IDEMP_KEY, createdAt: D,
    };
    const payload = { worker_id: W1, day: DAY, idempotency_key: IDEMP_KEY };
    const mk = (thrown: Error, inserted: Inserted[]) => {
      // The pre-check must MISS (read 0 → []) so only the CATCH is under test; the
      // catch's own resolve (read 1) then sees the committed original.
      let reads = 0;
      return idempDb({
        stored: () => [original],
        byKey: { [IDEMP_KEY]: () => (reads++ === 0 ? [] : [original]) },
        inserted,
        insertThrows: (table) => (table === attendances ? thrown : null),
      });
    };

    const negInserted: Inserted[] = [];
    const neg = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: mk(boom, negInserted) })
    ).inject({ method: "POST", url: "/api/v1/labor/attendance", payload });
    expect(neg.statusCode).toBe(500);
    expect(neg.json().id).toBeUndefined(); // never the resolvable row
    expect(negInserted.filter((i) => i.table === attendances)).toHaveLength(0);

    // POSITIVE CONTROL — same stub, same resolvable row, only the constraint NAME
    // differs. This half is what dies when the catch is removed.
    const posInserted: Inserted[] = [];
    const pos = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: mk(uniqueViolation(), posInserted),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/attendance", payload });
    expect(pos.statusCode).toBe(201);
    expect(pos.json().id).toBe("at-1");
    expect(posInserted.filter((i) => i.table === attendances)).toHaveLength(0);
  });

  // =========================================================================
  // B-336 — THE CATCH for attendance_self_day_uq.
  //
  // WHAT THESE TESTS PROVE, AND WHAT THEY EXPLICITLY DO NOT. They prove the
  // HANDLER's mapping of a 23505 naming attendance_self_day_uq: 409 instead of
  // 500, the right message, and the replay-before-name ordering. They inject
  // that violation through the db stub, so they DO NOT — cannot — prove that a
  // real Postgres raises it. Deleting the index from finance.ts and migration
  // 0062 leaves every one of these green; the probe was run. What dies on that
  // deletion is packages/db/src/schema/attendance-self-day.test.ts (4 of its 6 —
  // measured: db 4 failed / 25 passed, the number BLOCKERS.md B-336 also carries)
  // and the live burst in tests/e2e/b332-checkin-schema.spec.ts. Said plainly here
  // because the review before this one found a test named for an index that only
  // ever proved the stub, and the fix for that is labelling, not another stub.
  //
  // These are still worth having: the 500 they rule out is not cosmetic. The
  // mobile SyncProcessor DEFERS a 5xx and stops draining, so the whole offline
  // write queue wedges behind one duplicate check-in. Measured live at the
  // index-without-catch SHA: a burst of 2 answered [201,500], and the roster's
  // sequential duplicate answered 500 as well.
  // =========================================================================
  describe("B-336: a 23505 naming attendance_self_day_uq is a 409 duplicate, never a 500", () => {
    const SELF_DAY_UQ = "attendance_self_day_uq";
    const original = {
      id: "at-1", companyId: COMPANY, workerId: W1, day: DAY, ot: "0.00",
      status: "full", dayFraction: "1", ccId: null, idempotencyKey: IDEMP_KEY, createdAt: D,
    };
    /** The pre-check MISSES (read 0) so only the CATCH is under test. */
    const mk = (thrown: Error, inserted: Inserted[], stored: () => unknown[]) => {
      let reads = 0;
      return idempDb({
        stored,
        byKey: { [IDEMP_KEY]: () => (reads++ === 0 ? [] : stored()) },
        inserted,
        insertThrows: (table) => (table === attendances ? thrown : null),
      });
    };
    const post = async (db: ReturnType<typeof idempDb>, payload: Record<string, unknown>) =>
      (await buildTestApp({ resolveTenant: async () => SESSION, db })).inject({
        method: "POST", url: "/api/v1/labor/attendance", payload,
      });

    it("KEYLESS — the burst case. The catch must not require an idempotency_key, or the one violation it exists for rethrows to 500", async () => {
      const inserted: Inserted[] = [];
      const res = await post(
        mk(uniqueViolation(SELF_DAY_UQ), inserted, () => [original]),
        { worker_id: W1, day: DAY }, // no key — exactly what the phone's burst sends
      );
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe("this day is already recorded for this worker");
      expect(inserted.filter((i) => i.table === attendances)).toHaveLength(0);
    });

    it("KEYED, and the key resolves the caller's OWN row — the REPLAY wins over the duplicate, whichever constraint Postgres happened to name", async () => {
      // The ordering that matters: resolveAttendanceConflict looks the key up BEFORE
      // it looks at the name. A catch that dispatched on the name first would answer
      // 409 here — and the phone DEAD-LETTERS a 4xx, so this worker's day would be
      // lost rather than retried.
      const inserted: Inserted[] = [];
      const res = await post(
        mk(uniqueViolation(SELF_DAY_UQ), inserted, () => [original]),
        { worker_id: W1, day: DAY, idempotency_key: IDEMP_KEY },
      );
      expect(res.statusCode).toBe(201);
      expect(res.json().id).toBe("at-1");
      expect(inserted.filter((i) => i.table === attendances)).toHaveLength(0);
    });

    it("KEYED, and the key resolves NOTHING — a NEW key onto a day already recorded is a DUPLICATE, and says so rather than blaming the key", async () => {
      // The screen-remount class: a new key for the same worker+day passes
      // attendance_idempotency_uq untouched and lands on this index instead. The two
      // constraints mean different things, so the 409s carry different messages.
      const inserted: Inserted[] = [];
      const res = await post(
        mk(uniqueViolation(SELF_DAY_UQ), inserted, () => []),
        { worker_id: W1, day: DAY, idempotency_key: IDEMP_KEY },
      );
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe("this day is already recorded for this worker");
    });

    it("CONTROL — the key index's own unresolvable 409 still blames the KEY, so adding the second name did not collapse the two outcomes", async () => {
      const inserted: Inserted[] = [];
      const res = await post(
        mk(uniqueViolation(ATT_IDEMP_UQ), inserted, () => []),
        { worker_id: W1, day: DAY, idempotency_key: IDEMP_KEY },
      );
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe("idempotency_key already used");
    });
  });

  it("the replay does NOT weaken validation: an invalid status still 400s and a foreign worker still 400s, key or no key", async () => {
    const inserted: Inserted[] = [];
    const db = writeStub({
      rows: [
        [users, [userRow]],
        [roles, [roleRow()]],
        [workers, []], // worker not in this tenant
        [attendances, () => [
          { id: "at-1", companyId: COMPANY, workerId: W1, day: DAY, ot: "0.00",
            status: "full", dayFraction: "1", ccId: null, idempotencyKey: IDEMP_KEY, createdAt: D },
        ]],
      ],
      inserted,
    });
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db });
    // A foreign worker 400s even though the key WOULD resolve a row — the pre-check
    // sits below the tenant gate, so a key can never be used to bypass it.
    const foreign = await app.inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY, idempotency_key: IDEMP_KEY },
    });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().message).toMatch(/worker not found/);
    // …and the status enum still rejects before anything is resolved or written.
    const bad = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: idempDb({ stored: () => [] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY, status: "vacation", idempotency_key: IDEMP_KEY },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/full, half, absent/);
    expect(inserted.filter((i) => i.table === attendances)).toHaveLength(0);
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
// B-308 — POST /labor/payroll idempotency (natural key unique(worker_id, period))
// ---------------------------------------------------------------------------
// WHY this is a MONEY contract: the GL guard is per payroll ROW — postLaborPayroll
// keys source_doc `payroll:<id>` against jv_source_doc_uq — so TWO runs mint TWO ids
// and BOTH post as clean, balanced, uncorrelatable JVs. Reproduced live before the
// fix: JV-2026-0419 + JV-2026-0420, 687.50 each = 1,375.00 paid for one day's work.
// The load-bearing assertion in the first test is therefore the JV COUNT, not the row
// count: the row count alone does not reach the place the money lands.
// ===========================================================================

const PAY_UQ = "payroll_worker_period_uq";
const PERIOD = "2026-05";

/**
 * Row-aware payroll reads. The handler issues TWO shapes against `payroll` and they
 * must NOT answer each other: the B-308 natural-key resolve (worker_id + period, used
 * by both the pre-check and the 23505 catch) and /post's lookup by id. A row-blind
 * stub would hand the first stored row to both and hide a resolver that binds nothing.
 */
const payrollReads =
  (stored: () => Record<string, unknown>[]) =>
  (where: SQL | undefined): unknown[] => {
    const params = paramsOf(where);
    return stored().filter(
      (r) =>
        params.includes(r.id) ||
        (params.includes(r.workerId) && params.includes(r.period)),
    );
  };

/**
 * Row-aware jv reads: an unfiltered scan is allocJvNo (it numbers off every jv); a
 * filtered one is either the source_doc idempotency probe or insertThrough's
 * ownership proof on the just-written parent jv (by id). Derived from what was really
 * inserted, so a SECOND post is genuinely visible to the pre-check.
 */
const jvReads =
  (stored: () => Record<string, unknown>[]) =>
  (where: SQL | undefined): unknown[] => {
    if (!where) return stored();
    const params = paramsOf(where);
    return stored().filter((r) => params.includes(r.id) || params.includes(r.sourceDoc));
  };

/** Row-aware worker reads, so a create for W2 cannot be answered with W1's row. */
const workerReads =
  (all: (typeof workers.$inferSelect)[]) =>
  (where: SQL | undefined): unknown[] => {
    const params = paramsOf(where);
    return all.filter((w) => params.includes(w.id));
  };

/** Every payroll read this request made whose WHERE bound the natural key. */
const keyedPayReads = (captured: Captured[], period = PERIOD): Captured[] =>
  captured.filter((c) => c.table === payrolls && paramsOf(c.where).includes(period));

/** The write-capable stub for the B-308 cases: authz + one 450/day worker + COA. */
const payDb = (opts: {
  storedPay?: () => Record<string, unknown>[];
  storedJv?: () => Record<string, unknown>[];
  payrollRows?: RowSource;
  workerRows?: (typeof workers.$inferSelect)[];
  attendance?: unknown[];
  captured?: Captured[];
  inserted?: Inserted[];
  insertThrows?: (table: unknown, nth: number) => Error | null;
  onInsert?: (table: unknown, rows: Record<string, unknown>[]) => void;
}) =>
  writeStub({
    rows: [
      [users, [userRow]],
      [roles, [roleRow()]],
      [workers, workerReads(opts.workerRows ?? [worker(W1, "สมหมาย", "450")])],
      // one in-period full day + 2 OT hrs = 450 + 168.75 = ONE_DAY_PAY (618.75).
      [attendances, opts.attendance ?? [att(`${PERIOD}-10`, "1", "2.00")]],
      [payrolls, opts.payrollRows ?? payrollReads(opts.storedPay ?? (() => []))],
      [jvs, jvReads(opts.storedJv ?? (() => []))],
      [glAccounts, COA_ROWS],
    ],
    captured: opts.captured,
    inserted: opts.inserted,
    insertThrows: opts.insertThrows,
    onInsert: opts.onInsert,
  });

describe("POST /api/v1/labor/payroll — B-308 idempotency (natural key + replay)", () => {
  it("running the SAME worker+period twice → ONE payroll row, the replay returns the ORIGINAL byte-for-byte, and exactly ONE JV posts (618.75 once, not 1237.50 as two JVs)", async () => {
    const inserted: Inserted[] = [];
    // Both stored views are DERIVED from what the handler actually wrote — so if the
    // replay created a second run, the second /post really would mint its own JV and
    // this test would go red. That is the whole point.
    const storedPay: Record<string, unknown>[] = [];
    const storedJv: Record<string, unknown>[] = [];
    const db = payDb({
      storedPay: () => storedPay,
      storedJv: () => storedJv,
      inserted,
      onInsert: (table, out) => {
        if (table === payrolls) storedPay.push(...out);
        if (table === jvs) storedJv.push(...out);
      },
    });
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db });
    const payload = { worker_id: W1, period: PERIOD };

    const res1 = await app.inject({ method: "POST", url: "/api/v1/labor/payroll", payload });
    const res2 = await app.inject({ method: "POST", url: "/api/v1/labor/payroll", payload });

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);

    // THE MONEY ASSERTION FIRST, deliberately: post BOTH returned ids to the GL. Before
    // B-308 they were DIFFERENT ids, so jv_source_doc_uq saw two unrelated docs and
    // both posted — 2 balanced JVs, 1,237.50 for one day (live: JV-2026-0419 +
    // JV-2026-0420). Now they are the SAME id, so the second post is the already-posted
    // case → 409 and the ledger carries ONE JV for ONE amount. It leads the test so the
    // REVERT PROBE dies HERE, on the ledger, rather than on an earlier row-shape
    // assertion — a test that never reaches the money is not encoding the defect.
    const post1 = await app.inject({ method: "POST", url: `/api/v1/labor/payroll/${res1.json().id}/post` });
    const post2 = await app.inject({ method: "POST", url: `/api/v1/labor/payroll/${res2.json().id}/post` });
    const jvInserts = inserted.filter((i) => i.table === jvs);
    expect(jvInserts).toHaveLength(1); // ONE JV, not two
    expect(storedJv).toHaveLength(1);
    // …and it books the day ONCE: Σ Dr === Σ Cr === 618.75, not 1237.50.
    const lines = inserted
      .filter((i) => i.table === jvLines)
      .flatMap((i) => i.values as Record<string, unknown>[]);
    expect(lines.reduce((s, l) => s + Number(l.dr), 0)).toBe(ONE_DAY_PAY);
    expect(lines.reduce((s, l) => s + Number(l.cr), 0)).toBe(ONE_DAY_PAY);
    expect(post1.statusCode).toBe(200);
    expect(post1.json().amount).toBe(ONE_DAY_PAY);
    expect(post2.statusCode).toBe(409);
    expect(post2.json().message).toMatch(/already posted/);

    // …and the row half: the second run is idempotent — the operator sees the run that
    // already exists (same id), byte-identical by construction (one sender, one wire fn).
    expect(res2.json()).toEqual(res1.json());
    expect(res2.json().id).toBe(res1.json().id);
    expect(res1.json().amount).toBe(ONE_DAY_PAY);
    // exactly ONE row written across BOTH requests.
    expect(inserted.filter((i) => i.table === payrolls)).toHaveLength(1);
    expect(storedPay).toHaveLength(1);
  });

  it("the 23505 backstop fires when the PRE-CHECK misses (the real concurrent double-click) → 201 with the ORIGINAL, still one row", async () => {
    const inserted: Inserted[] = [];
    const captured: Captured[] = [];
    const storedPay: Record<string, unknown>[] = [];
    // The real race: resolves 0 (run #1) and 1 (run #2's pre-check) both happen BEFORE
    // the original is visible to us; our insert then trips the index, and resolve 2
    // (the catch's, after that commit) finds it. Exactly the window an app-level
    // pre-check cannot close — which is why the catch is kept.
    let keyedReadNo = 0;
    const racePay = (where: SQL | undefined): unknown[] => {
      const params = paramsOf(where);
      if (params.includes(W1) && params.includes(PERIOD)) {
        return keyedReadNo++ < 2 ? [] : storedPay;
      }
      return storedPay.filter((r) => params.includes(r.id));
    };
    const db = payDb({
      payrollRows: racePay,
      inserted,
      captured,
      onInsert: (table, out) => {
        if (table === payrolls) storedPay.push(...out);
      },
      // the 2nd insert (the replay) trips payroll_worker_period_uq; the 1st is fine.
      insertThrows: (table, nth) => (table === payrolls && nth >= 1 ? uniqueViolation(PAY_UQ) : null),
    });
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db });
    const payload = { worker_id: W1, period: PERIOD };
    const res1 = await app.inject({ method: "POST", url: "/api/v1/labor/payroll", payload });
    const res2 = await app.inject({ method: "POST", url: "/api/v1/labor/payroll", payload });

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(res2.json()).toEqual(res1.json()); // the ORIGINAL, produced by the same sender
    expect(inserted.filter((i) => i.table === payrolls)).toHaveLength(1);
    expect(storedPay).toHaveLength(1);
    // 3 keyed resolves: run#1's pre-check, run#2's pre-check (missed), the catch's.
    expect(keyedPayReads(captured)).toHaveLength(3);
  });

  it("N simultaneous double-clicks on the same worker+period → ONE row and one shared id (every loser replays the winner)", async () => {
    const inserted: Inserted[] = [];
    const storedPay: Record<string, unknown>[] = [];
    const N = 4;
    // Honest model of TRUE simultaneity — and deliberately NOT "run the injects through
    // Promise.all and hope they interleave": in-process they do not, every loser's
    // pre-check then finds the winner and the index is never exercised (the first cut
    // of this test proved exactly that, via the `thrown` assertion below). So the
    // window is modelled explicitly: EVERY pre-check is blind, and only a resolve that
    // follows a 23505 — i.e. the catch's — can see the winner.
    let thrown = 0;
    let sawViolation = false;
    const racePay = (where: SQL | undefined): unknown[] => {
      const params = paramsOf(where);
      if (!(params.includes(W1) && params.includes(PERIOD))) {
        return storedPay.filter((r) => params.includes(r.id));
      }
      if (sawViolation) {
        sawViolation = false;
        return storedPay;
      }
      return [];
    };
    const db = payDb({
      payrollRows: racePay,
      inserted,
      onInsert: (table, out) => {
        if (table === payrolls) storedPay.push(...out);
      },
      insertThrows: (table, nth) => {
        if (table !== payrolls || nth < 1) return null;
        thrown++;
        sawViolation = true;
        return uniqueViolation(PAY_UQ);
      },
    });
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db });
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        app.inject({ method: "POST", url: "/api/v1/labor/payroll", payload: { worker_id: W1, period: PERIOD } }),
      ),
    );
    expect(results.map((r) => r.statusCode)).toEqual(Array(N).fill(201));
    const ids = new Set(results.map((r) => r.json().id));
    expect(ids.size).toBe(1); // one run, N callers — no second postable row exists
    expect(inserted.filter((i) => i.table === payrolls)).toHaveLength(1);
    expect(storedPay).toHaveLength(1);
    // every loser got past its pre-check and was stopped by the INDEX, not the app.
    expect(thrown).toBe(N - 1);
  });

  it("a DIFFERENT period and a DIFFERENT worker still create (the key rejects nothing that is real work)", async () => {
    const inserted: Inserted[] = [];
    const storedPay: Record<string, unknown>[] = [];
    const db = payDb({
      storedPay: () => storedPay,
      workerRows: [worker(W1, "สมหมาย", "450"), worker(W2, "บุญมี", "420")],
      inserted,
      onInsert: (table, out) => {
        if (table === payrolls) storedPay.push(...out);
      },
    });
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db });
    for (const payload of [
      { worker_id: W1, period: PERIOD }, // the original run
      { worker_id: W1, period: "2026-06" }, // same worker, NEXT period
      { worker_id: W2, period: PERIOD }, // same period, ANOTHER worker
    ]) {
      const r = await app.inject({ method: "POST", url: "/api/v1/labor/payroll", payload });
      expect(r.statusCode).toBe(201);
    }
    const payInserts = inserted.filter((i) => i.table === payrolls);
    expect(payInserts).toHaveLength(3);
    expect(new Set(payInserts.map((i) => (i.values as Record<string, unknown>).period)).size).toBe(2);
    // …and only the exact repeat dedups.
    const repeat = await app.inject({
      method: "POST",
      url: "/api/v1/labor/payroll",
      payload: { worker_id: W1, period: PERIOD },
    });
    expect(repeat.statusCode).toBe(201);
    expect(inserted.filter((i) => i.table === payrolls)).toHaveLength(3); // no 4th row
  });

  it("the natural-key resolve is TENANT-scoped (binds company_id + worker_id + period, never another company)", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: payDb({ captured }) })
    ).inject({ method: "POST", url: "/api/v1/labor/payroll", payload: { worker_id: W1, period: PERIOD } });
    expect(res.statusCode).toBe(201);
    const keyed = keyedPayReads(captured);
    expect(keyed.length).toBeGreaterThan(0);
    for (const c of keyed) {
      const params = paramsOf(c.where);
      // payroll carries company_id directly → the plain scoped door binds it (zero
      // hops, no selectThrough). Company B therefore cannot resolve company A's run.
      expect(params).toContain(COMPANY);
      expect(params).toContain(W1);
      expect(params).toContain(PERIOD);
      expect(params).not.toContain(OTHER_COMPANY);
    }
  });

  it("409s when the collision resolves to NO row in this tenant (a cross-tenant clash — never a leak, never a fabricated success)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: payDb({
          // the colliding row belongs to ANOTHER company → invisible through our door
          storedPay: () => [],
          inserted,
          insertThrows: (table) => (table === payrolls ? uniqueViolation(PAY_UQ) : null),
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/payroll", payload: { worker_id: W1, period: PERIOD } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
    expect(res.json().message).toMatch(/already run for this worker and period/);
    expect(res.json().id).toBeUndefined();
    expect(inserted.filter((i) => i.table === payrolls)).toHaveLength(0);
  });

  it("a 23505 from a DIFFERENT constraint is NOT swallowed as a replay (B-263 name gate) → rethrows, no fabricated 201", async () => {
    const inserted: Inserted[] = [];
    const storedPay = [
      { id: "pay-other", companyId: COMPANY, workerId: W1, period: PERIOD, amount: "1.00", currencyCode: "THB", ccId: null, createdAt: D },
    ];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: payDb({
          // a row IS resolvable — so a handler gating on bare 23505 would happily echo
          // it. Only the constraint-NAME check keeps this honest.
          storedPay: () => storedPay,
          payrollRows: (where) => (paramsOf(where).includes(PERIOD) ? [] : storedPay),
          inserted,
          insertThrows: (table) => (table === payrolls ? uniqueViolation("payroll_pkey") : null),
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/payroll", payload: { worker_id: W1, period: PERIOD } });
    expect(res.statusCode).toBe(500); // the safe failure for a money write
    expect(res.json().id).toBeUndefined();
    expect(inserted.filter((i) => i.table === payrolls)).toHaveLength(0);
  });

  it("validation still runs ABOVE the dedup — a foreign worker 400s even when a prior run exists (a repeat can never bypass the tenant gate)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: payDb({
          workerRows: [], // the worker is not this tenant's
          storedPay: () => [
            { id: "pay-x", companyId: COMPANY, workerId: W1, period: PERIOD, amount: "5.00", currencyCode: "THB", ccId: null, createdAt: D },
          ],
          inserted,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/payroll", payload: { worker_id: W1, period: PERIOD } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/worker not found/);
    expect(inserted.filter((i) => i.table === payrolls)).toHaveLength(0);
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

// ===========================================================================
// B-332 — worker.user_id, the split attendance gate, and POST /labor/attendance/checkout
// ===========================================================================
// Migration 0062 adds the auth link (worker.user_id + worker_user_uq) and the
// field check-in/out columns. These pin the BRANCHES; the DB-level truths a stub
// can only fabricate — the partial index really rejecting a second link, the
// guarded UPDATE really blocking a concurrent writer on a row lock, and the three
// legitimate-work cases NOT being rejected — are proven on real Postgres in
// tests/e2e/b332-checkin-schema.spec.ts.

/** A user row other than the caller's — the target of a worker↔user link. */
const LINK_USER = "u-link";
const linkUserRow = { ...userRow, id: LINK_USER, email: "linked@rungrueang.co.th" };

/** A worker carrying (or not) the B-332 auth link. */
const linkedWorker = (id: string, userId: string | null): typeof workers.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    name: `worker-${id}`,
    dayRate: "500.00",
    currencyCode: "THB",
    userId,
    active: true,
    createdAt: D,
    updatedAt: D,
  }) as typeof workers.$inferSelect;

/**
 * Route the two DIFFERENT reads that both hit `workers` by the predicate's params:
 *   - the SELF lookup filters on user_id (findWorkerByUserId → the caller's id);
 *   - the TENANT lookup filters on worker id.
 * Discriminating on the params is what lets one stub answer both without the test
 * hand-waving which read it is serving.
 */
const workerSource =
  (opts: { self?: unknown[]; byId?: unknown[] }) =>
  (where: SQL | undefined): unknown[] => {
    const params = paramsOf(where);
    const isSelfLookup = params.includes("u-0") || params.includes(LINK_USER);
    return (isSelfLookup ? opts.self : opts.byId) ?? [];
  };

/** Route the caller's email lookup (loadUserByEmail) vs the link-target id lookup. */
const userSource =
  (linkTarget: unknown[] = [linkUserRow]) =>
  (where: SQL | undefined): unknown[] =>
    paramsOf(where).includes(SESSION.user.email) ? [userRow] : linkTarget;

// NB: `uniqueViolation(constraint)` is the SAME helper the B-307 replay tests use
// (defined above) — the 23505 shape violatedConstraint() reads. Reused, never
// redefined, so a change to that error shape cannot leave half this file lying.

describe("B-332 POST /api/v1/labor/workers — the worker↔user auth link", () => {
  it("stores user_id after resolving the user through the SCOPED tenant door", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({
          rows: [[users, userSource()], [roles, [roleRow(true)]], [workers, []]],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/workers",
      payload: { name: "ปรานี", day_rate: 500, user_id: LINK_USER },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().user_id).toBe(LINK_USER);
    const values = inserted.find((i) => i.table === workers)?.values as Record<string, unknown>;
    expect(values.userId).toBe(LINK_USER);
  });

  it("400s a user_id that is not in THIS tenant — the only place the cross-tenant FK invariant can be established (no insert)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        // The scoped users door resolves nothing for the link target.
        db: writeStub({ rows: [[users, userSource([])], [roles, [roleRow(true)]]], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/workers",
      payload: { name: "ปรานี", user_id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/user not found in this tenant/);
    expect(inserted).toHaveLength(0);
  });

  // B-332 gate-4.5 finding 3 — THE HONEST HALF of "one user resolves to at most one
  // worker". This exercises the APPLICATION pre-check: the stub is asked for the rows
  // that already exist and answers with a worker carrying the link, exactly as the real
  // scoped read would. Nothing about the failure is supplied by the test — no injected
  // 23505 — so the assertion dies if and only if the pre-check is removed.
  //
  // The reviewer's probe is why this exists: deleting worker_user_uq from BOTH
  // packages/db/src/schema/finance.ts AND migration 0062 left api 1542 + db 19 fully
  // green, because the only test in the index's name injected the violation it claimed
  // to detect. That test still runs (below) but it proves the CATCH BRANCH, not the index.
  it("409s BEFORE inserting when the user is already linked to another worker — the app-level check, exercised without injecting the violation", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({
          rows: [
            [users, userSource()],
            [roles, [roleRow(true)]],
            // The user ALREADY resolves to a worker — the real read's answer, not a throw.
            [workers, workerSource({ self: [linkedWorker("w-incumbent", LINK_USER)] })],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/workers",
      payload: { name: "impostor", user_id: LINK_USER },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already linked to another worker/);
    // Refused BEFORE the write, and never handing back the incumbent's row.
    expect(inserted).toHaveLength(0);
    expect(res.json().id).toBeUndefined();
  });

  it("409s when the INSERT trips worker_user_uq — the concurrency backstop the pre-check cannot be (an app read loses the race, and the index is GLOBAL where the read is tenant-scoped)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({
          // No `workers` rows → the pre-check reads nothing, exactly as it would when a
          // racing link committed after it ran. Only then is the injected 23505 reached.
          rows: [[users, userSource()], [roles, [roleRow(true)]]],
          insertThrows: (table) => (table === workers ? uniqueViolation("worker_user_uq") : null),
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/workers",
      payload: { name: "impostor", user_id: LINK_USER },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already linked to another worker/);
  });

  it("B-263: a 23505 on a DIFFERENT constraint is NOT swallowed as the link conflict (rethrows → 500, never a confidently wrong 409)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({
          rows: [[users, userSource()], [roles, [roleRow(true)]]],
          insertThrows: (table) => (table === workers ? uniqueViolation("some_future_worker_uq") : null),
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/workers",
      payload: { name: "impostor", user_id: LINK_USER },
    });
    expect(res.statusCode).toBe(500);
  });

  it("a create WITHOUT user_id never touches the link path (the 8 seeded workers stay unlinked)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({ rows: [[users, userSource()], [roles, [roleRow(true)]]], inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/workers", payload: { name: "สมหมาย" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().user_id).toBeNull();
    const values = inserted.find((i) => i.table === workers)?.values as Record<string, unknown>;
    expect(values.userId).toBeNull();
  });
});

describe("B-332 POST /api/v1/labor/attendance — the gate split by WHO IS BEING RECORDED", () => {
  /** A caller with NO finance.create, linked through worker.user_id to `selfId`. */
  const selfServiceDb = (selfId: string | null, inserted: Inserted[] = []) =>
    writeStub({
      rows: [
        [users, userSource()],
        [roles, [roleRow(false, false)]],
        [
          workers,
          workerSource({
            self: selfId ? [linkedWorker(selfId, "u-0")] : [],
            byId: [linkedWorker(W1, "u-0")],
          }),
        ],
      ],
      inserted,
    });

  it("201s a worker clocking THEMSELVES in with NO finance.create — the Site Engineer defect, closed", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: selfServiceDb(W1, inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-08-07" },
    });
    expect(res.statusCode).toBe(201);
    expect(inserted.filter((i) => i.table === attendances)).toHaveLength(1);
  });

  it("403s a caller with NO finance.create recording SOMEBODY ELSE's day (no insert)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: selfServiceDb(W2, inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-08-07" },
    });
    expect(res.statusCode).toBe(403);
    expect(inserted).toHaveLength(0);
  });

  it("403s a user with NO worker row — never auto-creates one (a fabricated worker has day_rate NULL and is paid 0.00 behind a clean 201)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: selfServiceDb(null, inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-08-07" },
    });
    expect(res.statusCode).toBe(403);
    expect(inserted).toHaveLength(0);
  });

  it("answers the SAME 403 for 'no worker row' and 'somebody else's worker' — an unauthorized caller cannot probe which worker ids exist", async () => {
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db: selfServiceDb(null) });
    const noRow = await app.inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-08-07" },
    });
    const app2 = await buildTestApp({ resolveTenant: async () => SESSION, db: selfServiceDb(W2) });
    const otherWorker = await app2.inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-08-07" },
    });
    expect(noRow.json()).toEqual(otherWorker.json());
  });

  it("keeps the 403-BEFORE-400 ordering: an unauthorized caller sending no worker_id still gets 403, never a body-validation hint", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: selfServiceDb(null) })
    ).inject({ method: "POST", url: "/api/v1/labor/attendance", payload: { day: "2026-08-07" } });
    expect(res.statusCode).toBe(403);
  });

  it("400s a self-service caller asserting OVERTIME — the 1.5× premium is a supervisor judgement (refusal, not a silent zero; no insert)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: selfServiceDb(W1, inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-08-07", ot: 4 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/overtime cannot be recorded on a self-service check-in/);
    expect(inserted).toHaveLength(0);
  });

  it("a caller WITH finance.create may still record overtime (the shipped web roster is unchanged)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({
          rows: [[users, userSource()], [roles, [roleRow(true)]], [workers, [linkedWorker(W1, null)]]],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-08-07", ot: 4 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().ot).toBe(4);
  });

  // B-332 gate-4.5 finding 4 — `active` is the only "off the roster" flag there is, and
  // before this it governed nothing: the only real revocation was deleting the account.
  it("403s a DEACTIVATED worker clocking himself in — `active` is the only off-the-roster flag, and it now revokes the new door (no insert)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({
          rows: [
            [users, userSource()],
            [roles, [roleRow(false, false)]],
            [
              workers,
              workerSource({
                self: [{ ...linkedWorker(W1, "u-0"), active: false }],
                byId: [{ ...linkedWorker(W1, "u-0"), active: false }],
              }),
            ],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-08-07" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/not active/);
    expect(inserted).toHaveLength(0);
  });

  it("a supervisor WITH finance.create may still record a day for a deactivated worker (door 1 is deliberately not gated on `active` — a corrected day for a man who has left)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({
          rows: [
            [users, userSource()],
            [roles, [roleRow(true)]],
            [workers, [{ ...linkedWorker(W1, null), active: false }]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-08-07" },
    });
    expect(res.statusCode).toBe(201);
    expect(inserted.filter((i) => i.table === attendances)).toHaveLength(1);
  });
});

// ===========================================================================
// B-332 gate-4.5 finding 1 — THE PAYEE MAY NOT INFLATE HIS OWN PAY
// ===========================================================================
// Door 2 handed the attendance write to the person who RECEIVES the money, and
// createLaborPayroll pays by SUMMING ROWS. Live, before the fix: five self-service
// POSTs for one day, no idempotency key → 201,201,201,201,201 and a 5× payout behind
// a clean balanced JV, requested by the beneficiary. The idempotency key cannot see
// this class at all (a screen remount mints a NEW key for the same worker+day), so the
// remedy is the explicit pre-check finance.ts named and B-332 shipped without.
describe("B-332 gate-4.5 POST /api/v1/labor/attendance — the self-service duplicate gate", () => {
  const DAY = "2026-08-07";
  /** A day already on file for W1 (what the real scoped read would return). */
  const recorded = (over: Record<string, unknown> = {}): typeof attendances.$inferSelect =>
    ({
      id: "at-existing",
      companyId: COMPANY,
      workerId: W1,
      day: DAY,
      ot: "0.00",
      status: "full",
      dayFraction: "1",
      ccId: null,
      idempotencyKey: null,
      checkedInAt: null,
      checkedOutAt: null,
      createdAt: D,
      updatedAt: D,
      ...over,
    }) as typeof attendances.$inferSelect;

  const db = (opts: {
    selfId?: string | null;
    financeCreate?: boolean;
    onFile?: unknown[];
    inserted?: Inserted[];
  }) =>
    writeStub({
      rows: [
        [users, userSource()],
        [roles, [roleRow(opts.financeCreate ?? false, false)]],
        [
          workers,
          workerSource({
            self: opts.selfId === null ? [] : [linkedWorker(opts.selfId ?? W1, "u-0")],
            byId: [linkedWorker(W1, "u-0")],
          }),
        ],
        [attendances, opts.onFile ?? []],
      ],
      inserted: opts.inserted,
    });

  it("409s the SECOND self-service check-in for a day already recorded — the 5× payout, closed (no insert)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: db({ onFile: [recorded()], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already recorded/);
    expect(inserted).toHaveLength(0);
  });

  it("201s the FIRST self-service check-in — no legitimate case is refused", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: db({ onFile: [], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY },
    });
    expect(res.statusCode).toBe(201);
    expect(inserted.filter((i) => i.table === attendances)).toHaveLength(1);
  });

  it("does NOT fire on a DIFFERENT day — the guard is per-day, not a one-check-in-ever lock", async () => {
    const inserted: Inserted[] = [];
    const onFile = recorded({ day: "2026-08-06" });
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({
          rows: [
            [users, userSource()],
            [roles, [roleRow(false, false)]],
            [workers, workerSource({ self: [linkedWorker(W1, "u-0")], byId: [linkedWorker(W1, "u-0")] })],
            // The stub FILTERS on the day the predicate asks for, as the real index-backed
            // read does. Answering the row unconditionally would make this assertion
            // vacuous — it would pass whether or not the guard scopes to a day.
            [
              attendances,
              (where: SQL | undefined) =>
                paramsOf(where).includes(onFile.day) ? [onFile] : [],
            ],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY },
    });
    expect(res.statusCode).toBe(201);
    expect(inserted.filter((i) => i.table === attendances)).toHaveLength(1);
  });

  // THE regression this guard could most easily have caused. B-307's own pre-check
  // normally answers a replay first, so to reach the duplicate gate at all the retry has
  // to be CONCURRENT — the key-anchored read finds nothing because the original had not
  // committed yet, and then the day-anchored read finds it. Without the "not my own
  // replay" filter that is a 409, and the phone dead-letters a 4xx: a genuine retry would
  // be thrown away. Modelled by making ONLY the key-anchored read miss.
  it("B-307 SURVIVES a CONCURRENT replay: the key-anchored read misses, the day-anchored read finds the caller's OWN row, and it is not treated as a duplicate", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({
          rows: [
            [users, userSource()],
            [roles, [roleRow(false, false)]],
            [workers, workerSource({ self: [linkedWorker(W1, "u-0")], byId: [linkedWorker(W1, "u-0")] })],
            [
              attendances,
              (where: SQL | undefined) =>
                // key-anchored (B-307 pre-check) → nothing, as during the race;
                // day-anchored (the duplicate gate) → the row this very key created.
                paramsOf(where).includes("k-1") ? [] : [recorded({ idempotencyKey: "k-1" })],
            ],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY, idempotency_key: "k-1" },
    });
    // Falls through to the insert, where attendance_idempotency_uq + the 23505 catch are
    // what settle it — the same backstop B-307 always relied on.
    expect(res.statusCode).toBe(201);
    expect(inserted.filter((i) => i.table === attendances)).toHaveLength(1);
  });

  it("a replay resolved by the B-307 pre-check still returns the ORIGINAL row, not a 409", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: db({ onFile: [recorded({ id: "at-original", idempotencyKey: "k-1" })] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY, idempotency_key: "k-1" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("at-original");
  });

  it("a REMOUNT (new key, same worker+day) is a DUPLICATE, not a replay — the key index would have let it through", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        // findAttendanceByIdempotencyKey resolves nothing for the NEW key (the stub row
        // carries the old one), so the B-307 pre-check misses — exactly as in production.
        db: writeStub({
          rows: [
            [users, userSource()],
            [roles, [roleRow(false, false)]],
            [workers, workerSource({ self: [linkedWorker(W1, "u-0")], byId: [linkedWorker(W1, "u-0")] })],
            [
              attendances,
              (where: SQL | undefined) =>
                paramsOf(where).includes("k-2") ? [] : [recorded({ idempotencyKey: "k-1" })],
            ],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY, idempotency_key: "k-2" },
    });
    expect(res.statusCode).toBe(409);
    expect(inserted).toHaveLength(0);
  });

  // B-336 gate finding 3 — RENAMED, because the tree stopped doing what the old name
  // said. It read "…a second row for a recorded day is still accepted there
  // (corrections, bulk save, the cc split)" and asserted 201 + one insert. LIVE, that
  // exact request is now 409: `recorded()` carries `ccId: null`, so the second
  // UNCOSTED row for this worker+day trips attendance_self_day_uq. It passed only
  // because THE STUB HAS NO INDEX — the same defect this file names 1,280 lines above
  // (the fix for a test that only ever proved the stub is labelling, not another stub).
  // Left green rather than deleted because the branch it covers IS load-bearing and is
  // covered nowhere else: the application pre-check is gated on `authz.selfService`, so
  // the roster door must fall THROUGH it and reach the INSERT. What answers that insert
  // is the DB, and the live spec asserts the 409 end-to-end (b332-checkin-schema.spec.ts
  // "RECLASSIFIED (B-336)"). The three shapes the old name listed do not survive either:
  // the "correction" is the refused case (B-335 — it never corrected, it ADDED), the web
  // bulk-save has never POSTed attendance at all, and the cc split is a DIFFERENT row
  // (cc_id NOT NULL) covered by the keyed-read test below.
  it("does not PRE-CHECK the finance.create ROSTER door — the request falls through to the INSERT (which live is refused 409 by attendance_self_day_uq; this stub has no index)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({
          rows: [
            [users, userSource()],
            [roles, [roleRow(true)]],
            [workers, [linkedWorker(W1, null)]],
            [attendances, [recorded()]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY, status: "half" },
    });
    // 201 IS THE STUB'S ANSWER, NOT PRODUCTION'S. The assertion that carries the
    // meaning is the insert: the handler reached the DB rather than short-circuiting.
    expect(inserted.filter((i) => i.table === attendances)).toHaveLength(1);
    expect(res.statusCode).toBe(201);
  });

  it("400s a self-service caller asserting cc_id — it is the guard's own escape hatch (one re-inflation per cost centre) and the check-in screen has no cc affordance", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: db({ onFile: [], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY, cc_id: "cc-1" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/cc_id cannot be set on a self-service check-in/);
    expect(inserted).toHaveLength(0);
  });

  it("keys the duplicate read on worker + day + cc_id, so a cost-centre split is a distinct day rather than a conflict", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({
          rows: [
            [users, userSource()],
            [roles, [roleRow(false, false)]],
            [workers, workerSource({ self: [linkedWorker(W1, "u-0")], byId: [linkedWorker(W1, "u-0")] })],
            [attendances, []],
          ],
          captured,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY },
    });
    const dupRead = captured.filter((c) => c.table === attendances).at(-1);
    const sql = new PgDialect().sqlToQuery(dupRead!.where!).sql;
    expect(sql).toMatch(/"cc_id" is null/i);
    const params = paramsOf(dupRead?.where);
    expect(params).toContain(COMPANY); // still tenant-scoped by the door
    expect(params).toContain(W1);
    expect(params).toContain(DAY);
  });
});

// ---------------------------------------------------------------------------
// B-340 gate-4.5 finding 4 — the ROSTER door's cost centre
// ---------------------------------------------------------------------------
// cc_id was read from the body and handed straight to the INSERT, so an id with no
// cost_center row reached the FK: 23503, which `isUniqueViolation` does not match, so
// the catch rethrew it — measured `{"code":"INTERNAL_ERROR"}` 500 on the ONE door this
// round reworked precisely so its refusals are never 5xx (sync_processor.dart DEFERS a
// 5xx and the phone's whole offline drain stops behind it).
//
// AND IT IS A TENANT DOOR. cost_center carries NO company_id — it is scoped through
// project — so another tenant's cost centre satisfies the FK perfectly and would have
// been STORED on our attendance row, carrying into the payroll JV's cc allocation.
describe("B-340 gate-4.5 POST /api/v1/labor/attendance — cc_id is RESOLVED, never handed to the FK", () => {
  const DAY = "2026-08-07";
  const CC = "cc111111-2222-4333-8444-555555555555";
  const ccRow = {
    id: CC,
    projectId: "p-1",
    code: "CC-01",
    name: "Block A",
    type: null,
    link: null,
    owner: null,
    budget: null,
    currencyCode: "THB",
    status: "active",
    createdAt: D,
    updatedAt: D,
  };
  const rosterDb = (opts: { ccRows?: unknown[]; inserted?: Inserted[]; captured?: Captured[] }) =>
    writeStub({
      rows: [
        [users, userSource()],
        [roles, [roleRow(true)]],
        [workers, [linkedWorker(W1, null)]],
        [attendances, []],
        [costCenters, opts.ccRows ?? []],
      ],
      inserted: opts.inserted,
      captured: opts.captured,
    });

  it("400s an UNKNOWN cc_id and writes nothing — the FK would have answered 23503, i.e. a 500", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rosterDb({ ccRows: [], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY, status: "full", cc_id: CC },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/cc_id not found in this tenant/);
    // Refused BEFORE the write, so there is no row and no rollback to reason about.
    expect(inserted.filter((i) => i.table === attendances)).toHaveLength(0);
  });

  it("400s a MALFORMED cc_id BEFORE any query — `WHERE id = 'not-a-uuid'` is 22P02, the same 500 one keystroke away", async () => {
    const captured: Captured[] = [];
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rosterDb({ ccRows: [ccRow], captured, inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY, status: "full", cc_id: "not-a-uuid" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/cc_id must be a uuid/);
    // The shape gate is what keeps 22P02 off the wire: no cost_center read happened.
    expect(captured.filter((c) => c.table === costCenters)).toHaveLength(0);
    expect(inserted.filter((i) => i.table === attendances)).toHaveLength(0);
  });

  it("ACCEPTS a cc_id that resolves and stores it — the roster's cost-centre split is narrowed by nothing", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rosterDb({ ccRows: [ccRow], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY, status: "half", cc_id: CC },
    });
    expect(res.statusCode).toBe(201);
    const row = inserted.find((i) => i.table === attendances)!.values as Record<string, unknown>;
    expect(row.ccId).toBe(CC);
    expect(row.dayFraction).toBe("0.5");
  });

  it("resolves the cost centre THROUGH project — cost_center has no company_id, so a plain scoped read could not express the tenant", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rosterDb({ ccRows: [ccRow], captured }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: DAY, status: "full", cc_id: CC },
    });
    const ccRead = captured.filter((c) => c.table === costCenters).at(-1);
    expect(ccRead, "the door must READ the cost centre, not trust the body").toBeDefined();
    const sql = new PgDialect().sqlToQuery(ccRead!.where!).sql;
    // The tenant predicate lands on PROJECT, one hop up — that is the whole point.
    expect(sql).toMatch(/"project"\."company_id"/i);
    const params = paramsOf(ccRead!.where);
    expect(params).toContain(COMPANY);
    expect(params).toContain(CC);
  });
});

describe("B-332 POST /api/v1/labor/attendance — the field check-in stamp + device fix", () => {
  const financeDb = (inserted: Inserted[] = []) =>
    writeStub({
      rows: [[users, userSource()], [roles, [roleRow(true)]], [workers, [linkedWorker(W1, null)]]],
      inserted,
    });

  it("stores the CLIENT-supplied check-in instant and the coordinate pair (a queued op may drain hours later — a server now() would record the SYNC time)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: financeDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: {
        worker_id: W1,
        day: "2026-08-07",
        checked_in_at: "2026-08-07T00:45:00.000Z",
        checkin_lat: 13.8076,
        checkin_lng: 100.4519,
      },
    });
    expect(res.statusCode).toBe(201);
    const values = inserted.find((i) => i.table === attendances)?.values as Record<string, unknown>;
    expect((values.checkedInAt as Date).toISOString()).toBe("2026-08-07T00:45:00.000Z");
    // 6 dp == the mobile formatter's precision (formatGpsFix toStringAsFixed(6)).
    expect(values.checkinLat).toBe("13.807600");
    expect(values.checkinLng).toBe("100.451900");
    // The create never writes the check-out half AT ALL — the column is absent from
    // the insert payload and defaults to NULL, and it is later stamped onto THIS row
    // by the checkout UPDATE, never by a second insert.
    // (The real column then defaults to NULL — proven on Postgres in the live spec,
    // which a stub echoing its own insert payload cannot show.)
    expect(Object.keys(values)).not.toContain("checkedOutAt");
    expect(Object.keys(values)).not.toContain("checkoutLat");
    expect(Object.keys(values)).not.toContain("checkoutLng");
  });

  it("a check-in with NO coordinate is accepted — GpsSource returns a plain null for denied/off/no-fix and never fabricates one", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: financeDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-08-07", checked_in_at: "2026-08-07T00:45:00.000Z" },
    });
    expect(res.statusCode).toBe(201);
    const values = inserted.find((i) => i.table === attendances)?.values as Record<string, unknown>;
    expect(values.checkinLat).toBeNull();
    expect(values.checkinLng).toBeNull();
  });

  it("400s an out-of-range latitude (numeric(9,6) would raise 22003 → a 500, and the phone DEFERS a 5xx and stops the whole drain)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: financeDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-08-07", checkin_lat: 999, checkin_lng: 100.4 },
    });
    expect(res.statusCode).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it("400s a PRESENT but unparseable coordinate instead of letting it collapse to the absent path (B-309's failure shape, one column over)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: financeDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-08-07", checkin_lat: "abc", checkin_lng: "xyz" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/must be a number/);
    expect(inserted).toHaveLength(0);
  });

  it("treats an explicit null coordinate as ABSENT (the wire form of 'no fix'), not as an error", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: financeDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-08-07", checkin_lat: null, checkin_lng: null },
    });
    expect(res.statusCode).toBe(201);
    const values = inserted.find((i) => i.table === attendances)?.values as Record<string, unknown>;
    expect(values.checkinLat).toBeNull();
  });

  it("400s a LONE latitude — half a coordinate would leave a row that looks located and cannot be measured", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: financeDb() })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-08-07", checkin_lat: 13.8 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/must be supplied together/);
  });

  it("400s an unparseable check-in instant instead of silently dropping it (a phone that recorded 07:45 must not be told it succeeded)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: financeDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "2026-08-07", checked_in_at: "not-a-timestamp" },
    });
    expect(res.statusCode).toBe(400);
    expect(inserted).toHaveLength(0);
  });
});

describe("B-332 POST /api/v1/labor/attendance/checkout — close the day on the SAME row", () => {
  const KEY = "ck-1";
  const OUT_AT = "2026-08-07T10:30:00.000Z";
  const checkedIn = (): typeof attendances.$inferSelect =>
    ({
      id: "at-1",
      companyId: COMPANY,
      workerId: W1,
      day: "2026-08-07",
      ot: "0.00",
      status: "full",
      dayFraction: "1",
      ccId: null,
      idempotencyKey: KEY,
      checkedInAt: new Date("2026-08-07T00:45:00.000Z"),
      checkedOutAt: null,
      createdAt: D,
      updatedAt: D,
    }) as typeof attendances.$inferSelect;

  const checkoutDb = (opts: {
    row?: unknown[];
    inserted?: Inserted[];
    updated?: Updated[];
    updateReturns?: WriteStubOpts["updateReturns"];
    financeCreate?: boolean;
  }) =>
    writeStub({
      rows: [
        [users, userSource()],
        [roles, [roleRow(opts.financeCreate ?? true)]],
        [workers, workerSource({ self: [linkedWorker(W1, "u-0")], byId: [linkedWorker(W1, null)] })],
        [attendances, opts.row ?? [checkedIn()]],
      ],
      inserted: opts.inserted,
      updated: opts.updated,
      updateReturns: opts.updateReturns,
    });

  const body = (over: Record<string, unknown> = {}) => ({
    worker_id: W1,
    day: "2026-08-07",
    check_in_key: KEY,
    checked_out_at: OUT_AT,
    ...over,
  });

  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/labor/attendance/checkout",
      payload: body(),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });

  it("stamps checked_out_at onto the EXISTING row — an UPDATE, never a second row (a second row carries its own day_fraction and pays the day twice)", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: checkoutDb({ inserted, updated }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance/checkout",
      payload: body({ checkout_lat: 13.8077, checkout_lng: 100.452 }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("at-1");
    expect(res.json().checked_out_at).toBe(OUT_AT);
    // THE assertion of the whole design decision: zero inserts, exactly one update.
    expect(inserted).toHaveLength(0);
    expect(updated.filter((u) => u.table === attendances)).toHaveLength(1);
    const set = updated[0]!.set;
    expect((set.checkedOutAt as Date).toISOString()).toBe(OUT_AT);
    expect(set.checkoutLat).toBe("13.807700");
    expect(set.checkoutLng).toBe("100.452000");
  });

  it("puts the `checked_out_at IS NULL` guard on the UPDATE's OWN where, not on a preceding select (B-149: a resolve-then-update pair is two round trips and both writers pass the read)", async () => {
    const updated: Updated[] = [];
    await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: checkoutDb({ updated }) })
    ).inject({ method: "POST", url: "/api/v1/labor/attendance/checkout", payload: body() });
    const sql = new PgDialect().sqlToQuery(updated[0]!.where!).sql;
    expect(sql).toMatch(/"checked_out_at" is null/i);
    // …AND the tenant predicate is still AND-ed in by the scoped door.
    expect(paramsOf(updated[0]!.where)).toContain(COMPANY);
  });

  it("200s a REPLAY: the guard matched 0 rows but the stored instant equals the requested one → the original row, no second write", async () => {
    const closed = { ...checkedIn(), checkedOutAt: new Date(OUT_AT) };
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: checkoutDb({ row: [closed], updated, updateReturns: () => [] }),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/attendance/checkout", payload: body() });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe("at-1");
    expect(res.json().checked_out_at).toBe(OUT_AT);
  });

  it("409s a GENUINE second check-out: the guard matched 0 rows and the stored instant DIFFERS — the first close is the record and is never overwritten", async () => {
    const closed = { ...checkedIn(), checkedOutAt: new Date("2026-08-07T09:00:00.000Z") };
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: checkoutDb({ row: [closed], updateReturns: () => [] }),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/attendance/checkout", payload: body() });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already checked out/);
  });

  it("404s a check_in_key that resolves nothing — the phone dead-letters a 4xx, so a check-in that itself died is visibly, not silently, unmatched", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: checkoutDb({ row: [] }) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance/checkout",
      payload: body({ check_in_key: "never-existed" }),
    });
    expect(res.statusCode).toBe(404);
  });

  it("resolves the row through the tenant + worker + day anchors (attendance_idempotency_uq is a GLOBAL index on the key alone)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({
          rows: [
            [users, userSource()],
            [roles, [roleRow(true)]],
            [workers, workerSource({ self: [], byId: [linkedWorker(W1, null)] })],
            [attendances, [checkedIn()]],
          ],
          captured,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/attendance/checkout", payload: body() });
    const attRead = captured.find((c) => c.table === attendances);
    const params = paramsOf(attRead?.where);
    expect(params).toContain(COMPANY);
    expect(params).toContain(KEY);
    expect(params).toContain(W1);
    expect(params).toContain("2026-08-07");
  });

  it("403s a caller with NO finance.create closing SOMEBODY ELSE's day, BEFORE the row is resolved (else 404-vs-403 leaks which keys exist)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({
          rows: [
            [users, userSource()],
            [roles, [roleRow(false, false)]],
            [workers, workerSource({ self: [linkedWorker(W2, "u-0")], byId: [linkedWorker(W1, null)] })],
            [attendances, [checkedIn()]],
          ],
          updated,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/attendance/checkout", payload: body() });
    expect(res.statusCode).toBe(403);
    expect(updated).toHaveLength(0);
  });

  it("200s a worker closing their OWN day with no finance.create", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: checkoutDb({ financeCreate: false }),
      })
    ).inject({ method: "POST", url: "/api/v1/labor/attendance/checkout", payload: body() });
    expect(res.statusCode).toBe(200);
  });

  it("400s a missing checked_out_at — a server now() would differ on every replay and turn each retry into a 409", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: checkoutDb({}) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance/checkout",
      payload: { worker_id: W1, day: "2026-08-07", check_in_key: KEY },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/checked_out_at is required/);
  });

  it("400s a missing check_in_key (the row has no other address the phone can hold offline)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: checkoutDb({}) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance/checkout",
      payload: { worker_id: W1, day: "2026-08-07", checked_out_at: OUT_AT },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/check_in_key is required/);
  });

  it("B-309 inherited: a present-but-NON-STRING check_in_key is a 400, not a silently-nulled key that 404s a real day", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: checkoutDb({}) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance/checkout",
      payload: body({ check_in_key: 123 }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/check_in_key must be a string/);
  });

  it("400s an out-of-range check-out coordinate (no update)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: checkoutDb({ updated }) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance/checkout",
      payload: body({ checkout_lat: 13.8, checkout_lng: 999 }),
    });
    expect(res.statusCode).toBe(400);
    expect(updated).toHaveLength(0);
  });

  // B-332 gate-4.5 finding 6 — the coordinates were range-checked; the instant pair was
  // not. Live before the fix: an 08:00 check-in closed at 06:00 stored happily, 200.
  it("400s a check-out EARLIER than its own check-in — a day cannot be closed before it was opened (no update)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: checkoutDb({ updated }) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance/checkout",
      // The row's checked_in_at is 00:45Z; this closes it two hours before that.
      payload: body({ checked_out_at: "2026-08-06T22:45:00.000Z" }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/cannot be earlier than checked_in_at/);
    expect(updated).toHaveLength(0);
  });

  it("accepts a NIGHT SHIFT closing on the next calendar day — the guard compares INSTANTS, not the `day` the pair is filed under", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: checkoutDb({
          row: [{ ...checkedIn(), checkedInAt: new Date("2026-08-07T15:00:00.000Z") }],
          updated,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance/checkout",
      // 22:00 Bangkok on the 7th → 06:00 Bangkok on the 8th, still `day` = the 7th.
      payload: body({ checked_out_at: "2026-08-07T23:00:00.000Z" }),
    });
    expect(res.statusCode).toBe(200);
    expect(updated.filter((u) => u.table === attendances)).toHaveLength(1);
  });

  it("does not constrain a row with NO check-in instant — the web bulk-save records a day with neither stamp, and there is nothing to order against", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: checkoutDb({ row: [{ ...checkedIn(), checkedInAt: null }], updated }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance/checkout",
      payload: body({ checked_out_at: "2026-08-06T22:45:00.000Z" }),
    });
    expect(res.statusCode).toBe(200);
    expect(updated.filter((u) => u.table === attendances)).toHaveLength(1);
  });
});

// ===========================================================================
// B-332 gate-4.5 finding 2 — A MALFORMED `day` IS A 400 ON BOTH NEW DOORS
// ---------------------------------------------------------------------------
// WHAT THESE PROVE, AND WHAT THEY CANNOT. They prove the HANDLER refuses a `day`
// that is not a YYYY-MM-DD calendar date, on both doors, before any DB call —
// asserted from the status, the message, and ZERO writes reaching the stub.
//
// They CANNOT show the 500 that used to happen: a stub has no `date` column to
// raise 22007, so the pre-fix behaviour here was a 201 with garbage, not a 500.
// The 500 was measured LIVE at 0de5782 against real Postgres, on both doors:
//   POST /labor/attendance           day="not-a-date" → 500 · "2121-13-45" → 500
//   POST /labor/attendance/checkout  day="not-a-date" → 500 · "2121-13-45" → 500
// and the live spec now carries that end-to-end (b332-checkin-schema.spec.ts,
// "a malformed `day` is a 400 on BOTH doors"). Said here for the reason the
// B-336 block above says it: a test named for something it cannot see is how
// the review before last found a suite proving its own stub.
//
// WHY THE 500 MATTERED ENOUGH TO SPEND A ROUND ON: the mobile SyncProcessor
// dead-letters a 4xx permanently but DEFERS a 5xx and STOPS the drain, so ONE
// malformed queued op wedges every write behind it for that worker.
//
// REVERT PROBE, run per door rather than claimed (21 tests here):
//   - drop requireCalendarDay from the CREATE door only → 10 RED here (the 8
//     refusals, the leap-rule test, and the never-touches-`attendance` test),
//     and 2 RED live;
//   - drop it from the CHECKOUT door only → 8 RED here, 1 RED live.
// The remaining 3 are CONTROLS and stay green on either revert, deliberately:
// `day is required` (unchanged behaviour), the accepted-shapes list (proves the
// refusals narrow nothing that exists), and the B-337 test (proves what this
// does NOT close). They are labelled rather than counted as proof.
// ===========================================================================
describe("B-332 gate-4.5 — `day` must be a YYYY-MM-DD calendar date (both attendance doors)", () => {
  const KEY = "ck-day";
  const stub = (touched: { inserted: Inserted[]; updated: Updated[]; captured: Captured[] }) =>
    writeStub({
      rows: [
        [users, userSource()],
        [roles, [roleRow(true)]],
        [workers, workerSource({ self: [linkedWorker(W1, "u-0")], byId: [linkedWorker(W1, null)] })],
        [
          attendances,
          [
            {
              id: "at-1", companyId: COMPANY, workerId: W1, day: "2026-08-07", ot: "0.00",
              status: "full", dayFraction: "1", ccId: null, idempotencyKey: KEY,
              checkedInAt: null, checkedOutAt: null, createdAt: D, updatedAt: D,
            },
          ],
        ],
      ],
      inserted: touched.inserted,
      updated: touched.updated,
      captured: touched.captured,
    });

  /** Every shape that reached the `date` column before this fix, and what it did there. */
  const REFUSED: Array<[string, string]> = [
    ["not-a-date", "unparseable — 500 live (22007)"],
    ["2121-13-45", "month 13, day 45 — 500 live (22008)"],
    ["2121-02-30", "shape-valid, not a date — 500 live"],
    ["2121-01-01T00:00:00Z", "an ISO INSTANT — silently coerced to 2121-01-01 and 201 live"],
    ["01/02/2121", "AMBIGUOUS — 2121-01-02 under MDY, 1 Feb under DMY (a session GUC)"],
    ["today", "a RELATIVE keyword — stored as the SERVER's current date, live"],
    ["infinity", "accepted by the date column, live — a row no period query can sum"],
    ["2026-08-07 08:00", "a timestamp — the day is not the only thing being said"],
  ];

  describe.each(REFUSED)("POST /labor/attendance day=%j", (day, why) => {
    it(`400s and writes nothing (${why})`, async () => {
      const touched = { inserted: [] as Inserted[], updated: [] as Updated[], captured: [] as Captured[] };
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: stub(touched) })
      ).inject({
        method: "POST",
        url: "/api/v1/labor/attendance",
        payload: { worker_id: W1, day },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe("day must be a YYYY-MM-DD calendar date");
      expect(touched.inserted).toHaveLength(0);
    });
  });

  describe.each(REFUSED)("POST /labor/attendance/checkout day=%j", (day, why) => {
    it(`400s and writes nothing (${why})`, async () => {
      const touched = { inserted: [] as Inserted[], updated: [] as Updated[], captured: [] as Captured[] };
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: stub(touched) })
      ).inject({
        method: "POST",
        url: "/api/v1/labor/attendance/checkout",
        payload: {
          worker_id: W1,
          day,
          check_in_key: KEY,
          checked_out_at: "2026-08-07T10:00:00.000Z",
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe("day must be a YYYY-MM-DD calendar date");
      expect(touched.updated).toHaveLength(0);
    });
  });

  it("keeps `day is required` distinct from `day is not a date` — an empty day is the caller omitting a field, not misspelling one", async () => {
    const touched = { inserted: [] as Inserted[], updated: [] as Updated[], captured: [] as Captured[] };
    for (const payload of [{ worker_id: W1 }, { worker_id: W1, day: "   " }]) {
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: stub(touched) })
      ).inject({ method: "POST", url: "/api/v1/labor/attendance", payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe("day is required");
    }
    expect(touched.inserted).toHaveLength(0);
  });

  it("ACCEPTS the shape every caller in the tree already sends, including a leap day — the refusals above narrow nothing that exists", async () => {
    for (const day of ["2026-08-07", "2024-02-29", "2000-02-29", "1999-01-01", "9999-12-31"]) {
      const touched = { inserted: [] as Inserted[], updated: [] as Updated[], captured: [] as Captured[] };
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: stub(touched) })
      ).inject({
        method: "POST",
        url: "/api/v1/labor/attendance",
        // No idempotency_key: the stub answers every attendance read with its one
        // seeded row, so a key would resolve the B-307 replay branch and never insert.
        payload: { worker_id: W1, day },
      });
      expect(res.statusCode).toBe(201);
      const v = touched.inserted.find((i) => i.table === attendances)!.values as Record<string, unknown>;
      expect(v.day).toBe(day); // stored VERBATIM — no normalisation, no reinterpretation
    }
  });

  it("REFUSES 2023-02-29 and 2100-02-29 — the calendar check is a real leap rule, not a 28/29 guess (2100 is divisible by 4 and is NOT a leap year)", async () => {
    for (const day of ["2023-02-29", "2100-02-29", "2026-00-10", "2026-13-01", "2026-04-31", "0000-01-01"]) {
      const touched = { inserted: [] as Inserted[], updated: [] as Updated[], captured: [] as Captured[] };
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: stub(touched) })
      ).inject({
        method: "POST",
        url: "/api/v1/labor/attendance",
        payload: { worker_id: W1, day },
      });
      expect(res.statusCode).toBe(400);
      expect(touched.inserted).toHaveLength(0);
    }
  });

  it("BOUNDS THE SHAPE, NOT THE DAY — on the ROSTER door a 2121 day, a 1999 day and a 2199 day are still 201; WHICH day is B-337's separate gate", async () => {
    // The point of stating it as a test: this validator is not the window. These stubs
    // hold finance.create, so they take door 1 — which B-337 deliberately leaves
    // unbounded (a supervisor records last month during a payroll correction). The
    // SELF-SERVICE answers for the same three days are in the B-337 describe below.
    for (const day of ["2121-01-01", "1999-01-01", "2199-12-31"]) {
      const touched = { inserted: [] as Inserted[], updated: [] as Updated[], captured: [] as Captured[] };
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: stub(touched) })
      ).inject({
        method: "POST",
        url: "/api/v1/labor/attendance",
        payload: { worker_id: W1, day },
      });
      expect(res.statusCode).toBe(201);
    }
  });

  it("a malformed day never reaches the `attendance` table AT ALL — no read and no insert, which is where the 22007 came from", async () => {
    const touched = { inserted: [] as Inserted[], updated: [] as Updated[], captured: [] as Captured[] };
    await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stub(touched) })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance",
      payload: { worker_id: W1, day: "not-a-date" },
    });
    // Only the gate's own reads (user/role/worker for authorizeAttendanceWrite) may
    // have run. Both halves are load-bearing and both die on a revert: without the
    // parser this request INSERTS, and live that insert is the 500.
    expect(touched.captured.filter((c) => c.table === attendances)).toHaveLength(0);
    expect(touched.inserted.filter((i) => i.table === attendances)).toHaveLength(0);
  });
});

// ===========================================================================
// B-337 (Wei 2026-08-08, option ก) — WHICH day, not just what shape
// ===========================================================================
// The finding: at 0de5782 the payee named his own dates. Live, as the field-check-in
// persona himself, `2121-01-01..10` were ten 201s and POST /labor/payroll
// {period:"2121-01"} paid 5000 on a 500/day worker — payroll SUMS rows, so N dates
// were N days' pay behind one clean balanced JV.
//
// THE CLOCK IS DRIVEN, NOT OBSERVED. Every test here pins SEED_FROZEN_NOW, so the
// window's edges are exact dates rather than "roughly a week ago" — and pinning it is
// itself an assertion: the handler reads businessNowMs() and NOT `new Date()`, because
// a handler on the raw clock would ignore the freeze and these dates would drift.
//
// The window is [today - 7 … today] on the BUSINESS calendar (UTC+07:00). Its number
// comes from pototype/labor.jsx:208 — "งวดสัปดาห์ … · 7 วัน", the labor pay period —
// so one full pay week of offline queue-drain lag is covered.
// ===========================================================================
describe("B-337: the SELF-SERVICE day is bound to the business clock", () => {
  /** 09:00 in Bangkok on 2026-08-08 → business today = 2026-08-08. */
  const FROZEN = "2026-08-08T02:00:00.000Z";
  const TODAY = "2026-08-08";
  const EDGE = "2026-08-01"; // today − 7: the last day a week-late drain may still post
  const STALE = "2026-07-31"; // today − 8
  const TOMORROW = "2026-08-09";

  const freeze = (iso: string): void => {
    process.env.SEED_FROZEN_NOW = iso;
  };
  afterEach(() => {
    delete process.env.SEED_FROZEN_NOW;
  });

  const stub = (opts: { selfService: boolean; inserted: Inserted[]; row?: unknown[] }) =>
    writeStub({
      rows: [
        [users, userSource()],
        [roles, [roleRow(!opts.selfService, false)]],
        [
          workers,
          workerSource({
            self: opts.selfService ? [linkedWorker(W1, "u-0")] : [],
            byId: [linkedWorker(W1, opts.selfService ? "u-0" : null)],
          }),
        ],
        [attendances, opts.row ?? []],
      ],
      inserted: opts.inserted,
    });

  const post = async (
    payload: Record<string, unknown>,
    selfService = true,
  ): Promise<{ status: number; message: string; inserted: Inserted[] }> => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stub({ selfService, inserted }) })
    ).inject({ method: "POST", url: "/api/v1/labor/attendance", payload });
    return { status: res.statusCode, message: String(res.json().message ?? ""), inserted };
  };

  it("REFUSES the reproduction — the ten fabricated days, the far-future day and the ancient one, all 400 with nothing written", async () => {
    freeze(FROZEN);
    for (let d = 1; d <= 10; d += 1) {
      const day = `2121-01-${String(d).padStart(2, "0")}`;
      const { status, inserted } = await post({ worker_id: W1, day });
      expect(status, day).toBe(400);
      expect(inserted.filter((i) => i.table === attendances)).toHaveLength(0);
    }
    expect((await post({ worker_id: W1, day: "2199-12-31" })).status).toBe(400);
    expect((await post({ worker_id: W1, day: "1999-01-01" })).status).toBe(400);
  });

  it("ACCEPTS today, and ACCEPTS the far edge — a check-in queued a week ago with no signal must still post when the drain finally runs, or the 4xx dead-letters a real day's pay", async () => {
    freeze(FROZEN);
    for (const day of [TODAY, EDGE, "2026-08-04"]) {
      const { status, inserted } = await post({ worker_id: W1, day });
      expect(status, day).toBe(201);
      const v = inserted.find((i) => i.table === attendances)!.values as Record<string, unknown>;
      expect(v.day).toBe(day);
    }
  });

  it("REFUSES one day past the edge, and refuses TOMORROW — with DIFFERENT messages, because a stale queue and a fabrication are different things to diagnose", async () => {
    freeze(FROZEN);
    const stale = await post({ worker_id: W1, day: STALE });
    expect(stale.status).toBe(400);
    expect(stale.message).toBe("day is more than 7 days old — a supervisor must record it");
    expect(stale.inserted).toHaveLength(0);

    const future = await post({ worker_id: W1, day: TOMORROW });
    expect(future.status).toBe(400);
    expect(future.message).toBe("day cannot be in the future");
    expect(future.inserted).toHaveLength(0);
  });

  it("leaves DOOR 1 unbounded — a supervisor still records last month, and 2121 too: the window guards the door B-332 opened onto payroll, not the roster", async () => {
    freeze(FROZEN);
    for (const day of ["2121-01-01", "1999-01-01", "2026-06-15", TOMORROW]) {
      const { status } = await post({ worker_id: W1, day }, false);
      expect(status, `roster ${day}`).toBe(201);
    }
  });

  it("judges the day on the BUSINESS calendar, not UTC — at 05:00 in Bangkok the date is already the 9th, and refusing that man's check-in as `future` would be a permanent dead-letter", async () => {
    // 22:00Z on the 8th is 05:00 on the 9th in Bangkok. This is the test that dies if
    // the +07:00 offset is dropped: a UTC-naive reading calls the 9th tomorrow, and
    // Thai site work starts at 07:30 (pototype/mobile-screens.jsx — the board's first
    // entry) with the check-in button at 08:00, which is 01:00Z.
    freeze("2026-08-08T22:00:00.000Z");
    expect((await post({ worker_id: W1, day: "2026-08-09" })).status).toBe(201);
    // …and the window slid with it: the 1st is now 8 days back and refused.
    expect((await post({ worker_id: W1, day: "2026-08-01" })).status).toBe(400);
  });

  it("reads the CLOCK, not the caller's own checked_in_at — binding the bound to a client value the fabricator supplies would be no bound at all", async () => {
    freeze(FROZEN);
    const { status, message } = await post({
      worker_id: W1,
      day: "2121-01-01",
      // A perfectly plausible instant for a day that is a century away.
      checked_in_at: `${TODAY}T01:00:00.000Z`,
    });
    expect(status).toBe(400);
    expect(message).toBe("day cannot be in the future");
  });

  it("does NOT bound the CHECK-OUT door — the row it closes already passed the window when it was created, and a week-late drain closes a day it was allowed to open", async () => {
    freeze(FROZEN);
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: writeStub({
          rows: [
            [users, userSource()],
            [roles, [roleRow(false, false)]],
            [workers, workerSource({ self: [linkedWorker(W1, "u-0")], byId: [linkedWorker(W1, "u-0")] })],
            [
              attendances,
              [
                {
                  id: "at-1", companyId: COMPANY, workerId: W1, day: STALE, ot: "0.00",
                  status: "full", dayFraction: "1", ccId: null, idempotencyKey: "ck-old",
                  checkedInAt: null, checkedOutAt: null, createdAt: D, updatedAt: D,
                },
              ],
            ],
          ],
          updated,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/labor/attendance/checkout",
      payload: {
        worker_id: W1,
        day: STALE,
        check_in_key: "ck-old",
        checked_out_at: `${STALE}T10:00:00.000Z`,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(updated.filter((u) => u.table === attendances)).toHaveLength(1);
  });
});

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
}

/** Db stub with insert/transaction doors (the read-only stubDb above cannot write). */
function writeStub(opts: WriteStubOpts): Db {
  const { rows, captured = [], inserted = [], insertThrows, onInsert } = opts;
  const insertCount = new Map<unknown, number>();
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

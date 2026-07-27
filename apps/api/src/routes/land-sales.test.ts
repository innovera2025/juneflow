// G2/G3 tests (PLAN.md §9) — land/sales handlers (Program-3 Wave-0 reads +
// Wave-1 batch-1 writes, B-157/158/159). Covers:
//   - the six company-scoped list envelopes (leads, plots, loans, bookings,
//     contracts, downs) + fail-closed 401.
//   - the no-JV writes (create lead / plot / loan / contract, advance-stage, dd).
//   - the receipt-JV writes (booking + down): a BALANCED Dr 1020 / Cr 2040 =
//     received-amount JV keyed source_doc booking:<id> / down:<id>:<seq>,
//     idempotent (prior-jv + 23505) and fail-closed on a missing COA account.
//   - the computed-JV write (land buy deal): deposit = area/1600 × price × 10%,
//     Dr 1150 / Cr 2010, source deal:<id>; lease → 422 (never a guessed amount).
// Every expected value comes from the stub, EXCEPT the money=SERVER contracts
// under test (the JV direction/balance, the deal deposit formula, and that a
// loan's ask/approved are stored as supplied). Routes are wired in app.ts
// (registerLandSalesRoute) → buildApp mounts them (no sibling re-registration).
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  downPaymentTxns,
  glAccounts,
  jvLines,
  jvs,
  landPlots,
  leads,
  loanApplications,
  projectNodes,
  roles,
  salesUnits,
  users,
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
const D0 = new Date(1_700_000_000_000);
const D1 = new Date(1_700_100_000_000);

// The four COA accounts the Program-3 sales/land postings resolve against.
const ACC_BANK = "acc00000-0000-0000-0000-000000001020"; // 1020 bank
const ACC_ADV = "acc00000-0000-0000-0000-000000002040"; // 2040 advance-received
const ACC_LAND = "acc00000-0000-0000-0000-000000001150"; // 1150 land-held-for-dev
const ACC_AP = "acc00000-0000-0000-0000-000000002010"; // 2010 AP

/** A canned rows source: a fixed list, or a where-aware fn (jvs is read 3× per post). */
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

/** Db stub: canned rows per table (reads, incl. insertThrough ownership selects) +
 *  write capture. Mirrors retention.test.ts. */
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
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
        returning: () => {
          inserted.push({ table, values });
          const arr = Array.isArray(values) ? values : [values];
          return Promise.resolve(
            arr.map((v) => {
              const row = v as Record<string, unknown>;
              return { id: row.id ?? `new-${seq++}`, createdAt: D0, ...row };
            }),
          );
        },
      }),
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
  // B-097: the transaction door runs its callback against this SAME stub handle.
  raw.transaction = (cb: (tx: unknown) => unknown) => cb(raw);
  return raw as unknown as Db;
}

function paramsOf(where: SQL | undefined): unknown[] {
  if (!where) return [];
  return new PgDialect().sqlToQuery(where).params;
}

// jvs is read 3× per posting handler: the idempotency probe (source_doc
// booking:/down:/deal:) → none; allocJvNo + insertThrough ownership → the seed.
const jvSeed = {
  id: "jv-seed",
  companyId: COMPANY,
  no: "OPEN-1",
  sourceDoc: "seed",
  periodId: null,
  memo: "seed",
  createdAt: D0,
  updatedAt: D0,
};
const jvSource = (where: SQL | undefined): unknown[] => {
  const isIdempotencyProbe = paramsOf(where).some(
    (p) => typeof p === "string" && /^(booking|down|deal):/.test(p),
  );
  return isIdempotencyProbe ? [] : [jvSeed];
};

const glAcc = (id: string, code: string, name: string) => ({
  id,
  companyId: COMPANY,
  parentId: null,
  code,
  name,
  accountType: null,
  createdAt: D0,
  updatedAt: D0,
});
/** All four posting accounts present (the happy path resolves every code). */
const COA_ROWS = [
  glAcc(ACC_BANK, "1020", "เงินฝากธนาคาร"),
  glAcc(ACC_ADV, "2040", "เงินมัดจำ/เงินจองรับล่วงหน้า"),
  glAcc(ACC_LAND, "1150", "ที่ดินรอการพัฒนา"),
  glAcc(ACC_AP, "2010", "เจ้าหนี้การค้า"),
];

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
const lead = (id: string, name: string, createdAt: Date): typeof leads.$inferSelect =>
  ({
    id, companyId: COMPANY, name, phone: "081-000-0000", source: "walk-in", interest: "บ้านเดี่ยว",
    stage: "visit", hot: true, warmth: "hot", lastContactAt: "2026-05-01", note: null,
    ownerUserId: null, days: 3, createdAt, updatedAt: createdAt,
  }) as typeof leads.$inferSelect;

const plot = (
  id: string,
  deedNo: string,
  createdAt: Date,
  extra: Partial<typeof landPlots.$inferSelect> = {},
): typeof landPlots.$inferSelect =>
  ({
    id, companyId: COMPANY, projectId: null, deedNo, areaSqm: "1600.0000", gps: "13.7,100.5",
    pricePerRai: "2500000.00", currencyCode: "THB", stage: "negotiating", tenure: "freehold",
    title: null, tambon: null, amphoe: null, prov: null, owner: null,
    ddChecklist: {}, createdAt, updatedAt: createdAt, ...extra,
  }) as typeof landPlots.$inferSelect;

const unit = (
  id: string,
  extra: Partial<typeof salesUnits.$inferSelect> = {},
): typeof salesUnits.$inferSelect =>
  ({
    id, companyId: COMPANY, unitId: null, customerId: null, stage: "reserved",
    booking: null, contract: null, loan: null, currencyCode: "THB", down: [],
    transferAt: null, createdAt: D0, updatedAt: D0, ...extra,
  }) as typeof salesUnits.$inferSelect;

const loan = (
  id: string,
  extra: Partial<typeof loanApplications.$inferSelect> = {},
): typeof loanApplications.$inferSelect =>
  ({
    id, companyId: COMPANY, salesUnitId: "su-1", bank: "SCB", askAmt: "3000000.00",
    approvedAmt: "2800000.00", currencyCode: "THB", term: 30, submitDate: "2026-05-01",
    resultDate: "2026-05-20", status: "approved", createdAt: D0, updatedAt: D0, ...extra,
  }) as typeof loanApplications.$inferSelect;

// B-082 F1 caller-perm rows (mirror fa.test.ts): the three JV-posting handlers gate
// on finance.create. loadCaller resolves the caller via authUser.email → dictionary
// user (u-0) → role, so every money-handler test must stub `users` + `roles`.
const userRow = {
  id: "u-0",
  companyId: COMPANY,
  email: SESSION.user.email,
  name: SESSION.user.name,
  roleId: "role-0",
  status: "active",
};
/** A role carrying (or not) the finance.create perm the JV-posting gate reads. */
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
  createdAt: D0,
  updatedAt: D0,
});

// ===========================================================================
// Reads
// ===========================================================================
describe("GET /api/v1/sales/leads", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/sales/leads" });
    expect(res.statusCode).toBe(401);
  });

  it("lists the tenant's leads newest-first as a list envelope (company-scoped)", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[leads, [lead("l0", "เก่า", D0), lead("l1", "ใหม่", D1)]]], captured }),
      })
    ).inject({ method: "GET", url: "/api/v1/sales/leads" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data.map((l: { name: string }) => l.name)).toEqual(["ใหม่", "เก่า"]); // newest-first
    expect(body.data[0]).toMatchObject({ id: "l1", name: "ใหม่", stage: "visit", hot: true, source: "walk-in" });
    expect(captured.some((c) => c.table === leads)).toBe(true);
  });
});

describe("GET /api/v1/land/plots", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/land/plots" });
    expect(res.statusCode).toBe(401);
  });

  it("lists land plots with price_per_rai (money) + currency_code as a list envelope", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[landPlots, [plot("p0", "นส.3ก-101", D0)]]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/land/plots" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data[0]).toMatchObject({
      id: "p0", deed_no: "นส.3ก-101", price_per_rai: 2500000, currency_code: "THB", area_sqm: 1600,
    });
  });

  it("honest-empty when there are no plots", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[landPlots, []]] }) })
    ).inject({ method: "GET", url: "/api/v1/land/plots" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
    expect(res.json().data).toEqual([]);
  });
});

describe("GET /api/v1/sales/loans", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/sales/loans" });
    expect(res.statusCode).toBe(401);
  });

  it("lists loan applications with ask/approved money + currency_code", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[loanApplications, [loan("loan-0")]]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/sales/loans" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0]).toMatchObject({
      id: "loan-0", bank: "SCB", ask_amt: 3_000_000, approved_amt: 2_800_000, term: 30, status: "approved",
    });
  });
});

describe("GET /api/v1/sales/bookings & /contracts", () => {
  it("bookings lists only units carrying a booking", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[salesUnits, [unit("su-1", { booking: "100000.00" }), unit("su-2")]]],
        }),
      })
    ).inject({ method: "GET", url: "/api/v1/sales/bookings" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
    expect(res.json().data[0]).toMatchObject({ id: "su-1", booking: 100000 });
  });

  it("contracts lists only units carrying a contract", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[salesUnits, [unit("su-1", { contract: "5000000.00" }), unit("su-2")]]],
        }),
      })
    ).inject({ method: "GET", url: "/api/v1/sales/contracts" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1);
    expect(res.json().data[0]).toMatchObject({ id: "su-1", contract: 5000000 });
  });
});

describe("GET /api/v1/sales/downs", () => {
  it("lists every instalment from the authoritative down_payment_txn (B-167 · unit_id resolved · no jsonb)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            // authoritative source — down_payment_txn, NOT the sales_unit.down jsonb.
            [downPaymentTxns, [
              { id: "d1", companyId: COMPANY, salesUnitId: "su-1", seq: 1, amount: "50000.00", currencyCode: "THB", paidAt: "2026-05-01", createdAt: D1 },
              { id: "d2", companyId: COMPANY, salesUnitId: "su-1", seq: 2, amount: "50000.00", currencyCode: "THB", paidAt: "2026-06-01", createdAt: D0 },
            ]],
            [salesUnits, [unit("su-1", { unitId: "node-1" })]], // for unit_id resolution
          ],
        }),
      })
    ).inject({ method: "GET", url: "/api/v1/sales/downs" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(2);
    expect(res.json().data[0]).toMatchObject({ sales_unit_id: "su-1", unit_id: "node-1", seq: 1, amount: 50000 });
  });
});

// ===========================================================================
// Wave A — no-JV writes
// ===========================================================================
describe("POST /api/v1/sales/leads", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST", url: "/api/v1/sales/leads", payload: { name: "คุณเอ" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("400s when name is missing", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [] }) })
    ).inject({ method: "POST", url: "/api/v1/sales/leads", payload: { phone: "081" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/name is required/);
  });

  it("creates a lead (201), storing warmth + a validated stage; company_id force-set", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/sales/leads",
      payload: { name: "คุณสมชาย", phone: "089-111-2222", warmth: "warm", stage: "quote", hot: false, days: 5 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: "คุณสมชาย", warmth: "warm", stage: "quote", days: 5 });
    const ins = inserted.find((i) => i.table === leads)!;
    const v = ins.values as Record<string, unknown>;
    expect(v.stage).toBe("quote"); // valid enum → honored
    expect(v.companyId).toBe(COMPANY); // tenant force-set by the scoped insert
  });

  it("ignores an invalid stage (falls back to the DB default)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [], inserted }) })
    ).inject({ method: "POST", url: "/api/v1/sales/leads", payload: { name: "x", stage: "bogus" } });
    expect(res.statusCode).toBe(201);
    const v = inserted.find((i) => i.table === leads)!.values as Record<string, unknown>;
    expect(v.stage).toBeUndefined(); // not set → DB default 'lead' applies
  });
});

describe("POST /api/v1/land/plots", () => {
  it("creates a land plot (201), storing area_sqm + price_per_rai as numeric strings", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [], inserted }) })
    ).inject({
      method: "POST",
      url: "/api/v1/land/plots",
      payload: { deed_no: "โฉนด 555", area_sqm: 3200, price_per_rai: 4200000, tenure: "buy", stage: "source" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ deed_no: "โฉนด 555", area_sqm: 3200, price_per_rai: 4200000, tenure: "buy" });
    const v = inserted.find((i) => i.table === landPlots)!.values as Record<string, unknown>;
    expect(v.areaSqm).toBe("3200");
    expect(v.pricePerRai).toBe("4200000.00");
    expect(v.companyId).toBe(COMPANY);
  });
});

describe("POST /api/v1/land/plots/:id/advance-stage", () => {
  it("advances one LAND_STAGES step when no explicit target is given", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[landPlots, [plot("p1", "d", D0, { stage: "dd" })]]], updated }),
      })
    ).inject({ method: "POST", url: "/api/v1/land/plots/p1/advance-stage", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().stage).toBe("nego"); // dd → nego
    expect(updated.find((u) => u.table === landPlots)!.set.stage).toBe("nego");
  });

  it("honors an explicit target stage from the body", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[landPlots, [plot("p1", "d", D0, { stage: "dd" })]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/land/plots/p1/advance-stage", payload: { stage: "close" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().stage).toBe("close");
  });

  it("409s a plot already at the terminal stage (close)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[landPlots, [plot("p1", "d", D0, { stage: "close" })]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/land/plots/p1/advance-stage", payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/final stage/);
  });

  it("404s a plot not in this tenant", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[landPlots, []]] }) })
    ).inject({ method: "POST", url: "/api/v1/land/plots/nope/advance-stage", payload: {} });
    expect(res.statusCode).toBe(404);
  });
});

describe("PUT /api/v1/land/plots/:id/dd", () => {
  it("shallow-merges the body dd patch over the stored checklist", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[landPlots, [plot("p1", "d", D0, { ddChecklist: { title: "ok", zoning: "pending" } })]]],
          updated,
        }),
      })
    ).inject({
      method: "PUT",
      url: "/api/v1/land/plots/p1/dd",
      payload: { dd: { zoning: "done", survey: "ok" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().dd_checklist).toEqual({ title: "ok", zoning: "done", survey: "ok" });
    expect(updated.find((u) => u.table === landPlots)!.set.ddChecklist).toEqual({
      title: "ok", zoning: "done", survey: "ok",
    });
  });

  it("404s a missing plot", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[landPlots, []]] }) })
    ).inject({ method: "PUT", url: "/api/v1/land/plots/nope/dd", payload: { dd: {} } });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /api/v1/sales/loans", () => {
  it("records a loan application storing ask/approved AS SUPPLIED (SA-6: not a GL doc)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [], inserted }) })
    ).inject({
      method: "POST",
      url: "/api/v1/sales/loans",
      payload: { bank: "KBank", ask_amt: 4500000, approved_amt: 4200000, term: 25, status: "partial" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ bank: "KBank", ask_amt: 4500000, approved_amt: 4200000, term: 25, status: "partial" });
    const v = inserted.find((i) => i.table === loanApplications)!.values as Record<string, unknown>;
    // Stored exactly as supplied — no server recompute, no JV.
    expect(v.askAmt).toBe("4500000.00");
    expect(v.approvedAmt).toBe("4200000.00");
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined();
  });
});

describe("POST /api/v1/sales/contracts", () => {
  it("sets the contract amount + stage=contract on the unit (NO JV)", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[salesUnits, [unit("su-1", { unitId: "node-1" })]]], inserted, updated }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/sales/contracts",
      payload: { unit_id: "su-1", contract: 5500000 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: "su-1", contract: 5500000, stage: "contract" });
    const upd = updated.find((u) => u.table === salesUnits)!;
    expect(upd.set.contract).toBe("5500000.00");
    expect(upd.set.stage).toBe("contract");
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined(); // B-161(c): metadata only
  });

  it("400s when the signing amount is missing", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[salesUnits, [unit("su-1")]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/sales/contracts", payload: { unit_id: "su-1" } });
    expect(res.statusCode).toBe(400);
  });

  it("404s when the unit is not in this tenant", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[salesUnits, []]] }) })
    ).inject({ method: "POST", url: "/api/v1/sales/contracts", payload: { unit_id: "nope", contract: 1 } });
    expect(res.statusCode).toBe(404);
  });
});

// ===========================================================================
// Wave B — receipt JV (Dr 1020 bank / Cr 2040 advance-received = received amount)
// ===========================================================================
describe("POST /api/v1/sales/bookings", () => {
  const bookDb = (
    o: { units?: unknown[]; jv?: RowSource; coa?: unknown[]; node?: unknown[]; inserted?: Inserted[]; financeCreate?: boolean } = {},
  ) =>
    stubDb({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(o.financeCreate ?? true)]],
        [salesUnits, o.units ?? []],
        [jvs, o.jv ?? jvSource],
        [glAccounts, o.coa ?? COA_ROWS],
        // B-169: a NEW booking scopes the project_node THROUGH its project (in-tenant
        // check). Default = the unit resolves; pass node:[] to model a foreign node.
        [projectNodes, o.node ?? [{ id: "node-1", projectId: "proj-1" }]],
      ],
      inserted: o.inserted,
    });

  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST", url: "/api/v1/sales/bookings", payload: { unit_id: "node-1", amount: 100000 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s a caller lacking the finance-create perm (B-082 F1 money-lock, fail closed)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: bookDb({ inserted, units: [], financeCreate: false }),
      })
    ).inject({ method: "POST", url: "/api/v1/sales/bookings", payload: { unit_id: "node-1", amount: 100000 } });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance create permission/);
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined(); // no money posted on a denied booking
  });

  it("400s a non-positive received amount", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: bookDb() })
    ).inject({ method: "POST", url: "/api/v1/sales/bookings", payload: { unit_id: "node-1", amount: 0 } });
    expect(res.statusCode).toBe(400);
  });

  it("books a new unit + posts a BALANCED Dr 1020 / Cr 2040 = received JV keyed booking:<id>", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: bookDb({ inserted, units: [] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/sales/bookings",
      payload: { unit_id: "node-1", amount: 100000, customer_id: "cust-1" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.stage).toBe("booked");
    expect(body.booking).toBe(100000);
    expect(body.jv_no).toMatch(/^JV-\d{4}-\d{4}$/);

    // Balanced receipt: Dr 1020 = 100,000 / Cr 2040 = 100,000.
    const lines = inserted.find((i) => i.table === jvLines)!.values as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    const dr = lines.find((l) => l.accountId === ACC_BANK)!;
    const cr = lines.find((l) => l.accountId === ACC_ADV)!;
    expect(dr.dr).toBe("100000.00");
    expect(dr.cr).toBe("0.00");
    expect(cr.dr).toBe("0.00");
    expect(cr.cr).toBe("100000.00");
    expect(lines.reduce((s, l) => s + Number(l.dr), 0)).toBe(lines.reduce((s, l) => s + Number(l.cr), 0));

    // source_doc keyed to the STABLE project_node unit id (booking:<unitId>), NOT the
    // fresh per-row salesUnitId — this is what makes two concurrent first-bookings of
    // the same unit collide on the jv_source_doc_uq index (the race fix).
    const jvIns = inserted.find((i) => i.table === jvs)!.values as Record<string, unknown>;
    expect(String(jvIns.sourceDoc)).toBe("booking:node-1");

    // The unit was created stage=booked with the booking amount.
    const unitIns = inserted.find((i) => i.table === salesUnits)!.values as Record<string, unknown>;
    expect(unitIns.stage).toBe("booked");
    expect(unitIns.booking).toBe("100000.00");
    expect(unitIns.unitId).toBe("node-1");
  });

  it("409s a unit that is already booked (booking already set)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: bookDb({ inserted, units: [unit("su-1", { unitId: "node-1", booking: "50000.00" })] }),
      })
    ).inject({ method: "POST", url: "/api/v1/sales/bookings", payload: { unit_id: "node-1", amount: 100000 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already booked/);
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined(); // no double post
  });

  it("404s a new booking on a project_node NOT in this tenant (B-169 · fail-closed · no money posted)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        // no existing sales_unit AND the project_node resolves to nothing through the
        // tenant chain (a foreign node id) → 404 before any write.
        db: bookDb({ inserted, units: [], node: [] }),
      })
    ).inject({ method: "POST", url: "/api/v1/sales/bookings", payload: { unit_id: "foreign-node", amount: 100000 } });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toMatch(/not found in this tenant/);
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined(); // fail-closed, no post
    expect(inserted.find((i) => i.table === salesUnits)).toBeUndefined(); // no unit created
  });

  it("409s (idempotent) when a booking JV already carries the source_doc", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: bookDb({
          inserted,
          units: [unit("su-1", { unitId: "node-1" })], // exists but no booking yet
          jv: [{ id: "jv-prior", companyId: COMPANY, sourceDoc: "booking:node-1" }],
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/sales/bookings", payload: { unit_id: "node-1", amount: 100000 } });
    expect(res.statusCode).toBe(409);
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined();
  });

  // Honest scope: with a stubbed Db this can only prove the 23505→409 ERROR-MAPPING,
  // not the concurrency GUARANTEE. The real first-booking race (two concurrent first
  // bookings of the same unit → exactly one 201 + one 409, one sales_unit, one JV) is
  // proven live on a real pg — see the throwaway race proof in the P3-BE-02 journal
  // entry (the booking:<unitId> key + one-tx rollback close it).
  it("maps a 23505 from the source_doc index to 409 (concurrent-duplicate error-mapping)", async () => {
    const base = bookDb({ units: [] });
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
    ).inject({ method: "POST", url: "/api/v1/sales/bookings", payload: { unit_id: "node-1", amount: 100000 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already booked/);
  });

  it("409s honestly when the tenant COA lacks a required posting account (never invents)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: bookDb({ units: [], coa: [glAcc(ACC_BANK, "1020", "bank")] }), // 2040 MISSING
      })
    ).inject({ method: "POST", url: "/api/v1/sales/bookings", payload: { unit_id: "node-1", amount: 100000 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/missing a required posting account/);
  });
});

describe("POST /api/v1/sales/downs", () => {
  const downDb = (
    o: { units?: unknown[]; jv?: RowSource; dpt?: unknown[]; inserted?: Inserted[]; updated?: Updated[]; financeCreate?: boolean } = {},
  ) =>
    stubDb({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(o.financeCreate ?? true)]],
        [salesUnits, o.units ?? [unit("su-1", { unitId: "node-1", down: [] })]],
        [jvs, o.jv ?? jvSource],
        // B-165: the in-tx count of this unit's down_payment_txn rows drives seq.
        [downPaymentTxns, o.dpt ?? []],
        [glAccounts, COA_ROWS],
      ],
      inserted: o.inserted,
      updated: o.updated,
    });

  it("403s a caller lacking the finance-create perm (B-082 F1 money-lock, fail closed)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: downDb({ inserted, financeCreate: false }),
      })
    ).inject({ method: "POST", url: "/api/v1/sales/downs", payload: { sales_unit_id: "su-1", amount: 50000 } });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance create permission/);
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined(); // no money posted on a denied down
  });

  it("records a down instalment keyed on the client instalment_no (B-167) + posts a BALANCED Dr 1020 / Cr 2040 JV keyed down:<id>:<instalment_no>", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: downDb({ inserted, units: [unit("su-1", { unitId: "node-1" })] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/sales/downs",
      // B-167: the client SELECTS the instalment number ("งวดที่ 8 จาก 10") → the stable
      // seq. No count+1 — instalment_no IS the key.
      payload: { sales_unit_id: "su-1", amount: 50000, paid_at: "2026-07-01", instalment_no: 8 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ sales_unit_id: "su-1", unit_id: "node-1", seq: 8, amount: 50000, paid_at: "2026-07-01" });
    expect(body.jv_no).toMatch(/^JV-\d{4}-\d{4}$/);
    // the authoritative down_payment_txn row is inserted at the client seq 8.
    const dptIns = inserted.find((i) => i.table === downPaymentTxns)!.values as Record<string, unknown>;
    expect(dptIns.seq).toBe(8);
    // Balanced Dr 1020 / Cr 2040 = 50,000.
    const lines = inserted.find((i) => i.table === jvLines)!.values as Record<string, unknown>[];
    const dr = lines.find((l) => l.accountId === ACC_BANK)!;
    const cr = lines.find((l) => l.accountId === ACC_ADV)!;
    expect(dr.dr).toBe("50000.00");
    expect(cr.cr).toBe("50000.00");
    // source_doc keyed on the client instalment_no (the stable dedup key).
    const jvIns = inserted.find((i) => i.table === jvs)!.values as Record<string, unknown>;
    expect(jvIns.sourceDoc).toBe("down:su-1:8");
    // B-167: no jsonb mirror write (down_payment_txn is authoritative).
    expect(inserted.find((i) => i.table === salesUnits)).toBeUndefined();
  });

  it("400s a non-positive received amount", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: downDb() })
    ).inject({ method: "POST", url: "/api/v1/sales/downs", payload: { sales_unit_id: "su-1", amount: -1, instalment_no: 1 } });
    expect(res.statusCode).toBe(400);
  });

  it("400s a missing or non-positive-integer instalment_no (B-167 natural key required)", async () => {
    const app0 = await buildTestApp({ resolveTenant: async () => SESSION, db: downDb() });
    const noNo = await app0.inject({ method: "POST", url: "/api/v1/sales/downs", payload: { sales_unit_id: "su-1", amount: 50000 } });
    expect(noNo.statusCode).toBe(400);
    expect(noNo.json().message).toMatch(/instalment_no/);
    const badNo = await app0.inject({ method: "POST", url: "/api/v1/sales/downs", payload: { sales_unit_id: "su-1", amount: 50000, instalment_no: 1.5 } });
    expect(badNo.statusCode).toBe(400);
  });

  it("404s when the sales unit is not in this tenant", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: downDb({ units: [] }) })
    ).inject({ method: "POST", url: "/api/v1/sales/downs", payload: { sales_unit_id: "nope", amount: 50000, instalment_no: 1 } });
    expect(res.statusCode).toBe(404);
  });

  // B-165: idempotency/dedup is now enforced by the down_payment_txn_unit_seq_uq
  // unique index (+ the jv source_doc index) INSIDE the tx — a concurrent/duplicate
  // first-down trips 23505 → 409. The stub can only prove the error-MAPPING (it echoes
  // rows regardless of the unique); the real concurrency guarantee is the committed
  // live E2E (tests/e2e/b163-booking-race.spec.ts DOWN variant → 1×201 + rest 409).
  it("maps a 23505 from the unique index to 409 (concurrent/duplicate down)", async () => {
    const base = downDb({ units: [unit("su-1", { unitId: "node-1", down: [] })] });
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
    ).inject({ method: "POST", url: "/api/v1/sales/downs", payload: { sales_unit_id: "su-1", amount: 50000, instalment_no: 1 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already recorded/);
  });
});

// ===========================================================================
// Wave C — computed JV (land buy deal)
// ===========================================================================
describe("POST /api/v1/land/plots/:id/deal", () => {
  const dealDb = (
    o: { plots?: unknown[]; jv?: RowSource; coa?: unknown[]; inserted?: Inserted[]; financeCreate?: boolean } = {},
  ) =>
    stubDb({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(o.financeCreate ?? true)]],
        [landPlots, o.plots ?? [plot("p1", "d", D0, { areaSqm: "1600.0000", pricePerRai: "2500000.00" })]],
        [jvs, o.jv ?? jvSource],
        [glAccounts, o.coa ?? COA_ROWS],
      ],
      inserted: o.inserted,
    });

  it("403s a caller lacking the finance-create perm (B-082 F1 money-lock, fail closed)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: dealDb({ inserted, financeCreate: false }),
      })
    ).inject({ method: "POST", url: "/api/v1/land/plots/p1/deal", payload: { type: "buy" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance create permission/);
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined(); // no money posted on a denied deal
  });

  it("computes the buy deposit (area/1600 × price × 10%) + posts Dr 1150 / Cr 2010, source deal:<id>", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: dealDb({ inserted }) })
    ).inject({ method: "POST", url: "/api/v1/land/plots/p1/deal", payload: { type: "buy" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 1600/1600 × 2,500,000 × 10% = 250,000 (server-computed — client terms ignored).
    expect(body.deposit).toBe(250000);
    expect(body.type).toBe("buy");
    expect(body.jv_no).toMatch(/^JV-\d{4}-\d{4}$/);

    const lines = inserted.find((i) => i.table === jvLines)!.values as Record<string, unknown>[];
    const dr = lines.find((l) => l.accountId === ACC_LAND)!;
    const cr = lines.find((l) => l.accountId === ACC_AP)!;
    expect(dr.dr).toBe("250000.00");
    expect(cr.cr).toBe("250000.00");
    expect(lines.reduce((s, l) => s + Number(l.dr), 0)).toBe(lines.reduce((s, l) => s + Number(l.cr), 0));
    const jvIns = inserted.find((i) => i.table === jvs)!.values as Record<string, unknown>;
    expect(jvIns.sourceDoc).toBe("deal:p1");
  });

  it("422s a lease deal (PV formula undefined — never a guessed amount)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: dealDb({ inserted }) })
    ).inject({ method: "POST", url: "/api/v1/land/plots/p1/deal", payload: { type: "lease" } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("NOT_IMPLEMENTED");
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined();
  });

  it("400s an unknown deal type", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: dealDb() })
    ).inject({ method: "POST", url: "/api/v1/land/plots/p1/deal", payload: { type: "rent-to-own" } });
    expect(res.statusCode).toBe(400);
  });

  it("409s honestly when the plot is missing area_sqm or price_per_rai", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: dealDb({ plots: [plot("p1", "d", D0, { areaSqm: null })] }),
      })
    ).inject({ method: "POST", url: "/api/v1/land/plots/p1/deal", payload: { type: "buy" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/missing area_sqm or price_per_rai/);
  });

  it("404s a plot not in this tenant", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: dealDb({ plots: [] }) })
    ).inject({ method: "POST", url: "/api/v1/land/plots/nope/deal", payload: { type: "buy" } });
    expect(res.statusCode).toBe(404);
  });

  it("409s (idempotent) when the deal JV already exists", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: dealDb({ inserted, jv: [{ id: "jv-prior", companyId: COMPANY, sourceDoc: "deal:p1" }] }),
      })
    ).inject({ method: "POST", url: "/api/v1/land/plots/p1/deal", payload: { type: "buy" } });
    expect(res.statusCode).toBe(409);
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined();
  });

  it("409s honestly when the tenant COA lacks a required posting account", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: dealDb({ coa: [glAcc(ACC_LAND, "1150", "land")] }), // 2010 AP MISSING
      })
    ).inject({ method: "POST", url: "/api/v1/land/plots/p1/deal", payload: { type: "buy" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/missing a required posting account/);
  });
});

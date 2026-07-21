// G3 unit tests (PLAN.md §9) — GL handlers (P2-BE-17, Wave-2 finance first
// slice). Covers GET /gl/coa (chart of accounts, code-ordered, tenant-scoped),
// GET /gl/jv (Σ dr amount + line_count + honest null status), POST /gl/jv (the
// double-entry balance invariant, tenant ownership of referenced ids, and the
// jv + jv_line scoped writes), and GET /gl/posting-inbox (the HONEST posted
// state — every source doc reads PENDING while no jv.source_doc carries a
// "table:uuid" ref; a real ref flips exactly that doc to posted). Every row
// comes from the stub — no value is hand-computed against the impl.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  accountingPeriods,
  glAccounts,
  grs,
  jvLines,
  jvs,
  payrolls,
  pvs,
  roles,
  rvs,
  users,
} from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย" },
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
  where: SQL;
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
  // B-097: the transaction door runs its callback against this SAME stub, so
  // writes inside a tx still capture into inserted/updated/captured (the fake
  // has no real BEGIN/COMMIT — it proves the door threads one scoped handle).
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
const ACC_CASH = "acc00000-0000-0000-0000-000000001020";
const ACC_AR = "acc00000-0000-0000-0000-000000001030";
const ACC_COST = "acc00000-0000-0000-0000-000000005020";

const glAcc = (id: string, code: string, name: string, parentId: string | null) => ({
  id,
  companyId: COMPANY,
  parentId,
  code,
  name,
  createdAt: D,
  updatedAt: D,
});

// An accounting_period row (B-094-1 locked-period guard). `period` defaults to
// the BE-labelled seed shape ('2569-05') used by the B-094-1 JV tests; the
// close-period tests pass an explicit CE period ('2026-05').
const PERIOD = "per00000-0000-0000-0000-0000000000p1";
const periodRow = (id: string, locked: boolean, period = "2569-05") => ({
  id,
  companyId: COMPANY,
  period,
  locked,
  createdAt: D,
  updatedAt: D,
});

// loadCaller resolves the caller via email → dictionary user (u-0) → role; the
// SESSION email must match userRow.email so the finance-authz gate can read the
// caller's perms (close-period requires finance.approve).
const userRow = {
  id: "u-0",
  companyId: COMPANY,
  email: SESSION.user.email,
  name: SESSION.user.name,
  roleId: "role-0",
  status: "active",
};
/** A role carrying the finance perms the close-period gate reads. */
const roleRow = (financeApprove = true) => ({
  id: "role-0",
  companyId: COMPANY,
  name: "Finance Manager",
  approvalLimits: {},
  perms: {
    finance: {
      view: true,
      create: true,
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

describe("GET /api/v1/gl/coa", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/gl/coa" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("returns the B-014 envelope of accounts, code-ordered, real columns only", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [
              glAccounts,
              [
                glAcc(ACC_COST, "5020", "ต้นทุนวัสดุก่อสร้าง", null),
                glAcc(ACC_CASH, "1020", "เงินฝากธนาคาร", null),
                glAcc(ACC_AR, "1030", "ลูกหนี้การค้า", ACC_CASH),
              ],
            ],
          ],
        }),
      })
    ).inject({ url: "/api/v1/gl/coa" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    expect(body.page).toBe(1);
    // code-ordered ascending
    expect(body.data.map((r: { code: string }) => r.code)).toEqual(["1020", "1030", "5020"]);
    const ar = body.data[1];
    expect(ar.id).toBe(ACC_AR);
    expect(ar.name).toBe("ลูกหนี้การค้า");
    expect(ar.parent_id).toBe(ACC_CASH);
    expect(Object.keys(ar).sort()).toEqual(["code", "created_at", "id", "name", "parent_id"]);
  });

  it("binds company_id on the gl_account read (tenant scope)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[glAccounts, [glAcc(ACC_CASH, "1020", "x", null)]]], captured }),
      })
    ).inject({ url: "/api/v1/gl/coa" });
    const read = captured.find((c) => c.table === glAccounts);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
  });
});

// jv + jv_line canned rows (two balanced books, one 2-line + one 3-line)
const JV_A = "jv000000-0000-0000-0000-00000000041a";
const JV_B = "jv000000-0000-0000-0000-00000000041b";
const jvRow = (id: string, no: string, source: string, memo: string, t: number) => ({
  id,
  companyId: COMPANY,
  no,
  sourceDoc: source,
  periodId: null,
  memo,
  createdAt: new Date(D.getTime() + t * 1000),
  updatedAt: D,
});
const jvLine = (jvId: string, acc: string, dr: number, cr: number) => ({
  id: `${jvId}-${acc}-${dr}-${cr}`,
  jvId,
  accountId: acc,
  dr: dr.toFixed(2),
  cr: cr.toFixed(2),
  currencyCode: "THB",
  ccId: null,
  projectId: null,
  createdAt: D,
  updatedAt: D,
});

describe("GET /api/v1/gl/jv", () => {
  it("lists JVs with Σ dr amount, line_count, honest null status, newest-first", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [
              jvs,
              [
                jvRow(JV_A, "JV-2026-0417", "Manual", "WHT 3%", 1),
                jvRow(JV_B, "JV-2026-0418", "REM", "รับชำระ B-08", 2),
              ],
            ],
            [
              jvLines,
              [
                jvLine(JV_A, ACC_COST, 8040, 0),
                jvLine(JV_A, ACC_AR, 0, 8040),
                jvLine(JV_B, ACC_CASH, 2_148_000, 0),
                jvLine(JV_B, ACC_AR, 0, 2_148_000),
              ],
            ],
          ],
        }),
      })
    ).inject({ url: "/api/v1/gl/jv" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    // newest-first: JV_B (t=2) before JV_A (t=1)
    expect(body.data.map((r: { no: string }) => r.no)).toEqual([
      "JV-2026-0418",
      "JV-2026-0417",
    ]);
    const b = body.data[0];
    expect(b.amount).toBe(2_148_000); // Σ dr of JV_B
    expect(b.line_count).toBe(2);
    expect(b.currency_code).toBe("THB");
    expect(b.source_doc).toBe("REM");
    expect(b.status).toBeNull(); // GAP: jv has no status column
  });

  it("binds company_id on the jv read (tenant scope)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[jvs, [jvRow(JV_A, "JV-1", "Manual", "x", 1)]]], captured }),
      })
    ).inject({ url: "/api/v1/gl/jv" });
    const read = captured.find((c) => c.table === jvs);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
  });
});

describe("POST /api/v1/gl/jv", () => {
  const balancedBody = {
    no: "JV-2026-0419",
    memo: "Accrued ค่าจ้าง พ.ค.",
    source_doc: "Manual",
    lines: [
      { account_id: ACC_COST, dr: 184500, cr: 0 },
      { account_id: ACC_AR, dr: 0, cr: 184500 },
    ],
  };
  // gl_account rows the ownership check resolves; jvs row so insertThrough's
  // parent-ownership select passes.
  const writeDb = (inserted: Inserted[] = [], captured: Captured[] = []) =>
    stubDb({
      rows: [
        [glAccounts, [glAcc(ACC_COST, "5020", "x", null), glAcc(ACC_AR, "1030", "y", null)]],
        [jvs, [{ id: "any", companyId: COMPANY }]],
      ],
      inserted,
      captured,
    });

  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/gl/jv",
      payload: balancedBody,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });

  it("creates a balanced JV (201) — writes jv + jv_line, echoes amount/line_count", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: writeDb(inserted) })
    ).inject({ method: "POST", url: "/api/v1/gl/jv", payload: balancedBody });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.no).toBe("JV-2026-0419");
    expect(body.amount).toBe(184500);
    expect(body.line_count).toBe(2);
    expect(body.status).toBeNull();

    // jv inserted with company_id force-set; jv_line inserted with 2 legs.
    const jvIns = inserted.find((i) => i.table === jvs);
    expect(jvIns).toBeTruthy();
    expect(jvIns!.values[0]!.companyId).toBe(COMPANY);
    const lineIns = inserted.find((i) => i.table === jvLines);
    expect(lineIns).toBeTruthy();
    expect(lineIns!.values).toHaveLength(2);
    expect(lineIns!.values.map((l) => l.dr)).toEqual(["184500.00", "0.00"]);
  });

  it("rejects an unbalanced JV (400 · Σ dr ≠ Σ cr)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: writeDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/gl/jv",
      payload: {
        no: "JV-X",
        lines: [
          { account_id: ACC_COST, dr: 100, cr: 0 },
          { account_id: ACC_AR, dr: 0, cr: 90 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
    expect(res.json().message).toMatch(/not balanced/);
    // nothing written on a rejected JV
    expect(inserted).toHaveLength(0);
  });

  it("rejects a zero-total JV (400 · Σ dr must be > 0)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: writeDb() })
    ).inject({
      method: "POST",
      url: "/api/v1/gl/jv",
      payload: {
        no: "JV-Z",
        lines: [
          { account_id: ACC_COST, dr: 0, cr: 0 },
          { account_id: ACC_AR, dr: 0, cr: 0 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/greater than zero/);
  });

  it("rejects the sub-cent rounding exploit — validate-vs-persist divergence (400, nothing written)", async () => {
    // gl.jv skeptic: three dr:0.004 legs each round2→0.00 on storage, but a raw-sum
    // gate saw 0.012→0.01 and matched the cr:0.01 leg → would persist Σdr=0.00 vs
    // Σcr=0.01 (unbalanced ledger). The per-line-rounded gate must reject it.
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: writeDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/gl/jv",
      payload: {
        no: "JV-POISON",
        lines: [
          { account_id: ACC_COST, dr: 0.004, cr: 0 },
          { account_id: ACC_COST, dr: 0.004, cr: 0 },
          { account_id: ACC_COST, dr: 0.004, cr: 0 },
          { account_id: ACC_AR, dr: 0, cr: 0.01 },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    // no unbalanced JV persisted
    expect(inserted).toHaveLength(0);
  });

  it("rejects empty/missing lines and missing no (400)", async () => {
    const appx = await buildTestApp({ resolveTenant: async () => SESSION, db: writeDb() });
    const noLines = await appx.inject({
      method: "POST",
      url: "/api/v1/gl/jv",
      payload: { no: "JV-1", lines: [] },
    });
    expect(noLines.statusCode).toBe(400);
    expect(noLines.json().message).toMatch(/non-empty array/);

    const noNo = await appx.inject({
      method: "POST",
      url: "/api/v1/gl/jv",
      payload: { lines: [{ account_id: ACC_COST, dr: 1, cr: 0 }] },
    });
    expect(noNo.statusCode).toBe(400);
    expect(noNo.json().message).toMatch(/no \(JV number\) is required/);
  });

  it("rejects a JV referencing a foreign account_id (400 · fail closed)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        // only ACC_COST belongs to the tenant → ACC_AR is foreign
        db: stubDb({
          rows: [
            [glAccounts, [glAcc(ACC_COST, "5020", "x", null)]],
            [jvs, [{ id: "any", companyId: COMPANY }]],
          ],
          inserted,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/gl/jv", payload: balancedBody });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(new RegExp(`account_id ${ACC_AR} not found`));
    expect(inserted).toHaveLength(0);
  });

  it("binds company_id on the account-ownership read (tenant scope)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: writeDb([], captured) })
    ).inject({ method: "POST", url: "/api/v1/gl/jv", payload: balancedBody });
    const read = captured.find((c) => c.table === glAccounts);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
  });

  // B-094-1: back-posting a JV into a LOCKED (closed) accounting period must be
  // rejected (409 INVALID_STATE) — a closed period must stay closed.
  it("rejects a JV posted to a LOCKED accounting period (409, nothing written)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [glAccounts, [glAcc(ACC_COST, "5020", "x", null), glAcc(ACC_AR, "1030", "y", null)]],
            [jvs, [{ id: "any", companyId: COMPANY }]],
            [accountingPeriods, [periodRow(PERIOD, true)]], // the period is CLOSED
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gl/jv",
      payload: { ...balancedBody, period_id: PERIOD },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
    expect(res.json().message).toMatch(/locked/);
    expect(inserted).toHaveLength(0); // the closed period held — no JV persisted
  });

  it("allows a JV posted to an OPEN period (201) — the guard does not over-block", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [glAccounts, [glAcc(ACC_COST, "5020", "x", null), glAcc(ACC_AR, "1030", "y", null)]],
            [jvs, [{ id: "any", companyId: COMPANY }]],
            [accountingPeriods, [periodRow(PERIOD, false)]], // the period is OPEN
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gl/jv",
      payload: { ...balancedBody, period_id: PERIOD },
    });
    expect(res.statusCode).toBe(201);
    expect(inserted.find((i) => i.table === jvs)).toBeTruthy();
  });
});

// posting-inbox source docs (valid hex uuids — the source_doc "table:uuid"
// convention regex only matches hex + dashes)
const PV_A = "aaaa0000-0000-0000-0000-0000000000aa";
const PV_B = "bbbb0000-0000-0000-0000-0000000000bb";
const RV_A = "cccc0000-0000-0000-0000-0000000000cc";
const inboxDb = (jvSourceDocs: Array<{ id: string; no: string | null; sourceDoc: string | null }>) =>
  stubDb({
    rows: [
      [pvs, [{ id: PV_A, net: "645000.00", currencyCode: "THB", createdAt: D },
             { id: PV_B, net: "268000.00", currencyCode: "THB", createdAt: D }]],
      [rvs, [{ id: RV_A, amount: "2148000.00", currencyCode: "THB", createdAt: D }]],
      [payrolls, []],
      [grs, []],
      [jvs, jvSourceDocs],
    ],
  });

describe("GET /api/v1/gl/posting-inbox", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/gl/posting-inbox" });
    expect(res.statusCode).toBe(401);
  });

  it("HONEST: every source doc reads PENDING while no jv carries a table:uuid ref", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        // seed-shaped free-text source_doc — references nothing by the convention
        db: inboxDb([
          { id: "jv-1", no: "JV-2026-0418", sourceDoc: "REM" },
          { id: "jv-2", no: "JV-2026-0416", sourceDoc: "GR auto" },
          { id: "jv-3", no: "JV-2026-0413", sourceDoc: "Petty" },
        ]),
      })
    ).inject({ url: "/api/v1/gl/posting-inbox" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3); // pv ×2 + rv ×1
    for (const row of body.data) {
      expect(row.posted).toBe(false); // NOT fabricated as posted
      expect(row.jv_no).toBeNull();
    }
    const pvA = body.data.find((r: { id: string }) => r.id === PV_A);
    expect(pvA.source).toBe("pv");
    expect(pvA.amount).toBe(645000);
    expect(Object.keys(pvA).sort()).toEqual([
      "amount",
      "created_at",
      "currency_code",
      "doc_no",
      "id",
      "jv_no",
      "posted",
      "source",
    ]);
  });

  it("flips exactly the referenced doc to posted when a jv carries a pv:<uuid> ref", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: inboxDb([
          { id: "jv-1", no: "JV-2026-0420", sourceDoc: `pv:${PV_A}` },
          { id: "jv-2", no: "JV-2026-0418", sourceDoc: "REM" },
        ]),
      })
    ).inject({ url: "/api/v1/gl/posting-inbox" });

    const body = res.json();
    const pvA = body.data.find((r: { id: string }) => r.id === PV_A);
    const pvB = body.data.find((r: { id: string }) => r.id === PV_B);
    expect(pvA.posted).toBe(true);
    expect(pvA.jv_no).toBe("JV-2026-0420");
    expect(pvB.posted).toBe(false); // untouched by the ref
    expect(pvB.jv_no).toBeNull();
  });

  it("binds company_id on the pv/rv reads (tenant scope)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[pvs, [{ id: PV_A, net: "1.00", currencyCode: "THB", createdAt: D }]], [jvs, []]],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/gl/posting-inbox" });
    const pvRead = captured.find((c) => c.table === pvs);
    expect(pvRead).toBeTruthy();
    expect(paramsOf(pvRead!.where)).toContain(COMPANY);
  });
});

// ===========================================================================
// GET /gl/reports/trial-balance — trial balance (Dr/Cr per account + footer)
// ===========================================================================
describe("GET /api/v1/gl/reports/trial-balance", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      url: "/api/v1/gl/reports/trial-balance",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("aggregates Σ dr / Σ cr per account with a balanced Dr=Cr footer", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [
              glAccounts,
              [
                glAcc(ACC_CASH, "1020", "เงินฝากธนาคาร", null),
                glAcc(ACC_AR, "1030", "ลูกหนี้การค้า", null),
                glAcc(ACC_COST, "5020", "ต้นทุนวัสดุก่อสร้าง", null),
              ],
            ],
            [
              jvLines,
              [
                // JV_A: cost 8040 dr, AR 8040 cr (balanced)
                jvLine(JV_A, ACC_COST, 8040, 0),
                jvLine(JV_A, ACC_AR, 0, 8040),
                // JV_B: cash 2,148,000 dr, AR 2,148,000 cr (balanced)
                jvLine(JV_B, ACC_CASH, 2_148_000, 0),
                jvLine(JV_B, ACC_AR, 0, 2_148_000),
              ],
            ],
          ],
        }),
      })
    ).inject({ url: "/api/v1/gl/reports/trial-balance" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // code-ordered ascending, only accounts with real jv_line activity
    expect(body.rows.map((r: { account_code: string }) => r.account_code)).toEqual([
      "1020",
      "1030",
      "5020",
    ]);
    const cash = body.rows.find((r: { account_code: string }) => r.account_code === "1020");
    expect(cash.account_name).toBe("เงินฝากธนาคาร");
    expect(cash.debit).toBe(2_148_000);
    expect(cash.credit).toBe(0);
    const ar = body.rows.find((r: { account_code: string }) => r.account_code === "1030");
    expect(ar.debit).toBe(0);
    expect(ar.credit).toBe(2_156_040); // 8040 + 2,148,000
    const cost = body.rows.find((r: { account_code: string }) => r.account_code === "5020");
    expect(cost.debit).toBe(8040);
    expect(cost.credit).toBe(0);
    // Dr=Cr footer — the true Σ across every leg (balanced seed JVs).
    expect(body.totals.total_debit).toBe(2_156_040);
    expect(body.totals.total_credit).toBe(2_156_040);
    expect(body.totals.total_debit).toBe(body.totals.total_credit);
    expect(body.currency_code).toBe("THB");
  });

  it("reads jv_line scoped THROUGH jv (never a bare jv_line select) — company param bound", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [jvLines, [jvLine(JV_A, ACC_COST, 1, 0)]],
            [glAccounts, [glAcc(ACC_COST, "5020", "x", null)]],
          ],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/gl/reports/trial-balance" });
    const lineRead = captured.find((c) => c.table === jvLines);
    expect(lineRead).toBeTruthy();
    // scoped THROUGH jv (the selectThrough join hop) + company_id bound on the root
    expect(lineRead!.joins).toContain(jvs);
    expect(paramsOf(lineRead!.where)).toContain(COMPANY);
  });
});

// ===========================================================================
// POST /gl/close-period — CE-strict lock-only period close (Wei C-176)
// ===========================================================================
describe("POST /api/v1/gl/close-period", () => {
  const authzDb = (
    periodRows: unknown[],
    financeApprove: boolean,
    extra: Partial<StubOpts> = {},
  ) =>
    stubDb({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(financeApprove)]],
        [accountingPeriods, periodRows],
      ],
      ...extra,
    });

  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/gl/close-period",
      payload: { period: "2026-05" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });

  it("403s a caller lacking the finance-approve perm (fail closed)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: authzDb([], /* financeApprove */ false),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gl/close-period",
      payload: { period: "2026-05" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance approve permission/);
  });

  it("400s a Buddhist-Era-looking period (2569-05) — CE-strict", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: authzDb([], true),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gl/close-period",
      payload: { period: "2569-05" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
    expect(res.json().message).toMatch(/CE 'YYYY-MM'/);
  });

  it("400s a malformed period (bad month / shape)", async () => {
    const appx = await buildTestApp({
      resolveTenant: async () => SESSION,
      db: authzDb([], true),
    });
    const badMonth = await appx.inject({
      method: "POST",
      url: "/api/v1/gl/close-period",
      payload: { period: "2026-13" },
    });
    expect(badMonth.statusCode).toBe(400);
    const badShape = await appx.inject({
      method: "POST",
      url: "/api/v1/gl/close-period",
      payload: { period: "202605" },
    });
    expect(badShape.statusCode).toBe(400);
  });

  it("409s a period that is already closed (locked)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: authzDb([periodRow(PERIOD, /* locked */ true, "2026-05")], true),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gl/close-period",
      payload: { period: "2026-05" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
    expect(res.json().message).toMatch(/already closed/);
  });

  it("locks a fresh CE period (ActionOk) — creates the row locked, company_id force-set", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: authzDb([], true, { inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gl/close-period",
      payload: { period: "2026-05" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period).toBe("2026-05");
    expect(body.locked).toBe(true);
    expect(body.created).toBe(true);
    const ins = inserted.find((i) => i.table === accountingPeriods);
    expect(ins).toBeTruthy();
    expect(ins!.values[0]!.companyId).toBe(COMPANY);
    expect(ins!.values[0]!.period).toBe("2026-05");
    expect(ins!.values[0]!.locked).toBe(true);
  });

  it("locks an existing OPEN CE period via update (ActionOk) — created=false", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: authzDb([periodRow(PERIOD, /* locked */ false, "2026-05")], true, {
          updated,
          updateBase: periodRow(PERIOD, false, "2026-05"),
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gl/close-period",
      payload: { period: "2026-05" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().created).toBe(false);
    expect(res.json().locked).toBe(true);
    const upd = updated.find((u) => u.table === accountingPeriods);
    expect(upd).toBeTruthy();
    expect(upd!.set.locked).toBe(true);
  });

  it("binds the EXACT CE period param on the accounting_period read (BE seed row not naively matched)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: authzDb([], true, { captured }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gl/close-period",
      payload: { period: "2026-05" },
    });
    const read = captured.find((c) => c.table === accountingPeriods);
    expect(read).toBeTruthy();
    // the query filters by BOTH the tenant and the EXACT CE param — never a loose
    // match that could pull a BE-labelled '2569-05' seed row.
    const params = paramsOf(read!.where);
    expect(params).toContain(COMPANY);
    expect(params).toContain("2026-05");
  });
});

// ===========================================================================
// POST /gl/post — post source money docs to the GL (money = server authority)
// ===========================================================================
const GR_A = "dddd0000-0000-0000-0000-0000000000dd";
const UNKNOWN_ID = "eeee0000-0000-0000-0000-0000000000ee";

// A stub carrying: the loadCaller/authz rows (users + roles), the posting-inbox
// source rows (pv/rv/gr/payroll), the jvs the inbox resolver + allocJvNo +
// insertThrough ownership all read, and the gl_account rows resolveAccountIds
// resolves the posting-map codes against.
const postDb = (
  opts: {
    rvRows?: unknown[];
    pvRows?: unknown[];
    grRows?: unknown[];
    payrollRows?: unknown[];
    jvRows?: unknown[];
    accounts?: unknown[];
    financeApprove?: boolean;
    inserted?: Inserted[];
    captured?: Captured[];
  } = {},
) =>
  stubDb({
    rows: [
      [users, [userRow]],
      [roles, [roleRow(opts.financeApprove ?? true)]],
      [pvs, opts.pvRows ?? []],
      [rvs, opts.rvRows ?? []],
      [grs, opts.grRows ?? []],
      [payrolls, opts.payrollRows ?? []],
      // default: one owned jv with a free-text source_doc — references nothing by
      // the convention (so no inbox doc reads posted) and seeds allocJvNo at 0001.
      [jvs, opts.jvRows ?? [{ id: "jv-own", companyId: COMPANY, no: "JV-2026-0001", sourceDoc: "REM" }]],
      [glAccounts, opts.accounts ?? [glAcc(ACC_CASH, "1020", "เงินฝากธนาคาร", null), glAcc(ACC_AR, "1030", "ลูกหนี้การค้า", null)]],
    ],
    inserted: opts.inserted,
    captured: opts.captured,
  });

describe("POST /api/v1/gl/post", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/gl/post",
      payload: { doc_ids: [RV_A] },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });

  it("403s a caller lacking finance.approve (fail closed — no JV written)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({
          rvRows: [{ id: RV_A, amount: "100.00", currencyCode: "THB", createdAt: D }],
          financeApprove: false,
          inserted,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/gl/post", payload: { doc_ids: [RV_A] } });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance approve permission/);
    expect(inserted).toHaveLength(0);
  });

  it("400s a missing / empty doc_ids array", async () => {
    const appx = await buildTestApp({ resolveTenant: async () => SESSION, db: postDb({}) });
    const empty = await appx.inject({
      method: "POST",
      url: "/api/v1/gl/post",
      payload: { doc_ids: [] },
    });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().code).toBe("VALIDATION");
    const missing = await appx.inject({
      method: "POST",
      url: "/api/v1/gl/post",
      payload: {},
    });
    expect(missing.statusCode).toBe(400);
  });

  it("posts an rv doc — Dr 1020 / Cr 1030 balanced, source_doc set, money from the SOURCE row", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({
          rvRows: [{ id: RV_A, amount: "2148000.00", currencyCode: "THB", createdAt: D }],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gl/post",
      // client smuggles an amount — it MUST be ignored (server authority).
      payload: { doc_ids: [RV_A], amount: 999999 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.skipped).toHaveLength(0);
    expect(body.posted).toHaveLength(1);
    const p = body.posted[0];
    expect(p.doc_id).toBe(RV_A);
    expect(p.source).toBe("rv");
    expect(p.amount).toBe(2_148_000); // from the rv row — NOT the client's 999999
    expect(p.jv_no).toMatch(/^JV-\d{4}-\d{4}$/);
    expect(body.currency_code).toBe("THB");

    // jv header: company_id force-set + the "rv:<uuid>" source_doc convention ref.
    const jvIns = inserted.find((i) => i.table === jvs);
    expect(jvIns).toBeTruthy();
    expect(jvIns!.values[0]!.companyId).toBe(COMPANY);
    expect(jvIns!.values[0]!.sourceDoc).toBe(`rv:${RV_A}`);
    expect(jvIns!.values[0]!.no).toBe("JV-2026-0002"); // one past the seeded 0001

    // two balanced legs: Dr 1020 (cash) = amount, Cr 1030 (AR) = amount.
    const lineIns = inserted.find((i) => i.table === jvLines);
    expect(lineIns).toBeTruthy();
    expect(lineIns!.values).toHaveLength(2);
    expect(lineIns!.values[0]!.accountId).toBe(ACC_CASH);
    expect(lineIns!.values[0]!.dr).toBe("2148000.00");
    expect(lineIns!.values[0]!.cr).toBe("0.00");
    expect(lineIns!.values[1]!.accountId).toBe(ACC_AR);
    expect(lineIns!.values[1]!.dr).toBe("0.00");
    expect(lineIns!.values[1]!.cr).toBe("2148000.00");
  });

  it("skips a gr doc — no postable money amount (gr carries quantity, C10 honest gap)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({ grRows: [{ id: GR_A, no: "GR-001", createdAt: D }], inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/gl/post", payload: { doc_ids: [GR_A] } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.posted).toHaveLength(0);
    expect(body.skipped).toEqual([{ doc_id: GR_A, reason: "no postable money amount" }]);
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined(); // nothing posted
  });

  it("skips an already-posted doc (idempotent) — a jv already carries its rv:<uuid> ref", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({
          rvRows: [{ id: RV_A, amount: "2148000.00", currencyCode: "THB", createdAt: D }],
          jvRows: [
            { id: "jv-posted", companyId: COMPANY, no: "JV-2026-0420", sourceDoc: `rv:${RV_A}` },
          ],
          inserted,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/gl/post", payload: { doc_ids: [RV_A] } });
    const body = res.json();
    expect(body.posted).toHaveLength(0);
    expect(body.skipped).toEqual([{ doc_id: RV_A, reason: "already posted" }]);
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined();
  });

  it("skips a doc_id not in the tenant's posting inbox", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({ rvRows: [{ id: RV_A, amount: "100.00", currencyCode: "THB", createdAt: D }] }),
      })
    ).inject({ method: "POST", url: "/api/v1/gl/post", payload: { doc_ids: [UNKNOWN_ID] } });
    const body = res.json();
    expect(body.posted).toHaveLength(0);
    expect(body.skipped).toEqual([
      { doc_id: UNKNOWN_ID, reason: "not found in this tenant's posting inbox" },
    ]);
  });

  it("skips when a mapped COA account is missing in the tenant's chart (never mis-posts)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({
          rvRows: [{ id: RV_A, amount: "100.00", currencyCode: "THB", createdAt: D }],
          accounts: [glAcc(ACC_CASH, "1020", "เงินฝากธนาคาร", null)], // 1030 (Cr) absent
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/gl/post", payload: { doc_ids: [RV_A] } });
    const body = res.json();
    expect(body.posted).toHaveLength(0);
    expect(body.skipped).toEqual([{ doc_id: RV_A, reason: "COA account missing" }]);
  });
});

// ===========================================================================
// GET /gl/periods — accounting periods list (company-scoped, period-ordered)
// ===========================================================================
describe("GET /api/v1/gl/periods", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/gl/periods" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });

  it("lists accounting periods (B-014 envelope), period-ordered, real columns only", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [
              accountingPeriods,
              [
                periodRow(PERIOD, /* locked */ true, "2026-06"),
                periodRow("per-2", false, "2026-04"),
                periodRow("per-3", false, "2026-05"),
              ],
            ],
          ],
        }),
      })
    ).inject({ url: "/api/v1/gl/periods" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    // period-ordered ascending
    expect(body.data.map((r: { period: string }) => r.period)).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    const jun = body.data.find((r: { period: string }) => r.period === "2026-06");
    expect(jun.locked).toBe(true);
    expect(Object.keys(jun).sort()).toEqual(["created_at", "id", "locked", "period"]);
  });

  it("binds company_id on the accounting_period read (tenant scope)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[accountingPeriods, [periodRow(PERIOD, false, "2026-05")]]],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/gl/periods" });
    const read = captured.find((c) => c.table === accountingPeriods);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
  });
});

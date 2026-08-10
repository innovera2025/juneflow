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
  grItems,
  grs,
  jvLines,
  jvs,
  payrolls,
  projects,
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
  // B-361: an UPDATE … RETURNING that yields 0 rows — a guarded (optimistic-lock)
  // flip whose folded pre-state matched nothing, i.e. another writer moved the row
  // first. The posting lock is exactly this shape.
  updateEmpty?: boolean;
}

/** Db stub: canned rows per table (reads, incl. selectThrough joins) + write capture. */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [], updated = [], updateBase = {}, updateEmpty = false } = opts;
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
            return Promise.resolve(updateEmpty ? [] : [{ ...updateBase, ...set }]);
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

// account_type (migration 0035 backfill) derived from the code prefix, so the
// statements classifier sees real types without every caller passing one.
const TYPE_BY_PREFIX: Record<string, string> = {
  "1": "asset",
  "2": "liability",
  "3": "equity",
  "4": "revenue",
  "5": "expense",
};
const glAcc = (
  id: string,
  code: string,
  name: string,
  parentId: string | null,
  accountType: string | null = TYPE_BY_PREFIX[code[0] ?? ""] ?? null,
) => ({
  id,
  companyId: COMPANY,
  parentId,
  code,
  name,
  accountType,
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

  // B-323: created_at DESC then `no` DESC is NOT total. B-168 is an open, live defect
  // in which allocJvNo can mint a DUPLICATE jv.no, so two distinct JVs can tie on BOTH
  // keys — and the comparator then returned 0 and handed the pair back to the join
  // plan. id is unique by construction and closes the order unconditionally.
  it("is TOTAL even when two JVs tie on created_at AND no (the open B-168 dup-no case)", async () => {
    const t = 7;
    const dup = "JV-2026-0500"; // the same voucher number on two distinct rows
    const nos = async (rows: unknown[]): Promise<string[]> => {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({ rows: [[jvs, rows], [jvLines, []]] }),
        })
      ).inject({ url: "/api/v1/gl/jv" });
      return res.json().data.map((r: { id: string }) => r.id);
    };
    const a = jvRow("aaa", dup, "Manual", "m", t);
    const b = jvRow("bbb", dup, "Manual", "m", t);
    expect(await nos([a, b])).toEqual(["aaa", "bbb"]);
    expect(await nos([b, a])).toEqual(["aaa", "bbb"]);
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

  // ── B-368: the receipt's money reaches the inbox ─────────────────────────────
  it("gr amount is the SERVER-derived Sigma(received_qty x price), matching the GR list wire", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pvs, []],
            [rvs, []],
            [payrolls, []],
            [grs, [{ id: GR_A, no: "GR-2026-0148", status: "received", createdAt: D }]],
            [
              grItems,
              [grLine("gi-0", GR_A, "480", "168.50"), grLine("gi-1", GR_A, "240", "142.00")],
            ],
            [jvs, []],
          ],
        }),
      })
    ).inject({ url: "/api/v1/gl/posting-inbox" });

    const row = res.json().data.find((r: { id: string }) => r.id === GR_A);
    // 480 × 168.50 + 240 × 142.00 — computed from the stored lines, not asserted
    // against the impl's own arithmetic path.
    expect(row.amount).toBe(480 * 168.5 + 240 * 142);
    expect(row.currency_code).toBe("THB");
    expect(row.doc_no).toBe("GR-2026-0148");
  });

  it("gr amount is NULL when the receipt has no priced lines (the mobile shape — 'unknown', not zero baht)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pvs, []],
            [rvs, []],
            [payrolls, []],
            [grs, [{ id: GR_A, no: "GR-2026-0148", status: "received", createdAt: D }]],
            [grItems, []], // st_receive posts bare {qty_ok} lines — no gr_item at all
            [jvs, []],
          ],
        }),
      })
    ).inject({ url: "/api/v1/gl/posting-inbox" });

    const row = res.json().data.find((r: { id: string }) => r.id === GR_A);
    expect(row.amount).toBeNull();
    expect(row.currency_code).toBeNull();
  });

  it("gr amount is NULL when the lines carry MORE THAN ONE currency (never a cross-currency sum)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pvs, []],
            [rvs, []],
            [payrolls, []],
            [grs, [{ id: GR_A, no: "GR-2026-0148", status: "received", createdAt: D }]],
            [
              grItems,
              [
                grLine("gi-0", GR_A, "10", "100.00", "THB"),
                grLine("gi-1", GR_A, "10", "100.00", "USD"),
              ],
            ],
            [jvs, []],
          ],
        }),
      })
    ).inject({ url: "/api/v1/gl/posting-inbox" });

    expect(res.json().data.find((r: { id: string }) => r.id === GR_A).amount).toBeNull();
  });

  it("reads the gr rows RECEIVED-only — a returned/cancelled receipt is not awaiting posting", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[pvs, []], [rvs, []], [payrolls, []], [grs, []], [jvs, []]],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/gl/posting-inbox" });
    const grRead = captured.find((c) => c.table === grs);
    expect(grRead).toBeTruthy();
    // The status predicate is bound on the read itself, so the LIST and the
    // gl.inbox BADGE (which derives from the same function) move together.
    expect(paramsOf(grRead!.where)).toContain("received");
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
// GET /gl/reports/project-pl — P&L per project (B-227 F-GL1)
// ===========================================================================
describe("GET /api/v1/gl/reports/project-pl", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/gl/reports/project-pl" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("computes a per-project P&L from real jv_line (revenue/cogs/sga/interest → gp/tax/net) + resolves the project name", async () => {
    const PROJ = "proj-a";
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [
              glAccounts,
              [
                glAcc("acc-rev", "4010", "รายได้จากการขายอสังหาริมทรัพย์", null), // → revenue
                glAcc("acc-cogs", "5020", "ต้นทุนวัสดุก่อสร้าง", null), // → cogs (50xx)
                glAcc("acc-sga", "5100", "ค่าใช้จ่ายในการบริหาร", null), // → sga (other expense)
                glAcc("acc-int", "5200", "ดอกเบี้ยจ่าย", null), // → interest (52xx)
                glAcc("acc-ar", "1030", "ลูกหนี้การค้า", null), // asset → NOT part of a P&L
              ],
            ],
            [
              jvLines,
              [
                { ...jvLine("jvR", "acc-rev", 0, 1_000_000), projectId: PROJ }, // revenue 1,000,000 (credit-normal)
                { ...jvLine("jvR", "acc-ar", 1_000_000, 0), projectId: PROJ }, // AR (asset) — must NOT leak into the P&L
                { ...jvLine("jvC", "acc-cogs", 600_000, 0), projectId: PROJ }, // cogs 600,000
                { ...jvLine("jvS", "acc-sga", 100_000, 0), projectId: PROJ }, // sga 100,000
                { ...jvLine("jvI", "acc-int", 50_000, 0), projectId: PROJ }, // interest 50,000
              ],
            ],
            [projects, [{ id: PROJ, companyId: COMPANY, name: "โครงการ A", createdAt: D, updatedAt: D }]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/gl/reports/project-pl" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projects).toHaveLength(1);
    const p = body.projects[0];
    expect(p.project_id).toBe(PROJ);
    expect(p.project_name).toBe("โครงการ A"); // FK resolved to the name, never the uuid
    expect(p.revenue).toBe(1_000_000); // the AR (asset) line did NOT leak in
    expect(p.cogs).toBe(600_000);
    expect(p.gross_profit).toBe(400_000); // 1,000,000 − 600,000
    expect(p.sga).toBe(100_000);
    expect(p.interest).toBe(50_000);
    expect(p.pre_tax).toBe(250_000); // 400,000 − 100,000 − 50,000
    expect(p.tax).toBe(50_000); // 20% of 250,000
    expect(p.net_income).toBe(200_000); // 250,000 − 50,000
    expect(p.gross_margin).toBe(40);
    expect(p.net_margin).toBe(20);
    expect(body.totals.revenue).toBe(1_000_000);
    expect(body.totals.net_income).toBe(200_000);
    expect(body.totals.project_count).toBe(1);
    expect(body.totals.losing_count).toBe(0);
    expect(body.currency_code).toBe("THB");
  });

  it("honest-null margins when a project has 0 revenue (never a divide-by-zero)", async () => {
    const PROJ = "proj-b";
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [glAccounts, [glAcc("acc-c2", "5020", "ต้นทุน", null)]],
            [jvLines, [{ ...jvLine("jvC2", "acc-c2", 300_000, 0), projectId: PROJ }]],
            [projects, [{ id: PROJ, companyId: COMPANY, name: "โครงการ B", createdAt: D, updatedAt: D }]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/gl/reports/project-pl" });
    expect(res.statusCode).toBe(200);
    const p = res.json().projects[0];
    expect(p.revenue).toBe(0);
    expect(p.cogs).toBe(300_000);
    expect(p.net_income).toBe(-300_000); // a real loss (300k cost, no revenue)
    expect(p.gross_margin).toBeNull(); // honest-null, not NaN/Infinity
    expect(p.net_margin).toBeNull();
    expect(res.json().totals.losing_count).toBe(1);
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
// GET /gl/reports/statements + /cashflow — the two account-type reports.
// The canned rows below mirror the REAL 7-JV seed (index.ts L595 JV_BOOKS +
// L378 COA_SEED) verbatim, so the asserted figures are the true Σ over stored
// jv_line — never a value hand-computed against the impl.
// ===========================================================================
const ACC_HAND = "acc00000-0000-0000-0000-000000001010"; // 1010 asset (CASH)
const ACC_WIP = "acc00000-0000-0000-0000-000000001140"; // 1140 asset
const ACC_PPE = "acc00000-0000-0000-0000-000000001210"; // 1210 asset
const ACC_AP = "acc00000-0000-0000-0000-000000002010"; // 2010 liability
const ACC_DEP = "acc00000-0000-0000-0000-000000002040"; // 2040 liability
const ACC_VAT = "acc00000-0000-0000-0000-000000002050"; // 2050 liability
const ACC_LABOR = "acc00000-0000-0000-0000-000000005030"; // 5030 expense
const ACC_ADMIN = "acc00000-0000-0000-0000-000000005100"; // 5100 expense
const ACC_INT = "acc00000-0000-0000-0000-000000005200"; // 5200 expense
// ACC_CASH = 1020 (bank, CASH) · ACC_AR = 1030 (asset) · ACC_COST = 5020 (expense).

const stmtAccounts = [
  glAcc(ACC_HAND, "1010", "เงินสดในมือ", null),
  glAcc(ACC_CASH, "1020", "เงินฝากธนาคาร - กระแสรายวัน (KBANK)", null),
  glAcc(ACC_AR, "1030", "ลูกหนี้การค้า", null),
  glAcc(ACC_WIP, "1140", "งานระหว่างก่อสร้าง (WIP/CIP)", null),
  glAcc(ACC_PPE, "1210", "ที่ดิน อาคาร และอุปกรณ์", null),
  glAcc(ACC_AP, "2010", "เจ้าหนี้การค้า", null),
  glAcc(ACC_DEP, "2040", "เงินมัดจำ/เงินจองรับล่วงหน้า", null),
  glAcc(ACC_VAT, "2050", "ภาษีขายรอนำส่ง (VAT)", null),
  glAcc(ACC_COST, "5020", "ต้นทุนวัสดุก่อสร้าง", null),
  glAcc(ACC_LABOR, "5030", "ค่าแรง / ค่าจ้างเหมาช่วง", null),
  glAcc(ACC_ADMIN, "5100", "ค่าใช้จ่ายในการบริหาร", null),
  glAcc(ACC_INT, "5200", "ดอกเบี้ยจ่าย", null),
];

// The 7 seeded JV books (index.ts L595) as jv_line rows. jvId groups the legs
// for the cashflow per-JV classification; the pending JV-0412 is INCLUDED (no
// status filter — it is internally balanced, so identity holds).
const stmtJvLines = [
  jvLine("jv-0418", ACC_CASH, 2_148_000, 0),
  jvLine("jv-0418", ACC_AR, 0, 2_148_000),
  jvLine("jv-0417", ACC_AP, 8040, 0),
  jvLine("jv-0417", ACC_VAT, 0, 8040),
  jvLine("jv-0416", ACC_COST, 90466, 0),
  jvLine("jv-0416", ACC_AP, 0, 90466),
  jvLine("jv-0415", ACC_COST, 100000, 0),
  jvLine("jv-0415", ACC_LABOR, 119200, 0),
  jvLine("jv-0415", ACC_WIP, 0, 219200),
  jvLine("jv-0414", ACC_ADMIN, 4167, 0),
  jvLine("jv-0414", ACC_PPE, 0, 4167),
  jvLine("jv-0413", ACC_ADMIN, 8400, 0),
  jvLine("jv-0413", ACC_HAND, 0, 8400),
  jvLine("jv-0412", ACC_ADMIN, 92250, 0),
  jvLine("jv-0412", ACC_INT, 92250, 0),
  jvLine("jv-0412", ACC_AP, 0, 92250),
  jvLine("jv-0412", ACC_DEP, 0, 92250),
];

const stmtDb = (extra: Partial<StubOpts> = {}) =>
  stubDb({
    rows: [
      [glAccounts, stmtAccounts],
      [jvLines, stmtJvLines],
    ],
    ...extra,
  });

describe("GET /api/v1/gl/reports/statements", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      url: "/api/v1/gl/reports/statements",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("classifies real Σ into a balanced BS + IS, prior-year honest-null", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stmtDb() })
    ).inject({ url: "/api/v1/gl/reports/statements" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const bs = body.balance_sheet;

    // ASSETS (debit-normal Σdr−Σcr), code-ordered, only accounts with activity.
    expect(bs.assets.rows.map((r: { account_code: string }) => r.account_code)).toEqual([
      "1010",
      "1020",
      "1030",
      "1140",
      "1210",
    ]);
    const bank = bs.assets.rows.find((r: { account_code: string }) => r.account_code === "1020");
    expect(bank.account_name).toBe("เงินฝากธนาคาร - กระแสรายวัน (KBANK)");
    expect(bank.amount).toBe(2_148_000);
    expect(bank.prior_amount).toBeNull(); // prior-year honest-null on every row
    expect(bs.assets.rows.find((r: { account_code: string }) => r.account_code === "1010").amount).toBe(-8400);
    expect(bs.assets.subtotal).toBe(-231_767);

    // LIABILITIES (credit-normal Σcr−Σdr).
    expect(bs.liabilities.rows.map((r: { account_code: string }) => r.account_code)).toEqual([
      "2010",
      "2040",
      "2050",
    ]);
    expect(bs.liabilities.rows.find((r: { account_code: string }) => r.account_code === "2010").amount).toBe(174_676);
    expect(bs.liabilities.subtotal).toBe(274_966);

    // EQUITY — honest-empty rows (no 3010/3020 activity) + net_income folded in.
    expect(bs.equity.rows).toEqual([]);
    expect(bs.equity.net_income_line.amount).toBe(-506_733);
    expect(bs.equity.net_income_line.prior_amount).toBeNull();
    expect(bs.equity.subtotal).toBe(-506_733);

    // The two BS sides tie (balanced == a real equality over real sums).
    expect(bs.total_assets).toBe(-231_767);
    expect(bs.total_liabilities_equity).toBe(-231_767);
    expect(bs.prior_total_assets).toBeNull();
    expect(bs.balanced).toBe(true);

    // INCOME STATEMENT — revenue honest-empty; expense debit-normal; NI a LOSS.
    const is = body.income_statement;
    expect(is.revenue.rows).toEqual([]);
    expect(is.revenue.total).toBe(0);
    expect(is.revenue.prior_total).toBeNull();
    expect(is.expense.rows.map((r: { account_code: string }) => r.account_code)).toEqual([
      "5020",
      "5030",
      "5100",
      "5200",
    ]);
    expect(is.expense.rows.find((r: { account_code: string }) => r.account_code === "5020").amount).toBe(190_466);
    expect(is.expense.rows.find((r: { account_code: string }) => r.account_code === "5100").amount).toBe(104_817);
    expect(is.expense.total).toBe(506_733);
    expect(is.net_income).toBe(-506_733);
    expect(is.prior_net_income).toBeNull();

    expect(body.currency_code).toBe("THB");
  });

  it("reads jv_line scoped THROUGH jv (never a bare jv_line select) — company param bound", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [jvLines, [jvLine("jv-x", ACC_COST, 1, 0)]],
            [glAccounts, [glAcc(ACC_COST, "5020", "x", null)]],
          ],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/gl/reports/statements" });
    const lineRead = captured.find((c) => c.table === jvLines);
    expect(lineRead).toBeTruthy();
    expect(lineRead!.joins).toContain(jvs);
    expect(paramsOf(lineRead!.where)).toContain(COMPANY);
  });
});

describe("GET /api/v1/gl/reports/cashflow", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      url: "/api/v1/gl/reports/cashflow",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("DIRECT method — real bucket sums, honest-empty investing/financing, prior null", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stmtDb() })
    ).inject({ url: "/api/v1/gl/reports/cashflow" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.method).toBe("direct");

    // OPERATING — cash movement attributed to its contra account, code-ordered:
    //   JV-0418 (cash 1020 +2,148,000) → contra 1030 +2,148,000
    //   JV-0413 (cash 1010 −8,400)     → contra 5100 −8,400
    expect(body.operating.lines.map((l: { account_code: string }) => l.account_code)).toEqual([
      "1030",
      "5100",
    ]);
    expect(body.operating.lines.find((l: { account_code: string }) => l.account_code === "1030").amount).toBe(2_148_000);
    expect(body.operating.lines.find((l: { account_code: string }) => l.account_code === "5100").amount).toBe(-8400);
    expect(body.operating.net).toBe(2_139_600);

    // INVESTING / FINANCING — honest-empty (no cash JV touches those accounts).
    expect(body.investing).toEqual({ lines: [], net: 0 });
    expect(body.financing).toEqual({ lines: [], net: 0 });

    // opening honest-0, closing = opening + real net movement, prior honest-null.
    expect(body.opening_cash).toBe(0);
    expect(body.net_change).toBe(2_139_600);
    expect(body.closing_cash).toBe(2_139_600);
    expect(body.prior).toBeNull();
    expect(body.currency_code).toBe("THB");
  });

  it("excludes a JV with no cash leg + reconciles buckets to net_change", async () => {
    // A pure accrual JV (no 1010/1020 leg) contributes nothing to cash flow;
    // net_change stays the real cash movement and the buckets sum to it.
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stmtDb() })
    ).inject({ url: "/api/v1/gl/reports/cashflow" });
    const body = res.json();
    const bucketNet =
      body.operating.net + body.investing.net + body.financing.net;
    expect(bucketNet).toBe(body.net_change); // self-reconciling
    // JV-0412 (accrual-only) never surfaces a 5200/2040 cash line.
    const allLines = [
      ...body.operating.lines,
      ...body.investing.lines,
      ...body.financing.lines,
    ].map((l: { account_code: string }) => l.account_code);
    expect(allLines).not.toContain("5200");
    expect(allLines).not.toContain("2040");
  });

  it("reads jv_line scoped THROUGH jv (never a bare jv_line select) — company param bound", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [jvLines, [jvLine("jv-x", ACC_CASH, 1, 0)]],
            [glAccounts, [glAcc(ACC_CASH, "1020", "x", null)]],
          ],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/gl/reports/cashflow" });
    const lineRead = captured.find((c) => c.table === jvLines);
    expect(lineRead).toBeTruthy();
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

// B-368: gr_item rows are the receipt's money. price/currency are SERVER-owned
// (gr.ts derives them from boq_item at create); this fixture just stores them.
const grLine = (
  id: string,
  grId: string,
  receivedQty: string,
  price: string,
  currencyCode = "THB",
) => ({ id, grId, boqItemId: null, name: `line ${id}`, orderedQty: receivedQty, receivedQty, unit: "ถุง", price, currencyCode, createdAt: D, updatedAt: D });

/** The gr posting rule's two COA accounts (gl-post.ts POSTING_MAP.gr = 5020 / 2010). */
const ACC_MATCOST = "9999aaaa-0000-0000-0000-00000000aaaa";
const ACC_TRADE_AP = "9999bbbb-0000-0000-0000-00000000bbbb";
const GR_ACCOUNTS = [
  glAcc(ACC_MATCOST, "5020", "ต้นทุนวัสดุ", null),
  glAcc(ACC_TRADE_AP, "2010", "เจ้าหนี้การค้า", null),
];

// A stub carrying: the loadCaller/authz rows (users + roles), the posting-inbox
// source rows (pv/rv/gr/payroll), the jvs the inbox resolver + allocJvNo +
// insertThrough ownership all read, and the gl_account rows resolveAccountIds
// resolves the posting-map codes against.
const postDb = (
  opts: {
    rvRows?: unknown[];
    pvRows?: unknown[];
    grRows?: unknown[];
    grItemRows?: unknown[];
    payrollRows?: unknown[];
    jvRows?: unknown[];
    accounts?: unknown[];
    financeApprove?: boolean;
    inserted?: Inserted[];
    captured?: Captured[];
    updated?: Updated[];
    updateEmpty?: boolean;
  } = {},
) =>
  stubDb({
    rows: [
      [users, [userRow]],
      [roles, [roleRow(opts.financeApprove ?? true)]],
      [pvs, opts.pvRows ?? []],
      [rvs, opts.rvRows ?? []],
      [grs, opts.grRows ?? []],
      // B-368: the receipt's postable money is Sigma(received_qty x price) over these.
      [grItems, opts.grItemRows ?? []],
      [payrolls, opts.payrollRows ?? []],
      // default: one owned jv with a free-text source_doc — references nothing by
      // the convention (so no inbox doc reads posted) and seeds allocJvNo at 0001.
      [jvs, opts.jvRows ?? [{ id: "jv-own", companyId: COMPANY, no: "JV-2026-0001", sourceDoc: "REM" }]],
      [glAccounts, opts.accounts ?? [glAcc(ACC_CASH, "1020", "เงินฝากธนาคาร", null), glAcc(ACC_AR, "1030", "ลูกหนี้การค้า", null)]],
    ],
    inserted: opts.inserted,
    captured: opts.captured,
    updated: opts.updated,
    updateEmpty: opts.updateEmpty,
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

  it("skips a gr doc with NO priced lines — no postable money amount (the mobile shape)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({
          grRows: [{ id: GR_A, no: "GR-001", status: "received", createdAt: D }],
          grItemRows: [], // st_receive posts bare {qty_ok} lines — no per-line detail
          inserted,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/gl/post", payload: { doc_ids: [GR_A] } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.posted).toHaveLength(0);
    expect(body.skipped).toEqual([{ doc_id: GR_A, reason: "no postable money amount" }]);
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined(); // nothing posted
  });

  // ── B-368: the receipt finally posts a COST ──────────────────────────────────
  it("POSTS a priced gr: Dr 5020 / Cr 2010 for the SERVER-derived Sigma(received x price)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({
          grRows: [{ id: GR_A, no: "GR-2026-0148", status: "received", createdAt: D }],
          grItemRows: [
            grLine("gi-0", GR_A, "480", "168.50"),
            grLine("gi-1", GR_A, "240", "142.00"),
          ],
          accounts: GR_ACCOUNTS,
          inserted,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/gl/post", payload: { doc_ids: [GR_A] } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.skipped).toHaveLength(0);
    const total = 480 * 168.5 + 240 * 142;
    expect(body.posted).toEqual([
      { doc_id: GR_A, source: "gr", jv_no: expect.any(String), amount: total },
    ]);

    // The JV records the source doc by the shared "<table>:<uuid>" convention, so
    // the inbox reads it back as posted (and the 0037 UNIQUE index dedups a race).
    const jvIns = inserted.find((i) => i.table === jvs);
    expect(jvIns!.values[0]!.sourceDoc).toBe(`gr:${GR_A}`);

    // A BALANCED two-leg JV at the derived amount.
    const lines = inserted.find((i) => i.table === jvLines)!.values;
    expect(lines).toHaveLength(2);
    expect(lines[0]!.accountId).toBe(ACC_MATCOST); // 5020 material cost
    expect(lines[0]!.dr).toBe(total.toFixed(2));
    expect(lines[0]!.cr).toBe("0.00");
    expect(lines[1]!.accountId).toBe(ACC_TRADE_AP); // 2010 trade AP
    expect(lines[1]!.dr).toBe("0.00");
    expect(lines[1]!.cr).toBe(total.toFixed(2));
  });

  // ── B-361: the post takes the receipt's row lock and re-decides ──────────────
  it("LOCKS the receipt inside the posting transaction, guarded on `received`, BEFORE the JV insert", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({
          grRows: [{ id: GR_A, no: "GR-2026-0148", status: "received", createdAt: D }],
          grItemRows: [grLine("gi-0", GR_A, "10", "100.00")],
          accounts: GR_ACCOUNTS,
          inserted,
          updated,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/gl/post", payload: { doc_ids: [GR_A] } });

    expect(res.statusCode).toBe(200);
    expect(res.json().posted).toHaveLength(1);
    // The lock is a guarded UPDATE on `gr` — the same row the return/cancel flip
    // takes — and its WHERE binds both the receipt id and the `received` pre-state.
    const lock = updated.find((u) => u.table === grs);
    expect(lock, "the posting tx must take the gr row lock").toBeTruthy();
    expect(paramsOf(lock!.where)).toEqual(expect.arrayContaining([GR_A, "received"]));
    // …and it happens BEFORE the JV exists (nothing to roll back if it refuses).
    expect(inserted.findIndex((i) => i.table === jvs)).toBeGreaterThanOrEqual(0);
    expect(updated.indexOf(lock!)).toBe(0);
  });

  it("skips a gr whose row moved on (returned/cancelled) — no JV, and NOT 'already posted'", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({
          // The enumeration read it as `received` (that read is outside any
          // transaction), but the guarded UPDATE matches 0 rows — the real shape
          // of "a concurrent return committed while this batch ran".
          grRows: [{ id: GR_A, no: "GR-2026-0148", status: "received", createdAt: D }],
          grItemRows: [grLine("gi-0", GR_A, "10", "100.00")],
          accounts: GR_ACCOUNTS,
          updateEmpty: true,
          inserted,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/gl/post", payload: { doc_ids: [GR_A] } });

    expect(res.statusCode).toBe(200); // never a 500
    const body = res.json();
    expect(body.posted).toEqual([]);
    expect(body.skipped).toEqual([
      {
        doc_id: GR_A,
        reason: "the receipt was returned or cancelled — no longer postable",
      },
    ]);
    // The whole post rolled back: no JV header, no legs. And the reason is NOT
    // "already posted" — that would tell the caller someone else booked this cost.
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined();
    expect(inserted.find((i) => i.table === jvLines)).toBeUndefined();
  });

  it("the lock governs `gr` ONLY — an rv posts with no gr UPDATE at all", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({
          rvRows: [{ id: RV_A, amount: "100.00", currencyCode: "THB", createdAt: D }],
          updated,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/gl/post", payload: { doc_ids: [RV_A] } });
    expect(res.json().posted).toHaveLength(1);
    expect(updated.find((u) => u.table === grs)).toBeUndefined();
  });

  it("skips a gr whose priced lines total ZERO — a zero JV would mark it posted forever", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: postDb({
          grRows: [{ id: GR_A, no: "GR-001", status: "received", createdAt: D }],
          // Lines exist, but none has a server price source (no boq_item_id at create).
          grItemRows: [grLine("gi-0", GR_A, "90", "0.00")],
          accounts: GR_ACCOUNTS,
          inserted,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/gl/post", payload: { doc_ids: [GR_A] } });
    expect(res.json().skipped).toEqual([
      { doc_id: GR_A, reason: "no postable money amount" },
    ]);
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined();
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

  it("maps a concurrent double-post (23505 on the source_doc index) to the idempotent skip", async () => {
    // The doc passes the in-memory pre-check (pending), but a racing /gl/post
    // committed the jv first → the 0037 source_doc UNIQUE index trips 23505 in the
    // tx. P2-BE-52: the handler maps it to the same skip, never a 500.
    const base = postDb({
      rvRows: [{ id: RV_A, amount: "2148000.00", currencyCode: "THB", createdAt: D }],
    });
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
    ).inject({ method: "POST", url: "/api/v1/gl/post", payload: { doc_ids: [RV_A] } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.posted).toHaveLength(0);
    expect(body.skipped).toEqual([{ doc_id: RV_A, reason: "already posted" }]);
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

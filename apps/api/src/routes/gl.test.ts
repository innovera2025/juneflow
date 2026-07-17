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
  glAccounts,
  grs,
  jvLines,
  jvs,
  payrolls,
  pvs,
  rvs,
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

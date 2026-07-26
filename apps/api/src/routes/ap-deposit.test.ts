// G3 unit tests (PLAN.md §9) — AP vendor-deposit handlers (Phase-3 Finance,
// P2-BE-54 · ap.jsx APDeposit). Covers the deposit register (STORED columns +
// joined vendor_name / ref + SERVER-computed balance) and the create action: a
// create posts a balanced Dr 1160 / Cr 1010 JV in the SAME transaction as the
// ap_deposit row, keys the source_doc `dep:<depositId>`, server-allocates the
// DP-YYYY-NNNN number, and is gated fail-closed (finance.create · vendor/po/wo
// ownership · amount > 0 · COA present) + race-safe (23505 → 409). Every expected
// value comes from the stub — no value is hand-computed against the impl, EXCEPT
// the server-authority contracts under test (balance = amount − used, the posted
// JV amount == the STORED deposit amount, and the Dr 1160 / Cr 1010 direction).
//
// The ap/deposit routes are wired in app.ts (registerApDepositRoute) by the
// orchestrator — buildApp mounts them under /api/v1, so buildTestApp does NO
// sibling registration (a self-registration would double-declare after the
// orchestrator's wiring lands). The root tenant-scope + audit hooks apply to the
// wired route exactly as to every other contract handler.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  apDeposits,
  glAccounts,
  jvLines,
  jvs,
  pos,
  roles,
  users,
  vendors,
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
const D = new Date(1_700_000_000_000); // 2023-11-14T22:13:20Z
const YEAR = new Date().getFullYear(); // DP/JV numbers use the current CE year.

/** A canned rows source: a fixed list, or a where-aware fn (a table read more than
 *  once with different predicates). */
type RowSource = unknown[] | ((where: SQL | undefined) => unknown[]);
interface Captured {
  table: unknown;
  where: SQL | undefined;
}
interface Inserted {
  table: unknown;
  values: Record<string, unknown> | Record<string, unknown>[];
}
interface StubOpts {
  rows: Array<[unknown, RowSource]>;
  captured?: Captured[];
  inserted?: Inserted[];
}

/** Db stub: canned rows per table (reads, incl. selectThrough joins) + write capture. */
function stubDb(opts: StubOpts): Db {
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
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: () => Promise.resolve([{ id: "upd", ...set }]),
        }),
      }),
    }),
  };
  // The transaction door runs its callback against this SAME stub, so writes inside
  // a tx still capture (the fake has no real BEGIN/COMMIT — it proves the door
  // threads one scoped handle).
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
  // ap/deposit routes are wired in app.ts (registerApDepositRoute) → buildApp
  // already mounts them under /api/v1; no sibling registration here (would
  // double-declare).
  await app.ready();
  return app;
}

// --- seed-shaped canned rows ------------------------------------------------
const DEP0 = "dep00000-0000-0000-0000-0000000000d0";
const VENDOR0 = "ven00000-0000-0000-0000-0000000000v0";
const PO0 = "po000000-0000-0000-0000-0000000000p0";
// The two REAL COA accounts a deposit posts against (Dr 1160 / Cr 1010).
const ACC_ADVANCE = "acc00000-0000-0000-0000-000000001160"; // 1160 advance-to-supplier
const ACC_CASH = "acc00000-0000-0000-0000-000000001010"; // 1010 cash

const depRow = (
  id: string,
  extra: Partial<typeof apDeposits.$inferSelect> = {},
): typeof apDeposits.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    no: `DP-${YEAR}-0024`,
    vendorId: VENDOR0,
    poId: PO0,
    woId: null,
    reason: "มัดจำ PO กระเบื้อง 30%",
    pct: "30.00",
    amount: "380400.00",
    used: "0.00",
    currencyCode: "THB",
    status: "approved",
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof apDeposits.$inferSelect;

const vendorRow = {
  id: VENDOR0,
  companyId: COMPANY,
  name: "บจก. โสสุโก้",
  code: "V-0001",
  taxId: null,
  kind: "supplier",
  creditTerm: null,
  addr: null,
  bank: null,
  status: "active",
  createdAt: D,
  updatedAt: D,
};

// po carries no company_id — it resolves through pr → project via selectThrough.
const poRow = { id: PO0, no: `PO-${YEAR}-0291` };

// A benign existing JV so insertThrough's parent-ownership select is non-empty and
// allocJvNo has a set to scan (its `no` never matches the current-year prefix, so
// allocJvNo starts at 0001).
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

const userRow = {
  id: "u-0",
  companyId: COMPANY,
  email: SESSION.user.email,
  name: SESSION.user.name,
  roleId: "role-0",
  status: "active",
};
/** A role carrying (or not) the finance.create perm the create gate reads. */
const roleRow = (financeCreate = true) => ({
  id: "role-0",
  companyId: COMPANY,
  name: "Finance",
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
/** Both posting accounts present (the happy path resolves the 1160/1010 map). */
const COA_ROWS = [
  glAcc(ACC_ADVANCE, "1160", "เงินมัดจำจ่ายล่วงหน้า (Advance to suppliers)"),
  glAcc(ACC_CASH, "1010", "เงินสด"),
];

// ===========================================================================
// GET /ap/deposit
// ===========================================================================
describe("GET /api/v1/ap/deposit", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/ap/deposit" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("returns the B-014 envelope — stored columns + joined vendor/ref + server-computed balance", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [apDeposits, [depRow(DEP0, { amount: "460000.00", used: "230000.00" })]],
            [vendors, [vendorRow]],
            [pos, [poRow]],
          ],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/ap/deposit" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    const r = body.data[0];
    // STORED columns.
    expect(r.id).toBe(DEP0);
    expect(r.no).toBe(`DP-${YEAR}-0024`);
    expect(r.vendor_id).toBe(VENDOR0);
    expect(r.po_id).toBe(PO0);
    expect(r.wo_id).toBeNull();
    expect(r.reason).toBe("มัดจำ PO กระเบื้อง 30%");
    expect(r.pct).toBe(30);
    expect(r.amount).toBe(460_000);
    expect(r.used).toBe(230_000);
    expect(r.currency_code).toBe("THB");
    expect(r.status).toBe("approved");
    // HONEST-JOINED.
    expect(r.vendor_name).toBe("บจก. โสสุโก้");
    expect(r.ref).toBe(`PO-${YEAR}-0291`);
    // SERVER-computed balance = amount − used (never stored).
    expect(r.balance).toBe(230_000);
    // The badge is NOT in the wire (web derives หักครบ/ค้างหัก from balance === 0).
    expect(r).not.toHaveProperty("badge");
    // company_id bound on the ap_deposit read (tenant scope).
    const read = captured.find((c) => c.table === apDeposits);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
  });

  it("ships a fully-offset deposit as balance 0 (web renders the หักครบ badge from it)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [apDeposits, [depRow(DEP0, { amount: "122480.00", used: "122480.00" })]],
            [vendors, [vendorRow]],
            [pos, [poRow]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/ap/deposit" });
    const r = res.json().data[0];
    expect(r.amount).toBe(122_480);
    expect(r.used).toBe(122_480);
    expect(r.balance).toBe(0); // web: balance === 0 → "หักครบ"
  });

  it("emits honest nulls for an unresolved vendor / ref join", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [apDeposits, [depRow(DEP0, { vendorId: null, poId: null, woId: null })]],
            [vendors, []],
            [pos, []],
          ],
        }),
      })
    ).inject({ url: "/api/v1/ap/deposit" });
    const r = res.json().data[0];
    expect(r.vendor_name).toBeNull();
    expect(r.ref).toBeNull();
  });
});

// ===========================================================================
// POST /ap/deposit
// ===========================================================================
describe("POST /api/v1/ap/deposit", () => {
  const createDb = (opts: {
    deposits?: unknown[];
    vendors?: unknown[];
    pos?: unknown[];
    coa?: unknown[];
    inserted?: Inserted[];
    captured?: Captured[];
    financeCreate?: boolean;
  } = {}) =>
    stubDb({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(opts.financeCreate ?? true)]],
        [apDeposits, opts.deposits ?? [depRow(DEP0)]], // seeds DP-<year>-0024 → next 0025
        [vendors, opts.vendors ?? [vendorRow]],
        [pos, opts.pos ?? [poRow]],
        [jvs, [jvSeed]],
        [glAccounts, opts.coa ?? COA_ROWS],
      ],
      inserted: opts.inserted,
      captured: opts.captured,
    });

  const payload = {
    vendor_id: VENDOR0,
    po_id: PO0,
    amount: 380400,
    pct: 30,
    reason: "มัดจำ PO กระเบื้อง 30%",
  };

  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/ap/deposit",
      payload,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });

  it("403s a caller lacking the finance-create perm (money-lock, fail closed)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: createDb({ inserted, financeCreate: false }),
      })
    ).inject({ method: "POST", url: "/api/v1/ap/deposit", payload });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance create permission/);
    expect(inserted).toHaveLength(0); // nothing posted on a denied create
  });

  it("400s when vendor_id is missing", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: createDb() })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/deposit",
      payload: { amount: 380400 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/vendor_id is required/);
  });

  it("400s when amount is missing or not greater than zero", async () => {
    const app1 = await buildTestApp({ resolveTenant: async () => SESSION, db: createDb() });
    const res = await app1.inject({
      method: "POST",
      url: "/api/v1/ap/deposit",
      payload: { vendor_id: VENDOR0 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/amount is required/);
    await app1.close();

    const res0 = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: createDb() })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/deposit",
      payload: { vendor_id: VENDOR0, amount: 0 },
    });
    expect(res0.statusCode).toBe(400);
    expect(res0.json().message).toMatch(/greater than zero/);
  });

  it("400s a vendor not in this tenant (scoped)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: createDb({ vendors: [], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/deposit",
      payload: { vendor_id: VENDOR0, amount: 380400 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/vendor not found in this tenant/);
    expect(inserted).toHaveLength(0);
  });

  it("400s a po_id not in this tenant (foreign, scoped through pr → project)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: createDb({ pos: [], inserted }), // selectThrough resolves nothing
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/deposit",
      payload: { vendor_id: VENDOR0, po_id: PO0, amount: 380400 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/po_id not found in this tenant/);
    expect(inserted).toHaveLength(0);
  });

  it("posts a BALANCED Dr 1160 / Cr 1010 JV from the STORED amount, server-allocates DP-no, keys source_doc dep:<id>", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: createDb({ inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/ap/deposit", payload });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    // Server-allocated DP number — one past the seeded DP-<year>-0024.
    expect(body.no).toBe(`DP-${YEAR}-0025`);
    expect(body.amount).toBe(380_400);
    expect(body.used).toBe(0);
    expect(body.balance).toBe(380_400); // amount − used, server-computed
    expect(body.status).toBe("approved");
    expect(body.vendor_name).toBe("บจก. โสสุโก้");
    expect(body.ref).toBe(`PO-${YEAR}-0291`);

    // The ap_deposit row is stored (used='0', status='approved', currency THB).
    const depIns = inserted.find((i) => i.table === apDeposits);
    const depVals = depIns!.values as Record<string, unknown>;
    expect(depVals.amount).toBe("380400.00");
    expect(depVals.used).toBe("0");
    expect(depVals.status).toBe("approved");
    expect(depVals.pct).toBe("30.00"); // stored label only — never drives amount

    // MONEY=SERVER: the posted JV amount reads the STORED deposit amount.
    const lineIns = inserted.find((i) => i.table === jvLines);
    const lines = lineIns!.values as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    const dr = lines.find((l) => l.accountId === ACC_ADVANCE)!; // Dr 1160
    const cr = lines.find((l) => l.accountId === ACC_CASH)!; // Cr 1010
    expect(dr.dr).toBe("380400.00");
    expect(dr.cr).toBe("0.00");
    expect(cr.dr).toBe("0.00");
    expect(cr.cr).toBe("380400.00");
    // The JV Dr/Cr amount equals the stored deposit amount (not a client re-trust).
    expect(dr.dr).toBe(depVals.amount);
    // Σ dr === Σ cr (balanced).
    const sumDr = lines.reduce((s, l) => s + Number(l.dr), 0);
    const sumCr = lines.reduce((s, l) => s + Number(l.cr), 0);
    expect(sumDr).toBe(380_400);
    expect(sumCr).toBe(380_400);

    // The JV carries the unique source_doc dep:<depositId> + a stable English memo.
    const jvIns = inserted.find((i) => i.table === jvs);
    const jvVals = jvIns!.values as Record<string, unknown>;
    expect(jvVals.sourceDoc).toBe(`dep:${body.id}`);
    expect(jvVals.memo).toBe(`vendor-deposit ${body.no}`);
    expect(jvVals.no).toMatch(/^JV-\d{4}-\d{4}$/);
  });

  it("stores DP-<year>-0001 as the first deposit of the year (empty register)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: createDb({ deposits: [] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/deposit",
      payload: { vendor_id: VENDOR0, amount: 215000 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().no).toBe(`DP-${YEAR}-0001`);
    expect(res.json().ref).toBeNull(); // no po/wo supplied
  });

  it("409s honestly when the tenant COA lacks a required posting account (never invents)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: createDb({
          coa: [glAcc(ACC_ADVANCE, "1160", "เงินมัดจำจ่ายล่วงหน้า")], // 1010 cash MISSING
          inserted,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/ap/deposit", payload });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/missing a required posting account/);
    expect(inserted).toHaveLength(0); // no post on a missing account
  });

  it("409s a concurrent double-post (23505 on the source_doc index → idempotent, never a 500)", async () => {
    // The create passes every guard, but a racing post committed first → the 0039
    // source_doc UNIQUE index trips 23505 in the tx. The handler maps it to 409.
    const base = createDb({});
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
    ).inject({ method: "POST", url: "/api/v1/ap/deposit", payload });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already posted/);
  });

  it("records an AuditLog row on a successful create (auto middleware)", async () => {
    const fired: { action: string; entity: string; companyId: string; userId: string | null }[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: createDb(),
        auditSink: (r) => {
          fired.push(r as (typeof fired)[number]);
        },
      })
    ).inject({ method: "POST", url: "/api/v1/ap/deposit", payload });
    expect(res.statusCode).toBe(201);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.entity).toBe("/api/v1/ap/deposit");
    expect(fired[0]!.companyId).toBe(COMPANY);
    expect(fired[0]!.userId).toBe("u-0");
  });
});

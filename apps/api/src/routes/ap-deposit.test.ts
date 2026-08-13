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
  /**
   * B-313: make an insert into a table THROW (models a 23505 unique-violation on the
   * ap_deposit_idempotency_uq partial index). Receives the table and the running
   * 0-based per-table insert count, so a test can let the 1st create through and trip
   * only the replay. Return null to insert normally. (inventory.test.ts B-312 shape.)
   */
  insertThrows?: (table: unknown, nth: number) => Error | null;
  /**
   * B-313: called with the rows an insert actually RETURNED (id + createdAt stamped).
   * Lets a test derive its stored-row view from what the handler really wrote instead
   * of hand-seeding it — so a handler that writes twice really IS seen twice by the
   * later JV / register assertions (a hand-seeded array would hide the defect).
   */
  onInsert?: (table: unknown, rows: Record<string, unknown>[]) => void;
}

/** Db stub: canned rows per table (reads, incl. selectThrough joins) + write capture. */
function stubDb(opts: StubOpts): Db {
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
      // B-388 · BOTH insert doors. TenantDb.insert() returns the builder WITHOUT
      // .returning() and the caller awaits it directly, so a `.returning()`-only
      // stub records nothing for such a write and every absence assertion about
      // it is vacuous. One `record()` closure sits behind both doors — invoked
      // once per DOOR CALL, never in the `values(...)` body (which would make
      // `.returning()` double-count). insertThrows / onInsert / the per-table
      // `nth` counter are therefore threaded IDENTICALLY down both paths: a 23505
      // model and the derived stored-row view behave the same whichever door the
      // write took. Evidence at the foot of this file.
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        const record = (): { boom: Error | null; out: Record<string, unknown>[] } => {
          const nth = insertCount.get(table) ?? 0;
          insertCount.set(table, nth + 1);
          const boom = insertThrows?.(table, nth);
          // Thrown BEFORE the capture: a rejected insert wrote no row, so it must not
          // be counted as one (the "exactly one row / one JV" assertions depend on it).
          if (boom) return { boom, out: [] };
          inserted.push({ table, values });
          const arr = Array.isArray(values) ? values : [values];
          const out = arr.map((v) => {
            const row = v as Record<string, unknown>;
            return { id: row.id ?? `new-${seq++}`, createdAt: D, ...row };
          });
          onInsert?.(table, out as Record<string, unknown>[]);
          return { boom: null, out };
        };
        return {
          returning: () => {
            const { boom, out } = record();
            return boom ? Promise.reject(boom) : Promise.resolve(out);
          },
          // The awaited-directly door (plain scoped insert, no .returning()).
          then: (onOk: (r: unknown) => unknown, onErr: (e: unknown) => unknown) => {
            const { boom, out } = record();
            return boom
              ? Promise.reject(boom).then(onOk, onErr)
              : Promise.resolve(out).then(onOk, onErr);
          },
        };
      },
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

/**
 * The rendered WHERE text (quoted column names + $n placeholders). B-313 needs this,
 * not just the params: a stub that models an AND-ed column by looking for its VALUE in
 * the params filters MORE when that column is dropped from the query, so deleting the
 * anchor would make the wrong-payee test pass for the wrong reason. Reading which
 * COLUMNS the handler actually bound is what makes the stub behave like the database.
 */
function sqlOf(where: SQL | undefined): string {
  if (!where) return "";
  return new PgDialect().sqlToQuery(where).sql;
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

  // B-323: the local `newestFirst` here was a hand-rolled shadow of list-order.ts's
  // export, and it was tie-BLIND — `msOf(b) - msOf(a)` returns 0 for two deposits
  // sharing an instant, handing the pair back to the join plan. The shared helper
  // breaks the tie on id, so the list cannot reorder between two identical reads.
  it("is TOTAL when two deposits share an instant — the join plan cannot decide", async () => {
    const tied = new Date("2024-03-10T00:00:00Z");
    const a = depRow("aaa", { createdAt: tied });
    const b = depRow("bbb", { createdAt: tied });
    const ids = async (rows: unknown[]): Promise<string[]> => {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({ rows: [[apDeposits, rows], [vendors, [vendorRow]], [pos, [poRow]]] }),
        })
      ).inject({ url: "/api/v1/ap/deposit" });
      return res.json().data.map((r: { id: string }) => r.id);
    };
    expect(await ids([a, b])).toEqual(["aaa", "bbb"]);
    expect(await ids([b, a])).toEqual(["aaa", "bbb"]);
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

// ===========================================================================
// B-313 — POST /ap/deposit idempotency (client key + partial index + replay)
// ---------------------------------------------------------------------------
// WHY this is a MONEY contract, not data hygiene: createDeposit MINTS a fresh
// deposit id per request and posts a Dr 1160 / Cr 1010 JV keyed `dep:<that fresh
// id>`, so a replay produces a SECOND source_doc. jv_source_doc_uq is real and its
// predicate DOES list `dep:` (verified live — a same-source_doc insert raises
// 23505), but it can only ever see a re-post of the SAME deposit; on a replayed
// CREATE the two source_docs differ and both JVs are individually clean and
// balanced. Proven live on the un-patched build, byte-identical body posted twice:
//   201, 201 → DP-2026-0001 + DP-2026-0002, JV-2026-0419 + JV-2026-0420,
//   Σ Dr 1160 = Σ Cr 1010 = 500,000.00 for ONE intended ฿250,000 payment.
// apps/mobile/sync_processor.dart replays a create it never heard back on, so the
// LOAD-BEARING assertions below are the JV COUNT and the Σ posted to 1160/1010 — a
// row count alone would not encode this defect, and neither would a status code.
// ===========================================================================

const IDEMP_KEY = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const SECOND_KEY = "b7c8d9e0-1f2a-4b3c-8d4e-5f6a7b8c9d0e";
/** Every client key this suite sends — a read binding one of these IS a dedup resolve. */
const CLIENT_KEYS: readonly string[] = [IDEMP_KEY, SECOND_KEY];
const DEPOSIT_IDEMP_UQ = "ap_deposit_idempotency_uq";
const JV_SOURCE_DOC_UQ = "jv_source_doc_uq";

/** A second tenant + its own supplier id, for the cross-tenant replay test. */
const COMPANY_B = "33333333-3333-3333-3333-333333333333";
const VENDOR_B = "ven00000-0000-0000-0000-0000000000b0";

/**
 * A raw pg unique-violation (SQLSTATE 23505) — the DatabaseError node-postgres throws,
 * naming the violated index on `.constraint`. `null` models a 23505 naming nothing.
 */
const pgUniqueViolation = (constraint: string | null = DEPOSIT_IDEMP_UQ): Error =>
  Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint ?? "?"}"`),
    constraint === null ? { code: "23505" } : { code: "23505", constraint },
  );

/**
 * The shape the HANDLER actually sees: every insert goes through drizzle, which wraps
 * the driver error in a DrizzleQueryError and nests the DatabaseError under `.cause`.
 * isUniqueViolation() / violatedConstraint() must BOTH look one level down — a suite
 * that only ever threw the FLAT shape would stay green against a gate reading
 * `err.constraint` directly while production silently lost its replay path (B-263).
 */
const uniqueViolation = (constraint: string | null = DEPOSIT_IDEMP_UQ): Error =>
  Object.assign(new Error("Failed query"), { cause: pgUniqueViolation(constraint) });

type DepRow = typeof apDeposits.$inferSelect;

/**
 * A keyed create issues TWO kinds of ap_deposit read — the keyed dedup resolve
 * (pre-check, and again from the catch) and allocDepositNo's unkeyed running-number
 * scan. The row-blind stub would answer both the same, so this behaves like the
 * DATABASE: it applies exactly the filters the handler's WHERE actually declares,
 * decided by which COLUMNS the rendered SQL binds —
 *   - company_id: TenantDb.select always ANDs it, so a row of another company is
 *     invisible to both kinds of read;
 *   - idempotency_key: a read binding one of the suite's client keys IS the dedup
 *     resolve (everything else is allocDepositNo's running-number scan);
 *   - vendor_id: the payee anchor, applied ONLY if the handler bound it.
 * That last clause is the load-bearing one. Keying off the column NAME (not the
 * presence of its value in the params) is what makes deleting the anchor from the
 * resolver LEAK the other payee's row here, exactly as it would in Postgres — a
 * params-only model would filter MORE when the anchor is dropped and the wrong-payee
 * test would pass for the wrong reason. Verified by mutation, not by inspection.
 */
const keyedDeposits =
  (stored: () => unknown[]) =>
  (where: SQL | undefined): unknown[] => {
    const params = paramsOf(where);
    const sql = sqlOf(where);
    let rows = stored();
    if (sql.includes('"company_id"')) {
      rows = rows.filter((d) => params.includes((d as DepRow).companyId));
    }
    const key = params.find(
      (p): p is string => typeof p === "string" && CLIENT_KEYS.includes(p),
    );
    if (key === undefined) return rows; // allocDepositNo's running-number scan
    rows = rows.filter((d) => (d as DepRow).idempotencyKey === key);
    if (sql.includes('"vendor_id"')) {
      rows = rows.filter((d) => params.includes((d as DepRow).vendorId));
    }
    return rows;
  };

/** Every ap_deposit read this app made whose WHERE bound the client key. */
const keyedDepositReads = (captured: Captured[]): Captured[] =>
  captured.filter(
    (c) => c.table === apDeposits && paramsOf(c.where).includes(IDEMP_KEY),
  );

/** Σ debits posted to 1160 advance-to-supplier across EVERY jv_line insert made. */
const sumAdvanceDebits = (inserted: Inserted[]): number =>
  inserted
    .filter((i) => i.table === jvLines)
    .flatMap((i) => i.values as Record<string, unknown>[])
    .filter((l) => l.accountId === ACC_ADVANCE)
    .reduce((s, l) => s + Number(l.dr), 0);

/** Σ credits posted to 1010 cash — the leg that pays the money OUT. */
const sumCashCredits = (inserted: Inserted[]): number =>
  inserted
    .filter((i) => i.table === jvLines)
    .flatMap((i) => i.values as Record<string, unknown>[])
    .filter((l) => l.accountId === ACC_CASH)
    .reduce((s, l) => s + Number(l.cr), 0);

/**
 * The B-313 stub. The stored ap_deposit / jv views are DERIVED from what the handler
 * actually WROTE (onInsert) — never hand-seeded — so if a replay wrote a second row
 * the register and JV assertions really would see it. That is the whole point.
 * `storedDeposits` can be SHARED between two tenants, so a cross-tenant replay is
 * tested against a table that genuinely contains the other company's row.
 */
const idempWorld = (
  opts: {
    company?: string;
    supplier?: unknown;
    captured?: Captured[];
    inserted?: Inserted[];
    insertThrows?: (table: unknown, nth: number) => Error | null;
    /** Overrides the keyed ap_deposit resolve (models a race). */
    keyedResolve?: (where: SQL | undefined) => unknown[];
    storedDeposits?: unknown[];
  } = {},
) => {
  const company = opts.company ?? COMPANY;
  const storedDeposits: unknown[] = opts.storedDeposits ?? [];
  const storedJvs: unknown[] = [jvSeed];
  const db = stubDb({
    rows: [
      [users, [{ ...userRow, companyId: company }]],
      [roles, [{ ...roleRow(true), companyId: company }]],
      [vendors, [opts.supplier ?? vendorRow]],
      [pos, [poRow]],
      [glAccounts, COA_ROWS],
      [jvs, () => storedJvs],
      [apDeposits, opts.keyedResolve ?? keyedDeposits(() => storedDeposits)],
    ],
    captured: opts.captured,
    inserted: opts.inserted,
    insertThrows: opts.insertThrows,
    onInsert: (table, out) => {
      if (table === apDeposits) storedDeposits.push(...out);
      else if (table === jvs) storedJvs.push(...out);
    },
  });
  return { db, storedDeposits, storedJvs };
};

const AMOUNT = 250_000;
const depositPost = (extra: Record<string, unknown> = {}, payee = VENDOR0) => ({
  method: "POST" as const,
  url: "/api/v1/ap/deposit",
  payload: {
    vendor_id: payee,
    po_id: PO0,
    amount: AMOUNT,
    pct: 10,
    reason: "มัดจำ PO 10%",
    ...extra,
  },
});

describe("POST /api/v1/ap/deposit — B-313 idempotency (client key + replay)", () => {
  it("same idempotency_key twice → ONE deposit, ONE JV (Σ Dr 1160 = 250,000, not 500,000) and cash credited ONCE", async () => {
    const inserted: Inserted[] = [];
    const world = idempWorld({ inserted });
    const app1 = await buildTestApp({ resolveTenant: async () => SESSION, db: world.db });

    const res1 = await app1.inject(depositPost({ idempotency_key: IDEMP_KEY }));
    const res2 = await app1.inject(depositPost({ idempotency_key: IDEMP_KEY }));

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);

    // THE MONEY ASSERTIONS FIRST (they are the point), inspecting what was WRITTEN.
    // Without the dedup there are TWO clean balanced JVs — each individually
    // well-formed, so no downstream double-entry guard can see the duplication —
    // and the company's cash is credited twice for one disbursement.
    expect(inserted.filter((i) => i.table === jvs)).toHaveLength(1);
    expect(sumAdvanceDebits(inserted)).toBe(AMOUNT);
    expect(sumAdvanceDebits(inserted)).not.toBe(2 * AMOUNT);
    expect(sumCashCredits(inserted)).toBe(AMOUNT);
    expect(sumCashCredits(inserted)).not.toBe(2 * AMOUNT);

    // ONE deposit row across BOTH requests, carrying the client key, and the JV
    // posted from the STORED amount (money=SERVER) against that ONE row.
    const depIns = inserted.filter((i) => i.table === apDeposits);
    expect(depIns).toHaveLength(1);
    const stored = depIns[0]!.values as Record<string, unknown>;
    expect(stored.idempotencyKey).toBe(IDEMP_KEY);
    expect(stored.amount).toBe("250000.00");
    expect(world.storedDeposits).toHaveLength(1);
    const jvIns = inserted.find((i) => i.table === jvs)!.values as Record<string, unknown>;
    expect(jvIns.sourceDoc).toBe(`dep:${stored.id}`);

    // The replay is idempotent — the client sees its OWN deposit (same id, same
    // server-allocated `no`, same joined name/ref), never a 409, never a duplicate.
    // Byte-identical BY CONSTRUCTION (one serializer, one ref resolver, one sender).
    expect(res2.json()).toEqual(res1.json());
    expect(res2.json().id).toBe(res1.json().id);
    expect(res2.json().no).toBe(res1.json().no);
    expect(res2.json().amount).toBe(AMOUNT);
    expect(res2.json().balance).toBe(AMOUNT);
    expect(res2.json().ref).toBe(`PO-${YEAR}-0291`);
  });

  it("the SAME key against a DIFFERENT payee is a 409 — it never hands back the first one's deposit", async () => {
    // A key reused against another payee must not confirm a payment that party never
    // received (and hide the one actually made). The resolver AND-binds the payee id,
    // so the pre-check misses, the insert trips the GLOBAL partial index, and the
    // catch re-resolves — finds nothing for THIS payee — and answers the honest 409.
    const inserted: Inserted[] = [];
    const otherPayee = { ...vendorRow, id: VENDOR_B, name: "บจก. อีกเจ้า" };
    const storedDeposits: unknown[] = [];
    const storedJvs: unknown[] = [jvSeed];
    const db = stubDb({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(true)]],
        // Both payees resolvable in this tenant (the 400 gate must not be what fires).
        [vendors, (w) => (paramsOf(w).includes(VENDOR_B) ? [otherPayee] : [vendorRow])],
        [pos, [poRow]],
        [glAccounts, COA_ROWS],
        [jvs, () => storedJvs],
        [apDeposits, keyedDeposits(() => storedDeposits)],
      ],
      inserted,
      onInsert: (table, out) => {
        if (table === apDeposits) storedDeposits.push(...out);
        else if (table === jvs) storedJvs.push(...out);
      },
      insertThrows: (table, nth) =>
        table === apDeposits && nth >= 1 ? uniqueViolation() : null,
    });
    const app1 = await buildTestApp({ resolveTenant: async () => SESSION, db });

    const res1 = await app1.inject(depositPost({ idempotency_key: IDEMP_KEY }));
    const res2 = await app1.inject(depositPost({ idempotency_key: IDEMP_KEY }, VENDOR_B));

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(409);
    expect(res2.json().message).toBe("idempotency_key already used");
    // NOT the first document, under any field.
    expect(res2.json().id).toBeUndefined();
    expect(JSON.stringify(res2.json())).not.toContain(res1.json().id);
    expect(JSON.stringify(res2.json())).not.toContain(VENDOR0);
    // And no money moved for the refused request.
    expect(inserted.filter((i) => i.table === apDeposits)).toHaveLength(1);
    expect(inserted.filter((i) => i.table === jvs)).toHaveLength(1);
    expect(sumCashCredits(inserted)).toBe(AMOUNT);
  });

  it("company B replaying company A's key gets NOTHING of A's — 409, and A's deposit is untouched", async () => {
    // ap_deposit_idempotency_uq is a GLOBAL partial index on the key alone, so a
    // cross-tenant key clash is physically possible. The resolver is tenant-scoped
    // (db.select AND-binds company_id), so B's pre-check and B's catch both resolve
    // nothing — B gets an honest 409, never a window into A's ledger.
    const insertedA: Inserted[] = [];
    const insertedB: Inserted[] = [];
    const shared: unknown[] = []; // ONE ap_deposit table both tenants read
    const worldA = idempWorld({ inserted: insertedA, storedDeposits: shared });
    const appA = await buildTestApp({ resolveTenant: async () => SESSION, db: worldA.db });
    const resA = await appA.inject(depositPost({ idempotency_key: IDEMP_KEY }));
    expect(resA.statusCode).toBe(201);
    await appA.close();

    const worldB = idempWorld({
      company: COMPANY_B,
      supplier: { ...vendorRow, id: VENDOR_B, companyId: COMPANY_B },
      inserted: insertedB,
      storedDeposits: shared,
      // The GLOBAL index sees A's row even though B's tenant-scoped reads cannot.
      insertThrows: (table) => (table === apDeposits ? uniqueViolation() : null),
    });
    const appB = await buildTestApp({
      resolveTenant: async () => ({ ...SESSION, companyId: COMPANY_B }),
      db: worldB.db,
    });
    const resB = await appB.inject(depositPost({ idempotency_key: IDEMP_KEY }, VENDOR_B));

    expect(resB.statusCode).toBe(409);
    expect(resB.json().message).toBe("idempotency_key already used");
    expect(JSON.stringify(resB.json())).not.toContain(resA.json().id);
    expect(JSON.stringify(resB.json())).not.toContain(String(resA.json().no));
    // A's row is the ONLY row, and B posted no JV at all.
    expect(shared).toHaveLength(1);
    expect((shared[0] as DepRow).companyId).toBe(COMPANY);
    expect(insertedB.filter((i) => i.table === jvs)).toHaveLength(0);
    expect(sumCashCredits(insertedB)).toBe(0);
  });

  it("a fresh write with NO key still creates (the web form is unchanged)", async () => {
    const inserted: Inserted[] = [];
    const world = idempWorld({ inserted });
    const app1 = await buildTestApp({ resolveTenant: async () => SESSION, db: world.db });

    const res1 = await app1.inject(depositPost());
    const res2 = await app1.inject(depositPost());

    // Two key-less posts are two DISTINCT deposits — the partial index exempts nulls
    // and no dedup path fires, so this contract is unchanged by B-313.
    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(res2.json().id).not.toBe(res1.json().id);
    expect(inserted.filter((i) => i.table === apDeposits)).toHaveLength(2);
    const first = inserted.find((i) => i.table === apDeposits)!.values as Record<string, unknown>;
    expect(first.idempotencyKey ?? null).toBeNull();
    expect(sumCashCredits(inserted)).toBe(2 * AMOUNT);
  });

  it("a DIFFERENT key creates a second deposit (dedup is per-key, not per-payee)", async () => {
    const inserted: Inserted[] = [];
    const world = idempWorld({ inserted });
    const app1 = await buildTestApp({ resolveTenant: async () => SESSION, db: world.db });

    const res1 = await app1.inject(depositPost({ idempotency_key: IDEMP_KEY }));
    const res2 = await app1.inject(depositPost({ idempotency_key: SECOND_KEY }));

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(res2.json().id).not.toBe(res1.json().id);
    expect(world.storedDeposits).toHaveLength(2);
    expect(inserted.filter((i) => i.table === jvs)).toHaveLength(2);
    // Two genuine instalments to one payee for the same amount = ordinary business,
    // and exactly why a natural key on (company, payee, po, amount) is wrong here.
    expect(sumCashCredits(inserted)).toBe(2 * AMOUNT);
  });

  it("a PRESENT but NON-STRING idempotency_key is a 400 and writes NOTHING (B-309 contract)", async () => {
    for (const bad of [123, 1.5, true, ["k"], { key: "k" }]) {
      const inserted: Inserted[] = [];
      const world = idempWorld({ inserted });
      const appN = await buildTestApp({ resolveTenant: async () => SESSION, db: world.db });
      const res = await appN.inject(depositPost({ idempotency_key: bad }));
      expect(res.statusCode, `${JSON.stringify(bad)} → 400`).toBe(400);
      expect(res.json().code).toBe("VALIDATION");
      // The whole point of B-309: silence here means the request takes the NO-KEY path
      // and double-posts while the client believes it sent a key.
      expect(inserted, `${JSON.stringify(bad)} wrote nothing`).toHaveLength(0);
      await appN.close();
    }
  });

  it("an EXPLICIT null key is ABSENT, not invalid — it still creates", async () => {
    const world = idempWorld({});
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: world.db })
    ).inject(depositPost({ idempotency_key: null }));
    expect(res.statusCode).toBe(201);
  });

  it("the 23505 backstop still fires when the PRE-CHECK misses (the real race) → 201 with the ORIGINAL, still one deposit / one JV", async () => {
    const inserted: Inserted[] = [];
    const captured: Captured[] = [];
    // The real race: the pre-checks of BOTH requests run before the original is
    // visible (keyed reads 0 and 1 resolve nothing); our insert then trips the partial
    // unique index, and read 2 — issued from the catch, after that commit — finds it.
    // Exactly the window an app-level pre-check cannot close, which is why the catch
    // is kept (money-post-idempotency lesson).
    let keyedReadNo = 0;
    const stored: unknown[] = [];
    const faithful = keyedDeposits(() => stored);
    const world = idempWorld({
      inserted,
      captured,
      storedDeposits: stored,
      keyedResolve: (where) => {
        const isKeyed = paramsOf(where).some(
          (p) => typeof p === "string" && CLIENT_KEYS.includes(p),
        );
        if (!isKeyed) return faithful(where);
        return keyedReadNo++ < 2 ? [] : faithful(where);
      },
      insertThrows: (table, nth) =>
        table === apDeposits && nth >= 1 ? uniqueViolation() : null,
    });
    const app1 = await buildTestApp({ resolveTenant: async () => SESSION, db: world.db });

    const res1 = await app1.inject(depositPost({ idempotency_key: IDEMP_KEY }));
    const res2 = await app1.inject(depositPost({ idempotency_key: IDEMP_KEY }));

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(res2.json()).toEqual(res1.json()); // the ORIGINAL, from the same sender
    // STRUCTURAL replay-safety: the ap_deposit row is the FIRST write in the tx, so
    // the 23505 aborts the block before the JV header or either leg is attempted — the
    // replay needs no compensating action. Nothing after the deposit ran on request 2.
    expect(inserted.filter((i) => i.table === apDeposits)).toHaveLength(1);
    expect(inserted.filter((i) => i.table === jvs)).toHaveLength(1);
    expect(sumAdvanceDebits(inserted)).toBe(AMOUNT);
    expect(sumCashCredits(inserted)).toBe(AMOUNT);
    // 3 keyed resolves: create#1's pre-check, create#2's pre-check (missed), the catch.
    expect(keyedDepositReads(captured)).toHaveLength(3);
  });

  it("a 23505 naming a DIFFERENT index (jv_source_doc_uq) is the honest 'already posted' 409 — never the replay path (B-263 name gate)", async () => {
    // 23505 alone only says "SOME unique constraint", and this table now has two
    // reachable ones. Without the BY-NAME gate a source_doc collision would be
    // answered with somebody's stored deposit instead of the honest conflict.
    const inserted: Inserted[] = [];
    const world = idempWorld({
      inserted,
      insertThrows: (table) => (table === jvs ? uniqueViolation(JV_SOURCE_DOC_UQ) : null),
    });
    const app1 = await buildTestApp({ resolveTenant: async () => SESSION, db: world.db });

    const res = await app1.inject(depositPost({ idempotency_key: IDEMP_KEY }));

    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already posted/);
    expect(res.json().message).not.toMatch(/idempotency_key already used/);
  });

  it("a flat 23505 with NO constraint name falls through to the honest 409 — never a double post, never a wrong document", async () => {
    const inserted: Inserted[] = [];
    const world = idempWorld({
      inserted,
      insertThrows: (table, nth) =>
        table === apDeposits && nth >= 1 ? uniqueViolation(null) : null,
    });
    const app1 = await buildTestApp({ resolveTenant: async () => SESSION, db: world.db });

    const res1 = await app1.inject(depositPost({ idempotency_key: IDEMP_KEY }));
    // A DIFFERENT key, so the pre-check cannot resolve it — only the catch decides.
    const res2 = await app1.inject(depositPost({ idempotency_key: SECOND_KEY }));

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(409);
    expect(res2.json().message).toMatch(/already posted/);
    // The safe direction: no replay convenience, but no second JV either.
    expect(inserted.filter((i) => i.table === jvs)).toHaveLength(1);
    expect(sumCashCredits(inserted)).toBe(AMOUNT);
  });

  it("the replay is answered BEFORE the COA gate — a deposit already paid is never 409'd because an account was removed afterwards", async () => {
    // B-264 class: sync_processor.dart dead-letters every 4xx PERMANENTLY. The
    // original could only have posted with 1160 + 1010 present, but the COA is
    // editable; if one is removed afterwards, a replay must still return the original
    // rather than fail for cash that has already left the company. This pins the
    // pre-check's position above the COA resolution.
    const inserted: Inserted[] = [];
    const stored: unknown[] = [];
    let coa = COA_ROWS;
    const storedJvs: unknown[] = [jvSeed];
    const db = stubDb({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(true)]],
        [vendors, [vendorRow]],
        [pos, [poRow]],
        [glAccounts, () => coa],
        [jvs, () => storedJvs],
        [apDeposits, keyedDeposits(() => stored)],
      ],
      inserted,
      onInsert: (table, out) => {
        if (table === apDeposits) stored.push(...out);
        else if (table === jvs) storedJvs.push(...out);
      },
    });
    const app1 = await buildTestApp({ resolveTenant: async () => SESSION, db });

    const res1 = await app1.inject(depositPost({ idempotency_key: IDEMP_KEY }));
    coa = [COA_ROWS[0]!]; // 1010 cash removed after the original posted
    const res2 = await app1.inject(depositPost({ idempotency_key: IDEMP_KEY }));

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(res2.statusCode).not.toBe(409);
    expect(res2.json()).toEqual(res1.json());
    expect(inserted.filter((i) => i.table === jvs)).toHaveLength(1);
  });

  it("a foreign payee is a 400 REGARDLESS of the key — a replay against something not ours is never answered from our data", async () => {
    const inserted: Inserted[] = [];
    const stored: unknown[] = [];
    const storedJvs: unknown[] = [jvSeed];
    const db = stubDb({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(true)]],
        // Only VENDOR0 belongs to this tenant; anything else resolves to nothing.
        [vendors, (w) => (paramsOf(w).includes(VENDOR0) ? [vendorRow] : [])],
        [pos, [poRow]],
        [glAccounts, COA_ROWS],
        [jvs, () => storedJvs],
        [apDeposits, keyedDeposits(() => stored)],
      ],
      inserted,
      onInsert: (table, out) => {
        if (table === apDeposits) stored.push(...out);
        else if (table === jvs) storedJvs.push(...out);
      },
    });
    const app1 = await buildTestApp({ resolveTenant: async () => SESSION, db });
    await app1.inject(depositPost({ idempotency_key: IDEMP_KEY }));

    const res = await app1.inject(
      depositPost({ idempotency_key: IDEMP_KEY }, "ven00000-0000-0000-0000-00000000ffff"),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/not found in this tenant/);
    expect(inserted.filter((i) => i.table === apDeposits)).toHaveLength(1);
  });
});

// ===========================================================================
// B-318 / B-168 — DOC-NUMBER ALLOCATION UNDER CONCURRENCY (migration 0061)
// ===========================================================================
// THE DEFECT, observed live on a real PG 16 before 0061: six concurrent, genuinely
// DISTINCT POST /ap/deposit minted DP-2026-0001 ×3 · DP-2026-0002 ×2 and shared JV
// numbers too (JV-2026-0419 ×2). allocDepositNo / allocJvNo are `max(suffix)+1`
// reads with no index behind them, so concurrent readers all see the same max. This
// SURVIVES the B-313 idempotency key: a key dedupes REPLAYS of one request, while
// this is two different payments colliding on a voucher number.
//
// AND THE INDEX ALONE IS A REGRESSION, also measured: with 0061 applied and no
// retry, four of six legitimate deposits came back 409 "already posted" — false,
// nothing was posted — and sync_processor.dart dead-letters every 4xx PERMANENTLY.
// So these tests are about the RETRY, not the index.
//
// WHAT THESE TESTS CAN PROVE. The stub has no unique index and no rollback, so it
// cannot prove uniqueness or atomicity; those are proven against a live PG 16 with
// a negative control. What it CAN prove — and what would otherwise ship untested —
// is the handler's branch wiring: that the collision is retried with a FRESH
// number, that exhaustion answers 503 rather than the bare 409 sitting right below
// it in the same catch, and that the B-313 replay is still NOT retried.
const DEPOSIT_COMPANY_NO_UQ = "ap_deposit_company_no_uq";
const JV_COMPANY_NO_UQ = "jv_company_no_uq";

describe("POST /api/v1/ap/deposit — B-318 doc-number collision", () => {
  it("a colliding deposit number is RETRIED with a freshly allocated one, not refused", async () => {
    const inserted: Inserted[] = [];
    // The racer that beat us COMMITTED DP-<yr>-0001 between our read and our write.
    // Modelled honestly: the row is visible to the next allocDepositNo read (that is
    // what makes the retry pick a different number) and our insert trips 0061.
    const storedDeposits: unknown[] = [];
    const year = new Date().getFullYear();
    const world = idempWorld({
      inserted,
      storedDeposits,
      insertThrows: (table, nth) => {
        if (table === apDeposits && nth === 0) {
          storedDeposits.push({
            id: "racer",
            companyId: COMPANY,
            no: `DP-${year}-0001`,
            vendorId: VENDOR0,
            idempotencyKey: null,
          });
          return uniqueViolation(DEPOSIT_COMPANY_NO_UQ);
        }
        return null;
      },
    });
    const app1 = await buildTestApp({ resolveTenant: async () => SESSION, db: world.db });
    const res = await app1.inject(depositPost());

    // The payment goes through — this is the whole point. Before the retry existed,
    // the index turned this into a 409 for a deposit that was never posted.
    expect(res.statusCode).toBe(201);
    // …under a DIFFERENT number: 0001 is the racer's, we must not re-offer it.
    expect(res.json().no).toBe(`DP-${year}-0002`);
    // The money still posts exactly once and still balances.
    expect(sumAdvanceDebits(inserted)).toBe(AMOUNT);
    expect(sumCashCredits(inserted)).toBe(AMOUNT);
    expect(inserted.filter((i) => i.table === jvs)).toHaveLength(1);
  });

  it("a colliding JV number is retried too — the deposit tx writes TWO numbered rows", async () => {
    const inserted: Inserted[] = [];
    const storedDeposits: unknown[] = [];
    const world = idempWorld({
      inserted,
      storedDeposits,
      insertThrows: (table, nth) => {
        if (table === jvs && nth === 0) {
          // The racer committed our JV number. Its deposit row is NOT ours, so it
          // does not advance our deposit sequence — only the JV sequence moves.
          world.storedJvs.push({ id: "racer-jv", companyId: COMPANY, no: `JV-${year2()}-0002` });
          // Model the ROLLBACK the fake transaction does not do: our own ap_deposit
          // insert, which ran first inside this tx, never survives a failed tx. Left
          // in place it would fake-advance the deposit sequence and the assertion
          // below would pass for the wrong reason.
          storedDeposits.pop();
          return uniqueViolation(JV_COMPANY_NO_UQ);
        }
        return null;
      },
    });
    const app1 = await buildTestApp({ resolveTenant: async () => SESSION, db: world.db });
    const res = await app1.inject(depositPost());

    expect(res.statusCode).toBe(201);
    // The deposit number is unchanged (nothing took it); the JV number moved past
    // the racer's. Both are re-allocated on the retry — the deposit just re-reads
    // the same free number, which is the correct outcome, not a stale carry-over.
    expect(res.json().no).toBe(`DP-${year2()}-0001`);
    const jvIns = inserted.filter((i) => i.table === jvs);
    expect(jvIns).toHaveLength(1); // only the winning attempt wrote
    expect((jvIns[0]!.values as Record<string, unknown>).no).toBe(`JV-${year2()}-0003`);
    expect(sumCashCredits(inserted)).toBe(AMOUNT); // cash still leaves exactly once
  });

  it("exhaustion answers 503 RETRY — NOT the bare 409 'already posted' in the same catch", async () => {
    // The regression this guards is precise: the catch arm below the new one reads
    // `if (isUniqueViolation(err)) return conflict(..., 'already posted')`. If
    // exhaustion re-threw the raw 23505, a real vendor payment would be refused with
    // a message claiming it was already made, and mobile would dead-letter it.
    const inserted: Inserted[] = [];
    const storedDeposits: unknown[] = [];
    const world = idempWorld({
      inserted,
      storedDeposits,
      insertThrows: (table) =>
        table === apDeposits ? uniqueViolation(DEPOSIT_COMPANY_NO_UQ) : null,
    });
    const app1 = await buildTestApp({ resolveTenant: async () => SESSION, db: world.db });
    const res = await app1.inject(depositPost());

    expect(res.statusCode).toBe(503);
    expect(res.statusCode).toBeGreaterThanOrEqual(500); // 5xx = mobile defers, 4xx = dead-letters
    const body = res.json();
    expect(body.code).toBe("RETRY");
    expect(body.message).not.toMatch(/already/i);
    // Nothing was posted: no JV, no cash movement.
    expect(inserted.filter((i) => i.table === jvs)).toHaveLength(0);
    expect(sumCashCredits(inserted)).toBe(0);
  });

  it("a B-313 idempotency 23505 is still NOT retried — ONE attempt, then the replay resolves", async () => {
    // The name gate is load-bearing in BOTH directions. Retrying a replay would
    // re-attempt a write that has already succeeded, ten times, before answering —
    // and each attempt would burn a deposit number. This is the same real-race setup
    // as the B-313 backstop test above, with the attempt COUNT asserted.
    const inserted: Inserted[] = [];
    let keyedReadNo = 0;
    let depositAttempts = 0;
    const stored: unknown[] = [];
    const faithful = keyedDeposits(() => stored);
    const world = idempWorld({
      inserted,
      storedDeposits: stored,
      keyedResolve: (where) => {
        const isKeyed = paramsOf(where).some(
          (p) => typeof p === "string" && CLIENT_KEYS.includes(p),
        );
        if (!isKeyed) return faithful(where);
        return keyedReadNo++ < 2 ? [] : faithful(where);
      },
      insertThrows: (table, nth) => {
        if (table !== apDeposits) return null;
        depositAttempts += 1;
        return nth >= 1 ? uniqueViolation(DEPOSIT_IDEMP_UQ) : null;
      },
    });
    const app1 = await buildTestApp({ resolveTenant: async () => SESSION, db: world.db });
    const res1 = await app1.inject(depositPost({ idempotency_key: IDEMP_KEY }));
    const res2 = await app1.inject(depositPost({ idempotency_key: IDEMP_KEY }));

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    expect(res2.json()).toEqual(res1.json()); // the ORIGINAL, not a re-attempt
    // 2 = the original write + the ONE racing attempt. A retried replay would be 11.
    expect(depositAttempts).toBe(2);
    expect(stored).toHaveLength(1);
    expect(sumCashCredits(inserted)).toBe(AMOUNT); // cash left exactly once
  });
});

/** The CE year allocDepositNo / allocJvNo stamp (they read the wall clock). */
function year2(): number {
  return new Date().getFullYear();
}

// ===========================================================================
// B-388 · SINGLE-RECORDING EVIDENCE for the both-doors insert stub.
//
// Converting a `.returning()`-only stub is behaviourally INERT in this file —
// nothing this route does today writes through the bare TenantDb.insert() door,
// so no assertion above changed verdict when this landed and a green suite is
// NOT evidence the conversion is right. The defect a conversion can introduce is
// a DOUBLE-count (the recording closure invoked on the way in as well as per
// door), a door that records somewhere else, or — the one that matters most in
// THIS file — a throw/callback that fires on one path and not the other. None of
// those is visible to stub-insert-door.enforce.test.ts, which proves a `then`
// KEY EXISTS, not that it records correctly. So it is asserted here, directly.
// ===========================================================================
describe("B-388 · stubDb's two insert doors record identically, once each", () => {
  interface Door {
    values: (
      v: Record<string, unknown> | Record<string, unknown>[],
    ) => PromiseLike<Record<string, unknown>[]> & {
      returning: () => Promise<Record<string, unknown>[]>;
    };
  }
  const doorOf = (db: Db, table: unknown): Door =>
    (db as unknown as { insert: (t: unknown) => Door }).insert(table);

  it("records exactly +1 per write and resolves identically, through EITHER door", async () => {
    const inserted: Inserted[] = [];
    const db = stubDb({ rows: [], inserted });

    expect(inserted).toHaveLength(0);
    // The awaited-directly door (what the plain scoped TenantDb.insert() hits).
    const bare = await doorOf(db, apDeposits).values({ no: "bare" });
    expect(inserted).toHaveLength(1);
    // The .returning() door (insertThrough / insert(...).returning()).
    const ret = await doorOf(db, apDeposits).values({ no: "ret" }).returning();
    expect(inserted).toHaveLength(2);

    expect(inserted).toEqual([
      { table: apDeposits, values: { no: "bare" } },
      { table: apDeposits, values: { no: "ret" } },
    ]);
    // The ids prove `seq` advanced exactly ONCE per write — no door double-recorded.
    expect(bare).toEqual([{ id: "new-0", createdAt: D, no: "bare" }]);
    expect(ret).toEqual([{ id: "new-1", createdAt: D, no: "ret" }]);
  });

  it("advances the per-table `nth` ONCE per door call, whichever door is used", async () => {
    // The counter is what lets a test trip only the REPLAY (nth === 1). If the
    // bare door skipped it, or ticked it twice, an idempotency test keyed on nth
    // would silently arm on the wrong write.
    const nths: number[] = [];
    const inserted: Inserted[] = [];
    const db = stubDb({
      rows: [],
      inserted,
      insertThrows: (_t, nth) => {
        nths.push(nth);
        return null;
      },
    });

    await doorOf(db, apDeposits).values({ no: "a" });                 // bare
    await doorOf(db, apDeposits).values({ no: "b" }).returning();     // returning
    await doorOf(db, apDeposits).values({ no: "c" });                 // bare

    expect(nths).toEqual([0, 1, 2]);
    expect(inserted).toHaveLength(3);
  });

  it("models a 23505 identically: EITHER door rejects, and a rejected write records nothing", async () => {
    const boom = new Error("duplicate key value violates unique constraint");
    const inserted: Inserted[] = [];
    const onInsertRows: Record<string, unknown>[][] = [];
    const db = stubDb({
      rows: [],
      inserted,
      insertThrows: () => boom,
      onInsert: (_t, r) => onInsertRows.push(r),
    });

    // Promise.resolve() adopts the thenable with exactly ONE `then` call, so this
    // measures the door and not the assertion helper.
    await expect(Promise.resolve(doorOf(db, apDeposits).values({ no: "x" }))).rejects.toBe(boom);
    await expect(doorOf(db, apDeposits).values({ no: "y" }).returning()).rejects.toBe(boom);

    // The throw happens BEFORE the capture on both paths: no phantom row, and no
    // onInsert for a write that never landed.
    expect(inserted).toHaveLength(0);
    expect(onInsertRows).toHaveLength(0);
  });

  it("fires onInsert once per door call, with the same stamped rows from either door", async () => {
    const onInsertRows: Record<string, unknown>[][] = [];
    const db = stubDb({ rows: [], onInsert: (_t, r) => onInsertRows.push(r) });

    const bare = await doorOf(db, apDeposits).values({ no: "a" });
    expect(onInsertRows).toHaveLength(1);
    const ret = await doorOf(db, apDeposits).values({ no: "b" }).returning();
    expect(onInsertRows).toHaveLength(2);

    // onInsert sees exactly what the door resolved to — the derived stored-row
    // view a replay test reads back is therefore the same whichever door wrote.
    expect(onInsertRows[0]).toEqual(bare);
    expect(onInsertRows[1]).toEqual(ret);
  });
});

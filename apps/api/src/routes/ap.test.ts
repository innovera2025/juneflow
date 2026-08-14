// G3 unit tests (PLAN.md §9) — AP handlers (P2-BE-18 part 2, Wave-2 finance).
// Covers GET /ap/billing (vendor + po/wo ref joins, WHT/retention, honest-null
// doc-number + aging, tenant scope), POST /ap/billing (vendor + FK fail-closed
// verification, WHT via @juneflow/tax-engine.calcWht when omitted vs explicit),
// GET /ap/pv (payee via billing→vendor, WHT derived through calcWht, cheque
// fields), POST /ap/pv (net = gross − WHT − retention with the calcWht leg,
// pending on create, billing tenant-scope), and POST /pv/{id}/approve — the PV
// approval ladder (finance-approve perm + the 500K/2M approvalLevel tiers, the
// seeded Finance Manager level, non-pending 409, fail-closed 403/404). Every
// expected value comes from the stub / the real tax-engine — not hand-computed
// against the impl.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  apBillings,
  grs,
  pos,
  pvs,
  roles,
  users,
  vendors,
  wos,
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
interface Inserted {
  table: unknown;
  values: Record<string, unknown>;
}
interface Updated {
  table: unknown;
  set: Record<string, unknown>;
  where: SQL;
}
/**
 * B-398 — one ORDERED log of every DB call, with the two facts the atomicity
 * assertions need and the `captured` / `inserted` / `updated` arrays cannot carry:
 * whether the call was issued through the TRANSACTION handle, and whether the read
 * chain appended `.for("update")` (the row lock). It is a SEPARATE log on purpose —
 * adding these fields to `Inserted` would break the exact `toEqual` at the foot of
 * this file, which is a real assertion about the insert doors.
 */
interface Call {
  kind: "read" | "insert" | "update";
  table: unknown;
  inTx: boolean;
  forUpdate: boolean;
}
interface StubOpts {
  /**
   * Canned rows per table. The function form receives the WHERE the caller built,
   * so a fixture can answer the request that was actually made instead of handing
   * back every row it holds (B-398 needs one fixture to serve both a covered and an
   * uncovered request — see `billingsByRequest`).
   */
  rows: Array<[unknown, unknown[] | ((where: SQL | undefined) => unknown[])]>;
  captured?: Captured[];
  inserted?: Inserted[];
  updated?: Updated[];
  calls?: Call[];
  updateBase?: Record<string, unknown>;
}

/** Db stub: canned rows per table (reads, incl. selectThrough joins) + write capture. */
function stubDb(opts: StubOpts): Db {
  const {
    rows,
    captured = [],
    inserted = [],
    updated = [],
    calls = [],
    updateBase = {},
  } = opts;
  const rowsFor = (table: unknown, where: SQL | undefined): unknown[] => {
    for (const [t, r] of rows) if (t === table) return typeof r === "function" ? r(where) : r;
    return [];
  };
  // B-398: set while the transaction door is running its callback, so every call
  // the block issues records `inTx: true`. The stub has no real BEGIN/COMMIT and
  // cannot model a row lock — it models the SHAPE so the handler runs, and lets a
  // test pin WHERE each call sits relative to the tx and the lock.
  let inTx = false;
  const builderFor = (table: unknown) => {
    let pendingWhere: SQL | undefined;
    let awaited = false;
    let forUpdate = false;
    const builder = {
      $dynamic: () => builder,
      innerJoin: () => builder,
      where: (where: SQL) => {
        captured.push({ table, where });
        pendingWhere = where;
        awaited = true;
        // The chain may END here (plain select) or CONTINUE — selectForUpdate
        // appends `.orderBy(id).for("update")`. Returning a builder that is ALSO a
        // thenable serves both without the call sites having to know which.
        return builder;
      },
      orderBy: () => builder,
      for: () => {
        forUpdate = true;
        return builder;
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) => {
        if (!awaited) captured.push({ table, where: undefined });
        calls.push({ kind: "read", table, inTx, forUpdate });
        return Promise.resolve(rowsFor(table, pendingWhere)).then(onOk, onErr);
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
      // `.returning()` double-count). Evidence at the foot of this file.
      values: (values: Record<string, unknown>) => {
        const record = (): Record<string, unknown>[] => {
          inserted.push({ table, values });
          calls.push({ kind: "insert", table, inTx, forUpdate: false });
          return [{ id: `new-${seq++}`, createdAt: D, ...values }];
        };
        return {
          returning: () => Promise.resolve(record()),
          // The awaited-directly door (plain scoped insert, no .returning()).
          then: (onOk: (r: unknown) => unknown, onErr: (e: unknown) => unknown) =>
            Promise.resolve(record()).then(onOk, onErr),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: () => {
            updated.push({ table, set, where });
            calls.push({ kind: "update", table, inTx, forUpdate: false });
            return Promise.resolve([{ ...updateBase, ...set }]);
          },
        }),
      }),
    }),
  };
  // B-097 / B-398: the transaction door runs its callback against this SAME stub,
  // so writes inside a tx still capture (the fake has no real BEGIN/COMMIT — it
  // proves the door threads one scoped handle, and a throw rejects the block). The
  // `inTx` flag it raises is what lets a test assert a call sits INSIDE the block.
  raw.transaction = async (cb: (tx: unknown) => unknown) => {
    inTx = true;
    try {
      return await cb(raw);
    } finally {
      inTx = false;
    }
  };
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
const VENDOR = "aaaa1111-0000-0000-0000-0000000000a1";
const PO0 = "po000000-0000-0000-0000-0000000000p0";
const WO0 = "wo000000-0000-0000-0000-0000000000w0";
const GR0 = "gr000000-0000-0000-0000-0000000000g0";
const AP0 = "ap000000-0000-0000-0000-0000000000a0";
const AP1 = "ap000000-0000-0000-0000-0000000000a1";
const PV0 = "pv000000-0000-0000-0000-0000000000v0";

const vendorRow = {
  id: VENDOR,
  companyId: COMPANY,
  name: "บจก. ซีแพค คอนกรีต",
  code: "V-0012",
  taxId: "0105545012345",
  kind: "supplier",
  creditTerm: 30,
  addr: null,
  bank: null,
  status: "active",
  createdAt: D,
  updatedAt: D,
};
const poRow = {
  id: PO0,
  prId: "pr-0",
  vendorId: VENDOR,
  no: "PO-2026-0291",
  total: "920000.00",
  vat: "0",
  currencyCode: "THB",
  creditTerm: 30,
  status: "approved",
  approvalStep: 1,
  createdAt: D,
  updatedAt: D,
};
const woRow = {
  id: WO0,
  prId: "pr-0",
  vendorId: VENDOR,
  contractId: null,
  no: "WO-2026-0117",
  value: "645000.00",
  currencyCode: "THB",
  retentionPct: "10.000",
  status: "pending",
  approvalStep: 0,
  createdAt: D,
  updatedAt: D,
};
const grRow = {
  id: GR0,
  poId: PO0,
  woId: null,
  no: "GR-2026-0455",
  received: "0",
  rejected: "0",
  photos: [],
  status: "received",
  createdAt: D,
  updatedAt: D,
};
const apBilling = (
  id: string,
  extra: Partial<typeof apBillings.$inferSelect> = {},
): typeof apBillings.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    poId: PO0,
    grId: GR0,
    woId: null,
    vendorId: VENDOR,
    invoiceNo: "INV-CPC-118",
    dueDate: null,
    amount: "920000.00",
    vat: "60187.00",
    wht: "27600.00",
    retention: null,
    currencyCode: "THB",
    status: "approved",
    kind: "deposit",
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof apBillings.$inferSelect;

const pvRow = (
  id: string,
  extra: Partial<typeof pvs.$inferSelect> = {},
): typeof pvs.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    billingIds: [AP0],
    whtPct: "3.00",
    amount: "645000.00",
    net: "561150.00",
    retention: "64500.00",
    method: "cheque",
    chequeNo: "CH-040128",
    chequeBank: "SCB · บัญชี OD",
    chequeDate: null,
    currencyCode: "THB",
    batchId: null,
    // B-094-3 (SoD): a legacy/unattributed PV leaves created_by null (the default);
    // the self-approve gate then can't prove self-approval and does not block.
    createdBy: null,
    status: "pending",
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof pvs.$inferSelect;

const userRow = {
  id: "u-0",
  companyId: COMPANY,
  email: "suda@rungrueang.co.th",
  name: "สุดา",
  roleId: "role-0",
  status: "active",
};
/** A role with the finance-approve perm gate + an approval tier (finmgr = 3). */
const roleRow = (approvalLevel: number, financeApprove = true) => ({
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
  approvalLevel,
  approvalLimit: null,
  currencyCode: "THB",
  createdAt: D,
  updatedAt: D,
});

// ===========================================================================
// GET /ap/billing
// ===========================================================================
describe("GET /api/v1/ap/billing", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/ap/billing" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("returns the envelope with vendor_name, po/wo ref, WHT/retention, honest-null no", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [
              apBillings,
              [
                apBilling(AP0), // PO/GR-billed
                apBilling(AP1, {
                  poId: null,
                  grId: null,
                  woId: WO0,
                  amount: "645000.00",
                  retention: "64500.00",
                  status: "pending",
                }),
              ],
            ],
            [vendors, [vendorRow]],
            [pos, [poRow]],
            [wos, [woRow]],
            [grs, [grRow]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/ap/billing" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    const a0 = body.data.find((r: { id: string }) => r.id === AP0);
    expect(a0.no).toBeNull(); // GAP: no doc-number column
    expect(a0.vendor_name).toBe("บจก. ซีแพค คอนกรีต");
    expect(a0.ref).toBe("PO-2026-0291"); // po.no
    expect(a0.amount).toBe(920000);
    expect(a0.wht).toBe(27600);
    expect(a0.retention).toBeNull();
    expect(a0.aging).toBeNull(); // no due_date → honest null
    const a1 = body.data.find((r: { id: string }) => r.id === AP1);
    expect(a1.ref).toBe("WO-2026-0117"); // wo.no
    expect(a1.retention).toBe(64500);
    expect(a1.status).toBe("pending");
  });

  it("binds company_id on the ap_billing read (tenant scope)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[apBillings, [apBilling(AP0)]]], captured }),
      })
    ).inject({ url: "/api/v1/ap/billing" });
    const read = captured.find((c) => c.table === apBillings);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
  });
});

// ===========================================================================
// POST /ap/billing
// ===========================================================================
describe("POST /api/v1/ap/billing", () => {
  const okDb = (inserted: Inserted[] = [], captured: Captured[] = []) =>
    stubDb({
      rows: [
        [vendors, [vendorRow]],
        [pos, [poRow]],
        [grs, [grRow]],
        [wos, [woRow]],
      ],
      inserted,
      captured,
    });

  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/ap/billing",
      payload: { vendor_id: VENDOR, amount: 100 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates a billing (201) — stores explicit wht, company_id force-set, status draft", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: okDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/billing",
      payload: {
        vendor_id: VENDOR,
        po_id: PO0,
        gr_id: GR0,
        invoice_no: "INV-CPC-118",
        amount: 920000,
        vat: 60187,
        wht: 27600,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.vendor_id).toBe(VENDOR);
    expect(body.amount).toBe(920000);
    expect(body.wht).toBe(27600);
    expect(body.status).toBe("draft");
    const ins = inserted.find((i) => i.table === apBillings);
    expect(ins).toBeTruthy();
    expect(ins!.values.companyId).toBe(COMPANY);
    expect(ins!.values.wht).toBe("27600.00");
    expect(ins!.values.status).toBe("draft");
  });

  it("derives wht through tax-engine.calcWht when omitted (3% default)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: okDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/billing",
      payload: { vendor_id: VENDOR, amount: 100000 }, // 3% → 3000
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().wht).toBe(3000);
    const ins = inserted.find((i) => i.table === apBillings);
    expect(ins!.values.wht).toBe("3000.00");
  });

  it("400s when vendor_id is missing", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: okDb() })
    ).inject({ method: "POST", url: "/api/v1/ap/billing", payload: { amount: 100 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/vendor_id is required/);
  });

  it("400s when amount is missing or not positive", async () => {
    const appx = await buildTestApp({ resolveTenant: async () => SESSION, db: okDb() });
    const zero = await appx.inject({
      method: "POST",
      url: "/api/v1/ap/billing",
      payload: { vendor_id: VENDOR, amount: 0 },
    });
    expect(zero.statusCode).toBe(400);
    expect(zero.json().message).toMatch(/amount is required/);
  });

  it("400s (fail closed) on a foreign vendor_id", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, []]], inserted }), // vendor absent → foreign
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/billing",
      payload: { vendor_id: VENDOR, amount: 100 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/vendor not found/);
    expect(inserted).toHaveLength(0);
  });

  it("400s (fail closed) on a foreign po_id", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[vendors, [vendorRow]], [pos, []]], inserted }), // po absent
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/billing",
      payload: { vendor_id: VENDOR, po_id: PO0, amount: 100 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/po_id not found/);
    expect(inserted).toHaveLength(0);
  });
});

// ===========================================================================
// GET /ap/pv
// ===========================================================================
describe("GET /api/v1/ap/pv", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/ap/pv" });
    expect(res.statusCode).toBe(401);
  });

  // B-323: both AP lists used an inline created_at-only comparator that returned 0 for
  // two rows sharing an instant, handing the pair back to the join plan. Billings and
  // PVs are routinely created together in one transaction, so the tie is not exotic.
  it("lists are TOTAL when two rows share an instant (id floor decides)", async () => {
    const billingIds = async (rows: unknown[]): Promise<string[]> => {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({
            rows: [
              [apBillings, rows],
              [vendors, [vendorRow]],
              [pos, [poRow]],
              [wos, [woRow]],
              [grs, [grRow]],
            ],
          }),
        })
      ).inject({ url: "/api/v1/ap/billing" });
      return res.json().data.map((r: { id: string }) => r.id);
    };
    // `apBilling()` / `pvRow()` hardcode the same createdAt — a genuine tie.
    expect(await billingIds([apBilling("aaa"), apBilling("bbb")])).toEqual(["aaa", "bbb"]);
    expect(await billingIds([apBilling("bbb"), apBilling("aaa")])).toEqual(["aaa", "bbb"]);

    const pvIds = async (rows: unknown[]): Promise<string[]> => {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({
            rows: [[pvs, rows], [apBillings, [apBilling(AP0)]], [vendors, [vendorRow]]],
          }),
        })
      ).inject({ url: "/api/v1/ap/pv" });
      return res.json().data.map((r: { id: string }) => r.id);
    };
    expect(await pvIds([pvRow("aaa"), pvRow("bbb")])).toEqual(["aaa", "bbb"]);
    expect(await pvIds([pvRow("bbb"), pvRow("aaa")])).toEqual(["aaa", "bbb"]);
  });

  it("lists PVs with payee, method/cheque fields, WHT via calcWht, net + retention", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pvs, [pvRow(PV0)]],
            [apBillings, [apBilling(AP0)]],
            [vendors, [vendorRow]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/ap/pv" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    const pv = body.data[0];
    expect(pv.no).toBeNull(); // GAP: no doc-number column
    expect(pv.payee).toBe("บจก. ซีแพค คอนกรีต"); // billing → vendor
    expect(pv.vendor_id).toBe(VENDOR);
    expect(pv.amount).toBe(645000);
    expect(pv.wht_pct).toBe(3);
    expect(pv.wht).toBe(19350); // 645000 × 3% via tax-engine.calcWht
    expect(pv.retention).toBe(64500);
    expect(pv.net).toBe(561150);
    expect(pv.method).toBe("cheque");
    expect(pv.cheque_no).toBe("CH-040128");
  });

  it("binds company_id on the pv read (tenant scope)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pvs, [pvRow(PV0)]]], captured }),
      })
    ).inject({ url: "/api/v1/ap/pv" });
    const read = captured.find((c) => c.table === pvs);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
  });
});

// ===========================================================================
// POST /ap/pv
// ===========================================================================
describe("POST /api/v1/ap/pv", () => {
  /**
   * The prototype's AP-2026-0180 row verbatim (ap.jsx AP_BILL[4] — the one its PV
   * create form settles): amount 645,000 VAT-INCLUSIVE (vat 42,196 = 645000 × 7/107
   * is the tax INSIDE it, never an addend), wht 19,350 = 3% of 645,000, retention
   * 64,500. ap.jsx's own net box prints 645,000 → −19,350 → −64,500 → 561,150.
   */
  const proto180 = () =>
    apBilling(AP0, {
      amount: "645000.00",
      vat: "42196.00",
      wht: "19350.00",
      retention: "64500.00",
    });
  const okDb = (inserted: Inserted[] = [], bills = [proto180()]) =>
    stubDb({
      rows: [
        [apBillings, bills],
        [vendors, [vendorRow]],
      ],
      inserted,
    });

  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/ap/pv",
      payload: { billing_ids: [AP0], amount: 100 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates a PV (201) — net = gross − WHT − retention (calcWht leg), pending, method stored", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: okDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/pv",
      payload: {
        billing_ids: [AP0],
        method: "cheque",
        wht_pct: 3,
        retention: 64500,
        cheque_no: "CH-040128",
        cheque_bank: "SCB",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("pending");
    expect(body.amount).toBe(645000);
    expect(body.wht).toBe(19350); // 645000 × 3% (tax-engine)
    expect(body.net).toBe(561150); // 645000 − 19350 − 64500
    expect(body.method).toBe("cheque");
    const ins = inserted.find((i) => i.table === pvs);
    expect(ins!.values.companyId).toBe(COMPANY);
    expect(ins!.values.net).toBe("561150.00");
    expect(ins!.values.status).toBe("pending");
  });

  // -------------------------------------------------------------------------
  // B-315 (Wei = ก) — money = SERVER: the payable is derived from the billing
  // rows, and any client `amount` is IGNORED. The stored gross decides WHO MAY
  // APPROVE (approvePv reads pv.amount alone), so an understated client figure
  // used to route a large payment past the Finance Manager / MD.
  // -------------------------------------------------------------------------
  it("B-315: creates a PV with NO amount in the body — the server derives it", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: okDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/pv",
      payload: { billing_ids: [AP0], wht_pct: 3, retention: 64500 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().amount).toBe(645000);
    expect(inserted.find((i) => i.table === pvs)!.values.amount).toBe("645000.00");
  });

  it("B-315: IGNORES a client amount ABOVE the true payable (no invented payable)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: okDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/pv",
      payload: { billing_ids: [AP0], amount: 9_000_000, wht_pct: 3, retention: 64500 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().amount).toBe(645000);
    const ins = inserted.find((i) => i.table === pvs)!;
    expect(ins.values.amount).toBe("645000.00");
    // the LEDGER + BANK-FILE basis follows the server's figure, not the client's
    expect(ins.values.net).toBe("561150.00"); // 645000 − 19350 − 64500
  });

  it("B-315: never adds `vat` — a VAT-bearing billing yields amount alone (the old bug)", async () => {
    // The browser used to send amount + vat. ap_billing.vat is the tax portion
    // CONTAINED IN amount (645000 × 7/107 = 42196), so adding it overstated the
    // payable by 6.54% (645,000 → 687,196). This is the regression pin.
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: okDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/pv",
      payload: { billing_ids: [AP0], amount: 645000 + 42196, wht_pct: 3, retention: 64500 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().amount).toBe(645000);
    expect(res.json().amount).not.toBe(687196);
  });

  it("B-315: SUMS every covered billing — not billingIds[0]", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: okDb(inserted, [
          apBilling(AP0, { amount: "645000.00", vat: "42196.00" }),
          apBilling(AP1, { amount: "96800.00", vat: "6334.00" }),
        ]),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/pv",
      payload: { billing_ids: [AP0, AP1], amount: 645000, wht_pct: 0, retention: 0 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().amount).toBe(741800); // 645000 + 96800, NOT 645000
    expect(inserted.find((i) => i.table === pvs)!.values.amount).toBe("741800.00");
  });

  it("B-315: 400s when the covered billings carry no payable amount (no zero PV)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: okDb(inserted, [apBilling(AP0, { amount: "0.00", vat: "0.00" })]),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/pv",
      // even a generous client amount cannot conjure a payable
      payload: { billing_ids: [AP0], amount: 500_000 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/no payable amount/);
    expect(inserted).toHaveLength(0);
  });

  it("B-315 EXPLOIT CLOSED: an understated amount cannot demote the approval tier", async () => {
    // A caller with finance.create posts a token `amount` against a 3,000,000
    // billing. Before the fix the row stored 500,000 → needed = 0 → the accountant
    // (approvalLevel 0) could approve a 3M payment with MD/FinMgr never seeing it.
    const inserted: Inserted[] = [];
    const created = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: okDb(inserted, [apBilling(AP0, { amount: "3000000.00", vat: "196261.00" })]),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/pv",
      payload: { billing_ids: [AP0], amount: 500_000, wht_pct: 0, retention: 0 },
    });
    expect(created.statusCode).toBe(201);

    // Feed the row the handler ACTUALLY persisted into the approval ladder — no
    // hand-written amount, so this proves the gate on the real stored value.
    const stored = inserted.find((i) => i.table === pvs)!.values;
    const persisted = pvRow(PV0, {
      amount: stored.amount as string,
      net: stored.net as string,
      createdBy: null, // isolate the tier gate from the SoD gate
    });
    const ladder = (approvalLevel: number) =>
      stubDb({
        rows: [
          [pvs, [persisted]],
          [users, [userRow]],
          [roles, [roleRow(approvalLevel, true)]],
          [apBillings, [apBilling(AP0)]],
          [vendors, [vendorRow]],
        ],
        updateBase: persisted,
      });

    // 1) THE POINT, asserted FIRST so nothing shields it: the tier derived from
    // the persisted row must refuse a tier-1 approver. Revert the handler and it
    // is THIS line that goes red (stored 500,000 → needed 0 → 200 approved).
    const accountant = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: ladder(0) })
    ).inject({ method: "POST", url: `/api/v1/pv/${PV0}/approve` });
    expect(accountant.statusCode, "tier-1 approver on a 3M PV must be refused").toBe(403);
    expect(accountant.json().message).toMatch(/requires approval level 4/);

    const finMgr = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: ladder(3) })
    ).inject({ method: "POST", url: `/api/v1/pv/${PV0}/approve` });
    expect(finMgr.statusCode).toBe(403); // even the Finance Manager is short of MD

    const md = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: ladder(4) })
    ).inject({ method: "POST", url: `/api/v1/pv/${PV0}/approve` });
    expect(md.statusCode).toBe(200);
    expect(md.json().status).toBe("approved");

    // 2) and the stored figure itself is the server's, not the caller's
    expect(stored.amount).toBe("3000000.00");
    expect(created.json().amount).toBe(3_000_000);
  });

  it("400s on empty billing_ids", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: okDb() })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/pv",
      payload: { billing_ids: [], amount: 100 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/non-empty array/);
  });

  it("400s (fail closed) on a foreign billing_id", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[apBillings, []]], inserted }), // billing absent → foreign
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/pv",
      payload: { billing_ids: [AP0], amount: 100 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(new RegExp(`billing_id ${AP0} not found`));
    expect(inserted).toHaveLength(0);
  });

  it("400s on an invalid method code", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: okDb() })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/pv",
      payload: { billing_ids: [AP0], amount: 100, method: "bitcoin" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/method must be one of/);
  });

  it("captures the creator's DICTIONARY user id in created_by (B-094-3 SoD)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [apBillings, [apBilling(AP0)]],
            [vendors, [vendorRow]],
            // loadCaller resolves the caller via email → dictionary user (u-0) → role.
            [users, [userRow]],
            [roles, [roleRow(0)]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/pv",
      payload: { billing_ids: [AP0], amount: 400000 },
    });
    expect(res.statusCode).toBe(201);
    const ins = inserted.find((i) => i.table === pvs);
    // The DICTIONARY user id (userRow.id), NOT the better-auth au-0 session id.
    expect(ins!.values.createdBy).toBe("u-0");
  });

  it("leaves created_by null when the caller can't be attributed (honest, fail-safe)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        // No users row → loadCaller returns null → created_by null.
        db: okDb(inserted),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ap/pv",
      payload: { billing_ids: [AP0], amount: 400000 },
    });
    expect(res.statusCode).toBe(201);
    const ins = inserted.find((i) => i.table === pvs);
    expect(ins!.values.createdBy).toBeNull();
  });

  // -------------------------------------------------------------------------
  // B-398 (Wei = ก · 2026-08-14) — ONE BILLING, AT MOST ONE LIVE PV.
  //
  // The defect: createPv never queried the pv table at all and ran with NO
  // transaction, so the same ap_billing could be covered by two PVs — and since
  // B-315 derives the amount from the billing rows, the duplicate is EXACT. Two
  // 201s, two pv rows, both amount 645000 / net 561150: the vendor payable paid
  // twice in full.
  //
  // Every case here dies on revert. The status-code assertions are paired with an
  // "and NOTHING was inserted" assertion, because a status-only test still passes
  // if someone later moves the guard to AFTER the insert.
  // -------------------------------------------------------------------------
  describe("B-398 · a billing already covered by a PV cannot be covered again", () => {
    const AP0_AMOUNT = "645000.00";
    const AP1_AMOUNT = "96800.00";

    /**
     * ap_billing rows answered against the ids the REQUEST actually asked for.
     * Without this the stub hands back every billing it holds regardless of the
     * WHERE, so a fixture carrying both AP0 and AP1 would sum both into any PV and
     * the positive control below would be measuring the wrong thing.
     */
    const billingsByRequest =
      (all: (typeof apBillings.$inferSelect)[]) => (where: SQL | undefined) => {
        const asked = new Set(paramsOf(where).map(String));
        return all.filter((b) => asked.has(b.id));
      };

    /** ONE fixture: two real billings, plus whatever PVs already exist. */
    const fixture = (
      existingPvs: (typeof pvs.$inferSelect)[],
      capture: { inserted?: Inserted[]; calls?: Call[] } = {},
    ) =>
      stubDb({
        rows: [
          [
            apBillings,
            billingsByRequest([
              apBilling(AP0, { amount: AP0_AMOUNT, vat: "42196.00" }),
              apBilling(AP1, { amount: AP1_AMOUNT, vat: "6334.00" }),
            ]),
          ],
          [vendors, [vendorRow]],
          [pvs, existingPvs],
        ],
        inserted: capture.inserted,
        calls: capture.calls,
      });

    /** An APPROVED PV already covering `ids` — the live coverage the guard sees. */
    const coveringPv = (ids: string[]) =>
      pvRow(PV0, { billingIds: ids, status: "approved" });

    const post = async (db: Db, billingIds: string[]) =>
      (
        await buildTestApp({ resolveTenant: async () => SESSION, db })
      ).inject({
        method: "POST",
        url: "/api/v1/ap/pv",
        payload: { billing_ids: billingIds, wht_pct: 3, retention: 0 },
      });

    it("refuses a SECOND PV over an already-covered billing → 409, and inserts NOTHING", async () => {
      const inserted: Inserted[] = [];
      const res = await post(fixture([coveringPv([AP0])], { inserted }), [AP0]);

      expect(res.statusCode, "a billing held by a live PV must not be paid twice").toBe(409);
      expect(res.json().code).toBe("INVALID_STATE");
      // THE point: not merely "the caller saw a 409" but "no second voucher exists".
      // Before the fix this array held one pv row with amount 645000 — an exact
      // duplicate of the covering PV's.
      expect(inserted.filter((i) => i.table === pvs)).toHaveLength(0);
      expect(inserted).toHaveLength(0);
    });

    it("names the offending billing id (and the PV holding it) in the 409", async () => {
      const res = await post(fixture([coveringPv([AP0])]), [AP0]);
      expect(res.statusCode).toBe(409);
      expect(res.json().message).toContain(AP0);
      expect(res.json().message).toContain(PV0);
    });

    it("POSITIVE CONTROL — same fixture, a DIFFERENT billing still creates a PV", async () => {
      // Identical db to the 409 case above: AP0 is covered by PV0. Only the request
      // differs. If the guard were over-broad (any existing PV blocks any create)
      // THIS is the line that goes red, and the 409s above would be worthless.
      const inserted: Inserted[] = [];
      const res = await post(fixture([coveringPv([AP0])], { inserted }), [AP1]);

      expect(res.statusCode, "an UNCOVERED billing must still be payable").toBe(201);
      const ins = inserted.find((i) => i.table === pvs)!;
      expect(ins.values.billingIds).toEqual([AP1]);
      expect(ins.values.amount).toBe(AP1_AMOUNT); // the server's own derivation, not AP0's
      expect(ins.values.status).toBe("pending");
    });

    it("a MULTI-billing PV succeeds when NEITHER id is covered", async () => {
      const inserted: Inserted[] = [];
      const res = await post(fixture([], { inserted }), [AP0, AP1]);

      expect(res.statusCode).toBe(201);
      expect(res.json().amount).toBe(741_800); // 645000 + 96800 — billing_ids stays PLURAL
      expect(inserted.find((i) => i.table === pvs)!.values.billingIds).toEqual([AP0, AP1]);
    });

    it("a MULTI-billing PV is refused when the FIRST id is covered", async () => {
      const inserted: Inserted[] = [];
      const res = await post(fixture([coveringPv([AP0])], { inserted }), [AP0, AP1]);

      expect(res.statusCode).toBe(409);
      expect(res.json().message).toContain(AP0);
      expect(inserted).toHaveLength(0);
    });

    it("a MULTI-billing PV is refused when the SECOND id is covered (per-ELEMENT, not per-array)", async () => {
      // The discriminator. A guard written as "does some PV hold the identical
      // billing_ids array?" — or one that only inspects billing_ids[0], the way
      // payee/currency legitimately do — answers 201 here and pays AP1 twice.
      const inserted: Inserted[] = [];
      const res = await post(fixture([coveringPv([AP1])], { inserted }), [AP0, AP1]);

      expect(res.statusCode, "coverage must be checked per element, not on the whole array").toBe(
        409,
      );
      expect(res.json().message).toContain(AP1);
      expect(inserted).toHaveLength(0);
    });

    it("counts a PENDING PV as live too (there is no cancelled PV state in this codebase)", async () => {
      // POST /pv/{id}/approve is the only pv mutation in the API and its only write
      // is pending→approved, so `pending` and `approved` are the only statuses that
      // reach the table. Both hold their billings. This pins that the guard did not
      // quietly acquire a status filter that lets an un-approved PV be duplicated.
      const inserted: Inserted[] = [];
      const res = await post(
        fixture([pvRow(PV0, { billingIds: [AP0], status: "pending" })], { inserted }),
        [AP0],
      );
      expect(res.statusCode).toBe(409);
      expect(inserted).toHaveLength(0);
    });

    it("the ownership 400 for a foreign billing id is unchanged — and now runs on the LOCK", async () => {
      // The lock REPLACED the plain scoped select; it did not join it. A foreign id
      // is still absent from the scoped read, so the message and the code are byte
      // identical to before — and the read that proves it is the FOR UPDATE one.
      const inserted: Inserted[] = [];
      const calls: Call[] = [];
      const res = await post(fixture([], { inserted, calls }), [
        "ffffffff-0000-0000-0000-00000000ffff",
      ]);

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION");
      expect(res.json().message).toMatch(/not found in this tenant/);
      expect(inserted).toHaveLength(0);

      const billingReads = calls.filter((c) => c.kind === "read" && c.table === apBillings);
      expect(billingReads).toHaveLength(1);
      expect(billingReads[0]!.forUpdate).toBe(true);
      expect(billingReads[0]!.inTx).toBe(true);
    });

    it("ATOMICITY — the coverage read runs INSIDE the tx and AFTER the FOR UPDATE lock", async () => {
      // The stub cannot model a real row lock, and this does not claim to. What it
      // pins is the ORDER and the PLACEMENT, which is what a reviewer cannot see and
      // what a refactor silently destroys: move the coverage read out of the block,
      // or above the lock, and the guard becomes a pure TOCTOU that reads
      // "uncovered" for both concurrent creates while still passing every
      // status-code assertion above.
      const calls: Call[] = [];
      const res = await post(fixture([], { calls }), [AP0]);
      expect(res.statusCode).toBe(201);

      const lock = calls.findIndex(
        (c) => c.kind === "read" && c.table === apBillings && c.forUpdate,
      );
      const coverage = calls.findIndex((c) => c.kind === "read" && c.table === pvs);
      const insert = calls.findIndex((c) => c.kind === "insert" && c.table === pvs);

      expect(lock, "the billings must be read through selectForUpdate").toBeGreaterThanOrEqual(0);
      expect(coverage, "createPv must read the pv table at all — it never used to").toBeGreaterThan(
        lock,
      );
      expect(insert, "the insert must follow the coverage read").toBeGreaterThan(coverage);

      // …and all three inside ONE transaction. The insert used to sit in no
      // transaction at all.
      expect(calls[lock]!.inTx, "the lock must be taken inside the transaction").toBe(true);
      expect(calls[coverage]!.inTx, "the coverage read must be inside the transaction").toBe(true);
      expect(calls[insert]!.inTx, "the insert must be inside the transaction").toBe(true);

      // No UNLOCKED read of ap_billing survives anywhere in the path — the lock
      // replaced the plain select rather than being bolted on beside it.
      expect(
        calls.filter((c) => c.kind === "read" && c.table === apBillings).map((c) => c.forUpdate),
      ).toEqual([true]);
    });
  });
});

// ===========================================================================
// POST /pv/{id}/approve — the PV approval ladder (F-PV1)
// ===========================================================================
describe("POST /api/v1/pv/:id/approve — ladder (บัญชี → ผจก.การเงิน >500K → MD >2M)", () => {
  const ladderDb = (
    pv: typeof pvs.$inferSelect,
    approvalLevel: number,
    financeApprove = true,
    updated: Updated[] = [],
  ) =>
    stubDb({
      rows: [
        [pvs, [pv]],
        [users, [userRow]],
        [roles, [roleRow(approvalLevel, financeApprove)]],
        [apBillings, [apBilling(AP0)]],
        [vendors, [vendorRow]],
      ],
      updated,
      updateBase: pv,
    });

  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: `/api/v1/pv/${PV0}/approve`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("404s an unknown PV", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pvs, []]] }),
      })
    ).inject({ method: "POST", url: `/api/v1/pv/${PV0}/approve` });
    expect(res.statusCode).toBe(404);
  });

  it("403s a caller lacking the finance-approve perm", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: ladderDb(pvRow(PV0, { amount: "400000.00" }), 4, /* financeApprove */ false),
      })
    ).inject({ method: "POST", url: `/api/v1/pv/${PV0}/approve` });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance approve permission/);
  });

  it("tier-1 (≤500K): บัญชี (level 0) with finance.approve approves → 200 approved", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: ladderDb(pvRow(PV0, { amount: "400000.00" }), 0, true, updated),
      })
    ).inject({ method: "POST", url: `/api/v1/pv/${PV0}/approve` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("approved");
    expect(updated.find((u) => u.table === pvs)!.set.status).toBe("approved");
  });

  it("tier-2 (>500K): level 2 gets 403, the Finance Manager (level 3) passes", async () => {
    const denied = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: ladderDb(pvRow(PV0, { amount: "1000000.00" }), 2),
      })
    ).inject({ method: "POST", url: `/api/v1/pv/${PV0}/approve` });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().message).toMatch(/requires approval level 3/);

    const ok = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: ladderDb(pvRow(PV0, { amount: "1000000.00" }), 3), // finmgr
      })
    ).inject({ method: "POST", url: `/api/v1/pv/${PV0}/approve` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("approved");
  });

  it("tier-3 (>2M): the Finance Manager (level 3) gets 403, MD (level 4) passes", async () => {
    const denied = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: ladderDb(pvRow(PV0, { amount: "3000000.00" }), 3),
      })
    ).inject({ method: "POST", url: `/api/v1/pv/${PV0}/approve` });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().message).toMatch(/requires approval level 4/);

    const ok = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: ladderDb(pvRow(PV0, { amount: "3000000.00" }), 4), // MD
      })
    ).inject({ method: "POST", url: `/api/v1/pv/${PV0}/approve` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("approved");
  });

  it("409s a non-pending PV (only a pending PV can be approved)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: ladderDb(pvRow(PV0, { amount: "400000.00", status: "approved" }), 3),
      })
    ).inject({ method: "POST", url: `/api/v1/pv/${PV0}/approve` });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  // B-094-3 — separation of duties (a creator may not approve their own PV).
  it("403s when the approver IS the creator (self-approve, SoD) — even with the tier", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        // created_by === the caller's dictionary user id (userRow.id = "u-0").
        db: ladderDb(pvRow(PV0, { amount: "400000.00", createdBy: "u-0" }), 4, true, updated),
      })
    ).inject({ method: "POST", url: `/api/v1/pv/${PV0}/approve` });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/separation of duties/);
    // Fail closed: the PV was NOT approved.
    expect(updated.find((u) => u.table === pvs)).toBeUndefined();
  });

  it("approves when a DIFFERENT authorized approver signs off (creator ≠ approver) → 200", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        // A different creator ("u-99") — the caller ("u-0") is not the creator.
        db: ladderDb(pvRow(PV0, { amount: "400000.00", createdBy: "u-99" }), 0, true, updated),
      })
    ).inject({ method: "POST", url: `/api/v1/pv/${PV0}/approve` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("approved");
    expect(updated.find((u) => u.table === pvs)!.set.status).toBe("approved");
  });

  it("does NOT block a legacy/unattributed PV (created_by null) — fail SAFE, not fail closed", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        // created_by null (the pvRow default) — self-approval can't be proven.
        db: ladderDb(pvRow(PV0, { amount: "400000.00", createdBy: null }), 0),
      })
    ).inject({ method: "POST", url: `/api/v1/pv/${PV0}/approve` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("approved");
  });
});

// ===========================================================================
// B-388 · SINGLE-RECORDING EVIDENCE for the both-doors insert stub.
//
// Converting a `.returning()`-only stub is behaviourally INERT in this file —
// nothing this route does today writes through the bare TenantDb.insert() door,
// so no assertion above changed verdict when this landed and a green suite is
// NOT evidence the conversion is right. The defect a conversion can introduce is
// a DOUBLE-count (the recording closure invoked on the way in as well as per
// door) or a second door that records somewhere else. Neither is visible to
// stub-insert-door.enforce.test.ts, which proves a `then` KEY EXISTS — not that
// it records correctly. So the recording is asserted here, directly.
// ===========================================================================
describe("B-388 · stubDb's two insert doors record identically, once each", () => {
  interface Door {
    values: (v: Record<string, unknown>) => PromiseLike<Record<string, unknown>[]> & {
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
    const bare = await doorOf(db, apBillings).values({ no: "bare" });
    expect(inserted).toHaveLength(1);
    // The .returning() door (insertThrough / insert(...).returning()).
    const ret = await doorOf(db, apBillings).values({ no: "ret" }).returning();
    expect(inserted).toHaveLength(2);

    expect(inserted).toEqual([
      { table: apBillings, values: { no: "bare" } },
      { table: apBillings, values: { no: "ret" } },
    ]);
    // Identical resolution shape. The ids prove `seq` advanced exactly ONCE per
    // write, so neither door invoked the recording closure twice.
    expect(bare).toEqual([{ id: "new-0", createdAt: D, no: "bare" }]);
    expect(ret).toEqual([{ id: "new-1", createdAt: D, no: "ret" }]);
  });
});

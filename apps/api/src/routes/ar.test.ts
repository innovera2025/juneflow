// G3 unit tests (PLAN.md §9) — AR handlers (Phase-3 Finance, AR + e-Tax lane).
// Wave-0 covered the two create POSTs; round-A adds: invoice lines + due_date +
// status stored (≤0 rejected), the RV paid-flip, the AR reads (list / aging /
// tax-register / credit-note), the credit-note create, and the CN-approve reversal
// JV (server VAT = round(amount×7/107), balanced Dr revenue + Dr VAT / Cr AR,
// idempotent on the JV source_doc). Every expected value comes from the stub / the
// real tax-engine — never hand-computed against the impl.
//
// The routes are registered onto the built app in buildTestApp (app.ts wiring is
// the orchestrator's). The root tenant-scope + audit hooks apply to the
// late-registered child plugin exactly as to the wired routes.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  arCreditNotes,
  arInvoiceLines,
  arInvoices,
  customers,
  glAccounts,
  jvLines,
  jvs,
  roles,
  rvs,
  users,
} from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";
import type { AuditRecord } from "../plugins/audit-log.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "suda@rungrueang.co.th", name: "สุดา" },
};
const D = new Date(1_700_000_000_000);

/** A canned rows source: a fixed list, or a where-aware fn (for a table read
 *  more than once with different predicates — e.g. jvs idempotency vs ownership). */
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

/** Db stub: canned rows per table (reads) + write capture (mirrors gl.test.ts). */
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
              return { id: row.id ?? `new-${seq++}`, createdAt: D, ...row };
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
  // B-097: the transaction door runs its callback against this SAME stub, so writes
  // inside a tx still capture (the fake has no real BEGIN/COMMIT — it proves the
  // door threads one scoped handle).
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
  // AR routes are wired in app.ts (registerArRoute) → buildApp already mounts them.
  return app;
}

// --- seed-shaped canned rows ------------------------------------------------
const CUSTOMER = "cust0000-0000-0000-0000-0000000000c1";
const INV0 = "inv00000-0000-0000-0000-0000000000i0";
const RV0 = "rv000000-0000-0000-0000-0000000000r0";
const CN0 = "cn000000-0000-0000-0000-0000000000n0";

const customerRow = {
  id: CUSTOMER,
  companyId: COMPANY,
  name: "คุณวรรณา ศรีจันทร์",
  taxId: "1-1014-00234-56-1",
  createdAt: D,
  updatedAt: D,
};

const arInvoice = (
  id: string,
  extra: Partial<typeof arInvoices.$inferSelect> = {},
): typeof arInvoices.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    customerId: CUSTOMER,
    projectId: null,
    no: "INV-2026-0418",
    amount: "728000.00",
    vat: "0",
    currencyCode: "THB",
    creditTerm: 14,
    dueDate: null,
    status: "open",
    etaxStatus: "queued",
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof arInvoices.$inferSelect;

const rvSeed = (
  id: string,
  extra: Partial<typeof rvs.$inferSelect> = {},
): typeof rvs.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    invoiceId: INV0,
    amount: "1000.00",
    currencyCode: "THB",
    method: "transfer",
    no: "RV-2026-0001",
    receiptDate: "2026-05-01",
    bank: "SCB",
    status: "open",
    source: "invoice",
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof rvs.$inferSelect;

const cnSeed = (
  id: string,
  extra: Partial<typeof arCreditNotes.$inferSelect> = {},
): typeof arCreditNotes.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    no: "CN-2026-0001",
    customerId: CUSTOMER,
    refInvoiceId: INV0,
    reason: "คืนสินค้า",
    amount: "107.00",
    currencyCode: "THB",
    status: null,
    noteDate: null,
    createdAt: D,
    updatedAt: D,
  }) as typeof arCreditNotes.$inferSelect;

const userRow = {
  id: "u-0",
  companyId: COMPANY,
  email: "suda@rungrueang.co.th",
  name: "สุดา",
  roleId: "role-0",
  status: "active",
};
/** A role carrying (or not) the finance.create / finance.approve perms. */
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

// The tenant COA rows the CN-approve reversal resolves (codes → ids).
const ACC_REVENUE = "acc-4010";
const ACC_VATOUT = "acc-2050";
const ACC_AR = "acc-1030";
const coaRows = [
  { id: ACC_REVENUE, companyId: COMPANY, code: "4010", name: "รายได้" },
  { id: ACC_VATOUT, companyId: COMPANY, code: "2050", name: "ภาษีขาย" },
  { id: ACC_AR, companyId: COMPANY, code: "1030", name: "ลูกหนี้การค้า" },
];

// ===========================================================================
// POST /ar/invoices  (Wave-0 authz + SERVER money, round-A lines/due_date/status)
// ===========================================================================
describe("POST /api/v1/ar/invoices", () => {
  const authedDb = (inserted: Inserted[] = [], captured: Captured[] = []) =>
    stubDb({
      rows: [
        [customers, [customerRow]],
        [users, [userRow]],
        [roles, [roleRow(true)]],
        [arInvoices, [arInvoice(INV0)]], // insertThrough parent-ownership read
      ],
      inserted,
      captured,
    });

  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/ar/invoices",
      payload: { customer_id: CUSTOMER, no: "INV-1", lines: [{ qty: 1, price: 10 }] },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("403s a caller without the finance.create perm (fail closed)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [customers, [customerRow]],
            [users, [userRow]],
            [roles, [roleRow(false)]],
          ],
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/invoices",
      payload: { customer_id: CUSTOMER, no: "INV-1", lines: [{ qty: 1, price: 10 }] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance create permission/);
  });

  it("SERVER money authority — a bogus client amount/vat is IGNORED (amount = Σ qty×price, vat = 7%)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: authedDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/invoices",
      payload: {
        customer_id: CUSTOMER,
        no: "INV-2026-0419",
        amount: 999999, // attacker-supplied — MUST be ignored (B-107a · Wei C-176)
        vat: 999999,
        lines: [{ qty: 2, price: 100000 }], // → amount 200000, vat 14000 (7%)
        credit_term: 30,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.amount).toBe(200000); // Σ 2×100000, NOT the client 999999
    expect(body.vat).toBe(14000); // 200000 × 7% via tax-engine.calcVat
    expect(body.etax_status).toBe("queued"); // C4 queue head on create
    expect(body.status).toBe("open"); // lifecycle head
    expect(body.no).toBe("INV-2026-0419");
    const ins = inserted.find((i) => i.table === arInvoices);
    expect(ins).toBeTruthy();
    const inv = ins!.values as Record<string, unknown>;
    expect(inv.companyId).toBe(COMPANY); // force-set by the scoped insert
    expect(inv.amount).toBe("200000.00");
    expect(inv.vat).toBe("14000.00");
    expect(inv.status).toBe("open");
    expect(inv.etaxStatus).toBe("queued");
  });

  it("stores the lines (amount = qty×price, server) + a due_date when credit_term is given", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: authedDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/invoices",
      payload: {
        customer_id: CUSTOMER,
        no: "INV-2026-0420",
        lines: [
          { qty: 2, price: 100, description: "งานเทพื้น" },
          { qty: 3, price: 50 },
        ],
        credit_term: 30,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.amount).toBe(350); // 2×100 + 3×50
    // due_date = invoice date + 30 days → a 'YYYY-MM-DD' string.
    expect(typeof body.due_date).toBe("string");
    expect(body.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const lineIns = inserted.find((i) => i.table === arInvoiceLines);
    expect(lineIns).toBeTruthy();
    const lines = lineIns!.values as Record<string, unknown>[];
    expect(Array.isArray(lines)).toBe(true);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.amount).toBe("200.00"); // 2 × 100, server-authoritative
    expect(lines[0]!.unitPrice).toBe("100.00");
    expect(lines[0]!.qty).toBe("2.00");
    expect(lines[0]!.description).toBe("งานเทพื้น");
    expect(lines[0]!.arInvoiceId).toBeTruthy(); // parent FK set for insertThrough
    expect(lines[1]!.amount).toBe("150.00"); // 3 × 50
    // Σ line.amount === header amount (SERVER authority is internally consistent).
    const lineSum = lines.reduce((s, l) => s + Number(l.amount), 0);
    expect(lineSum).toBe(350);
  });

  it("null due_date when no credit_term is given", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: authedDb() })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/invoices",
      payload: { customer_id: CUSTOMER, no: "INV-NT", lines: [{ qty: 1, price: 10 }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().due_date).toBeNull();
  });

  it("400s a ≤ 0 invoice total (C-180 NIT) with no insert", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: authedDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/invoices",
      payload: { customer_id: CUSTOMER, no: "INV-0", lines: [{ qty: 0, price: 0 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/greater than zero/);
    expect(inserted.find((i) => i.table === arInvoices)).toBeFalsy();
  });

  it("400s (fail closed) on a customer outside the tenant (no insert)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [customers, []], // customer absent → foreign
            [users, [userRow]],
            [roles, [roleRow(true)]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/invoices",
      payload: { customer_id: CUSTOMER, no: "INV-1", lines: [{ qty: 1, price: 10 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/customer not found/);
    expect(inserted).toHaveLength(0);
  });

  it("400s when no is missing (ar_invoice.no is NOT NULL)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: authedDb() })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/invoices",
      payload: { customer_id: CUSTOMER, lines: [{ qty: 1, price: 10 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/no is required/);
  });

  it("records an AuditLog row on a successful create, and is silent on a 4xx guard", async () => {
    const fired: AuditRecord[] = [];
    const okRes = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: authedDb(),
        auditSink: (r) => { fired.push(r); },
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/invoices",
      payload: { customer_id: CUSTOMER, no: "INV-A", lines: [{ qty: 1, price: 10 }] },
    });
    expect(okRes.statusCode).toBe(201);
    expect(fired).toHaveLength(1);

    const silent: AuditRecord[] = [];
    const badRes = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[customers, []], [users, [userRow]], [roles, [roleRow(true)]]],
        }),
        auditSink: (r) => { silent.push(r); },
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/invoices",
      payload: { customer_id: CUSTOMER, no: "INV-A", lines: [{ qty: 1, price: 10 }] },
    });
    expect(badRes.statusCode).toBe(400);
    expect(silent).toHaveLength(0);
  });
});

// ===========================================================================
// POST /ar/rv  (Wave-0 guards, round-A paid-flip + source)
// ===========================================================================
describe("POST /api/v1/ar/rv", () => {
  const INV = arInvoice(INV0, { amount: "1000.00", vat: "70.00" }); // total 1070
  const rvDb = (
    priorRvs: (typeof rvs.$inferSelect)[],
    inserted: Inserted[] = [],
    updated: Updated[] = [],
  ) =>
    stubDb({
      rows: [
        [arInvoices, [INV]],
        [rvs, priorRvs],
        [users, [userRow]],
        [roles, [roleRow(true)]],
      ],
      inserted,
      updated,
    });

  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/ar/rv",
      payload: { invoice_id: INV0, amount: 100 },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s a caller without the finance.create perm (fail closed)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[arInvoices, [INV]], [users, [userRow]], [roles, [roleRow(false)]]],
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/rv",
      payload: { invoice_id: INV0, amount: 100 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance create permission/);
  });

  it("404s (fail closed) an invoice outside the tenant (no insert)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[arInvoices, []], [users, [userRow]], [roles, [roleRow(true)]]],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/rv",
      payload: { invoice_id: INV0, amount: 100 },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    expect(inserted).toHaveLength(0);
  });

  it("400s when amount is not positive", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: rvDb([]) })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/rv",
      payload: { invoice_id: INV0, amount: 0 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/amount is required/);
  });

  it("409s an over-allocation (Wei C-176 — REJECT, never clamp): amount > outstanding", async () => {
    // outstanding = (1000 + 70) − Σ(prior rv 1000) = 70; a 100 receipt over-pays.
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rvDb([rvSeed(RV0, { amount: "1000.00" })], inserted),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/rv",
      payload: { invoice_id: INV0, amount: 100 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
    expect(inserted).toHaveLength(0);
  });

  it("P2-BE-52 RV round2: a sub-cent over (1070.004 vs outstanding 1070) settles, not 409", async () => {
    // No prior rv → outstanding = 1070.00. round2(1070.004) = 1070.00 ≤ outstanding,
    // so it SETTLES (201) + flips the invoice paid — the raw client float would
    // have false-rejected (1070.004 > 1070.00 → 409). Money stays 2-dp minor-unit.
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rvDb([], inserted, updated),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/rv",
      payload: { invoice_id: INV0, amount: 1070.004 },
    });
    expect(res.statusCode).toBe(201);
    const ins = inserted.find((i) => i.table === rvs);
    expect((ins!.values as Record<string, unknown>).amount).toBe("1070.00"); // round2 stored
    // Σ rv (1070.00) ≥ amount+vat (1070) → invoice flips paid.
    const flip = updated.find((u) => u.table === arInvoices);
    expect(flip!.set.status).toBe("paid");
  });

  it("creates the RV (201) within outstanding — source='invoice', no paid-flip yet", async () => {
    // outstanding = 70; a 50 receipt → total received 1050 < 1070 → stays open.
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rvDb([rvSeed(RV0, { amount: "1000.00" })], inserted, updated),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/rv",
      payload: { invoice_id: INV0, amount: 50, method: "cash" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.amount).toBe(50);
    expect(body.invoice_id).toBe(INV0);
    expect(body.method).toBe("cash");
    expect(body.source).toBe("invoice");
    const ins = inserted.find((i) => i.table === rvs);
    const rv = ins!.values as Record<string, unknown>;
    expect(rv.companyId).toBe(COMPANY);
    expect(rv.amount).toBe("50.00");
    expect(rv.invoiceId).toBe(INV0);
    expect(rv.currencyCode).toBe("THB"); // inherited from the invoice
    expect(rv.source).toBe("invoice");
    // Not fully paid → the invoice status is NOT flipped.
    expect(updated.find((u) => u.table === arInvoices)).toBeFalsy();
  });

  it("flips the invoice to paid when Σ rv covers amount + vat (Q4 paid-flip)", async () => {
    // outstanding = 70; a 70 receipt → total received 1070 ≥ 1070 → status=paid.
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rvDb([rvSeed(RV0, { amount: "1000.00" })], inserted, updated),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/rv",
      payload: { invoice_id: INV0, amount: 70 },
    });
    expect(res.statusCode).toBe(201);
    const flip = updated.find((u) => u.table === arInvoices);
    expect(flip).toBeTruthy();
    expect(flip!.set.status).toBe("paid");
  });

  it("does not fire an AuditLog row on a rejected (409) receipt", async () => {
    const fired: AuditRecord[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rvDb([rvSeed(RV0, { amount: "1000.00" })]),
        auditSink: (r) => { fired.push(r); },
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/rv",
      payload: { invoice_id: INV0, amount: 100 },
    });
    expect(res.statusCode).toBe(409);
    expect(fired).toHaveLength(0);
  });

  it("binds company_id on the invoice read (tenant scope)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[arInvoices, [INV]], [rvs, []], [users, [userRow]], [roles, [roleRow(true)]]],
          captured,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/rv",
      payload: { invoice_id: INV0, amount: 50 },
    });
    const read = captured.find((c) => c.table === arInvoices);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
  });
});

// ===========================================================================
// GET /ar/invoices
// ===========================================================================
describe("GET /api/v1/ar/invoices", () => {
  const invJan = arInvoice("inv-jan", {
    status: "open",
    etaxStatus: "queued",
    customerId: CUSTOMER,
    amount: "1000.00",
    vat: "70.00",
    createdAt: new Date("2024-01-10T00:00:00Z"),
  });
  const invFeb = arInvoice("inv-feb", {
    status: "paid",
    etaxStatus: "sent",
    customerId: "cust-other",
    amount: "500.00",
    vat: "35.00",
    createdAt: new Date("2024-02-10T00:00:00Z"),
  });
  const listDb = () =>
    stubDb({
      rows: [
        [arInvoices, [invJan, invFeb]],
        [rvs, [rvSeed("rv-a", { invoiceId: "inv-jan", amount: "200.00" })]],
      ],
    });

  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/ar/invoices" });
    expect(res.statusCode).toBe(401);
  });

  it("envelopes the rows newest-first with outstanding = amount + vat − Σ rv", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: listDb() })
    ).inject({ method: "GET", url: "/api/v1/ar/invoices" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("inv-feb"); // newest first (Feb > Jan)
    const jan = body.data.find((r: Record<string, unknown>) => r.id === "inv-jan");
    expect(jan.outstanding).toBe(870); // 1000 + 70 − 200
    const feb = body.data.find((r: Record<string, unknown>) => r.id === "inv-feb");
    expect(feb.outstanding).toBe(535); // 500 + 35 − 0
  });

  it("filters by status", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: listDb() })
    ).inject({ method: "GET", url: "/api/v1/ar/invoices?status=open" });
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("inv-jan");
  });

  it("filters by etax_status (dual-serves the e-Tax queue)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: listDb() })
    ).inject({ method: "GET", url: "/api/v1/ar/invoices?etax_status=sent" });
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("inv-feb");
  });

  it("filters by customer_id", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: listDb() })
    ).inject({ method: "GET", url: `/api/v1/ar/invoices?customer_id=${CUSTOMER}` });
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("inv-jan");
  });

  it("filters by period ('YYYY-MM' on createdAt CE month)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: listDb() })
    ).inject({ method: "GET", url: "/api/v1/ar/invoices?period=2024-02" });
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("inv-feb");
  });
});

// ===========================================================================
// GET /ar/rv
// ===========================================================================
describe("GET /api/v1/ar/rv", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/ar/rv" });
    expect(res.statusCode).toBe(401);
  });

  it("envelopes the receipts with no/receipt_date/status/source", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[rvs, [rvSeed(RV0, { amount: "1070.00" })]]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/ar/rv" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    const rv = body.data[0];
    expect(rv.amount).toBe(1070);
    expect(rv.no).toBe("RV-2026-0001");
    expect(rv.receipt_date).toBe("2026-05-01");
    expect(rv.status).toBe("open");
    expect(rv.source).toBe("invoice");
  });
});

// ===========================================================================
// GET /ar/aging
// ===========================================================================
describe("GET /api/v1/ar/aging", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/ar/aging" });
    expect(res.statusCode).toBe(401);
  });

  it("buckets NON-paid invoices by days-overdue (single EntityOk object, not enveloped)", async () => {
    const invCurrent = arInvoice("inv-cur", { status: "open", dueDate: null, amount: "1000.00", vat: "0" });
    const invOld = arInvoice("inv-old", { status: "open", dueDate: "2020-01-01", amount: "500.00", vat: "0" });
    const invPaid = arInvoice("inv-paid", { status: "paid", dueDate: "2020-01-01", amount: "999.00", vat: "0" });
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[arInvoices, [invCurrent, invOld, invPaid]], [rvs, []]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/ar/aging" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.buckets)).toBe(true);
    expect(body.data).toBeUndefined(); // NOT the list envelope
    const bucket = (name: string) => body.buckets.find((b: Record<string, unknown>) => b.bucket === name);
    expect(bucket("current")).toEqual({ bucket: "current", count: 1, amount: 1000 });
    expect(bucket("90+")).toEqual({ bucket: "90+", count: 1, amount: 500 });
    expect(body.total_outstanding).toBe(1500); // paid invoice excluded
    expect(body.currency_code).toBe("THB");
  });
});

// ===========================================================================
// GET /ar/cn  +  POST /ar/cn
// ===========================================================================
describe("GET /api/v1/ar/cn", () => {
  it("envelopes credit notes with a DERIVED vat = amount × 7/107", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[arCreditNotes, [cnSeed(CN0, { amount: "107.00" })]]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/ar/cn" });
    expect(res.statusCode).toBe(200);
    const cn = res.json().data[0];
    expect(cn.amount).toBe(107);
    expect(cn.vat).toBe(7); // 107 × 7/107 (VAT-inclusive extraction)
  });
});

describe("POST /api/v1/ar/cn", () => {
  const createDb = (inserted: Inserted[] = [], dup: (typeof arCreditNotes.$inferSelect)[] = []) =>
    stubDb({
      rows: [
        [customers, [customerRow]],
        [arInvoices, [arInvoice(INV0)]],
        [arCreditNotes, dup],
        [users, [userRow]],
        [roles, [roleRow(true)]],
      ],
      inserted,
    });

  it("403s without the finance.create perm", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[customers, [customerRow]], [arInvoices, [arInvoice(INV0)]], [users, [userRow]], [roles, [roleRow(false)]]],
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/cn",
      payload: { no: "CN-1", customer_id: CUSTOMER, ref_invoice_id: INV0, amount: 100 },
    });
    expect(res.statusCode).toBe(403);
  });

  it("creates the credit note (201) stored as-is + wire vat derived", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: createDb(inserted) })
    ).inject({
      method: "POST",
      url: "/api/v1/ar/cn",
      payload: { no: "CN-2026-0009", customer_id: CUSTOMER, ref_invoice_id: INV0, amount: 214, reason: "คืนของ" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.no).toBe("CN-2026-0009");
    expect(body.amount).toBe(214);
    expect(body.vat).toBe(14); // 214 × 7/107
    const ins = inserted.find((i) => i.table === arCreditNotes);
    const cn = ins!.values as Record<string, unknown>;
    expect(cn.companyId).toBe(COMPANY);
    expect(cn.amount).toBe("214.00");
    expect(cn.currencyCode).toBe("THB");
  });

  it("400 no missing / 400 customer foreign / 404 invoice foreign / 409 duplicate no / 400 amount ≤ 0", async () => {
    const post = async (db: Db, payload: Record<string, unknown>) =>
      (await buildTestApp({ resolveTenant: async () => SESSION, db })).inject({
        method: "POST",
        url: "/api/v1/ar/cn",
        payload,
      });
    const good = { no: "CN-X", customer_id: CUSTOMER, ref_invoice_id: INV0, amount: 100 };

    const noMissing = await post(createDb(), { ...good, no: "" });
    expect(noMissing.statusCode).toBe(400);
    expect(noMissing.json().message).toMatch(/no is required/);

    const custForeign = await post(
      stubDb({ rows: [[customers, []], [arInvoices, [arInvoice(INV0)]], [users, [userRow]], [roles, [roleRow(true)]]] }),
      good,
    );
    expect(custForeign.statusCode).toBe(400);
    expect(custForeign.json().message).toMatch(/customer not found/);

    const invForeign = await post(
      stubDb({ rows: [[customers, [customerRow]], [arInvoices, []], [users, [userRow]], [roles, [roleRow(true)]]] }),
      good,
    );
    expect(invForeign.statusCode).toBe(404);

    const dup = await post(createDb([], [cnSeed(CN0)]), good);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().message).toMatch(/already exists/);

    const zero = await post(createDb(), { ...good, amount: 0 });
    expect(zero.statusCode).toBe(400);
    expect(zero.json().message).toMatch(/greater than zero/);
  });
});

// ===========================================================================
// POST /ar/cn/{id}/approve
// ===========================================================================
describe("POST /api/v1/ar/cn/:id/approve", () => {
  // jvs is read twice: idempotency (source_doc `cn:...`) → none; insertThrough
  // ownership (jv id + company) + allocJvNo (all) → an owned row.
  const jvSource = (where: SQL | undefined): unknown[] => {
    const isIdempotencyProbe = paramsOf(where).some(
      (p) => typeof p === "string" && p.startsWith("cn:"),
    );
    return isIdempotencyProbe ? [] : [{ id: "jv-owned", companyId: COMPANY }];
  };
  const approveDb = (
    opts: {
      cn?: (typeof arCreditNotes.$inferSelect)[];
      jv?: RowSource;
      coa?: unknown[];
      inserted?: Inserted[];
      approve?: boolean;
    } = {},
  ) =>
    stubDb({
      rows: [
        [arCreditNotes, opts.cn ?? [cnSeed(CN0, { amount: "107.00" })]],
        [jvs, opts.jv ?? jvSource],
        [glAccounts, opts.coa ?? coaRows],
        [users, [userRow]],
        [roles, [roleRow(true, opts.approve ?? true)]],
      ],
      inserted: opts.inserted,
    });

  it("403s without the finance.approve perm (fail closed)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: approveDb({ approve: false }) })
    ).inject({ method: "POST", url: `/api/v1/ar/cn/${CN0}/approve` });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance approve permission/);
  });

  it("404s a credit note outside the tenant", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: approveDb({ cn: [] }) })
    ).inject({ method: "POST", url: `/api/v1/ar/cn/${CN0}/approve` });
    expect(res.statusCode).toBe(404);
  });

  it("posts a BALANCED reversal JV (Dr revenue net + Dr VAT / Cr AR) — server VAT = amount × 7/107", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: approveDb({ inserted }) })
    ).inject({ method: "POST", url: `/api/v1/ar/cn/${CN0}/approve` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(CN0);
    expect(body.amount).toBe(107);
    expect(body.vat).toBe(7); // 107 × 7/107
    expect(body.jv_no).toBe(`JV-${new Date().getFullYear()}-0001`);

    const jvIns = inserted.find((i) => i.table === jvs);
    expect(jvIns).toBeTruthy();
    expect((jvIns!.values as Record<string, unknown>).sourceDoc).toBe(`cn:${CN0}`);

    const lineIns = inserted.find((i) => i.table === jvLines);
    const lines = lineIns!.values as Record<string, unknown>[];
    expect(lines).toHaveLength(3);
    const sumDr = lines.reduce((s, l) => s + Number(l.dr), 0);
    const sumCr = lines.reduce((s, l) => s + Number(l.cr), 0);
    expect(sumDr).toBe(107); // net 100 + vat 7
    expect(sumCr).toBe(107); // AR 107 — BALANCED (C9)
    // Dr revenue = net 100, Dr VAT-output = 7, Cr AR = 107.
    expect(lines.find((l) => l.accountId === ACC_REVENUE)!.dr).toBe("100.00");
    expect(lines.find((l) => l.accountId === ACC_VATOUT)!.dr).toBe("7.00");
    expect(lines.find((l) => l.accountId === ACC_AR)!.cr).toBe("107.00");
  });

  it("409s (idempotent) when a reversal JV already carries source_doc cn:<id>", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: approveDb({ jv: [{ id: "jv-prior", companyId: COMPANY, sourceDoc: `cn:${CN0}` }], inserted }),
      })
    ).inject({ method: "POST", url: `/api/v1/ar/cn/${CN0}/approve` });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already approved/);
    expect(inserted.find((i) => i.table === jvs)).toBeFalsy(); // no double post
  });

  it("409s a concurrent double-approve (23505 on the source_doc index → idempotent)", async () => {
    // The CN passes the in-memory pre-check (no prior cn:<id> jv), but a racing
    // approve committed first → the 0037 source_doc UNIQUE index trips 23505 in the
    // tx. P2-BE-52: the handler maps it to the same 409, never a 500.
    const base = approveDb({});
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
    ).inject({ method: "POST", url: `/api/v1/ar/cn/${CN0}/approve` });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already approved/);
  });

  it("409s honestly when the tenant COA lacks a required posting account (never invents)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: approveDb({ coa: [{ id: ACC_REVENUE, companyId: COMPANY, code: "4010", name: "รายได้" }] }), // missing VAT + AR
      })
    ).inject({ method: "POST", url: `/api/v1/ar/cn/${CN0}/approve` });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/missing a required posting account/);
  });
});

// ===========================================================================
// GET /ar/tax-register  +  POST /ar/tax-register/{id}/cancel
// ===========================================================================
describe("GET /api/v1/ar/tax-register", () => {
  const invJan = arInvoice("tax-jan", { amount: "1000.00", vat: "70.00", status: "open", etaxStatus: "queued", createdAt: new Date("2024-01-10T00:00:00Z") });
  const invFeb = arInvoice("tax-feb", { amount: "500.00", vat: "35.00", status: "paid", etaxStatus: "sent", createdAt: new Date("2024-02-10T00:00:00Z") });

  it("derives one tax row per invoice with total = amount + vat, newest-first", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[arInvoices, [invJan, invFeb]]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/ar/tax-register" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data[0].id).toBe("tax-feb"); // newest first
    const jan = body.data.find((r: Record<string, unknown>) => r.id === "tax-jan");
    expect(jan.total).toBe(1070); // 1000 + 70
    expect(jan.status).toBe("open");
    expect(jan.etax_status).toBe("queued");
  });

  it("filters by period", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[arInvoices, [invJan, invFeb]]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/ar/tax-register?period=2024-01" });
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("tax-jan");
  });
});

describe("POST /api/v1/ar/tax-register/:id/cancel", () => {
  const cancelDb = (inv: (typeof arInvoices.$inferSelect)[] = [arInvoice(INV0)], updated: Updated[] = [], approve = true) =>
    stubDb({
      rows: [[arInvoices, inv], [users, [userRow]], [roles, [roleRow(true, approve)]]],
      updated,
    });

  it("403s without the finance.approve perm", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: cancelDb(undefined, [], false) })
    ).inject({ method: "POST", url: `/api/v1/ar/tax-register/${INV0}/cancel` });
    expect(res.statusCode).toBe(403);
  });

  it("404s an invoice outside the tenant", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: cancelDb([]) })
    ).inject({ method: "POST", url: `/api/v1/ar/tax-register/${INV0}/cancel` });
    expect(res.statusCode).toBe(404);
  });

  it("voids the invoice e-Tax (etax_status='void') and returns ActionOk", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: cancelDb([arInvoice(INV0)], updated) })
    ).inject({ method: "POST", url: `/api/v1/ar/tax-register/${INV0}/cancel` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: INV0, etax_status: "void" });
    const upd = updated.find((u) => u.table === arInvoices);
    expect(upd!.set.etaxStatus).toBe("void");
  });
});

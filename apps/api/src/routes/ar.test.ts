// G3 unit tests (PLAN.md §9) — AR handlers (Phase-3 Finance Wave-0, AR + e-Tax).
// Covers POST /ar/invoices (financial-authz finance.create, SERVER money
// authority — a bogus client amount/vat is IGNORED, amount = Σ qty×price + vat =
// 7% via @juneflow/tax-engine.calcVat, customer tenant-scope, etax_status queued
// on create) and POST /ar/rv (financial-authz, invoice tenant-scope 404, amount
// > 0, the over-allocation guard — Wei C-176 REJECT-not-clamp 409, the outstanding
// math amount+vat − Σrv, within-outstanding create). Every expected value comes
// from the stub / the real tax-engine — never hand-computed against the impl.
//
// The routes are registered onto the built app in buildTestApp (app.ts wiring is
// the orchestrator's; these tests do not touch it). The root tenant-scope + audit
// hooks apply to the late-registered child plugin exactly as to the wired routes.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { arInvoices, customers, roles, rvs, users } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";
import type { AuditRecord } from "../plugins/audit-log.js";
import { registerArRoute } from "./ar.js";

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
interface StubOpts {
  rows: Array<[unknown, unknown[]]>;
  captured?: Captured[];
  inserted?: Inserted[];
}

/** Db stub: canned rows per table (reads) + write capture (mirrors ap.test.ts). */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [] } = opts;
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  const builderFor = (table: unknown) => {
    const builder = {
      $dynamic: () => builder,
      innerJoin: () => builder,
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
  let seq = 0;
  const raw: Record<string, unknown> = {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          inserted.push({ table, values });
          return Promise.resolve([{ id: `new-${seq++}`, createdAt: D, ...values }]);
        },
      }),
    }),
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
  // AR routes are wired in app.ts (registerArRoute) → buildApp already mounts
  // them; no local re-registration (that would double-declare the routes).
  return app;
}

// --- seed-shaped canned rows ------------------------------------------------
const CUSTOMER = "cust0000-0000-0000-0000-0000000000c1";
const INV0 = "inv00000-0000-0000-0000-0000000000i0";
const RV0 = "rv000000-0000-0000-0000-0000000000r0";

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
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof rvs.$inferSelect;

const userRow = {
  id: "u-0",
  companyId: COMPANY,
  email: "suda@rungrueang.co.th",
  name: "สุดา",
  roleId: "role-0",
  status: "active",
};
/** A role carrying (or not) the finance.create perm. */
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

// ===========================================================================
// POST /ar/invoices
// ===========================================================================
describe("POST /api/v1/ar/invoices", () => {
  const authedDb = (inserted: Inserted[] = [], captured: Captured[] = []) =>
    stubDb({
      rows: [
        [customers, [customerRow]],
        [users, [userRow]],
        [roles, [roleRow(true)]],
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
            [roles, [roleRow(false)]], // finance.create = false
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
        // Attacker-supplied money — MUST be ignored (B-107a · Wei C-176).
        amount: 999999,
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
    expect(body.no).toBe("INV-2026-0419");
    const ins = inserted.find((i) => i.table === arInvoices);
    expect(ins).toBeTruthy();
    expect(ins!.values.companyId).toBe(COMPANY); // force-set by the scoped insert
    expect(ins!.values.amount).toBe("200000.00");
    expect(ins!.values.vat).toBe("14000.00");
    expect(ins!.values.etaxStatus).toBe("queued");
    // The lines are the money INPUT only — ar_invoice_line is post-Wave-0.
    expect(ins!.values).not.toHaveProperty("lines");
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

  it("400s when no is missing (ar_invoice.no is NOT NULL, Wave-0 client-supplied)", async () => {
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
    expect(silent).toHaveLength(0); // audit never fires on a rejected mutation
  });
});

// ===========================================================================
// POST /ar/rv
// ===========================================================================
describe("POST /api/v1/ar/rv", () => {
  // An invoice worth amount 1000 + vat 70 = 1070 outstanding, less any prior rv.
  const INV = arInvoice(INV0, { amount: "1000.00", vat: "70.00" });
  const rvDb = (
    priorRvs: (typeof rvs.$inferSelect)[],
    inserted: Inserted[] = [],
  ) =>
    stubDb({
      rows: [
        [arInvoices, [INV]],
        [rvs, priorRvs],
        [users, [userRow]],
        [roles, [roleRow(true)]],
      ],
      inserted,
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
          rows: [
            [arInvoices, [INV]],
            [users, [userRow]],
            [roles, [roleRow(false)]],
          ],
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
          rows: [
            [arInvoices, []], // invoice absent → foreign
            [users, [userRow]],
            [roles, [roleRow(true)]],
          ],
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
    expect(inserted).toHaveLength(0); // no partial create
  });

  it("creates the RV (201) when the amount is within the outstanding balance", async () => {
    // outstanding = 70; a 50 receipt is within it → inserted, currency from invoice.
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rvDb([rvSeed(RV0, { amount: "1000.00" })], inserted),
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
    const ins = inserted.find((i) => i.table === rvs);
    expect(ins).toBeTruthy();
    expect(ins!.values.companyId).toBe(COMPANY);
    expect(ins!.values.amount).toBe("50.00");
    expect(ins!.values.invoiceId).toBe(INV0);
    expect(ins!.values.currencyCode).toBe("THB"); // inherited from the invoice
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
          rows: [
            [arInvoices, [INV]],
            [rvs, []],
            [users, [userRow]],
            [roles, [roleRow(true)]],
          ],
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

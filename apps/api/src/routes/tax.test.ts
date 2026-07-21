// G3 unit tests (PLAN.md §9) — tax-report handlers (Phase-3 Finance round-A).
// Covers GET /tax/reports/vat (output − input net, period filter, tenant-scoped
// Σ, honest-empty) and GET /tax/reports/wht (ภ.ง.ด.3/53 split by the vendor
// tax_id-length heuristic, wht>0 gating, honest-empty). Every expected figure is
// a real Σ over the stub's canned numeric-column rows — no value is a client
// input (both endpoints are GETs) and none is hand-computed against the impl.
//
// The tax routes are wired in app.ts (registerTaxRoute) → buildApp mounts them
// under /api/v1; the root tenant-scope hook decorates request.db, so the tests
// exercise the real fail-closed path.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { apBillings, arInvoices, vendors } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "anan@rungrueang.co.th", name: "อนันต์" },
};
const D = new Date(1_700_000_000_000);

interface Captured {
  table: unknown;
  joins: unknown[];
  where: SQL | undefined;
}
interface StubOpts {
  rows: Array<[unknown, unknown[]]>;
  captured?: Captured[];
}

/** Db stub: canned rows per table (reads via the scoped select .where door). */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [] } = opts;
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
  return {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
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
  // Tax routes are wired in app.ts (registerTaxRoute) → buildApp already mounts
  // them under /api/v1; no sibling registration here (would double-declare).
  return app;
}

// --- seed-shaped canned rows ------------------------------------------------
const VEN_CO = "ven00000-0000-0000-0000-00000000000c"; // company payee (13-digit)
const VEN_IND = "ven00000-0000-0000-0000-00000000000d"; // individual payee (no tax_id)

const arRow = (
  extra: Partial<typeof arInvoices.$inferSelect> = {},
): typeof arInvoices.$inferSelect =>
  ({
    id: "ar-0",
    companyId: COMPANY,
    customerId: "cust-0",
    projectId: null,
    no: "INV-2026-0001",
    amount: "10000.00",
    vat: "700.00",
    currencyCode: "THB",
    creditTerm: 30,
    dueDate: null,
    status: "open",
    etaxStatus: "queued",
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof arInvoices.$inferSelect;

const apRow = (
  extra: Partial<typeof apBillings.$inferSelect> = {},
): typeof apBillings.$inferSelect =>
  ({
    id: "ap-0",
    companyId: COMPANY,
    poId: null,
    grId: null,
    vendorId: VEN_CO,
    invoiceNo: "V-INV-1",
    dueDate: null,
    amount: "3000.00",
    vat: "210.00",
    wht: null,
    retention: null,
    currencyCode: "THB",
    status: "draft",
    kind: "progress",
    woId: null,
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof apBillings.$inferSelect;

const vendorRow = (
  id: string,
  taxId: string | null,
): typeof vendors.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    name: taxId ? "บริษัท เอ จำกัด" : "นายสมชาย",
    code: null,
    taxId,
    kind: "supplier",
    creditTerm: 30,
    addr: null,
    bank: null,
    status: "active",
    createdAt: D,
    updatedAt: D,
  }) as typeof vendors.$inferSelect;

// ===========================================================================
// GET /tax/reports/vat
// ===========================================================================
describe("GET /api/v1/tax/reports/vat", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/tax/reports/vat" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("net_vat = Σ output − Σ input over real stored rows (money = server Σ)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [
              arInvoices,
              [
                arRow({ id: "ar-1", amount: "10000.00", vat: "700.00" }),
                arRow({ id: "ar-2", amount: "5000.00", vat: "350.00" }),
              ],
            ],
            [
              apBillings,
              [
                apRow({ id: "ap-1", amount: "3000.00", vat: "210.00" }),
                apRow({ id: "ap-2", amount: "2000.00", vat: "140.00" }),
              ],
            ],
          ],
        }),
      })
    ).inject({ url: "/api/v1/tax/reports/vat" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.output_vat).toBe(1050); // 700 + 350
    expect(body.output_base).toBe(15000); // 10000 + 5000
    expect(body.input_vat).toBe(350); // 210 + 140
    expect(body.input_base).toBe(5000); // 3000 + 2000
    expect(body.net_vat).toBe(700); // 1050 − 350 (payable)
    expect(body.period).toBeNull();
    expect(body.currency_code).toBe("THB");
  });

  it("net_vat is negative (a VAT credit) when input exceeds output", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [arInvoices, [arRow({ vat: "100.00" })]],
            [apBillings, [apRow({ vat: "450.00" })]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/tax/reports/vat" });
    expect(res.json().net_vat).toBe(-350); // 100 − 450 = credit
  });

  it("binds company_id on the ar_invoice + ap_billing reads (tenant scope)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [arInvoices, [arRow()]],
            [apBillings, [apRow()]],
          ],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/tax/reports/vat" });
    const arRead = captured.find((c) => c.table === arInvoices);
    const apRead = captured.find((c) => c.table === apBillings);
    expect(paramsOf(arRead!.where)).toContain(COMPANY);
    expect(paramsOf(apRead!.where)).toContain(COMPANY);
  });

  it("?period filters to a single CE month (UTC), excluding other months", async () => {
    const may = new Date("2026-05-15T00:00:00Z");
    const jun = new Date("2026-06-10T00:00:00Z");
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [
              arInvoices,
              [
                arRow({ id: "ar-may", amount: "10000.00", vat: "700.00", createdAt: may }),
                arRow({ id: "ar-jun", amount: "9999.00", vat: "699.00", createdAt: jun }),
              ],
            ],
            [
              apBillings,
              [apRow({ id: "ap-may", amount: "3000.00", vat: "210.00", createdAt: may })],
            ],
          ],
        }),
      })
    ).inject({ url: "/api/v1/tax/reports/vat?period=2026-05" });

    const body = res.json();
    expect(body.output_vat).toBe(700); // only the May invoice
    expect(body.output_base).toBe(10000);
    expect(body.input_vat).toBe(210);
    expect(body.net_vat).toBe(490);
    expect(body.period).toBe("2026-05"); // echoes the param verbatim
  });

  it("empty → honest zeros, not fabricated figures (C10)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [] }),
      })
    ).inject({ url: "/api/v1/tax/reports/vat" });
    expect(res.json()).toEqual({
      output_vat: 0,
      output_base: 0,
      input_vat: 0,
      input_base: 0,
      net_vat: 0,
      period: null,
      currency_code: "THB",
    });
  });
});

// ===========================================================================
// GET /tax/reports/wht
// ===========================================================================
describe("GET /api/v1/tax/reports/wht", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/tax/reports/wht" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });

  it("splits ภ.ง.ด.3 / ภ.ง.ด.53 by the vendor tax_id-length heuristic", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [
              apBillings,
              [
                // company payee (13-digit tax_id) → ภ.ง.ด.53
                apRow({ id: "b-1", vendorId: VEN_CO, amount: "10000.00", wht: "300.00" }),
                // individual payee (no tax_id) → ภ.ง.ด.3
                apRow({ id: "b-2", vendorId: VEN_IND, amount: "5000.00", wht: "150.00" }),
                // wht null → NOT counted (only bills that withheld tax count)
                apRow({ id: "b-3", vendorId: VEN_CO, amount: "8000.00", wht: null }),
                // wht 0 → NOT counted
                apRow({ id: "b-4", vendorId: VEN_IND, amount: "2000.00", wht: "0.00" }),
              ],
            ],
            [
              vendors,
              [
                vendorRow(VEN_CO, "0105551234567"), // 13 digits → company
                vendorRow(VEN_IND, null), // no tax_id → individual
              ],
            ],
          ],
        }),
      })
    ).inject({ url: "/api/v1/tax/reports/wht" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pnd53).toEqual({ count: 1, wht: 300, base: 10000 });
    expect(body.pnd3).toEqual({ count: 1, wht: 150, base: 5000 });
    expect(body.total_wht).toBe(450); // 300 + 150
    expect(body.period).toBeNull();
    expect(body.currency_code).toBe("THB");
  });

  it("a short/blank tax_id falls to ภ.ง.ด.3 (individual) per the heuristic", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [apBillings, [apRow({ id: "b-1", vendorId: VEN_IND, amount: "4000.00", wht: "120.00" })]],
            [vendors, [vendorRow(VEN_IND, "12345")]], // short (non-13) → individual
          ],
        }),
      })
    ).inject({ url: "/api/v1/tax/reports/wht" });
    const body = res.json();
    expect(body.pnd3).toEqual({ count: 1, wht: 120, base: 4000 });
    expect(body.pnd53).toEqual({ count: 0, wht: 0, base: 0 });
  });

  it("?period filters the withholding rows to one CE month", async () => {
    const may = new Date("2026-05-15T00:00:00Z");
    const jun = new Date("2026-06-10T00:00:00Z");
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [
              apBillings,
              [
                apRow({ id: "b-may", vendorId: VEN_IND, amount: "4000.00", wht: "120.00", createdAt: may }),
                apRow({ id: "b-jun", vendorId: VEN_IND, amount: "9000.00", wht: "270.00", createdAt: jun }),
              ],
            ],
            [vendors, [vendorRow(VEN_IND, null)]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/tax/reports/wht?period=2026-05" });
    const body = res.json();
    expect(body.pnd3).toEqual({ count: 1, wht: 120, base: 4000 }); // only May
    expect(body.total_wht).toBe(120);
    expect(body.period).toBe("2026-05");
  });

  it("empty → honest zeros for both groups (C10)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [] }),
      })
    ).inject({ url: "/api/v1/tax/reports/wht" });
    expect(res.json()).toEqual({
      pnd3: { count: 0, wht: 0, base: 0 },
      pnd53: { count: 0, wht: 0, base: 0 },
      total_wht: 0,
      period: null,
      currency_code: "THB",
    });
  });
});

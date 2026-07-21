// G3 unit tests (PLAN.md §9) — e-Tax handlers (Phase-3 Finance Wave-0, AR +
// e-Tax). Covers POST /etax/send (financial-authz finance.create, the C4 state
// machine queued → sent flip in a B-097 transaction, already-sent left untouched,
// a foreign invoice_id silently ignored with no leak / no flip, ActionOk with the
// sent count) and GET /etax/status (the HONEST per-status aggregate — Wei B-124,
// only what etax_status really holds, never a fabricated RD ack). Expected values
// come from the stub — never hand-computed against the impl.
//
// The routes are registered onto the built app in buildTestApp (app.ts wiring is
// the orchestrator's). The root tenant-scope + audit hooks apply to the
// late-registered child plugin exactly as to the wired routes.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { arInvoices, roles, users } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";
import type { AuditRecord } from "../plugins/audit-log.js";
import { registerEtaxRoute } from "./etax.js";

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
interface Updated {
  table: unknown;
  set: Record<string, unknown>;
  where: SQL;
}
interface StubOpts {
  rows: Array<[unknown, unknown[]]>;
  captured?: Captured[];
  updated?: Updated[];
  updateBase?: Record<string, unknown>;
}

/** Db stub with the B-097 transaction door (mirrors bank.test.ts / gl.test.ts). */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], updated = [], updateBase = {} } = opts;
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
  const raw: Record<string, unknown> = {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
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
  // B-097: the transaction door runs its callback against this SAME stub, so the
  // writes inside the tx still capture into updated/captured (no real BEGIN/COMMIT).
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
const INV0 = "inv00000-0000-0000-0000-0000000000i0";
const INV1 = "inv00000-0000-0000-0000-0000000000i1";
const INV2 = "inv00000-0000-0000-0000-0000000000i2";
const INV3 = "inv00000-0000-0000-0000-0000000000i3";
const FOREIGN = "ffffffff-0000-0000-0000-00000000ffff";

const arInvoice = (
  id: string,
  etaxStatus: "queued" | "sent" | "rejected" | "void" = "queued",
): typeof arInvoices.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    customerId: "cust0000-0000-0000-0000-0000000000c1",
    projectId: null,
    no: `INV-${id.slice(-2)}`,
    amount: "728000.00",
    vat: "50960.00",
    currencyCode: "THB",
    creditTerm: 14,
    etaxStatus,
    createdAt: D,
    updatedAt: D,
  }) as typeof arInvoices.$inferSelect;

const userRow = {
  id: "u-0",
  companyId: COMPANY,
  email: "suda@rungrueang.co.th",
  name: "สุดา",
  roleId: "role-0",
  status: "active",
};
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
// POST /etax/send
// ===========================================================================
describe("POST /api/v1/etax/send", () => {
  const sendDb = (
    invoices: (typeof arInvoices.$inferSelect)[],
    updated: Updated[] = [],
    financeCreate = true,
  ) =>
    stubDb({
      rows: [
        [arInvoices, invoices],
        [users, [userRow]],
        [roles, [roleRow(financeCreate)]],
      ],
      updated,
    });

  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/etax/send",
      payload: { invoice_ids: [INV0] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s a caller without the finance.create perm (fail closed)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: sendDb([arInvoice(INV0, "queued")], [], /* financeCreate */ false),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/etax/send",
      payload: { invoice_ids: [INV0] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance create permission/);
  });

  it("400s on an empty invoice_ids array", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: sendDb([arInvoice(INV0, "queued")]),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/etax/send",
      payload: { invoice_ids: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/non-empty array/);
  });

  it("flips a queued invoice to sent (C4 state machine) and returns ActionOk with the count", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: sendDb([arInvoice(INV0, "queued")], updated),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/etax/send",
      payload: { invoice_ids: [INV0] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true); // ActionOk shape
    expect(body.sent).toBe(1);
    expect(body.invoice_ids).toEqual([INV0]);
    const flip = updated.find((u) => u.table === arInvoices);
    expect(flip).toBeTruthy();
    expect(flip!.set.etaxStatus).toBe("sent");
  });

  it("leaves an already-sent invoice untouched (queued→sent only; no flip)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: sendDb([arInvoice(INV0, "sent")], updated),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/etax/send",
      payload: { invoice_ids: [INV0] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sent).toBe(0);
    expect(updated.find((u) => u.table === arInvoices)).toBeUndefined(); // no flip
  });

  it("silently ignores a foreign invoice_id — no leak, no flip", async () => {
    // Only the tenant's queued INV0 is resolvable; the foreign id is never read
    // (tenant scope) and never flipped.
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: sendDb([arInvoice(INV0, "queued")], updated),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/etax/send",
      payload: { invoice_ids: [INV0, FOREIGN] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sent).toBe(1);
    expect(res.json().invoice_ids).toEqual([INV0]); // foreign id absent
    const flip = updated.find((u) => u.table === arInvoices);
    // The flip UPDATE scopes to the owned id only — the foreign id never appears.
    expect(paramsOf(flip!.where)).toContain(INV0);
    expect(paramsOf(flip!.where)).not.toContain(FOREIGN);
  });

  it("records an AuditLog row on a successful send, and is silent on a 4xx guard", async () => {
    const fired: AuditRecord[] = [];
    const okRes = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: sendDb([arInvoice(INV0, "queued")]),
        auditSink: (r) => { fired.push(r); },
      })
    ).inject({
      method: "POST",
      url: "/api/v1/etax/send",
      payload: { invoice_ids: [INV0] },
    });
    expect(okRes.statusCode).toBe(200);
    expect(fired).toHaveLength(1);

    const silent: AuditRecord[] = [];
    const badRes = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: sendDb([arInvoice(INV0, "queued")], [], /* financeCreate */ false),
        auditSink: (r) => { silent.push(r); },
      })
    ).inject({
      method: "POST",
      url: "/api/v1/etax/send",
      payload: { invoice_ids: [INV0] },
    });
    expect(badRes.statusCode).toBe(403);
    expect(silent).toHaveLength(0);
  });
});

// ===========================================================================
// GET /etax/status
// ===========================================================================
describe("GET /api/v1/etax/status", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/etax/status" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the honest per-status aggregate (count of ar_invoice by etax_status)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [
              arInvoices,
              [
                arInvoice(INV0, "queued"),
                arInvoice(INV1, "queued"),
                arInvoice(INV2, "sent"),
                arInvoice(INV3, "void"),
              ],
            ],
          ],
        }),
      })
    ).inject({ url: "/api/v1/etax/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const byStatus = new Map<string, number>(
      body.data.map((r: { etax_status: string; count: number }) => [r.etax_status, r.count]),
    );
    expect(byStatus.get("queued")).toBe(2);
    expect(byStatus.get("sent")).toBe(1);
    expect(byStatus.get("rejected")).toBe(0); // 0-count bucket included (domain complete)
    expect(byStatus.get("void")).toBe(1);
    // One row per enum value (queued | sent | rejected | void).
    expect(body.total).toBe(4);
  });

  it("binds company_id on the ar_invoice read (tenant scope)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[arInvoices, [arInvoice(INV0, "queued")]]], captured }),
      })
    ).inject({ url: "/api/v1/etax/status" });
    const read = captured.find((c) => c.table === arInvoices);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
  });
});

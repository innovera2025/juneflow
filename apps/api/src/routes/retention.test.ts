// G3 unit tests (PLAN.md §9) — retention handlers (Phase-3 Finance, P2-BE-53).
// Covers the retention register (STORED columns + joined vendor_name /
// contract_value + server-computed remaining + DERIVED due_date/status) and the
// release action: a first-tranche release posts a balanced Dr 2030 / Cr 1020 JV,
// flips the ledger (returned := withheld, status := 'released'), keys the source_doc
// `ret:<id>:1`, and is gated fail-closed (finance.approve · held+due-12mo ·
// balance>0 · COA present) + race-safe (23505 → 409). Every expected value comes
// from the stub — no value is hand-computed against the impl, EXCEPT the
// server-authority contracts under test (balance = withheld − returned, the
// Dr 2030 / Cr 1020 direction, and the due = created_at + 12 months derivation).
//
// The routes are registered onto the built app in buildTestApp via a late child
// plugin (app.ts wiring — registerRetentionRoute — is the orchestrator's); the root
// tenant-scope + audit hooks apply to it exactly as to the wired routes.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  glAccounts,
  jvLines,
  jvs,
  retentionLedgers,
  roles,
  subconContracts,
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

/** Db stub: canned rows per table (reads, incl. selectThrough joins) + write capture. */
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
  // Retention routes are wired in app.ts (registerRetentionRoute) → buildApp already
  // mounts them under /api/v1; no sibling registration here (would double-declare).
  await app.ready();
  return app;
}

// --- seed-shaped canned rows ------------------------------------------------
const LEDGER0 = "ret00000-0000-0000-0000-0000000000l0";
const VENDOR0 = "ven00000-0000-0000-0000-0000000000v0";
const CONTRACT0 = "sub00000-0000-0000-0000-0000000000c0";
const WO0 = "wo000000-0000-0000-0000-0000000000w0";
// The two REAL COA accounts the retention release posts against (Dr 2030 / Cr 1020).
const ACC_RET = "acc00000-0000-0000-0000-000000002030"; // 2030 retention-payable
const ACC_BANK = "acc00000-0000-0000-0000-000000001020"; // 1020 bank

const retRow = (
  id: string,
  extra: Partial<typeof retentionLedgers.$inferSelect> = {},
): typeof retentionLedgers.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    woId: WO0,
    vendorId: VENDOR0,
    contractId: CONTRACT0,
    scope: "งานงวดที่ 1",
    rate: "5.00",
    withheld: "40000.00",
    returned: "0.00",
    currencyCode: "THB",
    dueDate: null,
    status: "held",
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof retentionLedgers.$inferSelect;

const vendorRow = {
  id: VENDOR0,
  companyId: COMPANY,
  name: "หจก. ช่างเอกก่อสร้าง",
  code: "V-0001",
  taxId: null,
  kind: "subcon",
  creditTerm: null,
  addr: null,
  bank: null,
  status: "active",
  createdAt: D,
  updatedAt: D,
};

// subcon_contract has no company_id — it resolves through project via selectThrough.
const contractRow = {
  id: CONTRACT0,
  vendorId: VENDOR0,
  projectId: "proj-0",
  no: "SC-2026-0001",
  value: "1500000.00",
  currencyCode: "THB",
  retentionPct: "5.000",
  start: null,
  end: null,
  createdAt: D,
  updatedAt: D,
};

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
/** A role carrying (or not) the finance.approve perm the release gate reads. */
const roleRow = (financeApprove = true) => ({
  id: "role-0",
  companyId: COMPANY,
  name: "Finance",
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
/** Both posting accounts present (the happy path resolves the 2030/1020 map). */
const COA_ROWS = [
  glAcc(ACC_RET, "2030", "เจ้าหนี้เงินประกันผลงาน"),
  glAcc(ACC_BANK, "1020", "เงินฝากธนาคาร"),
];

// jvs is read up to three times in a release: the idempotency probe (source_doc
// `ret:...`) → none; allocJvNo + insertThrough ownership (all/owned) → the seed.
const jvSource = (where: SQL | undefined): unknown[] => {
  const isIdempotencyProbe = paramsOf(where).some(
    (p) => typeof p === "string" && p.startsWith("ret:"),
  );
  return isIdempotencyProbe ? [] : [jvSeed];
};

// ===========================================================================
// GET /retention
// ===========================================================================
describe("GET /api/v1/retention", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/retention" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("returns the B-014 envelope — stored columns + joined vendor/contract + derived due_date & remaining", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [retentionLedgers, [retRow(LEDGER0)]],
            [vendors, [vendorRow]],
            [subconContracts, [contractRow]],
          ],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/retention" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    const r = body.data[0];
    // STORED columns.
    expect(r.id).toBe(LEDGER0);
    expect(r.wo_id).toBe(WO0);
    expect(r.vendor_id).toBe(VENDOR0);
    expect(r.contract_id).toBe(CONTRACT0);
    expect(r.scope).toBe("งานงวดที่ 1");
    expect(r.rate).toBe(5);
    expect(r.withheld).toBe(40_000);
    expect(r.returned).toBe(0);
    expect(r.currency_code).toBe("THB");
    // HONEST-JOINED.
    expect(r.vendor_name).toBe("หจก. ช่างเอกก่อสร้าง");
    expect(r.contract_value).toBe(1_500_000); // subcon_contract.value, joined
    // SERVER-computed remaining.
    expect(r.remaining).toBe(40_000);
    // DERIVED due_date = created_at (2023-11-14) + 12 months (the seed column is null).
    expect(r.due_date).toBe("2024-11-14");
    // company_id bound on the retention_ledger read (tenant scope).
    const read = captured.find((c) => c.table === retentionLedgers);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
  });

  it("derives the display status honestly from the real columns (holding / partial / done / due)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [
              retentionLedgers,
              [
                // future due, nothing returned → still holding.
                retRow("ret-holding", { id: "ret-holding", dueDate: "2099-01-01", returned: "0.00" }),
                // partly returned → partial.
                retRow("ret-partial", { id: "ret-partial", returned: "10000.00" }),
                // fully returned → done.
                retRow("ret-done", { id: "ret-done", returned: "40000.00" }),
                // past due, still outstanding → due.
                retRow("ret-due", { id: "ret-due", dueDate: "2020-01-01", returned: "0.00" }),
              ],
            ],
            [vendors, [vendorRow]],
            [subconContracts, [contractRow]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/retention" });
    const byId = Object.fromEntries(
      res.json().data.map((r: Record<string, unknown>) => [r.id, r.status]),
    );
    expect(byId["ret-holding"]).toBe("holding");
    expect(byId["ret-partial"]).toBe("partial");
    expect(byId["ret-done"]).toBe("done");
    expect(byId["ret-due"]).toBe("due");
  });

  it("emits honest nulls for an unresolved vendor / contract join", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [retentionLedgers, [retRow(LEDGER0, { vendorId: null, contractId: null })]],
            [vendors, []],
            [subconContracts, []],
          ],
        }),
      })
    ).inject({ url: "/api/v1/retention" });
    const r = res.json().data[0];
    expect(r.vendor_name).toBeNull();
    expect(r.contract_value).toBeNull();
  });
});

// ===========================================================================
// POST /retention/release
// ===========================================================================
describe("POST /api/v1/retention/release", () => {
  const releaseDb = (opts: {
    ledger?: (typeof retentionLedgers.$inferSelect)[];
    jv?: RowSource;
    coa?: unknown[];
    inserted?: Inserted[];
    updated?: Updated[];
    financeApprove?: boolean;
  } = {}) =>
    stubDb({
      rows: [
        [users, [userRow]],
        [roles, [roleRow(opts.financeApprove ?? true)]],
        // a DUE, held ledger (past due_date) is the release-eligible default.
        [
          retentionLedgers,
          opts.ledger ?? [retRow(LEDGER0, { dueDate: "2020-01-01" })],
        ],
        [jvs, opts.jv ?? jvSource],
        [glAccounts, opts.coa ?? COA_ROWS],
      ],
      inserted: opts.inserted,
      updated: opts.updated,
    });

  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/retention/release",
      payload: { ledger_id: LEDGER0 },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });

  it("403s a caller lacking the finance-approve perm (money-lock, fail closed)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: releaseDb({ inserted, financeApprove: false }),
      })
    ).inject({ method: "POST", url: "/api/v1/retention/release", payload: { ledger_id: LEDGER0 } });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance approve permission/);
    expect(inserted).toHaveLength(0); // nothing posted on a denied release
  });

  it("400s when ledger_id is missing", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: releaseDb() })
    ).inject({ method: "POST", url: "/api/v1/retention/release", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/ledger_id is required/);
  });

  it("404s a ledger not in this tenant (scoped)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: releaseDb({ ledger: [] }),
      })
    ).inject({ method: "POST", url: "/api/v1/retention/release", payload: { ledger_id: LEDGER0 } });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("posts a BALANCED Dr 2030 / Cr 1020 JV for the full balance, flips the ledger, keys source_doc ret:<id>:1", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: releaseDb({ inserted, updated }),
      })
    ).inject({ method: "POST", url: "/api/v1/retention/release", payload: { ledger_id: LEDGER0 } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(LEDGER0);
    expect(body.amount).toBe(40_000); // server-computed balance = withheld − returned
    expect(body.status).toBe("released");
    expect(body.jv_no).toMatch(/^JV-\d{4}-\d{4}$/);

    // Balanced double entry: Dr 2030 = 40,000 / Cr 1020 = 40,000.
    const lineIns = inserted.find((i) => i.table === jvLines);
    const lines = lineIns!.values as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    const dr = lines.find((l) => l.accountId === ACC_RET)!;
    const cr = lines.find((l) => l.accountId === ACC_BANK)!;
    expect(dr.dr).toBe("40000.00");
    expect(dr.cr).toBe("0.00");
    expect(cr.dr).toBe("0.00");
    expect(cr.cr).toBe("40000.00");
    // Σ dr === Σ cr (balanced).
    const sumDr = lines.reduce((s, l) => s + Number(l.dr), 0);
    const sumCr = lines.reduce((s, l) => s + Number(l.cr), 0);
    expect(sumDr).toBe(40_000);
    expect(sumCr).toBe(40_000);

    // The JV carries the unique source_doc ret:<id>:1 (seq 1 = fresh 100% release).
    const jvIns = inserted.find((i) => i.table === jvs);
    expect((jvIns!.values as Record<string, unknown>).sourceDoc).toBe(`ret:${LEDGER0}:1`);

    // The ledger is flipped: returned := withheld, status := 'released'.
    const upd = updated.find((u) => u.table === retentionLedgers);
    expect(upd).toBeTruthy();
    expect(upd!.set.returned).toBe("40000.00");
    expect(upd!.set.status).toBe("released");
    expect(paramsOf(upd!.where)).toContain(COMPANY); // tenant scope on the write
  });

  it("completes a partially-returned ledger at seq 2 for the remaining balance", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: releaseDb({
          ledger: [retRow(LEDGER0, { dueDate: "2020-01-01", returned: "10000.00" })],
          inserted,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/retention/release", payload: { ledger_id: LEDGER0 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().amount).toBe(30_000); // 40,000 − 10,000 remaining
    const jvIns = inserted.find((i) => i.table === jvs);
    expect((jvIns!.values as Record<string, unknown>).sourceDoc).toBe(`ret:${LEDGER0}:2`);
  });

  it("409s when the warranty (12-month) period has not elapsed — not yet due", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: releaseDb({
          ledger: [retRow(LEDGER0, { dueDate: "2099-01-01" })], // far-future due
          inserted,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/retention/release", payload: { ledger_id: LEDGER0 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/not yet due/);
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined(); // no post
  });

  it("409s a ledger with no outstanding balance (already fully returned)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: releaseDb({
          ledger: [retRow(LEDGER0, { dueDate: "2020-01-01", returned: "40000.00", status: "released" })],
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/retention/release", payload: { ledger_id: LEDGER0 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/no outstanding balance/);
  });

  it("409s (idempotent) when a release JV already carries source_doc ret:<id>:1", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: releaseDb({
          jv: [{ id: "jv-prior", companyId: COMPANY, sourceDoc: `ret:${LEDGER0}:1` }],
          inserted,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/retention/release", payload: { ledger_id: LEDGER0 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already released/);
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined(); // no double post
  });

  it("409s a concurrent double-release (23505 on the source_doc index → idempotent)", async () => {
    // The ledger passes the in-memory pre-check (no prior ret:<id>:1 jv), but a
    // racing release committed first → the 0038 source_doc UNIQUE index trips 23505
    // in the tx. The handler maps it to the same 409, never a 500.
    const base = releaseDb({});
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
    ).inject({ method: "POST", url: "/api/v1/retention/release", payload: { ledger_id: LEDGER0 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already released/);
  });

  it("409s honestly when the tenant COA lacks a required posting account (never invents)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: releaseDb({ coa: [glAcc(ACC_RET, "2030", "เจ้าหนี้เงินประกันผลงาน")] }), // 1020 bank MISSING
      })
    ).inject({ method: "POST", url: "/api/v1/retention/release", payload: { ledger_id: LEDGER0 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/missing a required posting account/);
  });

  it("records an AuditLog row on a successful release (auto middleware)", async () => {
    const fired: { action: string; entity: string; companyId: string; userId: string | null }[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: releaseDb(),
        auditSink: (r) => {
          fired.push(r as (typeof fired)[number]);
        },
      })
    ).inject({ method: "POST", url: "/api/v1/retention/release", payload: { ledger_id: LEDGER0 } });
    expect(res.statusCode).toBe(200);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.entity).toBe("/api/v1/retention/release");
    expect(fired[0]!.companyId).toBe(COMPANY);
    expect(fired[0]!.userId).toBe("u-0");
  });
});

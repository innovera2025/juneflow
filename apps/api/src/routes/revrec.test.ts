// G3 unit tests (PLAN.md §9) — GL revenue-recognition + WIP handlers (B-230).
// Covers: 401 fail-closed on each route; listGlRevRec envelope + unbilled derive +
// project-name resolve; postGlRevRec SERVER-computed due (contract × pct −
// recognized) posting a BALANCED JV (Dr 1130 / Cr 4020 = due), 409 when due ≤ 0,
// and 409 when the optimistic-lock CAS returns 0 rows (concurrent — via an
// update-empty stub); listGlWip envelope + balance derive; transferGlWip validated
// amount, BALANCED JV (Dr 5010 / Cr 1140 = amount), 400 on ≤ 0, 409 on over-balance,
// 409 optimistic-lock; and the company_id tenant-scope predicate on the loads.
// B-394: the finance.approve gate on BOTH posts (deny / positive control / the
// create-is-not-approve pin), asserting no JV was written on every refusal.
// Every expected money value comes from the stub — never hand-computed vs the impl.
//
// The routes are registered onto the built app in buildApp (app.ts wiring is the
// orchestrator's). The root tenant-scope hook applies to the wired routes.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  glAccounts,
  jvLines,
  jvs,
  projects,
  revRecTxns,
  revRecs,
  roles,
  users,
  wipTransferTxns,
  wips,
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

// --- Db stub: canned rows per table (reads) + write capture (mirrors ar.test.ts).
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
  /** The rows the UPDATE ... RETURNING resolves to. Default = one row (the CAS
   *  won); override to `() => []` to simulate a concurrent post winning the CAS. */
  updateRows?: (set: Record<string, unknown>) => unknown[];
}

// ---------------------------------------------------------------------------
// B-394 — the authz rows the two POST doors now resolve
// ---------------------------------------------------------------------------
// POST /gl/revrec/{id}/post and POST /gl/wip/{id}/transfer run the REAL
// loadCaller → permAllowed against the stubbed `user` + `role` tables. Nothing
// about the gate is faked: the production authz module does the resolving and the
// deciding here, and only the two rows it reads are canned.
//
// stubDb APPENDS these as DEFAULTS so the pre-existing post tests keep describing
// what they were written to describe (server-computed money, the balanced JV, the
// CAS) instead of all turning into 403 assertions. rowsFor takes the FIRST
// matching entry, so a test that supplies its own [users, …] / [roles, …] still
// wins — which is exactly how the deny-path tests below revoke a right.
const callerUser = {
  id: "u-caller",
  companyId: COMPANY,
  email: SESSION.user.email,
  name: SESSION.user.name,
  roleId: "role-0",
  status: "active",
};
/**
 * A role carrying (or not) the finance rights the gate reads. Defaults mirror the
 * seeded Finance Manager — the role suda@ (this SESSION's email) actually holds,
 * and one of the three that carry finance.approve; a deny test passes `false`.
 */
const financeRole = (
  finance: { create?: boolean; approve?: boolean } = {},
) => ({
  id: "role-0",
  companyId: COMPANY,
  name: "Finance Manager",
  approvalLimits: {},
  perms: {
    finance: {
      view: true,
      create: finance.create ?? true,
      edit: true,
      approve: finance.approve ?? true,
      cancel: false,
    },
  },
  approvalLevel: 3,
  approvalLimit: null,
  currencyCode: "THB",
  createdAt: D,
  updatedAt: D,
});
/** The two rows loadCaller resolves, as a rows[] fragment a test can prepend. */
const authzRows = (
  finance: { create?: boolean; approve?: boolean } = {},
): Array<[unknown, RowSource]> => [
  [users, [callerUser]],
  [roles, [financeRole(finance)]],
];

function stubDb(opts: StubOpts): Db {
  const {
    captured = [],
    inserted = [],
    updated = [],
    updateRows = (set) => [{ id: "upd", ...set }],
  } = opts;
  // B-394: authorized-caller defaults, APPENDED so an explicit per-test override wins.
  const rows: Array<[unknown, RowSource]> = [...opts.rows, ...authzRows()];
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
      // `.returning()` double-count). Evidence at the foot of this file.
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        const record = (): Record<string, unknown>[] => {
          inserted.push({ table, values });
          const arr = Array.isArray(values) ? values : [values];
          return arr.map((v) => {
            const row = v as Record<string, unknown>;
            return { id: row.id ?? `new-${seq++}`, createdAt: D, ...row };
          });
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
            return Promise.resolve(updateRows(set));
          },
        }),
      }),
    }),
  };
  // The transaction door runs its callback against this SAME stub, so writes inside
  // a tx still capture (no real BEGIN/COMMIT) — AND a throw inside the callback
  // (the CAS-0-rows rollback) propagates out exactly as a real rollback re-throws.
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
const PROJECT = "proj0000-0000-0000-0000-0000000000p1";
const REVREC = "revrec00-0000-0000-0000-00000000rr01";
const WIP = "wip00000-0000-0000-0000-000000000w01";

const projectRow = {
  id: PROJECT,
  companyId: COMPANY,
  name: "โครงการรุ่งเรือง เฟส 1",
  createdAt: D,
  updatedAt: D,
} as unknown as typeof projects.$inferSelect;

const revRecRow = (
  extra: Partial<typeof revRecs.$inferSelect> = {},
): typeof revRecs.$inferSelect =>
  ({
    id: REVREC,
    companyId: COMPANY,
    projectId: PROJECT,
    method: "percent-of-completion",
    contractAmount: "10000000.00",
    pct: "20.00",
    recognized: "2000000.00", // already recognized to the 20% target (2,000,000)
    billed: "1800000.00",
    currencyCode: "THB",
    posted: true,
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof revRecs.$inferSelect;

const wipRow = (
  extra: Partial<typeof wips.$inferSelect> = {},
): typeof wips.$inferSelect =>
  ({
    id: WIP,
    companyId: COMPANY,
    projectId: PROJECT,
    material: "3000000.00",
    subcon: "2000000.00",
    overhead: "500000.00",
    transferred: "1000000.00", // balance = 3M + 2M + 0.5M − 1M = 4,500,000
    currencyCode: "THB",
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof wips.$inferSelect;

// The tenant COA rows the posts resolve (codes → ids).
const ACC_CONTRACT_ASSET = "acc-1130";
const ACC_CONSTR_REVENUE = "acc-4020";
const ACC_COGS = "acc-5010";
const ACC_WIP = "acc-1140";
const coaRows = [
  { id: ACC_CONTRACT_ASSET, companyId: COMPANY, code: "1130", name: "สินทรัพย์ตามสัญญา" },
  { id: ACC_CONSTR_REVENUE, companyId: COMPANY, code: "4020", name: "รายได้ค่าก่อสร้าง" },
  { id: ACC_COGS, companyId: COMPANY, code: "5010", name: "ต้นทุนขาย" },
  { id: ACC_WIP, companyId: COMPANY, code: "1140", name: "งานระหว่างก่อสร้าง" },
];
// allocJvNo (max) + the jv_line insertThrough ownership both read jvs.
const jvOwned = [{ id: "jv-owned", companyId: COMPANY }];

// ===========================================================================
// 401 fail-closed (no tenant → flat 401 on every route)
// ===========================================================================
describe("GL revrec/wip — 401 fail-closed without a session", () => {
  it("401s GET /gl/revrec", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/gl/revrec" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });
  it("401s POST /gl/revrec/{id}/post", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: `/api/v1/gl/revrec/${REVREC}/post`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });
  it("401s GET /gl/wip", async () => {
    const res = await (await buildTestApp()).inject({ method: "GET", url: "/api/v1/gl/wip" });
    expect(res.statusCode).toBe(401);
  });
  it("401s POST /gl/wip/{id}/transfer", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: `/api/v1/gl/wip/${WIP}/transfer`,
      payload: { amount: 100 },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ===========================================================================
// GET /gl/revrec
// ===========================================================================
describe("GET /api/v1/gl/revrec", () => {
  it("returns the B-014 envelope with unbilled derived + the project name resolved", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[revRecs, [revRecRow()]], [projects, [projectRow]]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/gl/revrec" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(Array.isArray(body.data)).toBe(true);
    const row = body.data[0];
    expect(row.id).toBe(REVREC);
    expect(row.project_name).toBe("โครงการรุ่งเรือง เฟส 1"); // resolved from project
    expect(row.contract_amount).toBe(10000000);
    expect(row.pct).toBe(20);
    expect(row.recognized).toBe(2000000);
    expect(row.billed).toBe(1800000);
    expect(row.unbilled).toBe(200000); // 2,000,000 − 1,800,000 (derived)
    expect(row.posted).toBe(true);
    expect(row.currency_code).toBe("THB");
  });

  it("tenant-scopes the rev_rec load (company_id predicate present)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[revRecs, [revRecRow()]], [projects, [projectRow]]], captured }),
      })
    ).inject({ method: "GET", url: "/api/v1/gl/revrec" });
    const revSelect = captured.find((c) => c.table === revRecs);
    expect(revSelect).toBeTruthy();
    expect(paramsOf(revSelect!.where)).toContain(COMPANY); // scoped by tenant
  });
});

// ===========================================================================
// POST /gl/revrec/{id}/post — MONEY-CRITICAL
// ===========================================================================
describe("POST /api/v1/gl/revrec/{id}/post", () => {
  // A stub whose rev_rec is at pct 40 but recognized only 2,000,000 → due = 40% of
  // 10,000,000 − 2,000,000 = 2,000,000 (a real incremental recognition).
  const authedDb = (inserted: Inserted[] = [], captured: Captured[] = []) =>
    stubDb({
      rows: [
        [revRecs, [revRecRow({ pct: "40.00", recognized: "2000000.00", posted: false })]],
        [glAccounts, coaRows],
        [jvs, jvOwned],
      ],
      inserted,
      captured,
    });

  it("404s a rev_rec outside this tenant (scoped select → empty)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[revRecs, []]] }),
      })
    ).inject({ method: "POST", url: `/api/v1/gl/revrec/${REVREC}/post`, payload: {} });
    expect(res.statusCode).toBe(404);
  });

  it("computes due SERVER-side and posts a BALANCED JV (Dr 1130 / Cr 4020 = due), ignoring the body", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: authedDb(inserted) })
    ).inject({
      method: "POST",
      url: `/api/v1/gl/revrec/${REVREC}/post`,
      payload: { due: 999999, recognized: 999999, amount: 999999 }, // client noise — IGNORED
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.due).toBe(2000000); // 40% × 10,000,000 − 2,000,000 — server-computed
    expect(body.recognized).toBe(4000000); // 2,000,000 + due
    expect(typeof body.jv_no).toBe("string");

    // Balanced JV: Dr contract-asset 1130 = due, Cr construction-revenue 4020 = due.
    const jvIns = inserted.find((i) => i.table === jvs);
    expect(String((jvIns!.values as Record<string, unknown>).sourceDoc)).toMatch(/^revrec:/);
    const lineIns = inserted.find((i) => i.table === jvLines);
    const lines = lineIns!.values as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    const sumDr = lines.reduce((s, l) => s + Number(l.dr), 0);
    const sumCr = lines.reduce((s, l) => s + Number(l.cr), 0);
    expect(sumDr).toBe(2000000);
    expect(sumCr).toBe(2000000); // BALANCED (C9)
    expect(lines.find((l) => l.accountId === ACC_CONTRACT_ASSET)!.dr).toBe("2000000.00");
    expect(lines.find((l) => l.accountId === ACC_CONSTR_REVENUE)!.cr).toBe("2000000.00");

    // The rev_rec_txn ledger records the event (audit + source anchor).
    const txnIns = inserted.find((i) => i.table === revRecTxns);
    expect(txnIns).toBeTruthy();
    expect((txnIns!.values as Record<string, unknown>).amount).toBe("2000000.00");
    expect((txnIns!.values as Record<string, unknown>).revRecId).toBe(REVREC);
  });

  it("folds the optimistic-lock CAS into the FINAL update WHERE (recognized = pre-read value)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [revRecs, [revRecRow({ pct: "40.00", recognized: "2000000.00", posted: false })]],
            [glAccounts, coaRows],
            [jvs, jvOwned],
          ],
          updated,
        }),
      })
    ).inject({ method: "POST", url: `/api/v1/gl/revrec/${REVREC}/post`, payload: {} });
    expect(res.statusCode).toBe(200);
    const revUpdate = updated.find((u) => u.table === revRecs);
    expect(revUpdate).toBeTruthy();
    // The CAS guard binds BOTH the id and the pre-read recognized value into the
    // UPDATE's own WHERE (compare-and-swap), plus the door's company_id.
    const params = paramsOf(revUpdate!.where).map(String);
    expect(params).toContain(REVREC);
    expect(params).toContain("2000000.00"); // the pre-read recognized (CAS old value)
    expect(params).toContain(COMPANY);
    expect(revUpdate!.set.posted).toBe(true);
    expect(revUpdate!.set.recognized).toBe("4000000.00");
  });

  it("409s when the target is already fully recognized at this pct (due ≤ 0, no JV)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          // pct 20, recognized 2,000,000 → target 2,000,000 → due 0.
          rows: [[revRecs, [revRecRow({ pct: "20.00", recognized: "2000000.00" })]]],
          inserted,
        }),
      })
    ).inject({ method: "POST", url: `/api/v1/gl/revrec/${REVREC}/post`, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/nothing to recognize/);
    expect(inserted.find((i) => i.table === jvs)).toBeFalsy(); // never posted
  });

  it("409s when the optimistic-lock update matches 0 rows (concurrent post won the CAS)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [revRecs, [revRecRow({ pct: "40.00", recognized: "2000000.00", posted: false })]],
            [glAccounts, coaRows],
            [jvs, jvOwned],
          ],
          updateRows: () => [], // the CAS matched 0 rows → tx rolls back → 409
        }),
      })
    ).inject({ method: "POST", url: `/api/v1/gl/revrec/${REVREC}/post`, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/concurrently posted/);
  });

  it("409s honestly when the tenant COA lacks a posting account (no JV posted)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [revRecs, [revRecRow({ pct: "40.00", recognized: "2000000.00", posted: false })]],
            [glAccounts, []], // missing 1130 / 4020
          ],
          inserted,
        }),
      })
    ).inject({ method: "POST", url: `/api/v1/gl/revrec/${REVREC}/post`, payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/missing a required posting account/);
    expect(inserted.find((i) => i.table === jvs)).toBeFalsy();
  });
});

// ===========================================================================
// GET /gl/wip
// ===========================================================================
describe("GET /api/v1/gl/wip", () => {
  it("returns the envelope with balance derived (mat+sub+oh − transferred)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[wips, [wipRow()]], [projects, [projectRow]]] }),
      })
    ).inject({ method: "GET", url: "/api/v1/gl/wip" });
    expect(res.statusCode).toBe(200);
    const row = res.json().data[0];
    expect(row.id).toBe(WIP);
    expect(row.project_name).toBe("โครงการรุ่งเรือง เฟส 1");
    expect(row.material).toBe(3000000);
    expect(row.subcon).toBe(2000000);
    expect(row.overhead).toBe(500000);
    expect(row.transferred).toBe(1000000);
    expect(row.balance).toBe(4500000); // 3M + 2M + 0.5M − 1M (derived)
  });

  it("tenant-scopes the wip load (company_id predicate present)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[wips, [wipRow()]], [projects, [projectRow]]], captured }),
      })
    ).inject({ method: "GET", url: "/api/v1/gl/wip" });
    const wipSelect = captured.find((c) => c.table === wips);
    expect(paramsOf(wipSelect!.where)).toContain(COMPANY);
  });
});

// ===========================================================================
// POST /gl/wip/{id}/transfer — MONEY-CRITICAL
// ===========================================================================
describe("POST /api/v1/gl/wip/{id}/transfer", () => {
  const authedDb = (inserted: Inserted[] = [], updated: Updated[] = []) =>
    stubDb({
      rows: [
        [wips, [wipRow()]], // balance 4,500,000
        [glAccounts, coaRows],
        [jvs, jvOwned],
      ],
      inserted,
      updated,
    });

  it("404s a wip outside this tenant", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[wips, []]] }),
      })
    ).inject({ method: "POST", url: `/api/v1/gl/wip/${WIP}/transfer`, payload: { amount: 100 } });
    expect(res.statusCode).toBe(404);
  });

  it("400s a missing / ≤ 0 amount (no JV posted)", async () => {
    const inserted: Inserted[] = [];
    for (const payload of [{}, { amount: 0 }, { amount: -5 }]) {
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: authedDb(inserted) })
      ).inject({ method: "POST", url: `/api/v1/gl/wip/${WIP}/transfer`, payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/greater than zero/);
    }
    expect(inserted.find((i) => i.table === jvs)).toBeFalsy();
  });

  it("posts a BALANCED JV (Dr 5010 / Cr 1140 = amount) and advances transferred", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: authedDb(inserted, updated),
      })
    ).inject({
      method: "POST",
      url: `/api/v1/gl/wip/${WIP}/transfer`,
      payload: { amount: 1500000 }, // ≤ balance 4,500,000
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.transferred).toBe(2500000); // 1,000,000 + 1,500,000
    expect(typeof body.jv_no).toBe("string");

    const jvIns = inserted.find((i) => i.table === jvs);
    expect(String((jvIns!.values as Record<string, unknown>).sourceDoc)).toMatch(/^wip-transfer:/);
    const lines = (inserted.find((i) => i.table === jvLines)!.values) as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    expect(lines.reduce((s, l) => s + Number(l.dr), 0)).toBe(1500000);
    expect(lines.reduce((s, l) => s + Number(l.cr), 0)).toBe(1500000); // BALANCED
    expect(lines.find((l) => l.accountId === ACC_COGS)!.dr).toBe("1500000.00");
    expect(lines.find((l) => l.accountId === ACC_WIP)!.cr).toBe("1500000.00");

    // wip_transfer_txn ledger + the CAS guard on `transferred`.
    const txnIns = inserted.find((i) => i.table === wipTransferTxns);
    expect((txnIns!.values as Record<string, unknown>).amount).toBe("1500000.00");
    const wipUpdate = updated.find((u) => u.table === wips);
    const params = paramsOf(wipUpdate!.where).map(String);
    expect(params).toContain(WIP);
    expect(params).toContain("1000000.00"); // the pre-read transferred (CAS old value)
    expect(params).toContain(COMPANY);
    expect(wipUpdate!.set.transferred).toBe("2500000.00");
  });

  it("409s an over-balance transfer (REJECT, never clamp — no JV posted)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: authedDb(inserted),
      })
    ).inject({
      method: "POST",
      url: `/api/v1/gl/wip/${WIP}/transfer`,
      payload: { amount: 5000000 }, // > balance 4,500,000
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/exceeds the WIP balance/);
    expect(inserted.find((i) => i.table === jvs)).toBeFalsy();
  });

  it("409s when the optimistic-lock update matches 0 rows (concurrent transfer won the CAS)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[wips, [wipRow()]], [glAccounts, coaRows], [jvs, jvOwned]],
          updateRows: () => [], // CAS matched 0 rows → rollback → 409
        }),
      })
    ).inject({
      method: "POST",
      url: `/api/v1/gl/wip/${WIP}/transfer`,
      payload: { amount: 1500000 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/concurrently transferred/);
  });
});

// ===========================================================================
// B-394 — function-level authorization on the two JV-POSTING doors
// ===========================================================================
// Each deny test uses the SAME fixture the 200 happy path uses (the positive
// control right beside it proves that), so the 403 can only be the gate — a
// fixture that could not reach 200 would prove nothing about it. Each also
// asserts NOTHING WAS WRITTEN, because the harm this closes is a real balanced JV
// landing in the tenant's ledger, not a status code.
describe("GL revrec/wip posts — B-394 finance.approve authz", () => {
  const FORBIDDEN_MSG =
    "GL posting (revrec / WIP transfer) requires the finance approve permission";
  /** The rows a revrec post needs to reach 200 (due = 40% × 10M − 2M = 2,000,000). */
  const revrecRows = (): Array<[unknown, RowSource]> => [
    [revRecs, [revRecRow({ pct: "40.00", recognized: "2000000.00", posted: false })]],
    [glAccounts, coaRows],
    [jvs, jvOwned],
  ];
  /** The rows a wip transfer needs to reach 200 (balance 4,500,000). */
  const wipRows = (): Array<[unknown, RowSource]> => [
    [wips, [wipRow()]],
    [glAccounts, coaRows],
    [jvs, jvOwned],
  ];
  const TRANSFER = { amount: 1500000 };

  it("POST /gl/revrec/{id}/post 403s a caller without finance.approve, and posts no JV", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [...authzRows({ create: false, approve: false }), ...revrecRows()],
          inserted,
          updated,
        }),
      })
    ).inject({ method: "POST", url: `/api/v1/gl/revrec/${REVREC}/post`, payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: "FORBIDDEN", message: FORBIDDEN_MSG });
    // No jv, no jv_line, no rev_rec_txn — and `recognized` never advanced.
    expect(inserted).toEqual([]);
    expect(updated).toEqual([]);
  });

  it("POST /gl/revrec/{id}/post 200s the SAME fixture once finance.approve is held (the balanced JV still posts)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [...authzRows({ approve: true }), ...revrecRows()], inserted }),
      })
    ).inject({ method: "POST", url: `/api/v1/gl/revrec/${REVREC}/post`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().due).toBe(2000000);
    const lines = inserted.find((i) => i.table === jvLines)!.values as Record<string, unknown>[];
    expect(lines.reduce((s, l) => s + Number(l.dr), 0)).toBe(2000000);
    expect(lines.reduce((s, l) => s + Number(l.cr), 0)).toBe(2000000); // still BALANCED
    expect(inserted.find((i) => i.table === revRecTxns)).toBeTruthy();
  });

  it("POST /gl/revrec/{id}/post 403s a caller holding finance.create but NOT approve (approve, not create)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          // The seeded `sale` role's finance shape: view/create/edit, no approve.
          rows: [...authzRows({ create: true, approve: false }), ...revrecRows()],
          inserted,
        }),
      })
    ).inject({ method: "POST", url: `/api/v1/gl/revrec/${REVREC}/post`, payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(inserted).toEqual([]);
  });

  it("POST /gl/revrec/{id}/post 403s an UNATTRIBUTABLE caller (no dictionary row) — fail closed", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        // No `user` row resolves → loadCaller returns null → no perms at all.
        db: stubDb({ rows: [[users, []], [roles, []], ...revrecRows()], inserted }),
      })
    ).inject({ method: "POST", url: `/api/v1/gl/revrec/${REVREC}/post`, payload: {} });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: "FORBIDDEN", message: "caller cannot be attributed" });
    expect(inserted).toEqual([]);
  });

  it("POST /gl/wip/{id}/transfer 403s a caller without finance.approve, and posts no JV", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [...authzRows({ create: false, approve: false }), ...wipRows()],
          inserted,
          updated,
        }),
      })
    ).inject({ method: "POST", url: `/api/v1/gl/wip/${WIP}/transfer`, payload: TRANSFER });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ code: "FORBIDDEN", message: FORBIDDEN_MSG });
    // No jv, no jv_line, no wip_transfer_txn — and `transferred` never advanced.
    expect(inserted).toEqual([]);
    expect(updated).toEqual([]);
  });

  it("POST /gl/wip/{id}/transfer 200s the SAME fixture once finance.approve is held (the balanced JV still posts)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [...authzRows({ approve: true }), ...wipRows()], inserted }),
      })
    ).inject({ method: "POST", url: `/api/v1/gl/wip/${WIP}/transfer`, payload: TRANSFER });
    expect(res.statusCode).toBe(200);
    expect(res.json().transferred).toBe(2500000);
    const lines = inserted.find((i) => i.table === jvLines)!.values as Record<string, unknown>[];
    expect(lines.reduce((s, l) => s + Number(l.dr), 0)).toBe(1500000);
    expect(lines.reduce((s, l) => s + Number(l.cr), 0)).toBe(1500000); // still BALANCED
    expect(inserted.find((i) => i.table === wipTransferTxns)).toBeTruthy();
  });

  it("POST /gl/wip/{id}/transfer 403s a caller holding finance.create but NOT approve (approve, not create)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [...authzRows({ create: true, approve: false }), ...wipRows()],
          inserted,
        }),
      })
    ).inject({ method: "POST", url: `/api/v1/gl/wip/${WIP}/transfer`, payload: TRANSFER });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(inserted).toEqual([]);
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
    const bare = await doorOf(db, revRecTxns).values({ no: "bare" });
    expect(inserted).toHaveLength(1);
    // The .returning() door (insertThrough / insert(...).returning()).
    const ret = await doorOf(db, revRecTxns).values({ no: "ret" }).returning();
    expect(inserted).toHaveLength(2);

    expect(inserted).toEqual([
      { table: revRecTxns, values: { no: "bare" } },
      { table: revRecTxns, values: { no: "ret" } },
    ]);
    // Identical resolution shape. The ids prove `seq` advanced exactly ONCE per
    // write, so neither door invoked the recording closure twice.
    expect(bare).toEqual([{ id: "new-0", createdAt: D, no: "bare" }]);
    expect(ret).toEqual([{ id: "new-1", createdAt: D, no: "ret" }]);
  });

  it("expands an ARRAY of child rows identically through EITHER door", async () => {
    const insertedBare: Inserted[] = [];
    const bare = await doorOf(stubDb({ rows: [], inserted: insertedBare }), revRecTxns).values([
      { no: "a" },
      { no: "b" },
    ]);
    const insertedRet: Inserted[] = [];
    const ret = await doorOf(stubDb({ rows: [], inserted: insertedRet }), revRecTxns)
      .values([{ no: "a" }, { no: "b" }])
      .returning();

    // ONE recording for the batch (not one per row), and the SAME shape from both
    // doors — a divergence here is what a hand-copied `then` typically gets wrong.
    expect(insertedBare).toEqual(insertedRet);
    expect(insertedBare).toHaveLength(1);
    expect(insertedBare[0]).toEqual({ table: revRecTxns, values: [{ no: "a" }, { no: "b" }] });
    expect(bare).toEqual(ret);
    expect(bare).toHaveLength(2);
  });
});

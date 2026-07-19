// G3 unit tests (PLAN.md §9) — bank handlers (P2-BE-19 part 2, Wave-2 finance).
// Covers GET /bank/statements (line_count / matched_pct / bank_balance = Σ signed,
// honest-null book_balance, tenant scope), GET /bank/statements/{id}/lines
// (statement 404, matched_doc resolve, F-BANK1 suggestions = exact-amount +
// date-window: an in-window amount-match suggests, an out-of-window one does
// NOT), POST /bank/lines/{id}/match (exactly-one-id 400, 404, already-matched
// 409, fail-closed foreign-doc reject, and the tenant-verified confirm write),
// GET /bank/cheque (register + honest-null pv_no, tenant scope), and POST
// /bank/export-batch (approved-transfer filter + @juneflow/bank-file fake output,
// pv_ids restriction). Every expected value comes from the stub / the real
// bank-file formatter — not hand-computed against the impl.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  apBillings,
  bankStatementLines,
  bankStatements,
  cheques,
  pvs,
  roles,
  rvs,
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
interface StubOpts {
  rows: Array<[unknown, unknown[]]>;
  captured?: Captured[];
  inserted?: Inserted[];
  updated?: Updated[];
  updateBase?: Record<string, unknown>;
}

/** Db stub: canned rows per table (reads, incl. selectThrough joins) + write capture. */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [], updated = [], updateBase = {} } = opts;
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
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
        returning: () => {
          inserted.push({ table, values: values as Record<string, unknown> });
          // insertThrough passes an ARRAY of child rows; the scoped insert door
          // passes one object. Return one synthetic row per inserted row.
          const rows = Array.isArray(values) ? values : [values];
          return Promise.resolve(rows.map((v) => ({ id: `new-${seq++}`, createdAt: D, ...v })));
        },
      }),
    }),
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
  // B-097: the transaction door runs its callback against this SAME stub, so
  // writes inside a tx still capture into inserted/updated/captured (the fake
  // has no real BEGIN/COMMIT — it proves the door threads one scoped handle).
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
const STMT0 = "stmt0000-0000-0000-0000-0000000000s0";
const L_MATCHED = "line0000-0000-0000-0000-0000000000l0";
const L_HIT = "line0000-0000-0000-0000-0000000000l1";
const L_OUT = "line0000-0000-0000-0000-0000000000l2";
const CHQ0 = "chq00000-0000-0000-0000-0000000000c0";
const CHQ_HIT = "chq00000-0000-0000-0000-0000000000c1";
const CHQ_OUT = "chq00000-0000-0000-0000-0000000000c2";
const PV_HIT = "pv000000-0000-0000-0000-0000000000v1";
const PVA = "pv000000-0000-0000-0000-0000000000va";
const PVB = "pv000000-0000-0000-0000-0000000000vb";
const PVC = "pv000000-0000-0000-0000-0000000000vc";
const AP0 = "ap000000-0000-0000-0000-0000000000a0";
const VENDOR = "aaaa1111-0000-0000-0000-0000000000a1";

const statementRow = (
  id: string,
  extra: Partial<typeof bankStatements.$inferSelect> = {},
): typeof bankStatements.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    period: "2569-05",
    lines: [],
    locked: false,
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof bankStatements.$inferSelect;

const lineRow = (
  id: string,
  extra: Partial<typeof bankStatementLines.$inferSelect> = {},
): typeof bankStatementLines.$inferSelect =>
  ({
    id,
    statementId: STMT0,
    lineDate: "2026-05-22",
    description: "FT TXN",
    amount: "-15240.00",
    currencyCode: "THB",
    matched: false,
    pvId: null,
    chequeId: null,
    rvId: null,
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof bankStatementLines.$inferSelect;

const chequeRow = (
  id: string,
  extra: Partial<typeof cheques.$inferSelect> = {},
): typeof cheques.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    no: "CH-040126",
    amount: "184500.00",
    currencyCode: "THB",
    dueDate: "2026-05-20",
    status: "cleared",
    pvId: null,
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof cheques.$inferSelect;

const pvRow = (
  id: string,
  extra: Partial<typeof pvs.$inferSelect> = {},
): typeof pvs.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    billingIds: [AP0],
    whtPct: "3.00",
    amount: "920000.00",
    net: "892400.00",
    retention: "0",
    method: "transfer",
    chequeNo: null,
    chequeBank: null,
    chequeDate: null,
    currencyCode: "THB",
    batchId: null,
    status: "approved",
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof pvs.$inferSelect;

const vendorRow = {
  id: VENDOR,
  companyId: COMPANY,
  name: "บจก. ซีแพค คอนกรีต",
  code: "V-0012",
  taxId: "0105545012345",
  kind: "supplier",
  creditTerm: 30,
  addr: null,
  bank: "KBANK 012-3-45678-9",
  status: "active",
  createdAt: D,
  updatedAt: D,
};
const billingRow = {
  id: AP0,
  companyId: COMPANY,
  poId: null,
  grId: null,
  woId: null,
  vendorId: VENDOR,
  invoiceNo: "INV-CPC-118",
  dueDate: null,
  amount: "920000.00",
  vat: "0",
  wht: null,
  retention: null,
  currencyCode: "THB",
  status: "approved",
  kind: "progress",
  createdAt: D,
  updatedAt: D,
};

// --- authz seed: the finance caller loadCaller resolves via the session email --
// The two bank mutations are gated on the finance perms matrix (B-084):
// POST /bank/statements/import → finance `create`, POST /bank/reconcile →
// finance `approve`. loadCaller resolves the caller through the session email
// (authUser.email → dictionary user → role), so a test that must pass the gate
// seeds a `users` row (email = SESSION) + a `roles` row carrying the perm.
const userRow = {
  id: "u-0",
  companyId: COMPANY,
  email: "suda@rungrueang.co.th",
  name: "สุดา",
  roleId: "role-0",
  status: "active",
};
/** A finance role with configurable create/approve perms (loadCaller: email →
 *  user → role). Toggle a flag off to prove either mutation gate fail-closed. */
const financeRole = (create = true, approve = true) => ({
  id: "role-0",
  companyId: COMPANY,
  name: "Finance Manager",
  approvalLimits: {},
  perms: {
    finance: { view: true, create, edit: true, approve, cancel: false },
  },
  approvalLevel: 3,
  approvalLimit: null,
  currencyCode: "THB",
  createdAt: D,
  updatedAt: D,
});
/** The two stub rows that authorize a full finance caller (both create+approve). */
const financeCaller: Array<[unknown, unknown[]]> = [
  [users, [userRow]],
  [roles, [financeRole()]],
];

// ===========================================================================
// GET /bank/statements
// ===========================================================================
describe("GET /api/v1/bank/statements", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/bank/statements" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("derives line_count / matched_pct / bank_balance (Σ signed), honest-null book_balance", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [bankStatements, [statementRow(STMT0)]],
            [
              bankStatementLines,
              [
                lineRow(L_MATCHED, { amount: "-100.00", matched: true, chequeId: CHQ0 }),
                lineRow(L_HIT, { amount: "300.00", matched: false }),
              ],
            ],
          ],
        }),
      })
    ).inject({ url: "/api/v1/bank/statements" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    const s = body.data[0];
    expect(s.line_count).toBe(2);
    expect(s.matched_count).toBe(1);
    expect(s.matched_pct).toBe(50);
    expect(s.bank_balance).toBe(200); // -100 + 300
    expect(s.book_balance).toBeNull(); // GAP: no ledger cash-balance source
    expect(s.difference).toBeNull();
  });

  it("binds company_id on the bank_statement read (tenant scope)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[bankStatements, [statementRow(STMT0)]]], captured }),
      })
    ).inject({ url: "/api/v1/bank/statements" });
    const read = captured.find((c) => c.table === bankStatements);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
  });
});

// ===========================================================================
// GET /bank/statements/{id}/lines — matched_doc + F-BANK1 suggestions
// ===========================================================================
describe("GET /api/v1/bank/statements/:id/lines", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      url: `/api/v1/bank/statements/${STMT0}/lines`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("404s when the statement is not this tenant's", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[bankStatements, []]] }),
      })
    ).inject({ url: `/api/v1/bank/statements/${STMT0}/lines` });
    expect(res.statusCode).toBe(404);
  });

  it("resolves matched_doc + suggests only exact-amount docs within the date window", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [bankStatements, [statementRow(STMT0)]],
            [
              bankStatementLines,
              [
                // matched → matched_doc = CHQ0, no suggestions
                lineRow(L_MATCHED, {
                  amount: "-184500.00",
                  lineDate: "2026-05-21",
                  matched: true,
                  chequeId: CHQ0,
                }),
                // unmatched, amount 15240, line 2026-05-22 → in-window candidates hit
                lineRow(L_HIT, { amount: "-15240.00", lineDate: "2026-05-22", matched: false }),
                // unmatched, amount 350, only a candidate OUT of the ±7d window
                lineRow(L_OUT, { amount: "-350.00", lineDate: "2026-05-20", matched: false }),
              ],
            ],
            [
              cheques,
              [
                chequeRow(CHQ0, { no: "CH-040126", amount: "184500.00", dueDate: "2026-05-20" }),
                chequeRow(CHQ_HIT, { no: "CH-040130", amount: "15240.00", dueDate: "2026-05-20" }),
                chequeRow(CHQ_OUT, { no: "CH-039999", amount: "350.00", dueDate: "2026-01-01" }),
              ],
            ],
            [
              pvs,
              // The PV suggestion matches on NET (real cash-out), not gross amount
              // (B-094 net-vs-gross) — net 15240 lines up with the −15240 line.
              [pvRow(PV_HIT, { amount: "18000.00", net: "15240.00", chequeDate: "2026-05-25", method: "transfer" })],
            ],
            [rvs, []],
          ],
        }),
      })
    ).inject({ url: `/api/v1/bank/statements/${STMT0}/lines` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(3);
    const matched = body.data.find((r: { id: string }) => r.id === L_MATCHED);
    expect(matched.matched).toBe(true);
    expect(matched.suggestions).toEqual([]);
    expect(matched.matched_doc).toMatchObject({ type: "cheque", id: CHQ0, amount: 184500 });

    const hit = body.data.find((r: { id: string }) => r.id === L_HIT);
    expect(hit.matched_doc).toBeNull();
    // exact-amount (15240) + within ±7d → the pv (chequeDate 05-25) AND cheque (due 05-20)
    expect(hit.suggestions).toHaveLength(2);
    const kinds = hit.suggestions.map((s: { type: string }) => s.type).sort();
    expect(kinds).toEqual(["cheque", "pv"]);
    for (const s of hit.suggestions) expect(s.amount).toBe(15240);

    const out = body.data.find((r: { id: string }) => r.id === L_OUT);
    // amount matches CHQ_OUT (350) but its date is out of window → no suggestion
    expect(out.suggestions).toEqual([]);
  });

  // B-094 net-vs-gross: a transfer PV's real bank cash-out is its NET (gross −
  // WHT − retention), so the suggestion must match a line on pv.net, not gross.
  it("suggests a PV on its NET cash-out, not its GROSS amount (net-vs-gross)", async () => {
    const LINE_NET = "line0000-0000-0000-0000-0000000000n1";
    const LINE_GROSS = "line0000-0000-0000-0000-0000000000n2";
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [bankStatements, [statementRow(STMT0)]],
            [
              bankStatementLines,
              [
                // withdrawal for the PV's NET (the real cash-out) → should suggest
                lineRow(LINE_NET, { amount: "-892400.00", lineDate: "2026-05-22", matched: false }),
                // withdrawal for the PV's GROSS → NOT the cash-out → no suggestion
                lineRow(LINE_GROSS, { amount: "-920000.00", lineDate: "2026-05-22", matched: false }),
              ],
            ],
            [cheques, []],
            [
              pvs,
              // gross 920000, net 892400 (transfer), dated within the ±7d window
              [pvRow(PVA, { amount: "920000.00", net: "892400.00", method: "transfer", chequeDate: "2026-05-25" })],
            ],
            [rvs, []],
          ],
        }),
      })
    ).inject({ url: `/api/v1/bank/statements/${STMT0}/lines` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const net = body.data.find((r: { id: string }) => r.id === LINE_NET);
    const gross = body.data.find((r: { id: string }) => r.id === LINE_GROSS);
    // the NET line matches the PV's real cash-out → suggested, amount = net
    expect(net.suggestions).toHaveLength(1);
    expect(net.suggestions[0]).toMatchObject({ type: "pv", id: PVA, amount: 892400 });
    // the GROSS line no longer matches (the old gross-comparison bug) → none
    expect(gross.suggestions).toEqual([]);
  });

  // B-096 fix 3: a MATCHED PV's matched_doc shows its NET (the real cash-out and
  // the SAME figure buildSuggestions matched on), not its GROSS `amount` — so the
  // matched line's displayed amount agrees with the suggestion + the withdrawal.
  it("shows a matched PV's NET in matched_doc (display consistency, not gross)", async () => {
    const LINE_PV = "line0000-0000-0000-0000-0000000000p1";
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [bankStatements, [statementRow(STMT0)]],
            [
              bankStatementLines,
              [lineRow(LINE_PV, { amount: "-892400.00", matched: true, pvId: PVA })],
            ],
            [cheques, []],
            // gross 920000, net 892400 — the matched_doc must report net
            [pvs, [pvRow(PVA, { amount: "920000.00", net: "892400.00" })]],
            [rvs, []],
          ],
        }),
      })
    ).inject({ url: `/api/v1/bank/statements/${STMT0}/lines` });

    expect(res.statusCode).toBe(200);
    const line = res.json().data.find((r: { id: string }) => r.id === LINE_PV);
    expect(line.matched).toBe(true);
    // matched_doc.amount = pv.net (892400), NOT pv.amount gross (920000)
    expect(line.matched_doc).toMatchObject({ type: "pv", id: PVA, amount: 892400 });
    expect(line.matched_doc.amount).not.toBe(920000);
  });
});

// ===========================================================================
// POST /bank/lines/{id}/match — manual confirm (F-BANK1)
// ===========================================================================
describe("POST /api/v1/bank/lines/:id/match", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: `/api/v1/bank/lines/${L_HIT}/match`,
      payload: { pv_id: PVA },
    });
    expect(res.statusCode).toBe(401);
  });

  it("400s when neither one nor exactly one id is given", async () => {
    const appx = await buildTestApp({
      resolveTenant: async () => SESSION,
      db: stubDb({ rows: [...financeCaller, [bankStatementLines, [lineRow(L_HIT)]]] }),
    });
    const none = await appx.inject({
      method: "POST",
      url: `/api/v1/bank/lines/${L_HIT}/match`,
      payload: {},
    });
    expect(none.statusCode).toBe(400);
    expect(none.json().message).toMatch(/exactly one of/);

    const many = await appx.inject({
      method: "POST",
      url: `/api/v1/bank/lines/${L_HIT}/match`,
      payload: { pv_id: PVA, cheque_id: CHQ0 },
    });
    expect(many.statusCode).toBe(400);
  });

  it("404s an unknown / foreign line", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [...financeCaller, [bankStatementLines, []]] }),
      })
    ).inject({ method: "POST", url: `/api/v1/bank/lines/${L_HIT}/match`, payload: { pv_id: PVA } });
    expect(res.statusCode).toBe(404);
  });

  it("409s an already-matched line", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [...financeCaller, [bankStatementLines, [lineRow(L_MATCHED, { matched: true, chequeId: CHQ0 })]]] }),
      })
    ).inject({ method: "POST", url: `/api/v1/bank/lines/${L_MATCHED}/match`, payload: { pv_id: PVA } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("400s (fail closed) on a foreign pv_id — never links a doc from another tenant", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [...financeCaller,
            [bankStatementLines, [lineRow(L_HIT)]],
            [bankStatements, [statementRow(STMT0)]],
            [pvs, []], // referenced pv absent in this tenant → foreign
          ],
          updated,
        }),
      })
    ).inject({ method: "POST", url: `/api/v1/bank/lines/${L_HIT}/match`, payload: { pv_id: PVA } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/pv_id not found in this tenant/);
    expect(updated).toHaveLength(0);
  });

  it("confirms the match (200) — sets matched=true + the chosen FK, tenant-verified", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [...financeCaller,
            [bankStatementLines, [lineRow(L_HIT)]],
            [bankStatements, [statementRow(STMT0)]],
            [pvs, [pvRow(PVA)]],
          ],
          updated,
          updateBase: lineRow(L_HIT),
        }),
      })
    ).inject({ method: "POST", url: `/api/v1/bank/lines/${L_HIT}/match`, payload: { pv_id: PVA } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.matched).toBe(true);
    expect(body.pv_id).toBe(PVA);
    const write = updated.find((u) => u.table === bankStatementLines);
    expect(write).toBeTruthy();
    expect(write!.set.matched).toBe(true);
    expect(write!.set.pvId).toBe(PVA);
    expect(write!.set.chequeId).toBeNull();
  });

  it("409s a match on a line whose statement period is locked (reconcile close is enforced)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [...financeCaller,
            [bankStatementLines, [lineRow(L_HIT)]], // unmatched line
            [bankStatements, [statementRow(STMT0, { locked: true })]], // but the period is closed
            [pvs, [pvRow(PVA)]],
          ],
          updated,
        }),
      })
    ).inject({ method: "POST", url: `/api/v1/bank/lines/${L_HIT}/match`, payload: { pv_id: PVA } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
    expect(res.json().message).toMatch(/locked/);
    expect(updated).toHaveLength(0); // no write — the lock held
  });

  // B-094-2: a single PV settles at most ONE statement line — reject a reverse
  // double-reconcile (the same PV already matched to a DIFFERENT line).
  it("409s a match whose PV is already matched to another statement line (reverse-uniqueness)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [...financeCaller,
            // rows[0] = the UNMATCHED target line; rows[1] = a DIFFERENT line
            // already matched to PVA → matching PVA here would double-reconcile.
            [
              bankStatementLines,
              [
                lineRow(L_HIT), // target (unmatched)
                lineRow(L_MATCHED, { matched: true, pvId: PVA }), // PVA already used
              ],
            ],
            [bankStatements, [statementRow(STMT0)]],
            [pvs, [pvRow(PVA)]],
          ],
          updated,
        }),
      })
    ).inject({ method: "POST", url: `/api/v1/bank/lines/${L_HIT}/match`, payload: { pv_id: PVA } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
    expect(res.json().message).toMatch(/already matched to another/);
    expect(updated).toHaveLength(0); // no write — the double-reconcile was blocked
  });

  // B-084 (authz-reaudit GAP-2): matching a bank line to a document is finance
  // bookkeeping — a caller lacking the finance `create` perm is denied 403
  // before any ledger link is written (mirrors the import gate). Regression.
  it("403s (fail closed) a caller lacking the finance create perm — no match runs", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [users, [userRow]],
            [roles, [financeRole(/* create */ false, /* approve */ true)]],
            [bankStatementLines, [lineRow(L_HIT)]],
            [bankStatements, [statementRow(STMT0)]],
            [pvs, [pvRow(PVA)]],
          ],
          updated,
        }),
      })
    ).inject({ method: "POST", url: `/api/v1/bank/lines/${L_HIT}/match`, payload: { pv_id: PVA } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(res.json().message).toMatch(/finance create permission/);
    expect(updated).toHaveLength(0); // no ledger link was written
  });
});

// ===========================================================================
// GET /bank/cheque
// ===========================================================================
describe("GET /api/v1/bank/cheque", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/bank/cheque" });
    expect(res.statusCode).toBe(401);
  });

  it("lists the register with no/amount/due_date/status/pv_id + honest-null pv_no", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[cheques, [chequeRow(CHQ0, { no: "CH-040128", amount: "561150.00", pvId: PVA })]]],
        }),
      })
    ).inject({ url: "/api/v1/bank/cheque" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    const c = body.data[0];
    expect(c.no).toBe("CH-040128");
    expect(c.amount).toBe(561150);
    expect(c.status).toBe("cleared");
    expect(c.pv_id).toBe(PVA);
    expect(c.pv_no).toBeNull(); // GAP: pv has no doc-number column
  });

  it("binds company_id on the cheque read (tenant scope)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[cheques, [chequeRow(CHQ0)]]], captured }),
      })
    ).inject({ url: "/api/v1/bank/cheque" });
    const read = captured.find((c) => c.table === cheques);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
  });
});

// ===========================================================================
// POST /bank/export-batch — @juneflow/bank-file (fake formatter)
// ===========================================================================
describe("POST /api/v1/bank/export-batch", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/bank/export-batch",
    });
    expect(res.statusCode).toBe(401);
  });

  const exportDb = () =>
    stubDb({
      rows: [
        [
          pvs,
          [
            pvRow(PVA, { status: "approved", method: "transfer", net: "892400.00" }), // included
            pvRow(PVB, { status: "approved", method: "cheque", net: "402938.00" }), // excluded (cheque)
            pvRow(PVC, { status: "pending", method: "transfer", net: "96800.00" }), // excluded (pending)
          ],
        ],
        [apBillings, [billingRow]],
        [vendors, [vendorRow]],
      ],
    });

  it("builds the file for approved-transfer PVs only, via the bank-file fake formatter", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: exportDb() })
    ).inject({
      method: "POST",
      url: "/api/v1/bank/export-batch",
      payload: { batch_id: "batch-1", value_date: "2026-05-26" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.format).toBe("kbank-direct");
    expect(body.file_name).toBe("fake-kbank-direct-batch-1.txt");
    expect(body.pv_count).toBe(1); // only the approved transfer
    expect(body.pv_ids).toEqual([PVA]);
    expect(body.total_amount).toBe(892400); // PVA net
    expect(body.encoding).toBe("utf-8");
    // deterministic fake bank-file content — header + one instruction + trailer
    expect(body.content).toContain("FAKE-KBANK-DIRECT;batch-1;");
    expect(body.content).toContain("บจก. ซีแพค คอนกรีต");
    expect(body.content).toContain("892400.00;THB");
    expect(body.content).toContain("KBANK 012-3-45678-9"); // vendor.bank = beneficiary acct
    expect(body.content).toContain("T;1");
  });

  it("restricts to pv_ids and excludes an ineligible (cheque-method) PV", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: exportDb() })
    ).inject({
      method: "POST",
      url: "/api/v1/bank/export-batch",
      payload: { batch_id: "batch-2", pv_ids: [PVB] }, // PVB is cheque-method → not exported
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pv_count).toBe(0);
    expect(body.pv_ids).toEqual([]);
    expect(body.content).toContain("T;0");
  });
});

// ===========================================================================
// POST /bank/statements/import — parse file → create + F-BANK1 auto-match (B-093)
// ===========================================================================
describe("POST /api/v1/bank/statements/import", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/bank/statements/import",
      payload: { file: "2026-05-22,X,-1.00" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("parses the CSV file, creates the statement + lines, and auto-matches the single unambiguous candidate", async () => {
    const inserted: Inserted[] = [];
    const csv = [
      "date,description,amount", // header row → skipped
      "2026-05-22,FT PAYMENT,-15240.00", // → exact-amount + in-window match on CHQ_HIT
      "2026-05-01,MISC FEE,-999.00", // → no candidate → unmatched
    ].join("\n");
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            ...financeCaller, // finance.create — passes the import gate
            // insertThrough re-reads the (just-created) parent statement to prove
            // ownership — the stub ignores the WHERE, so a canned row stands in.
            [bankStatements, [statementRow(STMT0)]],
            [cheques, [chequeRow(CHQ_HIT, { no: "CH-040130", amount: "15240.00", dueDate: "2026-05-20" })]],
            [pvs, []],
            [rvs, []],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/bank/statements/import",
      payload: { period: "2569-05", file: csv },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.line_count).toBe(2);
    expect(body.matched_count).toBe(1); // only the unambiguous FT PAYMENT row
    expect(body.period).toBe("2569-05");
    expect(body.statement_id).toBeTruthy();

    // Statement created through the scoped insert door → company_id force-set.
    const stmtWrite = inserted.find((i) => i.table === bankStatements);
    expect(stmtWrite).toBeTruthy();
    expect((stmtWrite!.values as Record<string, unknown>).companyId).toBe(COMPANY);
    expect((stmtWrite!.values as Record<string, unknown>).locked).toBe(false);

    // Lines created via insertThrough — the matched one carries the cheque FK,
    // the other stays unmatched (the import never fabricates a match).
    const lineWrite = inserted.find((i) => i.table === bankStatementLines);
    expect(lineWrite).toBeTruthy();
    const lineRows = lineWrite!.values as unknown as Array<Record<string, unknown>>;
    expect(lineRows).toHaveLength(2);
    const matched = lineRows.find((r) => r.matched === true)!;
    expect(matched.chequeId).toBe(CHQ_HIT);
    expect(matched.pvId).toBeNull();
    expect(matched.amount).toBe("-15240.00"); // SIGNED preserved
    const unmatched = lineRows.find((r) => r.matched === false)!;
    expect(unmatched.chequeId).toBeNull();
    expect(unmatched.pvId).toBeNull();
  });

  // B-096 fix 1: a second import must NOT auto-match a doc already consumed by an
  // existing matched line — the migration-0028 partial-unique index would reject
  // the duplicate FK (a 500). The consumed doc is filtered from the import pool
  // and the row is left unmatched (manual flow), never guessed (C10).
  it("leaves a row unmatched when its only candidate is already consumed (no double-match / no 500)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            ...financeCaller, // finance.create — passes the import gate
            [bankStatements, [statementRow(STMT0)]], // insertThrough parent re-read
            // an EXISTING matched line already consumed CHQ_HIT → loadConsumedDocs
            // must filter it out of the import auto-match pool.
            [bankStatementLines, [lineRow(L_MATCHED, { matched: true, chequeId: CHQ_HIT })]],
            [cheques, [chequeRow(CHQ_HIT, { no: "CH-040130", amount: "15240.00", dueDate: "2026-05-20" })]],
            [pvs, []],
            [rvs, []],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/bank/statements/import",
      // this row's amount (15240) + date (05-22) exact-matches CHQ_HIT (due
      // 05-20, in ±7d) — but CHQ_HIT is already consumed, so it must be skipped.
      payload: { period: "2569-05", file: "2026-05-22,FT PAYMENT,-15240.00" },
    });

    expect(res.statusCode).toBe(200); // graceful — NOT a 500 from the unique index
    const body = res.json();
    expect(body.line_count).toBe(1);
    expect(body.matched_count).toBe(0); // the consumed cheque was not re-matched
    const lineWrite = inserted.find((i) => i.table === bankStatementLines);
    const lineRows = lineWrite!.values as unknown as Array<Record<string, unknown>>;
    expect(lineRows).toHaveLength(1);
    expect(lineRows[0]!.matched).toBe(false);
    expect(lineRows[0]!.chequeId).toBeNull(); // never linked the consumed cheque
  });

  it("accepts a structured lines[] array (already-parsed alternative form)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            ...financeCaller, // finance.create — passes the import gate
            [bankStatements, [statementRow(STMT0)]],
            [cheques, []],
            [pvs, []],
            [rvs, []],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/bank/statements/import",
      payload: {
        lines: [
          { date: "2026-05-22", description: "DEPOSIT", amount: 50000 },
          { date: "2026-05-23", description: "FEE", amount: -120.5 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.line_count).toBe(2);
    expect(body.matched_count).toBe(0); // no candidate docs → nothing pre-matched
    const lineWrite = inserted.find((i) => i.table === bankStatementLines);
    const lineRows = lineWrite!.values as unknown as Array<Record<string, unknown>>;
    expect(lineRows.map((r) => r.amount).sort()).toEqual(["-120.50", "50000.00"]);
  });

  it("400s a malformed file (amount column is not a number)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [...financeCaller] }), // finance.create — passes the gate; the parse then 400s
      })
    ).inject({
      method: "POST",
      url: "/api/v1/bank/statements/import",
      payload: { file: "2026-05-22,bad row,notanumber" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
    expect(res.json().message).toMatch(/not a number/);
  });

  it("400s an empty statement (header only → no lines)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [...financeCaller] }), // finance.create — passes the gate; the empty file then 400s
      })
    ).inject({
      method: "POST",
      url: "/api/v1/bank/statements/import",
      payload: { file: "date,description,amount" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/empty/);
  });

  it("400s when no file and no lines[] are provided", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [...financeCaller] }), // finance.create — passes the gate; missing file then 400s
      })
    ).inject({ method: "POST", url: "/api/v1/bank/statements/import", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/no statement file/);
  });

  // B-084 gate: import is finance-staff work → requires the finance `create` perm.
  it("403s (fail closed) a caller lacking the finance create perm — no import runs", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [users, [userRow]],
            [roles, [financeRole(/* create */ false, /* approve */ true)]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/bank/statements/import",
      payload: { period: "2569-05", file: "2026-05-22,FT PAYMENT,-15240.00" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(res.json().message).toMatch(/finance create permission/);
    expect(inserted).toHaveLength(0); // no statement/line was imported
  });
});

// ===========================================================================
// POST /bank/reconcile — lock/close a period (B-093)
// ===========================================================================
describe("POST /api/v1/bank/reconcile", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/bank/reconcile",
      payload: { period: "2569-05" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("400s when no period is given", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [...financeCaller] }), // finance.approve — passes the gate; missing period then 400s
      })
    ).inject({ method: "POST", url: "/api/v1/bank/reconcile", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/period is required/);
  });

  it("404s when the period has no statement", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [...financeCaller, [bankStatements, []]] }), // finance.approve — passes the gate; the period 404s
      })
    ).inject({ method: "POST", url: "/api/v1/bank/reconcile", payload: { period: "2569-99" } });
    expect(res.statusCode).toBe(404);
  });

  it("locks the period, returns honest matched_pct, and binds company_id (tenant scope)", async () => {
    const captured: Captured[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            ...financeCaller, // finance.approve — passes the reconcile gate
            [bankStatements, [statementRow(STMT0, { period: "2569-05", locked: false })]],
            [
              bankStatementLines,
              [
                lineRow(L_MATCHED, { matched: true, chequeId: CHQ0 }),
                lineRow(L_HIT, { matched: false }),
              ],
            ],
          ],
          captured,
          updated,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/bank/reconcile", payload: { period: "2569-05" } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.locked).toBe(true);
    expect(body.statement_count).toBe(1);
    expect(body.line_count).toBe(2);
    expect(body.matched_count).toBe(1);
    expect(body.matched_pct).toBe(50);

    // The lock write sets locked=true, scoped to this tenant.
    const write = updated.find((u) => u.table === bankStatements);
    expect(write).toBeTruthy();
    expect(write!.set.locked).toBe(true);
    // The period read is company-scoped.
    const read = captured.find((c) => c.table === bankStatements);
    expect(paramsOf(read!.where)).toContain(COMPANY);
  });

  it("409s a period that is already reconciled (all statements locked)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            ...financeCaller, // finance.approve — passes the gate; the locked period then 409s
            [bankStatements, [statementRow(STMT0, { period: "2569-05", locked: true })]],
          ],
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/bank/reconcile", payload: { period: "2569-05" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  // B-084 gate (priority): reconcile LOCKS the period (closes the books) → it
  // requires the finance `approve` perm. A caller with the perm off is denied and
  // the lock write never runs (the period stays open).
  it("403s (fail closed) a caller lacking the finance approve perm — the period is NOT locked", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [users, [userRow]],
            [roles, [financeRole(/* create */ true, /* approve */ false)]],
            [bankStatements, [statementRow(STMT0, { period: "2569-05", locked: false })]],
          ],
          updated,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/bank/reconcile", payload: { period: "2569-05" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(res.json().message).toMatch(/finance approve permission/);
    expect(updated).toHaveLength(0); // the lock never ran — the period stays open
  });

  // Fail-closed: a resolved session whose email maps to NO dictionary user cannot
  // be attributed → 403 before the period can be locked.
  it("403s (fail closed) an unattributable caller — session resolved but no dictionary user", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [users, []], // the session email resolves to NO dictionary user → no caller
            [bankStatements, [statementRow(STMT0, { period: "2569-05", locked: false })]],
          ],
          updated,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/bank/reconcile", payload: { period: "2569-05" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(res.json().message).toMatch(/cannot be attributed/);
    expect(updated).toHaveLength(0);
  });
});

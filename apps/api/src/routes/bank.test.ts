// G3 unit tests (PLAN.md §9) — bank handlers (P2-BE-19 part 2, Wave-2 finance).
// Covers GET /bank/statements (line_count / matched_pct / bank_balance = Σ signed,
// honest-null book_balance, tenant scope), GET /bank/statements/{id}/lines
// (statement 404, matched_doc resolve, F-BANK1 suggestions = exact-amount +
// date-window: an in-window amount-match suggests, an out-of-window one does
// NOT), POST /bank/lines/{id}/match (exactly-one-id 400, 404, already-matched
// 409, fail-closed foreign-doc reject, and the tenant-verified confirm write),
// GET /bank/cheque (register + honest-null pv_no, tenant scope), and POST
// /bank/export-batch (approved-transfer filter + @juneflow/bank-file fake output,
// pv_ids restriction, the B-397 post-export lock: a sent PV is stamped with
// the batch id and never re-emitted, an already-sent pv_ids is 409, nothing
// waiting is 409, and a PV stamped between the read and the guarded write is left
// out of the file; and the B-400 finance-`approve` gate on the money-out export:
// create is not enough, an unattributable caller is denied, and a denial stamps
// nothing and returns no file). Every expected value comes from the stub / the
// real bank-file formatter — not hand-computed against the impl.
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
  /**
   * B-397: the rows `UPDATE ... RETURNING` answers with. Default = the historical
   * single synthetic row ({...updateBase, ...set}), which is enough for a
   * one-row status flip. The export-batch world hands in a function instead,
   * because a batch stamp must be able to return the REAL matching pv rows — and,
   * when the guard excludes one, FEWER rows than the WHERE asked for.
   */
  updateRows?: (u: Updated) => unknown[];
}

/** Db stub: canned rows per table (reads, incl. selectThrough joins) + write capture. */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [], updated = [], updateBase = {} } = opts;
  const { updateRows } = opts;
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
      // B-388 · BOTH insert doors. TenantDb.insert() returns the builder WITHOUT
      // .returning() and the caller awaits it directly, so a `.returning()`-only
      // stub records nothing for such a write and every absence assertion about
      // it is vacuous. One `record()` closure sits behind both doors — invoked
      // once per DOOR CALL, never in the `values(...)` body (which would make
      // `.returning()` double-count). Evidence at the foot of this file.
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => {
        const record = (): Record<string, unknown>[] => {
          inserted.push({ table, values: values as Record<string, unknown> });
          // insertThrough passes an ARRAY of child rows; the scoped insert door
          // passes one object. Return one synthetic row per inserted row.
          const rows = Array.isArray(values) ? values : [values];
          return rows.map((v) => ({ id: `new-${seq++}`, createdAt: D, ...v }));
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
            const write: Updated = { table, set, where };
            updated.push(write);
            return Promise.resolve(updateRows ? updateRows(write) : [{ ...updateBase, ...set }]);
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

/** The COMPILED SQL text of a captured predicate — so a test can assert the GUARD
 *  itself (`"pv"."batch_id" is null`), not merely that some UPDATE happened (B-397). */
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

  // B-323: the line list ordered on line_date alone. That is a business DATE, so ties
  // are the NORM here — a statement routinely carries several lines on one day — and
  // the comparator returned 0 for every one of them, leaving their order to the join
  // plan. It now falls through to created_at (the seed's stagger / real import order)
  // and then to id, which is unique by construction.
  it("is TOTAL for lines sharing a line_date — the common case, not an edge", async () => {
    const ids = async (rows: unknown[]): Promise<string[]> => {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({
            rows: [
              [bankStatements, [statementRow(STMT0)]],
              [bankStatementLines, rows],
              [pvs, []],
              [cheques, []],
              [rvs, []],
            ],
          }),
        })
      ).inject({ url: `/api/v1/bank/statements/${STMT0}/lines` });
      return res.json().data.map((r: { id: string }) => r.id);
    };
    // Three lines on ONE day. `lineRow()` hardcodes the same createdAt too, so only
    // the id floor can order them — exactly the state the old comparator left open.
    const a = lineRow("aaa", { lineDate: "2026-05-22" });
    const b = lineRow("bbb", { lineDate: "2026-05-22" });
    const c = lineRow("ccc", { lineDate: "2026-05-22" });
    expect(await ids([a, b, c])).toEqual(["aaa", "bbb", "ccc"]);
    expect(await ids([c, a, b])).toEqual(["aaa", "bbb", "ccc"]);
    expect(await ids([c, b, a])).toEqual(["aaa", "bbb", "ccc"]);
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
// POST /bank/export-batch — @juneflow/bank-file (fake formatter) + the B-397
// post-export lock (pv.batch_id)
// ===========================================================================
// B-397 — WHY THE FIXTURE IS A "WORLD" AND NOT CANNED ROWS. The defect being
// closed here is that the handler stored the batch id NOWHERE, so an approved
// transfer PV stayed eligible for every future export. That defect is invisible
// to a stub whose rows never change: the second export reads the same pristine
// world as the first. exportWorld() therefore PERSISTS the stamp — the guarded
// UPDATE ... RETURNING answers with the rows it matched and writes the batch id
// back into the canned pv rows, so a SECOND export reads the world the FIRST one
// left behind.
//
// And it HONORS the handler's real predicate rather than re-implementing the rule
// it is supposed to be testing: the `batch_id IS NULL` filter is applied only when
// the COMPILED WHERE actually carries it (sqlOf), and the id set comes from the
// compiled params. Delete the guard from bank.ts and the stub starts matching
// already-stamped rows — the re-export and concurrency tests go RED. A stub that
// filtered on its own would have proved itself instead.
const PVD = "pv000000-0000-0000-0000-0000000000vd";
const BATCH1 = "ba100000-0000-0000-0000-0000000000b1";
const BATCH2 = "ba200000-0000-0000-0000-0000000000b2";
const OTHER_BATCH = "ba900000-0000-0000-0000-0000000000b9";
const EXPORT_URL = "/api/v1/bank/export-batch";

type PvSelect = typeof pvs.$inferSelect;

/** The exact fake-KBANK instruction line for a PV (beneficiary = vendorRow, and
 *  `reference` = the pv id) — so a test asserts on the EMITTED LINE, not a count. */
const instructionLine = (pvId: string, net: string) =>
  `D;;${vendorRow.bank};${vendorRow.name};${net};THB;${pvId}`;

/** Two eligible transfer PVs (so a batch can omit one and still emit), plus the
 *  two shapes that are never eligible: cheque-method and pending. */
const exportSeed = (): PvSelect[] => [
  pvRow(PVA, { status: "approved", method: "transfer", net: "892400.00" }), // eligible
  pvRow(PVB, { status: "approved", method: "cheque", net: "402938.00" }), // excluded (cheque)
  pvRow(PVC, { status: "pending", method: "transfer", net: "96800.00" }), // excluded (pending)
  pvRow(PVD, { status: "approved", method: "transfer", net: "561150.00" }), // eligible
];

interface ExportWorld {
  db: Db;
  /** The live pv rows — read by every request, mutated by every stamp. */
  pvState: PvSelect[];
  updated: Updated[];
  /** Queue a concurrent export's commit: it lands BETWEEN the next request's read
   *  and its guarded write — exactly the window the B-149 guard exists for. */
  steal: (...ids: string[]) => void;
}

function exportWorld(
  seed: PvSelect[] = exportSeed(),
  // B-400: the export gate needs finance `approve`, so the world seeds a real
  // authorized caller (users + roles rows the production loadCaller resolves) —
  // the same grant the reconcile tests use. Override it to prove the gate.
  caller: Array<[unknown, unknown[]]> = financeCaller,
): ExportWorld {
  const pvState = seed.map((r) => ({ ...r }));
  const updated: Updated[] = [];
  const pendingSteal: string[] = [];
  const db = stubDb({
    rows: [
      ...caller,
      [pvs, pvState],
      [apBillings, [billingRow]],
      [vendors, [vendorRow]],
    ],
    updated,
    updateRows: (u) => {
      // The concurrent export commits here — after our read, before our write.
      for (const id of pendingSteal.splice(0)) {
        const row = pvState.find((r) => r.id === id);
        if (row) row.batchId = OTHER_BATCH;
      }
      // Membership comes from the handler's OWN compiled predicate: the ids it
      // asked for, and the batch_id guard only if it really carries one.
      const params = paramsOf(u.where);
      const asked = new Set(
        pvState.filter((r) => params.includes(r.id)).map((r) => r.id),
      );
      const guarded = sqlOf(u.where).includes('"batch_id" is null');
      const matched = pvState.filter(
        (r) => asked.has(r.id) && (!guarded || r.batchId == null),
      );
      const stamp = String((u.set as Record<string, unknown>).batchId ?? "");
      const returned = matched.map((r) => ({ ...r, batchId: stamp }));
      for (const r of matched) r.batchId = stamp; // persist — the next export sees it
      return returned;
    },
  });
  return { db, pvState, updated, steal: (...ids) => pendingSteal.push(...ids) };
}

/** The batch id a stamped row ended up carrying (null when it was never stamped). */
const stampOf = (world: ExportWorld, pvId: string): string | null =>
  world.pvState.find((r) => r.id === pvId)?.batchId ?? null;

describe("POST /api/v1/bank/export-batch", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: EXPORT_URL,
    });
    expect(res.statusCode).toBe(401);
  });

  // B-400 gate. A live preflight on a seeded stack drove this endpoint as the
  // Warehouse role (finance.view = false) and got 200 with a real KBANK payment
  // instruction for 93,896 THB: it was the only bank mutation with no perm gate.
  // It emits the money-OUT instrument AND takes the B-397 one-way lock, so it
  // requires finance `approve` — same tier as /bank/reconcile.
  //
  // The assertions that matter are the two ABSENCES: no UPDATE was issued and no
  // file came back. A test checking only the status code would still pass if the
  // gate were later moved BELOW the stamp — the PV would be locked forever by a
  // request that was refused.
  it("403s (fail closed) a caller lacking the finance approve perm — nothing stamped, no file", async () => {
    const world = exportWorld(exportSeed(), [
      [users, [userRow]],
      [roles, [financeRole(/* create */ false, /* approve */ false)]],
    ]);
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: world.db })
    ).inject({ method: "POST", url: EXPORT_URL, payload: { batch_id: BATCH1 } });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(res.json().message).toMatch(/finance approve permission/);
    expect(res.json().content).toBeUndefined(); // the bank never got an instruction
    expect(world.updated).toHaveLength(0); // and no PV was locked to a batch
    expect(stampOf(world, PVA)).toBeNull();
    expect(stampOf(world, PVD)).toBeNull();
  });

  // Pins the RIGHT, not merely "some gate": the create tier is what the data-entry
  // doors beside this one (line match, statement import) require. Loosening the
  // export to create would let a finance clerk send money — this goes RED if it is.
  it("403s a caller holding finance create but NOT approve — create is not enough to send money", async () => {
    const world = exportWorld(exportSeed(), [
      [users, [userRow]],
      [roles, [financeRole(/* create */ true, /* approve */ false)]],
    ]);
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: world.db })
    ).inject({ method: "POST", url: EXPORT_URL, payload: { batch_id: BATCH1 } });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(res.json().message).toMatch(/finance approve permission/);
    expect(res.json().content).toBeUndefined();
    expect(world.updated).toHaveLength(0);
    expect(stampOf(world, PVA)).toBeNull();
  });

  // Fail-closed: a resolved session whose email maps to NO dictionary user cannot
  // be attributed → denied before the file is built or any PV is stamped.
  it("403s (fail closed) an unattributable caller — session resolved but no dictionary user", async () => {
    const world = exportWorld(exportSeed(), [[users, []]]);
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: world.db })
    ).inject({ method: "POST", url: EXPORT_URL, payload: { batch_id: BATCH1 } });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(res.json().message).toMatch(/cannot be attributed/);
    expect(res.json().content).toBeUndefined();
    expect(world.updated).toHaveLength(0);
    expect(stampOf(world, PVA)).toBeNull();
  });

  // The gate runs BEFORE the body is parsed — a denied caller never reaches the
  // batch_id shape check, so a payload that would 400 for an authorized caller
  // still 403s here. Deny before you read.
  it("denies before parsing the body — a malformed batch_id from an unauthorized caller still 403s", async () => {
    const world = exportWorld(exportSeed(), [
      [users, [userRow]],
      [roles, [financeRole(/* create */ true, /* approve */ false)]],
    ]);
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: world.db })
    ).inject({ method: "POST", url: EXPORT_URL, payload: { batch_id: "batch-1" } });

    expect(res.statusCode).toBe(403); // NOT the 400 the authorized caller gets
    expect(res.json().code).toBe("FORBIDDEN");
    expect(world.updated).toHaveLength(0);
  });

  // POSITIVE CONTROL: the feature itself still works — the eligible PVs are
  // exported, with the right net, on the real fake-formatter line shape. Same
  // fixture as the three denials above, differing ONLY in the granted perm, so an
  // over-broad B-400 gate (denying everyone) shows up here as a failure.
  it("builds the file for approved-transfer PVs only, via the bank-file fake formatter", async () => {
    const world = exportWorld();
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: world.db })
    ).inject({
      method: "POST",
      url: EXPORT_URL,
      payload: { batch_id: BATCH1, value_date: "2026-05-26" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.format).toBe("kbank-direct");
    expect(body.file_name).toBe(`fake-kbank-direct-${BATCH1}.txt`);
    expect(body.pv_count).toBe(2); // the two approved transfers
    expect(body.pv_ids).toEqual([PVA, PVD]);
    expect(body.total_amount).toBe(1453550); // 892400 + 561150
    expect(body.encoding).toBe("utf-8");
    // deterministic fake bank-file content — header + one line per PV + trailer
    const lines = (body.content as string).split("\n");
    expect(lines[0]).toBe(`FAKE-KBANK-DIRECT;${BATCH1};${COMPANY};2026-05-26`);
    expect(lines).toContain(instructionLine(PVA, "892400.00"));
    expect(lines).toContain(instructionLine(PVD, "561150.00"));
    expect(body.content).not.toContain(PVB); // cheque-method is never exported
    expect(body.content).not.toContain(PVC); // pending is never exported
    expect(lines.at(-1)).toBe("T;2");
  });

  it("stamps pv.batch_id with the batch id it reports, guarding the FINAL UPDATE", async () => {
    const world = exportWorld();
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: world.db })
    ).inject({ method: "POST", url: EXPORT_URL, payload: {} });

    expect(res.statusCode).toBe(200);
    const reported = res.json().batch_id as string;
    expect(reported).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    expect(world.updated).toHaveLength(1);
    const write = world.updated[0]!;
    expect(write.table).toBe(pvs);
    expect(write.set).toEqual({ batchId: reported }); // written id === reported id
    // Tenant-scoped, narrowed to the candidates, and carrying the B-149 guard on
    // the UPDATE's OWN where — not on the select that resolved the candidates.
    expect(paramsOf(write.where)).toContain(COMPANY);
    expect(paramsOf(write.where)).toEqual(expect.arrayContaining([PVA, PVD]));
    expect(sqlOf(write.where)).toContain('"batch_id" is null');
    // The rows really carry it now; an ineligible PV was never touched.
    expect(stampOf(world, PVA)).toBe(reported);
    expect(stampOf(world, PVD)).toBe(reported);
    expect(stampOf(world, PVB)).toBeNull();
    expect(stampOf(world, PVC)).toBeNull();
  });

  // THE DEFECT (H4): before B-397 the same approved transfer PV came back in every
  // batch, forever — one correct upload still re-emitted the payment next time.
  it("never re-emits a PV a previous export already sent", async () => {
    const world = exportWorld();
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db: world.db });

    const first = await app.inject({
      method: "POST",
      url: EXPORT_URL,
      payload: { batch_id: BATCH1, pv_ids: [PVA] },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json().pv_ids).toEqual([PVA]);
    expect((first.json().content as string).split("\n")).toContain(
      instructionLine(PVA, "892400.00"),
    );

    const second = await app.inject({
      method: "POST",
      url: EXPORT_URL,
      payload: { batch_id: BATCH2 },
    });
    expect(second.statusCode).toBe(200);
    const body = second.json();
    const lines = (body.content as string).split("\n");
    // PVA is SENT — it is not in the waiting-to-send set any more.
    expect(body.pv_ids).toEqual([PVD]);
    expect(body.pv_count).toBe(1);
    expect(body.total_amount).toBe(561150);
    expect(lines).toContain(instructionLine(PVD, "561150.00"));
    expect(lines).not.toContain(instructionLine(PVA, "892400.00"));
    expect(body.content).not.toContain(PVA); // no line references it at all
    expect(lines.at(-1)).toBe("T;1");
    // Eligibility excluded it up front: the second UPDATE never even ASKS for PVA,
    // and the first batch's stamp is not overwritten.
    expect(paramsOf(world.updated[1]!.where)).not.toContain(PVA);
    expect(stampOf(world, PVA)).toBe(BATCH1);
  });

  it("409s an explicit pv_ids naming an already-exported PV, and stamps nothing", async () => {
    const world = exportWorld();
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db: world.db });

    const first = await app.inject({
      method: "POST",
      url: EXPORT_URL,
      payload: { batch_id: BATCH1, pv_ids: [PVA] },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: EXPORT_URL,
      payload: { batch_id: BATCH2, pv_ids: [PVA, PVD] },
    });
    expect(second.statusCode).toBe(409);
    const body = second.json();
    expect(body.code).toBe("INVALID_STATE");
    expect(body.message).toContain(PVA); // the caller is TOLD, not silently dropped
    expect(body.content).toBeUndefined(); // no batch file
    // The whole request failed before any stamp: only the FIRST export wrote, and
    // the eligible PVD it also named is untouched.
    expect(world.updated).toHaveLength(1);
    expect(stampOf(world, PVD)).toBeNull();
  });

  it("409s (no batch file) when nothing is waiting to be sent, issuing no UPDATE", async () => {
    const world = exportWorld([
      pvRow(PVA, { status: "approved", method: "transfer", batchId: BATCH1 }), // already sent
      pvRow(PVB, { status: "approved", method: "cheque" }), // never eligible
      pvRow(PVC, { status: "pending", method: "transfer" }), // never eligible
    ]);
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: world.db })
    ).inject({ method: "POST", url: EXPORT_URL, payload: { batch_id: BATCH2 } });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe("INVALID_STATE");
    expect(body.message).toContain("waiting to be sent");
    expect(body.file_name).toBeUndefined();
    expect(body.content).toBeUndefined(); // a zero-instruction bank file is a footgun
    expect(world.updated).toHaveLength(0); // the sent PV was not even asked for
    expect(stampOf(world, PVA)).toBe(BATCH1); // and its batch is not overwritten
  });

  it("restricts to pv_ids: an ineligible (cheque-method) PV leaves nothing to send", async () => {
    const world = exportWorld();
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: world.db })
    ).inject({
      method: "POST",
      url: EXPORT_URL,
      payload: { batch_id: BATCH2, pv_ids: [PVB] }, // PVB is cheque-method → not exported
    });
    // B-397 changed this from a 200 carrying an empty "T;0" file to a 409.
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
    expect(res.json().content).toBeUndefined();
    expect(world.updated).toHaveLength(0);
    expect(stampOf(world, PVB)).toBeNull();
  });

  it("excludes a PV stamped between the read and the guarded write (concurrent export)", async () => {
    const world = exportWorld();
    world.steal(PVA); // a concurrent batch commits PVA's stamp after our read
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: world.db })
    ).inject({ method: "POST", url: EXPORT_URL, payload: { batch_id: BATCH2 } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const lines = (body.content as string).split("\n");
    // PVA WAS in the candidate list at read time — the guarded UPDATE matched 0
    // rows for it, so it must not appear in the file this call hands to the bank.
    expect(paramsOf(world.updated[0]!.where)).toContain(PVA);
    expect(body.pv_ids).toEqual([PVD]);
    expect(body.pv_count).toBe(1);
    expect(body.total_amount).toBe(561150);
    expect(lines).toContain(instructionLine(PVD, "561150.00"));
    expect(lines).not.toContain(instructionLine(PVA, "892400.00"));
    expect(body.content).not.toContain(PVA);
    expect(lines.at(-1)).toBe("T;1");
    expect(stampOf(world, PVA)).toBe(OTHER_BATCH); // the winner's batch stands
  });

  it("409s when every candidate was taken by a concurrent export", async () => {
    const world = exportWorld();
    world.steal(PVA, PVD);
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: world.db })
    ).inject({ method: "POST", url: EXPORT_URL, payload: { batch_id: BATCH2 } });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
    expect(res.json().message).toContain("concurrent");
    expect(res.json().content).toBeUndefined();
    expect(stampOf(world, PVA)).toBe(OTHER_BATCH);
    expect(stampOf(world, PVD)).toBe(OTHER_BATCH);
  });

  it("400s a malformed batch_id (B-397: it is written to a uuid column now)", async () => {
    const world = exportWorld();
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: world.db })
    ).inject({ method: "POST", url: EXPORT_URL, payload: { batch_id: "batch-1" } });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ code: "VALIDATION", message: "batch_id must be a uuid" });
    expect(world.updated).toHaveLength(0);
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
    const bare = await doorOf(db, bankStatements).values({ no: "bare" });
    expect(inserted).toHaveLength(1);
    // The .returning() door (insertThrough / insert(...).returning()).
    const ret = await doorOf(db, bankStatements).values({ no: "ret" }).returning();
    expect(inserted).toHaveLength(2);

    expect(inserted).toEqual([
      { table: bankStatements, values: { no: "bare" } },
      { table: bankStatements, values: { no: "ret" } },
    ]);
    // The ids prove `seq` advanced exactly ONCE per write — no door double-recorded.
    expect(bare).toEqual([{ id: "new-0", createdAt: D, no: "bare" }]);
    expect(ret).toEqual([{ id: "new-1", createdAt: D, no: "ret" }]);
  });

  it("expands an ARRAY of child rows identically through EITHER door", async () => {
    const insertedBare: Inserted[] = [];
    const bare = await doorOf(stubDb({ rows: [], inserted: insertedBare }), bankStatementLines)
      .values([{ no: "a" }, { no: "b" }]);
    const insertedRet: Inserted[] = [];
    const ret = await doorOf(stubDb({ rows: [], inserted: insertedRet }), bankStatementLines)
      .values([{ no: "a" }, { no: "b" }])
      .returning();

    // ONE recording for the batch (not one per row), same shape from both doors.
    expect(insertedBare).toEqual(insertedRet);
    expect(insertedBare).toHaveLength(1);
    expect(bare).toEqual(ret);
    expect(bare).toEqual([
      { id: "new-0", createdAt: D, no: "a" },
      { id: "new-1", createdAt: D, no: "b" },
    ]);
  });
});

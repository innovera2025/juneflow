// G3 unit tests (PLAN.md §9) — PO handlers (P2-BE-05, B-070; po-wo.jsx POList +
// POForm, flows.html FLOW-A + MATRIX "PO ใบสั่งซื้อ"). Covers the B-014 list
// envelope over real po columns, create-from-approved-PR (201, server-owned
// draft + approval_step 0, total seeded from the source PR's priced lines — C10,
// requires an approved pr_id + this tenant's vendor), single-doc detail with its
// variation orders, and the submit→approve→reject state machine with the PO/WO
// TIERED approval matrix (≤1M needs หน.จัดซื้อ/level 2; >1M needs ผจก.โครงการ/level 3;
// >5M needs MD/level 4 — NOTE the thresholds differ from PR's 500K/2M), plus the
// variation-order amendment (add/cut adjusts the stored total). Tenant scope is
// bound on the project root reached THROUGH pr_id → pr → project (no cross-tenant
// leak). All money comes from the stubbed rows — no value is hand-computed
// against the impl.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  apBillings,
  boqItems,
  pos,
  projects,
  prItems,
  prs,
  roles,
  users,
  variationOrders,
  vendors,
} from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const OTHER_COMPANY = "33333333-3333-3333-3333-333333333333";
const PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PR = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const VENDOR = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const D = new Date(1_700_000_000_000);

const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "wipha@rungrueang.co.th", name: "วิภา" },
};

interface Captured {
  table: unknown;
  where: SQL | undefined;
}
interface Inserted {
  table: unknown;
  rows: unknown[];
}
interface Updated {
  table: unknown;
  set: Record<string, unknown>;
  where: SQL | undefined;
}
interface StubOpts {
  rows: Array<[unknown, unknown[]]>;
  captured?: Captured[];
  inserted?: Inserted[];
  updated?: Updated[];
  updateBase?: Record<string, unknown>;
}

/** Base Db stub: canned rows per table for reads; capture of write ops. */
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
  return {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        returning: () => {
          const list = Array.isArray(values) ? values : [values];
          inserted.push({ table, rows: list });
          return Promise.resolve(
            list.map((r) => ({ id: `new-${seq++}`, ...(r as object) })),
          );
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
  return app;
}

// ---------------------------------------------------------------------------
// Row factories (stub-backed)
// ---------------------------------------------------------------------------

const project = { id: PROJECT, companyId: COMPANY, name: "juneflow ราชพฤกษ์" };
const vendor = { id: VENDOR, companyId: COMPANY, name: "บจก. ซัพพลาย", kind: "supplier" };

const prRow = (status: "draft" | "pending" | "approved" | "rejected") => ({
  id: PR,
  projectId: PROJECT,
  no: "PR-2026-0001",
  type: "material",
  needDate: null,
  status,
  approvalStep: 0,
  createdAt: D,
  updatedAt: D,
});

const po = (
  id: string,
  no: string | null,
  status: "draft" | "pending" | "approved" | "rejected",
  total: number,
  prId: string | null = PR,
) => ({
  id,
  prId,
  vendorId: VENDOR,
  no,
  total: String(total),
  vat: "0",
  currencyCode: "THB",
  creditTerm: 30,
  status,
  approvalStep: 0,
  createdAt: D,
  updatedAt: D,
});

// An ap_billing row for the paid/deposit split (B-079 / F2).
const apBilling = (
  id: string,
  poId: string,
  amount: number,
  kind: "deposit" | "progress" | "final",
) => ({
  id,
  companyId: COMPANY,
  poId,
  grId: null,
  vendorId: VENDOR,
  invoiceNo: `INV-${id}`,
  dueDate: null,
  amount: String(amount),
  vat: "0",
  currencyCode: "THB",
  status: "approved",
  kind,
  createdAt: D,
  updatedAt: D,
});

const voRow = (id: string, poId: string, dir: "add" | "cut", amount: number) => ({
  id,
  poId,
  dir,
  amount: String(amount),
  currencyCode: "THB",
  reason: "เพิ่มงาน",
  createdAt: D,
  updatedAt: D,
});

const prLine = (id: string, prId: string, boqItemId: string | null, qty: string) => ({
  id,
  prId,
  boqItemId,
  qty,
  createdAt: D,
  updatedAt: D,
});

const boqItemPriced = (id: string, price: string, currencyCode = "THB") => ({
  id,
  groupId: "g0",
  code: `C-${id}`,
  name: `item ${id}`,
  cat: "M",
  qty: "0",
  unit: "ถุง",
  price,
  currencyCode,
  ccId: null,
  remainQty: "0",
  elementId: null,
  createdAt: D,
  updatedAt: D,
});

const roleRow = (approvalLevel: number) => ({
  id: "role-0",
  companyId: COMPANY,
  name: "Role",
  approvalLimits: {},
  perms: {},
  approvalLevel,
  approvalLimit: null,
  currencyCode: "THB",
  createdAt: D,
  updatedAt: D,
});

const userRow = {
  id: "u-0",
  companyId: COMPANY,
  email: "wipha@rungrueang.co.th",
  name: "วิภา",
  roleId: "role-0",
  status: "active",
};

// ---------------------------------------------------------------------------
// GET /po — list + tenant scope
// ---------------------------------------------------------------------------

describe("GET /api/v1/po — auth + list", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/po" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  // B-323 round 2: this is the endpoint the whole blocker exists for. GET /po is a
  // selectThrough (three INNER JOINs, no ORDER BY), and po.list is a manifest screen
  // with a committed baseline. Measured live on the seeded stack under forced planner
  // configs, the raw chain returns:
  //   default   -> PO-2026-0291 0290 0289 0288 0287 0286
  //   mergejoin -> PO-2026-0287 0291 0286 0288 0290 0289
  // Removing the sort left ALL 1476 tests green, which is why these tests exist: the
  // suite could not previously tell the fixed code from the broken code.
  it("emits a TOTAL order — the same list whatever order the join plan returns", async () => {
    const at = (iso: string): Date => new Date(iso);
    const seeded = [
      { ...po("p291", "PO-2026-0291", "approved", 1), createdAt: at("2026-07-20T09:00:00Z") },
      { ...po("p290", "PO-2026-0290", "approved", 1), createdAt: at("2026-07-20T08:59:59Z") },
      { ...po("p289", "PO-2026-0289", "approved", 1), createdAt: at("2026-07-20T08:59:58Z") },
      { ...po("p288", "PO-2026-0288", "approved", 1), createdAt: at("2026-07-20T08:59:57Z") },
      { ...po("p287", "PO-2026-0287", "approved", 1), createdAt: at("2026-07-20T08:59:56Z") },
      { ...po("p286", "PO-2026-0286", "approved", 1), createdAt: at("2026-07-20T08:59:55Z") },
    ];
    const expected = ["p291", "p290", "p289", "p288", "p287", "p286"];
    const listIds = async (rows: unknown[]): Promise<string[]> => {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({ rows: [[pos, rows], [apBillings, []]] }),
        })
      ).inject({ url: "/api/v1/po" });
      return res.json().data.map((r: { id: string }) => r.id);
    };
    expect(await listIds(seeded)).toEqual(expected);
    // the EXACT permutation the merge-join plan produced on the live stack
    expect(await listIds([seeded[4]!, seeded[0]!, seeded[5]!, seeded[3]!, seeded[1]!, seeded[2]!]))
      .toEqual(expected);
    expect(await listIds([...seeded].reverse())).toEqual(expected);
  });

  it("breaks a same-instant tie on id, so POs raised in one second still order", async () => {
    const same = new Date("2026-07-20T09:00:00Z");
    const rows = [
      { ...po("zz", "PO-Z", "approved", 1), createdAt: same },
      { ...po("aa", "PO-A", "approved", 1), createdAt: same },
    ];
    const listIds = async (r: unknown[]): Promise<string[]> => {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({ rows: [[pos, r], [apBillings, []]] }),
        })
      ).inject({ url: "/api/v1/po" });
      return res.json().data.map((x: { id: string }) => x.id);
    };
    expect(await listIds(rows)).toEqual(["aa", "zz"]);
    expect(await listIds([...rows].reverse())).toEqual(["aa", "zz"]);
  });

  it("returns the B-014 envelope of real po columns + AP paid/deposit split", async () => {
    // Two billings on p0: a 300k deposit + a 200k progress → paid 500k, deposit 300k.
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pos, [po("p0", "PO-2026-0291", "approved", 1268000)]],
            [
              apBillings,
              [
                apBilling("ap0", "p0", 300000, "deposit"),
                apBilling("ap1", "p0", 200000, "progress"),
              ],
            ],
          ],
        }),
      })
    ).inject({ url: "/api/v1/po" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    const p0 = body.data[0];
    expect(p0.no).toBe("PO-2026-0291");
    expect(p0.status).toBe("approved");
    expect(p0.amount).toBe(1268000);
    expect(p0.total).toBe(1268000);
    // B-079 (F2): paid = Σ all billings; deposit = Σ kind=deposit (both real).
    expect(p0.paid).toBe(500000);
    expect(p0.deposit).toBe(300000);
    expect(Object.keys(p0).sort()).toEqual(
      [
        "amount",
        "approval_step",
        "credit_term",
        "currency_code",
        "deposit",
        "doc_date",
        "id",
        "no",
        "paid",
        "pr_id",
        "status",
        "total",
        "vat",
        "vendor_id",
      ],
    );
  });

  it("rounds paid/deposit to 2 dp — no Σ ap_billing float drift (B-085 fix 3)", async () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE-754 → paid must surface as 0.3, and
    // the lone 0.2 deposit stays exact.
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pos, [po("p0", "PO-DRIFT", "approved", 1)]],
            [
              apBillings,
              [
                apBilling("ap0", "p0", 0.2, "deposit"),
                apBilling("ap1", "p0", 0.1, "progress"),
              ],
            ],
          ],
        }),
      })
    ).inject({ url: "/api/v1/po" });
    expect(res.statusCode).toBe(200);
    const p0 = res.json().data[0];
    expect(p0.paid).toBe(0.3);
    expect(p0.deposit).toBe(0.2);
  });

  it("binds company_id on the project root of the scoped read (no cross-tenant leak)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pos, [po("p0", "N", "draft", 1)]]], captured }),
      })
    ).inject({ url: "/api/v1/po" });
    const read = captured.find((c) => c.table === pos);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
    expect(paramsOf(read!.where)).not.toContain(OTHER_COMPANY);
  });
});

// ---------------------------------------------------------------------------
// POST /po — create from an approved PR
// ---------------------------------------------------------------------------

describe("POST /api/v1/po — create from approved PR", () => {
  it("creates a draft PO (201) with total seeded from the source PR's priced lines (C10)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [prs, [prRow("approved")]],
            [vendors, [vendor]],
            [pos, []],
            [projects, [project]],
            [prItems, [prLine("l0", PR, "b0", "10")]], // 10 × 168.50 = 1685
            [boqItems, [boqItemPriced("b0", "168.50")]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/po",
      payload: { pr_id: PR, vendor_id: VENDOR, no: "PO-2026-0999", vat: 118, credit_term: 45 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("draft");
    expect(body.approval_step).toBe(0);
    expect(body.pr_id).toBe(PR);
    expect(body.vendor_id).toBe(VENDOR);
    expect(body.total).toBe(1685);
    expect(body.amount).toBe(1685);
    expect(body.vat).toBe(118);
    expect(body.credit_term).toBe(45);
    const write = inserted.find((w) => w.table === pos);
    expect((write!.rows[0] as { status: string }).status).toBe("draft");
    expect((write!.rows[0] as { total: string }).total).toBe("1685");
  });

  it("400s when pr_id is missing (a PO must be raised from an approved PR)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [] }) })
    ).inject({ method: "POST", url: "/api/v1/po", payload: { vendor_id: VENDOR } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("pr_id");
  });

  it("400s when the PR is not this tenant's", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[prs, []]] }), // PR not visible to this tenant
      })
    ).inject({
      method: "POST",
      url: "/api/v1/po",
      payload: { pr_id: PR, vendor_id: VENDOR },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("pr not found");
  });

  it("409s when the source PR is not approved", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[prs, [prRow("pending")]]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/po",
      payload: { pr_id: PR, vendor_id: VENDOR },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("400s when the vendor is not this tenant's", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[prs, [prRow("approved")]], [vendors, []]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/po",
      payload: { pr_id: PR, vendor_id: VENDOR },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("vendor not found");
  });

  it("409s on a duplicate no within the tenant", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [prs, [prRow("approved")]],
            [vendors, [vendor]],
            [pos, [po("p0", "DUP", "approved", 1)]],
          ],
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/po",
      payload: { pr_id: PR, vendor_id: VENDOR, no: "DUP" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_CODE");
  });
});

// ---------------------------------------------------------------------------
// GET /po/:id — detail with variation orders
// ---------------------------------------------------------------------------

describe("GET /api/v1/po/:id — detail", () => {
  it("returns the PO with its variation orders", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pos, [po("p0", "PO-1", "approved", 500000)]],
            [variationOrders, [voRow("v0", "p0", "add", 148000)]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/po/p0" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.amount).toBe(500000);
    expect(body.variation_orders).toHaveLength(1);
    expect(body.variation_orders[0].dir).toBe("add");
    expect(body.variation_orders[0].amount).toBe(148000);
  });

  it("404s for an id outside the tenant", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[pos, []]] }) })
    ).inject({ url: "/api/v1/po/nope" });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// State machine: submit → approve → reject
// ---------------------------------------------------------------------------

describe("PO state machine — submit", () => {
  it("submit: draft → pending", async () => {
    const P0 = po("p0", "N", "draft", 1000);
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pos, [P0]]], updated, updateBase: P0 }),
      })
    ).inject({ method: "POST", url: "/api/v1/po/p0/submit" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending");
    expect(updated[0]!.set.status).toBe("pending");
  });

  it("submit: 409 when the PO is not draft", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pos, [po("p0", "N", "pending", 1000)]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/po/p0/submit" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });
});

describe("PO state machine — approve (tiered authority, B-070 PO/WO 1M/5M)", () => {
  it("approve: ≤1M PO approved by หน.จัดซื้อ tier (level 2), approval_step=1", async () => {
    const P0 = po("p0", "N", "pending", 1000);
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[pos, [P0]], [users, [userRow]], [roles, [roleRow(2)]]],
          updated,
          updateBase: P0,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/po/p0/approve" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("approved");
    expect(updated[0]!.set.approvalStep).toBe(1);
  });

  it("approve: >1M PO needs ผจก.โครงการ — level 2 gets 403, level 3 passes (step 2)", async () => {
    const rows = (level: number) => ({
      rows: [
        [pos, [po("p0", "N", "pending", 2_000_000)]],
        [users, [userRow]],
        [roles, [roleRow(level)]],
      ] as Array<[unknown, unknown[]]>,
    });
    const denied = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb(rows(2)) })
    ).inject({ method: "POST", url: "/api/v1/po/p0/approve" });
    expect(denied.statusCode).toBe(403);

    const updated: Updated[] = [];
    const ok = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ ...rows(3), updated, updateBase: po("p0", "N", "pending", 2_000_000) }),
      })
    ).inject({ method: "POST", url: "/api/v1/po/p0/approve" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("approved");
    expect(updated[0]!.set.approvalStep).toBe(2);
  });

  it("approve: >5M PO needs MD — level 3 gets 403, level 4 passes (step 3)", async () => {
    const rows = (level: number) => ({
      rows: [
        [pos, [po("p0", "N", "pending", 6_000_000)]],
        [users, [userRow]],
        [roles, [roleRow(level)]],
      ] as Array<[unknown, unknown[]]>,
    });
    const denied = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb(rows(3)) })
    ).inject({ method: "POST", url: "/api/v1/po/p0/approve" });
    expect(denied.statusCode).toBe(403);

    const ok = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ ...rows(4), updateBase: po("p0", "N", "pending", 6_000_000) }),
      })
    ).inject({ method: "POST", url: "/api/v1/po/p0/approve" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().approval_step).toBe(3);
  });

  it("approve: 403 when the caller has no attributable role", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pos, [po("p0", "N", "pending", 1000)]], [users, []], [roles, []]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/po/p0/approve" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("approve: 409 when the PO is not pending (authority ok, wrong state)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pos, [po("p0", "N", "draft", 1000)]], [users, [userRow]], [roles, [roleRow(4)]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/po/p0/approve" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });
});

describe("PO state machine — reject", () => {
  it("reject: pending → rejected with a reason (by an authorized approver)", async () => {
    const P0 = po("p0", "N", "pending", 1000);
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[pos, [P0]], [users, [userRow]], [roles, [roleRow(2)]]],
          updated,
          updateBase: P0,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/po/p0/reject", payload: { reason: "ราคาเกินงบ" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("rejected");
    expect(updated[0]!.set.status).toBe("rejected");
  });

  it("reject: 400 when reason is missing", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pos, [po("p0", "N", "pending", 1000)]], [users, [userRow]], [roles, [roleRow(2)]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/po/p0/reject", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
  });

  it("reject: 409 when the PO is not pending", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pos, [po("p0", "N", "draft", 1000)]], [users, [userRow]], [roles, [roleRow(2)]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/po/p0/reject", payload: { reason: "x" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  // B-084-reject: a low-tier member must not be able to reject a high-value
  // pending PO (workflow sabotage) — reject is gated on the same authority as
  // approve (>5M needs MD level 4; a level-2 หน.จัดซื้อ is denied 403).
  it("reject: 403 when a below-tier caller rejects a high-value pending PO (no write)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[pos, [po("p0", "N", "pending", 6_000_000)]], [users, [userRow]], [roles, [roleRow(2)]]],
          updated,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/po/p0/reject", payload: { reason: "x" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(updated).toHaveLength(0); // gate precedes the write — nothing rejected
  });

  it("reject: 403 when the caller has no attributable role (fail closed)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pos, [po("p0", "N", "pending", 1000)]], [users, []], [roles, []]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/po/p0/reject", payload: { reason: "x" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// variation-order — add/cut amends the stored total
// ---------------------------------------------------------------------------

describe("POST /api/v1/po/:id/variation-order", () => {
  it("add: writes a variation order and increases the stored total", async () => {
    const P0 = po("p0", "N", "approved", 1000);
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          // B-084: amending needs approval authority for the current (1000) and
          // resulting (1500) totals — both tier 2 (หน.จัดซื้อ), so level 2 clears.
          rows: [
            [pos, [P0]],
            [prs, [prRow("approved")]],
            [projects, [project]],
            [users, [userRow]],
            [roles, [roleRow(2)]],
          ],
          inserted,
          updated,
          updateBase: P0,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/po/p0/variation-order",
      payload: { dir: "add", amount: 500, reason: "เพิ่มผนัง" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.variation_order.dir).toBe("add");
    expect(body.variation_order.amount).toBe(500);
    expect(body.po.total).toBe(1500);
    expect(body.po.amount).toBe(1500);
    const voWrite = inserted.find((w) => w.table === variationOrders);
    expect((voWrite!.rows[0] as { dir: string }).dir).toBe("add");
    expect(updated[0]!.set.total).toBe("1500");
  });

  it("cut: decreases the stored total", async () => {
    const P0 = po("p0", "N", "approved", 1000);
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pos, [P0]],
            [prs, [prRow("approved")]],
            [projects, [project]],
            [users, [userRow]],
            [roles, [roleRow(2)]],
          ],
          updateBase: P0,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/po/p0/variation-order",
      payload: { dir: "cut", amount: 300 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().po.total).toBe(700);
  });

  it("400s on an invalid dir", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pos, [po("p0", "N", "approved", 1000)]]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/po/p0/variation-order",
      payload: { dir: "sideways", amount: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s on a missing/negative amount", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pos, [po("p0", "N", "approved", 1000)]]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/po/p0/variation-order",
      payload: { dir: "add" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s for a PO outside the tenant", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[pos, []]] }) })
    ).inject({
      method: "POST",
      url: "/api/v1/po/nope/variation-order",
      payload: { dir: "add", amount: 1 },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// B-084 (matrix GAP-1) — variation-order approval-authority gate. The stored
// total is what /approve reads to pick the tier, so amending a PO must cost at
// least as much authority as approving it at both the old and new amount. This
// closes exploit-B: cut a PO below its tier → get it approved cheaply → add the
// amount back after approval (a full in-tenant financial-authz bypass).
// ---------------------------------------------------------------------------

describe("POST /api/v1/po/:id/variation-order — B-084 authority gate", () => {
  // The scoped rows for an amend attempt: the PO under amendment + the source PR
  // + project anchor + the caller's user/role at the given tier.
  const amendRows = (P0: ReturnType<typeof po>, level: number) =>
    ({
      rows: [
        [pos, [P0]],
        [prs, [prRow("approved")]],
        [projects, [project]],
        [users, [userRow]],
        [roles, [roleRow(level)]],
      ] as Array<[unknown, unknown[]]>,
    });

  it("EXPLOIT closed (cut step): a level-2 caller CANNOT cut a >5M PO to downgrade its tier", async () => {
    // A 6,000,000 PO demands MD (level 4). The exploit begins by cutting it below
    // the 1M tier so a level-2 head can approve it — but the cut itself now needs
    // authority for the CURRENT 6M total (MD), so the tier-2 caller is denied.
    const P0 = po("p0", "PO-EXPLOIT", "approved", 6_000_000);
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(amendRows(P0, 2)),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/po/p0/variation-order",
      payload: { dir: "cut", amount: 5_600_000 }, // → 400,000 (below tier)
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("EXPLOIT closed (add-back step): a level-2 caller CANNOT add a PO back up past their tier after approval", async () => {
    // The second half of the exploit: a 400,000 PO (approved cheaply) is inflated
    // back to 6,000,000. The RESULTING total demands MD, so the tier-2 caller is
    // denied — the add-back never lands.
    const P0 = po("p0", "PO-EXPLOIT", "approved", 400_000);
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(amendRows(P0, 2)),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/po/p0/variation-order",
      payload: { dir: "add", amount: 5_600_000 }, // → 6,000,000 (MD tier)
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("an authorized MD (level 4) CAN still variation-order a high-value PO", async () => {
    const P0 = po("p0", "PO-MD", "approved", 6_000_000);
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ ...amendRows(P0, 4), updated, updateBase: P0 }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/po/p0/variation-order",
      payload: { dir: "add", amount: 1_000_000 }, // → 7,000,000
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().po.total).toBe(7_000_000);
    expect(updated[0]!.set.total).toBe("7000000");
  });

  it("403s an unattributable caller (fail-closed: no role resolved)", async () => {
    const P0 = po("p0", "N", "approved", 1000);
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pos, [P0]], [users, []], [roles, []]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/po/p0/variation-order",
      payload: { dir: "add", amount: 1 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("409s when the PO is pending (mid-approval) — only draft/approved may be amended", async () => {
    const P0 = po("p0", "N", "pending", 1000);
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(amendRows(P0, 4)),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/po/p0/variation-order",
      payload: { dir: "add", amount: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("409s when the PO is rejected (terminal) — cannot amend a dead doc", async () => {
    const P0 = po("p0", "N", "rejected", 1000);
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(amendRows(P0, 4)),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/po/p0/variation-order",
      payload: { dir: "add", amount: 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("400s a cut that would drive the stored total below 0 (non-negative floor)", async () => {
    const P0 = po("p0", "N", "approved", 1000);
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(amendRows(P0, 4)),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/po/p0/variation-order",
      payload: { dir: "cut", amount: 1500 }, // 1000 − 1500 = −500
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
  });
});

describe("PO action endpoints — tenant scope", () => {
  it("404 for a PO outside the tenant (submit/approve/reject)", async () => {
    for (const verb of ["submit", "approve", "reject"]) {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({ rows: [[pos, []], [users, [userRow]], [roles, [roleRow(4)]]] }),
        })
      ).inject({
        method: "POST",
        url: `/api/v1/po/nope/${verb}`,
        payload: { reason: "x" },
      });
      expect(res.statusCode).toBe(404);
    }
  });
});

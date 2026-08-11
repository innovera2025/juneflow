// G3 unit tests (PLAN.md §9) — WO handlers (P2-BE-05, B-070; po-wo.jsx WOList +
// WOForm, flows.html FLOW-A + MATRIX "WO ใบสั่งจ้าง"). Covers the B-014 list
// envelope with a DERIVED retention_amount (value × retention_pct / 100),
// create-from-approved-PR (201, server-owned draft, value + retention_pct from
// the body, requires an approved pr_id + this tenant's vendor), single-doc
// detail, and the submit→approve→reject state machine with the PO/WO TIERED
// approval matrix (≤1M/level 2; >1M/level 3; >5M/level 4 — thresholds differ
// from PR's 500K/2M). Tenant scope is bound on the project root reached THROUGH
// pr_id → pr → project. All money comes from the stubbed rows.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  prs,
  projects,
  roles,
  users,
  vendors,
  wos,
  workPeriods,
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
const vendor = { id: VENDOR, companyId: COMPANY, name: "บจก. รุ่งเรืองก่อสร้าง", kind: "subcon" };

const prRow = (status: "draft" | "pending" | "approved" | "rejected") => ({
  id: PR,
  projectId: PROJECT,
  no: "PR-2026-0001",
  type: "subcon",
  needDate: null,
  status,
  approvalStep: 0,
  // B-075: PR display fields — title doubles as the WO scope (งานเหมา).
  title: "งานทาสีภายนอก Block A",
  vendorId: null,
  requesterId: null,
  phase: "เฟส 1 · A",
  submittedAt: null,
  approvedAt: null,
  createdAt: D,
  updatedAt: D,
});

const wo = (
  id: string,
  no: string | null,
  status: "draft" | "pending" | "approved" | "rejected",
  value: number,
  retentionPct = "0.000",
  prId: string | null = PR,
  contractId: string | null = null,
) => ({
  id,
  prId,
  vendorId: VENDOR,
  contractId,
  no,
  value: String(value),
  currencyCode: "THB",
  retentionPct,
  status,
  approvalStep: 0,
  createdAt: D,
  updatedAt: D,
});

// A work_period installment (B-080 / F3) linked to a subcon contract.
const workPeriod = (
  id: string,
  contractId: string,
  seq: number,
  amount: number,
  status: "pending" | "delivered" | "inspecting" | "passed" | "rejected" | "paid",
) => ({
  id,
  contractId,
  seq,
  basis: "percent",
  target: "0",
  pct: "0",
  amount: String(amount),
  currencyCode: "THB",
  status,
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
// GET /wo — list + retention + tenant scope
// ---------------------------------------------------------------------------

describe("GET /api/v1/wo — auth + list + retention", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/wo" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  // B-323: /wo is a selectThrough (INNER JOIN, no ORDER BY). Proven live — with the
  // sort removed, forcing a merge join reordered this list on the seeded stack.
  it("emits a TOTAL order — the same list whatever order the join plan returns", async () => {
    const at = (iso: string): Date => new Date(iso);
    const rows = [
      { ...wo("w1", "WO-2026-0101", "approved", 1), createdAt: at("2026-07-20T09:00:00Z") },
      { ...wo("w2", "WO-2026-0102", "approved", 1), createdAt: at("2026-07-20T08:59:59Z") },
      { ...wo("w3", "WO-2026-0103", "approved", 1), createdAt: at("2026-07-20T08:59:58Z") },
      { ...wo("w4", "WO-2026-0104", "approved", 1), createdAt: at("2026-07-20T08:59:57Z") },
    ];
    const listIds = async (r: unknown[]): Promise<string[]> => {
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[wos, r]] }) })
      ).inject({ url: "/api/v1/wo" });
      return res.json().data.map((x: { id: string }) => x.id);
    };
    const expected = ["w1", "w2", "w3", "w4"];
    expect(await listIds(rows)).toEqual(expected);
    expect(await listIds([rows[3]!, rows[1]!, rows[0]!, rows[2]!])).toEqual(expected);
    expect(await listIds([...rows].reverse())).toEqual(expected);
  });

  it("breaks a same-instant tie on id, so two WOs raised in one second still order", async () => {
    const same = new Date("2026-07-20T09:00:00Z");
    const rows = [
      { ...wo("zz", "WO-Z", "approved", 1), createdAt: same },
      { ...wo("aa", "WO-A", "approved", 1), createdAt: same },
    ];
    const listIds = async (r: unknown[]): Promise<string[]> => {
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[wos, r]] }) })
      ).inject({ url: "/api/v1/wo" });
      return res.json().data.map((x: { id: string }) => x.id);
    };
    expect(await listIds(rows)).toEqual(["aa", "zz"]);
    expect(await listIds([...rows].reverse())).toEqual(["aa", "zz"]);
  });

  it("returns the envelope with retention_amount + scope/progress/installments (F3)", async () => {
    // Contract c0 plan: งวด1 645k passed + งวด2 645k pending + งวด3 860k pending →
    // done 645k / total 2,150k → progress round(30%) = 30.
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [wos, [wo("w0", "WO-2026-0117", "pending", 2_150_000, "10.000", PR, "c0")]],
            [
              workPeriods,
              [
                workPeriod("wp2", "c0", 2, 645000, "pending"),
                workPeriod("wp0", "c0", 1, 645000, "passed"),
                workPeriod("wp1", "c0", 3, 860000, "pending"),
              ],
            ],
            [prs, [prRow("approved")]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/wo" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    const w0 = body.data[0];
    expect(w0.no).toBe("WO-2026-0117");
    expect(w0.value).toBe(2_150_000);
    expect(w0.amount).toBe(2_150_000);
    expect(w0.retention_pct).toBe(10);
    expect(w0.retention_amount).toBe(215000); // 2,150,000 × 10% (matches po-wo.jsx mock)
    // B-080 (F3): scope = source PR title; progress + installments from work_period.
    expect(w0.contract_id).toBe("c0");
    expect(w0.scope).toBe("งานทาสีภายนอก Block A");
    expect(w0.progress).toBe(30); // 645k done / 2,150k plan
    expect(w0.installments.map((p: { seq: number }) => p.seq)).toEqual([1, 2, 3]); // sorted
    expect(w0.installments[0].amount).toBe(645000);
    expect(w0.installments[0].status).toBe("passed");
    expect(Object.keys(w0).sort()).toEqual(
      [
        "amount",
        "approval_step",
        "contract_id",
        "currency_code",
        "id",
        "installments",
        "no",
        "pr_id",
        "progress",
        "retention_amount",
        "retention_pct",
        "scope",
        "status",
        "value",
        "vendor_id",
      ],
    );
  });

  it("a WO with contract_id null honestly reports an empty plan / null progress", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [wos, [wo("w0", "WO-2026-0116", "approved", 845000, "5.000", PR, null)]],
            [prs, [prRow("approved")]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/wo" });
    const w0 = res.json().data[0];
    expect(w0.contract_id).toBe(null);
    expect(w0.installments).toEqual([]);
    expect(w0.progress).toBe(null);
  });

  it("rounds retention_amount to 2 dp — no value × pct / 100 sub-cent drift (B-085 fix 3)", async () => {
    // 12345 × 7.125 / 100 = 879.58125 → must surface as 879.58, not the raw
    // sub-cent value (the FE / visual gate shows money at 2 dp).
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [wos, [wo("w0", "WO-RETAIN", "approved", 12345, "7.125", PR, null)]],
            [prs, [prRow("approved")]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/wo" });
    expect(res.statusCode).toBe(200);
    const w0 = res.json().data[0];
    expect(w0.retention_amount).toBe(879.58);
  });

  it("binds company_id on the project root of the scoped read (no cross-tenant leak)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[wos, [wo("w0", "N", "draft", 1)]]], captured }),
      })
    ).inject({ url: "/api/v1/wo" });
    const read = captured.find((c) => c.table === wos);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
    expect(paramsOf(read!.where)).not.toContain(OTHER_COMPANY);
  });
});

// ---------------------------------------------------------------------------
// POST /wo — create from an approved PR
// ---------------------------------------------------------------------------

describe("POST /api/v1/wo — create from approved PR", () => {
  it("creates a draft WO (201) with value + retention_pct from the body", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[prs, [prRow("approved")]], [vendors, [vendor]], [wos, []], [projects, [project]]],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/wo",
      payload: { pr_id: PR, vendor_id: VENDOR, no: "WO-2026-0999", value: 845000, retention_pct: 10 },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("draft");
    expect(body.approval_step).toBe(0);
    expect(body.value).toBe(845000);
    expect(body.retention_pct).toBe(10);
    expect(body.retention_amount).toBe(84500); // 845,000 × 10%
    const write = inserted.find((w) => w.table === wos);
    expect((write!.rows[0] as { retentionPct: string }).retentionPct).toBe("10");
  });

  it("400s when pr_id is missing", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [] }) })
    ).inject({ method: "POST", url: "/api/v1/wo", payload: { vendor_id: VENDOR, value: 1 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("pr_id");
  });

  it("409s when the source PR is not approved", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[prs, [prRow("draft")]]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/wo",
      payload: { pr_id: PR, vendor_id: VENDOR, value: 1 },
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
      url: "/api/v1/wo",
      payload: { pr_id: PR, vendor_id: VENDOR, value: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("vendor not found");
  });

  it("400s when retention_pct is out of range", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[prs, [prRow("approved")]], [vendors, [vendor]]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/wo",
      payload: { pr_id: PR, vendor_id: VENDOR, value: 1, retention_pct: 150 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("retention_pct");
  });

  it("409s on a duplicate no within the tenant", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[prs, [prRow("approved")]], [vendors, [vendor]], [wos, [wo("w0", "DUP", "approved", 1)]]],
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/wo",
      payload: { pr_id: PR, vendor_id: VENDOR, value: 1, no: "DUP" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_CODE");
  });
});

// ---------------------------------------------------------------------------
// GET /wo/:id — detail
// ---------------------------------------------------------------------------

describe("GET /api/v1/wo/:id — detail", () => {
  it("returns the WO with its derived retention_amount", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[wos, [wo("w0", "WO-1", "approved", 985000, "10.000")]]] }),
      })
    ).inject({ url: "/api/v1/wo/w0" });
    expect(res.statusCode).toBe(200);
    expect(res.json().retention_amount).toBe(98500); // 985,000 × 10%
  });

  it("404s for an id outside the tenant", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[wos, []]] }) })
    ).inject({ url: "/api/v1/wo/nope" });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// State machine: submit → approve → reject
// ---------------------------------------------------------------------------

describe("WO state machine — submit", () => {
  it("submit: draft → pending", async () => {
    const W0 = wo("w0", "N", "draft", 1000);
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[wos, [W0]]], updated, updateBase: W0 }),
      })
    ).inject({ method: "POST", url: "/api/v1/wo/w0/submit" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending");
    expect(updated[0]!.set.status).toBe("pending");
  });

  it("submit: 409 when the WO is not draft", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[wos, [wo("w0", "N", "pending", 1000)]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/wo/w0/submit" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });
});

describe("WO state machine — approve (tiered authority, B-070 PO/WO 1M/5M)", () => {
  it("approve: ≤1M WO approved by หน.จัดซื้อ tier (level 2), approval_step=1", async () => {
    const W0 = wo("w0", "N", "pending", 845000);
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[wos, [W0]], [users, [userRow]], [roles, [roleRow(2)]]],
          updated,
          updateBase: W0,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/wo/w0/approve" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("approved");
    expect(updated[0]!.set.approvalStep).toBe(1);
  });

  it("approve: >1M WO needs ผจก.โครงการ — level 2 gets 403, level 3 passes", async () => {
    const rows = (level: number) => ({
      rows: [
        [wos, [wo("w0", "N", "pending", 2_150_000)]],
        [users, [userRow]],
        [roles, [roleRow(level)]],
      ] as Array<[unknown, unknown[]]>,
    });
    const denied = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb(rows(2)) })
    ).inject({ method: "POST", url: "/api/v1/wo/w0/approve" });
    expect(denied.statusCode).toBe(403);

    const ok = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ ...rows(3), updateBase: wo("w0", "N", "pending", 2_150_000) }),
      })
    ).inject({ method: "POST", url: "/api/v1/wo/w0/approve" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("approved");
  });

  it("approve: >5M WO needs MD — level 3 gets 403, level 4 passes (step 3)", async () => {
    const rows = (level: number) => ({
      rows: [
        [wos, [wo("w0", "N", "pending", 6_000_000)]],
        [users, [userRow]],
        [roles, [roleRow(level)]],
      ] as Array<[unknown, unknown[]]>,
    });
    const denied = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb(rows(3)) })
    ).inject({ method: "POST", url: "/api/v1/wo/w0/approve" });
    expect(denied.statusCode).toBe(403);

    const ok = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ ...rows(4), updateBase: wo("w0", "N", "pending", 6_000_000) }),
      })
    ).inject({ method: "POST", url: "/api/v1/wo/w0/approve" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().approval_step).toBe(3);
  });

  it("approve: 403 when the caller has no attributable role", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[wos, [wo("w0", "N", "pending", 1000)]], [users, []], [roles, []]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/wo/w0/approve" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("approve: 409 when the WO is not pending", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[wos, [wo("w0", "N", "draft", 1000)]], [users, [userRow]], [roles, [roleRow(4)]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/wo/w0/approve" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });
});

describe("WO state machine — reject", () => {
  it("reject: pending → rejected with a reason (by an authorized approver)", async () => {
    const W0 = wo("w0", "N", "pending", 1000);
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[wos, [W0]], [users, [userRow]], [roles, [roleRow(2)]]],
          updated,
          updateBase: W0,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/wo/w0/reject", payload: { reason: "ขอบเขตงานไม่ชัด" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("rejected");
    expect(updated[0]!.set.status).toBe("rejected");
  });

  it("reject: 400 when reason is missing", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[wos, [wo("w0", "N", "pending", 1000)]], [users, [userRow]], [roles, [roleRow(2)]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/wo/w0/reject", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
  });

  it("reject: 409 when the WO is not pending", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[wos, [wo("w0", "N", "draft", 1000)]], [users, [userRow]], [roles, [roleRow(2)]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/wo/w0/reject", payload: { reason: "x" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  // B-084-reject: a low-tier member must not be able to reject a high-value
  // pending WO (workflow sabotage) — reject is gated on the same authority as
  // approve (>5M needs MD level 4; a level-2 หน.จัดซื้อ is denied 403).
  it("reject: 403 when a below-tier caller rejects a high-value pending WO (no write)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[wos, [wo("w0", "N", "pending", 6_000_000)]], [users, [userRow]], [roles, [roleRow(2)]]],
          updated,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/wo/w0/reject", payload: { reason: "x" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(updated).toHaveLength(0);
  });
});

describe("WO action endpoints — tenant scope", () => {
  it("404 for a WO outside the tenant (submit/approve/reject)", async () => {
    for (const verb of ["submit", "approve", "reject"]) {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({ rows: [[wos, []], [users, [userRow]], [roles, [roleRow(4)]]] }),
        })
      ).inject({
        method: "POST",
        url: `/api/v1/wo/nope/${verb}`,
        payload: { reason: "x" },
      });
      expect(res.statusCode).toBe(404);
    }
  });
});

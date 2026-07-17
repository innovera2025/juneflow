// G3 unit tests (PLAN.md §9) — PR handlers (P2-BE-04, B-070; pr-list.jsx PRList +
// pr-form.jsx PRForm, flows.html FLOW-A + MATRIX "PR ใบขอซื้อ"). Covers the B-014
// list envelope with a DERIVED amount (C10, Σ qty×price where price comes from the
// BOQ item each line references — never the mock's hardcoded 842,500), tenant
// scope on every read/write (company_id bound on the project root — no cross-tenant
// leak), create (201, server-owned draft + approval_step 0) incl. the `clear` →
// `advance` enum mapping, single-doc detail with priced lines, and the
// submit→approve→reject state machine: TIERED approval authority (amount ≤500K
// needs หน.จัดซื้อ/level 2; >500K needs ผจก.โครงการ/level 3; >2M needs MD/level 4;
// insufficient role → 403), reject requires a reason, and the out-of-order
// transition guards (409). All money comes from the stubbed rows — no value is
// hand-computed against the impl.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { boqItems, projects, prItems, prs, roles, users, vendors } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const OTHER_COMPANY = "33333333-3333-3333-3333-333333333333";
const PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// A session; role rows are provided directly per test, but the email is present
// so the tenant-scope hook attaches request.authUser exactly as production does.
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
  /** Base row merged with the update SET to synthesize the RETURNING row. */
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
// Row factories (stub-backed — never the mock's presentational values)
// ---------------------------------------------------------------------------

const project = { id: PROJECT, companyId: COMPANY, name: "juneflow ราชพฤกษ์" };

const pr = (
  id: string,
  no: string,
  status: "draft" | "pending" | "approved" | "rejected",
  type: "material" | "subcon" | "expense" | "advance" = "material",
  approvalStep = 0,
  opts: { vendorId?: string | null; requesterId?: string | null } = {},
) => ({
  id,
  projectId: PROJECT,
  no,
  type,
  needDate: "2026-06-02",
  status,
  approvalStep,
  // B-075 display columns (migration 0022): title/phase/vendor/requester +
  // submit/approve timestamps (null until the PR reaches that state).
  title: `คำขอ ${no}`,
  phase: "เฟส 2 · B",
  vendorId: opts.vendorId ?? null,
  requesterId: opts.requesterId ?? null,
  submittedAt: status === "draft" ? null : new Date(1_700_000_000_000),
  approvedAt: status === "approved" ? new Date(1_700_000_000_000) : null,
  createdAt: new Date(1_700_000_000_000),
  updatedAt: new Date(1_700_000_000_000),
});

const prLine = (id: string, prId: string, boqItemId: string | null, qty: string) => ({
  id,
  prId,
  boqItemId,
  qty,
  createdAt: new Date(1_700_000_000_000),
  updatedAt: new Date(1_700_000_000_000),
});

/** A minimal BOQ item carrying just the price surface the PR amount reads. */
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
  createdAt: new Date(1_700_000_000_000),
  updatedAt: new Date(1_700_000_000_000),
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
  createdAt: new Date(1_700_000_000_000),
  updatedAt: new Date(1_700_000_000_000),
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
// GET /pr — list envelope + derived amount + tenant scope
// ---------------------------------------------------------------------------

describe("GET /api/v1/pr — auth + list", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/pr" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("returns the B-014 envelope with a DERIVED amount per PR (C10, priced from BOQ)", async () => {
    const P0 = pr("p0", "PR-2026-0418", "pending", "material", 0, {
      vendorId: "v0",
      requesterId: "u0",
    });
    const P1 = pr("p1", "PR-2026-0417", "draft", "expense");
    // p0 has 2 lines priced from BOQ b0 (price 100) + b1 (price 50):
    //   10×100 + 4×50 = 1200. p1 has no lines → amount 0.
    const L0 = prLine("l0", "p0", "b0", "10");
    const L1 = prLine("l1", "p0", "b1", "4");
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [prs, [P0, P1]],
            [prItems, [L0, L1]],
            [boqItems, [boqItemPriced("b0", "100.00"), boqItemPriced("b1", "50.00")]],
            [vendors, [{ id: "v0", companyId: COMPANY, name: "บจก. ผู้ขายวัสดุ" }]],
            [users, [{ id: "u0", companyId: COMPANY, name: "สมชาย วัฒนกุล" }]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/pr" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    const p0 = body.data.find((d: { id: string }) => d.id === "p0");
    const p1 = body.data.find((d: { id: string }) => d.id === "p1");
    expect(p0.amount).toBe(1200);
    expect(p0.currency_code).toBe("THB");
    expect(p0.status).toBe("pending");
    expect(p1.amount).toBe(0);
    // B-075: real display columns + resolved vendor/requester names.
    expect(p0.title).toBe("คำขอ PR-2026-0418");
    expect(p0.phase).toBe("เฟส 2 · B");
    expect(p0.vendor).toBe("บจก. ผู้ขายวัสดุ");
    expect(p0.requester).toBe("สมชาย วัฒนกุล");
    expect(p0.submitted_at).toBeTruthy();
    expect(p1.vendor).toBe(null); // no vendor_id on the expense PR
    // wire is real columns only — no company_id / update timestamp leak.
    expect(Object.keys(p0).sort()).toEqual(
      [
        "amount",
        "approval_step",
        "approved_at",
        "currency_code",
        "id",
        "need_date",
        "no",
        "phase",
        "project_id",
        "requester",
        "requester_id",
        "status",
        "submitted_at",
        "title",
        "type",
        "vendor",
        "vendor_id",
      ],
    );
  });

  it("binds company_id on the project root of every scoped read (no cross-tenant leak)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[prs, [pr("p0", "N", "draft")]]], captured }),
      })
    ).inject({ url: "/api/v1/pr" });
    const prRead = captured.find((c) => c.table === prs);
    expect(prRead).toBeTruthy();
    expect(paramsOf(prRead!.where)).toContain(COMPANY);
    expect(paramsOf(prRead!.where)).not.toContain(OTHER_COMPANY);
  });
});

// ---------------------------------------------------------------------------
// POST /pr — create (+ clear→advance mapping + item pricing)
// ---------------------------------------------------------------------------

describe("POST /api/v1/pr — create", () => {
  it("creates a draft PR (201, server-owned status=draft + approval_step=0) with a priced line", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[projects, [project]], [prs, []], [boqItems, [boqItemPriced("b0", "168.50")]]],
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pr",
      payload: {
        no: "PR-2026-0999",
        type: "material",
        project_id: PROJECT,
        need_date: "2026-06-02",
        items: [{ boq_item_id: "b0", qty: 10 }],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.no).toBe("PR-2026-0999");
    expect(body.status).toBe("draft");
    expect(body.approval_step).toBe(0);
    expect(body.type).toBe("material");
    expect(body.project_id).toBe(PROJECT);
    expect(body.amount).toBe(1685); // 10 × 168.50
    expect(body.items).toHaveLength(1);
    expect(body.items[0].amount).toBe(1685);
  });

  it("maps the prototype `clear` type to the `advance` enum value (no migration)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [project]], [prs, []]], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pr",
      payload: { no: "PR-CLR-1", type: "clear", project_id: PROJECT },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().type).toBe("advance");
    const write = inserted.find((w) => w.table === prs);
    expect((write!.rows[0] as { type: string }).type).toBe("advance");
  });

  it("400s on an unknown type", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [project]]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pr",
      payload: { no: "X", type: "bogus", project_id: PROJECT },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s when project_id is missing / not the tenant's", async () => {
    const missing = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [] }) })
    ).inject({ method: "POST", url: "/api/v1/pr", payload: { no: "X", type: "material" } });
    expect(missing.statusCode).toBe(400);

    const foreign = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, []]] }), // project not visible to this tenant
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pr",
      payload: { no: "X", type: "material", project_id: PROJECT },
    });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().message).toBe("project not found");
  });

  it("400s when a line references a BOQ item outside the tenant", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [project]], [prs, []], [boqItems, []]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pr",
      payload: { no: "X", type: "material", project_id: PROJECT, items: [{ boq_item_id: "b-foreign", qty: 1 }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("409s on a duplicate no within the tenant", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [project]], [prs, [pr("p0", "DUP", "approved")]]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pr",
      payload: { no: "DUP", type: "material", project_id: PROJECT },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_CODE");
  });
});

// ---------------------------------------------------------------------------
// GET /pr/:id — detail with priced lines
// ---------------------------------------------------------------------------

describe("GET /api/v1/pr/:id — detail", () => {
  it("returns the PR with its priced lines + derived amount", async () => {
    const P0 = pr("p0", "PR-1", "pending");
    const L0 = prLine("l0", "p0", "b0", "5"); // 5 × 425 = 2125
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[prs, [P0]], [prItems, [L0]], [boqItems, [boqItemPriced("b0", "425.00")]]],
        }),
      })
    ).inject({ url: "/api/v1/pr/p0" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.amount).toBe(2125);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].price).toBe(425);
    expect(body.items[0].amount).toBe(2125);
  });

  it("404s for an id outside the tenant", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[prs, []]] }) })
    ).inject({ url: "/api/v1/pr/nope" });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// State machine: submit → approve → reject (+ tiered authority + guards)
// ---------------------------------------------------------------------------

describe("PR state machine — submit", () => {
  it("submit: draft → pending", async () => {
    const P0 = pr("p0", "N", "draft");
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[prs, [P0]], [projects, [project]], [prItems, []]], updated, updateBase: P0 }),
      })
    ).inject({ method: "POST", url: "/api/v1/pr/p0/submit" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending");
    expect(updated[0]!.set.status).toBe("pending");
  });

  it("submit: 409 when the PR is not draft (e.g. already pending)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[prs, [pr("p0", "N", "pending")]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/pr/p0/submit" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });
});

describe("PR state machine — approve (tiered authority, B-070)", () => {
  // amount ≤ 500,000 needs only หน.จัดซื้อ (approvalLevel 2).
  it("approve: ≤500K PR approved by หน.จัดซื้อ tier (level 2)", async () => {
    const P0 = pr("p0", "N", "pending");
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [prs, [P0]],
            [prItems, [prLine("l0", "p0", "b0", "10")]], // 10 × 100 = 1000
            [boqItems, [boqItemPriced("b0", "100.00")]],
            [projects, [project]],
            [users, [userRow]],
            [roles, [roleRow(2)]], // Procurement head — enough for ≤500K
          ],
          updated,
          updateBase: P0,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/pr/p0/approve" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("approved");
    expect(updated[0]!.set.status).toBe("approved");
    expect(updated[0]!.set.approvalStep).toBe(1); // 1 tier engaged
  });

  // 500,000 < amount ≤ 2,000,000 needs ผจก.โครงการ (approvalLevel 3).
  it("approve: >500K PR needs ผจก.โครงการ tier — level 2 gets 403, level 3 passes", async () => {
    const rows = (level: number) => ({
      rows: [
        [prs, [pr("p0", "N", "pending")]],
        [prItems, [prLine("l0", "p0", "b0", "6000")]], // 6000 × 100 = 600,000
        [boqItems, [boqItemPriced("b0", "100.00")]],
        [projects, [project]],
        [users, [userRow]],
        [roles, [roleRow(level)]],
      ] as Array<[unknown, unknown[]]>,
    });

    const denied = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb(rows(2)) })
    ).inject({ method: "POST", url: "/api/v1/pr/p0/approve" });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("FORBIDDEN");

    const ok = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ ...rows(3), updateBase: pr("p0", "N", "pending") }),
      })
    ).inject({ method: "POST", url: "/api/v1/pr/p0/approve" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("approved");
  });

  // amount > 2,000,000 needs MD (approvalLevel 4).
  it("approve: >2M PR needs MD tier — level 3 gets 403, level 4 passes", async () => {
    const rows = (level: number) => ({
      rows: [
        [prs, [pr("p0", "N", "pending")]],
        [prItems, [prLine("l0", "p0", "b0", "30000")]], // 30000 × 100 = 3,000,000
        [boqItems, [boqItemPriced("b0", "100.00")]],
        [projects, [project]],
        [users, [userRow]],
        [roles, [roleRow(level)]],
      ] as Array<[unknown, unknown[]]>,
    });

    const denied = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb(rows(3)) })
    ).inject({ method: "POST", url: "/api/v1/pr/p0/approve" });
    expect(denied.statusCode).toBe(403);

    const ok = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ ...rows(4), updateBase: pr("p0", "N", "pending") }),
      })
    ).inject({ method: "POST", url: "/api/v1/pr/p0/approve" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("approved");
    expect(ok.json().approval_step).toBe(3); // all 3 tiers engaged
  });

  it("approve: 403 when the caller has no attributable role", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [prs, [pr("p0", "N", "pending")]],
            [prItems, []],
            [boqItems, []],
            [users, []], // no dictionary user → level unattributable
            [roles, []],
          ],
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/pr/p0/approve" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("approve: 409 when the PR is not pending (must submit first)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [prs, [pr("p0", "N", "draft")]],
            [prItems, []],
            [boqItems, []],
            [users, [userRow]],
            [roles, [roleRow(4)]],
          ],
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/pr/p0/approve" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });
});

describe("PR state machine — reject", () => {
  it("reject: pending → rejected with a reason (by an authorized approver)", async () => {
    const P0 = pr("p0", "N", "pending");
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [prs, [P0]],
            [projects, [project]],
            [prItems, []],
            [boqItems, []],
            [users, [userRow]],
            [roles, [roleRow(2)]],
          ],
          updated,
          updateBase: P0,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pr/p0/reject",
      payload: { reason: "ราคาเกิน BOQ ต้องแนบเหตุผล" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("rejected");
    expect(updated[0]!.set.status).toBe("rejected");
  });

  it("reject: 400 when reason is missing (contract requires {reason})", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[prs, [pr("p0", "N", "pending")]], [prItems, []], [boqItems, []], [users, [userRow]], [roles, [roleRow(2)]]],
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/pr/p0/reject", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
  });

  it("reject: 409 when the PR is not pending", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[prs, [pr("p0", "N", "draft")]], [prItems, []], [boqItems, []], [users, [userRow]], [roles, [roleRow(2)]]],
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/pr/p0/reject", payload: { reason: "x" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  // B-084-reject: a low-tier member must not be able to reject a high-value
  // pending PR (workflow sabotage) — reject is gated on the same authority as
  // approve (>500K needs ผจก.โครงการ level 3; a level-2 หน.จัดซื้อ is denied 403).
  it("reject: 403 when a below-tier caller rejects a high-value pending PR (no write)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [prs, [pr("p0", "N", "pending")]],
            [prItems, [prLine("l0", "p0", "b0", "6000")]], // 6000 × 100 = 600,000 (> 500K)
            [boqItems, [boqItemPriced("b0", "100.00")]],
            [users, [userRow]],
            [roles, [roleRow(2)]], // หน.จัดซื้อ — below the ผจก.โครงการ tier
          ],
          updated,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/pr/p0/reject", payload: { reason: "x" } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(updated).toHaveLength(0); // gate precedes the write — nothing rejected
  });
});

describe("PR action endpoints — tenant scope", () => {
  it("404 for a PR outside the tenant (submit/approve/reject)", async () => {
    for (const verb of ["submit", "approve", "reject"]) {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({ rows: [[prs, []], [prItems, []], [boqItems, []], [users, [userRow]], [roles, [roleRow(4)]]] }),
        })
      ).inject({
        method: "POST",
        url: `/api/v1/pr/nope/${verb}`,
        payload: { reason: "x" },
      });
      expect(res.statusCode).toBe(404);
    }
  });
});

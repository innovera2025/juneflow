// G3 unit tests (PLAN.md §9) — BOQ handlers (P2-BE-02, B-070; boq.jsx BOQEditor +
// boq-list.jsx BOQList, flows.html FLOW-A + MATRIX "BOQ / Revise"). Covers the
// B-014 list envelope with a DERIVED total (C10, Σ qty×price — never hardcoded),
// tenant scope on every read/write (company_id bound on the project root — no
// cross-tenant leak), create (201, server-owned draft + version 1), single-doc
// detail with per-group CBS available = budget−used−committed, item list + ?group
// filter, bulk item add (201) + rejection once approved (immutable/locked), and
// the submit→approve→revise state machine: approve locks + requires MD-tier
// (approvalLevel 4) authority, edit-after-approve rejected, revise → v+1, and the
// out-of-order transition guards (approval-step progression). All money/counts
// come from the stubbed rows — no value is hand-computed against the impl.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  boqDocs,
  boqVersionHistory,
  boqGroups,
  boqItems,
  cbsBudgets,
  projects,
  prItems,
  prs,
  roles,
  users,
} from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const OTHER_COMPANY = "33333333-3333-3333-3333-333333333333";
const PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

// A Director session (role approvalLevel 4 → may approve/lock BOQ). Email is
// irrelevant to the stub (role rows are provided directly), but present so the
// tenant-scope hook attaches request.authUser exactly as production does.
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
  const raw: Record<string, unknown> = {
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

// ---------------------------------------------------------------------------
// Row factories (stub-backed — never the mock's presentational values)
// ---------------------------------------------------------------------------

const project = { id: PROJECT, companyId: COMPANY, name: "juneflow ราชพฤกษ์" };

const doc = (
  id: string,
  no: string,
  status: "draft" | "pending" | "approved" | "revise",
  version = 1,
  approvedBy: string | null = null,
) => ({
  id,
  projectId: PROJECT,
  no,
  name: `BOQ ${no}`,
  scope: "Block B",
  version,
  status,
  // B-081 (F4): archive approver + timestamp (null unless approved).
  approvedBy,
  approvedAt: approvedBy ? new Date(1_700_000_000_000) : null,
  createdAt: new Date(1_700_000_000_000),
  updatedAt: new Date(1_700_000_000_000),
});

// A tenant dictionary user row (for approver / version-history name resolution).
const user = (id: string, name: string) => ({
  id,
  companyId: COMPANY,
  email: `${id}@t.co`,
  name,
  roleId: "role-dir",
  status: "active",
  createdAt: new Date(1_700_000_000_000),
  updatedAt: new Date(1_700_000_000_000),
});

// A boq_version_history row (B-081 / F4).
const vhRow = (
  id: string,
  docId: string,
  version: number,
  action: string,
  by: string | null,
  delta: string | null,
  note: string | null,
) => ({
  id,
  docId,
  version,
  action,
  by,
  at: new Date(1_700_000_000_000),
  delta,
  note,
  createdAt: new Date(1_700_000_000_000),
});

const group = (id: string, boqId: string, name: string, seq: number) => ({
  id,
  boqId,
  name,
  seq,
  createdAt: new Date(1_700_000_000_000),
  updatedAt: new Date(1_700_000_000_000),
});

const item = (
  id: string,
  groupId: string,
  cat: "M" | "L" | "S",
  qty: string,
  price: string,
) => ({
  id,
  groupId,
  code: `C-${id}`,
  name: `item ${id}`,
  detail: `detail ${id}`,
  cat,
  qty,
  unit: "ถุง",
  price,
  currencyCode: "THB",
  ccId: null,
  remainQty: qty,
  elementId: null,
  createdAt: new Date(1_700_000_000_000),
  updatedAt: new Date(1_700_000_000_000),
});

const cbs = (
  id: string,
  groupId: string,
  budget: string,
  used: string,
  committed: string,
) => ({
  id,
  groupId,
  budget,
  used,
  committed,
  currencyCode: "THB",
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

// B-084 (matrix GAP-2): generate-PR mints PRs + consumes budget, so it now
// requires the caller's role to carry pr.create. This role (id role-0, matched
// by userRow.roleId) grants it; roleRow(level).perms is {} (no pr.create).
const prCreatorRole = {
  ...roleRow(0),
  perms: { pr: { view: true, create: true, edit: false, approve: false, cancel: false } },
};

// ---------------------------------------------------------------------------
// GET /boq — list envelope + derived total + tenant scope
// ---------------------------------------------------------------------------

describe("GET /api/v1/boq — auth + list", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/boq" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("returns the B-014 envelope with a DERIVED total per doc (C10, never hardcoded)", async () => {
    const D0 = doc("d0", "BOQ-2026-B-02", "approved", 3, "u-dir");
    const D1 = doc("d1", "BOQ-2026-C-01", "draft");
    const G0 = group("g0", "d0", "02 งานโครงสร้าง", 1);
    // 2 items under d0's group: 10×100 + 3×50 = 1150. d1 has no items → total 0.
    const I0 = item("i0", "g0", "M", "10", "100.00");
    const I1 = item("i1", "g0", "M", "3", "50.00");
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [boqDocs, [D0, D1]],
            [boqGroups, [G0]],
            [boqItems, [I0, I1]],
            [users, [user("u-dir", "วิภา จันทร์เจริญ")]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/boq" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    const d0 = body.data.find((d: { id: string }) => d.id === "d0");
    const d1 = body.data.find((d: { id: string }) => d.id === "d1");
    expect(d0.total).toBe(1150);
    expect(d0.currency_code).toBe("THB");
    expect(d0.status).toBe("approved");
    expect(d0.version).toBe(3);
    expect(d1.total).toBe(0);
    // B-081 (F4): the approved doc carries a resolved approver; the draft one null.
    expect(d0.approved_by).toBe("u-dir");
    expect(d0.approved_by_name).toBe("วิภา จันทร์เจริญ");
    expect(d1.approved_by).toBe(null);
    expect(d1.approved_by_name).toBe(null);
    // wire is real columns only — no company_id / update timestamp leak.
    expect(Object.keys(d0).sort()).toEqual(
      [
        "approved_at",
        "approved_by",
        "approved_by_name",
        "currency_code",
        "id",
        "name",
        "no",
        "project_id",
        "scope",
        "status",
        "total",
        "version",
      ],
    );
  });

  it("rounds the derived total to 2 dp — no JS-float accumulation drift (B-085 fix 3)", async () => {
    const D0 = doc("d0", "BOQ-DRIFT", "draft");
    const G0 = group("g0", "d0", "01", 1);
    // 3 × 0.10 = 0.30000000000000004 in IEEE-754 → must round to 0.3, not leak the
    // trailing digits to the FE / visual gate.
    const I0 = item("i0", "g0", "M", "3", "0.10");
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[boqDocs, [D0]], [boqGroups, [G0]], [boqItems, [I0]], [users, []]],
        }),
      })
    ).inject({ url: "/api/v1/boq" });
    expect(res.statusCode).toBe(200);
    const d0 = res.json().data.find((d: { id: string }) => d.id === "d0");
    expect(d0.total).toBe(0.3);
  });

  it("binds company_id on the project root of every scoped read (no cross-tenant leak)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[boqDocs, [doc("d0", "N", "draft")]]], captured }),
      })
    ).inject({ url: "/api/v1/boq" });
    const docRead = captured.find((c) => c.table === boqDocs);
    expect(docRead).toBeTruthy();
    // the tenant predicate anchors on project.company_id = THIS tenant.
    expect(paramsOf(docRead!.where)).toContain(COMPANY);
    expect(paramsOf(docRead!.where)).not.toContain(OTHER_COMPANY);
  });
});

// ---------------------------------------------------------------------------
// POST /boq — create
// ---------------------------------------------------------------------------

describe("POST /api/v1/boq — create", () => {
  it("creates a draft doc (201, server-owned status=draft + version=1)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [project]], [boqDocs, []]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq",
      payload: { no: "BOQ-2026-Z-99", name: "New BOQ", scope: "Block Z", project_id: PROJECT },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.no).toBe("BOQ-2026-Z-99");
    expect(body.status).toBe("draft");
    expect(body.version).toBe(1);
    expect(body.total).toBe(0);
    expect(body.project_id).toBe(PROJECT);
  });

  it("400s when project_id is missing / not the tenant's", async () => {
    const missing = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [] }) })
    ).inject({ method: "POST", url: "/api/v1/boq", payload: { no: "X", name: "Y" } });
    expect(missing.statusCode).toBe(400);

    const foreign = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, []]] }), // project not visible to this tenant
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq",
      payload: { no: "X", name: "Y", project_id: PROJECT },
    });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().message).toBe("project not found");
  });

  it("409s on a duplicate no within the tenant", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [project]], [boqDocs, [doc("d0", "DUP", "approved")]]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq",
      payload: { no: "DUP", name: "Y", project_id: PROJECT },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_CODE");
  });
});

// ---------------------------------------------------------------------------
// GET /boq/:id — detail with per-group CBS
// ---------------------------------------------------------------------------

describe("GET /api/v1/boq/:id — detail + CBS", () => {
  it("returns the doc with per-group CBS available = budget − used − committed + F4 history", async () => {
    const D0 = doc("d0", "BOQ-1", "approved", 2, "u-dir");
    const G0 = group("g0", "d0", "02 งานโครงสร้าง", 1);
    const I0 = item("i0", "g0", "M", "4", "25.00"); // total 100
    const C0 = cbs("c0", "g0", "1000000.00", "200000.00", "100000.00"); // avail 700000
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [boqDocs, [D0]],
            [boqGroups, [G0]],
            [boqItems, [I0]],
            [cbsBudgets, [C0]],
            [users, [user("u-dir", "วิภา จันทร์เจริญ")]],
            // out-of-order versions — the detail sorts newest-first.
            [
              boqVersionHistory,
              [
                vhRow("vh1", "d0", 1, "อนุมัติฉบับแรก", "u-dir", "11598000", "BOQ ฉบับแรก"),
                vhRow("vh2", "d0", 2, "อนุมัติ", "u-dir", "-120000", "ลดสเปกประตู"),
              ],
            ],
          ],
        }),
      })
    ).inject({ url: "/api/v1/boq/d0" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(100);
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].cbs.available).toBe(700000);
    expect(body.groups[0].cbs.budget).toBe(1000000);
    // B-081 (F4): approver name + version-history (newest version first).
    expect(body.approved_by_name).toBe("วิภา จันทร์เจริญ");
    expect(body.version_history.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(body.version_history[0].action).toBe("อนุมัติ");
    expect(body.version_history[0].by_name).toBe("วิภา จันทร์เจริญ");
    expect(body.version_history[1].delta).toBe("11598000");
  });

  it("404s for an id outside the tenant", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[boqDocs, []]] }) })
    ).inject({ url: "/api/v1/boq/nope" });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /boq/:id/items — list + ?group filter
// ---------------------------------------------------------------------------

describe("GET /api/v1/boq/:id/items — list + group filter", () => {
  it("lists the doc's items (real item columns only)", async () => {
    const D0 = doc("d0", "N", "approved");
    const I0 = item("i0", "g0", "M", "4800", "168.50");
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[boqDocs, [D0]], [boqItems, [I0]]] }),
      })
    ).inject({ url: "/api/v1/boq/d0/items" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data[0].qty).toBe(4800);
    expect(body.data[0].price).toBe(168.5);
    expect(body.data[0].cat).toBe("M");
    expect(body.data[0].detail).toBe("detail i0");
    expect(Object.keys(body.data[0]).sort()).toEqual(
      ["cat", "cc_id", "code", "currency_code", "detail", "element_id", "group_id", "id", "name", "price", "qty", "remain_qty", "unit"],
    );
  });

  // B-323: a BOQ's items are its document LINES, not a document list. They render as
  // the ordered body of one doc, so they read ENTRY order (created_at ASC) — the exact
  // opposite direction to every list endpoint. Asserting a newest-first order here
  // would pass a fix that prints the priced lines bottom-to-top.
  //
  // boq_item has no `seq` column, so entry order lives only in created_at; POST
  // /boq/:id/items stamps the batch apart (stampEntryOrder) to record it.
  //
  // NOTE what this first test does NOT prove. It hands the reader four DISTINCT
  // timestamps — the seed's stagger in miniature — so it passes whether or not the
  // WRITE path stamps. A reader is only exercised against the real defect by rows that
  // actually TIE, which is what the two tests after it do (mirroring gr.test.ts).
  it("renders the doc's LINES in entry order — ascending, whatever the join plan returns", async () => {
    const at = (iso: string): Date => new Date(iso);
    const lines = ["i0", "i1", "i2", "i3"].map((id, i) => ({
      ...item(id, "g0", "M", "1", "1.00"),
      createdAt: at(`2026-07-20T09:00:00.00${i}Z`),
    }));
    const listIds = async (rows: unknown[]): Promise<string[]> => {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({ rows: [[boqDocs, [doc("d0", "N", "approved")]], [boqItems, rows]] }),
        })
      ).inject({ url: "/api/v1/boq/d0/items" });
      return res.json().data.map((r: { id: string }) => r.id);
    };
    const expected = ["i0", "i1", "i2", "i3"];
    expect(await listIds(lines)).toEqual(expected);
    expect(await listIds([lines[2]!, lines[0]!, lines[3]!, lines[1]!])).toEqual(expected);
    // the direction guard: reversed input must NOT come back reversed
    expect(await listIds([...lines].reverse())).toEqual(expected);
  });

  it("RECOVERS entry order from a stamped batch even when uuid order is its REVERSE", async () => {
    // The uuids are chosen so that sorting by id yields the exact opposite of entry
    // order, and the read hands the rows back in a third, scrambled order. Only
    // created_at can produce the right answer — which is why the write path must
    // stamp it. Without the stamp these three would tie and the uuid would decide.
    const t0 = new Date("2026-07-20T09:00:00.000Z").getTime();
    const written = [
      { ...item("ffff-cement", "g0", "M", "1", "1.00"), createdAt: new Date(t0) },
      { ...item("7777-steel", "g0", "M", "2", "1.00"), createdAt: new Date(t0 + 1) },
      { ...item("0000-sand", "g0", "M", "3", "1.00"), createdAt: new Date(t0 + 2) },
    ];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [boqDocs, [doc("d0", "N", "approved")]],
            [boqItems, [written[2]!, written[0]!, written[1]!]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/boq/d0/items" });
    const ids = res.json().data.map((r: { id: string }) => r.id);
    expect(ids).toEqual(["ffff-cement", "7777-steel", "0000-sand"]);
    // Asserted as a FOIL: if entryOrder ever degrades to the id tiebreak, the result
    // becomes this instead, so the test cannot pass by accident.
    expect([...ids].sort()).toEqual(["0000-sand", "7777-steel", "ffff-cement"]);
  });

  it("a doc whose lines DID tie (written before the stamp) still renders deterministically", async () => {
    // Rows already in the database carry the old tied timestamps and cannot be
    // repaired. entryOrder must still be TOTAL over them — deterministically wrong
    // beats nondeterministic, because the visual gate can at least hold the line.
    const tied = new Date("2026-07-20T09:00:00.000Z");
    const legacy = [
      { ...item("ffff-cement", "g0", "M", "1", "1.00"), createdAt: tied },
      { ...item("0000-sand", "g0", "M", "3", "1.00"), createdAt: tied },
    ];
    const listIds = async (rows: unknown[]): Promise<string[]> => {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({ rows: [[boqDocs, [doc("d0", "N", "approved")]], [boqItems, rows]] }),
        })
      ).inject({ url: "/api/v1/boq/d0/items" });
      return res.json().data.map((r: { id: string }) => r.id);
    };
    // Both join-plan orders must agree — that is what "total" means.
    expect(await listIds(legacy)).toEqual(await listIds([...legacy].reverse()));
  });

  it("?group binds the group id into the scoped item read", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[boqDocs, [doc("d0", "N", "approved")]], [boqItems, []]], captured }),
      })
    ).inject({ url: "/api/v1/boq/d0/items?group=g-xyz" });
    const itemRead = captured.find((c) => c.table === boqItems);
    expect(itemRead).toBeTruthy();
    expect(paramsOf(itemRead!.where)).toContain("g-xyz");
  });

  it("404s for a doc outside the tenant", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[boqDocs, []]] }) })
    ).inject({ url: "/api/v1/boq/nope/items" });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /boq/:id/items — bulk add + immutability
// ---------------------------------------------------------------------------

describe("POST /api/v1/boq/:id/items — bulk add", () => {
  it("adds items (201) targeting a group of the doc and returns the refreshed total", async () => {
    const inserted: Inserted[] = [];
    const D0 = doc("d0", "N", "draft");
    const G0 = group("g0", "d0", "02", 1);
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[boqDocs, [D0]], [boqGroups, [G0]], [projects, [project]], [boqItems, []]],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq/d0/items",
      payload: { items: [{ group_id: "g0", code: "MAT-1", name: "ปูน", cat: "M", qty: 10, unit: "ถุง", price: 100 }] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].code).toBe("MAT-1");
    expect(body.items[0].remain_qty).toBe(10); // fresh line → remain = qty
    // the write landed on the boq_item table.
    const write = inserted.find((w) => w.table === boqItems);
    expect(write).toBeTruthy();
  });

  // B-323 — the WRITE half. This is the test whose absence let the defect ship: the
  // read-side test above hands the reader distinct timestamps, so it passes with or
  // without a stamp. insertThrough is ONE `.insert().values(rows)` — one statement,
  // one now() — so an unstamped bulk add gives every line the SAME created_at, the ASC
  // reader falls through to the `defaultRandom()` uuid, and the priced body of the BOQ
  // renders in uuid order, stably wrong forever. Assert the batch is spaced apart.
  it("stamps a bulk add apart so its ENTRY ORDER is recorded, not inferred", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [boqDocs, [doc("d0", "N", "draft")]],
            [boqGroups, [group("g0", "d0", "02", 1)]],
            [projects, [project]],
            [boqItems, []],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq/d0/items",
      payload: {
        items: [
          { group_id: "g0", code: "M-1", name: "ปูน", cat: "M", qty: 1, price: 100 },
          { group_id: "g0", code: "M-2", name: "เหล็ก", cat: "M", qty: 2, price: 100 },
          { group_id: "g0", code: "M-3", name: "ทราย", cat: "M", qty: 3, price: 100 },
          { group_id: "g0", code: "M-4", name: "หิน", cat: "M", qty: 4, price: 100 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const rows = inserted.find((w) => w.table === boqItems)!.rows as {
      code: string;
      createdAt?: Date;
    }[];
    // body order is preserved …
    expect(rows.map((r) => r.code)).toEqual(["M-1", "M-2", "M-3", "M-4"]);
    // … and each line carries a DISTINCT, strictly increasing instant. Without the
    // stamp every createdAt here is `undefined` (the column default fires server-side
    // and ties them all), so both assertions below fail.
    const times = rows.map((r) => r.createdAt?.getTime());
    expect(times.every((t) => typeof t === "number")).toBe(true);
    expect(new Set(times).size).toBe(4);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
  });

  it("accepts a bare items[] array body too", async () => {
    const D0 = doc("d0", "N", "revise");
    const G0 = group("g0", "d0", "02", 1);
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[boqDocs, [D0]], [boqGroups, [G0]], [projects, [project]], [boqItems, []]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq/d0/items",
      payload: [{ group_id: "g0", code: "L-1", name: "แรง", cat: "L", qty: 5, price: 200 }],
    });
    expect(res.statusCode).toBe(201);
  });

  it("REJECTS edits once approved (409 locked — immutable until a Revise)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[boqDocs, [doc("d0", "N", "approved")]]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq/d0/items",
      payload: { items: [{ group_id: "g0", code: "X", name: "Y", cat: "M", qty: 1, price: 1 }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("BOQ_LOCKED");
  });

  it("400s when an item targets a group not in this BOQ, or with a bad cat", async () => {
    const D0 = doc("d0", "N", "draft");
    const G0 = group("g0", "d0", "02", 1);
    const badGroup = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[boqDocs, [D0]], [boqGroups, [G0]], [projects, [project]]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq/d0/items",
      payload: { items: [{ group_id: "g-foreign", code: "X", name: "Y", cat: "M", qty: 1, price: 1 }] },
    });
    expect(badGroup.statusCode).toBe(400);

    const badCat = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[boqDocs, [D0]], [boqGroups, [G0]], [projects, [project]]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq/d0/items",
      payload: { items: [{ group_id: "g0", code: "X", name: "Y", cat: "Z", qty: 1, price: 1 }] },
    });
    expect(badCat.statusCode).toBe(400);
  });

  it("400s on an empty items list", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[boqDocs, [doc("d0", "N", "draft")]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/boq/d0/items", payload: { items: [] } });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// State machine: submit → approve → revise (+ authority + guards)
// ---------------------------------------------------------------------------

describe("BOQ state machine — submit/approve/revise", () => {
  it("submit: draft → pending", async () => {
    const D0 = doc("d0", "N", "draft");
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[boqDocs, [D0]], [projects, [project]], [boqItems, []]], updated, updateBase: D0 }),
      })
    ).inject({ method: "POST", url: "/api/v1/boq/d0/submit" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending");
    expect(updated[0]!.set.status).toBe("pending");
  });

  it("submit: 409 when the doc is not draft/revise (e.g. already pending)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[boqDocs, [doc("d0", "N", "pending")]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/boq/d0/submit" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("approve: pending → approved (LOCK) with MD-tier authority + F4 history", async () => {
    const D0 = doc("d0", "N", "pending", 2);
    const updated: Updated[] = [];
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [boqDocs, [D0]],
            [users, [userRow]],
            [roles, [roleRow(4)]], // Director — may approve
            [projects, [project]],
            [boqItems, []],
          ],
          updated,
          inserted,
          updateBase: { ...D0, status: "approved", approvedBy: "u-0" },
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/boq/d0/approve" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("approved");
    expect(updated[0]!.set.status).toBe("approved");
    // B-081 (F4): the archive approver + timestamp are stamped on the doc.
    expect(updated[0]!.set.approvedBy).toBe("u-0");
    expect(updated[0]!.set.approvedAt).toBeInstanceOf(Date);
    // ...and a version-history row is appended (action=approve, doc version).
    const vhWrite = inserted.find((w) => w.table === boqVersionHistory);
    expect(vhWrite).toBeTruthy();
    const vh = vhWrite!.rows[0] as { action: string; version: number; by: string | null };
    expect(vh.action).toBe("approve");
    expect(vh.version).toBe(2);
    expect(vh.by).toBe("u-0");
    // echoed approver display name resolves from the user row.
    expect(res.json().approved_by).toBe("u-0");
    expect(res.json().approved_by_name).toBe("วิภา");
  });

  it("approve: 403 when the caller's role.approvalLevel is below the MD tier", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [boqDocs, [doc("d0", "N", "pending")]],
            [users, [userRow]],
            [roles, [roleRow(3)]], // Project Manager — NOT enough for BOQ lock
          ],
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/boq/d0/approve" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("approve: 409 when the doc is not pending (must submit first)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [boqDocs, [doc("d0", "N", "draft")]],
            [users, [userRow]],
            [roles, [roleRow(4)]],
          ],
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/boq/d0/approve" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("revise: approved → revise with version += 1 (+ B-085 fix 1 revise-history row)", async () => {
    const D0 = doc("d0", "N", "approved", 3);
    const updated: Updated[] = [];
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[boqDocs, [D0]], [users, [userRow]], [roles, [roleRow(4)]], [projects, [project]], [boqItems, []]],
          updated,
          inserted,
          updateBase: D0,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/boq/d0/revise" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("revise");
    expect(body.version).toBe(4); // v3 → v4
    expect(updated[0]!.set.version).toBe(4);
    // B-085 fix 1: revise now writes a version-history row (action=revise) for the
    // NEW version so the archive timeline shows revise events, not just approvals.
    const vhWrite = inserted.find((w) => w.table === boqVersionHistory);
    expect(vhWrite).toBeTruthy();
    const vh = vhWrite!.rows[0] as { action: string; version: number; by: string | null };
    expect(vh.action).toBe("revise");
    expect(vh.version).toBe(4); // the freshly bumped version — distinct from approve keys
    expect(vh.by).toBe("u-0"); // resolved reviser (mirrors /approve)
  });

  // B-084 (authz-reaudit GAP-1): revise re-opens an approved BOQ — it demands the
  // SAME MD authority the approval did. A sub-MD caller cannot silently un-approve.
  it("revise: 403 when the caller's role.approvalLevel is below the MD tier", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [boqDocs, [doc("d0", "N", "approved", 3)]],
            [users, [userRow]],
            [roles, [roleRow(3)]], // Project Manager — cannot un-lock an approved BOQ
          ],
          updated,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/boq/d0/revise" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(updated).toHaveLength(0); // fail-closed: the approved BOQ was NOT re-opened
  });

  it("revise: 409 when the doc is not approved", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[boqDocs, [doc("d0", "N", "pending")]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/boq/d0/revise" });
    expect(res.statusCode).toBe(409);
  });

  it("action endpoints 404 for a doc outside the tenant", async () => {
    for (const verb of ["submit", "approve", "revise"]) {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({ rows: [[boqDocs, []], [users, [userRow]], [roles, [roleRow(4)]]] }),
        })
      ).inject({ method: "POST", url: `/api/v1/boq/nope/${verb}` });
      expect(res.statusCode).toBe(404);
    }
  });
});

// ---------------------------------------------------------------------------
// POST /boq/:id/generate-pr — M/S split + cut-remain (boq-extra.jsx BOQtoPRForm)
// ---------------------------------------------------------------------------

describe("POST /api/v1/boq/:id/generate-pr — split + cut-remain", () => {
  // An approved doc with a Material (M) item and a Subcon (S) item.
  const D0 = doc("d0", "BOQ-2026-B-02", "approved", 3);
  const IM = item("im", "g0", "M", "10", "100.00"); // remain 10, price 100
  const IS = item("is", "g0", "S", "8", "200.00"); // remain 8,  price 200

  it("splits Material→material PR + Subcon→subcon PR, prices from real BOQ (C10), and cuts remain", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [boqDocs, [D0]],
            [boqItems, [IM, IS]],
            [projects, [project]],
            [prs, []],
            [users, [userRow]],
            [roles, [prCreatorRole]],
          ],
          inserted,
          updated,
          updateBase: IM,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq/d0/generate-pr",
      payload: { item_ids: ["im", "is"], qty: { im: 5, is: 3 } },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.prs).toHaveLength(2);

    const mat = body.prs.find((p: { type: string }) => p.type === "material");
    const sub = body.prs.find((p: { type: string }) => p.type === "subcon");
    expect(mat).toBeTruthy();
    expect(sub).toBeTruthy();
    // Running nos derive from the (empty) existing set → 0001 each prefix.
    expect(mat.no).toMatch(/^PR-\d{4}-0001$/);
    expect(sub.no).toMatch(/^PR-S-\d{4}-0001$/);
    expect(mat.boq_id).toBe("d0");

    // Material PR: 1 line (im), amount = 5 × 100 (real BOQ price, never hardcoded).
    expect(mat.items).toHaveLength(1);
    expect(mat.items[0].boq_item_id).toBe("im");
    expect(mat.items[0].qty).toBe(5);
    expect(mat.items[0].price).toBe(100);
    expect(mat.amount).toBe(500);
    // Subcon PR: 1 line (is), amount = 3 × 200.
    expect(sub.items[0].boq_item_id).toBe("is");
    expect(sub.amount).toBe(600);

    // Two PR docs + their lines were inserted on pr / pr_item.
    expect(inserted.filter((w) => w.table === prs)).toHaveLength(2);
    expect(inserted.filter((w) => w.table === prItems)).toHaveLength(2);
    const prLines = inserted.filter((w) => w.table === prItems);
    expect((prLines[0]!.rows[0] as { boqItemId: string }).boqItemId).toBe("im");

    // Cut-remain: a SINGLE bulk CASE update decrements every PR'd item's
    // remain_qty (10−5, 8−3 → both "5") in one statement — not one update per
    // row (0024 perf fix, updateThroughChainMany). The CASE binds each item id
    // with its new remainder; the WHERE scopes to the resolved ids.
    const remainWrites = updated.filter((u) => u.table === boqItems);
    expect(remainWrites).toHaveLength(1);
    const caseParams = paramsOf(remainWrites[0]!.set.remainQty as SQL);
    expect(caseParams).toEqual(expect.arrayContaining(["im", "is", "5"]));
    const whereParams = paramsOf(remainWrites[0]!.where);
    expect(whereParams).toEqual(expect.arrayContaining(["im", "is"]));
  });

  it("single category (only Material) → one PR, no subcon PR", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [boqDocs, [D0]],
            [boqItems, [IM]],
            [projects, [project]],
            [prs, []],
            [users, [userRow]],
            [roles, [prCreatorRole]],
          ],
          updateBase: IM,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq/d0/generate-pr",
      payload: { item_ids: ["im"], qty: { im: 4 } },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.prs).toHaveLength(1);
    expect(body.prs[0].type).toBe("material");
  });

  it("defaults qty to the item's full remaining quantity when omitted", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [boqDocs, [D0]],
            [boqItems, [IM]],
            [projects, [project]],
            [prs, []],
            [users, [userRow]],
            [roles, [prCreatorRole]],
          ],
          updateBase: IM,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq/d0/generate-pr",
      payload: { item_ids: ["im"] }, // no qty map → full remain (10)
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().prs[0].amount).toBe(1000); // 10 × 100
  });

  it("409s when the BOQ is not approved (draft cannot be PR'd)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [boqDocs, [doc("d0", "N", "draft")]],
            [users, [userRow]],
            [roles, [prCreatorRole]],
          ],
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq/d0/generate-pr",
      payload: { item_ids: ["im"], qty: { im: 1 } },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("BOQ_NOT_APPROVED");
  });

  it("409s when a requested qty exceeds the item's remain_qty", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [boqDocs, [D0]],
            [boqItems, [IM]],
            [users, [userRow]],
            [roles, [prCreatorRole]],
          ],
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq/d0/generate-pr",
      payload: { item_ids: ["im"], qty: { im: 20 } }, // remain is 10
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("QTY_EXCEEDS_REMAIN");
  });

  it("404s when a selected item is not in this BOQ (tenant/doc scoped)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [boqDocs, [D0]],
            [boqItems, [IM]],
            [users, [userRow]],
            [roles, [prCreatorRole]],
          ],
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq/d0/generate-pr",
      payload: { item_ids: ["im", "foreign"], qty: { im: 1, foreign: 1 } },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400s when item_ids is empty", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [boqDocs, [D0]],
            [users, [userRow]],
            [roles, [prCreatorRole]],
          ],
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/boq/d0/generate-pr", payload: { item_ids: [] } });
    expect(res.statusCode).toBe(400);
  });

  it("404s for a BOQ outside the tenant, and binds company_id on the scoped read", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[boqDocs, []]], captured }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq/nope/generate-pr",
      payload: { item_ids: ["im"], qty: { im: 1 } },
    });
    expect(res.statusCode).toBe(404);
    const docRead = captured.find((c) => c.table === boqDocs);
    expect(paramsOf(docRead!.where)).toContain(COMPANY);
    expect(paramsOf(docRead!.where)).not.toContain(OTHER_COMPANY);
  });

  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/boq/d0/generate-pr",
      payload: { item_ids: ["im"] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403s a caller whose role lacks pr.create (B-084: no unauthorized spend initiation)", async () => {
    // A zero-perms role (roleRow(4).perms is {}) — even an MD-tier approver — may
    // not mint PRs unless it carries the pr.create right.
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [boqDocs, [D0]],
            [boqItems, [IM]],
            [users, [userRow]],
            [roles, [roleRow(4)]], // approvalLevel 4 but perms {} → no pr.create
          ],
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/boq/d0/generate-pr",
      payload: { item_ids: ["im"], qty: { im: 1 } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });
});

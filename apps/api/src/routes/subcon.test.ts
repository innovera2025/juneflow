// G3 unit tests (PLAN.md §9) — Subcon / Acceptance handlers (Phase-4 FLOW-B
// Wave-0; subcon-accept.jsx SubconContracts + subcon-accept2.jsx SubconAccept /
// AcceptForm, flows.html FLOW-B "งวดงานผู้รับเหมา + ศูนย์ตรวจรับ"). Covers the
// B-014 list envelope, tenant scope on every read/write (company_id bound on the
// project root reached THROUGH the subcon hop chain — no cross-tenant leak), the
// C3 state machines (work_period pending→delivered→passed|rejected; defect
// open→fixing→closed|open), create anchored on the tenant project (insertThrough
// re-verify, fail-closed on a foreign project/vendor), the acceptance-center
// period queue reused from counts.ts, and the AuditLog choke point (a spy sink
// fires on a successful mutation and NOT on a 409/404 guard). All rows come from
// the stub — no value is hand-computed against the impl.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  subconContracts,
  workPeriods,
  acceptances,
  defects,
  projects,
  vendors,
} from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import type { AuditRecord } from "../plugins/audit-log.js";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const OTHER_COMPANY = "33333333-3333-3333-3333-333333333333";
const PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const VENDOR = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const CONTRACT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PERIOD = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const ACCEPTANCE = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const DEFECT = "ffffffff-ffff-ffff-ffff-ffffffffffff";
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
  // The transaction door runs its callback against this SAME stub, so writes
  // inside a tx still capture into inserted/updated/captured (no real BEGIN).
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
// Row factories (stub-backed — real columns only)
// ---------------------------------------------------------------------------

const project = { id: PROJECT, companyId: COMPANY, name: "juneflow ราชพฤกษ์" };
const vendor = { id: VENDOR, companyId: COMPANY, name: "บจก. รุ่งเรืองก่อสร้าง" };

const contract = (id: string, no: string) => ({
  id,
  vendorId: VENDOR,
  projectId: PROJECT,
  no,
  value: "2150000.00",
  currencyCode: "THB",
  retentionPct: "10.000",
  start: "2026-02-01",
  end: "2026-09-30",
  createdAt: D,
  updatedAt: D,
});

const period = (
  id: string,
  status: "pending" | "delivered" | "inspecting" | "passed" | "rejected" | "paid",
  basis: "percent" | "distance" | "milestone" | "unit" = "percent",
  seq = 1,
) => ({
  id,
  contractId: CONTRACT,
  seq,
  basis,
  target: "20.000",
  pct: "0.000",
  amount: "430000.00",
  currencyCode: "THB",
  status,
  createdAt: D,
  updatedAt: D,
});

const acceptance = (id: string, periodId: string) => ({
  id,
  periodId,
  inspector: null,
  photos: [] as string[],
  docs: [] as string[],
  signedAt: null,
  createdAt: D,
  updatedAt: D,
});

const defect = (
  id: string,
  status: "open" | "fixing" | "recheck" | "closed",
) => ({
  id,
  acceptanceId: ACCEPTANCE,
  item: "ฉาบผนัง B-06 เป็นคลื่น",
  severity: "medium",
  beforePhoto: "before.jpg",
  afterPhoto: null as string | null,
  due: null as string | null,
  status,
  createdAt: D,
  updatedAt: D,
});

// ---------------------------------------------------------------------------
// GET /subcon-contracts — list envelope + tenant scope
// ---------------------------------------------------------------------------

describe("GET /api/v1/subcon-contracts — auth + list", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/subcon-contracts" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("returns the B-014 envelope of real contract columns (money carries currency_code)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[subconContracts, [contract(CONTRACT, "WO-2026-0042")]]] }),
      })
    ).inject({ url: "/api/v1/subcon-contracts" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    const c = body.data[0];
    expect(c.no).toBe("WO-2026-0042");
    expect(c.value).toBe(2150000);
    expect(c.currency_code).toBe("THB");
    expect(c.retention_pct).toBe(10);
    expect(c.vendor_id).toBe(VENDOR);
    expect(c.project_id).toBe(PROJECT);
    expect(Object.keys(c).sort()).toEqual(
      ["currency_code", "end", "id", "no", "project_id", "retention_pct", "start", "value", "vendor_id"],
    );
  });

  it("binds company_id on the project root of the scoped read (no cross-tenant leak)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[subconContracts, [contract(CONTRACT, "N")]]], captured }),
      })
    ).inject({ url: "/api/v1/subcon-contracts" });
    const read = captured.find((c) => c.table === subconContracts);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
    expect(paramsOf(read!.where)).not.toContain(OTHER_COMPANY);
  });
});

// ---------------------------------------------------------------------------
// GET /subcon-contracts/:id/periods — list + 404 + tenant scope
// ---------------------------------------------------------------------------

describe("GET /api/v1/subcon-contracts/:id/periods", () => {
  it("lists a tenant contract's periods (sorted by seq) with company_id bound on both reads", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [subconContracts, [contract(CONTRACT, "WO-1")]],
            [workPeriods, [period("p2", "pending", "percent", 2), period("p1", "delivered", "percent", 1)]],
          ],
          captured,
        }),
      })
    ).inject({ url: `/api/v1/subcon-contracts/${CONTRACT}/periods` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.data.map((p: { seq: number }) => p.seq)).toEqual([1, 2]); // sorted
    expect(body.data[0].amount).toBe(430000);
    expect(body.data[0].currency_code).toBe("THB");
    // both the contract read and the period read anchor company_id on the project.
    for (const table of [subconContracts, workPeriods]) {
      const read = captured.find((c) => c.table === table);
      expect(read).toBeTruthy();
      expect(paramsOf(read!.where)).toContain(COMPANY);
    }
  });

  it("404s when the contract is not this tenant's (foreign id)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[subconContracts, []]] }),
      })
    ).inject({ url: `/api/v1/subcon-contracts/${CONTRACT}/periods` });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /subcon-contracts — create (anchored on the tenant project)
// ---------------------------------------------------------------------------

describe("POST /api/v1/subcon-contracts — create", () => {
  it("creates a contract + embedded periods (201, server-owned status=pending, NO autosplit)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[projects, [project]], [vendors, [vendor]]],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/subcon-contracts",
      payload: {
        project_id: PROJECT,
        vendor_id: VENDOR,
        no: "WO-2026-0099",
        value: 1_750_000,
        retention_pct: 5,
        periods: [
          { seq: 1, basis: "distance", target: 100, amount: 100_000 },
          { seq: 2, basis: "distance", target: 100, amount: 100_000 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.no).toBe("WO-2026-0099");
    expect(body.value).toBe(1_750_000);
    expect(body.retention_pct).toBe(5);
    expect(body.periods).toHaveLength(2);
    expect(body.periods[0].status).toBe("pending"); // server-owned
    expect(body.periods[0].basis).toBe("distance");
    // the contract + its periods were inserted (period rows carry the contractId).
    expect(inserted.filter((w) => w.table === subconContracts)).toHaveLength(1);
    const periodWrite = inserted.find((w) => w.table === workPeriods);
    expect(periodWrite!.rows).toHaveLength(2);
    expect((periodWrite!.rows[0] as { status: string }).status).toBe("pending");
    expect((periodWrite!.rows[0] as { contractId: string }).contractId).toBeTruthy();
  });

  it("creates a contract with no periods when periods[] is omitted", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [project]], [vendors, [vendor]]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/subcon-contracts",
      payload: { project_id: PROJECT, vendor_id: VENDOR, no: "WO-2026-0100" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().periods).toEqual([]);
  });

  it("400s when project_id / vendor_id / no is missing", async () => {
    for (const payload of [
      { vendor_id: VENDOR, no: "X" },
      { project_id: PROJECT, no: "X" },
      { project_id: PROJECT, vendor_id: VENDOR },
    ]) {
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [] }) })
      ).inject({ method: "POST", url: "/api/v1/subcon-contracts", payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it("400s (fail closed) when the project is not the tenant's — no write, company_id bound on the read", async () => {
    const inserted: Inserted[] = [];
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, []], [vendors, [vendor]]], inserted, captured }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/subcon-contracts",
      payload: { project_id: PROJECT, vendor_id: VENDOR, no: "WO-X" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("project not found");
    expect(inserted.find((w) => w.table === subconContracts)).toBeFalsy();
    const read = captured.find((c) => c.table === projects);
    expect(paramsOf(read!.where)).toContain(COMPANY);
    expect(paramsOf(read!.where)).not.toContain(OTHER_COMPANY);
  });

  it("400s when the vendor is not the tenant's (no anchoring on a foreign vendor)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [project]], [vendors, []]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/subcon-contracts",
      payload: { project_id: PROJECT, vendor_id: VENDOR, no: "WO-X" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe("vendor not found");
  });

  it("400s when an embedded period has an invalid basis", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [project]], [vendors, [vendor]]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/subcon-contracts",
      payload: { project_id: PROJECT, vendor_id: VENDOR, no: "WO-X", periods: [{ basis: "bogus" }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("records an AuditLog row on a successful create (mutation choke point)", async () => {
    const records: AuditRecord[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [project]], [vendors, [vendor]]] }),
        auditSink: (r) => { records.push(r); },
      })
    ).inject({
      method: "POST",
      url: "/api/v1/subcon-contracts",
      payload: { project_id: PROJECT, vendor_id: VENDOR, no: "WO-AUD" },
    });
    expect(res.statusCode).toBe(201);
    expect(records).toHaveLength(1);
    expect(records[0]!.action).toBe("create");
  });
});

// ---------------------------------------------------------------------------
// POST /periods/:id/deliver — pending → delivered + acceptance upsert
// ---------------------------------------------------------------------------

describe("POST /api/v1/periods/:id/deliver", () => {
  it("delivers a pending period (200 → delivered) and upserts the acceptance", async () => {
    const P = period(PERIOD, "pending");
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [workPeriods, [P]],
            [subconContracts, [contract(CONTRACT, "WO-1")]],
            [acceptances, []], // none yet → created
            [projects, [project]],
          ],
          inserted,
          updated,
          updateBase: P,
        }),
      })
    ).inject({
      method: "POST",
      url: `/api/v1/periods/${PERIOD}/deliver`,
      payload: { docs: ["delivery-note.pdf"], photos: ["p1.jpg", "p2.jpg"] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("delivered");
    expect(body.acceptance).toBeTruthy();
    // period status flip landed on work_period; a fresh acceptance was inserted.
    const flip = updated.find((u) => u.table === workPeriods);
    expect(flip!.set.status).toBe("delivered");
    const accWrite = inserted.find((w) => w.table === acceptances);
    expect(accWrite).toBeTruthy();
    expect((accWrite!.rows[0] as { docs: string[] }).docs).toEqual(["delivery-note.pdf"]);
    expect((accWrite!.rows[0] as { periodId: string }).periodId).toBe(PERIOD);
  });

  it("updates the existing acceptance instead of inserting a second one", async () => {
    const P = period(PERIOD, "pending");
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [workPeriods, [P]],
            [subconContracts, [contract(CONTRACT, "WO-1")]],
            [acceptances, [acceptance(ACCEPTANCE, PERIOD)]], // already exists → update
            [projects, [project]],
          ],
          inserted,
          updated,
          updateBase: P,
        }),
      })
    ).inject({
      method: "POST",
      url: `/api/v1/periods/${PERIOD}/deliver`,
      payload: { docs: ["v2.pdf"], photos: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(inserted.find((w) => w.table === acceptances)).toBeFalsy(); // no 2nd insert
    expect(updated.find((u) => u.table === acceptances)).toBeTruthy(); // updated in place
  });

  it("409s when the period is not pending (INVALID_STATE) and does NOT audit or mutate", async () => {
    const updated: Updated[] = [];
    const records: AuditRecord[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[workPeriods, [period(PERIOD, "delivered")]], [subconContracts, [contract(CONTRACT, "WO-1")]]],
          updated,
        }),
        auditSink: (r) => { records.push(r); },
      })
    ).inject({ method: "POST", url: `/api/v1/periods/${PERIOD}/deliver`, payload: { docs: [], photos: [] } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
    expect(updated).toHaveLength(0);
    expect(records).toHaveLength(0); // audit never fires on a rejected mutation
  });

  it("404s for a period outside the tenant (no mutation, no audit) and binds company_id", async () => {
    const captured: Captured[] = [];
    const records: AuditRecord[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[workPeriods, []]], captured }),
        auditSink: (r) => { records.push(r); },
      })
    ).inject({ method: "POST", url: `/api/v1/periods/${PERIOD}/deliver`, payload: { docs: [], photos: [] } });
    expect(res.statusCode).toBe(404);
    expect(records).toHaveLength(0);
    const read = captured.find((c) => c.table === workPeriods);
    expect(paramsOf(read!.where)).toContain(COMPANY);
    expect(paramsOf(read!.where)).not.toContain(OTHER_COMPANY);
  });

  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: `/api/v1/periods/${PERIOD}/deliver`,
      payload: { docs: [], photos: [] },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /periods/:id/inspect — pass → passed | reject → rejected + defects
// ---------------------------------------------------------------------------

describe("POST /api/v1/periods/:id/inspect", () => {
  it("pass: delivered → passed (200) and records an AuditLog row", async () => {
    const P = period(PERIOD, "delivered");
    const updated: Updated[] = [];
    const records: AuditRecord[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[workPeriods, [P]], [subconContracts, [contract(CONTRACT, "WO-1")]], [projects, [project]]],
          updated,
          updateBase: P,
        }),
        auditSink: (r) => { records.push(r); },
      })
    ).inject({ method: "POST", url: `/api/v1/periods/${PERIOD}/inspect`, payload: { result: "pass" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("passed");
    expect(updated.find((u) => u.table === workPeriods)!.set.status).toBe("passed");
    expect(records).toHaveLength(1);
  });

  it("reject: delivered → rejected + inserts defect rows (item/severity/before_photo)", async () => {
    const P = period(PERIOD, "delivered");
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [workPeriods, [P]],
            [subconContracts, [contract(CONTRACT, "WO-1")]],
            [acceptances, [acceptance(ACCEPTANCE, PERIOD)]], // attach defects here
            [projects, [project]],
          ],
          inserted,
          updated,
          updateBase: P,
        }),
      })
    ).inject({
      method: "POST",
      url: `/api/v1/periods/${PERIOD}/inspect`,
      payload: {
        result: "reject",
        defects: [
          { item: "ฉาบผนัง B-06 เป็นคลื่น", severity: "medium", photo_before: "b1.jpg" },
          { item: "ขอบวงกบไม่เรียบ" },
          { severity: "low" }, // no item → not recorded
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("rejected");
    expect(updated.find((u) => u.table === workPeriods)!.set.status).toBe("rejected");
    const defectWrite = inserted.find((w) => w.table === defects);
    expect(defectWrite!.rows).toHaveLength(2); // the item-less defect is dropped
    const first = defectWrite!.rows[0] as { item: string; severity: string; beforePhoto: string; status: string; acceptanceId: string };
    expect(first.item).toBe("ฉาบผนัง B-06 เป็นคลื่น");
    expect(first.severity).toBe("medium");
    expect(first.beforePhoto).toBe("b1.jpg");
    expect(first.status).toBe("open");
    expect(first.acceptanceId).toBe(ACCEPTANCE);
    expect(body.defects).toHaveLength(2);
  });

  it("reject: creates the acceptance when the period has none, then attaches defects", async () => {
    const P = period(PERIOD, "delivered");
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [workPeriods, [P]],
            [subconContracts, [contract(CONTRACT, "WO-1")]],
            [acceptances, []], // none → created inside the tx
            [projects, [project]],
          ],
          inserted,
          updateBase: P,
        }),
      })
    ).inject({
      method: "POST",
      url: `/api/v1/periods/${PERIOD}/inspect`,
      payload: { result: "reject", defects: [{ item: "งานไม่เรียบ" }] },
    });
    expect(res.statusCode).toBe(200);
    expect(inserted.find((w) => w.table === acceptances)).toBeTruthy();
    expect(inserted.find((w) => w.table === defects)).toBeTruthy();
  });

  it("400s when result is not pass/reject", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[workPeriods, [period(PERIOD, "delivered")]], [subconContracts, [contract(CONTRACT, "WO-1")]]] }),
      })
    ).inject({ method: "POST", url: `/api/v1/periods/${PERIOD}/inspect`, payload: { result: "maybe" } });
    expect(res.statusCode).toBe(400);
  });

  it("409s when the period is not delivered/inspecting (e.g. still pending)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[workPeriods, [period(PERIOD, "pending")]], [subconContracts, [contract(CONTRACT, "WO-1")]]] }),
      })
    ).inject({ method: "POST", url: `/api/v1/periods/${PERIOD}/inspect`, payload: { result: "pass" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("404s for a period outside the tenant", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[workPeriods, []]] }),
      })
    ).inject({ method: "POST", url: `/api/v1/periods/${PERIOD}/inspect`, payload: { result: "pass" } });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /defects/:id/fix — open|recheck → fixing (+ after_photo)
// ---------------------------------------------------------------------------

describe("POST /api/v1/defects/:id/fix", () => {
  it("fixes an open defect → fixing and stores the after photo", async () => {
    const DEF = defect(DEFECT, "open");
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[defects, [DEF]]], updated, updateBase: DEF }),
      })
    ).inject({ method: "POST", url: `/api/v1/defects/${DEFECT}/fix`, payload: { photo_after: "after.jpg" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("fixing");
    expect(body.after_photo).toBe("after.jpg");
    const write = updated.find((u) => u.table === defects);
    expect(write!.set.status).toBe("fixing");
    expect(write!.set.afterPhoto).toBe("after.jpg");
  });

  it("allows fixing a re-opened (recheck) defect", async () => {
    const DEF = defect(DEFECT, "recheck");
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[defects, [DEF]]], updateBase: DEF }),
      })
    ).inject({ method: "POST", url: `/api/v1/defects/${DEFECT}/fix`, payload: { photo_after: "a.jpg" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("fixing");
  });

  it("409s when the defect is already closed", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[defects, [defect(DEFECT, "closed")]]] }),
      })
    ).inject({ method: "POST", url: `/api/v1/defects/${DEFECT}/fix`, payload: { photo_after: "a.jpg" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("404s for a defect outside the tenant, binding company_id on the scoped read", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[defects, []]], captured }),
      })
    ).inject({ method: "POST", url: `/api/v1/defects/${DEFECT}/fix`, payload: { photo_after: "a.jpg" } });
    expect(res.statusCode).toBe(404);
    const read = captured.find((c) => c.table === defects);
    expect(paramsOf(read!.where)).toContain(COMPANY);
    expect(paramsOf(read!.where)).not.toContain(OTHER_COMPANY);
  });
});

// ---------------------------------------------------------------------------
// POST /defects/:id/recheck — fixing → closed (pass-like) | open
// ---------------------------------------------------------------------------

describe("POST /api/v1/defects/:id/recheck", () => {
  it("closes the defect when result is pass-like", async () => {
    const DEF = defect(DEFECT, "fixing");
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[defects, [DEF]]], updated, updateBase: DEF }),
      })
    ).inject({ method: "POST", url: `/api/v1/defects/${DEFECT}/recheck`, payload: { result: "pass" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("closed");
    expect(updated.find((u) => u.table === defects)!.set.status).toBe("closed");
  });

  it("re-opens the defect when result is NOT pass-like", async () => {
    const DEF = defect(DEFECT, "fixing");
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[defects, [DEF]]], updated, updateBase: DEF }),
      })
    ).inject({ method: "POST", url: `/api/v1/defects/${DEFECT}/recheck`, payload: { result: "still-bad" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("open");
    expect(updated.find((u) => u.table === defects)!.set.status).toBe("open");
  });

  it("409s when the defect is not being fixed", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[defects, [defect(DEFECT, "open")]]] }),
      })
    ).inject({ method: "POST", url: `/api/v1/defects/${DEFECT}/recheck`, payload: { result: "pass" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("404s for a defect outside the tenant", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[defects, []]] }),
      })
    ).inject({ method: "POST", url: `/api/v1/defects/${DEFECT}/recheck`, payload: { result: "pass" } });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /acceptance-center — the C3 period queue (Wave-0 period slice)
// ---------------------------------------------------------------------------

describe("GET /api/v1/acceptance-center", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/acceptance-center" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the period queue (delivered|inspecting|rejected) by default, company_id bound", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[workPeriods, [period("p1", "delivered"), period("p2", "rejected")]]],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/acceptance-center" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(2);
    const read = captured.find((c) => c.table === workPeriods);
    // the queue statuses AND the tenant company_id are bound on the scoped read.
    const params = paramsOf(read!.where);
    expect(params).toContain(COMPANY);
    expect(params).toEqual(expect.arrayContaining(["delivered", "inspecting", "rejected"]));
  });

  it("?status narrows the queue to a single status", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[workPeriods, [period("p1", "delivered")]]], captured }),
      })
    ).inject({ url: "/api/v1/acceptance-center?status=delivered" });
    const read = captured.find((c) => c.table === workPeriods);
    const params = paramsOf(read!.where);
    expect(params).toContain("delivered");
    expect(params).not.toContain("rejected");
  });

  it("?status outside the queue → honest empty (no scan)", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[workPeriods, [period("p1", "delivered")]]], captured }),
      })
    ).inject({ url: "/api/v1/acceptance-center?status=passed" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
    expect(captured.find((c) => c.table === workPeriods)).toBeFalsy(); // no query ran
  });

  it("?type=gr and ?type=house are the Wave-3 fan-in — honest empty", async () => {
    for (const type of ["gr", "house"]) {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({ rows: [[workPeriods, [period("p1", "delivered")]]] }),
        })
      ).inject({ url: `/api/v1/acceptance-center?type=${type}` });
      expect(res.statusCode).toBe(200);
      expect(res.json().total).toBe(0);
    }
  });
});

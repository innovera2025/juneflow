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
  apBillings,
  retentionLedgers,
  grs,
  pmWorkOrders,
  pmAssets,
  pmContracts,
  pos,
  wos,
  prs,
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
  /** Counts transaction() invocations — proves multi-write atomicity (one tx). */
  tx?: { count: number };
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
  // inside a tx still capture into inserted/updated/captured (no real BEGIN). The
  // optional tx spy counts invocations so a test can prove one-transaction atomicity.
  raw.transaction = (cb: (tx: unknown) => unknown) => {
    if (opts.tx) opts.tx.count += 1;
    return cb(raw);
  };
  return raw as unknown as Db;
}

function paramsOf(where: SQL | undefined): unknown[] {
  if (!where) return [];
  return new PgDialect().sqlToQuery(where).params;
}

/** The lowercased SQL text of a where clause — for asserting param-less
 * predicates (e.g. `... is null`) that never surface in paramsOf(). */
function sqlOf(where: SQL | undefined): string {
  if (!where) return "";
  return new PgDialect().sqlToQuery(where).sql.toLowerCase();
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

// Wave-3 fan-in stub rows (pm work order · goods receipt) — real columns only.
const ASSET = "a5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5";
const TEMPLATE = "7e7e7e7e-7e7e-7e7e-7e7e-7e7e7e7e7e7e";

const pmWorkOrder = (id: string, customerSign: string | null) => ({
  id,
  assetId: ASSET,
  templateId: TEMPLATE,
  tech: "ช่างวิรัตน์ ส.",
  checkinGps: "13.7,100.5",
  items: [] as unknown[],
  cause: null as string | null,
  fix: null as string | null,
  advice: null as string | null,
  customerSign,
  createdAt: D,
  updatedAt: D,
});

const gr = (
  id: string,
  rejected: number,
  opts: { poId?: string | null; woId?: string | null; no?: string } = {},
) => ({
  id,
  poId: opts.poId ?? "88888888-8888-8888-8888-888888888888",
  woId: opts.woId ?? null,
  no: opts.no ?? "GR-2569-0448",
  received: "100",
  rejected: String(rejected),
  photos: [] as string[],
  status: "received",
  createdAt: D,
  updatedAt: D,
});

// META-1 (P2-BE-43) enrichment stub rows — only the columns the enrichment reads
// (id + the join FK + the display source). project_name resolves through these to
// `project.name` ("juneflow ราชพฤกษ์"), the tenant-scoped root.
const PM_CONTRACT = "c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1";
const PO = "90909090-9090-9090-9090-909090909090";
const PR = "70707070-7070-7070-7070-707070707070";

/** pm_asset — name is nullable (pre-migration-0034 rows); kind is the fallback. */
const pmAsset = (name: string | null = "ปั๊มดับเพลิง A") => ({
  id: ASSET,
  contractId: PM_CONTRACT,
  name,
  kind: "ปั๊ม",
});
const pmContract = { id: PM_CONTRACT, projectId: PROJECT };
const po = { id: PO, prId: PR };
const pr = { id: PR, projectId: PROJECT };

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

  it("pass: carries a `warning` advisory field (null-or-string, never a 403); null when nothing lags", async () => {
    const P = period(PERIOD, "delivered", "percent");
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[workPeriods, [P]], [subconContracts, [contract(CONTRACT, "WO-1")]], [projects, [project]]],
          updateBase: P,
        }),
      })
    ).inject({ method: "POST", url: `/api/v1/periods/${PERIOD}/inspect`, payload: { result: "pass" } });
    expect(res.statusCode).toBe(200); // advisory NEVER changes the status code
    const body = res.json();
    expect(body).toHaveProperty("warning");
    expect(body.warning).toBeNull(); // a single period has nothing to lag behind
  });

  it("pass: flags `accepted_ahead_of_progress` when an earlier percent period is not yet passed — still 200", async () => {
    // target = seq 2 (pct 30%) accepted while seq 1 (pct 20%) is still pending: the
    // cumulative target (50%) overshoots the recorded progress (30%) → advisory.
    const target = { ...period(PERIOD, "delivered", "percent", 2), pct: "30.000" };
    const earlier = { ...period("p-earlier", "pending", "percent", 1), pct: "20.000" };
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[workPeriods, [target, earlier]], [subconContracts, [contract(CONTRACT, "WO-1")]], [projects, [project]]],
          updateBase: target,
        }),
      })
    ).inject({ method: "POST", url: `/api/v1/periods/${PERIOD}/inspect`, payload: { result: "pass" } });
    expect(res.statusCode).toBe(200); // an advisory NEVER blocks the pass
    expect(res.json().warning).toBe("accepted_ahead_of_progress");
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
// POST /periods/:id/approve-payment — Wave-2: SERVER-computed money + retention
// (B-107a) → AP billing + retention-ledger HELD + period → paid (one tx). The
// %-gate is an honest, never-blocking advisory (B-107c). All money is asserted
// against the SERVER formula, never a client-supplied amount.
// ---------------------------------------------------------------------------

describe("POST /api/v1/periods/:id/approve-payment", () => {
  const url = `/api/v1/periods/${PERIOD}/approve-payment`;
  // A passed period per basis (the new migration-0033 money cols spread on top of
  // the Wave-0 factory). contract = value 2,150,000 · retention 10%.
  const passedPercent = { ...period(PERIOD, "passed", "percent"), pct: "20.000" };
  const passedDistance = {
    ...period(PERIOD, "passed", "distance"),
    perPeriodQty: "100.0000",
    ratePerUnit: "1000.00",
    amount: "555555.00", // a DECOY stored amount — the server must use qty × rate.
  };
  const passedUnit = {
    ...period(PERIOD, "passed", "unit"),
    perPeriodQty: "2.0000",
    ratePerUnit: "250000.00",
    amount: "9.00", // decoy — server uses qty × rate.
  };
  const passedMilestone = { ...period(PERIOD, "passed", "milestone"), amount: "375000.00" };

  const withPeriod = (
    p: Record<string, unknown>,
    extra: Partial<StubOpts> = {},
  ): StubOpts => ({
    rows: [[workPeriods, [p]], [subconContracts, [contract(CONTRACT, "WO-1")]]],
    updateBase: p,
    ...extra,
  });

  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ method: "POST", url, payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it("404s for a period outside the tenant (no writes, binds company_id)", async () => {
    const inserted: Inserted[] = [];
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[workPeriods, []]], inserted, captured }),
      })
    ).inject({ method: "POST", url, payload: {} });
    expect(res.statusCode).toBe(404);
    expect(inserted).toHaveLength(0);
    const read = captured.find((c) => c.table === workPeriods);
    expect(paramsOf(read!.where)).toContain(COMPANY);
    expect(paramsOf(read!.where)).not.toContain(OTHER_COMPANY);
  });

  it("409s (INVALID_STATE) unless the period is `passed` — pending/delivered/... write nothing", async () => {
    for (const status of ["pending", "delivered", "inspecting", "rejected", "paid"] as const) {
      const inserted: Inserted[] = [];
      const updated: Updated[] = [];
      const tx = { count: 0 };
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb(withPeriod(period(PERIOD, status), { inserted, updated, tx })),
        })
      ).inject({ method: "POST", url, payload: {} });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("INVALID_STATE");
      expect(inserted).toHaveLength(0); // no ap_billing / retention_ledger write
      expect(updated).toHaveLength(0); // no status flip
      expect(tx.count).toBe(0); // never entered the transaction
    }
  });

  it("percent basis: gross = (pct/100)×contract.value, SERVER-computed — a client `amount` is IGNORED", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(withPeriod(passedPercent, { inserted })),
      })
    ).inject({ method: "POST", url, payload: { amount: 99_999_999 } }); // bogus client amount
    expect(res.statusCode).toBe(200);
    // 20% of 2,150,000 = 430,000 — the bogus client amount is never read.
    expect((inserted.find((w) => w.table === apBillings)!.rows[0] as { amount: string }).amount).toBe("430000.00");
    expect(res.json().gross).toBe(430000);
    expect(res.json().basis).toBe("percent");
  });

  it("distance basis: gross = perPeriodQty × ratePerUnit (not the stored amount)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(withPeriod(passedDistance, { inserted })),
      })
    ).inject({ method: "POST", url, payload: { amount: 1 } });
    expect(res.statusCode).toBe(200);
    // 100 × 1,000 = 100,000 — NOT the decoy stored amount 555,555.
    expect((inserted.find((w) => w.table === apBillings)!.rows[0] as { amount: string }).amount).toBe("100000.00");
    expect(res.json().gross).toBe(100000);
  });

  it("unit basis: gross = perPeriodQty × ratePerUnit (not the stored amount)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(withPeriod(passedUnit, { inserted })),
      })
    ).inject({ method: "POST", url, payload: {} });
    expect(res.statusCode).toBe(200);
    // 2 × 250,000 = 500,000 — NOT the decoy stored amount 9.
    expect((inserted.find((w) => w.table === apBillings)!.rows[0] as { amount: string }).amount).toBe("500000.00");
    expect(res.json().gross).toBe(500000);
  });

  it("milestone basis: gross = the period's stored fixed `amount`", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(withPeriod(passedMilestone, { inserted })),
      })
    ).inject({ method: "POST", url, payload: { amount: 0 } });
    expect(res.statusCode).toBe(200);
    expect((inserted.find((w) => w.table === apBillings)!.rows[0] as { amount: string }).amount).toBe("375000.00");
    expect(res.json().gross).toBe(375000);
  });

  it("splits retention: ap_billing.retention == gross×retention_pct/100 AND a HELD retention_ledger row is written", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(withPeriod(passedPercent, { inserted })),
      })
    ).inject({ method: "POST", url, payload: {} });
    expect(res.statusCode).toBe(200);
    const bill = inserted.find((w) => w.table === apBillings)!.rows[0] as { amount: string; retention: string; status: string };
    expect(bill.amount).toBe("430000.00");
    expect(bill.retention).toBe("43000.00"); // 10% of 430,000
    expect(bill.status).toBe("draft");
    const led = inserted.find((w) => w.table === retentionLedgers)!.rows[0] as {
      withheld: string; returned: string; status: string; contractId: string; rate: string;
    };
    expect(led.withheld).toBe("43000.00");
    expect(led.returned).toBe("0");
    expect(led.status).toBe("held");
    expect(led.contractId).toBe(CONTRACT);
    expect(led.rate).toBe("10.000");
    const body = res.json();
    expect(body.retention).toBe(43000);
    expect(body.net).toBe(387000); // gross − retention
    expect(body.currency_code).toBe("THB");
    expect(body.ap_billing_id).toBeTruthy();
  });

  it("flips the period status → `paid` (scoped chain update)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(withPeriod(passedMilestone, { updated })),
      })
    ).inject({ method: "POST", url, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("paid");
    expect(updated.find((u) => u.table === workPeriods)!.set.status).toBe("paid");
  });

  it("writes the AP billing + retention ledger + status flip in ONE transaction (atomic)", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const tx = { count: 0 };
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(withPeriod(passedPercent, { inserted, updated, tx })),
      })
    ).inject({ method: "POST", url, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(tx.count).toBe(1); // exactly one transaction wraps all three writes
    expect(inserted.find((w) => w.table === apBillings)).toBeTruthy();
    expect(inserted.find((w) => w.table === retentionLedgers)).toBeTruthy();
    expect(updated.find((u) => u.table === workPeriods)!.set.status).toBe("paid");
  });

  it("returns an advisory `warning` field (null-or-string), never a 403; null when nothing lags", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(withPeriod(passedPercent)),
      })
    ).inject({ method: "POST", url, payload: {} });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("warning");
    expect(body.warning).toBeNull();
  });

  it("advisory flags `accepted_ahead_of_progress` when an earlier period is unpaid — still 200 (never blocks)", async () => {
    const target = { ...period(PERIOD, "passed", "percent", 2), pct: "30.000" };
    const earlier = { ...period("p-earlier", "pending", "percent", 1), pct: "20.000" };
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[workPeriods, [target, earlier]], [subconContracts, [contract(CONTRACT, "WO-1")]]],
          updateBase: target,
        }),
      })
    ).inject({ method: "POST", url, payload: {} });
    expect(res.statusCode).toBe(200); // an advisory NEVER changes the status code
    expect(res.json().warning).toBe("accepted_ahead_of_progress");
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

  it("an unknown ?type falls through to the period queue (Wave-0 shape)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[workPeriods, [period("p1", "delivered")]]] }),
      })
    ).inject({ url: "/api/v1/acceptance-center?type=bogus" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(1); // the delivered period is still queued
  });
});

// ---------------------------------------------------------------------------
// GET /acceptance-center — Wave-3 fan-in (B-107e): the pm / house / gr slices.
// Each is tenant-scoped through the project.company_id root (subcon/pm/gr rows
// carry NO company_id — a bare read would be a tenant hole), returns the B-014
// envelope, and is honest-empty when its feed has no matching rows (C10 — never
// fabricated). Rows come from the stub; no value is hand-computed.
// ---------------------------------------------------------------------------

describe("GET /api/v1/acceptance-center — Wave-3 fan-in (pm/house/gr)", () => {
  it("401s flat for every slice type without a session (fail closed)", async () => {
    for (const type of ["pm", "house", "gr"]) {
      const res = await (await buildTestApp()).inject({
        url: `/api/v1/acceptance-center?type=${type}`,
      });
      expect(res.statusCode).toBe(401);
    }
  });

  // --- pm slice: pm_workorder awaiting close (customer_sign IS NULL) ---------

  it("?type=pm returns unsigned work orders (company_id bound on the 3-hop read)", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pmWorkOrders, [pmWorkOrder("w1", null)]]], captured }),
      })
    ).inject({ url: "/api/v1/acceptance-center?type=pm" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    const w = body.data[0];
    expect(w.type).toBe("pm");
    expect(w.asset_id).toBe(ASSET);
    expect(w.template_id).toBe(TEMPLATE);
    expect(w.tech).toBe("ช่างวิรัตน์ ส.");
    expect(w.checkin_gps).toBe("13.7,100.5");
    // the pm_workorder → pm_asset → pm_contract → project read anchors company_id.
    const read = captured.find((c) => c.table === pmWorkOrders);
    expect(read).toBeTruthy();
    expect(paramsOf(read!.where)).toContain(COMPANY);
    expect(paramsOf(read!.where)).not.toContain(OTHER_COMPANY);
  });

  it("?type=pm filters to customer_sign IS NULL (a signed WO can never enter the queue)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pmWorkOrders, [pmWorkOrder("w1", null)]]], captured }),
      })
    ).inject({ url: "/api/v1/acceptance-center?type=pm" });
    const read = captured.find((c) => c.table === pmWorkOrders);
    const sql = sqlOf(read!.where);
    expect(sql).toContain("customer_sign");
    expect(sql).toContain("is null");
  });

  it("?type=pm honest-empty when every work order is already signed/closed", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pmWorkOrders, []]] }),
      })
    ).inject({ url: "/api/v1/acceptance-center?type=pm" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
  });

  // --- house slice: the FINAL (max-seq) work period per contract, unpaid ------

  it("?type=house returns only the max-seq period of a contract (tagged type=house), company bound", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            // deliberately out of order — the max-seq (3), not the last element, wins.
            [workPeriods, [
              period("p2", "delivered", "percent", 2),
              period("p3", "rejected", "percent", 3),
              period("p1", "delivered", "percent", 1),
            ]],
          ],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/acceptance-center?type=house" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1); // one contract → its single final period
    expect(body.data[0].seq).toBe(3);
    expect(body.data[0].type).toBe("house");
    const read = captured.find((c) => c.table === workPeriods);
    expect(paramsOf(read!.where)).toContain(COMPANY);
    expect(paramsOf(read!.where)).not.toContain(OTHER_COMPANY);
  });

  it("?type=house groups per contract — each contract's final awaiting period comes back", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [workPeriods, [
              { ...period("a1", "delivered", "percent", 1), contractId: "c-a" },
              { ...period("a2", "delivered", "percent", 2), contractId: "c-a" },
              { ...period("b1", "rejected", "percent", 5), contractId: "c-b" },
            ]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/acceptance-center?type=house" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2); // c-a final (seq 2) + c-b final (seq 5)
    expect(body.data.map((r: { seq: number }) => r.seq).sort()).toEqual([2, 5]);
  });

  it("?type=house excludes a contract whose final period is already paid (handed-over-and-done)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [workPeriods, [
              period("p1", "paid", "percent", 1),
              period("p2", "paid", "percent", 2),
              period("p3", "paid", "percent", 3), // final = paid → excluded
            ]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/acceptance-center?type=house" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
  });

  it("?type=house honest-empty when there are no periods", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[workPeriods, []]] }),
      })
    ).inject({ url: "/api/v1/acceptance-center?type=house" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
  });

  // --- gr slice: goods receipts with a rejected quantity (rejected > 0) -------

  it("?type=gr returns only receipts with rejected>0 (tagged type=gr), company bound on BOTH chains", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[grs, [gr("g1", 8), gr("g2", 0)]]],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/acceptance-center?type=gr" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1); // g1 (rejected 8) queued; g2 (rejected 0) excluded
    const g = body.data[0];
    expect(g.id).toBe("g1");
    expect(g.type).toBe("gr");
    expect(g.rejected).toBe(8);
    expect(g.no).toBe("GR-2569-0448");
    // a gr anchors on EITHER a po or a wo → the two chains each bind company_id.
    const grReads = captured.filter((c) => c.table === grs);
    expect(grReads).toHaveLength(2); // po chain + wo chain
    for (const read of grReads) {
      expect(paramsOf(read.where)).toContain(COMPANY);
      expect(paramsOf(read.where)).not.toContain(OTHER_COMPANY);
    }
  });

  it("?type=gr honest-empty when no receipt carries a rejected quantity", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[grs, [gr("g1", 0)]]] }),
      })
    ).inject({ url: "/api/v1/acceptance-center?type=gr" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// META-1 (P2-BE-43) display enrichment — the acceptance-center rows + the
// periods list gain the prototype (company-accept.jsx ACCEPT_ITEMS) display
// columns that have a REAL source: project_name (resolved THROUGH the scoped
// join to project.name), a composed title, owner (pm.tech only), and the
// rejected-period defect items. The sourceless cols (overdue / wait_days /
// due_text / docs_count) are honest-empty = ABSENT (Wei · C10 — never
// fabricated). Every enrichment join is asserted tenant-scoped (COMPANY bound,
// no OTHER_COMPANY leak). Rows come from the stub — no value is hand-computed.
// ---------------------------------------------------------------------------

describe("GET /api/v1 acceptance-center + periods — META-1 display enrichment", () => {
  // The display cols with NO honest server source must never appear on any wire.
  const ABSENT = ["overdue", "wait_days", "due_text", "docs_count"];
  const expectAbsent = (row: Record<string, unknown>): void => {
    for (const k of ABSENT) expect(row).not.toHaveProperty(k);
  };
  const rowsOf = (res: { json(): unknown }): Array<Record<string, unknown>> =>
    (res.json() as { data: Array<Record<string, unknown>> }).data;
  const boundOn = (captured: Captured[], tables: unknown[]): void => {
    for (const table of tables) {
      const read = captured.find((c) => c.table === table);
      expect(read).toBeTruthy();
      expect(paramsOf(read!.where)).toContain(COMPANY);
      expect(paramsOf(read!.where)).not.toContain(OTHER_COMPANY);
    }
  };

  // --- period slice (default) ------------------------------------------------

  it("period slice: project_name + composed title + owner null + defect text; new joins company-scoped", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [workPeriods, [period("p1", "delivered", "percent", 1), period("p2", "rejected", "percent", 2)]],
            [subconContracts, [contract(CONTRACT, "WO-1")]],
            [projects, [project]],
            [acceptances, [acceptance(ACCEPTANCE, "p2")]], // p2's acceptance carries the defect
            [defects, [defect(DEFECT, "open")]],
          ],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/acceptance-center" });
    expect(res.statusCode).toBe(200);
    const data = rowsOf(res);
    expect(data).toHaveLength(2);
    const p1 = data.find((r) => r.id === "p1")!;
    const p2 = data.find((r) => r.id === "p2")!;
    // project_name resolved contract → project (real project.name)
    expect(p1.project_name).toBe("juneflow ราชพฤกษ์");
    expect(p2.project_name).toBe("juneflow ราชพฤกษ์");
    // title composed from the REAL contract.no + seq (exact strings)
    expect(p1.title).toBe("WO-1");
    expect(p2.title).toBe("WO-1");
    // a work period has no owner column → honest null on every period row
    expect(p1.owner).toBeNull();
    expect(p2.owner).toBeNull();
    // the rejected period surfaces its defect item; a non-rejected period is null
    expect(p2.defect).toEqual(["ฉาบผนัง B-06 เป็นคลื่น"]);
    expect(p1.defect).toBeNull();
    // the sourceless display cols are ABSENT (honest-empty regression)
    expectAbsent(p1);
    expectAbsent(p2);
    // every new enrichment join binds this tenant, never the other company
    boundOn(captured, [projects, subconContracts, acceptances, defects]);
  });

  it("defect is null on a rejected period with no recorded defects (honest, not fabricated)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [workPeriods, [period("p2", "rejected", "percent", 2)]],
            [subconContracts, [contract(CONTRACT, "WO-1")]],
            [projects, [project]],
            [acceptances, []],
            [defects, []],
          ],
        }),
      })
    ).inject({ url: "/api/v1/acceptance-center" });
    expect(res.statusCode).toBe(200);
    expect(rowsOf(res)[0]!.defect).toBeNull();
  });

  it("project_name + title are null (never a crash) when the contract hop does not resolve", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [workPeriods, [period("p1", "delivered", "percent", 1)]],
            [subconContracts, []], // contract not in this tenant's set → unresolved hop
            [projects, [project]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/acceptance-center" });
    expect(res.statusCode).toBe(200);
    const r = rowsOf(res)[0]!;
    expect(r.project_name).toBeNull();
    expect(r.title).toBeNull();
  });

  // --- pm slice --------------------------------------------------------------

  it("pm slice: project_name (asset→contract→project) + composed title + owner=tech; joins company-scoped", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pmWorkOrders, [pmWorkOrder("w1", null)]],
            [pmAssets, [pmAsset()]],
            [pmContracts, [pmContract]],
            [projects, [project]],
          ],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/acceptance-center?type=pm" });
    expect(res.statusCode).toBe(200);
    const w = rowsOf(res)[0]!;
    expect(w.project_name).toBe("juneflow ราชพฤกษ์");
    expect(w.title).toBe("ปั๊มดับเพลิง A · ปั๊ม");
    expect(w.owner).toBe("ช่างวิรัตน์ ส."); // the REAL pm_workorder.tech
    expectAbsent(w);
    boundOn(captured, [pmAssets, pmContracts, projects]);
  });

  it("pm slice: title falls back to kind when the asset name is null (no fabrication)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pmWorkOrders, [pmWorkOrder("w1", null)]],
            [pmAssets, [pmAsset(null)]], // pre-0034 asset with no name
            [pmContracts, [pmContract]],
            [projects, [project]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/acceptance-center?type=pm" });
    expect(rowsOf(res)[0]!.title).toBe("ปั๊ม · ปั๊ม");
  });

  // --- house slice -----------------------------------------------------------

  it("house slice: project_name + composed title on the final period; owner null, no defect key", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [workPeriods, [period("p1", "delivered", "percent", 1), period("p3", "rejected", "percent", 3)]],
            [subconContracts, [contract(CONTRACT, "WO-1")]],
            [projects, [project]],
          ],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/acceptance-center?type=house" });
    expect(res.statusCode).toBe(200);
    const h = rowsOf(res)[0]!;
    expect(h.seq).toBe(3); // the max-seq final period
    expect(h.type).toBe("house");
    expect(h.project_name).toBe("juneflow ราชพฤกษ์");
    expect(h.title).toBe("WO-1");
    expect(h.owner).toBeNull();
    expect(h).not.toHaveProperty("defect"); // a handover carries no defect column
    expectAbsent(h);
    boundOn(captured, [subconContracts, projects]);
  });

  // --- gr slice --------------------------------------------------------------

  it("gr slice: project_name (po→pr→project) + title=gr.no + owner null; po/wo/pr joins company-scoped", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [grs, [gr("g1", 8, { poId: PO })]],
            [pos, [po]],
            [wos, []],
            [prs, [pr]],
            [projects, [project]],
          ],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/acceptance-center?type=gr" });
    expect(res.statusCode).toBe(200);
    const g = rowsOf(res)[0]!;
    expect(g.project_name).toBe("juneflow ราชพฤกษ์");
    expect(g.title).toBe("GR-2569-0448"); // the REAL gr.no
    expect(g.owner).toBeNull();
    expect(g).not.toHaveProperty("defect");
    expectAbsent(g);
    boundOn(captured, [pos, wos, prs, projects]);
  });

  it("gr slice: project_name null when neither po nor wo resolves; title still the real gr.no", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [grs, [gr("g1", 8, { poId: PO })]],
            [pos, []], // po unresolved → no pr → no project
            [wos, []],
            [prs, []],
            [projects, [project]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/acceptance-center?type=gr" });
    const g = rowsOf(res)[0]!;
    expect(g.project_name).toBeNull();
    expect(g.title).toBe("GR-2569-0448");
  });

  // --- periods list (GET /subcon-contracts/:id/periods) ----------------------

  it("periods list: each period gains project_name + title + defect; new joins company-scoped", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [subconContracts, [contract(CONTRACT, "WO-1")]],
            [workPeriods, [period("p1", "delivered", "percent", 1), period("p2", "rejected", "percent", 2)]],
            [projects, [project]],
            [acceptances, [acceptance(ACCEPTANCE, "p2")]],
            [defects, [defect(DEFECT, "open")]],
          ],
          captured,
        }),
      })
    ).inject({ url: `/api/v1/subcon-contracts/${CONTRACT}/periods` });
    expect(res.statusCode).toBe(200);
    const data = rowsOf(res); // sorted by seq
    const r1 = data[0]!;
    const r2 = data[1]!;
    expect(r1.project_name).toBe("juneflow ราชพฤกษ์");
    expect(r1.title).toBe("WO-1");
    expect(r1.owner).toBeNull();
    expect(r1.defect).toBeNull();
    expect(r2.title).toBe("WO-1");
    expect(r2.defect).toEqual(["ฉาบผนัง B-06 เป็นคลื่น"]);
    expectAbsent(r1);
    expectAbsent(r2);
    boundOn(captured, [projects, acceptances, defects]);
  });
});

// G3 unit tests (PLAN.md §9) — PM / CMMS Wave-0 handlers (Phase-4 FLOW-C; pm.jsx
// PMAssets/PMAssetForm, pm-checklist.jsx ChecklistManager/ChecklistEditor, pm3.jsx
// PMWorkOrders/PMWOForm + check-in + checklist fill). Covers the B-014 list
// envelope, create shapes, the template→work-order items SNAPSHOT, check-in,
// checklist positional fill, and — crucially — tenant scope: every read is bound
// on company_id (checklist_template DIRECTLY; pm_asset/pm_workorder THROUGH their
// project-root hop chains), a foreign contract/asset/WO id resolves to nothing
// (→ 404, never written), and AuditLog fires on a successful mutation but NOT on
// a failed guard. All values come from the stubbed rows — nothing is hand-computed
// against the impl.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  checklistTemplates,
  pmAssets,
  pmContracts,
  pmWorkOrders,
  projects,
} from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import type { AuditRecord } from "../plugins/audit-log.js";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const OTHER_COMPANY = "33333333-3333-3333-3333-333333333333";
const PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CONTRACT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ASSET = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const TEMPLATE = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const WO = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const D = new Date(1_700_000_000_000);

const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย" },
};

// --- join-aware capturing stub Db: records every read (table + join hops +
// WHERE predicate), every inserted row set, and every update (set + where). The
// select projection (insertThrough's `.select({id})`) is ignored — the door only
// checks the owned-parent row count.
interface Captured {
  table: unknown;
  joins: unknown[];
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

function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [], updated = [], updateBase = {} } = opts;
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  const builderFor = (table: unknown) => {
    const joins: unknown[] = [];
    const builder = {
      $dynamic: () => builder,
      innerJoin: (parent: unknown) => {
        joins.push(parent);
        return builder;
      },
      where: (where: SQL) => {
        captured.push({ table, joins, where });
        return Promise.resolve(rowsFor(table));
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) => {
        captured.push({ table, joins, where: undefined });
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
// Row factories (stub-backed — transcribe the real schema columns)
// ---------------------------------------------------------------------------

const projectRow = { id: PROJECT, companyId: COMPANY, name: "juneflow ราชพฤกษ์" };

const contractRow = {
  id: CONTRACT,
  projectId: PROJECT,
  customerId: null,
  mode: "MA",
  visitsPerYear: 12,
  sla: "4 ชม.",
  value: "144000.00",
  currencyCode: "THB",
  end: "2026-12-31",
  createdAt: D,
  updatedAt: D,
};

const assetRow = (over: Record<string, unknown> = {}) => ({
  id: ASSET,
  contractId: CONTRACT,
  kind: "ลิฟต์",
  site: "อาคาร A · โถงกลาง",
  cycle: "รายเดือน",
  nextDue: "2026-06-20",
  createdAt: D,
  updatedAt: D,
  ...over,
});

// checklist_template.items are check LABELS (data-dictionary / pm-checklist.jsx).
const templateItems = [
  { label: "ตรวจระบบเบรกและมอเตอร์ฉุดลาก" },
  { label: "ตรวจสลิง/ลวดสลิงและความตึง" },
  { label: "ทดสอบปุ่มฉุกเฉิน + อินเตอร์คอม" },
];
const templateRow = {
  id: TEMPLATE,
  companyId: COMPANY,
  kind: "ลิฟต์",
  items: templateItems,
  createdAt: D,
  updatedAt: D,
};

const woRow = (over: Record<string, unknown> = {}) => ({
  id: WO,
  assetId: ASSET,
  templateId: null,
  tech: "ช่างสมพงษ์ ก.",
  checkinGps: null,
  items: [] as unknown[],
  cause: null,
  fix: null,
  advice: null,
  customerSign: null,
  createdAt: D,
  updatedAt: D,
  ...over,
});

// ===========================================================================
// GET /pm/assets
// ===========================================================================

describe("GET /api/v1/pm/assets", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/pm/assets" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("wraps assets in the B-014 envelope with the real-column wire shape", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pmAssets, [assetRow()]]] }),
      })
    ).inject({ url: "/api/v1/pm/assets" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [
        {
          id: ASSET,
          contract_id: CONTRACT,
          kind: "ลิฟต์",
          site: "อาคาร A · โถงกลาง",
          cycle: "รายเดือน",
          next_due: "2026-06-20",
        },
      ],
      page: 1,
      page_size: 50,
      total: 1,
    });
  });

  it("reads pm_asset THROUGH pm_contract→project, bound to company_id (no leak)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pmAssets, [assetRow()]]], captured }),
      })
    ).inject({ url: "/api/v1/pm/assets" });
    const read = captured.find((c) => c.table === pmAssets)!;
    expect(read.joins).toEqual([pmContracts, projects]); // 2-hop chain to the root
    expect(paramsOf(read.where)).toContain(COMPANY);
    expect(paramsOf(read.where)).not.toContain(OTHER_COMPANY);
  });

  it("binds a different tenant's OWN company_id (tenant isolation)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => ({
          companyId: OTHER_COMPANY,
          user: { id: "au-9", email: "other@x.co.th", name: "อื่น" },
        }),
        db: stubDb({ rows: [[pmAssets, [assetRow()]]], captured }),
      })
    ).inject({ url: "/api/v1/pm/assets" });
    const read = captured.find((c) => c.table === pmAssets)!;
    expect(paramsOf(read.where)).toContain(OTHER_COMPANY);
    expect(paramsOf(read.where)).not.toContain(COMPANY);
  });
});

// ===========================================================================
// POST /pm/assets
// ===========================================================================

describe("POST /api/v1/pm/assets", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/pm/assets",
      payload: { contract_id: CONTRACT, kind: "ลิฟต์" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates an asset (201) anchored on the contract's project, echoing the wire", async () => {
    const captured: Captured[] = [];
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pmContracts, [contractRow]],
            [projects, [projectRow]],
          ],
          captured,
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pm/assets",
      payload: {
        contract_id: CONTRACT,
        kind: "ลิฟต์",
        site: "อาคาร A · โถงกลาง",
        cycle: "รายเดือน",
        next_due: "2026-06-20",
      },
    });
    expect(res.statusCode).toBe(201);
    // The write carries exactly the schema columns (no invented fields).
    const write = inserted.find((w) => w.table === pmAssets)!;
    expect(write.rows[0]).toEqual({
      contractId: CONTRACT,
      kind: "ลิฟต์",
      site: "อาคาร A · โถงกลาง",
      cycle: "รายเดือน",
      nextDue: "2026-06-20",
    });
    expect(res.json()).toMatchObject({
      contract_id: CONTRACT,
      kind: "ลิฟต์",
      site: "อาคาร A · โถงกลาง",
      cycle: "รายเดือน",
      next_due: "2026-06-20",
    });
    // The contract was resolved THROUGH its project root, and the insertThrough
    // parent verify hit project — both bound on company_id.
    const contractRead = captured.find((c) => c.table === pmContracts)!;
    expect(contractRead.joins).toEqual([projects]);
    expect(paramsOf(contractRead.where)).toContain(COMPANY);
    const parentVerify = captured.filter(
      (c) => c.table === projects && paramsOf(c.where).includes(PROJECT),
    );
    expect(parentVerify.length).toBeGreaterThan(0);
    for (const call of parentVerify) expect(paramsOf(call.where)).toContain(COMPANY);
  });

  it("400s on a missing contract_id", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [] }) })
    ).inject({ method: "POST", url: "/api/v1/pm/assets", payload: { kind: "ลิฟต์" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("contract_id");
  });

  it("400s on a missing kind", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pmContracts, [contractRow]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/pm/assets", payload: { contract_id: CONTRACT } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("kind");
  });

  it("404s + writes nothing for a foreign contract_id (scoped read finds nothing)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        // No pm_contract canned → the scoped read resolves nothing, exactly what a
        // foreign tenant's contract looks like through the scoped door.
        db: stubDb({ rows: [], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pm/assets",
      payload: { contract_id: CONTRACT, kind: "ลิฟต์" },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    expect(inserted).toHaveLength(0);
  });
});

// ===========================================================================
// GET /pm/checklist-templates + POST
// ===========================================================================

describe("GET /api/v1/pm/checklist-templates", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/pm/checklist-templates" });
    expect(res.statusCode).toBe(401);
  });

  it("wraps templates in the B-014 envelope (id/kind/items) — DIRECT company scope", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[checklistTemplates, [templateRow]]], captured }),
      })
    ).inject({ url: "/api/v1/pm/checklist-templates" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [{ id: TEMPLATE, kind: "ลิฟต์", items: templateItems }],
      page: 1,
      page_size: 50,
      total: 1,
    });
    // checklist_template carries company_id → read DIRECTLY (no join hops).
    const read = captured.find((c) => c.table === checklistTemplates)!;
    expect(read.joins).toEqual([]);
    expect(paramsOf(read.where)).toContain(COMPANY);
  });
});

describe("POST /api/v1/pm/checklist-templates", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/pm/checklist-templates",
      payload: { kind: "ลิฟต์", items: ["a"] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates a template (201), normalizing string items → {label} rows", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pm/checklist-templates",
      payload: { kind: "ลิฟต์", items: ["ตรวจเบรก", "  ", "ตรวจสลิง"] },
    });
    expect(res.statusCode).toBe(201);
    const write = inserted.find((w) => w.table === checklistTemplates)!;
    // blank labels dropped; company_id force-set by the scoped insert door.
    expect(write.rows[0]).toMatchObject({
      kind: "ลิฟต์",
      items: [{ label: "ตรวจเบรก" }, { label: "ตรวจสลิง" }],
      companyId: COMPANY,
    });
    expect(res.json()).toEqual({
      id: "new-0",
      kind: "ลิฟต์",
      items: [{ label: "ตรวจเบรก" }, { label: "ตรวจสลิง" }],
    });
  });

  it("defaults kind to ทั่วไป when omitted (mock ChecklistEditor `kind || ทั่วไป`)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pm/checklist-templates",
      payload: { items: [{ label: "ตรวจทั่วไป" }] },
    });
    expect(res.statusCode).toBe(201);
    expect((inserted[0]!.rows[0] as { kind: string }).kind).toBe("ทั่วไป");
  });

  it("400s + writes nothing when the item set is empty (mock rejects an empty set)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pm/checklist-templates",
      payload: { kind: "ลิฟต์", items: ["   ", ""] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
    expect(inserted).toHaveLength(0);
  });
});

// ===========================================================================
// GET /pm/workorders
// ===========================================================================

describe("GET /api/v1/pm/workorders", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/pm/workorders" });
    expect(res.statusCode).toBe(401);
  });

  it("wraps work orders in the B-014 envelope with the real-column wire shape", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[pmWorkOrders, [woRow({ checkinGps: "13.8076, 100.4519", items: templateItems })]]],
        }),
      })
    ).inject({ url: "/api/v1/pm/workorders" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    expect(body.data[0]).toEqual({
      id: WO,
      asset_id: ASSET,
      template_id: null,
      tech: "ช่างสมพงษ์ ก.",
      checkin_gps: "13.8076, 100.4519",
      items: templateItems,
      cause: null,
      fix: null,
      advice: null,
      customer_sign: null,
    });
  });

  it("reads pm_workorder THROUGH pm_asset→pm_contract→project, bound to company_id", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pmWorkOrders, [woRow()]]], captured }),
      })
    ).inject({ url: "/api/v1/pm/workorders" });
    const read = captured.find((c) => c.table === pmWorkOrders)!;
    expect(read.joins).toEqual([pmAssets, pmContracts, projects]); // 3-hop chain
    expect(paramsOf(read.where)).toContain(COMPANY);
    expect(paramsOf(read.where)).not.toContain(OTHER_COMPANY);
  });
});

// ===========================================================================
// POST /pm/workorders — the template→WO items SNAPSHOT
// ===========================================================================

describe("POST /api/v1/pm/workorders", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/pm/workorders",
      payload: { asset_id: ASSET },
    });
    expect(res.statusCode).toBe(401);
  });

  it("SNAPSHOTS the chosen template's items into the new WO at create time", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pmAssets, [assetRow()]],
            [pmContracts, [contractRow]],
            [checklistTemplates, [templateRow]],
            [projects, [projectRow]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pm/workorders",
      payload: { asset_id: ASSET, template_id: TEMPLATE, tech: "ช่างสมพงษ์ ก." },
    });
    expect(res.statusCode).toBe(201);
    const write = inserted.find((w) => w.table === pmWorkOrders)!;
    const row = write.rows[0] as {
      assetId: string;
      templateId: string | null;
      tech: string | null;
      items: unknown;
    };
    expect(row.assetId).toBe(ASSET);
    expect(row.templateId).toBe(TEMPLATE);
    expect(row.tech).toBe("ช่างสมพงษ์ ก.");
    // The SNAPSHOT: the WO's items equal the template's items (copied at create).
    expect(row.items).toEqual(templateItems);
    // …and it is a real snapshot (a distinct array, not the template's reference).
    expect(row.items).not.toBe(templateItems);
    expect(res.json().items).toEqual(templateItems);
  });

  it("starts with an empty checklist when no template_id is given (honest [])", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pmAssets, [assetRow()]],
            [pmContracts, [contractRow]],
            [projects, [projectRow]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pm/workorders",
      payload: { asset_id: ASSET },
    });
    expect(res.statusCode).toBe(201);
    const write = inserted.find((w) => w.table === pmWorkOrders)!;
    expect((write.rows[0] as { items: unknown[] }).items).toEqual([]);
    expect((write.rows[0] as { templateId: string | null }).templateId).toBe(null);
  });

  it("400s on a missing asset_id", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [] }) })
    ).inject({ method: "POST", url: "/api/v1/pm/workorders", payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("asset_id");
  });

  it("404s + writes nothing for a foreign asset_id (scoped read finds nothing)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [], inserted }), // no pm_asset visible to this tenant
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pm/workorders",
      payload: { asset_id: ASSET, template_id: TEMPLATE },
    });
    expect(res.statusCode).toBe(404);
    expect(inserted).toHaveLength(0);
  });

  it("404s + writes nothing for a foreign template_id (company-scoped read finds nothing)", async () => {
    const captured: Captured[] = [];
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pmAssets, [assetRow()]],
            [pmContracts, [contractRow]],
            // No checklist_template canned → a foreign template id resolves to
            // nothing through the company-scoped door.
            [projects, [projectRow]],
          ],
          captured,
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pm/workorders",
      payload: { asset_id: ASSET, template_id: TEMPLATE },
    });
    expect(res.statusCode).toBe(404);
    expect(inserted).toHaveLength(0);
    // the template lookup was DIRECT company-scoped (no join, carried company_id).
    const templateRead = captured.find((c) => c.table === checklistTemplates)!;
    expect(templateRead.joins).toEqual([]);
    expect(paramsOf(templateRead.where)).toContain(COMPANY);
  });
});

// ===========================================================================
// POST /pm/workorders/:id/checkin
// ===========================================================================

describe("POST /api/v1/pm/workorders/:id/checkin", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: `/api/v1/pm/workorders/${WO}/checkin`,
      payload: { gps: "13.8076, 100.4519" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("records checkin_gps and returns the updated WO", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[pmWorkOrders, [woRow()]]],
          updated,
          updateBase: woRow(),
        }),
      })
    ).inject({
      method: "POST",
      url: `/api/v1/pm/workorders/${WO}/checkin`,
      payload: { gps: "13.8076, 100.4519" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().checkin_gps).toBe("13.8076, 100.4519");
    expect(updated[0]!.table).toBe(pmWorkOrders);
    expect(updated[0]!.set.checkinGps).toBe("13.8076, 100.4519");
  });

  it("resolves the WO THROUGH its 3-hop chain, bound to company_id", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pmWorkOrders, [woRow()]]], captured, updateBase: woRow() }),
      })
    ).inject({
      method: "POST",
      url: `/api/v1/pm/workorders/${WO}/checkin`,
      payload: { gps: "13.8, 100.4" },
    });
    const read = captured.find((c) => c.table === pmWorkOrders)!;
    expect(read.joins).toEqual([pmAssets, pmContracts, projects]);
    expect(paramsOf(read.where)).toContain(COMPANY);
  });

  it("400s on a missing gps", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pmWorkOrders, [woRow()]]] }),
      })
    ).inject({ method: "POST", url: `/api/v1/pm/workorders/${WO}/checkin`, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("gps");
  });

  it("404s for a WO outside the tenant (nothing resolves through the chain)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pmWorkOrders, []]], updated }), // WO invisible
      })
    ).inject({
      method: "POST",
      url: `/api/v1/pm/workorders/${WO}/checkin`,
      payload: { gps: "13.8, 100.4" },
    });
    expect(res.statusCode).toBe(404);
    expect(updated).toHaveLength(0);
  });
});

// ===========================================================================
// PUT /pm/workorders/:id/checklist
// ===========================================================================

describe("PUT /api/v1/pm/workorders/:id/checklist", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "PUT",
      url: `/api/v1/pm/workorders/${WO}/checklist`,
      payload: { items: [] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("merges results POSITIONALLY onto the snapshot labels and returns the WO", async () => {
    const snapshot = [
      { label: "ตรวจเบรก" },
      { label: "ตรวจสลิง" },
      { label: "ทดสอบปุ่มฉุกเฉิน" },
    ];
    const merged = [
      { label: "ตรวจเบรก", result: "normal" },
      { label: "ตรวจสลิง", result: "adjust", before: "before.jpg", after: "after.jpg" },
      { label: "ทดสอบปุ่มฉุกเฉิน" }, // result "none" → unchecked → omitted
    ];
    const updated: Updated[] = [];
    const woWithSnapshot = woRow({ templateId: TEMPLATE, items: snapshot });
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[pmWorkOrders, [woWithSnapshot]]],
          updated,
          updateBase: woWithSnapshot,
        }),
      })
    ).inject({
      method: "PUT",
      url: `/api/v1/pm/workorders/${WO}/checklist`,
      payload: {
        items: [
          { result: "normal" },
          { result: "adjust", before: "before.jpg", after: "after.jpg" },
          { result: "none" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    // The stored items keep the snapshot labels + the filled result/photos.
    expect(updated[0]!.set.items).toEqual(merged);
    expect(res.json().items).toEqual(merged);
  });

  it("400s + updates nothing when items[] is missing", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pmWorkOrders, [woRow()]]], updated }),
      })
    ).inject({ method: "PUT", url: `/api/v1/pm/workorders/${WO}/checklist`, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("items");
    expect(updated).toHaveLength(0);
  });

  it("404s for a WO outside the tenant", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pmWorkOrders, []]], updated }),
      })
    ).inject({
      method: "PUT",
      url: `/api/v1/pm/workorders/${WO}/checklist`,
      payload: { items: [{ result: "normal" }] },
    });
    expect(res.statusCode).toBe(404);
    expect(updated).toHaveLength(0);
  });
});

// ===========================================================================
// AuditLog — fires on a successful mutation, NOT on a failed guard
// ===========================================================================

describe("AuditLog middleware (PLAN.md §5 — every mutation logged)", () => {
  it("records a row on a successful POST /pm/assets (201)", async () => {
    const records: AuditRecord[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pmContracts, [contractRow]], [projects, [projectRow]]] }),
        auditSink: (r) => {
          records.push(r);
        },
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pm/assets",
      payload: { contract_id: CONTRACT, kind: "ลิฟต์" },
    });
    expect(res.statusCode).toBe(201);
    expect(records).toHaveLength(1);
    expect(records[0]!.companyId).toBe(COMPANY);
  });

  it("does NOT record a row on a 404 guard (foreign contract)", async () => {
    const records: AuditRecord[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [] }), // contract invisible → 404
        auditSink: (r) => {
          records.push(r);
        },
      })
    ).inject({
      method: "POST",
      url: "/api/v1/pm/assets",
      payload: { contract_id: CONTRACT, kind: "ลิฟต์" },
    });
    expect(res.statusCode).toBe(404);
    expect(records).toHaveLength(0);
  });

  it("records a row on a successful PUT checklist (200) but not on its 404", async () => {
    const okRecords: AuditRecord[] = [];
    const woWithSnapshot = woRow({ items: [{ label: "ตรวจเบรก" }] });
    const ok = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [[pmWorkOrders, [woWithSnapshot]]],
          updateBase: woWithSnapshot,
        }),
        auditSink: (r) => {
          okRecords.push(r);
        },
      })
    ).inject({
      method: "PUT",
      url: `/api/v1/pm/workorders/${WO}/checklist`,
      payload: { items: [{ result: "normal" }] },
    });
    expect(ok.statusCode).toBe(200);
    expect(okRecords).toHaveLength(1);
    await app.close();

    const missRecords: AuditRecord[] = [];
    const miss = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pmWorkOrders, []]] }), // WO invisible → 404
        auditSink: (r) => {
          missRecords.push(r);
        },
      })
    ).inject({
      method: "PUT",
      url: `/api/v1/pm/workorders/${WO}/checklist`,
      payload: { items: [{ result: "normal" }] },
    });
    expect(miss.statusCode).toBe(404);
    expect(missRecords).toHaveLength(0);
  });
});

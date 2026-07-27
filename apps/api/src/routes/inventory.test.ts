// G3 unit tests (PLAN.md §9) — inventory handlers (Program-2 Inventory · B-141).
// Covers the read surface (standard-cost item value + Σ-from-ledger balances), the
// creates (item/warehouse/transfer — value SERVER-computed, transfer stays pending
// with lines and NO ledger movement), the transfer approve (two atomic ledger rows
// per line, negative-stock 409 rollback, already-approved 409), and the material
// issue (−qty ledger decrement + Dr 1140 / Cr 5020 WIP JV, negative-stock 409,
// COA-missing 409), all gated fail-closed (finance.create / finance.approve · 401).
// Every expected value comes from the stub EXCEPT the server-authority contracts
// under test: value = Σ qty × item.price (standard-cost), on-hand = Σ ledger.qty,
// the Dr 1140 / Cr 5020 direction, and the signed dual-warehouse ledger legs.
//
// PRE-WIRING SCAFFOLD: app.ts wiring (registerInventoryRoute) is the orchestrator's
// pending step, so buildTestApp mounts the routes here via a late child plugin under
// /api/v1 — the root tenant-scope + audit hooks apply to it exactly as to the wired
// routes. Once app.ts wires registerInventoryRoute(v1), remove that block (else a
// duplicate-route error) — the retention.test.ts transition precedent.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  glAccounts,
  inventoryItems,
  issueLines,
  jvLines,
  jvs,
  materialIssues,
  projects,
  roles,
  stockLedgers,
  stockTransfers,
  transferLines,
  users,
  warehouses,
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
const D = new Date(1_700_000_000_000); // 2023-11-14T22:13:20Z

// --- generic keyed stub (mirrors retention.test.ts / labor.test.ts) ----------
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
}

/** Db stub: canned rows per table (reads, incl. selectThrough joins) + write capture. */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [], updated = [] } = opts;
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
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
        returning: () => {
          inserted.push({ table, values });
          const arr = Array.isArray(values) ? values : [values];
          return Promise.resolve(
            arr.map((v) => {
              const row = v as Record<string, unknown>;
              return { id: row.id ?? `new-${seq++}`, createdAt: D, ...row };
            }),
          );
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: () => {
            updated.push({ table, set, where });
            return Promise.resolve([{ id: "upd", ...set }]);
          },
        }),
      }),
    }),
  };
  // B-097: the transaction door runs its callback against this SAME stub, so writes
  // inside a tx still capture (the fake has no real BEGIN/COMMIT — it proves the
  // door threads one scoped handle, and a throw rejects the whole block).
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
  // Inventory routes are wired in app.ts (registerInventoryRoute) → buildApp mounts
  // them under /api/v1; no sibling registration here (would double-declare).
  await app.ready();
  return app;
}

// --- seed-shaped ids + rows --------------------------------------------------
const ITEM0 = "itm00000-0000-0000-0000-0000000000i0";
const ITEM1 = "itm00000-0000-0000-0000-0000000000i1";
const WH_FROM = "whs00000-0000-0000-0000-00000000wfr0";
const WH_TO = "whs00000-0000-0000-0000-000000000wto";
const PROJECT0 = "prj00000-0000-0000-0000-0000000000p0";
const TRANSFER0 = "trf00000-0000-0000-0000-0000000000t0";
const ISSUE0 = "iss00000-0000-0000-0000-0000000000s0";
const CC0 = "cc000000-0000-0000-0000-0000000000cc";
const ACC_WIP = "acc00000-0000-0000-0000-000000001140"; // 1140 WIP/CIP
const ACC_MAT = "acc00000-0000-0000-0000-000000005020"; // 5020 materials-cost

const itemRow = (
  id: string,
  extra: Partial<typeof inventoryItems.$inferSelect> = {},
): typeof inventoryItems.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    warehouseId: WH_FROM,
    code: "CEM-01",
    cat: "ปูน",
    name: "ปูนซีเมนต์",
    unit: "ถุง",
    price: "50.00",
    currencyCode: "THB",
    stock: "0",
    lowPoint: "20.0000",
    status: "active",
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof inventoryItems.$inferSelect;

const warehouseRow = (
  id: string,
  extra: Partial<typeof warehouses.$inferSelect> = {},
): typeof warehouses.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    name: "คลังกลาง",
    location: "กรุงเทพฯ",
    code: "WH-01",
    type: "main",
    owner: "บริษัท",
    capacity: "1000.0000",
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof warehouses.$inferSelect;

const ledgerRow = (
  itemId: string,
  warehouseId: string,
  qty: string,
): typeof stockLedgers.$inferSelect =>
  ({
    id: `led-${itemId}-${warehouseId}`,
    companyId: COMPANY,
    itemId,
    warehouseId,
    qty,
    refDoc: "seed",
    movedAt: D,
    createdAt: D,
  }) as typeof stockLedgers.$inferSelect;

const transferRow = (
  id: string,
  extra: Partial<typeof stockTransfers.$inferSelect> = {},
): typeof stockTransfers.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    no: "OPEN-1",
    fromWarehouseId: WH_FROM,
    toWarehouseId: WH_TO,
    qty: "10.0000",
    value: "500.00",
    currencyCode: "THB",
    transferDate: null,
    byUserId: null,
    status: "pending",
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof stockTransfers.$inferSelect;

const transferLineRow = (
  transferId: string,
  itemId: string,
  qty: string,
): typeof transferLines.$inferSelect =>
  ({
    id: `tl-${itemId}`,
    transferId,
    itemId,
    qty,
    fromWh: WH_FROM,
    toWh: WH_TO,
    createdAt: D,
    updatedAt: D,
  }) as typeof transferLines.$inferSelect;

const issueRow = (
  id: string,
  extra: Partial<typeof materialIssues.$inferSelect> = {},
): typeof materialIssues.$inferSelect =>
  ({
    id,
    companyId: COMPANY,
    no: "OPEN-1",
    projectId: PROJECT0,
    fromWarehouseId: WH_FROM,
    value: "500.00",
    currencyCode: "THB",
    issueDate: null,
    byUserId: null,
    status: "approved",
    createdAt: D,
    updatedAt: D,
    ...extra,
  }) as typeof materialIssues.$inferSelect;

const issueLineRow = (
  issueId: string,
  itemId: string,
  qty: string,
): typeof issueLines.$inferSelect =>
  ({
    id: `il-${itemId}`,
    issueId,
    itemId,
    qty,
    ccId: CC0,
    createdAt: D,
    updatedAt: D,
  }) as typeof issueLines.$inferSelect;

const projectRow = {
  id: PROJECT0,
  companyId: COMPANY,
  typeId: "type-0",
  name: "คอนโด รุ่งเรือง",
  short: "RR",
  color: null,
  budget: "10000000.00",
  currencyCode: "THB",
  status: "active",
  health: null,
  createdAt: D,
  updatedAt: D,
};

const userRow = {
  id: "u-0",
  companyId: COMPANY,
  email: SESSION.user.email,
  name: SESSION.user.name,
  roleId: "role-0",
  status: "active",
};
/** A role carrying (or not) the finance create/approve perms the gates read. */
const roleRow = (finance: { create?: boolean; approve?: boolean } = {}) => ({
  id: "role-0",
  companyId: COMPANY,
  name: "Ops",
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

const glAcc = (id: string, code: string, name: string) => ({
  id,
  companyId: COMPANY,
  parentId: null,
  code,
  name,
  accountType: null,
  createdAt: D,
  updatedAt: D,
});
/** Both issue-posting accounts present (the happy path resolves 1140 + 5020). */
const COA_ROWS = [
  glAcc(ACC_WIP, "1140", "งานระหว่างก่อสร้าง"),
  glAcc(ACC_MAT, "5020", "ต้นทุนวัสดุ"),
];

/** A benign existing JV so allocJvNo has a set to scan + insertThrough ownership is non-empty. */
const jvSeed = {
  id: "jv-seed",
  companyId: COMPANY,
  no: "OPEN-1",
  sourceDoc: "seed",
  periodId: null,
  memo: "seed",
  createdAt: D,
  updatedAt: D,
};

/** The two authz rows every write handler resolves (loadCaller → user → role). */
const authzRows = (finance: { create?: boolean; approve?: boolean } = {}) =>
  [
    [users, [userRow]],
    [roles, [roleRow(finance)]],
  ] as Array<[unknown, RowSource]>;

// ===========================================================================
// READS
// ===========================================================================
describe("GET /api/v1/inventory/items", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/inventory/items" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("emits standard-cost value = price × on-hand, on-hand = Σ ledger.qty (all warehouses)", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [inventoryItems, [itemRow(ITEM0, { price: "50.00" })]],
            // 8 in WH_FROM + 2 in WH_TO → on-hand 10, value 10 × 50 = 500.
            [
              stockLedgers,
              [ledgerRow(ITEM0, WH_FROM, "8.0000"), ledgerRow(ITEM0, WH_TO, "2.0000")],
            ],
          ],
          captured,
        }),
      })
    ).inject({ url: "/api/v1/inventory/items" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(1);
    const r = body.data[0];
    expect(r.id).toBe(ITEM0);
    expect(r.price).toBe(50);
    expect(r.on_hand).toBe(10); // Σ signed ledger qty
    expect(r.stock).toBe(10); // mirrors on_hand (legacy scalar superseded)
    expect(r.value).toBe(500); // standard-cost server value
    expect(r.currency_code).toBe("THB");
    // tenant scope bound on the item read.
    const read = captured.find((c) => c.table === inventoryItems);
    expect(paramsOf(read!.where)).toContain(COMPANY);
  });

  it("reads honest-empty on-hand (0) + value (0) when the ledger is unseeded", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [inventoryItems, [itemRow(ITEM0)]],
            [stockLedgers, []],
          ],
        }),
      })
    ).inject({ url: "/api/v1/inventory/items" });
    const r = res.json().data[0];
    expect(r.on_hand).toBe(0);
    expect(r.value).toBe(0);
  });
});

describe("GET /api/v1/inventory/items/:id", () => {
  it("404s an item not in this tenant (scoped)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[inventoryItems, []]] }),
      })
    ).inject({ url: `/api/v1/inventory/items/${ITEM0}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("returns one item with its on-hand + standard-cost value", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [inventoryItems, [itemRow(ITEM0, { price: "50.00" })]],
            [stockLedgers, [ledgerRow(ITEM0, WH_FROM, "12.0000")]],
          ],
        }),
      })
    ).inject({ url: `/api/v1/inventory/items/${ITEM0}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().on_hand).toBe(12);
    expect(res.json().value).toBe(600);
  });
});

describe("GET /api/v1/inventory/warehouses", () => {
  it("lists the tenant's warehouses with the superset columns", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[warehouses, [warehouseRow(WH_FROM)]]] }),
      })
    ).inject({ url: "/api/v1/inventory/warehouses" });
    expect(res.statusCode).toBe(200);
    const r = res.json().data[0];
    expect(r.id).toBe(WH_FROM);
    expect(r.code).toBe("WH-01");
    expect(r.type).toBe("main");
    expect(r.owner).toBe("บริษัท");
    expect(r.capacity).toBe(1000);
  });
});

describe("GET /api/v1/inventory/stock", () => {
  it("derives per-(item,warehouse) balances from the ledger (Σ qty) + standard-cost value", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [
              stockLedgers,
              [
                ledgerRow(ITEM0, WH_FROM, "8.0000"),
                ledgerRow(ITEM0, WH_FROM, "-3.0000"), // same bucket → nets to 5
                ledgerRow(ITEM0, WH_TO, "2.0000"),
              ],
            ],
            [inventoryItems, [itemRow(ITEM0, { price: "50.00" })]],
            [warehouses, [warehouseRow(WH_FROM), warehouseRow(WH_TO, { name: "คลังหน้างาน" })]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/inventory/stock" });
    expect(res.statusCode).toBe(200);
    const byKey = Object.fromEntries(
      res.json().data.map((r: Record<string, unknown>) => [`${r.item_id}::${r.warehouse_id}`, r]),
    );
    expect(byKey[`${ITEM0}::${WH_FROM}`].on_hand).toBe(5);
    expect(byKey[`${ITEM0}::${WH_FROM}`].value).toBe(250); // 5 × 50
    expect(byKey[`${ITEM0}::${WH_TO}`].on_hand).toBe(2);
    expect(byKey[`${ITEM0}::${WH_TO}`].value).toBe(100);
  });

  it("reads honest-empty (no rows) when the ledger is unseeded", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [stockLedgers, []],
            [inventoryItems, [itemRow(ITEM0)]],
            [warehouses, [warehouseRow(WH_FROM)]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/inventory/stock" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
  });
});

describe("GET /api/v1/inventory/transfers/:id", () => {
  it("returns the header + its transfer_line rows", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [stockTransfers, [transferRow(TRANSFER0)]],
            [transferLines, [transferLineRow(TRANSFER0, ITEM0, "10.0000")]],
            [warehouses, [warehouseRow(WH_FROM), warehouseRow(WH_TO)]],
          ],
        }),
      })
    ).inject({ url: `/api/v1/inventory/transfers/${TRANSFER0}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(TRANSFER0);
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].item_id).toBe(ITEM0);
    expect(body.lines[0].qty).toBe(10);
  });
});

describe("GET /api/v1/inventory/issues/:id", () => {
  it("returns the header + its issue_line rows", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [materialIssues, [issueRow(ISSUE0)]],
            [issueLines, [issueLineRow(ISSUE0, ITEM0, "10.0000")]],
            [projects, [projectRow]],
          ],
        }),
      })
    ).inject({ url: `/api/v1/inventory/issues/${ISSUE0}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(ISSUE0);
    expect(body.project_name).toBe("คอนโด รุ่งเรือง");
    expect(body.lines[0].cc_id).toBe(CC0);
  });
});

// ===========================================================================
// CREATES
// ===========================================================================
describe("POST /api/v1/inventory/items", () => {
  it("403s a caller lacking finance.create (fail closed)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: authzRows({ create: false }), inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/inventory/items",
      payload: { code: "X", name: "n", price: 10 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/finance create permission/);
    expect(inserted).toHaveLength(0);
  });

  it("400s when code / name / price are missing or non-positive", async () => {
    const build = () => buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: authzRows() }) });
    const noCode = await (await build()).inject({ method: "POST", url: "/api/v1/inventory/items", payload: { name: "n", price: 10 } });
    expect(noCode.statusCode).toBe(400);
    const noPrice = await (await build()).inject({ method: "POST", url: "/api/v1/inventory/items", payload: { code: "C", name: "n" } });
    expect(noPrice.statusCode).toBe(400);
    const zeroPrice = await (await build()).inject({ method: "POST", url: "/api/v1/inventory/items", payload: { code: "C", name: "n", price: 0 } });
    expect(zeroPrice.statusCode).toBe(400);
  });

  it("creates an item (price stored, legacy stock 0, on-hand 0 for a fresh item)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: authzRows(), inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/inventory/items",
      payload: { code: "CEM-01", name: "ปูน", cat: "ปูน", unit: "ถุง", price: 50, low_point: 20 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().on_hand).toBe(0);
    const ins = inserted.find((i) => i.table === inventoryItems)!;
    const v = ins.values as Record<string, unknown>;
    expect(v.price).toBe("50.00");
    expect(v.stock).toBe("0");
    expect(v.lowPoint).toBe("20.0000");
  });
});

describe("POST /api/v1/inventory/warehouses", () => {
  it("creates a warehouse with the superset columns", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: authzRows(), inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/inventory/warehouses",
      payload: { code: "WH-02", name: "คลังหน้างาน", type: "site", owner: "โครงการ", capacity: 500 },
    });
    expect(res.statusCode).toBe(201);
    const v = inserted.find((i) => i.table === warehouses)!.values as Record<string, unknown>;
    expect(v.code).toBe("WH-02");
    expect(v.type).toBe("site");
    expect(v.capacity).toBe("500.0000");
  });

  it("400s when code is missing", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: authzRows() }) })
    ).inject({ method: "POST", url: "/api/v1/inventory/warehouses", payload: { name: "n" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /api/v1/inventory/transfers", () => {
  const transferDb = (opts: { inserted?: Inserted[] } = {}) =>
    stubDb({
      rows: [
        ...authzRows(),
        [warehouses, [warehouseRow(WH_FROM), warehouseRow(WH_TO)]],
        [inventoryItems, [itemRow(ITEM0, { price: "50.00" }), itemRow(ITEM1, { id: ITEM1, price: "30.00" })]],
        [stockTransfers, [transferRow("seed-tr", { no: "OPEN-1" })]],
      ],
      inserted: opts.inserted,
    });

  it("creates a PENDING transfer — value = Σ qty × price (server), lines, NO ledger movement", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: transferDb({ inserted }) })
    ).inject({
      method: "POST",
      url: "/api/v1/inventory/transfers",
      payload: {
        from_warehouse_id: WH_FROM,
        to_warehouse_id: WH_TO,
        lines: [
          { item_id: ITEM0, qty: 4 }, // 4 × 50 = 200
          { item_id: ITEM1, qty: 5 }, // 5 × 30 = 150
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const header = inserted.find((i) => i.table === stockTransfers)!.values as Record<string, unknown>;
    expect(header.value).toBe("350.00"); // server standard-cost total
    expect(header.qty).toBe("9.0000");
    expect(header.status).toBe("pending");
    expect(header.no).toMatch(/^TR-\d{4}-\d{4}$/);
    // lines written (via insertThrough into transfer_line).
    const lines = inserted.find((i) => i.table === transferLines)!.values as Record<string, unknown>[];
    expect(lines).toHaveLength(2);
    // NO stock movement on create (deferred to approve).
    expect(inserted.find((i) => i.table === stockLedgers)).toBeUndefined();
  });

  it("400s a line item that is not in this tenant (ownership)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: transferDb() })
    ).inject({
      method: "POST",
      url: "/api/v1/inventory/transfers",
      payload: { from_warehouse_id: WH_FROM, to_warehouse_id: WH_TO, lines: [{ item_id: "foreign", qty: 1 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/not found in this tenant/);
  });

  it("400s when from and to warehouses are the same", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: transferDb() })
    ).inject({
      method: "POST",
      url: "/api/v1/inventory/transfers",
      payload: { from_warehouse_id: WH_FROM, to_warehouse_id: WH_FROM, lines: [{ item_id: ITEM0, qty: 1 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/must differ/);
  });
});

// ===========================================================================
// ACTIONS — transfer approve
// ===========================================================================
describe("POST /api/v1/inventory/transfers/:id/approve", () => {
  const approveDb = (opts: {
    transfer?: (typeof stockTransfers.$inferSelect)[];
    ledger?: (typeof stockLedgers.$inferSelect)[];
    inserted?: Inserted[];
    updated?: Updated[];
    financeApprove?: boolean;
  } = {}) =>
    stubDb({
      rows: [
        ...authzRows({ approve: opts.financeApprove ?? true }),
        [stockTransfers, opts.transfer ?? [transferRow(TRANSFER0, { status: "pending" })]],
        [transferLines, [transferLineRow(TRANSFER0, ITEM0, "10.0000")]],
        [stockLedgers, opts.ledger ?? [ledgerRow(ITEM0, WH_FROM, "100.0000")]],
      ],
      inserted: opts.inserted,
      updated: opts.updated,
    });

  it("403s a caller lacking finance.approve", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: approveDb({ financeApprove: false }) })
    ).inject({ method: "POST", url: `/api/v1/inventory/transfers/${TRANSFER0}/approve` });
    expect(res.statusCode).toBe(403);
  });

  it("404s a transfer not in this tenant", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: approveDb({ transfer: [] }) })
    ).inject({ method: "POST", url: `/api/v1/inventory/transfers/${TRANSFER0}/approve` });
    expect(res.statusCode).toBe(404);
  });

  it("409s an already-approved transfer (not pending)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: approveDb({ transfer: [transferRow(TRANSFER0, { status: "approved" })], inserted }),
      })
    ).inject({ method: "POST", url: `/api/v1/inventory/transfers/${TRANSFER0}/approve` });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/not pending/);
    expect(inserted.find((i) => i.table === stockLedgers)).toBeUndefined();
  });

  it("writes TWO signed ledger legs per line (−from / +to) + flips status, NO JV", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: approveDb({ inserted, updated }) })
    ).inject({ method: "POST", url: `/api/v1/inventory/transfers/${TRANSFER0}/approve` });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("approved");
    const legs = inserted.filter((i) => i.table === stockLedgers).map((i) => i.values as Record<string, unknown>);
    expect(legs).toHaveLength(2);
    const out = legs.find((l) => l.warehouseId === WH_FROM)!;
    const inn = legs.find((l) => l.warehouseId === WH_TO)!;
    expect(out.qty).toBe("-10.0000"); // −qty out of the source
    expect(inn.qty).toBe("10.0000"); // +qty into the destination
    expect(out.refDoc).toBe(`transfer:${TRANSFER0}`);
    // status flip pending → approved.
    const upd = updated.find((u) => u.table === stockTransfers)!;
    expect(upd.set.status).toBe("approved");
    // internal relocation touches no P&L → no JV posted.
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined();
  });

  it("409s + rolls back on a negative-stock guard breach (insufficient on-hand)", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: approveDb({ ledger: [], inserted, updated }), // empty ledger → 0 on-hand
      })
    ).inject({ method: "POST", url: `/api/v1/inventory/transfers/${TRANSFER0}/approve` });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/insufficient stock/);
    expect(inserted.find((i) => i.table === stockLedgers)).toBeUndefined();
    expect(updated.find((u) => u.table === stockTransfers)).toBeUndefined();
  });
});

// ===========================================================================
// CREATES + ACTION — material issue (finance.approve)
// ===========================================================================
describe("POST /api/v1/inventory/issues", () => {
  const issueDb = (opts: {
    ledger?: (typeof stockLedgers.$inferSelect)[];
    coa?: unknown[];
    inserted?: Inserted[];
    financeApprove?: boolean;
    lineCc?: string | null;
  } = {}) =>
    stubDb({
      rows: [
        ...authzRows({ approve: opts.financeApprove ?? true }),
        [projects, [projectRow]],
        [warehouses, [warehouseRow(WH_FROM)]],
        [inventoryItems, [itemRow(ITEM0, { price: "50.00" })]],
        [stockLedgers, opts.ledger ?? [ledgerRow(ITEM0, WH_FROM, "100.0000")]],
        [materialIssues, [issueRow("seed-mi", { no: "OPEN-1" })]],
        [jvs, [jvSeed]],
        [glAccounts, opts.coa ?? COA_ROWS],
      ],
      inserted: opts.inserted,
    });

  const issuePayload = { project_id: PROJECT0, from_warehouse_id: WH_FROM, lines: [{ item_id: ITEM0, qty: 10, cc_id: CC0 }] };

  it("403s a caller lacking finance.approve (an issue moves stock + posts money)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: issueDb({ financeApprove: false, inserted }) })
    ).inject({ method: "POST", url: "/api/v1/inventory/issues", payload: issuePayload });
    expect(res.statusCode).toBe(403);
    expect(inserted).toHaveLength(0);
  });

  it("decrements stock (−qty) + posts a balanced Dr 1140 / Cr 5020 WIP JV (server standard-cost)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: issueDb({ inserted }) })
    ).inject({ method: "POST", url: "/api/v1/inventory/issues", payload: issuePayload });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.value).toBe(500); // 10 × 50 standard-cost
    expect(body.jv_no).toMatch(/^JV-\d{4}-\d{4}$/);
    // material_issue header (server no, value, approved).
    const header = inserted.find((i) => i.table === materialIssues)!.values as Record<string, unknown>;
    expect(header.no).toMatch(/^MI-\d{4}-\d{4}$/);
    expect(header.value).toBe("500.00");
    expect(header.status).toBe("approved");
    // ONE −qty ledger row out of the source warehouse.
    const legs = inserted.filter((i) => i.table === stockLedgers).map((i) => i.values as Record<string, unknown>);
    expect(legs).toHaveLength(1);
    expect(legs[0]!.qty).toBe("-10.0000");
    expect(legs[0]!.warehouseId).toBe(WH_FROM);
    expect(String(legs[0]!.refDoc)).toMatch(/^issue:/);
    // Balanced Dr 1140 / Cr 5020 = value, carrying project_id on both legs.
    const jvLineIns = inserted.find((i) => i.table === jvLines)!.values as Record<string, unknown>[];
    expect(jvLineIns).toHaveLength(2);
    const dr = jvLineIns.find((l) => l.accountId === ACC_WIP)!;
    const cr = jvLineIns.find((l) => l.accountId === ACC_MAT)!;
    expect(dr.dr).toBe("500.00");
    expect(dr.cr).toBe("0.00");
    expect(cr.cr).toBe("500.00");
    expect(dr.projectId).toBe(PROJECT0);
    expect(cr.projectId).toBe(PROJECT0);
    // single distinct cc carries onto the summary JV legs.
    expect(dr.ccId).toBe(CC0);
    // the JV keys source_doc issue:<id>.
    const jvIns = inserted.find((i) => i.table === jvs)!.values as Record<string, unknown>;
    expect(String(jvIns.sourceDoc)).toMatch(/^issue:/);
    // Σ dr === Σ cr (balanced double entry).
    const sumDr = jvLineIns.reduce((s, l) => s + Number(l.dr), 0);
    const sumCr = jvLineIns.reduce((s, l) => s + Number(l.cr), 0);
    expect(sumDr).toBe(500);
    expect(sumCr).toBe(500);
  });

  it("409s + rolls back on a negative-stock guard breach (insufficient on-hand)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: issueDb({ ledger: [], inserted }) })
    ).inject({ method: "POST", url: "/api/v1/inventory/issues", payload: issuePayload });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/insufficient stock/);
    expect(inserted.find((i) => i.table === jvs)).toBeUndefined();
    expect(inserted.find((i) => i.table === materialIssues)).toBeUndefined();
  });

  it("409s honestly when the tenant COA lacks a required posting account (never invents)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: issueDb({ coa: [glAcc(ACC_WIP, "1140", "งานระหว่างก่อสร้าง")] }), // 5020 missing
      })
    ).inject({ method: "POST", url: "/api/v1/inventory/issues", payload: issuePayload });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/missing a required posting account/);
  });

  it("400s a project not in this tenant (ownership, fail closed)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            ...authzRows(),
            [projects, []], // project not found
            [warehouses, [warehouseRow(WH_FROM)]],
            [inventoryItems, [itemRow(ITEM0)]],
          ],
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/inventory/issues", payload: issuePayload });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/project_id not found/);
  });

  it("records an AuditLog row on a successful issue (auto middleware)", async () => {
    const fired: { entity: string; companyId: string; userId: string | null }[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: issueDb(),
        auditSink: (r) => {
          fired.push(r as (typeof fired)[number]);
        },
      })
    ).inject({ method: "POST", url: "/api/v1/inventory/issues", payload: issuePayload });
    expect(res.statusCode).toBe(201);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.entity).toBe("/api/v1/inventory/issues");
    expect(fired[0]!.companyId).toBe(COMPANY);
    expect(fired[0]!.userId).toBe("u-0");
  });
});

// G3 unit tests (PLAN.md §9) — GR handlers (P2-BE-06, B-070; gr.jsx GRList +
// forms.jsx GRCreateForm/ReturnForm, data-dictionary "ตีกลับ -> DefectReport").
// Covers the B-014 list envelope UNIONing the PO + WO anchor chains, create
// against a PO (material) or a WO (work), the lines[]→received/rejected
// aggregation, rejected→defect_report generation, partial-vs-full receipt (a
// partial receipt leaves the PO open; a full receipt closes it), and the
// received→returned / received→cancelled state machine. Tenant scope binds on
// the project root reached THROUGH po_id→po→pr→project OR wo_id→wo→pr→project (no
// cross-tenant leak). All quantities come from the stubbed rows — no value is
// hand-computed against the impl.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  defectReports,
  grs,
  grItems,
  pos,
  prItems,
  prs,
  projects,
  wos,
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
const PO = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const WO = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
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
// A rows entry keys canned reads by table (any join) OR by [table, requiredJoin]
// so the two grs reads in GET /gr (PO chain vs WO chain) can return DIFFERENT
// rows — the stub cannot otherwise tell the INNER-JOIN chains apart.
type RowKey = unknown | [unknown, unknown];
interface StubOpts {
  rows: Array<[RowKey, unknown[]]>;
  captured?: Captured[];
  inserted?: Inserted[];
  updated?: Updated[];
  updateBase?: Record<string, unknown>;
}

/** Base Db stub: canned rows per table (join-aware); capture of write ops. */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [], updated = [], updateBase = {} } = opts;
  const rowsFor = (table: unknown, joins: unknown[]): unknown[] => {
    // Most specific first: a [table, requiredJoin] key whose join is present.
    for (const [key, r] of rows) {
      if (Array.isArray(key) && key[0] === table && joins.includes(key[1])) return r;
    }
    for (const [key, r] of rows) if (key === table) return r;
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
        captured.push({ table, where });
        return Promise.resolve(rowsFor(table, joins));
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) => {
        captured.push({ table, where: undefined });
        return Promise.resolve(rowsFor(table, joins)).then(onOk, onErr);
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

const prRow = {
  id: PR,
  projectId: PROJECT,
  no: "PR-2026-0001",
  type: "material",
  needDate: null,
  status: "approved",
  approvalStep: 3,
  createdAt: D,
  updatedAt: D,
};

const poRow = (status: string) => ({
  id: PO,
  prId: PR,
  vendorId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  no: "PO-2026-0288",
  total: "96800",
  vat: "0",
  currencyCode: "THB",
  creditTerm: 30,
  status,
  approvalStep: 1,
  createdAt: D,
  updatedAt: D,
});

const woRow = (status: string) => ({
  id: WO,
  prId: PR,
  vendorId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  no: "WO-2026-0115",
  value: "2840000",
  currencyCode: "THB",
  retentionPct: "10.000",
  status,
  approvalStep: 1,
  createdAt: D,
  updatedAt: D,
});

const prLine = (id: string, qty: string) => ({
  id,
  prId: PR,
  boqItemId: "b0",
  qty,
  createdAt: D,
  updatedAt: D,
});

const gr = (
  id: string,
  opts: {
    no?: string | null;
    poId?: string | null;
    woId?: string | null;
    received?: number;
    rejected?: number;
    status?: string;
    photos?: string[];
  } = {},
) => ({
  id,
  poId: opts.poId ?? null,
  woId: opts.woId ?? null,
  no: opts.no ?? null,
  received: String(opts.received ?? 0),
  rejected: String(opts.rejected ?? 0),
  photos: opts.photos ?? [],
  status: opts.status ?? "received",
  createdAt: D,
  updatedAt: D,
});

// A gr_item received line (B-078 / F1).
const grItem = (
  id: string,
  grId: string,
  ordered: number,
  received: number,
  price: string,
) => ({
  id,
  grId,
  boqItemId: null,
  name: `line ${id}`,
  orderedQty: String(ordered),
  receivedQty: String(received),
  unit: "ถุง",
  price,
  currencyCode: "THB",
  createdAt: D,
  updatedAt: D,
});

const vendorRow = { id: VENDOR, companyId: COMPANY, name: "บจก. รุ่งเรืองก่อสร้าง" };

// ---------------------------------------------------------------------------
// GET /gr — list (PO + WO chains UNIONed) + tenant scope
// ---------------------------------------------------------------------------

describe("GET /api/v1/gr — auth + list", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/gr" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });

  it("returns the B-014 envelope UNIONing PO-anchored + WO-anchored receipts with F1 data", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [[grs, pos], [gr("g0", { no: "GR-2026-0148", poId: PO, received: 320 })]],
            [[grs, wos], [gr("g1", { no: "GR-2026-0145", woId: WO, received: 92 })]],
            // per-line gr_items per anchor chain (money = Σ received × price).
            [[grItems, pos], [grItem("gi0", "g0", 100, 90, "300.00")]],
            [[grItems, wos], [grItem("gi1", "g1", 50, 50, "100.00")]],
            [pos, [poRow("approved")]],
            [wos, [woRow("approved")]],
            [vendors, [vendorRow]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/gr" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    const g0 = body.data.find((g: { id: string }) => g.id === "g0");
    const g1 = body.data.find((g: { id: string }) => g.id === "g1");
    expect(g0.no).toBe("GR-2026-0148");
    expect(g0.po_id).toBe(PO);
    expect(g0.wo_id).toBe(null);
    expect(g0.received).toBe(320);
    // B-078 (F1): resolved vendor, per-line items, money = 90×300, ordered = 100.
    expect(g0.vendor).toBe("บจก. รุ่งเรืองก่อสร้าง");
    expect(g0.ordered_qty).toBe(100);
    expect(g0.money).toBe(27000);
    expect(g0.items).toHaveLength(1);
    expect(g0.items[0].name).toBe("line gi0");
    expect(g1.no).toBe("GR-2026-0145");
    expect(g1.wo_id).toBe(WO);
    expect(g1.po_id).toBe(null);
    expect(g1.money).toBe(5000); // 50 × 100
    expect(Object.keys(g0).sort()).toEqual(
      [
        "currency_code",
        "date",
        "id",
        "items",
        "money",
        "no",
        "ordered_qty",
        "photos",
        "po_id",
        "received",
        "rejected",
        "status",
        "vendor",
        "wo_id",
      ],
    );
  });

  it("binds company_id on the project root of both scoped reads (no cross-tenant leak)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[grs, [gr("g0", { poId: PO })]]], captured }),
      })
    ).inject({ url: "/api/v1/gr" });
    const reads = captured.filter((c) => c.table === grs);
    expect(reads.length).toBe(2); // PO chain + WO chain
    for (const read of reads) {
      expect(paramsOf(read.where)).toContain(COMPANY);
      expect(paramsOf(read.where)).not.toContain(OTHER_COMPANY);
    }
  });
});

// ---------------------------------------------------------------------------
// POST /gr — create against a PO or a WO
// ---------------------------------------------------------------------------

describe("POST /api/v1/gr — create receipt", () => {
  it("creates a receipt against a PO (201), aggregating lines into received/rejected", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pos, [poRow("approved")]],
            [prs, [prRow]],
            [projects, [project]],
            [prItems, [prLine("l0", "1000")]], // ordered 1000 → partial
            [grs, [gr("new-0", { poId: PO, received: 300 })]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: {
        po_id: PO,
        no: "GR-2026-0149",
        lines: [
          { qty_ok: 200, qty_rejected: 0, photos: ["p1.jpg"] },
          { qty_ok: 100, qty_rejected: 0, photos: ["p2.jpg"] },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("received");
    expect(body.po_id).toBe(PO);
    expect(body.wo_id).toBe(null);
    expect(body.received).toBe(300); // 200 + 100
    expect(body.rejected).toBe(0);
    expect(body.photos).toEqual(["p1.jpg", "p2.jpg"]);
    const write = inserted.find((w) => w.table === grs);
    expect((write!.rows[0] as { received: string }).received).toBe("300");
    expect((write!.rows[0] as { status: string }).status).toBe("received");
    expect((write!.rows[0] as { poId: string | null }).poId).toBe(PO);
    expect((write!.rows[0] as { woId: string | null }).woId).toBe(null);
  });

  it("writes gr_item rows from widened lines carrying a name (B-078 / F1)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pos, [poRow("approved")]],
            [prs, [prRow]],
            [projects, [project]],
            [prItems, [prLine("l0", "1000")]],
            [grs, [gr("new-0", { poId: PO, received: 90 })]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: {
        po_id: PO,
        no: "GR-2026-0151",
        lines: [
          // widened detail line → one gr_item; ordered 100, received (qty_ok) 90.
          { qty_ok: 90, qty_rejected: 0, name: "ปูนซีเมนต์", ordered_qty: 100, unit: "ถุง", price: 300 },
          // bare qty-only line → no gr_item (per-line detail honestly absent).
          { qty_ok: 10, qty_rejected: 0 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const itemWrite = inserted.find((w) => w.table === grItems);
    expect(itemWrite).toBeTruthy();
    expect(itemWrite!.rows).toHaveLength(1); // only the named line
    const row = itemWrite!.rows[0] as {
      name: string;
      orderedQty: string;
      receivedQty: string;
      price: string;
    };
    expect(row.name).toBe("ปูนซีเมนต์");
    expect(row.orderedQty).toBe("100");
    expect(row.receivedQty).toBe("90"); // = qty_ok
    expect(row.price).toBe("300.00");
  });

  it("creates a receipt against a WO (201) — wo_id set, po_id null (B-070 GR-from-WO)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [wos, [woRow("approved")]],
            [prs, [prRow]],
            [projects, [project]],
            [prItems, []], // WO lump-sum: no ordered qty → never auto-closes
            [grs, [gr("new-0", { woId: WO, received: 1 })]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { wo_id: WO, lines: [{ qty_ok: 1, qty_rejected: 0 }] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.wo_id).toBe(WO);
    expect(body.po_id).toBe(null);
    expect(body.partial).toBe(true); // ordered 0 → not auto-closed
    const write = inserted.find((w) => w.table === grs);
    expect((write!.rows[0] as { woId: string | null }).woId).toBe(WO);
    expect((write!.rows[0] as { poId: string | null }).poId).toBe(null);
  });

  it("400s when neither po_id nor wo_id is given", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [] }) })
    ).inject({ method: "POST", url: "/api/v1/gr", payload: { lines: [{ qty_ok: 1 }] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("po_id or wo_id");
  });

  it("400s when BOTH po_id and wo_id are given", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [] }) })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, wo_id: WO, lines: [{ qty_ok: 1 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("not both");
  });

  it("400s when lines[] is missing or empty", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [] }) })
    ).inject({ method: "POST", url: "/api/v1/gr", payload: { po_id: PO, lines: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("lines");
  });

  it("404s when the PO is not this tenant's (foreign/absent id)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pos, []]] }), // PO invisible to this tenant
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, lines: [{ qty_ok: 1 }] },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe("po not found");
  });

  it("409s when the PO is not approved (cannot receive against a draft/pending PO)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[pos, [poRow("pending")]]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, lines: [{ qty_ok: 1 }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("404s when the WO is not this tenant's", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[wos, []]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { wo_id: WO, lines: [{ qty_ok: 1 }] },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe("wo not found");
  });
});

// ---------------------------------------------------------------------------
// Rejected qty → defect_report
// ---------------------------------------------------------------------------

describe("POST /api/v1/gr — rejected qty generates a defect_report", () => {
  it("writes a defect_report when any line has qty_rejected > 0", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pos, [poRow("approved")]],
            [prs, [prRow]],
            [projects, [project]],
            [prItems, [prLine("l0", "1000")]],
            [grs, [gr("new-0", { poId: PO, received: 280, rejected: 20 })]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: {
        po_id: PO,
        no: "GR-2026-0150",
        lines: [{ qty_ok: 280, qty_rejected: 20 }],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.rejected).toBe(20);
    expect(body.defect_report).toBeTruthy();
    expect(body.defect_report.gr_id).toBe("new-0"); // the just-created GR
    const defectWrite = inserted.find((w) => w.table === defectReports);
    expect(defectWrite).toBeTruthy();
    expect((defectWrite!.rows[0] as { grId: string }).grId).toBe("new-0");
  });

  it("does NOT write a defect_report when nothing is rejected", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pos, [poRow("approved")]],
            [prs, [prRow]],
            [projects, [project]],
            [prItems, [prLine("l0", "1000")]],
            [grs, [gr("new-0", { poId: PO, received: 300 })]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, lines: [{ qty_ok: 300, qty_rejected: 0 }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().defect_report).toBeUndefined();
    expect(inserted.find((w) => w.table === defectReports)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Partial vs full receipt — the PO stays open on partial, closes on full
// ---------------------------------------------------------------------------

describe("POST /api/v1/gr — partial vs full receipt", () => {
  it("partial (received < ordered): PO stays OPEN (no close), partial=true", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pos, [poRow("approved")]],
            [prs, [prRow]],
            [projects, [project]],
            [prItems, [prLine("l0", "1000")]], // ordered 1000
            [grs, [gr("new-0", { poId: PO, received: 300 })]], // cumulative 300
          ],
          updated,
          updateBase: poRow("approved"),
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, lines: [{ qty_ok: 300 }] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.partial).toBe(true);
    expect(body.ordered_total).toBe(1000);
    expect(body.received_total).toBe(300);
    // PO NOT closed — no update against the po table.
    expect(updated.find((u) => u.table === pos)).toBeUndefined();
  });

  it("full (received >= ordered): PO CLOSED (status→closed), partial=false", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pos, [poRow("approved")]],
            [prs, [prRow]],
            [projects, [project]],
            [prItems, [prLine("l0", "1000")]], // ordered 1000
            [grs, [gr("new-0", { poId: PO, received: 1000 })]], // cumulative 1000
          ],
          updated,
          updateBase: poRow("approved"),
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, lines: [{ qty_ok: 1000 }] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.partial).toBe(false);
    expect(body.received_total).toBe(1000);
    const close = updated.find((u) => u.table === pos);
    expect(close).toBeTruthy();
    expect(close!.set.status).toBe("closed");
  });

  it("cumulative received sums across prior GRs (cancelled ones excluded)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pos, [poRow("approved")]],
            [prs, [prRow]],
            [projects, [project]],
            [prItems, [prLine("l0", "1000")]],
            [
              grs,
              [
                gr("g-old", { poId: PO, received: 600, status: "received" }),
                gr("new-0", { poId: PO, received: 400, status: "received" }),
                gr("g-x", { poId: PO, received: 999, status: "cancelled" }), // excluded
              ],
            ],
          ],
          updateBase: poRow("approved"),
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, lines: [{ qty_ok: 400 }] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.received_total).toBe(1000); // 600 + 400, cancelled 999 excluded
    expect(body.partial).toBe(false);
  });

  it("RETURNED GRs are excluded from the cumulative total — a return-then-re-receive does NOT force-close the PO", async () => {
    // Regression (handler-verify FIX): a returned receipt must not count toward
    // ordered qty, else the outstanding balance is stranded. ordered 1000,
    // a returned 600 + a fresh 600 → only the active 600 counts → still partial.
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pos, [poRow("approved")]],
            [prs, [prRow]],
            [projects, [project]],
            [prItems, [prLine("l0", "1000")]], // ordered 1000
            [
              grs,
              [
                gr("g-ret", { poId: PO, received: 600, status: "returned" }), // excluded
                gr("new-0", { poId: PO, received: 600, status: "received" }),
              ],
            ],
          ],
          updated,
          updateBase: poRow("approved"),
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, lines: [{ qty_ok: 600 }] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.received_total).toBe(600); // returned 600 excluded, only active 600
    expect(body.partial).toBe(true);
    // PO NOT closed — the outstanding 400 must remain receivable.
    expect(updated.find((u) => u.table === pos)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// State machine — return / cancel
// ---------------------------------------------------------------------------

describe("GR return/cancel state machine", () => {
  it("return: received → returned", async () => {
    const updated: Updated[] = [];
    const G = gr("g0", { poId: PO, status: "received" });
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[grs, [G]]], updated, updateBase: G }),
      })
    ).inject({ method: "POST", url: "/api/v1/gr/g0/return" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("returned");
    expect(updated[0]!.set.status).toBe("returned");
    expect(updated[0]!.table).toBe(grs);
  });

  it("return: 409 when the GR is not in the received state", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[grs, [gr("g0", { poId: PO, status: "returned" })]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/gr/g0/return" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("cancel: received → cancelled (WO-anchored GR routes through the WO chain)", async () => {
    const updated: Updated[] = [];
    const G = gr("g1", { woId: WO, status: "received" });
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[grs, [G]]], updated, updateBase: G }),
      })
    ).inject({ method: "POST", url: "/api/v1/gr/g1/cancel" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("cancelled");
    expect(updated[0]!.set.status).toBe("cancelled");
  });

  it("cancel: 409 when the GR is already cancelled", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[grs, [gr("g0", { poId: PO, status: "cancelled" })]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/gr/g0/cancel" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("return/cancel: 404 for a GR outside the tenant", async () => {
    for (const verb of ["return", "cancel"]) {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({ rows: [[grs, []]] }),
        })
      ).inject({ method: "POST", url: `/api/v1/gr/nope/${verb}` });
      expect(res.statusCode).toBe(404);
    }
  });

  it("return: 401 flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/gr/g0/return",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });
});

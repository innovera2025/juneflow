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
import { isUniqueViolation, violatedConstraint } from "./gl-post.js";
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
  // When true, an UPDATE … RETURNING yields 0 rows — models a B-156 optimistic guard
  // whose folded pre-state matched nothing (a concurrent flip / already-advanced doc).
  updateEmpty?: boolean;
  // B-261: make an insert into a table throw (models a 23505 unique-violation on the
  // gr_idempotency_uq partial index). Receives the table and the running 0-based
  // insert count for that table; return an Error to throw, else null/undefined.
  insertThrows?: (table: unknown, nth: number) => unknown;
}

/** Base Db stub: canned rows per table (join-aware); capture of write ops. */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [], updated = [], updateBase = {}, updateEmpty = false, insertThrows } = opts;
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
  const insertCalls = new Map<unknown, number>();
  return {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        returning: () => {
          const nth = insertCalls.get(table) ?? 0;
          insertCalls.set(table, nth + 1);
          const thrown = insertThrows?.(table, nth);
          if (thrown) return Promise.reject(thrown);
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
            return Promise.resolve(updateEmpty ? [] : [{ ...updateBase, ...set }]);
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

  it("rounds money to 2 dp — no Σ(received × price) float drift (B-085 fix 3)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [[grs, pos], [gr("g0", { no: "GR-DRIFT", poId: PO, received: 3 })]],
            [[grs, wos], []],
            // 3 × 0.10 = 0.30000000000000004 in IEEE-754 → must surface as 0.3.
            [[grItems, pos], [grItem("gi0", "g0", 3, 3, "0.10")]],
            [[grItems, wos], []],
            [pos, [poRow("approved")]],
            [vendors, [vendorRow]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/gr" });
    expect(res.statusCode).toBe(200);
    const g0 = res.json().data.find((g: { id: string }) => g.id === "g0");
    expect(g0.money).toBe(0.3);
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

  it("400s when the receipt lines carry more than one currency (B-085 fix 4 — one receipt = one currency)", async () => {
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
            [grs, [gr("new-0", { poId: PO, received: 5 })]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: {
        po_id: PO,
        lines: [
          { qty_ok: 3, name: "ปูนซีเมนต์", ordered_qty: 3, unit: "ถุง", price: 300, currency_code: "THB" },
          { qty_ok: 2, name: "steel", ordered_qty: 2, unit: "ton", price: 400, currency_code: "USD" },
        ],
      },
    });
    // Fail closed at create — never sum across currencies under one label, and
    // never persist the receipt (no gr / gr_item writes).
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
    expect(res.json().message).toContain("currency");
    expect(inserted.find((w) => w.table === grItems)).toBeFalsy();
    expect(inserted.find((w) => w.table === grs)).toBeFalsy();
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

  it("full receipt is idempotent when a CONCURRENT GR already closed the PO: the guarded auto-close (…AND status='approved') matches 0 rows → fire-and-forget no-op, no error, still 201 (B-156)", async () => {
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
            [grs, [gr("new-0", { poId: PO, received: 1000 })]], // cumulative 1000 → full
          ],
          updated,
          updateBase: poRow("approved"),
          // The other racer already flipped the PO approved→closed; this close's
          // guard (…AND status='approved') therefore matches nothing.
          updateEmpty: true,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, lines: [{ qty_ok: 1000 }] },
    });
    // The receipt still succeeds — a 0-row close is a harmless idempotent no-op,
    // never a thrown error, so full receipt never double-closes.
    expect(res.statusCode).toBe(201);
    expect(res.json().partial).toBe(false);
    const close = updated.find((u) => u.table === pos);
    expect(close).toBeTruthy(); // the close WAS attempted (guarded), it simply matched 0 rows
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

  it("return: 409 via the B-156 optimistic guard on a CONCURRENT flip (reads 'received' → passes the JS pre-check, but the guarded UPDATE …AND status='received' matches 0 rows)", async () => {
    // updateEmpty models a concurrent return/cancel that already advanced the GR
    // between the pre-check read and the guarded flip → the atomic 0-row backstop.
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[grs, [gr("g0", { poId: PO, status: "received" })]]], updateEmpty: true }),
      })
    ).inject({ method: "POST", url: "/api/v1/gr/g0/return" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
    expect(res.json().message).toMatch(/only a received GR can be returned/);
  });

  it("cancel: 409 via the B-156 optimistic guard on a CONCURRENT flip (0-row guarded UPDATE)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[grs, [gr("g1", { woId: WO, status: "received" })]]], updateEmpty: true }),
      })
    ).inject({ method: "POST", url: "/api/v1/gr/g1/cancel" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
    expect(res.json().message).toMatch(/only a received GR can be cancelled/);
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

// ---------------------------------------------------------------------------
// B-261 — idempotency contract (client key + partial unique index + replay)
// The mobile offline SyncProcessor replays a create it never heard back on; the
// same idempotency_key must return the ORIGINAL receipt (money=SERVER), never a
// duplicate. A 23505 on gr_idempotency_uq is the dedup point (mirrors B-167).
// ---------------------------------------------------------------------------

const IDEMP_KEY = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const GR_IDEMP_UQ = "gr_idempotency_uq";

/**
 * A raw pg unique-violation (SQLSTATE 23505) — the DatabaseError node-postgres
 * throws. It names the violated index on `.constraint` (verified against a live
 * PG 16 + pg 8: `{ code: "23505", constraint: "<index name>" }`), which is what
 * B-263's catch gates on. `null` models the defensive case of a 23505 that names
 * nothing.
 */
const pgUniqueViolation = (constraint: string | null = GR_IDEMP_UQ): Error =>
  Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint ?? "?"}"`),
    constraint === null ? { code: "23505" } : { code: "23505", constraint },
  );

/**
 * The shape the HANDLER actually sees: every insert goes through drizzle, which
 * wraps the driver error in a DrizzleQueryError and nests the DatabaseError under
 * `.cause` (verified live: drizzle-orm 0.45 → `DrizzleQueryError { cause:
 * DatabaseError { code, constraint } }`). isUniqueViolation() and
 * violatedConstraint() must therefore both look one level down — a suite that only
 * ever threw the FLAT shape would stay green against a gate reading
 * `err.constraint` directly while production silently lost its replay path.
 */
const uniqueViolation = (constraint: string | null = GR_IDEMP_UQ): Error =>
  Object.assign(new Error("Failed query"), { cause: pgUniqueViolation(constraint) });

describe("POST /api/v1/gr — B-261 idempotency (client key + replay)", () => {
  it("same idempotency_key twice → ONE receipt: the replay returns the ORIGINAL byte-for-byte, no 2nd insert", async () => {
    const inserted: Inserted[] = [];
    // The ORIGINAL receipt the replay must resolve. createdAt undefined mirrors the
    // fresh insert's RETURNING (the handler never sets it — the DB defaults it), so
    // the two responses serialize identically (a real replay reads the DB-stamped row).
    const original = { ...gr("new-0", { poId: PO, received: 300 }), createdAt: undefined };
    const db = stubDb({
      rows: [
        [pos, [poRow("approved")]],
        [prs, [prRow]],
        [projects, [project]],
        [prItems, [prLine("l0", "1000")]], // ordered 1000 → partial
        [grs, [original]],
        [vendors, [vendorRow]],
      ],
      inserted,
      // the 2nd create (the replay) trips the idempotency index; the 1st inserts fine.
      insertThrows: (table, nth) => (table === grs && nth >= 1 ? uniqueViolation() : null),
    });
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db });
    const payload = { po_id: PO, idempotency_key: IDEMP_KEY, lines: [{ qty_ok: 300, qty_rejected: 0 }] };
    const res1 = await app.inject({ method: "POST", url: "/api/v1/gr", payload });
    const res2 = await app.inject({ method: "POST", url: "/api/v1/gr", payload });

    expect(res1.statusCode).toBe(201);
    expect(res2.statusCode).toBe(201);
    // The replay is idempotent — the client sees its OWN receipt (same id, same money),
    // never a 409, never a duplicate.
    expect(res2.json()).toEqual(res1.json());
    expect(res1.json().id).toBe("new-0");
    expect(res2.json().id).toBe("new-0");
    expect(res2.json().received).toBe(300);
    // exactly ONE gr row written across BOTH requests — the replay tripped 23505 before any write.
    expect(inserted.filter((w) => w.table === grs)).toHaveLength(1);
    // and the persisted receipt carries the client key.
    expect((inserted.find((w) => w.table === grs)!.rows[0] as { idempotencyKey: string }).idempotencyKey).toBe(IDEMP_KEY);
  });

  it("the replay dedup SELECT is tenant-scoped (binds company_id + the key — a foreign key never resolves our GR)", async () => {
    const captured: Captured[] = [];
    const original = { ...gr("new-0", { poId: PO, received: 300 }), createdAt: undefined };
    const db = stubDb({
      rows: [
        [pos, [poRow("approved")]],
        [prs, [prRow]],
        [projects, [project]],
        [prItems, [prLine("l0", "1000")]],
        [grs, [original]],
        [vendors, [vendorRow]],
      ],
      captured,
      insertThrows: (table) => (table === grs ? uniqueViolation() : null),
    });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, idempotency_key: IDEMP_KEY, lines: [{ qty_ok: 300 }] },
    });
    expect(res.statusCode).toBe(201);
    // the dedup resolve filtered grs by the client key — and every such read is
    // company-scoped on the project root (no cross-tenant leak).
    const keyed = captured.filter((c) => c.table === grs && paramsOf(c.where).includes(IDEMP_KEY));
    expect(keyed.length).toBeGreaterThan(0);
    for (const c of keyed) {
      expect(paramsOf(c.where)).toContain(COMPANY);
      expect(paramsOf(c.where)).not.toContain(OTHER_COMPANY);
    }
  });

  it("409s when a key collision resolves to NO receipt in this tenant (a cross-tenant clash — never a leak or a fabricated success)", async () => {
    const db = stubDb({
      rows: [
        [pos, [poRow("approved")]],
        [prs, [prRow]],
        [projects, [project]],
        [prItems, [prLine("l0", "1000")]],
        [grs, []], // the colliding gr belongs to ANOTHER tenant → invisible through our chain
        [vendors, [vendorRow]],
      ],
      insertThrows: (table) => (table === grs ? uniqueViolation() : null),
    });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, idempotency_key: IDEMP_KEY, lines: [{ qty_ok: 300 }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
  });

  it("different idempotency_keys → two distinct receipts (no dedup path)", async () => {
    const inserted: Inserted[] = [];
    const db = stubDb({
      rows: [
        [pos, [poRow("approved")]],
        [prs, [prRow]],
        [projects, [project]],
        [prItems, [prLine("l0", "1000")]],
        [grs, [gr("g", { poId: PO, received: 300 })]],
        [vendors, [vendorRow]],
      ],
      inserted,
      // distinct keys never collide on a real DB → the stub never throws.
    });
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db });
    const r1 = await app.inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, idempotency_key: "key-A", lines: [{ qty_ok: 300 }] },
    });
    const r2 = await app.inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, idempotency_key: "key-B", lines: [{ qty_ok: 300 }] },
    });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    const grInserts = inserted.filter((w) => w.table === grs);
    expect(grInserts).toHaveLength(2); // two real receipts, each with its own key
    expect((grInserts[0]!.rows[0] as { idempotencyKey: string }).idempotencyKey).toBe("key-A");
    expect((grInserts[1]!.rows[0] as { idempotencyKey: string }).idempotencyKey).toBe("key-B");
  });

  it("no idempotency_key → a normal single create; the key persists as null (web clients unchanged, no dedup path)", async () => {
    const inserted: Inserted[] = [];
    const db = stubDb({
      rows: [
        [pos, [poRow("approved")]],
        [prs, [prRow]],
        [projects, [project]],
        [prItems, [prLine("l0", "1000")]],
        [grs, [gr("new-0", { poId: PO, received: 300 })]],
        [vendors, [vendorRow]],
      ],
      inserted,
    });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, lines: [{ qty_ok: 300 }] },
    });
    expect(res.statusCode).toBe(201);
    const grInserts = inserted.filter((w) => w.table === grs);
    expect(grInserts).toHaveLength(1);
    expect((grInserts[0]!.rows[0] as { idempotencyKey: string | null }).idempotencyKey).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// B-263 — the B-261 replay catch gates on the CONSTRAINT NAME, not on SQLSTATE
// alone. 23505 says "some unique constraint was violated"; it does not say which.
// Today gr carries only its PK + gr_idempotency_uq, so the old SQLSTATE-only gate
// was safe — but this handler is the template being copied to the other
// money-write endpoints, and the first future unique index on such a table (a
// unique doc `no`, say) would otherwise inherit the replay path and answer a
// wrong-ish 201/409 for an unrelated collision. Both branches are pinned below.
// ---------------------------------------------------------------------------

describe("POST /api/v1/gr — B-263 (the 23505 replay gate is constraint-name-specific)", () => {
  /** The ORIGINAL receipt a replay must resolve (createdAt mirrors a fresh RETURNING). */
  const baseRows = (): StubOpts["rows"] => [
    [pos, [poRow("approved")]],
    [prs, [prRow]],
    [projects, [project]],
    [prItems, [prLine("l0", "1000")]], // ordered 1000 → partial receipt
    [grs, [{ ...gr("new-0", { poId: PO, received: 300 }), createdAt: undefined }]],
    [vendors, [vendorRow]],
  ];
  const postKeyed = async (db: Db) =>
    (await buildTestApp({ resolveTenant: async () => SESSION, db })).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, idempotency_key: IDEMP_KEY, lines: [{ qty_ok: 300 }] },
    });

  it("(a) 23505 naming gr_idempotency_uq → the REPLAY still runs: the ORIGINAL receipt, no 2nd write", async () => {
    const inserted: Inserted[] = [];
    const db = stubDb({
      rows: baseRows(),
      inserted,
      // drizzle-wrapped (the production shape): DrizzleQueryError → cause → DatabaseError.
      insertThrows: (table) => (table === grs ? uniqueViolation(GR_IDEMP_UQ) : null),
    });
    const res = await postKeyed(db);
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("new-0"); // the client's OWN receipt, re-read not recreated
    expect(res.json().received).toBe(300);
    expect(inserted.filter((w) => w.table === grs)).toHaveLength(0); // the insert threw → no duplicate
  });

  it("(a) the same violation UNWRAPPED (raw pg DatabaseError, constraint at the top level) replays too", async () => {
    const db = stubDb({
      rows: baseRows(),
      insertThrows: (table) => (table === grs ? pgUniqueViolation(GR_IDEMP_UQ) : null),
    });
    const res = await postKeyed(db);
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("new-0");
  });

  it("(b) 23505 naming a DIFFERENT unique constraint is NOT mis-routed into the replay — it rethrows (500)", async () => {
    const captured: Captured[] = [];
    const inserted: Inserted[] = [];
    const db = stubDb({
      rows: baseRows(),
      captured,
      inserted,
      // a hypothetical future `unique(no)` on gr — a real collision, but NOT a replay.
      insertThrows: (table) => (table === grs ? uniqueViolation("gr_no_uq") : null),
    });
    const res = await postKeyed(db);
    // fails safe: the caller gets an honest error, never someone else's receipt as
    // a 201 nor a fabricated "idempotency_key already used" 409.
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe("INTERNAL_ERROR");
    // and the replay path never even started: no dedup SELECT bound the client key…
    expect(
      captured.filter((c) => c.table === grs && paramsOf(c.where).includes(IDEMP_KEY)),
    ).toHaveLength(0);
    expect(inserted.filter((w) => w.table === grs)).toHaveLength(0); // …and no receipt was written
  });

  it("(b) a 23505 that names NO constraint is not assumed to be ours either (strict gate)", async () => {
    const captured: Captured[] = [];
    const db = stubDb({
      rows: baseRows(),
      captured,
      insertThrows: (table) => (table === grs ? uniqueViolation(null) : null),
    });
    const res = await postKeyed(db);
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe("INTERNAL_ERROR");
    expect(
      captured.filter((c) => c.table === grs && paramsOf(c.where).includes(IDEMP_KEY)),
    ).toHaveLength(0);
  });
});

describe("violatedConstraint() — the shared B-263 gate helper (money-write template)", () => {
  it("reads the violated index name from BOTH real runtime shapes, undefined otherwise", () => {
    expect(violatedConstraint(pgUniqueViolation(GR_IDEMP_UQ))).toBe(GR_IDEMP_UQ); // raw pg
    expect(violatedConstraint(uniqueViolation(GR_IDEMP_UQ))).toBe(GR_IDEMP_UQ); // drizzle-wrapped
    expect(violatedConstraint(uniqueViolation("gr_no_uq"))).toBe("gr_no_uq");
    expect(violatedConstraint(uniqueViolation(null))).toBeUndefined(); // 23505, unnamed
    expect(violatedConstraint(new Error("boom"))).toBeUndefined();
    expect(violatedConstraint(null)).toBeUndefined();
    expect(violatedConstraint("23505")).toBeUndefined();
  });

  it("pairs with isUniqueViolation(): the SQLSTATE precondition holds on both shapes", () => {
    expect(isUniqueViolation(pgUniqueViolation())).toBe(true);
    expect(isUniqueViolation(uniqueViolation())).toBe(true);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
  });
});

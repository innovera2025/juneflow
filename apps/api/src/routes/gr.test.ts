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
  boqItems,
  boqGroups,
  boqDocs,
  jvs,
  stockLedgers,
} from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { isUniqueViolation, violatedConstraint } from "./gl-post.js";
// B-TBD-QTY: the over-receipt tolerance is asserted THROUGH the constant, never
// against a literal — Wei's final figure must cost one line, not a test sweep.
import { GR_OVER_RECEIPT_TOLERANCE_PCT } from "./gr.js";
import { IDEMPOTENCY_KEY_TYPE_MESSAGE, readIdempotencyKey } from "./procurement.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const OTHER_COMPANY = "33333333-3333-3333-3333-333333333333";
const PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PR = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PO = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const WO = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const VENDOR = "cccccccc-cccc-cccc-cccc-cccccccccccc";
// B-348: gr_item.price is DERIVED from these BOQ lines, never from the body.
const BOQ_ITEM = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const BOQ_ITEM_USD = "ffffffff-ffff-ffff-ffff-fffffffffffe";
const BOQ_ITEM_FOREIGN = "ffffffff-ffff-ffff-ffff-fffffffffff0";
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
// B-264: a rows VALUE may also be a function of the read's WHERE. POST /gr now runs
// an idempotency PRE-CHECK — a grs read whose WHERE binds the client key — ALONGSIDE
// the handler's other (unkeyed) grs reads, and the row-blind stub cannot otherwise
// tell "resolve the client's own receipt" from "the anchor's cumulative receipts".
// See keyedGrs() below.
type RowSource = unknown[] | ((where: SQL | undefined) => unknown[]);
interface StubOpts {
  rows: Array<[RowKey, RowSource]>;
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
  const resolve = (src: RowSource, where: SQL | undefined): unknown[] =>
    typeof src === "function" ? src(where) : src;
  const rowsFor = (
    table: unknown,
    joins: unknown[],
    where: SQL | undefined,
  ): unknown[] => {
    // Most specific first: a [table, requiredJoin] key whose join is present.
    for (const [key, r] of rows) {
      if (Array.isArray(key) && key[0] === table && joins.includes(key[1])) {
        return resolve(r, where);
      }
    }
    for (const [key, r] of rows) if (key === table) return resolve(r, where);
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
        return Promise.resolve(rowsFor(table, joins, where));
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) => {
        captured.push({ table, where: undefined });
        return Promise.resolve(rowsFor(table, joins, undefined)).then(onOk, onErr);
      },
    };
    return builder;
  };
  let seq = 0;
  const insertCalls = new Map<unknown, number>();
  const handle: Record<string, unknown> = {
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
  };
  // B-340: POST /gr and the return/cancel actions now run their writes inside ONE
  // db.transaction (header insert FIRST, so a replay's 23505 rolls the stock movement
  // back with it). The stub runs the callback against ITSELF — the inventory.test.ts
  // precedent (`raw.transaction = (cb) => cb(raw)`) — so every write still lands in
  // the same capture arrays and no assertion below had to change.
  //
  // BE CLEAR ABOUT WHAT THIS MODELS. It gives the handler a transaction SHAPE. It
  // does NOT roll anything back, so NO test in this file can prove the rollback that
  // makes the replayed receipt safe, and none claims to. That is the live spec's job
  // (tests/e2e/b340-gr-stock.spec.ts, "a REPLAY does not raise on-hand twice"), and
  // the revert probe is reported there rather than implied here.
  handle.transaction = (cb: (tx: unknown) => unknown) => cb(handle);
  return handle as unknown as Db;
}

function paramsOf(where: SQL | undefined): unknown[] {
  if (!where) return [];
  return new PgDialect().sqlToQuery(where).params;
}

/**
 * The SQL text a predicate compiles to. B-362: a row source that filters on a
 * bound VALUE alone cannot tell "the predicate is absent" from "the predicate
 * bound something else", so a where-blindness mutation would slip through it.
 * Reading the compiled SQL is how the fixture sees the COLUMN.
 */
function sqlOf(where: SQL | undefined): string {
  if (!where) return "";
  return new PgDialect().sqlToQuery(where).sql;
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

// A pr_item — the receipt's ORDERED line. B-360 made `boqItemId` load-bearing:
// a receipt may only price from a boq_item this PR actually ordered, so the
// default is the priced BOQ line the create tests name. Pass an explicit id (or
// null) to model an order that did NOT order that line.
const prLine = (id: string, qty: string, boqItemId: string | null = BOQ_ITEM) => ({
  id,
  prId: PR,
  boqItemId,
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

/**
 * B-348 — the SERVER's price source. gr.ts resolves a line's `boq_item_id`
 * through boq_item -> group -> doc -> project and takes `price` + `currency_code`
 * from the row it finds; a line whose id resolves to nothing is refused.
 */
const boqItemPriced = (id: string, price: string, currencyCode = "THB") => ({
  id,
  groupId: "g0",
  code: `C-${id}`,
  name: `boq ${id}`,
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

  // -------------------------------------------------------------------------
  // B-323 — deterministic row order.
  //
  // GET /gr issues six unordered selectThrough reads (INNER JOINs) and shipped
  // `[...poGrs, ...woGrs]` straight to the wire. Two freshly seeded stacks gave the
  // visual gate 0 px on one and 253,533 px (15.8%, the whole table body offset) on
  // the next, with no code change: the join plan flips and rows come back in a
  // different order. These pin the ORDER the endpoint emits regardless of the order
  // the reads produced.
  // -------------------------------------------------------------------------
  const grAt = (id: string, iso: string, anchor: "po" | "wo") => ({
    ...gr(id, anchor === "po" ? { poId: PO } : { woId: WO }),
    createdAt: new Date(iso),
  });

  const listIds = async (poArm: unknown[], woArm: unknown[]): Promise<string[]> => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [[grs, pos], poArm],
            [[grs, wos], woArm],
            [pos, [poRow("approved")]],
            [wos, [woRow("approved")]],
            [vendors, [vendorRow]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/gr" });
    expect(res.statusCode).toBe(200);
    return res.json().data.map((g: { id: string }) => g.id);
  };

  it("orders the UNIONed list newest-first ACROSS both anchors, not PO-block then WO-block", async () => {
    // Interleaved by date on purpose: sorting each arm and concatenating would give
    // [p1, p3, w2, w4] — a plausible-looking non-fix. The dates say [p1, w2, p3, w4].
    const po = [grAt("p3", "2026-07-20T08:59:58Z", "po"), grAt("p1", "2026-07-20T09:00:00Z", "po")];
    const wo = [grAt("w4", "2026-07-20T08:59:57Z", "wo"), grAt("w2", "2026-07-20T08:59:59Z", "wo")];
    expect(await listIds(po, wo)).toEqual(["p1", "w2", "p3", "w4"]);
  });

  it("emits the SAME order for every permutation the DB could return", async () => {
    const po = [
      grAt("p1", "2026-07-20T09:00:00Z", "po"),
      grAt("p3", "2026-07-20T08:59:58Z", "po"),
    ];
    const wo = [
      grAt("w2", "2026-07-20T08:59:59Z", "wo"),
      grAt("w4", "2026-07-20T08:59:57Z", "wo"),
    ];
    const expected = ["p1", "w2", "p3", "w4"];
    expect(await listIds(po, wo)).toEqual(expected);
    expect(await listIds([...po].reverse(), wo)).toEqual(expected);
    expect(await listIds(po, [...wo].reverse())).toEqual(expected);
    expect(await listIds([...po].reverse(), [...wo].reverse())).toEqual(expected);
  });

  it("breaks a same-instant tie on id, so rows written in one transaction still order", async () => {
    // Every seeded GR shared the transaction's now() before B-323, and two production
    // GRs created in the same second tie too. Without a tiebreak the order here is
    // whatever the reads happened to return.
    const same = "2026-07-20T09:00:00Z";
    const po = [grAt("gz", same, "po"), grAt("ga", same, "po")];
    const wo = [grAt("gm", same, "wo")];
    expect(await listIds(po, wo)).toEqual(["ga", "gm", "gz"]);
    expect(await listIds([...po].reverse(), wo)).toEqual(["ga", "gm", "gz"]);
  });

  it("renders a receipt's LINES in ENTRY order, not newest-first — and pins items[0].currency_code", async () => {
    // A receipt's lines are its ordered BODY, so they read ASCENDING. Round 1 sorted
    // them newestFirst, which printed every multi-line receipt upside down; the seed
    // could not show it because seed/stamp.ts staggers gr_item ASCENDING too, so the
    // rendered result matched the seed array either way.
    //
    // The reads are deliberately handed back in the WRONG order (the join plan's), and
    // the USD line is the one entered FIRST — so if the handler kept the read order,
    // or sorted the other way, the receipt would be labelled USD.
    const lines = [
      {
        ...grItem("gi-2nd", "g0", 1, 1, "10.00"),
        createdAt: new Date("2026-07-20T09:00:00.001Z"),
        currencyCode: "THB",
      },
      {
        ...grItem("gi-1st", "g0", 1, 1, "10.00"),
        createdAt: new Date("2026-07-20T09:00:00.000Z"),
        currencyCode: "USD",
      },
    ];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [[grs, pos], [gr("g0", { no: "GR-LINES", poId: PO, received: 3 })]],
            [[grs, wos], []],
            [[grItems, pos], lines],
            [[grItems, wos], []],
            [pos, [poRow("approved")]],
            [vendors, [vendorRow]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/gr" });
    const g0 = res.json().data.find((g: { id: string }) => g.id === "g0");
    expect(g0.items.map((i: { id: string }) => i.id)).toEqual(["gi-1st", "gi-2nd"]);
    expect(g0.currency_code).toBe("USD"); // items[0] AFTER the sort, not after the read
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
            [boqItems, [boqItemPriced(BOQ_ITEM, "300.00")]],
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
          // B-348: the price comes from BOQ_ITEM (300.00), NOT from this body.
          { qty_ok: 90, qty_rejected: 0, name: "ปูนซีเมนต์", ordered_qty: 100, unit: "ถุง", boq_item_id: BOQ_ITEM },
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

  // ── B-348: money = SERVER, on the line ───────────────────────────────────────
  it("IGNORES a client `price` and takes the line's money from its BOQ item (B-348)", async () => {
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
            // The SERVER's price for this BOQ line.
            [boqItems, [boqItemPriced(BOQ_ITEM, "1200.00", "THB")]],
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
          {
            qty_ok: 90,
            name: "ปูนซีเมนต์",
            ordered_qty: 100,
            unit: "ถุง",
            boq_item_id: BOQ_ITEM,
            // A client trying to originate the receipt's monetary value.
            price: 999999,
            currency_code: "USD",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const row = inserted.find((w) => w.table === grItems)!.rows[0] as {
      price: string;
      currencyCode: string;
    };
    expect(row.price).toBe("1200.00"); // the BOQ line's price, not 999999
    expect(row.currencyCode).toBe("THB"); // and its currency, not the body's USD
    // …and the SAME figure reaches the wire the GL inbox will agree with.
    expect(res.json().money).toBe(108000); // 90 × 1200
  });

  it("400s on a boq_item_id this tenant cannot see — an id that CHOOSES a price is resolved (B-348)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pos, [poRow("approved")]],
            [prs, [prRow]],
            [projects, [project]],
            // The order DID order this line (pr_item.boq_item_id is a bare FK with
            // no tenant predicate of its own), so the B-360 ordered-line gate passes
            // and the SCOPED price read is the guard under test here.
            [prItems, [prLine("l0", "1000", BOQ_ITEM_FOREIGN)]],
            [grs, [gr("new-0", { poId: PO, received: 90 })]],
            // The scoped read returns NOTHING for the foreign id.
            [boqItems, []],
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
          { qty_ok: 90, name: "ปูนซีเมนต์", ordered_qty: 90, boq_item_id: BOQ_ITEM_FOREIGN },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
    expect(res.json().message).toContain("not found in this tenant");
    // Nothing persisted — not the receipt, not the line.
    expect(inserted.find((w) => w.table === grs)).toBeFalsy();
    expect(inserted.find((w) => w.table === grItems)).toBeFalsy();
  });

  // ── B-360: the price source is THIS ORDER'S lines, not the tenant's BOQ ──────
  it("400s on a boq_item_id the order never ordered — the tenant door alone let a client PICK its price (B-360)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pos, [poRow("approved")]],
            [prs, [prRow]],
            [projects, [project]],
            // This PR ordered the 300.00 line …
            [prItems, [prLine("l0", "1000", BOQ_ITEM)]],
            [grs, [gr("new-0", { poId: PO, received: 2 })]],
            // … and BOTH lines are visible to this tenant, which is exactly why the
            // scoped BOQ read cannot refuse the expensive one.
            [
              boqItems,
              [
                boqItemPriced(BOQ_ITEM, "300.00", "THB"),
                boqItemPriced(BOQ_ITEM_USD, "1840000.00", "THB"),
              ],
            ],
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
          // The attack: 2 units priced off a line from somebody else's order.
          { qty_ok: 2, name: "ปูนซีเมนต์", ordered_qty: 2, boq_item_id: BOQ_ITEM_USD },
        ],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
    expect(res.json().message).toContain("not a line of this order");
    // Nothing persisted — no receipt, no priced line, no 3.68M.
    expect(inserted.find((w) => w.table === grs)).toBeFalsy();
    expect(inserted.find((w) => w.table === grItems)).toBeFalsy();
  });

  it("an order with NO lines can price NOTHING — a named boq_item is refused, not silently priced (B-360)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pos, [poRow("approved")]],
            [prs, [prRow]],
            [projects, [project]],
            [prItems, []], // a lump-sum order: no ordered line detail at all
            [grs, [gr("new-0", { poId: PO, received: 2 })]],
            [boqItems, [boqItemPriced(BOQ_ITEM, "300.00")]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: {
        po_id: PO,
        lines: [{ qty_ok: 2, name: "ปูนซีเมนต์", ordered_qty: 2, boq_item_id: BOQ_ITEM }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("not a line of this order");
    expect(inserted.find((w) => w.table === grs)).toBeFalsy();
  });

  it("the ordered-line gate refuses BEFORE the idempotency pre-check — a replay is never answered from our data (B-360)", async () => {
    const captured: Captured[] = [];
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [pos, [poRow("approved")]],
            [prs, [prRow]],
            [projects, [project]],
            [prItems, [prLine("l0", "1000", BOQ_ITEM)]],
            // A receipt ALREADY carrying this key: if the pre-check ran first it
            // would resolve and answer 201 with that original receipt.
            [
              grs,
              keyedGrs(
                { "replay-360": [gr("g-old", { poId: PO, received: 2 })] },
                [gr("g-old", { poId: PO, received: 2 })],
              ),
            ],
            [boqItems, [boqItemPriced(BOQ_ITEM_USD, "1840000.00")]],
          ],
          captured,
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: {
        po_id: PO,
        idempotency_key: "replay-360",
        lines: [{ qty_ok: 2, name: "x", ordered_qty: 2, boq_item_id: BOQ_ITEM_USD }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("not a line of this order");
    expect(inserted.find((w) => w.table === grs)).toBeFalsy();
  });

  it("a named line with NO boq_item_id stores 0.00 — 'unknown', never the body's number (B-348)", async () => {
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
        lines: [{ qty_ok: 90, name: "ปูนซีเมนต์", ordered_qty: 90, price: 300 }],
      },
    });
    expect(res.statusCode).toBe(201);
    const row = inserted.find((w) => w.table === grItems)!.rows[0] as { price: string };
    expect(row.price).toBe("0.00");
  });

  // ── B-TBD-QTY: the QUANTITY has a ceiling, because it posts to the ledger ─────
  //
  // B-360 made the server own the receipt's PRICE and the set of lines it may price
  // from, and left the QUANTITY wide open. Measured live at 80084a7: an order of
  // 10,000 × 142 received with qty_ok 99,999,999 answered 201 and posted JV-2026-0435
  // Dr 5020 / Cr 2010 14,199,999,858.00 — 14.2 BILLION on a 1,420,000 order.
  //
  // Every assertion here is written against GR_OVER_RECEIPT_TOLERANCE_PCT and never
  // against a literal, so Wei's final figure changes the tests with the constant.
  // ORDERED is 100 throughout, which makes the ceiling a whole number for any
  // sensible percentage.
  const ORDERED = 100;
  const CEILING = (ORDERED * (100 + GR_OVER_RECEIPT_TOLERANCE_PCT)) / 100;
  /** The fixture every over-receipt test shares: an order for ORDERED units @300. */
  const overReceiptDb = (opts: {
    prior?: unknown[];
    inserted?: Inserted[];
    captured?: Captured[];
    orderedQty?: string;
  }) =>
    stubDb({
      rows: [
        [pos, [poRow("approved")]],
        [prs, [prRow]],
        [projects, [project]],
        // THE BASIS. pr_item.qty is the only SERVER-owned ordered quantity — the
        // `ordered_qty` on the wire is the client's own number and falls back to its
        // own qty_ok, so a guard reading that would compare a claim to itself.
        [prItems, [prLine("l0", opts.orderedQty ?? String(ORDERED))]],
        [grs, [gr("new-0", { poId: PO, received: 0 })]],
        [grItems, cumulativeGrItems(opts.prior ?? [], [])],
        [boqItems, [boqItemPriced(BOQ_ITEM, "300.00")]],
        [vendors, [vendorRow]],
      ],
      inserted: opts.inserted,
      captured: opts.captured,
    });
  const receipt = (qtyOk: number, claimedOrdered = qtyOk) => ({
    po_id: PO,
    lines: [
      {
        qty_ok: qtyOk,
        name: "ปูนซีเมนต์",
        ordered_qty: claimedOrdered,
        boq_item_id: BOQ_ITEM,
      },
    ],
  });
  /** A prior receipt's line against the same BOQ item (what is already received). */
  const priorLine = (id: string, received: number) => ({
    ...grItem(id, `g-${id}`, ORDERED, received, "300.00"),
    boqItemId: BOQ_ITEM,
  });

  it("THE EXPLOIT, closed: 99,999,999 against an order of 100 is 400, and NOTHING is written", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: overReceiptDb({ inserted }) })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      // THE DISCRIMINATOR: the body claims it ordered 99,999,999 too. A guard reading
      // gr_item.ordered_qty would compare the client's number to the client's number
      // and pass this unchanged — which is why the basis has to be pr_item.qty.
      payload: receipt(99_999_999, 99_999_999),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
    expect(res.json().message).toContain("over-receipt tolerance");
    // No priced line and no stock movement — both are written AFTER the ceiling, so
    // their absence is a real property this stub can see.
    expect(inserted.find((w) => w.table === grItems)).toBeFalsy();
    expect(inserted.find((w) => w.table === stockLedgers)).toBeFalsy();
    // THE `gr` HEADER ROW IS A STUB ARTEFACT HERE, and saying so is the point. The
    // ceiling is checked AFTER the header insert (it must be — the insert is what
    // trips gr_idempotency_uq, so moving the check in front of it would answer a
    // concurrent B-261 replay with a 400 instead of the storekeeper's own receipt).
    // The throw rolls that insert back on real Postgres; this stub's
    // `transaction = (cb) => cb(handle)` gives a transaction SHAPE and does NOT roll
    // back, exactly as this file's header says, so the capture still holds the row.
    // "No gr row exists" is therefore the LIVE spec's assertion, read back out of
    // Postgres, and is deliberately NOT claimed here.
    expect(inserted.find((w) => w.table === grs)).toBeTruthy();
  });

  it("a legitimate receipt still works: 3 against an order of 100 is 201, priced by the server", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: overReceiptDb({ inserted }) })
    ).inject({ method: "POST", url: "/api/v1/gr", payload: receipt(3) });
    expect(res.statusCode).toBe(201);
    expect(res.json().money).toBe(900); // 3 × 300.00, the server's price
    expect(inserted.find((w) => w.table === grItems)).toBeTruthy();
  });

  it("AT the ceiling is 201 — the tolerance PERMITS over-receipt, it is not a hard cap", async () => {
    // The prototype deliberately allows over-receipt: mobile-field.jsx:46 clamps only
    // the LOWER bound, :76 renders `เกิน {n}` in INFO tone, and an over-receipt takes
    // the green "ยืนยันรับของครบ" path. A hard cap at ORDERED would contradict that.
    expect(CEILING).toBeGreaterThan(ORDERED); // the probe is discriminating
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: overReceiptDb({}) })
    ).inject({ method: "POST", url: "/api/v1/gr", payload: receipt(CEILING) });
    expect(res.statusCode).toBe(201);
  });

  it("ONE UNIT over the ceiling is 400 — the boundary, from the other side", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: overReceiptDb({}) })
    ).inject({ method: "POST", url: "/api/v1/gr", payload: receipt(CEILING + 1) });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain("over-receipt tolerance");
  });

  it("CUMULATIVE, not per-request: 40 already received + 40 more clears, + the rest does not", async () => {
    // A per-request check would pass BOTH of these. `PO → N GR` is the spec's own
    // cardinality (data-dictionary.html:65) and gr.create.balanceRemaining draws the
    // balance down per line across receipts, so partial receipts are the normal case.
    const under = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: overReceiptDb({ prior: [priorLine("p0", 40)] }),
      })
    ).inject({ method: "POST", url: "/api/v1/gr", payload: receipt(40) });
    expect(under.statusCode).toBe(201); // 40 + 40 = 80, well under

    const over = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: overReceiptDb({ prior: [priorLine("p0", 40)] }),
      })
    ).inject({ method: "POST", url: "/api/v1/gr", payload: receipt(CEILING - 40 + 1) });
    expect(over.statusCode).toBe(400); // 40 + (ceiling − 40 + 1) = ceiling + 1
    expect(over.json().message).toContain("over-receipt tolerance");
  });

  it("splitting one line in two does not evade the ceiling — a request is summed per boq_item", async () => {
    const half = CEILING / 2;
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: overReceiptDb({}) })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: {
        po_id: PO,
        lines: [
          { qty_ok: half + 1, name: "a", ordered_qty: half + 1, boq_item_id: BOQ_ITEM },
          { qty_ok: half + 1, name: "b", ordered_qty: half + 1, boq_item_id: BOQ_ITEM },
        ],
      },
    });
    // Neither line alone exceeds the ceiling; together they do by 2.
    expect(half + 1).toBeLessThan(CEILING);
    expect(res.statusCode).toBe(400);
  });

  it("only ACTIVE receipts count — the cumulative read filters on gr.status, so a return frees its quantity", async () => {
    // A returned/cancelled receipt has had its stock reversed and its goods have gone
    // back to the vendor. The row source here is where-BLIND, so it cannot prove the
    // filter by returning fewer rows — the proof is the COLUMN in the compiled SQL
    // (the B-362 shape: a value-only fixture cannot tell "no predicate" from "a
    // different predicate").
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: overReceiptDb({ captured, prior: [] }),
      })
    ).inject({ method: "POST", url: "/api/v1/gr", payload: receipt(CEILING) });
    expect(res.statusCode).toBe(201);
    const cumulative = captured.filter(
      (c) => c.table === grItems && sqlOf(c.where).includes('"status"'),
    );
    expect(cumulative).toHaveLength(1);
    expect(paramsOf(cumulative[0]!.where)).toContain("received");
  });

  it("an UN-QUANTIFIED line (pr_item.qty = 0) has NO ceiling — a tolerance on 0 would make it unreceivable", async () => {
    // pr_item.qty defaults to '0' and a WO's lump-sum งานเหมา has no BOQ qty source at
    // all. 0 × (1 + tol) = 0, so a naive guard would refuse EVERY receipt against such
    // an order — a worse break than the hole. Same answer the auto-close already gives
    // ("an un-quantified order never auto-closes", GAP 3). THE RESIDUAL IS REAL and is
    // pinned here rather than hidden: this line has no quantity ceiling.
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: overReceiptDb({ orderedQty: "0" }),
      })
    ).inject({ method: "POST", url: "/api/v1/gr", payload: receipt(99_999_999) });
    expect(res.statusCode).toBe(201);
  });

  // ── B-323 round 2: the PRODUCTION tie the seed can never reproduce ────────────
  //
  // The seed hands every gr_item a distinct created_at (seed/stamp.ts), so a
  // seed-based test proves NOTHING about line order. In production a receipt's lines
  // are written by ONE insertThrough — one INSERT, one now() — so all N lines take the
  // same instant and every reader falls through to the defaultRandom() uuid. These two
  // tests are the pair: the writer must record entry order, and the reader must
  // recover it from what the writer recorded.
  it("RECORDS entry order: a 3-line receipt is written with 3 DISTINCT, increasing created_at", async () => {
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
            [grs, [gr("new-0", { poId: PO, received: 6 })]],
          ],
          inserted,
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: {
        po_id: PO,
        no: "GR-2026-0199",
        lines: [
          { qty_ok: 1, qty_rejected: 0, name: "ปูนซีเมนต์", ordered_qty: 1, unit: "ถุง", price: 300 },
          { qty_ok: 2, qty_rejected: 0, name: "เหล็กเส้น", ordered_qty: 2, unit: "เส้น", price: 300 },
          { qty_ok: 3, qty_rejected: 0, name: "ทราย", ordered_qty: 3, unit: "คิว", price: 300 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const rows = inserted.find((w) => w.table === grItems)!.rows as {
      name: string;
      createdAt: Date;
    }[];
    expect(rows.map((r) => r.name)).toEqual(["ปูนซีเมนต์", "เหล็กเส้น", "ทราย"]);

    // Without stampEntryOrder these are all `undefined` and Postgres gives all three
    // the transaction's single now() — the tie that makes the random uuid decisive.
    const times = rows.map((r) => r.createdAt?.getTime());
    expect(times.every((t) => typeof t === "number")).toBe(true);
    expect(new Set(times).size).toBe(3);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
  });

  it("RECOVERS entry order: those same 3 lines render top-down even with adversarial uuids", async () => {
    // The uuids are chosen so that uuid order is the REVERSE of entry order, and the
    // reads are handed back in a third, scrambled order. Only created_at can produce
    // the right answer — which is exactly why the write path has to stamp it.
    const t0 = new Date("2026-07-20T09:00:00.000Z").getTime();
    const written = [
      { ...grItem("ffff-cement", "g0", 1, 1, "300.00"), createdAt: new Date(t0) },
      { ...grItem("7777-steel", "g0", 2, 2, "300.00"), createdAt: new Date(t0 + 1) },
      { ...grItem("0000-sand", "g0", 3, 3, "300.00"), createdAt: new Date(t0 + 2) },
    ];
    const scrambled = [written[2]!, written[0]!, written[1]!];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({
          rows: [
            [[grs, pos], [gr("g0", { no: "GR-2026-0199", poId: PO, received: 6 })]],
            [[grs, wos], []],
            [[grItems, pos], scrambled],
            [[grItems, wos], []],
            [pos, [poRow("approved")]],
            [vendors, [vendorRow]],
          ],
        }),
      })
    ).inject({ url: "/api/v1/gr" });
    const g0 = res.json().data.find((g: { id: string }) => g.id === "g0");
    expect(g0.items.map((i: { id: string }) => i.id)).toEqual([
      "ffff-cement",
      "7777-steel",
      "0000-sand",
    ]);
    // The uuid order the pre-fix code would have produced — asserted as a FOIL so this
    // test cannot pass by accident if entryOrder silently degrades to the id tiebreak.
    expect([...g0.items].map((i: { id: string }) => i.id).sort()).toEqual([
      "0000-sand",
      "7777-steel",
      "ffff-cement",
    ]);
  });

  it("a receipt whose lines DID tie (written before the fix) still renders deterministically", async () => {
    // Rows already in the database carry the old tied timestamps and cannot be
    // repaired. entryOrder must still be TOTAL over them — deterministically wrong
    // beats nondeterministic, because the visual gate can at least hold the line.
    const tied = new Date("2026-07-20T09:00:00.000Z");
    const legacy = [
      { ...grItem("ffff-cement", "g0", 1, 1, "300.00"), createdAt: tied },
      { ...grItem("0000-sand", "g0", 3, 3, "300.00"), createdAt: tied },
    ];
    const ids = async (rows: unknown[]): Promise<string[]> => {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({
            rows: [
              [[grs, pos], [gr("g0", { no: "GR-LEGACY", poId: PO, received: 4 })]],
              [[grs, wos], []],
              [[grItems, pos], rows],
              [[grItems, wos], []],
              [pos, [poRow("approved")]],
              [vendors, [vendorRow]],
            ],
          }),
        })
      ).inject({ url: "/api/v1/gr" });
      const g0 = res.json().data.find((g: { id: string }) => g.id === "g0");
      return g0.items.map((i: { id: string }) => i.id);
    };
    expect(await ids(legacy)).toEqual(["0000-sand", "ffff-cement"]);
    expect(await ids([...legacy].reverse())).toEqual(["0000-sand", "ffff-cement"]);
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
            // B-360: BOTH lines are on this order, so the ordered-line gate passes
            // and the currency guard is the one under test.
            [prItems, [prLine("l0", "1000", BOQ_ITEM), prLine("l1", "1000", BOQ_ITEM_USD)]],
            [grs, [gr("new-0", { poId: PO, received: 5 })]],
            // B-348: the currencies compared are the BOQ lines' own, not the body's
            // — the handler no longer reads a client currency_code at all.
            [
              boqItems,
              [
                boqItemPriced(BOQ_ITEM, "300.00", "THB"),
                boqItemPriced(BOQ_ITEM_USD, "400.00", "USD"),
              ],
            ],
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
          { qty_ok: 3, name: "ปูนซีเมนต์", ordered_qty: 3, unit: "ถุง", boq_item_id: BOQ_ITEM },
          { qty_ok: 2, name: "steel", ordered_qty: 2, unit: "ton", boq_item_id: BOQ_ITEM_USD },
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
  // ── B-348: a POSTED receipt is frozen ────────────────────────────────────────
  //
  // These exist because THIS round created the hazard: until gr carried a money
  // value, return/cancel had no JV to contradict. A return after the post would
  // leave Dr 5020 / Cr 2010 standing for goods that went back to the vendor, and
  // nothing in the return path touches `jv`.
  const postedJv = (grId: string) => ({
    id: "jv-posted",
    companyId: COMPANY,
    no: "JV-2026-0500",
    sourceDoc: `gr:${grId}`,
  });

  /**
   * B-362 — jv rows answered THE WAY A DATABASE WOULD, i.e. by the WHERE.
   *
   * The base stub's `rowsFor` is where-BLIND: whatever a `[jvs, rows]` entry holds
   * comes back for every jv read. So the two freeze tests each injected their own
   * answer — one supplied the posting JV, the other supplied `[]` and called that
   * "a jv posting a DIFFERENT receipt". Neither could see the predicate, and the
   * mutation `db.select(jvs, eq(jvs.sourceDoc, …))` -> `db.select(jvs)` passed
   * 85/85. Live that regression is a total outage of the return path: the seeded
   * tenant carries many jv rows, so EVERY return and cancel would 409, with the api
   * suite green.
   *
   * This models the real filter: a read whose SQL mentions `source_doc` returns only
   * the rows carrying a bound value; a read that does NOT (the where-blind mutation)
   * returns the tenant's WHOLE jv set — which is exactly what Postgres would hand
   * back, and exactly what makes the freeze fire on somebody else's JV.
   */
  const jvsByWhere =
    (rows: ReturnType<typeof postedJv>[]) =>
    (where: SQL | undefined): unknown[] => {
      if (!sqlOf(where).includes("source_doc")) return rows; // where-blind read
      const params = paramsOf(where);
      return rows.filter((r) => params.includes(r.sourceDoc));
    };

  for (const verb of ["return", "cancel"] as const) {
    it(`${verb}: 409 when a JV has already posted this receipt (B-348)`, async () => {
      const updated: Updated[] = [];
      const inserted: Inserted[] = [];
      const G = gr("g0", { poId: PO, status: "received" });
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({
            rows: [[grs, [G]], [jvs, jvsByWhere([postedJv("g0")])]],
            updated,
            inserted,
            updateBase: G,
          }),
        })
      ).inject({ method: "POST", url: `/api/v1/gr/g0/${verb}` });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("INVALID_STATE");
      expect(res.json().message).toContain("posted");
      // The status is never flipped and NO stock reversal is written.
      expect(updated.find((u) => u.table === grs)).toBeUndefined();
      expect(inserted.find((i) => i.table === stockLedgers)).toBeUndefined();
    });

    it(`${verb}: a jv posting a DIFFERENT receipt does not freeze this one (B-348/B-362)`, async () => {
      const updated: Updated[] = [];
      const G = gr("g0", { poId: PO, status: "received" });
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({
            // A jv that REALLY EXISTS in this tenant and posts ANOTHER receipt.
            // The predicate `jv.source_doc = 'gr:g0'` is what excludes it; drop the
            // predicate and this row comes back and freezes g0.
            rows: [[grs, [G]], [jvs, jvsByWhere([postedJv("g-other")])]],
            updated,
            updateBase: G,
          }),
        })
      ).inject({ method: "POST", url: `/api/v1/gr/g0/${verb}` });
      expect(res.statusCode).toBe(200);
      expect(updated.find((u) => u.table === grs)).toBeTruthy(); // the flip happened
    });

    it(`${verb}: the freeze read BINDS this receipt's source_doc (B-362)`, async () => {
      // The predicate itself, asserted rather than inferred from an outcome: every
      // jv read this request issues is scoped to `gr:<this id>`.
      const captured: Captured[] = [];
      const G = gr("g0", { poId: PO, status: "received" });
      await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({
            rows: [[grs, [G]], [jvs, jvsByWhere([])]],
            captured,
            updateBase: G,
          }),
        })
      ).inject({ method: "POST", url: `/api/v1/gr/g0/${verb}` });
      const jvReads = captured.filter((c) => c.table === jvs);
      expect(jvReads.length).toBeGreaterThan(0);
      for (const read of jvReads) {
        expect(sqlOf(read.where)).toContain("source_doc");
        expect(paramsOf(read.where)).toContain("gr:g0");
      }
    });

    // ── B-362: the IN-TRANSACTION re-check, which had no coverage at all ────────
    it(`${verb}: a JV that lands BETWEEN the pre-check and the transaction still freezes it (B-362)`, async () => {
      // The real interleaving the in-tx re-check exists for: /gl/post commits after
      // this handler's pre-check read and before its own COMMIT. Deleting that
      // re-check used to kill NOTHING (85/85 green) — the pre-check answered every
      // freeze test on its own.
      const updated: Updated[] = [];
      const inserted: Inserted[] = [];
      const G = gr("g0", { poId: PO, status: "received" });
      const landed: ReturnType<typeof postedJv>[] = [];
      let jvReads = 0;
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb({
            rows: [
              [grs, [G]],
              [
                jvs,
                (where: SQL | undefined) => {
                  // 1st read = the pre-check: nothing posted yet.
                  // 2nd read = inside the transaction, AFTER the guarded flip: by
                  // then the concurrent post has committed its JV.
                  if (++jvReads === 1) return [];
                  if (landed.length === 0) landed.push(postedJv("g0"));
                  return jvsByWhere(landed)(where);
                },
              ],
            ],
            updated,
            inserted,
            updateBase: G,
          }),
        })
      ).inject({ method: "POST", url: `/api/v1/gr/g0/${verb}` });

      expect(jvReads).toBeGreaterThanOrEqual(2); // the pre-check AND the re-check ran
      expect(res.statusCode).toBe(409); // never 500 — sync_processor defers 5xx
      expect(res.json().code).toBe("INVALID_STATE");
      expect(res.json().message).toContain("posted");
      // The guarded flip was ATTEMPTED (that is what takes the row lock) and the
      // stock reversal never ran — the throw happens between them, so the real
      // transaction rolls the flip back with it.
      expect(updated.find((u) => u.table === grs)).toBeTruthy();
      expect(inserted.find((i) => i.table === stockLedgers)).toBeUndefined();
    });
  }

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

/**
 * B-264: POST /gr resolves the client's OWN receipt by idempotency_key BEFORE the
 * anchor status gate, so a keyed create issues TWO kinds of grs read — the keyed
 * resolve (pre-check, and again in the 23505 catch) and the unkeyed anchor reads
 * (the cumulative received_total). The row-blind stub answers every grs read the
 * same, so this splits them: a read whose WHERE binds one of `byKey`'s keys gets
 * that key's rows (what the key resolves to — [] = not stored yet, or another
 * tenant's/anchor's key we cannot see); every other grs read gets `unkeyed`.
 * Pass a MUTABLE array as a key's rows to model a row that lands mid-flight (the
 * original committing between our pre-check and our insert = the real race).
 */
const keyedGrs =
  (byKey: Record<string, unknown[]>, unkeyed: unknown[] = []) =>
  (where: SQL | undefined): unknown[] => {
    const params = paramsOf(where);
    for (const [key, rows] of Object.entries(byKey)) {
      if (params.includes(key)) return rows;
    }
    return unkeyed;
  };

/**
 * B-TBD-QTY: a gr_item row source that can tell the create path's CUMULATIVE read
 * — "everything already received against this anchor", whose predicate names
 * `gr.status` — from a read of ONE receipt's own lines (grItemsFor / the replay
 * envelope), whose predicate names `gr_item.gr_id`.
 *
 * WHY IT HAD TO EXIST. The row-blind stub returns one row set per table, so a single
 * `[grItems, …]` entry served BOTH reads. A fixture that meant "this is the first
 * receipt against the order" was therefore silently also saying "1000 units have
 * already been received against it" — which the over-receipt ceiling then, correctly,
 * refused. Reading the COLUMN out of the compiled SQL is how the fixture sees the
 * difference (the B-362 precedent, and the reason sqlOf exists).
 */
const cumulativeGrItems =
  (prior: unknown[], own: unknown[]) =>
  (where: SQL | undefined): unknown[] =>
    sqlOf(where).includes('"status"') ? prior : own;

/** Every grs read this request made whose WHERE bound the client key. */
const keyedReads = (captured: Captured[], key = IDEMP_KEY): Captured[] =>
  captured.filter((c) => c.table === grs && paramsOf(c.where).includes(key));

describe("POST /api/v1/gr — B-261 idempotency (client key + replay)", () => {
  it("same idempotency_key twice → ONE receipt: the replay returns the ORIGINAL byte-for-byte, no 2nd insert", async () => {
    const inserted: Inserted[] = [];
    // The ORIGINAL receipt the replay must resolve. createdAt undefined mirrors the
    // fresh insert's RETURNING (the handler never sets it — the DB defaults it), so
    // the two responses serialize identically (a real replay reads the DB-stamped row).
    const original = { ...gr("new-0", { poId: PO, received: 300 }), createdAt: undefined };
    // What the client key resolves to: nothing before the first create commits.
    const stored: unknown[] = [];
    const db = stubDb({
      rows: [
        [pos, [poRow("approved")]],
        [prs, [prRow]],
        [projects, [project]],
        [prItems, [prLine("l0", "1000")]], // ordered 1000 → partial
        [grs, keyedGrs({ [IDEMP_KEY]: stored }, [original])],
        [vendors, [vendorRow]],
      ],
      inserted,
      // the 2nd create (the replay) trips the idempotency index; the 1st inserts fine.
      insertThrows: (table, nth) => (table === grs && nth >= 1 ? uniqueViolation() : null),
    });
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db });
    const payload = { po_id: PO, idempotency_key: IDEMP_KEY, lines: [{ qty_ok: 300, qty_rejected: 0 }] };
    const res1 = await app.inject({ method: "POST", url: "/api/v1/gr", payload });
    stored.push(original); // the first receipt is now committed — the key resolves
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
        // neither key is stored → both pre-checks miss → two real creates.
        [grs, keyedGrs({ "key-A": [], "key-B": [] }, [gr("g", { poId: PO, received: 300 })])],
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
// B-264 — the replay must survive an ORDER-CLOSING receipt.
// B-261's replay lived only in the insert's 23505 catch, which sits BELOW the
// anchor status gate — and a FULL receipt closes the PO/WO in this same handler.
// So the exact scenario the key exists for (commit succeeded → response lost →
// SyncProcessor replays) hit `po.status !== "approved"` and got 409 INVALID_STATE
// for goods that WERE received; sync_processor.dart dead-letters every 4xx
// permanently, so the storekeeper saw FAILED with no in-app recovery. This is
// st-receive's HAPPY path (mobile-field.jsx defaults recv = ordered), yet every
// B-261 test seeded a PARTIAL receipt (qty_ok 300 of 1000) — which is precisely
// why it survived. The fix resolves the client's own receipt BEFORE that gate.
// ---------------------------------------------------------------------------

describe("POST /api/v1/gr — B-264 (an order-closing receipt is still replayable)", () => {
  const PO2 = "dddddddd-dddd-dddd-dddd-dddddddddd02";
  const FRESH_KEY = "9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";

  it("FULL receipt closes the PO — replaying the same key STILL returns the original 201 (not 409), with ONE gr + ONE line + ONE defect written", async () => {
    const inserted: Inserted[] = [];
    const updated: Updated[] = [];
    // The persisted rows the replay re-reads. They mirror what request 1's inserts
    // RETURNed (the stub ids run new-0 gr → new-1 gr_item → new-2 defect, in handler
    // order), so the replay rebuilds a byte-identical envelope from real state.
    const original = {
      ...gr("new-0", { poId: PO, received: 1000, rejected: 50 }),
      createdAt: undefined,
    };
    const originalItem = {
      id: "new-1",
      grId: "new-0",
      // B-348: the line prices off a real BOQ item, so the replay rebuilds the
      // same envelope from the same SERVER-owned number.
      boqItemId: BOQ_ITEM,
      name: "ปูนซีเมนต์",
      orderedQty: "1000",
      receivedQty: "1000",
      unit: "ถุง",
      price: "300.00",
      currencyCode: "THB",
      createdAt: undefined,
      updatedAt: undefined,
    };
    const originalDefect = {
      id: "new-2",
      grId: "new-0",
      note: "GR new-0: 50 rejected (ตีกลับ)",
    };
    // The PO the receipt closes — MUTABLE, because closing it is the whole defect.
    const po = poRow("approved");
    const stored: unknown[] = []; // what the client key resolves to (nothing yet)
    const db = stubDb({
      rows: [
        [pos, [po]],
        [prs, [prRow]],
        [projects, [project]],
        [prItems, [prLine("l0", "1000")]], // ordered 1000 → a 1000 receipt is FULL
        [grs, keyedGrs({ [IDEMP_KEY]: stored }, [original])],
        // B-TBD-QTY: NOTHING has been received against this order yet (request 1 is
        // the first receipt) — `originalItem` is what the REPLAY re-reads back as
        // its own line, and must not double as "already received".
        [grItems, cumulativeGrItems([], [originalItem])],
        [defectReports, [originalDefect]],
        [vendors, [vendorRow]],
        [boqItems, [boqItemPriced(BOQ_ITEM, "300.00")]],
      ],
      inserted,
      updated,
    });
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db });
    const payload = {
      po_id: PO,
      idempotency_key: IDEMP_KEY,
      lines: [
        {
          name: "ปูนซีเมนต์",
          ordered_qty: 1000,
          qty_ok: 1000, // the whole order — st-receive's default recv = ordered
          qty_rejected: 50,
          unit: "ถุง",
          boq_item_id: BOQ_ITEM,
        },
      ],
    };

    const res1 = await app.inject({ method: "POST", url: "/api/v1/gr", payload });
    expect(res1.statusCode).toBe(201);
    expect(res1.json().partial).toBe(false); // the order is fully received…
    // …so this very handler closed the PO — the state that used to strand the replay.
    // B-TBD-QTY: `po` now takes TWO writes on a priced receipt — the ANCHOR LOCK
    // (updated_at only) and the auto-close — so the close is selected by the column
    // it sets rather than by being the only po write.
    const closes = updated.filter((u) => u.table === pos && "status" in u.set);
    expect(closes).toHaveLength(1);
    expect(closes[0]!.set).toEqual({ status: "closed" });
    // …and the lock is the FIRST of the two. Order is the whole guarantee: it has to
    // precede the gr insert, whose FK takes KEY SHARE on this same row (upgrading
    // that from two transactions at once is a deadlock, not a wait).
    const poWrites = updated.filter((u) => u.table === pos);
    expect(poWrites).toHaveLength(2);
    expect(Object.keys(poWrites[0]!.set)).toEqual(["updatedAt"]);

    // The response never reached the client (the SyncProcessor's lost 201). The
    // world moved on exactly as the handler left it: the PO is closed, the receipt
    // and its key are committed.
    po.status = "closed";
    stored.push(original);

    const res2 = await app.inject({ method: "POST", url: "/api/v1/gr", payload });

    // THE FIX: the storekeeper's replay is answered with their OWN receipt.
    expect(res2.statusCode).toBe(201); // was 409 INVALID_STATE → permanent dead-letter
    expect(res2.json()).toEqual(res1.json()); // byte-identical, same envelope builder
    expect(res2.json().id).toBe("new-0");
    expect(res2.json().received).toBe(1000);
    expect(res2.json().money).toBe(300000); // 1000 × 300.00 — money re-read, not re-derived
    // …and NOTHING was written twice across the two requests.
    expect(inserted.filter((w) => w.table === grs)).toHaveLength(1);
    expect(inserted.filter((w) => w.table === grItems)).toHaveLength(1);
    expect(inserted.filter((w) => w.table === defectReports)).toHaveLength(1);
    // B-TBD-QTY: the CLOSE, selected by column — the replay takes no anchor lock at
    // all (it never enters the transaction), so the po write count would otherwise
    // conflate "no second close" with "no second lock".
    expect(updated.filter((u) => u.table === pos && "status" in u.set)).toHaveLength(1);
  });

  it("the same key against a DIFFERENT PO does NOT hand back the first PO's receipt (409, never someone else's document)", async () => {
    const original = { ...gr("new-0", { poId: PO, received: 1000 }), createdAt: undefined };
    const po2 = { ...poRow("approved"), id: PO2 };
    const db = stubDb({
      rows: [
        [pos, [po2]],
        [prs, [prRow]],
        [projects, [project]],
        [prItems, [prLine("l0", "1000")]],
        // The keyed resolve binds the key AND the anchor po_id. The ORIGINAL hangs
        // off PO, so a resolve anchored on PO2 matches nothing — that anchor filter
        // is the assertion here; a key-ONLY lookup would return the wrong receipt.
        [
          grs,
          (where) => {
            const p = paramsOf(where);
            if (!p.includes(IDEMP_KEY)) return [];
            return p.includes(PO) ? [original] : [];
          },
        ],
        [vendors, [vendorRow]],
      ],
      // the key is globally taken (gr_idempotency_uq is a partial index on the key
      // ALONE), so the insert collides even though the anchor differs.
      insertThrows: (table) => (table === grs ? uniqueViolation() : null),
    });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO2, idempotency_key: IDEMP_KEY, lines: [{ qty_ok: 1000 }] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_STATE");
    expect(res.json().id).toBeUndefined(); // PO's receipt was NOT leaked onto PO2
  });

  it("cross-tenant: company B replaying company A's key gets nothing of A's — both keyed resolves bind B's company_id", async () => {
    const captured: Captured[] = [];
    const db = stubDb({
      rows: [
        [pos, [poRow("approved")]],
        [prs, [prRow]],
        [projects, [project]],
        [prItems, [prLine("l0", "1000")]],
        // A's receipt is invisible through B's chain — the keyed resolve (pre-check
        // AND catch) is a selectThrough, not a bare `where idempotency_key = …`.
        [grs, keyedGrs({ [IDEMP_KEY]: [] }, [])],
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
      payload: { po_id: PO, idempotency_key: IDEMP_KEY, lines: [{ qty_ok: 1000 }] },
    });
    expect(res.statusCode).toBe(409); // an honest refusal, never A's receipt
    expect(res.json().id).toBeUndefined();
    // both keyed resolves ran (pre-check, then the catch) and BOTH were scoped to B.
    const keyed = keyedReads(captured);
    expect(keyed).toHaveLength(2);
    for (const c of keyed) {
      expect(paramsOf(c.where)).toContain(COMPANY);
      expect(paramsOf(c.where)).not.toContain(OTHER_COMPANY);
    }
  });

  it("a FRESH receipt against a CLOSED PO is still 409 — the pre-check only excuses a key that resolves", async () => {
    const captured: Captured[] = [];
    const inserted: Inserted[] = [];
    const db = stubDb({
      rows: [
        [pos, [poRow("closed")]], // already fully received
        [prs, [prRow]],
        [projects, [project]],
        [prItems, [prLine("l0", "1000")]],
        [grs, keyedGrs({ [FRESH_KEY]: [] }, [])], // the new key resolves to nothing
        [vendors, [vendorRow]],
      ],
      captured,
      inserted,
    });
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db });
    for (const body of [
      { po_id: PO, lines: [{ qty_ok: 10 }] }, // no key at all (a web client)
      { po_id: PO, idempotency_key: FRESH_KEY, lines: [{ qty_ok: 10 }] }, // a NEW key
    ]) {
      const res = await app.inject({ method: "POST", url: "/api/v1/gr", payload: body });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("INVALID_STATE");
      expect(res.json().message).toMatch(/approved \(open\) PO/);
    }
    expect(inserted.filter((w) => w.table === grs)).toHaveLength(0); // nothing received
  });

  it("a blank / whitespace / absent key never enters the replay branch (and never matches a stored NULL)", async () => {
    const captured: Captured[] = [];
    const inserted: Inserted[] = [];
    const db = stubDb({
      rows: [
        [pos, [poRow("approved")]],
        [prs, [prRow]],
        [projects, [project]],
        [prItems, [prLine("l0", "1000")]],
        // a pre-existing key-less receipt on this PO (idempotency_key IS NULL) —
        // a blank key must never resolve to it.
        [grs, [gr("g-null", { poId: PO, received: 100 })]],
        [vendors, [vendorRow]],
      ],
      captured,
      inserted,
    });
    const app = await buildTestApp({ resolveTenant: async () => SESSION, db });
    for (const body of [
      { po_id: PO, idempotency_key: "   ", lines: [{ qty_ok: 10 }] },
      { po_id: PO, idempotency_key: "", lines: [{ qty_ok: 10 }] },
      { po_id: PO, lines: [{ qty_ok: 10 }] },
    ]) {
      const res = await app.inject({ method: "POST", url: "/api/v1/gr", payload: body });
      expect(res.statusCode).toBe(201);
      expect(res.json().id).not.toBe("g-null"); // a real create, not the NULL-key row
    }
    // three real receipts, each persisting a NULL key — and no read ever bound a blank.
    const grInserts = inserted.filter((w) => w.table === grs);
    expect(grInserts).toHaveLength(3);
    for (const w of grInserts) {
      expect((w.rows[0] as { idempotencyKey: string | null }).idempotencyKey).toBe(null);
    }
    for (const c of captured.filter((c) => c.table === grs)) {
      expect(paramsOf(c.where)).not.toContain("   ");
      expect(paramsOf(c.where)).not.toContain("");
    }
  });

  // -------------------------------------------------------------------------
  // B-309 — a PRESENT but NON-STRING key
  // -------------------------------------------------------------------------
  // The blank cases above are all STRINGS: they exercise `.trim()` and never the type
  // coercion, which is why str() swallowing a NUMBER survived review here AND in the
  // B-307 copy of this template. A number collapsed to null → dedup silently OFF while
  // the client believed it had sent a key → the replay received the goods a second
  // time. The insert-count assertion is the load-bearing one.
  it.each([
    ["a JSON number (the live-proven case)", 123],
    ["a float", 1.5],
    ["a boolean", true],
    ["an array", [FRESH_KEY]],
    ["an object", { key: FRESH_KEY }],
  ])(
    "B-309: %s idempotency_key → 400 VALIDATION and NO receipt is written (never a silent no-key create)",
    async (_label, key) => {
      const inserted: Inserted[] = [];
      const captured: Captured[] = [];
      const db = stubDb({
        rows: [
          [pos, [poRow("approved")]],
          [prs, [prRow]],
          [projects, [project]],
          [prItems, [prLine("l0", "1000")]],
          [grs, []],
          [vendors, [vendorRow]],
        ],
        captured,
        inserted,
      });
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db })
      ).inject({
        method: "POST",
        url: "/api/v1/gr",
        payload: { po_id: PO, idempotency_key: key, lines: [{ qty_ok: 10 }] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("VALIDATION");
      expect(res.json().message).toMatch(/idempotency_key must be a string/);
      expect(inserted.filter((w) => w.table === grs)).toHaveLength(0); // nothing received
      expect(captured.filter((c) => c.table === grs)).toHaveLength(0); // never even looked
    },
  );

  it("B-309: the camelCase alias is guarded too — {idempotencyKey: 123} → 400, no receipt", async () => {
    const inserted: Inserted[] = [];
    const db = stubDb({
      rows: [
        [pos, [poRow("approved")]],
        [prs, [prRow]],
        [projects, [project]],
        [prItems, [prLine("l0", "1000")]],
        [grs, []],
        [vendors, [vendorRow]],
      ],
      inserted,
    });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, idempotencyKey: 123, lines: [{ qty_ok: 10 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(inserted.filter((w) => w.table === grs)).toHaveLength(0);
  });

  it("B-309: an EXPLICIT null is ABSENT, not invalid — 201, persists null, binds no key in any read", async () => {
    const inserted: Inserted[] = [];
    const captured: Captured[] = [];
    const db = stubDb({
      rows: [
        [pos, [poRow("approved")]],
        [prs, [prRow]],
        [projects, [project]],
        [prItems, [prLine("l0", "1000")]],
        [grs, [gr("g-null", { poId: PO, received: 100 })]],
        [vendors, [vendorRow]],
      ],
      captured,
      inserted,
    });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, idempotency_key: null, lines: [{ qty_ok: 10 }] },
    });
    // A null is the wire form of a nullable client field holding no key — nothing was
    // ever minted, so no client is misled and the legitimate no-key path must stand.
    expect(res.statusCode).toBe(201);
    expect(res.json().id).not.toBe("g-null"); // a real create, not the NULL-key row
    const grInserts = inserted.filter((w) => w.table === grs);
    expect(grInserts).toHaveLength(1);
    expect((grInserts[0]!.rows[0] as { idempotencyKey: string | null }).idempotencyKey).toBe(
      null,
    );
  });

  it("B-309: a NUMERIC-LOOKING STRING is a perfectly valid key — it still dedups (the fix gates on TYPE, not on shape)", async () => {
    const inserted: Inserted[] = [];
    const captured: Captured[] = [];
    // The ORIGINAL receipt this key already resolves — the same pre-check replay the
    // uuid key gets. "123" is a string, so nothing about B-309 may touch it.
    const original = { ...gr("new-0", { poId: PO, received: 300 }), createdAt: undefined };
    const db = stubDb({
      rows: [
        [pos, [poRow("approved")]],
        [prs, [prRow]],
        [projects, [project]],
        [prItems, [prLine("l0", "1000")]],
        [grs, keyedGrs({ "123": [original] }, [original])],
        [vendors, [vendorRow]],
      ],
      captured,
      inserted,
    });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, idempotency_key: "123", lines: [{ qty_ok: 300 }] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("new-0"); // the client's OWN receipt, replayed
    expect(inserted.filter((w) => w.table === grs)).toHaveLength(0); // no second receipt
    expect(keyedReads(captured, "123").length).toBeGreaterThan(0); // the key was bound
  });

  it("the 23505 backstop still fires when the pre-check MISSES (two simultaneous replays of the full receipt)", async () => {
    const inserted: Inserted[] = [];
    const captured: Captured[] = [];
    const original = { ...gr("new-0", { poId: PO, received: 1000 }), createdAt: undefined };
    const stored: unknown[] = []; // our pre-check reads BEFORE the other replay commits
    const db = stubDb({
      rows: [
        [pos, [poRow("approved")]],
        [prs, [prRow]],
        [projects, [project]],
        [prItems, [prLine("l0", "1000")]],
        [grs, keyedGrs({ [IDEMP_KEY]: stored }, [original])],
        [vendors, [vendorRow]],
      ],
      inserted,
      captured,
      // …and it commits between our pre-check and our insert. The pre-check is NOT a
      // substitute for the unique index (money-post-idempotency lesson).
      insertThrows: (table) => {
        if (table !== grs) return null;
        stored.push(original);
        return uniqueViolation();
      },
    });
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db })
    ).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, idempotency_key: IDEMP_KEY, lines: [{ qty_ok: 1000 }] },
    });
    expect(res.statusCode).toBe(201); // the loser is answered with the winner's receipt
    expect(res.json().id).toBe("new-0");
    expect(inserted.filter((w) => w.table === grs)).toHaveLength(0); // no duplicate row
    expect(keyedReads(captured)).toHaveLength(2); // pre-check missed, catch resolved
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
  const ORIGINAL = { ...gr("new-0", { poId: PO, received: 300 }), createdAt: undefined };
  /**
   * B-264: this describe's subject is the 23505 CATCH, so the pre-check must MISS —
   * `stored` (what the client key resolves to) starts EMPTY. That is also the real
   * race: our pre-check read nothing, then the other writer committed. A static
   * [grs, [ORIGINAL]] would let the pre-check answer first and the constraint-name
   * gate below would never be exercised at all.
   */
  const baseRows = (stored: unknown[] = []): StubOpts["rows"] => [
    [pos, [poRow("approved")]],
    [prs, [prRow]],
    [projects, [project]],
    [prItems, [prLine("l0", "1000")]], // ordered 1000 → partial receipt
    [grs, keyedGrs({ [IDEMP_KEY]: stored }, [ORIGINAL])],
    [vendors, [vendorRow]],
  ];
  /** An insert that LOSES the race: the other writer's row lands, then we 23505. */
  const raced = (stored: unknown[], err: Error) => (table: unknown) => {
    if (table !== grs) return null;
    stored.push(ORIGINAL);
    return err;
  };
  const postKeyed = async (db: Db) =>
    (await buildTestApp({ resolveTenant: async () => SESSION, db })).inject({
      method: "POST",
      url: "/api/v1/gr",
      payload: { po_id: PO, idempotency_key: IDEMP_KEY, lines: [{ qty_ok: 300 }] },
    });

  it("(a) 23505 naming gr_idempotency_uq → the REPLAY still runs: the ORIGINAL receipt, no 2nd write", async () => {
    const inserted: Inserted[] = [];
    const stored: unknown[] = [];
    const db = stubDb({
      rows: baseRows(stored),
      inserted,
      // drizzle-wrapped (the production shape): DrizzleQueryError → cause → DatabaseError.
      insertThrows: raced(stored, uniqueViolation(GR_IDEMP_UQ)),
    });
    const res = await postKeyed(db);
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("new-0"); // the client's OWN receipt, re-read not recreated
    expect(res.json().received).toBe(300);
    expect(inserted.filter((w) => w.table === grs)).toHaveLength(0); // the insert threw → no duplicate
  });

  it("(a) the same violation UNWRAPPED (raw pg DatabaseError, constraint at the top level) replays too", async () => {
    const stored: unknown[] = [];
    const db = stubDb({
      rows: baseRows(stored),
      insertThrows: raced(stored, pgUniqueViolation(GR_IDEMP_UQ)),
    });
    const res = await postKeyed(db);
    expect(res.statusCode).toBe(201);
    expect(res.json().id).toBe("new-0");
  });

  it("(b) 23505 naming a DIFFERENT unique constraint is NOT mis-routed into the replay — it rethrows (500)", async () => {
    const captured: Captured[] = [];
    const inserted: Inserted[] = [];
    const db = stubDb({
      rows: baseRows(), // the key resolves to nothing — this collision is not a replay
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
    // and the CATCH's replay never started: the only keyed resolve was the B-264
    // pre-check (which found nothing) — a second one would mean the constraint-name
    // gate let an unrelated collision into the replay path.
    expect(keyedReads(captured)).toHaveLength(1);
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
    expect(keyedReads(captured)).toHaveLength(1); // the pre-check only, never the catch
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

/**
 * B-309. The classification table itself, at the unit level — the handler tests above
 * prove each verdict end-to-end for /gr and labor.test.ts does the same for
 * /labor/attendance, but only here can `undefined` be asserted: JSON cannot transmit
 * it, so no HTTP-level test can reach that branch. Every row is a DECISION, not an
 * accident — this is the artifact a future reviewer reads to see which shapes were
 * deliberately treated as absent and which as invalid.
 */
describe("readIdempotencyKey() — the shared B-309 parser (money-write template)", () => {
  it.each([
    ["the property is missing entirely", {}],
    ["an explicit undefined (unreachable over JSON — only a direct call)", { idempotency_key: undefined }],
    ["an explicit null (a nullable client field holding no key)", { idempotency_key: null }],
    ["an empty string", { idempotency_key: "" }],
    ["whitespace only", { idempotency_key: "   " }],
    ["a tab/newline", { idempotency_key: "\t\n" }],
  ])("ABSENT — %s → key null, no error", (_label, body) => {
    expect(readIdempotencyKey(body)).toEqual({ ok: true, key: null });
  });

  it.each([
    ["a uuid", IDEMP_KEY, IDEMP_KEY],
    ["a numeric-looking string", "123", "123"],
    ["a padded string (trimmed, as before B-309)", "  k1  ", "k1"],
    ["the string \"null\"", "null", "null"],
  ])("VALID — %s stays a key", (_label, raw, expected) => {
    expect(readIdempotencyKey({ idempotency_key: raw })).toEqual({ ok: true, key: expected });
  });

  it.each([
    ["a number (the live-proven double-post)", 123],
    ["zero — falsy, but still a present non-string", 0],
    ["a float", 1.5],
    ["a boolean", true],
    ["an array", ["k"]],
    ["an object", { k: "v" }],
  ])("INVALID — %s → 400, never a silent no-key create", (_label, raw) => {
    expect(readIdempotencyKey({ idempotency_key: raw })).toEqual({
      ok: false,
      message: IDEMPOTENCY_KEY_TYPE_MESSAGE,
    });
  });

  it("alias precedence is pick()'s and is unchanged: the FIRST present key decides, even when it is the bad one", () => {
    // Answering from the valid camelCase twin would hide exactly the client bug the
    // guard exists to surface.
    expect(readIdempotencyKey({ idempotency_key: 123, idempotencyKey: "ok" }).ok).toBe(false);
    expect(readIdempotencyKey({ idempotencyKey: 123 }).ok).toBe(false);
    expect(readIdempotencyKey({ idempotencyKey: "ok" })).toEqual({ ok: true, key: "ok" });
  });
});

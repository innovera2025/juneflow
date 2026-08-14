// G3 unit tests (PLAN.md §9) — GET + POST /models (P1-BE-09, B-050;
// master.jsx MasterModel/ModelAddForm). Covers the B-014 envelope + wire shape,
// the DERIVED counts (unit_count from project_node, bom_item_count from bom —
// C10, never the mock's hardcoded numbers), tenant scope on every read (no
// leak), and the create behaviors: a new model starts `draft`, the server
// rotates the 7-color palette, the code is uppercased + unique (409), and the
// validation mirror of ModelAddForm.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { models, projectNodes, boms, users, roles } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย วัฒนกุล" },
};

interface Captured {
  table: unknown;
  where: SQL | undefined;
}
interface Inserted {
  table: unknown;
  values: Record<string, unknown>;
}

/** stub Db: canned rows per table for reads + capture of inserted values. */
function stubDb(
  rows: Array<[unknown, unknown[]]>,
  captured: Captured[] = [],
  inserted: Inserted[] = [],
): Db {
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
      // B-388 · BOTH insert doors. TenantDb.insert() returns the builder WITHOUT
      // .returning() and the caller awaits it directly, so a `.returning()`-only
      // stub records nothing for such a write and every absence assertion about
      // it is vacuous. One `record()` closure sits behind both doors — invoked
      // once per DOOR CALL, never in the `values(...)` body (which would make
      // `.returning()` double-count). Evidence at the foot of this file.
      values: (values: Record<string, unknown>) => {
        const record = (): Record<string, unknown>[] => {
          inserted.push({ table, values });
          // Echo the inserted values + a synthetic id + column defaults a real
          // INSERT ... RETURNING would fill (currency_code).
          return [{ id: `new-${seq++}`, currencyCode: "THB", ...values }];
        };
        return {
          returning: () => Promise.resolve(record()),
          // The awaited-directly door (plain scoped insert, no .returning()).
          then: (onOk: (r: unknown) => unknown, onErr: (e: unknown) => unknown) =>
            Promise.resolve(record()).then(onOk, onErr),
        };
      },
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

async function buildTestApp(
  overrides: Partial<AppDeps> = {},
): Promise<FastifyInstance> {
  app = await buildApp({
    db: overrides.db ?? stubDb([]),
    resolveTenant: overrides.resolveTenant ?? (async () => null),
    signIn: overrides.signIn ?? (async () => null),
    storage: overrides.storage ?? createFakeR2Storage("https://r2.test"),
    quota:
      overrides.quota ??
      new QuotaGuard({
        resolver: unlimitedQuotaResolver,
        upgradeUrl: "https://upgrade.test",
      }),
    auditSink: overrides.auditSink ?? (async () => {}),
    logger: false,
  });
  return app;
}

// seed-shaped canned rows (master.jsx MODELS).
const modelRow = (
  id: string,
  code: string,
  name: string,
  area: string,
  price: string,
  status: "active" | "draft",
  color: string,
  bed: number,
  bath: number,
  parking: number,
) => ({
  id,
  companyId: COMPANY,
  name,
  code,
  bed,
  bath,
  parking,
  area,
  price,
  currencyCode: "THB",
  status,
  color,
  createdAt: new Date(),
  updatedAt: new Date(),
});
// B-391: stagger the fixture the way cost-centers.test.ts's `staggered()` already
// does for the same reason (B-323) — index 0 newest, 1s apart. Two module-level
// `modelRow()` calls each reading the live clock via bare `new Date()` are not
// guaranteed to tie: on a loaded machine the second
// call lands in a later millisecond than the first, and the real, correctly-TOTAL
// `byNewestThenId` comparator (newest-first) then legitimately reorders [A1, B1] to
// [B1, A1] — flipping this test's hardcoded envelope order out from under it. Fixed,
// ON THE RATE, because a number here would mislead: this was observed ONCE, in one
// full-suite run on a contended box. Two later attempts to reproduce it naturally
// came back 0/10 and 0/9 on idle machines. Do not read a frequency into that and
// conclude the fix was unnecessary — the evidence is not a rate, it is a
// reconstructed-condition probe: this file, unmodified, under a monotonically
// increasing `Date`, fails exactly this test, and passes once staggered.
// explicitly-descending instants make the order deterministic regardless of
// scheduler timing; the comparator itself needs no change (B-323's
// list-order.enforce.test.ts already proves it TOTAL).
const staggered = <T extends { createdAt: Date; updatedAt: Date }>(rows: T[]): T[] =>
  rows.map((r, i) => {
    const at = new Date(Date.UTC(2026, 0, 1, 0, 0, 0) - i * 1000);
    return { ...r, createdAt: at, updatedAt: at };
  });
const [A1, B1] = staggered([
  modelRow("m-a1", "A-1", "บ้านเดี่ยว 2 ชั้น", "168.00", "8240000.00", "active", "#0B2A4A", 4, 4, 2),
  modelRow("m-b1", "B-1", "ทาวน์โฮม 2 ชั้น", "92.00", "4850000.00", "active", "#0F766E", 3, 2, 1),
]);

// B-084 (matrix GAP-8): creating a model is master-data administration, now
// gated on master.create (F1 consistency with /users + /roles). The caller's
// role carries it; the session email resolves to this scoped user.
const masterRole = {
  id: "role-admin", companyId: COMPANY, name: "Admin", approvalLimits: {},
  perms: { master: { view: true, create: true, edit: true, approve: true, cancel: true } },
  approvalLevel: 4, approvalLimit: null, currencyCode: "THB",
  createdAt: new Date(), updatedAt: new Date(),
};
const callerUser = {
  id: "u-caller", companyId: COMPANY, email: SESSION.user.email, name: "สมชาย",
  roleId: "role-admin", status: "active", department: null,
  createdAt: new Date(), updatedAt: new Date(),
};

// project_node: 3 unit-kind nodes on B-1, 1 block-kind on B-1 (must NOT count),
// 1 unit with no model (skipped) → unit_count(B-1)=3, unit_count(A-1)=0.
const unitNode = (id: string, modelId: string | null) => ({
  id,
  projectId: "p-rjp",
  parentId: null,
  modelId,
  kind: "unit",
  name: id,
  saleStatus: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});
const NODES = [
  unitNode("u1", "m-b1"),
  unitNode("u2", "m-b1"),
  unitNode("u3", "m-b1"),
  { ...unitNode("blk", "m-b1"), kind: "block" },
  unitNode("u-nomodel", null),
];
// bom: B-1 template has 3 items → bom_item_count(B-1)=3; A-1 has no bom → 0.
const BOMS = [
  { id: "bom-b1", companyId: COMPANY, unitType: "B-1", items: [{}, {}, {}], createdAt: new Date(), updatedAt: new Date() },
];

describe("GET /api/v1/models — auth", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/models" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });
});

describe("GET /api/v1/models — envelope + derived counts", () => {
  it("wraps models with the wire shape + DERIVED unit_count/bom_item_count", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([
          [models, [A1, B1]],
          [projectNodes, NODES],
          [boms, BOMS],
        ]),
      })
    ).inject({ url: "/api/v1/models" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [
        {
          id: "m-a1", code: "A-1", type: "บ้านเดี่ยว 2 ชั้น", area: 168,
          bed: 4, bath: 4, parking: 2, price: 8240000, currency_code: "THB",
          status: "active", color: "#0B2A4A", unit_count: 0, bom_item_count: 0,
        },
        {
          id: "m-b1", code: "B-1", type: "ทาวน์โฮม 2 ชั้น", area: 92,
          bed: 3, bath: 2, parking: 1, price: 4850000, currency_code: "THB",
          status: "active", color: "#0F766E", unit_count: 3, bom_item_count: 3,
        },
      ],
      page: 1,
      page_size: 50,
      total: 2,
    });
  });

  it("returns only wire fields (no company_id / timestamp leak)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[models, [A1]], [projectNodes, []], [boms, []]]),
      })
    ).inject({ url: "/api/v1/models" });
    expect(Object.keys(res.json().data[0]).sort()).toEqual(
      ["area", "bath", "bed", "bom_item_count", "code", "color", "currency_code", "id", "parking", "price", "status", "type", "unit_count"],
    );
  });
});

describe("GET /api/v1/models — tenant scope (no leak)", () => {
  it("binds company_id on the model, project_node, and bom reads", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[models, [A1]], [projectNodes, NODES], [boms, BOMS]], captured),
      })
    ).inject({ url: "/api/v1/models" });

    const tables = [models, projectNodes, boms];
    for (const t of tables) {
      const call = captured.find((c) => c.table === t);
      expect(call, `read for ${String(t)}`).toBeTruthy();
      expect(paramsOf(call!.where)).toContain(COMPANY);
    }
  });
});

describe("POST /api/v1/models — create starts draft, palette color, unique code", () => {
  it("creates a draft, uppercases the code, rotates the palette by existing count", async () => {
    const inserted: Inserted[] = [];
    // 2 existing models → palette index 2 = "#1D4ED8".
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[models, [A1, B1]], [users, [callerUser]], [roles, [masterRole]]], [], inserted),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/models",
      payload: { code: "f-1", type: "ทาวน์โฮมใหม่", area: "120", price: "5.5", bed: 3, bath: 2, parking: 1 },
    });

    expect(res.statusCode).toBe(201);
    // server-owned fields on the INSERT.
    const values = inserted[0]!.values;
    expect(values.code).toBe("F-1");
    expect(values.status).toBe("draft");
    expect(values.color).toBe("#1D4ED8");
    expect(values.name).toBe("ทาวน์โฮมใหม่");
    // response echoes the created model; a brand-new model has 0 derived counts.
    const body = res.json();
    expect(body).toMatchObject({
      code: "F-1", type: "ทาวน์โฮมใหม่", status: "draft", color: "#1D4ED8",
      currency_code: "THB", unit_count: 0, bom_item_count: 0,
    });
  });

  it("409s a duplicate code (case-insensitive, per company)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[models, [A1, B1]], [users, [callerUser]], [roles, [masterRole]]]),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/models",
      payload: { code: "a-1", type: "ซ้ำ", area: "100" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_CODE");
  });

  it("400s on missing code / type / bad area", async () => {
    const build = async () =>
      buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[models, []], [users, [callerUser]], [roles, [masterRole]]]),
      });

    const noCode = await (await build()).inject({ method: "POST", url: "/api/v1/models", payload: { type: "x", area: "10" } });
    expect(noCode.statusCode).toBe(400);
    await app.close();

    const noType = await (await build()).inject({ method: "POST", url: "/api/v1/models", payload: { code: "Z-1", area: "10" } });
    expect(noType.statusCode).toBe(400);
    await app.close();

    const badArea = await (await build()).inject({ method: "POST", url: "/api/v1/models", payload: { code: "Z-1", type: "x", area: "0" } });
    expect(badArea.statusCode).toBe(400);
  });

  it("403s a caller whose role lacks master.create (B-084 GAP-8 F1 consistency)", async () => {
    const lowRole = { ...masterRole, id: "role-low", perms: { boq: { view: true, create: true, edit: false, approve: false, cancel: false } } };
    const lowUser = { ...callerUser, roleId: "role-low" };
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[models, []], [users, [lowUser]], [roles, [lowRole]]]),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/models",
      payload: { code: "Z-9", type: "x", area: "100" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });
});

// ---------------------------------------------------------------------------
// GET /models/:id/bom — the BOM template lines (boq.bom / F5)
// ---------------------------------------------------------------------------

const bomRow = (unitType: string, items: unknown[]) => ({
  id: `bom-${unitType}`,
  companyId: COMPANY,
  unitType,
  items,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("GET /api/v1/models/:id/bom", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/models/m-b1/bom" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });

  it("returns the model's BOM template lines (keyed by unit_type = code)", async () => {
    const lines = [
      { cat: "M", code: "01-001", name: "เสาเข็มเจาะ", unit: "ต้น", qty: 18, price: 4200 },
      { cat: "M", code: "02-002", name: "คอนกรีตผสมเสร็จ", unit: "ลบ.ม.", qty: 42, price: 2150 },
    ];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([
          [models, [B1]],
          [boms, [bomRow("B-1", lines)]],
        ]),
      })
    ).inject({ url: "/api/v1/models/m-b1/bom" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.page).toBe(1);
    expect(body.data).toEqual(lines);
  });

  it("returns an empty list honestly when the model has no matching BOM", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[models, [A1]], [boms, []]]),
      })
    ).inject({ url: "/api/v1/models/m-a1/bom" });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(0);
    expect(res.json().data).toEqual([]);
  });

  it("404s for a model not in this tenant (foreign / absent id)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[models, []]]),
      })
    ).inject({ url: "/api/v1/models/nope/bom" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });
});

// ===========================================================================
// B-388 · SINGLE-RECORDING EVIDENCE for the both-doors insert stub.
//
// Converting a `.returning()`-only stub is behaviourally INERT in this file —
// nothing this route does today writes through the bare TenantDb.insert() door,
// so no assertion above changed verdict when this landed and a green suite is
// NOT evidence the conversion is right. The defect a conversion can introduce is
// a DOUBLE-count (the recording closure invoked on the way in as well as per
// door) or a second door that records somewhere else. Neither is visible to
// stub-insert-door.enforce.test.ts, which proves a `then` KEY EXISTS — not that
// it records correctly. So the recording is asserted here, directly.
// ===========================================================================
describe("B-388 · stubDb's two insert doors record identically, once each", () => {
  interface Door {
    values: (v: Record<string, unknown>) => PromiseLike<Record<string, unknown>[]> & {
      returning: () => Promise<Record<string, unknown>[]>;
    };
  }
  const doorOf = (db: Db, table: unknown): Door =>
    (db as unknown as { insert: (t: unknown) => Door }).insert(table);

  it("records exactly +1 per write and resolves identically, through EITHER door", async () => {
    const inserted: Inserted[] = [];
    const db = stubDb([], [], inserted);

    expect(inserted).toHaveLength(0);
    const bare = await doorOf(db, models).values({ code: "BARE" });
    expect(inserted).toHaveLength(1);
    const ret = await doorOf(db, models).values({ code: "RET" }).returning();
    expect(inserted).toHaveLength(2);

    expect(inserted).toEqual([
      { table: models, values: { code: "BARE" } },
      { table: models, values: { code: "RET" } },
    ]);
    // The ids prove `seq` advanced exactly ONCE per write — no door double-recorded.
    expect(bare).toEqual([{ id: "new-0", currencyCode: "THB", code: "BARE" }]);
    expect(ret).toEqual([{ id: "new-1", currencyCode: "THB", code: "RET" }]);
  });
});

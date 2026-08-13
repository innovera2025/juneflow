// G3 unit tests (PLAN.md §9) — GET/POST/PUT/DELETE /org-units (P1-BE-10, B-052;
// master.jsx MasterCompany/OrgAddForm). Covers the pre-order tree traversal of
// GET (each parent immediately followed by its subtree), tenant scope on every
// read (company_id bound), and the server rules: level = min(parent.level+1, 2),
// a department requires a parent, tax_id validated only when sent, code unique
// per tenant (409), PUT partial-merge + cycle guard, DELETE cascade of the whole
// subtree.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { orgUnits } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย" },
};

interface Captured {
  table: unknown;
  where: SQL | undefined;
}
interface Inserted {
  table: unknown;
  values: Record<string, unknown>;
}
interface Updated {
  table: unknown;
  set: Record<string, unknown>;
  where: SQL | undefined;
}
interface Deleted {
  table: unknown;
  where: SQL | undefined;
}

interface StubOpts {
  rows: Array<[unknown, unknown[]]>;
  captured?: Captured[];
  inserted?: Inserted[];
  updated?: Updated[];
  deleted?: Deleted[];
  /** Base row merged with the update SET to synthesize the RETURNING row. */
  updateBase?: Record<string, unknown>;
}

/** Base Db stub: canned rows per table for reads; capture of write ops. */
function stubDb(opts: StubOpts): Db {
  const {
    rows,
    captured = [],
    inserted = [],
    updated = [],
    deleted = [],
    updateBase = {},
  } = opts;
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
          return [{ id: `new-${seq++}`, ...values }];
        };
        return {
          returning: () => Promise.resolve(record()),
          // The awaited-directly door (plain scoped insert, no .returning()).
          then: (onOk: (r: unknown) => unknown, onErr: (e: unknown) => unknown) =>
            Promise.resolve(record()).then(onOk, onErr),
        };
      },
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
    delete: (table: unknown) => ({
      where: (where: SQL) => {
        deleted.push({ table, where });
        return Promise.resolve(undefined);
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

// A small org tree (staggered createdAt fixes document order):
//   ICON(root) → CONS → { RJP, BBT } ; ICS(root)
const org = (
  id: string,
  parentId: string | null,
  level: number,
  icon: string,
  name: string,
  code: string,
  note: string,
  t: number,
) => ({
  id,
  companyId: COMPANY,
  parentId,
  level,
  icon,
  name,
  code,
  note,
  createdAt: new Date(1_700_000_000_000 + t * 1000),
  updatedAt: new Date(1_700_000_000_000 + t * 1000),
});
const ICON = org("o-icon", null, 0, "building", "juneflow Co., Ltd.", "ICON", "แม่", 1);
const CONS = org("o-cons", "o-icon", 1, "users", "ฝ่ายก่อสร้าง", "CONS", "86 คน", 2);
const RJP = org("o-rjp", "o-cons", 2, "user", "ทีม ราชพฤกษ์", "CONS-RJP", "24 คน", 3);
const BBT = org("o-bbt", "o-cons", 2, "user", "ทีม บางบัวทอง", "CONS-BBT", "18 คน", 4);
const ICS = org("o-ics", null, 0, "building", "juneflow Services", "ICS", "ย่อย", 5);
const TREE = [BBT, ICS, CONS, RJP, ICON]; // deliberately shuffled: GET must re-order

describe("GET /api/v1/org-units — auth", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/org-units" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
  });
});

describe("GET /api/v1/org-units — pre-order tree traversal + envelope", () => {
  it("emits each parent immediately followed by its subtree, in document order", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[orgUnits, TREE]] }) })
    ).inject({ url: "/api/v1/org-units" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.map((r: { id: string }) => r.id)).toEqual([
      "o-icon", "o-cons", "o-rjp", "o-bbt", "o-ics",
    ]);
    expect(body.total).toBe(5);
    expect(body.page).toBe(1);
    // wire shape is the opaque org Entity (no company_id / timestamp leak).
    expect(Object.keys(body.data[0]).sort()).toEqual(
      ["code", "icon", "id", "level", "name", "note", "parent_id"],
    );
  });

  it("binds company_id on the read (tenant scope, no leak)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[orgUnits, TREE]], captured }),
      })
    ).inject({ url: "/api/v1/org-units" });
    const call = captured.find((c) => c.table === orgUnits);
    expect(call).toBeTruthy();
    expect(paramsOf(call!.where)).toContain(COMPANY);
  });
});

describe("POST /api/v1/org-units — create rules", () => {
  it("creates a company at level 0 (no parent), icon building", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[orgUnits, [ICON]]], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/org-units",
      payload: { kind: "company", name: "จูนโฟลว์ ใหม่", code: "idv", note: "n" },
    });
    expect(res.statusCode).toBe(201);
    const v = inserted[0]!.values;
    expect(v.code).toBe("IDV"); // uppercased
    expect(v.level).toBe(0);
    expect(v.parentId).toBeNull();
    expect(v.icon).toBe("building");
  });

  it("creates a department at min(parent.level+1, 2) under its parent", async () => {
    const inserted: Inserted[] = [];
    // parent CONS is level 1 → child level 2, icon user.
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[orgUnits, TREE]], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/org-units",
      payload: { kind: "dept", name: "ทีมใหม่", code: "CONS-NEW", parent_id: "o-cons" },
    });
    expect(res.statusCode).toBe(201);
    const v = inserted[0]!.values;
    expect(v.level).toBe(2);
    expect(v.parentId).toBe("o-cons");
    expect(v.icon).toBe("user");
  });

  it("caps department level at 2 even under a level-2 parent", async () => {
    const inserted: Inserted[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[orgUnits, TREE]], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/org-units",
      payload: { kind: "dept", name: "ลึก", code: "DEEP", parent_id: "o-rjp" },
    });
    expect(inserted[0]!.values.level).toBe(2);
  });

  it("400s a department with no parent", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[orgUnits, TREE]] }) })
    ).inject({ method: "POST", url: "/api/v1/org-units", payload: { kind: "dept", name: "x", code: "X1" } });
    expect(res.statusCode).toBe(400);
  });

  it("409s a duplicate code (case-insensitive, per tenant, any level)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[orgUnits, TREE]] }) })
    ).inject({
      method: "POST",
      url: "/api/v1/org-units",
      payload: { kind: "company", name: "ซ้ำ", code: "cons-rjp" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_CODE");
  });

  it("400s a company with an invalid tax_id, but accepts a valid 13-digit one", async () => {
    const bad = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[orgUnits, []]] }) })
    ).inject({
      method: "POST",
      url: "/api/v1/org-units",
      payload: { kind: "company", name: "c", code: "TX1", tax_id: "12345" },
    });
    expect(bad.statusCode).toBe(400);
    await app.close();

    const ok = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[orgUnits, []]] }) })
    ).inject({
      method: "POST",
      url: "/api/v1/org-units",
      payload: { kind: "company", name: "c", code: "TX2", tax_id: "0107565000123" },
    });
    expect(ok.statusCode).toBe(201);
  });
});

describe("PUT /api/v1/org-units/:id — partial merge + cycle guard", () => {
  it("merges ONLY the provided fields (omitted fields are untouched)", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[orgUnits, TREE]], updated, updateBase: CONS }),
      })
    ).inject({
      method: "PUT",
      url: "/api/v1/org-units/o-cons",
      payload: { name: "ฝ่ายก่อสร้าง (แก้ไข)" },
    });
    expect(res.statusCode).toBe(200);
    const set = updated[0]!.set;
    expect(Object.keys(set)).toEqual(["name"]); // note/code/parent untouched
    expect(set.name).toBe("ฝ่ายก่อสร้าง (แก้ไข)");
    // the WHERE is scoped by company_id.
    expect(paramsOf(updated[0]!.where)).toContain(COMPANY);
    // response reflects the merged row.
    expect(res.json().name).toBe("ฝ่ายก่อสร้าง (แก้ไข)");
  });

  it("recomputes level when re-parented to a valid (non-descendant) node", async () => {
    const updated: Updated[] = [];
    // move BBT (level 2) under ICS (level 0) → new level 1.
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[orgUnits, TREE]], updated, updateBase: BBT }),
      })
    ).inject({ method: "PUT", url: "/api/v1/org-units/o-bbt", payload: { parent_id: "o-ics" } });
    expect(updated[0]!.set.parentId).toBe("o-ics");
    expect(updated[0]!.set.level).toBe(1);
  });

  it("409s a circular re-parent (new parent is a descendant of the node)", async () => {
    const updated: Updated[] = [];
    // move CONS under its own child RJP → cycle.
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[orgUnits, TREE]], updated }),
      })
    ).inject({ method: "PUT", url: "/api/v1/org-units/o-cons", payload: { parent_id: "o-rjp" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CIRCULAR_PARENT");
    expect(updated).toHaveLength(0); // no write attempted
  });

  it("404s an id outside the tenant", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[orgUnits, TREE]] }) })
    ).inject({ method: "PUT", url: "/api/v1/org-units/o-ghost", payload: { name: "x" } });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /api/v1/org-units/:id — cascade the whole subtree", () => {
  it("deletes the node + all descendants in one scoped delete", async () => {
    const deleted: Deleted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[orgUnits, TREE]], deleted }),
      })
    ).inject({ method: "DELETE", url: "/api/v1/org-units/o-cons" });
    expect(res.statusCode).toBe(200);
    // subtree of CONS = { o-cons, o-rjp, o-bbt } → 3 deleted.
    expect(res.json().deleted_count).toBe(3);
    const params = paramsOf(deleted[0]!.where);
    expect(params).toContain(COMPANY); // scoped
    for (const id of ["o-cons", "o-rjp", "o-bbt"]) expect(params).toContain(id);
    expect(params).not.toContain("o-icon"); // ancestor untouched
  });

  it("404s an id outside the tenant (no delete attempted)", async () => {
    const deleted: Deleted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[orgUnits, TREE]], deleted }),
      })
    ).inject({ method: "DELETE", url: "/api/v1/org-units/o-ghost" });
    expect(res.statusCode).toBe(404);
    expect(deleted).toHaveLength(0);
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
    const db = stubDb({ rows: [], inserted });

    expect(inserted).toHaveLength(0);
    const bare = await doorOf(db, orgUnits).values({ name: "bare" });
    expect(inserted).toHaveLength(1);
    const ret = await doorOf(db, orgUnits).values({ name: "ret" }).returning();
    expect(inserted).toHaveLength(2);

    expect(inserted).toEqual([
      { table: orgUnits, values: { name: "bare" } },
      { table: orgUnits, values: { name: "ret" } },
    ]);
    // The ids prove `seq` advanced exactly ONCE per write — no door double-recorded.
    expect(bare).toEqual([{ id: "new-0", name: "bare" }]);
    expect(ret).toEqual([{ id: "new-1", name: "ret" }]);
  });
});

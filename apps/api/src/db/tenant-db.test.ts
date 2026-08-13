// G3 unit tests (PLAN.md §9) — tenant scope: NO query may escape company_id
// (PLAN.md §5 + Appendix A, apps/api/CLAUDE.md).
//
// Strategy: build queries through TenantDb over a real Drizzle handle whose pg
// Pool never connects, and inspect the generated SQL with drizzle `.toSQL()`
// (pure serialization — no DB round-trip). Every read/update/delete MUST carry
// the `company_id = $` predicate and every insert MUST bind company_id, so a
// query that reached another tenant's rows is provably impossible.
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb } from "@juneflow/db/client";
import {
  boqDocs,
  boqGroups,
  boqItems,
  companies,
  packages,
  pmAssets,
  pmContracts,
  pmWorkOrders,
  projects,
  projectTypes,
  subconContracts,
  users,
  workPeriods,
} from "@juneflow/db";
import { projectNodes } from "@juneflow/db";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Db } from "@juneflow/db/client";
import { TenantDb, TenantScopeError } from "./tenant-db.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const OTHER = "99999999-9999-9999-9999-999999999999";

// Pool is constructed but never queried; a bogus URL is fine for .toSQL().
const db = createDb("postgres://u:p@127.0.0.1:5432/juneflow_test");
const tdb = new TenantDb(db, COMPANY);

describe("fail-closed construction", () => {
  it("throws when constructed without a company_id", () => {
    expect(() => new TenantDb(db, "")).toThrow(TenantScopeError);
  });

  it("exposes the bound company_id", () => {
    expect(tdb.companyId).toBe(COMPANY);
  });
});

describe("select is always company_id-scoped", () => {
  it("injects the company_id predicate with the tenant as a bound param", () => {
    const { sql, params } = tdb.select(users).toSQL();
    expect(sql).toContain('"company_id" = $1');
    expect(params).toContain(COMPANY);
  });

  it("AND-s a caller predicate onto the tenant predicate (never replaces it)", () => {
    const { sql, params } = tdb
      .select(users, eq(users.email, "a@b.co"))
      .toSQL();
    expect(sql).toContain('"company_id" = $');
    expect(sql).toContain('"email" = $');
    expect(sql).toContain(" and ");
    expect(params).toContain(COMPANY);
    expect(params).toContain("a@b.co");
  });
});

describe("insert always binds this tenant's company_id", () => {
  it("force-sets company_id even though the payload cannot supply it", () => {
    const { sql, params } = tdb
      .insert(users, { email: "a@b.co", name: "A" })
      .toSQL();
    expect(sql).toContain('"company_id"');
    expect(params).toContain(COMPANY);
  });

  it("overrides any smuggled company_id — the tenant's id wins", () => {
    const { params } = tdb
      // Cast past the type guard to simulate a hostile payload.
      .insert(users, { email: "a@b.co", name: "A", companyId: OTHER } as never)
      .toSQL();
    expect(params).toContain(COMPANY);
    expect(params).not.toContain(OTHER);
  });
});

describe("update is always company_id-scoped", () => {
  it("scopes the WHERE by company_id", () => {
    const { sql, params } = tdb.update(users, { name: "B" }).toSQL();
    expect(sql).toContain('"company_id" = $');
    expect(params).toContain(COMPANY);
  });

  it("AND-s a caller predicate onto the tenant predicate", () => {
    const { sql, params } = tdb
      .update(users, { name: "B" }, eq(users.email, "a@b.co"))
      .toSQL();
    expect(sql).toContain('"company_id" = $');
    expect(sql).toContain('"email" = $');
    expect(params).toContain(COMPANY);
    expect(params).toContain("a@b.co");
  });

  // Security regression (Gate 4.5 FAIL, 12 ก.ค.): a hostile payload must not be
  // able to reassign company_id via SET — otherwise a row escapes to OTHER's
  // tenant even though the WHERE stays scoped to this tenant.
  it("cannot reassign company_id — a smuggled SET company_id is stripped", () => {
    const { sql, params } = tdb
      // Cast past the type guard to simulate a hostile payload.
      .update(users, { name: "B", companyId: OTHER } as never)
      .toSQL();
    // OTHER never reaches the query — not in SET, not anywhere.
    expect(params).not.toContain(OTHER);
    // The SET clause (between "set" and "where") must not touch company_id.
    const setClause = sql.slice(sql.indexOf(" set ") + 5, sql.indexOf(" where "));
    expect(setClause).not.toContain("company_id");
    // company_id survives only as the WHERE scope predicate.
    expect(sql).toContain('"company_id" = $');
    expect(params).toContain(COMPANY);
  });
});

describe("selectReference reads platform-global reference tables (P1-BE-01)", () => {
  const PKG = "33333333-3333-3333-3333-333333333333";

  it("issues no company_id predicate — the table has no such column", () => {
    const { sql } = tdb.selectReference(packages).toSQL();
    expect(sql).not.toContain("company_id");
  });

  it("applies only the caller predicate (e.g. the tenant's own package_id)", () => {
    const { sql, params } = tdb
      .selectReference(packages, eq(packages.id, PKG))
      .toSQL();
    expect(sql).toContain('"id" = $1');
    expect(params).toContain(PKG);
  });

  it("rejects tenant-owned tables at compile time AND at runtime", () => {
    expect(() =>
      // @ts-expect-error — users carries companyId, so it is NOT a ReferenceTable;
      // tenant-owned tables must go through the scoped select() only.
      tdb.selectReference(users),
    ).toThrow(TenantScopeError);
  });

  // Gate 4.5 finding (P1-BE-01 rework): tables scoped via a PARENT FK have no
  // companyId column, so they COMPILE through the ReferenceTable type gate —
  // the runtime allowlist is the load-bearing defense. boq_doc (→ project) and
  // work_period (→ subcon_contract) are the reviewer's proven probes.
  it("rejects parent-FK-scoped tenant tables at runtime (boq_doc)", () => {
    expect(() => tdb.selectReference(boqDocs)).toThrow(TenantScopeError);
    expect(() => tdb.selectReference(boqDocs)).toThrow(
      /TENANT_SCOPE_REFERENCE_DENIED/,
    );
  });

  it("rejects parent-FK-scoped tenant tables at runtime (work_period)", () => {
    expect(() => tdb.selectReference(workPeriods)).toThrow(TenantScopeError);
  });

  it("allows exactly the platform-global allowlist: package, company", () => {
    expect(() => tdb.selectReference(packages)).not.toThrow();
    expect(() => tdb.selectReference(companies)).not.toThrow();
  });

  // B-065 (P1-BE-14): project_type gained a nullable company_id (hybrid
  // global/tenant table), so it LEFT the reference allowlist — it must be read
  // through selectGlobalOrOwned(), never bare through selectReference().
  it("rejects project_type — hybrid table since B-065 (read via selectGlobalOrOwned)", () => {
    expect(() =>
      // @ts-expect-error — project_type now carries a nullable companyId, so it
      // is NOT a ReferenceTable; the hybrid read door is the only one.
      tdb.selectReference(projectTypes),
    ).toThrow(TenantScopeError);
  });
});

describe("selectGlobalOrOwned reads global defaults + own rows (B-065, P1-BE-14)", () => {
  it("scopes to (company_id IS NULL OR company_id = this tenant)", () => {
    const { sql, params } = tdb.selectGlobalOrOwned(projectTypes).toSQL();
    // hybrid scope: shared global defaults (NULL) unioned with this tenant's own.
    expect(sql).toContain('"company_id" is null');
    expect(sql).toContain('"company_id" = $');
    expect(sql).toContain(" or ");
    expect(params).toContain(COMPANY);
  });

  it("never binds another tenant's id — foreign custom types are unreachable", () => {
    const { params } = tdb.selectGlobalOrOwned(projectTypes).toSQL();
    expect(params).not.toContain(OTHER);
  });

  it("AND-s a caller predicate onto the hybrid scope (never replaces it)", () => {
    const { sql, params } = tdb
      .selectGlobalOrOwned(projectTypes, eq(projectTypes.key, "realestate"))
      .toSQL();
    expect(sql).toContain('"company_id" is null');
    expect(sql).toContain('"key" = $');
    expect(sql).toContain(" and ");
    expect(params).toContain(COMPANY);
    expect(params).toContain("realestate");
  });
});

describe("selectThrough scopes parent-FK child tables via their tenant root (P1-BE-02)", () => {
  it("single hop (boq_doc → project): joins and binds company_id on the root", () => {
    const { sql, params } = tdb
      .selectThrough(boqDocs, [{ fk: boqDocs.projectId, parent: projects }])
      .toSQL();
    expect(sql).toContain("inner join");
    expect(sql).toContain('"project"');
    expect(sql).toContain('"company_id" = $');
    expect(params).toContain(COMPANY);
  });

  it("selects ONLY the child's columns (no root/company data leaks out)", () => {
    const { sql } = tdb
      .selectThrough(boqDocs, [{ fk: boqDocs.projectId, parent: projects }])
      .toSQL();
    // The selection must come from boq_doc; project columns like budget must
    // not appear in the SELECT list (before FROM).
    const selectList = sql.slice(0, sql.indexOf(" from "));
    expect(selectList).toContain('"boq_doc"');
    expect(selectList).not.toContain('"budget"');
  });

  it("multi hop (work_period → subcon_contract → project) still anchors on company_id", () => {
    const { sql, params } = tdb
      .selectThrough(workPeriods, [
        { fk: workPeriods.contractId, parent: subconContracts },
        { fk: subconContracts.projectId, parent: projects },
      ])
      .toSQL();
    expect((sql.match(/inner join/g) ?? []).length).toBe(2);
    expect(sql).toContain('"company_id" = $');
    expect(params).toContain(COMPANY);
  });

  it("three hops (pm_workorder → pm_asset → pm_contract → project)", () => {
    const { sql, params } = tdb
      .selectThrough(pmWorkOrders, [
        { fk: pmWorkOrders.assetId, parent: pmAssets },
        { fk: pmAssets.contractId, parent: pmContracts },
        { fk: pmContracts.projectId, parent: projects },
      ])
      .toSQL();
    expect((sql.match(/inner join/g) ?? []).length).toBe(3);
    expect(params).toContain(COMPANY);
  });

  it("AND-s a caller predicate onto the tenant predicate (never replaces it)", () => {
    const { sql, params } = tdb
      .selectThrough(
        boqDocs,
        [{ fk: boqDocs.projectId, parent: projects }],
        eq(boqDocs.status, "pending"),
      )
      .toSQL();
    expect(sql).toContain('"company_id" = $');
    expect(sql).toContain('"status" = $');
    expect(sql).toContain(" and ");
    expect(params).toContain(COMPANY);
    expect(params).toContain("pending");
  });

  it("fails closed on an empty hop path", () => {
    expect(() => tdb.selectThrough(boqDocs, [])).toThrow(TenantScopeError);
    expect(() => tdb.selectThrough(boqDocs, [])).toThrow(
      /TENANT_SCOPE_PATH_MISSING/,
    );
  });

  it("fails closed when the final hop is NOT a company_id-scoped root", () => {
    // subcon_contract itself scopes via project — stopping there would leave
    // the query unanchored, so it must throw.
    expect(() =>
      tdb.selectThrough(workPeriods, [
        { fk: workPeriods.contractId, parent: subconContracts },
      ]),
    ).toThrow(/TENANT_SCOPE_ROOT_UNSCOPED/);
  });
});

describe("insertThrough is the fail-closed WRITE door for parent-FK child tables (P1-BE-10)", () => {
  const PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  // A minimal fake base Db: the ownership SELECT returns `ownedRows`; the INSERT
  // captures its rows. We also capture the SELECT predicate to prove it is
  // anchored on company_id + the parent id.
  function fakeDb(ownedRows: unknown[], sink: { where?: SQL; inserted?: unknown[] }): Db {
    return {
      select: () => ({
        from: () => ({
          where: (where: SQL) => {
            sink.where = where;
            return Promise.resolve(ownedRows);
          },
        }),
      }),
      // B-388 · BOTH insert doors. TenantDb has two: insertThrough() ends in
      // .returning(), but the plain scoped insert() (line 228) returns
      // `db.insert(table).values(row)` and the CALLER awaits that builder — so a
      // `.returning()`-only fake never sees such a write at all. This fake sits
      // under the REAL TenantDb, which makes it the one place the door pair can
      // be exercised through production code rather than a hand-rolled call.
      //
      // `sink.inserted` now ACCUMULATES instead of being overwritten, so "one
      // write records exactly one row-set" is an assertable property. Every test
      // above writes at most once, so the two assertions on it are unchanged:
      // `toBeUndefined()` on the denied path, `toHaveLength(2)` for a 2-row
      // insertThrough.
      insert: () => ({
        values: (rows: unknown[]) => {
          const record = (): unknown[] => {
            const list = Array.isArray(rows) ? rows : [rows];
            sink.inserted = [...(sink.inserted ?? []), ...list];
            return list;
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

  it("throws (writes NOTHING) when the parent is not owned by this tenant", async () => {
    const sink: { where?: SQL; inserted?: unknown[] } = {};
    const t = new TenantDb(fakeDb([], sink), COMPANY);
    await expect(
      t.insertThrough(projectNodes, projects, PROJECT, [
        { projectId: PROJECT, kind: "block", name: "B" } as never,
      ]),
    ).rejects.toThrow(/TENANT_SCOPE_PARENT_DENIED/);
    expect(sink.inserted).toBeUndefined();
    // ownership check is scoped by company_id AND the parent id.
    const params = new PgDialect().sqlToQuery(sink.where!).params;
    expect(params).toContain(COMPANY);
    expect(params).toContain(PROJECT);
  });

  it("inserts the rows once the parent is proven tenant-owned", async () => {
    const sink: { where?: SQL; inserted?: unknown[] } = {};
    const t = new TenantDb(fakeDb([{ id: PROJECT }], sink), COMPANY);
    const rows = [
      { projectId: PROJECT, kind: "block", name: "B" } as never,
      { projectId: PROJECT, kind: "unit", name: "B-01" } as never,
    ];
    await t.insertThrough(projectNodes, projects, PROJECT, rows);
    expect(sink.inserted).toHaveLength(2);
  });

  // =========================================================================
  // B-388 · SINGLE-RECORDING EVIDENCE for the both-doors insert fake above.
  //
  // These live INSIDE this describe deliberately: they must exercise the door
  // defined at the top of it, not a copy. The first draft of this evidence
  // declared its own duplicate `fakeDb` in a describe at the foot of the file
  // and asserted against that — so neutering the real door's `then` left the
  // whole suite green. Evidence that does not exercise the thing it names is
  // the exact defect B-388 exists to close, so it is not repeated here.
  //
  // Unlike the route stubs, this fake can be driven through the REAL TenantDb,
  // making it the one place production code exercises BOTH doors:
  //   · insertThrough() → db.insert(t).values(rows).returning()  (returning door)
  //   · insert()        → db.insert(t).values(row), AWAITED      (bare door)
  // That second line is the whole hazard: before this fake grew a `then`, an
  // awaited-directly write resolved to the builder object itself and was NEVER
  // recorded, so `expect(sink.inserted).toBeUndefined()` above could not fail.
  // =========================================================================
  it("B-388 · records a BARE-door TenantDb.insert() exactly once (+1), not zero", async () => {
    const sink: { where?: SQL; inserted?: unknown[] } = {};
    const t = new TenantDb(fakeDb([], sink), COMPANY);

    expect(sink.inserted).toBeUndefined();
    // TenantDb.insert() does NOT call .returning() — the caller awaits the
    // builder. This is the write a `.returning()`-only fake cannot see.
    await t.insert(users, { email: "a@b.co", name: "A" });
    expect(sink.inserted).toHaveLength(1);
    await t.insert(users, { email: "c@d.co", name: "C" });
    expect(sink.inserted).toHaveLength(2);

    // The tenant is force-set on both, and the recorded rows are the rows written.
    expect(sink.inserted).toEqual([
      { email: "a@b.co", name: "A", companyId: COMPANY },
      { email: "c@d.co", name: "C", companyId: COMPANY },
    ]);
  });

  it("B-388 · records the SAME sink from the .returning() door, so the two agree", async () => {
    const sink: { where?: SQL; inserted?: unknown[] } = {};
    const t = new TenantDb(fakeDb([{ id: PROJECT }], sink), COMPANY);

    await t.insert(users, { email: "a@b.co", name: "A" });
    expect(sink.inserted).toHaveLength(1);
    // insertThrough ends in .returning() — the other door, same recorder.
    await t.insertThrough(projectNodes, projects, PROJECT, [
      { projectId: PROJECT, kind: "block", name: "B" } as never,
    ]);
    expect(sink.inserted).toHaveLength(2);
  });
});

describe("updateThrough is the fail-closed UPDATE door for parent-FK child tables (P2-BE-02)", () => {
  const PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  // ownership SELECT returns `ownedRows`; the UPDATE captures its set + WHERE.
  function fakeDb(
    ownedRows: unknown[],
    sink: { ownWhere?: SQL; setWhere?: SQL; set?: Record<string, unknown> },
  ): Db {
    return {
      select: () => ({
        from: () => ({
          where: (where: SQL) => {
            sink.ownWhere = where;
            return Promise.resolve(ownedRows);
          },
        }),
      }),
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: (where: SQL) => ({
            returning: () => {
              sink.set = set;
              sink.setWhere = where;
              return Promise.resolve([{ id: "d0", ...set }]);
            },
          }),
        }),
      }),
    } as unknown as Db;
  }

  it("throws (updates NOTHING) when the parent is not owned by this tenant", async () => {
    const sink: { ownWhere?: SQL; setWhere?: SQL; set?: Record<string, unknown> } = {};
    const t = new TenantDb(fakeDb([], sink), COMPANY);
    await expect(
      t.updateThrough(boqDocs, projects, boqDocs.projectId, PROJECT, { status: "approved" }, eq(boqDocs.id, "d0")),
    ).rejects.toThrow(/TENANT_SCOPE_PARENT_DENIED/);
    expect(sink.set).toBeUndefined();
    // ownership check is scoped by company_id AND the parent id.
    const params = new PgDialect().sqlToQuery(sink.ownWhere!).params;
    expect(params).toContain(COMPANY);
    expect(params).toContain(PROJECT);
  });

  it("updates the row (scoped by the verified parent FK) once the parent is proven owned", async () => {
    const sink: { ownWhere?: SQL; setWhere?: SQL; set?: Record<string, unknown> } = {};
    const t = new TenantDb(fakeDb([{ id: PROJECT }], sink), COMPANY);
    const rows = await t.updateThrough(
      boqDocs, projects, boqDocs.projectId, PROJECT, { status: "approved" }, eq(boqDocs.id, "d0"),
    );
    expect(rows).toHaveLength(1);
    expect(sink.set).toEqual({ status: "approved" });
    // the write is additionally scoped BY the verified parent id (project_id),
    // so a row whose parent FK points elsewhere is never touched.
    const params = new PgDialect().sqlToQuery(sink.setWhere!).params;
    expect(params).toContain(PROJECT);
  });
});

describe("updateThroughChain is the fail-closed UPDATE door for MULTI-HOP child tables (P2-BE-03)", () => {
  // boq_item → boq_group → boq_doc → project (the deepest scoped write chain).
  const ITEM_HOPS = [
    { fk: boqItems.groupId, parent: boqGroups },
    { fk: boqGroups.boqId, parent: boqDocs },
    { fk: boqDocs.projectId, parent: projects },
  ];

  // The selectThrough ownership resolution returns `scopedRows`; the UPDATE
  // captures its set + WHERE and echoes the resolved rows merged with the set.
  function fakeDb(
    scopedRows: unknown[],
    sink: { selWhere?: SQL; setWhere?: SQL; set?: Record<string, unknown> },
  ): Db {
    const builder = {
      $dynamic: () => builder,
      innerJoin: () => builder,
      where: (where: SQL) => {
        sink.selWhere = where;
        return Promise.resolve(scopedRows);
      },
    };
    return {
      select: () => ({ from: () => builder }),
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: (where: SQL) => ({
            returning: () => {
              sink.set = set;
              sink.setWhere = where;
              return Promise.resolve(
                scopedRows.map((r) => ({ ...(r as object), ...set })),
              );
            },
          }),
        }),
      }),
    } as unknown as Db;
  }

  it("resolves scoped ids via the hop chain (company_id anchored) then updates ONLY those ids", async () => {
    const sink: { selWhere?: SQL; setWhere?: SQL; set?: Record<string, unknown> } = {};
    const t = new TenantDb(fakeDb([{ id: "it-1" }, { id: "it-2" }], sink), COMPANY);
    const rows = await t.updateThroughChain(
      boqItems,
      ITEM_HOPS,
      { remainQty: "5" },
      eq(boqItems.id, "it-1"),
    );
    expect(rows).toHaveLength(2);
    expect(sink.set).toEqual({ remainQty: "5" });
    // ownership resolution is anchored on company_id (via the project root).
    expect(new PgDialect().sqlToQuery(sink.selWhere!).params).toContain(COMPANY);
    // the UPDATE is scoped by id IN (<the RESOLVED scoped ids>), never by the
    // raw caller `where` alone — a foreign id could never slip through.
    const setParams = new PgDialect().sqlToQuery(sink.setWhere!).params;
    expect(setParams).toContain("it-1");
    expect(setParams).toContain("it-2");
  });

  it("updates NOTHING (returns []) when `where` resolves to no tenant-owned rows", async () => {
    const sink: { selWhere?: SQL; setWhere?: SQL; set?: Record<string, unknown> } = {};
    const t = new TenantDb(fakeDb([], sink), COMPANY);
    const rows = await t.updateThroughChain(
      boqItems,
      ITEM_HOPS,
      { remainQty: "0" },
      eq(boqItems.id, "foreign"),
    );
    expect(rows).toEqual([]);
    expect(sink.set).toBeUndefined(); // no UPDATE issued at all
  });
});

describe("updateThroughChainMany is the fail-closed BULK per-row UPDATE door (0024 perf)", () => {
  // Same deepest chain as updateThroughChain: boq_item → boq_group → boq_doc →
  // project. This door writes a DISTINCT value per id in ONE statement.
  const ITEM_HOPS = [
    { fk: boqItems.groupId, parent: boqGroups },
    { fk: boqGroups.boqId, parent: boqDocs },
    { fk: boqDocs.projectId, parent: projects },
  ];

  function fakeDb(
    scopedRows: unknown[],
    sink: { selWhere?: SQL; setWhere?: SQL; set?: Record<string, unknown> },
  ): Db {
    const builder = {
      $dynamic: () => builder,
      innerJoin: () => builder,
      where: (where: SQL) => {
        sink.selWhere = where;
        return Promise.resolve(scopedRows);
      },
    };
    return {
      select: () => ({ from: () => builder }),
      update: () => ({
        set: (set: Record<string, unknown>) => ({
          where: (where: SQL) => ({
            returning: () => {
              sink.set = set;
              sink.setWhere = where;
              return Promise.resolve(scopedRows.map((r) => ({ ...(r as object) })));
            },
          }),
        }),
      }),
    } as unknown as Db;
  }

  it("resolves ownership once (company_id anchored) then writes every id in ONE CASE update", async () => {
    const sink: { selWhere?: SQL; setWhere?: SQL; set?: Record<string, unknown> } = {};
    const t = new TenantDb(fakeDb([{ id: "it-1" }, { id: "it-2" }], sink), COMPANY);
    const rows = await t.updateThroughChainMany(
      boqItems,
      ITEM_HOPS,
      boqItems.remainQty,
      new Map([
        ["it-1", "5"],
        ["it-2", "3"],
      ]),
    );
    expect(rows).toHaveLength(2);
    // Ownership resolution is anchored on company_id (via the project root).
    expect(new PgDialect().sqlToQuery(sink.selWhere!).params).toContain(COMPANY);
    // ONE update whose SET remain_qty is a CASE binding each id + its own value.
    const caseParams = new PgDialect().sqlToQuery(sink.set!.remainQty as SQL).params;
    expect(caseParams).toEqual(expect.arrayContaining(["it-1", "5", "it-2", "3"]));
    // The UPDATE is scoped by id IN (<the RESOLVED scoped ids>).
    const whereParams = new PgDialect().sqlToQuery(sink.setWhere!).params;
    expect(whereParams).toEqual(expect.arrayContaining(["it-1", "it-2"]));
  });

  it("drops an id the hop chain did NOT resolve (a foreign id is never written)", async () => {
    const sink: { selWhere?: SQL; setWhere?: SQL; set?: Record<string, unknown> } = {};
    // Caller asks to update it-1 (owned) + evil (not owned); selectThrough only
    // resolves it-1 → the CASE and WHERE bind it-1 alone, evil is silently dropped.
    const t = new TenantDb(fakeDb([{ id: "it-1" }], sink), COMPANY);
    await t.updateThroughChainMany(
      boqItems,
      ITEM_HOPS,
      boqItems.remainQty,
      new Map([
        ["it-1", "5"],
        ["evil", "999"],
      ]),
    );
    const caseParams = new PgDialect().sqlToQuery(sink.set!.remainQty as SQL).params;
    expect(caseParams).toContain("it-1");
    expect(caseParams).not.toContain("evil");
    expect(caseParams).not.toContain("999");
    const whereParams = new PgDialect().sqlToQuery(sink.setWhere!).params;
    expect(whereParams).toContain("it-1");
    expect(whereParams).not.toContain("evil");
  });

  it("issues NO query for an empty values map (returns [], not even the resolve)", async () => {
    const sink: { selWhere?: SQL; setWhere?: SQL; set?: Record<string, unknown> } = {};
    const t = new TenantDb(fakeDb([{ id: "it-1" }], sink), COMPANY);
    const rows = await t.updateThroughChainMany(
      boqItems,
      ITEM_HOPS,
      boqItems.remainQty,
      new Map(),
    );
    expect(rows).toEqual([]);
    expect(sink.selWhere).toBeUndefined();
    expect(sink.set).toBeUndefined();
  });

  it("updates NOTHING (returns []) when the hop chain resolves no tenant-owned rows", async () => {
    const sink: { selWhere?: SQL; setWhere?: SQL; set?: Record<string, unknown> } = {};
    const t = new TenantDb(fakeDb([], sink), COMPANY);
    const rows = await t.updateThroughChainMany(
      boqItems,
      ITEM_HOPS,
      boqItems.remainQty,
      new Map([["foreign", "0"]]),
    );
    expect(rows).toEqual([]);
    expect(sink.set).toBeUndefined(); // no UPDATE issued at all
  });
});

describe("delete is always company_id-scoped", () => {
  it("scopes the WHERE by company_id", () => {
    const { sql, params } = tdb.delete(users).toSQL();
    expect(sql).toContain('"company_id" = $');
    expect(params).toContain(COMPANY);
  });

  it("AND-s a caller predicate onto the tenant predicate", () => {
    const { sql } = tdb.delete(users, eq(users.email, "a@b.co")).toSQL();
    expect(sql).toContain('"company_id" = $');
    expect(sql).toContain('"email" = $');
    expect(sql).toContain(" and ");
  });
});

describe("transaction door (B-097) — same-tenant scope, all-or-nothing", () => {
  // A non-connecting executor whose transaction() hands the real (never-queried)
  // drizzle handle straight to the callback — no BEGIN/COMMIT — so we can
  // .toSQL()-inspect the tenant scope of the wrapper the door builds for the
  // callback. Real rollback (BEGIN/COMMIT on a throw) is drizzle's contract and
  // is exercised by the live-PG finance E2E, not by serialization-only units.
  const passthrough = {
    transaction: (cb: (tx: unknown) => unknown) => cb(db),
  } as unknown as Db;
  const tdbTx = new TenantDb(passthrough, COMPANY);

  it("hands the callback a TenantDb bound to the SAME tenant (scope cannot widen)", async () => {
    let seen: string | undefined;
    await tdbTx.transaction(async (tx) => {
      seen = tx.companyId;
    });
    expect(seen).toBe(COMPANY);
    expect(seen).not.toBe(OTHER);
  });

  it("every door inside the transaction still injects company_id", async () => {
    await tdbTx.transaction(async (tx) => {
      const { sql, params } = tx.select(users).toSQL();
      expect(sql).toContain('"company_id" = $1');
      expect(params).toContain(COMPANY);
    });
  });

  it("propagates the callback's return value", async () => {
    const out = await tdbTx.transaction(async () => ({ ok: 7 }));
    expect(out).toEqual({ ok: 7 });
  });

  it("rejects (→ rollback) when the callback throws", async () => {
    await expect(
      tdbTx.transaction(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});

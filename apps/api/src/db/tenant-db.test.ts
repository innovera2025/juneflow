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
      insert: () => ({
        values: (rows: unknown[]) => ({
          returning: () => {
            sink.inserted = rows;
            return Promise.resolve(rows);
          },
        }),
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

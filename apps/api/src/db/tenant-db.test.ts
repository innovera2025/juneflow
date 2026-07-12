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
import { users } from "@juneflow/db";
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

// Tenant-scoped DB wrapper (P0-BE-11) — the single choke point that makes the
// hard rule enforceable and testable:
//
//   "company_id is enforced via middleware on EVERY query — no query may escape
//    tenant scope, not even one." (PLAN.md §5 + Appendix A, apps/api/CLAUDE.md)
//
// How it enforces (fail-closed):
//   - Construction requires a non-empty companyId, else it throws.
//   - It exposes ONLY scoped operations. Every read/update/delete auto-injects
//     `eq(table.company_id, companyId)` (AND-ed with any caller predicate) and
//     every insert force-sets `company_id = companyId`. The un-scoped base
//     handle is held privately and never returned, so a handler physically
//     cannot issue a query without the tenant predicate.
//
// Scoped operations accept only tables that carry a `companyId` column (the
// TenantTable generic). The one unscoped door, selectReference(), is runtime-
// allowlisted to exactly the platform-global reference tables
// (package/project_type/company) and throws for everything else — including
// parent-FK-scoped tenant tables that have no companyId column of their own.
//
// G3: src/db/tenant-db.test.ts proves the predicate/value is present on every
// operation by inspecting the generated SQL (drizzle `.toSQL()`), and that a
// missing companyId fails closed.
import { and, eq, getTableColumns, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import { companies, packages, projectTypes } from "@juneflow/db/schema";
import type { Db } from "@juneflow/db/client";

/** A tenant-owned table: any Drizzle table exposing a `companyId` column. */
export type TenantTable = PgTable & { companyId: PgColumn };

/**
 * A platform-global reference table: one WITHOUT a `companyId` column
 * (package, project_type, company). NOTE the type gate is only a first line of
 * defense: it blocks tables that carry a companyId column, but tables scoped
 * via a PARENT FK (boq_doc → project, work_period → subcon_contract, ...) also
 * have no companyId column and would compile through. The REAL enforcement is
 * the REFERENCE_TABLES runtime allowlist in selectReference() — anything not
 * on it throws TenantScopeError (gate 4.5 finding, P1-BE-01 rework).
 */
export type ReferenceTable = PgTable & { companyId?: never };

/**
 * The ONLY tables selectReference() may read: genuinely platform-global
 * reference data with no tenant owner at all. Parent-FK-scoped tenant tables
 * (BOQ, subcon, acceptance, ...) are NOT reference tables — they must be read
 * through predicates that anchor on a company_id-scoped root. Extend this list
 * only for tables the erd shows with no company linkage at any depth.
 */
const REFERENCE_TABLES: ReadonlySet<PgTable> = new Set<PgTable>([
  packages,
  projectTypes,
  companies,
]);

/** Insert payload for a tenant table, minus company_id (the wrapper injects it). */
type TenantInsert<T extends TenantTable> = Omit<T["$inferInsert"], "companyId">;

/** Update payload for a tenant table; company_id can never be reassigned. */
type TenantUpdate<T extends TenantTable> = Partial<Omit<T["$inferInsert"], "companyId">>;

export class TenantScopeError extends Error {
  constructor(
    message = "TENANT_SCOPE_MISSING: a valid company_id is required for every query",
  ) {
    super(message);
    this.name = "TenantScopeError";
  }
}

export class TenantDb {
  readonly companyId: string;
  readonly #db: Db;

  constructor(db: Db, companyId: string) {
    // Fail closed: without a tenant we must never hand out a DB handle.
    if (!companyId) throw new TenantScopeError();
    this.#db = db;
    this.companyId = companyId;
  }

  /** company_id predicate AND-ed with an optional caller-supplied predicate. */
  #scope(table: TenantTable, extra?: SQL): SQL {
    const tenant = eq(table.companyId, this.companyId);
    return extra ? (and(tenant, extra) as SQL) : tenant;
  }

  /** SELECT * FROM table WHERE company_id = ? [AND extra]. */
  select<T extends TenantTable>(table: T, where?: SQL) {
    return this.#db.select().from(table).where(this.#scope(table, where));
  }

  /** INSERT with company_id force-set to this tenant (any caller value ignored). */
  insert<T extends TenantTable>(table: T, values: TenantInsert<T>) {
    const row = { ...values, companyId: this.companyId } as T["$inferInsert"];
    return this.#db.insert(table).values(row);
  }

  /** UPDATE ... WHERE company_id = ? [AND extra]; company_id itself is immutable. */
  update<T extends TenantTable>(table: T, set: TenantUpdate<T>, where?: SQL) {
    // Fail-closed at runtime, mirroring insert(): the public `set` type forbids
    // reassigning company_id, but a caller can still smuggle one in past the type
    // (via `any`/cast/untyped JS). Strip it here so a row can never be moved to
    // another tenant — the WHERE scope alone would not stop a SET company_id = X.
    const { companyId: _immutable, ...safe } = set as Record<string, unknown>;
    return this.#db
      .update(table)
      .set(safe as PgUpdateSetSource<T>)
      .where(this.#scope(table, where));
  }

  /** DELETE FROM table WHERE company_id = ? [AND extra]. */
  delete<T extends TenantTable>(table: T, where?: SQL) {
    return this.#db.delete(table).where(this.#scope(table, where));
  }

  /**
   * Read a parent-FK-scoped tenant table THROUGH its ancestry to a
   * company_id-scoped root (P1-BE-02). Tables like boq_doc / work_period /
   * pm_workorder / project_node carry no companyId column of their own — the
   * erd scopes them via a parent chain that ends at a tenant root (project,
   * ...). This is the ONLY door for reading them, and it is scoped by
   * construction:
   *
   *   SELECT child.* FROM child
   *     INNER JOIN hop1 ON child.fk = hop1.id
   *     [INNER JOIN hop2 ...]
   *   WHERE root.company_id = <this tenant> [AND extra]
   *
   * Fail-closed rules (throws TenantScopeError):
   *   - hops must be non-empty (a companyId-less table can never be read bare)
   *   - the FINAL hop's parent must be a TenantTable (companyId column), so
   *     the tenant predicate always anchors on a real scoped root.
   */
  selectThrough<T extends PgTable>(
    table: T,
    hops: readonly { fk: PgColumn; parent: PgTable }[],
    where?: SQL,
  ) {
    const root = hops[hops.length - 1]?.parent;
    if (!root) {
      throw new TenantScopeError(
        "TENANT_SCOPE_PATH_MISSING: selectThrough() requires at least one " +
          "join hop ending at a company_id-scoped root table",
      );
    }
    const rootCompanyId = (root as Partial<TenantTable>).companyId;
    if (!rootCompanyId) {
      throw new TenantScopeError(
        "TENANT_SCOPE_ROOT_UNSCOPED: the final selectThrough() hop must be a " +
          "tenant table carrying a company_id column",
      );
    }
    const tenant = eq(rootCompanyId, this.companyId);
    // Drizzle's join generics do not compose under a generic child table, so
    // the builder is accumulated through a minimal structural view; the final
    // row type is exact (we select ONLY the child's columns).
    interface ThroughBuilder {
      innerJoin(parent: PgTable, on: SQL): ThroughBuilder;
      where(predicate: SQL): Promise<T["$inferSelect"][]> & { toSQL(): { sql: string; params: unknown[] } };
    }
    let query = this.#db
      .select(getTableColumns(table))
      .from(table)
      .$dynamic() as unknown as ThroughBuilder;
    for (const hop of hops) {
      const parentId = (hop.parent as PgTable & { id?: PgColumn }).id;
      if (!parentId) {
        throw new TenantScopeError(
          "TENANT_SCOPE_HOP_INVALID: every selectThrough() hop parent must " +
            "expose an id primary-key column to join on",
        );
      }
      query = query.innerJoin(hop.parent, eq(hop.fk, parentId));
    }
    return query.where(where ? (and(tenant, where) as SQL) : tenant);
  }

  /**
   * WRITE door for a parent-FK-scoped child table (project_node, ...) that
   * carries no companyId column of its own — the insert counterpart to
   * selectThrough(). Fail-closed BY CONSTRUCTION: it FIRST verifies this tenant
   * owns the company_id-scoped parent row (parent.id = parentId AND
   * parent.company_id = <tenant>) and throws TenantScopeError otherwise, so a
   * child can never be written under another tenant's parent. Only then does it
   * INSERT ... RETURNING. Callers MUST set every row's parent FK to `parentId`
   * (e.g. project_node.project_id = the verified project) — the scope anchors on
   * that verified parent exactly like selectThrough anchors its reads.
   */
  async insertThrough<T extends PgTable>(
    table: T,
    parent: TenantTable,
    parentId: string,
    rows: readonly T["$inferInsert"][],
  ): Promise<T["$inferSelect"][]> {
    const parentPk = (parent as PgTable & { id?: PgColumn }).id;
    if (!parentPk) {
      throw new TenantScopeError(
        "TENANT_SCOPE_HOP_INVALID: insertThrough() parent must expose an id " +
          "primary-key column to anchor the tenant scope on",
      );
    }
    const owned = await this.#db
      .select({ id: parentPk })
      .from(parent)
      .where(
        and(eq(parentPk, parentId), eq(parent.companyId, this.companyId)) as SQL,
      );
    if (owned.length === 0) {
      throw new TenantScopeError(
        "TENANT_SCOPE_PARENT_DENIED: insertThrough() parent row is not owned " +
          "by this tenant — a child cannot be written under a foreign parent",
      );
    }
    const created = await this.#db
      .insert(table)
      .values(rows as T["$inferInsert"][])
      .returning();
    return created as T["$inferSelect"][];
  }

  /**
   * Read a platform-global REFERENCE table (no `companyId` column exists, so no
   * tenant predicate is possible — exactly: package, project_type, company).
   * Read-only, and gated TWICE: the ReferenceTable type blocks companyId-column
   * tables at compile time, and the REFERENCE_TABLES allowlist rejects every
   * other table at runtime (parent-FK-scoped tenant tables like
   * boq_doc/work_period have no companyId column and would otherwise compile
   * through — gate 4.5 finding). Callers must only resolve reference rows the
   * tenant already points at (e.g. its own subscription's package_id) — never
   * enumerate other tenants.
   */
  selectReference<T extends ReferenceTable>(table: T, where?: SQL) {
    if (!REFERENCE_TABLES.has(table)) {
      throw new TenantScopeError(
        "TENANT_SCOPE_REFERENCE_DENIED: not a platform-global reference table " +
          "(allowlist: package, project_type, company) — tenant-owned data, " +
          "including parent-FK-scoped tables, must go through the scoped select()",
      );
    }
    const query = this.#db.select().from(table);
    return where ? query.where(where) : query;
  }
}

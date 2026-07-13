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
// Only tables that carry a `companyId` column can be reached through this
// wrapper — the generic constraint rejects anything else at compile time, so a
// tenant-owned table can never be queried un-scoped by accident.
//
// G3: src/db/tenant-db.test.ts proves the predicate/value is present on every
// operation by inspecting the generated SQL (drizzle `.toSQL()`), and that a
// missing companyId fails closed.
import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import type { Db } from "@juneflow/db/client";

/** A tenant-owned table: any Drizzle table exposing a `companyId` column. */
export type TenantTable = PgTable & { companyId: PgColumn };

/**
 * A platform-global reference table: one WITHOUT a `companyId` column, so
 * tenant scoping is impossible by definition (package, project_type, company).
 * The `companyId?: never` constraint makes the two sets mutually exclusive at
 * compile time — a tenant-owned table can never slip through this door.
 */
export type ReferenceTable = PgTable & { companyId?: never };

/** Insert payload for a tenant table, minus company_id (the wrapper injects it). */
type TenantInsert<T extends TenantTable> = Omit<T["$inferInsert"], "companyId">;

/** Update payload for a tenant table; company_id can never be reassigned. */
type TenantUpdate<T extends TenantTable> = Partial<Omit<T["$inferInsert"], "companyId">>;

export class TenantScopeError extends Error {
  constructor() {
    super("TENANT_SCOPE_MISSING: a valid company_id is required for every query");
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
   * Read a platform-global REFERENCE table (no `companyId` column exists, so no
   * tenant predicate is possible — e.g. package, project_type, company). This is
   * deliberately read-only and type-gated to non-tenant tables: every
   * tenant-owned table still MUST go through the scoped select() above.
   * Callers must only resolve reference rows the tenant already points at
   * (e.g. its own subscription's package_id) — never enumerate other tenants.
   */
  selectReference<T extends ReferenceTable>(table: T, where?: SQL) {
    const query = this.#db.select().from(table);
    return where ? query.where(where) : query;
  }
}

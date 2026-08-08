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
// (package/company) and throws for everything else — including parent-FK-scoped
// tenant tables that have no companyId column of their own.
//
// project_type is a HYBRID table (B-065, P1-BE-14): its 4 product defaults are
// global (company_id IS NULL) but tenant-created custom types are owned
// (company_id = tenant). It now carries a nullable companyId column, so it is
// read through the dedicated selectGlobalOrOwned() door (global OR own — never
// another tenant's) and written through the scoped insert()/update() doors. It
// is NO LONGER on the selectReference() allowlist.
//
// G3: src/db/tenant-db.test.ts proves the predicate/value is present on every
// operation by inspecting the generated SQL (drizzle `.toSQL()`), and that a
// missing companyId fails closed.
import { and, eq, getTableColumns, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import { companies, packages } from "@juneflow/db/schema";
import type { Db } from "@juneflow/db/client";

/** A tenant-owned table: any Drizzle table exposing a `companyId` column. */
export type TenantTable = PgTable & { companyId: PgColumn };

/**
 * A platform-global reference table: one WITHOUT a `companyId` column
 * (package, company). NOTE the type gate is only a first line of defense: it
 * blocks tables that carry a companyId column, but tables scoped via a PARENT
 * FK (boq_doc → project, work_period → subcon_contract, ...) also have no
 * companyId column and would compile through. The REAL enforcement is the
 * REFERENCE_TABLES runtime allowlist in selectReference() — anything not on it
 * throws TenantScopeError (gate 4.5 finding, P1-BE-01 rework).
 */
export type ReferenceTable = PgTable & { companyId?: never };

/**
 * The ONLY tables selectReference() may read: genuinely platform-global
 * reference data with NO tenant owner at all. Parent-FK-scoped tenant tables
 * (BOQ, subcon, acceptance, ...) are NOT reference tables — they must be read
 * through predicates that anchor on a company_id-scoped root. project_type left
 * this list in B-065 (it gained a nullable company_id — a hybrid global/tenant
 * table, read via selectGlobalOrOwned()). Extend this list only for tables the
 * erd shows with no company linkage at any depth.
 */
const REFERENCE_TABLES: ReadonlySet<PgTable> = new Set<PgTable>([
  packages,
  companies,
]);

/** Insert payload for a tenant table, minus company_id (the wrapper injects it). */
type TenantInsert<T extends TenantTable> = Omit<T["$inferInsert"], "companyId">;

/** Update payload for a tenant table; company_id can never be reassigned. */
type TenantUpdate<T extends TenantTable> = Partial<Omit<T["$inferInsert"], "companyId">>;

/**
 * The executor backing a TenantDb: either the root pool handle (`Db`) or an OPEN
 * transaction handle. Both expose the identical query-builder + nested
 * `.transaction()` surface — they share drizzle's `PgDatabase` base — so every
 * door compiles and runs against either. The tx handle is DERIVED from `Db`
 * itself via `infer`, so we depend on drizzle's own inference rather than its
 * un-exported `ExtractTablesWithRelations` generic. `transaction()` rebuilds a
 * scoped wrapper over the tx handle, keeping the company_id scope inside a
 * transaction (B-097, security-core: a transaction can never widen tenant scope).
 */
type TxHandle<D> = D extends {
  transaction(fn: (tx: infer TX) => Promise<unknown>): Promise<unknown>;
}
  ? TX
  : never;
type Executor = Db | TxHandle<Db>;

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
  readonly #db: Executor;

  constructor(db: Executor, companyId: string) {
    // Fail closed: without a tenant we must never hand out a DB handle.
    if (!companyId) throw new TenantScopeError();
    this.#db = db;
    this.companyId = companyId;
  }

  /**
   * Run `fn` inside a SINGLE DB transaction, scoped to THIS tenant. The wrapper
   * handed to `fn` re-applies the same company_id predicate on every door, so
   * multi-write handlers commit all-or-nothing: bank import (statement + lines),
   * gl.jv (header + lines), boq approve (doc + version-history). Throwing from
   * `fn` — an FK violation, a unique-index conflict (migration-0028 reverse
   * uniqueness), or an explicit guard — ROLLS BACK every write in the block, so
   * a failed multi-write never leaves an orphaned parent or a partial post.
   *
   * Security-core (B-097): the tx-scoped wrapper is constructed with the
   * IDENTICAL companyId (`this.companyId`), so a transaction inherits — and can
   * never widen — the caller's tenant scope. Every door on the inner wrapper
   * still AND-s the tenant predicate. Reads used only to DECIDE writes should
   * stay OUTSIDE the block; put the writes (and any read whose result must be
   * consistent with them) inside.
   */
  async transaction<R>(fn: (tx: TenantDb) => Promise<R>): Promise<R> {
    return this.#db.transaction((tx) => fn(new TenantDb(tx, this.companyId)));
  }

  /** company_id predicate AND-ed with an optional caller-supplied predicate. */
  #scope(table: TenantTable, extra?: SQL): SQL {
    const tenant = eq(table.companyId, this.companyId);
    return extra ? (and(tenant, extra) as SQL) : tenant;
  }

  // drizzle 0.45 hardened `.select().from(x)` with a `TableLikeHasEmptySelection<x>`
  // guard (rejects referencing a data-modifying subquery that has no `returning`
  // clause). That guard is a conditional type which only ever excludes empty
  // Subqueries — never a real PgTable — but it cannot REDUCE for an unbounded
  // generic table param `T`, so a generic `.from(table)` stopped type-checking on
  // the 0.38→0.45 bump even though every call site here passes a concrete table.
  // Fix: pin the type arg (`.from<T>`) so the exact row type is preserved, and
  // assert the argument through the guard's (unreducible-but-satisfied) parameter
  // slot with `as never` (the bottom type is assignable to any parameter shape).
  // Pure type adaptation — zero runtime/query change.

  /** SELECT * FROM table WHERE company_id = ? [AND extra]. */
  select<T extends TenantTable>(table: T, where?: SQL) {
    return this.#db
      .select()
      .from<T>(table as never)
      .where(this.#scope(table, where));
  }

  /**
   * SELECT … WHERE company_id = ? [AND extra] ORDER BY id FOR UPDATE — the same
   * scoped read as select(), plus a ROW LOCK on every row it returns (B-342).
   *
   * WHY THIS DOOR EXISTS. The negative-stock guard reads stock_ledger inside a
   * transaction and compares Σ(qty) in memory. Under READ COMMITTED — the default,
   * and there is no isolation override anywhere in apps/api — two storekeepers
   * moving the same item both read the same balance, both pass, and both commit.
   * Measured live on real Postgres, 2 separate processes, 6 rounds: the
   * transfer-approve path answered [200,200] with a source balance of −100 in 5 of
   * them.
   *
   * WHY LOCKING THE LEDGER WOULD NOT WORK, and this locks inventory_item instead:
   * `SELECT … FOR UPDATE` locks rows that EXIST. It cannot block another
   * transaction's INSERT (there is no predicate locking under READ COMMITTED), and
   * on a first movement there are no ledger rows to lock at all. The lock therefore
   * has to be taken on a row that already exists and that both writers must pass
   * through — the inventory_item. Coarser than per-(item, warehouse): two issues of
   * the same material from DIFFERENT stores serialise against each other. That is
   * accepted deliberately at human operating pace, and named rather than hidden.
   *
   * ORDER BY id IS LOAD-BEARING, not tidiness: the sort sits below the LockRows node,
   * so rows are locked in a deterministic order and two multi-line documents with
   * overlapping item sets cannot deadlock by grabbing them in opposite orders.
   *
   * THE HAZARD, written down because it is invisible at the call site: this is
   * correct BECAUSE READ COMMITTED takes a fresh snapshot per statement, so the
   * ledger SELECT issued after the lock wait sees the winner's commit. Under
   * REPEATABLE READ or SERIALIZABLE the snapshot is fixed at the first statement and
   * THIS GUARD SILENTLY STOPS WORKING. Anyone raising the isolation level for an
   * unrelated reason breaks the money guard without touching the calling file.
   *
   * Tenant scope is identical to select(): the company_id predicate is AND-ed in by
   * #scope, so a lock can never be taken on another tenant's row.
   */
  selectForUpdate<T extends TenantTable & { id: PgColumn }>(table: T, where?: SQL) {
    return this.#db
      .select()
      .from<T>(table as never)
      .where(this.#scope(table, where))
      .orderBy(table.id)
      .for("update");
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
      .from<T>(table as never) // drizzle 0.45 .from() guard — see select() note
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
   * UPDATE door for a parent-FK-scoped child table (boq_doc, ...) that carries
   * no companyId column of its own — the update counterpart to insertThrough()
   * (P2-BE-02). Fail-closed BY CONSTRUCTION: it FIRST verifies this tenant owns
   * the company_id-scoped parent row (parent.id = parentId AND
   * parent.company_id = <tenant>) and throws TenantScopeError otherwise, so a
   * child can never be mutated under another tenant's parent. Only then does it
   * UPDATE ... RETURNING, scoping the write BY parentFk = parentId as well, so a
   * row whose parent FK points elsewhere is never touched even if `where` alone
   * would match it.
   *
   * Callers pass the child's FK column (`parentFk`, e.g. boqDocs.projectId), the
   * verified `parentId` (the parent row this tenant owns — resolve it first via a
   * scoped selectThrough), and a `where` narrowing to the specific child row
   * (e.g. eq(boqDocs.id, docId)). The state machine (boq submit/approve/revise)
   * is the first caller.
   */
  async updateThrough<T extends PgTable>(
    table: T,
    parent: TenantTable,
    parentFk: PgColumn,
    parentId: string,
    set: Partial<T["$inferInsert"]>,
    // Optional to match selectThrough()'s where?: SQL — a caller composing the
    // predicate with and()/or() (which return SQL | undefined) needs no cast. The
    // impl below AND-s it into the parent-FK scope, which tolerates undefined.
    where?: SQL,
  ): Promise<T["$inferSelect"][]> {
    const parentPk = (parent as PgTable & { id?: PgColumn }).id;
    if (!parentPk) {
      throw new TenantScopeError(
        "TENANT_SCOPE_HOP_INVALID: updateThrough() parent must expose an id " +
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
        "TENANT_SCOPE_PARENT_DENIED: updateThrough() parent row is not owned " +
          "by this tenant — a child cannot be mutated under a foreign parent",
      );
    }
    const updated = await this.#db
      .update(table)
      .set(set as PgUpdateSetSource<T>)
      .where(and(where, eq(parentFk, parentId)) as SQL)
      .returning();
    return updated as T["$inferSelect"][];
  }

  /**
   * UPDATE door for a table scoped through a MULTI-HOP ancestry (boq_item →
   * boq_group → boq_doc → project) — the deep-chain counterpart to
   * updateThrough(), which only reaches a child that carries a DIRECT tenant-FK
   * column (boq_doc.project_id). boq_item carries neither a companyId column nor
   * a project_id FK, so updateThrough() cannot anchor on it; this door proves
   * tenant ownership EXACTLY the way selectThrough() reads it — by resolving the
   * target rows THROUGH the hop chain to a company_id-scoped root — and then
   * updates strictly the resolved ids.
   *
   * Fail-closed BY CONSTRUCTION: the id set is produced ONLY by selectThrough()
   * (which AND-anchors company_id on the root table), so an id in `where` that
   * belongs to another tenant resolves to nothing and is never written. The
   * final UPDATE is scoped by `id IN (<resolved scoped ids>)`, never by the raw
   * caller `where` alone. Returns the updated rows (empty when `where` matched
   * nothing within this tenant). The first caller is BOQ generate-PR cut-remain
   * (boq_item.remain_qty -= generated qty).
   */
  async updateThroughChain<T extends PgTable & { id: PgColumn }>(
    table: T,
    hops: readonly { fk: PgColumn; parent: PgTable }[],
    set: Partial<T["$inferInsert"]>,
    // Optional to match selectThrough() (which this delegates to for the ownership
    // proof) — an and()/or()-composed predicate needs no cast at the call site.
    where?: SQL,
    // B-149 optimistic-lock predicate on the TARGET table's OWN columns, re-applied
    // to the FINAL update — NOT just the resolve SELECT. The resolve→update is two
    // round-trips, so a status guard placed only in `where` (the SELECT) does NOT
    // close a concurrent race: under READ COMMITTED the loser's UPDATE re-checks
    // (EPQ) only `id IN (ids)` and still matches → a duplicate commit. Folding the
    // guard into the UPDATE's own WHERE makes the flip atomic — the loser re-matches
    // `id IN (ids) AND <guard>` against the committed row and gets 0 rows. MUST
    // reference only `table`'s own columns (the final UPDATE carries no joins).
    guard?: SQL,
  ): Promise<T["$inferSelect"][]> {
    const idCol = (table as PgTable & { id?: PgColumn }).id;
    if (!idCol) {
      throw new TenantScopeError(
        "TENANT_SCOPE_HOP_INVALID: updateThroughChain() table must expose an id " +
          "primary-key column to anchor the scoped update on",
      );
    }
    // Resolve the tenant-scoped rows matching `where` THROUGH the hop chain —
    // this is the ownership proof (selectThrough anchors company_id on the root).
    const scoped = (await this.selectThrough(table, hops, where)) as {
      id: unknown;
    }[];
    const ids = scoped.map((r) => r.id);
    if (ids.length === 0) return [];
    const idScope = inArray(idCol, ids as never[]);
    const updated = await this.#db
      .update(table)
      .set(set as PgUpdateSetSource<T>)
      .where(guard ? (and(idScope, guard) as SQL) : idScope)
      .returning();
    return updated as T["$inferSelect"][];
  }

  /**
   * BULK, PER-ROW UPDATE door for a table scoped through a MULTI-HOP ancestry —
   * the set-many counterpart to updateThroughChain() (perf 0024 audit). Where
   * updateThroughChain() writes ONE value to every matched row, this writes a
   * DISTINCT value per id in a SINGLE statement. It exists to kill the
   * generate-PR cut-remain N+1: decrementing N BOQ items' remain_qty previously
   * cost 2·N queries (N ownership-resolve selectThroughs + N updates); this
   * collapses it to 2 (one selectThrough ownership resolve + one CASE update).
   *
   * Fail-closed BY CONSTRUCTION, exactly like updateThroughChain(): the id set
   * is resolved ONLY by selectThrough() (which AND-anchors company_id on the
   * root), so an id belonging to another tenant resolves to nothing and is never
   * written. The final UPDATE is scoped by `id IN (<resolved scoped ids>)`, and
   * each row's new value is taken from the caller `values` map keyed by that
   * resolved id — never trusting the caller's raw id list. Returns the updated
   * rows (empty when `values` is empty or nothing resolved within this tenant).
   *
   * `column` is the single target column (e.g. boqItems.remainQty); each THEN
   * branch is cast to that column's own SQL type so the CASE result type is
   * unambiguous for any column kind.
   */
  async updateThroughChainMany<T extends PgTable & { id: PgColumn }>(
    table: T,
    hops: readonly { fk: PgColumn; parent: PgTable }[],
    column: PgColumn,
    values: ReadonlyMap<string, string>,
  ): Promise<T["$inferSelect"][]> {
    const idCol = (table as PgTable & { id?: PgColumn }).id;
    if (!idCol) {
      throw new TenantScopeError(
        "TENANT_SCOPE_HOP_INVALID: updateThroughChainMany() table must expose an " +
          "id primary-key column to anchor the scoped update on",
      );
    }
    const ids = [...values.keys()];
    if (ids.length === 0) return [];
    // Ownership proof: resolve the tenant-scoped rows THROUGH the hop chain
    // (selectThrough AND-anchors company_id on the root) — never trust the raw ids.
    const scoped = (await this.selectThrough(
      table,
      hops,
      inArray(idCol, ids as never[]),
    )) as { id: unknown }[];
    const scopedIds = scoped
      .map((r) => r.id as string)
      .filter((id) => values.has(id));
    if (scopedIds.length === 0) return [];
    // Resolve the drizzle property key for `column` so .set() targets it by key.
    const cols = getTableColumns(table) as Record<string, PgColumn>;
    const colKey = Object.keys(cols).find((k) => cols[k]?.name === column.name);
    if (!colKey) {
      throw new TenantScopeError(
        "TENANT_SCOPE_COLUMN_INVALID: updateThroughChainMany() column must belong " +
          "to the target table",
      );
    }
    // One statement:
    //   SET col = CASE WHEN id = $a THEN $b::<coltype> ... ELSE col END
    //   WHERE id IN (<scoped ids>)
    // Each new value comes from the caller map keyed by the RESOLVED scoped id.
    const sqlType = column.getSQLType();
    const whenClauses = scopedIds.map(
      (id) =>
        sql`when ${idCol} = ${id} then ${values.get(id)!}::${sql.raw(sqlType)}`,
    );
    const caseExpr = sql`case ${sql.join(whenClauses, sql` `)} else ${column} end`;
    const updated = await this.#db
      .update(table)
      .set({ [colKey]: caseExpr } as PgUpdateSetSource<T>)
      .where(inArray(idCol, scopedIds as never[]))
      .returning();
    return updated as T["$inferSelect"][];
  }

  /**
   * Read a platform-global REFERENCE table (no `companyId` column exists, so no
   * tenant predicate is possible — exactly: package, company). Read-only, and
   * gated TWICE: the ReferenceTable type blocks companyId-column tables at
   * compile time, and the REFERENCE_TABLES allowlist rejects every other table
   * at runtime (parent-FK-scoped tenant tables like boq_doc/work_period have no
   * companyId column and would otherwise compile through — gate 4.5 finding).
   * Callers must only resolve reference rows the tenant already points at (e.g.
   * its own subscription's package_id) — never enumerate other tenants.
   */
  selectReference<T extends ReferenceTable>(table: T, where?: SQL) {
    if (!REFERENCE_TABLES.has(table)) {
      throw new TenantScopeError(
        "TENANT_SCOPE_REFERENCE_DENIED: not a platform-global reference table " +
          "(allowlist: package, company) — tenant-owned data, including " +
          "parent-FK-scoped and hybrid tables (project_type), must go through " +
          "the scoped select()/selectGlobalOrOwned()",
      );
    }
    const query = this.#db.select().from<T>(table as never); // guard — see select()
    return where ? query.where(where) : query;
  }

  /**
   * Read a HYBRID global/tenant table (B-065, P1-BE-14 — currently project_type):
   * rows are EITHER platform-global defaults (company_id IS NULL, shared/seeded)
   * OR this tenant's own custom rows (company_id = <tenant>). Returns their
   * UNION and NEVER another tenant's rows.
   *
   * Unlike select(), which hard-filters company_id = <tenant> (and would hide
   * the shared globals), the scope here is
   *   (company_id IS NULL OR company_id = <tenant>) [AND extra].
   * Writes still flow through the scoped insert()/update() doors (force-set /
   * hard-filter company_id = <tenant>), so a tenant can only ever create or
   * mutate its OWN rows — the global defaults are read-only to every tenant.
   */
  selectGlobalOrOwned<T extends TenantTable>(table: T, where?: SQL) {
    const scope = or(
      isNull(table.companyId),
      eq(table.companyId, this.companyId),
    ) as SQL;
    return this.#db
      .select()
      .from<T>(table as never) // drizzle 0.45 .from() guard — see select() note
      .where(where ? (and(scope, where) as SQL) : scope);
  }
}

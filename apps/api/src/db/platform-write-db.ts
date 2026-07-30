// Platform-owner cross-tenant WRITE door (Phase-6 W1a, B-193) — the sensitive
// counterpart to the PlatformDb read door, and the single most dangerous handle
// in the codebase (an owner mutating ANY tenant's row).
//
// Mirrors PlatformDb's containment exactly (private #db, allowlist-throw,
// constructed once in app.ts, injected ONLY into owner-gated WRITE handlers —
// never on `request`, never a read handler) and TenantDb.update()'s runtime
// field-strip.
//
// FAIL-CLOSED BY CONSTRUCTION:
//   - UPDATE ALLOWLIST: updateAllTenants() throws for any table not in
//     WRITE_TABLES — the writable admin subset (user + company status writes,
//     and the global package catalog edit). subscription/platform_invoice stay
//     read-only.
//   - INSERT ALLOWLIST: insertOne() has its OWN, strictly narrower INSERT_TABLES
//     ({package} only). INSERT is a net-new create primitive (materializes a
//     row), materially more dangerous than a single-row UPDATE — cross-tenant
//     user/company CREATION is deliberately unreachable (they stay UPDATE-only).
//   - STRIP is_platform_admin: a write/create can NEVER set the owner flag — the
//     self-elevation defense (a write must not be a mint-new-owners primitive).
//     Both the drizzle key (isPlatformAdmin) and the raw column are dropped.
//   - STRIP company_id: a write can never move/inject a row into another tenant.
//   - STRIP id: the primary key is owned by the WHERE (update) or the DB's
//     defaultRandom (insert), never the SET/VALUES.
//   - SINGLE ROW: every UPDATE is scoped by `id = <id>` — never a blanket UPDATE
//     (package is a global catalog row, so its edit has no company predicate —
//     an intended global-blast-radius change, gated only by ownerOnly()).
//   - It carries NO owner check itself — the caller's ownerOnly() gate does that.
import type { SQL } from "drizzle-orm";
import { eq } from "drizzle-orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import { companies, packages, subscriptions, users } from "@juneflow/db/schema";
import type { Db } from "@juneflow/db/client";
import { TenantScopeError } from "./tenant-db.js";

/**
 * The tables the platform owner may UPDATE through this door — the writable admin
 * subset: user (block/unblock), company (suspend/resume), package (edit the global
 * plan catalog, B-197), and subscription (set a tenant's plan/seats, B-201).
 * Narrower than PlatformDb's read allowlist. Extend ONLY for a genuinely
 * platform-admin-WRITABLE table alongside an owner-gated write handler.
 *
 * NOTE on the company_id strip: package is GLOBAL (no company_id), but subscription
 * is a TENANT-owned table WITH company_id — so for it the updateAllTenants
 * company_id strip is LOAD-BEARING: it stops an owner re-homing a subscription to
 * another tenant (a smuggled company_id in the set is dropped).
 */
const WRITE_TABLES: ReadonlySet<PgTable> = new Set<PgTable>([
  users,
  companies,
  packages,
  subscriptions,
]);

/**
 * The tables the platform owner may CREATE (INSERT) through this door — a
 * SEPARATE, strictly narrower set than WRITE_TABLES: ONLY the global package
 * catalog (B-197). INSERT is a net-new create primitive, so user/company stay
 * UPDATE-only here — cross-tenant user/company creation is deliberately
 * unreachable (reusing WRITE_TABLES would silently make it possible).
 */
const INSERT_TABLES: ReadonlySet<PgTable> = new Set<PgTable>([packages]);

/** A table exposing an `id` primary key — the single-row anchor for every write. */
type IdTable = PgTable & { id: PgColumn };

export class PlatformWriteDb {
  /** The un-scoped base handle — PRIVATE. Never returned, never on `request`. */
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * UPDATE <admin table> SET <safe> WHERE id = <id> RETURNING * — spanning ALL
   * tenants (NO company_id predicate; cross-tenant is the point). Guarded by the
   * WRITE_TABLES allowlist. The caller MUST be behind ownerOnly(); this repeats
   * no owner check (two independent layers must both hold). Strips
   * is_platform_admin (self-elevation defense), company_id (no tenant move), and
   * id (PK owned by the WHERE) — both the drizzle property key AND the raw
   * snake_case column name. Returns the updated row(s) so the handler can audit
   * the TARGET company.
   */
  async updateAllTenants<T extends IdTable>(
    table: T,
    id: string,
    set: Partial<T["$inferInsert"]>,
  ): Promise<T["$inferSelect"][]> {
    if (!WRITE_TABLES.has(table)) {
      throw new TenantScopeError(
        "PLATFORM_ADMIN_WRITE_DENIED: not a platform-admin-writable table " +
          "(allowlist: user, company, package, subscription)",
      );
    }
    const {
      isPlatformAdmin: _ownerFlag,
      is_platform_admin: _ownerFlagRaw,
      companyId: _immutableTenant,
      company_id: _immutableTenantRaw,
      id: _immutableId,
      ...safe
    } = set as Record<string, unknown>;
    void _ownerFlag;
    void _ownerFlagRaw;
    void _immutableTenant;
    void _immutableTenantRaw;
    void _immutableId;
    const updated = await this.#db
      .update(table)
      .set(safe as PgUpdateSetSource<T>)
      .where(eq(table.id, id) as SQL)
      .returning();
    return updated as T["$inferSelect"][];
  }

  /**
   * INSERT one row into an INSERT_TABLES-allowlisted table (package only) —
   * the owner's create-a-plan primitive (B-197). Gated on its OWN allowlist (a
   * net-new create is more dangerous than an UPDATE), and strips id (server
   * defaultRandom — a client can never pin a PK), is_platform_admin (a create can
   * never mint an owner), and company_id (a create can never inject a tenant
   * owner — a no-op for the global package, fail-closed if the allowlist grows).
   * Required NOT-NULL columns are the handler/contract's responsibility — a
   * missing one fails closed at the DB (NOT-NULL violation); the door invents no
   * defaults. Returns the single created row for the wire + audit.
   */
  async insertOne<T extends PgTable>(
    table: T,
    values: Partial<T["$inferInsert"]>,
  ): Promise<T["$inferSelect"]> {
    if (!INSERT_TABLES.has(table)) {
      throw new TenantScopeError(
        "PLATFORM_ADMIN_INSERT_DENIED: not a platform-admin-creatable table " +
          "(allowlist: package)",
      );
    }
    const {
      id: _serverPk,
      isPlatformAdmin: _ownerFlag,
      is_platform_admin: _ownerFlagRaw,
      companyId: _noTenant,
      company_id: _noTenantRaw,
      ...safe
    } = values as Record<string, unknown>;
    void _serverPk;
    void _ownerFlag;
    void _ownerFlagRaw;
    void _noTenant;
    void _noTenantRaw;
    const [created] = await this.#db
      .insert(table)
      .values(safe as T["$inferInsert"])
      .returning();
    return created as T["$inferSelect"];
  }
}

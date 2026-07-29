// Platform-owner cross-tenant WRITE door (Phase-6 W1a, B-193) — the sensitive
// counterpart to the PlatformDb read door, and the single most dangerous handle
// in the codebase (an owner mutating ANY tenant's row).
//
// Mirrors PlatformDb's containment exactly (private #db, allowlist-throw,
// constructed once in app.ts, injected ONLY into owner-gated WRITE handlers —
// never on `request`, never a read handler) and TenantDb.update()'s runtime
// field-strip. UPDATE-ONLY: no insert/delete, so a cross-tenant row can never be
// created or destroyed through it.
//
// FAIL-CLOSED BY CONSTRUCTION:
//   - ALLOWLIST: updateAllTenants() throws for any table not in WRITE_TABLES —
//     a DELIBERATELY NARROWER set than PlatformDb's read allowlist (only user +
//     company are writable; package/subscription/platform_invoice stay read-only).
//   - STRIP is_platform_admin: a user-write can NEVER set the owner flag — the
//     self-elevation defense (an owner-write must not be a mint-new-owners
//     primitive). Both the drizzle key (isPlatformAdmin) and the raw column
//     (is_platform_admin) are dropped.
//   - STRIP company_id: a write can never move a row to another tenant.
//   - STRIP id: the primary key is owned by the WHERE, never the SET.
//   - SINGLE ROW: every UPDATE is scoped by `id = <id>` — never a blanket
//     cross-tenant UPDATE (cross-tenant is the point, but exactly one target row).
//   - It carries NO owner check itself — the caller's ownerOnly() gate does that.
import type { SQL } from "drizzle-orm";
import { eq } from "drizzle-orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import { companies, users } from "@juneflow/db/schema";
import type { Db } from "@juneflow/db/client";
import { TenantScopeError } from "./tenant-db.js";

/**
 * The ONLY tables the platform owner may WRITE cross-tenant through this door —
 * the writable admin subset: user (block/unblock) and company (suspend/resume).
 * Deliberately narrower than PlatformDb's read allowlist. Extend ONLY for a
 * genuinely platform-admin-WRITABLE table alongside an owner-gated write handler.
 */
const WRITE_TABLES: ReadonlySet<PgTable> = new Set<PgTable>([users, companies]);

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
          "(allowlist: user, company)",
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
}

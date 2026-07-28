// Platform-owner cross-tenant READ door (Phase-6, B-177) — the ONE sanctioned
// escape from company_id tenant-scoping, and the most security-sensitive handle
// in the codebase.
//
// WHY A SEPARATE CLASS (not a method on TenantDb, not selectReference):
//   - TenantDb (db/tenant-db.ts) is handed to EVERY tenant handler via
//     request.db. Any cross-tenant method on it, or any extra table on the
//     selectReference() REFERENCE_TABLES allowlist, would hand every handler a
//     cross-tenant leak primitive one cast/typo away. Rejected.
//   - PlatformDb instead holds the un-scoped base Db PRIVATELY (#db, never
//     returned, never attached to `request`) and is constructed ONCE in app.ts,
//     injected ONLY into the owner-gated /admin/* route registrar. A tenant
//     handler can never reach it.
//
// FAIL-CLOSED BY CONSTRUCTION:
//   - READ-ONLY: exposes only selectAllTenants(); no insert/update/delete exists,
//     so a cross-tenant WRITE is impossible (out of scope for B-177 reads).
//   - ALLOWLIST: selectAllTenants() throws for any table not in ADMIN_TABLES, so
//     even the owner-gated handlers can only read the five platform-admin tables.
//   - It carries NO owner check itself — that is the caller's ownerOnly() gate
//     (routes/authz.ts). Every call site is a handler that has ALREADY denied a
//     non-owner with 403. Two independent layers must both hold to read tenant
//     data: the ownerOnly gate AND this allowlist.
import type { SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  companies,
  packages,
  platformInvoices,
  subscriptions,
  users,
} from "@juneflow/db/schema";
import type { Db } from "@juneflow/db/client";
import { TenantScopeError } from "./tenant-db.js";

/**
 * The ONLY tables the platform owner may read cross-tenant through this door:
 * the SaaS-platform administration surface (plans, tenant companies, their
 * subscriptions, platform billing, and the cross-tenant user list). Everything
 * else — the tenant ERP tables — must never be readable across tenants and is
 * rejected at runtime. Extend this list only for a genuinely platform-admin
 * table, and only alongside an owner-gated handler that reads it.
 */
const ADMIN_TABLES: ReadonlySet<PgTable> = new Set<PgTable>([
  packages,
  companies,
  subscriptions,
  platformInvoices,
  users,
]);

export class PlatformDb {
  /** The un-scoped base handle — PRIVATE. Never returned, never on `request`. */
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * SELECT * FROM <admin table> [WHERE extra] — spanning ALL tenants. Guarded by
   * the ADMIN_TABLES allowlist (throws TenantScopeError otherwise) so this door
   * can only ever read the five platform-admin tables, never a tenant ERP table.
   * The caller MUST be behind the ownerOnly() gate; this method assumes the owner
   * check already passed and does not repeat it.
   */
  selectAllTenants<T extends PgTable>(table: T, where?: SQL) {
    if (!ADMIN_TABLES.has(table)) {
      throw new TenantScopeError(
        "PLATFORM_ADMIN_TABLE_DENIED: not a platform-admin-readable table " +
          "(allowlist: package, company, subscription, platform_invoice, user)",
      );
    }
    const query = this.#db.select().from<T>(table as never); // 0.45 .from() guard — see tenant-db.ts select()
    return where ? query.where(where) : query;
  }
}

// Tenant profile data loaders shared by GET /me and POST /auth/login
// (P1-BE-01). Every tenant-owned read goes through TenantDb (company_id scope
// on every query); package/company are platform-global reference tables
// resolved ONLY via ids the tenant itself points at (TenantDb.selectReference).
//
// Wire shapes are snake_case per the contract convention (company_id,
// approval_limits, upgrade_url, file_id ...). The contract models Me/Entity as
// opaque objects — fields here are the REAL seed-backed columns, never invented
// values (PLAN.md §0 rule 3: data comes from the DB, not hardcode).
import { eq } from "drizzle-orm";
import {
  aiUsage,
  companies,
  packages,
  roles,
  subscriptions,
  users,
} from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";

type UserRow = typeof users.$inferSelect;
type RoleRow = typeof roles.$inferSelect;
type CompanyRow = typeof companies.$inferSelect;

/** Dictionary user row → wire user entity. */
export function serializeUser(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role_id: row.roleId,
    status: row.status,
  };
}

/** Role row → wire role entity (approval_limits is surfaced separately). */
export function serializeRole(row: RoleRow) {
  return { id: row.id, name: row.name, perms: row.perms };
}

/** Company row → wire company entity (master fields the shell renders). */
export function serializeCompany(row: CompanyRow) {
  return {
    id: row.id,
    name: row.name,
    short: row.short,
    color: row.color,
    doc_prefix: row.docPrefix,
    biz: row.biz,
    tax_id: row.taxId,
    status: row.status,
  };
}

/** Current month key for ai_usage, UTC (PLAN.md §4: time is stored UTC). */
function currentMonthUtc(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * The tenant's package + usage: Me.package per the contract description —
 * "package{menus,limits,ai_used}". Resolved from the tenant's own subscription
 * (tenant-scoped) → package reference row; ai_used sums this month's ai_usage
 * rows (tenant-scoped). Returns null when the tenant has no subscription.
 */
export async function loadPackageUsage(db: TenantDb) {
  const subs = await db.select(subscriptions);
  const sub =
    subs.find((s) => s.status === "active" || s.status === "trial") ?? subs[0];
  if (!sub) return null;

  const pkgRows = await db.selectReference(
    packages,
    eq(packages.id, sub.packageId),
  );
  const pkg = pkgRows[0];
  if (!pkg) return null;

  const usageRows = await db.select(
    aiUsage,
    eq(aiUsage.month, currentMonthUtc()),
  );
  const aiUsed = usageRows.reduce((sum, row) => sum + row.used, 0);

  return {
    id: pkg.id,
    size: pkg.size,
    name: pkg.name,
    menus: pkg.menus,
    limits: pkg.limits,
    sub_rules: pkg.subRules,
    ai_used: aiUsed,
  };
}

/** The tenant's dictionary user row for a session email (company-scoped). */
export async function loadUserByEmail(db: TenantDb, email: string) {
  const rows = await db.select(users, eq(users.email, email));
  return rows[0] ?? null;
}

/** The user's role row (company-scoped); null when the user has no role. */
export async function loadRole(db: TenantDb, roleId: string | null) {
  if (!roleId) return null;
  const rows = await db.select(roles, eq(roles.id, roleId));
  return rows[0] ?? null;
}

/** The tenant's own company reference row. */
export async function loadOwnCompany(db: TenantDb) {
  const rows = await db.selectReference(
    companies,
    eq(companies.id, db.companyId),
  );
  return rows[0] ?? null;
}

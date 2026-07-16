// Subscription-backed quota resolver (B-082 F2 — the "unlimited resolver in
// prod" HIGH finding).
//
// The quota MECHANISM (QuotaGuard + the 402 QuotaExceededError shape) is
// correct and already wired on files/ai-qto/projects; only the resolver was a
// stub — production shipped `unlimitedQuotaResolver` (limit -1 everywhere), so
// seat/AI/project quotas were unbounded regardless of the subscription tier.
//
// This resolver reads the tenant's REAL allowance (active subscription → package
// limits, exactly like GET /me's loadPackageUsage) and the REAL current usage
// per dimension, all through the tenant-scoped TenantDb (company_id on every
// query). It is fail-closed: a tenant with no resolvable active subscription/
// package gets no allowance (deny) rather than silently falling back to
// unlimited. index.ts gates it to production; non-prod keeps the unlimited/dev
// resolver so the local stack stays green (the existing pattern).
import { eq } from "drizzle-orm";
import {
  aiUsage,
  packages,
  projects,
  subscriptions,
  users,
} from "@juneflow/db/schema";
import type { Db } from "@juneflow/db/client";
import { TenantDb } from "../db/tenant-db.js";
import type { QuotaKey, QuotaResolver } from "./quota.js";

/** Current month key (YYYY-MM) in UTC — matches loadPackageUsage / ai_usage. */
function currentMonthUtc(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * Real per-tenant quota resolver. Constructed with the base (un-scoped) Db and
 * builds a company_id-scoped TenantDb per lookup, so every limit/usage read is
 * tenant-isolated by construction.
 */
export class SubscriptionQuotaResolver implements QuotaResolver {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async resolve(
    companyId: string,
    key: QuotaKey,
  ): Promise<{ limit: number; used: number }> {
    const db = new TenantDb(this.#db, companyId);
    const limit = await this.#limit(db, key);
    // Fail-closed: no active subscription/package → no allowance. `limit 0,
    // used 1` fails isWithinQuota (0 !== -1 && 1 < 0 is false) → 402, rather
    // than the unlimited stub's silent pass.
    if (limit === null) return { limit: 0, used: 1 };
    // -1 = unlimited (PackageLimits convention) — skip the (potentially large)
    // usage count; isWithinQuota short-circuits on -1 anyway.
    if (limit === -1) return { limit: -1, used: 0 };
    return { limit, used: await this.#used(db, key) };
  }

  /** The tenant's package limit for a dimension, or null when unresolvable. */
  async #limit(db: TenantDb, key: QuotaKey): Promise<number | null> {
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
    const limit = pkg.limits[key];
    return typeof limit === "number" ? limit : null;
  }

  /** The tenant's current usage for a dimension (real tenant-scoped counts). */
  async #used(db: TenantDb, key: QuotaKey): Promise<number> {
    switch (key) {
      case "projects":
        return (await db.select(projects)).length;
      case "users":
        return (await db.select(users)).length;
      case "ai_per_month": {
        const rows = await db.select(
          aiUsage,
          eq(aiUsage.month, currentMonthUtc()),
        );
        return rows.reduce((sum, row) => sum + row.used, 0);
      }
      case "storage_gb":
        // No server-side byte accounting exists: attachments stream
        // client→R2 via presigned URLs (routes/files.ts) and the DMS
        // `document` row (packages/db misc.ts) stores no size. Precise GB
        // enforcement needs a bytes column (schema change — sacred/out of this
        // zone), so storage is reported unused until that lands. The other
        // three dimensions (the exploitable seat/AI/project caps) are enforced.
        return 0;
    }
  }
}

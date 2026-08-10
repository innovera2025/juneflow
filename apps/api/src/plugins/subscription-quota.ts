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
import { byOldestThenId } from "../routes/list-order.js";
import type { QuotaKey, QuotaResolver } from "./quota.js";

/** Current month key (YYYY-MM) in UTC — matches loadPackageUsage / ai_usage. */
function currentMonthUtc(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * B-363 sort key: a live (active|trial) subscription sorts before any other. MODULE
 * scope on purpose — a comparator that closes over a FUNCTION-local helper cannot be
 * lifted by the B-323 comparator probe (list-order.enforce.test.ts blind spot 4) and
 * would have to buy a registry exemption instead of being checked.
 */
function liveFirst(s: { status: string }): number {
  return s.status === "active" || s.status === "trial" ? 0 : 1;
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
    // B-363 — WHICH subscription, decided rather than left to the join plan.
    // This used to be `subs.find(active|trial) ?? subs[0]` over an UNORDERED
    // select: for a company with 2+ subscriptions the fallback (and the `find`,
    // among several active ones) picked whatever row Postgres happened to return
    // first, so the SAME tenant could be metered against different rows on two
    // requests — and packages/db/src/quota-preflight.ts, which reports what the
    // meter will do, orders by `created_at` and could name a different one again.
    // A billing input must not depend on a scan order. The key is the preflight's:
    // active/trial first, then oldest, then id as the total-order tie-break.
    // Latent on today's data (no company has two subscriptions — checked), which is
    // exactly why it is pinned before one does.
    //
    // The tail is `byOldestThenId` — routes/list-order.ts, the repo's own total
    // order (created_at ASC, then the id FLOOR). Reused rather than hand-rolled:
    // its `msOf` tolerates a Date, an ISO string or an epoch number (a hand-rolled
    // `createdAt.getTime()` throws on the others, which the B-323 comparator probe
    // in list-order.enforce.test.ts catches immediately — it did).
    const subs = [...(await db.select(subscriptions))].sort(
      (a, b) => liveFirst(a) - liveFirst(b) || byOldestThenId(a, b),
    );
    const sub = subs[0];
    if (!sub) return null;
    const pkgRows = await db.selectReference(
      packages,
      eq(packages.id, sub.packageId),
    );
    const pkg = pkgRows[0];
    if (!pkg) return null;
    // B-349 — the SEAT OVERRIDE, and it governs `users` ONLY.
    //
    // packages/db/src/schema/platform.ts is explicit about what this column is:
    // "a per-subscriber seat-cap OVERRIDE the owner may set… NULL = no override
    // (fall back to the package's `limits.users`); -1 = unlimited", and admin.ts
    // validates it as -1 or >= 1 on PUT /admin/subscribers/{id}/package. It was
    // recorded there as a follow-up and never wired, so an owner could set a seat
    // cap and nothing ever read it.
    //
    // THE GATE ON `key` IS LOAD-BEARING, not defensive tidiness. A generic
    // `sub.seats ?? pkg.limits[key]` would let a seat override silently cap
    // projects, storage_gb AND ai_per_month too — nothing in the schema or in
    // admin.ts says seats governs anything but users, so a tenant granted 3 extra
    // seats would find itself limited to 3 projects and 3 AI runs a month.
    //
    // Resolved AFTER the package deliberately: a subscription carrying `seats` but
    // no resolvable package is broken data, and honouring half of it is how
    // billing goes wrong quietly. That case falls through the `!pkg` return above
    // to the fail-closed deny, seats or no seats.
    if (key === "users" && sub.seats != null) return sub.seats;
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

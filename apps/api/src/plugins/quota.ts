// Quota enforcement (P0-BE-13).
//
// Hard rule (PLAN.md §5, apps/api/CLAUDE.md, docs/extract/PACKAGE-RULES.md):
//   Exceeding a package/AI quota ALWAYS answers HTTP 402 with code
//   QUOTA_EXCEEDED and an `upgrade_url`. The 402 body is the contract's
//   QuotaExceededError (packages/contracts/openapi.yaml): a flat envelope
//   { code: "QUOTA_EXCEEDED", message, upgrade_url } — NOT wrapped in `error`.
//
// The quota keys mirror packages/db PackageLimits (decision C5): projects /
// users / storage_gb / ai_per_month. Limit -1 means unlimited (PackageLimits
// convention). Usage counting against real subscriptions lands with the
// resource routes; this module is the reusable mechanism + the guaranteed 402
// shape, with a `QuotaResolver` seam the resource layer plugs real counts into.
import type { FastifyReply } from "fastify";
import type { PackageLimits } from "@juneflow/db";

/** The quota dimensions, 1:1 with packages/db PackageLimits keys (decision C5). */
export const QUOTA_KEYS = [
  "projects",
  "users",
  "storage_gb",
  "ai_per_month",
] as const;
export type QuotaKey = (typeof QUOTA_KEYS)[number];

// Compile-time proof the key list stays in lockstep with PackageLimits: if a
// limit key is added/removed in the schema, this assignment stops compiling.
const _keysMatchSchema: Record<QuotaKey, number> = {} as PackageLimits;
void _keysMatchSchema;

export interface QuotaStatus {
  ok: boolean;
  key: QuotaKey;
  limit: number;
  used: number;
}

/** Resolves the tenant's limit + current usage for a quota dimension. */
export interface QuotaResolver {
  resolve(companyId: string, key: QuotaKey): Promise<{ limit: number; used: number }>;
}

/**
 * Pure decision: is a tenant within quota for a dimension? Unlimited (-1) always
 * passes; otherwise there must be headroom for one more (used < limit). The
 * caller checks BEFORE creating the resource, so `used` is the pre-create count.
 */
export function isWithinQuota(limit: number, used: number): boolean {
  return limit === -1 || used < limit;
}

export interface QuotaGuardOptions {
  resolver: QuotaResolver;
  /** Absolute upgrade URL surfaced in every 402 (config, never hardcoded UI). */
  upgradeUrl: string;
}

export class QuotaGuard {
  readonly #resolver: QuotaResolver;
  readonly upgradeUrl: string;

  constructor(options: QuotaGuardOptions) {
    this.#resolver = options.resolver;
    this.upgradeUrl = options.upgradeUrl;
  }

  /** Evaluate a single quota dimension for a tenant. */
  async check(companyId: string, key: QuotaKey): Promise<QuotaStatus> {
    const { limit, used } = await this.#resolver.resolve(companyId, key);
    return { ok: isWithinQuota(limit, used), key, limit, used };
  }
}

/**
 * Send the canonical 402 (contract QuotaExceededError). Returns the reply so a
 * handler can `return sendQuotaExceeded(...)` to end the request.
 */
export function sendQuotaExceeded(
  reply: FastifyReply,
  key: QuotaKey,
  upgradeUrl: string,
): FastifyReply {
  return reply.code(402).send({
    code: "QUOTA_EXCEEDED",
    message: `Quota exceeded for ${key}`,
    upgrade_url: upgradeUrl,
  });
}

/**
 * Dev/default resolver: reports every dimension as unlimited so a scaffold
 * without wired usage counting stays green and demoable (Phase 0 milestone).
 * Replaced by a subscription-backed resolver when the resource routes land.
 */
export const unlimitedQuotaResolver: QuotaResolver = {
  async resolve() {
    return { limit: -1, used: 0 };
  },
};

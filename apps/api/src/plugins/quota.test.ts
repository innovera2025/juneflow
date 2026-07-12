// G3 unit tests (PLAN.md §9) — quota: exceeding a package/AI limit ALWAYS
// answers 402 QUOTA_EXCEEDED + upgrade_url (PLAN.md §5, apps/api/CLAUDE.md).
import { afterEach, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import {
  QuotaGuard,
  QUOTA_KEYS,
  isWithinQuota,
  sendQuotaExceeded,
  unlimitedQuotaResolver,
  type QuotaResolver,
} from "./quota.js";

const UPGRADE = "https://app.juneflow.local/settings/subscription";

describe("isWithinQuota decision", () => {
  it("treats -1 as unlimited", () => {
    expect(isWithinQuota(-1, 999999)).toBe(true);
  });
  it("passes when there is headroom for one more", () => {
    expect(isWithinQuota(3, 2)).toBe(true);
  });
  it("blocks at the limit (used == limit)", () => {
    expect(isWithinQuota(3, 3)).toBe(false);
  });
  it("blocks over the limit", () => {
    expect(isWithinQuota(3, 5)).toBe(false);
  });
});

describe("quota keys stay 1:1 with PackageLimits (decision C5)", () => {
  it("exposes exactly projects/users/storage_gb/ai_per_month", () => {
    expect([...QUOTA_KEYS]).toEqual([
      "projects",
      "users",
      "storage_gb",
      "ai_per_month",
    ]);
  });
});

describe("QuotaGuard.check", () => {
  const guardWith = (limit: number, used: number): QuotaGuard => {
    const resolver: QuotaResolver = { async resolve() { return { limit, used }; } };
    return new QuotaGuard({ resolver, upgradeUrl: UPGRADE });
  };

  it("reports ok with limit/used echoed back", async () => {
    const status = await guardWith(5, 2).check("c1", "projects");
    expect(status).toEqual({ ok: true, key: "projects", limit: 5, used: 2 });
  });

  it("reports not-ok when over the limit", async () => {
    const status = await guardWith(5, 5).check("c1", "storage_gb");
    expect(status.ok).toBe(false);
  });

  it("unlimited resolver always passes", async () => {
    const guard = new QuotaGuard({ resolver: unlimitedQuotaResolver, upgradeUrl: UPGRADE });
    const status = await guard.check("c1", "ai_per_month");
    expect(status.ok).toBe(true);
  });
});

describe("sendQuotaExceeded emits the contract QuotaExceededError", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });

  it("responds 402 with flat {code, message, upgrade_url}", async () => {
    app = Fastify();
    app.post("/projects", async (_req, reply) =>
      sendQuotaExceeded(reply, "projects", UPGRADE),
    );
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/projects" });
    expect(res.statusCode).toBe(402);
    expect(res.json()).toEqual({
      code: "QUOTA_EXCEEDED",
      message: "Quota exceeded for projects",
      upgrade_url: UPGRADE,
    });
  });
});

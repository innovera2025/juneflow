// G3 unit tests (PLAN.md §9) — B-082 F2: the production quota resolver enforces
// the tenant's real subscription-backed limits + real usage per dimension, and
// fails closed when no active subscription/package resolves (replacing the
// unlimited stub that let seat/AI/project quotas run unbounded in prod).
import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { aiUsage, packages, projects, subscriptions, users } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { isWithinQuota } from "./quota.js";
import { SubscriptionQuotaResolver } from "./subscription-quota.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";

/** Table-keyed stub: every select().from(table).where(...) answers its rows. */
function stubDb(rows: Array<[unknown, unknown[]]>): Db {
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  return {
    select: () => ({
      from: (table: unknown) => {
        const builder = {
          where: (_where: SQL) => Promise.resolve(rowsFor(table)),
          then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) =>
            Promise.resolve(rowsFor(table)).then(onOk, onErr),
        };
        return builder;
      },
    }),
  } as unknown as Db;
}

const subRow = { id: "s-0", companyId: COMPANY, packageId: "pkg-m", cycle: "yearly", status: "active" };
const month = new Date().toISOString().slice(0, 7);
const dbWith = (limits: Record<string, number>) =>
  stubDb([
    [subscriptions, [subRow]],
    [packages, [{ id: "pkg-m", size: "M", name: "Professional", limits, menus: [], subRules: {} }]],
    [projects, [{ id: "p1" }, { id: "p2" }, { id: "p3" }]],
    [users, [{ id: "u1" }, { id: "u2" }]],
    [aiUsage, [{ month, used: 3 }, { month, used: 4 }]],
  ]);

const LIMITS = { projects: 10, users: 25, storage_gb: 100, ai_per_month: 50 };

describe("SubscriptionQuotaResolver — real limit + real usage", () => {
  it("counts projects against the package limit", async () => {
    const r = new SubscriptionQuotaResolver(dbWith(LIMITS));
    expect(await r.resolve(COMPANY, "projects")).toEqual({ limit: 10, used: 3 });
  });

  it("counts seats (users) against the package limit", async () => {
    const r = new SubscriptionQuotaResolver(dbWith(LIMITS));
    expect(await r.resolve(COMPANY, "users")).toEqual({ limit: 25, used: 2 });
  });

  it("sums this month's AI usage against ai_per_month", async () => {
    const r = new SubscriptionQuotaResolver(dbWith(LIMITS));
    expect(await r.resolve(COMPANY, "ai_per_month")).toEqual({ limit: 50, used: 7 });
  });

  it("reports storage as unused (no server-side byte accounting yet)", async () => {
    const r = new SubscriptionQuotaResolver(dbWith(LIMITS));
    expect(await r.resolve(COMPANY, "storage_gb")).toEqual({ limit: 100, used: 0 });
  });

  it("short-circuits an unlimited (-1) dimension without counting", async () => {
    const r = new SubscriptionQuotaResolver(dbWith({ ...LIMITS, projects: -1 }));
    expect(await r.resolve(COMPANY, "projects")).toEqual({ limit: -1, used: 0 });
  });
});

// ---------------------------------------------------------------------------
// B-369 — the seat OVERRIDE (subscription.seats), and its blast radius
// ---------------------------------------------------------------------------
const dbWithSeats = (limits: Record<string, number>, seats: number | null) =>
  stubDb([
    [subscriptions, [{ ...subRow, seats }]],
    [packages, [{ id: "pkg-m", size: "M", name: "Professional", limits, menus: [], subRules: {} }]],
    [projects, [{ id: "p1" }, { id: "p2" }, { id: "p3" }]],
    [users, [{ id: "u1" }, { id: "u2" }]],
    [aiUsage, [{ month, used: 3 }, { month, used: 4 }]],
  ]);

describe("SubscriptionQuotaResolver — the seat override (B-369)", () => {
  it("subscription.seats OVERRIDES the package's users limit", async () => {
    const r = new SubscriptionQuotaResolver(dbWithSeats(LIMITS, 3));
    expect(await r.resolve(COMPANY, "users")).toEqual({ limit: 3, used: 2 });
  });

  it("seats = -1 means unlimited seats (and skips the count)", async () => {
    const r = new SubscriptionQuotaResolver(dbWithSeats(LIMITS, -1));
    expect(await r.resolve(COMPANY, "users")).toEqual({ limit: -1, used: 0 });
  });

  it("NULL seats falls back to the package limit (no override)", async () => {
    const r = new SubscriptionQuotaResolver(dbWithSeats(LIMITS, null));
    expect(await r.resolve(COMPANY, "users")).toEqual({ limit: 25, used: 2 });
  });

  // The whole reason the override is gated on `key === "users"`: a generic
  // `sub.seats ?? pkg.limits[key]` would cap every other dimension at the seat
  // count, so a tenant granted 3 seats would also get 3 projects and 3 AI runs.
  it("does NOT touch projects / ai_per_month / storage_gb", async () => {
    const r = new SubscriptionQuotaResolver(dbWithSeats(LIMITS, 3));
    expect(await r.resolve(COMPANY, "projects")).toEqual({ limit: 10, used: 3 });
    expect(await r.resolve(COMPANY, "ai_per_month")).toEqual({ limit: 50, used: 7 });
    expect(await r.resolve(COMPANY, "storage_gb")).toEqual({ limit: 100, used: 0 });
  });

  it("seats WITHOUT a resolvable package still fails closed (broken data is denied)", async () => {
    const r = new SubscriptionQuotaResolver(
      stubDb([
        [subscriptions, [{ ...subRow, seats: 50 }]],
        [packages, []], // the package the subscription points at is gone
        [users, [{ id: "u1" }]],
      ]),
    );
    const status = await r.resolve(COMPANY, "users");
    expect(status).toEqual({ limit: 0, used: 1 });
    expect(isWithinQuota(status.limit, status.used)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B-363 — WHICH subscription, when a company has more than one
// ---------------------------------------------------------------------------
// `subs.find(active|trial) ?? subs[0]` over an UNORDERED select left the choice to
// the scan order, so the same tenant could be metered against a different row on
// two requests — and packages/db/src/quota-preflight.ts, which reports what the
// meter will do, ordered by created_at and could name a third answer. A billing
// input must not depend on a join plan. The key is the preflight's: active/trial
// first, then oldest, then id.
describe("SubscriptionQuotaResolver — the subscription pick is deterministic (B-363)", () => {
  const at = (iso: string) => new Date(iso);
  const sub = (id: string, status: string, created: string, seats: number) => ({
    ...subRow,
    id,
    status,
    seats,
    createdAt: at(created),
  });
  const withSubs = (subs: unknown[]) =>
    stubDb([
      [subscriptions, subs],
      [packages, [{ id: "pkg-m", size: "M", name: "Professional", limits: LIMITS, menus: [], subRules: {} }]],
      [users, [{ id: "u1" }, { id: "u2" }]],
    ]);

  const cancelled = sub("s-cancelled", "cancelled", "2020-01-01T00:00:00Z", 99);
  const oldActive = sub("s-old", "active", "2024-01-01T00:00:00Z", 7);
  const newActive = sub("s-new", "active", "2026-01-01T00:00:00Z", 8);

  it("prefers an active/trial subscription over any other, whatever order the rows arrive in", async () => {
    for (const order of [[cancelled, oldActive], [oldActive, cancelled]]) {
      const r = new SubscriptionQuotaResolver(withSubs(order));
      expect((await r.resolve(COMPANY, "users")).limit).toBe(7); // never the 99
    }
  });

  it("breaks a tie between two ACTIVE subscriptions on created_at — same answer either way round", async () => {
    for (const order of [[newActive, oldActive], [oldActive, newActive]]) {
      const r = new SubscriptionQuotaResolver(withSubs(order));
      expect((await r.resolve(COMPANY, "users")).limit).toBe(7); // the older one
    }
  });

  it("falls back to `id` when status AND created_at tie — a total order, never a scan order", async () => {
    const a = sub("s-aaa", "active", "2025-06-01T00:00:00Z", 4);
    const b = sub("s-bbb", "active", "2025-06-01T00:00:00Z", 5);
    for (const order of [[b, a], [a, b]]) {
      const r = new SubscriptionQuotaResolver(withSubs(order));
      expect((await r.resolve(COMPANY, "users")).limit).toBe(4); // s-aaa
    }
  });
});

describe("SubscriptionQuotaResolver — enforcement + fail-closed", () => {
  it("blocks once usage reaches the limit (real 402 path)", async () => {
    const r = new SubscriptionQuotaResolver(dbWith({ ...LIMITS, projects: 3 }));
    const status = await r.resolve(COMPANY, "projects");
    expect(status).toEqual({ limit: 3, used: 3 });
    expect(isWithinQuota(status.limit, status.used)).toBe(false);
  });

  it("fails closed (deny) when the tenant has no active subscription", async () => {
    const r = new SubscriptionQuotaResolver(stubDb([[subscriptions, []]]));
    const status = await r.resolve(COMPANY, "users");
    expect(isWithinQuota(status.limit, status.used)).toBe(false);
  });

  it("fails closed (deny) when the subscription's package is missing", async () => {
    const r = new SubscriptionQuotaResolver(
      stubDb([[subscriptions, [subRow]], [packages, []]]),
    );
    const status = await r.resolve(COMPANY, "projects");
    expect(isWithinQuota(status.limit, status.used)).toBe(false);
  });
});

// G3 unit tests (PLAN.md §9) — AI-QTO stub handlers (P2-BE-03, B-070 / §12;
// ai-qto.jsx 4-step wizard). AI-QTO is a FAKE STUB (no real IFC/CAD parse): the
// upload mints a "done" job handle + deducts an AI credit (ai_per_month quota →
// 402), the job GET returns the canned take-off, and create-BOQ turns the
// mappings (or, absent them, the canned take-off) into a REAL draft BOQ doc +
// groups + items. All money/counts come from the stubbed rows / mapping payload
// — never a value hand-computed against the impl.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { aiUsage, boqDocs, boqGroups, boqItems, projects } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import {
  QuotaGuard,
  unlimitedQuotaResolver,
  type QuotaResolver,
} from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const OTHER_COMPANY = "33333333-3333-3333-3333-333333333333";
const PROJECT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UPGRADE = "https://upgrade.test";

const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "wipha@rungrueang.co.th", name: "วิภา" },
};

interface Captured {
  table: unknown;
  where: SQL | undefined;
}
interface Inserted {
  table: unknown;
  rows: unknown[];
}

interface Updated {
  table: unknown;
  set: Record<string, unknown>;
  where: SQL | undefined;
}
/** Rows a table answers with — a function when the answer must change per call. */
type RowSource = unknown[] | (() => unknown[]);

interface StubOpts {
  rows: Array<[unknown, RowSource]>;
  captured?: Captured[];
  inserted?: Inserted[];
  updated?: Updated[];
  /** B-369: make the nth insert into a table throw (models a 23505 on a unique index). */
  insertThrows?: (table: unknown, nth: number) => unknown;
  /** Records every table a FOR UPDATE row lock was taken on. */
  locked?: unknown[];
}

/** Base Db stub: canned rows per table for reads; capture of write ops. */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [], updated = [], insertThrows, locked = [] } = opts;
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return typeof r === "function" ? r() : r;
    return [];
  };
  // A CHAINABLE thenable: drizzle's selectForUpdate door is
  // `.where(...).orderBy(...).for("update")`, so `where` must return the builder
  // rather than a promise, and the builder itself resolves when awaited.
  const builderFor = (table: unknown) => {
    let seen: SQL | undefined;
    const builder = {
      $dynamic: () => builder,
      innerJoin: () => builder,
      orderBy: () => builder,
      for: (_mode: string) => {
        locked.push(table);
        return builder;
      },
      where: (where: SQL) => {
        seen = where;
        return builder;
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) => {
        captured.push({ table, where: seen });
        return Promise.resolve(rowsFor(table)).then(onOk, onErr);
      },
    };
    return builder;
  };
  let seq = 0;
  const insertCalls = new Map<unknown, number>();
  const handle: Record<string, unknown> = {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        returning: () => {
          const nth = insertCalls.get(table) ?? 0;
          insertCalls.set(table, nth + 1);
          const thrown = insertThrows?.(table, nth);
          if (thrown) return Promise.reject(thrown);
          const list = Array.isArray(values) ? values : [values];
          inserted.push({ table, rows: list });
          return Promise.resolve(
            list.map((r) => ({ id: `new-${seq++}`, ...(r as object) })),
          );
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: () => {
            updated.push({ table, set, where });
            return Promise.resolve([set]);
          },
        }),
      }),
    }),
  };
  // The transaction door runs its callback against this SAME stub (the
  // inventory.test.ts / gr.test.ts precedent). It gives the handler a transaction
  // SHAPE and nothing more: there is no real BEGIN/COMMIT, so no test here can
  // prove the rollback — only that the writes go through the scoped doors in the
  // right order. The lock's actual behaviour under concurrency is a live claim.
  handle.transaction = (cb: (tx: unknown) => unknown) => cb(handle);
  return handle as unknown as Db;
}

function paramsOf(where: SQL | undefined): unknown[] {
  if (!where) return [];
  return new PgDialect().sqlToQuery(where).params;
}

/** A QuotaGuard whose resolver reports the given ai_per_month limit/used. */
function quotaGuard(limit: number, used: number): QuotaGuard {
  const resolver: QuotaResolver = { async resolve() { return { limit, used }; } };
  return new QuotaGuard({ resolver, upgradeUrl: UPGRADE });
}

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<FastifyInstance> {
  app = await buildApp({
    db: overrides.db ?? stubDb({ rows: [] }),
    resolveTenant: overrides.resolveTenant ?? (async () => null),
    signIn: overrides.signIn ?? (async () => null),
    storage: overrides.storage ?? createFakeR2Storage("https://r2.test"),
    quota:
      overrides.quota ??
      new QuotaGuard({ resolver: unlimitedQuotaResolver, upgradeUrl: UPGRADE }),
    auditSink: overrides.auditSink ?? (async () => {}),
    logger: false,
  });
  return app;
}

const project = { id: PROJECT, companyId: COMPANY, name: "juneflow ราชพฤกษ์" };

// ---------------------------------------------------------------------------
// POST /ai-qto/upload — stub job handle + AI-credit (ai_per_month) quota
// ---------------------------------------------------------------------------

describe("POST /api/v1/ai-qto/upload — stub job + AI credit", () => {
  it("202s a 'done' stub job handle when within AI quota", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, quota: quotaGuard(-1, 0) })
    ).inject({ method: "POST", url: "/api/v1/ai-qto/upload" });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe("done");
    expect(body.stub).toBe(true);
    expect(String(body.job_id)).toMatch(/^aiqto-stub-/);
    expect(body.id).toBe(body.job_id);
  });

  it("402 QUOTA_EXCEEDED (ai_per_month) + upgrade_url when the AI credit is spent", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, quota: quotaGuard(5, 5) })
    ).inject({ method: "POST", url: "/api/v1/ai-qto/upload" });
    expect(res.statusCode).toBe(402);
    expect(res.json()).toEqual({
      code: "QUOTA_EXCEEDED",
      message: "Quota exceeded for ai_per_month",
      upgrade_url: UPGRADE,
    });
  });

  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/ai-qto/upload",
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// B-369 — the meter TURNS. Before this, `aiUsage` had three readers and zero
// writers anywhere in apps/api, so `used` never moved and the 402 above could
// never fire on a real tenant: a "deducted AI credit" that no statement deducts.
// ---------------------------------------------------------------------------

const usageRow = (used: number) => ({
  id: "aiu-0",
  companyId: COMPANY,
  month: new Date().toISOString().slice(0, 7),
  used,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("POST /api/v1/ai-qto/upload — B-369 ai_usage is written", () => {
  it("INSERTS the month's meter row at 1 when none exists yet", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        quota: quotaGuard(50, 0),
        db: stubDb({ rows: [[aiUsage, []]], inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/ai-qto/upload" });

    expect(res.statusCode).toBe(202);
    const write = inserted.find((i) => i.table === aiUsage);
    expect(write).toBeTruthy();
    expect(write!.rows[0]).toMatchObject({
      used: 1,
      month: new Date().toISOString().slice(0, 7),
      // the scoped insert door force-sets the tenant
      companyId: COMPANY,
    });
  });

  it("INCREMENTS an existing month row by exactly one", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        quota: quotaGuard(50, 7),
        db: stubDb({ rows: [[aiUsage, [usageRow(7)]]], updated }),
      })
    ).inject({ method: "POST", url: "/api/v1/ai-qto/upload" });

    expect(res.statusCode).toBe(202);
    const write = updated.find((u) => u.table === aiUsage);
    expect(write).toBeTruthy();
    expect(write!.set).toEqual({ used: 8 });
  });

  it("takes the meter row's ROW LOCK before deciding — the check above is a TOCTOU", async () => {
    // quota.check READS the meter and this WRITES it. Two uploads at limit-1 both
    // read limit-1 and both pass, so the decision has to be retaken on a locked
    // row or the tenant gets one free run per unit of concurrency, on a PRICED
    // dimension. An upsert would make the write atomic and leave the hole open.
    const locked: unknown[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        quota: quotaGuard(50, 7),
        db: stubDb({ rows: [[aiUsage, [usageRow(7)]]], locked }),
      })
    ).inject({ method: "POST", url: "/api/v1/ai-qto/upload" });
    expect(locked).toContain(aiUsage);
  });

  it("402s WITHOUT incrementing when the locked row is already at the cap", async () => {
    // The loser of a race: it passed the pre-check at limit-1, then waited on the
    // lock and re-read the winner's committed value.
    const updated: Updated[] = [];
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        quota: quotaGuard(10, 9), // the stale pre-check: one credit left
        db: stubDb({ rows: [[aiUsage, [usageRow(10)]]], updated, inserted }), // …but not any more
      })
    ).inject({ method: "POST", url: "/api/v1/ai-qto/upload" });

    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("QUOTA_EXCEEDED");
    expect(updated.find((u) => u.table === aiUsage)).toBeUndefined();
    expect(inserted.find((i) => i.table === aiUsage)).toBeUndefined();
  });

  it("an UNLIMITED (-1) allowance still meters, and never refuses", async () => {
    const updated: Updated[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        quota: quotaGuard(-1, 0),
        db: stubDb({ rows: [[aiUsage, [usageRow(9999)]]], updated }),
      })
    ).inject({ method: "POST", url: "/api/v1/ai-qto/upload" });
    expect(res.statusCode).toBe(202);
    expect(updated.find((u) => u.table === aiUsage)!.set).toEqual({ used: 10000 });
  });

  it("retries once through the LOCK path when a concurrent first insert wins (23505)", async () => {
    // No row exists, so there is nothing to lock and the unique index
    // (ai_usage_company_month_uq) is the serialiser. The loser's INSERT trips it;
    // by the retry a row exists, so the retry increments instead of inserting.
    const updated: Updated[] = [];
    const inserted: Inserted[] = [];
    let attempts = 0;
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        quota: quotaGuard(50, 0),
        db: stubDb({
          // First read: empty (no row). After the failed insert: the winner's row.
          rows: [[aiUsage, () => (attempts++ === 0 ? [] : [usageRow(1)])]],
          inserted,
          updated,
          insertThrows: (table, nth) =>
            table === aiUsage && nth === 0
              ? Object.assign(new Error("duplicate key"), {
                  code: "23505",
                  constraint: "ai_usage_company_month_uq",
                })
              : null,
        }),
      })
    ).inject({ method: "POST", url: "/api/v1/ai-qto/upload" });

    expect(res.statusCode).toBe(202);
    // The insert was attempted and rejected; the retry took the increment path.
    expect(inserted.find((i) => i.table === aiUsage)).toBeUndefined();
    expect(updated.find((u) => u.table === aiUsage)!.set).toEqual({ used: 2 });
  });

  it("does NOT meter a request the quota pre-check already refused", async () => {
    const updated: Updated[] = [];
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        quota: quotaGuard(5, 5),
        db: stubDb({ rows: [[aiUsage, [usageRow(5)]]], updated, inserted }),
      })
    ).inject({ method: "POST", url: "/api/v1/ai-qto/upload" });
    expect(res.statusCode).toBe(402);
    expect(updated).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /ai-qto/:job — canned take-off result
// ---------------------------------------------------------------------------

describe("GET /api/v1/ai-qto/:job — stub job status", () => {
  it("returns the canned, done take-off (clearly marked stub) for a known handle", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION })
    ).inject({ url: "/api/v1/ai-qto/aiqto-stub-11111111-1111-1111-1111-111111111111" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("done");
    expect(body.stub).toBe(true);
    expect(body.note).toMatch(/STUB/);
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    expect(Array.isArray(body.elements)).toBe(true);
  });

  it("404s for an unrecognized (non-stub) job handle", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION })
    ).inject({ url: "/api/v1/ai-qto/not-a-real-job" });
    expect(res.statusCode).toBe(404);
  });

  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      url: "/api/v1/ai-qto/aiqto-stub-abc",
    });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /ai-qto/:job/create-boq — build a real draft BOQ from the mappings
// ---------------------------------------------------------------------------

describe("POST /api/v1/ai-qto/:job/create-boq — real BOQ from stub result", () => {
  it("creates a draft doc + one group per distinct mapping group + items, total derived (C10)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [project]], [boqDocs, []]], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ai-qto/aiqto-stub-x/create-boq",
      payload: {
        project_id: PROJECT,
        mappings: [
          { group: "02 โครงสร้าง", code: "C1", name: "Concrete", unit: "m3", qty: 10, price: 100, cat: "M" },
          { group: "02 โครงสร้าง", code: "R1", name: "Rebar", unit: "ton", qty: 2, price: 500, cat: "วัสดุ" },
          { group: "03 สถาปัตย์", code: "W1", name: "Wall", unit: "m2", qty: 5, price: 50, cat: "เหมา" },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("draft");
    expect(body.version).toBe(1);
    expect(body.no).toMatch(/^BOQ-\d{4}-AI-0001$/);
    expect(body.groups).toBe(2); // 2 distinct group labels
    expect(body.items).toBe(3);
    expect(body.total).toBe(10 * 100 + 2 * 500 + 5 * 50); // 2250
    expect(body.stub).toBe(true);

    // the doc, its groups, and its items were all inserted.
    expect(inserted.find((w) => w.table === boqDocs)).toBeTruthy();
    expect(inserted.find((w) => w.table === boqGroups)).toBeTruthy();
    const itemWrite = inserted.find((w) => w.table === boqItems);
    expect(itemWrite!.rows).toHaveLength(3);
    // cat labels map to the enum (วัสดุ→M, เหมา→S); fresh line → remain = qty.
    expect((itemWrite!.rows[1] as { cat: string }).cat).toBe("M");
    expect((itemWrite!.rows[2] as { cat: string }).cat).toBe("S");
    expect((itemWrite!.rows[0] as { remainQty: string }).remainQty).toBe("10");

    // B-323: this is the SECOND writer of boq_item, and GET /boq/:id/items reads that
    // table with entryOrder (created_at ASC). boq_item has no `seq`, and one
    // insertThrough is one statement / one now() — so without the stamp all three
    // take-off lines tie and the AI's mapping order is replaced by uuid order.
    const times = (itemWrite!.rows as { createdAt?: Date }[]).map((r) =>
      r.createdAt?.getTime(),
    );
    expect(times.every((t) => typeof t === "number")).toBe(true);
    expect(new Set(times).size).toBe(3);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
  });

  it("falls back to the canned take-off when no mappings are provided", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [project]], [boqDocs, []]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ai-qto/aiqto-stub-x/create-boq",
      payload: { project_id: PROJECT },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    // canned take-off = 5 items across 3 distinct groups.
    expect(body.items).toBe(5);
    expect(body.groups).toBe(3);
  });

  it("400s when project_id is missing or not the tenant's", async () => {
    const missing = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [] }) })
    ).inject({ method: "POST", url: "/api/v1/ai-qto/aiqto-stub-x/create-boq", payload: {} });
    expect(missing.statusCode).toBe(400);

    const foreign = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, []]] }), // project not visible to this tenant
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ai-qto/aiqto-stub-x/create-boq",
      payload: { project_id: PROJECT, mappings: [{ code: "C", name: "C", qty: 1, price: 1, cat: "M" }] },
    });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().message).toBe("project not found");
  });

  it("binds company_id on the tenant-scoped project lookup (no cross-tenant leak)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [project]], [boqDocs, []]], captured }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/ai-qto/aiqto-stub-x/create-boq",
      payload: { project_id: PROJECT, mappings: [{ code: "C", name: "C", qty: 1, price: 1, cat: "M" }] },
    });
    const projRead = captured.find((c) => c.table === projects);
    expect(projRead).toBeTruthy();
    expect(paramsOf(projRead!.where)).toContain(COMPANY);
    expect(paramsOf(projRead!.where)).not.toContain(OTHER_COMPANY);
  });

  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/ai-qto/aiqto-stub-x/create-boq",
      payload: { project_id: PROJECT },
    });
    expect(res.statusCode).toBe(401);
  });
});

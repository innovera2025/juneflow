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
import { boqDocs, boqGroups, boqItems, projects } from "@juneflow/db";
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

interface StubOpts {
  rows: Array<[unknown, unknown[]]>;
  captured?: Captured[];
  inserted?: Inserted[];
}

/** Base Db stub: canned rows per table for reads; capture of insert ops. */
function stubDb(opts: StubOpts): Db {
  const { rows, captured = [], inserted = [] } = opts;
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  const builderFor = (table: unknown) => {
    const builder = {
      $dynamic: () => builder,
      innerJoin: () => builder,
      where: (where: SQL) => {
        captured.push({ table, where });
        return Promise.resolve(rowsFor(table));
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) => {
        captured.push({ table, where: undefined });
        return Promise.resolve(rowsFor(table)).then(onOk, onErr);
      },
    };
    return builder;
  };
  let seq = 0;
  return {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        returning: () => {
          const list = Array.isArray(values) ? values : [values];
          inserted.push({ table, rows: list });
          return Promise.resolve(
            list.map((r) => ({ id: `new-${seq++}`, ...(r as object) })),
          );
        },
      }),
    }),
  } as unknown as Db;
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

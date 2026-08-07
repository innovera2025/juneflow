// G3 unit tests (PLAN.md §9) — POST /projects/:id/nodes + GET
// /projects/:id/hierarchy (P1-BE-10, B-053; master.jsx MasterProject/BlockAddForm).
// Covers the real pre-order hierarchy tree with DERIVED sold/built counts (C10),
// tenant scope (project verify + selectThrough both bind company_id, 404 outside
// tenant), and the create rules: auto-generate N empty unit nodes, unit code
// "{blockCode}-{NN}", cap 200/block, block-code uniqueness (409).
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { models, projectNodes, projects } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย" },
};

interface Captured {
  table: unknown;
  where: SQL | undefined;
}
interface Inserted {
  table: unknown;
  values: Record<string, unknown>[];
}

interface StubOpts {
  rows: Array<[unknown, unknown[]]>;
  captured?: Captured[];
  inserted?: Inserted[];
}

/** Base Db stub: canned rows per table for reads; capture of inserted rows. */
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
      values: (values: Record<string, unknown>[]) => ({
        returning: () => {
          inserted.push({ table, values });
          return Promise.resolve(values.map((v, i) => ({ id: v.id ?? `new-${seq++}-${i}`, ...v })));
        },
      }),
    }),
  } as unknown as Db;
}

function paramsOf(where: SQL | undefined): unknown[] {
  if (!where) return [];
  return new PgDialect().sqlToQuery(where).params;
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
      new QuotaGuard({ resolver: unlimitedQuotaResolver, upgradeUrl: "https://upgrade.test" }),
    auditSink: overrides.auditSink ?? (async () => {}),
    logger: false,
  });
  return app;
}

const PROJECT = { id: "p1", companyId: COMPANY, name: "ราชพฤกษ์" };

const pn = (
  id: string,
  parentId: string | null,
  kind: string,
  name: string,
  code: string | null,
  modelId: string | null,
  saleStatus: string | null,
  t: number,
) => ({
  id,
  projectId: "p1",
  parentId,
  modelId,
  kind,
  name,
  code,
  saleStatus,
  createdAt: new Date(1_700_000_000_000 + t * 1000),
  updatedAt: new Date(1_700_000_000_000 + t * 1000),
});

// phase → block(B) → 4 units: 1 soldBuilt, 1 sold, 1 built, 1 empty.
const PH1 = pn("n-ph1", null, "phase", "เฟส 1", null, null, null, 1);
const BLK = pn("n-blk", "n-ph1", "block", "Block B", "B", "m-b1", null, 2);
const U1 = pn("n-u1", "n-blk", "unit", "B-01", "B-01", "m-b1", "soldBuilt", 3);
const U2 = pn("n-u2", "n-blk", "unit", "B-02", "B-02", "m-b1", "sold", 4);
const U3 = pn("n-u3", "n-blk", "unit", "B-03", "B-03", "m-b1", "built", 5);
const U4 = pn("n-u4", "n-blk", "unit", "B-04", "B-04", "m-b1", "empty", 6);
const NODES = [U4, BLK, U1, PH1, U3, U2]; // shuffled → GET must re-order

describe("GET /api/v1/projects/:id/hierarchy — auth + 404", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/projects/p1/hierarchy" });
    expect(res.statusCode).toBe(401);
  });

  it("404s a project outside the tenant (scoped project select finds nothing)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[projects, []]] }) })
    ).inject({ url: "/api/v1/projects/p1/hierarchy" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/v1/projects/:id/hierarchy — real pre-order tree + C10 counts", () => {
  it("returns phase→block→unit in order with derived sold/built", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [PROJECT]], [projectNodes, NODES]] }),
      })
    ).inject({ url: "/api/v1/projects/p1/hierarchy" });

    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<Record<string, unknown>>;
    expect(data.map((n) => n.id)).toEqual(["n-ph1", "n-blk", "n-u1", "n-u2", "n-u3", "n-u4"]);

    const phase = data[0]!;
    expect(phase).toMatchObject({ kind: "phase", units: 4, sold: 2, built: 2 });

    const block = data[1]!;
    // sold = {sold, soldBuilt} = 2 ; built = {built, soldBuilt} = 2 (C10 from rows).
    expect(block).toMatchObject({
      kind: "block", code: "B", model_id: "m-b1", units: 4, sold: 2, built: 2,
    });

    const unit = data[2]!;
    expect(unit).toMatchObject({ kind: "unit", code: "B-01", status: "soldBuilt" });
  });

  it("binds company_id on BOTH the project verify and the node read (no leak)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [PROJECT]], [projectNodes, NODES]], captured }),
      })
    ).inject({ url: "/api/v1/projects/p1/hierarchy" });

    for (const t of [projects, projectNodes]) {
      const call = captured.find((c) => c.table === t);
      expect(call, `read for ${String(t)}`).toBeTruthy();
      expect(paramsOf(call!.where)).toContain(COMPANY);
    }
  });
});

describe("POST /api/v1/projects/:id/nodes — create block + auto-generate units", () => {
  it("404s a project outside the tenant", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb({ rows: [[projects, []]] }) })
    ).inject({ method: "POST", url: "/api/v1/projects/p1/nodes", payload: { name: "E", code: "E", units: 2 } });
    expect(res.statusCode).toBe(404);
  });

  it("auto-generates N empty unit nodes with code {blockCode}-{NN} under the first phase", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [PROJECT]], [projectNodes, [PH1]]], inserted }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/projects/p1/nodes",
      payload: { name: "Block E", code: "e", units: 3 },
    });

    expect(res.statusCode).toBe(201);
    // one insertThrough call with [block, unit, unit, unit].
    const written = inserted.find((i) => i.table === projectNodes)!.values;
    expect(written).toHaveLength(4);
    const [block, ...units] = written;
    expect(block).toMatchObject({ kind: "block", code: "E", name: "Block E", parentId: "n-ph1" });
    expect(units.map((u) => u.name)).toEqual(["E-01", "E-02", "E-03"]);
    expect(units.every((u) => u.kind === "unit" && u.saleStatus === "empty")).toBe(true);
    expect(units.every((u) => u.parentId === block.id)).toBe(true);
    expect(units.every((u) => u.code === u.name)).toBe(true);

    // B-323: project_node has no `seq`, and dashboard.ts reads the table with
    // entryOrder (created_at ASC) to build the phase ladder. This block + its 3 units
    // go in ONE insertThrough = one now(), so without the stamp all four tie and that
    // ladder falls through to the random uuid. (This file's own bySibling tiebreaks on
    // name and would survive the tie — the dashboard reader is the one that breaks,
    // which is exactly why the WRITE side is where the fix belongs.)
    const times = (written as { createdAt?: Date }[]).map((n) => n.createdAt?.getTime());
    expect(times.every((t) => typeof t === "number")).toBe(true);
    expect(new Set(times).size).toBe(4);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);

    // response echoes the created block: brand-new units → sold/built provably 0.
    expect(res.json()).toMatchObject({
      kind: "block", code: "E", name: "Block E", units: 3, sold: 0, built: 0, parent_id: "n-ph1",
    });
  });

  it("400s when units exceed the 200/block cap", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [PROJECT]], [projectNodes, [PH1]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/projects/p1/nodes", payload: { name: "E", code: "E", units: 201 } });
    expect(res.statusCode).toBe(400);
  });

  it("400s when units < 1", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [PROJECT]], [projectNodes, [PH1]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/projects/p1/nodes", payload: { name: "E", code: "E", units: 0 } });
    expect(res.statusCode).toBe(400);
  });

  it("409s a block code that already exists in the project (case-insensitive)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [PROJECT]], [projectNodes, [PH1, BLK]]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/projects/p1/nodes", payload: { name: "dup", code: "b", units: 2 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_CODE");
  });

  it("400s when the project has no phase to attach under", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [PROJECT]], [projectNodes, []]] }),
      })
    ).inject({ method: "POST", url: "/api/v1/projects/p1/nodes", payload: { name: "E", code: "E", units: 2 } });
    expect(res.statusCode).toBe(400);
  });

  it("400s when a supplied model_id is not in the tenant", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb({ rows: [[projects, [PROJECT]], [projectNodes, [PH1]], [models, []]] }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/projects/p1/nodes",
      payload: { name: "E", code: "E", units: 2, model_id: "m-ghost" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// G3 unit tests (PLAN.md §9) — GET /counts (P1-BE-02, B-040(ก)): per-key
// pending-work counts from seed-shaped rows, parent-mirror sharing
// (boq ↔ boq.approval · sales ↔ sales.service), 400 on unknown/missing keys,
// 401 without a session, and company_id scope bound on every query.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  boqDocs,
  grs,
  jvs,
  leads,
  payrolls,
  pmWorkOrders,
  prs,
  pvs,
  rvs,
  serviceTickets,
  workPeriods,
} from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "./../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย วัฒนกุล" },
};

// --- stub Db supporting BOTH plain scoped selects and selectThrough joins ---
interface Captured {
  table: unknown;
  joins: unknown[];
  where: SQL | undefined;
}

function stubJoinDb(
  rows: Array<[unknown, unknown[]]>,
  captured: Captured[] = [],
): Db {
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  return {
    select: () => ({
      from: (table: unknown) => {
        const joins: unknown[] = [];
        const builder = {
          $dynamic: () => builder,
          innerJoin: (parent: unknown) => {
            joins.push(parent);
            return builder;
          },
          where: (where: SQL) => {
            captured.push({ table, joins, where });
            return Promise.resolve(rowsFor(table));
          },
          then: (
            onOk: (rows: unknown[]) => unknown,
            onErr: (err: unknown) => unknown,
          ) => {
            captured.push({ table, joins, where: undefined });
            return Promise.resolve(rowsFor(table)).then(onOk, onErr);
          },
        };
        return builder;
      },
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

async function buildTestApp(
  overrides: Partial<AppDeps> = {},
): Promise<FastifyInstance> {
  app = await buildApp({
    db: overrides.db ?? stubJoinDb([]),
    resolveTenant: overrides.resolveTenant ?? (async () => null),
    signIn: overrides.signIn ?? (async () => null),
    storage: overrides.storage ?? createFakeR2Storage("https://r2.test"),
    quota:
      overrides.quota ??
      new QuotaGuard({
        resolver: unlimitedQuotaResolver,
        upgradeUrl: "https://upgrade.test",
      }),
    auditSink: overrides.auditSink ?? (async () => {}),
    logger: false,
  });
  return app;
}

// --- seed-shaped canned rows (stub returns post-WHERE rows per table) --------
const PV_A = "aaaaaaaa-0000-0000-0000-00000000000a";
const PV_B = "aaaaaaaa-0000-0000-0000-00000000000b";
const GR_A = "bbbbbbbb-0000-0000-0000-00000000000a";
const GR_B = "bbbbbbbb-0000-0000-0000-00000000000b";
const RV_A = "cccccccc-0000-0000-0000-00000000000a";

const countsDb = (captured: Captured[] = []) =>
  stubJoinDb(
    [
      // boq.approval → 1 pending doc (seed: BOQ-2026-D-01)
      [boqDocs, [{ id: "boq-1", status: "pending" }]],
      // pr.list → 3 pending PRs (seed: PR-2026-0418/0417/0412)
      [prs, [{ id: "pr-1" }, { id: "pr-2" }, { id: "pr-3" }]],
      // accept → delivered ×2 + rejected ×1 (seed work periods)
      [workPeriods, [{ id: "wp-1" }, { id: "wp-2" }, { id: "wp-3" }]],
      // pm.wo → 6 unsigned work orders (seed)
      [
        pmWorkOrders,
        Array.from({ length: 6 }, (_, i) => ({ id: `wo-${i}` })),
      ],
      // gl.inbox sources: pv ×2, rv ×1, gr ×2, payroll ×0
      [pvs, [{ id: PV_A }, { id: PV_B }]],
      [rvs, [{ id: RV_A }]],
      [grs, [{ id: GR_A }, { id: GR_B }]],
      [payrolls, []],
      // one JV posted PV_A via the "table:uuid" convention; mock strings
      // (seed verbatim, e.g. "REM") reference nothing.
      [
        jvs,
        [
          { id: "jv-1", sourceDoc: `pv:${PV_A}` },
          { id: "jv-2", sourceDoc: "REM" },
          { id: "jv-3", sourceDoc: null },
        ],
      ],
      // sales.crm → whole funnel (2 leads)
      [leads, [{ id: "l-1", stage: "lead" }, { id: "l-2", stage: "contract" }]],
      // sales.service → 5 open of 7 (2 closed) — mirrors seed distribution
      [
        serviceTickets,
        [
          { id: "t-1", status: "scheduled" },
          { id: "t-2", status: "fixing" },
          { id: "t-3", status: "received" },
          { id: "t-4", status: "fixed" },
          { id: "t-5", status: "fixed" },
          { id: "t-6", status: "closed" },
          { id: "t-7", status: "closed" },
        ],
      ],
    ],
    captured,
  );

describe("GET /api/v1/counts — auth and validation", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      url: "/api/v1/counts?keys=boq",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Missing tenant context",
    });
  });

  it("400s flat when keys is missing", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION })
    ).inject({ url: "/api/v1/counts" });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("MISSING_COUNT_KEYS");
    expect(Object.keys(body).sort()).toEqual(["code", "message"]);
  });

  it("400s flat on an unknown key (contract: enum of the 9 nav ids)", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION })
    ).inject({ url: "/api/v1/counts?keys=boq,nope" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      code: "INVALID_COUNT_KEY",
      message: "Unknown count key: nope",
    });
  });
});

describe("GET /api/v1/counts — per-key counts from seed-shaped rows", () => {
  it("answers the Counts shape for all 9 keys", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: countsDb(),
      })
    ).inject({
      url:
        "/api/v1/counts?keys=boq,boq.approval,pr.list,accept,pm.wo," +
        "gl.inbox,sales,sales.crm,sales.service",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      counts: {
        boq: 1,
        "boq.approval": 1,
        "pr.list": 3,
        accept: 3,
        "pm.wo": 6,
        // pv (2) − posted pv:PV_A (1) + rv (1) + gr (2) + payroll (0) = 4
        "gl.inbox": 4,
        sales: 5,
        "sales.crm": 2,
        "sales.service": 5,
      },
    });
  });

  it("answers only the requested keys", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: countsDb(),
      })
    ).inject({ url: "/api/v1/counts?keys=pr.list" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ counts: { "pr.list": 3 } });
  });

  it("parent badges mirror their child and share ONE query (boq ↔ boq.approval)", async () => {
    const captured: Captured[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: countsDb(captured),
      })
    ).inject({ url: "/api/v1/counts?keys=boq,boq.approval" });

    expect(res.json()).toEqual({ counts: { boq: 1, "boq.approval": 1 } });
    // memoized: exactly one boq_doc query despite two keys
    expect(captured.filter((c) => c.table === boqDocs).length).toBe(1);
  });

  it("binds company_id on EVERY count query (tenant scope, C10)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: countsDb(captured),
      })
    ).inject({
      url:
        "/api/v1/counts?keys=boq,boq.approval,pr.list,accept,pm.wo," +
        "gl.inbox,sales,sales.crm,sales.service",
    });

    expect(captured.length).toBeGreaterThan(0);
    for (const call of captured) {
      expect(paramsOf(call.where)).toContain(COMPANY);
    }
  });

  it("scopes parent-FK tables through joins (never a bare read)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: countsDb(captured),
      })
    ).inject({ url: "/api/v1/counts?keys=accept,pm.wo,boq.approval,gl.inbox" });

    const joinsFor = (table: unknown): number =>
      captured.find((c) => c.table === table)?.joins.length ?? -1;
    expect(joinsFor(boqDocs)).toBe(1); // → project
    expect(joinsFor(workPeriods)).toBe(2); // → subcon_contract → project
    expect(joinsFor(pmWorkOrders)).toBe(3); // → asset → contract → project
    expect(joinsFor(grs)).toBe(2); // → po → vendor
    expect(joinsFor(pvs)).toBe(0); // direct company_id table
  });
});

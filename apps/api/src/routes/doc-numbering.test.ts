// G3 unit tests (PLAN.md §9) — GET /doc-numbering (P1-BE-08, master.jsx
// DOCNUM_SEED): the tenant's running-number counters with their
// {id, type, prefix, running, reset_rule, locked} wire shape, wrapped in the
// B-014 list envelope, fail-closed 401 without a tenant, and tenant-scoped on
// doc_numbering's OWN company_id column (extensions.ts:574) — read through the
// scoped select() door whose WHERE company_id = <tenant> predicate is asserted
// directly, so another tenant's counters can never leak.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { docNumberings } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย วัฒนกุล" },
};

// --- capturing stub Db: per-table canned rows + the WHERE predicate of every
// scoped select() read (doc_numbering is read via db.select(table).where(scope),
// so the tenant predicate lands in .where()).
interface Captured {
  table: unknown;
  where: SQL | undefined;
}

function stubDb(
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
        const builder = {
          $dynamic: () => builder,
          innerJoin: () => builder,
          where: (where: SQL) => {
            captured.push({ table, where });
            return Promise.resolve(rowsFor(table));
          },
          then: (
            onOk: (rows: unknown[]) => unknown,
            onErr: (err: unknown) => unknown,
          ) => {
            captured.push({ table, where: undefined });
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
    db: overrides.db ?? stubDb([]),
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

// --- seed-shaped canned rows (doc_numbering schema / DOCNUM_SEED). The stub
// returns post-WHERE rows, so these transcribe the schema columns the route
// reads: running is the stored integer (the seed's "0291" leading-zero string
// is mock-only display formatting), reset_rule/locked are the renamed columns.
const docRow = (
  type: string,
  prefix: string,
  running: number,
  resetRule: string,
  locked: boolean,
) => ({
  id: `docnum-${prefix}`,
  companyId: COMPANY,
  type,
  prefix,
  running,
  resetRule,
  locked,
  createdAt: new Date(),
  updatedAt: new Date(),
});
const seedDocNumbering = [
  docRow("Purchase Requisition", "PR", 418, "ทุกปีบัญชี", false),
  docRow("Purchase Order", "PO", 291, "ทุกปีบัญชี", true),
  docRow("Work Order", "WO", 117, "ทุกปีบัญชี", true),
];

describe("GET /api/v1/doc-numbering — auth", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      url: "/api/v1/doc-numbering",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Missing tenant context",
    });
  });
});

describe("GET /api/v1/doc-numbering — counters in the B-014 list envelope", () => {
  it("wraps the counters with {id, type, prefix, running, reset_rule, locked}", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[docNumberings, seedDocNumbering]]),
      })
    ).inject({ url: "/api/v1/doc-numbering" });

    expect(res.statusCode).toBe(200);
    // B-014: 3 rows returned as a single full page (page_size = max(3, 50) = 50).
    expect(res.json()).toEqual({
      data: [
        { id: "docnum-PR", type: "Purchase Requisition", prefix: "PR", running: 418, reset_rule: "ทุกปีบัญชี", locked: false },
        { id: "docnum-PO", type: "Purchase Order", prefix: "PO", running: 291, reset_rule: "ทุกปีบัญชี", locked: true },
        { id: "docnum-WO", type: "Work Order", prefix: "WO", running: 117, reset_rule: "ทุกปีบัญชี", locked: true },
      ],
      page: 1,
      page_size: 50,
      total: 3,
    });
  });

  it("returns only the schema columns (no company_id / timestamp leak)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[docNumberings, [seedDocNumbering[0]]]]),
      })
    ).inject({ url: "/api/v1/doc-numbering" });

    const row = res.json().data[0];
    // company_id (tenant scope) + timestamps never reach the wire.
    expect(Object.keys(row).sort()).toEqual(
      ["id", "locked", "prefix", "reset_rule", "running", "type"],
    );
  });

  it("empty set still yields a valid one-page envelope (page_size >= 1)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[docNumberings, []]]),
      })
    ).inject({ url: "/api/v1/doc-numbering" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [],
      page: 1,
      page_size: 50,
      total: 0,
    });
  });
});

describe("GET /api/v1/doc-numbering — tenant scope (no leak)", () => {
  it("reads doc_numbering bound to company_id = <this tenant>", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[docNumberings, seedDocNumbering]], captured),
      })
    ).inject({ url: "/api/v1/doc-numbering" });

    // exactly one read: doc_numbering, scoped on its own company_id column.
    expect(captured).toHaveLength(1);
    expect(captured[0].table).toBe(docNumberings);
    expect(paramsOf(captured[0].where)).toContain(COMPANY);
  });

  it("is tenant-bound: a different tenant's predicate carries ITS company_id", async () => {
    const other = {
      companyId: "99999999-9999-9999-9999-999999999999",
      user: { id: "au-9", email: "other@x.co.th", name: "อื่น" },
    };
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => other,
        db: stubDb([[docNumberings, seedDocNumbering]], captured),
      })
    ).inject({ url: "/api/v1/doc-numbering" });

    expect(captured).toHaveLength(1);
    expect(paramsOf(captured[0].where)).toContain(other.companyId);
    expect(paramsOf(captured[0].where)).not.toContain(COMPANY);
  });
});

// G3 unit tests (PLAN.md §9) — POST /projects (P1-BE-13, B-058;
// CreateProjectForm master.jsx:1242-1338). The create-project wizard's backend:
// a project row scoped to the caller's company_id (the scoped insert door
// force-sets it), the server-owned `active` status, the project_type key → NOT
// NULL type_id resolution, and the wizard's optional first phase materialized as
// project_node rows (phase + N `empty` units) so the unit count round-trips
// through GET /projects. Package project quota gates creation (402), and a
// request without a tenant fails closed (401).
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { projects, projectNodes, projectTypes } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import {
  QuotaGuard,
  unlimitedQuotaResolver,
  type QuotaKey,
  type QuotaResolver,
} from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย วัฒนกุล" },
};

// --- join-capable capturing stub Db: records every read (table + join hops +
// WHERE) and every inserted row set. insert().values() accepts a single object
// (the scoped project insert) OR an array (insertThrough's node rows).
interface Captured {
  table: unknown;
  joins: unknown[];
  where: SQL | undefined;
}
interface Inserted {
  table: unknown;
  values: Record<string, unknown>[];
}

function stubDb(
  rows: Array<[unknown, unknown[]]>,
  captured: Captured[] = [],
  inserted: Inserted[] = [],
): Db {
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  let seq = 0;
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
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => ({
        returning: () => {
          const arr = Array.isArray(values) ? values : [values];
          inserted.push({ table, values: arr });
          // Echo the inserted rows + a synthetic id + the currency_code default a
          // real INSERT ... RETURNING would fill.
          return Promise.resolve(
            arr.map((v) => ({ id: `new-${seq++}`, currencyCode: "THB", ...v })),
          );
        },
      }),
    }),
  } as unknown as Db;
}

/** Fixed-answer quota resolver — forces the 402 path for a chosen dimension. */
function fixedQuota(answers: Record<string, { limit: number; used: number }>): QuotaResolver {
  return {
    async resolve(_companyId: string, key: QuotaKey) {
      return answers[key] ?? { limit: -1, used: 0 };
    },
  };
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

// project_type reference row the create resolves its type_id against.
const PT_REALESTATE = {
  id: "pt-realestate-0000-0000-0000-000000000001",
  key: "realestate",
  name: "อสังหาริมทรัพย์",
  hierarchy: ["โครงการ", "เฟส", "บล็อก", "ยูนิต"],
  modules: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};
// A canned project row makes insertThrough's parent-ownership verify pass (the
// stub returns it regardless of predicate — it stands in for the just-created,
// tenant-owned project).
const OWNED_PROJECT = { id: "new-0", companyId: COMPANY, name: "x" };

describe("POST /api/v1/projects — auth", () => {
  it("401s flat without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { name: "โครงการใหม่", type: "realestate" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Missing tenant context",
    });
  });
});

describe("POST /api/v1/projects — create (company-scoped, server-owned status)", () => {
  it("creates a project: company_id force-set, status active, type_id resolved, short uppercased", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[projectTypes, [PT_REALESTATE]]], [], inserted),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: {
        name: "  juneflow ลาดพร้าว เฟส 1  ",
        type: "realestate",
        short: "lpr",
        budget: 5500000,
        // a client-sent status must be ignored — the server owns it.
        status: "archived",
      },
    });

    expect(res.statusCode).toBe(201);
    // exactly one INSERT: the project, with server-owned fields.
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.table).toBe(projects);
    const values = inserted[0]!.values[0]!;
    expect(values.companyId).toBe(COMPANY); // scoped insert force-set the tenant
    expect(values.typeId).toBe(PT_REALESTATE.id); // key → NOT NULL type_id
    expect(values.name).toBe("juneflow ลาดพร้าว เฟส 1"); // trimmed
    expect(values.short).toBe("LPR"); // uppercased
    expect(values.budget).toBe("5500000.00"); // money column, 2-decimal string
    expect(values.currencyCode).toBe("THB");
    expect(values.status).toBe("active"); // NOT the client "archived"

    // 201 body is the Project wire shape (same as GET /projects).
    expect(res.json()).toEqual({
      id: "new-0",
      name: "juneflow ลาดพร้าว เฟส 1",
      type: "realestate",
      budget: 5500000,
      currency_code: "THB",
      status: "active",
      short: "LPR",
      color: null,
      company_id: COMPANY,
      units: 0,
      phases: [],
    });
  });

  it("defaults an omitted budget to null and currency_code to THB", async () => {
    const inserted: Inserted[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[projectTypes, [PT_REALESTATE]]], [], inserted),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { name: "ไม่มีงบ", type: "realestate" },
    });
    const values = inserted[0]!.values[0]!;
    expect(values.budget).toBeNull();
    expect(values.currencyCode).toBe("THB");
  });
});

describe("POST /api/v1/projects — first phase materialized as project_node rows", () => {
  it("creates a phase node + N `empty` unit nodes and round-trips the unit count", async () => {
    const captured: Captured[] = [];
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(
          [[projectTypes, [PT_REALESTATE]], [projects, [OWNED_PROJECT]]],
          captured,
          inserted,
        ),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: {
        name: "ลาดพร้าว",
        type: "realestate",
        short: "LPR",
        units: 3,
        phases: [{ label: "เฟส 1", units: 3 }],
      },
    });

    expect(res.statusCode).toBe(201);
    // two INSERTs: project, then the project_node batch (phase + units).
    expect(inserted).toHaveLength(2);
    expect(inserted[0]!.table).toBe(projects);
    expect(inserted[1]!.table).toBe(projectNodes);

    const nodeRows = inserted[1]!.values;
    const phaseRows = nodeRows.filter((n) => n.kind === "phase");
    const unitRows = nodeRows.filter((n) => n.kind === "unit");
    expect(phaseRows).toHaveLength(1);
    expect(unitRows).toHaveLength(3);
    // the phase is a root node (no parent) named after the wizard's label.
    expect(phaseRows[0]!.name).toBe("เฟส 1");
    expect(phaseRows[0]!.parentId).toBeNull();
    expect(phaseRows[0]!.projectId).toBe("new-0");
    // every unit hangs under the phase and starts `empty` (like a fresh block).
    for (const u of unitRows) {
      expect(u.parentId).toBe(phaseRows[0]!.id);
      expect(u.saleStatus).toBe("empty");
      expect(u.projectId).toBe("new-0");
    }

    // insertThrough verified this tenant owns the parent project before writing.
    const parentVerify = captured.filter(
      (c) => c.table === projects && paramsOf(c.where).includes("new-0"),
    );
    expect(parentVerify.length).toBeGreaterThan(0);
    for (const call of parentVerify) {
      expect(paramsOf(call.where)).toContain(COMPANY);
    }

    // the 201 body derives units/phases from what was created (all empty → 0%).
    const body = res.json();
    expect(body.units).toBe(3);
    expect(body.phases).toHaveLength(1);
    expect(body.phases[0]).toMatchObject({
      name: "เฟส 1",
      units: 3,
      sold_pct: 0,
      sale_status: null,
    });
  });

  it("skips structure when phases is omitted (no project_node write)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[projectTypes, [PT_REALESTATE]]], [], inserted),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { name: "ข้ามโครงสร้าง", type: "realestate" },
    });
    expect(res.statusCode).toBe(201);
    // only the project row — no project_node batch.
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.table).toBe(projects);
    expect(res.json().units).toBe(0);
    expect(res.json().phases).toEqual([]);
  });
});

describe("POST /api/v1/projects — quota gate (402)", () => {
  it("402s QUOTA_EXCEEDED with upgrade_url when over the project quota (nothing written)", async () => {
    const inserted: Inserted[] = [];
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[projectTypes, [PT_REALESTATE]]], [], inserted),
        quota: new QuotaGuard({
          resolver: fixedQuota({ projects: { limit: 1, used: 1 } }),
          upgradeUrl: "https://upgrade.test/subscription",
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { name: "เกินโควตา", type: "realestate" },
    });

    expect(res.statusCode).toBe(402);
    expect(res.json()).toEqual({
      code: "QUOTA_EXCEEDED",
      message: "Quota exceeded for projects",
      upgrade_url: "https://upgrade.test/subscription",
    });
    // the quota check runs BEFORE any write.
    expect(inserted).toHaveLength(0);
  });

  it("creates when within quota (headroom for one more)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[projectTypes, [PT_REALESTATE]]]),
        quota: new QuotaGuard({
          resolver: fixedQuota({ projects: { limit: 5, used: 4 } }),
          upgradeUrl: "https://upgrade.test/subscription",
        }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { name: "ยังมีที่ว่าง", type: "realestate" },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe("POST /api/v1/projects — validation", () => {
  const build = async () =>
    buildTestApp({
      resolveTenant: async () => SESSION,
      db: stubDb([[projectTypes, [PT_REALESTATE]], [projects, [OWNED_PROJECT]]]),
    });

  it("400s on a missing name", async () => {
    const res = await (await build()).inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { type: "realestate" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
  });

  it("400s on an unknown type (not one of the 4 keys)", async () => {
    const res = await (await build()).inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { name: "x", type: "spaceport" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s on a non-numeric budget", async () => {
    const res = await (await build()).inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: { name: "x", type: "realestate", budget: "ไม่ใช่เลข" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s when a phase asks for more than the per-phase unit cap", async () => {
    const res = await (await build()).inject({
      method: "POST",
      url: "/api/v1/projects",
      payload: {
        name: "x",
        type: "realestate",
        phases: [{ label: "เฟสยักษ์", units: 201 }],
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

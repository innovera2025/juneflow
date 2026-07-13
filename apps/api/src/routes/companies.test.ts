// G3 unit tests (PLAN.md §9) — GET /companies (P1-BE-03, B-041(ก+)): the
// tenant's affiliated group companies (Multi-Company switcher rows) with the
// Company wire shape, group-head derivation from the tenant's own company row
// (never from client input), fail-closed 401s, and company/tenant scope on
// every query.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { companies, projects } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const HEAD = "44444444-4444-4444-4444-444444444444";
const JF = "55555555-5555-5555-5555-555555555501";
const JE = "55555555-5555-5555-5555-555555555502";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย วัฒนกุล" },
};

// --- sequenced stub Db: per-table QUEUE of canned row sets ------------------
// GET /companies reads the companies table twice (own row → group members),
// so the stub answers per call order; the last row set sticks.
interface Captured {
  table: unknown;
  where: SQL | undefined;
}

function stubSeqDb(
  queues: Array<[unknown, unknown[][]]>,
  captured: Captured[] = [],
): Db {
  const remaining = new Map<unknown, unknown[][]>(
    queues.map(([t, q]) => [t, [...q]]),
  );
  const rowsFor = (table: unknown): unknown[] => {
    const queue = remaining.get(table);
    if (!queue || queue.length === 0) return [];
    return queue.length === 1 ? (queue[0] as unknown[]) : (queue.shift() as unknown[]);
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
    db: overrides.db ?? stubSeqDb([]),
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

// --- seed-shaped canned rows (company-accept.jsx COMPANIES) ------------------
const ownRow = {
  id: COMPANY,
  name: "บจก. รุ่งเรืองก่อสร้าง",
  taxId: null,
  short: null,
  color: null,
  docPrefix: null,
  biz: null,
  groupParentId: null,
};
const jfRow = {
  id: JF,
  name: "บจก. จูนโฟลว์ ดีเวลลอปเมนท์",
  taxId: "0-1055-61012-34-5",
  short: "JF",
  color: "#0B2A4A",
  docPrefix: "JF",
  biz: "พัฒนาอสังหาริมทรัพย์",
  groupParentId: COMPANY,
};
const jeRow = {
  id: JE,
  name: "บจก. จูนโฟลว์ เอ็นเนอร์ยี",
  taxId: "0-1055-64067-89-0",
  short: "JE",
  color: "#B45309",
  docPrefix: "JE",
  biz: "โรงไฟฟ้าพลังงานแสงอาทิตย์",
  groupParentId: COMPANY,
};

describe("GET /api/v1/companies — auth", () => {
  it("401s flat without a session", async () => {
    const res = await (await buildTestApp()).inject({
      url: "/api/v1/companies",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Missing tenant context",
    });
  });

  it("fails closed 401 when the tenant has no company row", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubSeqDb([[companies, [[]]]]),
      })
    ).inject({ url: "/api/v1/companies" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "No company record for this tenant",
    });
  });
});

describe("GET /api/v1/companies — group members with the Company shape", () => {
  it("answers the members with switcher fields + derived project_count", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubSeqDb([
          [companies, [[ownRow], [jfRow, jeRow]]],
          // one tenant project attributed to JF, none to JE
          [projects, [[{ id: "pj-1", companyId: JF }]]],
        ]),
      })
    ).inject({ url: "/api/v1/companies" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        id: JF,
        name: "บจก. จูนโฟลว์ ดีเวลลอปเมนท์",
        short: "JF",
        color: "#0B2A4A",
        biz: "พัฒนาอสังหาริมทรัพย์",
        tax_id: "0-1055-61012-34-5",
        doc_prefix: "JF",
        project_count: 1,
      },
      {
        id: JE,
        name: "บจก. จูนโฟลว์ เอ็นเนอร์ยี",
        short: "JE",
        color: "#B45309",
        biz: "โรงไฟฟ้าพลังงานแสงอาทิตย์",
        tax_id: "0-1055-64067-89-0",
        doc_prefix: "JE",
        project_count: 0,
      },
    ]);
  });

  it("derives the group head from the tenant's own row (head = own id when ungrouped)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubSeqDb(
          [
            [companies, [[ownRow], [jfRow]]],
            [projects, [[]]],
          ],
          captured,
        ),
      })
    ).inject({ url: "/api/v1/companies" });

    const companyCalls = captured.filter((c) => c.table === companies);
    expect(companyCalls.length).toBe(2);
    // 1st read: the tenant's own row by its OWN id (from the JWT scope).
    expect(paramsOf(companyCalls[0]?.where)).toEqual([COMPANY]);
    // 2nd read: members by group_parent_id = head (= own id here).
    expect(paramsOf(companyCalls[1]?.where)).toEqual([COMPANY]);
  });

  it("anchors on the head company when the tenant is itself a group member", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubSeqDb(
          [
            [companies, [[{ ...ownRow, groupParentId: HEAD }], [jfRow]]],
            [projects, [[]]],
          ],
          captured,
        ),
      })
    ).inject({ url: "/api/v1/companies" });

    const companyCalls = captured.filter((c) => c.table === companies);
    // member lookup binds the HEAD id, never a client-supplied value.
    expect(paramsOf(companyCalls[1]?.where)).toEqual([HEAD]);
  });

  it("binds company_id on the tenant project read (scope)", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubSeqDb(
          [
            [companies, [[ownRow], [jfRow]]],
            [projects, [[]]],
          ],
          captured,
        ),
      })
    ).inject({ url: "/api/v1/companies" });

    const projectCalls = captured.filter((c) => c.table === projects);
    expect(projectCalls.length).toBe(1);
    expect(paramsOf(projectCalls[0]?.where)).toContain(COMPANY);
  });
});

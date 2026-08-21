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
// reads: running is the stored TEXT verbatim from the mock — leading zeros
// kept ("0418") and non-numeric values allowed (BOQ "B-02 v3") per B-060(ก).
// locked is the lock-mode CODE (B-067(ข), P1-BE-12 — was boolean): one of the
// 4 mock LOCK_OPTS modes all | dept | warehouse | none.
const docRow = (
  type: string,
  prefix: string,
  running: string,
  resetRule: string,
  locked: string,
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
// Covers all 4 lock-mode codes (dept · all · warehouse · none) so the route is
// proven to pass each through verbatim (B-067(ข) — the boolean it replaced
// collapsed dept+warehouse into false).
const seedDocNumbering = [
  docRow("Purchase Requisition", "PR", "0418", "ทุกปีบัญชี", "dept"),
  docRow("Purchase Order", "PO", "0291", "ทุกปีบัญชี", "all"),
  docRow("Bill of Quantities", "BOQ", "B-02 v3", "—", "all"),
  docRow("Stock Transfer", "TR", "0084", "ทุกปีบัญชี", "warehouse"),
  docRow("Return", "RT", "0014", "ทุกปีบัญชี", "none"),
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
  it("wraps the counters with {id, type, prefix, running, reset_rule, locked} — running is a verbatim STRING (B-060), locked is the lock-mode CODE (B-067)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[docNumberings, seedDocNumbering]]),
      })
    ).inject({ url: "/api/v1/doc-numbering" });

    expect(res.statusCode).toBe(200);
    // B-014: 5 rows returned as a single full page (page_size = max(5, 50) = 50).
    // B-060: running goes on the wire as the stored text — the leading zeros
    // survive ("0418" stays "0418", never 418) and the BOQ row carries the
    // non-numeric "B-02 v3" verbatim (master.jsx:743/874).
    // B-067: locked is the lock-mode code passed through verbatim — all 4 modes
    // (dept · all · warehouse · none) reach the wire distinctly.
    expect(res.json()).toEqual({
      data: [
        { id: "docnum-PR", type: "Purchase Requisition", prefix: "PR", running: "0418", reset_rule: "ทุกปีบัญชี", locked: "dept" },
        { id: "docnum-PO", type: "Purchase Order", prefix: "PO", running: "0291", reset_rule: "ทุกปีบัญชี", locked: "all" },
        { id: "docnum-BOQ", type: "Bill of Quantities", prefix: "BOQ", running: "B-02 v3", reset_rule: "—", locked: "all" },
        { id: "docnum-TR", type: "Stock Transfer", prefix: "TR", running: "0084", reset_rule: "ทุกปีบัญชี", locked: "warehouse" },
        { id: "docnum-RT", type: "Return", prefix: "RT", running: "0014", reset_rule: "ทุกปีบัญชี", locked: "none" },
      ],
      page: 1,
      page_size: 50,
      total: 5,
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

// ---------------------------------------------------------------------------
// WRITES (this round) — POST /doc-numbering, PUT /doc-numbering/{id},
// GET /doc-numbering/{id}. The contract declared all three; none was mounted,
// so master.docnum's add/edit controls had nothing to call.
// ---------------------------------------------------------------------------

/** A Postgres unique violation as node-postgres reports it. */
function uniqueViolation(constraint: string): Error & { code: string; constraint: string } {
  return Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
    constraint,
  });
}

interface WriteSink {
  inserted?: Record<string, unknown>[];
  updated?: Record<string, unknown>[];
  updateWhere?: SQL;
}

/**
 * Read-write stub. `throwOnWrite` makes both write doors reject with the given
 * error, which is how the 409 path is exercised: the duplicate is decided by the
 * DATABASE (unique(company_id, type), extensions.ts:749), never by a preceding
 * SELECT, so the only thing this suite can and should prove is that the handler
 * translates that specific constraint — and nothing else — into a 409.
 */
function rwStub(opts: {
  selectRows?: unknown[];
  updateRows?: unknown[];
  sink?: WriteSink;
  throwOnWrite?: Error;
} = {}): Db {
  const selectRows = opts.selectRows ?? [];
  const updateRows = opts.updateRows ?? [];
  const sink = opts.sink ?? {};
  const boom = opts.throwOnWrite;
  return {
    select: () => ({
      from: () => {
        const builder = {
          $dynamic: () => builder,
          where: () => Promise.resolve(selectRows),
          then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) =>
            Promise.resolve(selectRows).then(onOk, onErr),
        };
        return builder;
      },
    }),
    // BOTH insert doors (B-386/B-388, enforced by stub-insert-door.enforce.test):
    // TenantDb.insert() can be awaited directly OR chained with .returning(), and
    // a `.returning()`-only stub records nothing for the first, which makes every
    // "did not write" assertion about it vacuous. One record() closure sits behind
    // both, invoked once per DOOR CALL so nothing double-counts.
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        const record = (): Record<string, unknown>[] => {
          sink.inserted = [...(sink.inserted ?? []), values];
          return [{ id: "docnum-new", ...values }];
        };
        return {
          returning: () => (boom ? Promise.reject(boom) : Promise.resolve(record())),
          then: (onOk: (r: unknown) => unknown, onErr: (e: unknown) => unknown) =>
            (boom ? Promise.reject(boom) : Promise.resolve(record())).then(onOk, onErr),
        };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: () => {
            if (boom) return Promise.reject(boom);
            sink.updated = [...(sink.updated ?? []), values];
            sink.updateWhere = where;
            return Promise.resolve(updateRows);
          },
        }),
      }),
    }),
  } as unknown as Db;
}

const OK_BODY = { type: "Debit Note", prefix: "DN", running: "0001", reset_rule: "ทุกปีบัญชี", locked: "all" };

describe("POST /api/v1/doc-numbering — create a counter", () => {
  it("401s without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "POST",
      url: "/api/v1/doc-numbering",
      payload: OK_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  it("creates and echoes the wire shape", async () => {
    const sink: WriteSink = {};
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: rwStub({ sink }) })
    ).inject({ method: "POST", url: "/api/v1/doc-numbering", payload: OK_BODY });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: "docnum-new",
      type: "Debit Note",
      prefix: "DN",
      running: "0001",
      reset_rule: "ทุกปีบัญชี",
      locked: "all",
    });
    expect(sink.inserted?.[0]).toMatchObject({ type: "Debit Note", running: "0001", locked: "all" });
  });

  it("keeps `running` as TEXT — leading zeros survive", async () => {
    // B-060: the mock carries "0418" and even "B-02 v3". Parsing it to a number
    // here would rewrite both, and the FE pads/increments all-digit values itself.
    const sink: WriteSink = {};
    await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: rwStub({ sink }) })
    ).inject({
      method: "POST",
      url: "/api/v1/doc-numbering",
      payload: { ...OK_BODY, running: "0418" },
    });
    expect(sink.inserted?.[0]!.running).toBe("0418");
  });

  it("400s a missing type — it is the NOT NULL column and half the unique index", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: rwStub() })
    ).inject({ method: "POST", url: "/api/v1/doc-numbering", payload: { prefix: "DN" } });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
  });

  it("400s an unknown lock code instead of storing it", async () => {
    // The column is free text with a default, so "sometimes" would store happily
    // and then render as NOTHING in the grid's security column — indistinguishable
    // from "not set" for a screen whose subject is locking document numbers.
    const sink: WriteSink = {};
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: rwStub({ sink }) })
    ).inject({
      method: "POST",
      url: "/api/v1/doc-numbering",
      payload: { ...OK_BODY, locked: "sometimes" },
    });

    expect(res.statusCode).toBe(400);
    expect(sink.inserted).toBeUndefined();
  });

  it("accepts every lock code the FE can label, and defaults to none", async () => {
    for (const locked of ["all", "dept", "warehouse", "none"]) {
      const sink: WriteSink = {};
      const res = await (
        await buildTestApp({ resolveTenant: async () => SESSION, db: rwStub({ sink }) })
      ).inject({ method: "POST", url: "/api/v1/doc-numbering", payload: { ...OK_BODY, locked } });
      expect(res.statusCode).toBe(201);
      expect(sink.inserted?.[0]!.locked).toBe(locked);
    }

    const sink: WriteSink = {};
    await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: rwStub({ sink }) })
    ).inject({ method: "POST", url: "/api/v1/doc-numbering", payload: { type: "Debit Note" } });
    expect(sink.inserted?.[0]!.locked).toBe("none");
    expect(sink.inserted?.[0]!.running).toBe("1");
  });

  it("409s on the type unique index — the DB decides, not a preceding SELECT", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rwStub({ throwOnWrite: uniqueViolation("doc_numbering_company_type_uq") }),
      })
    ).inject({ method: "POST", url: "/api/v1/doc-numbering", payload: OK_BODY });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_TYPE");
  });

  it("does NOT report a DIFFERENT unique index as a duplicate type", async () => {
    // B-263: gating on "some unique violation" turns every future index on this
    // table into a false 409 that hides a real bug. The catch is keyed on the
    // constraint NAME, so another index must surface as a 500.
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rwStub({ throwOnWrite: uniqueViolation("some_other_uq") }),
      })
    ).inject({ method: "POST", url: "/api/v1/doc-numbering", payload: OK_BODY });

    expect(res.statusCode).toBe(500);
  });
});

describe("GET /api/v1/doc-numbering/{id} — one counter", () => {
  it("401s without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/api/v1/doc-numbering/docnum-PO" });
    expect(res.statusCode).toBe(401);
  });

  it("404s an id this tenant cannot see, rather than 403", async () => {
    // The scoped select AND-injects company_id, so another tenant's row simply
    // matches nothing. A 403 would confirm the id exists somewhere.
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: rwStub({ selectRows: [] }) })
    ).inject({ url: "/api/v1/doc-numbering/docnum-OTHER" });

    expect(res.statusCode).toBe(404);
  });
});

describe("PUT /api/v1/doc-numbering/{id} — update a counter", () => {
  it("401s without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({
      method: "PUT",
      url: "/api/v1/doc-numbering/docnum-PO",
      payload: OK_BODY,
    });
    expect(res.statusCode).toBe(401);
  });

  it("404s when the scoped update matches no row", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rwStub({ updateRows: [] }),
      })
    ).inject({ method: "PUT", url: "/api/v1/doc-numbering/docnum-OTHER", payload: OK_BODY });

    expect(res.statusCode).toBe(404);
  });

  it("scopes the update by the row id", async () => {
    const sink: WriteSink = {};
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rwStub({
          sink,
          updateRows: [{ id: "docnum-PO", type: "Purchase Order", prefix: "PO", running: "0292", resetRule: null, locked: "all" }],
        }),
      })
    ).inject({
      method: "PUT",
      url: "/api/v1/doc-numbering/docnum-PO",
      payload: { type: "Purchase Order", prefix: "PO", running: "0292", locked: "all" },
    });

    expect(res.statusCode).toBe(200);
    expect(paramsOf(sink.updateWhere)).toContain("docnum-PO");
    expect(res.json().running).toBe("0292");
  });

  it("409s when a rename collides with the type unique index", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: rwStub({ throwOnWrite: uniqueViolation("doc_numbering_company_type_uq") }),
      })
    ).inject({ method: "PUT", url: "/api/v1/doc-numbering/docnum-PO", payload: OK_BODY });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("DUPLICATE_TYPE");
  });

  it("400s an unknown lock code instead of storing it", async () => {
    const sink: WriteSink = {};
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: rwStub({ sink }) })
    ).inject({
      method: "PUT",
      url: "/api/v1/doc-numbering/docnum-PO",
      payload: { ...OK_BODY, locked: "maybe" },
    });

    expect(res.statusCode).toBe(400);
    expect(sink.updated).toBeUndefined();
  });
});

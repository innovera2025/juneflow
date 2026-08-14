// G3 unit tests (PLAN.md §9) — P1-BE-01 app assembly: contract routes under
// /api/v1, auth guard (401 flat), GET /me + GET /projects response shapes from
// seed-shaped rows, POST /auth/login contract behavior, flat {code,message}
// not-found + error handlers, and tenant scope on every tenant-table query
// (asserted on the captured WHERE SQL — the company_id param must be bound).
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  aiUsage,
  companies,
  packages,
  projectNodes,
  projects,
  projectTypes,
  roles,
  salesUnits,
  subscriptions,
  users,
} from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
// The real driver error class, so the unwrapped-DatabaseError test below drives what
// production throws rather than a hand-rolled look-alike. `pg` is CJS and hangs
// DatabaseError off its module instance, so it is destructured from the default import.
import pgDriver from "pg";
// A REAL connection refusal, produced rather than described: a real Pool at a port
// nothing is listening on, and the same `drizzle()` the app builds its Db with. Every
// hand-written stand-in for this shape got its provenance fields wrong in one direction
// or another, which is exactly how the loose test shipped.
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { buildApp, type AppDeps } from "./app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "./plugins/quota.js";
import { createFakeR2Storage } from "./routes/files.js";

const { DatabaseError, Pool } = pgDriver;

const COMPANY = "22222222-2222-2222-2222-222222222222";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย วัฒนกุล" },
};

// --- seed-shaped canned rows (values mirror the central seed for T-1001) ----
const userRow = {
  id: "u-0",
  companyId: COMPANY,
  email: "somchai@rungrueang.co.th",
  name: "สมชาย วัฒนกุล",
  roleId: "r-pm",
  status: "active",
};
const roleRow = {
  id: "r-pm",
  companyId: COMPANY,
  name: "Project Manager",
  approvalLimits: { default: 1_000_000 },
  perms: { dashboard: { view: true } },
};
const subRow = {
  id: "s-0",
  companyId: COMPANY,
  packageId: "pkg-m",
  cycle: "yearly",
  status: "active",
};
const pkgRow = {
  id: "pkg-m",
  size: "M",
  name: "Professional",
  limits: { projects: 10, users: 25, storage_gb: 100, ai_per_month: 50 },
  menus: ["boq", "proc", "petty"],
  subRules: { "boq.aiqto": "M" },
};
const companyRow = {
  id: COMPANY,
  name: "บจก. รุ่งเรืองก่อสร้าง",
  taxId: null,
  address: null,
  short: null,
  color: null,
  docPrefix: null,
  biz: null,
  status: "active",
};
const projectRow = {
  id: "pj-rjp",
  companyId: COMPANY,
  typeId: "pt-re",
  name: "juneflow พาร์ค ราชพฤกษ์",
  short: "RJP",
  color: "#0B2A4A",
  budget: "50000000.00",
  currencyCode: "THB",
  status: "active",
};
const typeRow = { id: "pt-re", key: "realestate", name: "อสังหาริมทรัพย์" };
// project_node tree (B-041(ก+)): phase → block → 3 units (units hang under an
// intermediate block node, mirroring the central seed's B-009 layout).
const nodeRows = [
  { id: "n-p1", projectId: "pj-rjp", parentId: null, kind: "phase", name: "เฟส 2 · Block B+C (ทาวน์โฮม)", saleStatus: null },
  { id: "n-b", projectId: "pj-rjp", parentId: "n-p1", kind: "block", name: "Block B", saleStatus: null },
  { id: "n-u1", projectId: "pj-rjp", parentId: "n-b", kind: "unit", name: "B-01", saleStatus: "sold" },
  { id: "n-u2", projectId: "pj-rjp", parentId: "n-b", kind: "unit", name: "B-02", saleStatus: "soldBuilt" },
  { id: "n-u3", projectId: "pj-rjp", parentId: "n-b", kind: "unit", name: "B-03", saleStatus: "booked" },
];
const salesUnitRows = [
  { id: "su-1", companyId: COMPANY, unitId: "n-u1", stage: "sold" },
  { id: "su-2", companyId: COMPANY, unitId: "n-u2", stage: "soldBuilt" },
  { id: "su-3", companyId: COMPANY, unitId: "n-u3", stage: "booked" },
];

// --- stub Db: canned rows per table + captured (table, where) pairs ---------
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
          // selectThrough joins (P1-BE-02): the stub answers the child
          // table's canned rows regardless of join chain.
          $dynamic: () => builder,
          innerJoin: () => builder,
          where: (where: SQL) => {
            captured.push({ table, where });
            return Promise.resolve(rowsFor(table));
          },
          // selectReference without a predicate awaits the builder directly.
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

/** Bound params of a captured WHERE (drizzle serialization, no DB). */
function paramsOf(where: SQL | undefined): unknown[] {
  if (!where) return [];
  return new PgDialect().sqlToQuery(where).params;
}

function capturedFor(captured: Captured[], table: unknown): Captured[] {
  return captured.filter((c) => c.table === table);
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
    logger: overrides.logger ?? false,
  });
  return app;
}

const fullDb = (captured: Captured[] = []) =>
  stubDb(
    [
      [users, [userRow]],
      [roles, [roleRow]],
      [subscriptions, [subRow]],
      [packages, [pkgRow]],
      [companies, [companyRow]],
      [aiUsage, [{ month: "2026-07", used: 3 }, { month: "2026-07", used: 4 }]],
      [projects, [projectRow]],
      [projectTypes, [typeRow]],
      [projectNodes, nodeRows],
      [salesUnits, salesUnitRows],
    ],
    captured,
  );

describe("public surface", () => {
  it("serves /health without auth (compose healthcheck probe)", async () => {
    const res = await (await buildTestApp()).inject({ url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe("auth guard — every /api/v1 resource 401s flat without a session", () => {
  it.each(["/api/v1/me", "/api/v1/projects"])(
    "GET %s → 401 flat contract Error",
    async (url) => {
      const res = await (await buildTestApp()).inject({ url });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    },
  );
});

describe("flat error envelopes (audit debts 1+2)", () => {
  it("unknown route with a session → 404 flat NOT_FOUND", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION })
    ).inject({ url: "/api/v1/does-not-exist" });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe("NOT_FOUND");
    expect(typeof body.message).toBe("string");
    expect(Object.keys(body).sort()).toEqual(["code", "message"]);
  });

  it("a crashing resolver → 500 flat INTERNAL_ERROR without leaking details", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => {
          throw new Error("secret internal detail");
        },
      })
    ).inject({ url: "/api/v1/me" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  });
});

// ---------------------------------------------------------------------------
// B-390 — the data-exception remap is WIRED to the one shared error handler.
//
// db/pg-data-exception.test.ts proves the DECISION (which errors are the client's
// fault). This block proves the WIRING: that the handler actually feeds it the
// request's body / path params, and that its answer reaches the response. A correct
// decision function that nobody consults would leave every route still 500ing, and
// the unit tests alone cannot see that.
// ---------------------------------------------------------------------------

/** A Db whose every read fails with `err` — stands in for a statement Postgres refused. */
function throwingDb(err: unknown): Db {
  const fail = () => Promise.reject(err);
  const builder = {
    $dynamic: () => builder,
    innerJoin: () => builder,
    where: fail,
    then: (onOk: (rows: unknown[]) => unknown, onErr: (e: unknown) => unknown) =>
      fail().then(onOk, onErr),
  };
  return {
    select: () => ({ from: () => builder }),
  } as unknown as Db;
}

/**
 * DrizzleQueryError { cause: DatabaseError, query, params } — the shape drizzle really
 * throws, message included: drizzle builds it as `Failed query: <sql>\nparams: <values>`,
 * so the bound values live on the object AND in its message AND in its stack header.
 * The redaction tests below depend on all three being present here; the B-390 remap
 * tests only read `.params`.
 */
function drizzleQueryError(
  fields: { code: string; message?: string; detail?: string },
  params: unknown[],
  query = 'select "id" from "subcon_contract" where "id" = $1',
): Error {
  const cause = new Error(fields.message ?? "db error") as Error & Record<string, unknown>;
  cause.code = fields.code;
  cause.severity = PG_SEVERITY;
  if (fields.detail !== undefined) cause.detail = fields.detail;
  const e = new Error(
    `Failed query: ${query}\nparams: ${params}`,
  ) as Error & Record<string, unknown>;
  e.cause = cause;
  e.query = query;
  e.params = params;
  return e;
}

/**
 * A pg DatabaseError with NO drizzle wrapper — the REAL class off the `pg` driver, so
 * its own-property enumerability and its prototype are production's, not a stand-in.
 *
 * This is the shape app.ts pgFields() checks FIRST (SQLSTATE on the top-level `.code`,
 * nothing under `.cause`), and it reaches a handler whenever a statement is issued
 * outside drizzle's wrapper. It carries no `params` and no `query`: everything it can
 * leak is inside the message Postgres wrote.
 */
function unwrappedDatabaseError(code: string, message: string): Error {
  const e = new DatabaseError(message, message.length, "error");
  e.code = code;
  // Set for the same reason `code` is: the constructor takes neither off the wire, and a
  // server-sent error always carries both (see PG_SEVERITY). Without it this fixture is
  // the AMBIGUOUS shape, which its own test below drives on purpose.
  e.severity = PG_SEVERITY;
  return e;
}

/**
 * A UNIQUE VIOLATION as production really produces one: a REAL pg DatabaseError with
 * the fields Postgres sets on a 23505, inside drizzle's wrapper (every write here goes
 * through drizzle). `detail` is the whole point — Postgres puts the COLLIDING VALUE in
 * it, `Key (vendor_tax_id)=(<value>) already exists.`, while the message names only the
 * constraint. app.ts allowlists `detail` for SQLSTATE class 22 alone, and this is the
 * shape that control exists to refuse.
 */
function duplicateKeyError(detail: string): Error {
  const cause = new DatabaseError(
    'duplicate key value violates unique constraint "vendor_tax_id_unique"',
    140,
    "error",
  );
  cause.code = "23505";
  cause.severity = PG_SEVERITY;
  cause.detail = detail;
  cause.table = "vendor";
  cause.constraint = "vendor_tax_id_unique";
  const e = new Error("Failed query: insert into \"vendor\" ...\nparams: ") as Error &
    Record<string, unknown>;
  e.cause = cause;
  return e;
}

/**
 * Drizzle's wrapper around a statement that failed for a reason Postgres never got to
 * REPORT — a dropped connection, a pool timeout — so `.cause` carries no SQLSTATE. That
 * is the case app.ts's safeMessage() names as rule 2's whole reason to exist. Every other
 * FIXTURE here carries the SQLSTATE-and-severity pair, so rule 1 withholds the message
 * before rule 2 is ever consulted; the real-connection tests below drive this same branch
 * with a cause produced by a live pool instead of described here.
 *
 * With no code there is nothing to stand in for the message, and the wrapper's message
 * is `Failed query: <sql>` — carrying whatever the statement text inlines.
 */
function codelessDrizzleQueryError(query: string, params: unknown[]): Error {
  const cause = new Error("Connection terminated unexpectedly");
  const e = new Error(`Failed query: ${query}\nparams: ${params}`) as Error &
    Record<string, unknown>;
  e.cause = cause;
  e.query = query;
  e.params = params;
  return e;
}

/**
 * `severity` as a real DatabaseError carries it, and the reason these fixtures set it.
 *
 * MEASURED against a live Postgres 16 through this repo's `pg` 8.22: every error the
 * server sent back arrived with BOTH a 5-character SQLSTATE and a `severity` string —
 * 22P02, 22012 and 42P01 with "ERROR", and the connection-time 28P01 with "FATAL" — at
 * the top level when unwrapped and under `.cause` when drizzle wrapped it. The fixtures
 * below previously set only `code`, which made them look-alikes of a shape production
 * never produces; app.ts isPostgresError() now reads both fields, so that omission would
 * quietly move every fixture off the branch it exists to exercise.
 */
const PG_SEVERITY = "ERROR";

const NUMERIC_6_3 =
  "A field with precision 6, scale 3 must round to an absolute value less than 10^3.";

describe("B-390 client-caused data exceptions answer 4xx (the phone must not wedge)", () => {
  it("a value from the BODY that Postgres refuses → 400 flat VALIDATION", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(
          drizzleQueryError(
            { code: "22003", message: "numeric field overflow", detail: NUMERIC_6_3 },
            ["100000"],
          ),
        ),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/subcon-contracts",
      payload: { periods: [{ basis: "percent", pct: 100000 }] },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("VALIDATION");
    // Still the flat contract Error — a 4xx must not grow a new envelope.
    expect(Object.keys(body).sort()).toEqual(["code", "message"]);
  });

  it("a value from a PATH PARAM that Postgres refuses → 400 (provenance is not body-only)", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(
          drizzleQueryError(
            { code: "22P02", message: 'invalid input syntax for type uuid: "not-a-uuid"' },
            ["not-a-uuid"],
          ),
        ),
      })
    ).inject({ url: "/api/v1/subcon-contracts/not-a-uuid/periods" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");
  });

  it("a SERVER-COMPUTED overflow keeps its 500 — the remap is not a cover-up", async () => {
    // Same SQLSTATE, same handler, same route as the 400 above. The ONLY difference is
    // that the offending value appears nowhere in the request, because the server
    // computed it. If this ever flips to 400, a money bug has been turned into a quiet
    // "you sent something wrong" — which is worse than the wedge B-390 fixed.
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(
          drizzleQueryError(
            {
              code: "22003",
              message: "numeric field overflow",
              detail:
                "A field with precision 16, scale 2 must round to an absolute value less than 10^14.",
            },
            ["999998999999990.00"],
          ),
        ),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/subcon-contracts",
      payload: { periods: [{ basis: "percent", pct: 50 }] },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  });

  it("an ordinary server crash is untouched by the remap", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(new TypeError("Cannot read properties of undefined")),
      })
    ).inject({ url: "/api/v1/subcon-contracts/11111111-1111-1111-1111-111111111111/periods" });
    expect(res.statusCode).toBe(500);
    expect(res.json().code).toBe("INTERNAL_ERROR");
  });
});

// ---------------------------------------------------------------------------
// AUDIT M1 — the error log must not carry the values of the failing statement.
//
// The thing that could go wrong: every request Postgres refuses runs through the same
// two `request.log.error(error)` lines above, and a DrizzleQueryError carries the bound
// parameter list of the statement. Unredacted (measured before the fix) that writes the
// values FOUR times per line — `err.params`, `err.query`, the second line of
// `err.message`, and again in the stack header — into a json-file log on the host's
// disk. These tests read the log the way an operator would: as raw text.
//
// Both halves are asserted together on purpose. Redaction that also erased the SQLSTATE
// would pass a "no values" test while quietly disarming B-390's compensating control
// (db/pg-data-exception.ts: the ERROR-level log, not the 400, is what keeps a
// server-side fault visible), so every case below asserts diagnosis AND silence.
//
// SCOPE — see app.ts's header. These tests cover the ERROR OBJECT and the log call that
// carries it. The REQUEST LINE fastify writes at level 30 (`req.url`, query string
// included) is a separate, uncovered surface; the one test that plants a marker in the
// URL says so where it asserts.
// ---------------------------------------------------------------------------

/**
 * Obviously-fake markers standing in for what really flows through these statements:
 * a national-id-shaped string, a bank account and a distinctive amount. They are
 * planted in the places a real failure carries real ones — so a marker surfacing
 * anywhere in the log text is the real value surfacing in production.
 */
const MARKER_TAX_ID = "1-9999-00000-00-0";
const MARKER_BANK_ACCOUNT = "999-0-99999-9";
const MARKER_AMOUNT = 8675309.42;

/**
 * A statement whose TEXT also inlines a value. Drizzle parameterizes today, so this is
 * the `sql.raw` shape the serializer refuses to trust rather than one it meets now —
 * dropping the query text is what makes that future call site harmless.
 */
const LEAKY_QUERY =
  `insert into "ap_billing" ("vendor_tax_id","bank_account","amount") ` +
  `values ('${MARKER_TAX_ID}', $1, $2)`;

/**
 * A message Postgres itself authored with the offending value quoted inside it —
 * measured shape, per db/pg-data-exception.ts. Nothing but this message carries the
 * value, so a test asserting on the whole log line is the only thing that catches it.
 */
const UUID_SYNTAX_ERROR = `invalid input syntax for type uuid: "${MARKER_TAX_ID}"`;

const NUMERIC_16_2 =
  "A field with precision 16, scale 2 must round to an absolute value less than 10^14.";

/** A pino destination that keeps every line, plus the two readers these tests need. */
function logCapture() {
  const lines: string[] = [];
  return {
    options: { stream: { write: (line: string) => void lines.push(line) } },
    /** Everything written, byte for byte as it would land in the host's log file. */
    text: () => lines.join(""),
    /** The single ERROR-level record (pino level 50). */
    errorRecord: () => {
      const errors = lines
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((record) => record.level === 50);
      expect(errors).toHaveLength(1);
      return errors[0] as Record<string, unknown> & {
        err?: Record<string, unknown>;
        msg?: unknown;
      };
    },
  };
}

/**
 * A TCP port with nothing listening on it — bound to have the OS pick a free one, then
 * released, so "closed" is established rather than assumed of a hard-coded number (this
 * repo has spent two commits this week on CI flakes; a squatted 59999 would be a third).
 */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/**
 * The two shapes a REFUSED CONNECTION really reaches the handler in — produced by a real
 * `pg` Pool and the real `drizzle()`, never hand-rolled:
 *   · raw    — `Error { message: "connect ECONNREFUSED 127.0.0.1:<port>",
 *               code: "ECONNREFUSED", errno, syscall, address, port }`, NO severity.
 *   · wrapped — `DrizzleQueryError { message: "Failed query: select 1\nparams: ",
 *               cause: <that same Error> }`, which is what every statement in this repo
 *               would actually throw, since they all go through drizzle.
 * A fixture is what let the loose test ship: nothing here had ever driven a string `code`
 * that was not a SQLSTATE.
 */
async function realConnectionRefusal(): Promise<{
  address: string;
  raw: Error;
  wrapped: Error;
}> {
  const address = `127.0.0.1:${await closedPort()}`;
  const pool = new Pool({ connectionString: `postgres://u:p@${address}/nodb` });
  const caught: Error[] = [];
  for (const attempt of [
    () => pool.query("select 1"),
    () => drizzle(pool).execute(sql`select 1`),
  ]) {
    let error: unknown;
    try {
      await attempt();
    } catch (e) {
      error = e;
    }
    expect(error, `expected a refused connection on ${address}`).toBeInstanceOf(Error);
    caught.push(error as Error);
  }
  await pool.end();
  return { address, raw: caught[0] as Error, wrapped: caught[1] as Error };
}

/** No marker, and no parameter list, anywhere in what was written. */
function expectNoValuesLeaked(text: string): void {
  for (const marker of [
    MARKER_TAX_ID,
    MARKER_BANK_ACCOUNT,
    String(MARKER_AMOUNT),
  ]) {
    expect(text).not.toContain(marker);
  }
  // Neither the `params` key nor drizzle's `params: <values>` message line survives.
  expect(text).not.toContain("params");
  expect(text).not.toContain("ap_billing");
}

describe("audit M1 — a refused statement must not log its values", () => {
  it("the 500 path keeps the SQLSTATE and drops every bound value", async () => {
    const capture = logCapture();
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(
          drizzleQueryError(
            { code: "22003", message: "numeric field overflow", detail: NUMERIC_16_2 },
            [MARKER_BANK_ACCOUNT, String(MARKER_AMOUNT)],
            LEAKY_QUERY,
          ),
        ),
        logger: capture.options,
      })
    ).inject({
      url: "/api/v1/subcon-contracts/11111111-1111-1111-1111-111111111111/periods",
    });

    // The response is untouched by this change — still the flat contract Error.
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });

    // The values are gone — asserted FIRST so a revert dies here, on the defect
    // itself, rather than on the diagnosis assertions below.
    const record = capture.errorRecord();
    expect(record.err).not.toHaveProperty("params");
    expect(record.err).not.toHaveProperty("query");
    expectNoValuesLeaked(capture.text());

    // Diagnosis survives: SQLSTATE, the threshold detail B-390 reads, and the frames
    // that name the route which issued the statement.
    expect(record.err?.code).toBe("22003");
    expect(record.err?.detail).toBe(NUMERIC_16_2);
    expect(String(record.err?.stack)).toContain("    at ");
  });

  it("the B-390 400 remap still logs at ERROR — the compensating control survives", async () => {
    // Same handler, same serializer, but the answer is a 400. db/pg-data-exception.ts
    // states that the loud log is what keeps a MISJUDGED remap visible, so silencing
    // this line would break B-390 without breaking any of its own tests.
    const capture = logCapture();
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(
          drizzleQueryError(
            { code: "22003", message: "numeric field overflow", detail: NUMERIC_6_3 },
            [MARKER_BANK_ACCOUNT, String(MARKER_AMOUNT)],
            LEAKY_QUERY,
          ),
        ),
        logger: capture.options,
      })
    ).inject({
      method: "POST",
      url: "/api/v1/subcon-contracts",
      payload: { periods: [{ basis: "amount", amount: MARKER_AMOUNT }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");

    const record = capture.errorRecord();
    expectNoValuesLeaked(capture.text());
    expect(record.err?.code).toBe("22003");
    // The client's own value may be echoed to the CLIENT that sent it; it still must
    // not be written to the host's disk.
    expect(res.json().message).toContain(String(MARKER_AMOUNT));
  });

  it("an UNWRAPPED pg DatabaseError is redacted too — the guard is provenance, not prefix", async () => {
    // The measured hole in the first fix: it redacted a message by matching drizzle's
    // `Failed query:` prefix, so a DatabaseError that reaches the handler WITHOUT the
    // wrapper — real pg class, SQLSTATE on the top-level `.code`, which is the case
    // app.ts pgFields() checks FIRST — sailed straight through. 22P02/22007/22008/22023
    // quote the offending VALUE inside the message (db/pg-data-exception.ts), so that
    // value landed in `err.message` and again in the line's top-level `msg`.
    const capture = logCapture();
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(unwrappedDatabaseError("22P02", UUID_SYNTAX_ERROR)),
        logger: capture.options,
      })
    ).inject({
      url: "/api/v1/subcon-contracts/11111111-1111-1111-1111-111111111111/periods",
    });

    // The offending value is not in the request (the path carries a well-formed uuid),
    // so B-390 cannot attribute it to the caller and it keeps its loud 500.
    expect(res.statusCode).toBe(500);

    // Read as an operator reads it: the whole line, every field, not just `err`.
    expectNoValuesLeaked(capture.text());
    // Diagnosis survives — the SQLSTATE is still there, and still on the record.
    expect(capture.text()).toContain("22P02");
    const record = capture.errorRecord();
    expect(record.err?.code).toBe("22P02");
    expect(String(record.err?.stack)).toContain("    at ");
  });

  it("`{ err }` with NO message argument does not promote the raw message to `msg`", async () => {
    // ROUND-2 LEAK, and the reason a merge object was never safe merely for being one:
    // pino's write() takes `msg` from `_obj[errorKey].message` off the RAW error BEFORE
    // any serializer runs — the same promotion the single-argument branch exists to
    // stop, reached through the `err` key instead of past it. Measured on the
    // unredacted hook: `"msg":"invalid input syntax for type uuid: \"<marker>\""`.
    // Live shape, not hypothetical: routes/notify.ts:220 already logs `{ err, event }`.
    const capture = logCapture();
    const built = await buildTestApp({ logger: capture.options });
    built.log.error({
      err: unwrappedDatabaseError("22P02", UUID_SYNTAX_ERROR),
      event: "subcon.period.write",
    });

    expect(capture.text()).not.toContain(MARKER_TAX_ID);
    const record = capture.errorRecord();
    expect(String(record.msg)).not.toContain(MARKER_TAX_ID);
    // Diagnosis survives at the TOP level too — the withheld message names the SQLSTATE.
    expect(String(record.msg)).toContain("22P02");
    expect(record.err?.code).toBe("22P02");
    // Redaction is on the error, not on the line: the caller's other keys are untouched.
    expect(record.event).toBe("subcon.period.write");
  });

  it("`{ err }` with no message: a drizzle error's `Failed query … params` is not promoted", async () => {
    // The worse half of the same hole. For a DrizzleQueryError the promoted message is
    // the STATEMENT AND ITS PARAMETERS in one string — measured verbatim as
    // `Failed query: <sql>\nparams: <values>` at the line's top level, i.e. OUTSIDE
    // `err`, where the serializer that strips `.query`/`.params` cannot reach it.
    const capture = logCapture();
    const built = await buildTestApp({ logger: capture.options });
    built.log.error({
      err: drizzleQueryError(
        { code: "22003", message: "numeric field overflow", detail: NUMERIC_16_2 },
        [MARKER_BANK_ACCOUNT, String(MARKER_AMOUNT)],
        LEAKY_QUERY,
      ),
    });

    expectNoValuesLeaked(capture.text());
    expect(capture.text()).toContain("22003");
  });

  it("`{ err }` with no message does NOT degrade the error's type (one rule per key)", async () => {
    // The division of labour that fix could have broken: the hook derives only the
    // MESSAGE from `err` and leaves the object itself to the serializer. Running
    // redactErrorValues() over it here as well would feed the serializer its own output,
    // whose `name` is gone — and a TypeError would be logged as "Error".
    const capture = logCapture();
    const built = await buildTestApp({ logger: capture.options });
    built.log.error({ err: new TypeError("Cannot read properties of undefined") });

    const record = capture.errorRecord();
    expect(record.err?.type).toBe("TypeError");
    expect(record.msg).toBe("Cannot read properties of undefined");
  });

  it("`{ err }` with an UNDEFINED message argument is the same leak — the guard is not arity", async () => {
    // ROUND-3, and the measured reason a LENGTH check was never pino's condition. The
    // hook guarded `rest.length === 0`; pino's write() guards `msg === undefined`. They
    // differ by exactly one arity, and one arity is all a real call site needs:
    // `log.error({ err }, maybeMsg)` where `maybeMsg` is an optional nobody set passes
    // TWO arguments, so the length check skipped the fix — then pino's LOG() shifted that
    // `undefined` out as the message and write() promoted the RAW `err.message` exactly
    // as if the argument had been absent. Measured on the length-guarded hook: level 50,
    // marker present, `"msg":"invalid input syntax for type uuid: \"<marker>\""`.
    const capture = logCapture();
    const built = await buildTestApp({ logger: capture.options });
    // Typed as the caller's own optional would be — the point is the ARITY, so the call
    // below must pass two arguments, not one.
    const maybeMsg: string | undefined = undefined;
    built.log.error(
      {
        err: unwrappedDatabaseError("22P02", UUID_SYNTAX_ERROR),
        event: "subcon.period.write",
      },
      maybeMsg,
    );

    expect(capture.text()).not.toContain(MARKER_TAX_ID);
    const record = capture.errorRecord();
    expect(String(record.msg)).not.toContain(MARKER_TAX_ID);
    // Diagnosis survives, and so does the caller's own key.
    expect(String(record.msg)).toContain("22P02");
    expect(record.err?.code).toBe("22P02");
    expect(record.event).toBe("subcon.period.write");
  });

  it("a RAW error with an undefined message argument leaks the same way (one gap, two branches)", async () => {
    // The arity gap is in BOTH branches of the hook, because pino promotes in both:
    // write() takes `msg` from `_obj.message` when the first argument IS the error, and
    // from `_obj[errorKey].message` when it is a merge object. `log.error(err, maybeMsg)`
    // is the same one-word distance from `log.error(err)` as the case above.
    const capture = logCapture();
    const built = await buildTestApp({ logger: capture.options });
    const maybeMsg: string | undefined = undefined;
    built.log.error(unwrappedDatabaseError("22P02", UUID_SYNTAX_ERROR), maybeMsg);

    expect(capture.text()).not.toContain(MARKER_TAX_ID);
    const record = capture.errorRecord();
    expect(String(record.msg)).not.toContain(MARKER_TAX_ID);
    expect(String(record.msg)).toContain("22P02");
    expect(record.err?.code).toBe("22P02");
  });

  it("a drizzle wrapper with NO SQLSTATE still loses its statement — safeMessage rule 2", async () => {
    // The second control this file did not have: mutating rule 2 to `return firstLine`
    // left the whole suite GREEN, because every other error driven here carries a code
    // and is withheld by rule 1 before rule 2 is consulted. The case rule 2 exists for is
    // the one app.ts documents as still reachable — a statement that failed for a reason
    // Postgres never got to report, so `.cause` has no SQLSTATE — and there the wrapper's
    // `Failed query: <sql>` IS the message, promoted to the line's top-level `msg`.
    // Measured under that mutation: level 50 with the table name and the marker in `msg`.
    const capture = logCapture();
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(
          codelessDrizzleQueryError(LEAKY_QUERY, [
            MARKER_BANK_ACCOUNT,
            String(MARKER_AMOUNT),
          ]),
        ),
        logger: capture.options,
      })
    ).inject({
      url: "/api/v1/subcon-contracts/11111111-1111-1111-1111-111111111111/periods",
    });

    // No SQLSTATE means B-390 cannot attribute the failure to the caller: the 500 stands.
    expect(res.statusCode).toBe(500);
    expectNoValuesLeaked(capture.text());

    // What an operator keeps: that a STATEMENT failed rather than application code, and
    // the frames naming the route that issued it. NOT the cause's own line — a round that
    // appended it is what this assertion now pins shut (see the circular-reference
    // regression below for the value that reached disk through it).
    const record = capture.errorRecord();
    expect(record.msg).toBe("Failed query: [redacted]");
    expect(record.err?.message).toBe("Failed query: [redacted]");
    // THE DOCUMENTED COST, asserted so it cannot be quietly re-widened: the reason the
    // statement failed is NOT in the line. "Connection terminated unexpectedly" lives
    // only on `.cause`, and nothing copies it.
    expect(capture.text()).not.toContain("Connection terminated");
    expect(capture.text()).not.toContain("cause");
    expect(String(record.err?.stack)).toContain("    at ");
  });

  it("a REAL refused connection keeps its address and claims no SQLSTATE", async () => {
    // THE ROUND-3 DEFECT, driven end to end. pgFields() decided provenance with
    // `typeof code === "string"` — "has a string code", not "carries a SQLSTATE" — and
    // that was the DECIDING test for withholding a message. So the single most common
    // production outage was logged as
    // `Postgres refused this statement; message withheld (SQLSTATE ECONNREFUSED)`:
    // a sentence that is false (Postgres never saw a statement) and that deleted the
    // host:port. BLOCKERS.md B-033 was diagnosed from exactly that address, and
    // `ETIMEDOUT`/`FST_ERR_VALIDATION` measured the same way. No test drove a non-
    // SQLSTATE string code, which is why it shipped — so this one produces the error
    // rather than describing it.
    const { address, raw } = await realConnectionRefusal();
    // The shape, asserted before it is driven: a plain Error, a 12-character `code`
    // where a SQLSTATE is 5, and no `severity` — the pair app.ts now requires.
    expect(raw.message).toBe(`connect ECONNREFUSED ${address}`);
    expect((raw as Error & { code?: unknown }).code).toBe("ECONNREFUSED");
    expect((raw as Error & { severity?: unknown }).severity).toBeUndefined();

    const capture = logCapture();
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(raw),
        logger: capture.options,
      })
    ).inject({
      url: "/api/v1/subcon-contracts/11111111-1111-1111-1111-111111111111/periods",
    });

    // Not attributable to the caller (nothing about the request caused it): 500 stands.
    expect(res.statusCode).toBe(500);

    const record = capture.errorRecord();
    // The address SURVIVES — in the serialized error and in the promoted `msg`.
    expect(record.err?.message).toBe(`connect ECONNREFUSED ${address}`);
    expect(String(record.msg)).toContain(address);
    // …and the line does not claim a SQLSTATE, or a refusal Postgres never made.
    expect(capture.text()).not.toContain("SQLSTATE");
    expect(capture.text()).not.toContain("Postgres refused");
    // `code` is where this file reads SQLSTATEs everywhere else, so a Node errno left
    // there would read as one.
    expect(record.err).not.toHaveProperty("code");
  });

  it("the SAME refusal WRAPPED by drizzle LOSES the address — the documented cost", async () => {
    // The realistic shape, since every statement here goes through drizzle: the wrapper's
    // own message is `Failed query: <sql>\nparams: <values>`, so it is redacted to the
    // prefix and NOTHING is appended. The address survives nowhere in the record — the
    // cause is not copied by the allowlist, and safeStack() drops the `caused by:` header
    // along with the rest of the header line.
    //
    // THIS IS A REGRESSION IN DIAGNOSABILITY AND IT IS DELIBERATE. A round that appended
    // the cause's first line to recover this address had to decide which causes were safe
    // to echo, and the only available test was "does it look like Postgres?" — a denylist,
    // at the one point a value can reach disk, which measurably leaked (see the
    // circular-reference regression below). Recovering the address belongs in a follow-up
    // that logs the CONFIGURED database host from the app's own config, which is a value
    // this process owns and never has to trust.
    const { address, wrapped } = await realConnectionRefusal();
    const cause = (wrapped as Error & { cause?: Record<string, unknown> }).cause;
    expect(wrapped.message).toContain("Failed query:");
    expect(cause?.code).toBe("ECONNREFUSED");
    expect(cause?.severity).toBeUndefined();

    const capture = logCapture();
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(wrapped),
        logger: capture.options,
      })
    ).inject({
      url: "/api/v1/subcon-contracts/11111111-1111-1111-1111-111111111111/periods",
    });

    expect(res.statusCode).toBe(500);

    const record = capture.errorRecord();
    expect(record.err?.message).toBe("Failed query: [redacted]");
    expect(record.msg).toBe("Failed query: [redacted]");
    // THE COST, pinned: the host:port is nowhere in the line — not in `msg`, not in the
    // serialized error, not in the frames. Re-adding an echo makes this assertion fail.
    expect(capture.text()).not.toContain(address);
    expect(capture.text()).not.toContain("ECONNREFUSED");
    expect(capture.text()).not.toContain("SQLSTATE");
    // What is NOT relaxed to buy that: the statement text and the parameter list are as
    // gone as they were before, and the frames still name the route.
    expect(capture.text()).not.toContain("select 1");
    expect(capture.text()).not.toContain("params");
    expect(String(record.err?.stack)).toContain("    at ");
  });

  it("the withholding boundary IS `severity`: pg-shaped keeps its message, REAL pg loses it", async () => {
    // THE PAIR, in one test, because neither half means anything alone. isPostgresError()
    // is the ONE test that decides whether a message survives; an earlier round put a
    // looser net under it ("any pg fingerprint → withhold") and that net was removed
    // because it fired on ordinary application errors — measured, `severity: "medium"` on
    // a defect error, and `severity` is a real column in this schema.
    //
    // HALF ONE — pg-SHAPED but not provably pg (SQLSTATE-shaped code, NO severity):
    // the message is now KEPT. This is the accepted cost of deleting that net, and it is
    // asserted rather than described: if a real DatabaseError ever reaches this handler
    // with `severity` stripped, the literal Postgres quoted into its message is logged.
    const shaped = new DatabaseError(
      UUID_SYNTAX_ERROR,
      UUID_SYNTAX_ERROR.length,
      "error",
    );
    shaped.code = "22P02";

    const shapedCapture = logCapture();
    const shapedRes = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(shaped),
        logger: shapedCapture.options,
      })
    ).inject({
      url: "/api/v1/subcon-contracts/11111111-1111-1111-1111-111111111111/periods",
    });

    expect(shapedRes.statusCode).toBe(500);
    const shapedRecord = shapedCapture.errorRecord();
    expect(shapedRecord.msg).toBe(UUID_SYNTAX_ERROR);
    expect(shapedRecord.err?.message).toBe(UUID_SYNTAX_ERROR);
    // No SQLSTATE was established, so none is claimed and `code` is not lifted.
    expect(shapedCapture.text()).not.toContain("SQLSTATE");
    expect(shapedRecord.err).not.toHaveProperty("code");

    // HALF TWO — the SAME message off a REAL server-sent error (the SQLSTATE-and-severity
    // pair every DatabaseError measured off a live Postgres 16 carries). Withheld, and the
    // SQLSTATE stands in for it. This is what makes half one a BOUNDARY and not a hole:
    // deleting the `severity` conjunct from isPostgresError() makes half one pass while
    // this half dies, and vice versa.
    const realCapture = logCapture();
    const realRes = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(unwrappedDatabaseError("22P02", UUID_SYNTAX_ERROR)),
        logger: realCapture.options,
      })
    ).inject({
      url: "/api/v1/subcon-contracts/11111111-1111-1111-1111-111111111111/periods",
    });

    expect(realRes.statusCode).toBe(500);
    expectNoValuesLeaked(realCapture.text());
    const realRecord = realCapture.errorRecord();
    expect(realRecord.msg).toBe(
      "Postgres refused this statement; message withheld (SQLSTATE 22P02)",
    );
    expect(realRecord.err?.code).toBe("22P02");
  });

  it("the printed SQLSTATE is only ever a SQLSTATE-SHAPED code (the other half of the pair)", async () => {
    // Found by mutation, not by reading: dropping the SHAPE half of isPostgresError() and
    // keeping only `severity` left all 42 tests green, because no shape measured off a
    // live server separates the two conjuncts. They do different jobs, so each needs its
    // own test — `severity` establishes PROVENANCE, the shape keeps the printed sentence
    // TRUE, and printing `(SQLSTATE ECONNREFUSED)` is exactly the falsehood this rework
    // exists to delete.
    //
    // THIS INPUT IS CONSTRUCTED, and says so: it pins a property of the LINE ("the token
    // SQLSTATE is followed only by something SQLSTATE-shaped"), not a shape measured in
    // production. Every other error in this block is produced rather than described.
    const fingerprinted = new Error(UUID_SYNTAX_ERROR) as Error & Record<string, unknown>;
    fingerprinted.severity = PG_SEVERITY;
    fingerprinted.code = "ECONNREFUSED";

    const capture = logCapture();
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(fingerprinted),
        logger: capture.options,
      })
    ).inject({
      url: "/api/v1/subcon-contracts/11111111-1111-1111-1111-111111111111/periods",
    });

    expect(res.statusCode).toBe(500);
    // Nothing is announced as a SQLSTATE that could not be one — the shape conjunct is
    // what refuses `ECONNREFUSED` here, and dropping it prints `(SQLSTATE ECONNREFUSED)`.
    expect(capture.text()).not.toContain("SQLSTATE");
    expect(capture.text()).not.toContain("Postgres refused");
    // And with the "any fingerprint → withhold" net gone, a `severity` alone no longer
    // suppresses the message: it is kept verbatim. Same cost as the boundary test above,
    // stated here too because this fixture is exactly the ambiguous shape.
    expect(capture.errorRecord().msg).toBe(UUID_SYNTAX_ERROR);
  });

  it("rule 2 echoes NO cause at all — not even one that looks safe", async () => {
    // Was: "does not echo a cause that MIGHT be Postgres-authored", guarding an echo that
    // no longer exists. Kept and inverted rather than deleted, because the input is still
    // the sharpest one available — a cause that IS from Postgres but misses
    // isPostgresError() (no `severity`), INSIDE drizzle's wrapper, so rule 1 does not fire
    // and rule 2 is what answers. Postgres quoted the offending value into that message.
    const cause = new DatabaseError(
      UUID_SYNTAX_ERROR,
      UUID_SYNTAX_ERROR.length,
      "error",
    ) as Error & Record<string, unknown>;
    cause.code = "22P02";
    const wrapped = new Error(
      `Failed query: ${LEAKY_QUERY}\nparams: ${MARKER_BANK_ACCOUNT}`,
    ) as Error & Record<string, unknown>;
    wrapped.cause = cause;

    const capture = logCapture();
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(wrapped),
        logger: capture.options,
      })
    ).inject({
      url: "/api/v1/subcon-contracts/11111111-1111-1111-1111-111111111111/periods",
    });

    expect(res.statusCode).toBe(500);
    expectNoValuesLeaked(capture.text());
    const record = capture.errorRecord();
    expect(record.msg).toBe("Failed query: [redacted]");
    expect(capture.text()).not.toContain("SQLSTATE");
  });

  it("a cause that INTERPOLATES a value never reaches the log — the measured echo leak", async () => {
    // THE REGRESSION TEST FOR WHAT THE CAUSE ECHO ACTUALLY LEAKED, produced by the real
    // driver rather than described. `pg`'s own prepareValue (pg/lib/utils.js) builds this
    // message when a bound parameter's `toPostgres()` cycles, and it puts THE PARAMETER'S
    // OWN VALUE in the sentence:
    //   `circular reference detected while preparing "1-9999-00000-00-0" for query`
    // It is a plain Error with NO pg fingerprint — no `severity`, no SQLSTATE-shaped
    // `code`, none of the identifier fields — so every "does this look like Postgres?"
    // guard passes it through. Measured end to end on the shipped handler, the echo wrote
    //   `Failed query: [redacted] (cause: circular reference detected while preparing
    //    "1-9999-00000-00-0" for query)`
    // and the marker reached disk. That is why the echo is gone and why the replacement
    // is not a better filter: the filter WAS the defect, twice over.
    // `prepareValue` is real and reachable (`pg.utils`), but absent from @types/pg, so
    // the shape is asserted here rather than imported.
    const { prepareValue } = (
      pgDriver as unknown as { utils: { prepareValue(v: unknown): unknown } }
    ).utils;
    const circular = { toPostgres: () => circular, toString: () => MARKER_TAX_ID };
    let causeFromDriver: unknown;
    try {
      prepareValue(circular);
    } catch (e) {
      causeFromDriver = e;
    }
    // The shape, asserted before it is driven — the marker really is in the message, and
    // the object really does look like ordinary application code.
    expect((causeFromDriver as Error).message).toContain(MARKER_TAX_ID);
    expect(causeFromDriver as Record<string, unknown>).not.toHaveProperty("severity");
    expect((causeFromDriver as Record<string, unknown>).code).toBeUndefined();

    const wrapped = new Error(
      `Failed query: ${LEAKY_QUERY}\nparams: ${MARKER_BANK_ACCOUNT}`,
    ) as Error & Record<string, unknown>;
    wrapped.cause = causeFromDriver;

    const capture = logCapture();
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(wrapped),
        logger: capture.options,
      })
    ).inject({
      url: "/api/v1/subcon-contracts/11111111-1111-1111-1111-111111111111/periods",
    });

    expect(res.statusCode).toBe(500);
    expectNoValuesLeaked(capture.text());
    expect(capture.text()).not.toContain("circular reference");
    expect(capture.errorRecord().msg).toBe("Failed query: [redacted]");
  });

  it("a DUAL-STACK host refusal is an AggregateError — what lands, stated exactly", async () => {
    // THE SHAPE THIS REPO'S OWN DEFAULT PRODUCES, and the one no round had driven.
    // `.env.example` and packages/db/drizzle.config.ts both point at `localhost`, which
    // resolves to BOTH ::1 and 127.0.0.1, so Node tries both and throws an
    // `AggregateError` rather than the single socket Error the 127.0.0.1 tests drive:
    //   AggregateError { message: "", code: "ECONNREFUSED", errors: [Error, Error] }
    // Its `message` is EMPTY and the addresses live in `.errors[]`, which the allowlist
    // does not copy. With no rule left that inspects pg-ish fields, it is simply a
    // non-pg error and takes the verbatim path — of an empty string.
    //
    // WHAT THAT COSTS, asserted rather than claimed: the log line carries the stack frames
    // and nothing else. Not the address, and not even the `ECONNREFUSED` code — the
    // serializer lifts `code` only off a proven pg error, so a Node errno is dropped with
    // the rest. Connection-failure diagnosis is DEGRADED versus HEAD. Recovering it is a
    // follow-up that logs the CONFIGURED host from the app's own config, not a wider
    // allowlist here.
    const port = await closedPort();
    const pool = new Pool({ connectionString: `postgres://u:p@localhost:${port}/nodb` });
    let refusal: unknown;
    try {
      await pool.query("select 1");
    } catch (e) {
      refusal = e;
    }
    await pool.end().catch(() => undefined);

    // The shape, produced rather than hand-rolled.
    expect(refusal).toBeInstanceOf(AggregateError);
    expect((refusal as Error).message).toBe("");
    expect((refusal as Record<string, unknown>).code).toBe("ECONNREFUSED");
    expect((refusal as AggregateError).errors.length).toBeGreaterThan(1);

    const capture = logCapture();
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(refusal),
        logger: capture.options,
      })
    ).inject({
      url: "/api/v1/subcon-contracts/11111111-1111-1111-1111-111111111111/periods",
    });

    expect(res.statusCode).toBe(500);

    const record = capture.errorRecord();
    // What survives: the class name and the frames that name the route.
    expect(record.err?.type).toBe("AggregateError");
    expect(String(record.err?.stack)).toContain("    at ");
    // What does NOT: the message is empty, the addresses are gone, the errno is gone.
    expect(record.err?.message).toBe("");
    expect(capture.text()).not.toContain(String(port));
    expect(capture.text()).not.toContain("ECONNREFUSED");
    expect(record.err).not.toHaveProperty("errors");
    expect(record.err).not.toHaveProperty("code");
    // …and no SQLSTATE is invented for a connection Postgres never answered.
    expect(capture.text()).not.toContain("SQLSTATE");
  });

  it("a 23505 `detail` is withheld — the class-22 allowlist is enforced, not just commented", async () => {
    // The control this file previously did not test at all: widening isDataExceptionCode()
    // to accept EVERY SQLSTATE class left the whole suite green. Postgres puts the
    // COLLIDING VALUE in a 23505 detail — `Key (vendor_tax_id)=(<value>) already
    // exists.` — and B-165/B-167 made duplicate-key collisions an ORDINARY outcome of
    // the idempotency keys on the money paths, so this is a routine day's log line.
    const capture = logCapture();
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(
          duplicateKeyError(`Key (vendor_tax_id)=(${MARKER_TAX_ID}) already exists.`),
        ),
        logger: capture.options,
      })
    ).inject({
      url: "/api/v1/subcon-contracts/11111111-1111-1111-1111-111111111111/periods",
    });

    // Class 23 is not in PG_CLIENT_INPUT_CODES, so B-390 leaves the loud 500 alone —
    // this test is purely about what reaches the host's disk.
    expect(res.statusCode).toBe(500);

    const record = capture.errorRecord();
    expect(record.err).not.toHaveProperty("detail");
    expect(capture.text()).not.toContain(MARKER_TAX_ID);
    // …while every field an operator actually diagnoses a unique violation from stays.
    expect(capture.text()).toContain("23505");
    expect(record.err?.code).toBe("23505");
    expect(record.err?.constraint).toBe("vendor_tax_id_unique");
    expect(record.err?.table).toBe("vendor");
  });

  it("the flagship B-390 case — a bad uuid in the PATH leaves no trace in the error record", async () => {
    // Every other test here injects a WELL-FORMED uuid, so none of them exercises the
    // case B-390 was written for: the offending value IS the path param.
    //
    // ASSERTED ON THE LEVEL-50 RECORD ONLY, deliberately — see app.ts's header. Fastify's
    // own default `req` serializer writes {"level":30,"req":{…,"url":"…/<value>/…"}} one
    // line ABOVE this one, before any handler runs, and no error-path redaction can
    // reach it. Asserting on capture.text() here would fail today; asserting that the
    // level-30 line DOES carry it would pin the leak in place and block the `req`
    // serializer that closes it. The record assertion still dies the moment the
    // redaction under test regresses.
    const capture = logCapture();
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(
          drizzleQueryError({ code: "22P02", message: UUID_SYNTAX_ERROR }, [
            MARKER_TAX_ID,
          ]),
        ),
        logger: capture.options,
      })
    ).inject({ url: `/api/v1/subcon-contracts/${MARKER_TAX_ID}/periods` });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION");

    const record = capture.errorRecord();
    expect(JSON.stringify(record)).not.toContain(MARKER_TAX_ID);
    expect(record.err?.code).toBe("22P02");
  });

  it("an error logged under a key that is NOT `err` is redacted (the guard is the value)", async () => {
    // A pino serializer is registered per KEY, so it guards only the spellings someone
    // listed. Measured: with `err` serialized, `{ error: e }` still wrote the whole
    // `{query, params, cause}`. Five sites already spell it `error` (routes/admin.ts,
    // routes/auth.ts ×2, routes/users.ts ×2); each passes only `(err as {name?})?.name`
    // today, so this is the one-word edit at any of them that must stay harmless.
    const capture = logCapture();
    const app = await buildTestApp({ logger: capture.options });
    app.log.error(
      {
        kind: "invite",
        error: drizzleQueryError(
          { code: "22003", message: "numeric field overflow", detail: NUMERIC_16_2 },
          [MARKER_BANK_ACCOUNT, String(MARKER_AMOUNT)],
          LEAKY_QUERY,
        ),
      },
      "invite delivery failed",
    );

    expectNoValuesLeaked(capture.text());
    expect(capture.text()).toContain("22003");
    // The unrelated keys of the same call are untouched — this redacts errors, not lines.
    expect(capture.errorRecord().kind).toBe("invite");
  });

  it("the same holds under a key nobody listed — a key allowlist would not have", async () => {
    // The reason app.ts tests `instanceof Error` instead of adding `error` to the
    // serializer list: `failure` is a name no one enumerated, and it must still be safe.
    const capture = logCapture();
    const app = await buildTestApp({ logger: capture.options });
    app.log.error(
      {
        failure: drizzleQueryError(
          { code: "22003", message: "numeric field overflow", detail: NUMERIC_16_2 },
          [MARKER_BANK_ACCOUNT, String(MARKER_AMOUNT)],
          LEAKY_QUERY,
        ),
      },
      "subcontract period write failed",
    );

    expectNoValuesLeaked(capture.text());
    expect(capture.text()).toContain("22003");
  });

  it("an ordinary crash still logs its message and frames (redaction is not a blackout)", async () => {
    const capture = logCapture();
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: throwingDb(new TypeError("Cannot read properties of undefined")),
        logger: capture.options,
      })
    ).inject({
      url: "/api/v1/subcon-contracts/11111111-1111-1111-1111-111111111111/periods",
    });
    const record = capture.errorRecord();
    expect(record.err?.type).toBe("TypeError");
    expect(record.err?.message).toBe("Cannot read properties of undefined");
    expect(String(record.err?.stack)).toContain("    at ");
  });
});

describe("GET /api/v1/me", () => {
  it("answers the Me shape from seed-backed rows", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: fullDb(),
      })
    ).inject({ url: "/api/v1/me" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      user: {
        id: "u-0",
        email: "somchai@rungrueang.co.th",
        name: "สมชาย วัฒนกุล",
        role_id: "r-pm",
        status: "active",
      },
      role: {
        id: "r-pm",
        name: "Project Manager",
        perms: { dashboard: { view: true } },
      },
      approval_limits: { default: 1_000_000 },
      package: {
        id: "pkg-m",
        size: "M",
        name: "Professional",
        menus: ["boq", "proc", "petty"],
        limits: { projects: 10, users: 25, storage_gb: 100, ai_per_month: 50 },
        sub_rules: { "boq.aiqto": "M" },
        ai_used: 7,
      },
    });
  });

  it("binds company_id on EVERY tenant-table query it makes", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: fullDb(captured),
      })
    ).inject({ url: "/api/v1/me" });

    // users, roles, subscriptions, ai_usage are tenant-owned: each captured
    // WHERE must carry the tenant as a bound param (TenantDb injects it).
    for (const table of [users, roles, subscriptions, aiUsage]) {
      const calls = capturedFor(captured, table);
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(paramsOf(call.where)).toContain(COMPANY);
      }
    }
    // packages is a platform-global reference table — resolved by the
    // tenant's own package_id, never enumerated by company (it has none).
    const pkgCalls = capturedFor(captured, packages);
    expect(pkgCalls.length).toBe(1);
    expect(paramsOf(pkgCalls[0]?.where)).toEqual(["pkg-m"]);
  });

  it("fails closed 401 when the session user has no dictionary row", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([[users, []]]),
      })
    ).inject({ url: "/api/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "No user record for this session in the tenant",
    });
  });
});

describe("GET /api/v1/projects", () => {
  it("answers the Project rows (B-014 envelope) with the project_type KEY", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: fullDb(),
      })
    ).inject({ url: "/api/v1/projects" });

    expect(res.statusCode).toBe(200);
    // B-014: the list is wrapped in the paginated envelope. One row is returned
    // as a single full page (page_size = max(rows, DEFAULT_PAGE_SIZE) = 50).
    expect(res.json()).toEqual({
      data: [
        {
          id: "pj-rjp",
          name: "juneflow พาร์ค ราชพฤกษ์",
          type: "realestate",
          budget: 50_000_000,
          currency_code: "THB",
          status: "active",
          // B-041(ก+) ProjectSwitcher extensions
          short: "RJP",
          color: "#0B2A4A",
          company_id: COMPANY,
          units: 3,
          phases: [
            {
              id: "n-p1",
              name: "เฟส 2 · Block B+C (ทาวน์โฮม)",
              // 3 unit descendants THROUGH the block node; 2 of 3 sales units
              // are sold/soldBuilt → round(100 × 2/3) = 67.
              units: 3,
              sold_pct: 67,
              sale_status: null,
            },
          ],
        },
      ],
      page: 1,
      page_size: 50,
      total: 1,
    });
  });

  it("scopes the project, node and sales-unit queries by company_id", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: fullDb(captured),
      })
    ).inject({ url: "/api/v1/projects" });

    const projectCalls = capturedFor(captured, projects);
    expect(projectCalls.length).toBe(1);
    expect(paramsOf(projectCalls[0]?.where)).toContain(COMPANY);
    // project_node has no company_id — scoped THROUGH project (selectThrough).
    const nodeCalls = capturedFor(captured, projectNodes);
    expect(nodeCalls.length).toBe(1);
    expect(paramsOf(nodeCalls[0]?.where)).toContain(COMPANY);
    // sales_unit is company-scoped directly.
    const saleCalls = capturedFor(captured, salesUnits);
    expect(saleCalls.length).toBe(1);
    expect(paramsOf(saleCalls[0]?.where)).toContain(COMPANY);
    // project_type is a hybrid table (B-065): read once through the
    // selectGlobalOrOwned door (global defaults + this tenant's own types).
    expect(capturedFor(captured, projectTypes).length).toBe(1);
  });
});

describe("POST /api/v1/auth/login", () => {
  const signedIn = {
    token: "tok-1",
    companyId: COMPANY,
    user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย วัฒนกุล" },
  };

  it("answers AuthLoginResult {token,user,company,package} on success", async () => {
    const res = await (
      await buildTestApp({ signIn: async () => signedIn, db: fullDb() })
    ).inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: "somchai@rungrueang.co.th", password: "pw" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.token).toBe("tok-1");
    expect(body.user).toEqual({
      id: "u-0",
      email: "somchai@rungrueang.co.th",
      name: "สมชาย วัฒนกุล",
      role_id: "r-pm",
      status: "active",
    });
    expect(body.company).toMatchObject({
      id: COMPANY,
      name: "บจก. รุ่งเรืองก่อสร้าง",
    });
    expect(body.package).toMatchObject({ id: "pkg-m", ai_used: 7 });
  });

  it("rejects bad credentials with 401 flat INVALID_CREDENTIALS", async () => {
    const res = await (
      await buildTestApp({ signIn: async () => null })
    ).inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: "nobody@example.test", password: "wrong" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
    });
  });

  it("rejects missing fields with 401 without calling the signIn seam", async () => {
    let called = false;
    const res = await (
      await buildTestApp({
        signIn: async () => {
          called = true;
          return null;
        },
      })
    ).inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: "somchai@rungrueang.co.th" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("INVALID_CREDENTIALS");
    expect(called).toBe(false);
  });

  it("fails closed when the account has no tenant binding", async () => {
    const res = await (
      await buildTestApp({
        signIn: async () => ({ ...signedIn, companyId: null }),
      })
    ).inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: "somchai@rungrueang.co.th", password: "pw" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      code: "UNAUTHENTICATED",
      message: "Account has no tenant binding",
    });
  });
});

describe("POST /api/v1/auth/login — brute-force throttle (B-082 F4 · B-099 · B-100)", () => {
  it("429s after too many attempts against ONE account (per-user cap) with the flat RATE_LIMITED error", async () => {
    const built = await buildTestApp({ signIn: async () => null });
    let last;
    // 11 attempts against the SAME account trip the per-user cap (10) on the 11th.
    for (let i = 0; i < 11; i++) {
      last = await built.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: "spray@example.test", password: "guess" },
      });
    }
    expect(last!.statusCode).toBe(429);
    expect(last!.json()).toEqual({
      code: "RATE_LIMITED",
      message: "Too many login attempts, please try again later",
    });
    expect(last!.headers["retry-after"]).toBe("60");
  });

  it("B-099: distinct accounts behind one office IP are NOT blocked by the per-user cap", async () => {
    // The motivating regression (orch-B finance-E2E): several approvers share one
    // office NAT egress IP and each logs in a few times. The primary cap keys on the
    // ACCOUNT, so 11 DISTINCT accounts from one IP each stay at 1 attempt — none is
    // throttled (they get 401 bad-creds), where the old per-IP-10 throttle blocked them.
    const built = await buildTestApp({ signIn: async () => null });
    let last;
    for (let i = 0; i < 11; i++) {
      last = await built.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: `approver${i}@rungrueang.co.th`, password: "pw" },
      });
    }
    expect(last!.statusCode).toBe(401); // not throttled — the office is not the attacker
    expect(last!.json().code).toBe("INVALID_CREDENTIALS");
  });

  it("B-099: a broad spray of distinct accounts from one IP still trips the coarse per-IP backstop", async () => {
    // Each distinct account stays under the per-user cap, but the per-IP backstop
    // (50) still counts every attempt from the source and cuts off a 51-wide spray.
    const built = await buildTestApp({ signIn: async () => null });
    let last;
    for (let i = 0; i < 51; i++) {
      last = await built.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: `spray${i}@example.test`, password: "guess" },
      });
    }
    expect(last!.statusCode).toBe(429); // per-IP coarse guard holds
    expect(last!.json().code).toBe("RATE_LIMITED");
  });

  it("B-100: a wrong-password spray does NOT lock out the victim's correct login (account-lockout DoS closed)", async () => {
    const validSession = {
      token: "tok-1",
      companyId: COMPANY,
      user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย วัฒนกุล" },
    };
    const built = await buildTestApp({
      signIn: async (_email, pw) => (pw === "right" ? validSession : null),
      db: fullDb(),
    });
    // An attacker sprays the victim's email with WRONG passwords — the attacker's
    // own (account+IP) failure window fills and they are throttled (429).
    let sprayed;
    for (let i = 0; i < 11; i++) {
      sprayed = await built.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { "content-type": "application/json" },
        payload: { email: "somchai@rungrueang.co.th", password: "wrong" },
      });
    }
    expect(sprayed!.statusCode).toBe(429);
    // The REAL victim, with the CORRECT password, still gets in — a valid
    // credential bypasses the account counter (B-100 ข). The spray cannot lock them out.
    const victim = await built.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: { email: "somchai@rungrueang.co.th", password: "right" },
    });
    expect(victim.statusCode).toBe(200);
    expect(victim.json().token).toBe("tok-1");
  });

  it("B-100: the account throttle is scoped to the source IP — a victim from a different IP starts fresh", async () => {
    const built = await buildTestApp({ signIn: async () => null, db: fullDb() });
    // Attacker sprays the victim's email from THEIR ip → throttled (429) on that ip.
    let sprayed;
    for (let i = 0; i < 11; i++) {
      sprayed = await built.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        remoteAddress: "203.0.113.9",
        headers: { "content-type": "application/json" },
        payload: { email: "somchai@rungrueang.co.th", password: "wrong" },
      });
    }
    expect(sprayed!.statusCode).toBe(429);
    // The victim, from a DIFFERENT ip, has an untouched (account+IP) window — a
    // single wrong attempt returns the normal 401, never a pre-emptive 429.
    const fromVictimIp = await built.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      remoteAddress: "198.51.100.7",
      headers: { "content-type": "application/json" },
      payload: { email: "somchai@rungrueang.co.th", password: "wrong" },
    });
    expect(fromVictimIp.statusCode).toBe(401); // not 429 — the spray never touched (victim|victimIP)
  });
});

describe("contract prefix /api/v1 (audit debt 1)", () => {
  it("mounts POST /files under /api/v1", async () => {
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION })
    ).inject({ method: "POST", url: "/api/v1/files?link_module=boq:1" });
    expect(res.statusCode).toBe(201);
    expect(res.json().file_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

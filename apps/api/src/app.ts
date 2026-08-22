// Juneflow API — Fastify app assembly (P1-BE-01).
//
// Split out of the entrypoint so the wiring is unit-testable (G3): index.ts
// builds this app with production deps and listens; tests build it with
// injected seams (resolver / signIn / storage / quota / audit sink).
//
// Contract surface (packages/contracts/openapi.yaml):
// - All contract routes live under the contract server prefix /api/v1
//   (P1-BE-01 audit debt 1 — live contract tests must not 404).
// - Every error body is flat {code,message} per the Error schema: tenant-scope
//   401, route errors, the not-found handler (debt 2) and the global error
//   handler below. files.ts nested 401 fixed the same round (debt 3).
// - /health stays at the root: it is NOT a contract endpoint — it is the
//   compose healthcheck probe (infra/docker-compose.yml pins it).
import Fastify, { type FastifyInstance } from "fastify";
import type { Db } from "@juneflow/db/client";
import { PlatformDb } from "./db/platform-db.js";
import { PlatformWriteDb } from "./db/platform-write-db.js";
import { clientDataException } from "./db/pg-data-exception.js";
import {
  registerTenantScope,
  DEFAULT_PUBLIC_PATHS,
  type ResolvedTenant,
} from "./plugins/tenant-scope.js";
import type { FastifyRequest } from "fastify";
import {
  registerAuditLog,
  createDbAuditSink,
  type AuditSink,
} from "./plugins/audit-log.js";
import { QuotaGuard } from "./plugins/quota.js";
import { FeatureFlags, registerFeatureFlags } from "./plugins/feature-flags.js";
import { registerFilesRoute, type FileStorage } from "./routes/files.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerMeRoute } from "./routes/me.js";
import { loadUserByEmail } from "./routes/profile-data.js";
import { registerProjectsRoute } from "./routes/projects.js";
import { registerTimelineRoute } from "./routes/timeline.js";
import { registerCountsRoute } from "./routes/counts.js";
import { registerCompaniesRoute } from "./routes/companies.js";
import { registerProjectTypesRoute } from "./routes/project-types.js";
import { registerCostCentersRoute } from "./routes/cost-centers.js";
import { registerDocNumberingRoute } from "./routes/doc-numbering.js";
import { registerDocumentsRoute } from "./routes/documents.js";
import { registerModelsRoute } from "./routes/models.js";
import { registerVendorsRoute } from "./routes/vendors.js";
import { registerUsersRoute } from "./routes/users.js";
import { registerRolesRoute } from "./routes/roles.js";
import { registerAdminRoutes, type DunningNotifier } from "./routes/admin.js";
import { registerSubscriptionRoutes } from "./routes/subscription.js";
import { registerOrgUnitsRoute } from "./routes/org-units.js";
import { registerProjectNodesRoute } from "./routes/project-nodes.js";
import { registerBoqRoute } from "./routes/boq.js";
import { registerAiQtoRoute } from "./routes/ai-qto.js";
import { registerPrRoute } from "./routes/pr.js";
import { registerPoRoute } from "./routes/po.js";
import { registerWoRoute } from "./routes/wo.js";
import { registerGrRoute } from "./routes/gr.js";
import { registerSubconRoute } from "./routes/subcon.js";
import { registerPmRoute } from "./routes/pm.js";
import { registerNotificationsRoute } from "./routes/notifications.js";
import { registerDashboardRoute } from "./routes/dashboard.js";
import { registerAuditLogRoute } from "./routes/audit-log.js";
import { registerBoqReportsRoute } from "./routes/boq-reports.js";
import { registerAnalyticsRoute } from "./routes/analytics.js";
import { registerGlRoute } from "./routes/gl.js";
import { registerRevRecRoute } from "./routes/revrec.js";
import { registerOpexRoute } from "./routes/opex.js";
import { registerArRoute } from "./routes/ar.js";
import { registerCustomersRoute } from "./routes/customers.js";
import { registerEtaxRoute } from "./routes/etax.js";
import { registerFaRoute } from "./routes/fa.js";
import { registerApRoute } from "./routes/ap.js";
import { registerApCnDnRoute } from "./routes/ap-cndn.js";
import { registerBankRoute } from "./routes/bank.js";
import { registerTaxRoute } from "./routes/tax.js";
import { registerRetentionRoute } from "./routes/retention.js";
import { registerApDepositRoute } from "./routes/ap-deposit.js";
import { registerLaborRoute } from "./routes/labor.js";
import { registerInventoryRoute } from "./routes/inventory.js";
import { registerLandSalesRoute } from "./routes/land-sales.js";
import { registerSalesServiceRoute } from "./routes/sales-service.js";
import { registerSolarRoute } from "./routes/solar.js";
import { registerPettyRoute } from "./routes/petty.js";
import type { SignIn } from "./auth.js";
import {
  DbCredentialStore,
  noopResetDelivery,
  type CredentialStore,
  type ResetDelivery,
} from "./auth-provisioning.js";

export interface AppDeps {
  /** Base (un-scoped) DB handle — only plugins/TenantDb construction see it. */
  db: Db;
  /** Tenant/session resolver (prod: better-auth resolveAuthContext). */
  resolveTenant: (request: FastifyRequest) => Promise<ResolvedTenant>;
  /** Credential sign-in seam (prod: better-auth signInWithEmail). */
  signIn: SignIn;
  /** File storage seam for POST /files. */
  storage: FileStorage;
  /** Quota guard (402 QUOTA_EXCEEDED + upgrade_url). */
  quota: QuotaGuard;
  /** Feature flags (defaults: DEFAULT_FEATURE_FLAGS). */
  features?: FeatureFlags;
  /** Audit sink override for tests (defaults to the DB sink). */
  auditSink?: AuditSink;
  /** Dunning-notification seam (W1d). Default no-op; tests record it; real LINE
   *  delivery (P0-INT-03) lands later as a default-swap. */
  notify?: DunningNotifier;
  /**
   * Credential/reset seam (B-282). Defaults to the REAL DbCredentialStore over
   * the base handle, so production is wired by construction and a test opts out
   * by injecting a fake — never the other way round (a no-op default here would
   * silently restore the "invited users can never log in" bug).
   */
  credentials?: CredentialStore;
  /**
   * Reset/invite token delivery seam (B-282). Defaults to a NO-OP: apps/api has
   * no mail dependency and @juneflow/notifications ships no concrete
   * SmtpTransport (B-269), so nothing here can send a message yet. index.ts
   * warns at boot; see auth-provisioning.ts for the exact wiring steps.
   */
  deliverReset?: ResetDelivery;
  /**
   * Fastify logger: `false` (tests), `true`/omitted (production, stdout), or pino
   * options when the caller needs the destination — the redaction test below
   * captures the stream to read what an error path actually writes to disk.
   */
  logger?: boolean | LogOptions;
}

/** The pino options buildApp accepts; `stream` is the pino DestinationStream shape. */
export interface LogOptions {
  stream: { write(msg: string): void };
  level?: string;
}

// ---------------------------------------------------------------------------
// LOG REDACTION (audit M1) — the ERROR OBJECT a refused statement produces must not
// write the values it refused onto the host's disk.
//
// SCOPE, narrowed to what is actually enforced. The round-1 wording claimed the whole
// statement — "must not write the values it refused" — and the flagship B-390 case
// disproves it. A bad uuid in a PATH PARAM (22P02 → 400) is stripped out of the
// level-50 error record by everything below, and then written verbatim ONE LINE ABOVE
// it, at level 30, by FASTIFY'S OWN DEFAULT `req` SERIALIZER:
//   {"level":30,"req":{"method":"GET","url":"/api/v1/subcon-contracts/<value>/periods"}}
// fastify logs `{ req }` on "incoming request" before any handler runs, so nothing in
// an error path can reach it. URLs AND QUERY STRINGS ARE A SEPARATE, UNCOVERED SURFACE.
// Every M1 test below but one injects a WELL-FORMED uuid in the path, so they pass
// vacuously on that dimension; the one test that plants a marker in the URL asserts on
// the level-50 record only, and says so.
//
// WHAT CLOSING IT WOULD TAKE, named so it is not mistaken for covered ground: a `req`
// serializer in loggerOptions() emitting `request.routeOptions.url` — the route TEMPLATE
// `/api/v1/subcon-contracts/:id/periods` — in place of `request.url`, and dropping the
// query string outright. Few lines, but it rewrites EVERY request line in production
// rather than an error path, and it deletes the concrete id an operator correlates a
// user's report against — so it has to land with a request-id correlation this log does
// not have yet. Separate work, separate blast radius.
//
// MEASURED against this repo's fastify 5 + drizzle 0.45, not assumed. With the default
// logger, ONE `request.log.error(err)` on a DrizzleQueryError writes the bound values
// FOUR times over:
//   · `err.params`  — the bound parameter list, verbatim, as a json array;
//   · `err.query`   — the statement text;
//   · `err.message` — drizzle builds it as `Failed query: <sql>\nparams: <values>`;
//   · `err.stack`   — whose header line repeats that same message.
// Fastify's default `err` serializer copies every own enumerable property of the error,
// and pino's write() promotes `err.message` to the line's top-level `msg`. So on a
// deployed host — json-file logs on disk, read by whoever can reach the box — every
// numeric overflow, bad uuid, constraint violation or transient DB failure spills the
// literal values of that request: money amounts, payroll figures, customer names and
// phone numbers, tax ids, bank account strings.
//
// The SAME measurement showed the diagnosis is currently ABSENT: the SQLSTATE lives on
// the nested pg DatabaseError (`.cause`), which the default serializer renders only as
// stack text, so "22003" appeared nowhere in the line. This block therefore does two
// things at once — it drops the values AND lifts the fields you actually diagnose from.
//
// THE COMPENSATING CONTROL THIS MUST NOT BREAK. B-390 answers 400 for a data exception
// the client caused, and db/pg-data-exception.ts ("WHAT THIS DOES NOT GUARANTEE") names
// two residual cases where that 400 can be wrong and states that the ERROR-LEVEL LOG,
// not the status code, is what keeps a server-side fault visible. That log stays loud
// here: same level, same call sites, and it now carries the SQLSTATE, the schema
// identifiers and the stack frames — strictly more than it carried before.
//
// WHAT A CONNECTION FAILURE COSTS NOW — an accepted, measured regression, not an
// oversight. Two rounds tried to keep the `host:port` of a refused connect in the line by
// echoing the error's `.cause`, and both produced a DENYLIST ("echo it unless it looks
// like Postgres") at the one point a value can reach disk. The second one measurably
// leaked: real `pg` throws `circular reference detected while preparing "<value>" for
// query` from prepareValue, which carries no pg fingerprint at all, and the bound
// parameter's own value went to disk inside that sentence. The echo is therefore deleted
// rather than filtered again, and this is what remains, MEASURED through this app's own
// logger on each shape:
//   · A SINGLE-STACK host (`127.0.0.1:<port>`) throws a plain socket Error whose message
//     IS `connect ECONNREFUSED 127.0.0.1:<port>`. Unwrapped, that message is kept
//     verbatim, so the address survives. Wrapped by drizzle, it does not: the wrapper's
//     own message is redacted to `Failed query: [redacted]` and the cause is not read.
//   · A DUAL-STACK host NAME — `localhost`, which is what `.env.example` and
//     packages/db/drizzle.config.ts actually configure — resolves to ::1 AND 127.0.0.1,
//     so Node throws `AggregateError { message: "", code: "ECONNREFUSED", errors: [...] }`.
//     Its message is EMPTY and both addresses live in `.errors[]`, which this allowlist
//     does not copy. The line keeps the type name (`AggregateError`) and the stack frames
//     — and NOTHING ELSE.
// SAY IT PLAINLY: on the configuration this repo documents, a connection failure now logs
// the stack frames and the error's class, but NOT the target address AND NOT the
// `ECONNREFUSED` code — `code` is lifted only off a proven pg error, so a Node errno is
// dropped with the rest. (That last part is not new here; the allowlist has always done
// it. What is new is that no message carries the address either.) Connection-failure
// diagnosis is DEGRADED versus the previous behaviour. B-033 was diagnosed from that
// address, so this is a real loss.
// WHERE THE FIX BELONGS, so nobody re-derives the denylist: log the CONFIGURED database
// host from the app's own config at the point of failure. The app KNOWS that value — it
// built the pool from it — so it needs no trust decision and no parsing of a string some
// other library authored. Parsing it back out of an error message is the approach that
// was tried twice and abandoned twice, for the reason above.
//
// ALLOWLIST, NOT DENYLIST — TWICE OVER, because the leak has two dimensions.
//   · ACROSS AN ERROR'S FIELDS: `params`/`query` are only today's value-bearing keys,
//     and any error object may grow another, so nothing reaches the log unless it is
//     named below.
//   · ACROSS THE LOG CALL'S KEYS: an error is only redacted if something redacts the
//     KEY it was logged under, and `err` is a convention, not a rule — `{ error: e }`
//     is just as natural to write. So the guard below is on the VALUE (any Error,
//     under any key) rather than on a list of key names, which would be a denylist
//     over spellings nobody controls.
// ---------------------------------------------------------------------------

/** The shape fastify's logger typing requires back from an `err` serializer. */
interface SerializedError {
  [key: string]: unknown;
  type: string;
  message: string;
  stack: string;
}

/** Anything object-shaped, for reading unknown error properties. */
function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * SQLSTATE's SHAPE: five characters, digits and uppercase letters only. Measured against
 * a live Postgres 16 through this repo's own driver: 22P02, 22012, 23505, 28P01, 42P01.
 *
 * Shape alone is NOT a provenance test, which is why it is only half of one below:
 * `EPIPE`, `EPERM` and `EBUSY` are Node error codes that match it exactly.
 */
const SQLSTATE_SHAPE = /^[0-9A-Z]{5}$/;

function isSqlstateShaped(code: unknown): boolean {
  return typeof code === "string" && SQLSTATE_SHAPE.test(code);
}

/**
 * Does this object carry a SQLSTATE that POSTGRES issued?
 *
 * THE TEST THIS REPLACES, AND THE OUTAGE IT MISREPORTED. It asked
 * `typeof own.code === "string"` — "has a string code", not "came from Postgres" — and
 * this is the DECIDING test for safeMessage() rule 1, so any error with any string code
 * had its message withheld and replaced by a sentence about Postgres. Measured through a
 * real `pg` Pool at a closed port and the shipped buildApp, an operator's most common
 * outage read `Postgres refused this statement; message withheld (SQLSTATE
 * ECONNREFUSED)`: a sentence that is FALSE (Postgres never saw a statement — the TCP
 * connect was refused) and that deletes the `127.0.0.1:<port>` the operator needs.
 * BLOCKERS.md B-033 was diagnosed from exactly that address. `ETIMEDOUT` and fastify's
 * `FST_ERR_VALIDATION` measured identically.
 *
 * ACCEPTS, MEASURED: an object carrying BOTH a SQLSTATE-shaped `code` AND a string
 * `severity`. Every real DatabaseError measured against a live Postgres 16 through `pg`
 * 8.22 carried both — 22P02, 22012, 42P01 (severity "ERROR") and the connection-time
 * 28P01 (severity "FATAL") — at the top level when unwrapped, and under `.cause` when
 * drizzle wrapped it.
 *
 * REJECTS, MEASURED: `ECONNREFUSED` and `ETIMEDOUT` (no `severity`, and 12/9 characters),
 * `FST_ERR_VALIDATION`, and the 5-character Node codes that pass the shape test alone —
 * `EPIPE`, `EPERM`, `EBUSY` — none of which carries `severity`.
 *
 * SCOPE, NOT A GUARANTEE: this is a fingerprint of what pg's protocol parser writes, not
 * a proof of origin. Anything that sets both fields satisfies it, and a pg-protocol
 * proxy that omitted `severity` would not.
 *
 * AND IT IS NOW THE ONLY GUARD ON THE MESSAGE, which is a real cost and is stated rather
 * than hidden. An earlier round put a second, looser net under this one: any single pg
 * fingerprint (a string `severity`, a 5-char code, a `schema`/`table`/`column`/
 * `constraint`/`routine` field) withheld the message even when this test missed. That net
 * was removed because it caught the wrong things far more often than the right ones —
 * measured, `Error("defect <id> is invalid")` with `.severity = "medium"` was logged as
 * "provenance unproven; message withheld", and `severity` is an ORDINARY column in this
 * schema (packages/db/src/schema/subcon.ts defects, written at routes/subcon.ts), not an
 * exotic field name. So it destroyed ordinary application messages on a routine day.
 * WHAT THAT COSTS: a real DatabaseError that reached this handler WITHOUT `severity`
 * would now have its message echoed verbatim — and Postgres quotes the offending literal
 * into several of those. Both halves are pinned by tests, as a pair, so the boundary is
 * visible: a real server-sent error loses its message, and a pg-SHAPED one keeps it.
 * The bet is that the pair is what pg actually sends (measured on 22P02, 22012, 42P01,
 * 28P01) and that a stripped-`severity` DatabaseError is not a shape this repo produces.
 */
function isPostgresError(o: Record<string, unknown>): boolean {
  return isSqlstateShaped(o.code) && typeof o.severity === "string";
}

/**
 * The pg DatabaseError behind an error, at either nesting level — the same lookup
 * db/pg-data-exception.ts pgError() makes, and load-bearing for the same reason:
 * drizzle nests the DatabaseError under `.cause`, so reading only the top-level
 * object finds no SQLSTATE in production.
 *
 * WHAT DIFFERS FROM THAT ONE is the test applied at each level, and deliberately so:
 * there the loose code is then matched against PG_CLIENT_INPUT_CODES, so a false
 * positive falls through to the same 500 it would have got anyway. Here it decides
 * whether a message is withheld and whether a SQLSTATE is asserted, so a false positive
 * both destroys evidence and states something untrue.
 */
function pgFields(err: unknown): Record<string, unknown> | null {
  const own = asObject(err);
  if (own && isPostgresError(own)) return own;
  const cause = asObject(own?.cause);
  return cause && isPostgresError(cause) ? cause : null;
}

/**
 * DatabaseError fields that name SCHEMA rather than data. Measured in
 * db/pg-data-exception.ts: 23502 carries schema+table+column while 22003 carries
 * neither — so these are copied when present, and their absence is not an error.
 */
const PG_IDENTIFIER_FIELDS = [
  "schema",
  "table",
  "column",
  "constraint",
  "routine",
] as const;

/**
 * `detail` is allowlisted BY SQLSTATE CLASS, and that is deliberate rather than
 * cautious. For class 22 (data exception) the detail describes a threshold or a
 * format and carries no row values — "A field with precision 6, scale 3 must round
 * to an absolute value less than 10^3." — which is exactly the string B-390's own
 * discriminator reads. For class 23 (integrity constraint violation) the detail IS
 * the data: measured Postgres shapes are `Key (email)=(somchai@rungrueang.co.th)
 * already exists.` and, for a not-null/check violation, `Failing row contains (v1,
 * v2, v3).` — the whole row. Pattern-filtering those two shapes would be a denylist
 * over strings Postgres is free to change; refusing every class but 22 is not.
 *
 * This deviates from the M1 brief, which said "keep detail", and the deviation is the
 * point: 23505 is not an exotic error in this repo — B-165/B-167 made a duplicate-key
 * collision an ORDINARY, expected outcome of the idempotency keys on the money paths.
 * Following the brief literally would therefore have written a live row value to the
 * host's disk on a routine day, not on a rare one.
 */
function isDataExceptionCode(code: unknown): boolean {
  return typeof code === "string" && code.startsWith("22");
}

/** Drizzle builds `Failed query: <sql>\nparams: <values>`; line 2 is the values. */
const DRIZZLE_MESSAGE_PREFIX = "Failed query:";

/** Stands in for a message Postgres authored; the caller appends the SQLSTATE. */
const PG_MESSAGE_WITHHELD = "Postgres refused this statement; message withheld";

/**
 * A message safe to write to disk, decided by PROVENANCE rather than by shape.
 *
 * THREE RULES, most-distrusted source first.
 *
 * 1. POSTGRES ISSUED THE SQLSTATE, at either nesting level (isPostgresError(): a
 *    SQLSTATE-shaped `code` AND a `severity`, the pair every DatabaseError measured off
 *    a live server carried, and which `ECONNREFUSED`/`ETIMEDOUT`/`FST_ERR_VALIDATION`
 *    do not). The heading used to read "carries a pg SQLSTATE" while the test underneath
 *    it only asked for a string `code`; see isPostgresError() for the outage that
 *    mismatch printed. Postgres authored that message, and Postgres
 *    interpolates the offending VALUE into it: db/pg-data-exception.ts measured
 *    22P02 `invalid input syntax for type uuid: "not-a-uuid"`, and records that
 *    22007/22008/22023 quote a literal the same way. So the message is withheld
 *    whole and the SQLSTATE stands in for it.
 *    THIS RULE REPLACES A PREFIX MATCH ON `Failed query:`, and the difference is
 *    not theoretical: a DatabaseError that reaches the handler UNWRAPPED — no
 *    drizzle wrapper, SQLSTATE on the top-level `.code`, which is exactly the case
 *    pgFields() checks first — has no such prefix, so its raw message went through
 *    verbatim into `err.message` AND, via the hook below, into the line's
 *    top-level `msg`.
 *    COST, stated rather than hidden: where the message is the ONLY place an
 *    identifier appears (42P01 `relation "x" does not exist` carries no `table`
 *    field), that name is now gone from the log. The stack frames replace it —
 *    they name the route file and line that issued the statement. Carving a
 *    per-class exception instead would be a denylist over strings Postgres is free
 *    to change, which is the thing this block already refuses to build.
 *
 * 2. NO pg SQLSTATE, BUT DRIZZLE'S WRAPPER — a statement that failed for a reason
 *    Postgres never got to report (dropped connection, pool timeout, a refused TCP
 *    connect). Line 2 of that wrapper message is the bound values verbatim, so ONLY THE
 *    PREFIX SURVIVES and nothing is appended to it.
 *    AN EARLIER ROUND APPENDED THE CAUSE'S FIRST LINE HERE, to keep the `host:port` of a
 *    refused connect in the record, and it was removed because it was a DENYLIST at the
 *    one place a value can reach disk: it echoed any cause that did not show a pg
 *    fingerprint. Measured end to end through this handler, real `pg` (pg/lib/utils.js
 *    prepareObject) throws `circular reference detected while preparing "<value>" for
 *    query` — an ordinary Error, no fingerprint, the parameter's own value interpolated
 *    into the sentence — and the line came out
 *    `Failed query: [redacted] (cause: circular reference detected while preparing
 *    "1-9999-00000-00-0" for query)`. The marker reached disk. Two rounds of trying to
 *    filter that string produced a denylist both times, which is what this whole block
 *    refuses to build; see the header for what replaces it.
 *
 * 3. ANYTHING ELSE — an ordinary application error, kept VERBATIM (first line).
 *    That is where the line is drawn, deliberately: rules 1 and 2 cover messages
 *    assembled by Postgres and by drizzle AROUND the offending values, whereas
 *    these are authored in this repo ("subcontract not found", a TypeError from a
 *    bad refactor) by code with no reason to interpolate a row value. Redacting
 *    here too would buy nothing measurable and would blind the operator on the
 *    ordinary crash — the case that is neither a leak nor rare. A refused connection
 *    that reaches the handler UNWRAPPED lands here too, and keeps its address.
 *    THERE IS NO LONGER A RULE BETWEEN 2 AND 3. One round put a "pg-SHAPED but not
 *    provably pg → withhold" branch there; it fired on a string `severity`, a string
 *    `schema`/`table`/`column`/`constraint`/`routine`, or ANY 5-char code, and measured,
 *    `Error("defect <id> is invalid")` with `.severity = "medium"` — `severity` being a
 *    real column in this schema — was logged as "message withheld". It destroyed
 *    ordinary messages to guard a shape nothing here produces; see isPostgresError()
 *    for what that costs and why the trade was taken.
 *
 * DELIBERATE CHOICE ON THE SQL TEXT (`.query`, and the same text inside a rule-1 or
 * rule-2 message): it is dropped, not kept. Drizzle parameterizes ($1…$n), so TODAY
 * the statement text holds placeholders and not values — but that is a property of
 * every call site, not of this serializer, and one future `sql.raw` interpolating a
 * value would re-open the leak silently, in the one place nobody would think to
 * re-audit. WHAT REPLACES IT, and what does not: `code` says what Postgres refused, the
 * identifier fields say where, and the stack frames name the exact route file and line
 * that issued the statement — which is more precise than a table name. Round 3 wrote
 * "nothing is lost that matters" there, and the ECONNREFUSED measurement falsified it —
 * none of those three carries the host:port of a connection that was never established,
 * which lives only in the cause's message. That address is NOT recovered here; the
 * header states what a connection failure does and does not keep, and where the fix
 * belongs. The claim is a list of what survives rather than a "nothing".
 */
function safeMessage(err: unknown): string {
  const pg = pgFields(err);
  if (pg) return `${PG_MESSAGE_WITHHELD} (SQLSTATE ${String(pg.code)})`;
  const own = asObject(err);
  // `String(value)` on an object with no string `message` yields "[object Object]" —
  // a floor on THIS function's return value, and nothing more. The round-1 comment here
  // read that as "nothing this block did not name may reach the log", which measurement
  // contradicts twice over: a thrown NON-Error never reaches this function at all (the
  // hook below routes it to the merge branch, because `first instanceof Error` is
  // false), and pino then spreads its OWN FIELDS as top-level log keys — measured, a
  // thrown `{query, params, code, message}` wrote all four, markers included. That is
  // pino's pre-existing behaviour rather than something this block introduced, and it is
  // limit 4 on redactErrorsUnderOtherKeys() below.
  const raw = typeof own?.message === "string" ? own.message : String(err);
  const firstLine = raw.split("\n", 1)[0] ?? "";
  if (firstLine.startsWith(DRIZZLE_MESSAGE_PREFIX)) {
    return `${DRIZZLE_MESSAGE_PREFIX} [redacted]`;
  }
  return firstLine;
}

/**
 * The `    at …` frames only. A stack's header line repeats the message verbatim —
 * so for a drizzle error it repeats the bound values — while the frames are file,
 * function and line, which is the half worth keeping.
 */
function safeStack(stack: unknown): string | undefined {
  if (typeof stack !== "string") return undefined;
  const frames = stack.split("\n").filter((line) => /^\s+at /.test(line));
  return frames.length > 0 ? frames.join("\n") : undefined;
}

/**
 * The `err` log serializer. Replaces fastify's default (which copies every own
 * enumerable property) with the allowlist above.
 *
 * NO pg message is copied, at either nesting level — safeMessage() rule 1 withholds
 * it, because Postgres quotes the offending literal inside it for several codes
 * (measured: `invalid input syntax for type uuid: "not-a-uuid"`) and `code` names the
 * same failure without carrying a value.
 */
function redactErrorValues(err: unknown): SerializedError {
  const e = asObject(err) ?? {};
  const out: SerializedError = {
    type: typeof e.name === "string" ? e.name : "Error",
    message: safeMessage(err),
    stack: safeStack(e.stack) ?? "",
  };
  const pg = pgFields(err);
  if (pg) {
    out.code = pg.code;
    for (const field of PG_IDENTIFIER_FIELDS) {
      if (typeof pg[field] === "string") out[field] = pg[field];
    }
    if (isDataExceptionCode(pg.code) && typeof pg.detail === "string") {
      out.detail = pg.detail;
    }
  }
  return out;
}

/** pino's `errorKey` — the one key a serializer can be registered for by name. */
const PINO_ERROR_KEY = "err";

/**
 * pino's OWN promotion condition, mirrored rather than approximated.
 *
 * pino's LOG() shifts the message out of the argument list and hands write() whatever it
 * found there; write() then promotes the RAW `.message` — off the error, before any
 * serializer — whenever that value is `undefined`. Round 2 approximated this as "no
 * argument was passed" (`rest.length === 0`), and the two differ by exactly ONE ARITY,
 * which was enough to leave the leak open: measured, `log.error({ err }, maybeMsg)` where
 * `maybeMsg` is an optional nobody set passes TWO arguments, so a length check skipped
 * the fix branch while pino promoted the raw message anyway —
 * `msg="invalid input syntax for type uuid: \"<value>\""`, the exact string this block
 * exists to stop, reached by the exact same route. Reading `rest[0]` covers both spellings
 * at once: it is `undefined` when the argument is ABSENT and when it is PRESENT-BUT-UNDEFINED.
 *
 * `null` is deliberately NOT treated as missing. pino promotes only on `undefined`; a
 * caller who passed `null` gets pino's own rendering of it, and widening this past pino's
 * test would make the hook diverge from the behaviour it exists to mirror — which is the
 * mistake being fixed here, in the other direction.
 */
function hasNoMessageArgument(rest: unknown[]): boolean {
  return rest[0] === undefined;
}

/**
 * Redact every Error a caller passed under a key OTHER than `err`.
 *
 * WHY THIS IS BY VALUE AND NOT BY KEY NAME. A pino serializer is registered per key,
 * so it only ever guards spellings someone thought to list. Measured: with `err`
 * serialized, `log.error({ error: e }, "…")` still wrote the DrizzleQueryError's
 * `{query, params, cause}` in full — JSON.stringify emits an Error's OWN ENUMERABLE
 * properties, which is exactly where drizzle hangs the bound values. `error` is not
 * an exotic spelling either: five sites already use it (routes/admin.ts,
 * routes/auth.ts ×2, routes/users.ts ×2). They are safe TODAY only because each
 * passes `(err as {name?: string})?.name` and never the error itself — a one-word
 * edit at any of them re-opens M1, in files this one does not own, with no test that
 * would notice. Adding `error` to the serializer list would fix those five and leave
 * `e`, `cause`, `failure` and every future name open; testing the VALUE closes the class
 * OF TOP-LEVEL ERRORS IN A MERGE OBJECT — which is every call site in apps/api, and is
 * narrower than "closes the class". The four shapes it does not close are enumerated
 * below, because the round-1 wording stopped at the unqualified claim.
 *
 * THE TRADE-OFF, since it is a real one: this runs on every log line rather than only
 * on lines pino routes to a serializer, and it hard-codes the division of labour with
 * that serializer — `err` is skipped here because the serializer owns it, and applying
 * both would run redactErrorValues() twice (the second pass reads `type` where the
 * first wrote `name`, degrading a TypeError to "Error"). One rule per key, no overlap.
 * Cost is bounded: an own-key scan of a 1–2 key merge object, and no allocation at all
 * unless an Error is actually found.
 *
 * KNOWN LIMITS — each one MEASURED by driving a DrizzleQueryError through this app's
 * own logger, not reasoned about. A hook sees the arguments of ONE log call, so four
 * shapes escape it and every one of them wrote the bound values into the line:
 *   1. `log.child({ error: e })` — child bindings are serialized ONCE at child creation
 *      and never pass through logMethod at all. Unreachable from here by construction.
 *   2. `log.error([e], "…")` — an array is deliberately not spread (see below), so its
 *      elements are rendered as-is.
 *   3. `log.error({ ctx: { err: e } }, "…")` — the scan is SHALLOW by design.
 *   4. A thrown NON-Error logged as the merge object itself (`{query, params, code,
 *      message}`) — `instanceof Error` is false, so pino spreads its fields as
 *      top-level keys. Pre-existing pino behaviour, not introduced here.
 * NO CALL SITE IN apps/api DOES ANY OF THESE TODAY (grepped, not assumed). They are
 * documented rather than closed because 1 cannot be reached from a hook and 2–4 cost a
 * per-line deep walk that could mangle legitimate payloads. What IS closed is the shape
 * every real call site uses: a top-level Error in the merge object, under any key.
 */
function redactErrorsUnderOtherKeys(
  merge: Record<string, unknown>,
): Record<string, unknown> {
  let out = merge;
  for (const key of Object.keys(merge)) {
    const value = merge[key];
    if (key === PINO_ERROR_KEY || !(value instanceof Error)) continue;
    if (out === merge) out = { ...merge };
    out[key] = redactErrorValues(value);
  }
  return out;
}

/**
 * Fastify/pino logger options with the redaction wired in.
 *
 * The serializer alone is NOT enough, and that is the measurement that shaped this:
 * pino's write() promotes a bare Error's `.message` to the line's top-level `msg`,
 * which no `err` serializer and no `redact` path can reach without censoring the whole
 * field. So the `logMethod` hook does two jobs, and each covers call sites this file
 * does not own — verified by grep over apps/api/src rather than assumed:
 *
 *   · RAW SINGLE-ARG `log.error(err)`, rewritten to `log.error({ err }, safeMessage)`
 *     so the serialized error is the only rendering of it. Four such sites exist: the
 *     two in the handler below, routes/admin.ts:532 (a dunning-notify failure) and
 *     index.ts:100 (the boot failure that exits the process).
 *   · AN ERROR UNDER ANY OTHER KEY, redacted by value (see above). This is what would
 *     cover routes/auth.ts:186/347 and routes/users.ts:421/442 and routes/admin.ts:379
 *     if any of them ever passed its error object instead of just `.name`.
 *   · `{ err }` WITH NO USABLE MESSAGE ARGUMENT — the SAME promotion, reached the other way,
 *     and missed by round 1. pino's write() takes `msg` from `_obj[errorKey].message`
 *     off the RAW error before any serializer runs, so a merge object was not safe
 *     merely for being a merge object: measured here, `log.error({ err })` on an
 *     unwrapped pg error put `invalid input syntax for type uuid: "<value>"` in `msg`,
 *     and on a drizzle error put the entire `Failed query: <sql>\nparams: <values>`
 *     there — statement AND parameters, the exact four-way leak this block exists to
 *     stop. The branch below supplies the same value-free message the single-arg branch
 *     produces, leaving pino nothing raw to promote.
 *
 * That last case is NOT latent. routes/notify.ts:220 already writes the merge shape,
 * `log.error({ err, event }, msg)`; it is safe TODAY only because it still passes a
 * message, and the serializer handles the `err` key. Deleting that argument — or adding
 * any new `{ err }` site — is the whole distance to the leak.
 *
 * AND "PASSES A MESSAGE" MEANS PASSES A DEFINED ONE, which is where round 2 stopped
 * short: both branches below asked whether an argument EXISTED (`rest.length === 0`)
 * while pino asks whether the message it computed IS `undefined`. A site that passes
 * `msg` from an optional — `log.error({ err }, opts.reason)` — satisfies the arity test
 * and fails pino's, so the raw message was promoted with the fix branch skipped. Both
 * branches now ask pino's question; see hasNoMessageArgument().
 */
function loggerOptions(logger: AppDeps["logger"]) {
  if (logger === false) return false;
  const redaction = {
    serializers: { [PINO_ERROR_KEY]: redactErrorValues },
    hooks: {
      logMethod(
        this: unknown,
        args: [unknown, ...unknown[]],
        method: (...a: unknown[]) => void,
      ) {
        const [first, ...rest] = args;
        if (first instanceof Error && hasNoMessageArgument(rest)) {
          method.call(this, { [PINO_ERROR_KEY]: first }, safeMessage(first));
          return;
        }
        // An Error passed WITH a message is left alone on purpose: pino files it
        // under `err` itself, where the serializer takes it, and the caller's own
        // message is the `msg` — nothing to promote. Arrays are left alone too;
        // spreading one would silently change the shape of the line.
        const merge =
          first instanceof Error || Array.isArray(first) ? null : asObject(first);
        if (merge) {
          const redacted = redactErrorsUnderOtherKeys(merge);
          // `{ err }` with no USABLE message: pino would promote the RAW `err.message` to
          // the line's `msg`. Mirror its own test (`msg === undefined && _obj[errorKey]`)
          // rather than approximate it by arity — see hasNoMessageArgument(). Only the
          // MESSAGE is derived here — `err` is still left to the serializer, keeping the
          // one-rule-per-key division intact (redactErrorValues() run twice degrades a
          // TypeError to "Error").
          const carried = asObject(merge[PINO_ERROR_KEY]);
          if (hasNoMessageArgument(rest) && Boolean(carried?.message)) {
            method.call(this, redacted, safeMessage(carried));
            return;
          }
          method.call(this, redacted, ...rest);
          return;
        }
        method.apply(this, args);
      },
    },
  };
  return typeof logger === "object" ? { ...redaction, ...logger } : redaction;
}

/** Assemble the full Fastify app (plugins + handlers + /api/v1 routes). */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions(deps.logger) });

  // Contract Error is flat {code,message} — including 404s (audit debt 2).
  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({
      code: "NOT_FOUND",
      message: `Route ${request.method}:${request.url} not found`,
    });
  });

  // Every failure path answers the flat contract Error shape. 5xx details go
  // to the log only (e.g. the better-auth misconfig that 500ed the stack —
  // P1-BE-01 root cause — must not leak internals to clients).
  app.setErrorHandler((error, request, reply) => {
    const err = error as {
      statusCode?: unknown;
      code?: unknown;
      message?: unknown;
    };
    const statusCode =
      typeof err.statusCode === "number" && err.statusCode >= 400
        ? err.statusCode
        : 500;
    if (statusCode >= 500) {
      // B-390: a value the CLIENT sent that Postgres refuses is a client error, and
      // answering 500 wedges a field phone's whole offline queue (sync_processor.dart
      // defers a 5xx and stops draining, but dead-letters a 4xx and continues).
      // clientDataException() returns non-null ONLY when the offending value is
      // traceable to this request; a value the SERVER computed keeps its 500 rather
      // than being misreported as the caller's mistake (full reasoning in
      // db/pg-data-exception.ts — read it before widening this).
      const clientInput = clientDataException(error, {
        body: request.body,
        params: request.params,
        query: request.query,
      });
      if (clientInput) {
        // Logged at ERROR level even though the answer is a 400: if the provenance
        // test above ever misjudges a server-side overflow, this line is what keeps
        // it visible instead of silently downgraded.
        request.log.error(error);
        return reply.code(400).send(clientInput);
      }
      request.log.error(error);
      return reply
        .code(statusCode)
        .send({ code: "INTERNAL_ERROR", message: "Internal server error" });
    }
    return reply.code(statusCode).send({
      code: typeof err.code === "string" ? err.code : "BAD_REQUEST",
      message: typeof err.message === "string" ? err.message : "Request failed",
    });
  });

  // Enforce company_id tenant scope on every non-public request (fail closed).
  await registerTenantScope(app, {
    db: deps.db,
    resolveCompanyId: deps.resolveTenant,
    publicPaths: DEFAULT_PUBLIC_PATHS,
  });

  // Feature flags: hide modules that are not finished yet so dev stays green.
  await registerFeatureFlags(app, deps.features ?? new FeatureFlags());

  // Every successful mutation writes an AuditLog row (single choke point).
  // Attribute the row to the DICTIONARY user (audit_log.user_id FK), resolved
  // from the session email exactly like GET /me — the session carries the
  // better-auth auth_user id, which is NOT the dictionary user id (F2 fix). The
  // lookup runs only on successful mutations (the audit hook fires there) and
  // fails closed to a null actor when the caller has no dictionary row.
  await registerAuditLog(app, {
    sink: deps.auditSink ?? createDbAuditSink(deps.db),
    resolveUserId: async (request) => {
      const db = request.db;
      const authUser = request.authUser;
      if (!db || !authUser) return null;
      try {
        const user = await loadUserByEmail(db, authUser.email);
        return user?.id ?? null;
      } catch {
        // A transient actor-lookup failure must not drop the whole audit row —
        // degrade to a null actor (the mutation is still recorded).
        return null;
      }
    },
  });

  // Compose healthcheck probe (root — not part of the contract surface).
  app.get("/health", async () => ({ ok: true }));

  // B-177: the ONE guarded cross-tenant read door for platform-owner /admin/*.
  // Constructed ONCE over the un-scoped base handle and injected ONLY into the
  // owner-gated admin routes — NEVER attached to `request` (request.db stays a
  // company-scoped TenantDb for every tenant handler).
  const platformDb = new PlatformDb(deps.db);
  // B-193 (W1a): the cross-tenant WRITE door — same containment (private handle,
  // injected ONLY into the owner-gated admin routes, never on request).
  const platformWriteDb = new PlatformWriteDb(deps.db);
  // W1d dunning notifier — no-op by default (the real LINE adapter's send() throws
  // a TODO until P0-INT-03; the remind never depends on it). Test-overridable.
  const notify: DunningNotifier = deps.notify ?? (() => {});
  // B-282 credential seam. Like platformDb/platformWriteDb this wraps the
  // un-scoped base handle privately and is injected ONLY into the three
  // handlers that provision or reset a credential — never attached to `request`.
  const credentials: CredentialStore =
    deps.credentials ?? new DbCredentialStore(deps.db);
  const deliverReset: ResetDelivery = deps.deliverReset ?? noopResetDelivery;

  // Contract routes under the contract server prefix /api/v1.
  await app.register(
    async (v1) => {
      await registerAuthRoutes(v1, {
        db: deps.db,
        signIn: deps.signIn,
        credentials,
        deliverReset,
      });
      registerMeRoute(v1);
      registerProjectsRoute(v1, { quota: deps.quota });
      // B-424 — GET /projects/{id}/timeline (the schedule behind the timeline screen).
      registerTimelineRoute(v1);
      registerCountsRoute(v1);
      registerCompaniesRoute(v1);
      registerProjectTypesRoute(v1);
      registerCostCentersRoute(v1);
      registerDocNumberingRoute(v1);
      registerDocumentsRoute(v1);
      registerModelsRoute(v1);
      registerVendorsRoute(v1);
      // B-369: the users route gained the seat meter (the sold `users` quota
      // dimension had no call site anywhere).
      registerUsersRoute(v1, { credentials, deliverReset, quota: deps.quota });
      registerRolesRoute(v1);
      registerAdminRoutes(v1, {
        platformDb,
        platformWriteDb,
        notify,
        credentials,
        deliverReset,
      });
      registerSubscriptionRoutes(v1);
      registerOrgUnitsRoute(v1);
      registerProjectNodesRoute(v1);
      registerBoqRoute(v1);
      registerAiQtoRoute(v1, { quota: deps.quota });
      registerPrRoute(v1);
      registerPoRoute(v1);
      registerWoRoute(v1);
      registerGrRoute(v1);
      registerSubconRoute(v1);
      registerPmRoute(v1);
      registerNotificationsRoute(v1);
      registerDashboardRoute(v1);
      registerAuditLogRoute(v1);
      registerBoqReportsRoute(v1);
      registerAnalyticsRoute(v1);
      registerGlRoute(v1);
      registerRevRecRoute(v1);
      registerOpexRoute(v1);
      registerArRoute(v1);
      registerCustomersRoute(v1);
      registerEtaxRoute(v1);
      registerFaRoute(v1);
      registerApRoute(v1);
      registerApCnDnRoute(v1);
      registerBankRoute(v1);
      registerTaxRoute(v1);
      registerRetentionRoute(v1);
      registerApDepositRoute(v1);
      registerLaborRoute(v1);
      registerInventoryRoute(v1);
      registerLandSalesRoute(v1);
      registerSalesServiceRoute(v1);
      registerSolarRoute(v1);
      registerPettyRoute(v1);
      await registerFilesRoute(v1, {
        storage: deps.storage,
        quota: deps.quota,
      });
    },
    { prefix: "/api/v1" },
  );

  return app;
}

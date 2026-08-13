// B-390 — a Postgres data exception the CLIENT caused must answer 4xx, not 500.
//
// THE WEDGE THIS FIXES (measured, not assumed)
// --------------------------------------------
// `pct = 100000` in the body of POST /subcon-contracts lands in
// `work_period.pct numeric(6,3)`. Postgres raises SQLSTATE 22003 "numeric field
// overflow", nothing catches it, and the global handler answers HTTP 500.
//
// A 500 is not merely the wrong label here. apps/mobile/lib/offline/sync_processor.dart
// DEAD-LETTERS a 4xx (markFailed + `continue`) but DEFERS a 5xx (`_deferPending` +
// `break`) — it stops draining at the first 5xx so a genuinely transient failure
// cannot be skipped past. So one unvalidated numeric field, in a body the contract
// types as an opaque `Entity`, stalls a field phone's ENTIRE offline queue behind it
// indefinitely, with no user-visible cause. 122 `numeric(p,s)` columns sit behind
// opaque-body routes; every one has this shape.
//
// THE TRAP THIS DELIBERATELY DOES NOT FALL INTO
// ---------------------------------------------
// A class-22 data exception arises two OPPOSITE ways:
//
//   · THE CLIENT SENT IT   — `pct = 100000` straight off the body. 400 is correct,
//     and the phone dead-letters it instead of wedging.
//   · THE SERVER COMPUTED IT — a money calculation overflowing its own column, a
//     rounding path emitting something the schema refuses. Answering 400 THERE tells
//     the user they sent something wrong when the server is broken, and converts a
//     loud 500 into a quiet, misattributed refusal. That is STRICTLY WORSE than the
//     wedge above: the wedge stalls a queue visibly, this hides a money bug.
//
// So a blanket "class 22 → 400" remap is a cover-up, and this module refuses to be one.
//
// ARE THE TWO DISTINGUISHABLE AT THE CATCH POINT? — NOT FROM THE ERROR ALONE.
// Measured against live PG 16 (pg 8 + drizzle-orm 0.45), the 22003 DatabaseError is:
//   { code: "22003", message: "numeric field overflow",
//     detail: "A field with precision 6, scale 3 must round to an absolute value
//              less than 10^3.", routine: "apply_typmod" }
// There is NO `column`, NO `table`, and NO offending value — and that is a deliberate
// asymmetry in Postgres, not an oversight: the SAME probe shows 23502 (not-null) DOES
// carry `schema` + `table` + `column`. Provenance is simply erased by the time the
// error exists.
//
// WHAT IS KNOWABLE, AND HOW THIS RECOVERS PROVENANCE ANYWAY
// ---------------------------------------------------------
// Two facts survive that the error object alone does not carry:
//
//   1. `detail` states the THRESHOLD ("less than 10^3"), so we know how large a value
//      had to be to overflow, even though we do not know which one did.
//   2. drizzle's DrizzleQueryError carries the BOUND PARAMETER LIST (`.params`) of the
//      failing statement — the literal values that went to Postgres.
//
// Intersect those with the values the CLIENT actually supplied (body ∪ path params ∪
// query) and provenance becomes decidable without per-column knowledge and without
// parsing SQL:
//
//      remap to 400  ⟺  EVERY parameter that could have overflowed
//                       is a value the client itself sent.
//
// The quantifier is EVERY, not "any", and that choice is the whole safety argument:
//   · Over-including candidates can only ADD a parameter the client did not send,
//     which fails the test and keeps the 500. Over-inclusion is therefore SAFE.
//   · A server-computed overflow (`amount = round2(qty × rate)` = 1e20 into
//     numeric(16,2)) is not in the body — the body carried the OPERANDS, not the
//     product — so it never satisfies EVERY, and it keeps its loud 500.
//   · Zero candidates (the value was computed inside SQL, or `.params` is absent
//     because the statement did not go through drizzle) → no attribution is possible
//     → 500. Silence is read as "cannot attribute", never as "client's fault".
//
// This also disposes of the canonical server-bug shapes for free, which is the check
// that the reasoning is sound rather than merely convenient:
//   · `String(Infinity)` (a JS divide-by-zero reaching the DB) raises 22003 with
//     detail "cannot hold an infinite value" — measured routine `apply_typmod_special`.
//     No "10^N" appears, so there is NO threshold, so there are NO candidates → 500.
//   · `String(undefined)` raises 22P02 'invalid input syntax for type numeric:
//     "undefined"'. The value IS in the message, so it becomes the sole candidate —
//     and "undefined" is not in the request, so it fails EVERY → 500.
//
// KNOWN LIMIT, stated because the next reader's instinct will be to widen this.
// The candidate set is "bound parameters at or above the threshold", which assumes the
// overflowing value WAS one of the bound parameters. A statement that computes
// server-side and overflows on the RESULT — `UPDATE t SET total = total + $1`, where
// $1 is a client value at or above the threshold and the accumulated SUM is what
// overflows — would be misattributed to the client. Checked, not assumed: no route in
// apps/api performs SQL-side accumulation arithmetic today (the only `sql` template
// touching a column is the CASE expression in tenant-db.ts updateThroughChainMany,
// which binds values directly). If such a write is ever added, this module must gate
// on the statement shape too, NOT be widened to cover it.
//
// DO NOT widen this to "SQLSTATE starts with 22". That class contains 22012
// division_by_zero and 22023 invalid_parameter_value, both of which are SERVER faults
// (see PG_CLIENT_INPUT_CODES). A prefix match cannot be defended; the list below can.

/** The flat contract Error body (packages/contracts/openapi.yaml `Error`). */
export interface ClientDataViolation {
  code: "VALIDATION";
  message: string;
}

/**
 * SQLSTATEs a CLIENT VALUE can genuinely provoke, decided per code rather than by
 * class. Each entry still has to pass the provenance test above — this list only
 * bounds the blast radius; it is not itself the safety argument.
 *
 * INCLUDED
 *  · 22003 numeric_value_out_of_range — the measured wedge (`pct = 100000` into
 *    numeric(6,3)). 122 numeric(p,s) columns sit behind opaque-body routes.
 *  · 22P02 invalid_text_representation — reachable and measured 500 today: a
 *    malformed uuid in a path segment (GET /subcon-contracts/not-a-uuid/periods).
 *    This is the phone-shaped failure — an offline client replaying a locally
 *    minted temp id — so it wedges the same queue for the same reason.
 *  · 22007 invalid_datetime_format / 22008 datetime_field_overflow — a client date
 *    string off an opaque body; measured 500 today (`start: "2026-13-99"` → 22008).
 *    Caveat, measured: 22007 sometimes quotes the FORMAT rather than the value
 *    (`invalid value "bogu" for "YYYY"`). The provenance test is what makes that safe
 *    — "YYYY" is not in the request, so such an error keeps its 500 rather than being
 *    reported as a bad client value.
 *
 * EXCLUDED, with the reason each exclusion is a measurement and not a hunch:
 *  · 22001 string_data_right_truncation — STRUCTURALLY UNREACHABLE here. The schema
 *    declares ZERO `varchar(n)` columns (counted: 0 across packages/db/src/schema);
 *    every text column is unbounded `text`, which cannot right-truncate. Including it
 *    would be speculative code with no test that could ever fail on revert.
 *  · 22012 division_by_zero — the division is performed BY the server. A client value
 *    can at most be a zero divisor; the fault is the server's missing guard, and that
 *    must stay loud.
 *  · 22023 invalid_parameter_value — raised by function arguments that are
 *    server-authored SQL literals (measured: `date_trunc('bogus', now())`, routine
 *    `timestamptz_trunc_internal`). No route binds a client value into that position.
 *    This exclusion is LOAD-BEARING rather than decorative, which is why it has its own
 *    test: 22023 also covers `invalid hexadecimal digit: "Z"` (measured, from
 *    `'\xZZ'::bytea`), whose message DOES end in a quoted literal. That value is fully
 *    attributable to the client, so candidate extraction alone would happily remap it —
 *    only this list refuses. Widening to `code.startsWith("22")` re-opens exactly that.
 */
export const PG_CLIENT_INPUT_CODES = new Set([
  "22003",
  "22P02",
  "22007",
  "22008",
]);

/** The client-controlled scalar surface of a request (body ∪ path params ∪ query). */
export interface ClientRequestValues {
  body?: unknown;
  params?: unknown;
  query?: unknown;
}

/**
 * The Postgres DatabaseError behind an error, at either nesting level.
 *
 * Mirrors gl-post.ts isUniqueViolation()/violatedConstraint(): the pg driver puts the
 * SQLSTATE on `.code`, and drizzle nests the DatabaseError under `.cause`. Every
 * handler statement goes THROUGH drizzle, so the nested lookup is the load-bearing
 * one — reading only `err.code` yields undefined in production.
 */
function pgError(err: unknown): { code?: string; message?: string; detail?: string } | null {
  const at = (e: unknown): { code?: string; message?: string; detail?: string } | null => {
    if (!e || typeof e !== "object") return null;
    const code = (e as { code?: unknown }).code;
    if (typeof code !== "string") return null;
    const msg = (e as { message?: unknown }).message;
    const detail = (e as { detail?: unknown }).detail;
    return {
      code,
      message: typeof msg === "string" ? msg : undefined,
      detail: typeof detail === "string" ? detail : undefined,
    };
  };
  const own = at(err);
  if (own) return own;
  return at(err && typeof err === "object" ? (err as { cause?: unknown }).cause : undefined);
}

/** The bound parameter list drizzle attaches to a failed query, or [] when absent. */
function boundParams(err: unknown): unknown[] {
  if (!err || typeof err !== "object") return [];
  const p = (err as { params?: unknown }).params;
  return Array.isArray(p) ? p : [];
}

/**
 * Parse a finite number out of an opaque scalar, mirroring the routes' own `toNum`
 * (subcon.ts / boq.ts / ai-qto.ts) INCLUDING its comma stripping — a client that sends
 * `"100,000"` supplied the value the handler bound as `100000`, and provenance has to
 * see that as the same value or it would wrongly read a client value as server-made.
 */
function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Depth cap — an attacker-supplied body must not be able to make this walk expensive. */
const MAX_DEPTH = 8;

/** Every scalar leaf of a client-supplied structure, as raw values. */
function collectScalars(value: unknown, out: unknown[], depth = 0): void {
  if (value === null || value === undefined || depth > MAX_DEPTH) return;
  if (Array.isArray(value)) {
    for (const v of value) collectScalars(v, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectScalars(v, out, depth + 1);
    }
    return;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    out.push(value);
  }
}

/** All scalars the client supplied across body, path params and query. */
function clientScalars(client: ClientRequestValues): unknown[] {
  const out: unknown[] = [];
  collectScalars(client.body, out);
  collectScalars(client.params, out);
  collectScalars(client.query, out);
  return out;
}

/**
 * The values that could have provoked `code`, recovered WITHOUT per-column knowledge.
 *
 * Returns numeric candidates for 22003 (bound params at or above the threshold the
 * `detail` states) and the single quoted literal for the syntax/datetime codes (which,
 * unlike 22003, name the offending value in the message). An empty result means "no
 * attribution possible" and the caller must keep the 500.
 */
function offendingCandidates(
  code: string,
  pg: { message?: string; detail?: string },
  err: unknown,
): { numbers: number[]; strings: string[] } {
  if (code === "22003") {
    // "A field with precision 6, scale 3 must round to an absolute value less than 10^3."
    // No 10^N (e.g. "cannot hold an infinite value") ⇒ no threshold ⇒ no candidates.
    const m = /less than 10\^(-?\d+)/.exec(pg.detail ?? "");
    if (!m) return { numbers: [], strings: [] };
    const threshold = Math.pow(10, Number(m[1]));
    if (!Number.isFinite(threshold)) return { numbers: [], strings: [] };
    const numbers: number[] = [];
    for (const p of boundParams(err)) {
      const n = asFiniteNumber(p);
      if (n !== null && Math.abs(n) >= threshold) numbers.push(n);
    }
    return { numbers, strings: [] };
  }
  // 22P02 / 22007 / 22008 quote the offending literal at the end of the message, e.g.
  //   invalid input syntax for type uuid: "not-a-uuid"
  //   date/time field value out of range: "2026-13-99"
  const m = /: "([\s\S]*)"$/.exec(pg.message ?? "");
  return m ? { numbers: [], strings: [m[1]] } : { numbers: [], strings: [] };
}

/**
 * Map a Postgres data exception to a 400 VALIDATION body IFF the client supplied the
 * offending value; otherwise null, meaning the caller must leave it a 500.
 *
 * Null is the answer for every uncertain case by construction — an unlisted SQLSTATE,
 * an unattributable value, or any candidate the client did not send.
 */
export function clientDataException(
  err: unknown,
  client: ClientRequestValues,
): ClientDataViolation | null {
  const pg = pgError(err);
  if (!pg?.code || !PG_CLIENT_INPUT_CODES.has(pg.code)) return null;

  const { numbers, strings } = offendingCandidates(pg.code, pg, err);
  if (numbers.length === 0 && strings.length === 0) return null;

  const supplied = clientScalars(client);
  const suppliedNumbers = supplied
    .map(asFiniteNumber)
    .filter((n): n is number => n !== null);
  const suppliedStrings = new Set(supplied.map((v) => String(v)));

  // EVERY candidate must be traceable to the request. One that is not means the server
  // produced a value its own schema refuses, and that must not be dressed up as the
  // caller's mistake.
  if (!numbers.every((n) => suppliedNumbers.includes(n))) return null;
  if (!strings.every((s) => suppliedStrings.has(s))) return null;

  const offenders = [...numbers.map((n) => String(n)), ...strings];
  const message =
    pg.code === "22003"
      ? `Value ${offenders.join(", ")} is outside the range this field accepts`
      : `Value "${offenders.join('", "')}" is not in a format this field accepts`;
  return { code: "VALIDATION", message };
}

// B-390 — G3 unit tests for the Postgres data-exception remap.
//
// THE PROPERTY UNDER TEST, stated as the thing that could go wrong:
// a class-22 data exception must become a 400 when the CLIENT supplied the offending
// value (so a field phone dead-letters it instead of wedging its whole offline queue
// on a 5xx), and must REMAIN a 500 when the SERVER computed it (so a money bug stays
// loud instead of being misreported as the caller's mistake).
//
// Every error shape below is a TRANSCRIPT of a real Postgres 16 error measured through
// pg 8 + drizzle-orm 0.45 — the `detail` strings, the `message` strings and the
// `routine` values are copied from that probe, not invented. That matters more than
// usual here: the whole discriminator reads `detail` for the overflow threshold and
// `message` for the offending literal, so a plausible-looking-but-wrong fixture would
// make these tests agree with a broken implementation.
import { describe, expect, it } from "vitest";
import { clientDataException, PG_CLIENT_INPUT_CODES } from "./pg-data-exception.js";

/** A raw pg DatabaseError, as the driver presents it (SQLSTATE on `.code`). */
function pgErr(fields: {
  code: string;
  message?: string;
  detail?: string;
}): Error & Record<string, unknown> {
  const e = new Error(fields.message ?? "db error") as Error & Record<string, unknown>;
  e.code = fields.code;
  if (fields.detail !== undefined) e.detail = fields.detail;
  return e;
}

/**
 * The shape drizzle actually throws: DrizzleQueryError { cause: DatabaseError, params }.
 * gl-post.ts records that reading only `err.code` yields undefined in production
 * because of this nesting, so the nested form is the one that matters.
 */
function drizzleErr(
  fields: { code: string; message?: string; detail?: string },
  params: unknown[],
): Error & Record<string, unknown> {
  const e = new Error("Failed query: ...") as Error & Record<string, unknown>;
  e.cause = pgErr(fields);
  e.params = params;
  return e;
}

// --- measured 22003 details ------------------------------------------------
/** work_period.pct numeric(6,3) — the measured wedge. Threshold 10^3. */
const OVERFLOW_6_3 =
  "A field with precision 6, scale 3 must round to an absolute value less than 10^3.";
/** ap_billing.amount numeric(16,2) — where the server-computed gross overflows. */
const OVERFLOW_16_2 =
  "A field with precision 16, scale 2 must round to an absolute value less than 10^14.";
/** String(Infinity) reaching a numeric column — measured routine apply_typmod_special. */
const OVERFLOW_INFINITE = "A field with precision 16, scale 2 cannot hold an infinite value.";

describe("B-390 clientDataException — the client-sent case becomes a 400", () => {
  it("22003 from a body value (the measured wedge: pct=100000 into numeric(6,3))", () => {
    const err = drizzleErr(
      { code: "22003", message: "numeric field overflow", detail: OVERFLOW_6_3 },
      ["contract-uuid", 1, "percent", "0", "100000", "500", "THB", "pending"],
    );
    expect(
      clientDataException(err, {
        body: { periods: [{ basis: "percent", seq: 1, pct: 100000, amount: 500 }] },
      }),
    ).toEqual({
      code: "VALIDATION",
      message: "Value 100000 is outside the range this field accepts",
    });
  });

  it("22P02 from a PATH param (the measured GET /subcon-contracts/not-a-uuid/periods)", () => {
    // Provenance lives in request.params here, not the body — a body-only search
    // would leave this route 500ing, and it is the phone-shaped failure (an offline
    // client replaying a locally minted temp id).
    const err = drizzleErr(
      { code: "22P02", message: 'invalid input syntax for type uuid: "not-a-uuid"' },
      ["company-uuid", "not-a-uuid"],
    );
    expect(clientDataException(err, { params: { id: "not-a-uuid" } })).toEqual({
      code: "VALIDATION",
      message: 'Value "not-a-uuid" is not in a format this field accepts',
    });
  });

  it("22008 from a body date string (measured: start='2026-13-99')", () => {
    const err = drizzleErr(
      { code: "22008", message: 'date/time field value out of range: "2026-13-99"' },
      ["vendor", "project", "B390", "1", "THB", "0", "2026-13-99", null],
    );
    expect(clientDataException(err, { body: { start: "2026-13-99" } })).toEqual({
      code: "VALIDATION",
      message: 'Value "2026-13-99" is not in a format this field accepts',
    });
  });

  it("finds the value in the QUERY string too", () => {
    const err = drizzleErr(
      { code: "22P02", message: 'invalid input syntax for type integer: "twelve"' },
      ["twelve"],
    );
    expect(clientDataException(err, { query: { limit: "twelve" } })).not.toBeNull();
  });

  it("matches a comma-formatted client value against the bound number", () => {
    // The routes' own toNum() strips commas, so "100,000" in the body IS the 100000
    // that was bound. Missing this would read a client value as server-made.
    const err = drizzleErr(
      { code: "22003", message: "numeric field overflow", detail: OVERFLOW_6_3 },
      ["100000"],
    );
    expect(clientDataException(err, { body: { pct: "100,000" } })).not.toBeNull();
  });

  it("reads the SQLSTATE off a RAW pg error too (no drizzle nesting)", () => {
    const e = pgErr({ code: "22P02", message: 'invalid input syntax for type uuid: "abc"' });
    expect(clientDataException(e, { params: { id: "abc" } })).not.toBeNull();
  });
});

describe("B-390 clientDataException — the server-computed case STAYS a 500", () => {
  it("a server-computed gross the request never mentions is NOT remapped", () => {
    // The live counterpart: POST /periods/:id/approve-payment carries an EMPTY body,
    // and gross = (pct/100) x contract.value = 999998999999990.00 overflows
    // ap_billing.amount. Nothing in the request contains that number.
    const err = drizzleErr(
      { code: "22003", message: "numeric field overflow", detail: OVERFLOW_16_2 },
      ["company", null, null, "vendor", "999998999999990.00", "0.00", "THB", "draft"],
    );
    expect(
      clientDataException(err, { body: {}, params: { id: "period-uuid" } }),
    ).toBeNull();
  });

  it("String(Infinity) — no 10^N threshold, so nothing is attributable", () => {
    // The statement also binds a perfectly ordinary CLIENT value (5000, in the body).
    // That is deliberate: it makes the THRESHOLD PARSE the only thing keeping this a
    // 500. Drop the "no 10^N ⇒ no candidates" guard and 5000 becomes an attributable
    // candidate the client did send, and a JS divide-by-zero starts answering 400.
    const err = drizzleErr(
      { code: "22003", message: "numeric field overflow", detail: OVERFLOW_INFINITE },
      ["Infinity", "5000"],
    );
    expect(clientDataException(err, { body: { amount: 5000 } })).toBeNull();
  });

  it("String(undefined) reaching a numeric column is a SERVER bug, not a 400", () => {
    const err = drizzleErr(
      { code: "22P02", message: 'invalid input syntax for type numeric: "undefined"' },
      ["undefined"],
    );
    expect(clientDataException(err, { body: { pct: 5 } })).toBeNull();
  });

  it("EVERY candidate must be client-sent — one server value poisons the remap", () => {
    // THE QUANTIFIER TEST. A statement binding BOTH a client value at/above the
    // threshold AND a server-computed one must stay 500: we cannot tell which of the
    // two overflowed, so the only safe answer is the loud one.
    const err = drizzleErr(
      { code: "22003", message: "numeric field overflow", detail: OVERFLOW_6_3 },
      ["100000", "77777"],
    );
    expect(clientDataException(err, { body: { pct: 100000 } })).toBeNull();
  });

  it("no bound params at all → unattributable → 500", () => {
    const err = drizzleErr(
      { code: "22003", message: "numeric field overflow", detail: OVERFLOW_6_3 },
      [],
    );
    expect(clientDataException(err, { body: { pct: 100000 } })).toBeNull();
  });

  it("a value BELOW the threshold is never treated as the offender", () => {
    // 500 < 10^3, so it cannot have overflowed numeric(6,3); with no candidate at or
    // above the threshold there is nothing to attribute.
    const err = drizzleErr(
      { code: "22003", message: "numeric field overflow", detail: OVERFLOW_6_3 },
      ["500"],
    );
    expect(clientDataException(err, { body: { amount: 500 } })).toBeNull();
  });
});

describe("B-390 the code list is a decision, not a prefix match", () => {
  it.each([
    ["22012", "division by zero", "the server performed the division"],
    ["22023", 'unit "bogus" not recognized for type timestamp with time zone', "server SQL literal"],
    ["22001", "value too long for type character varying(4)", "no varchar(n) column exists"],
  ])("%s stays a 500 (%s)", (code, message) => {
    const err = drizzleErr({ code, message }, ["whatever"]);
    expect(clientDataException(err, { body: { a: "whatever" } })).toBeNull();
  });

  it("THE ALLOW-LIST IS THE ONLY THING refusing an excluded code that IS attributable", () => {
    // The three cases above pass for a second reason — their messages carry no
    // trailing quoted literal, so candidate extraction finds nothing regardless of the
    // allow-list. They therefore do NOT prove the exclusions are load-bearing, and a
    // revert probe (swap the Set for `code.startsWith("22")`) left them all green.
    //
    // This one does prove it. `select '\xZZ'::bytea` raises SQLSTATE 22023 with the
    // measured message `invalid hexadecimal digit: "Z"` — an EXCLUDED code whose
    // message DOES end in a quoted literal, so the value is fully attributable and the
    // client really did send it. Only PG_CLIENT_INPUT_CODES stands between that and a
    // 400. Widen the gate to a class-22 prefix and this test dies.
    const err = drizzleErr({ code: "22023", message: 'invalid hexadecimal digit: "Z"' }, ["Z"]);
    expect(clientDataException(err, { body: { data: "Z" } })).toBeNull();
  });

  it("the set records the per-code decision (not a prefix)", () => {
    for (const code of ["22012", "22023", "22001", "2200B", "22P01"]) {
      expect(PG_CLIENT_INPUT_CODES.has(code)).toBe(false);
    }
    for (const code of ["22003", "22P02", "22007", "22008"]) {
      expect(PG_CLIENT_INPUT_CODES.has(code)).toBe(true);
    }
  });

  it("a non-data-exception (23505 unique violation) is untouched", () => {
    // The B-261/B-263 idempotency handlers own 23505; this must not intercept it.
    const err = drizzleErr({ code: "23505", message: "duplicate key value" }, ["k"]);
    expect(clientDataException(err, { body: { key: "k" } })).toBeNull();
  });

  it("a plain non-database Error is untouched", () => {
    expect(clientDataException(new Error("null deref"), { body: {} })).toBeNull();
    expect(clientDataException(undefined, { body: {} })).toBeNull();
  });
});

describe("B-390 the request walk", () => {
  it("finds a value nested in arrays/objects (opaque Entity bodies are nested)", () => {
    const err = drizzleErr(
      { code: "22003", message: "numeric field overflow", detail: OVERFLOW_6_3 },
      ["100000"],
    );
    expect(
      clientDataException(err, { body: { a: [{ b: { c: [{ pct: 100000 }] } }] } }),
    ).not.toBeNull();
  });

  it("stops descending past the depth cap rather than walking a hostile body", () => {
    // 12 levels deep, past MAX_DEPTH=8: the value is not found, so the answer is the
    // SAFE one (500), not a 400 built from an unbounded walk.
    let body: Record<string, unknown> = { pct: 100000 };
    for (let i = 0; i < 12; i += 1) body = { nest: body };
    const err = drizzleErr(
      { code: "22003", message: "numeric field overflow", detail: OVERFLOW_6_3 },
      ["100000"],
    );
    expect(clientDataException(err, { body })).toBeNull();
  });
});

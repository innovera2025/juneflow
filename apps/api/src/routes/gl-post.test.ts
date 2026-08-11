// G3 unit tests (PLAN.md §9) — B-318 / B-168 doc-number allocation under
// concurrency: withDocNoRetry, DocNoExhaustedError and the 503 terminal reply.
//
// WHY THIS SUITE EXISTS. allocJvNo / allocDepositNo are plain `max(suffix)+1`
// reads. Observed LIVE on a real PG 16 before migration 0061: six concurrent,
// genuinely DISTINCT POST /ap/deposit minted DP-2026-0001 ×3 / DP-2026-0002 ×2 and
// JV-2026-0419 ×2 — six real payments, three deposit numbers, four JV numbers. The
// unique index alone does NOT fix that: with 0061 applied and no retry, four of the
// six came back 409 "already posted" (false — nothing was posted, the NUMBER
// collided), and apps/mobile/lib/offline/sync_processor.dart dead-letters every 4xx
// PERMANENTLY. The index and this retry are one fix in two halves.
//
// WHAT THIS SUITE CAN AND CANNOT PROVE. It exercises the retry CONTRACT — which
// errors are retried, which are passed straight through, what the caller sees on
// exhaustion — against synthetic driver errors in the exact nested shape drizzle
// produces. It cannot prove uniqueness itself (no unique index exists in a fake) or
// transaction rollback semantics; those are proven against a live PG 16 with a
// negative control, and only there. A test that asserted "no duplicate numbers"
// against a store with no index would be proving the double, not the property.
import { describe, expect, it, vi } from "vitest";
import {
  allocJvNo,
  DEPOSIT_COMPANY_NO_CONSTRAINT,
  DEPOSIT_NO_CONSTRAINTS,
  DocNoExhaustedError,
  docNoExhausted,
  isUniqueViolation,
  JV_COMPANY_NO_CONSTRAINT,
  JV_NO_CONSTRAINTS,
  violatedConstraint,
  withDocNoRetry,
} from "./gl-post.js";

/**
 * A raw pg unique-violation (SQLSTATE 23505) — the DatabaseError node-postgres
 * throws, naming the violated index on `.constraint`.
 */
const pgUniqueViolation = (constraint: string | null): Error =>
  Object.assign(
    new Error(`duplicate key value violates unique constraint "${constraint ?? "?"}"`),
    constraint === null ? { code: "23505" } : { code: "23505", constraint },
  );

/**
 * The shape the HANDLER actually sees. Every insert goes through drizzle, which
 * wraps the driver error in a DrizzleQueryError and nests the DatabaseError under
 * `.cause` — so `err.constraint` alone is `undefined` in production (B-263). Every
 * test here throws the NESTED shape, because a suite that only threw the flat one
 * would stay green against a retry that read `err.constraint` directly while
 * production silently never retried at all.
 */
const uniqueViolation = (constraint: string | null): Error =>
  Object.assign(new Error("Failed query"), { cause: pgUniqueViolation(constraint) });

/** A minimal FastifyReply double that records code() + send(). */
function fakeReply(): {
  reply: Parameters<typeof docNoExhausted>[0];
  status: () => number | null;
  body: () => unknown;
} {
  let status: number | null = null;
  let body: unknown = null;
  const reply = {
    code(c: number) {
      status = c;
      return this;
    },
    send(b: unknown) {
      body = b;
      return this;
    },
  };
  return {
    reply: reply as unknown as Parameters<typeof docNoExhausted>[0],
    status: () => status,
    body: () => body,
  };
}

describe("B-263 error shape — the NEW 0061 constraints read through the nested cause", () => {
  it("violatedConstraint names jv_company_no_uq / ap_deposit_company_no_uq under .cause", () => {
    // Verified against the real runtime while reproducing the defect:
    //   err.constraint === undefined | err.cause.constraint === "jv_company_no_uq"
    expect(violatedConstraint(uniqueViolation(JV_COMPANY_NO_CONSTRAINT))).toBe(
      "jv_company_no_uq",
    );
    expect(violatedConstraint(uniqueViolation(DEPOSIT_COMPANY_NO_CONSTRAINT))).toBe(
      "ap_deposit_company_no_uq",
    );
    // …and the flat top-level shape still resolves (raw pg, no drizzle wrapper).
    expect(violatedConstraint(pgUniqueViolation(JV_COMPANY_NO_CONSTRAINT))).toBe(
      "jv_company_no_uq",
    );
  });
});

describe("withDocNoRetry — what it retries", () => {
  it("re-runs the closure after a jv_company_no_uq collision and returns the later attempt's value", async () => {
    let attempts = 0;
    const result = await withDocNoRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw uniqueViolation(JV_COMPANY_NO_CONSTRAINT);
      return `attempt-${attempts}`;
    });
    expect(attempts).toBe(3);
    expect(result).toBe("attempt-3");
  });

  it("RE-ALLOCATES on every attempt — the number is not carried over stale", async () => {
    // This is the load-bearing property. A retry that re-ran only the transaction,
    // reusing the number the losing attempt already read, would collide forever:
    // the winner has committed that exact number. The closure must re-read the max.
    const committed = ["JV-2026-0001"];
    const seen: string[] = [];
    const db = {
      select: async () => committed.map((no) => ({ no })),
    } as unknown as Parameters<typeof allocJvNo>[0];
    vi.setSystemTime(new Date("2026-05-01T00:00:00Z"));
    await withDocNoRetry(async () => {
      const no = await allocJvNo(db);
      seen.push(no);
      if (seen.length < 3) {
        // Model the race honestly: the racer that beat us COMMITTED this number, so
        // it is visible to the next read. Then we lose on the index.
        committed.push(no);
        throw uniqueViolation(JV_COMPANY_NO_CONSTRAINT);
      }
    });
    vi.useRealTimers();
    expect(seen).toEqual(["JV-2026-0002", "JV-2026-0003", "JV-2026-0004"]);
    expect(new Set(seen).size).toBe(seen.length); // never re-offers a taken number
  });

  it("succeeds on the first attempt with no retry and no delay (the ordinary path)", async () => {
    const started = Date.now();
    let attempts = 0;
    const result = await withDocNoRetry(async () => {
      attempts += 1;
      return "ok";
    });
    expect(attempts).toBe(1);
    expect(result).toBe("ok");
    // No backoff is paid when nothing collided.
    expect(Date.now() - started).toBeLessThan(50);
  });

  it("retries ap_deposit_company_no_uq for the deposit handler's constraint set", async () => {
    let attempts = 0;
    await withDocNoRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) throw uniqueViolation(DEPOSIT_COMPANY_NO_CONSTRAINT);
      },
      DEPOSIT_NO_CONSTRAINTS,
    );
    expect(attempts).toBe(2);
  });
});

describe("withDocNoRetry — what it must NOT retry", () => {
  // Every one of these is a 23505 too. Retrying any of them would re-run a write
  // whose OWN handler branch is the correct answer — an idempotency replay would be
  // re-attempted instead of resolved, a duplicate instalment would be re-posted.
  it.each([
    ["ap_deposit_idempotency_uq (B-313 replay)", "ap_deposit_idempotency_uq"],
    ["jv_source_doc_uq (double-post guard)", "jv_source_doc_uq"],
    ["material_issue_idempotency_uq (B-312)", "material_issue_idempotency_uq"],
    ["down_payment_txn seq (B-167)", "down_payment_txn_unit_seq_uq"],
    ["ar_invoice_company_no_uq (B-217)", "ar_invoice_company_no_uq"],
  ])("passes %s straight through on the FIRST throw", async (_label, constraint) => {
    let attempts = 0;
    await expect(
      withDocNoRetry(async () => {
        attempts += 1;
        throw uniqueViolation(constraint);
      }),
    ).rejects.toThrow("Failed query");
    expect(attempts).toBe(1);
  });

  it("does not retry a 23505 that names NO constraint", async () => {
    // Fail closed: without a name we cannot know it is ours. Falling through to the
    // handler's own catch is the safe direction (a 409, never a silent re-post).
    let attempts = 0;
    await expect(
      withDocNoRetry(async () => {
        attempts += 1;
        throw uniqueViolation(null);
      }),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it("does not retry a non-23505 error, and re-throws it untouched", async () => {
    const boom = new Error("connection terminated");
    let attempts = 0;
    await expect(
      withDocNoRetry(async () => {
        attempts += 1;
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(attempts).toBe(1);
  });

  it("does not retry a business error thrown from inside the transaction", async () => {
    // NegativeStockError / StaleStateError / ConcurrentPostError all travel this
    // path — they are real conflicts, not contention, and must reach their branch.
    class StaleStateError extends Error {}
    let attempts = 0;
    await expect(
      withDocNoRetry(async () => {
        attempts += 1;
        throw new StaleStateError("asset is not active");
      }),
    ).rejects.toBeInstanceOf(StaleStateError);
    expect(attempts).toBe(1);
  });
});

describe("withDocNoRetry — exhaustion", () => {
  it("gives up after the bound and throws DocNoExhaustedError naming the constraint", async () => {
    let attempts = 0;
    const err = await withDocNoRetry(async () => {
      attempts += 1;
      throw uniqueViolation(JV_COMPANY_NO_CONSTRAINT);
    }, JV_NO_CONSTRAINTS, 4).catch((e: unknown) => e);
    expect(attempts).toBe(4);
    expect(err).toBeInstanceOf(DocNoExhaustedError);
    expect((err as DocNoExhaustedError).constraintName).toBe("jv_company_no_uq");
    expect((err as DocNoExhaustedError).attempts).toBe(4);
  });

  it("the exhaustion error is NOT a unique violation — no bare isUniqueViolation catch can swallow it", async () => {
    // THE POINT of the dedicated class. Eleven handlers carry a bare
    // `if (isUniqueViolation(err)) return conflict(... "already posted")`. If
    // exhaustion re-threw the raw 23505, every one of them would confidently report
    // a posting that never happened. This assertion is what keeps that impossible.
    const err = await withDocNoRetry(
      async () => {
        throw uniqueViolation(JV_COMPANY_NO_CONSTRAINT);
      },
      JV_NO_CONSTRAINTS,
      2,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DocNoExhaustedError);
    expect(isUniqueViolation(err)).toBe(false);
    expect(violatedConstraint(err)).toBeUndefined();
  });

  it("defaults to 10 attempts (the MEASURED floor — 5 starved the tail at N=20)", async () => {
    let attempts = 0;
    await expect(
      withDocNoRetry(async () => {
        attempts += 1;
        throw uniqueViolation(JV_COMPANY_NO_CONSTRAINT);
      }),
    ).rejects.toBeInstanceOf(DocNoExhaustedError);
    expect(attempts).toBe(10);
  });

  it("backs off between attempts rather than hot-looping onto the same number", async () => {
    // Measured on a live PG 16: with no backoff the losers wake together and thunder
    // onto the same next number — N=20 finished 12/20 within the bound; with this
    // jitter, 20/20. The assertion is only that time IS spent, not how much.
    const started = Date.now();
    await withDocNoRetry(
      async () => {
        throw uniqueViolation(JV_COMPANY_NO_CONSTRAINT);
      },
      JV_NO_CONSTRAINTS,
      5,
    ).catch(() => undefined);
    expect(Date.now() - started).toBeGreaterThanOrEqual(20); // ≥ 4 × the 5 ms floor
  });
});

describe("docNoExhausted — the terminal reply", () => {
  it("answers 503 RETRY, never a 4xx", async () => {
    // 503, not 409, is load-bearing: exhaustion is TRANSIENT contention and nothing
    // was committed, so the request is safe to repeat — and sync_processor.dart
    // dead-letters every 4xx permanently while deferring 5xx. A 409 here would
    // strand a payment the user still owes with no in-app recovery.
    const { reply, status, body } = fakeReply();
    docNoExhausted(reply);
    expect(status()).toBe(503);
    expect(status()).toBeGreaterThanOrEqual(500);
    const sent = body() as { code: string; message: string };
    expect(sent.code).toBe("RETRY");
    // The message must not claim the document exists.
    expect(sent.message).not.toMatch(/already/i);
    expect(sent.message).toMatch(/nothing was posted/i);
  });
});

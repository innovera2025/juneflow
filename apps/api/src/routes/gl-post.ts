// GL posting — the SINGLE source of truth for the doc-type → account map and the
// helpers a source money doc uses to become a balanced JV. Shared by /gl/post
// (gl.ts), CN approve (ar.ts), and FA depreciation + revalue/write-off (fa.ts) so
// the double-entry account map + JV-numbering + tenant-scoped account resolution
// never diverge across the finance handlers.
//
// POSTING MAP — DERIVED from the seed JV_BOOKS (Wei B-122 Q2: derive from
// JV_BOOKS → fixed map in code → confirm-before-merge). Each rule cites whether
// it has a REAL seed exemplar or is EXTRAPOLATED (no exemplar — flagged for the
// map-confirm blocker, never silently invented):
//   rv       Dr 1020 bank      / Cr 1030 AR        REAL  (JV-2026-0418 "REM")
//   gr       Dr 5020 materials / Cr 2010 AP        REAL  (JV-2026-0416 "GR auto")
//   pv       Dr 2010 AP        / Cr 1020 bank      EXTRAPOLATED (no PV exemplar)
//   payroll  Dr 1140 WIP-labor / Cr 1020 bank      EXTRAPOLATED (no payroll exemplar)
//     ^ RESOLVED (B-144, Wei=ก): realigned 5030→1140 so the generic /gl/post inbox
//       path and the dedicated POST /labor/payroll/{id}/post (B-140) capitalise labor
//       to the SAME account (Dr 1140 WIP). Both share source_doc payroll:<id> → the
//       jv_source_doc_uq index still lets only one win (no double-post), and now the
//       GL account no longer depends on which endpoint fires.
// Direct-posting handlers (not inbox-sourced) use the ACCT codes below:
//   fa depr  Dr 5100 admin-exp / Cr 1210 PP&E      REAL  (JV-2026-0414 "FA auto")
//   cn       Dr 4010 revenue + Dr 2050 VAT / Cr 1030 AR   EXTRAPOLATED (invoice reversal)
// (The prototype's 5301/1502-4 accounts are NOT in COA_SEED and are deliberately
// not hardcoded — Wei C-177. Codes resolve to ids per-tenant at post time.)
import { inArray } from "drizzle-orm";
import { glAccounts, jvs } from "@juneflow/db/schema";
import type { FastifyReply } from "fastify";
import type { TenantDb } from "../db/tenant-db.js";

/**
 * A Postgres UNIQUE-violation (SQLSTATE 23505). P2-BE-52: jv.source_doc carries a
 * partial UNIQUE index (migration 0037) so a source money doc can be posted at
 * most ONCE even under a concurrent race the check-then-insert can't cover. When
 * the losing transaction's jv insert trips that constraint, the posting handler
 * maps it to the SAME idempotent outcome as the pre-check (409 / skip "already
 * posted") instead of a 500. The pg driver puts the SQLSTATE on `.code`; drizzle
 * may nest the driver error under `.cause`, so check both.
 */
export function isUniqueViolation(err: unknown): boolean {
  const code = (e: unknown): unknown =>
    e && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
  if (code(err) === "23505") return true;
  const cause = err && typeof err === "object" ? (err as { cause?: unknown }).cause : undefined;
  return code(cause) === "23505";
}

/**
 * The NAME of the unique constraint/index a Postgres error violated, or undefined
 * when the error carries no such name. B-263: SQLSTATE 23505 says "SOME unique
 * constraint was violated" — it does NOT say WHICH. A handler that maps 23505 to one
 * specific business outcome (the B-261 POST /gr idempotency replay) must therefore
 * gate on the constraint NAME as well, or a future unique index added to the same
 * table silently inherits that outcome and answers the wrong thing. Pair this with
 * isUniqueViolation() (the SQLSTATE precondition) on every money-write that copies
 * the B-261 template.
 *
 * Error shape VERIFIED against the real runtime (pg 8 + drizzle-orm 0.45 against a
 * live PG 16), not assumed:
 *   raw pg      → DatabaseError    { code: "23505", constraint: "<index name>" }
 *   via drizzle → DrizzleQueryError { cause: DatabaseError { code, constraint } }
 * Every handler insert/update goes THROUGH drizzle, so the nested lookup is the
 * load-bearing one — reading only `err.constraint` yields undefined in production.
 * Mirrors isUniqueViolation()'s own two-level check.
 */
export function violatedConstraint(err: unknown): string | undefined {
  const name = (e: unknown): string | undefined => {
    if (!e || typeof e !== "object") return undefined;
    const c = (e as { constraint?: unknown }).constraint;
    return typeof c === "string" && c ? c : undefined;
  };
  const cause = err && typeof err === "object" ? (err as { cause?: unknown }).cause : undefined;
  return name(err) ?? name(cause);
}

/** The posting-inbox source kinds that have a real backing table (gl-posting.ts). */
export type GlPostableKind = "pv" | "rv" | "gr" | "payroll" | "petty";

export interface PostingRule {
  /** Debit account code. */
  dr: string;
  /** Credit account code. */
  cr: string;
  /** Which money field on the source row funds the JV. */
  basis: "amount" | "net";
  /** true = a real JV_BOOKS seed exemplar backs this map; false = extrapolated. */
  real: boolean;
  note: string;
}

/** doc-type → account-code posting map (derived from seed JV_BOOKS · B-122 Q2). */
export const POSTING_MAP: Record<GlPostableKind, PostingRule> = {
  rv: { dr: "1020", cr: "1030", basis: "amount", real: true, note: "JV-2026-0418 REM" },
  // B-348: gr is now POSTABLE — its amount is derived server-side as
  // Σ(gr_item.received_qty × gr_item.price), the same figure GET /gr shows.
  //
  // THE ADJACENCY THAT MUST NOT BE LOST, recorded here because this is where a
  // future change would be made: this Dr 5020 is the ACCRUAL (cost + AP liability
  // at receipt). POST /ap/billing (ap.ts) writes NO JV, and `pv` below is
  // Dr 2010 / Cr 1020 — the SETTLEMENT of that liability, not a second accrual. If
  // AP billing ever starts posting a JV of its own it must NOT debit 5020, or one
  // delivery's cost is counted twice.
  gr: { dr: "5020", cr: "2010", basis: "amount", real: true, note: "JV-2026-0416 GR auto — the ACCRUAL; pv Dr 2010/Cr 1020 settles it (never a 2nd Dr 5020)" },
  pv: { dr: "2010", cr: "1020", basis: "net", real: false, note: "extrapolated — no PV exemplar in JV_BOOKS" },
  payroll: { dr: "1140", cr: "1020", basis: "amount", real: false, note: "B-144: realigned 5030→1140 WIP-labor to match the dedicated POST /labor/payroll/{id}/post (B-140)" },
  // petty (B-233, Wei C-177): a petty-cash CLAIM debits the admin-expense (5100)
  // and credits cash-on-hand (1010) — the ONLY existing COA accounts (the
  // prototype's 52xx/1102 are NOT in COA_SEED, so the claim-MVP posts to real
  // accounts). REAL exemplar: JV_BOOKS seeds Dr 5100 / Cr 1010 for the 8,400 petty
  // vehicle-repair claim (seed/index.ts). value is the claim magnitude (stored > 0).
  petty: { dr: "5100", cr: "1010", basis: "amount", real: true, note: "Dr 5100 admin-exp / Cr 1010 cash-on-hand — REAL JV_BOOKS petty exemplar (Wei C-177: existing accounts only)" },
};

/** Named COA codes the direct-posting handlers (CN, FA, retention, deposit) reference by intent. */
export const ACCT = {
  cash: "1010",
  bank: "1020",
  ar: "1030",
  // สินทรัพย์ตามสัญญา (Unbilled AR) — recognized-but-not-yet-billed construction
  // revenue is a contract ASSET (B-230). A revenue-recognition post debits it:
  // Dr 1130 / Cr 4020 construction-revenue.
  contractAsset: "1130",
  // งานระหว่างก่อสร้าง (WIP/CIP) — accumulated project cost held as inventory. A
  // WIP → COGS transfer credits it (B-230): Dr 5010 COGS / Cr 1140 WIP. (Also the
  // payroll/labor capitalisation target, POSTING_MAP.payroll — B-144.)
  wip: "1140",
  // ที่ดินรอการพัฒนา — land acquired and held for development is an asset. A land
  // buy-deal deposit capitalises here: Dr 1150 / Cr 2010 AP (Program-3 land deal,
  // B-159 Wei=ก). Distinct from a construction WIP account.
  landHeldForDev: "1150",
  // เงินมัดจำจ่ายล่วงหน้า — a deposit PAID to a vendor is an asset (advance to
  // supplier). Paying it: Dr 1160 / Cr 1010 cash (ap.jsx APDeposit · P2-BE-54).
  advanceToSupplier: "1160",
  ap: "2010",
  // เจ้าหนี้เงินประกันผลงานค้างจ่าย — the retention we withheld from a vendor/subcon
  // (a liability). Releasing it back pays the vendor: Dr 2030 / Cr 1020 (P2-BE-53).
  retentionPayable: "2030",
  // เงินมัดจำ/เงินจองรับล่วงหน้า — an advance/booking RECEIVED from a buyer is a
  // liability (unearned). A sales booking / down-payment receipt posts Dr 1020
  // bank / Cr 2040 advance-received (Program-3 sales, B-161 Wei=ก). NOT the AR
  // credit (1030) POSTING_MAP.rv uses — a booking has no invoice behind it yet.
  advanceReceived: "2040",
  vatOutput: "2050",
  revenue: "4010",
  // รายได้ค่าก่อสร้าง (ตามสัญญา) — construction contract revenue, the credit side
  // of a revenue-recognition post (B-230): Dr 1130 contract-asset / Cr 4020.
  constructionRevenue: "4020",
  // ต้นทุนขาย - โอนกรรมสิทธิ์ — cost of sales, the debit side of a WIP → COGS
  // transfer (B-230): Dr 5010 COGS / Cr 1140 WIP.
  cogs: "5010",
  materials: "5020",
  labor: "5030",
  adminExpense: "5100",
  ppe: "1210",
} as const;

/**
 * Resolve COA `code` → account id for THIS tenant (company-scoped select). A code
 * the tenant's COA does not carry is simply absent from the map — the caller
 * treats a missing required code as a fail-closed error (never posts an
 * unbalanced / mis-accounted JV). Returns a Map keyed by code.
 */
export async function resolveAccountIds(
  db: TenantDb,
  codes: string[],
): Promise<Map<string, string>> {
  const uniq = [...new Set(codes)];
  if (uniq.length === 0) return new Map();
  const rows = (await db.select(
    glAccounts,
    inArray(glAccounts.code, uniq),
  )) as (typeof glAccounts.$inferSelect)[];
  return new Map(rows.map((r) => [r.code, r.id]));
}

/**
 * Allocate the next JV number for this tenant — JV-<current-year>-<NNNN>, one past
 * the max numeric suffix among the tenant's existing JV numbers for that year
 * prefix (the seed's JV-2026-0418 → JV-2026-0419). Company-scoped read (fail
 * closed). Deterministic given the current jv set; the caller writes it inside the
 * same posting transaction.
 */
export async function allocJvNo(db: TenantDb): Promise<string> {
  const rows = (await db.select(jvs)) as (typeof jvs.$inferSelect)[];
  const year = new Date().getFullYear();
  const prefix = `JV-${year}-`;
  let max = 0;
  for (const r of rows) {
    const no = r.no ?? "";
    if (!no.startsWith(prefix)) continue;
    const m = /-(\d+)$/.exec(no);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// B-318 / B-168 — doc-number allocation under concurrency
// ---------------------------------------------------------------------------
// THE DEFECT (observed live, not theorised): allocJvNo and ap-deposit's
// allocDepositNo are plain `max(numeric suffix) + 1` reads with nothing behind
// them. Six concurrent, genuinely DISTINCT POST /ap/deposit produced three deposit
// numbers and four JV numbers — DP-2026-0001 ×3, JV-2026-0419 ×2. No amount is
// wrong; the AUDIT TRAIL is, and jv_no is what every ActionOk hands back as the
// voucher reference. This SURVIVES the B-261/B-312/B-313 idempotency work: a client
// key dedupes REPLAYS of one request, whereas this is two different requests
// colliding on a number.
//
// THE FIX IS TWO HALVES AND NEITHER WORKS ALONE (migration 0061):
//   (a) unique(company_id, no) on jv + ap_deposit — makes a duplicate impossible;
//   (b) this retry — makes a LOSER re-allocate instead of being refused.
// Shipping (a) without (b) is a REGRESSION, measured: with both indexes and no
// retry, four of six legitimate vendor deposits came back 409 "already posted" —
// false, nothing was posted, the NUMBER collided — and
// apps/mobile/lib/offline/sync_processor.dart dead-letters every 4xx PERMANENTLY.
// That would turn a duplicated-number problem into silently refused payments.

/** unique(company_id, no) on jv — migration 0061. */
export const JV_COMPANY_NO_CONSTRAINT = "jv_company_no_uq";
/** unique(company_id, no) on ap_deposit — migration 0061. */
export const DEPOSIT_COMPANY_NO_CONSTRAINT = "ap_deposit_company_no_uq";

/** The constraint set a JV-posting handler retries on (every jv insert site). */
export const JV_NO_CONSTRAINTS: readonly string[] = [JV_COMPANY_NO_CONSTRAINT];
/** POST /ap/deposit writes BOTH numbered rows in one tx → it retries on both. */
export const DEPOSIT_NO_CONSTRAINTS: readonly string[] = [
  DEPOSIT_COMPANY_NO_CONSTRAINT,
  JV_COMPANY_NO_CONSTRAINT,
];

/**
 * Doc-number allocation lost the race `attempts` times running.
 *
 * Deliberately NOT a 23505 and NOT an Error the `isUniqueViolation` catches can
 * recognise: every money handler already has a bare `if (isUniqueViolation(err))`
 * arm that answers "already posted" / "already approved" / "already released", and
 * re-throwing the raw driver error would let one of them swallow exhaustion into a
 * confident lie about a posting that never happened. A distinct class forces each
 * handler to add ONE explicit branch, placed FIRST in its catch.
 *
 * NOTHING WAS COMMITTED when this is thrown — the last attempt's transaction rolled
 * back, so the caller may safely retry the whole request.
 */
export class DocNoExhaustedError extends Error {
  /** The unique index that kept tripping. */
  readonly constraintName: string;
  /** How many allocate-and-write attempts were made. */
  readonly attempts: number;
  constructor(constraintName: string, attempts: number) {
    super(
      `document-number allocation lost the race ${attempts} times (${constraintName}) — nothing was committed`,
    );
    this.name = "DocNoExhaustedError";
    this.constraintName = constraintName;
    this.attempts = attempts;
  }
}

/**
 * How many allocate-and-write attempts before giving up. MEASURED, not guessed:
 * simulating the exact design (allocate → insert → retry on the named 23505)
 * against a live PG 16 on one tenant, `attempts` = 5 with no backoff starved the
 * tail badly (N=10 → 6 succeeded; N=20 → 8). With the jittered backoff below,
 * 10 attempts carried N=20 → 20/20 (worst case 8 attempts, 648 ms). DUPLICATE
 * NUMBERS MINTED: zero in every configuration — the only failure mode the bound
 * governs is exhaustion, never a duplicate. Those are single-node localhost
 * numbers with no network RTT; real latency widens each race window, so treat 10
 * as a measured FLOOR, not a tuned production value.
 */
const DOC_NO_ATTEMPTS = 10;

/**
 * Run `fn` — which MUST perform the number ALLOCATION as well as the write —
 * retrying when it trips one of `constraints` BY NAME.
 *
 * Two things about this are load-bearing:
 *
 * 1. THE ALLOCATION MUST BE INSIDE `fn`. Retrying the transaction with the same
 *    stale number just collides again forever; the point of the retry is to
 *    re-read the (now advanced) max.
 *
 * 2. NO SAVEPOINT IS NEEDED, and a naive in-transaction retry would be a no-op
 *    that looks like a fix. Verified against a live PG 16: after a 23505, further
 *    commands in that transaction fail 25P02 "current transaction is aborted", so
 *    an inner retry can never succeed. It works here because of WHERE the
 *    transaction sits: `request.db` is a TenantDb over the ROOT POOLED database
 *    (plugins/tenant-scope.ts) and TenantDb.transaction delegates straight to it,
 *    so every `db.transaction()` in these handlers is TOP-LEVEL. A failed attempt
 *    is therefore already rolled back and its connection released before `fn` is
 *    called again, and the next attempt is a clean BEGIN. (fa.ts allocates INSIDE
 *    its transaction — there the retry wraps the whole `db.transaction()` CALL,
 *    which is still top-level, so the rule holds unchanged.)
 *
 * Gating on the constraint NAME (B-263) is what keeps this from retrying somebody
 * else's uniqueness: an idempotency-key replay, a duplicate source_doc, a duplicate
 * down-payment instalment are all 23505 too, and all of them must propagate on the
 * FIRST throw so their own handler branch answers.
 */
export async function withDocNoRetry<R>(
  fn: () => Promise<R>,
  constraints: readonly string[] = JV_NO_CONSTRAINTS,
  attempts: number = DOC_NO_ATTEMPTS,
): Promise<R> {
  let lastName = constraints[0] ?? JV_COMPANY_NO_CONSTRAINT;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      const name = violatedConstraint(err);
      // Not OUR collision → propagate untouched, first time, every time.
      if (!isUniqueViolation(err) || !name || !constraints.includes(name)) throw err;
      lastName = name;
      if (i === attempts) break;
      // Jittered backoff. Without it the losers all wake together and thunder onto
      // the same next number, so the tail starves (measured: N=20 → 12/20 with no
      // backoff vs 20/20 with it). Grows with the attempt so a heavily contended
      // tenant spreads out instead of hot-looping.
      await new Promise((resolve) =>
        setTimeout(resolve, 5 + Math.floor(Math.random() * 20 * i)),
      );
    }
  }
  throw new DocNoExhaustedError(lastName, attempts);
}

/**
 * The honest terminal answer when withDocNoRetry gives up: 503, NOT 409.
 *
 * Exhaustion is TRANSIENT contention and nothing was committed, so the request is
 * safe — and correct — to repeat. 409 would be a lie twice over: it claims a
 * business conflict that does not exist, and apps/mobile sync_processor.dart
 * dead-letters every 4xx permanently while treating 5xx as deferred/retryable, so a
 * 409 here would strand a payment the user still owes with no in-app recovery.
 */
export function docNoExhausted(reply: FastifyReply): FastifyReply {
  return reply.code(503).send({
    code: "RETRY",
    message:
      "could not allocate a document number under concurrent load — nothing was posted; please retry",
  });
}

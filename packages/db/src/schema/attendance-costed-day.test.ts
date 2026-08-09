// G3 unit tests — the one-day-per-(worker, cost centre) constraint is DECLARED
// (B-338 / B-342). Sibling of attendance-self-day.test.ts, and deliberately written
// to the same shape so the pair reads as one guarantee rather than two half-guards.
//
// WHY THIS FILE EXISTS. `attendance_self_day_uq` is PARTIAL on `cc_id IS NULL`, so it
// cannot see a COSTED pair by construction — that predicate is exactly what keeps the
// legitimate cost-centre split legal. The pair therefore escaped it by design.
// Re-measured live at 2f42244 before this index existed: roster door, two `full` rows,
// one worker, one day, the SAME cc_id, 2 separate client processes → [201,201], two
// rows, day_fraction 2.00, and POST /labor/payroll paid 1000 for one day on a 500/day
// worker. `attendance_costed_day_uq` is the complement, and the two predicates now
// cover every row on the table with nothing in between.
//
// WHAT THIS PROVES, EXACTLY: that the index is DECLARED in both places that make it
// real on a fresh stack — the drizzle schema (what `drizzle-kit generate` reads) and
// the applied migration (what `drizzle-kit migrate` runs). Deleting it from either
// place fails here. REVERT PROBE RUN, and the number is reported rather than claimed:
// deleting the index from schema AND migration turns 5 of the 6 tests below RED, while
// the whole `api` suite stays fully GREEN — which is precisely why this file exists
// and why no api test pretends to cover it.
//
// WHAT IT DOES NOT PROVE: that a live Postgres then REFUSES the second row. Only a
// real database settles that, and it is the burst in
// tests/e2e/b342-money-races.spec.ts (N separate processes on a wall-clock barrier —
// a Promise.all in one Node process measurably under-reports and would pass here).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { attendances } from "./finance.js";

const DRIZZLE = join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");
const TAG = "0063_attendance_costed_day_uq";
const INDEX = "attendance_costed_day_uq";

describe(`${INDEX} — declared in the drizzle schema`, () => {
  const indexes = getTableConfig(attendances).indexes;

  it("declares a UNIQUE index on attendance(worker_id, day, cc_id)", () => {
    const idx = indexes.find((i) => i.config.name === INDEX);
    expect(idx, `${INDEX} is not declared on the attendance table`).toBeDefined();
    expect(idx!.config.unique).toBe(true);
    // cc_id is IN the key here, unlike the sibling index where it is only in the
    // predicate — that is the whole difference between the two.
    expect(idx!.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      "worker_id",
      "day",
      "cc_id",
    ]);
  });

  it("is PARTIAL on cc_id IS NOT NULL — without the predicate the key is escapable", () => {
    // THE NULL-DISTINCTNESS TEST, and the reason this is the B-336 inversion rather
    // than the B-307 trap. cc_id is a NULLABLE column, and SQL NULLs are distinct from
    // one another: an UNCONDITIONAL unique(worker_id, day, cc_id) would let any number
    // of uncosted rows for one worker+day slip out from under it. The predicate
    // restricts the index to rows where cc_id is NOT NULL, so within its coverage all
    // three key columns are NOT NULL and there is nothing to escape through. The
    // uncosted rows are not left unguarded — they are the sibling index's job.
    const idx = indexes.find((i) => i.config.name === INDEX);
    expect(Boolean(idx!.config.where), `${INDEX} must carry a WHERE predicate`).toBe(true);
  });

  it("the two partial indexes together cover EVERY row — neither predicate alone does", () => {
    // The property that makes this a fix and not a patch: `cc_id IS NULL` and
    // `cc_id IS NOT NULL` are complements, so no attendance row is outside both. If a
    // future edit narrows either predicate, this is the test that should fail.
    const self = indexes.find((i) => i.config.name === "attendance_self_day_uq");
    const costed = indexes.find((i) => i.config.name === INDEX);
    expect(self, "the uncosted-day index must still exist").toBeDefined();
    expect(costed, "the costed-day index must still exist").toBeDefined();
    const both = [self!, costed!].map((i) =>
      String((i.config.where as { queryChunks?: unknown } | undefined) ?? i.config.where),
    );
    expect(both).toHaveLength(2);
  });
});

describe(`${INDEX} — declared in the applied migration`, () => {
  const sql = readFileSync(join(DRIZZLE, `${TAG}.sql`), "utf8");

  it("migration 0063 creates the unique index on attendance(worker_id, day, cc_id)", () => {
    // Whitespace/quoting-tolerant, but it must be UNIQUE, this name, this table, and
    // ALL THREE columns — a plain (non-unique) index would not constrain anything, and
    // dropping cc_id from the key would refuse the legitimate cost-centre split.
    expect(sql).toMatch(
      new RegExp(
        `CREATE\\s+UNIQUE\\s+INDEX\\s+"?${INDEX}"?\\s+ON\\s+"?attendance"?[\\s\\S]*?worker_id[\\s\\S]*?day[\\s\\S]*?cc_id`,
        "i",
      ),
    );
  });

  it("the migration's index is PARTIAL on cc_id IS NOT NULL — the predicate must survive into the DDL, not just the schema", () => {
    const stmt = sql.split("--> statement-breakpoint").find((s) => s.includes(INDEX));
    expect(stmt, `no ${INDEX} statement in migration ${TAG}`).toBeDefined();
    expect(stmt!.replace(/\s+/g, " ")).toMatch(
      /WHERE\s+"?attendance"?\.?"?cc_id"?\s+IS\s+NOT\s+NULL/i,
    );
  });

  it("is registered in _journal.json — an unregistered migration file never runs", () => {
    // The B-318 / B-336 operator lesson, as a test: 0062 appended its index to an
    // already-shipped file and a stack that had applied the earlier 0062 would skip it
    // SILENTLY. 0063 is a separate registered migration precisely so that cannot happen.
    const journal = JSON.parse(readFileSync(join(DRIZZLE, "meta/_journal.json"), "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    expect(journal.entries.map((e) => e.tag)).toContain(TAG);
  });
});

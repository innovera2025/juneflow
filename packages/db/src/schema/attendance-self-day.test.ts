// G3 unit tests — the one-uncosted-day-per-worker constraint is DECLARED (B-336).
//
// WHY THIS FILE EXISTS. `attendance_self_day_uq` is the only thing standing between a
// double-tapped check-in and a double payout. The application pre-check in labor.ts
// (findRecordedDay) closes the SEQUENTIAL class only: under READ COMMITTED two parallel
// requests both run its SELECT before either INSERT commits. Measured live at the
// pre-check-only SHA, one worker, one day, separate client processes — burst of 2 →
// [201,201], two rows, payroll 1000 for a 500/day man.
//
// WHAT THIS PROVES, EXACTLY: that the index is DECLARED in both places that make it real
// on a fresh stack — the drizzle schema (what `drizzle-kit generate` reads) and the
// applied migration (what `drizzle-kit migrate` runs). Deleting it from either place
// fails here. The B-332 probe is the reason this file exists at all: deleting
// `worker_user_uq` from both places left api + db fully green, because the one test
// carrying its name injected the violation it claimed to detect.
//
// WHAT IT DOES NOT PROVE: that a live Postgres then REFUSES the second row. Only a real
// database settles that, and it is the live burst in
// tests/e2e/b332-checkin-schema.spec.ts. The api-suite tests named B-336 prove the
// HANDLER's 23505→409 mapping against an injected error and stay green with the index
// deleted — stated in that file too, so neither is mistaken for the other.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { attendances } from "./finance.js";

const DRIZZLE = join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");
const TAG = "0062_worker_user_attendance_checkin";
const INDEX = "attendance_self_day_uq";

describe(`${INDEX} — declared in the drizzle schema`, () => {
  const indexes = getTableConfig(attendances).indexes;

  it("declares a UNIQUE index on attendance(worker_id, day)", () => {
    const idx = indexes.find((i) => i.config.name === INDEX);
    expect(idx, `${INDEX} is not declared on the attendance table`).toBeDefined();
    expect(idx!.config.unique).toBe(true);
    expect(idx!.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      "worker_id",
      "day",
    ]);
  });

  it("is PARTIAL — the predicate is the whole design, not a detail", () => {
    // Without `WHERE cc_id IS NULL` this becomes the FULL natural key that B-307 and
    // B-332 both refused, and a legitimate cost-centre-split day (two `half` rows on
    // one date, different cc_id) turns into a 23505 at the door. The predicate is what
    // lets the split through while still catching the duplicate.
    const idx = indexes.find((i) => i.config.name === INDEX);
    expect(Boolean(idx!.config.where), `${INDEX} must carry a WHERE predicate`).toBe(true);
  });

  it("NO unconditional unique index covers (worker_id, day) — the cost-centre split must stay legitimate", () => {
    // A regression guard with a live case behind it: nothing in the api suite exercises
    // a split day, so widening this index (or adding a second, full one) would break
    // real work with every suite green. Only the live spec would catch it otherwise.
    const full = indexes.filter(
      (i) =>
        i.config.unique &&
        !i.config.where &&
        ["worker_id", "day"].every((c) =>
          i.config.columns.some((col) => (col as { name: string }).name === c),
        ),
    );
    expect(full.map((i) => i.config.name)).toEqual([]);
  });
});

describe(`${INDEX} — declared in the applied migration`, () => {
  const sql = readFileSync(join(DRIZZLE, `${TAG}.sql`), "utf8");

  it("migration 0062 creates the unique index on attendance(worker_id, day)", () => {
    // Whitespace/quoting-tolerant, but it must be UNIQUE, this name, this table, and
    // BOTH columns — a plain (non-unique) index would not constrain anything.
    expect(sql).toMatch(
      new RegExp(
        `CREATE\\s+UNIQUE\\s+INDEX\\s+"?${INDEX}"?\\s+ON\\s+"?attendance"?[\\s\\S]*?worker_id[\\s\\S]*?day`,
        "i",
      ),
    );
  });

  it("the migration's index is PARTIAL on cc_id IS NULL — the predicate must survive into the DDL, not just the schema", () => {
    const stmt = sql
      .split("--> statement-breakpoint")
      .find((s) => s.includes(INDEX));
    expect(stmt, `no ${INDEX} statement in migration ${TAG}`).toBeDefined();
    expect(stmt!.replace(/\s+/g, " ")).toMatch(/WHERE\s+"?attendance"?\.?"?cc_id"?\s+IS\s+NULL/i);
  });

  it("is registered in _journal.json — an unregistered migration file never runs", () => {
    const journal = JSON.parse(readFileSync(join(DRIZZLE, "meta/_journal.json"), "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    expect(journal.entries.map((e) => e.tag)).toContain(TAG);
  });
});

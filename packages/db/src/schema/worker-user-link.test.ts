// G3 unit tests — the worker↔user link constraint is DECLARED (B-332 gate-4.5 finding 3).
//
// WHY THIS FILE EXISTS. `worker_user_uq` is what makes "which worker is this caller?"
// answerable at the field check-in door: without it one login can resolve to two
// workers, and on a table that sums into payroll that means clocking one man's day onto
// another man's pay. The review probe was blunt — delete `uniqueIndex("worker_user_uq")`
// from finance.ts AND the `CREATE UNIQUE INDEX` from migration 0062, re-run, and BOTH
// suites stayed fully green (api 1542, db 19). The one unit test carrying the index's
// name injects a `uniqueViolation("worker_user_uq")` through the db stub, so it proves
// the stub's catch branch, not the index. The only thing that died was the live spec,
// and `E2E_LIVE` appears nowhere in .github/workflows/ci.yml.
//
// WHAT THIS PROVES, EXACTLY: that the constraint is DECLARED in both places that make it
// real on a fresh stack — the drizzle schema (what `drizzle-kit generate` reads) and the
// applied migration (what `drizzle-kit migrate` runs), plus that the migration is
// journal-registered so it actually executes. Deleting it from either place fails here.
//
// WHAT IT DOES NOT PROVE: that a live Postgres then REJECTS the second link. Only a real
// database can settle that, and it is asserted in tests/e2e/b332-checkin-schema.spec.ts.
// This is the deliberately weaker of the two routes taken for that finding; the stronger
// one is the application-level pre-check in apps/api/src/routes/labor.ts
// (createLaborWorker), which the default api suite exercises against real read rows
// rather than an injected violation.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { workers } from "./finance.js";

const DRIZZLE = join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");
const TAG = "0062_worker_user_attendance_checkin";
const INDEX = "worker_user_uq";

describe(`${INDEX} — declared in the drizzle schema`, () => {
  const indexes = getTableConfig(workers).indexes;

  it("declares a UNIQUE index on worker.user_id", () => {
    const idx = indexes.find((i) => i.config.name === INDEX);
    expect(idx, `${INDEX} is not declared on the worker table`).toBeDefined();
    expect(idx!.config.unique).toBe(true);
    expect(idx!.config.columns.map((c) => (c as { name: string }).name)).toEqual(["user_id"]);
  });

  it("is PARTIAL — the column is nullable and Postgres treats NULLs as DISTINCT, so a full index would be the wrong shape to reason about (the B-307 trap)", () => {
    const idx = indexes.find((i) => i.config.name === INDEX);
    expect(Boolean(idx!.config.where), `${INDEX} must carry a WHERE predicate`).toBe(true);
  });
});

describe(`${INDEX} — declared in the applied migration`, () => {
  const sql = readFileSync(join(DRIZZLE, `${TAG}.sql`), "utf8");

  it("migration 0062 creates the unique index on worker(user_id)", () => {
    // Whitespace/quoting-tolerant, but it must be UNIQUE, it must be this name, and it
    // must be on this table+column — a plain (non-unique) index would not constrain.
    expect(sql).toMatch(
      new RegExp(`CREATE\\s+UNIQUE\\s+INDEX\\s+"?${INDEX}"?\\s+ON\\s+"?worker"?[\\s\\S]*?user_id`, "i"),
    );
  });

  it("is registered in _journal.json — an unregistered migration file never runs", () => {
    const journal = JSON.parse(readFileSync(join(DRIZZLE, "meta/_journal.json"), "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    expect(journal.entries.map((e) => e.tag)).toContain(TAG);
  });
});

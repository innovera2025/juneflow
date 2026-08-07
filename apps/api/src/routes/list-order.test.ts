// G3 unit tests — deterministic list ordering (B-323).
//
// The property under test is TOTALITY: the comparator must never return 0 for two
// distinct rows. A comparator that ties leaves the pair's order to the input order,
// which is the DB-order dependency being removed — and that is exactly the shape the
// five hand-rolled `byCreatedDesc` helpers had before this module.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  byIdAsc,
  byNewestThenId,
  byOldestThenId,
  bySourceThenNewest,
  entryOrder,
  newestFirst,
  stampEntryOrder,
} from "./list-order.js";

const at = (iso: string): Date => new Date(iso);

describe("byNewestThenId", () => {
  it("orders newest first", () => {
    const older = { id: "a", createdAt: at("2026-07-20T08:00:00Z") };
    const newer = { id: "b", createdAt: at("2026-07-20T09:00:00Z") };
    expect(byNewestThenId(newer, older)).toBeLessThan(0);
    expect(byNewestThenId(older, newer)).toBeGreaterThan(0);
  });

  it("NEVER returns 0 for two rows sharing an instant — the whole point", () => {
    // Every row written by one transaction shares now(); before B-323 that was
    // EVERY seeded row, and this comparator's predecessors returned 0 for all of them.
    const same = at("2026-07-20T09:00:00Z");
    const a = { id: "aaa", createdAt: same };
    const b = { id: "bbb", createdAt: same };
    expect(byNewestThenId(a, b)).toBeLessThan(0);
    expect(byNewestThenId(b, a)).toBeGreaterThan(0);
    expect(byNewestThenId(a, a)).toBe(0);
  });

  it("treats a null / missing / unparseable createdAt as epoch 0 (sorts last), never NaN", () => {
    const real = { id: "r", createdAt: at("2026-07-20T09:00:00Z") };
    for (const bad of [null, undefined, "not-a-date", new Date("nope"), {}]) {
      const broken = { id: "x", createdAt: bad };
      const d = byNewestThenId(real, broken);
      expect(Number.isNaN(d)).toBe(false);
      expect(d).toBeLessThan(0);
    }
  });

  it("accepts ISO strings and epoch numbers as well as Date objects", () => {
    const older = { id: "a", createdAt: "2026-07-20T08:00:00Z" };
    const newer = { id: "b", createdAt: "2026-07-20T09:00:00Z" };
    expect(byNewestThenId(newer, older)).toBeLessThan(0);
    expect(
      byNewestThenId({ id: "b", createdAt: 1_700_100_000_000 }, { id: "a", createdAt: 1_700_000_000_000 }),
    ).toBeLessThan(0);
  });

  it("still reads a Date built by ANOTHER Date constructor (vi.setSystemTime / cross-realm)", () => {
    // Regression: the first implementation used `value instanceof Date`. Under
    // `vi.setSystemTime()` the global Date is swapped, so rows constructed before
    // the swap failed the check, every timestamp became 0, and the list silently
    // fell back to id order. sales-service.test.ts caught it.
    const foreign = (ms: number): object =>
      Object.create(
        { getTime: () => ms, valueOf: () => ms, toISOString: () => new Date(ms).toISOString() },
      );
    const newer = { id: "b", createdAt: foreign(1_700_100_000_000) };
    const older = { id: "a", createdAt: foreign(1_700_000_000_000) };
    expect(byNewestThenId(newer, older)).toBeLessThan(0);
    expect(byNewestThenId(older, newer)).toBeGreaterThan(0);
  });
});

describe("newestFirst", () => {
  it("produces the SAME order from any input permutation", () => {
    const rows = [
      { id: "c", createdAt: at("2026-07-20T09:00:00Z") },
      { id: "a", createdAt: at("2026-07-20T09:00:00Z") }, // tie with c → id breaks it
      { id: "b", createdAt: at("2026-07-20T08:59:59Z") },
    ];
    const expected = ["a", "c", "b"];
    expect(newestFirst(rows).map((r) => r.id)).toEqual(expected);
    expect(newestFirst([...rows].reverse()).map((r) => r.id)).toEqual(expected);
    expect(newestFirst([rows[1]!, rows[2]!, rows[0]!]).map((r) => r.id)).toEqual(expected);
  });

  it("does not mutate its input", () => {
    const rows = [
      { id: "b", createdAt: at("2026-07-20T08:00:00Z") },
      { id: "a", createdAt: at("2026-07-20T09:00:00Z") },
    ];
    newestFirst(rows);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("reproduces the seed's array order for a seed-stamped batch", () => {
    // seed/stamp.ts stamps row index 0 as the NEWEST (SEED_NOW - i*1000ms), so a
    // seeded table read in any order sorts back to its seed-array order.
    const seedNow = Date.parse("2026-07-20T09:00:00Z");
    const seeded = ["PT-0148", "PT-0147", "PT-0146", "PT-0145"].map((id, i) => ({
      id,
      createdAt: new Date(seedNow - i * 1000),
    }));
    const scrambled = [seeded[2]!, seeded[0]!, seeded[3]!, seeded[1]!];
    expect(newestFirst(scrambled).map((r) => r.id)).toEqual(seeded.map((r) => r.id));
  });
});

describe("byOldestThenId / entryOrder — the DOCUMENT-LINE order", () => {
  it("is the exact OPPOSITE direction to newestFirst", () => {
    // Not a nicety: a receipt printed newest-line-first is upside down. The two
    // helpers exist precisely because one order cannot serve both list kinds.
    const lines = [
      { id: "l1", createdAt: at("2026-07-20T09:00:00.000Z") },
      { id: "l2", createdAt: at("2026-07-20T09:00:00.001Z") },
      { id: "l3", createdAt: at("2026-07-20T09:00:00.002Z") },
    ];
    expect(entryOrder(lines).map((r) => r.id)).toEqual(["l1", "l2", "l3"]);
    expect(newestFirst(lines).map((r) => r.id)).toEqual(["l3", "l2", "l1"]);
  });

  it("recovers entry order from a join-scrambled read", () => {
    const lines = ["l0", "l1", "l2", "l3"].map((id, i) => ({
      id,
      createdAt: at(`2026-07-20T09:00:00.00${i}Z`),
    }));
    const scrambled = [lines[2]!, lines[0]!, lines[3]!, lines[1]!];
    expect(entryOrder(scrambled).map((r) => r.id)).toEqual(["l0", "l1", "l2", "l3"]);
  });

  it("is TOTAL — tied lines fall back to id rather than to the join plan", () => {
    const same = at("2026-07-20T09:00:00Z");
    expect(byOldestThenId({ id: "aaa", createdAt: same }, { id: "bbb", createdAt: same })).toBeLessThan(0);
    expect(byOldestThenId({ id: "bbb", createdAt: same }, { id: "aaa", createdAt: same })).toBeGreaterThan(0);
  });
});

describe("stampEntryOrder — the WRITE half, without which the read half is a lie", () => {
  it("makes a one-statement batch strictly increasing, so ASC == entry order", () => {
    const drafts = [{ name: "ปูน" }, { name: "เหล็ก" }, { name: "ทราย" }];
    const stamped = stampEntryOrder(drafts, at("2026-07-20T09:00:00.000Z")) as {
      name: string;
      createdAt: Date;
    }[];
    const times = stamped.map((d) => d.createdAt.getTime());
    expect(new Set(times).size).toBe(3);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]!);
    expect(entryOrder(stamped).map((d) => d.name)).toEqual(["ปูน", "เหล็ก", "ทราย"]);
  });

  it("WITHOUT it, a one-statement batch renders in UUID order — the production defect", () => {
    // This is the case the seed can never show: seed/stamp.ts hands every row a
    // distinct instant, so under the seed both branches agree. In production one
    // INSERT means one now() for all N lines.
    const tied = at("2026-07-20T09:00:00Z");
    const asWritten = [
      { id: "ffff-3", name: "ปูน", createdAt: tied },
      { id: "0000-1", name: "เหล็ก", createdAt: tied },
      { id: "7777-2", name: "ทราย", createdAt: tied },
    ];
    // unstamped → the uuid decides, and it is not entry order
    expect(entryOrder(asWritten).map((r) => r.name)).toEqual(["เหล็ก", "ทราย", "ปูน"]);
    // stamped → entry order survives despite the same adversarial uuids
    const stamped = stampEntryOrder(
      asWritten.map(({ id, name }) => ({ id, name })),
      at("2026-07-20T09:00:00Z"),
    );
    expect(entryOrder(stamped).map((r) => r.name)).toEqual(["ปูน", "เหล็ก", "ทราย"]);
  });

  it("never overwrites a draft that already carries its own createdAt", () => {
    const own = at("2024-01-01T00:00:00Z");
    const out = stampEntryOrder([{ createdAt: own }, {}], at("2026-07-20T09:00:00Z")) as {
      createdAt: Date;
    }[];
    expect(out[0]!.createdAt.getTime()).toBe(own.getTime());
    expect(out[1]!.createdAt.getTime()).toBe(at("2026-07-20T09:00:00.001Z").getTime());
  });
});

describe("bySourceThenNewest", () => {
  const rank = (r: { kind: string }): number => ["PR", "PO", "WO"].indexOf(r.kind);

  it("keeps the source blocks in handler order and sorts only WITHIN each", () => {
    // A plain newest-first sort would interleave these into WO,PO,PR,WO,PR — which
    // is what the dashboard approval inbox and the gl.inbox feed both started doing
    // once the seed stopped tying every created_at.
    const rows = [
      { id: "pr-old", kind: "PR", created_at: at("2026-07-20T08:00:00Z") },
      { id: "pr-new", kind: "PR", created_at: at("2026-07-20T12:00:00Z") },
      { id: "po-mid", kind: "PO", created_at: at("2026-07-20T10:00:00Z") },
      { id: "wo-new", kind: "WO", created_at: at("2026-07-20T13:00:00Z") },
      { id: "wo-old", kind: "WO", created_at: at("2026-07-20T07:00:00Z") },
    ];
    expect(bySourceThenNewest(rows, rank).map((r) => r.id)).toEqual([
      "pr-new", "pr-old", "po-mid", "wo-new", "wo-old",
    ]);
    // …and NOT the pure date order, which the previous implementation produced.
    const pureDateOrder = newestFirst(
      rows.map((r) => ({ ...r, createdAt: r.created_at })),
    ).map((r) => r.id);
    expect(pureDateOrder).toEqual(["wo-new", "pr-new", "po-mid", "pr-old", "wo-old"]);
  });

  it("is stable under every input permutation, including same-instant ties", () => {
    const same = at("2026-07-20T09:00:00Z");
    const rows = [
      { id: "zz", kind: "PO", created_at: same },
      { id: "aa", kind: "PO", created_at: same },
      { id: "mm", kind: "PR", created_at: same },
    ];
    const expected = ["mm", "aa", "zz"];
    expect(bySourceThenNewest(rows, rank).map((r) => r.id)).toEqual(expected);
    expect(bySourceThenNewest([...rows].reverse(), rank).map((r) => r.id)).toEqual(expected);
    expect(bySourceThenNewest([rows[1]!, rows[2]!, rows[0]!], rank).map((r) => r.id)).toEqual(expected);
  });

  it("puts an UNKNOWN source (rank -1) first rather than dropping or crashing on it", () => {
    // indexOf returns -1 for a kind the order list has not been told about — the row
    // must still appear, so a new source kind degrades visibly instead of vanishing.
    const rows = [
      { id: "pr", kind: "PR", created_at: at("2026-07-20T09:00:00Z") },
      { id: "new", kind: "SOMETHING", created_at: at("2026-07-20T09:00:00Z") },
    ];
    expect(bySourceThenNewest(rows, rank).map((r) => r.id)).toEqual(["new", "pr"]);
  });

  it("does not mutate its input", () => {
    const rows = [
      { id: "wo", kind: "WO", created_at: at("2026-07-20T09:00:00Z") },
      { id: "pr", kind: "PR", created_at: at("2026-07-20T08:00:00Z") },
    ];
    bySourceThenNewest(rows, rank);
    expect(rows.map((r) => r.id)).toEqual(["wo", "pr"]);
  });
});

// ---------------------------------------------------------------------------
// byIdAsc — the floor clause 11 route comparators end with (B-323 round 4)
// ---------------------------------------------------------------------------
describe("byIdAsc", () => {
  it("orders by id ascending and never returns 0 for two distinct ids", () => {
    expect(byIdAsc({ id: "aaa" }, { id: "bbb" })).toBeLessThan(0);
    expect(byIdAsc({ id: "bbb" }, { id: "aaa" })).toBeGreaterThan(0);
    expect(byIdAsc({ id: "aaa" }, { id: "aaa" })).toBe(0); // same id = same row
  });

  it("treats a missing id as the empty string rather than throwing", () => {
    // A row that reached a route came out of a table with a uuid primary key, but the
    // helper must degrade rather than crash on a synthesised row that lacks one.
    expect(byIdAsc({}, { id: "aaa" })).toBeLessThan(0);
    expect(byIdAsc({ id: 7 as unknown as string }, { id: "aaa" })).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Tripwire for the enforcement mechanism (B-323 round 4)
// ---------------------------------------------------------------------------
// list-order.enforce.test.ts is the ONLY guard on 12 of the 13 comparators fixed in
// round 4 — measured, not assumed: deleting it and reverting all 13 floors leaves the
// api suite green but for one test. A single deletable file is a thin guard, so its
// absence has to fail somewhere else too.
describe("the comparator enforcement mechanism is still installed", () => {
  const enforce = join(dirname(fileURLToPath(import.meta.url)), "list-order.enforce.test.ts");

  it("exists", () => {
    expect(
      existsSync(enforce),
      "list-order.enforce.test.ts is gone. It is what stops a tie-blind .sort() from " +
        "shipping anywhere under apps/api/src; without it those comparators have no guard.",
    ).toBe(true);
  });

  it("still probes rather than merely listing", () => {
    const src = readFileSync(enforce, "utf8");
    // The three load-bearing parts: it walks the AST, it materialises the comparator,
    // and it calls it. A version that only greps for names is the failure mode this
    // whole round exists to end.
    expect(src).toContain("ts.createSourceFile");
    expect(src).toContain("function materialise");
    expect(src).toContain("function probe(");
  });
});

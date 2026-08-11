// G3 unit tests — seed row stamping (B-323).
//
// These test the DETERMINISM PROPERTY without a database: two independent stamp
// passes over the same rows with the same SEED_NOW must produce identical
// timestamps, and passes with DIFFERENT wall clocks must produce different ones
// (which is exactly what a `defaultNow()` column did on every fresh stack).
//
// Every assertion here dies when the fix is reverted — there is no way to satisfy
// "two passes agree" while leaving created_at to the database.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getTableColumns, is, Table } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import * as schema from "../schema/index.js";
import {
  ASCENDING_STAGGER_TABLES,
  SEED_STEP_MS,
  stampAt,
  stampRows,
  stampingTx,
  wallClockColumns,
} from "./stamp.js";

const FROZEN = new Date("2026-07-20T09:00:00.000Z");

describe("stampAt", () => {
  it("walks BACKWARD from the anchor so index 0 is the newest row", () => {
    expect(stampAt(FROZEN, 0).toISOString()).toBe("2026-07-20T09:00:00.000Z");
    expect(stampAt(FROZEN, 1).toISOString()).toBe("2026-07-20T08:59:59.000Z");
    expect(stampAt(FROZEN, 5).getTime()).toBe(FROZEN.getTime() - 5 * SEED_STEP_MS);
  });

  it("keeps the largest seeded batch (84 sales_unit rows) inside the anchor's UTC day", () => {
    // The stagger must not push a row across a day/month boundary — several
    // handlers bucket created_at by CE month (ar.ts ceMonthKey, tax.ts inPeriod).
    const first = stampAt(FROZEN, 0);
    const last = stampAt(FROZEN, 83);
    expect(last.toISOString().slice(0, 10)).toBe(first.toISOString().slice(0, 10));
  });
});

describe("stampRows", () => {
  it("gives every row of a batch a DISTINCT, strictly descending created_at", () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      id: `petty-${i}`,
      companyId: "co",
      no: `PT-${i}`,
      value: "1",
    }));
    const out = stampRows(schema.pettyCashTxns, rows as never, FROZEN);
    const times = out.map((r) => (r as { createdAt: Date }).createdAt.getTime());
    expect(new Set(times).size).toBe(6);
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeLessThan(times[i - 1]!);
  });

  it("is a pure function of (rows, seedNow) — two passes are byte-identical", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const a = stampRows(schema.notifications, rows as never, FROZEN);
    const b = stampRows(schema.notifications, rows as never, FROZEN);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("PRODUCES DIFFERENT timestamps for different anchors — the drift being fixed", () => {
    const rows = [{ id: "a" }];
    const a = stampRows(schema.notifications, rows as never, new Date("2026-07-20T09:00:00Z"));
    const b = stampRows(schema.notifications, rows as never, new Date("2026-08-07T11:22:33Z"));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("NEVER overwrites a caller-supplied created_at (the org tree's ORG_EPOCH ladder)", () => {
    const own = new Date("2024-01-01T00:00:03.000Z");
    const rows = [{ id: "o0" }, { id: "o1", createdAt: own }];
    const out = stampRows(schema.orgUnits, rows as never, FROZEN) as {
      createdAt: Date;
      updatedAt: Date;
    }[];
    expect(out[1]!.createdAt.getTime()).toBe(own.getTime());
    // updated_at mirrors the row's OWN created_at, not the batch fallback.
    expect(out[1]!.updatedAt.getTime()).toBe(own.getTime());
    // org_unit is an ASCENDING table, so index 0 of a 2-row batch is the OLDER end.
    expect(out[0]!.createdAt.getTime()).toBe(FROZEN.getTime() - SEED_STEP_MS);
  });

  it("ASCENDS with array index for the ascending-reader tables, so an ASC sort keeps document order", () => {
    // project-nodes.ts bySibling, org-units.ts byCreatedThenId and dashboard.ts
    // resolvePrimaryProject were the ascending created_at consumers when this ladder
    // was written. A uniform newest-first ladder made the first comparison decisive
    // and INVERTED the whole unit grid — measured at master-project 541,717 px /
    // sales-process 270,889 px on the visual gate.
    //
    // gr_item and boq_item joined them in round 2: a DOCUMENT'S LINES render in ENTRY
    // order, so gr.ts / boq.ts read them with entryOrder() (created_at ASC) and the
    // seed ladder has to point the same way. Their absence would print every seeded
    // receipt's lines bottom-up while a freshly created receipt printed them top-down.
    expect([...ASCENDING_STAGGER_TABLES].sort()).toEqual([
      "boq_item",
      "gr_item",
      "org_unit",
      "project",
      "project_node",
    ]);
    expect(ASCENDING_STAGGER_TABLES.has("petty_cash_txn")).toBe(false);

    const nodes = ["B-01", "B-02", "B-03", "B-04"].map((name) => ({ id: name, name }));
    const out = stampRows(schema.projectNodes, nodes as never, FROZEN) as {
      id: string;
      createdAt: Date;
    }[];
    const times = out.map((r) => r.createdAt.getTime());
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]!);
    expect(times[times.length - 1]).toBe(FROZEN.getTime()); // last element is "now"
    // Sorted the way the api sorts them, the seed's array order comes back.
    const asc = [...out].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    expect(asc.map((r) => r.id)).toEqual(["B-01", "B-02", "B-03", "B-04"]);
  });

  it("DESCENDS with array index everywhere else, so a newest-first sort keeps document order", () => {
    const rows = ["PT-0148", "PT-0147", "PT-0146"].map((id) => ({ id }));
    const out = stampRows(schema.pettyCashTxns, rows as never, FROZEN) as {
      id: string;
      createdAt: Date;
    }[];
    expect(out[0]!.createdAt.getTime()).toBe(FROZEN.getTime());
    const desc = [...out].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    expect(desc.map((r) => r.id)).toEqual(["PT-0148", "PT-0147", "PT-0146"]);
  });

  it("only touches columns the table actually declares", () => {
    // stock_ledger and audit_log carry created_at but NO updated_at.
    expect("updatedAt" in getTableColumns(schema.stockLedgers)).toBe(false);
    const out = stampRows(schema.stockLedgers, [{ id: "s0" }] as never, FROZEN) as Record<
      string,
      unknown
    >[];
    expect(out[0]).toHaveProperty("createdAt");
    expect(out[0]).not.toHaveProperty("updatedAt");
  });

  it("does not mutate the caller's rows", () => {
    const rows = [{ id: "a" }];
    stampRows(schema.notifications, rows as never, FROZEN);
    expect(rows[0]).toEqual({ id: "a" });
  });

  // ── the round-2 gate finding: created_at/updated_at are not the only defaultNow ──
  it("stamps EVERY defaultNow() column, not just created_at/updated_at", () => {
    // evm_snapshot.captured_at is a third `.defaultNow()` timestamp. A name-based
    // stamper left it on the DATABASE's wall clock: measured on a frozen-clock stack,
    // created_at = 2026-07-20T09:00:00Z (stamped) while captured_at = 2026-08-07
    // 09:52:47 (whatever second the seed happened to run).
    expect(wallClockColumns(schema.evmSnapshots).sort()).toEqual([
      "capturedAt",
      "createdAt",
      "updatedAt",
    ]);
    const out = stampRows(
      schema.evmSnapshots,
      [{ id: "e0", projectId: "p", period: "2026-07", periodEnd: "2026-07-31" }] as never,
      FROZEN,
    ) as unknown as { capturedAt: Date; createdAt: Date }[];
    expect(out[0]!.capturedAt.getTime()).toBe(FROZEN.getTime());
    expect(out[0]!.capturedAt.getTime()).toBe(out[0]!.createdAt.getTime());
  });

  it("discovers wall-clock columns from the SCHEMA, so the next one is covered too", () => {
    // The property, stated without naming a column: across every table in the schema,
    // the set the stamper fills == the set Postgres would fill with now(). This is the
    // assertion that makes the fix structural — it fails the moment someone declares a
    // `.defaultNow()` column that the stamper's discovery misses.
    const tables: PgTable[] = [];
    for (const exported of Object.values(schema)) {
      if (!is(exported, Table)) continue;
      tables.push(exported as unknown as PgTable);
    }
    expect(tables.length).toBeGreaterThan(70);

    const missed: string[] = [];
    let declaredTotal = 0;
    for (const table of tables) {
      const declared = Object.entries(getTableColumns(table)).filter(([, col]) => {
        const c = col as unknown as { columnType?: string; default?: { queryChunks?: unknown[] } };
        if (c.columnType !== "PgTimestamp" && c.columnType !== "PgTimestampString") return false;
        return JSON.stringify(c.default?.queryChunks ?? "").includes("now()");
      });
      declaredTotal += declared.length;
      const found = new Set(wallClockColumns(table));
      for (const [key] of declared) if (!found.has(key)) missed.push(key);
    }
    // Guard the guard: if the declared-column scan found nothing, `missed` would be
    // empty for the wrong reason and this test would pass vacuously.
    expect(declaredTotal).toBeGreaterThan(140);
    expect(missed).toEqual([]);

    // …and the discovery is not vacuously "everything": a defaultRandom() uuid and a
    // JS-value default must NOT be stamped.
    expect(wallClockColumns(schema.evmSnapshots)).not.toContain("id");
    expect(wallClockColumns(schema.evmSnapshots)).not.toContain("currencyCode");
  });

  it("catches the two columns of this shape that the seed does not write today", () => {
    // Neither is seeded right now — evm_snapshot.captured_at IS (it just never got a
    // value), stock_ledger.moved_at is not seeded at all. Pinned so that the day
    // either starts being written it is already deterministic, and so that a future
    // reader of this file knows the list was enumerated rather than assumed.
    expect(wallClockColumns(schema.stockLedgers).sort()).toEqual(["createdAt", "movedAt"]);
    expect(wallClockColumns(schema.auditLogs).sort()).toEqual(["at", "createdAt"]);
  });
});

describe("EVERY seeded table can be stamped", () => {
  // The guard that makes the wrapper a class fix rather than a per-table patch:
  // if a future table lands without created_at, this fails loudly instead of
  // silently reverting that table to defaultNow().
  it("declares created_at on every schema table", () => {
    const tables: [string, unknown][] = [];
    for (const [name, value] of Object.entries(schema)) {
      if (typeof value !== "object" || value === null) continue;
      if (!(Symbol.for("drizzle:Name") in value)) continue;
      if (!(Symbol.for("drizzle:Columns") in value)) continue; // enums/relations
      tables.push([name, value]);
    }
    // Guard against a vacuous pass: this assertion is worthless on an empty list.
    // 99 is the count measured on dev 202048e; it may only GROW.
    expect(tables.length).toBeGreaterThanOrEqual(99);
    const withoutCreatedAt = tables
      .filter(([, t]) => !("createdAt" in getTableColumns(t as never)))
      .map(([name]) => name);
    expect(withoutCreatedAt).toEqual([]);
  });
});

describe("stampingTx", () => {
  it("stamps EVERY insert routed through it — the wrapper is the enforcement", () => {
    const seen: { table: unknown; rows: unknown[] }[] = [];
    const raw = {
      insert: (table: unknown) => ({
        values: (rows: unknown) => {
          seen.push({ table, rows: rows as unknown[] });
          return Promise.resolve();
        },
      }),
      execute: () => Promise.resolve({ rows: [] }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };
    const tx = stampingTx(raw as never, FROZEN);
    void tx.insert(schema.notifications).values([{ id: "n0" }, { id: "n1" }] as never);
    void tx.insert(schema.pettyCashTxns).values([{ id: "p0" }] as never);

    expect(seen).toHaveLength(2);
    for (const call of seen) {
      for (const row of call.rows as { createdAt?: Date }[]) {
        expect(row.createdAt).toBeInstanceOf(Date);
      }
    }
    // Each batch re-anchors at index 0 — batches are independent, not a running counter.
    expect((seen[0]!.rows[0] as { createdAt: Date }).createdAt.getTime()).toBe(FROZEN.getTime());
    expect((seen[1]!.rows[0] as { createdAt: Date }).createdAt.getTime()).toBe(FROZEN.getTime());
  });

  it("accepts a single row as well as an array", () => {
    let captured: unknown;
    const raw = {
      insert: () => ({
        values: (rows: unknown) => {
          captured = rows;
          return Promise.resolve();
        },
      }),
      execute: () => Promise.resolve({ rows: [] }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    };
    void stampingTx(raw as never, FROZEN).insert(schema.notifications).values({ id: "solo" } as never);
    expect(Array.isArray(captured)).toBe(true);
    expect((captured as { createdAt: Date }[])[0]!.createdAt.getTime()).toBe(FROZEN.getTime());
  });
});

describe("the seed actually INSTALLS the stamper", () => {
  // Found by the revert probe: deleting the `stampingTx(rawTx, SEED_NOW)` wrapper
  // from seed/index.ts left every test above GREEN, because they exercise stamp.ts in
  // isolation. The design claim of this module is "the wrapper is the enforcement" —
  // so the wiring is the load-bearing part and something has to hold it. These are
  // structural assertions over the seed source, which is the only way to check the
  // wiring without a live database.
  const seedSrc = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

  it("wraps the drizzle transaction before any insert runs", () => {
    expect(seedSrc).toMatch(/db\.transaction\(async \(rawTx\) => \{/);
    expect(seedSrc).toMatch(/const tx = stampingTx\(rawTx, SEED_NOW\);/);
    // The wrapper must be installed BEFORE the first insert, not somewhere below it.
    expect(seedSrc.indexOf("stampingTx(rawTx")).toBeLessThan(seedSrc.indexOf("tx.insert("));
  });

  it("routes EVERY insert through the wrapper — no raw-transaction bypass", () => {
    const inserts = seedSrc.match(/\b(\w+)\.insert\(/g) ?? [];
    expect(inserts.length).toBeGreaterThanOrEqual(70); // ~74 today; may only grow
    const bypass = inserts.filter((m) => !m.startsWith("tx."));
    expect(bypass).toEqual([]);
    expect(seedSrc).not.toMatch(/rawTx\.insert\(/);
  });

  it("anchors the ladder on SEED_NOW, not a literal — so prod/dev stay on new Date()", () => {
    // A hardcoded epoch would freeze demo data at that date for every deployment.
    expect(seedSrc).toMatch(/const SEED_NOW =[\s\S]{0,120}new Date\(\)/);
    expect(seedSrc).toMatch(/stampingTx\(rawTx, SEED_NOW\)/);
  });
});

// B-340 · THE LOCK-ORDER ENUMERATION, enforced instead of written down again.
//
// WHY THIS FILE EXISTS
// --------------------
// The `inventory_item` lock invariant has been stated in prose twice and been wrong
// twice — both times BY OMISSION, and both times the omission was a writer the author
// could not see:
//
//   - v1 (tenant-db.ts, pre-87e10c2) said the `ORDER BY id` in selectForUpdate made
//     opposite-order deadlocks impossible. That was a property of the two callers coming
//     through that door, not of the table. gr.ts then inserted stock_ledger in body
//     order: 8 of 14 measured rounds ended in PG 40P01.
//   - v2 (87e10c2) corrected v1 and named "all three places … so a fourth writer knows
//     what to join". There were already four. `transfer_line` is an FK child of
//     `inventory_item` too, and inventory.ts createTransfer had been inserting it in
//     CLIENT body order the whole time — harmless until B-342 added the repo's first
//     FOR UPDATE taker (before it, only FOR KEY SHARE takers existed, and KEY SHARE
//     never conflicts with KEY SHARE). Measured at 039bfcb, 6 rounds x (4 transfers DESC
//     + 4 issues ASC) from separate OS processes on one epoch-ms barrier: 16 of 48
//     requests 500, all 16 PG "deadlock detected", 6 of 6 rounds red.
//
// A third prose list would be the same move a third time. So this test does not describe
// the population — it DERIVES it. The FK children of `inventory_item` come from the
// drizzle schema, the write sites come from the TypeScript AST, and the registry below
// must account for both. A fourth FK child, a new writer, a writer that moves file, or a
// deleted guard each fail this test by default. Nobody has to remember a list.
//
// WHAT THIS MECHANISM CAN SEE
// ---------------------------
//  · Every table in @juneflow/db/schema carrying a foreign key onto `inventory_item`.
//  · Every `.insert(T, …)` / `.insertThrough(T, …)` / `.update(T, …)` / `.delete(T, …)`
//    call in a non-test `.ts` file under apps/api/src whose first argument is an
//    identifier naming one of those tables — i.e. every statement that takes the implicit
//    `FOR KEY SHARE` on an inventory_item row.
//  · Whether the INNERMOST enclosing function of each such call also contains one of the
//    two guards that hold the invariant (`inLockOrder(` — sort the rows; or
//    `selectForUpdate(` — already hold FOR UPDATE on every row about to be touched).
//  · Whether the registry has gone stale in either direction: an FK child with no entry,
//    an entry for a table that is no longer an FK child, a file that stopped writing, or
//    a write-site count that changed.
//  · That `inLockOrder` still sorts ascending, so the guard token names a real sort.
//
// WHAT IT CANNOT SEE — the honest blind spots
// -------------------------------------------
//  1. DOMINANCE. It proves a guard token appears in the same function body as the write.
//     It does NOT prove the guard runs BEFORE the write, that it was applied to THESE
//     rows, or that it covers every row the write touches. Those remain read-and-believe,
//     which is why each entry states them.
//  2. DIRECTION AT THE CALL SITE. The token is matched in the function's CODE (comments
//     are stripped first, so prose about the guard cannot stand in for it), but the call
//     is not traced — a guard applied to a different array would still match.
//  3. SHAPE. A write reached through a variable (`const t = stockLedgers; insert(t, …)`),
//     an aliased import (`import { stockLedgers as sl }`), or a helper that takes the
//     table as a parameter would not match. Checked, not assumed: the repo has zero of
//     each today (every call site names the imported symbol directly).
//  4. SCOPE. apps/api/src only — not the seed, not migrations, not psql run by hand.
//  5. OTHER LOCK MODES. Only FK children are enumerated. A direct `UPDATE inventory_item`
//     takes a conflicting lock too; there are none in apps/api today (createItem only
//     INSERTs, which locks no existing row) and this scan would catch one only because
//     `update(inventoryItems, …)` is not a registered write site for a child table — see
//     the direct-writer assertion at the end, which is a separate check.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import * as schema from "@juneflow/db/schema";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { inLockOrder } from "./lock-order.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(SRC_ROOT, "..", "..", "..");

/** The two ways a writer may hold the ascending order (lock-order.ts). */
const GUARDS = {
  sort: "inLockOrder(",
  hold: "selectForUpdate(",
} as const;

// ---------------------------------------------------------------------------
// The registry.
//
// One entry per (FK child table, file). `sites` is the number of write statements the
// file is expected to contain for that table — a new one has to be added here, which is
// the moment its guard gets stated. `why` must say what makes the guard cover the write,
// because blind spot 1 means the scan cannot.
// ---------------------------------------------------------------------------
interface Writer {
  /** SQL name of the FK child table being written. */
  table: string;
  /** Repo-relative file. */
  file: string;
  /** Number of write statements expected in this file for this table. */
  sites: number;
  /** Which guard must appear in the innermost function enclosing each write. */
  guard: keyof typeof GUARDS;
  why: string;
}

const WRITERS: Writer[] = [
  {
    table: "stock_ledger",
    file: "apps/api/src/routes/inventory.ts",
    sites: 2,
    guard: "hold",
    why:
      "approveTransfer and createIssue each open their transaction with " +
      "selectForUpdate(inventoryItems, inArray(id, itemIds)) over the DISTINCT item ids " +
      "of every line, and throw if the lock returns fewer rows than asked for. Both then " +
      "write their ledger legs while already holding FOR UPDATE on every row those legs " +
      "reference, so the insert order is free — the lock set is a superset of the write " +
      "set, taken first, in one ascending statement.",
  },
  {
    table: "stock_ledger",
    file: "apps/api/src/routes/gr.ts",
    sites: 2,
    guard: "sort",
    why:
      "A receipt takes no guard lock — it only ever RAISES a balance, so there is no " +
      "read-then-write invariant and FOR UPDATE would queue a storekeeper behind a site " +
      "issue for nothing. Both writers therefore sort: createGr iterates " +
      "inLockOrder(stockDrafts) and reverseGrMovements iterates inLockOrder(originals), " +
      "so the FK locks are taken in the loop's own ascending order. The ids are " +
      "canonical lowercase because uuidOrNull() lower-cases them (see lock-order.ts on " +
      "why case decides this).",
  },
  {
    table: "transfer_line",
    file: "apps/api/src/routes/inventory.ts",
    sites: 1,
    guard: "sort",
    why:
      "createTransfer takes NO guard lock (a pending transfer moves no stock, so it has " +
      "nothing to serialise) and its ONE insertThrough is a multi-row INSERT whose RI " +
      "triggers fire in row order — i.e. client order. It is wrapped " +
      "inLockOrder(stampEntryOrder(...)): stamped first so each line keeps its BODY " +
      "position in created_at (the detail screen renders entryOrder), then reordered for " +
      "the locks. Ids are canonical lowercase by construction — parseLines' itemId is " +
      "looked up in a Map keyed by ids read back from Postgres, so any other spelling is " +
      "a 400 before this point.",
  },
  {
    table: "issue_line",
    file: "apps/api/src/routes/inventory.ts",
    sites: 1,
    guard: "hold",
    why:
      "createIssue's issue_line insertThrough runs inside the same transaction callback " +
      "as its selectForUpdate over every line's item id, so the FK locks it takes are " +
      "already held by this transaction and its row order cannot contribute to a cycle.",
  },
];

// ---------------------------------------------------------------------------
// Schema-derived population
// ---------------------------------------------------------------------------

/** Exported schema symbols whose table has a foreign key onto `inventory_item`. */
function fkChildrenOfInventoryItem(): { symbol: string; table: string }[] {
  const out: { symbol: string; table: string }[] = [];
  for (const [symbol, value] of Object.entries(schema)) {
    if (!is(value, PgTable)) continue;
    const cfg = getTableConfig(value);
    for (const fk of cfg.foreignKeys) {
      const foreign = getTableConfig(fk.reference().foreignTable);
      if (foreign.name === "inventory_item") out.push({ symbol, table: cfg.name });
    }
  }
  return out.sort((a, b) => (a.table < b.table ? -1 : a.table > b.table ? 1 : 0));
}

// ---------------------------------------------------------------------------
// AST enumeration of write sites
// ---------------------------------------------------------------------------

/** Every non-test `.ts` file under apps/api/src, repo-relative, sorted. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
        out.push(relative(REPO_ROOT, full).split(sep).join("/"));
      }
    }
  };
  walk(SRC_ROOT);
  return out.sort();
}

const WRITE_METHODS = new Set(["insert", "insertThrough", "update", "delete"]);

interface Site {
  file: string;
  table: string;
  line: number;
  /** Source text of the innermost function enclosing the call. */
  enclosing: string;
}

/**
 * Source text with comments removed, so a guard token can only be satisfied by CODE.
 * A paragraph naming `inLockOrder(...)` next to an unsorted insert is exactly the shape
 * that shipped twice; it must not pass for the call. Over-stripping (a `//` inside a
 * string literal on the same line as a guard call) can only produce a LOUD false
 * failure, never a silent pass.
 */
function codeOnly(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** The innermost function-like ancestor of `node` (arrow, expression or declaration). */
function enclosingFunction(node: ts.Node): ts.Node | undefined {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (
      ts.isArrowFunction(cur) ||
      ts.isFunctionExpression(cur) ||
      ts.isFunctionDeclaration(cur) ||
      ts.isMethodDeclaration(cur)
    ) {
      return cur;
    }
    cur = cur.parent;
  }
  return undefined;
}

function writeSites(symbolToTable: Map<string, string>): Site[] {
  const sites: Site[] = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(join(REPO_ROOT, file), "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, /* setParentNodes */ true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        const callee = node.expression;
        const name = ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : ts.isIdentifier(callee)
            ? callee.text
            : "";
        const first = node.arguments[0];
        if (WRITE_METHODS.has(name) && first && ts.isIdentifier(first)) {
          const table = symbolToTable.get(first.text);
          if (table) {
            const fn = enclosingFunction(node);
            sites.push({
              file,
              table,
              line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
              enclosing: codeOnly(fn ? fn.getText(sf) : text),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return sites;
}

// ---------------------------------------------------------------------------

describe("B-340 · every lock taker on inventory_item acquires ascending", () => {
  const children = fkChildrenOfInventoryItem();
  const symbolToTable = new Map(children.map((c) => [c.symbol, c.table]));
  const sites = writeSites(symbolToTable);

  it("derives the FK children of inventory_item from the schema, and the registry covers them", () => {
    // v2 of the tenant-db.ts comment named three writers because it had enumerated by
    // eye. This is the enumeration it should have had: any table that gains an FK onto
    // inventory_item lands here with no entry and fails until someone states its guard.
    const derived = [...new Set(children.map((c) => c.table))].sort();
    const registered = [...new Set(WRITERS.map((w) => w.table))].sort();
    expect(
      derived,
      "an FK child of inventory_item has appeared or disappeared. Every INSERT into one " +
        "takes an implicit FOR KEY SHARE on the referenced row, which conflicts with " +
        "TenantDb.selectForUpdate — so each needs a WRITERS entry naming what holds its " +
        "ordering (see lock-order.ts).",
    ).toEqual(registered);
    expect(derived.length, "the schema must have at least one FK child to enforce").toBeGreaterThan(
      0,
    );
  });

  it("finds no write site outside the registry", () => {
    const known = new Set(WRITERS.map((w) => `${w.table}::${w.file}`));
    const stray = sites
      .filter((s) => !known.has(`${s.table}::${s.file}`))
      .map((s) => `${s.file}:${s.line} writes ${s.table}`);
    expect(
      stray,
      "a new writer of an inventory_item FK child. It takes FOR KEY SHARE on every row " +
        "it references, in the order it supplies them — add a WRITERS entry stating " +
        "whether it sorts (inLockOrder) or already holds FOR UPDATE (selectForUpdate).",
    ).toEqual([]);
  });

  it("holds each registered writer to its declared site count and guard", () => {
    for (const w of WRITERS) {
      const mine = sites.filter((s) => s.table === w.table && s.file === w.file);
      expect(
        mine.length,
        `${w.file} was registered with ${w.sites} write site(s) for ${w.table} and now has ` +
          `${mine.length}. A write that appeared, moved or vanished must be re-read against ` +
          `the reason on the entry:\n  ${w.why}`,
      ).toBe(w.sites);
      for (const site of mine) {
        expect(
          site.enclosing.includes(GUARDS[w.guard]),
          `${site.file}:${site.line} writes ${site.table} but its enclosing function no ` +
            `longer contains \`${GUARDS[w.guard]}\`. The registered reason was:\n  ${w.why}\n` +
            `Without it this INSERT takes its FK locks in whatever order its rows arrived ` +
            `in, which is a deadlock against any ascending taker (B-340).`,
        ).toBe(true);
      }
    }
  });

  it("has no stale registry entry pointing at a file that no longer writes", () => {
    const seen = new Set(sites.map((s) => `${s.table}::${s.file}`));
    const stale = WRITERS.filter((w) => !seen.has(`${w.table}::${w.file}`)).map(
      (w) => `${w.file} :: ${w.table}`,
    );
    expect(stale, "a registry entry whose writer is gone — the claim was not re-read").toEqual([]);
  });

  it("keeps inventory_item free of direct writers, which would be a lock taker this scan does not model", () => {
    // Blind spot 5, asserted rather than trusted. An UPDATE/DELETE on inventory_item
    // itself takes a row lock that conflicts with both FOR UPDATE and FOR KEY SHARE, and
    // the registry above only models FK children. createItem INSERTs, which locks no
    // existing row and is therefore not a taker.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const text = readFileSync(join(REPO_ROOT, file), "utf8");
      if (/\.(update|delete)\(\s*inventoryItems\b/.test(text)) offenders.push(file);
    }
    expect(
      offenders,
      "a direct UPDATE/DELETE of inventory_item appeared. It takes a conflicting row lock " +
        "and must acquire ascending like every other taker — extend this test before " +
        "shipping it.",
    ).toEqual([]);
  });

  it("keeps the receipt's anchor lock AHEAD of its gr insert and its ledger writes (B-TBD-QTY)", () => {
    // THE ONE CROSS-TABLE EDGE, and the only one this file models: a receipt locks
    // its anchor po/wo row (a guarded UPDATE — the B-361 pattern, since po/wo carry
    // no company_id) before it reads what has already been received against that
    // order. The ORDER of the three statements is the whole guarantee and none of it
    // is visible at the call site:
    //
    //   · anchor lock BEFORE the `gr` insert — because `gr.po_id` is an FK, so the
    //     insert takes an implicit FOR KEY SHARE on the anchor. KEY SHARE does not
    //     conflict with KEY SHARE, so two receipts would both take it and then both
    //     try to UPGRADE to the exclusive lock, each waiting on the other. Reversing
    //     these two lines turns a serialised wait into PG 40P01 -> 500 -> a field
    //     phone's whole offline drain wedged (lock-order.ts, at length).
    //   · anchor lock BEFORE the stock_ledger loop — so the ascending order is
    //     anchor -> gr -> inventory_item repo-wide.
    //
    // Blind spot 1 applies here as everywhere in this file: this proves the ORDER of
    // the statements in the source, not that the lock covers the rows the read used.
    // That much is read-and-believe, and gr.ts states it.
    const grPath = "apps/api/src/routes/gr.ts";
    const text = readFileSync(join(REPO_ROOT, grPath), "utf8");
    const sf = ts.createSourceFile(grPath, text, ts.ScriptTarget.ES2022, true);

    // The createGr transaction callback = the one whose body writes stock_ledger.
    let body: string | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "transaction" &&
        node.arguments.length === 1
      ) {
        const arg = codeOnly(node.arguments[0]!.getText(sf));
        // ALL whitespace removed, not collapsed: the three statements below are
        // formatted differently (one-liners vs multi-line argument lists) and a
        // prettier pass may re-wrap any of them. Position is what this test reads;
        // layout must not be able to decide it.
        if (arg.includes("stockLedgers")) body = arg.replace(/\s+/g, "");
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    expect(
      body,
      "no db.transaction callback in gr.ts writes stock_ledger — createGr was " +
        "restructured, so the lock-order claim below has to be re-read, not re-run",
    ).toBeDefined();

    const anchorLock = Math.min(
      ...["updateThroughChain(pos,", "updateThroughChain(wos,"]
        .map((t) => body!.indexOf(t))
        .filter((i) => i >= 0),
    );
    const grInsert = body!.indexOf("insertThrough(grs,");
    const ledger = body!.indexOf("insert(stockLedgers,");
    expect(
      Number.isFinite(anchorLock) && anchorLock >= 0,
      "createGr no longer locks its anchor po/wo row before reading what has been " +
        "received. The over-receipt ceiling is a read-then-write; without this lock " +
        "two receipts that each fit under it both pass and both commit (B-342's shape).",
    ).toBe(true);
    expect(grInsert, "createGr's gr header insert was not found").toBeGreaterThan(-1);
    expect(ledger, "createGr's stock_ledger insert was not found").toBeGreaterThan(-1);
    expect(
      anchorLock,
      "the anchor lock must precede the `gr` INSERT. The insert takes FOR KEY SHARE " +
        "on the anchor via gr.po_id; upgrading that to the exclusive lock from two " +
        "transactions at once is a deadlock, not a wait.",
    ).toBeLessThan(grInsert);
    expect(
      anchorLock,
      "the anchor lock must precede the stock_ledger writes — the repo-wide order is " +
        "anchor po/wo -> gr -> inventory_item.",
    ).toBeLessThan(ledger);
  });

  it("probes inLockOrder: the guard token names a real ascending sort", () => {
    // The registry's `guard: "sort"` entries are only worth the token if the token still
    // sorts. A comparator emptied out would leave every one of them passing.
    const scrambled = [
      { itemId: "f0000000-0000-4000-8000-000000000000" },
      { itemId: "a0000000-0000-4000-8000-000000000000" },
      { itemId: "b0000000-0000-4000-8000-000000000000" },
    ];
    expect(inLockOrder(scrambled).map((r) => r.itemId[0])).toEqual(["a", "b", "f"]);
    // Never mutates its input — a caller that also renders the array must be able to
    // trust that (inventory.ts createTransfer relies on stamp-then-sort, not on a copy).
    expect(scrambled.map((r) => r.itemId[0])).toEqual(["f", "a", "b"]);
    // THE CASE TRAP, pinned because it is why every caller must normalise first: ASCII
    // puts every uppercase hex digit BEFORE every lowercase one (0x42 < 0x61), while
    // Postgres compares `uuid` as raw bytes and puts B after a. An uppercase id therefore
    // sorts the OPPOSITE way across the a/b boundary, which is the exact mismatch this
    // ordering exists to remove.
    const mixed = [
      { itemId: "a0000000-0000-4000-8000-000000000000" },
      { itemId: "B0000000-0000-4000-8000-000000000000" },
    ];
    expect(inLockOrder(mixed).map((r) => r.itemId[0])).toEqual(["B", "a"]);
    expect(
      inLockOrder(mixed.map((r) => ({ itemId: r.itemId.toLowerCase() }))).map((r) => r.itemId[0]),
    ).toEqual(["a", "b"]);
  });
});

// THE REPO-WIDE LOCK ORDER on `inventory_item` (B-340 / B-342).
//
// This file exists because the invariant has now been stated wrongly TWICE, and both
// times the error was the same shape: a paragraph that enumerated the lock takers its
// author could see, and read as a property of the table.
//
//   - Round 1 (tenant-db.ts, pre-87e10c2) said the `ORDER BY id` inside
//     selectForUpdate meant "two multi-line documents with overlapping item sets cannot
//     deadlock". True of the two callers that come through that door; false of the
//     table. gr.ts then became a third taker and deadlocked 8 of 14 measured rounds.
//   - Round 2 (87e10c2) corrected that, and named "all three places". There were four:
//     inventory.ts createTransfer had been inserting `transfer_line` — an FK child of
//     `inventory_item` — in client body order the whole time. Measured at 039bfcb, 6
//     rounds x (4 transfers DESC + 4 issues ASC) from 48 separate OS processes on one
//     epoch-ms barrier: 16 of 48 requests answered 500, every one of them a PG 40P01,
//     in 6 of 6 rounds.
//
// So the enumeration is deliberately NOT repeated here in prose. It lives in ONE place
// that cannot go stale by omission — the registry in lock-order.enforce.test.ts, which
// derives the FK children of `inventory_item` from the drizzle schema and fails when a
// child, a writer, or a guard appears or disappears. Prose states the mechanism; the
// test states the population.
//
// THE MECHANISM, invisible at every call site
// -------------------------------------------
// `stock_ledger.item_id`, `transfer_line.item_id` and `issue_line.item_id` are FKs, so
// EVERY INSERT into those tables silently takes
// `SELECT 1 FROM ONLY inventory_item x WHERE id = $1 FOR KEY SHARE OF x`
// on the referenced row — one per inserted row, in ROW ORDER, including inside a single
// multi-row INSERT (its RI triggers fire at end of statement, in the order the rows were
// supplied). FOR KEY SHARE CONFLICTS with the FOR UPDATE that TenantDb.selectForUpdate
// takes on the same rows. An unsorted inserter is therefore a lock taker, in whatever
// order the client's body happened to arrive in, and a lock taker nobody can see.
//
// TWO WAYS TO HOLD THE INVARIANT, and both count:
//   - SORT the rows ascending by item id before inserting (inLockOrder, below); or
//   - insert while ALREADY HOLDING the FOR UPDATE that selectForUpdate took ascending
//     (the guard-lock callers) — the locks are already held, so the insert order is free.
// What is NOT allowed is a third direction. Ascending everywhere is what makes a cycle
// impossible: a waiter only ever holds rows with ids BELOW the one it waits on, so
// "A waits on a row B holds" and "B waits on a row A holds" cannot both be true.
//
// THE SOURCE PR COMES BEFORE inventory_item (B-372), and this is the one
// cross-table edge in the order. gr.ts createGr's over-receipt ceiling is a
// read-then-write, so it takes an EXCLUSIVE lock before reading — a guarded UPDATE,
// the B-361 pattern, because `pr` carries no company_id and TenantDb.selectForUpdate
// cannot reach it.
//
// THE ROW IS THE PR, NOT THE ANCHOR PO/WO, and the difference is load-bearing rather
// than cosmetic. The ceiling's basis is the PR's ordered lines and its accumulator
// sums the PR's receipts, so the PR is the only row every racing receipt against that
// order passes through. An anchor lock looked equivalent and was not: po.ts caps
// nothing about how many POs one PR raises, so two receipts against two DIFFERENT POs
// of the same PR would take two DIFFERENT locks, never block, and both commit. A lock
// has to sit at the grain of the invariant it protects.
//
// IT MUST BE TAKEN BEFORE THE `gr` HEADER INSERT, and that is a deadlock rule, not a
// preference. `gr.po_id`/`gr.wo_id` are FKs, so INSERT INTO gr takes an implicit FOR
// KEY SHARE on the anchor, and `po.pr_id`/`wo.pr_id` are FKs so INSERT INTO po/wo
// takes one on the PR. KEY SHARE does not conflict with KEY SHARE, so two writers
// would BOTH hold it and then both try to UPGRADE to the exclusive lock — each
// waiting on the other's. Taking the exclusive lock while no KEY SHARE is held yet
// makes that upgrade impossible; the second receipt waits at the first statement
// instead. The full ascending order for a receipt is therefore:
//
//     pr  ->  gr  ->  inventory_item
//
// Nothing inverts it: pr.ts / po.ts / wo.ts take their locks standalone (none of those
// files opens a transaction at all), gl-posting.ts's lockPostableGr takes only `gr`
// (its UPDATE leaves po_id/wo_id untouched, so no FK recheck re-takes anything), and
// inventory.ts takes only inventory_item. The POSITION of that lock — before the
// header insert, before the ledger loop — is pinned in lock-order.enforce.test.ts,
// because it is exactly the thing prose here cannot keep true by itself.
//
// WHY 40P01 IS NOT A COSMETIC FAILURE. `grep -rn "40P01\|deadlock" apps/api/src` finds
// no handler, so PG's chosen victim rethrows to the 500 handler — and sync_processor.dart
// DEFERS a 5xx: one deadlocked receipt or transfer stops the phone's ENTIRE offline drain
// and deadlocks again on every retry. That is the exact wedge labor.ts's
// ATTENDANCE_COSTED_DAY_CONSTRAINT comment was written to avoid, reintroduced by a
// different mechanism.

/**
 * A copy of `rows` in the repo-wide lock order: ASCENDING by `itemId` (never mutates).
 *
 * WHY ASCENDING *STRING* ORDER IS THE ORDER POSTGRES USES: `uuid` compares as its 16 raw
 * bytes, and the canonical LOWERCASE hex text form sorts identically byte for byte (hex
 * digits 0-9 then a-f are ASCII-ordered). The `a`/`b` boundary is where it bites: raw JS
 * puts `B0…` BEFORE `a0…` (0x42 < 0x61) while Postgres puts it after, so a caller that
 * lets a client's uppercase uuid through would sort the exact opposite way on that pair.
 * Every caller must therefore hand this function CANONICAL LOWERCASE ids, and each does
 * so by a different route — gr.ts normalises with `uuidOrNull().toLowerCase()`;
 * inventory.ts's line parse is gated on a `Map` keyed by ids read back from Postgres, so
 * a non-canonical id is a 400 before it ever reaches here. Verified live:
 * `array_agg(id ORDER BY id)` = `array_agg(id ORDER BY id::text)` over the catalogue.
 *
 * A TIE IS DELIBERATE AND SAFE: two lines naming the SAME item compare equal, JS's sort
 * is stable so their body order survives, and taking a row lock twice inside one
 * transaction is a no-op. Nothing sorted here may be rendered — see the caller note in
 * inventory.ts createTransfer, where the SAME array is also the transfer's ordered body.
 */
export function inLockOrder<T extends { itemId: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
}

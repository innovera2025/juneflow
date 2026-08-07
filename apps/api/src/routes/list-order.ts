// Deterministic list ordering (B-323).
//
// THE DEFECT THIS CLOSES
// ----------------------
// `grep -rn "orderBy" apps/api/src packages/db/src` returns ZERO. Every one of the
// 68 `listEnvelope` endpoints returns rows in whatever order Postgres happened to
// produce. For a single-table `SELECT ... WHERE company_id = $1` that is the heap
// order (stable in practice on a freshly seeded, never-updated table), but
// `selectThrough()` emits INNER JOINs whose plan (hash vs nested-loop) flips with
// autovacuum/ANALYZE timing — so the SAME code on two fresh stacks returns rows in
// two different orders. Measured on `GET /gr`, which reads six joined chains and
// ships `[...poGrs, ...woGrs]` unsorted: 0 px on one stack and 253,533 px (15.8%,
// the whole table body vertically offset) on the next, with no code change.
//
// WHY THIS IS IN TYPESCRIPT AND NOT `ORDER BY`
// -------------------------------------------
// A SQL `ORDER BY` pushed into the TenantDb read doors would be the tidier fix in
// isolation, and it was the first thing tried. Two pieces of evidence argue against
// it, and both were checked rather than assumed:
//
//  1. A SINGLE blanket order is wrong for half the callers, because a Juneflow list
//     is one of two different things (see TWO KINDS below) and they want opposite
//     directions. Pushing one order into the door would silently impose the document
//     order on line collections.
//  2. It would be INVISIBLE to the test suite. All 49 api route suites stub the db
//     with hand-rolled builders that return canned arrays from `.where()`; a SQL
//     clause they never execute cannot be asserted, so the property would ship
//     untested and survive its own revert. Sorting the resolved rows is exercised by
//     those same stubs — feed them a scrambled array and the assertion dies when the
//     sort is removed.
//
// TWO KINDS OF LIST — AND WHY ONE ORDER CANNOT SERVE BOTH
// -------------------------------------------------------
// A **document/master list** (GET /po, /pr, /wo, /boq, /pm/assets, …) is a set of
// independent rows. Nothing about it implies a stored sequence, and the app already
// intends newest-first — `newestFirst()` was hand-rolled in five route files with the
// docstring "(mock list order)". Order: `created_at DESC, id ASC` → `newestFirst()`.
//
// A **document LINE collection** (`gr_item`, `boq_item`, `pr_item`, `jv_line`,
// `ar_invoice_line`, `transfer_line`, `issue_line`) is the ordered body of ONE parent.
// Its meaning IS the order the user typed it, and NONE of these tables carries a `seq`
// column, so entry order lives only in what the writer records. Order:
// `created_at ASC, id ASC` → `entryOrder()`.
//
// THE TRAP THAT ROUND 1 FELL INTO (and this round closes)
// -------------------------------------------------------
// Round 1's version of this file argued — correctly — that ordering lines by
// `created_at` "would replace an order that is usually right with one that is
// deterministically wrong", and then `gr.ts` did exactly that, calling `newestFirst()`
// over `[...poItems, ...woItems]`. Under the seed the call is a NO-OP (seed/stamp.ts
// hands every row a distinct instant in array order), so nothing in the suite or the
// visual gate could see it. In PRODUCTION every line of one GR is written by one
// `insertThrough` — one INSERT, one `now()` — so all lines tie on `created_at` and the
// comparator falls through to the `defaultRandom()` uuid: line display order becomes
// **uuid order**, not entry order. That is load-bearing, not cosmetic: `grWire` ships
// `items` on the wire and labels the whole receipt with `items[0].currency_code`.
//
// So the doc was right AND the call had to change. Both halves are fixed here:
//
//   - the READER uses `entryOrder()` (ASC) for lines, so ascending time == entry order;
//   - the WRITER uses `stampEntryOrder()` to give each line of a batch a distinct,
//     strictly increasing `created_at`, so the tie that made the uuid load-bearing
//     never happens in the first place.
//
// Neither half works alone. A reader with no writer stamp still ties; a writer stamp
// with no reader order is still at the mercy of the join plan. `gr.test.ts` pins both
// with TIED timestamps — the seed's stagger hides this defect, so a seed-based test
// proves nothing about it.
//
// DIRECTION
// ---------
// `newestFirst()` matches the seed's default stagger (seed/stamp.ts stamps row index 0
// as the newest), and `entryOrder()` matches the ascending stagger the seed applies to
// the tables listed in `ASCENDING_STAGGER_TABLES` — so under either order a seeded list
// renders in seed-array order, which is the order the app-baselines were captured in.
//
// NOTE the pre-existing helpers were INERT before B-323: with every row sharing the
// transaction's `now()` the comparator returned 0 for every pair and JS's stable sort
// simply preserved the arbitrary DB order. They only start doing real work once the
// seed stamps distinct instants — the two halves of this fix interlock.

/**
 * Milliseconds of a `created_at`, or 0 when absent/unparseable (never NaN).
 *
 * Deliberately NOT `value instanceof Date` — that was the first version and it is
 * wrong twice over: `vi.setSystemTime()` swaps the global `Date` constructor, so a
 * row built before the swap fails the check and every timestamp collapses to 0
 * (the api suite caught exactly this and silently reverted a list to id order), and
 * the same happens across any realm boundary. `new Date(x)` accepts a Date, an ISO
 * string and an epoch number alike — the shape the five helpers this replaces used.
 */
function msOf(value: unknown): number {
  if (value == null) return 0;
  const t = new Date(value as string | number | Date).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Lexicographic compare of two ids, treating a missing id as the empty string. */
function idOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export interface OrderableRow {
  createdAt?: unknown;
  id?: unknown;
}

/**
 * TOTAL order over rows: `created_at` DESC, then `id` ASC.
 *
 * Total matters — a comparator that can return 0 for two distinct rows leaves their
 * relative order to whatever the input order was, which is exactly the DB-order
 * dependency being removed. Equal timestamps are broken by id, and two rows with the
 * same id are the same row.
 */
export function byNewestThenId(a: OrderableRow, b: OrderableRow): number {
  const ta = msOf(a.createdAt);
  const tb = msOf(b.createdAt);
  if (ta !== tb) return tb - ta;
  const ia = idOf(a.id);
  const ib = idOf(b.id);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/** A copy of `rows` in deterministic newest-first order (never mutates the input). */
export function newestFirst<T extends OrderableRow>(rows: readonly T[]): T[] {
  return [...rows].sort(byNewestThenId);
}

/**
 * The id FLOOR: lexicographic `id` ASC, and nothing else.
 *
 * Most lists are not ordered by time at all — they are ordered by a business key
 * (`name`, `code`, `period`, `seq`, `day`, a revenue figure). Every one of those keys
 * can repeat, and a comparator that stops at a repeatable key returns 0 for the pair
 * and hands it straight back to the join plan, which is the whole defect. `|| byIdAsc`
 * is the one-token tail that closes such a comparator without touching the order it
 * actually intends: it can only decide pairs the business key already called equal.
 *
 * Use it as the LAST clause of a comparator, never as the whole comparator (that is
 * `byOldestThenId` minus the timestamp, which no list wants). It is also the reason
 * the enforcement probe in list-order.enforce.test.ts uses `id` as the default floor:
 * a row that reached a route came out of a table whose primary key is `id`.
 */
export function byIdAsc(a: OrderableRow, b: OrderableRow): number {
  const ia = idOf(a.id);
  const ib = idOf(b.id);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/**
 * TOTAL order over rows: `created_at` ASC, then `id` ASC — the ENTRY order of a
 * document's lines, and of any master list the seed transcribes in display order
 * (`ASCENDING_STAGGER_TABLES`).
 *
 * Total for the same reason `byNewestThenId` is: a 0 for two distinct rows hands the
 * pair back to the join plan. But note what the `id` tiebreak MEANS here — for lines
 * it is a `defaultRandom()` uuid, i.e. NOT entry order. It is the last-resort floor
 * that keeps the result deterministic; the thing that makes it *correct* is
 * `stampEntryOrder()` on the write side, which prevents the tie from occurring.
 */
export function byOldestThenId(a: OrderableRow, b: OrderableRow): number {
  const ta = msOf(a.createdAt);
  const tb = msOf(b.createdAt);
  if (ta !== tb) return ta - tb;
  const ia = idOf(a.id);
  const ib = idOf(b.id);
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/** A copy of `rows` in deterministic ENTRY order (never mutates the input). */
export function entryOrder<T extends OrderableRow>(rows: readonly T[]): T[] {
  return [...rows].sort(byOldestThenId);
}

/**
 * Spacing between consecutive lines of ONE document write. Mirrors the seed's
 * `SEED_STEP_MS` intent at the millisecond the wire needs: `timestamptz` keeps
 * microseconds, so 1 ms is ample separation and moves no rendered date.
 */
export const LINE_STEP_MS = 1;

/**
 * Give each line of a batch a distinct, strictly increasing `created_at` so its ENTRY
 * ORDER is RECORDED rather than inferred.
 *
 * This is the write half of `entryOrder()`. Without it, `insertThrough(grItems, …,
 * lines)` is one INSERT statement, every row takes the transaction's `now()`, all
 * lines tie, and the only surviving tiebreak is a random uuid — so a 3-line GR renders
 * in uuid order. `gr_item`, `boq_item`, `pr_item`, `jv_line`, `ar_invoice_line`,
 * `transfer_line` and `issue_line` all carry NO `seq` column, so there is nowhere else
 * for entry order to live.
 *
 * A draft that already sets `createdAt` keeps it (the seed stamps its own ladder).
 * `updatedAt` is deliberately left to the column default — a just-written line has not
 * been updated, and nothing orders on it.
 */
// The constraint is `object`, NOT `{ createdAt?: unknown }`. A draft row built as an
// object literal with no `createdAt` key at all — which is every line-insert call site
// in the routes — has no property in common with a type whose members are all
// optional, so TypeScript's weak-type check REJECTED it. That turned the compiler into
// an argument against stamping exactly the batches that most need it. The return type
// records what the function actually does: every row comes back carrying a createdAt.
export function stampEntryOrder<T extends object>(
  drafts: readonly T[],
  base: Date = new Date(),
): (T & { createdAt: Date })[] {
  const t0 = base.getTime();
  return drafts.map((d, i) =>
    (d as { createdAt?: unknown }).createdAt === undefined
      ? { ...d, createdAt: new Date(t0 + i * LINE_STEP_MS) }
      : d,
  ) as (T & { createdAt: Date })[];
}

/**
 * Deterministic order for a feed assembled from several SOURCES, keeping the source
 * blocks in the order the handler built them and ordering only WITHIN each block.
 *
 * Two handlers assemble a queue this way — the gl.inbox posting feed (pv, rv, gr,
 * payroll, petty) and the dashboard approval inbox (PR, PO, WO) — and both were
 * relying, without saying so, on every row sharing the transaction's `now()`: JS's
 * sort is stable, so a comparator that returned 0 for every pair preserved the block
 * order for free. The dashboard even documents the accident ("JS's stable sort keeps
 * the PR→PO→WO grouping for equal times"). Once created_at actually varies, a plain
 * newest-first sort interleaves the sources and the screen looks different.
 *
 * Determinism does not require that. Ranking by source FIRST keeps exactly what ships
 * today and still leaves no pair unordered — which is the right trade for a round
 * whose job is reproducibility, not redesign. Whether these queues SHOULD be a single
 * date-ordered list is a product question, and a separate one.
 */
export function bySourceThenNewest<T extends { created_at?: unknown; id?: unknown }>(
  rows: readonly T[],
  sourceRank: (row: T) => number,
): T[] {
  return [...rows].sort((a, b) => {
    const ra = sourceRank(a);
    const rb = sourceRank(b);
    if (ra !== rb) return ra - rb;
    return byNewestThenId(
      { createdAt: a.created_at, id: a.id },
      { createdAt: b.created_at, id: b.id },
    );
  });
}

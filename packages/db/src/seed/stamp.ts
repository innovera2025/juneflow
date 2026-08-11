// @juneflow/db — seed row stamping (B-323).
//
// WHY THIS EXISTS
// ---------------
// Every table in packages/db/src/schema/** declares
//
//     createdAt: timestamp("created_at", ...).notNull().defaultNow()
//
// `defaultNow()` is a POSTGRES-side wall-clock default. `SEED_FROZEN_NOW`
// (B-224) freezes the seed script's BUSINESS clock (`SEED_NOW`, due dates, EVM
// periods) and the api's ap/ar aging DISPLAY clock (`businessNowMs`) — two
// layers that never touch what the database itself writes. So before this
// module, every freshly seeded stack stamped a DIFFERENT `created_at` on all
// 72 seeded tables, and the visual gate only reproduced on the stack that had
// captured it (measured drift: petty 936 px · gl.inbox 428 px ·
// notifications 276 px, against a 160 px threshold, GROWING with elapsed wall
// time).
//
// The seed already solved this problem TWICE, locally, for the two tables where
// it happened to bite (both comments are worth reading):
//   - seed/index.ts org tree — `createdAt: new Date(ORG_EPOCH + i * 1000)`
//     "all rows would otherwise share the transaction's now()"
//   - seed/index.ts audit log — `at: new Date(SEED_NOW.getTime() - i * 4h)`
//     "defaultNow collapsed all 13 rows to one instant"
// This module lifts that pattern to every insert so the 75th one cannot forget.
//
// SHAPE OF THE STAMP
// ------------------
// Row `i` of an insert batch gets `SEED_NOW - i * SEED_STEP_MS`, i.e. index 0 is
// the NEWEST. That direction is not arbitrary — it is what the rest of the
// system already assumes:
//   - the seed arrays are transcribed newest-first (PETTY_TX runs PT-2026-0148
//     down to -0143; AP_BILL runs 0184 down to 0180);
//   - the api's own list helper is `newestFirst()`, whose docstring reads
//     "(mock list order)" — so createdAt DESC == seed array order == the order
//     the app-baselines were captured in.
// Anchoring on SEED_NOW rather than a fixed epoch keeps prod/dev BYTE-IDENTICAL
// in behaviour: with SEED_FROZEN_NOW unset, SEED_NOW is `new Date()`, so demo
// data still looks freshly created; only the frozen gate is pinned.
//
// A row that sets `createdAt` ITSELF always wins — the org tree keeps its
// ORG_EPOCH ascending stagger (GET /org-units sorts siblings by created_at ASC)
// and the audit log keeps its 4-hour time series.

import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

/** The SQL table name, or "" for anything drizzle does not recognise as a table. */
function tableName(table: PgTable): string {
  try {
    return getTableName(table);
  } catch {
    return "";
  }
}

/**
 * Spacing between consecutive rows of one insert batch. 1s matches the org-tree
 * precedent (`i * 1000`). Deliberately small: the largest seeded batch is 84
 * rows, so a whole table spans < 90s and every row lands on the same calendar
 * DAY as SEED_NOW — the stagger pins row ORDER without moving any rendered date
 * across a day/month boundary (several handlers bucket `created_at` by CE month).
 */
export const SEED_STEP_MS = 1000;

/**
 * Which end of the ladder array index 0 sits on.
 *
 * Both directions run BACKWARD from `seedNow` (no seeded row is ever stamped in the
 * future); they differ only in whether the array's first element is the newest or
 * the oldest.
 */
export type StaggerDirection = "newest-first" | "oldest-first";

/**
 * Tables whose API reads order by created_at ASCENDING, so their seed ladder must
 * ascend with the array index or the rendered result comes out REVERSED.
 *
 * A sweep of all created_at-driven `.sort()` sites in apps/api found these ascending
 * readers; every other list is newest-first:
 *   - org-units.ts:67      byCreatedThenId      — the org tree
 *   - project-nodes.ts:41  bySibling            — project → phase → block → unit
 *   - dashboard.ts:150     resolvePrimaryProject — sorts `project` ASC and takes [0]
 *   - projects.ts:155      entryOrder           — GET /projects, anchored on the same
 *                                                 hero-project convention
 *   - gr.ts / boq.ts       entryOrder           — DOCUMENT LINES (gr_item, boq_item):
 *                                                 a line collection renders top-down in
 *                                                 the order it was entered, so its
 *                                                 ladder must ascend with the array
 *
 * The line tables are the ones that make this set load-bearing rather than cosmetic.
 * `gr_item` and `boq_item` carry no `seq` column, so entry order lives only in
 * `created_at`; the api's write paths stamp a real batch apart (stampEntryOrder), and
 * the seed's ladder has to point the SAME way or a seeded receipt renders its lines
 * bottom-up while a freshly created one renders them top-down.
 *
 * `org_unit` already sets its own createdAt (the ORG_EPOCH ladder), so it never
 * reaches this fallback; it is listed anyway so the three stay together and removing
 * the explicit ladder cannot silently flip the tree.
 *
 * MEASURED, not assumed. With a uniform newest-first ladder the visual gate moved
 * `master-project` by 541,717 px (33.9%) and `sales-process` by 270,889 px (16.9%)
 * — the whole unit grid inverted. Before B-323 every project_node row tied on the
 * transaction's now(), so `bySibling` fell through to its `name` tiebreak and the
 * units came out B-01..B-84; a descending ladder made the first comparison decisive
 * and the name tiebreak never ran. `project` is the same shape one level up:
 * resolvePrimaryProject returned the LAST seeded project instead of the hero project
 * (`project:rjp`, seed index 0) that the timeline, EVM and milestone seeds all anchor
 * on. NB the pre-fix behaviour was not right either — with every row tied it fell to
 * the uuid tiebreak and picked a third project — so this is a fix, not a restoration.
 */
export const ASCENDING_STAGGER_TABLES: ReadonlySet<string> = new Set([
  "project_node",
  "org_unit",
  "project",
  "gr_item",
  "boq_item",
]);

/** The instant a batch's row `i` (of `count`) is stamped with. */
export function stampAt(
  seedNow: Date,
  index: number,
  count = 0,
  direction: StaggerDirection = "newest-first",
): Date {
  const step = direction === "newest-first" ? index : Math.max(count - 1, 0) - index;
  return new Date(seedNow.getTime() - step * SEED_STEP_MS);
}

/**
 * Does this drizzle column default to the DATABASE's wall clock — i.e. was it declared
 * `.defaultNow()`?
 *
 * Asked STRUCTURALLY, off the column metadata, rather than by listing column names.
 * That is the whole point: `created_at` and `updated_at` are merely the two commonest
 * columns of this shape, not the only ones. `evm_snapshot.captured_at` is a third
 * (measured on a frozen-clock stack: created_at = 2026-07-20 09:00:00 but captured_at
 * = 2026-08-07 09:52:47, the real wall clock), and `stock_ledger.moved_at` is a fourth
 * that is simply not seeded yet. A name-based stamper reports "fixed" and leaves both
 * drifting; this one catches the NEXT such column the day it is declared.
 *
 * drizzle models `.defaultNow()` as `hasDefault` + a `SQL` default whose one chunk is
 * the literal `now()`; a JS-value default (`.default("THB")`) is a plain string, and
 * `.defaultRandom()` is `gen_random_uuid()`, so neither matches.
 */
function isWallClockDefault(column: unknown): boolean {
  const c = column as {
    columnType?: string;
    hasDefault?: boolean;
    default?: { queryChunks?: { value?: unknown }[] };
  };
  if (!c?.hasDefault) return false;
  if (c.columnType !== "PgTimestamp" && c.columnType !== "PgTimestampString") return false;
  const chunks = c.default?.queryChunks;
  if (!Array.isArray(chunks)) return false;
  return chunks.some((chunk) =>
    String((chunk as { value?: unknown })?.value ?? "")
      .toLowerCase()
      .includes("now()"),
  );
}

/** The JS property keys of every `.defaultNow()` timestamp column on `table`. */
export function wallClockColumns(table: PgTable): string[] {
  const cols = getTableColumns(table) as Record<string, unknown>;
  return Object.keys(cols).filter((key) => isWallClockDefault(cols[key]));
}

/**
 * Fill in EVERY `.defaultNow()` timestamp on a batch of seed rows, deterministically.
 *
 * - the columns are discovered from the schema, not from a name list, so a table with
 *   `captured_at` / `moved_at` / `at` is stamped exactly like one with `created_at`;
 * - only columns the table actually declares are touched (`stock_ledger` and
 *   `audit_log` carry no `updated_at`);
 * - a caller-supplied value is NEVER overwritten (the org tree keeps its ORG_EPOCH
 *   ladder, the audit log its 4-hour series);
 * - `created_at` gets the batch ladder; every OTHER wall-clock column MIRRORS it —
 *   a seeded row has never been updated and its snapshot was taken when it was
 *   written, so any other value would be a lie. A column that wants its own business
 *   meaning (e.g. `captured_at` = period close) should be set explicitly at the seed
 *   call site; the mirror is the honest default, not a claim.
 */
export function stampRows<T extends PgTable>(
  table: T,
  rows: readonly T["$inferInsert"][],
  seedNow: Date,
): T["$inferInsert"][] {
  const keys = wallClockColumns(table);
  if (keys.length === 0) return rows as T["$inferInsert"][];

  const direction: StaggerDirection = ASCENDING_STAGGER_TABLES.has(tableName(table))
    ? "oldest-first"
    : "newest-first";
  const hasCreatedAt = keys.includes("createdAt");

  return rows.map((row, i) => {
    const r = row as Record<string, unknown>;
    const fallback = stampAt(seedNow, i, rows.length, direction);
    // The row's anchor instant: its own createdAt when it set one, else the ladder.
    const anchor = (hasCreatedAt ? r.createdAt ?? fallback : fallback) as Date;
    const patch: Record<string, unknown> = {};
    for (const key of keys) {
      if (r[key] === undefined) patch[key] = anchor;
    }
    return (
      Object.keys(patch).length === 0 ? row : { ...r, ...patch }
    ) as T["$inferInsert"];
  });
}

/** The one insert method the seed uses — `tx.insert(table).values(rows)`. */
export interface StampedInsertBuilder<T extends PgTable> {
  values(rows: T["$inferInsert"] | readonly T["$inferInsert"][]): Promise<unknown>;
}

/** The subset of a drizzle transaction the seed touches, with stamping folded in. */
export interface StampingTx {
  insert<T extends PgTable>(table: T): StampedInsertBuilder<T>;
  execute(query: unknown): Promise<{ rows: Record<string, unknown>[] }>;
  /**
   * Straight passthrough — the seed's one UPDATE (re-pointing wo.contract_id once
   * the subcon contracts exist) needs no stamping: no column in the schema carries
   * `$onUpdate`, so `updated_at` keeps the value the INSERT stamped, which is what
   * "this row has never been edited by a user" should mean.
   */
  update<T extends PgTable>(table: T): {
    set(values: Partial<T["$inferInsert"]>): { where(predicate: unknown): Promise<unknown> };
  };
}

interface RawTx {
  insert(table: never): { values(rows: never): Promise<unknown> };
  execute(query: never): Promise<unknown>;
  update(table: never): { set(values: never): { where(predicate: never): Promise<unknown> } };
}

/**
 * Wrap a drizzle transaction so EVERY insert through it is stamped. This is the
 * whole enforcement mechanism: the seed body only ever sees the wrapper, so an
 * insert added later cannot silently fall back to `defaultNow()`.
 *
 * The public surface is typed on `T["$inferInsert"]`, so the seed's 74 row
 * literals keep exactly the compile-time checking they had against the raw
 * transaction — the `never` casts are confined to this adapter.
 */
export function stampingTx(tx: RawTx, seedNow: Date): StampingTx {
  return {
    execute: (query) =>
      tx.execute(query as never) as Promise<{ rows: Record<string, unknown>[] }>,
    update<T extends PgTable>(table: T) {
      return {
        set(values: Partial<T["$inferInsert"]>) {
          return {
            where: (predicate: unknown) =>
              tx.update(table as never).set(values as never).where(predicate as never),
          };
        },
      };
    },
    insert<T extends PgTable>(table: T): StampedInsertBuilder<T> {
      return {
        values(rows) {
          const list = (Array.isArray(rows) ? rows : [rows]) as readonly T["$inferInsert"][];
          return tx.insert(table as never).values(stampRows(table, list, seedNow) as never);
        },
      };
    },
  };
}

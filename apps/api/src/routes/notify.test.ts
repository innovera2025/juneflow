// G3 unit tests (PLAN.md §9) — the notification EMITTER (B-367).
//
// What these prove, and what they deliberately do not:
//  · The fan-out set is derived from role.approval_level, through the SCOPED
//    TenantDb door, and excludes accounts that cannot act.
//  · A decision notification goes to the requester and NOBODY else, and a PR
//    with a null requester emits NOTHING (rather than picking someone).
//  · The bell never changes the caller's answer: an emitter that throws is
//    logged and swallowed.
//  · They do NOT prove any of the events this module refuses to emit — those are
//    absences, and the honest test for an absence is the grep in the header of
//    notify.ts plus the two route tests below asserting the emit COUNT.
//
// Every row comes from the stub; no expected value is read back off the impl.
import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { notifications, roles, users } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { TenantDb } from "../db/tenant-db.js";
import { bestEffortNotify, notifyPrDecided, notifyPrSubmitted } from "./notify.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const D = new Date(1_700_000_000_000);

interface Inserted {
  table: unknown;
  values: Record<string, unknown>;
}
interface Read {
  table: unknown;
  where: SQL | undefined;
}

function stubDb(
  rows: Array<[unknown, unknown[]]>,
  inserted: Inserted[] = [],
  reads: Read[] = [],
): Db {
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  const builderFor = (table: unknown) => {
    const builder = {
      $dynamic: () => builder,
      innerJoin: () => builder,
      where: (where: SQL) => {
        reads.push({ table, where });
        return Promise.resolve(rowsFor(table));
      },
      then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) => {
        reads.push({ table, where: undefined });
        return Promise.resolve(rowsFor(table)).then(onOk, onErr);
      },
    };
    return builder;
  };
  return {
    select: () => ({ from: (table: unknown) => builderFor(table) }),
    insert: (table: unknown) => ({
      // B-388 · BOTH insert doors. TenantDb.insert() returns the builder WITHOUT
      // .returning() and the caller awaits it directly, so a `.returning()`-only
      // stub records nothing for such a write and every absence assertion about
      // it is vacuous. One `record()` closure sits behind both doors — invoked
      // once per DOOR CALL, never in the `values(...)` body (which would make
      // `.returning()` double-count). Evidence at the foot of this file.
      values: (values: Record<string, unknown>) => {
        const record = (): Record<string, unknown>[] => {
          inserted.push({ table, values });
          return [values];
        };
        return {
          returning: () => Promise.resolve(record()),
          // The awaited-directly door (plain scoped insert, no .returning()).
          then: (onOk: (r: unknown) => unknown, onErr: (e: unknown) => unknown) =>
            Promise.resolve(record()).then(onOk, onErr),
        };
      },
    }),
  } as unknown as Db;
}

const role = (id: string, level: number) => ({
  id,
  companyId: COMPANY,
  name: id,
  approvalLevel: level,
  createdAt: D,
  updatedAt: D,
});
const user = (id: string, roleId: string | null, status = "active") => ({
  id,
  companyId: COMPANY,
  email: `${id}@t.co`,
  name: id,
  roleId,
  status,
  createdAt: D,
  updatedAt: D,
});

const PR = "aaaaaaaa-0000-0000-0000-000000000001";

describe("notifyPrSubmitted — the approver fan-out", () => {
  it("addresses every user whose role reaches the tier, and only those", async () => {
    const inserted: Inserted[] = [];
    const db = new TenantDb(
      stubDb(
        [
          [roles, [role("r-l1", 1), role("r-l3", 3), role("r-l4", 4)]],
          [
            users,
            [
              user("u-site", "r-l1"),
              user("u-pm", "r-l3"),
              user("u-md", "r-l4"),
              user("u-noroleq", null),
            ],
          ],
        ],
        inserted,
      ),
      COMPANY,
    );

    const written = await notifyPrSubmitted(db, PR, 3);

    expect(written).toBe(2);
    const recipients = inserted.map((i) => i.values.userId).sort();
    expect(recipients).toEqual(["u-md", "u-pm"]);
    for (const row of inserted) {
      expect(row.table).toBe(notifications);
      expect(row.values.type).toBe("approval");
      expect(row.values.ref).toBe(`pr:${PR}`);
      // the scoped insert door force-sets the tenant on every row
      expect(row.values.companyId).toBe(COMPANY);
    }
  });

  it("excludes a BLOCKED account — it cannot log in, so it cannot approve", async () => {
    const inserted: Inserted[] = [];
    const db = new TenantDb(
      stubDb(
        [
          [roles, [role("r-l4", 4)]],
          [users, [user("u-live", "r-l4"), user("u-blocked", "r-l4", "blocked")]],
        ],
        inserted,
      ),
      COMPANY,
    );

    expect(await notifyPrSubmitted(db, PR, 2)).toBe(1);
    expect(inserted.map((i) => i.values.userId)).toEqual(["u-live"]);
  });

  it("includes an INVITED account — it holds the seat and will redeem the invite", async () => {
    const inserted: Inserted[] = [];
    const db = new TenantDb(
      stubDb(
        [
          [roles, [role("r-l4", 4)]],
          [users, [user("u-invited", "r-l4", "invited")]],
        ],
        inserted,
      ),
      COMPANY,
    );

    expect(await notifyPrSubmitted(db, PR, 2)).toBe(1);
    expect(inserted[0]!.values.userId).toBe("u-invited");
  });

  it("emits NOTHING when no role reaches the tier (an honest empty fan-out, not an error)", async () => {
    const inserted: Inserted[] = [];
    const db = new TenantDb(
      stubDb(
        [
          [roles, [role("r-l2", 2)]],
          [users, [user("u-proc", "r-l2")]],
        ],
        inserted,
      ),
      COMPANY,
    );

    expect(await notifyPrSubmitted(db, PR, 4)).toBe(0);
    expect(inserted).toHaveLength(0);
  });

  it("reads users and roles through the tenant-scoped door (company_id on both)", async () => {
    const reads: Read[] = [];
    const db = new TenantDb(
      stubDb(
        [
          [roles, [role("r-l4", 4)]],
          [users, [user("u-md", "r-l4")]],
        ],
        [],
        reads,
      ),
      COMPANY,
    );
    await notifyPrSubmitted(db, PR, 2);

    const dialect = new PgDialect();
    for (const table of [roles, users]) {
      const read = reads.find((r) => r.table === table);
      expect(read, `no scoped read of ${String(table)}`).toBeTruthy();
      expect(dialect.sqlToQuery(read!.where!).params).toContain(COMPANY);
    }
  });
});

describe("notifyPrDecided — the requester", () => {
  it("writes exactly one info row addressed to the requester", async () => {
    const inserted: Inserted[] = [];
    const db = new TenantDb(stubDb([], inserted), COMPANY);

    expect(await notifyPrDecided(db, PR, "u-requester")).toBe(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.values).toMatchObject({
      userId: "u-requester",
      type: "info",
      ref: `pr:${PR}`,
      companyId: COMPANY,
    });
  });

  it("emits NOTHING when requester_id is null — there is no other record of who raised it", async () => {
    const inserted: Inserted[] = [];
    const db = new TenantDb(stubDb([], inserted), COMPANY);

    expect(await notifyPrDecided(db, PR, null)).toBe(0);
    expect(inserted).toHaveLength(0);
  });
});

describe("bestEffortNotify", () => {
  it("swallows and LOGS an emitter failure, so a committed state change still answers", async () => {
    const logged: unknown[] = [];
    await expect(
      bestEffortNotify(
        { error: (obj) => void logged.push(obj) },
        "pr.submitted",
        async () => {
          throw new Error("db down");
        },
      ),
    ).resolves.toBeUndefined();
    expect(logged).toHaveLength(1);
  });

  it("does not log when the emit succeeds", async () => {
    const logged: unknown[] = [];
    await bestEffortNotify({ error: (obj) => void logged.push(obj) }, "pr.approved", async () => 1);
    expect(logged).toHaveLength(0);
  });
});

// ===========================================================================
// B-388 · SINGLE-RECORDING EVIDENCE for the both-doors insert stub.
//
// Converting a `.returning()`-only stub is behaviourally INERT in this file —
// nothing this route does today writes through the bare TenantDb.insert() door,
// so no assertion above changed verdict when this landed and a green suite is
// NOT evidence the conversion is right. The defect a conversion can introduce is
// a DOUBLE-count (the recording closure invoked on the way in as well as per
// door) or a second door that records somewhere else. Neither is visible to
// stub-insert-door.enforce.test.ts, which proves a `then` KEY EXISTS — not that
// it records correctly. So the recording is asserted here, directly.
// ===========================================================================
describe("B-388 · stubDb's two insert doors record identically, once each", () => {
  interface Door {
    values: (v: Record<string, unknown>) => PromiseLike<Record<string, unknown>[]> & {
      returning: () => Promise<Record<string, unknown>[]>;
    };
  }
  const doorOf = (db: Db, table: unknown): Door =>
    (db as unknown as { insert: (t: unknown) => Door }).insert(table);

  it("records exactly +1 per write and resolves identically, through EITHER door", async () => {
    const inserted: Inserted[] = [];
    const db = stubDb([], inserted);

    expect(inserted).toHaveLength(0);
    const bare = await doorOf(db, notifications).values({ title: "bare" });
    expect(inserted).toHaveLength(1);
    const ret = await doorOf(db, notifications).values({ title: "ret" }).returning();
    expect(inserted).toHaveLength(2);

    expect(inserted).toEqual([
      { table: notifications, values: { title: "bare" } },
      { table: notifications, values: { title: "ret" } },
    ]);
    // This stub echoes the row back verbatim (no synthetic id), so exactly-once
    // rests on the +1 length checks above.
    expect(bare).toEqual([{ title: "bare" }]);
    expect(ret).toEqual([{ title: "ret" }]);
  });
});

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
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          inserted.push({ table, values });
          return Promise.resolve([values]);
        },
      }),
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

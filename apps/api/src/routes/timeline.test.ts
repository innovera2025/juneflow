// G3 unit tests (PLAN.md §9) — GET /projects/{id}/timeline (B-424).
//
// The screen behind this read draws bars from dates, so the properties that
// matter are not "did it return rows" but: is it fail-closed without a tenant,
// does an unknown project 404 rather than leak, does it hand the client the
// SERVER's date to place the today-line with, and does it pass the stored values
// through unchanged — including the two that mean something specific by being
// absent (actual_end null = started and unfinished; start_date null = never
// scheduled).
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { milestones, projects, roles, timelineTasks, users } from "@juneflow/db";
import type { Db } from "@juneflow/db/client";
import { buildApp, type AppDeps } from "../app.js";
import { QuotaGuard, unlimitedQuotaResolver } from "../plugins/quota.js";
import { createFakeR2Storage } from "./files.js";

const COMPANY = "22222222-2222-2222-2222-222222222222";
const PROJECT = "33333333-3333-3333-3333-333333333333";
const SESSION = {
  companyId: COMPANY,
  user: { id: "au-0", email: "somchai@rungrueang.co.th", name: "สมชาย วัฒนกุล" },
};

interface Captured {
  table: unknown;
  where: SQL | undefined;
}

/**
 * Canned-rows stub. Both child reads chain .orderBy() after .where(), so the
 * builder has to answer both shapes — a stub that only resolves on .where()
 * would make the ordered reads hang rather than fail, which is worse than a
 * wrong answer because it looks like a slow test.
 */
function stubDb(
  rows: Array<[unknown, unknown[]]>,
  captured: Captured[] = [],
  updates: Array<{ table: unknown; values: Record<string, unknown> }> = [],
): Db {
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  return {
    // The progress write (B-436) goes through TenantDb.update().returning(); the read
    // tests never touch this branch, and the write tests read `updates` to assert what
    // reached the column rather than trusting the handler's own reply.
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (where: SQL) => ({
          returning: () => {
            captured.push({ table, where });
            updates.push({ table, values });
            const row = rowsFor(table)[0];
            return Promise.resolve(
              row ? [{ ...(row as Record<string, unknown>), ...values }] : [],
            );
          },
        }),
      }),
    }),
    select: () => ({
      from: (table: unknown) => {
        const settle = (where: SQL | undefined) => {
          captured.push({ table, where });
          return Promise.resolve(rowsFor(table));
        };
        const builder: Record<string, unknown> = {
          $dynamic: () => builder,
          innerJoin: () => builder,
          where: (where: SQL) => {
            const afterWhere = {
              orderBy: () => settle(where),
              then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) =>
                settle(where).then(onOk, onErr),
            };
            return afterWhere;
          },
          then: (onOk: (r: unknown[]) => unknown, onErr: (e: unknown) => unknown) =>
            settle(undefined).then(onOk, onErr),
        };
        return builder;
      },
    }),
  } as unknown as Db;
}

function paramsOf(where: SQL | undefined): unknown[] {
  if (!where) return [];
  return new PgDialect().sqlToQuery(where).params;
}

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

async function buildTestApp(overrides: Partial<AppDeps> = {}): Promise<FastifyInstance> {
  app = await buildApp({
    db: overrides.db ?? stubDb([]),
    resolveTenant: overrides.resolveTenant ?? (async () => null),
    signIn: overrides.signIn ?? (async () => null),
    storage: overrides.storage ?? createFakeR2Storage("https://r2.test"),
    quota:
      overrides.quota ??
      new QuotaGuard({ resolver: unlimitedQuotaResolver, upgradeUrl: "https://upgrade.test" }),
    auditSink: overrides.auditSink ?? (async () => {}),
    logger: false,
  });
  return app;
}

const projectRow = (over: Record<string, unknown> = {}) => ({
  id: PROJECT,
  companyId: COMPANY,
  name: "juneflow ราชพฤกษ์",
  startDate: "2026-01-01",
  endDate: "2026-08-29",
  ...over,
});

/** A seeded-shaped Gantt row (timeline_task, migrations 0064/0065). */
const taskRow = (over: Record<string, unknown> = {}) => ({
  id: "tl-0",
  companyId: COMPANY,
  projectId: PROJECT,
  groupLabel: "02 งานโครงสร้าง",
  label: "งานฐานราก B-1 ถึง B-24",
  planStart: "2026-01-09",
  planEnd: "2026-02-08",
  actualStart: "2026-01-09",
  actualEnd: "2026-02-10",
  status: "done",
  pct: "100.00",
  late: true,
  lateDays: 2,
  ...over,
});

const milestoneRow = (over: Record<string, unknown> = {}) => ({
  id: "ms-0",
  companyId: COMPANY,
  projectId: PROJECT,
  label: "ครบฐานราก B-Block",
  day: 40,
  milestoneDate: "2026-02-10",
  status: "done",
  ...over,
});

describe("GET /api/v1/projects/{id}/timeline", () => {
  it("401s without a session (fail closed)", async () => {
    const res = await (await buildTestApp()).inject({ url: `/api/v1/projects/${PROJECT}/timeline` });
    expect(res.statusCode).toBe(401);
  });

  it("404s a project this tenant cannot see, rather than 403", async () => {
    // The scoped read AND-injects company_id, so another tenant's project simply
    // matches nothing. A 403 would confirm the id exists somewhere.
    const res = await (
      await buildTestApp({ resolveTenant: async () => SESSION, db: stubDb([[projects, []]]) })
    ).inject({ url: `/api/v1/projects/${PROJECT}/timeline` });

    expect(res.statusCode).toBe(404);
  });

  it("scopes every read to THIS tenant and THIS project", async () => {
    const captured: Captured[] = [];
    await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb(
          [
            [projects, [projectRow()]],
            [timelineTasks, [taskRow()]],
            [milestones, [milestoneRow()]],
          ],
          captured,
        ),
      })
    ).inject({ url: `/api/v1/projects/${PROJECT}/timeline` });

    // three reads: the project, its tasks, its milestones
    expect(captured).toHaveLength(3);
    for (const c of captured) {
      expect(paramsOf(c.where)).toContain(COMPANY);
    }
    // the two child reads additionally pin the project
    const childReads = captured.filter((c) => c.table === timelineTasks || c.table === milestones);
    expect(childReads).toHaveLength(2);
    for (const c of childReads) {
      expect(paramsOf(c.where)).toContain(PROJECT);
    }
  });

  it("returns the schedule window and the SERVER's date", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([
          [projects, [projectRow()]],
          [timelineTasks, []],
          [milestones, []],
        ]),
      })
    ).inject({ url: `/api/v1/projects/${PROJECT}/timeline` });

    const body = res.json();
    expect(res.statusCode).toBe(200);
    expect(body.project_id).toBe(PROJECT);
    expect(body.start_date).toBe("2026-01-01");
    expect(body.end_date).toBe("2026-08-29");
    // as_of_date exists and is a plain calendar date. The client MUST place the
    // today-line with this rather than the browser clock: the screen also prints
    // the day number in its footer, and two clocks let those disagree.
    expect(body.as_of_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("passes a task's stored columns through unchanged", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([
          [projects, [projectRow()]],
          [timelineTasks, [taskRow()]],
          [milestones, []],
        ]),
      })
    ).inject({ url: `/api/v1/projects/${PROJECT}/timeline` });

    expect(res.json().tasks).toEqual([
      {
        id: "tl-0",
        group_label: "02 งานโครงสร้าง",
        label: "งานฐานราก B-1 ถึง B-24",
        plan_start: "2026-01-09",
        plan_end: "2026-02-08",
        actual_start: "2026-01-09",
        actual_end: "2026-02-10",
        status: "done",
        pct: 100,
        late: true,
        late_days: 2,
      },
    ]);
  });

  it("keeps actual_end NULL for work that has started and not finished", async () => {
    // That null is the difference between a bar drawn to the today-line and a bar
    // drawn to a finish date. Substituting today's date here would report unfinished
    // work as complete, on every row that is in progress.
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([
          [projects, [projectRow()]],
          [timelineTasks, [taskRow({ id: "tl-5", status: "ongoing", actualEnd: null, late: false, lateDays: null })]],
          [milestones, []],
        ]),
      })
    ).inject({ url: `/api/v1/projects/${PROJECT}/timeline` });

    const [task] = res.json().tasks;
    expect(task.actual_end).toBeNull();
    expect(task.late_days).toBeNull();
  });

  it("answers 200 with a null window for a project nobody has scheduled", async () => {
    // Not an error: an unscheduled project is a normal project. The client renders
    // an empty chart; inventing a start would put a bar on today.
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([
          [projects, [projectRow({ startDate: null, endDate: null })]],
          [timelineTasks, []],
          [milestones, []],
        ]),
      })
    ).inject({ url: `/api/v1/projects/${PROJECT}/timeline` });

    expect(res.statusCode).toBe(200);
    expect(res.json().start_date).toBeNull();
    expect(res.json().tasks).toEqual([]);
  });

  it("returns milestones with the day offset the strip positions with", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([
          [projects, [projectRow()]],
          [timelineTasks, []],
          [milestones, [milestoneRow()]],
        ]),
      })
    ).inject({ url: `/api/v1/projects/${PROJECT}/timeline` });

    expect(res.json().milestones).toEqual([
      { id: "ms-0", label: "ครบฐานราก B-Block", day: 40, milestone_date: "2026-02-10", status: "done" },
    ]);
  });

  it("sends no derived geometry — offsets stay one source of truth", async () => {
    // total_days / today_day / bar offsets are date arithmetic against start_date.
    // Sending them too would let the server and the client disagree about the same
    // number, which is the failure this read is shaped to avoid.
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([
          [projects, [projectRow()]],
          [timelineTasks, [taskRow()]],
          [milestones, [milestoneRow()]],
        ]),
      })
    ).inject({ url: `/api/v1/projects/${PROJECT}/timeline` });

    const body = res.json();
    expect(Object.keys(body).sort()).toEqual([
      "as_of_date",
      "end_date",
      "milestones",
      "project_id",
      "start_date",
      "tasks",
    ]);
    for (const forbidden of ["total_days", "today_day", "day_width", "bars"]) {
      expect(body[forbidden]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// ORDERING. gate 4.5 found the first version of this suite could not see it: every
// fixture had ONE task and ONE milestone, so deleting both sorts left all nine
// tests green while the file's own comment claimed the stubs exercised them. These
// hand the stubs a scrambled array, which is what that comment described.
// ---------------------------------------------------------------------------

describe("GET /api/v1/projects/{id}/timeline — row order", () => {
  const scrambled = [
    taskRow({ id: "c", groupLabel: "02", planStart: "2026-03-01" }),
    taskRow({ id: "a", groupLabel: "01", planStart: "2026-02-01" }),
    taskRow({ id: "b", groupLabel: "02", planStart: "2026-01-01" }),
    taskRow({ id: "d", groupLabel: "01", planStart: "2026-02-01" }),
  ];

  it("sorts by group band, then plan start, then id", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([
          [projects, [projectRow()]],
          [timelineTasks, scrambled],
          [milestones, []],
        ]),
      })
    ).inject({ url: `/api/v1/projects/${PROJECT}/timeline` });

    // 01 before 02; inside 01 the two share a start date so `id` breaks the tie;
    // inside 02 the earlier start wins.
    expect(res.json().tasks.map((t: { id: string }) => t.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("is TOTAL — two rows alike but for their id never swap between reads", async () => {
    // A chart whose rows reorder on refresh reads as data that changed. The floor
    // is `id`; without it the order falls back to whatever the join plan produced.
    const twins = [
      taskRow({ id: "z", groupLabel: "01", planStart: "2026-02-01" }),
      taskRow({ id: "y", groupLabel: "01", planStart: "2026-02-01" }),
    ];
    for (const order of [twins, [...twins].reverse()]) {
      const res = await (
        await buildTestApp({
          resolveTenant: async () => SESSION,
          db: stubDb([
            [projects, [projectRow()]],
            [timelineTasks, order],
            [milestones, []],
          ]),
        })
      ).inject({ url: `/api/v1/projects/${PROJECT}/timeline` });
      expect(res.json().tasks.map((t: { id: string }) => t.id)).toEqual(["y", "z"]);
    }
  });

  it("sorts a row with no group or no plan start LAST, never first", async () => {
    // A row that cannot be placed must not displace one that can.
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([
          [projects, [projectRow()]],
          [
            timelineTasks,
            [
              taskRow({ id: "nogroup", groupLabel: null, planStart: "2026-01-01" }),
              taskRow({ id: "real", groupLabel: "01", planStart: "2026-05-01" }),
              taskRow({ id: "nostart", groupLabel: "01", planStart: null }),
            ],
          ],
          [milestones, []],
        ]),
      })
    ).inject({ url: `/api/v1/projects/${PROJECT}/timeline` });

    expect(res.json().tasks.map((t: { id: string }) => t.id)).toEqual(["real", "nostart", "nogroup"]);
  });

  it("sorts milestones by day, then id, with a dayless one last", async () => {
    const res = await (
      await buildTestApp({
        resolveTenant: async () => SESSION,
        db: stubDb([
          [projects, [projectRow()]],
          [timelineTasks, []],
          [
            milestones,
            [
              milestoneRow({ id: "m3", day: 195 }),
              milestoneRow({ id: "m0", day: null }),
              milestoneRow({ id: "m1", day: 0 }),
              milestoneRow({ id: "m2", day: 40 }),
            ],
          ],
        ]),
      })
    ).inject({ url: `/api/v1/projects/${PROJECT}/timeline` });

    expect(res.json().milestones.map((m: { id: string }) => m.id)).toEqual(["m1", "m2", "m3", "m0"]);
  });
});

// ---------------------------------------------------------------------------
// POST /timeline/tasks/{id}/progress — the foreman's progress report (B-436).
//
// The write exists because timeline_task.pct is the only per-activity completion
// percentage in the schema and nothing wrote it. What matters here is not "did it
// return 200" but: is it fail-closed without a permission, does a value that cannot
// be a percentage reach the column, and does the caller get back the number that was
// STORED rather than the one it sent.
// ---------------------------------------------------------------------------

/** A dictionary user row, as loadCaller reads it. */
const userRow = (over: Record<string, unknown> = {}) => ({
  id: "u-0",
  companyId: COMPANY,
  email: SESSION.user.email,
  name: SESSION.user.name,
  roleId: "role-site",
  status: "active",
  isPlatformAdmin: false,
  ...over,
});

/** A role row. `subcon.edit` is the right this endpoint gates on. */
const roleRow = (perms: Record<string, Record<string, boolean>>) => ({
  id: "role-site",
  companyId: COMPANY,
  name: "Site Engineer",
  approvalLevel: 1,
  perms,
});

const SITE_PERMS = { subcon: { view: true, create: true, edit: true } };
const VIEW_ONLY_PERMS = { subcon: { view: true, create: false, edit: false } };

function progressApp(
  perms: Record<string, Record<string, boolean>>,
  tasks: unknown[],
  updates: Array<{ table: unknown; values: Record<string, unknown> }> = [],
) {
  return buildTestApp({
    resolveTenant: async () => SESSION,
    db: stubDb(
      [
        [users, [userRow()]],
        [roles, [roleRow(perms)]],
        [timelineTasks, tasks],
      ],
      [],
      updates,
    ),
  });
}

const post = (app: FastifyInstance, body: unknown, id = "tl-0") =>
  app.inject({ method: "POST", url: `/api/v1/timeline/tasks/${id}/progress`, payload: body });

describe("POST /timeline/tasks/{id}/progress", () => {
  it("refuses a caller with no session", async () => {
    const res = await post(await buildTestApp(), { pct: 40 });
    expect(res.statusCode).toBe(401);
  });

  it("refuses a caller who may view subcon but not edit it", async () => {
    // The seed's Project Manager role is exactly this shape (subcon view-only), so
    // this is not a hypothetical caller.
    const res = await post(await progressApp(VIEW_ONLY_PERMS, [taskRow()]), { pct: 40 });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("stores the reported percent and answers with the STORED row", async () => {
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const res = await post(await progressApp(SITE_PERMS, [taskRow()], updates), { pct: 40 });
    expect(res.statusCode).toBe(200);
    // What reached the column, not what the handler chose to echo.
    expect(updates).toHaveLength(1);
    expect(updates[0]!.table).toBe(timelineTasks);
    expect(updates[0]!.values.pct).toBe("40");
    // And the reply is the post-write value, not the pre-write one.
    expect(res.json().pct).toBe(40);
  });

  it("accepts both ends of the range — 100 is a real report", async () => {
    for (const pct of [0, 100]) {
      const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
      const res = await post(await progressApp(SITE_PERMS, [taskRow()], updates), { pct });
      expect(res.statusCode).toBe(200);
      expect(updates[0]!.values.pct).toBe(String(pct));
    }
  });

  it("refuses a percent outside the range, and writes nothing", async () => {
    for (const pct of [-1, 101]) {
      const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
      const res = await post(await progressApp(SITE_PERMS, [taskRow()], updates), { pct });
      expect(res.statusCode).toBe(400);
      expect(updates).toHaveLength(0);
    }
  });

  it("refuses a present-but-unparseable percent rather than skipping it", async () => {
    // A phone that sent "abc" and got a 200 would believe it reported progress it
    // had not. The same reasoning as labor.ts optCoordPair, one column over.
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const res = await post(await progressApp(SITE_PERMS, [taskRow()], updates), { pct: "abc" });
    expect(res.statusCode).toBe(400);
    expect(updates).toHaveLength(0);
  });

  it("refuses a body with no percent at all", async () => {
    const res = await post(await progressApp(SITE_PERMS, [taskRow()]), {});
    expect(res.statusCode).toBe(400);
  });

  it("404s an unknown task instead of confirming it exists elsewhere", async () => {
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const res = await post(await progressApp(SITE_PERMS, [], updates), { pct: 40 });
    expect(res.statusCode).toBe(404);
    expect(updates).toHaveLength(0);
  });

  it("is naturally idempotent — the same report twice leaves the same value", async () => {
    // The write SETS an absolute value rather than adding to one, which is why it
    // carries no idempotency key. A replay that moved the number would need one.
    const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
    const app = await progressApp(SITE_PERMS, [taskRow()], updates);
    await post(app, { pct: 40 });
    await post(app, { pct: 40 });
    expect(updates.map((u) => u.values.pct)).toEqual(["40", "40"]);
  });
});

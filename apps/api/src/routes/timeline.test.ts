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
import { milestones, projects, timelineTasks } from "@juneflow/db";
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
function stubDb(rows: Array<[unknown, unknown[]]>, captured: Captured[] = []): Db {
  const rowsFor = (table: unknown): unknown[] => {
    for (const [t, r] of rows) if (t === table) return r;
    return [];
  };
  return {
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

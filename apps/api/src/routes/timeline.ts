// GET /projects/{id}/timeline — the project schedule behind the `timeline`
// screen (แผนงานโครงการ, pototype/timeline.jsx ProjectTimeline). B-424.
//
// ONE READ FOR THREE SOURCES, because all three are anchored on the same
// project: the schedule window (project.start_date/end_date, migration 0064),
// the Gantt rows (timeline_task) and the milestone strip (milestone). A
// tenant-wide variant would have no day zero to measure bars from, which is why
// this hangs off /projects/{id} the way /projects/{id}/hierarchy does.
//
// WHAT THIS DELIBERATELY DOES NOT SEND.
//   · Bar offsets, total_days, today_day. Every one of them is date arithmetic
//     against start_date, and sending them would make the server and the client
//     two sources for the same number — the class of bug where a bar and its
//     caption disagree because one was computed twice.
//   · The S-curve. That is GET /boq/reports/evm, the SINGLE reader of
//     evm_snapshot (B-101 D3). A second reader here is exactly what that
//     decision forbids.
//
// WHAT IT DOES SEND, AND WHY: `as_of_date`. The screen draws a today-line and
// also prints "วันที่ N จาก 240 วัน" beneath it. If the client positions the
// line from the browser clock, those two can contradict each other on the same
// screen — and under the G5 gate the line would move between runs. The server
// answers with its OWN date, through businessNowMs() so a frozen seed clock
// (SEED_FROZEN_NOW) freezes this too.
//
// A project with no start_date has no day zero. It is not an error — a project
// nobody has scheduled is a normal project — so the read succeeds with
// start_date null and the client renders an empty chart rather than putting a
// bar on today.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { milestones, projects, timelineTasks } from "@juneflow/db/schema";
import { businessNowMs } from "../business-clock.js";
import { loadCaller, permAllowed } from "./authz.js";

/**
 * Gantt row order: group band, then plan start, then id.
 *
 * SORTED IN TYPESCRIPT, NOT SQL, and that is a repo rule with a reason
 * (list-order.ts, B-323): every route suite stubs the db with a builder that
 * returns canned arrays, so a SQL ORDER BY those stubs never execute would ship
 * untested and survive its own revert. Sorting resolved rows is exercised by the
 * same stubs — hand them a scrambled array and the assertion dies when the sort
 * goes. list-order.enforce.test.ts fails the build on a SQL ordering clause
 * anywhere under apps/api/src — including one written inside a comment, which is
 * how this very sentence had to be rephrased.
 *
 * TOTAL, never tie-blind: `id` is the floor, so two tasks that start the same day
 * inside the same band cannot swap between two reads. A chart whose rows reorder
 * on refresh reads as data that changed.
 */
export function byGroupThenPlanStart(
  a: { groupLabel: string | null; planStart: string | null; id: string },
  b: { groupLabel: string | null; planStart: string | null; id: string },
): number {
  // A task with no group sorts after the named bands rather than jumping to the
  // top: an unlabelled row is the exception, and the exception does not lead.
  const ga = a.groupLabel ?? "\uffff";
  const gb = b.groupLabel ?? "\uffff";
  if (ga !== gb) return ga < gb ? -1 : 1;
  // Likewise a task with no plan start sorts last within its band — it cannot be
  // placed on the chart at all, so it must not displace one that can.
  const pa = a.planStart ?? "\uffff";
  const pb = b.planStart ?? "\uffff";
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Milestone order: the day offset the strip positions with, then id. */
export function byDayThenId(
  a: { day: number | null; id: string },
  b: { day: number | null; id: string },
): number {
  // Day is what the strip measures along; a milestone without one cannot be placed,
  // so it trails rather than landing at day zero.
  const da = a.day ?? Number.MAX_SAFE_INTEGER;
  const db_ = b.day ?? Number.MAX_SAFE_INTEGER;
  if (da !== db_) return da - db_;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** One Gantt row on the wire — the stored columns, nothing derived. */
function taskWire(t: typeof timelineTasks.$inferSelect): Record<string, unknown> {
  return {
    id: t.id,
    group_label: t.groupLabel,
    label: t.label,
    plan_start: t.planStart,
    plan_end: t.planEnd,
    actual_start: t.actualStart,
    // null here means "started and not finished" — the bar the screen draws up
    // to the today-line. Substituting a date would claim the work is done.
    actual_end: t.actualEnd,
    status: t.status,
    pct: t.pct == null ? null : Number(t.pct),
    late: t.late,
    // The STATED count, not actual_end - plan_end: the prototype leaves one
    // overrunning task unmarked, so the subtraction would warn about a row it
    // treats as clean (B-424, migration 0065).
    late_days: t.lateDays,
  };
}

/** One milestone on the wire. `day` is the offset the strip positions with. */
function milestoneWire(m: typeof milestones.$inferSelect): Record<string, unknown> {
  return {
    id: m.id,
    label: m.label,
    day: m.day,
    milestone_date: m.milestoneDate,
    status: m.status,
  };
}

/** 401 for a request with no resolved tenant. */
function unauthenticated(reply: FastifyReply) {
  return reply.code(401).send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
}

/** Register GET /projects/{id}/timeline on the given (already /api/v1-prefixed) scope. */
/**
 * The module whose `edit` right admits a foreman's progress report (B-436).
 *
 * `subcon`, not `wo` or `finance`, and the seed's own role table is the reason: the
 * Site Engineer role — the role the prototype's foreman screen depicts — holds
 * subcon view+create+EDIT while holding only view+create on wo and nothing on
 * finance. Gating on subcon.edit therefore admits exactly the site role and the
 * director, and refuses Sales and a view-only Project Manager. It is also what the
 * prototype's own caption says this write feeds: "% งานที่ส่งจะอัปเดต Progress
 * ผู้รับเหมา".
 */
const PROGRESS_MODULE = "subcon";

/** Percent bounds, inclusive at both ends (100 is a legitimate report). */
const PCT_MIN = 0;
const PCT_MAX = 100;

/**
 * Read `pct` off an opaque body.
 *
 * A PRESENT but unparseable value is a 400, never a silent skip: a phone that sent
 * "abc" and got a 200 back would believe it had reported progress it had not. The
 * same reasoning as labor.ts optCoordPair, one column over.
 */
function readPct(body: Record<string, unknown>): { ok: true; pct: number } | { ok: false; message: string } {
  const raw = body["pct"];
  if (raw === undefined || raw === null) return { ok: false, message: "pct is required" };
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(n)) return { ok: false, message: "pct must be a number" };
  if (n < PCT_MIN || n > PCT_MAX) return { ok: false, message: `pct must be between ${PCT_MIN} and ${PCT_MAX}` };
  return { ok: true, pct: n };
}

export function registerTimelineRoute(app: FastifyInstance): void {
  app.get("/projects/:id/timeline", async (request, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);

    const { id } = request.params as { id: string };

    // Scoped read: the tenant predicate is AND-ed in by TenantDb, so another
    // tenant's project id matches zero rows and answers 404. Not 403 — a 403
    // would confirm the id exists somewhere.
    const [project] = await db.select(projects, eq(projects.id, id));
    if (!project) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `project ${id} not found` });
    }

    // Both child reads are ALSO scoped on their own company_id (timeline_task
    // and milestone each carry one) AND filtered to this project, so a task
    // belonging to another project of the same tenant cannot leak into this
    // chart either.
    const [tasks, msRows] = await Promise.all([
      db.select(timelineTasks, eq(timelineTasks.projectId, id)),
      db.select(milestones, eq(milestones.projectId, id)),
    ]);

    return reply.code(200).send({
      project_id: project.id,
      start_date: project.startDate,
      end_date: project.endDate,
      as_of_date: new Date(businessNowMs()).toISOString().slice(0, 10),
      tasks: [...tasks].sort(byGroupThenPlanStart).map(taskWire),
      milestones: [...msRows].sort(byDayThenId).map(milestoneWire),
    });
  });

  /**
   * POST /timeline/tasks/:id/progress — a foreman reports one activity's percent
   * complete (B-436, mobile fm-progress).
   *
   * WHY THIS COLUMN AND NO OTHER. timeline_task.pct is the only per-activity
   * completion percentage in the schema. A work period carries a STATUS and its own
   * `pct` is a TARGET share, which B-297 (4) already ruled is not progress; a BOQ
   * item is a material or labour line (bags of cement), not an activity. So this
   * writes the column that already means what the screen says, and needs no new
   * table.
   *
   * NO IDEMPOTENCY KEY, deliberately, and the reason is the shape of the write: it
   * SETS an absolute value rather than adding to one. Replaying "pct = 40" leaves
   * the row at 40 however many times it arrives, so the class of bug an
   * idempotency key exists to close (a retry that moves a number twice) cannot
   * occur here. A money write would need one; this is not one.
   *
   * The tenant predicate is AND-ed in by TenantDb, so another tenant's task id
   * matches zero rows and answers 404 — not 403, which would confirm the id exists
   * somewhere.
   */
  app.post("/timeline/tasks/:id/progress", async (request: FastifyRequest, reply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);

    const caller = await loadCaller(request);
    if (!caller) {
      return reply.code(403).send({ code: "FORBIDDEN", message: "caller cannot be attributed" });
    }
    if (!permAllowed(caller.perms, PROGRESS_MODULE, "edit")) {
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: "this action requires the subcon edit permission" });
    }

    const { id } = request.params as { id: string };
    const parsed = readPct((request.body ?? {}) as Record<string, unknown>);
    if (!parsed.ok) {
      return reply.code(400).send({ code: "VALIDATION", message: parsed.message });
    }

    const [task] = await db.select(timelineTasks, eq(timelineTasks.id, id));
    if (!task) {
      return reply.code(404).send({ code: "NOT_FOUND", message: `timeline task ${id} not found` });
    }

    const [updated] = await db
      .update(
        timelineTasks,
        { pct: String(parsed.pct), updatedAt: new Date(businessNowMs()) },
        eq(timelineTasks.id, id),
      )
      .returning();

    // The UPDATE's own returned row, not the one read a moment ago: reporting the
    // pre-write value back would tell the phone its report landed while showing it
    // the number it replaced.
    return reply.code(200).send(taskWire(updated ?? task));
  });
}

/*
 * Data hook for the `timeline` screen (B-424).
 *
 * ONE read for the schedule — GET /projects/{id}/timeline carries the window,
 * the Gantt rows and the milestones together, because all three are anchored on
 * the same project and a chart drawn from three separately-arriving pieces would
 * flicker through states that never existed (bars with no axis, an axis with no
 * bars).
 *
 * The S-curve is the SECOND read, and deliberately a separate one:
 * GET /boq/reports/evm is the single reader of evm_snapshot (B-101 D3), it is
 * already wired for the BOQ reports screen, and duplicating it here would be the
 * second reader that decision exists to prevent. It is reused as-is.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";
import type { MilestoneWire, TimelineTaskWire } from "./timeline-rows";

/** The body of GET /projects/{id}/timeline (the contract types it opaque). */
export interface TimelineWire {
  project_id: string;
  start_date: string | null;
  end_date: string | null;
  /** The SERVER's date — the today-line is placed with this, never the browser's. */
  as_of_date: string | null;
  tasks: TimelineTaskWire[];
  milestones: MilestoneWire[];
}

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** A field off an opaque row, as a string or null. Never a fabricated value. */
function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** A field off an opaque row, as a finite number or null. */
function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // The wire sends numerics as JSON numbers, but a string that is exactly a
  // number is accepted rather than dropped — dropping it would silently empty a
  // percent column if the serialiser ever changed.
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function toTask(row: Record<string, unknown>): TimelineTaskWire {
  return {
    id: str(row.id) ?? "",
    group_label: str(row.group_label),
    label: str(row.label),
    plan_start: str(row.plan_start),
    plan_end: str(row.plan_end),
    actual_start: str(row.actual_start),
    actual_end: str(row.actual_end),
    status: str(row.status),
    pct: num(row.pct),
    late: row.late === true,
    late_days: num(row.late_days),
  };
}

function toMilestone(row: Record<string, unknown>): MilestoneWire {
  return {
    id: str(row.id) ?? "",
    label: str(row.label),
    day: num(row.day),
    milestone_date: str(row.milestone_date),
    status: str(row.status),
  };
}

/** Narrow the opaque body, keeping every absent value absent. */
function parseTimeline(body: unknown): TimelineWire | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const tasks = Array.isArray(b.tasks) ? b.tasks : [];
  const ms = Array.isArray(b.milestones) ? b.milestones : [];
  return {
    project_id: str(b.project_id) ?? "",
    start_date: str(b.start_date),
    end_date: str(b.end_date),
    as_of_date: str(b.as_of_date),
    tasks: tasks.map((r) => toTask(r as Record<string, unknown>)),
    milestones: ms.map((r) => toMilestone(r as Record<string, unknown>)),
  };
}

/**
 * GET /projects/{id}/timeline — the project schedule.
 *
 * Disabled until a project is resolved: firing with an empty id would 404 on
 * every mount and put an error state on a screen that is merely still choosing
 * which project to show.
 */
export function useProjectTimeline(projectId: string | undefined) {
  return useQuery<TimelineWire | null>({
    queryKey: ["timeline", projectId ?? null],
    queryFn: async () =>
      parseTimeline(
        await unwrap(
          apiClient.GET("/projects/{id}/timeline", {
            params: { path: { id: projectId ?? "" } },
          }),
        ),
      ),
    enabled: authed() && !!projectId,
    staleTime: 60_000,
  });
}

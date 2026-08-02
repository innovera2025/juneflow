/*
 * Data hooks for the Labor area (P5-WEB, read-only) — the tenant's worker register
 * and the daily attendance records. Both LaborWorkers and LaborAttendance read here.
 *
 * Every read goes through the generated typed client (api-client.ts) + TanStack Query
 * via unwrap() — no hand-written models/fetch (PLAN.md section 5, apps/web/CLAUDE.md).
 * The prototype held its data in local WORKERS_SEED / a per-worker att map
 * (pototype/labor.jsx); here the server is the system of record:
 *   GET /labor/workers    -> the worker register (listLaborWorkers, B-014 envelope
 *                            `.data`; sorted name asc). Feeds LaborWorkers directly and
 *                            supplies LaborAttendance's roster + the worker_id -> name/
 *                            team/skill/day_rate join.
 *   GET /labor/attendance -> the daily time records (listLaborAttendance, B-014 envelope
 *                            `.data`; sorted day desc). Joined to workers by worker_id.
 *
 * READ-ONLY: no create/update hook is exposed. POST /labor/workers and
 * POST /labor/attendance exist, but wiring the write forms is out of this display
 * round — the screens surface add/save as honest-disabled. A future write round adds
 * the mutation hooks. Rows are the opaque Entity from the contract.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types /labor/* rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache keys for the labor reads (list + future invalidation). */
const WORKERS_KEY = ["labor-workers"] as const;
const ATTENDANCE_KEY = ["labor-attendance"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /labor/workers — the tenant worker register (B-014 envelope `data`). */
export function useLaborWorkers() {
  return useQuery<Row[]>({
    queryKey: WORKERS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/labor/workers"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /labor/attendance — the tenant daily attendance records (B-014 envelope `data`). */
export function useLaborAttendance() {
  return useQuery<Row[]>({
    queryKey: ATTENDANCE_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/labor/attendance"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

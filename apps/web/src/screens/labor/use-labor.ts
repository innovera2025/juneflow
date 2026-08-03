/*
 * Data hooks for the Labor area (P5-WEB) — the tenant's worker register, the daily
 * attendance records, and the payroll runs. LaborWorkers, LaborAttendance, and
 * LaborPayroll read here.
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md section 5, apps/web/CLAUDE.md).
 * The prototype held its data in local WORKERS_SEED / a per-worker att map / PAYROLL_SEED
 * (pototype/labor.jsx); here the server is the system of record:
 *   GET  /labor/workers          -> the worker register (listLaborWorkers, B-014 envelope
 *                            `.data`; sorted name asc). Feeds LaborWorkers directly and
 *                            supplies LaborAttendance's roster + the worker_id -> name/
 *                            team/skill/day_rate join (and LaborPayroll's worker join).
 *   GET  /labor/attendance       -> the daily time records (listLaborAttendance, B-014
 *                            envelope `.data`; sorted day desc). Joined to workers by worker_id.
 *   GET  /labor/payroll          -> the payroll runs (listLaborPayroll, B-014 envelope
 *                            `.data`; sorted created_at desc). Joined to workers by worker_id.
 *   POST /labor/payroll/{id}/post -> post one run to the GL (money=SERVER): the server posts
 *                            a balanced JV Dr 1140 WIP-labor / Cr 1020 bank = the STORED
 *                            amount and returns { id, jv_no, amount }. The client NEVER
 *                            supplies the amount; a double-post / no-amount / missing-COA
 *                            answers 409 (surfaced honestly by the screen).
 *
 * READ-ONLY workers/attendance: POST /labor/workers and POST /labor/attendance exist, but
 * wiring those write forms is out of this display round — the screens surface add/save as
 * honest-disabled. Rows/bodies/responses are the opaque Entity from the contract.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { components } from "@juneflow/contracts";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

type Entity = components["schemas"]["Entity"];
/** Opaque list-row shape (the contract types /labor/* rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache keys for the labor reads (list + invalidation). */
const WORKERS_KEY = ["labor-workers"] as const;
const ATTENDANCE_KEY = ["labor-attendance"] as const;
const PAYROLL_KEY = ["labor-payroll"] as const;

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

/** GET /labor/payroll — the tenant payroll runs (B-014 envelope `data`; created_at desc). */
export function useLaborPayroll() {
  return useQuery<Row[]>({
    queryKey: PAYROLL_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/labor/payroll"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * POST /labor/payroll/{id}/post — post one payroll run to the GL (money=SERVER). The client
 * sends ONLY the run id; the server posts + balances the JV (Dr 1140 WIP-labor / Cr 1020
 * bank = the STORED amount), gated finance.approve, and returns { id, jv_no, amount }. A
 * double-post / no-amount / missing-COA answers 409 (the screen surfaces it, never fabricates
 * success). Invalidates the payroll list on success.
 */
export function usePostLaborPayroll(): UseMutationResult<Entity, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.POST("/labor/payroll/{id}/post", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PAYROLL_KEY }),
  });
}

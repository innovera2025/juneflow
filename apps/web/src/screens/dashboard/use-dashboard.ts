/*
 * Data hooks for the Dashboard screen (P1-WEB-07, B-049) — the 7 real GET /dashboard/*
 * reads (apps/api/src/routes/dashboard.ts, P1-BE-15). Every call goes through the
 * generated typed client (api-client.ts) + TanStack Query via unwrap() — no hand-written
 * models / raw fetch (PLAN.md §5, apps/web/CLAUDE.md). Opaque Entity bodies are parsed to
 * typed rows by dashboard-agg.ts (gate G3).
 *
 * PROJECT SCOPE: the dashboard follows the ProjectSwitcher active project — every hook
 * takes the active project id and forwards it as ?project_id so the aggregation scopes to
 * the project the header shows (the handler's omitted-default resolves a PRIMARY project by
 * id-tiebreak, which need not be the data-rich one — B-049 recon). `period` carries the
 * range switch (only summary / budget-actual accept it per the contract).
 *
 * All queries are gated on a present bearer token (like use-shell-data) so the login
 * screen never fires 401s.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";
import {
  parseSummary,
  parseBudgetActual,
  parseApprovals,
  parsePhaseRows,
  parseAlerts,
  parseCashflow,
  parseContractors,
  parseActivity,
  type Ent,
  type DashSummary,
  type BudgetActual,
  type ApprovalItem,
  type PhaseRow,
  type AlertRow,
  type Cashflow,
  type ContractorRow,
  type ActivityRow,
} from "./dashboard-agg";

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** Rows out of a B-014 list envelope `{ data, page, page_size, total }`. */
function rowsOf(env: { data?: unknown[] } | undefined): Ent[] {
  return (env?.data ?? []) as Ent[];
}

/** GET /dashboard/summary — header meta + type-aware KPIs + health donut. */
export function useDashboardSummary(projectId: string | undefined, range: string) {
  return useQuery<DashSummary | null>({
    queryKey: ["dashboard", "summary", projectId ?? null, range],
    queryFn: async () =>
      parseSummary(
        (await unwrap(
          apiClient.GET("/dashboard/summary", {
            params: { query: { period: range, project_id: projectId } },
          }),
        )) as Ent,
      ),
    enabled: authed(),
    staleTime: 30_000,
  });
}

/** GET /dashboard/budget-actual — time-series (honest-empty on seed) + breakdown. */
export function useDashboardBudgetActual(projectId: string | undefined, range: string) {
  return useQuery<BudgetActual | null>({
    queryKey: ["dashboard", "budget-actual", projectId ?? null, range],
    queryFn: async () =>
      parseBudgetActual(
        (await unwrap(
          apiClient.GET("/dashboard/budget-actual", {
            params: { query: { period: range, project_id: projectId } },
          }),
        )) as Ent,
      ),
    enabled: authed(),
    staleTime: 30_000,
  });
}

/** GET /dashboard/approvals-inbox — pending PR+PO+WO the caller can approve. */
export function useDashboardApprovals(projectId: string | undefined) {
  return useQuery<ApprovalItem[]>({
    queryKey: ["dashboard", "approvals-inbox", projectId ?? null],
    queryFn: async () =>
      parseApprovals(
        rowsOf(
          await unwrap(
            apiClient.GET("/dashboard/approvals-inbox", {
              params: { query: { project_id: projectId } },
            }),
          ),
        ),
      ),
    enabled: authed(),
    staleTime: 30_000,
  });
}

/** GET /dashboard/phase-progress — per-phase built/sold % (budget/status = wire gaps). */
export function useDashboardPhaseProgress(projectId: string | undefined) {
  return useQuery<PhaseRow[]>({
    queryKey: ["dashboard", "phase-progress", projectId ?? null],
    queryFn: async () =>
      parsePhaseRows(
        rowsOf(
          await unwrap(
            apiClient.GET("/dashboard/phase-progress", {
              params: { query: { project_id: projectId } },
            }),
          ),
        ),
      ),
    enabled: authed(),
    staleTime: 30_000,
  });
}

/** GET /dashboard/alerts — rule-based risk alerts (honest-empty on seed). */
export function useDashboardAlerts(projectId: string | undefined) {
  return useQuery<AlertRow[]>({
    queryKey: ["dashboard", "alerts", projectId ?? null],
    queryFn: async () =>
      parseAlerts(
        rowsOf(
          await unwrap(
            apiClient.GET("/dashboard/alerts", {
              params: { query: { project_id: projectId } },
            }),
          ),
        ),
      ),
    enabled: authed(),
    staleTime: 30_000,
  });
}

/** GET /dashboard/cashflow-forecast — 7-day net + line items (empty on seed). */
export function useDashboardCashflow(projectId: string | undefined) {
  return useQuery<Cashflow | null>({
    queryKey: ["dashboard", "cashflow-forecast", projectId ?? null],
    queryFn: async () =>
      parseCashflow(
        (await unwrap(
          apiClient.GET("/dashboard/cashflow-forecast", {
            params: { query: { project_id: projectId } },
          }),
        )) as Ent,
      ),
    enabled: authed(),
    staleTime: 30_000,
  });
}

/** GET /dashboard/contractors — active subcontracts + progress + retention. */
export function useDashboardContractors(projectId: string | undefined) {
  return useQuery<ContractorRow[]>({
    queryKey: ["dashboard", "contractors", projectId ?? null],
    queryFn: async () =>
      parseContractors(
        rowsOf(
          await unwrap(
            apiClient.GET("/dashboard/contractors", {
              params: { query: { project_id: projectId } },
            }),
          ),
        ),
      ),
    enabled: authed(),
    staleTime: 30_000,
  });
}

/**
 * GET /audit-log — the recent-activity feed (group-C Wave-1b). Unlike the /dashboard/*
 * reads this op is NOT project-scoped: the contract exposes only ?entity/user/action/
 * page (company-scope is enforced server-side), so the whole-company feed is fetched
 * unfiltered and parseActivity keeps the 5 newest (API is already newest-first).
 */
export function useDashboardActivity() {
  return useQuery<ActivityRow[]>({
    queryKey: ["dashboard", "activity"],
    queryFn: async () => parseActivity(rowsOf(await unwrap(apiClient.GET("/audit-log")))),
    enabled: authed(),
    staleTime: 30_000,
  });
}

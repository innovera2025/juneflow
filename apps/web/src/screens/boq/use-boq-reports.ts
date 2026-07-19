/*
 * Data hooks for BOQReports (group-C W2b/W3b) — the four real GET /boq/reports/*
 * aggregate reads (B-101). Every call goes through the generated typed client
 * (api-client.ts) + TanStack Query via unwrap() — no hand-written models / raw
 * fetch (PLAN.md §5, apps/web/CLAUDE.md). Each op returns an EntityOk object
 * directly (not a B-014 list envelope), parsed to typed rows by boq-reports-agg.ts.
 *
 * PROJECT SCOPE: the reports follow the active project the shell shows — every hook
 * takes the active project id and forwards it as ?project_id, exactly like the
 * dashboard hooks. When the id is undefined the aggregate spans every BOQ the tenant
 * owns (the handler's tenant-verified default). Queries are gated on a present
 * bearer token (like use-boq-overview / use-shell-data) so the login screen never
 * fires 401s.
 *
 * WIRE NOTE: /boq/reports/boq-vs-nonboq + /boq/reports/cost-type are live on the
 * backend; all four /boq/reports/* ops are live (W2 cost-type/boq-vs-nonboq · W3b
 * variance/evm via the shared evm_snapshot reader). A failing op simply errors → the
 * query's data stays undefined → parse*() returns null → the view renders the honest
 * empty-state shell (never a fabricated number).
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";
import {
  parseBoqVsNonboq,
  parseCostType,
  parseVariance,
  parseEvm,
  type Ent,
  type BoqVsNonBoqReport,
  type CostTypeReport,
  type VarianceReport,
  type EvmReport,
} from "./boq-reports-agg";

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /boq/reports/boq-vs-nonboq — RPT-001 in-plan BOQ vs over-plan Non-BOQ. */
export function useBoqVsNonboq(projectId: string | undefined) {
  return useQuery<BoqVsNonBoqReport | null>({
    queryKey: ["boq-reports", "boq-vs-nonboq", projectId ?? null],
    queryFn: async () =>
      parseBoqVsNonboq(
        (await unwrap(
          apiClient.GET("/boq/reports/boq-vs-nonboq", {
            params: { query: { project_id: projectId } },
          }),
        )) as Ent,
      ),
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /boq/reports/cost-type — RPT-003 Material / Subcon / Labor by work category. */
export function useBoqCostType(projectId: string | undefined) {
  return useQuery<CostTypeReport | null>({
    queryKey: ["boq-reports", "cost-type", projectId ?? null],
    queryFn: async () =>
      parseCostType(
        (await unwrap(
          apiClient.GET("/boq/reports/cost-type", {
            params: { query: { project_id: projectId } },
          }),
        )) as Ent,
      ),
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /boq/reports/variance — RPT-004 plan-vs-actual variance by period. */
export function useBoqVariance(projectId: string | undefined) {
  return useQuery<VarianceReport | null>({
    queryKey: ["boq-reports", "variance", projectId ?? null],
    queryFn: async () =>
      parseVariance(
        (await unwrap(
          apiClient.GET("/boq/reports/variance", {
            params: { query: { project_id: projectId } },
          }),
        )) as Ent,
      ),
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /boq/reports/evm — RPT-005 EVM S-curve (PV/EV/AC) + SPI/CPI indices. */
export function useBoqEvm(projectId: string | undefined) {
  return useQuery<EvmReport | null>({
    queryKey: ["boq-reports", "evm", projectId ?? null],
    queryFn: async () =>
      parseEvm(
        (await unwrap(
          apiClient.GET("/boq/reports/evm", {
            params: { query: { project_id: projectId } },
          }),
        )) as Ent,
      ),
    enabled: authed(),
    staleTime: 60_000,
  });
}

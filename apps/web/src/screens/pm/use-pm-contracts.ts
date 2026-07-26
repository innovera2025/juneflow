/*
 * Data hooks for PMContracts (pm.contracts port, Program-1 P2-WEB-41, Wei ruling
 * B-136 LEAN).
 *
 * The READ list (GET /pm/contracts) already lives in use-pm.ts (usePmContractList,
 * consumed by pm.schedule) — it is re-exported here so the screen has a single
 * contract data surface, and so the create mutation below shares its exact cache
 * key (["pm","contracts"]) for invalidation.
 *
 * The CREATE (POST /pm/contracts) is added here. Every write goes through the
 * generated typed client (api-client.ts) + TanStack Query via unwrap() — no
 * hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The server owns the
 * id; the contract is anchored on the tenant-owned project (fail-closed —
 * apps/api/src/routes/pm.ts resolves project_id THROUGH the tenant scope, 404 on a
 * foreign/absent id).
 *
 * ACCEPTED BODY. The OpenAPI contract (packages/contracts/openapi.yaml POST
 * /pm/contracts) DECLARES { project_id, mode(enum 'ma'|'visits'), visits_per_year,
 * sla } and, since the schema sets no `additionalProperties:false`, additional
 * fields are schema-legal. The handler (apps/api/src/routes/pm.ts L356-411)
 * additionally reads customer_id / value / end / currency_code via pick(), so they
 * ride the body as intended real columns (the GET wire round-trips all of them).
 *
 * NOTE the enum asymmetry: the WRITE mode is 'ma'|'visits' (contract enum;
 * normalizeMode maps ma->MA, visits->per_visit) while the READ wire returns
 * 'MA'|'per_visit' (the stored value). There is NO `no` column on the contract
 * wire (B-136), so no document number is sent. A visits contract with
 * visits_per_year>0 autogens WO shells server-side once assets exist (B-108a) — the
 * create body is unchanged by that.
 */
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { components } from "@juneflow/contracts";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";

// Re-export the read list (defined in use-pm.ts) so the screen imports one surface.
export { usePmContractList } from "./use-pm";

type Entity = components["schemas"]["Entity"];

/** Shared cache key for the PM contract list — matches use-pm.ts PM_CONTRACTS_KEY. */
const PM_CONTRACTS_KEY = ["pm", "contracts"] as const;

/**
 * The POST /pm/contracts body (index-signed so schema-legal extra fields ride
 * through the generated client). `project_id` + `mode` are REQUIRED by the handler;
 * `mode` uses the CONTRACT enum 'ma'|'visits' (normalizeMode maps them to the stored
 * MA|per_visit). customer_id / value / end / currency_code are handler-read real
 * columns carried as additionalProperties. No `no` is carried (the contract wire has
 * no document-number column, B-136).
 */
export interface CreatePmContractBody {
  [key: string]: unknown;
  project_id: string;
  mode: "ma" | "visits";
  customer_id?: string;
  visits_per_year?: number;
  sla?: string;
  value?: number;
  end?: string;
  currency_code?: string;
}

/**
 * POST /pm/contracts — create a PM maintenance contract for a tenant-owned project
 * (pm2.jsx PMContractWizard/PMContractForm, LEAN). The server owns the id; the
 * contract is anchored on the project's tenant scope (fail-closed). Invalidates the
 * contract list on success so the new row (and its derived status) appears.
 */
export function useCreatePmContract(): UseMutationResult<
  Entity,
  unknown,
  CreatePmContractBody
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePmContractBody) =>
      unwrap(apiClient.POST("/pm/contracts", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PM_CONTRACTS_KEY }),
  });
}

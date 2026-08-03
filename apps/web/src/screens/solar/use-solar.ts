/*
 * Data hooks for the Solar/Energy-EPC screens (solar.*). Ported from pototype/solar.jsx +
 * real-forms2.jsx, whose screens each held their data in a local array; here the server is
 * the system of record. Every read/write goes through the generated typed client
 * (api-client.ts) + TanStack Query via unwrap() — no hand-written models/fetch (PLAN.md §5,
 * apps/web/CLAUDE.md). Each list is the B-014 paginated envelope `{ data, ... }`; the screens
 * consume the page rows (`data`).
 *
 * The six solar reads (apps/api/src/routes/solar.ts) are:
 *   GET /solar/inverters    -> real-time inverter register (monitoring table).
 *   GET /solar/om-tickets   -> O&M work-ticket list (the monitor side card).
 *   GET /solar/ppa-invoices -> monthly PPA sell-electricity billing rows.
 *   GET /solar/roi          -> cumulative-cashflow year rows (ROI table).
 *   GET /solar/permit-steps -> permit/approval timeline steps.
 *   GET /solar/warranties   -> equipment warranty register.
 *
 * The Wave-1a workflow writes (B-212/B-215/B-219 · money=NONE — no JV/cost, no client
 * money, no client-derived dates) each invalidate their list on success:
 *   POST /solar/om-tickets/{id}/close -> idempotent close (409 on already-closed).
 *   POST /solar/permit-steps          -> add a permit step (server defaults status=pending).
 *   POST /solar/warranties            -> add a warranty item (server defaults status=active).
 * (The open-OM-ticket create, POST /solar/om-tickets, is registered on the door but its
 * form's team dropdown has no i18n keys / no wire column, so the create affordance stays
 * honest-disabled — no hook wired here.)
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
/** Opaque list-row shape (the contract types every solar row as Entity). */
type Row = Record<string, unknown>;

/** Shared cache keys (list read + write invalidation) for the Wave-1a mutated lists. */
const OM_TICKETS_KEY = ["solar-om-tickets"] as const;
const PERMIT_STEPS_KEY = ["solar-permit-steps"] as const;
const WARRANTIES_KEY = ["solar-warranties"] as const;

/** True when a bearer token is present — the queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /solar/inverters — the real-time inverter register (solar.monitor table). */
export function useSolarInverters() {
  return useQuery<Row[]>({
    queryKey: ["solar-inverters"],
    queryFn: async () => (await unwrap(apiClient.GET("/solar/inverters"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /solar/om-tickets — the O&M work tickets (solar.monitor side card). */
export function useSolarOmTickets() {
  return useQuery<Row[]>({
    queryKey: OM_TICKETS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/solar/om-tickets"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /solar/ppa-invoices — the monthly PPA billing rows (solar.ppa table). */
export function useSolarPpaInvoices() {
  return useQuery<Row[]>({
    queryKey: ["solar-ppa-invoices"],
    queryFn: async () => (await unwrap(apiClient.GET("/solar/ppa-invoices"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /solar/roi — the cumulative-cashflow year rows (solar.roi table). */
export function useSolarRoi() {
  return useQuery<Row[]>({
    queryKey: ["solar-roi"],
    queryFn: async () => (await unwrap(apiClient.GET("/solar/roi"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /solar/permit-steps — the permit/approval timeline steps (solar.permit). */
export function useSolarPermitSteps() {
  return useQuery<Row[]>({
    queryKey: PERMIT_STEPS_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/solar/permit-steps"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /solar/warranties — the equipment warranty register (solar.warranty table). */
export function useSolarWarranties() {
  return useQuery<Row[]>({
    queryKey: WARRANTIES_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/solar/warranties"))).data ?? [],
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/* --- Wave-1a workflow writes (B-212/B-215/B-219 · money=NONE · Entity-opaque bodies) ----- */

/**
 * POST /solar/om-tickets/{id}/close — idempotently close an O&M ticket (the ticket id is the
 * mutation variable). The door closes WHERE status != 'closed'; an already-closed re-close is
 * a 409 INVALID_STATE (unwrap throws → the caller's error toast). Invalidates the ticket list.
 */
export function useCloseOmTicket(): UseMutationResult<Entity, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.POST("/solar/om-tickets/{id}/close", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: OM_TICKETS_KEY }),
  });
}

/**
 * POST /solar/permit-steps — add a permit step. The caller composes the opaque body
 * ({ name, org }); the server force-sets status="pending" (no advance-step, B-212).
 * Invalidates the permit-step list on success.
 */
export function useCreatePermitStep(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/solar/permit-steps", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: PERMIT_STEPS_KEY }),
  });
}

/**
 * POST /solar/warranties — add a warranty registry item. The caller composes the opaque body
 * ({ item, years }); the server stores Math.trunc(years) (B-219) and force-sets
 * status="active". Invalidates the warranty list on success.
 */
export function useCreateWarranty(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/solar/warranties", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: WARRANTIES_KEY }),
  });
}

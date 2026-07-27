/*
 * Data hooks for the After-Sales Service module — the tenant's service-ticket register
 * (sales.service), WRITE-enabled (SV-1 · status machine · money = NONE).
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md).
 * The prototype held its register + all mutations as local mock notifies
 * (sales-service.jsx SERVICE_TICKETS + NewTicketForm.submit + TicketDetail buttons);
 * here the server is the system of record (apps/api/src/routes/sales-service.ts, SV-1):
 *   GET  /sales/service                -> the ticket register (B-014 envelope `.data`),
 *                                         newest-first, each row + the derived warranty.
 *   GET  /sales/service/{id}           -> one ticket detail (no envelope; 404 if not in
 *                                         the tenant) + the derived warranty.
 *   POST /sales/service                -> receive + assign a ticket (title required; the
 *                                         server allocates `no`, derives warranty).
 *   POST /sales/service/{id}/schedule  -> received  -> scheduled (optional assignee/date).
 *   POST /sales/service/{id}/start     -> scheduled -> fixing.
 *   POST /sales/service/{id}/fix       -> fixing    -> fixed.
 *   POST /sales/service/{id}/close     -> fixed     -> closed (terminal).
 *
 * Every action-op is race-safe server-side (B-149 optimistic guard: the predecessor
 * status is folded into the UPDATE WHERE, so a wrong/stale transition 409s; a foreign id
 * 404s). Each mutation invalidates the register (and the single ticket) so the list +
 * detail re-derive their badges/KPIs from the server's canonical state — never from an
 * optimistic client guess. Bodies/responses are the opaque Entity/ActionOk (money-free).
 *
 * The customer + assignee catalogues the create-form pickers read reuse the shared
 * master hooks (useCustomerList / useUserList) — the same tenant catalogues, one shared
 * query cache. There is intentionally NO unit-picker hook: service_ticket.unit_id is a
 * project_node uuid with no clean label source (bookings carry no unit label; the
 * hierarchy needs a per-project fetch), so the create form omits it and the list/detail
 * em-dash it (never leaking the uuid).
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
/** Opaque row/detail shape (the contract types /sales/service rows as Entity). */
type Row = Record<string, unknown>;

/** Shared cache keys — the register list read + per-ticket detail + invalidation. */
const SERVICE_KEY = ["sales", "service"] as const;
const ticketKey = (id: string) => [...SERVICE_KEY, id] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /sales/service — the tenant's service-ticket register (B-014 envelope `.data`),
 * newest-first. Opaque Entity rows narrowed by toTicketRow (sales-service-rows.ts).
 */
export function useServiceTickets() {
  return useQuery<Row[]>({
    queryKey: SERVICE_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/sales/service"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * GET /sales/service/{id} — one ticket detail (no envelope). Disabled until an id is
 * resolved (the detail modal passes the row's id). The response is the single opaque
 * Entity (the server-derived warranty rides it), narrowed by toTicketRow.
 */
export function useServiceTicket(id: string) {
  return useQuery<Row>({
    queryKey: ticketKey(id),
    queryFn: () =>
      unwrap(apiClient.GET("/sales/service/{id}", { params: { path: { id } } })),
    enabled: authed() && id !== "",
    staleTime: 60_000,
  });
}

/**
 * POST /sales/service — receive + assign a ticket (NewTicketForm). The caller composes
 * the opaque body ({ title (required), customer_id?, assignee_user_id?, channel?,
 * category?, priority?, scheduled_date? }); the server allocates `no`, stamps the intake
 * date, defaults status "received", and derives the warranty. Invalidates the register
 * so the new ticket appears in the server's newest-first order.
 */
export function useCreateServiceTicket(): UseMutationResult<Entity, unknown, Entity> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Entity) => unwrap(apiClient.POST("/sales/service", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: SERVICE_KEY }),
  });
}

/** Variables for a status action-op: the ticket id + (schedule only) an optional body. */
export interface TransitionVars {
  id: string;
  /** Only `schedule` carries a body ({ assignee_user_id?, scheduled_date? }); else none. */
  body?: Entity;
}

/** Invalidate both the register and the acted-on ticket after a transition. */
function invalidateTicket(qc: ReturnType<typeof useQueryClient>, id: string): void {
  void qc.invalidateQueries({ queryKey: SERVICE_KEY });
  void qc.invalidateQueries({ queryKey: ticketKey(id) });
}

/**
 * POST /sales/service/{id}/schedule — received -> scheduled. Carries an optional body
 * ({ assignee_user_id?, scheduled_date? }). 409 when the ticket is not `received`; 404
 * when it is not in the tenant. Invalidates the register + the ticket on success.
 */
export function useScheduleServiceTicket(): UseMutationResult<Entity, unknown, TransitionVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: TransitionVars) =>
      unwrap(
        apiClient.POST("/sales/service/{id}/schedule", {
          params: { path: { id } },
          body: (body ?? {}) as Entity,
        }),
      ),
    onSuccess: (_data, vars) => invalidateTicket(qc, vars.id),
  });
}

/**
 * POST /sales/service/{id}/start — scheduled -> fixing (no body). 409 when the ticket is
 * not `scheduled`; 404 when it is not in the tenant. Invalidates on success.
 */
export function useStartServiceTicket(): UseMutationResult<Entity, unknown, TransitionVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: TransitionVars) =>
      unwrap(apiClient.POST("/sales/service/{id}/start", { params: { path: { id } } })),
    onSuccess: (_data, vars) => invalidateTicket(qc, vars.id),
  });
}

/**
 * POST /sales/service/{id}/fix — fixing -> fixed (no body). 409 when the ticket is not
 * `fixing`; 404 when it is not in the tenant. Invalidates on success.
 */
export function useFixServiceTicket(): UseMutationResult<Entity, unknown, TransitionVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: TransitionVars) =>
      unwrap(apiClient.POST("/sales/service/{id}/fix", { params: { path: { id } } })),
    onSuccess: (_data, vars) => invalidateTicket(qc, vars.id),
  });
}

/**
 * POST /sales/service/{id}/close — fixed -> closed (terminal). Any client rating is
 * IGNORED server-side (service_ticket has no rating column), so no body is sent. 409 when
 * the ticket is not `fixed`; 404 when it is not in the tenant. Invalidates on success.
 */
export function useCloseServiceTicket(): UseMutationResult<Entity, unknown, TransitionVars> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: TransitionVars) =>
      unwrap(apiClient.POST("/sales/service/{id}/close", { params: { path: { id } } })),
    onSuccess: (_data, vars) => invalidateTicket(qc, vars.id),
  });
}

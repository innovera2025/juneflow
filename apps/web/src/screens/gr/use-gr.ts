/*
 * Data hooks for GRList (P2-WEB-11) — the tenant's goods receipts + the PO/WO
 * anchors a receipt can be created against.
 *
 * Every read/write goes through the generated typed client (api-client.ts) +
 * TanStack Query via unwrap() — no hand-written models/fetch (PLAN.md §5,
 * apps/web/CLAUDE.md). The prototype held its data in local GR_ROWS / PO_FOR_GR
 * arrays (gr.jsx:3, forms.jsx:375); here the server is the system of record:
 *   GET  /gr  -> the tenant goods receipts (listGr, B-014 paginated envelope `.data`).
 *   GET  /po  -> open POs, both to resolve a row's ref number (po_id -> po.no) and
 *                to populate the create-form receive-from-PO picker.
 *   GET  /wo  -> the same for the receive-from-WO picker + wo_id -> wo.no (B-070).
 *   POST /gr  -> record a receipt ({ po_id | wo_id, lines[{qty_ok,qty_rejected}] });
 *                the server owns status ("received") and aggregates lines[].
 *   POST /gr/{id}/return  -> received -> returned (gr.jsx return action).
 *   POST /gr/{id}/cancel  -> received -> cancelled (gr.jsx cancel action).
 * Every mutation invalidates the GR list so the new state appears.
 *
 * Bodies/responses are the opaque Entity from the contract (additionalProperties).
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
/** Opaque list-row shape (the contract types /gr, /po, /wo rows as Entity). */
type Row = Record<string, unknown>;

/** The POST /gr body (createGr requestBody, generated from the contract). */
export interface CreateGrBody {
  po_id?: string;
  wo_id?: string;
  lines: { qty_ok?: number; qty_rejected?: number; photos?: string[] }[];
}

/** Shared cache key for the GR catalogue (list + invalidation). */
const GR_KEY = ["gr"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /gr — the tenant goods receipts for the table (B-014 envelope `data`). */
export function useGrList() {
  return useQuery<Row[]>({
    queryKey: GR_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/gr"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /po — open POs (ref resolution + create-form picker). */
export function usePoList() {
  return useQuery<Row[]>({
    queryKey: ["po"],
    queryFn: async () => (await unwrap(apiClient.GET("/po"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /wo — open WOs (ref resolution + create-form picker, B-070). */
export function useWoList() {
  return useQuery<Row[]>({
    queryKey: ["wo"],
    queryFn: async () => (await unwrap(apiClient.GET("/wo"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * POST /gr — record a receipt against a PO or WO. The caller composes the body
 * ({ po_id | wo_id, lines }); the server forces status="received" and aggregates
 * the lines. The catalogue is invalidated on success so the new receipt appears.
 */
export function useCreateGr(): UseMutationResult<Entity, unknown, CreateGrBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateGrBody) => unwrap(apiClient.POST("/gr", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: GR_KEY }),
  });
}

/** POST /gr/{id}/return — received -> returned. Invalidates the list on success. */
export function useReturnGr(): UseMutationResult<unknown, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.POST("/gr/{id}/return", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: GR_KEY }),
  });
}

/** POST /gr/{id}/cancel — received -> cancelled. Invalidates the list on success. */
export function useCancelGr(): UseMutationResult<unknown, unknown, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(apiClient.POST("/gr/{id}/cancel", { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: GR_KEY }),
  });
}

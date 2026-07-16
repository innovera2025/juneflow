/*
 * Data hooks for BOQOverview (P2-WEB-03) — the overview's real aggregate sources.
 *
 * Every read goes through the generated typed client (api-client.ts) + TanStack
 * Query via unwrap() — no hand-written models/fetch (PLAN.md §5). The prototype
 * hard-codes every figure (12.4M / the waterfall / the balance rows); here the
 * server is the system of record. The doc list (GET /boq) + projects + hierarchy
 * hooks are reused from use-boq.ts / use-shell-data.ts / master/use-project-hierarchy.ts;
 * this module adds the waterfall + balance-table sources:
 *   GET /pr           -> PR docs (amount = SUM of BOQ-priced lines)     — PR-opened bar
 *   GET /po           -> PO docs (amount = po.total)                    — PO stage
 *   GET /wo           -> WO docs (amount = wo.value)                    — WO stage
 *   GET /boq/{id}     -> one doc's groups (id + name, seq-sorted)       — balance group heads
 *   GET /boq/{id}/items -> that doc's priced lines (qty/price/remain)   — balance rows
 * All list reads are the B-014 paginated envelope (`.data`). Queries are gated on a
 * present bearer token so the login screen never fires 401s.
 *
 * WIRE GAP (not fetched, reported): GET /gr carries receipt QUANTITIES only, no money
 * (gr.ts GAP 2), so the GR waterfall stage has no real source — it is NOT queried here
 * and the view renders that bar as an em-dash rather than inventing a value.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types /pr,/po,/wo,/items rows as Entity). */
type Row = Record<string, unknown>;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /pr — the tenant's PRs; each row's `amount` is the SUM of its BOQ-priced lines. */
export function usePrList() {
  return useQuery<Row[]>({
    queryKey: ["pr"],
    queryFn: async () => (await unwrap(apiClient.GET("/pr"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /po — the tenant's POs; each row's `amount` is po.total (approved = PO stage). */
export function usePoList() {
  return useQuery<Row[]>({
    queryKey: ["po"],
    queryFn: async () => (await unwrap(apiClient.GET("/po"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** GET /wo — the tenant's WOs; each row's `amount` is wo.value (approved = WO stage). */
export function useWoList() {
  return useQuery<Row[]>({
    queryKey: ["wo"],
    queryFn: async () => (await unwrap(apiClient.GET("/wo"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/**
 * GET /boq/{id} — one BOQ doc's detail; the overview reads only its `groups`
 * (id + name, already seq-sorted) to head the Balance table. Disabled until a doc
 * id is resolved (the first scoped doc).
 */
export function useBoqDetail(docId: string | undefined) {
  return useQuery<Row>({
    queryKey: ["boq-detail", docId],
    queryFn: () =>
      unwrap(
        apiClient.GET("/boq/{id}", { params: { path: { id: docId as string } } }),
      ),
    enabled: authed() && !!docId,
    staleTime: 60_000,
  });
}

/**
 * GET /boq/{id}/items — one BOQ doc's priced lines (qty/price/remain_qty) for the
 * Balance table rows. Disabled until a doc id is resolved.
 */
export function useBoqItems(docId: string | undefined) {
  return useQuery<Row[]>({
    queryKey: ["boq-items", docId],
    queryFn: async () =>
      (
        await unwrap(
          apiClient.GET("/boq/{id}/items", {
            params: { path: { id: docId as string } },
          }),
        )
      ).data ?? [],
    enabled: authed() && !!docId,
    staleTime: 60_000,
  });
}

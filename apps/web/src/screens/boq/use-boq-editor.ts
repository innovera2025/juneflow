/*
 * Data hooks for BOQEditor (P2-WEB-04) — the editor's real read + write endpoints.
 *
 * Every call goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The prototype
 * held the whole doc in local state; here the server is the system of record. The doc
 * catalogue (GET /boq, use-boq.ts) + the detail/items reads (GET /boq/{id} + /items,
 * use-boq-overview.ts) are REUSED; this module adds the editor's mutation endpoints:
 *   POST /boq/{id}/items        -> add a priced line (also used for duplicate = a copy)
 *   POST /boq/{id}/generate-pr  -> M/S-split PR from selected items + cut-remain
 *   POST /boq/{id}/submit       -> draft|revise -> pending (send to approval)
 *   POST /boq/{id}/revise       -> approved -> revise (version += 1, editable again)
 * Every mutation invalidates the doc detail/items (+ the PR list for generate-pr) so the
 * refreshed totals / remain_qty / status appear.
 *
 * Bodies/responses are the opaque Entity from the contract (additionalProperties).
 */
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { useCostCenterList } from "../master/use-cost-centers";

export { useBoqList } from "./use-boq";
export { useBoqDetail, useBoqItems } from "./use-boq-overview";
export { useCostCenterList };

/** Opaque wire shape (bodies + responses type as the contract's Entity). */
type Body = Record<string, unknown>;

/**
 * POST /boq/{id}/items — add one (or more) priced line(s) to the doc. The caller composes
 * the opaque body (buildAddItemBody / buildDuplicateBody). On success the doc detail + items
 * are invalidated so the table + totals refresh from the server's fresh aggregate.
 */
export function useAddBoqItem(
  docId: string | undefined,
): UseMutationResult<unknown, unknown, Body> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Body) =>
      unwrap(
        apiClient.POST("/boq/{id}/items", {
          params: { path: { id: docId as string } },
          body: body as never,
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["boq-items", docId] });
      qc.invalidateQueries({ queryKey: ["boq-detail", docId] });
      qc.invalidateQueries({ queryKey: ["boq"] });
    },
  });
}

/**
 * POST /boq/{id}/generate-pr — create PR(s) from the selected APPROVED-BOQ items. The
 * server splits Material -> a supplier PR and Subcon/Labor -> a PR-Subcon, and decrements
 * each item's remain_qty (cut-remain). On success the items (remain_qty) + the PR list are
 * invalidated. The response ({ prs: [...] }) is returned so the caller can surface the PR no.
 */
export function useGeneratePr(
  docId: string | undefined,
): UseMutationResult<unknown, unknown, { item_ids: string[] }> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { item_ids: string[] }) =>
      unwrap(
        apiClient.POST("/boq/{id}/generate-pr", {
          params: { path: { id: docId as string } },
          body: body as never,
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["boq-items", docId] });
      qc.invalidateQueries({ queryKey: ["pr"] });
    },
  });
}

/**
 * POST /boq/{id}/submit — draft|revise -> pending. On success the doc list + detail are
 * invalidated so the new status appears (the screen then navigates to boq.approval).
 */
export function useSubmitBoq(
  docId: string | undefined,
): UseMutationResult<unknown, unknown, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        apiClient.POST("/boq/{id}/submit", {
          params: { path: { id: docId as string } },
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["boq"] });
      qc.invalidateQueries({ queryKey: ["boq-detail", docId] });
    },
  });
}

/**
 * POST /boq/{id}/revise — approved -> revise (version += 1, editable again). On success the
 * doc list + detail are invalidated so the unlocked, bumped version appears.
 */
export function useReviseBoq(
  docId: string | undefined,
): UseMutationResult<unknown, unknown, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        apiClient.POST("/boq/{id}/revise", {
          params: { path: { id: docId as string } },
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["boq"] });
      qc.invalidateQueries({ queryKey: ["boq-detail", docId] });
      qc.invalidateQueries({ queryKey: ["boq-items", docId] });
    },
  });
}

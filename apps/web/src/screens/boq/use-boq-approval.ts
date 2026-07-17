/*
 * Data hooks for BOQApproval (P2-WEB-06) — the approval screen's real read + write.
 *
 * Every call goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The prototype
 * held the queue + diff in local arrays; here the server is the system of record. The doc
 * catalogue (GET /boq, use-boq.ts) is REUSED as the pending-queue source (filtered to
 * status "pending" in boq-approval-agg — GET /boq has no status filter param); the doc
 * detail/items reads (GET /boq/{id} + /items, use-boq-overview.ts) are REUSED for the
 * selected doc. This module adds the ONE approval write the contract exposes:
 *   POST /boq/{id}/approve -> pending -> approved (LOCK). Requires MD-tier authority
 *      (approvalLevel >= 4, seed role `dir`); NO baht threshold — every BOQ/revise goes
 *      through approval regardless of amount (apps/api/src/routes/boq.ts:725-766,
 *      flows.html MATRIX "BOQ / Revise").
 * On success the doc list + detail are invalidated so the locked status appears.
 *
 * WIRE GAP (reported, not fabricated): the contract has NO reject / request-edit action
 * for a pending BOQ (only submit/approve/revise exist — packages/contracts/openapi.yaml),
 * and no per-tier approval_step, so the screen's reject/revise buttons are notify-only
 * stubs (mirroring the prototype's own pure-notify mock) — see boq-approval.tsx.
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

export { useBoqList } from "./use-boq";
export { useBoqDetail, useBoqItems } from "./use-boq-overview";

/**
 * POST /boq/{id}/approve — pending -> approved (LOCK). The server enforces MD-tier
 * authority + the pending precondition; a 403 (level too low) / 409 (wrong state) surfaces
 * through unwrap() as a thrown error the caller turns into a toast. On success the doc list
 * + detail are invalidated so the new locked status appears.
 */
export function useApproveBoq(
  docId: string | undefined,
): UseMutationResult<unknown, unknown, void> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        apiClient.POST("/boq/{id}/approve", {
          params: { path: { id: docId as string } },
        }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["boq"] });
      qc.invalidateQueries({ queryKey: ["boq-detail", docId] });
    },
  });
}

/*
 * Write hook for the Due-Diligence / land-deal screen (land.dd).
 *
 * POST /land/plots/{id}/deal — post a land deal (money=SERVER). For a LEASE (B-161, Wei=
 * d) the client supplies { type: "lease", amount (the first-period rent — a legitimate
 * client cash figure), cc_id? }; the SERVER books the rent-expense JV (via ap.pv) and
 * owns the JV/jv_no. For a BUY the server computes the 10% deposit itself (the client
 * sends only { type: "buy" }). The client NEVER composes a Dr/Cr line or a JV number.
 * Invalidates the plot register (the deal advances the plot). Body/response = the opaque
 * Entity from the contract; a not-yet-implemented lease branch surfaces its error honestly.
 */
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { components } from "@juneflow/contracts";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";

type Entity = components["schemas"]["Entity"];

export function useCreateLandDeal(): UseMutationResult<
  Entity,
  unknown,
  { plotId: string; body: Entity }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ plotId, body }) =>
      unwrap(apiClient.POST("/land/plots/{id}/deal", { params: { path: { id: plotId } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["land-plots"] }),
  });
}

/*
 * Data hooks for the Retention register screen (ap.retention) — the tenant's held-retention
 * ledgers and the release action.
 *
 * Every read/write goes through the generated typed client (api-client.ts) + TanStack Query via
 * unwrap() — no hand-written models/fetch (PLAN.md section 5, apps/web/CLAUDE.md). The prototype
 * held the register in a local RETENTION_SEED; here the server is the system of record
 * (apps/api/src/routes/retention.ts):
 *   GET  /retention          -> the held-retention register (registerWire; B-014 paginated `.data`).
 *   POST /retention/release  -> release the ENTIRE outstanding balance of one ledger. MONEY =
 *                               SERVER AUTHORITY (gate-4.5): the body carries ONLY { ledger_id },
 *                               NEVER an amount — the server computes round2(withheld - returned),
 *                               posts the balanced JV (Dr 2030 / Cr bank) and flips the ledger. The
 *                               response is a RAW ActionOk ({ id, jv_no, amount, status }); the
 *                               screen reads its `amount` for the success toast (never client math).
 *                               Invalidates the register on success so the released row refreshes.
 *
 * Bodies/responses are the opaque Entity/ActionOk from the contract (additionalProperties).
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque list-row shape (the contract types the retention rows as Entity). */
type Row = Record<string, unknown>;

const RETENTION_KEY = ["ap", "retention"] as const;

/** True when a bearer token is present — the query stays disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /retention — the tenant's held-retention register (B-014 envelope `{ data, ... }`). */
export function useRetentionList() {
  return useQuery<Row[]>({
    queryKey: RETENTION_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/retention"))).data ?? [],
    enabled: authed(),
    staleTime: 60_000,
  });
}

/** Request body of POST /retention/release. MONEY AUTHORITY: { ledger_id } ONLY — never an amount. */
export interface ReleaseRetentionBody {
  ledger_id: string;
}

/**
 * POST /retention/release — release one ledger's ENTIRE outstanding balance. The SERVER computes
 * and posts the amount; the client sends only the ledger id. Resolves the RAW ActionOk
 * ({ id, jv_no, amount, status }) so the caller can toast the server-authoritative `amount`.
 * Invalidates the register on success (the row flips to fully-returned / 'done').
 */
export function useReleaseRetention(): UseMutationResult<unknown, unknown, ReleaseRetentionBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReleaseRetentionBody) =>
      unwrap(apiClient.POST("/retention/release", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: RETENTION_KEY }),
  });
}

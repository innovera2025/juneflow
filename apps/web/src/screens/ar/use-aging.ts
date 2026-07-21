/*
 * Data hooks for the shared FinAging screen (ar.aging + ap.aging).
 *
 * Every read goes through the generated typed client (api-client.ts) + TanStack Query via unwrap()
 * — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The prototype held two local
 * mock arrays (AGING_AP / AGING_AR); here the AR side is the real server report:
 *   GET /ar/aging -> the AGGREGATE-BY-BUCKET report (apps/api/src/routes/ar.ts aging()). This
 *                   endpoint returns a SINGLE object (EntityOk, NOT a list envelope):
 *                     { buckets:[{bucket,count,amount}], total_outstanding, currency_code }
 *                   so unwrap() yields that object directly (no `.data` unwrap).
 *
 * AP side (ap.aging): there is NO /ap/aging endpoint (apps/api/src/routes/ap.ts exposes none) — so
 * there is deliberately NO useApAging hook. /ar/aging is NEVER reused for AP (different party +
 * direction), and the AP tab renders honest-empty rather than fabricating or mis-sourcing data.
 * When an /ap/aging handler lands, add a sibling useApAging() here mirroring useArAging().
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque aggregate-report shape (the contract types /ar/aging as EntityOk). */
type AgingReport = Record<string, unknown>;

const AR_AGING_KEY = ["ar", "aging"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/**
 * GET /ar/aging — the tenant's AR aging report (aggregate by bucket, single object). unwrap()
 * returns the raw report object (this endpoint is EntityOk, not a list envelope).
 */
export function useArAging() {
  return useQuery<AgingReport>({
    queryKey: AR_AGING_KEY,
    queryFn: () => unwrap(apiClient.GET("/ar/aging")),
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

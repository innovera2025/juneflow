/*
 * Data hooks for the tax report screens (tax.vat + tax.wht).
 *
 * Every read goes through the generated typed client (api-client.ts) + TanStack Query via unwrap()
 * — no hand-written models/fetch (PLAN.md §5, apps/web/CLAUDE.md). The prototype held mock arrays;
 * here the server is the system of record:
 *   GET /tax/reports/vat -> PP30 VAT summary (apps/api/src/routes/tax.ts vatReport; opaque EntityOk
 *                           = a SINGLE report object, NOT a list envelope -> unwrap yields it directly).
 *   GET /tax/reports/wht -> PND withholding summary (whtReport; opaque EntityOk).
 * Both accept an optional ?period=YYYY-MM filter, but the screens have no wire-backed period picker
 * (drop-not-collect), so they fetch the full report (all periods) and surface report.period honestly.
 *
 * Responses are the opaque Entity (Record<string, unknown>) from the contract; the pure narrowing to
 * VatReport / WhtReport lives in tax-rows.ts.
 */
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api-client";
import { unwrap } from "../../query-client";
import { getAuthToken } from "../../auth-token";

/** Opaque report shape (the contract types the tax reports as Entity). */
type Report = Record<string, unknown>;

const VAT_REPORT_KEY = ["tax", "reports", "vat"] as const;
const WHT_REPORT_KEY = ["tax", "reports", "wht"] as const;

/** True when a bearer token is present — queries stay disabled otherwise. */
function authed(): boolean {
  return getAuthToken() != null;
}

/** GET /tax/reports/vat — the tenant's PP30 output/input VAT summary. */
export function useVatReport() {
  return useQuery<Report>({
    queryKey: VAT_REPORT_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/tax/reports/vat"))) ?? {},
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

/** GET /tax/reports/wht — the tenant's PND3/PND53 withholding summary. */
export function useWhtReport() {
  return useQuery<Report>({
    queryKey: WHT_REPORT_KEY,
    queryFn: async () => (await unwrap(apiClient.GET("/tax/reports/wht"))) ?? {},
    enabled: authed(),
    staleTime: 5 * 60_000,
  });
}

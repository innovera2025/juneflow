/**
 * TanStack Query client for @juneflow/web (P0-WEB-01 skeleton, wired in P0-WEB-06).
 *
 * Data fetching goes through the generated `apiClient` (api-client.ts) only —
 * it is typed end-to-end from packages/contracts/openapi.yaml, so hand-written
 * models/fetch are forbidden (PLAN.md §5). This module owns the single
 * QueryClient instance and the `unwrap` adapter that turns openapi-fetch's
 * `{ data, error }` result into a value/throw contract TanStack Query expects.
 */
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Conservative skeleton defaults; per-screen ports tune these as needed.
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

/**
 * Adapt an openapi-fetch call for use as a TanStack Query `queryFn`/`mutationFn`.
 * openapi-fetch never throws on HTTP errors — it returns `{ data, error }`. Query
 * needs a rejected promise on failure, so screen ports wrap their typed calls:
 *
 *   useQuery({ queryKey: ["me"], queryFn: () => unwrap(apiClient.GET("/me")) })
 *
 * `data`/`error` stay fully typed from the OpenAPI contract — no model is written
 * here, only the success/error shape is normalised.
 */
export async function unwrap<TData, TError>(
  call: Promise<{ data?: TData; error?: TError }>,
): Promise<TData> {
  const { data, error } = await call;
  if (error !== undefined) {
    throw error;
  }
  return data as TData;
}

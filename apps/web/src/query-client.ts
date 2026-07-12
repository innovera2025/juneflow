/**
 * TanStack Query client for @juneflow/web (P0-WEB-01 skeleton).
 *
 * Data fetching goes through the generated @juneflow/contracts client only —
 * never hand-written models/fetch (P0-WEB-06 wires that generated client into
 * these queries). This module just owns the single QueryClient instance.
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

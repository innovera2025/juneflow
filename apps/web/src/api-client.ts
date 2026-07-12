/**
 * Typed API client for @juneflow/web (P0-WEB-06).
 *
 * The client is generated end-to-end from the OpenAPI contract: `openapi-fetch`
 * consumes the `paths` type produced by `openapi-typescript` from
 * packages/contracts/openapi.yaml. Every request/response body, path param and
 * query is therefore derived from the contract — hand-written models or raw
 * fetch calls are forbidden (PLAN.md §5 / apps/web/CLAUDE.md "API client").
 * openapi.yaml is SACRED after merge; regenerate the types via
 * `pnpm --filter @juneflow/contracts run generate`, never edit them by hand.
 *
 * Base URL matches the contract's `servers` entry (`/api/v1`). It can be
 * overridden per-environment with VITE_API_BASE_URL (e.g. an absolute origin
 * in tests); the Vite dev proxy to apps/api is wired in vite.config.ts.
 */
import createClient from "openapi-fetch";
import type { paths } from "@juneflow/contracts";

/** Default base URL — the single `servers` url declared in openapi.yaml. */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

/**
 * The one shared, fully-typed API client instance. All data fetching in the web
 * app goes through this (fed into TanStack Query queryFns) — see query-client.ts.
 */
export const apiClient = createClient<paths>({
  baseUrl: API_BASE_URL,
  // Session cookie auth (better-auth, PLAN.md §5) — send credentials same-origin.
  credentials: "include",
});

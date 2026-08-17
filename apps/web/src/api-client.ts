/**
 * Typed API client for @juneflow/web (P0-WEB-06, auth corrected in P0-FIX-03).
 *
 * The client is generated end-to-end from the OpenAPI contract: `openapi-fetch`
 * consumes the `paths` type produced by `openapi-typescript` from
 * packages/contracts/openapi.yaml. Every request/response body, path param and
 * query is therefore derived from the contract — hand-written models or raw
 * fetch calls are forbidden (PLAN.md §5 / apps/web/CLAUDE.md "API client").
 * openapi.yaml is SACRED after merge; regenerate the types via
 * `pnpm --filter @juneflow/contracts run generate`, never edit them by hand.
 *
 * Base URL matches the contract's `servers` entry (`/api/v1`). That relative
 * path is routed to apps/api by an origin proxy: `server.proxy` in
 * vite.config.ts for `pnpm dev`, and the `location /api/` block in
 * apps/web/nginx.conf.template for the built image. It can be overridden per
 * environment with VITE_API_BASE_URL (e.g. an absolute origin in tests).
 */
import createClient from "openapi-fetch";
import type { paths } from "@juneflow/contracts";
import { getAuthToken } from "./auth-token";

/** Default base URL — the single `servers` url declared in openapi.yaml. */
export const DEFAULT_API_BASE_URL = "/api/v1";

/**
 * Resolve the base URL from the build-time override, treating a blank value as
 * absent.
 *
 * `??` alone is not enough, and the gap was not theoretical: apps/web/Dockerfile
 * declared `ARG VITE_API_BASE_URL` followed by `ENV VITE_API_BASE_URL=${...}`,
 * and Docker turns an unpassed ARG into a DEFINED empty string. Vite then
 * inlined `""`, which `??` passes through untouched. Every request lost its
 * prefix and went to the origin root (`/counts`, `/me`, `/projects`), where
 * nginx's SPA fallback answered index.html with 200 — so the app rendered its
 * shell, fetched nothing, raised no console error, and every screen was empty.
 * Measured on the image built from aba803f: 0 occurrences of "/api/v1" in the
 * bundle. A blank override cannot mean "same origin, no prefix" here, because
 * the contract declares exactly one `servers` url.
 */
export function resolveApiBaseUrl(raw: string | undefined): string {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : DEFAULT_API_BASE_URL;
}

export const API_BASE_URL: string = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

/**
 * The one shared, fully-typed API client instance. All data fetching in the web
 * app goes through this (fed into TanStack Query queryFns) — see query-client.ts.
 */
export const apiClient = createClient<paths>({
  baseUrl: API_BASE_URL,
});

/**
 * Bearer JWT auth per the contract's global `bearerAuth` scheme (decision
 * B-028 option A): attach `Authorization: Bearer <jwt>` when a token is present.
 * The JWT carries company_id for tenant scope (apps/api middleware, PLAN.md §5).
 * Public endpoints (declared `security: []`, e.g. /auth/login, /health) simply
 * run without the header. The contract, not a session cookie, is authoritative —
 * so no `credentials: "include"`.
 */
apiClient.use({
  onRequest({ request }) {
    const token = getAuthToken();
    if (token) {
      request.headers.set("Authorization", `Bearer ${token}`);
    }
    return request;
  },
});

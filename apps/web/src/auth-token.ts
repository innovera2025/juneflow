/**
 * Bearer-token store for @juneflow/web (P0-FIX-03, decision B-028 option A).
 *
 * The OpenAPI contract declares `bearerAuth` (JWT in the Authorization header,
 * carrying company_id for tenant scope) as the global security scheme
 * (packages/contracts/openapi.yaml `components.securitySchemes.bearerAuth` +
 * top-level `security: [bearerAuth: []]`). The web client therefore authenticates
 * with `Authorization: Bearer <jwt>`, NOT a session cookie — matching apps/api's
 * tenant-scope middleware which reads the JWT (PLAN.md §5, Appendix A).
 *
 * This module is the single holder for that JWT: the login screen (P1-WEB-01)
 * calls setAuthToken() after a successful POST /auth/login, and api-client.ts
 * reads it per request via its bearer middleware. localStorage access is guarded
 * and injectable so the store is unit-testable in a plain Node environment
 * (mirrors i18n/lang-store.ts — G3, no jsdom needed).
 */

/** localStorage key holding the active bearer JWT. */
export const TOKEN_STORAGE_KEY = "juneflow-token";

/** Injectable persistence so the store can be tested without a DOM. */
export interface AuthTokenDeps {
  /** Read the persisted JWT (null when absent/unavailable). */
  readPersisted(): string | null;
  /** Persist the JWT. */
  writePersisted(token: string): void;
  /** Remove the persisted JWT (logout). */
  removePersisted(): void;
}

/** Default deps: guarded access to the ambient localStorage. */
const domDeps: AuthTokenDeps = {
  readPersisted() {
    try {
      return globalThis.localStorage?.getItem(TOKEN_STORAGE_KEY) ?? null;
    } catch {
      return null;
    }
  },
  writePersisted(token) {
    try {
      globalThis.localStorage?.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
      /* storage unavailable (e.g. SSR/tests) — no-op */
    }
  },
  removePersisted() {
    try {
      globalThis.localStorage?.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      /* storage unavailable — no-op */
    }
  },
};

export interface AuthTokenStore {
  /** The current bearer JWT, or null when unauthenticated. */
  getToken(): string | null;
  /** Store the bearer JWT (after successful login). */
  setToken(token: string): void;
  /** Clear the bearer JWT (logout). */
  clearToken(): void;
}

/**
 * Create an auth-token store. The initial token is read from persistence so an
 * already-authenticated session survives a page reload.
 */
export function createAuthTokenStore(
  deps: AuthTokenDeps = domDeps,
): AuthTokenStore {
  let current: string | null = deps.readPersisted();

  return {
    getToken: () => current,
    setToken(token) {
      current = token;
      deps.writePersisted(token);
    },
    clearToken() {
      current = null;
      deps.removePersisted();
    },
  };
}

/** App-wide singleton bound to the real localStorage. */
export const authTokenStore = createAuthTokenStore();

/** Convenience accessors over the singleton (used by api-client.ts + login). */
export const getAuthToken = (): string | null => authTokenStore.getToken();
export const setAuthToken = (token: string): void =>
  authTokenStore.setToken(token);
export const clearAuthToken = (): void => authTokenStore.clearToken();

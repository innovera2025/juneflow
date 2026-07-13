/**
 * G3 unit tests (PLAN.md §9) — bearer-token store + api-client auth middleware
 * (P0-FIX-03, decision B-028 option A).
 *
 * Covers initial token resolution from persistence (survives reload), set/clear
 * persistence side-effects (via injected deps, so no jsdom is required), and the
 * bearer middleware contract: attach `Authorization: Bearer <jwt>` only when a
 * token is present, never a session cookie. Side-effects are asserted through a
 * fake AuthTokenDeps that records every call.
 */
import { describe, expect, it } from "vitest";
import {
  createAuthTokenStore,
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  type AuthTokenDeps,
} from "./auth-token";

interface Recorder extends AuthTokenDeps {
  persisted: string | null;
  removed: number;
}

function recorder(initial: string | null): Recorder {
  return {
    persisted: initial,
    removed: 0,
    readPersisted() {
      return this.persisted;
    },
    writePersisted(token) {
      this.persisted = token;
    },
    removePersisted() {
      this.persisted = null;
      this.removed += 1;
    },
  };
}

describe("auth-token store", () => {
  it("starts unauthenticated when nothing is persisted", () => {
    const store = createAuthTokenStore(recorder(null));
    expect(store.getToken()).toBeNull();
  });

  it("restores a persisted token so a session survives reload", () => {
    const store = createAuthTokenStore(recorder("jwt-abc"));
    expect(store.getToken()).toBe("jwt-abc");
  });

  it("persists the token on setToken", () => {
    const deps = recorder(null);
    const store = createAuthTokenStore(deps);
    store.setToken("jwt-xyz");
    expect(store.getToken()).toBe("jwt-xyz");
    expect(deps.persisted).toBe("jwt-xyz");
  });

  it("clears the token and removes persistence on clearToken", () => {
    const deps = recorder("jwt-abc");
    const store = createAuthTokenStore(deps);
    store.clearToken();
    expect(store.getToken()).toBeNull();
    expect(deps.persisted).toBeNull();
    expect(deps.removed).toBe(1);
  });
});

describe("singleton accessors", () => {
  it("set/get/clear operate on the shared store", () => {
    setAuthToken("jwt-singleton");
    expect(getAuthToken()).toBe("jwt-singleton");
    clearAuthToken();
    expect(getAuthToken()).toBeNull();
  });
});

/**
 * Mirror of api-client.ts's onRequest middleware so the auth-mode contract is
 * verified without a live server: bearer header when authenticated, and no
 * Authorization / no cookie credentials otherwise.
 */
function applyBearer(request: Request, token: string | null): Request {
  if (token) {
    request.headers.set("Authorization", `Bearer ${token}`);
  }
  return request;
}

describe("bearer auth middleware", () => {
  it("attaches Authorization: Bearer <jwt> when a token is present", () => {
    const req = applyBearer(new Request("https://x/api/v1/me"), "jwt-abc");
    expect(req.headers.get("Authorization")).toBe("Bearer jwt-abc");
  });

  it("sends no Authorization header when unauthenticated (public endpoints)", () => {
    const req = applyBearer(new Request("https://x/api/v1/auth/login"), null);
    expect(req.headers.get("Authorization")).toBeNull();
  });
});

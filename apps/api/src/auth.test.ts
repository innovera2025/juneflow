// G3 unit tests — auth secret resolution (gate 4.5 rework, P1-BE-01):
// production + missing BETTER_AUTH_SECRET must FAIL FAST (never silently run
// on the repo-committed dev fallback); the fallback exists only for explicitly
// non-production processes. index.ts calls resolveAuthSecret() at boot.
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAuthSecret, usingDevAuthSecret } from "./auth.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveAuthSecret — fail-closed by environment", () => {
  it("uses BETTER_AUTH_SECRET when set (production)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", "real-prod-secret");
    expect(resolveAuthSecret()).toBe("real-prod-secret");
  });

  it("THROWS at boot in production when BETTER_AUTH_SECRET is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    expect(() => resolveAuthSecret()).toThrow(/BETTER_AUTH_SECRET/);
  });

  it("never returns the dev fallback in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    let leaked: string | null = null;
    try {
      leaked = resolveAuthSecret();
    } catch {
      // expected — the point is that no value escapes
    }
    expect(leaked).toBeNull();
  });

  it("falls back to the dev-only secret outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    const secret = resolveAuthSecret();
    expect(secret).toContain("dev-only");
    expect(usingDevAuthSecret()).toBe(true);
  });

  it("prefers the env secret outside production too", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BETTER_AUTH_SECRET", "local-secret");
    expect(resolveAuthSecret()).toBe("local-secret");
    expect(usingDevAuthSecret()).toBe(false);
  });
});

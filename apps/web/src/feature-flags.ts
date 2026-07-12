/**
 * Phase 0 feature flags for @juneflow/web (P0-WEB-02).
 *
 * PLAN.md section 7 (Phase 0 milestone): modules that are not finished yet must
 * stay hidden behind a feature flag so `dev` is always green and demoable. No
 * screen is ported yet (real screens land in P0-WEB-05+), so by default EVERY
 * route is flagged OFF and its route renders the Placeholder scaffold.
 *
 * A route is turned on by listing its id in `VITE_FEATURE_ROUTES` (comma or
 * space separated), or all at once with `VITE_FEATURE_ALL=1`. This is the
 * web-local switch; the backend feature-flag mechanism (P0-BE-14) gates data.
 *
 * NOTE: this reads `import.meta.env`, so it is only used by app code (router),
 * never by the dependency-free NAV parity checker.
 */

function readEnv(key: string): string | undefined {
  // import.meta.env is injected by Vite; guard so non-Vite contexts stay safe.
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.[key];
}

/** Set of route ids explicitly enabled via env (empty in Phase 0 defaults). */
function enabledRouteIds(): ReadonlySet<string> {
  const raw = readEnv("VITE_FEATURE_ROUTES") ?? "";
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/** True when every route is force-enabled via `VITE_FEATURE_ALL`. */
function allEnabled(): boolean {
  const raw = (readEnv("VITE_FEATURE_ALL") ?? "").toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Whether the real screen for a route is enabled. When false the router renders
 * the Placeholder and the sidebar (P0-WEB-05) hides the entry. Defaults to false
 * for every route until its screen is ported and its flag is switched on.
 */
export function isRouteEnabled(routeId: string): boolean {
  return allEnabled() || enabledRouteIds().has(routeId);
}

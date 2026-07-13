/**
 * TanStack Router route tree for @juneflow/web (P0-WEB-02).
 *
 * Builds the full route tree from the structural route registry (registry.ts),
 * which is transcribed 1:1 from docs/extract/NAV-ROUTES.md — the extracted
 * source of truth for every route (PLAN.md section 0 rule 2). The checker
 * scripts/check-nav-parity.mjs proves the registry matches NAV-ROUTES.md 100%.
 *
 * What this task delivers:
 *  - a route per Sidebar route (100) + per RouteView-only route (8),
 *  - `fin.*` legacy ids redirected to their real route (C-note in registry),
 *  - "/" redirects to the default route ("dashboard"),
 *  - every screen behind a Phase-0 feature flag: since no screen is ported yet
 *    (P0-WEB-05+), all routes render the Placeholder scaffold (feature-flags.ts).
 *
 * Rulings: C7 (boq.bom is a first-class route), C8 (subcon.* gated by module
 * subcon) are encoded in registry.ts. Real screens + the chrome.jsx/shell.jsx
 * app shell (labels via i18n, badges via real queries — C10) arrive in P0-WEB-05.
 * No design values are hardcoded here — colors/spacing come from @juneflow/tokens.
 */
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  Outlet,
} from "@tanstack/react-router";
import {
  DEFAULT_ROUTE,
  EXTRA_ROUTES,
  LEGACY_REDIRECTS,
  SIDEBAR_ROUTES,
} from "./routes/registry";
import { isRouteEnabled } from "./feature-flags";
import { LoginScreen } from "./screens/login/login-screen";

/**
 * Ported screens keyed by route id. A route with an entry here renders its real
 * screen (P1-*); everything else falls back to the Placeholder scaffold until its
 * screen lands. Login (P1-WEB-01) is standalone/full-bleed and needs no app shell.
 */
const PORTED_SCREENS: Readonly<Record<string, () => JSX.Element>> = {
  login: LoginScreen,
};

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

/**
 * Scaffold placeholder shown for every route until its real screen is ported
 * (P0-WEB-05+). Renders only the technical route id (no translated copy — real
 * screens use i18n keys exclusively, PLAN.md section 0). Hidden from the sidebar
 * while its feature flag is off.
 */
function Placeholder({ routeId }: { routeId: string }) {
  const enabled = isRouteEnabled(routeId);
  return (
    <main data-route={routeId} data-enabled={enabled}>
      <code>{routeId}</code>
      <p>{enabled ? "screen pending port (P0-WEB-05+)" : "hidden behind feature flag"}</p>
    </main>
  );
}

// Build the "/" index route -> redirect to the default route (shell.jsx default).
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: `/${DEFAULT_ROUTE}` as never });
  },
});

// One route per registered screen (sidebar + RouteView-only). Paths use the raw
// route id as a single literal segment (e.g. "/boq.overview").
const screenRoutes = [...SIDEBAR_ROUTES, ...EXTRA_ROUTES].map((r) => {
  const Ported = PORTED_SCREENS[r.id];
  return createRoute({
    getParentRoute: () => rootRoute,
    path: `/${r.id}`,
    component: Ported ? () => <Ported /> : () => <Placeholder routeId={r.id} />,
  });
});

// Legacy fin.* ids redirect to their real route.
const legacyRoutes = LEGACY_REDIRECTS.map((r) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: `/${r.id}`,
    beforeLoad: () => {
      throw redirect({ to: `/${r.target}` as never });
    },
  }),
);

const routeTree = rootRoute.addChildren([
  indexRoute,
  ...screenRoutes,
  ...legacyRoutes,
]);

export const router = createRouter({ routeTree });

// Register the router instance for full type-safety across the app.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

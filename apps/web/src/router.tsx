/**
 * TanStack Router skeleton for @juneflow/web (P0-WEB-01).
 *
 * This is the minimal router foundation only: a root route rendering an
 * <Outlet /> plus a single index route. The full route tree — all 44 menus
 * from docs/extract/NAV-ROUTES.md, route gating (C7/C8), and placeholder
 * screens behind feature flags — is built in P0-WEB-02.
 *
 * The index route renders the scaffold PlaceholderShell; the real app shell
 * (pototype/chrome.jsx + shell.jsx) is ported in P0-WEB-05 and must pass the
 * visual gate (G5). No design values are hardcoded here — colors/spacing come
 * from @juneflow/tokens only (PLAN.md §0 rule 2).
 */
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

function PlaceholderShell() {
  // Scaffold-only placeholder. Replaced by the chrome.jsx/shell.jsx port (P0-WEB-05).
  // Visible text below is scaffold-only; real screens use i18n keys exclusively (P0-WEB-03).
  return (
    <main>
      <h1>Juneflow</h1>
      <p>TODO(P0-WEB-05): app shell port from pototype/chrome.jsx + shell.jsx</p>
    </main>
  );
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: PlaceholderShell,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({ routeTree });

// Register the router instance for full type-safety across the app.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

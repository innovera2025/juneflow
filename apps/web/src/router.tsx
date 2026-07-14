/**
 * TanStack Router route tree for @juneflow/web.
 *
 * Root layout = the app shell (P0-WEB-05): <ShellProvider> wraps <AppShell/>, which
 * renders the sidebar + per-page topbar chrome around the routed screen (<Outlet/>),
 * ported 1:1 from pototype/shell.jsx + chrome.jsx. Route "login" is full-bleed (no
 * shell) per shell.jsx:106-119. Every route is built from the structural registry
 * (routes/registry.ts, proven 100% == NAV-ROUTES.md by scripts/check-nav-parity.mjs).
 *
 * Screen bodies: login (P1-WEB-01) is ported; every other route renders the shell
 * Placeholder (Page→TopBar + "under development" card) until its screen lands — so the
 * full chrome is demoable now. Labels come from i18n keys, badges from real queries
 * (C10), data from GET /me + GET /projects via the generated client. `fin.*` legacy
 * ids redirect; "/" redirects to the default route ("dashboard").
 */
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import {
  DEFAULT_ROUTE,
  EXTRA_ROUTES,
  LEGACY_REDIRECTS,
  SIDEBAR_ROUTES,
} from "./routes/registry";
import { LoginScreen } from "./screens/login/login-screen";
import { MasterCompany } from "./screens/master/master-company";
import { MasterModel } from "./screens/master/master-model";
import { MasterProject } from "./screens/master/master-project";
import { UsersPermissions } from "./screens/master/users-permissions";
import { ShellProvider } from "./shell/shell-context";
import { AppShell } from "./shell/app-shell";
import { Placeholder } from "./shell/page";

/**
 * Ported screens keyed by route id. A route with an entry here renders its real
 * screen; everything else renders the shell Placeholder until its screen lands.
 */
const PORTED_SCREENS: Readonly<Record<string, () => JSX.Element>> = {
  login: LoginScreen,
  "master.company": MasterCompany,
  "master.model": MasterModel,
  "master.project": MasterProject,
  users: UsersPermissions,
};

const rootRoute = createRootRoute({
  component: () => (
    <ShellProvider>
      <AppShell />
    </ShellProvider>
  ),
});

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

/**
 * Juneflow web entry - @juneflow/web (apps/web zone, Frontend Web).
 *
 * Port source = pototype/*.jsx EXCLUDING finance.jsx + tweaks-panel.jsx (dead code) per PLAN.md section 0.
 * Also strictly out of scope (PLAN.md section 0 rule 5): pototype/wat/ + Buddhist-temple finance HTML files
 * (different product), every standalone build file (2-9 MB), and the "Juneflow Ant Pro*" theme (Fiori only).
 *
 * Screens must match the prototype 100% for everything the user sees/clicks/reads (PLAN.md section 0 rule 1).
 * Mock-only mechanisms must NOT be ported (rule 3): DOM MutationObserver translation, hardcoded NAV badges,
 * name-string FKs, reseed-on-reload.
 *
 * P0-WEB-01 wires the skeleton: TanStack Query (query-client.ts) + TanStack Router (router.tsx),
 * both bound to the @juneflow/tokens fiori theme (no hardcoded design values). Later tasks fill it in.
 * P0-WEB-06 adds the generated API client (api-client.ts) that Query queryFns call. Later tasks fill it in.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
// Fiori theme tokens - the only allowed source of colors/fonts/spacing/radius (never hardcode values).
import "@juneflow/tokens/src/tokens.css";
import { queryClient } from "./query-client";
import { router } from "./router";

// DONE(P0-WEB-02): route tree + route constants for all routes in docs/extract/NAV-ROUTES.md
//   live in routes/registry.ts (structural: id/component/file/module gate) and router.tsx builds
//   the tree from it (default route = "dashboard"; every screen behind a Phase-0 feature flag ->
//   Placeholder until ported; C7 boq.bom is a first-class route, C8 subcon.* gated by module
//   subcon). scripts/check-nav-parity.mjs proves 100% parity with NAV-ROUTES.md.
// TODO(P0-WEB-03): i18n wiring - key-based t() from @juneflow/i18n (th/zh/en/ar + RTL for ar).
//   Every visible string = key from i18n-full.json; missing key => write BLOCKERS.md, never invent.
// TODO(P0-WEB-05): port the app shell 1:1 from pototype/chrome.jsx + shell.jsx (sidebar/topbar/menu);
//   badges come from real queries (decision C10), labels from i18n keys. Must pass the visual gate (G5).
// DONE(P0-WEB-06): API client generated from packages/contracts openapi.yaml (api-client.ts, via
//   openapi-fetch typed by the generated `paths`) - no hand-written models/fetch; fed into TanStack
//   Query through the `unwrap` adapter in query-client.ts.

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found");
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

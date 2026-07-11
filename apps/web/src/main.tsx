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
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Fiori theme tokens - the only allowed source of colors/fonts/spacing/radius (never hardcode values).
import "@juneflow/tokens/src/tokens.css";

// TODO(P0-WEB-02): build the route tree + route constants for all 44 menus, port order per
//   docs/extract/NAV-ROUTES.md (default route = "dashboard"; routes missing a screen render the
//   prototype Placeholder; decisions C7 = NAV-side labels / "อนุมัติ BOQ" / add boq.bom label,
//   C8 = gate subcon.* with module subcon). Placeholder screens stay hidden behind feature flags.
// TODO(P0-WEB-03): i18n wiring - key-based t() from @juneflow/i18n (th/zh/en/ar + RTL for ar).
//   Every visible string = key from i18n-full.json; missing key => write BLOCKERS.md, never invent.
// TODO(P0-WEB-05): port the app shell 1:1 from pototype/chrome.jsx + shell.jsx (sidebar/topbar/menu);
//   badges come from real queries (decision C10), labels from i18n keys. Must pass the visual gate (G5).
// TODO(P0-WEB-06): API client generated from packages/contracts openapi.yaml only - never hand-write
//   models or fetch calls; set up the TanStack Query client here.

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

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found");
}

createRoot(rootEl).render(
  <StrictMode>
    <PlaceholderShell />
  </StrictMode>,
);

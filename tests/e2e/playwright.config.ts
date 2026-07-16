import { defineConfig } from "@playwright/test";

// tests/e2e — Playwright E2E harness config (Gate G4 — PLAN.md §9).
//
// Expected behavior comes ONLY from the state machines in docs/handoff/flows.html
// (7 process flows + approval matrix) + the ported screen spec (pototype/*.jsx).
// Per tests/CLAUDE.md iron rule: never read the implementation to DERIVE expected
// values (selectors, which must be stable, are a separate concern).
//
// Two run modes:
//   - default (no E2E_LIVE): reachability smoke only — web GET / = 200 + api
//     /health = 200. Requires the compose dev stack up (run-gates recipe).
//   - E2E_LIVE=1: also runs the real login→shell flow. Because the compose web
//     nginx does not proxy /api/* (see e2e/live-proxy.mjs), we front the SPA and
//     the api behind ONE origin (the live-proxy webServer) so the browser drives
//     the genuine bearer-JWT login against the seeded stack.
const LIVE = Boolean(process.env.E2E_LIVE);
const PROXY_PORT = Number(process.env.PROXY_PORT ?? 5199);
const PROXY_ORIGIN = `http://localhost:${PROXY_PORT}`;
// This config lives in tests/e2e/; __dirname (Playwright loads it as CJS) is that
// directory, so the proxy launches regardless of the invoking cwd.
const PROXY_SCRIPT = `${__dirname}/live-proxy.mjs`;

// In LIVE mode the SPA + api share the proxy origin; otherwise talk to the
// compose web directly (reachability only). E2E_BASE_URL overrides either.
const baseURL =
  process.env.E2E_BASE_URL ?? (LIVE ? PROXY_ORIGIN : "http://localhost:5173");

export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  // Only in LIVE mode: start the single-origin proxy in front of compose
  // web(:5173) + api(:3000). reuseExistingServer lets a hand-started proxy win.
  ...(LIVE
    ? {
        webServer: {
          command: `node ${JSON.stringify(PROXY_SCRIPT)}`,
          url: `${PROXY_ORIGIN}/`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
          stdout: "pipe" as const,
          stderr: "pipe" as const,
        },
      }
    : {}),
});

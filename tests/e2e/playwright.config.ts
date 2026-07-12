import { defineConfig } from "@playwright/test";

// tests/e2e — Playwright E2E harness config (Gate G4 — PLAN.md §9).
//
// Expected behavior comes ONLY from the state machines in docs/handoff/flows.html
// (7 process flows + approval matrix). Per tests/CLAUDE.md iron rule: never read
// the implementation before writing expected values.
//
// TODO(P0-QA-03): first smoke test (login -> shell load) running against the
// compose dev stack from infra/docker-compose.yml (depends on P0-DEV-01).
export default defineConfig({
  testDir: ".",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    // TODO(P0-QA-03): confirm the web port exposed by infra/docker-compose.yml.
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "on-first-retry",
  },
});

import { defineConfig } from "@playwright/test";

// B-315 live-proof config — the API-only variant of playwright.config.ts, same
// shape as b307-live.config.ts. finance-flow.spec.ts drives the api directly over
// the bearer-JWT flow (APIRequestContext, no browser), so it needs neither the SPA
// nor the single-origin live-proxy webServer the default LIVE config starts — that
// proxy waits on the compose `web` service, which an api-only stack does not run.
// Point E2E_API_URL at the stack's api port and run this config with E2E_LIVE=1.
const apiUrl = process.env.E2E_API_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  testMatch: "finance-flow.spec.ts",
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: apiUrl },
});

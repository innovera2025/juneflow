import { defineConfig } from "@playwright/test";

// B-307 live-proof config — the API-only variant of playwright.config.ts.
// b307-attendance-idempotency.spec.ts drives the api directly over the bearer-JWT
// flow (APIRequestContext, no browser), so it needs neither the SPA nor the
// single-origin live-proxy webServer the default LIVE config starts — that proxy
// waits on the compose `web` service, which an api-only stack does not run. Point
// E2E_API_URL at the stack's api port and run this config with E2E_LIVE=1.
const apiUrl = process.env.E2E_API_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  testMatch: "b307-attendance-idempotency.spec.ts",
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: apiUrl },
});

import { defineConfig } from "@playwright/test";

// B-360 live-proof config — the API-only variant of playwright.config.ts (same
// shape as b368-live.config.ts). The spec drives the api directly over the
// bearer-JWT flow and opens a direct psql connection to read the JV legs back
// independently, so it needs neither the SPA nor the single-origin live-proxy
// webServer the default LIVE config starts.
//
// Run with:  E2E_LIVE=1 E2E_API_URL=<api> DATABASE_URL=<pg> \
//              pnpm playwright test --config e2e/b360-live.config.ts
//
// workers=1 / fullyParallel OFF deliberately: the file mints ONE order and
// receives against it in sequence; a parallel worker racing the same anchor would
// turn a genuine pass into a 409 that looks like a defect in the code under test.
const apiUrl = process.env.E2E_API_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  testMatch: /b360-.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: apiUrl },
});

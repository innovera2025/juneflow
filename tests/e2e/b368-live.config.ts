import { defineConfig } from "@playwright/test";

// B-368 live-proof config — the API-only variant of playwright.config.ts (same
// shape as b342-live.config.ts / b332-live.config.ts). The spec drives the api
// directly over the bearer-JWT flow and opens a direct psql connection to read the
// JV legs back independently, so it needs neither the SPA nor the single-origin
// live-proxy webServer the default LIVE config starts.
//
// Run with:  E2E_LIVE=1 E2E_API_URL=<api> DATABASE_URL=<pg> \
//              pnpm playwright test --config e2e/b368-live.config.ts
//
// workers=1 / fullyParallel OFF deliberately: every test creates a receipt against
// "an approved (open) PO" resolved fresh, and a parallel worker closing that PO
// with its own full receipt would turn a genuine pass into a 409 that looks like a
// defect in the code under test.
const apiUrl = process.env.E2E_API_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  testMatch: /b368-.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: apiUrl },
});

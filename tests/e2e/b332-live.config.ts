import { defineConfig } from "@playwright/test";

// B-332 live-proof config — the API-only variant of playwright.config.ts (same shape
// as b307-live.config.ts). b332-checkin-schema.spec.ts drives the api directly over
// the bearer-JWT flow (APIRequestContext, no browser) and opens ONE direct psql
// connection to construct the check-out race, so it needs neither the SPA nor the
// single-origin live-proxy webServer the default LIVE config starts.
//
// Run with:  E2E_LIVE=1 E2E_API_URL=<api> DATABASE_URL=<pg> \
//              pnpm playwright test --config e2e/b332-live.config.ts
//
// fullyParallel is OFF deliberately: the constructed race holds a row lock open, and
// a parallel worker touching the same tenant would make "the API blocked" ambiguous.
const apiUrl = process.env.E2E_API_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  testMatch: "b332-checkin-schema.spec.ts",
  fullyParallel: false,
  workers: 1,
  // The race test deliberately waits ~2.5s on a held lock.
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: apiUrl },
});

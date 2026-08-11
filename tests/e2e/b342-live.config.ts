import { defineConfig } from "@playwright/test";

// B-340 / B-342 live-proof config — the API-only variant of playwright.config.ts
// (same shape as b332-live.config.ts). Both specs drive the api directly over the
// bearer-JWT flow and open direct psql connections to seed balances and to construct
// the held-lock race, so they need neither the SPA nor the single-origin live-proxy
// webServer the default LIVE config starts.
//
// Run with:  E2E_LIVE=1 E2E_API_URL=<api> DATABASE_URL=<pg> \
//              pnpm playwright test --config e2e/b342-live.config.ts
//
// fullyParallel is OFF and workers=1 deliberately: the constructed race holds a row
// lock open, and the stock fixtures reset a shared (item, warehouse) balance — a
// parallel worker touching the same tenant would make "the API blocked" ambiguous.
const apiUrl = process.env.E2E_API_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  testMatch: /b34[02]-.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  // The constructed race deliberately waits ~3s on a held lock; the bursts spawn N
  // subprocesses released on a 900 ms barrier.
  timeout: 120_000,
  reporter: [["list"]],
  use: { baseURL: apiUrl },
});

import { defineConfig } from "@playwright/test";

// B-351 live-proof config — the API-only variant of playwright.config.ts (same
// shape as b348/b342/b332-live.config.ts). The spec drives the api directly over
// the bearer-JWT flow, so it needs neither the SPA nor the single-origin
// live-proxy webServer the default LIVE config starts.
//
// Run with:  E2E_LIVE=1 E2E_API_URL=<api> \
//              pnpm playwright test --config e2e/b351-live.config.ts
//
// workers=1 / fullyParallel OFF deliberately: the suite MOVES work periods
// through their state machine and each test resolves "a period in <status>"
// fresh, so a parallel worker consuming the same row would make a genuine pass
// look like a 409 in the code under test.
const apiUrl = process.env.E2E_API_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  testMatch: /b351-.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: [["list"]],
  use: { baseURL: apiUrl },
});

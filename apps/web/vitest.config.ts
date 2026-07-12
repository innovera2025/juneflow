// Vitest config for @juneflow/web (G3 unit tests — PLAN.md §9).
// The i18n wiring tests (P0-WEB-03) are DOM-free by design (side-effects are injected),
// so the default Node environment is enough — no jsdom dependency required.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});

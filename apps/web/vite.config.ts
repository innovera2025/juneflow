// Vite config for @juneflow/web (React 18 SPA - PLAN.md Appendix A).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Where `pnpm dev` should forward /api to. Defaults to the api service's dev
// port; override with API_PROXY_TARGET when running against a different stack
// (e.g. the compose api published on 3001).
const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // api-client.ts falls back to a SAME-ORIGIN "/api/v1", so without this the
    // dev server answers every API call with index.html and HTTP 200 — a
    // failure shaped like a success, since the client receives HTML where JSON
    // should be and the status code says nothing is wrong. The production image
    // solves the same problem in apps/web/nginx.conf.template; this is the dev
    // half of that pair, and the two must not drift.
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});

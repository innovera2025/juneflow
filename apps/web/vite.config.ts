// Vite config for @juneflow/web (React 18 SPA - PLAN.md Appendix A).
// TODO(P0-WEB-01): wire dev proxy to apps/api once the Fastify skeleton (P0-BE-13) exposes endpoints.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
  },
});

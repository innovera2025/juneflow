// Drizzle Kit config - PostgreSQL 16, single DB, company_id middleware scope
// (RLS deferred - PLAN.md Appendix A).
// Schema changes go through Drizzle migrations ONLY (apps/api/CLAUDE.md);
// merged migrations are sacred files (PLAN.md section 10).
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/juneflow",
  },
});

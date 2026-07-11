// Drizzle Kit config - PostgreSQL 16, single DB, company_id middleware scope
// (RLS deferred - PLAN.md Appendix A).
// Schema changes go through Drizzle migrations ONLY (apps/api/CLAUDE.md);
// merged migrations are sacred files (PLAN.md section 10).
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  // Point drizzle-kit at the per-group table files directly (not the index.ts
  // barrel): the barrel uses NodeNext ".js" import specifiers for tsc, which
  // drizzle-kit's CJS loader cannot resolve. Add each new group's file here.
  schema: ["./src/schema/platform.ts"],
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://postgres:postgres@localhost:5432/juneflow",
  },
});

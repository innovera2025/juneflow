// @juneflow/db — Drizzle client factory (node-postgres).
//
// Single DB, `company_id` middleware scope (RLS deferred — PLAN.md Appendix A).
// This module only constructs the connection pool + Drizzle handle; tenant
// scoping (company_id enforced on EVERY query) is layered ON TOP of this base
// handle by apps/api (src/db/tenant-db.ts, P0-BE-11). Nothing here issues a
// query, so importing it does not open a connection until the first query.
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

export type Schema = typeof schema;

/** The base (un-scoped) Drizzle handle. Never expose this to request handlers
 *  directly — hand out a tenant-scoped wrapper instead (apps/api TenantDb). */
export type Db = NodePgDatabase<Schema>;

/**
 * Build a Drizzle handle over a fresh pg Pool.
 * @param connectionString defaults to `DATABASE_URL`.
 */
export function createDb(
  connectionString: string | undefined = process.env.DATABASE_URL,
): Db {
  const pool = new Pool(
    connectionString ? { connectionString } : {},
  );
  return drizzle(pool, { schema });
}

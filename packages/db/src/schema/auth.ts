// @juneflow/db — better-auth tables (P1-BE-01, decision B-016(ก)).
//
// better-auth self-hosts in OUR Postgres (PLAN.md §3 + Appendix A). B-016(ก):
// it must NOT own/extend the dictionary `user` table (sacred migration 0000) —
// instead it gets its own `auth_user` table (wired via `user.modelName` in
// apps/api/src/auth.ts) linked to the tenant by `company_id`. All auth tables
// go through Drizzle migrations like every other table (apps/api/CLAUDE.md:
// schema changes via migrations ONLY — the earlier "created via better-auth
// CLI" note in apps/api/src/auth.ts predated this decision).
//
// Column set = better-auth core schema (user/session/account/verification) for
// the email+password + bearer setup we run. Primary keys are text (better-auth
// generates its own non-uuid string ids). Timestamps are UTC like every table
// (PLAN.md §4).
//
// The app link: auth_user.email ↔ user.email within auth_user.company_id
// (user_company_email_uq makes that pair unique), so a session resolves to
// exactly one dictionary user row per tenant.
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./platform.js";

/**
 * auth_user — better-auth's user model (modelName "auth_user", B-016(ก)).
 * Tenant binding: company_id is set server-side only (input: false in the
 * better-auth config) — a client can never claim another tenant.
 */
export const authUsers = pgTable(
  "auth_user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    companyId: uuid("company_id").references(() => companies.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("auth_user_company_idx").on(t.companyId)],
);

/** auth_session — one row per live session; `token` is the bearer credential. */
export const authSessions = pgTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("auth_session_user_idx").on(t.userId)],
);

/**
 * auth_account — provider credentials per user. For email+password the
 * provider_id is "credential" and `password` holds the scrypt hash.
 */
export const authAccounts = pgTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("auth_account_user_idx").on(t.userId)],
);

/** auth_verification — better-auth verification tokens (email flows etc.). */
export const authVerifications = pgTable("auth_verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

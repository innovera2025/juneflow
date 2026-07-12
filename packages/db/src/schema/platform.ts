// @juneflow/db — Platform / Tenant schema group (P0-BE-06).
//
// Source of truth: docs/handoff/data-dictionary.html section "Platform / Tenant"
// (+ erd.html relationships). Entities: Company (Tenant), Package, Subscription,
// PlatformInvoice, AiUsage, User, Role.
//
// Global-readiness hard rules (PLAN.md section 4) applied to every table:
//   - id is a real uuid PK; *_id columns are real uuid FKs (never name-text FKs,
//     which are a prototype mock mechanism — PLAN.md section 0 rule 3)
//   - all timestamps are stored as UTC (timestamptz); calendar/timezone is a
//     per-user/tenant display concern
//   - every money column carries a currency_code
//
// better-auth session/account tables are intentionally NOT defined here — they
// are self-hosted by P0-BE-11 (PLAN.md Appendix A). Role.perms matrix is
// Appendix B item 13 (P0-BE-09). Any NEW conflict -> BLOCKERS.md, never decide
// locally.

import {
  pgEnum,
  pgTable,
  index,
  text,
  uuid,
  integer,
  numeric,
  jsonb,
  timestamp,
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Shared JSON shapes
// ---------------------------------------------------------------------------

/**
 * Package.limits — quota per package (data-dictionary: "{projects, users,
 * storage_gb, ai_per_month} · -1 = ไม่จำกัด"). Key names per decision C5:
 * storage_gb / ai_per_month (NOT storage / ai). -1 means unlimited.
 */
export interface PackageLimits {
  projects: number;
  users: number;
  storage_gb: number;
  ai_per_month: number;
}

/**
 * Package.sub_rules — module unlock rules stacked on top of `menus`
 * (data-dictionary: "sub_rules (ptype->Full, aiqto->M+)"). Free-form map of
 * nav-id -> minimum package requirement; kept as a string map so new rules do
 * not require a migration.
 */
export type PackageSubRules = Record<string, string>;

/**
 * Role.approval_limits — approval cap per document type (data-dictionary:
 * "เพดานอนุมัติต่อชนิดเอกสาร"). Map of doc-type -> numeric ceiling.
 */
export type ApprovalLimits = Record<string, number>;

/**
 * Role.perms — the permission matrix, PLAN.md Appendix B item 13 (P0-BE-09).
 * master.jsx `ROLE_PRESETS.perms` = 11 modules x 5 permissions
 * (ดู/สร้าง/แก้ไข/อนุมัติ/ยกเลิก). Stored as a map of module-id -> the 5 boolean
 * flags so adding a module needs no migration.
 */
export interface RolePermFlags {
  view: boolean;
  create: boolean;
  edit: boolean;
  approve: boolean;
  cancel: boolean;
}
export type RolePerms = Record<string, RolePermFlags>;

// ---------------------------------------------------------------------------
// Enums (status columns)
// ---------------------------------------------------------------------------

export const companyStatus = pgEnum("company_status", ["active", "suspended"]);
export const packageSize = pgEnum("package_size", ["S", "M", "L", "Full"]);
export const subscriptionCycle = pgEnum("subscription_cycle", [
  "monthly",
  "yearly",
]);
export const subscriptionStatus = pgEnum("subscription_status", [
  // `trial` = the 14-day free-trial state (subscription-admin.jsx T-1005 "ทดลอง").
  // Added in migration 0006 per B-021(ก); it precedes the paid lifecycle.
  "trial",
  "active",
  "expiring",
  "overdue",
  "cancelled",
]);
export const platformInvoiceStatus = pgEnum("platform_invoice_status", [
  "paid",
  "pending",
  "overdue",
]);
export const userStatus = pgEnum("user_status", ["active", "blocked"]);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * Package (S/M/L/Full) — owner-editable subscription plan.
 * data-dictionary: size,name,price_m,price_y (S=2900 M=7900 L=14900 Full=ติดต่อ),
 * limits json, menus string[] (46 nav ids), sub_rules.
 * price_m / price_y are nullable because "Full = ติดต่อ" (contact — no listed price).
 */
export const packages = pgTable("package", {
  id: uuid("id").primaryKey().defaultRandom(),
  size: packageSize("size").notNull(),
  name: text("name").notNull(),
  priceM: numeric("price_m", { precision: 12, scale: 2 }),
  priceY: numeric("price_y", { precision: 12, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  limits: jsonb("limits").$type<PackageLimits>().notNull(),
  menus: jsonb("menus").$type<string[]>().notNull(),
  subRules: jsonb("sub_rules").$type<PackageSubRules>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * Company (Tenant) — one company per tenant on the shared multi-tenant system.
 * data-dictionary: name / tax_id / address (juristic info for e-Tax),
 * subscription_id (current package), status.
 * subscription_id <-> subscription.company_id is a circular 1:1; both sides are
 * real FKs and subscription_id is nullable so a company can be created first.
 *
 * Appendix B item 14 — Multi-company group (company-accept.jsx `COMPANIES`:
 * short, color, doc_prefix, biz). Affiliated companies "ในเครือ" are linked via
 * the self-referential group_parent_id (the group head; null for a standalone /
 * head company), enabling the cross-company approval inbox without changing the
 * company_id tenant-scope key. doc_prefix is the per-company document-number
 * prefix.
 */
export const companies = pgTable("company", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  taxId: text("tax_id"),
  address: text("address"),
  subscriptionId: uuid("subscription_id").references(
    (): AnyPgColumn => subscriptions.id,
    { onDelete: "set null" },
  ),
  groupParentId: uuid("group_parent_id").references(
    (): AnyPgColumn => companies.id,
    { onDelete: "set null" },
  ),
  short: text("short"),
  color: text("color"),
  docPrefix: text("doc_prefix"),
  biz: text("biz"),
  status: companyStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * Subscription — a company's active package with billing cycle + renewal.
 * data-dictionary: company_id, package_id, cycle, renew_at, status
 * (trial | active | expiring | overdue | cancelled — `trial` added by B-021(ก)).
 * cycle: monthly | yearly (price_m /
 * price_y on Package).
 */
export const subscriptions = pgTable("subscription", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  packageId: uuid("package_id")
    .notNull()
    .references(() => packages.id, { onDelete: "restrict" }),
  cycle: subscriptionCycle("cycle").notNull(),
  renewAt: timestamp("renew_at", { withTimezone: true, mode: "date" }),
  status: subscriptionStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("subscription_company_idx").on(t.companyId)]);

/**
 * PlatformInvoice — billing document against a subscription (owner dunning).
 * data-dictionary: subscription_id, amount, status (paid | pending | overdue).
 */
export const platformInvoices = pgTable("platform_invoice", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriptionId: uuid("subscription_id")
    .notNull()
    .references(() => subscriptions.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currencyCode: text("currency_code").notNull().default("THB"),
  status: platformInvoiceStatus("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * AiUsage — monthly AI QTO quota consumption per company.
 * data-dictionary: company_id, month, used ("ตัดโควต้า AI QTO รายเดือน").
 * `month` is a YYYY-MM period key; one row per company per month.
 */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    month: text("month").notNull(),
    used: integer("used").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("ai_usage_company_month_uq").on(t.companyId, t.month)],
);

/**
 * Role — permission + approval role, scoped to a company.
 * data-dictionary: approval_limits json (approval cap per doc type). The full
 * perms matrix (11 modules x 5 permissions) is Appendix B item 13 (P0-BE-09).
 */
export const roles = pgTable("role", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  approvalLimits: jsonb("approval_limits")
    .$type<ApprovalLimits>()
    .notNull()
    .default({}),
  // Appendix B item 13 — 11-module x 5-permission matrix (master.jsx ROLE_PRESETS).
  perms: jsonb("perms").$type<RolePerms>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("role_company_idx").on(t.companyId)]);

/**
 * User — a member of a company (multi-tenant: User ∈ Company).
 * data-dictionary: email, name, role_id, status (active | blocked — admin can
 * block / reset password). Email is unique within a company. Auth sessions /
 * accounts are handled separately by better-auth (P0-BE-11).
 */
export const users = pgTable(
  "user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    roleId: uuid("role_id").references(() => roles.id, { onDelete: "set null" }),
    status: userStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("user_company_email_uq").on(t.companyId, t.email)],
);

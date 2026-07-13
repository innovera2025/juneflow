// @juneflow/db — Project / Master schema group (P0-BE-07).
//
// Source of truth: docs/handoff/data-dictionary.html section "โครงการ / Master"
// (+ erd.html "Master / โครงการ" band). Entities: ProjectType, Project,
// ProjectNode (Phase/Block/Unit tree), Model (house model), CostCenter,
// Vendor, Customer.
//
// Global-readiness hard rules (PLAN.md section 4) applied to every table:
//   - id is a real uuid PK; *_id columns are real uuid FKs (never name-text FKs,
//     which are a prototype mock mechanism — PLAN.md section 0 rule 3)
//   - all timestamps stored as UTC (timestamptz)
//   - every money column carries a currency_code
//   - land / house area stored in square meters (rai-ngan-wa at display only)
//   - company_id tenant scope on aggregate roots + masters (PLAN.md section 5);
//     child rows scope through their parent FK
//
// Any NEW conflict outside PLAN.md Appendix C -> BLOCKERS.md, never decide
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
import { companies } from "./platform.js";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * ProjectType.key — the 4 product project types (data-dictionary Project.type:
 * "realestate | solar | civil | service"). Lives on project_type; a Project
 * references its type via type_id (erd.html: Project.type_id -> ProjectType).
 */
export const projectTypeKey = pgEnum("project_type_key", [
  "realestate",
  "solar",
  "civil",
  "service",
]);

/**
 * Vendor.kind — a vendor is either a supplier (materials, AP) or a subcon
 * (labor contract, WO / WorkPeriod). data-dictionary: "vendor(ผู้ขาย|ผู้รับเหมา
 * flag)"; erd.html: "kind: supplier|subcon".
 */
export const vendorKind = pgEnum("vendor_kind", ["supplier", "subcon"]);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * ProjectType — WBS + module config per product type (erd.html "ProjectType",
 * note "Full only"). hierarchy is the ordered WBS label list per type (e.g.
 * [site, zone/Array, string, inverter]); modules is the nav-id set opened for
 * the type, stacked on top of the package menus. Product-level reference config
 * (no company_id — erd.html shows none), seeded from docs/extract/PROJECT-TYPES.md.
 */
export const projectTypes = pgTable("project_type", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: projectTypeKey("key").notNull().unique(),
  name: text("name").notNull(),
  hierarchy: jsonb("hierarchy").$type<string[]>().notNull().default([]),
  modules: jsonb("modules").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * Project — a construction/service project owned by a company.
 * data-dictionary: name, type, budget, status. type is carried via type_id ->
 * project_type (erd.html). budget is money -> currency_code. status left as
 * free text (dictionary does not enumerate project status values).
 *
 * short / color — B-041(ก+) approved columns (migration 0009): the
 * ProjectSwitcher short-code + chip color from chrome.jsx PROJECTS (e.g.
 * "RJP" / "#0B2A4A"), stamped verbatim at seed time. Nullable — display-only
 * master fields, not required by any business rule.
 */
export const projects = pgTable("project", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  typeId: uuid("type_id")
    .notNull()
    .references(() => projectTypes.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  short: text("short"),
  color: text("color"),
  budget: numeric("budget", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("project_company_idx").on(t.companyId)]);

/**
 * Model — a house / building model (แบบบ้าน) referenced by sale units.
 * data-dictionary: Phase/Block/Unit "model_id (แบบบ้าน)"; erd.html Model:
 * name, area. area stored in m2 (PLAN.md section 4). Company-scoped master.
 */
export const models = pgTable("model", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  area: numeric("area", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("model_company_idx").on(t.companyId)]);

/**
 * ProjectNode — the Phase/Block/Unit hierarchy, one self-referential tree per
 * project (data-dictionary: "hierarchy: Project -> Phase -> Block -> Unit (label
 * ตาม type)", "tree via parent_id + model_id + สถานะขาย"). `kind` names the
 * level using the ProjectType.hierarchy labels (free text — labels vary per
 * type, so not an enum). saleStatus is the per-unit sale status (labels per
 * project type -> free text). model_id is nullable (only leaf units carry it).
 */
export const projectNodes = pgTable("project_node", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => projectNodes.id, {
    onDelete: "cascade",
  }),
  modelId: uuid("model_id").references(() => models.id, {
    onDelete: "set null",
  }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  saleStatus: text("sale_status"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * CostCenter — attached to every cost document (incl. land survey work).
 * data-dictionary: code, name, project_id. `code` is unique within a project.
 */
export const costCenters = pgTable(
  "cost_center",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("cost_center_project_code_uq").on(t.projectId, t.code)],
);

/**
 * Vendor — supplier / subcon master; AP pulls from here (data-dictionary
 * "master แยกชัด: vendor(ผู้ขาย|ผู้รับเหมา flag)"). Company-scoped master.
 * creditTerm = payment credit term in days (erd.html Vendor.credit_term).
 */
export const vendors = pgTable("vendor", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  taxId: text("tax_id"),
  kind: vendorKind("kind").notNull().default("supplier"),
  creditTerm: integer("credit_term"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("vendor_company_idx").on(t.companyId)]);

/**
 * Customer — buyer / PM customer master; AR pulls from here (data-dictionary
 * "customer (ผู้ซื้อ/ลูกค้า PM)"). Company-scoped master.
 */
export const customers = pgTable("customer", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  taxId: text("tax_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("customer_company_idx").on(t.companyId)]);

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

// NOTE: project_type.key was the `project_type_key` enum (realestate | solar |
// civil | service). B-065 (P1-BE-14) relaxed it to `text` because a tenant's
// CUSTOM project type carries a free-form key (the mock generates
// "custom_<base36 ts>", project-type-screen.jsx:135) — a 4-value enum could
// only ever hold the product defaults. The enum type is dropped in migration
// 0014 (same enum→text pattern as doc_numbering.running/locked, 0012/0013).

/**
 * Vendor.kind — a vendor is either a supplier (materials, AP) or a subcon
 * (labor contract, WO / WorkPeriod). data-dictionary: "vendor(ผู้ขาย|ผู้รับเหมา
 * flag)"; erd.html: "kind: supplier|subcon".
 */
export const vendorKind = pgEnum("vendor_kind", ["supplier", "subcon"]);

/**
 * Model.status — a house model is either published (`active`) or a `draft`
 * (B-050, P1-BE-09). master.jsx MODELS carry status active|draft, and a newly
 * created model always starts `draft` (ModelAddForm:465 "สถานะ ร่าง · สร้าง BOM
 * ได้หลังบันทึก").
 */
export const modelStatus = pgEnum("model_status", ["active", "draft"]);

/**
 * CostCenter.type — Project | Overhead | Dept (B-059, P1-BE-11). master.jsx
 * CC_SEED carries the three values verbatim (MasterCC type badge + CCAddForm
 * dropdown, master.jsx:584-592/641).
 */
export const costCenterType = pgEnum("cost_center_type", [
  "Project",
  "Overhead",
  "Dept",
]);

/**
 * CostCenter.status — draft | approved (B-059, P1-BE-11). A plain field, NOT a
 * workflow: creation always lands `draft` (CCAddForm submits status "draft",
 * master.jsx:628; no approval flow exists in flows.html per the B-059 ruling).
 */
export const costCenterStatus = pgEnum("cost_center_status", [
  "draft",
  "approved",
]);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * ProjectType — WBS + module config per product type (erd.html "ProjectType",
 * note "Full only"). hierarchy is the ordered WBS label list per type (e.g.
 * [site, zone/Array, string, inverter]); modules is the nav-id set opened for
 * the type, stacked on top of the package menus. Seeded from
 * docs/extract/PROJECT-TYPES.md.
 *
 * B-065 (P1-BE-14) — TENANT-SCOPED, hybrid ownership. The master.ptype screen
 * (project-type-screen.jsx ProjectTypeForm, POST/PUT /project-types) lets a
 * user CREATE/EDIT project types; before B-065 this was a platform-global
 * reference table, so a tenant's custom type would have leaked to ALL tenants
 * (tenant-leak). Wei ruling: tenant-scope it via a NULLABLE company_id:
 *   - company_id IS NULL  → a GLOBAL product default (realestate/solar/civil/
 *     service): shared, seeded once, read by every tenant, and READ-ONLY to
 *     tenants (a tenant cannot edit a shared default — the scoped update door
 *     matches zero rows → 404).
 *   - company_id = <tenant> → a CUSTOM type OWNED by that tenant. It must NEVER
 *     leak to another tenant.
 * Reads go through the hybrid TenantDb.selectGlobalOrOwned() door
 * (company_id IS NULL OR company_id = <tenant>); writes go through the scoped
 * insert()/update() doors (force-set / hard-filter company_id = <tenant>).
 *
 * key is `text` (was the project_type_key enum) so a custom type's free-form
 * key fits; uniqueness is now per owner: unique(company_id, key). Postgres
 * treats NULLs as distinct, so the 4 global keys stay unique via the seed (one
 * row each) while each tenant's custom keys are unique within that tenant.
 */
export const projectTypes = pgTable("project_type", {
  id: uuid("id").primaryKey().defaultRandom(),
  // NULL = a platform-global product default (shared, seeded); a company id =
  // a custom type owned by that tenant (B-065). onDelete cascade drops a
  // tenant's custom types with the tenant; the NULL globals are unaffected.
  companyId: uuid("company_id").references(() => companies.id, {
    onDelete: "cascade",
  }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  hierarchy: jsonb("hierarchy").$type<string[]>().notNull().default([]),
  modules: jsonb("modules").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("project_type_company_idx").on(t.companyId),
  unique("project_type_company_key_uq").on(t.companyId, t.key),
]);

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
  // `name` is the model's display name (master.jsx MODELS `type`, e.g.
  // "บ้านเดี่ยว 2 ชั้น") — the erd Model.name. `code` is the short model code
  // (e.g. "A-1"), unique per tenant (B-050).
  name: text("name").notNull(),
  // B-050 (P1-BE-09) house-model attributes from master.jsx MODELS (L426-432).
  // `code` is uppercase, unique within the company (model_company_code_uq).
  // Nullable at the column level so the new-column migration lands on existing
  // rows; presence + uniqueness are enforced by POST /models and the seed.
  code: text("code"),
  // Room spec (mock int). Nullable — added after the original rows existed.
  bed: integer("bed"),
  bath: integer("bath"),
  parking: integer("parking"),
  // area stays numeric (existing column) — integer mock values store cleanly.
  area: numeric("area", { precision: 12, scale: 2 }),
  // `price` is the starting price in REAL money — FULL baht (numeric +
  // currency_code), NOT the mock's "M ฿" (millions) display. The FE divides by
  // 1e6 for the "8.24 M ฿" card (master.jsx:559). Nullable (price is optional
  // on the create form).
  price: numeric("price", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  status: modelStatus("status").notNull().default("draft"),
  // The model card accent color — persisted, assigned server-side by rotating a
  // 7-color palette at create time (master.jsx MODEL_COLORS:449). Nullable for
  // the pre-existing rows the migration alters.
  color: text("color"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("model_company_idx").on(t.companyId),
  unique("model_company_code_uq").on(t.companyId, t.code),
]);

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
  // Node code (B-053): the block/unit code surfaced as HierarchyNode.code.
  // Blocks carry the user-entered code (e.g. "B"); units carry the generated
  // "{blockCode}-{NN}" (padStart 2); phases have none. Nullable (phase nodes +
  // pre-existing rows). Block-code uniqueness within a project is enforced by
  // the createProjectNode handler, not a DB constraint (project_node has no
  // company_id — see tenant scope), so no unique index here.
  code: text("code"),
  saleStatus: text("sale_status"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [
  // 0024 (perf-audit §2.3 Tier 2): project_node is the self-referential
  // Phase/Block/Unit tree — read by project_id (all nodes of a project) and
  // walked by parent_id (children of a node). Both are FK JOIN keys.
  index("project_node_project_idx").on(t.projectId),
  index("project_node_parent_idx").on(t.parentId),
]);

/**
 * CostCenter — attached to every cost document (incl. land survey work).
 * data-dictionary: code, name, project_id. `code` is unique within a project.
 *
 * type / link / owner / budget / status — B-059(ก) approved superset
 * (P1-BE-11): the MasterCC screen (master.jsx:584-731) renders 7 columns the
 * dictionary lacked. link = the "ผูกกับ (เฟส / Block / แผนก)" display text;
 * owner = the responsible person's display name; budget is money → FULL baht
 * numeric + currency_code (repo money rule — never the mock's formatted
 * string). type/link/owner/budget are nullable at the column level so the
 * new-column migration lands on pre-existing rows (B-050 precedent); presence
 * is enforced by the seed + POST /cost-centers.
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
    type: costCenterType("type"),
    link: text("link"),
    owner: text("owner"),
    budget: numeric("budget", { precision: 16, scale: 2 }),
    currencyCode: text("currency_code").notNull().default("THB"),
    // Plain status field (no approval flow) — a new cost center starts draft.
    status: costCenterStatus("status").notNull().default("draft"),
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
 *
 * addr / bank / status / code — B-071 (P2-BE-08) approved additive superset,
 * mirroring the B-059(ก)/cost_center pattern (P1-BE-11): the master.vendor
 * screen (master-party.jsx MasterVendor + VendorForm L137-183) renders columns
 * the base table lacked. addr = the registered-address display text; bank = the
 * bank-account display string ("KBANK 012-3-45678-9"); code = the "V-00xx"
 * display code the mock generates (now persisted — before B-071 there was no
 * column so it was omitted from the wire). addr/bank/code are nullable at the
 * column level so the new-column migration lands on the 13 pre-existing rows
 * (B-050 precedent); presence is populated by the seed + POST /vendors.
 *   status = active | inactive (VendorForm status dropdown, master-party.jsx:175).
 * Plain text (not an enum) — matches the most recent same-wave precedent
 * (gr.status, migration 0016) and the task's ALTER-only additive shape; the
 * active|inactive closed set is enforced at the handler layer (POST/PUT). A new
 * vendor starts `active` (the mock's VendorForm default).
 *   `type` is NOT a column — the mock's 4-way type badge (วัสดุ/บริการ/ที่ดิน/
 * รับเหมา) is display-derived from `kind` on the web (B-070), never stored.
 *   `spend` is NOT a column — the per-vendor purchase total has no AP source
 * yet (honest gap), so it stays computed/omitted rather than fabricated.
 */
export const vendors = pgTable("vendor", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Display code ("V-00xx") from VendorForm; nullable (new column on old rows).
  code: text("code"),
  taxId: text("tax_id"),
  kind: vendorKind("kind").notNull().default("supplier"),
  creditTerm: integer("credit_term"),
  // Registered-address + bank-account display strings from VendorForm; nullable.
  addr: text("addr"),
  bank: text("bank"),
  // active | inactive (VendorForm dropdown); closed set enforced by the handler.
  status: text("status").notNull().default("active"),
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

// @juneflow/db — Appendix B mandatory extensions (P0-BE-09).
//
// These entities exist in the pototype screens + mock data but are NOT in
// data-dictionary.html. Per PLAN.md section 6 they are "designed from screens +
// mock" (docs/extract/MOCK-DATA.md). The G1 FULL gate = dictionary tables
// (platform/project/boq/subcon/pm/finance/misc) + all 14 Appendix B items.
//
// This file covers 12 of the 14 items (each field traced to its mock source in
// MOCK-DATA.md). The remaining two extend existing platform tables and live in
// platform.ts:
//   - item 13  Role.perms matrix (11 modules x 5 permissions) -> roles.perms
//   - item 14  Multi-company group (COMPANIES + docPrefix)   -> company group cols
//
// Global-readiness hard rules (PLAN.md section 4) applied to EVERY table:
//   - id is a real uuid PK; *_id columns are real uuid FKs (never name-text FKs,
//     which are a prototype mock mechanism — PLAN.md section 0 rule 3)
//   - all timestamps stored as UTC (timestamptz); calendar/timezone is a
//     per-user/tenant display concern
//   - every money column carries a currency_code
//   - company_id tenant scope on every aggregate root (PLAN.md section 5)
//
// Rollup/derived fields shown in the mock (warehouse item counts, ROI cumulative,
// aging buckets, etc.) are business-rule outputs — kept only where the mock stores
// them as a persisted number. Any NEW conflict outside PLAN.md Appendix C ->
// BLOCKERS.md, never decide locally.

import {
  pgEnum,
  pgTable,
  unique,
  index,
  text,
  uuid,
  integer,
  numeric,
  boolean,
  date,
  timestamp,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { companies, users } from "./platform.js";
import {
  projects,
  projectNodes,
  customers,
  vendors,
  costCenters,
} from "./project.js";
import { prs, wos } from "./boq.js";
import { subconContracts } from "./subcon.js";
import { arInvoices } from "./finance.js";

// ---------------------------------------------------------------------------
// Enums (only where the mock enumerates a crisp, closed value set)
// ---------------------------------------------------------------------------

/** Lead/CRM 5-stage funnel (sales-crm.jsx `stages`). */
export const leadStage = pgEnum("lead_stage", [
  "lead",
  "visit",
  "quote",
  "booking",
  "contract",
]);

/** PettyCash transaction type (petty-alloc.jsx `PETTY_TX.type`). */
export const pettyCashType = pgEnum("petty_cash_type", [
  "claim",
  "clear",
  "topup",
]);

// ---------------------------------------------------------------------------
// Item 1 — Inventory (Item / Warehouse / StockTransfer / MaterialIssue)
// inventory.jsx: ITEMS / WH / TRANSFERS / ISSUES
// ---------------------------------------------------------------------------

/**
 * Warehouse — a material store (inventory.jsx `WH`: name, items, value, alerts,
 * util). item count / value / alerts / util are derived rollups over
 * inventory_item + stock_transfer; only the identity (name, location) is stored.
 */
export const warehouses = pgTable("warehouse", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  location: text("location"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("warehouse_company_idx").on(t.companyId)]);

/**
 * InventoryItem — a stocked material (inventory.jsx `ITEMS`: code, cat, name,
 * unit, price, stock, low, status, wh). price is money -> currency_code; `stock`
 * is on-hand qty, `low_point` the reorder threshold (mock `low`). status is a
 * derived ok/low badge kept as free text.
 */
export const inventoryItems = pgTable("inventory_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  warehouseId: uuid("warehouse_id").references(() => warehouses.id, {
    onDelete: "set null",
  }),
  code: text("code").notNull(),
  cat: text("cat"),
  name: text("name").notNull(),
  unit: text("unit"),
  price: numeric("price", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  stock: numeric("stock", { precision: 18, scale: 4 }).notNull().default("0"),
  lowPoint: numeric("low_point", { precision: 18, scale: 4 }),
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("inventory_item_company_idx").on(t.companyId)]);

/**
 * StockTransfer — a warehouse-to-warehouse move (inventory.jsx `TRANSFERS`: no,
 * from, to, items, qty, value, date, by, status). from/to are real warehouse
 * FKs; value is money -> currency_code; by_user_id is the initiator.
 */
export const stockTransfers = pgTable("stock_transfer", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  no: text("no").notNull(),
  fromWarehouseId: uuid("from_warehouse_id").references(() => warehouses.id, {
    onDelete: "set null",
  }),
  toWarehouseId: uuid("to_warehouse_id").references(() => warehouses.id, {
    onDelete: "set null",
  }),
  qty: numeric("qty", { precision: 18, scale: 4 }),
  value: numeric("value", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  transferDate: date("transfer_date"),
  byUserId: uuid("by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("stock_transfer_company_idx").on(t.companyId)]);

/**
 * MaterialIssue — an issue of stock out to a project (inventory.jsx `ISSUES`: no,
 * proj, from, items, value, date, by, status). project_id / from_warehouse_id are
 * real FKs; value is money -> currency_code.
 */
export const materialIssues = pgTable("material_issue", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  no: text("no").notNull(),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  fromWarehouseId: uuid("from_warehouse_id").references(() => warehouses.id, {
    onDelete: "set null",
  }),
  value: numeric("value", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  issueDate: date("issue_date"),
  byUserId: uuid("by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("material_issue_company_idx").on(t.companyId)]);

// ---------------------------------------------------------------------------
// Item 2 — Lead / CRM (5-stage funnel) — sales-crm.jsx `LEADS_BY_STAGE`
// ---------------------------------------------------------------------------

/**
 * Lead — a CRM lead moving through the 5-stage funnel (sales-crm.jsx
 * `LEADS_BY_STAGE`: id, name, phone, source, interest, hot, lastContact, note,
 * owner, days). stage is the funnel column (lead|visit|quote|booking|contract);
 * owner_user_id is the sales owner; `days` is days-in-stage.
 */
export const leads = pgTable("lead", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  phone: text("phone"),
  source: text("source"),
  interest: text("interest"),
  stage: leadStage("stage").notNull().default("lead"),
  hot: boolean("hot").notNull().default(false),
  lastContactAt: date("last_contact_at"),
  note: text("note"),
  ownerUserId: uuid("owner_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  days: integer("days"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("lead_company_idx").on(t.companyId)]);

// ---------------------------------------------------------------------------
// Item 3 — ServiceTicket (after-sales repair) — sales-service.jsx
// ---------------------------------------------------------------------------

/**
 * ServiceTicket — an after-sales repair request (sales-service.jsx
 * `SERVICE_TICKETS`: no, unit, customer, channel, category, title, prio, status,
 * assignee, date, scheduled, warranty). unit_id -> project_node (the sold unit),
 * customer_id -> customer, assignee_user_id -> user. `warranty` records whether
 * the ticket is covered under warranty.
 */
export const serviceTickets = pgTable("service_ticket", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  no: text("no").notNull(),
  unitId: uuid("unit_id").references(() => projectNodes.id, {
    onDelete: "set null",
  }),
  customerId: uuid("customer_id").references(() => customers.id, {
    onDelete: "set null",
  }),
  channel: text("channel"),
  category: text("category"),
  title: text("title").notNull(),
  priority: text("priority"),
  status: text("status"),
  assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  openedDate: date("opened_date"),
  scheduledDate: date("scheduled_date"),
  warranty: boolean("warranty").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("service_ticket_company_idx").on(t.companyId)]);

// ---------------------------------------------------------------------------
// Item 4 — Solar (Inverter O&M / PPA invoice / ROI / Permit steps / Warranty)
// solar.jsx: inverters / tickets / rows(PPA) / years(ROI) / steps / items
// ---------------------------------------------------------------------------

/**
 * SolarInverter — an O&M-monitored inverter (solar.jsx `inverters`: id, zone, kw,
 * out, perf, status, temp). kw = rated capacity, output_kw = current output, perf
 * = performance ratio %, temp = device temperature. project_id ties it to a solar
 * project.
 */
export const solarInverters = pgTable("solar_inverter", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  zone: text("zone"),
  kw: numeric("kw", { precision: 12, scale: 3 }),
  outputKw: numeric("output_kw", { precision: 12, scale: 3 }),
  perf: numeric("perf", { precision: 6, scale: 2 }),
  temp: numeric("temp", { precision: 6, scale: 2 }),
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("solar_inverter_company_idx").on(t.companyId)]);

/**
 * SolarOmTicket — an inverter O&M ticket (solar.jsx `tickets`: no, t(title),
 * pri(priority), who(assignee), st(status)). inverter_id links the ticket to the
 * monitored device.
 */
export const solarOmTickets = pgTable("solar_om_ticket", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  inverterId: uuid("inverter_id").references(() => solarInverters.id, {
    onDelete: "set null",
  }),
  no: text("no").notNull(),
  title: text("title"),
  priority: text("priority"),
  assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("solar_om_ticket_company_idx").on(t.companyId)]);

/**
 * PpaInvoice — a power-purchase-agreement (sell-electricity) invoice (solar.jsx
 * `rows`: m(month), mwh, rate, amt, st(status)). rate and amount are money ->
 * currency_code; mwh is energy sold.
 */
export const ppaInvoices = pgTable("ppa_invoice", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  month: text("month"),
  mwh: numeric("mwh", { precision: 14, scale: 4 }),
  rate: numeric("rate", { precision: 12, scale: 4 }),
  amount: numeric("amount", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("ppa_invoice_company_idx").on(t.companyId)]);

/**
 * SolarRoi — a per-year ROI row for a solar project (solar.jsx `years`: y(year),
 * rev(revenue), opex, cum(cumulative)). revenue / opex / cumulative are money ->
 * currency_code.
 */
export const solarRois = pgTable("solar_roi", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  year: integer("year"),
  revenue: numeric("revenue", { precision: 16, scale: 2 }),
  opex: numeric("opex", { precision: 16, scale: 2 }),
  cumulative: numeric("cumulative", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("solar_roi_company_idx").on(t.companyId)]);

/**
 * SolarPermitStep — one step in the solar permitting pipeline (solar.jsx `steps`:
 * n(name), org(authority), st(status), date). org is the issuing authority.
 */
export const solarPermitSteps = pgTable("solar_permit_step", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  org: text("org"),
  status: text("status"),
  stepDate: date("step_date"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("solar_permit_step_company_idx").on(t.companyId)]);

/**
 * SolarWarranty — a warranty-registry entry for installed equipment (solar.jsx
 * `items`: item, brand, qty, perf, prod(production date), exp(expiry), st).
 * prod_date / expiry_date bound the warranty window.
 */
export const solarWarranties = pgTable("solar_warranty", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  item: text("item").notNull(),
  brand: text("brand"),
  qty: integer("qty"),
  perf: numeric("perf", { precision: 6, scale: 2 }),
  prodDate: date("prod_date"),
  expiryDate: date("expiry_date"),
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("solar_warranty_company_idx").on(t.companyId)]);

// ---------------------------------------------------------------------------
// Item 5 — Timeline (Task / Milestone Gantt) — timeline.jsx
// ---------------------------------------------------------------------------

/**
 * TimelineTask — a Gantt task under a plan group (timeline.jsx `TIMELINE_TASKS`:
 * group, color, tasks[{l(label), plan[start,end], actual[start,end], status, pct,
 * late}]). plan_* / actual_* unpack the mock [start,end] arrays into real dates;
 * `late` is the schedule-slip flag.
 */
export const timelineTasks = pgTable("timeline_task", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  groupLabel: text("group_label"),
  label: text("label").notNull(),
  planStart: date("plan_start"),
  planEnd: date("plan_end"),
  actualStart: date("actual_start"),
  actualEnd: date("actual_end"),
  status: text("status"),
  pct: numeric("pct", { precision: 6, scale: 2 }),
  late: boolean("late").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("timeline_task_company_idx").on(t.companyId)]);

/**
 * Milestone — a project milestone marker on the timeline (timeline.jsx
 * `MILESTONES`: l(label), day, date, status). `day` is the plan day-offset.
 */
export const milestones = pgTable("milestone", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  label: text("label").notNull(),
  day: integer("day"),
  milestoneDate: date("milestone_date"),
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("milestone_company_idx").on(t.companyId)]);

// ---------------------------------------------------------------------------
// Item 6 — PettyCash transaction — petty-alloc.jsx `PETTY_TX`
// ---------------------------------------------------------------------------

/**
 * PettyCashTxn — a petty-cash movement (petty-alloc.jsx `PETTY_TX`: no,
 * type(claim/clear/topup), l(label), v(value), by, date, status, cat, ref).
 * value is money -> currency_code; cc_id ties the spend to a cost center; ref is
 * the source-document reference string.
 */
export const pettyCashTxns = pgTable("petty_cash_txn", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  no: text("no").notNull(),
  type: pettyCashType("type").notNull(),
  label: text("label"),
  value: numeric("value", { precision: 16, scale: 2 }).notNull(),
  currencyCode: text("currency_code").notNull().default("THB"),
  byUserId: uuid("by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  txnDate: date("txn_date"),
  status: text("status"),
  cat: text("cat"),
  ref: text("ref"),
  ccId: uuid("cc_id").references(() => costCenters.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("petty_cash_txn_company_idx").on(t.companyId)]);

// ---------------------------------------------------------------------------
// Item 7 — OrgStructure (ORG_SEED) — master.jsx `ORG_SEED`
// ---------------------------------------------------------------------------

/**
 * OrgUnit — a node in the company org tree (master.jsx `ORG_SEED`: lvl(level),
 * ic(icon), name, code, note). parent_id is the self-referential tree link (real
 * FK, replacing the mock's flat level list).
 */
export const orgUnits = pgTable("org_unit", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id").references((): AnyPgColumn => orgUnits.id, {
    onDelete: "set null",
  }),
  level: integer("level"),
  icon: text("icon"),
  name: text("name").notNull(),
  code: text("code"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("org_unit_company_idx").on(t.companyId)]);

// ---------------------------------------------------------------------------
// Item 8 — DocNumbering (DOCNUM_SEED) — master.jsx `DOCNUM_SEED`
// ---------------------------------------------------------------------------

/**
 * DocNumbering — a running-number counter per document type (master.jsx
 * `DOCNUM_SEED`: type, prefix, running, reset, lock). `running` is the next
 * sequence value; `reset_rule` is the reset cadence (yearly/monthly/never per
 * mock RESET_OPTS); `locked` freezes the format. Unique per (company, type).
 */
export const docNumberings = pgTable("doc_numbering", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  prefix: text("prefix"),
  running: integer("running").notNull().default(1),
  resetRule: text("reset_rule"),
  locked: boolean("locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [unique("doc_numbering_company_type_uq").on(t.companyId, t.type)]);

// ---------------------------------------------------------------------------
// Item 9 — Retention ledger — accounting-extra2.jsx `RETENTION_SEED`
// ---------------------------------------------------------------------------

/**
 * RetentionLedger — the retained-money ledger per subcon work order
 * (accounting-extra2.jsx `RETENTION_SEED`: wo, vendor, scope, contract, rate,
 * withheld, returned, due, status). wo_id -> wo, vendor_id -> vendor, contract_id
 * -> subcon_contract are real FKs; withheld / returned are money -> currency_code;
 * `rate` is the retention percentage.
 */
export const retentionLedgers = pgTable("retention_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  woId: uuid("wo_id").references(() => wos.id, { onDelete: "set null" }),
  vendorId: uuid("vendor_id").references(() => vendors.id, {
    onDelete: "set null",
  }),
  contractId: uuid("contract_id").references(() => subconContracts.id, {
    onDelete: "set null",
  }),
  scope: text("scope"),
  rate: numeric("rate", { precision: 6, scale: 2 }),
  withheld: numeric("withheld", { precision: 16, scale: 2 }),
  returned: numeric("returned", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  dueDate: date("due_date"),
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("retention_ledger_company_idx").on(t.companyId)]);

// ---------------------------------------------------------------------------
// Item 10 — RevRec / WIP — accounting-extra.jsx `REVREC_SEED` / `WIP_SEED`
// ---------------------------------------------------------------------------

/**
 * RevRec — revenue recognition per project (accounting-extra.jsx `REVREC_SEED`:
 * proj, method, contract, pct, recognized, billed, posted). contract / recognized
 * / billed are money -> currency_code; `method` is the recognition method
 * (percent-of-completion, etc.); `posted` marks it posted to GL.
 */
export const revRecs = pgTable("rev_rec", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  method: text("method"),
  contractAmount: numeric("contract_amount", { precision: 16, scale: 2 }),
  pct: numeric("pct", { precision: 6, scale: 2 }),
  recognized: numeric("recognized", { precision: 16, scale: 2 }),
  billed: numeric("billed", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  posted: boolean("posted").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("rev_rec_company_idx").on(t.companyId)]);

/**
 * Wip — work-in-progress cost balance per project (accounting-extra.jsx
 * `WIP_SEED`: proj, mat(material), sub(subcon), oh(overhead), transferred).
 * material / subcon / overhead / transferred are money -> currency_code
 * (transferred = amount moved out of WIP to COGS).
 */
export const wips = pgTable("wip", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  material: numeric("material", { precision: 16, scale: 2 }),
  subcon: numeric("subcon", { precision: 16, scale: 2 }),
  overhead: numeric("overhead", { precision: 16, scale: 2 }),
  transferred: numeric("transferred", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("wip_company_idx").on(t.companyId)]);

// ---------------------------------------------------------------------------
// Item 11 — AR CreditNote — accounting-extra2.jsx `ARCN_SEED`
// ---------------------------------------------------------------------------

/**
 * ArCreditNote — a credit note against an AR invoice (accounting-extra2.jsx
 * `ARCN_SEED`: no, customer, ref, reason, amount, status, date). customer_id ->
 * customer, ref_invoice_id -> ar_invoice (the credited invoice); amount is money
 * -> currency_code.
 */
export const arCreditNotes = pgTable("ar_credit_note", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  no: text("no").notNull(),
  customerId: uuid("customer_id").references(() => customers.id, {
    onDelete: "set null",
  }),
  refInvoiceId: uuid("ref_invoice_id").references(() => arInvoices.id, {
    onDelete: "set null",
  }),
  reason: text("reason"),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull(),
  currencyCode: text("currency_code").notNull().default("THB"),
  status: text("status"),
  noteDate: date("note_date"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("ar_credit_note_company_idx").on(t.companyId)]);

// ---------------------------------------------------------------------------
// Item 12 — BidComparison — real-forms2.jsx `rows` (vendor bid compare)
// ---------------------------------------------------------------------------

/**
 * BidComparison — the header of a vendor bid-comparison sheet tied to a PR
 * (real-forms2.jsx `rows` compares vendor quotes for a purchase). pr_id links the
 * comparison to its purchase requisition; the per-vendor quotes are
 * bid_comparison_line rows.
 */
export const bidComparisons = pgTable("bid_comparison", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  prId: uuid("pr_id").references(() => prs.id, { onDelete: "set null" }),
  title: text("title"),
  decidedAt: date("decided_at"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("bid_comparison_company_idx").on(t.companyId)]);

/**
 * BidComparisonLine — one vendor's quote on a bid comparison (real-forms2.jsx
 * `rows`: v(vendor), p12/p16(unit prices), credit(credit term), ship(shipping),
 * score, best). vendor_id -> vendor; price / shipping are money -> currency_code;
 * `is_best` marks the winning bid.
 */
export const bidComparisonLines = pgTable("bid_comparison_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  bidComparisonId: uuid("bid_comparison_id")
    .notNull()
    .references(() => bidComparisons.id, { onDelete: "cascade" }),
  vendorId: uuid("vendor_id").references(() => vendors.id, {
    onDelete: "set null",
  }),
  price: numeric("price", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  creditTerm: text("credit_term"),
  shipping: numeric("shipping", { precision: 16, scale: 2 }),
  score: numeric("score", { precision: 6, scale: 2 }),
  isBest: boolean("is_best").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

// @juneflow/db — "อื่นๆ" schema group (P0-BE-08).
//
// Source of truth: docs/handoff/data-dictionary.html section "อื่นๆ"
// ("LandPlot · SalesUnit · Document (DMS) · Notification · AuditLog") + erd.html
// "อื่นๆ" band.
//
// Global-readiness hard rules (PLAN.md section 4) applied to every table:
//   - id is a real uuid PK; *_id columns are real uuid FKs (never name-text FKs)
//   - all timestamps stored as UTC (timestamptz)
//   - LAND AREA STORED IN SQUARE METRES (rai-ngan-wa / acre / ha at display only)
//   - money columns carry currency_code
//   - company_id tenant scope on every aggregate root (PLAN.md section 5)
//
// AuditLog matches the shape the audit middleware writes
// (apps/api/src/plugins/audit-log.ts): { user, action, entity, before/after, ip,
// at } for every create / update / approve / void.
//
// Any NEW conflict outside PLAN.md Appendix C -> BLOCKERS.md, never decide
// locally.

import {
  pgTable,
  index,
  uniqueIndex,
  text,
  uuid,
  integer,
  numeric,
  jsonb,
  boolean,
  date,
  timestamp,
} from "drizzle-orm/pg-core";
import { companies, users } from "./platform.js";
import { projects, projectNodes, customers } from "./project.js";

/**
 * LandPlot — a land parcel moving through a 7-step acquisition pipeline
 * (data-dictionary "stage 7 ขั้น pipeline · DD checklist json"; erd.html
 * "project_id, deed_no, area, gps, stage, dd{}, tenure"). area is stored in
 * SQUARE METRES per PLAN.md section 4 (rai-ngan-wa displayed by the client only).
 * price_per_rai is money -> currency_code. stage / tenure not enumerated by the
 * dictionary -> free text; dd_checklist holds the due-diligence checklist JSON.
 */
export const landPlots = pgTable("land_plot", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  deedNo: text("deed_no"),
  areaSqm: numeric("area_sqm", { precision: 18, scale: 4 }),
  gps: text("gps"),
  pricePerRai: numeric("price_per_rai", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  stage: text("stage"),
  tenure: text("tenure"),
  // LA-2 (B-158 Wei=ก): Land Bank registry columns visible in the prototype but not
  // previously modelled — additive nullable (a plot without them renders em-dash).
  title: text("title"),
  tambon: text("tambon"),
  amphoe: text("amphoe"),
  prov: text("prov"),
  owner: text("owner"),
  ddChecklist: jsonb("dd_checklist").$type<unknown>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("land_plot_company_idx").on(t.companyId)]);

/**
 * SalesUnit — the booking->transfer sales lifecycle of a project unit, tying AR
 * to house acceptance (data-dictionary "ผูก AR + ตรวจรับบ้าน (Defect)"; erd.html
 * "unit_id, customer_id, stage, booking, contract, down[], loan"). unit_id ->
 * project_node (the sold unit); customer_id -> customer. booking / contract /
 * loan are money -> currency_code (contract is the contract-signing milestone
 * payment — numeric money like booking/down/loan per PLAN.md Appendix C decision
 * B-013(ก), not a document reference). down[] is the down-payment installment
 * schedule JSON. transfer_at records the ownership-transfer date. stage not
 * enumerated -> free text.
 */
export const salesUnits = pgTable("sales_unit", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  unitId: uuid("unit_id").references(() => projectNodes.id, {
    onDelete: "set null",
  }),
  customerId: uuid("customer_id").references(() => customers.id, {
    onDelete: "set null",
  }),
  stage: text("stage"),
  booking: numeric("booking", { precision: 16, scale: 2 }),
  contract: numeric("contract", { precision: 16, scale: 2 }),
  loan: numeric("loan", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  down: jsonb("down").$type<unknown[]>().notNull().default([]),
  transferAt: date("transfer_at"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("sales_unit_company_idx").on(t.companyId)]);

/**
 * Document (DMS) — a file every module auto-attaches, with a 60-day expiry
 * warning (data-dictionary "ทุกโมดูลแนบไฟล์เข้า DMS อัตโนมัติ · เตือนหมดอายุ 60
 * วัน"; erd.html "cat, project_id, version, expiry, link_module"). link_module is
 * the polymorphic "module:uuid" back-reference to the owning record. Actual bytes
 * live in R2 via POST /files (PLAN.md section 5); url is the stored object ref.
 *
 * B-221 (Solar-tail · Wei=ก, dms.jsx DMS list): the DMS list surfaces four more
 * per-file columns — all additive/nullable (a legacy row without them renders
 * em-dash). `name` is the display filename; `by_user_id` is a REAL FK to the
 * uploader (never a name-text — PLAN.md §4), set-null so purging a user keeps the
 * file; `size` is the display byte-string ("2.4 MB", not a numeric byte count —
 * the mock shows the formatted value); `status` is the free-text lifecycle code
 * (active | review | expiring — text, no enum).
 */
export const documents = pgTable("document", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  cat: text("cat"),
  version: integer("version").notNull().default(1),
  expiry: date("expiry"),
  linkModule: text("link_module"),
  url: text("url"),
  // B-221: DMS list columns (additive, nullable).
  name: text("name"),
  byUserId: uuid("by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  size: text("size"),
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("document_company_idx").on(t.companyId)]);

/**
 * Notification — a notification-center entry, also fanned to Mobile + LINE
 * (data-dictionary "ศูนย์แจ้งเตือน + Mobile + LINE"; erd.html "user_id, type,
 * ref, read"). ref is a polymorphic "module:uuid" deep link to the referenced
 * record. read defaults false.
 */
export const notifications = pgTable("notification", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  ref: text("ref"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("notification_company_idx").on(t.companyId)]);

/**
 * AuditLog — an immutable record of every mutation, written by the audit
 * middleware (data-dictionary "ทุก create/update/approve/void"; erd.html "user,
 * action, entity, before/after"). Shape mirrors apps/api/src/plugins/audit-log.ts:
 * acting user_id, action, entity ("table:uuid"), before/after JSON snapshots, ip,
 * and `at` (the UTC event time — distinct from created_at row insert time). Rows
 * are append-only; user_id set-null so purging a user does not erase the trail.
 */
export const auditLogs = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  before: jsonb("before").$type<unknown>(),
  after: jsonb("after").$type<unknown>(),
  ip: text("ip"),
  at: timestamp("at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("audit_log_company_idx").on(t.companyId)]);

/**
 * LoanApplication — a mortgage application for a sold unit (SA-6 · B-157 Wei=ก;
 * sales.jsx SalesLoan: bank / ask / approved / term / submit + result dates /
 * 5-state status). The prototype's single sales_unit.loan numeric could not carry
 * this — it is its own record. money columns carry currency_code (server-owned);
 * ask/approved are RECORDED as supplied (SA-6 is a recorded application, not a GL
 * posting — no money=SERVER recompute). company-scoped (company_id root).
 */
export const loanApplications = pgTable("loan_application", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  salesUnitId: uuid("sales_unit_id").references(() => salesUnits.id, {
    onDelete: "set null",
  }),
  bank: text("bank"),
  askAmt: numeric("ask_amt", { precision: 16, scale: 2 }),
  approvedAmt: numeric("approved_amt", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  term: integer("term"), // loan term in years
  submitDate: date("submit_date"),
  resultDate: date("result_date"),
  // 5-state (sales.jsx): submitted | approved | partial | rejected | transfer
  status: text("status").notNull().default("submitted"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("loan_application_company_idx").on(t.companyId)]);

/**
 * DownPaymentTxn — one installment of a unit's down-payment schedule (SA-5 · B-158
 * Wei=ก; sales-process.jsx SalesDown: seq · due · amount · paid_at · RV-per-งวด ·
 * done/total derive). Supersedes the sales_unit.down jsonb array. CREATED here in
 * 0042 but WIRED in batch-2 (per B-161 rec — batch-1 createSalesDown posts the
 * simple receipt); rv_id is a soft uuid ref to finance.rv (no cross-schema FK, per
 * the issue_line.cc_id precedent). company-scoped; money col carries currency_code.
 */
export const downPaymentTxns = pgTable("down_payment_txn", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  salesUnitId: uuid("sales_unit_id")
    .notNull()
    .references(() => salesUnits.id, { onDelete: "cascade" }),
  seq: integer("seq"),
  dueDate: date("due_date"),
  amount: numeric("amount", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  paidAt: date("paid_at"),
  rvId: uuid("rv_id"), // soft ref → finance.rv.id (no cross-schema FK)
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("down_payment_txn_company_idx").on(t.companyId),
  index("down_payment_txn_unit_idx").on(t.salesUnitId),
  // B-165: dedup guard for concurrent down instalments — two concurrent first-downs
  // both compute seq = in-tx count + 1 (uncommitted rows invisible under READ
  // COMMITTED → both see the same count → same seq) and collide here → 23505 → 409.
  uniqueIndex("down_payment_txn_unit_seq_uq").on(t.salesUnitId, t.seq),
]);

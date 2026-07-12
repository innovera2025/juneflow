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
  ddChecklist: jsonb("dd_checklist").$type<unknown>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

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
});

/**
 * Document (DMS) — a file every module auto-attaches, with a 60-day expiry
 * warning (data-dictionary "ทุกโมดูลแนบไฟล์เข้า DMS อัตโนมัติ · เตือนหมดอายุ 60
 * วัน"; erd.html "cat, project_id, version, expiry, link_module"). link_module is
 * the polymorphic "module:uuid" back-reference to the owning record. Actual bytes
 * live in R2 via POST /files (PLAN.md section 5); url is the stored object ref.
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
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

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
});

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
});

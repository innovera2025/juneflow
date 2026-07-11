// @juneflow/db — PM / CMMS schema group (P0-BE-07).
//
// Source of truth: docs/handoff/data-dictionary.html section "PM (CMMS)"
// (+ erd.html "PM · บำรุงรักษา (CMMS)" band). Entities: PMContract, PMAsset,
// PMWorkOrder, ChecklistTemplate.
//
// Structure: Project -> N PMContract -> N PMAsset; a maintenance plan auto-gens
// PMWorkOrder rows whose checklist rows come from a ChecklistTemplate picked at
// creation time (data-dictionary).
//
// PMQuote (spare-parts quote -> customer LINE approval) appears only in erd.html,
// not in the data-dictionary base schema nor PLAN.md Appendix B, so it is left
// out of this base group (recorded in the backend journal, not a conflict).
//
// Global-readiness hard rules (PLAN.md section 4): real uuid FKs, UTC
// timestamps, money columns carry currency_code. Company scope flows through
// project_id; the central ChecklistTemplate carries company_id. Any NEW conflict
// outside PLAN.md Appendix C -> BLOCKERS.md.

import {
  pgEnum,
  pgTable,
  text,
  uuid,
  integer,
  numeric,
  jsonb,
  date,
  timestamp,
} from "drizzle-orm/pg-core";
import { companies } from "./platform.js";
import { projects, customers } from "./project.js";

// ---------------------------------------------------------------------------
// Shared JSON shapes
// ---------------------------------------------------------------------------

/**
 * PMWorkOrder.items — checklist rows filled in on the job (data-dictionary
 * "items[{label,result,before,after}]"). result: normal | adjust | repair;
 * before/after are photo references.
 */
export interface PmChecklistRow {
  label: string;
  result?: "normal" | "adjust" | "repair";
  before?: string;
  after?: string;
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * PMContract.mode — data-dictionary: "mode: MA เงื่อนไข | per-visit (หารครั้งลง
 * ปฏิทิน)". per_visit spreads the value across scheduled visits on the calendar.
 */
export const pmContractMode = pgEnum("pm_contract_mode", ["MA", "per_visit"]);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * PMContract — a preventive-maintenance contract for a project + customer
 * (data-dictionary "PMContract.mode,visits_per_year,sla,value,end"). value is
 * money -> currency_code; end is the contract end date.
 */
export const pmContracts = pgTable("pm_contract", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => customers.id, {
    onDelete: "set null",
  }),
  mode: pmContractMode("mode").notNull(),
  visitsPerYear: integer("visits_per_year"),
  sla: text("sla"),
  value: numeric("value", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  end: date("end"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * PMAsset — a maintained asset under a PM contract, type-aware
 * (data-dictionary "PMAsset.kind,site,cycle,next_due"; kind e.g. lift /
 * inverter / crane). next_due is the next service due date.
 */
export const pmAssets = pgTable("pm_asset", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id")
    .notNull()
    .references(() => pmContracts.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  site: text("site"),
  cycle: text("cycle"),
  nextDue: date("next_due"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * ChecklistTemplate — central config, picked when a PMWorkOrder is created
 * (data-dictionary "ChecklistTemplate.kind,items[]"). Company-scoped master.
 */
export const checklistTemplates = pgTable("checklist_template", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  items: jsonb("items").$type<PmChecklistRow[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * PMWorkOrder — a maintenance job on an asset: tech check-in (GPS), a filled
 * checklist, cause/fix/advice, and the customer's signature. Closing it emits a
 * certificate to LINE (data-dictionary "ปิดงาน -> ใบรับรอง -> LINE"). The
 * checklist template used is captured via template_id.
 */
export const pmWorkOrders = pgTable("pm_workorder", {
  id: uuid("id").primaryKey().defaultRandom(),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => pmAssets.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").references(() => checklistTemplates.id, {
    onDelete: "set null",
  }),
  tech: text("tech"),
  checkinGps: text("checkin_gps"),
  items: jsonb("items").$type<PmChecklistRow[]>().notNull().default([]),
  cause: text("cause"),
  fix: text("fix"),
  advice: text("advice"),
  customerSign: text("customer_sign"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

// @juneflow/db — Subcon / Acceptance schema group (P0-BE-07).
//
// Source of truth: docs/handoff/data-dictionary.html section "ผู้รับเหมา /
// ตรวจรับ" (+ erd.html "ผู้รับเหมา & ตรวจรับ" band). Entities: SubconContract,
// WorkPeriod, Acceptance, Defect.
//
// Structure: Vendor(subcon) -> N SubconContract -> N WorkPeriod -> 1 Acceptance
// -> N Defect (data-dictionary).
//
// Conflict decisions applied (PLAN.md Appendix C):
//   - C2: WorkPeriod.basis has a 4th value `unit` (per-house lump sum) on top of
//         percent | distance(m) | milestone — code is the latest truth.
//   - C3: WorkPeriod.status follows the flows.html / dictionary state machine
//         (pending | delivered | inspecting | passed | rejected | paid); the
//         prototype mock values are mapped to these at seed time (P0-BE-10).
//
// Global-readiness hard rules (PLAN.md section 4): real uuid FKs, UTC
// timestamps, money columns carry currency_code. Company scope flows through
// project_id / vendor_id. Any NEW conflict outside Appendix C -> BLOCKERS.md.

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
import { projects, vendors } from "./project.js";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * WorkPeriod.basis — measurement basis for a work period. Decision C2 adds the
 * 4th value `unit` (per-house lump sum) to the dictionary's
 * percent | distance | milestone. `distance` is the dictionary's "distance(m)".
 */
export const workPeriodBasis = pgEnum("work_period_basis", [
  "percent",
  "distance",
  "milestone",
  "unit",
]);

/**
 * WorkPeriod.status — decision C3: the flows.html / dictionary state machine
 * (NOT the prototype mock values, which are mapped in at seed). Order:
 * pending -> delivered -> inspecting -> passed | rejected -> paid.
 */
export const workPeriodStatus = pgEnum("work_period_status", [
  "pending",
  "delivered",
  "inspecting",
  "passed",
  "rejected",
  "paid",
]);

/**
 * Defect.status — data-dictionary: "open -> fixing -> recheck -> closed".
 */
export const defectStatus = pgEnum("defect_status", [
  "open",
  "fixing",
  "recheck",
  "closed",
]);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * SubconContract — a subcontract with a subcon vendor for a project
 * (data-dictionary "Contract.no,value,retention_pct,start,end"). value is money
 * -> currency_code; retention_pct is the retention percentage held back.
 */
export const subconContracts = pgTable("subcon_contract", {
  id: uuid("id").primaryKey().defaultRandom(),
  vendorId: uuid("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "restrict" }),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  no: text("no").notNull(),
  value: numeric("value", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  retentionPct: numeric("retention_pct", { precision: 6, scale: 3 })
    .notNull()
    .default("0"),
  start: date("start"),
  end: date("end"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * WorkPeriod — a payment/progress period of a subcontract (งวดงาน).
 * data-dictionary: seq, basis, target, pct, amount, status. basis per C2,
 * status per C3 (see enums above). amount is money -> currency_code; target is
 * the basis-dependent target value (percent / metres / units); pct is percent
 * complete.
 */
export const workPeriods = pgTable("work_period", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id")
    .notNull()
    .references(() => subconContracts.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull().default(0),
  basis: workPeriodBasis("basis").notNull(),
  target: numeric("target", { precision: 18, scale: 4 }).notNull().default("0"),
  pct: numeric("pct", { precision: 6, scale: 3 }).notNull().default("0"),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  status: workPeriodStatus("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * Acceptance — a foreman's on-site inspection of a work period (via mobile)
 * (data-dictionary "Acceptance.inspector,photos[],docs[],signed_at"). One
 * acceptance per work period. signed_at is a UTC timestamp (null until signed).
 */
export const acceptances = pgTable("acceptance", {
  id: uuid("id").primaryKey().defaultRandom(),
  periodId: uuid("period_id")
    .notNull()
    .references(() => workPeriods.id, { onDelete: "cascade" }),
  inspector: text("inspector"),
  photos: jsonb("photos").$type<string[]>().notNull().default([]),
  docs: jsonb("docs").$type<string[]>().notNull().default([]),
  signedAt: timestamp("signed_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * Defect — a defect raised during an Acceptance (data-dictionary
 * "Defect.item,severity,before/after_photo,due,status"). status per enum above.
 */
export const defects = pgTable("defect", {
  id: uuid("id").primaryKey().defaultRandom(),
  acceptanceId: uuid("acceptance_id")
    .notNull()
    .references(() => acceptances.id, { onDelete: "cascade" }),
  item: text("item").notNull(),
  severity: text("severity"),
  beforePhoto: text("before_photo"),
  afterPhoto: text("after_photo"),
  due: date("due"),
  status: defectStatus("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

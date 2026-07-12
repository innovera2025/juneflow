// @juneflow/db — BOQ / Procurement schema group (P0-BE-07).
//
// Source of truth: docs/handoff/data-dictionary.html section "BOQ / จัดซื้อ"
// (+ erd.html "BOQ & จัดซื้อ" band). Entities: BOM (template), BOQDoc,
// BOQGroup, BOQItem, CBSBudget, PR + PRItem, PO, WO, VariationOrder, GR,
// DefectReport.
//
// Structure: Project -> N BOQDoc -> N BOQGroup -> N BOQItem (data-dictionary
// "BOQDoc -> N Group -> N Item"). CBSBudget is a per-group budget-control row
// (data-dictionary CBSBudget.group_id). PR (from BOQ) -> PO(material) /
// WO(subcon); PO -> GR; GR rejection -> DefectReport.
//
// Global-readiness hard rules (PLAN.md section 4): real uuid FKs, UTC
// timestamps, every money column carries currency_code. Company scope flows
// through project_id on documents; masters (BOM) carry company_id directly.
// Any NEW conflict outside PLAN.md Appendix C -> BLOCKERS.md.

import {
  pgEnum,
  pgTable,
  index,
  text,
  uuid,
  integer,
  numeric,
  jsonb,
  date,
  timestamp,
} from "drizzle-orm/pg-core";
import { companies } from "./platform.js";
import { projects, costCenters, vendors } from "./project.js";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * BOQDoc.status — data-dictionary: "draft | pending | approved(ล็อก) | revise"
 * (approved locks the doc; revise spins a new version of the whole doc).
 */
export const boqDocStatus = pgEnum("boq_doc_status", [
  "draft",
  "pending",
  "approved",
  "revise",
]);

/**
 * BOQItem.cat — data-dictionary: "cat: M วัสดุ | L ค่าแรง | S เหมา"
 * (M = material, L = labor, S = lump-sum).
 */
export const boqItemCat = pgEnum("boq_item_cat", ["M", "L", "S"]);

/**
 * PR.type — data-dictionary: "type: material | subcon | expense | advance".
 */
export const prType = pgEnum("pr_type", [
  "material",
  "subcon",
  "expense",
  "advance",
]);

/**
 * VariationOrder.dir — data-dictionary: "VariationOrder (dir add|cut, ...)".
 */
export const variationDir = pgEnum("variation_dir", ["add", "cut"]);

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * BOM — a per-unit-type material template (erd.html "BOM Template สูตรต่อหลัง":
 * unit_type, items[]). A BOQItem can be seeded from a BOM template
 * (data-dictionary "Item <- BOM template ได้"). Company-scoped master.
 * items is the template line list kept as JSON (no migration per line change).
 */
export const boms = pgTable("bom", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  unitType: text("unit_type").notNull(),
  items: jsonb("items").$type<unknown[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("bom_company_idx").on(t.companyId)]);

/**
 * BOQDoc — a bill of quantities document for a project. Revise = new version of
 * the whole doc (data-dictionary "Revise = เวอร์ชันใหม่ทั้ง doc"). approved
 * locks it.
 */
export const boqDocs = pgTable("boq_doc", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  no: text("no").notNull(),
  name: text("name").notNull(),
  scope: text("scope"),
  version: integer("version").notNull().default(1),
  status: boqDocStatus("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * BOQGroup — a heading / cost category inside a BOQDoc (data-dictionary
 * "BOQDoc -> N Group -> N Item"). CBS budget control attaches per group.
 */
export const boqGroups = pgTable("boq_group", {
  id: uuid("id").primaryKey().defaultRandom(),
  boqId: uuid("boq_id")
    .notNull()
    .references(() => boqDocs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  seq: integer("seq").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * BOQItem — a priced line inside a BOQGroup. remain_qty is cut when a PR opens
 * against the item (data-dictionary "remain_qty ตัดเมื่อเปิด PR"). element_id is
 * a forward reference to a CAD/BIM element registry for AI-QTO traceability
 * (data-dictionary marks it "fk?"; the element registry is deferred — PLAN.md
 * section 12 — so this stays an unconstrained uuid for now, never a name-text
 * FK). price is money -> currency_code.
 */
export const boqItems = pgTable("boq_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => boqGroups.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  cat: boqItemCat("cat").notNull(),
  qty: numeric("qty", { precision: 18, scale: 4 }).notNull().default("0"),
  unit: text("unit"),
  price: numeric("price", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  ccId: uuid("cc_id").references(() => costCenters.id, { onDelete: "set null" }),
  remainQty: numeric("remain_qty", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  elementId: uuid("element_id"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * CBSBudget — budget control per BOQGroup + over-budget warning
 * (data-dictionary "CBSBudget.group_id,budget,used,committed"). All three are
 * money -> currency_code.
 */
export const cbsBudgets = pgTable("cbs_budget", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id")
    .notNull()
    .references(() => boqGroups.id, { onDelete: "cascade" }),
  budget: numeric("budget", { precision: 16, scale: 2 }).notNull().default("0"),
  used: numeric("used", { precision: 16, scale: 2 }).notNull().default("0"),
  committed: numeric("committed", { precision: 16, scale: 2 })
    .notNull()
    .default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * PR — purchase requisition against a project, with N lines pulled from BOQ
 * items (data-dictionary "PR -> N รายการ (จาก BOQ)"). approval_step tracks the
 * approval matrix position (status values are not enumerated by the dictionary
 * -> free text).
 */
export const prs = pgTable("pr", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  no: text("no").notNull(),
  type: prType("type").notNull(),
  needDate: date("need_date"),
  status: text("status").notNull().default("draft"),
  approvalStep: integer("approval_step").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * PRItem — a PR line referencing the source BOQItem (erd.html "PR + Items ->
 * boq_item_id (n)"). boq_item_id is nullable for non-BOQ (expense/advance) lines.
 */
export const prItems = pgTable("pr_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  prId: uuid("pr_id")
    .notNull()
    .references(() => prs.id, { onDelete: "cascade" }),
  boqItemId: uuid("boq_item_id").references(() => boqItems.id, {
    onDelete: "set null",
  }),
  qty: numeric("qty", { precision: 18, scale: 4 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * PO — a material purchase order raised from an approved PR
 * (data-dictionary "PR อนุมัติ -> PO(วัสดุ)"). total/vat are money ->
 * currency_code; credit_term in days.
 */
export const pos = pgTable("po", {
  id: uuid("id").primaryKey().defaultRandom(),
  prId: uuid("pr_id").references(() => prs.id, { onDelete: "set null" }),
  vendorId: uuid("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "restrict" }),
  total: numeric("total", { precision: 16, scale: 2 }).notNull().default("0"),
  vat: numeric("vat", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  creditTerm: integer("credit_term"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * WO — a subcon work order, the PO counterpart raised for subcon work
 * (data-dictionary "WO(เหมา)"). value is money -> currency_code. Subcon delivery
 * itself is tracked via SubconContract -> WorkPeriod (see subcon.ts).
 */
export const wos = pgTable("wo", {
  id: uuid("id").primaryKey().defaultRandom(),
  prId: uuid("pr_id").references(() => prs.id, { onDelete: "set null" }),
  vendorId: uuid("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "restrict" }),
  value: numeric("value", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * VariationOrder — an add/cut amendment attached to a PO
 * (data-dictionary "+ VariationOrder (dir add|cut, amount, reason)"). amount is
 * money -> currency_code.
 */
export const variationOrders = pgTable("variation_order", {
  id: uuid("id").primaryKey().defaultRandom(),
  poId: uuid("po_id")
    .notNull()
    .references(() => pos.id, { onDelete: "cascade" }),
  dir: variationDir("dir").notNull(),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * GR — goods receipt against a PO: received / rejected quantities + photos.
 * A rejection generates a DefectReport and notifies the vendor
 * (data-dictionary "ตีกลับ -> DefectReport + แจ้งผู้ขาย").
 */
export const grs = pgTable("gr", {
  id: uuid("id").primaryKey().defaultRandom(),
  poId: uuid("po_id")
    .notNull()
    .references(() => pos.id, { onDelete: "cascade" }),
  received: numeric("received", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  rejected: numeric("rejected", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  photos: jsonb("photos").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * DefectReport — generated from a GR rejection (data-dictionary). Distinct from
 * the subcon Acceptance Defect (see subcon.ts).
 */
export const defectReports = pgTable("defect_report", {
  id: uuid("id").primaryKey().defaultRandom(),
  grId: uuid("gr_id")
    .notNull()
    .references(() => grs.id, { onDelete: "cascade" }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

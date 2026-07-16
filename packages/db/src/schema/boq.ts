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
// WO(subcon); PO -> GR (or WO -> GR, B-070 GR-from-WO); GR rejection ->
// DefectReport.
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
import { companies, users } from "./platform.js";
import { projects, costCenters, vendors } from "./project.js";
import { subconContracts } from "./subcon.js";

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
  // B-081 (F4, migration 0021): the archive approver + approval timestamp. The
  // audit_log cannot source these (its `entity` is a route template with no
  // resolved id — recon), so the approve handler writes them directly here.
  // Nullable — only set once a doc is approved. approvedBy -> users.
  approvedBy: uuid("approved_by").references(() => users.id, {
    onDelete: "set null",
  }),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * BOQVersionHistory — the Revise history of a BOQDoc (B-081 / F4, migration
 * 0021). boq.jsx ARCHIVE[].history[] shows each version's approve/revise event
 * with who did it, when, the value delta, and a note. This table persists that
 * log so the archive screen's Revise-history expander + version-diff read from
 * real rows. `delta` is stored as text (the mock's signed value string). `by` ->
 * users (nullable — a system-generated entry has no user).
 */
export const boqVersionHistory = pgTable("boq_version_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  docId: uuid("doc_id")
    .notNull()
    .references(() => boqDocs.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(0),
  action: text("action"),
  by: uuid("by").references(() => users.id, { onDelete: "set null" }),
  at: timestamp("at", { withTimezone: true, mode: "date" }),
  delta: text("delta"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
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
  // Gap-5 (migration 0023): the boq.editor line-detail note (boq.jsx
  // INITIAL_ROWS_BY_GROUP[].detail — e.g. "ขนาด 50 kg/ถุง · ตามมอก. 15-2562").
  // Nullable free text; the editor shows it under the item name.
  detail: text("detail"),
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
  // Gap-2 (migration 0022): pr-list.jsx display fields that were genuinely absent
  // from the schema (the list row shows title/vendor/requester/phase + submit/
  // approve timestamps). vendor_id -> vendor, requester_id -> users (both
  // nullable — expense/advance PRs carry no vendor, and a mock requester with no
  // seeded user stays null). submitted_at/approved_at are null until the PR
  // reaches that state.
  title: text("title"),
  vendorId: uuid("vendor_id").references(() => vendors.id, {
    onDelete: "set null",
  }),
  requesterId: uuid("requester_id").references(() => users.id, {
    onDelete: "set null",
  }),
  phase: text("phase"),
  submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" }),
  approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
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
 *
 * `no` (document number), `status`, and `approval_step` were added (P2-BE-05,
 * B-070, migration 0015) to give PO the same submit->approve->reject state
 * machine + tiered-approval matrix as PR (flows.html FLOW-A / MATRIX). They
 * mirror the pr columns exactly: status defaults to `draft`, approval_step to 0.
 */
export const pos = pgTable("po", {
  id: uuid("id").primaryKey().defaultRandom(),
  prId: uuid("pr_id").references(() => prs.id, { onDelete: "set null" }),
  vendorId: uuid("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "restrict" }),
  no: text("no"),
  total: numeric("total", { precision: 16, scale: 2 }).notNull().default("0"),
  vat: numeric("vat", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  creditTerm: integer("credit_term"),
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
 * WO — a subcon work order, the PO counterpart raised for subcon work
 * (data-dictionary "WO(เหมา)"). value is money -> currency_code. Subcon delivery
 * itself (งวดงาน / installments) is tracked via SubconContract -> WorkPeriod
 * (see subcon.ts) — the WO row carries no per-installment breakdown.
 *
 * `no`, `status`, `approval_step` were added (P2-BE-05, B-070, migration 0015)
 * for the same state machine + tiered approval as PO/PR. `retention_pct` (mirror
 * of subcon_contract.retention_pct) was added so the WO can carry its own
 * retention hold-back rate (po-wo.jsx WOForm "Retention %" input); the retained
 * amount is derived at read time as value * retention_pct / 100.
 */
export const wos = pgTable("wo", {
  id: uuid("id").primaryKey().defaultRandom(),
  prId: uuid("pr_id").references(() => prs.id, { onDelete: "set null" }),
  vendorId: uuid("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "restrict" }),
  // B-080 (F3, migration 0020): link a WO to its subcon contract so the WO reuses
  // the existing SubconContract -> WorkPeriod installment model (subcon.ts)
  // instead of duplicating a per-installment table. Nullable — a WO without a
  // matching contract (no shared subcon vendor) leaves it null.
  contractId: uuid("contract_id").references(() => subconContracts.id, {
    onDelete: "set null",
  }),
  no: text("no"),
  value: numeric("value", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  retentionPct: numeric("retention_pct", { precision: 6, scale: 3 })
    .notNull()
    .default("0"),
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
 * GR — goods receipt against a PO (material) OR a WO (subcon work; B-070
 * GR-from-WO): received / rejected quantities + photos. A rejection generates a
 * DefectReport and notifies the vendor (data-dictionary "ตีกลับ -> DefectReport
 * + แจ้งผู้ขาย"). gr.jsx "รับจาก PO" + "รับงาน WO" tabs.
 *
 * `wo_id` / `no` / `status` were added (P2-BE-06, B-070, migration 0016) and
 * `po_id` was made NULLABLE so a receipt can anchor on EITHER a PO or a WO
 * (exactly one is set):
 *   - `wo_id`  — nullable FK to wo; set (with po_id NULL) for a WO receipt.
 *   - `no`     — document number (gr.jsx "GR เลขที่", e.g. GR-2026-0148);
 *                client-supplied like po/wo `no`, nullable.
 *   - `status` — the return/cancel lifecycle: `received` (default, recorded) ->
 *                `returned` | `cancelled`. There is NO GR approval endpoint in
 *                the contract, so the prototype's "approved" badge maps to the
 *                recorded `received` state.
 *
 * received / rejected are the AGGREGATE of the createGr body's lines
 * (Σ qty_ok / Σ qty_rejected): the gr table has no per-line child table, so a
 * multi-line receipt collapses to one gr row (GAP flagged in gr.ts; mirrors the
 * po-has-no-line-table shape). photos flattens every line's photos[].
 */
export const grs = pgTable("gr", {
  id: uuid("id").primaryKey().defaultRandom(),
  poId: uuid("po_id").references(() => pos.id, { onDelete: "cascade" }),
  woId: uuid("wo_id").references(() => wos.id, { onDelete: "cascade" }),
  no: text("no"),
  received: numeric("received", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  rejected: numeric("rejected", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  photos: jsonb("photos").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("received"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

/**
 * GRItem — a per-line detail row of a GR (B-078 / F1, migration 0018). The `gr`
 * table keeps only the aggregate received/rejected total; the prototype detail
 * panel (gr.jsx "รายการที่รับ") shows each received line with its
 * ordered/received quantity + unit. This child table captures that per-line
 * fidelity so a GR detail view renders real line rows instead of an aggregate.
 *
 * `boq_item_id` links a received line back to the source BOQ item where the line
 * name resolves to a seeded item (nullable — free-text / non-BOQ receipts leave
 * it null). `price` is money -> currency_code (the line's unit price; derived
 * from the linked boq_item at seed time — the prototype detail array carries no
 * per-line price of its own).
 */
export const grItems = pgTable("gr_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  grId: uuid("gr_id")
    .notNull()
    .references(() => grs.id, { onDelete: "cascade" }),
  boqItemId: uuid("boq_item_id").references(() => boqItems.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  orderedQty: numeric("ordered_qty", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  receivedQty: numeric("received_qty", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  unit: text("unit"),
  price: numeric("price", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
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

// @juneflow/db — Finance / Accounting schema group (P0-BE-08).
//
// Source of truth: docs/handoff/data-dictionary.html section "การเงิน-บัญชี"
// ("AP/AR · GL · Bank · FA · e-Tax") + erd.html "การเงิน / บัญชี" band.
// Entities: GLAccount (COA tree), AccountingPeriod (period lock), APBilling, PV,
// ARInvoice, RV, JV + JVLine, Cheque, BankStatement, Reconcile, FixedAsset,
// Worker, Attendance, Payroll, OpexBudget.
//
// Dictionary relationship note: "ทุกเอกสารเงิน → GLPosting → JV (double entry)".
// GLPosting is the posting *process* that emits a JV from a source money doc; we
// model it as JV.source_doc (a polymorphic "table:uuid" ref) rather than a
// separate table — the JV with its balanced JVLine rows IS the GL posting.
//
// Global-readiness hard rules (PLAN.md section 4) applied to every table:
//   - id is a real uuid PK; *_id columns are real uuid FKs (never name-text FKs,
//     a prototype mock mechanism — PLAN.md section 0 rule 3)
//   - all timestamps stored as UTC (timestamptz)
//   - every money column carries a currency_code
//   - company_id tenant scope on document aggregate roots + masters (PLAN.md
//     section 5); child rows (JVLine) scope through their parent FK
//
// Decisions applied (PLAN.md Appendix C):
//   - C4: ARInvoice.etax_status superset queued -> sent | rejected + void
//   - C9: JV.lines[{account_id,dr,cr,cc_id,project_id}] modeled as real JVLine
//     rows (not JSON) so double-entry DR=CR is countable/enforceable; seed emits
//     balanced lines (P0-QA-06).
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
  boolean,
  date,
  timestamp,
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { companies } from "./platform.js";
import { projects, costCenters, vendors, customers } from "./project.js";
import { pos, grs, wos } from "./boq.js";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * ARInvoice.etax_status — decision C4: the dictionary lists
 * "queued | sent | rejected"; the pototype mock uses "sent | pending | error |
 * void". Wei's ruling is the SUPERSET: queued -> sent | rejected + void (UI stays
 * per pototype). Stored value drives the e-Tax queue state machine.
 */
export const etaxStatus = pgEnum("etax_status", [
  "queued",
  "sent",
  "rejected",
  "void",
]);

/**
 * APBilling.kind — B-079 (F2, migration 0019): the billing installment type that
 * lets the PO paid-vs-deposit split be computed from real AP data. po-wo.jsx
 * models a PO payment as มัดจำ (down payment) -> งวด 1 (progress) -> งวดสุดท้าย
 * (final): `deposit` is the down-payment billing, `progress` an interim
 * receipt-linked billing, `final` the closing billing. A screen then aggregates
 * deposit = Σ(kind=deposit) and paid = Σ(all), both real. Defaults to the most
 * common `progress`.
 */
export const apBillingKind = pgEnum("ap_billing_kind", [
  "deposit",
  "progress",
  "final",
]);

/**
 * PV.method — the payment-voucher settlement method (B-089 / F-AP1 · migration
 * 0026). ap.jsx PVCreateForm:252-257 offers a fixed 4-way method whose stable
 * codes are already English in the mock: cash (เงินสด) | transfer (โอนเงิน) |
 * cheque (เช็ค) | deposit (หักมัดจำ, deposit off-set). Only the stable code is
 * stored; the Thai label is an i18n display concern (mirrors `department`). The
 * column is nullable — a draft PV may not have chosen a method yet.
 */
export const pvMethod = pgEnum("pv_method", [
  "cash",
  "transfer",
  "cheque",
  "deposit",
]);

// ---------------------------------------------------------------------------
// GL / period
// ---------------------------------------------------------------------------

/**
 * GLAccount — chart of accounts, a self-referential tree per company
 * (data-dictionary "GLAccount (COA) tree: ผังบัญชีมาตรฐาน + map ต่อชนิดเอกสาร";
 * erd.html "code, name, parent_id"). `code` is unique within a company. COA_SEED
 * (23 accounts) is a starting point pending accountant validation (PLAN.md §11
 * Open Q #3) — schema only here.
 */
export const glAccounts = pgTable(
  "gl_account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => glAccounts.id, {
      onDelete: "set null",
    }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("gl_account_company_code_uq").on(t.companyId, t.code)],
);

/**
 * AccountingPeriod — a fiscal period that can be locked to stop back-posting
 * (data-dictionary "ปิดงวดล็อก"; JV/BankStatement carry period(lock)). `period`
 * is a YYYY-MM key, unique per company. Reconcile / period close set locked.
 */
export const accountingPeriods = pgTable(
  "accounting_period",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    locked: boolean("locked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("accounting_period_company_period_uq").on(t.companyId, t.period)],
);

// ---------------------------------------------------------------------------
// AP (payables)
// ---------------------------------------------------------------------------

/**
 * APBilling — accounts-payable billing with 3-way match against PO + GR + vendor
 * invoice (data-dictionary "3-way match (po,gr,inv)"; erd.html "po_id, gr_id,
 * invoice_no, due"). po_id / gr_id are nullable (non-PO expenses). amount/vat are
 * money -> currency_code. status not enumerated by the dictionary -> free text.
 */
export const apBillings = pgTable("ap_billing", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  poId: uuid("po_id").references(() => pos.id, { onDelete: "set null" }),
  grId: uuid("gr_id").references(() => grs.id, { onDelete: "set null" }),
  vendorId: uuid("vendor_id").references(() => vendors.id, {
    onDelete: "restrict",
  }),
  invoiceNo: text("invoice_no"),
  dueDate: date("due_date"),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  vat: numeric("vat", { precision: 16, scale: 2 }).notNull().default("0"),
  // B-089 (F-AP1, migration 0026): the withholding-tax amount deducted at billing
  // (ap.jsx AP_BILL `wht`, computed via @juneflow/tax-engine.calcWht). Money —
  // shares the row's currency_code. Nullable: a billing with no WHT leaves it null.
  wht: numeric("wht", { precision: 16, scale: 2 }),
  // B-089 (F-AP1, migration 0026): the retention hold-back on a subcon (WO)
  // billing (ap.jsx AP_BILL `retention`, only present on the WO-billed row).
  // Money — shares the row's currency_code. Nullable: no retention -> null.
  retention: numeric("retention", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  status: text("status").notNull().default("draft"),
  // B-079 (F2): billing installment type (deposit | progress | final). Defaults
  // to the most common `progress`; re-seeded per row from the PO payment state.
  kind: apBillingKind("kind").notNull().default("progress"),
  // B-089 (F-AP1, migration 0026): a subcon billing raised against a Work Order
  // (ap.jsx AP-2026-0180 ref "WO-2026-0117 งวด 3") rather than a PO/GR. Nullable —
  // set only on WO-based billings; PO/GR billings leave it null (and vice-versa).
  woId: uuid("wo_id").references(() => wos.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("ap_billing_company_idx").on(t.companyId),
  // 0024 (task + perf-audit §1.4): the 3-way match joins ap_billing back to its
  // PO and GR — index both FK columns (nullable for non-PO expenses).
  index("ap_billing_po_idx").on(t.poId),
  index("ap_billing_gr_idx").on(t.grId),
  // 0026 (B-089/F-AP1): WO-based subcon billings join back to their Work Order —
  // index the nullable wo_id FK, mirroring the po/gr FK-index precedent.
  index("ap_billing_wo_idx").on(t.woId),
]);

/**
 * PV — payment voucher settling one or more AP billings (data-dictionary
 * "wht_pct, net · batch_id (Export to Bank)"; erd.html "billing_ids[], wht_pct,
 * net, batch_id (bank)"). billing_ids[] is the covered-billing set (kept as a
 * uuid array — a PV can span several billings). WHT withheld triggers a 50-tawi
 * (issued downstream). net is money -> currency_code. batch_id groups PVs for a
 * bank-export batch (the bank file itself is built by @juneflow/bank-file);
 * unconstrained uuid until the payment-batch entity lands (not a name-text FK).
 */
export const pvs = pgTable("pv", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  billingIds: jsonb("billing_ids").$type<string[]>().notNull().default([]),
  whtPct: numeric("wht_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  // B-089 (F-AP1, migration 0026): the GROSS AP value being settled (ap.jsx
  // PV_LIST `amount`). The table previously stored only `net` + `wht_pct`, so the
  // gross could not be reconstructed; persist it so net = gross − WHT − retention
  // is auditable. Money — shares the row's currency_code. Defaults 0 for the
  // additive ADD COLUMN on any pre-existing rows; the seed/handler set the real gross.
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  net: numeric("net", { precision: 16, scale: 2 }).notNull().default("0"),
  // B-089 (F-AP1, migration 0026): the retention held back on this PV (ap.jsx
  // PV_LIST `retention`). Money — shares the row's currency_code. Nullable.
  retention: numeric("retention", { precision: 16, scale: 2 }),
  // B-089 (F-AP1, migration 0026): settlement method + cheque details (ap.jsx
  // PV_LIST `method`/`chequeNo`/`chequeBank` + PVCreateForm cheque block). method
  // is the stable enum code; cheque_* are only populated for cheque-method PVs.
  // cheque_date is a calendar date (no time) like due_date. All nullable.
  method: pvMethod("method"),
  chequeNo: text("cheque_no"),
  chequeBank: text("cheque_bank"),
  chequeDate: date("cheque_date"),
  currencyCode: text("currency_code").notNull().default("THB"),
  batchId: uuid("batch_id"),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("pv_company_idx").on(t.companyId)]);

// ---------------------------------------------------------------------------
// AR (receivables)
// ---------------------------------------------------------------------------

/**
 * ARInvoice — customer invoice feeding the e-Tax queue (data-dictionary
 * "credit_term, vat, etax_status"; erd.html "customer_id, vat, credit_term,
 * etax_status"). project_id optional (project-billed invoices). etax_status per
 * decision C4 superset. amount/vat money -> currency_code; credit_term in days.
 */
export const arInvoices = pgTable("ar_invoice", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "restrict" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  no: text("no").notNull(),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  vat: numeric("vat", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  creditTerm: integer("credit_term"),
  etaxStatus: etaxStatus("etax_status").notNull().default("queued"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("ar_invoice_company_idx").on(t.companyId)]);

/**
 * RV — receipt voucher recording payment against an AR invoice (data-dictionary
 * "RV รับชำระ"; erd.html "invoice_id, amount, method"). amount money ->
 * currency_code; method is the receipt method (cash/transfer/cheque) -> free text.
 */
export const rvs = pgTable("rv", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => arInvoices.id, { onDelete: "restrict" }),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  method: text("method"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("rv_company_idx").on(t.companyId)]);

// ---------------------------------------------------------------------------
// GL journal (double entry)
// ---------------------------------------------------------------------------

/**
 * JV — journal voucher, the double-entry posting emitted from a source money doc
 * (data-dictionary "double entry"; erd.html "source_doc, lines[{acc,dr,cr,cc}],
 * period(lock)"). source_doc is a polymorphic "table:uuid" ref to the originating
 * document (GLPosting process — see file header). period_id locks the JV to a
 * closed accounting period. Balancing DR=CR lives across its JVLine rows (C9).
 */
export const jvs = pgTable("jv", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  no: text("no").notNull(),
  sourceDoc: text("source_doc"),
  periodId: uuid("period_id").references(() => accountingPeriods.id, {
    onDelete: "set null",
  }),
  memo: text("memo"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("jv_company_idx").on(t.companyId)]);

/**
 * JVLine — one debit/credit leg of a JV (decision C9:
 * lines[{account_id, dr, cr, cc_id, project_id}]). Modeled as real rows (not
 * JSON) so the double entry is enforceable and countable — seed emits balanced
 * lines with sum(dr) = sum(cr) per JV (P0-QA-06). dr/cr money -> currency_code.
 * cc_id / project_id are optional cost dimensions.
 */
export const jvLines = pgTable("jv_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  jvId: uuid("jv_id")
    .notNull()
    .references(() => jvs.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => glAccounts.id, { onDelete: "restrict" }),
  dr: numeric("dr", { precision: 16, scale: 2 }).notNull().default("0"),
  cr: numeric("cr", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  ccId: uuid("cc_id").references(() => costCenters.id, { onDelete: "set null" }),
  projectId: uuid("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Bank
// ---------------------------------------------------------------------------

/**
 * Cheque — bank-side cheque document (data-dictionary "Cheque / BankStatement /
 * Reconcile"). amount money -> currency_code; status not enumerated -> free text.
 */
export const cheques = pgTable("cheque", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  no: text("no").notNull(),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  dueDate: date("due_date"),
  status: text("status").notNull().default("draft"),
  // B-089 (F-AP1, migration 0026): the PV that issued this cheque (bank.jsx
  // cheque register cross-references a PV by number — CH-040128 -> PV-2026-0184).
  // Nullable — a received cheque (เช็ครับ) or a cheque whose PV is not modeled
  // leaves it null.
  pvId: uuid("pv_id").references(() => pvs.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("cheque_company_idx").on(t.companyId),
  // 0026 (B-089/F-AP1): the cheque -> PV back-link is a join column — index it.
  index("cheque_pv_idx").on(t.pvId),
]);

/**
 * BankStatement — an imported bank statement whose lines are matched against
 * PV/RV, then locked at period close (data-dictionary "นำเข้า statement →
 * จับคู่อัตโนมัติ/มือ → ปิดงวดล็อก"; erd.html "lines[] ↔ pv/rv, period, locked").
 * lines kept as JSON (raw imported rows); Reconcile records the match result.
 */
export const bankStatements = pgTable("bank_statement", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  period: text("period"),
  lines: jsonb("lines").$type<unknown[]>().notNull().default([]),
  locked: boolean("locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("bank_statement_company_idx").on(t.companyId)]);

/**
 * Reconcile — the match result between a bank statement and PV/RV entries, which
 * locks the period when closed (data-dictionary "จับคู่ → ปิดงวดล็อก"). matched
 * holds the statement-line -> pv/rv mapping as JSON. period_id points at the
 * period being closed.
 */
export const reconciles = pgTable("reconcile", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  statementId: uuid("statement_id")
    .notNull()
    .references(() => bankStatements.id, { onDelete: "cascade" }),
  periodId: uuid("period_id").references(() => accountingPeriods.id, {
    onDelete: "set null",
  }),
  matched: jsonb("matched").$type<unknown[]>().notNull().default([]),
  locked: boolean("locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("reconcile_company_idx").on(t.companyId)]);

// ---------------------------------------------------------------------------
// Fixed assets
// ---------------------------------------------------------------------------

/**
 * FixedAsset — a depreciable asset; monthly depreciation auto-posts a JV
 * (data-dictionary "ค่าเสื่อมรายเดือน → JV อัตโนมัติ"; erd.html "cost,
 * life_years, cc_id"). cost money -> currency_code; depr_method not enumerated ->
 * free text (e.g. straight-line).
 */
export const fixedAssets = pgTable("fixed_asset", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  cost: numeric("cost", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  lifeYears: integer("life_years"),
  ccId: uuid("cc_id").references(() => costCenters.id, { onDelete: "set null" }),
  deprMethod: text("depr_method"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("fixed_asset_company_idx").on(t.companyId)]);

// ---------------------------------------------------------------------------
// Labor cost (Worker -> Attendance -> Payroll) + OPEX
// ---------------------------------------------------------------------------

/**
 * Worker — labor master; labor cost flows to project cost (data-dictionary
 * "Worker/Attendance/Payroll · ค่าแรง → ลงต้นทุนโครงการ"). Distinct from `user`
 * (auth account). day_rate money -> currency_code.
 */
export const workers = pgTable("worker", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  dayRate: numeric("day_rate", { precision: 16, scale: 2 }),
  currencyCode: text("currency_code").notNull().default("THB"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("worker_company_idx").on(t.companyId)]);

/**
 * Attendance — a worker's daily time record (erd.html labor "worker_id, day, ot,
 * ... cc_id"). ot in hours; cc_id charges the day to a cost center.
 */
export const attendances = pgTable("attendance", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  workerId: uuid("worker_id")
    .notNull()
    .references(() => workers.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
  ot: numeric("ot", { precision: 8, scale: 2 }).notNull().default("0"),
  ccId: uuid("cc_id").references(() => costCenters.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("attendance_company_idx").on(t.companyId)]);

/**
 * Payroll — a worker's payout for a period (erd.html labor "period, cc_id").
 * period is a YYYY-MM key; amount money -> currency_code.
 */
export const payrolls = pgTable("payroll", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  workerId: uuid("worker_id")
    .notNull()
    .references(() => workers.id, { onDelete: "cascade" }),
  period: text("period").notNull(),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  ccId: uuid("cc_id").references(() => costCenters.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("payroll_company_idx").on(t.companyId)]);

/**
 * OpexBudget — a department's operating budget by month, compared across years
 * (data-dictionary "OpexBudget(dept,year,months[]) · OPEX เทียบหลายปี"). months
 * is the 12-month figure array; money -> currency_code. Unique per dept+year.
 */
export const opexBudgets = pgTable(
  "opex_budget",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    dept: text("dept").notNull(),
    year: integer("year").notNull(),
    months: jsonb("months").$type<number[]>().notNull().default([]),
    currencyCode: text("currency_code").notNull().default("THB"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("opex_budget_company_dept_year_uq").on(t.companyId, t.dept, t.year)],
);

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

import { sql } from "drizzle-orm";
import {
  pgEnum,
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
  unique,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { companies, users } from "./platform.js";
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
    // B-122 Q1 (F-GL2, migration 0035): the account classification driving the
    // trial-balance / statements sign convention and the /gl/post posting map.
    // Additive + nullable; the migration back-populates it from the code prefix
    // (1→asset, 2→liability, 3→equity, 4→revenue, 5→expense) so pre-existing
    // COA rows classify without a reseed. Stable English codes (i18n display).
    accountType: text("account_type"),
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
  // 0030 (perf-reaudit-finance): AP aging + vendor statements filter ap_billing
  // by vendor — index the vendor FK (mirrors the po/gr/wo FK-index precedent).
  index("ap_billing_vendor_idx").on(t.vendorId),
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
  // B-094-3 (SoD, migration 0029 · Wei ruled "ทำเลย"): the DICTIONARY `user` who
  // created the PV, captured at POST /ap/pv from the caller's resolved dictionary
  // user id (loadCaller — NOT the better-auth auth_user id, which is FK-invalid
  // here, the F2 audit-actor precedent). Separation-of-duties: POST /pv/{id}/approve
  // rejects an approver whose id === created_by (a creator may not approve their own
  // PV). Nullable + ON DELETE set null: a legacy/unattributed PV leaves it null and
  // the SoD gate fails SAFE (an unprovable creator is never blocked).
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("pv_company_idx").on(t.companyId)]);

/**
 * APDeposit — a deposit PAID to a vendor before goods/work are received (ap.jsx
 * APDeposit "มัดจำจ่ายให้ผู้ขาย · Vendor Deposit", P2-BE-54). The prototype's GL is
 * explicit: "Dr มัดจำจ่าย, Cr เงินสด" — paying a deposit is an ASSET (an advance to
 * the supplier, COA 1160) funded from cash. It offsets back against the vendor's
 * AP when goods/work are billed (`used` grows toward `amount`; balance =
 * amount − used, SERVER-computed, never stored). Linked to a PO or a WO (the
 * prototype's "อ้างถึง PO / WO" — one of po_id / wo_id set), both nullable FKs.
 * amount is money → currency_code; pct is the deposit percentage (nullable — the
 * form's "% มัดจำ"). status free text (the mock's 'approved'). company_id tenant root.
 */
export const apDeposits = pgTable("ap_deposit", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  no: text("no").notNull(),
  vendorId: uuid("vendor_id").references(() => vendors.id, {
    onDelete: "restrict",
  }),
  poId: uuid("po_id").references(() => pos.id, { onDelete: "set null" }),
  woId: uuid("wo_id").references(() => wos.id, { onDelete: "set null" }),
  reason: text("reason"),
  pct: numeric("pct", { precision: 6, scale: 2 }),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  used: numeric("used", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  status: text("status").notNull().default("approved"),
  // B-313 (migration 0060): the client-supplied idempotency key for the mobile
  // offline SyncProcessor's at-least-once replay. POST /ap/deposit MINTS a fresh
  // deposit id per request and posts a Dr 1160 / Cr 1010 JV keyed `dep:<that fresh
  // id>` — so jv_source_doc_uq can NEVER see a replay (two different source_docs,
  // two clean balanced JVs) and the cash credit is doubled. Proven live: two
  // byte-identical posts of ฿250,000 → DP-2026-0001 + DP-2026-0002, JV-2026-0419 +
  // JV-2026-0420, Σ Dr 1160 = Σ Cr 1010 = 500,000.00 for ONE payment.
  // No natural key exists, and BOTH halves were proven live rather than argued:
  //   - NULL-escapable — with a unique index on (company_id, vendor_id, po_id,
  //     amount) in place, a byte-identical row still INSERTED (po_id is NULL, and
  //     SQL NULL is not equal to itself). vendor_id/po_id/wo_id/pct are ALL nullable.
  //   - legitimately repeatable — set a real po_id on two equal instalments and that
  //     same index CANNOT EVEN BE BUILT ("Key (…)=(…) is duplicated"). Two equal
  //     instalments to one vendor against one PO is ordinary business.
  // Hence the B-307 CLIENT-key shape, not B-308's natural key. `no` is NOT NULL but
  // SERVER-allocated — an output, not a client key. NULLABLE: pre-existing rows and
  // web clients that omit it carry none and never collide.
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("ap_deposit_company_idx").on(t.companyId),
  // The register + offset join a deposit back to its vendor/PO/WO — index the FKs.
  index("ap_deposit_vendor_idx").on(t.vendorId),
  index("ap_deposit_po_idx").on(t.poId),
  index("ap_deposit_wo_idx").on(t.woId),
  // B-313 (migration 0060): PARTIAL unique index — a replayed POST /ap/deposit
  // carrying a previously-seen idempotency_key trips 23505 → the handler returns the
  // ORIGINAL deposit (no duplicate row, no second JV, no second cash credit).
  // Partial (WHERE idempotency_key IS NOT NULL) so the pre-existing / key-less
  // deposits are exempt and never collide (mirrors gr_idempotency_uq /
  // attendance_idempotency_uq / material_issue_idempotency_uq). Proven to apply
  // cleanly on real seeded data.
  uniqueIndex("ap_deposit_idempotency_uq")
    .on(t.idempotencyKey)
    .where(sql`${t.idempotencyKey} IS NOT NULL`),
  // B-318 (migration 0061): the deposit NUMBER is unique per tenant. allocDepositNo
  // is a plain `max(suffix)+1` read, so two CONCURRENT (genuinely distinct) creates
  // both saw the same max and minted the same DP-<year>-<NNNN> — observed live, three
  // numbers across six real deposits. That is NOT what the 0060 idempotency key
  // covers: a key dedupes REPLAYS of ONE request; this is two different payments
  // colliding on a voucher number, and a duplicated voucher number is exactly what
  // makes the money trail un-auditable. FULL (not partial): `no` is NOT NULL, so
  // there is no NULL to exempt and a predicate would only add an escape hatch.
  // Mirrors ar_invoice_company_no_uq (0047) — the same problem already solved on AR.
  // The allocator side is withDocNoRetry() in ap-deposit.ts: the index alone would
  // turn the collision into a false 409 for a real payment.
  uniqueIndex("ap_deposit_company_no_uq").on(t.companyId, t.no),
]);

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
  // B-121 Q2 (migration 0035): the invoice due date (created = date + credit_term
  // days at POST) and the payment lifecycle status. due_date drives AR aging
  // buckets; status flips open → paid when Σ rv.amount ≥ amount + vat (Q4). Nullable
  // due_date (a draft with no term); status defaults 'open' so the additive ADD
  // COLUMN backfills existing rows safely.
  dueDate: date("due_date"),
  status: text("status").notNull().default("open"),
  etaxStatus: etaxStatus("etax_status").notNull().default("queued"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("ar_invoice_company_idx").on(t.companyId),
  // B-217: `no` is unique per tenant. An AR invoice now posts a balanced revenue
  // JV on create (B-216), so a duplicate (company_id, no) would double-recognize
  // revenue. This hard guard backs the in-memory dup-`no` pre-check in
  // createArInvoice (race-safe — a concurrent racer trips 23505 → 409).
  uniqueIndex("ar_invoice_company_no_uq").on(t.companyId, t.no),
]);

/**
 * ARInvoiceLine — one billed line of an AR invoice (B-121 Q2, migration 0035).
 * The header (ar_invoice.amount/vat) is server-authoritative — amount = Σ line
 * (qty × unit_price) and vat = 7% via the tax engine (POST /ar/invoices already
 * ignores any client-supplied total). Storing the lines makes that total
 * auditable and lets GET /ar/invoices/{id} render the breakdown. No company_id:
 * a child row scopes through ar_invoice via the parent FK (selectThrough), the
 * jv_line precedent. qty/unit_price/amount are numeric; amount = qty × unit_price
 * per line (money → currency_code).
 */
export const arInvoiceLines = pgTable("ar_invoice_line", {
  id: uuid("id").primaryKey().defaultRandom(),
  arInvoiceId: uuid("ar_invoice_id")
    .notNull()
    .references(() => arInvoices.id, { onDelete: "cascade" }),
  description: text("description"),
  qty: numeric("qty", { precision: 16, scale: 2 }).notNull().default("0"),
  unitPrice: numeric("unit_price", { precision: 16, scale: 2 })
    .notNull()
    .default("0"),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [
  // A child row scopes through ar_invoice — index the parent FK (jv_line precedent).
  index("ar_invoice_line_invoice_idx").on(t.arInvoiceId),
]);

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
  // B-121 Q3 (migration 0035): invoice_id is now NULLABLE — a retention-refund RV
  // (source='retention-refund') settles a held-back retention, not an invoice, so
  // it carries no invoice_id. An invoice-receipt RV (source='invoice') still sets it.
  invoiceId: uuid("invoice_id").references(() => arInvoices.id, {
    onDelete: "restrict",
  }),
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  method: text("method"),
  // B-121 Q3 (migration 0035): receipt-document metadata + lifecycle. `no` is the
  // receipt number, receipt_date the calendar date received, bank the receiving
  // account. status 'open'→'posted' on GL post. source discriminates an
  // invoice-receipt from a retention-refund (drives the nullable invoice_id).
  // Defaults keep the additive ADD COLUMN safe on existing rows.
  no: text("no"),
  receiptDate: date("receipt_date"),
  bank: text("bank"),
  status: text("status").notNull().default("open"),
  source: text("source").notNull().default("invoice"),
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
}, (t) => [
  index("jv_company_idx").on(t.companyId),
  // 0030 (perf-reaudit-finance): GL period-close + reporting filter jv by its
  // accounting period — index the nullable period FK. Mirrors 0024.
  index("jv_period_idx").on(t.periodId),
  // 0037 (P2-BE-52): a source money doc posts to the GL at most ONCE. source_doc
  // is the polymorphic "<kind>:<uuid>" (or "fa:<uuid>:<period>") posting ref; a
  // partial UNIQUE index makes a concurrent double-post (the /gl/post, CN-approve,
  // and FA-depreciation handlers all check-then-insert, which races) impossible at
  // the DB layer — the losing tx trips 23505 and the handler maps it to the same
  // idempotent 409/skip. The predicate matches ONLY real posting refs
  // (`^<kind>:`): the seed's JV_BOOKS use FREE-TEXT source labels ("REM" / "Manual"
  // ×2 / "GR auto" / …) that are intentionally non-unique (gl-posting.ts) and MUST
  // stay outside this constraint (a bare IS NOT NULL would fail the seed on the two
  // "Manual" rows). Manual JVs with a null/free-text source_doc are unconstrained.
  uniqueIndex("jv_source_doc_uq")
    .on(t.sourceDoc)
    .where(sql`${t.sourceDoc} ~ '^(pv|rv|gr|payroll|fa|cn|apcn|apdn|ret|dep|booking|down|transfer|deal|petty):'`),
  // B-318 / B-168 (migration 0061): the JV NUMBER is unique per tenant. jv_source_doc_uq
  // guards WHAT was posted (a source doc posts at most once); it says nothing about the
  // number the posting was FILED under. allocJvNo is a plain `max(suffix)+1` read shared
  // by 17 insert sites, so two concurrent posts of DIFFERENT source docs both read the
  // same max and file under the same JV-<year>-<NNNN> — observed live, four numbers
  // across six real JVs. Nothing crashes and no amount is wrong; the books simply stop
  // being traceable, and jv_no is what every ActionOk hands the user as the voucher
  // reference. FULL (not partial): `no` is NOT NULL, so there is no NULL to exempt.
  // The allocator side is withDocNoRetry() at every insert site (gl-post.ts) — this
  // index without it would convert the collision into a false "already posted" 409.
  uniqueIndex("jv_company_no_uq").on(t.companyId, t.no),
]);

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
}, (t) => [
  // 0030 (perf-reaudit-finance §P1): jv_line has no company_id — it scopes
  // through jv via selectThrough, so every tenant read of a JV's lines filters
  // on jv_id. Index the hot FK (the highest-traffic finance join). Mirrors 0024.
  index("jv_line_jv_idx").on(t.jvId),
]);

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
 * BankStatementLine — one normalized line of an imported bank statement, split
 * out of the raw `BankStatement.lines` jsonb so a reconcile match becomes a
 * per-row FK write instead of a whole-array jsonb rewrite (B-092 / F-BANK2,
 * migration 0027; mirrors the `gr_item` child-table precedent). Wei ruling:
 * normalize the jsonb blob into real rows — the line-level `matched`/FK columns
 * are the new source of truth for a match; the parent `BankStatement.lines`
 * jsonb is kept (additive) as the raw imported record.
 *
 * `amount` is SIGNED — deposits positive, withdrawals negative (bank.jsx STMT
 * `v`) — so the statement balance is Σ(amount) (money -> currency_code). A
 * matched line back-links to the settling payment voucher (pv_id), a cleared
 * cheque (cheque_id), or a receipt voucher (rv_id); all three are nullable and
 * only the relevant one is set. An unmatched line carries matched=false + null
 * FKs. line_date is a calendar date (no time), like due_date.
 */
export const bankStatementLines = pgTable(
  "bank_statement_line",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    statementId: uuid("statement_id")
      .notNull()
      .references(() => bankStatements.id, { onDelete: "cascade" }),
    lineDate: date("line_date"),
    description: text("description"),
    // SIGNED money — deposits +, withdrawals − (bank.jsx STMT `v`). Money column
    // -> carries currency_code; the running balance is Σ(amount).
    amount: numeric("amount", { precision: 16, scale: 2 }).notNull().default("0"),
    currencyCode: text("currency_code").notNull().default("THB"),
    matched: boolean("matched").notNull().default(false),
    // F-BANK2: the matched counterpart. A statement line is settled by at most
    // one of a PV (outgoing payment), a cheque (cleared/cashed), or an RV
    // (incoming receipt). All nullable — set only on matched lines; rv_id is a
    // real FK because the `rv` table exists (AR receipt vouchers), though the
    // seed leaves it null (no RV rows are seeded — AR is Phase-5-deferred).
    pvId: uuid("pv_id").references(() => pvs.id, { onDelete: "set null" }),
    chequeId: uuid("cheque_id").references(() => cheques.id, {
      onDelete: "set null",
    }),
    rvId: uuid("rv_id").references(() => rvs.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // 0027 (B-092/F-BANK2): a statement's lines are read/matched together — index
    // the parent FK, mirroring the child-table FK-index precedent (gr_item).
    index("bank_statement_line_statement_idx").on(t.statementId),
    // 0028 (B-094-2): a single PV / cheque / RV settles at most ONE statement line
    // — a partial UNIQUE index makes the reverse double-reconcile (the handler
    // 409s first) impossible at the DB layer too. WHERE ... IS NOT NULL keeps the
    // many unmatched lines (all three FKs null) from colliding on NULL. Mirrors
    // the org_unit partial-unique precedent (extensions.ts).
    uniqueIndex("bank_statement_line_pv_uq")
      .on(t.pvId)
      .where(sql`${t.pvId} is not null`),
    uniqueIndex("bank_statement_line_cheque_uq")
      .on(t.chequeId)
      .where(sql`${t.chequeId} is not null`),
    uniqueIndex("bank_statement_line_rv_uq")
      .on(t.rvId)
      .where(sql`${t.rvId} is not null`),
  ],
);

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
}, (t) => [
  index("reconcile_company_idx").on(t.companyId),
  // 0030 (perf-reaudit-finance): reconcile joins back to its bank statement and
  // its accounting period — index both FKs (statement_id NOT NULL, period_id
  // nullable). Mirrors 0024.
  index("reconcile_statement_idx").on(t.statementId),
  index("reconcile_period_idx").on(t.periodId),
]);

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
  // B-123 Q4 (migration 0035 superset · Wei-confirmed): the depreciation-basis and
  // lifecycle columns runFaDepreciation needs. Straight-line per Wei's Q1 ruling:
  // monthly depr = (cost − salvage) / life_years / 12, accumulated_depr is the
  // running total the run advances (idempotent per period), book value =
  // cost − accumulated_depr (DERIVED, never stored, to avoid drift). acquired_date
  // anchors the depreciation start. status 'active'→'disposed'/'written_off' via the
  // FA adjust op-set (Q5). Money columns → currency_code; defaults keep the additive
  // ADD COLUMN safe on existing rows.
  salvage: numeric("salvage", { precision: 16, scale: 2 })
    .notNull()
    .default("0"),
  acquiredDate: date("acquired_date"),
  accumulatedDepr: numeric("accumulated_depr", { precision: 16, scale: 2 })
    .notNull()
    .default("0"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [index("fixed_asset_company_idx").on(t.companyId)]);

/**
 * FAAdjustment — a revaluation or write-off applied to a fixed asset (B-123 Q5,
 * migration 0036). The FA adjust op-set (PUT /fa/assets/{id}, POST /fa/revalue,
 * POST /fa/write-off) records the change here so GET /fa/adjustments has a real
 * backing (never a fabricated history — C10). A revalue captures the new book
 * value; a write-off captures the carrying amount removed. Each adjustment posts
 * a balanced JV (jv_id back-links it) via the same posting-inbox convention as
 * depreciation. finance.approve-gated → status starts 'approved' (the approve
 * perm IS the draft→approve gate; a future draft workflow can default 'draft').
 * Its own company_id (aggregate-root pattern, mirrors ar_invoice) → GET is a
 * plain company-scoped select. amount is money → currency_code.
 */
export const faAdjustments = pgTable("fa_adjustment", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id")
    .notNull()
    .references(() => fixedAssets.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'revalue' | 'write_off'
  amount: numeric("amount", { precision: 16, scale: 2 }).notNull().default("0"),
  currencyCode: text("currency_code").notNull().default("THB"),
  jvId: uuid("jv_id").references(() => jvs.id, { onDelete: "set null" }),
  memo: text("memo"),
  status: text("status").notNull().default("approved"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("fa_adjustment_company_idx").on(t.companyId),
  index("fa_adjustment_asset_idx").on(t.assetId),
]);

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
  // B-140 RG-1 (migration 0040): worker-master superset from labor.jsx WorkerForm
  // (code/ทีม/หัวหน้า/ความชำนาญ/ประเภทค่าจ้าง/ใช้งาน). All additive + nullable/defaulted
  // (safe ADD COLUMN on the seeded rows). Stable English codes (i18n display).
  code: text("code"),
  team: text("team"),
  supervisor: text("supervisor"),
  skill: text("skill"),
  payType: text("pay_type"),
  active: boolean("active").notNull().default(true),
  // B-332 (migration 0062): the auth link. Before this column `worker` and `user`
  // had NO relationship in either direction, so a mobile field check-in could not
  // answer "which worker is this caller?" — the server could only take a client-
  // supplied worker_id on trust. NULLABLE and it must stay that way: workers are
  // day-labourers and most will never hold a login (the 8 seeded rows carry none,
  // and there is no backfill value that would not be a fabrication).
  //
  // ON DELETE set null, NOT cascade — load-bearing. Deleting a user account must
  // drop the login link and KEEP the worker: cascading would delete the worker and
  // (through attendance/payroll's own cascade) that worker's PAYROLL HISTORY.
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("worker_company_idx").on(t.companyId),
  // B-332: one user resolves to AT MOST one worker. Without it "which worker am I?"
  // is ambiguous at the check-in door and the handler would have to pick — which on
  // a table that sums into payroll means clocking one man's day onto another man's
  // pay. PARTIAL (WHERE user_id IS NOT NULL) because the column is nullable and
  // Postgres treats NULLs as DISTINCT: a full index would admit all 8 unlinked
  // workers today but is the wrong shape to reason about (B-307's NULL-distinctness
  // trap — the opposite call from B-308's payroll_worker_period_uq, whose two
  // columns are both NOT NULL). The predicate also makes the intent explicit: many
  // workers with no login, never two workers with the same login.
  //
  // ONE index, not two: this same btree serves the `WHERE user_id = $1` self-lookup
  // (the equality implies the predicate), so no separate worker_user_idx is added.
  uniqueIndex("worker_user_uq")
    .on(t.userId)
    .where(sql`${t.userId} IS NOT NULL`),
]);

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
  // B-140 RG-2 (migration 0040): the daily attendance status (มา/ครึ่งวัน/ขาด) and
  // its pay factor. status drives day_fraction {full:1, half:0.5, absent:0} — the
  // OT/pay calc is pay = day_rate × day_fraction + ot × (day_rate/8) × 1.5 (RG-3).
  // Additive: status defaults 'full', day_fraction defaults 1 (safe on seeded rows).
  status: text("status").notNull().default("full"),
  dayFraction: numeric("day_fraction", { precision: 3, scale: 2 }).notNull().default("1"),
  ccId: uuid("cc_id").references(() => costCenters.id, { onDelete: "set null" }),
  // B-307 (migration 0057): the client-supplied idempotency key for the mobile
  // offline SyncProcessor's at-least-once replay. POST /labor/payroll computes the
  // payout by SUMMING attendance ROWS (not DISTINCT days), so a replayed check-in
  // inserts a second row and the worker is PAID TWICE for that day — a money defect,
  // not data hygiene. This key + the attendance_idempotency_uq partial unique index
  // below is the dedup point (mirrors the B-261 gr contract). NULLABLE: pre-existing
  // rows and the web bulk-save carry none and never collide.
  idempotencyKey: text("idempotency_key"),
  // B-332 (migration 0062): the mobile field check-in/check-out pair. The mapping
  // the comment below called "undecided" is now decided: CHECK-OUT IS A SECOND
  // COLUMN ON THIS ROW, never a second row.
  //
  // WHY a column and not a row — the reason is arithmetic, not indexing.
  // createLaborPayroll pays by SUMMING ROWS (`total += dayRate * day_fraction + …`)
  // and day_fraction is NOT NULL DEFAULT 1, so a check-out written as its own row
  // would carry its own full day_fraction and the worker would be paid 2.0 days for
  // one day worked. The B-307 key would NOT catch it either: a check-in and a
  // check-out are two distinct client operations carrying two distinct legitimate
  // idempotency keys, so nothing collides. It is the B-307 double-pay defect
  // re-entering through a different door.
  //
  // CLIENT-SUPPLIED timestamps, not server now(): the phone queues these offline and
  // the SyncProcessor may drain hours later, so now()-at-sync would record the sync
  // time instead of the time the worker actually stood at the gate. Client-supplied
  // is also what makes the check-out replay-safe (the retry re-sends the same
  // instant, so "same value stored" is provably a replay rather than a second event).
  // Neither column feeds the payroll sum — day_fraction and ot do — so a client value
  // here is a RECORD, not money.
  checkedInAt: timestamp("checked_in_at", { withTimezone: true, mode: "date" }),
  checkedOutAt: timestamp("checked_out_at", { withTimezone: true, mode: "date" }),
  // B-332: the device fix at each event, WGS-84 decimal degrees (the format
  // Geolocator.getCurrentPosition returns). numeric(9,6) — 6 dp is ~0.11 m and is
  // EXACTLY the mobile formatter's precision (formatGpsFix toStringAsFixed(6)), so
  // nothing is lost crossing the wire; 3 integer digits hold ±180.
  //
  // Deliberately NUMERIC, diverging from the shipped `text` precedent
  // (pm_workorder.checkin_gps, land_plot.gps, both "13.8076, 100.4519"): those are
  // DISPLAY strings that are never computed against. A radius/geofence check is a
  // distance calculation, and a text column has to be parsed for it — where
  // unparseable text fails silently.
  //
  // NULLABLE is load-bearing, not laziness. GpsSource.currentFix() returns a plain
  // null for permission-denied / location-services-off / no-fix and NEVER fabricates
  // a coordinate. NOT NULL here would mean a worker with location off cannot clock
  // in at all — the same "reject real work at the door" failure as a wrong unique
  // key, arriving through a different column.
  //
  // NOT captured: Position.accuracy (metres). The mobile seam returns only a
  // formatted lat/lng, and a radius verdict computed without an accuracy figure is
  // misleading (a ±500 m fix reported as "within 12 m"). Widening the seam is a
  // prerequisite for the geofence, not a column to add speculatively here.
  checkinLat: numeric("checkin_lat", { precision: 9, scale: 6 }),
  checkinLng: numeric("checkin_lng", { precision: 9, scale: 6 }),
  checkoutLat: numeric("checkout_lat", { precision: 9, scale: 6 }),
  checkoutLng: numeric("checkout_lng", { precision: 9, scale: 6 }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
}, (t) => [
  index("attendance_company_idx").on(t.companyId),
  // B-307 (migration 0057): PARTIAL unique index — a replayed POST /labor/attendance
  // carrying a previously-seen idempotency_key trips 23505 → the handler returns the
  // ORIGINAL row (no duplicate, so payroll still sums that day ONCE). Partial (WHERE
  // idempotency_key IS NOT NULL) so every pre-existing / key-less attendance row is
  // exempt and never collides (mirrors gr_idempotency_uq / jv_source_doc_uq).
  // Deliberately NOT unique(worker_id, day): a cost-centre-split day is legitimately
  // two `half` rows with different cc_id (the column exists for exactly that), and the
  // mobile check-in/check-out pair's mapping onto this single POST is undecided — a
  // wrong uniqueness constraint on a money table rejects real work at the door.
  //
  // B-332 REVISITED the "undecided" half and STILL adds no such index. Check-out is
  // now decided (a column above, so the pair no longer needs two rows), but three
  // independent things still argue against unique(worker_id, day) and one of them is
  // decisive:
  //   1. THE CORRECTION PATH. There is no UPDATE / PUT / PATCH / DELETE on attendance
  //      anywhere in registerLaborRoute — a second INSERT is the ONLY way to correct a
  //      day (someone marked absent who actually worked half a day). A unique index
  //      turns every correction into a 23505. B-310 is open RIGHT NOW because B-308's
  //      unique(worker_id, period) froze payroll with no recompute path; the same
  //      mistake one table upstream, on the INPUT, would also make B-310 unfixable —
  //      its remedy depends on attendance being correctable.
  //   2. THE COST-CENTRE SPLIT above. Honest qualification: the shipped web register
  //      keys its state one entry per worker and has no cc selector, so a split day is
  //      producible only through the API today — coherent-but-unbuilt. That makes it
  //      an argument about foreclosing a future, not about breaking production, and it
  //      is the WEAKER of the two.
  //   3. IT WOULD FIGHT THE B-307 KEY. attendance_idempotency_uq below dedups a
  //      REPLAY; a natural key dedups a DUPLICATE. A screen remount mints a NEW
  //      idempotency key for the same worker+day (the key is per screen instance), so
  //      that request passes the key index and trips the natural key — and the catch
  //      in labor.ts gates on the constraint NAME (B-263), so a different name
  //      rethrows to a 500. On the phone a 5xx is deferred and the drain STOPS, so the
  //      whole write queue wedges behind it. The name gate correctly prevents
  //      answering the WRONG ROW; it is not a licence to add the index.
  // NULL-distinctness, checked explicitly since B-307 and B-308 answered that same
  // test in opposite directions: worker_id and day are BOTH NOT NULL, so such an
  // index would be FULL and INESCAPABLE — the B-308 case, not the B-307 case. Passing
  // that test is not what makes a key right: an inescapable index is exactly as
  // dangerous as it is strong when it is the wrong constraint. B-332 is caught by
  // reason 1, not by the NULL trap.
  // A check-in the user genuinely initiates twice is a DUPLICATE, not a replay, and
  // the honest answer to it is a 409 from an explicit pre-check — not a 23505 from a
  // second index.
  uniqueIndex("attendance_idempotency_uq")
    .on(t.idempotencyKey)
    .where(sql`${t.idempotencyKey} IS NOT NULL`),
]);

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
}, (t) => [
  index("payroll_company_idx").on(t.companyId),
  /**
   * B-308 (money · Wei = ก): ONE payroll run per worker per period. Without this a
   * double-click on "run payroll" mints TWO rows, and because the GL guard keys on
   * `source_doc = payroll:<id>` (jv_source_doc_uq, 0037) BOTH post as clean balanced
   * JVs — 2× the money for one day's work, uncorrelatable after the fact. Reproduced
   * live: JV-2026-0419 + JV-2026-0420, 687.50 each, distinct payroll ids.
   *
   * NATURAL key, not a client idempotency key (unlike attendance_idempotency_uq /
   * gr_idempotency_uq): a second run for the same worker+period is never legitimate
   * work — `period` is a monthly YYYY-MM bucket by ruling (B-140 RG-4) and no
   * UPDATE / PUT / re-run path for `payroll` exists anywhere in the API.
   *
   * NOT partial and NOT company-scoped, both deliberate: worker_id and period are
   * both NOT NULL, so the key covers 100% of rows with no NULL-distinctness escape
   * (the trap the partial B-307 index had to dodge); and worker_id FKs a
   * tenant-owned worker, so two companies can never share one — the 2-column key is
   * strictly TIGHTER than adding company_id, never looser.
   */
  uniqueIndex("payroll_worker_period_uq").on(t.workerId, t.period),
]);

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

// ---------------------------------------------------------------------------
// EVM (Earned Value) snapshot — the one genuinely-new group-C store
// ---------------------------------------------------------------------------

/**
 * EVMSnapshot — a periodic per-project Earned-Value time-series row (PV/EV/AC +
 * time-phased budget), the ONE genuinely-new group-C store (Wei-approved B-101;
 * recon agents/orch-b-recon/flow-a-group-c.md §3.4). Point-in-time analytics
 * (BAC / AC / committed / %complete) are derivable on-the-fly and largely
 * already implemented, but the S-curve (PV/EV/AC over time) is NOT — no existing
 * table is time-phased (cbs_budget is flat; jv_line/ap_billing collapse to one
 * seed instant) and past EV/AC is LOST once variation_order / boq-revise
 * overwrite balances, so the as-at history must be CAPTURED. This snapshot backs
 * the dashboard budget-vs-actual S-curve (GET /dashboard/budget-actual backfill),
 * RPT-005 EVM, and RPT-004 variance (§3.2 build-once — one store, three surfaces).
 *
 * TENANT SCOPE — PROJECT-ANCHORED: there is deliberately NO company_id column.
 * Company scope flows through project_id -> project.company_id, read via
 * TenantDb.selectThrough() over the projects hop — exactly the same door pattern
 * as boq_doc / subcon_contract / project_node, matching the project-anchored doc
 * convention. A snapshot can never be read outside its project's tenant.
 *
 * Global-readiness (PLAN.md §4): every money column (pv/ev/ac/budget/bac) carries
 * currency_code; all timestamps are UTC (timestamptz). period is a 'YYYY-MM'
 * bucket key; period_end is the as-at date (the time axis). UNIQUE(project_id,
 * period) makes one snapshot per project per period the source of truth
 * (idempotent re-capture / re-seed).
 */
export const evmSnapshots = pgTable(
  "evm_snapshot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    period: text("period").notNull(), // 'YYYY-MM' bucket key
    periodEnd: date("period_end").notNull(), // snapshot as-at date (the time axis)
    // Planned Value — the time-phased baseline, cumulative to period_end.
    pv: numeric("pv", { precision: 16, scale: 2 }).notNull().default("0"),
    // Earned Value — %complete × BAC, cumulative.
    ev: numeric("ev", { precision: 16, scale: 2 }).notNull().default("0"),
    // Actual Cost to date, cumulative.
    ac: numeric("ac", { precision: 16, scale: 2 }).notNull().default("0"),
    // Period cumulative BAC allocation (the dashboard mock's 'budget' bars).
    budget: numeric("budget", { precision: 16, scale: 2 }).notNull().default("0"),
    // Budget At Completion — the project total (constant across a project's rows).
    bac: numeric("bac", { precision: 16, scale: 2 }).notNull().default("0"),
    currencyCode: text("currency_code").notNull().default("THB"),
    // captured_at = when the snapshot was taken (period-close); UTC.
    capturedAt: timestamp("captured_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // One snapshot per project per period — the source of truth (idempotent re-seed).
    unique("evm_snapshot_project_period_uq").on(t.projectId, t.period),
    // 0031 (B-101): the series read scopes project_id → projects (selectThrough
    // hop) and filters by project_id — index the anchoring FK.
    index("evm_snapshot_project_idx").on(t.projectId),
  ],
);

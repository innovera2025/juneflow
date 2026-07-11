/**
 * @juneflow/bank-file — BankFileFormatter compliance interface.
 *
 * PLAN.md §4 (global-readiness): compliance is an interface — first
 * implementation = `kbank-direct` (see ./kbank-direct).
 *
 * Mock-first (packages/integrations/CLAUDE.md): KBANK starts as a fake
 * adapter; the real formatter swaps in behind this same interface.
 *
 * Credentials/bank config come from env ONLY (P0-INT-04) — never hardcoded,
 * never committed. Secrets are sacred (PLAN.md §10).
 *
 * TODO(P0-INT-02): finalize payload shapes + unit tests (gate G3).
 */

/** Money always carries a currency code (PLAN.md §4 global-readiness). */
export interface Money {
  /** Decimal string to avoid float rounding, e.g. "1234.56". */
  amount: string;
  /** ISO 4217 code, e.g. "THB". */
  currencyCode: string;
}

/** Single payment instruction inside a batch. TODO(P0-INT-02): full field set. */
export interface PaymentInstruction {
  beneficiaryName: string;
  beneficiaryAccountNo: string;
  /** Receiving bank code. TODO(P0-INT-02): bank code list per format spec. */
  beneficiaryBankCode: string;
  amount: Money;
  /** Free-text reference shown on the statement. */
  reference?: string;
}

/** A payment batch to be exported as a bank file (async BullMQ export job — PLAN.md §5). */
export interface PaymentBatch {
  batchId: string;
  /** Tenant scope — company_id is mandatory on every query (PLAN.md §5). */
  companyId: string;
  /** Debit (paying) account number. */
  debitAccountNo: string;
  /** Value date as ISO 8601 date string; timestamps are stored UTC (PLAN.md §4). */
  valueDate: string;
  instructions: PaymentInstruction[];
}

export interface FormattedBankFile {
  fileName: string;
  /** File body in the bank's expected text format. */
  content: string;
  /** Text encoding required by the bank channel. TODO(P0-INT-02): confirm per spec. */
  encoding: 'utf-8' | 'tis-620';
}

/**
 * BankFileFormatter — compliance interface (PLAN.md §4).
 * First implementation = `kbank-direct` (./kbank-direct/index.ts).
 */
export interface BankFileFormatter {
  /** Format identifier, e.g. 'kbank-direct'. */
  readonly format: string;
  formatPaymentBatch(batch: PaymentBatch): Promise<FormattedBankFile>;
}

/**
 * KBANK Direct bank-file formatter — first BankFileFormatter implementation
 * (PLAN.md §4). Skeleton + fake (mock-first, packages/integrations/CLAUDE.md).
 *
 * Credentials/channel config come from env ONLY (P0-INT-04), e.g.:
 *   KBANK_DIRECT_COMPANY_CODE, KBANK_DIRECT_API_KEY
 * Never hardcode, never commit — secrets are sacred (PLAN.md §10).
 * `.env.example` conventions land in P0-INT-04.
 */
import type { BankFileFormatter, FormattedBankFile, PaymentBatch } from '../index.js';

/**
 * Real KBANK Direct implementation — skeleton only.
 * TODO(P0-INT-02): implement the KBANK Direct file layout (record types,
 * field widths, encoding) per the bank's format spec.
 */
export class KBankDirectFormatter implements BankFileFormatter {
  readonly format = 'kbank-direct';

  async formatPaymentBatch(_batch: PaymentBatch): Promise<FormattedBankFile> {
    throw new Error('TODO(P0-INT-02): KBankDirectFormatter.formatPaymentBatch not implemented');
  }
}

/**
 * FakeBankFileFormatter — canned output for dev/tests (mock-first).
 * Deterministic, no credentials; lets flows/contract tests/E2E run before
 * the real KBANK format lands behind the same interface.
 */
export class FakeBankFileFormatter implements BankFileFormatter {
  readonly format = 'kbank-direct';

  async formatPaymentBatch(batch: PaymentBatch): Promise<FormattedBankFile> {
    const lines = [
      `FAKE-KBANK-DIRECT;${batch.batchId};${batch.companyId};${batch.valueDate}`,
      ...batch.instructions.map(
        (i) =>
          `D;${i.beneficiaryBankCode};${i.beneficiaryAccountNo};${i.beneficiaryName};` +
          `${i.amount.amount};${i.amount.currencyCode};${i.reference ?? ''}`,
      ),
      `T;${batch.instructions.length}`,
    ];
    return {
      fileName: `fake-kbank-direct-${batch.batchId}.txt`,
      content: lines.join('\n'),
      encoding: 'utf-8',
    };
  }
}

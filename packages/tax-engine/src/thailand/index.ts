/**
 * Thailand TaxEngine — first implementation (PLAN.md §4).
 *
 * Skeleton + fake (mock-first, packages/integrations/CLAUDE.md): the fake
 * must let flows, contract tests and E2E run end-to-end before the real
 * e-Tax integration lands behind the same interface.
 *
 * Credentials come from env ONLY (P0-INT-04), e.g.:
 *   ETAX_API_BASE_URL, ETAX_API_KEY, ETAX_CERT_PATH
 * Never hardcode, never commit — secrets are sacred (PLAN.md §10).
 * `.env.example` conventions land in P0-INT-04.
 */
import type {
  ETaxSubmission,
  ETaxSubmitRequest,
  Money,
  RdFormRenderRequest,
  RenderedRdForm,
  TaxEngine,
  VatCalcInput,
  VatCalcResult,
  WhtCalcInput,
  WhtCalcResult,
} from '../index.js';

/**
 * Real Thailand implementation — skeleton only.
 * TODO(P0-INT-01): implement WHT/VAT calculation per RD rules.
 * TODO(P0-INT-05): RD forms must render EXACTLY like pototype/tax-forms.jsx
 * (accurate to RD originals) — field inventory in docs/tax-forms-map.md.
 */
export class ThailandTaxEngine implements TaxEngine {
  async calcWht(_input: WhtCalcInput): Promise<WhtCalcResult> {
    throw new Error('TODO(P0-INT-01): ThailandTaxEngine.calcWht not implemented');
  }

  async calcVat(_input: VatCalcInput): Promise<VatCalcResult> {
    throw new Error('TODO(P0-INT-01): ThailandTaxEngine.calcVat not implemented');
  }

  async renderRdForm(_request: RdFormRenderRequest): Promise<RenderedRdForm> {
    // TODO(P0-INT-05): must render exactly like pototype/tax-forms.jsx.
    throw new Error('TODO(P0-INT-01): ThailandTaxEngine.renderRdForm not implemented');
  }

  async submitETax(_request: ETaxSubmitRequest): Promise<ETaxSubmission> {
    // Real e-Tax submission goes through an async BullMQ job (PLAN.md §5).
    throw new Error('TODO(P0-INT-01): ThailandTaxEngine.submitETax not implemented');
  }

  async getETaxSubmission(_submissionId: string): Promise<ETaxSubmission> {
    throw new Error('TODO(P0-INT-01): ThailandTaxEngine.getETaxSubmission not implemented');
  }

  async voidETaxSubmission(_submissionId: string, _reason: string): Promise<ETaxSubmission> {
    throw new Error('TODO(P0-INT-01): ThailandTaxEngine.voidETaxSubmission not implemented');
  }
}

/**
 * FakeTaxEngine — canned results for dev/tests (mock-first).
 * Deterministic, no network, no credentials. Status lifecycle follows
 * decision C4: queued -> sent | rejected, plus void.
 */
export class FakeTaxEngine implements TaxEngine {
  async calcWht(input: WhtCalcInput): Promise<WhtCalcResult> {
    // Fake-only float math — real impl must use exact decimal arithmetic.
    const base = Number(input.baseAmount.amount);
    const wht = (base * input.ratePercent) / 100;
    return {
      baseAmount: input.baseAmount,
      whtAmount: money(wht, input.baseAmount.currencyCode),
      netPayable: money(base - wht, input.baseAmount.currencyCode),
    };
  }

  async calcVat(input: VatCalcInput): Promise<VatCalcResult> {
    // Fake-only float math — real impl must use exact decimal arithmetic.
    const base = Number(input.baseAmount.amount);
    const rate = input.ratePercent / 100;
    const netBase = input.inclusive ? base / (1 + rate) : base;
    const vat = netBase * rate;
    return {
      baseAmount: money(netBase, input.baseAmount.currencyCode),
      vatAmount: money(vat, input.baseAmount.currencyCode),
      grossAmount: money(netBase + vat, input.baseAmount.currencyCode),
    };
  }

  async renderRdForm(request: RdFormRenderRequest): Promise<RenderedRdForm> {
    // TODO(P0-INT-05): real renderer must produce forms that render EXACTLY
    // like pototype/tax-forms.jsx (RD originals). This is a canned placeholder.
    return {
      formId: request.formId,
      content: `<!-- FAKE RD form "${request.formId}" — placeholder only. -->`,
      mimeType: 'text/html',
    };
  }

  async submitETax(request: ETaxSubmitRequest): Promise<ETaxSubmission> {
    // Decision C4: new submissions start as 'queued'.
    return { submissionId: `fake-etax-${request.documentId}`, status: 'queued' };
  }

  async getETaxSubmission(submissionId: string): Promise<ETaxSubmission> {
    // Canned: pretend the queued submission was accepted by RD.
    return { submissionId, status: 'sent' };
  }

  async voidETaxSubmission(submissionId: string, _reason: string): Promise<ETaxSubmission> {
    return { submissionId, status: 'void' };
  }
}

/** Fake-only helper: format a float as a 2-decimal Money value. */
function money(value: number, currencyCode: string): Money {
  return { amount: value.toFixed(2), currencyCode };
}

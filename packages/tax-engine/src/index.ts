/**
 * @juneflow/tax-engine — TaxEngine compliance interface.
 *
 * PLAN.md §4 (global-readiness): compliance is an interface — first
 * implementation = `thailand` (see ./thailand).
 *
 * Mock-first (packages/integrations/CLAUDE.md): every external service starts
 * as a fake adapter; the real e-Tax implementation swaps in behind this same
 * interface later.
 *
 * Credentials (e-Tax etc.) are provided via env ONLY (P0-INT-04) — never
 * hardcoded, never committed. Secrets are sacred (PLAN.md §10).
 *
 * TODO(P0-INT-01): finalize calculation payloads + unit tests (gate G3).
 */

/** Money always carries a currency code (PLAN.md §4 global-readiness). */
export interface Money {
  /** Decimal string to avoid float rounding, e.g. "1234.56". */
  amount: string;
  /** ISO 4217 code, e.g. "THB". */
  currencyCode: string;
}

/**
 * e-Tax submission status — decision C4 (PLAN.md Appendix C):
 * superset `queued -> sent | rejected` plus `void`. UI stays per pototype.
 */
export type ETaxStatus = 'queued' | 'sent' | 'rejected' | 'void';

/** Withholding tax (WHT) calculation input. TODO(P0-INT-01): full field set. */
export interface WhtCalcInput {
  baseAmount: Money;
  /** WHT rate as percent, e.g. 3 for 3%. */
  ratePercent: number;
  /** RD income type reference (e.g. service, rent). TODO(P0-INT-01). */
  incomeType?: string;
}

export interface WhtCalcResult {
  baseAmount: Money;
  whtAmount: Money;
  netPayable: Money;
}

/** VAT calculation input. TODO(P0-INT-01): full field set. */
export interface VatCalcInput {
  baseAmount: Money;
  /** VAT rate as percent, e.g. 7 for 7%. */
  ratePercent: number;
  /** Whether baseAmount already includes VAT. */
  inclusive: boolean;
}

export interface VatCalcResult {
  baseAmount: Money;
  vatAmount: Money;
  grossAmount: Money;
}

/**
 * RD (Thai Revenue Department) form identifiers found in
 * pototype/tax-forms.jsx. Rendered forms MUST match pototype/tax-forms.jsx
 * exactly — these mirror official RD documents; re-layouting is forbidden
 * (packages/integrations/CLAUDE.md). Field inventory: TODO(P0-INT-05)
 * -> packages/tax-engine/docs/tax-forms-map.md.
 */
export type RdFormId =
  | 'pnd1' // PND 1
  | 'pnd2' // PND 2
  | 'pnd3' // PND 3
  | 'pnd53' // PND 53
  | 'pp30' // PP 30 (VAT return)
  | 'wht-cert-50bis'; // WHT certificate (Section 50 bis)

export interface RdFormRenderRequest {
  formId: RdFormId;
  /**
   * Form payload — concrete per-form shape comes from the P0-INT-05 field map.
   * TODO(P0-INT-01): replace with typed per-form payloads.
   */
  data: Record<string, unknown>;
}

export interface RenderedRdForm {
  formId: RdFormId;
  /** Rendered output (e.g. HTML string or PDF bytes). TODO(P0-INT-01). */
  content: string | Uint8Array;
  mimeType: string;
}

export interface ETaxSubmitRequest {
  /** Source document id (tenant-scoped via company_id — PLAN.md §5). */
  documentId: string;
  companyId: string;
  /** e-Tax payload. TODO(P0-INT-01): typed payload per document type. */
  payload: Record<string, unknown>;
}

export interface ETaxSubmission {
  submissionId: string;
  status: ETaxStatus;
  /** Populated when status = 'rejected'. */
  rejectReason?: string;
}

/**
 * TaxEngine — compliance interface (PLAN.md §4).
 * First implementation = `thailand` (./thailand/index.ts).
 */
export interface TaxEngine {
  calcWht(input: WhtCalcInput): Promise<WhtCalcResult>;
  calcVat(input: VatCalcInput): Promise<VatCalcResult>;
  /** Render an RD form — must render exactly like pototype/tax-forms.jsx. */
  renderRdForm(request: RdFormRenderRequest): Promise<RenderedRdForm>;
  /** Submit to e-Tax. New submissions start as 'queued' (decision C4). */
  submitETax(request: ETaxSubmitRequest): Promise<ETaxSubmission>;
  getETaxSubmission(submissionId: string): Promise<ETaxSubmission>;
  /** Void an e-Tax submission (decision C4 keeps 'void' from pototype). */
  voidETaxSubmission(submissionId: string, reason: string): Promise<ETaxSubmission>;
}

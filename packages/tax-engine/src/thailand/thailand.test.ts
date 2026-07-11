/**
 * G3 unit tests (PLAN.md §9) — TaxEngine interface + Thailand adapters.
 *
 * mock-first (packages/integrations/CLAUDE.md): the fake adapter must let
 * flows / contract tests / E2E run end-to-end before the real e-Tax
 * integration lands behind the same interface. These tests lock in the fake's
 * deterministic behaviour and the skeleton's not-yet-implemented contract.
 */
import { describe, expect, it } from 'vitest';
import type { Money, TaxEngine } from '../index.js';
import { FakeTaxEngine, ThailandTaxEngine } from './index.js';

const thb = (amount: string): Money => ({ amount, currencyCode: 'THB' });

/** Method names the TaxEngine interface (PLAN.md §4) must expose. */
const TAX_ENGINE_METHODS: ReadonlyArray<keyof TaxEngine> = [
  'calcWht',
  'calcVat',
  'renderRdForm',
  'submitETax',
  'getETaxSubmission',
  'voidETaxSubmission',
];

describe('FakeTaxEngine — interface conformance', () => {
  const engine: TaxEngine = new FakeTaxEngine();

  it.each(TAX_ENGINE_METHODS)('implements %s as a callable method', (method) => {
    expect(typeof engine[method]).toBe('function');
  });
});

describe('FakeTaxEngine.calcWht', () => {
  it('withholds ratePercent of the base and preserves currency', async () => {
    const engine = new FakeTaxEngine();
    const result = await engine.calcWht({ baseAmount: thb('1000.00'), ratePercent: 3 });

    expect(result.whtAmount).toEqual(thb('30.00'));
    expect(result.netPayable).toEqual(thb('970.00'));
    expect(result.baseAmount).toEqual(thb('1000.00'));
  });

  it('returns zero WHT for a 0% rate', async () => {
    const engine = new FakeTaxEngine();
    const result = await engine.calcWht({ baseAmount: thb('500.00'), ratePercent: 0 });

    expect(result.whtAmount).toEqual(thb('0.00'));
    expect(result.netPayable).toEqual(thb('500.00'));
  });
});

describe('FakeTaxEngine.calcVat', () => {
  it('adds VAT on top when the base is exclusive', async () => {
    const engine = new FakeTaxEngine();
    const result = await engine.calcVat({
      baseAmount: thb('100.00'),
      ratePercent: 7,
      inclusive: false,
    });

    expect(result.baseAmount).toEqual(thb('100.00'));
    expect(result.vatAmount).toEqual(thb('7.00'));
    expect(result.grossAmount).toEqual(thb('107.00'));
  });

  it('extracts VAT from within when the base is inclusive', async () => {
    const engine = new FakeTaxEngine();
    const result = await engine.calcVat({
      baseAmount: thb('107.00'),
      ratePercent: 7,
      inclusive: true,
    });

    expect(result.baseAmount).toEqual(thb('100.00'));
    expect(result.vatAmount).toEqual(thb('7.00'));
    expect(result.grossAmount).toEqual(thb('107.00'));
  });
});

describe('FakeTaxEngine e-Tax lifecycle (decision C4: queued -> sent | rejected, plus void)', () => {
  it('starts a new submission as "queued" with a documentId-derived id', async () => {
    const engine = new FakeTaxEngine();
    const submission = await engine.submitETax({
      documentId: 'INV-001',
      companyId: 'co-1',
      payload: {},
    });

    expect(submission.status).toBe('queued');
    expect(submission.submissionId).toContain('INV-001');
  });

  it('reports a submitted document as "sent"', async () => {
    const engine = new FakeTaxEngine();
    const submission = await engine.getETaxSubmission('fake-etax-INV-001');

    expect(submission.status).toBe('sent');
    expect(submission.submissionId).toBe('fake-etax-INV-001');
  });

  it('moves a submission to "void" when voided', async () => {
    const engine = new FakeTaxEngine();
    const submission = await engine.voidETaxSubmission('fake-etax-INV-001', 'issued in error');

    expect(submission.status).toBe('void');
  });
});

describe('FakeTaxEngine.renderRdForm', () => {
  it('returns an HTML placeholder tagged with the requested formId', async () => {
    const engine = new FakeTaxEngine();
    const rendered = await engine.renderRdForm({ formId: 'pp30', data: {} });

    expect(rendered.formId).toBe('pp30');
    expect(rendered.mimeType).toBe('text/html');
    expect(String(rendered.content)).toContain('pp30');
  });
});

describe('ThailandTaxEngine — skeleton (real impl pending, P0-INT-01/P0-INT-05)', () => {
  const engine = new ThailandTaxEngine();

  it('rejects calcWht until the real RD rules are implemented', async () => {
    await expect(engine.calcWht({ baseAmount: thb('1000.00'), ratePercent: 3 })).rejects.toThrow(
      /not implemented/,
    );
  });

  it('rejects submitETax until the real e-Tax integration is implemented', async () => {
    await expect(
      engine.submitETax({ documentId: 'INV-001', companyId: 'co-1', payload: {} }),
    ).rejects.toThrow(/not implemented/);
  });

  it('rejects renderRdForm until forms render exactly like pototype/tax-forms.jsx', async () => {
    await expect(engine.renderRdForm({ formId: 'pp30', data: {} })).rejects.toThrow(
      /not implemented/,
    );
  });
});

/**
 * G3 unit tests (PLAN.md §9) — BankFileFormatter interface + KBANK Direct adapters.
 *
 * mock-first (packages/integrations/CLAUDE.md): the fake adapter must let
 * flows / contract tests / E2E run end-to-end before the real KBANK Direct
 * format lands behind the same interface. These tests lock in the fake's
 * deterministic output and the skeleton's not-yet-implemented contract.
 */
import { describe, expect, it } from 'vitest';
import type { BankFileFormatter, Money, PaymentBatch } from '../index.js';
import { FakeBankFileFormatter, KBankDirectFormatter } from './index.js';

const thb = (amount: string): Money => ({ amount, currencyCode: 'THB' });

/** A deterministic two-instruction batch reused across the fake's assertions. */
const sampleBatch = (): PaymentBatch => ({
  batchId: 'BATCH-001',
  companyId: 'co-1',
  debitAccountNo: '123-4-56789-0',
  valueDate: '2026-07-15',
  instructions: [
    {
      beneficiaryName: 'ACME Co Ltd',
      beneficiaryAccountNo: '111-2-33333-4',
      beneficiaryBankCode: '004',
      amount: thb('1000.00'),
      reference: 'INV-001',
    },
    {
      beneficiaryName: 'Beta Supplies',
      beneficiaryAccountNo: '555-6-77777-8',
      beneficiaryBankCode: '014',
      amount: thb('250.50'),
    },
  ],
});

describe('FakeBankFileFormatter — interface conformance', () => {
  const formatter: BankFileFormatter = new FakeBankFileFormatter();

  it('exposes the kbank-direct format identifier', () => {
    expect(formatter.format).toBe('kbank-direct');
  });

  it('implements formatPaymentBatch as a callable method', () => {
    expect(typeof formatter.formatPaymentBatch).toBe('function');
  });
});

describe('FakeBankFileFormatter.formatPaymentBatch', () => {
  it('emits a header, one detail line per instruction and a trailer count', async () => {
    const formatter = new FakeBankFileFormatter();
    const file = await formatter.formatPaymentBatch(sampleBatch());
    const lines = file.content.split('\n');

    expect(lines[0]).toBe('FAKE-KBANK-DIRECT;BATCH-001;co-1;2026-07-15');
    expect(lines[1]).toBe('D;004;111-2-33333-4;ACME Co Ltd;1000.00;THB;INV-001');
    // Missing reference collapses to an empty field, keeping the layout stable.
    expect(lines[2]).toBe('D;014;555-6-77777-8;Beta Supplies;250.50;THB;');
    expect(lines[3]).toBe('T;2');
    expect(lines).toHaveLength(4);
  });

  it('names the file from the batch id and reports its encoding', async () => {
    const formatter = new FakeBankFileFormatter();
    const file = await formatter.formatPaymentBatch(sampleBatch());

    expect(file.fileName).toBe('fake-kbank-direct-BATCH-001.txt');
    expect(file.encoding).toBe('utf-8');
  });

  it('handles an empty batch with a zero-count trailer', async () => {
    const formatter = new FakeBankFileFormatter();
    const file = await formatter.formatPaymentBatch({
      batchId: 'BATCH-EMPTY',
      companyId: 'co-1',
      debitAccountNo: '123-4-56789-0',
      valueDate: '2026-07-15',
      instructions: [],
    });

    expect(file.content.split('\n')).toEqual([
      'FAKE-KBANK-DIRECT;BATCH-EMPTY;co-1;2026-07-15',
      'T;0',
    ]);
  });

  it('is deterministic — same batch produces byte-identical output', async () => {
    const formatter = new FakeBankFileFormatter();
    const first = await formatter.formatPaymentBatch(sampleBatch());
    const second = await formatter.formatPaymentBatch(sampleBatch());

    expect(first).toEqual(second);
  });
});

describe('KBankDirectFormatter — skeleton (real impl pending, P0-INT-02)', () => {
  const formatter = new KBankDirectFormatter();

  it('exposes the kbank-direct format identifier', () => {
    expect(formatter.format).toBe('kbank-direct');
  });

  it('rejects formatPaymentBatch until the real KBANK Direct layout is implemented', async () => {
    await expect(formatter.formatPaymentBatch(sampleBatch())).rejects.toThrow(/not implemented/);
  });
});

/**
 * G3 unit tests (PLAN.md §9) — env-driven config loader (P0-INT-04).
 *
 * Credentials come from env ONLY. Tests pass an explicit env record (never the
 * real process.env) so they stay deterministic and never depend on a machine's
 * secrets. Verifies: mock-first default, credential wiring, and the real
 * driver's required-var validation.
 */
import { describe, expect, it } from 'vitest';
import { loadBankFileConfig } from './config.js';

describe('loadBankFileConfig', () => {
  it('defaults to the mock-first "fake" driver with no credentials', () => {
    const config = loadBankFileConfig({});

    expect(config.driver).toBe('fake');
    expect(config.kbankDirect).toEqual({ companyCode: undefined, apiKey: undefined });
  });

  it('reads KBANK Direct credentials from the environment', () => {
    const config = loadBankFileConfig({
      BANK_FILE_DRIVER: 'kbank-direct',
      KBANK_DIRECT_COMPANY_CODE: 'CO123',
      KBANK_DIRECT_API_KEY: 'secret-key',
    });

    expect(config.driver).toBe('kbank-direct');
    expect(config.kbankDirect).toEqual({ companyCode: 'CO123', apiKey: 'secret-key' });
  });

  it('rejects an unknown driver', () => {
    expect(() => loadBankFileConfig({ BANK_FILE_DRIVER: 'bogus' })).toThrow(
      /invalid BANK_FILE_DRIVER/,
    );
  });

  it('requires KBANK credentials when the real driver is selected', () => {
    expect(() => loadBankFileConfig({ BANK_FILE_DRIVER: 'kbank-direct' })).toThrow(
      /missing required env var\(s\): KBANK_DIRECT_COMPANY_CODE, KBANK_DIRECT_API_KEY/,
    );
  });
});

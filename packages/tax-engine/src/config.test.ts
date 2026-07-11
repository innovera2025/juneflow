/**
 * G3 unit tests (PLAN.md §9) — env-driven config loader (P0-INT-04).
 *
 * Credentials come from env ONLY. Tests pass an explicit env record (never the
 * real process.env) so they stay deterministic and never depend on a machine's
 * secrets. Verifies: mock-first default, credential wiring, and the real
 * driver's required-var validation.
 */
import { describe, expect, it } from 'vitest';
import { loadTaxEngineConfig } from './config.js';

describe('loadTaxEngineConfig', () => {
  it('defaults to the mock-first "fake" driver with no credentials', () => {
    const config = loadTaxEngineConfig({});

    expect(config.driver).toBe('fake');
    expect(config.etax).toEqual({
      apiBaseUrl: undefined,
      apiKey: undefined,
      certPath: undefined,
    });
  });

  it('reads e-Tax credentials from the environment', () => {
    const config = loadTaxEngineConfig({
      TAX_ENGINE_DRIVER: 'thailand',
      ETAX_API_BASE_URL: 'https://etax.rd.go.th',
      ETAX_API_KEY: 'secret-key',
      ETAX_CERT_PATH: '/run/secrets/etax.p12',
    });

    expect(config.driver).toBe('thailand');
    expect(config.etax).toEqual({
      apiBaseUrl: 'https://etax.rd.go.th',
      apiKey: 'secret-key',
      certPath: '/run/secrets/etax.p12',
    });
  });

  it('rejects an unknown driver', () => {
    expect(() => loadTaxEngineConfig({ TAX_ENGINE_DRIVER: 'bogus' })).toThrow(
      /invalid TAX_ENGINE_DRIVER/,
    );
  });

  it('requires e-Tax credentials when the real driver is selected', () => {
    expect(() => loadTaxEngineConfig({ TAX_ENGINE_DRIVER: 'thailand' })).toThrow(
      /missing required env var\(s\): ETAX_API_BASE_URL, ETAX_API_KEY/,
    );
  });

  it('treats a blank required var as missing', () => {
    expect(() =>
      loadTaxEngineConfig({
        TAX_ENGINE_DRIVER: 'thailand',
        ETAX_API_BASE_URL: 'https://etax.rd.go.th',
        ETAX_API_KEY: '',
      }),
    ).toThrow(/missing required env var\(s\): ETAX_API_KEY/);
  });
});

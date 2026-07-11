/**
 * @juneflow/bank-file — env-driven configuration (P0-INT-04).
 *
 * Every KBANK credential comes from the environment ONLY — never hardcoded,
 * never committed. Secrets are sacred (PLAN.md §10). See `.env.example` for the
 * full variable list and packages/integrations/CLAUDE.md for the convention.
 *
 * Mock-first (PLAN.md §4): the default driver is `fake`, which needs no
 * credentials, so dev / contract tests / E2E run before the real KBANK Direct
 * formatter is wired behind the same interface.
 */

/**
 * Minimal ambient `process.env` typing. The package tsconfig sets `types: []`
 * (no @types/node) on purpose; this narrow declaration lets the loader read env
 * without pulling Node's full type surface into the package.
 */
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

/** Env source: real `process.env` in prod, an explicit record in tests. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** BankFileFormatter implementation selector (mock-first default = `fake`). */
export type BankFileDriver = 'fake' | 'kbank-direct';

/** KBANK Direct credentials — required only for the real driver. */
export interface KBankDirectCredentials {
  /** Corporate customer code issued by KBANK. */
  companyCode: string | undefined;
  /** KBANK Direct API key (secret — env only). */
  apiKey: string | undefined;
}

export interface BankFileConfig {
  driver: BankFileDriver;
  kbankDirect: KBankDirectCredentials;
}

/** Credentials the real `kbank-direct` driver cannot start without. */
const KBANK_DIRECT_REQUIRED_VARS = ['KBANK_DIRECT_COMPANY_CODE', 'KBANK_DIRECT_API_KEY'] as const;

/**
 * Read BankFileFormatter configuration from the environment.
 * @throws if the driver is unknown, or the real driver is missing credentials.
 */
export function loadBankFileConfig(env: EnvSource = process.env): BankFileConfig {
  const config: BankFileConfig = {
    driver: parseBankFileDriver(env.BANK_FILE_DRIVER),
    kbankDirect: {
      companyCode: env.KBANK_DIRECT_COMPANY_CODE,
      apiKey: env.KBANK_DIRECT_API_KEY,
    },
  };

  if (config.driver === 'kbank-direct') {
    assertEnvPresent('bank-file', env, KBANK_DIRECT_REQUIRED_VARS);
  }
  return config;
}

function parseBankFileDriver(raw: string | undefined): BankFileDriver {
  if (raw === undefined || raw === '' || raw === 'fake') return 'fake';
  if (raw === 'kbank-direct') return 'kbank-direct';
  throw new Error(`[bank-file] invalid BANK_FILE_DRIVER="${raw}" (expected "fake" | "kbank-direct")`);
}

/** Throw if any of `vars` is absent or blank in `env`. */
export function assertEnvPresent(pkg: string, env: EnvSource, vars: readonly string[]): void {
  const missing = vars.filter((name) => {
    const value = env[name];
    return value === undefined || value === '';
  });
  if (missing.length > 0) {
    throw new Error(`[${pkg}] missing required env var(s): ${missing.join(', ')}`);
  }
}

/**
 * @juneflow/tax-engine — env-driven configuration (P0-INT-04).
 *
 * Every e-Tax credential comes from the environment ONLY — never hardcoded,
 * never committed. Secrets are sacred (PLAN.md §10). See `.env.example` for the
 * full variable list and packages/integrations/CLAUDE.md for the convention.
 *
 * Mock-first (PLAN.md §4): the default driver is `fake`, which needs no
 * credentials, so dev / contract tests / E2E run before the real e-Tax
 * integration is wired behind the same interface.
 */

/**
 * Minimal ambient `process.env` typing. The package tsconfig sets `types: []`
 * (no @types/node) on purpose; this narrow declaration lets the loader read env
 * without pulling Node's full type surface into the package.
 */
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

/** Env source: real `process.env` in prod, an explicit record in tests. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** TaxEngine implementation selector (mock-first default = `fake`). */
export type TaxEngineDriver = 'fake' | 'thailand';

/** e-Tax credentials — all optional at load; required only for the real driver. */
export interface ETaxCredentials {
  /** e-Tax API base URL. */
  apiBaseUrl: string | undefined;
  /** e-Tax API key (secret — env only). */
  apiKey: string | undefined;
  /** Path to the signing certificate on the host (secret — env only). */
  certPath: string | undefined;
}

export interface TaxEngineConfig {
  driver: TaxEngineDriver;
  etax: ETaxCredentials;
}

/** Credentials the real `thailand` driver cannot start without. */
const THAILAND_REQUIRED_VARS = ['ETAX_API_BASE_URL', 'ETAX_API_KEY'] as const;

/**
 * Read TaxEngine configuration from the environment.
 * @throws if the driver is unknown, or the real driver is missing credentials.
 */
export function loadTaxEngineConfig(env: EnvSource = process.env): TaxEngineConfig {
  const config: TaxEngineConfig = {
    driver: parseTaxEngineDriver(env.TAX_ENGINE_DRIVER),
    etax: {
      apiBaseUrl: env.ETAX_API_BASE_URL,
      apiKey: env.ETAX_API_KEY,
      certPath: env.ETAX_CERT_PATH,
    },
  };

  if (config.driver === 'thailand') {
    assertEnvPresent('tax-engine', env, THAILAND_REQUIRED_VARS);
  }
  return config;
}

function parseTaxEngineDriver(raw: string | undefined): TaxEngineDriver {
  if (raw === undefined || raw === '' || raw === 'fake') return 'fake';
  if (raw === 'thailand') return 'thailand';
  throw new Error(`[tax-engine] invalid TAX_ENGINE_DRIVER="${raw}" (expected "fake" | "thailand")`);
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

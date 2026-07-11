/**
 * @juneflow/notifications — env-driven configuration (P0-INT-04).
 *
 * Every channel credential (LINE / SMTP / Web Push) comes from the environment
 * ONLY — never hardcoded, never committed. Secrets are sacred (PLAN.md §10).
 * See `.env.example` for the full variable list and
 * packages/integrations/CLAUDE.md for the convention.
 *
 * Mock-first (PLAN.md §4): the default driver is `fake`, which needs no
 * credentials, so dev / contract tests / E2E run before real adapters are wired
 * behind the same interface.
 */

/**
 * Minimal ambient `process.env` typing. The package tsconfig sets `types: []`
 * (no @types/node) on purpose; this narrow declaration lets the loader read env
 * without pulling Node's full type surface into the package.
 */
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

/** Env source: real `process.env` in prod, an explicit record in tests. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Notification adapter selector (mock-first default = `fake`). */
export type NotificationsDriver = 'fake' | 'real';

/** LINE Messaging API credentials. */
export interface LineCredentials {
  channelAccessToken: string | undefined;
  channelSecret: string | undefined;
}

/** SMTP email credentials. */
export interface EmailCredentials {
  host: string | undefined;
  port: number | undefined;
  user: string | undefined;
  password: string | undefined;
  from: string | undefined;
}

/** Web Push (VAPID) credentials. */
export interface WebPushCredentials {
  vapidPublicKey: string | undefined;
  vapidPrivateKey: string | undefined;
  vapidSubject: string | undefined;
}

export interface NotificationsConfig {
  driver: NotificationsDriver;
  line: LineCredentials;
  email: EmailCredentials;
  webpush: WebPushCredentials;
}

/**
 * Credentials the real driver cannot start without — one minimal set per
 * channel, since production wires all three (line / email / webpush).
 */
const REAL_REQUIRED_VARS = [
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  'SMTP_HOST',
  'EMAIL_FROM',
  'WEBPUSH_VAPID_PUBLIC_KEY',
  'WEBPUSH_VAPID_PRIVATE_KEY',
  'WEBPUSH_VAPID_SUBJECT',
] as const;

/**
 * Read notifications configuration from the environment.
 * @throws if the driver is unknown, SMTP_PORT is not a number, or the real
 * driver is missing credentials.
 */
export function loadNotificationsConfig(env: EnvSource = process.env): NotificationsConfig {
  const config: NotificationsConfig = {
    driver: parseNotificationsDriver(env.NOTIFICATIONS_DRIVER),
    line: {
      channelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
      channelSecret: env.LINE_CHANNEL_SECRET,
    },
    email: {
      host: env.SMTP_HOST,
      port: parsePort(env.SMTP_PORT),
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      from: env.EMAIL_FROM,
    },
    webpush: {
      vapidPublicKey: env.WEBPUSH_VAPID_PUBLIC_KEY,
      vapidPrivateKey: env.WEBPUSH_VAPID_PRIVATE_KEY,
      vapidSubject: env.WEBPUSH_VAPID_SUBJECT,
    },
  };

  if (config.driver === 'real') {
    assertEnvPresent('notifications', env, REAL_REQUIRED_VARS);
  }
  return config;
}

function parseNotificationsDriver(raw: string | undefined): NotificationsDriver {
  if (raw === undefined || raw === '' || raw === 'fake') return 'fake';
  if (raw === 'real') return 'real';
  throw new Error(
    `[notifications] invalid NOTIFICATIONS_DRIVER="${raw}" (expected "fake" | "real")`,
  );
}

function parsePort(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`[notifications] invalid SMTP_PORT="${raw}" (expected an integer 1-65535)`);
  }
  return port;
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

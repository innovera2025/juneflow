/**
 * G3 unit tests (PLAN.md §9) — env-driven config loader (P0-INT-04).
 *
 * Credentials come from env ONLY. Tests pass an explicit env record (never the
 * real process.env) so they stay deterministic and never depend on a machine's
 * secrets. Verifies: mock-first default, per-channel credential wiring, port
 * parsing, and the real driver's required-var validation.
 */
import { describe, expect, it } from 'vitest';
import { loadNotificationsConfig } from './config.js';

const REAL_ENV = {
  NOTIFICATIONS_DRIVER: 'real',
  LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
  LINE_CHANNEL_SECRET: 'line-secret',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
  SMTP_USER: 'user',
  SMTP_PASSWORD: 'pass',
  EMAIL_FROM: 'noreply@example.com',
  WEBPUSH_VAPID_PUBLIC_KEY: 'vapid-pub',
  WEBPUSH_VAPID_PRIVATE_KEY: 'vapid-priv',
  WEBPUSH_VAPID_SUBJECT: 'mailto:admin@example.com',
} as const;

describe('loadNotificationsConfig', () => {
  it('defaults to the mock-first "fake" driver with no credentials', () => {
    const config = loadNotificationsConfig({});

    expect(config.driver).toBe('fake');
    expect(config.line).toEqual({ channelAccessToken: undefined, channelSecret: undefined });
    expect(config.email.host).toBeUndefined();
    expect(config.email.port).toBeUndefined();
    expect(config.webpush.vapidPublicKey).toBeUndefined();
  });

  it('reads every channel credential from the environment', () => {
    const config = loadNotificationsConfig(REAL_ENV);

    expect(config.driver).toBe('real');
    expect(config.line).toEqual({ channelAccessToken: 'line-token', channelSecret: 'line-secret' });
    expect(config.email).toEqual({
      host: 'smtp.example.com',
      port: 587,
      user: 'user',
      password: 'pass',
      from: 'noreply@example.com',
    });
    expect(config.webpush).toEqual({
      vapidPublicKey: 'vapid-pub',
      vapidPrivateKey: 'vapid-priv',
      vapidSubject: 'mailto:admin@example.com',
    });
  });

  it('rejects an unknown driver', () => {
    expect(() => loadNotificationsConfig({ NOTIFICATIONS_DRIVER: 'bogus' })).toThrow(
      /invalid NOTIFICATIONS_DRIVER/,
    );
  });

  it('rejects a non-numeric SMTP_PORT', () => {
    expect(() => loadNotificationsConfig({ SMTP_PORT: 'not-a-port' })).toThrow(/invalid SMTP_PORT/);
  });

  it('requires every channel credential when the real driver is selected', () => {
    expect(() => loadNotificationsConfig({ NOTIFICATIONS_DRIVER: 'real' })).toThrow(
      /missing required env var\(s\): LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET, SMTP_HOST, EMAIL_FROM, WEBPUSH_VAPID_PUBLIC_KEY, WEBPUSH_VAPID_PRIVATE_KEY, WEBPUSH_VAPID_SUBJECT/,
    );
  });
});

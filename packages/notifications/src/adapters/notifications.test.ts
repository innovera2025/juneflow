/**
 * G3 unit tests (PLAN.md §9) — NotificationAdapter interface + line/email/webpush adapters.
 *
 * mock-first (packages/integrations/CLAUDE.md): the fake adapters must let
 * flows / contract tests / E2E run end-to-end before the real LINE / SMTP /
 * Web Push channels land behind the same interface. These tests lock in the
 * fakes' deterministic output and the skeletons' not-yet-implemented contract.
 */
import { describe, expect, it } from 'vitest';
import type {
  NotificationAdapter,
  NotificationChannel,
  NotificationMessage,
} from '../index.js';
import { FakeEmailNotificationAdapter, EmailNotificationAdapter } from './email.js';
import { FakeLineNotificationAdapter, LineNotificationAdapter } from './line.js';
import { FakeWebPushNotificationAdapter, WebPushNotificationAdapter } from './webpush.js';

/** A deterministic message reused across the fakes' assertions. */
const sampleMessage = (channel: NotificationChannel, to: string): NotificationMessage => ({
  channel,
  to,
  title: 'nav.notifications.title',
  body: 'phrases.approval.pending',
  companyId: 'co-1',
});

/**
 * The three adapter families, each paired with its channel id, real (skeleton)
 * constructor and fake constructor — one table drives every shared assertion.
 */
const families = [
  {
    channel: 'line' as const,
    to: 'Uabc123',
    Real: LineNotificationAdapter,
    Fake: FakeLineNotificationAdapter,
    fakePrefix: 'fake-line-',
  },
  {
    channel: 'email' as const,
    to: 'user@example.com',
    Real: EmailNotificationAdapter,
    Fake: FakeEmailNotificationAdapter,
    fakePrefix: 'fake-email-',
  },
  {
    channel: 'webpush' as const,
    to: 'sub-789',
    Real: WebPushNotificationAdapter,
    Fake: FakeWebPushNotificationAdapter,
    fakePrefix: 'fake-webpush-',
  },
];

describe.each(families)('$channel adapter — interface conformance', ({ channel, Fake }) => {
  const adapter: NotificationAdapter = new Fake();

  it('exposes its channel identifier', () => {
    expect(adapter.channel).toBe(channel);
  });

  it('implements send as a callable method', () => {
    expect(typeof adapter.send).toBe('function');
  });
});

describe.each(families)('Fake$channel adapter.send', ({ channel, to, Fake, fakePrefix }) => {
  it('returns a sent result keyed on the recipient address', async () => {
    const adapter = new Fake();
    const result = await adapter.send(sampleMessage(channel, to));

    expect(result.status).toBe('sent');
    expect(result.messageId).toBe(`${fakePrefix}${to}`);
    expect(result.error).toBeUndefined();
  });

  it('is deterministic — same message produces the same result', async () => {
    const adapter = new Fake();
    const first = await adapter.send(sampleMessage(channel, to));
    const second = await adapter.send(sampleMessage(channel, to));

    expect(first).toEqual(second);
  });
});

describe.each(families)(
  '$channel adapter — skeleton (real impl pending, P0-INT-03)',
  ({ channel, to, Real }) => {
    const adapter = new Real();

    it('exposes its channel identifier', () => {
      expect(adapter.channel).toBe(channel);
    });

    it('rejects send until the real channel delivery is implemented', async () => {
      await expect(adapter.send(sampleMessage(channel, to))).rejects.toThrow(/not implemented/);
    });
  },
);

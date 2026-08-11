/**
 * G3 unit tests (PLAN.md §9) — EmailNotificationAdapter.
 *
 * The transport is injected, so every path here runs with NO network: a
 * recording fake proves the message→envelope mapping, a rejecting fake proves
 * a failed send surfaces honestly instead of resolving a fake success.
 */
import { describe, expect, it } from 'vitest';
import type { NotificationMessage } from '../index.js';
import {
  EmailDeliveryError,
  EmailNotificationAdapter,
  type SmtpDeliveryReceipt,
  type SmtpEnvelope,
  type SmtpTransport,
} from './email.js';

const FROM = 'noreply@juneflow.test';

/** Records what the adapter handed to the wire; answers a canned receipt. */
class RecordingTransport implements SmtpTransport {
  readonly sent: SmtpEnvelope[] = [];

  async sendMail(envelope: SmtpEnvelope): Promise<SmtpDeliveryReceipt> {
    this.sent.push(envelope);
    return { messageId: 'smtp-queue-id-1' };
  }
}

/** Fails the way a real relay refusal / connection drop does — by rejecting. */
class FailingTransport implements SmtpTransport {
  calls = 0;
  constructor(readonly failure: Error) {}

  async sendMail(_envelope: SmtpEnvelope): Promise<SmtpDeliveryReceipt> {
    this.calls += 1;
    throw this.failure;
  }
}

const message = (overrides: Partial<NotificationMessage> = {}): NotificationMessage => ({
  channel: 'email',
  to: 'user@example.com',
  title: 'nav.notifications.title',
  body: 'phrases.approval.pending',
  companyId: 'co-1',
  ...overrides,
});

describe('EmailNotificationAdapter — construction', () => {
  it('exposes its channel identifier', () => {
    const adapter = new EmailNotificationAdapter({ from: FROM, transport: new RecordingTransport() });
    expect(adapter.channel).toBe('email');
  });

  it.each([undefined, ''])('refuses to construct without EMAIL_FROM (%p)', (from) => {
    expect(() => new EmailNotificationAdapter({ from, transport: new RecordingTransport() })).toThrow(
      /EMAIL_FROM/,
    );
  });
});

describe('EmailNotificationAdapter.send — success path', () => {
  it('reports the transport-assigned message id as sent', async () => {
    const transport = new RecordingTransport();
    const adapter = new EmailNotificationAdapter({ from: FROM, transport });

    const result = await adapter.send(message());

    expect(result).toEqual({ messageId: 'smtp-queue-id-1', status: 'sent' });
    expect(result.error).toBeUndefined();
  });

  it('maps the message onto the envelope (title → subject, body verbatim)', async () => {
    const transport = new RecordingTransport();
    const adapter = new EmailNotificationAdapter({ from: FROM, transport });

    await adapter.send(message());

    expect(transport.sent).toEqual([
      {
        from: FROM,
        to: 'user@example.com',
        subject: 'nav.notifications.title',
        text: 'phrases.approval.pending',
      },
    ]);
  });

  it('hands the transport envelope fields only — never credentials or tenant scope', async () => {
    const transport = new RecordingTransport();
    const adapter = new EmailNotificationAdapter({ from: FROM, transport });

    await adapter.send(message());

    expect(Object.keys(transport.sent[0] ?? {}).sort()).toEqual(['from', 'subject', 'text', 'to']);
  });

  it('omits the subject key entirely when the message has no title', async () => {
    const transport = new RecordingTransport();
    const adapter = new EmailNotificationAdapter({ from: FROM, transport });

    // `title` genuinely absent (exactOptionalPropertyTypes: not `title: undefined`).
    const { title: _title, ...withoutTitle } = message();
    await adapter.send(withoutTitle);

    expect(transport.sent[0]).not.toHaveProperty('subject');
  });

  it('does not render data into the body (no invented deep-link copy)', async () => {
    const transport = new RecordingTransport();
    const adapter = new EmailNotificationAdapter({ from: FROM, transport });

    await adapter.send(message({ data: { route: '/pr/PR-2026-001' } }));

    expect(transport.sent[0]?.text).toBe('phrases.approval.pending');
  });
});

describe('EmailNotificationAdapter.send — transport failure', () => {
  it('rejects with EmailDeliveryError instead of resolving a fake success', async () => {
    const transport = new FailingTransport(new Error('550 5.1.1 recipient rejected'));
    const adapter = new EmailNotificationAdapter({ from: FROM, transport });

    await expect(adapter.send(message())).rejects.toBeInstanceOf(EmailDeliveryError);
    expect(transport.calls).toBe(1);
  });

  it('preserves the underlying failure on cause and names the recipient', async () => {
    const failure = new Error('ECONNREFUSED');
    const adapter = new EmailNotificationAdapter({
      from: FROM,
      transport: new FailingTransport(failure),
    });

    const error = await adapter.send(message()).then(
      () => undefined,
      (caught: unknown) => caught as EmailDeliveryError,
    );

    expect(error).toBeDefined();
    expect(error?.cause).toBe(failure);
    expect(error?.recipient).toBe('user@example.com');
    expect(error?.channel).toBe('email');
    expect(error?.message).toContain('user@example.com');
  });
});

describe('EmailNotificationAdapter.send — caller errors never reach the wire', () => {
  it('rejects a blank recipient', async () => {
    const transport = new RecordingTransport();
    const adapter = new EmailNotificationAdapter({ from: FROM, transport });

    await expect(adapter.send(message({ to: '   ' }))).rejects.toThrow(/blank recipient/);
    expect(transport.sent).toHaveLength(0);
  });

  it('rejects a message routed to another channel', async () => {
    const transport = new RecordingTransport();
    const adapter = new EmailNotificationAdapter({ from: FROM, transport });

    await expect(adapter.send(message({ channel: 'line' }))).rejects.toThrow(/"line" message/);
    expect(transport.sent).toHaveLength(0);
  });
});

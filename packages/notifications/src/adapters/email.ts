/**
 * Email notification adapter — skeleton + fake (mock-first,
 * packages/integrations/CLAUDE.md).
 *
 * Credentials come from env ONLY (P0-INT-04), e.g.:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM
 * Never hardcode, never commit — secrets are sacred (PLAN.md §10).
 * `.env.example` conventions land in P0-INT-04.
 */
import type { NotificationAdapter, NotificationMessage, NotificationResult } from '../index.js';

/**
 * Real SMTP email adapter — skeleton only.
 * TODO(P0-INT-03): implement SMTP delivery.
 */
export class EmailNotificationAdapter implements NotificationAdapter {
  readonly channel = 'email';

  async send(_message: NotificationMessage): Promise<NotificationResult> {
    throw new Error('TODO(P0-INT-03): EmailNotificationAdapter.send not implemented');
  }
}

/** Fake email adapter — canned result for dev/tests (mock-first, no network). */
export class FakeEmailNotificationAdapter implements NotificationAdapter {
  readonly channel = 'email';

  async send(message: NotificationMessage): Promise<NotificationResult> {
    return { messageId: `fake-email-${message.to}`, status: 'sent' };
  }
}

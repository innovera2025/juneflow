/**
 * LINE notification adapter — skeleton + fake (mock-first,
 * packages/integrations/CLAUDE.md).
 *
 * Credentials come from env ONLY (P0-INT-04), e.g.:
 *   LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET
 * Never hardcode, never commit — secrets are sacred (PLAN.md §10).
 * `.env.example` conventions land in P0-INT-04.
 *
 * Note: LINE LIFF UI is NOT in this package — LIFF is a React web app in
 * apps/web (PLAN.md Appendix A). This adapter only delivers messages.
 */
import type { NotificationAdapter, NotificationMessage, NotificationResult } from '../index.js';

/**
 * Real LINE Messaging API adapter — skeleton only.
 * TODO(P0-INT-03): implement push message delivery via LINE Messaging API.
 */
export class LineNotificationAdapter implements NotificationAdapter {
  readonly channel = 'line';

  async send(_message: NotificationMessage): Promise<NotificationResult> {
    throw new Error('TODO(P0-INT-03): LineNotificationAdapter.send not implemented');
  }
}

/** Fake LINE adapter — canned result for dev/tests (mock-first, no network). */
export class FakeLineNotificationAdapter implements NotificationAdapter {
  readonly channel = 'line';

  async send(message: NotificationMessage): Promise<NotificationResult> {
    return { messageId: `fake-line-${message.to}`, status: 'sent' };
  }
}

/**
 * Web-push notification adapter — skeleton + fake (mock-first,
 * packages/integrations/CLAUDE.md).
 *
 * Credentials come from env ONLY (P0-INT-04), e.g.:
 *   WEBPUSH_VAPID_PUBLIC_KEY, WEBPUSH_VAPID_PRIVATE_KEY, WEBPUSH_VAPID_SUBJECT
 * Never hardcode, never commit — secrets are sacred (PLAN.md §10).
 * `.env.example` conventions land in P0-INT-04.
 *
 * Native push FCM/APNs = deferred (PLAN.md Appendix A / §12) — this adapter
 * covers browser Web Push (VAPID) only.
 */
import type { NotificationAdapter, NotificationMessage, NotificationResult } from '../index.js';

/**
 * Real Web Push (VAPID) adapter — skeleton only.
 * TODO(P0-INT-03): implement Web Push delivery to stored subscriptions.
 */
export class WebPushNotificationAdapter implements NotificationAdapter {
  readonly channel = 'webpush';

  async send(_message: NotificationMessage): Promise<NotificationResult> {
    throw new Error('TODO(P0-INT-03): WebPushNotificationAdapter.send not implemented');
  }
}

/** Fake web-push adapter — canned result for dev/tests (mock-first, no network). */
export class FakeWebPushNotificationAdapter implements NotificationAdapter {
  readonly channel = 'webpush';

  async send(message: NotificationMessage): Promise<NotificationResult> {
    return { messageId: `fake-webpush-${message.to}`, status: 'sent' };
  }
}

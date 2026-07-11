/**
 * @juneflow/notifications — NotificationAdapter compliance interface.
 *
 * PLAN.md §4 (global-readiness): compliance is an interface — adapters:
 * `line` / `email` / `webpush` (see ./adapters). Notifications are dispatched
 * as async BullMQ jobs (PLAN.md §5), not sent inline from request handlers.
 *
 * Mock-first (packages/integrations/CLAUDE.md): LINE (and every external
 * channel) starts as a fake adapter; real adapters swap in behind this same
 * interface. Native push FCM/APNs = deferred (PLAN.md Appendix A / §12).
 *
 * Credentials come from env ONLY (P0-INT-04) — never hardcoded, never
 * committed. Secrets are sacred (PLAN.md §10).
 *
 * TODO(P0-INT-03): finalize payload shapes + unit tests (gate G3).
 */

export type NotificationChannel = 'line' | 'email' | 'webpush';

/** Message to deliver on one channel. TODO(P0-INT-03): full field set. */
export interface NotificationMessage {
  channel: NotificationChannel;
  /**
   * Channel-specific recipient address: LINE user id, email address, or
   * web-push subscription id.
   */
  to: string;
  /**
   * Display texts must come from packages/i18n keys (i18n-full.json) —
   * never invent new translations (PLAN.md §0 rule 2).
   */
  title?: string;
  body: string;
  /** Optional structured payload (e.g. deep-link route). */
  data?: Record<string, unknown>;
  /** Tenant scope — company_id is mandatory on every query (PLAN.md §5). */
  companyId: string;
}

export interface NotificationResult {
  messageId: string;
  status: 'queued' | 'sent' | 'failed';
  /** Populated when status = 'failed'. */
  error?: string;
}

/**
 * NotificationAdapter — compliance interface (PLAN.md §4).
 * Adapters: line / email / webpush (./adapters/*.ts).
 */
export interface NotificationAdapter {
  readonly channel: NotificationChannel;
  send(message: NotificationMessage): Promise<NotificationResult>;
}

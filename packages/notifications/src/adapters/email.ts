/**
 * Email notification adapter (P0-INT-03).
 *
 * Split of responsibility — the adapter owns the *message* half, an injected
 * `SmtpTransport` owns the *wire* half:
 *
 *   NotificationMessage --(this adapter)--> SmtpEnvelope --(transport)--> SMTP
 *
 * The adapter therefore holds NO credentials at all: SMTP_HOST / SMTP_PORT /
 * SMTP_USER / SMTP_PASSWORD are the transport's business, so a password can
 * never reach this file, its errors, or a log line written from them. The only
 * config value read here is EMAIL_FROM (`loadNotificationsConfig().email.from`),
 * which is an envelope field, not a secret.
 *
 * Credentials come from env ONLY (P0-INT-04). Never hardcode, never commit —
 * secrets are sacred (PLAN.md §10).
 *
 * NOTE: no concrete `SmtpTransport` ships in this package. Node has no built-in
 * SMTP client and the workspace has no mail library, so the wire half is a
 * stack decision — see BLOCKERS.md B-269.
 */
import { assertEnvPresent } from '../config.js';
import type { NotificationAdapter, NotificationMessage, NotificationResult } from '../index.js';

/** One outbound mail, ready for the wire. Carries no credentials by design. */
export interface SmtpEnvelope {
  /** Envelope sender — EMAIL_FROM. */
  readonly from: string;
  /** Single recipient (NotificationMessage.to). */
  readonly to: string;
  /** Subject header; absent when the message carries no title. */
  readonly subject?: string;
  /** Plain-text body, verbatim from NotificationMessage.body. */
  readonly text: string;
}

/** What a transport returns once the relay has accepted the message. */
export interface SmtpDeliveryReceipt {
  /** Server-assigned id for the accepted message. */
  readonly messageId: string;
}

/**
 * The wire port. Everything that needs a socket, TLS, or credentials lives
 * behind this interface — which is also what makes the adapter unit-testable
 * with no network (see email.test.ts).
 *
 * @throws (rejects) when the relay refuses or the connection fails. A transport
 * must NEVER resolve on a failed send.
 */
export interface SmtpTransport {
  sendMail(envelope: SmtpEnvelope): Promise<SmtpDeliveryReceipt>;
}

export interface EmailAdapterOptions {
  /** `loadNotificationsConfig().email.from` (EMAIL_FROM). */
  readonly from: string | undefined;
  /** Pre-configured transport — owns host/port/auth. */
  readonly transport: SmtpTransport;
}

/**
 * A send that reached the transport and failed there.
 *
 * `send()` REJECTS with this rather than resolving `{ status: 'failed' }` so an
 * async dispatch job (BullMQ, PLAN.md §5) fails and retries instead of acking a
 * mail that was never delivered. The message deliberately interpolates only the
 * recipient — never credentials, never the transport's own text — so logging it
 * cannot leak. The underlying failure is preserved on `cause`.
 */
export class EmailDeliveryError extends Error {
  readonly channel = 'email';
  readonly recipient: string;

  constructor(recipient: string, options?: { cause?: unknown }) {
    super(`[notifications] email delivery to ${recipient} failed`, options);
    this.name = 'EmailDeliveryError';
    this.recipient = recipient;
  }
}

/** EMAIL_FROM must be present — same blank rule as loadNotificationsConfig(). */
function assertFromPresent(from: string | undefined): asserts from is string {
  assertEnvPresent('notifications', { EMAIL_FROM: from }, ['EMAIL_FROM']);
}

/**
 * Real email adapter — maps a NotificationMessage onto an SMTP envelope and
 * delegates delivery to the injected transport.
 */
export class EmailNotificationAdapter implements NotificationAdapter {
  readonly channel = 'email';

  readonly #from: string;
  readonly #transport: SmtpTransport;

  constructor(options: EmailAdapterOptions) {
    const { from, transport } = options;
    // loadNotificationsConfig() only enforces EMAIL_FROM when
    // NOTIFICATIONS_DRIVER=real; re-assert here so a mis-wired adapter fails at
    // construction (boot) instead of at the first send.
    assertFromPresent(from);
    this.#from = from;
    this.#transport = transport;
  }

  /**
   * Deliver one message.
   *
   * `status: 'sent'` means the relay ACCEPTED the message. Final mailbox
   * delivery is not observable from an SMTP handoff, so nothing stronger is
   * claimed here.
   *
   * NotificationMessage.data is NOT rendered into the mail: turning a deep-link
   * route into a URL needs a public base-URL config this repo does not have, and
   * inventing one would fabricate content. NotificationMessage.companyId is
   * likewise not written into a header — it is tenant scope for the caller, not
   * an envelope field.
   *
   * @throws {EmailDeliveryError} when the transport fails.
   * @throws {Error} on a caller error (wrong channel, blank recipient) — these
   * never reach the transport.
   */
  async send(message: NotificationMessage): Promise<NotificationResult> {
    if (message.channel !== 'email') {
      throw new Error(
        `[notifications] EmailNotificationAdapter received a "${message.channel}" message`,
      );
    }

    const to = message.to;
    if (to.trim() === '') {
      throw new Error('[notifications] email message has a blank recipient (to)');
    }

    const envelope: SmtpEnvelope = {
      from: this.#from,
      to,
      text: message.body,
      // exactOptionalPropertyTypes: omit the key entirely rather than send
      // `subject: undefined`, so a transport can tell "no subject" from "empty".
      ...(message.title === undefined ? {} : { subject: message.title }),
    };

    let receipt: SmtpDeliveryReceipt;
    try {
      receipt = await this.#transport.sendMail(envelope);
    } catch (cause) {
      // Never swallow a failed send into a success result.
      throw new EmailDeliveryError(to, { cause });
    }

    return { messageId: receipt.messageId, status: 'sent' };
  }
}

/** Fake email adapter — canned result for dev/tests (mock-first, no network). */
export class FakeEmailNotificationAdapter implements NotificationAdapter {
  readonly channel = 'email';

  async send(message: NotificationMessage): Promise<NotificationResult> {
    return { messageId: `fake-email-${message.to}`, status: 'sent' };
  }
}

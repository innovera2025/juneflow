// Credential provisioning + password-reset primitives (B-282).
//
// THE GAP THIS CLOSES. Before this module the auth chain had a hole big enough
// to stop a launch: POST /users wrote only the dictionary `user` row with
// status "invited" and created NO better-auth credential, while POST /auth/forgot
// and POST /auth/reset were declared in the contract (openapi.yaml ~L111/~L127)
// but never mounted. The only credentials that existed anywhere were the DEV
// ones in packages/db/src/seed/index.ts — whose own comment says a real
// deployment must provision credentials outside the seed, and nothing did. Net
// effect: an invited user could never log in, ever.
//
// WHY A SEPARATE PRIVILEGED HANDLE (the PlatformDb containment pattern).
// auth_account / auth_session / auth_verification carry NO company_id column, so
// they cannot be reached through TenantDb (db/tenant-db.ts) at all. This store
// therefore holds the un-scoped base handle PRIVATELY (#db — never returned,
// never attached to `request`), is constructed ONCE in app.ts, and is injected
// only into the three handlers that need it. Exactly the containment rule
// db/platform-db.ts already sets for the cross-tenant read door.
//
// TENANT SCOPING STILL HOLDS. The tenant binding lives on auth_user.company_id.
// Every write this store makes is anchored on ONE auth_user, and the single
// statement that touches a tenant-owned table (activateInvitedUser → dictionary
// `user`) carries an EXPLICIT `company_id = <that auth_user's company>`
// predicate. A reset therefore cannot cross companies: the token resolves to an
// auth_user, the auth_user carries the company, and the update is pinned to it.
//
// TOKEN MODEL (no migration — B-282 evidence). The token store is the EXISTING
// but previously unused `auth_verification` table (packages/db/src/schema/auth.ts
// L113-125, migration 0008). Its four load-bearing columns are exactly what a
// reset token needs:
//   identifier  → "pwreset:<auth_user id>"  (namespaced so better-auth's own
//                 verification rows, if it ever writes any, never collide)
//   value       → the SHA-256 hex DIGEST of the token; the raw token is never
//                 stored, so a database read cannot reset anyone's password
//   expires_at  → issue + RESET_TOKEN_TTL_MS
// Single-use is enforced by DELETE ... RETURNING, which is atomic under READ
// COMMITTED: the row can be deleted by exactly one transaction, so a second
// (or concurrent) use of the same token returns zero rows. The guard is on the
// MUTATING statement itself, not on a preceding SELECT — the B-149 lesson.
//
// SECRET HYGIENE. The raw token exists only in memory, is returned only to the
// handler that hands it straight to the delivery seam, and is never logged,
// echoed in a response, or written to a column. Passwords are hashed by
// better-auth's own scrypt (better-auth/crypto — the same function the seed
// uses), never hand-rolled, and the plaintext never leaves the handler frame.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
  users,
} from "@juneflow/db/schema";
import type { Db } from "@juneflow/db/client";
import { isUniqueViolation, violatedConstraint } from "./routes/gl-post.js";

/** better-auth's provider id for an email+password credential (seed convention). */
const CREDENTIAL_PROVIDER = "credential";

/** `auth_verification.identifier` namespace for OUR password-reset tokens. */
export const RESET_IDENTIFIER_PREFIX = "pwreset:";

/** Reset-token lifetime. Short enough to bound a leaked-inbox window. */
export const RESET_TOKEN_TTL_MS = 30 * 60_000;

/** Token entropy: 32 random bytes = 256 bits. Never a counter, never a timestamp. */
const RESET_TOKEN_BYTES = 32;

/**
 * better-auth's own password bounds (emailAndPassword defaults). Enforced at the
 * reset boundary so a too-short password fails with a flat contract error here
 * rather than as an opaque better-auth rejection at the next sign-in.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/** The unique index auth_user.email trips on a cross-company collision (0008). */
const AUTH_USER_EMAIL_UNIQUE = "auth_user_email_unique";

/** One credentialed account: the auth_user identity + its tenant binding. */
export interface CredentialAccount {
  /** auth_user.id — the better-auth identity, NOT the dictionary user id. */
  readonly authUserId: string;
  /** auth_user.company_id — the tenant binding (null = misprovisioned). */
  readonly companyId: string | null;
  /** auth_user.email — the link to the dictionary `user` row. */
  readonly email: string;
}

/** A consumed (already deleted) reset record. */
export interface ConsumedResetToken {
  readonly account: CredentialAccount;
  /** The digest as it was STORED — for the caller's constant-time re-check. */
  readonly hash: string;
  readonly expiresAt: Date;
}

/**
 * auth_user.email is UNIQUE across the WHOLE platform (migration 0008), not per
 * company. Inviting an address another tenant already holds therefore cannot be
 * provisioned. Raised so the handler answers a flat 409 instead of a 500.
 * See BLOCKERS.md B-283 — making it unique per company needs a SACRED migration.
 */
export class CredentialEmailTakenError extends Error {
  constructor(email: string) {
    super(`a credential already exists for ${email}`);
    this.name = "CredentialEmailTakenError";
  }
}

/**
 * Everything that touches the auth_* tables, behind one seam so the whole
 * invite → forgot → reset → login chain is unit-testable with no database —
 * the same pattern app.ts already uses for `signIn` / `storage` / `quota`.
 */
export interface CredentialStore {
  /**
   * Create the auth_user + its "credential" auth_account for a NEW invite. The
   * account is created with a NULL password on purpose: better-auth refuses to
   * sign in an account with no password, so an invited user cannot log in until
   * they complete a reset — which is exactly the invite semantics users.ts
   * documents (status starts `invited`).
   * @throws CredentialEmailTakenError when the address is already credentialed.
   */
  provision(input: {
    companyId: string;
    email: string;
    name: string;
  }): Promise<CredentialAccount>;

  /** The credentialed account for `email`, or null when there is none. */
  findByEmail(email: string): Promise<CredentialAccount | null>;

  /**
   * Store `hash` as THE live reset token for the account, replacing any earlier
   * one (issuing a new token invalidates the previous one).
   */
  issueResetToken(authUserId: string, hash: string, expiresAt: Date): Promise<void>;

  /**
   * Atomically consume the record matching `hash` — single-use by construction.
   * Returns null when no such record exists (unknown, already used, or issued
   * against a different account).
   */
  consumeResetToken(hash: string): Promise<ConsumedResetToken | null>;

  /**
   * Set the account's credential password (better-auth scrypt) and drop every
   * live session it has, so a stolen session dies with the old password.
   */
  setPassword(authUserId: string, password: string): Promise<void>;

  /**
   * Flip the dictionary `user` row for this account from `invited` to `active`
   * — the second half of the invite state machine users.ts documents. Scoped by
   * an EXPLICIT company_id = account.companyId predicate, so it can never touch
   * another tenant's row, and it never revives a `blocked` user.
   */
  activateInvitedUser(account: CredentialAccount): Promise<void>;
}

/** A freshly minted token: the raw value plus the digest that gets stored. */
export interface NewResetToken {
  /** RAW — hand to the delivery seam and nowhere else. Never log or return it. */
  readonly token: string;
  /** SHA-256 hex digest — the only form that touches the database. */
  readonly hash: string;
}

/**
 * Mint an unguessable reset token: 256 bits from the CSPRNG, base64url-encoded.
 * Deliberately carries NO structure — no user id, no counter, no timestamp — so
 * possession of one token tells an attacker nothing about any other.
 */
export function newResetToken(): NewResetToken {
  const token = randomBytes(RESET_TOKEN_BYTES).toString("base64url");
  return { token, hash: hashResetToken(token) };
}

/** The stored form of a token. Digesting is what makes a DB read useless. */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time digest comparison. The SHA-256 indirection is the primary
 * defence (a timing oracle over a digest leaks nothing about the preimage);
 * this is the second layer, and it is load-bearing at the one place a store
 * implementation could return a record it matched loosely.
 */
export function resetHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // Length must be compared first (timingSafeEqual throws on a mismatch); the
  // digest length is fixed and public, so this leaks nothing.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** What a delivery adapter receives. `token` is a secret — treat it as one. */
export interface ResetDeliveryMessage {
  /** Recipient address (the account's own email). */
  readonly to: string;
  /** The RAW token. Never log it, never persist it, never put it in an error. */
  readonly token: string;
  /** Which flow issued it — an invite, a self-service forgot, or an admin reset. */
  readonly kind: "invite" | "forgot" | "admin";
  readonly expiresAt: Date;
}

/**
 * Where an issued token is delivered. Injected rather than imported so the API
 * keeps no mail dependency and no startup credential handling of its own.
 *
 * NOT WIRED IN THIS SLICE, deliberately. apps/api does NOT depend on
 * @juneflow/notifications (checked: nothing in the workspace does — the package
 * has no dependents), and that package ships no concrete SmtpTransport either
 * (packages/notifications/src/adapters/email.ts header → BLOCKERS.md B-269:
 * Node has no built-in SMTP client and the workspace has no mail library, so the
 * wire half is an open stack decision). Wiring it would mean adding a dependency
 * AND inventing startup config for a transport that does not exist — a guess.
 * The endpoints therefore issue real tokens and hand them to this seam, and
 * index.ts warns at boot that nothing is listening. To wire it later:
 *
 *   1. add "@juneflow/notifications": "workspace:*" to apps/api/package.json
 *   2. build the adapter once at boot:
 *        const email = createEmailAdapter({
 *          from: loadNotificationsConfig().email.from,
 *          transport: <the SmtpTransport chosen in B-269>,
 *        });
 *   3. pass buildApp({ ..., deliverReset: (m) => email.send({
 *        to: m.to, title: <i18n subject key>, body: <link + m.token> }) })
 *
 * Step 3's copy must come from an existing i18n key — no invented strings.
 */
export type ResetDelivery = (message: ResetDeliveryMessage) => Promise<void> | void;

/**
 * The default: deliver nowhere. Chosen over throwing so POST /auth/forgot keeps
 * its uniform 200 (a throw would turn "this address exists" into a 500 — an
 * enumeration oracle). index.ts warns at boot so the silence is never a surprise.
 */
export const noopResetDelivery: ResetDelivery = () => {};

/** Production CredentialStore over the base Drizzle handle. */
export class DbCredentialStore implements CredentialStore {
  /** The un-scoped base handle — PRIVATE. Never returned, never on `request`. */
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  async provision(input: {
    companyId: string;
    email: string;
    name: string;
  }): Promise<CredentialAccount> {
    const authUserId = randomUUID();
    try {
      await this.#db.transaction(async (tx) => {
        await tx.insert(authUsers).values({
          id: authUserId,
          name: input.name,
          email: input.email,
          emailVerified: false,
          companyId: input.companyId,
        });
        // password: null — an invited account cannot sign in until it is reset.
        await tx.insert(authAccounts).values({
          id: randomUUID(),
          accountId: authUserId,
          providerId: CREDENTIAL_PROVIDER,
          userId: authUserId,
          password: null,
        });
      });
    } catch (err) {
      // B-263: 23505 says "SOME unique constraint" — gate on the NAME too, or a
      // future index on these tables would silently inherit the 409.
      if (
        isUniqueViolation(err) &&
        violatedConstraint(err) === AUTH_USER_EMAIL_UNIQUE
      ) {
        throw new CredentialEmailTakenError(input.email);
      }
      throw err;
    }
    return { authUserId, companyId: input.companyId, email: input.email };
  }

  async findByEmail(email: string): Promise<CredentialAccount | null> {
    const rows = await this.#db
      .select()
      .from(authUsers)
      .where(eq(authUsers.email, email))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return { authUserId: row.id, companyId: row.companyId, email: row.email };
  }

  async issueResetToken(
    authUserId: string,
    hash: string,
    expiresAt: Date,
  ): Promise<void> {
    const identifier = `${RESET_IDENTIFIER_PREFIX}${authUserId}`;
    await this.#db.transaction(async (tx) => {
      // Issuing a new token invalidates any earlier one for this account.
      await tx
        .delete(authVerifications)
        .where(eq(authVerifications.identifier, identifier));
      await tx.insert(authVerifications).values({
        id: randomUUID(),
        identifier,
        value: hash,
        expiresAt,
      });
    });
  }

  async consumeResetToken(hash: string): Promise<ConsumedResetToken | null> {
    // Single-use, atomically: only ONE transaction can delete the row, so a
    // replay (or a concurrent second use) returns zero rows. The guard is on
    // the mutating statement, never on a preceding SELECT (B-149).
    const deleted = await this.#db
      .delete(authVerifications)
      .where(
        and(
          eq(authVerifications.value, hash),
          like(authVerifications.identifier, `${RESET_IDENTIFIER_PREFIX}%`),
        ),
      )
      .returning();
    const row = deleted[0];
    if (!row) return null;

    const authUserId = row.identifier.slice(RESET_IDENTIFIER_PREFIX.length);
    const accounts = await this.#db
      .select()
      .from(authUsers)
      .where(eq(authUsers.id, authUserId))
      .limit(1);
    const account = accounts[0];
    // The token was live but its account is gone (deleted mid-flight) — nothing
    // to reset. The row is already consumed, which is the correct outcome.
    if (!account) return null;

    return {
      account: {
        authUserId: account.id,
        companyId: account.companyId,
        email: account.email,
      },
      hash: row.value,
      expiresAt: row.expiresAt,
    };
  }

  async setPassword(authUserId: string, password: string): Promise<void> {
    // better-auth's own scrypt — the format better-auth verifies against. Never
    // hand-rolled (same call the seed makes).
    const hashed = await hashPassword(password);
    await this.#db.transaction(async (tx) => {
      const updated = await tx
        .update(authAccounts)
        .set({ password: hashed, updatedAt: new Date() })
        .where(
          and(
            eq(authAccounts.userId, authUserId),
            eq(authAccounts.providerId, CREDENTIAL_PROVIDER),
          ),
        )
        .returning();
      if (updated.length === 0) {
        // No credential row yet (a pre-B-282 auth_user, or a provider-only
        // account) — create the credential rather than silently doing nothing.
        await tx.insert(authAccounts).values({
          id: randomUUID(),
          accountId: authUserId,
          providerId: CREDENTIAL_PROVIDER,
          userId: authUserId,
          password: hashed,
        });
      }
      // Every live session dies with the old password.
      await tx.delete(authSessions).where(eq(authSessions.userId, authUserId));
    });
  }

  async activateInvitedUser(account: CredentialAccount): Promise<void> {
    // No tenant binding → nothing safe to scope the update to. Fail closed.
    if (!account.companyId) return;
    await this.#db
      .update(users)
      .set({ status: "active", updatedAt: new Date() })
      .where(
        and(
          // EXPLICIT tenant predicate — a reset can never cross companies.
          eq(users.companyId, account.companyId),
          eq(users.email, account.email),
          // Only `invited` advances; a `blocked` user is never revived here.
          eq(users.status, "invited"),
        ),
      );
  }
}

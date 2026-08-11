// In-memory CredentialStore — TEST/DEV ONLY (B-282).
//
// NEVER default any app wiring to this: it keeps credentials in a process-local
// Map, so nothing survives a restart and nothing is shared between instances.
// buildApp deliberately defaults `credentials` to the REAL DbCredentialStore, so
// a test has to opt in explicitly (mirrors createFakeR2Storage in routes/files.ts).
//
// It exists so the whole invite → forgot → reset → login chain can be exercised
// end to end without a database, INCLUDING the parts a stub cannot fake
// convincingly: single-use consumption, expiry, and the password actually
// changing (signInWith below verifies against what setPassword stored, so a
// reset that silently did nothing fails the chain test rather than passing it).
import {
  CredentialEmailTakenError,
  type ConsumedResetToken,
  type CredentialAccount,
  type CredentialStore,
} from "./auth-provisioning.js";

interface FakeAccount {
  authUserId: string;
  companyId: string | null;
  email: string;
  /** null = provisioned but no password yet (an invite nobody has completed). */
  password: string | null;
  /** Live session tokens; setPassword must clear them. */
  sessions: string[];
}

interface FakeToken {
  authUserId: string;
  expiresAt: Date;
  /** The digest as stored — a test can corrupt it to probe the caller's check. */
  hash: string;
}

export class FakeCredentialStore implements CredentialStore {
  readonly accounts = new Map<string, FakeAccount>();
  readonly tokens = new Map<string, FakeToken>();
  /** Every activateInvitedUser call, in order — the tenant-scope assertion. */
  readonly activations: CredentialAccount[] = [];
  /** Every deprovision() call, in order — the invite-rollback assertion. */
  readonly deprovisioned: string[] = [];
  /** Set to make the next provision() throw (rollback / 409 paths). */
  provisionError: Error | null = null;
  /** Set to make the next issueResetToken() throw. */
  issueError: Error | null = null;
  /** Set to make the next deprovision() throw (compensator-failure path). */
  deprovisionError: Error | null = null;
  /** When set, tokens are issued already expired. */
  issueExpiredAt: Date | null = null;
  /** When set, consumeResetToken reports this digest instead of the real one. */
  corruptStoredHash: string | null = null;

  private seq = 0;

  /** Seed an already-credentialed account (a pre-existing user). */
  seed(account: {
    authUserId: string;
    companyId: string | null;
    email: string;
    password?: string | null;
    sessions?: string[];
  }): void {
    this.accounts.set(account.authUserId, {
      authUserId: account.authUserId,
      companyId: account.companyId,
      email: account.email,
      password: account.password ?? null,
      sessions: account.sessions ?? [],
    });
  }

  async provision(input: {
    companyId: string;
    email: string;
    name: string;
  }): Promise<CredentialAccount> {
    if (this.provisionError) throw this.provisionError;
    if (await this.findByEmail(input.email)) {
      throw new CredentialEmailTakenError(input.email);
    }
    const authUserId = `au-fake-${this.seq++}`;
    this.seed({ authUserId, companyId: input.companyId, email: input.email });
    return { authUserId, companyId: input.companyId, email: input.email };
  }

  async deprovision(authUserId: string): Promise<void> {
    if (this.deprovisionError) throw this.deprovisionError;
    this.accounts.delete(authUserId);
    for (const [k, t] of this.tokens) if (t.authUserId === authUserId) this.tokens.delete(k);
    this.deprovisioned.push(authUserId);
  }

  async findByEmail(email: string): Promise<CredentialAccount | null> {
    for (const a of this.accounts.values()) {
      if (a.email === email) {
        return { authUserId: a.authUserId, companyId: a.companyId, email: a.email };
      }
    }
    return null;
  }

  async issueResetToken(
    authUserId: string,
    hash: string,
    expiresAt: Date,
  ): Promise<void> {
    if (this.issueError) throw this.issueError;
    // Issuing replaces any earlier token for the account (same as the real store).
    for (const [k, t] of this.tokens) if (t.authUserId === authUserId) this.tokens.delete(k);
    this.tokens.set(hash, {
      authUserId,
      expiresAt: this.issueExpiredAt ?? expiresAt,
      hash,
    });
  }

  async consumeResetToken(hash: string): Promise<ConsumedResetToken | null> {
    const token = this.tokens.get(hash);
    if (!token) return null;
    // Single-use: gone the moment it is read, exactly like DELETE ... RETURNING.
    this.tokens.delete(hash);
    const account = this.accounts.get(token.authUserId);
    if (!account) return null;
    return {
      account: {
        authUserId: account.authUserId,
        companyId: account.companyId,
        email: account.email,
      },
      hash: this.corruptStoredHash ?? token.hash,
      expiresAt: token.expiresAt,
    };
  }

  async setPassword(authUserId: string, password: string): Promise<void> {
    const account = this.accounts.get(authUserId);
    if (!account) return;
    account.password = password;
    account.sessions = []; // every live session dies with the old password
  }

  async activateInvitedUser(account: CredentialAccount): Promise<void> {
    this.activations.push(account);
  }

  /**
   * Simulate a credential sign-in against what this store actually holds — the
   * last link of the chain. A null password (a provisioned-but-never-reset
   * invite) never signs in, which is the behaviour better-auth enforces for an
   * auth_account whose password column is NULL.
   */
  signInWith(email: string, password: string): FakeAccount | null {
    for (const a of this.accounts.values()) {
      if (a.email === email && a.password !== null && a.password === password) return a;
    }
    return null;
  }
}

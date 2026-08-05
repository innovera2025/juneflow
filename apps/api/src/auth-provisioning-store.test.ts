// G3 unit tests (PLAN.md §9) — the PRODUCTION DbCredentialStore (B-282).
//
// WHY THIS FILE EXISTS. The first cut of B-282 tested the reset chain only
// through FakeCredentialStore: every route test injected the fake, so "single
// use", "sessions die with the password" and "an invited account has no
// password" were properties of a Map, not of the code that ships. Five
// production security properties could be deleted at once — DELETE…RETURNING
// downgraded to a plain SELECT (an infinitely replayable token), the session
// delete removed (a stolen bearer survives a reset), `password: null` replaced
// with a known string (every invited account shipping with an attacker-known
// password), and the B-263 constraint-name gate dropped — and the whole 1294-test
// suite still passed. Tests that survive their own subject's removal are
// decoration.
//
// HOW IT TESTS THE REAL THING WITHOUT A DATABASE. DbCredentialStore takes a real
// Drizzle handle, so the handle here is a REAL `drizzle()` over a fake pg client
// that records every statement instead of executing it. Every assertion below is
// therefore against the SQL the production store actually emits — statement
// text, bound parameter values, and transaction boundaries (begin/commit/
// rollback) — not against a stub of the store's own shape. A live-PG variant
// (the b097/b163 precedent) would add "and Postgres agrees"; what it could not
// add is this file's ability to run on every CI push with no compose stack.
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@juneflow/db/schema";
import type { Db } from "@juneflow/db/client";
import {
  CredentialEmailTakenError,
  DbCredentialStore,
  hashResetToken,
  newResetToken,
  RESET_IDENTIFIER_PREFIX,
} from "./auth-provisioning.js";

const COMPANY = "11111111-1111-1111-1111-111111111111";
const EMAIL = "napha@juneflow.co.th";

interface Statement {
  text: string;
  values: unknown[];
}

/** A pg error as the driver raises it (SQLSTATE + the violated index NAME). */
function uniqueViolation(constraint: string): Error & { code: string; constraint: string } {
  return Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), {
    code: "23505",
    constraint,
  });
}

// Drizzle asks the driver for `rowMode: "array"`, so a stubbed result row is a
// POSITIONAL array in the statement's own column order — these two are the only
// shapes this file needs to hand back.
/** auth_user: id, name, email, email_verified, image, company_id, created_at, updated_at. */
const authUserRow = (id: string, email: string, companyId: string | null) => [
  id, "นภา ศรีสุข", email, true, null, companyId, new Date(0), new Date(0),
];
/** auth_verification: id, identifier, value, expires_at, created_at, updated_at. */
const verificationRow = (identifier: string, digest: string, expiresAt: Date) => [
  "v-1", identifier, digest, expiresAt, new Date(0), new Date(0),
];

/**
 * A real Drizzle handle over a fake pg client. `reply` decides what each
 * statement returns (or throws); every statement is appended to `log` exactly as
 * the driver would receive it.
 */
function recordingDb(reply: (text: string) => unknown[] | Error = () => []) {
  const log: Statement[] = [];
  const client = {
    query: async (config: unknown, params?: unknown[]) => {
      const text =
        typeof config === "string" ? config : ((config as { text: string }).text ?? "");
      log.push({ text, values: params ?? [] });
      const rows = reply(text);
      if (rows instanceof Error) throw rows;
      return { rows, rowCount: rows.length, command: "", oid: 0, fields: [] };
    },
    connect: async () => client,
    release: () => {},
  };
  const db = drizzle(client as never, { schema }) as unknown as Db;
  return { db, log };
}

/** The statements, in order, as bare SQL text. */
const texts = (log: Statement[]): string[] => log.map((s) => s.text);
/** The one statement matching `pattern` (fails loudly when 0 or 2+ match). */
function only(log: Statement[], pattern: RegExp): Statement {
  const hits = log.filter((s) => pattern.test(s.text));
  expect(hits, `expected exactly one statement matching ${pattern}`).toHaveLength(1);
  return hits[0]!;
}

/**
 * Assert `log` is ONE transaction that contains every statement in `inside`.
 *
 * WHY THIS IS NOT `log[0] === "begin" && log.at(-1) === "commit"`. That
 * endpoints-only pair is satisfied just as well by `[begin … commit begin …
 * commit]`, so a method split into two sequential transactions passed it
 * unchanged — the three tests that named atomicity proved only that the log
 * starts and ends on a boundary. Counting the boundaries is what fails a split:
 * two `begin`s, two `commit`s. The window check then pins each named statement
 * strictly BETWEEN them, so moving one out of the transaction fails too.
 */
function expectOneTransaction(log: Statement[], inside: RegExp[]): void {
  const order = texts(log);
  expect(order.filter((t) => t === "begin"), "exactly one begin").toHaveLength(1);
  expect(order.filter((t) => t === "commit"), "exactly one commit").toHaveLength(1);
  expect(order.filter((t) => t === "rollback"), "no rollback").toHaveLength(0);
  const opened = order.indexOf("begin");
  const closed = order.indexOf("commit");
  for (const pattern of inside) {
    const at = order.findIndex((t) => pattern.test(t));
    expect(at, `${pattern} must be issued after begin`).toBeGreaterThan(opened);
    expect(at, `${pattern} must be issued before commit`).toBeLessThan(closed);
  }
}

// ---------------------------------------------------------------------------
describe("DbCredentialStore.provision", () => {
  it("creates auth_user + a PASSWORDLESS credential account in ONE transaction", async () => {
    const { db, log } = recordingDb();
    const account = await new DbCredentialStore(db).provision({
      companyId: COMPANY,
      email: EMAIL,
      name: "นภา ศรีสุข",
    });

    // Both inserts inside ONE begin/commit — never a half-created identity. A
    // split here (auth_user in tx1, auth_account in tx2) would leave, on a
    // failure between the commits, an auth_user holding the address under the
    // platform-wide auth_user_email_unique with no credential and no dictionary
    // row: users.ts compensates by deleting the dictionary row and does not call
    // deprovision, because it is written on the assumption provision is atomic.
    expectOneTransaction(log, [/insert into "auth_user"/, /insert into "auth_account"/]);

    const identity = only(log, /insert into "auth_user"/);
    expect(identity.values).toContain(account.authUserId);
    expect(identity.values).toContain(EMAIL);
    expect(identity.values).toContain(COMPANY);

    // THE property: the credential ships with a NULL password. better-auth
    // refuses to sign in an account whose password column is null, so an invite
    // cannot be used until it is completed. A literal here — any literal — would
    // mean every invited account shipped with a password the writer knows.
    const credential = only(log, /insert into "auth_account"/);
    expect(credential.values).toEqual([
      expect.any(String), // id
      account.authUserId, // account_id
      "credential", // provider_id
      account.authUserId, // user_id
      null, // password
    ]);
  });

  it("maps a auth_user_email_unique violation to CredentialEmailTakenError, and rolls back", async () => {
    const { db, log } = recordingDb((text) =>
      /insert into "auth_user"/.test(text) ? uniqueViolation("auth_user_email_unique") : [],
    );

    await expect(
      new DbCredentialStore(db).provision({ companyId: COMPANY, email: EMAIL, name: "นภา" }),
    ).rejects.toBeInstanceOf(CredentialEmailTakenError);
    expect(texts(log)).toContain("rollback");
  });

  it("RETHROWS a 23505 on any OTHER constraint (B-263 — 23505 does not say which)", async () => {
    // Gating on SQLSTATE alone would silently answer "that address is taken" for
    // a future unique index on either table.
    const { db } = recordingDb((text) =>
      /insert into "auth_account"/.test(text) ? uniqueViolation("auth_account_pkey") : [],
    );

    const err = await new DbCredentialStore(db)
      .provision({ companyId: COMPANY, email: EMAIL, name: "นภา" })
      .then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    expect(err).not.toBeInstanceOf(CredentialEmailTakenError);
  });
});

// ---------------------------------------------------------------------------
describe("DbCredentialStore.findByEmail", () => {
  it("reads auth_user by the exact address and maps the tenant binding", async () => {
    const { db, log } = recordingDb(() => [authUserRow("au-1", EMAIL, COMPANY)]);
    const account = await new DbCredentialStore(db).findByEmail(EMAIL);

    expect(only(log, /from "auth_user"/).values).toContain(EMAIL);
    expect(account).toEqual({ authUserId: "au-1", companyId: COMPANY, email: EMAIL });
  });

  it("answers null when there is no credential for the address", async () => {
    const { db } = recordingDb(() => []);
    expect(await new DbCredentialStore(db).findByEmail(EMAIL)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("DbCredentialStore.issueResetToken", () => {
  it("replaces any earlier token and stores the DIGEST ONLY, namespaced, in one transaction", async () => {
    const { db, log } = recordingDb();
    const { token, hash } = newResetToken();
    const expiresAt = new Date("2026-08-05T10:00:00.000Z");
    await new DbCredentialStore(db).issueResetToken("au-1", hash, expiresAt);

    expect(texts(log)[0]).toBe("begin");
    expect(texts(log).at(-1)).toBe("commit");
    // The previous token for this account dies first — issuing a new link
    // invalidates the old one.
    const purge = only(log, /delete from "auth_verification"/);
    expect(purge.values).toEqual([`${RESET_IDENTIFIER_PREFIX}au-1`]);
    expect(texts(log).indexOf(purge.text)).toBeLessThan(
      texts(log).findIndex((t) => /insert into "auth_verification"/.test(t)),
    );

    const stored = only(log, /insert into "auth_verification"/);
    expect(stored.values).toContain(hash);
    expect(stored.values).toContain(expiresAt.toISOString());
    // A database read must not be able to reset anyone: the raw token is nowhere.
    expect(JSON.stringify(stored.values)).not.toContain(token);
  });
});

// ---------------------------------------------------------------------------
describe("DbCredentialStore.consumeResetToken", () => {
  const row = (hash: string) =>
    verificationRow(`${RESET_IDENTIFIER_PREFIX}au-1`, hash, new Date("2026-08-05T10:00:00.000Z"));

  it("consumes with DELETE … RETURNING — never a SELECT-then-delete", async () => {
    // THE single-use property, and the one a fake cannot prove. Under READ
    // COMMITTED exactly one transaction can delete the row, so a replay (or a
    // concurrent second use) returns zero rows. A SELECT here — even followed by
    // a delete — makes the token replayable in the window between the two
    // statements (the B-149 lesson: guard the MUTATING statement).
    const hash = hashResetToken("some-token");
    const { db, log } = recordingDb((text) =>
      /delete from "auth_verification"/.test(text)
        ? [row(hash)]
        : [authUserRow("au-1", EMAIL, COMPANY)],
    );

    await new DbCredentialStore(db).consumeResetToken(hash);

    const consume = log[0]!;
    expect(consume.text).toMatch(/^delete from "auth_verification"/);
    expect(consume.text).toMatch(/returning/);
    // Nothing read auth_verification — the delete IS the read.
    expect(texts(log).filter((t) => /select .* from "auth_verification"/.test(t))).toEqual([]);
    // Matched on the exact digest, and only inside our own namespace.
    expect(consume.values).toEqual([hash, `${RESET_IDENTIFIER_PREFIX}%`]);
  });

  it("answers null for an already-consumed token and never looks the account up", async () => {
    const { db, log } = recordingDb(() => []);
    expect(await new DbCredentialStore(db).consumeResetToken("dead")).toBeNull();
    expect(texts(log).filter((t) => /from "auth_user"/.test(t))).toEqual([]);
  });

  it("answers null when the token is live but its account is gone", async () => {
    const hash = hashResetToken("some-token");
    const { db } = recordingDb((text) =>
      /delete from "auth_verification"/.test(text) ? [row(hash)] : [],
    );
    expect(await new DbCredentialStore(db).consumeResetToken(hash)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("DbCredentialStore.setPassword", () => {
  /** better-auth's scrypt output: <16-byte hex salt>:<64-byte hex key>. */
  const SCRYPT = /^[0-9a-f]{32}:[0-9a-f]{128}$/;

  it("writes a better-auth scrypt hash — never the plaintext", async () => {
    const { db, log } = recordingDb((text) =>
      /update "auth_account"/.test(text) ? [{ id: "acct-1" }] : [],
    );
    await new DbCredentialStore(db).setPassword("au-1", "correct-horse");

    const write = only(log, /update "auth_account"/);
    expect(write.values[0]).toMatch(SCRYPT);
    expect(JSON.stringify(log)).not.toContain("correct-horse");
    expect(write.values).toContain("au-1");
    expect(write.values).toContain("credential");
  });

  it("kills every live session in the SAME transaction as the password write", async () => {
    // A password reset that leaves sessions alive means a stolen bearer token
    // survives the very reset performed to revoke it.
    const { db, log } = recordingDb((text) =>
      /update "auth_account"/.test(text) ? [{ id: "acct-1" }] : [],
    );
    await new DbCredentialStore(db).setPassword("au-1", "correct-horse");

    // ONE transaction, not two: a crash between two commits would leave the new
    // password live with every old session still valid — the stolen bearer the
    // session kill exists to revoke.
    expectOneTransaction(log, [/update "auth_account"/, /delete from "auth_session"/]);
    const order = texts(log);
    const kill = only(log, /delete from "auth_session"/);
    expect(kill.values).toEqual(["au-1"]);
    expect(order.indexOf(kill.text)).toBeGreaterThan(
      order.findIndex((t) => /update "auth_account"/.test(t)),
    );
  });

  it("creates the credential row when the account has none yet (pre-B-282 auth_user)", async () => {
    // The UPDATE matches nothing → the reset must still leave a usable password
    // rather than silently succeeding with none.
    const { db, log } = recordingDb(() => []);
    await new DbCredentialStore(db).setPassword("au-1", "correct-horse");

    const created = only(log, /insert into "auth_account"/);
    expect(created.values).toContain("credential");
    expect(created.values).toContain("au-1");
    expect(created.values.some((v) => typeof v === "string" && SCRYPT.test(v))).toBe(true);
    expect(JSON.stringify(created.values)).not.toContain("correct-horse");
  });
});

// ---------------------------------------------------------------------------
describe("DbCredentialStore.deprovision", () => {
  it("removes token, sessions, credential and identity in ONE transaction", async () => {
    // The compensator for a failed invite. Without it the auth_user survives a
    // rollback and auth_user_email_unique is platform-wide, so that address can
    // never be invited again anywhere (B-283) with no endpoint able to clear it.
    const { db, log } = recordingDb();
    await new DbCredentialStore(db).deprovision("au-1");

    // All four deletes in ONE transaction: a compensator that half-runs leaves
    // exactly the orphan it was added to clear.
    expectOneTransaction(log, [
      /delete from "auth_verification"/,
      /delete from "auth_session"/,
      /delete from "auth_account"/,
      /delete from "auth_user"/,
    ]);
    const order = texts(log);
    expect(only(log, /delete from "auth_verification"/).values).toEqual([
      `${RESET_IDENTIFIER_PREFIX}au-1`,
    ]);
    expect(only(log, /delete from "auth_session"/).values).toEqual(["au-1"]);
    expect(only(log, /delete from "auth_account"/).values).toEqual(["au-1"]);
    expect(only(log, /delete from "auth_user"/).values).toEqual(["au-1"]);
    // Children before the identity they reference (FK order).
    expect(order.findIndex((t) => /delete from "auth_account"/.test(t))).toBeLessThan(
      order.findIndex((t) => /delete from "auth_user"/.test(t)),
    );
  });
});

// ---------------------------------------------------------------------------
describe("DbCredentialStore.activateInvitedUser", () => {
  it("pins the update to the token's own company, and to status='invited'", async () => {
    const { db, log } = recordingDb();
    await new DbCredentialStore(db).activateInvitedUser({
      authUserId: "au-1",
      companyId: COMPANY,
      email: EMAIL,
    });

    const flip = only(log, /update "user"/);
    expect(flip.text).toMatch(/"company_id" = \$/);
    expect(flip.text).toMatch(/"email" = \$/);
    expect(flip.text).toMatch(/"status" = \$/);
    expect(flip.values).toContain(COMPANY);
    expect(flip.values).toContain(EMAIL);
    expect(flip.values).toContain("invited");
    expect(flip.values).toContain("active");
  });

  it("issues NO statement at all when the account carries no tenant binding", async () => {
    const { db, log } = recordingDb();
    await new DbCredentialStore(db).activateInvitedUser({
      authUserId: "au-1",
      companyId: null,
      email: EMAIL,
    });
    expect(log).toEqual([]);
  });
});

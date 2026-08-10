// GET + POST /users — the tenant's users (P1-BE-09, B-051; master.jsx
// UsersPermissions/UserAddForm L895-1116, SACRED-EDITS-QUEUE §4b/§4c).
//
// Contract (openapi.yaml /users): GET → the B-014 list envelope of opaque Entity
// rows; POST → 201 EntityCreated (an email invite — the new user starts
// `invited` and sets their own password later). Field semantics are locked by
// B-051 (schema `user`, platform.ts). The wire row is
//   {id, name, email, username, role_id, status, department}
// where
//   username   = DERIVED from email (the local part before "@") — the mock uses
//                the email AS the username ("อีเมล (ใช้เป็น Username)" /
//                "ระบบจะ gen Username จากอีเมล", master.jsx:1022/1044); email is
//                the stored identity, so username is a derived field (no column),
//                exactly like the other derived counts here (C10 pattern).
//   status     = active | blocked | invited. POST always starts `invited`
//                (master.jsx:1033-1045: the invite is emailed and the user sets
//                their own password) — never trust a client-supplied status.
//   department = one of CONS|PROC|FIN|SLS|ADM|WH (master.jsx:1025) or null.
//
// `user` + `role` carry their OWN company_id column (platform.ts), so they are
// read/written through the scoped TenantDb.select()/insert() door (auto-injects /
// force-sets WHERE|SET company_id = <this tenant>) — a bare read is impossible,
// so another tenant's users can never leak. email is unique within a company
// (user_company_email_uq), so a duplicate invite answers 409. Without a resolved
// tenant, request.db is absent and the handler answers 401.
//
// B-282 — WHAT THE INVITE USED TO LEAVE UNDONE. This handler wrote the
// dictionary `user` row and stopped there: no better-auth credential was ever
// created and nothing was sent, so "the user sets their own password later" had
// no mechanism behind it and an invited user could never log in. POST now also
// provisions the auth_user + a passwordless "credential" auth_account and issues
// a reset token, which the invitee redeems through POST /auth/reset (that route
// also flips this row invited → active). The token goes to the delivery seam
// and is never logged or returned in the 201.
//
// filter/page query params are accepted per the contract but not interpreted.
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { users, roles, subscriptions } from "@juneflow/db/schema";
import {
  canonicalEmail,
  CredentialEmailTakenError,
  newResetToken,
  RESET_TOKEN_TTL_MS,
  type CredentialStore,
  type ResetDelivery,
} from "../auth-provisioning.js";
import { listEnvelope } from "./list-envelope.js";
import { loadCaller, MANAGEMENT_MODULE, permAllowed } from "./authz.js";
import { isWithinQuota, QuotaGuard, sendQuotaExceeded } from "../plugins/quota.js";

export interface UsersRouteOptions {
  /** Credential/reset seam (prod: DbCredentialStore over the base handle). */
  credentials: CredentialStore;
  /** Invite-token delivery seam (default: no-op — see auth-provisioning.ts). */
  deliverReset: ResetDelivery;
  /** B-369: the seat meter. `users` was the one SOLD dimension with no call site. */
  quota: QuotaGuard;
}

/**
 * B-363 — the seat allowance was exhausted under the lock, so this invite is
 * refused. Thrown from INSIDE the seat transaction so the `user` insert in the
 * same block rolls back with it; the handler answers the canonical 402.
 */
class SeatQuotaExceededError extends Error {
  constructor() {
    super("no free seat under the seat lock");
    this.name = "SeatQuotaExceededError";
  }
}

/** Department codes accepted on invite (master.jsx:1025 UserAddForm dropdown). */
const DEPARTMENTS = ["CONS", "PROC", "FIN", "SLS", "ADM", "WH"] as const;
type Department = (typeof DEPARTMENTS)[number];

type UserRow = typeof users.$inferSelect;

/** username = the email local part (before "@"); "" if the email has no local part. */
function usernameFromEmail(email: string): string {
  return email.split("@")[0] ?? "";
}

/** The opaque Entity wire shape for one user (username derived from email). */
function toWire(u: UserRow): Record<string, unknown> {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    username: usernameFromEmail(u.email),
    role_id: u.roleId,
    status: u.status,
    department: u.department,
  };
}

/**
 * Normalize a department input to a code. Tolerates the mock's full label
 * ("CONS — ฝ่ายก่อสร้าง") by taking the leading token. Returns the code, null
 * when absent, or "invalid" when a value is present but not one of the 6 codes.
 */
function parseDepartment(value: unknown): Department | null | "invalid" {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const code = value.trim().split(/[\s—–-]/)[0]?.toUpperCase();
  return (DEPARTMENTS as readonly string[]).includes(code ?? "")
    ? (code as Department)
    : "invalid";
}

/** Register GET + POST /users on the given (already /api/v1-prefixed) scope. */
export function registerUsersRoute(
  app: FastifyInstance,
  options: UsersRouteOptions,
): void {
  app.get("/users", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    // user → own company_id (scoped select).
    const rows = await db.select(users);
    return reply.code(200).send(listEnvelope(rows.map(toWire)));
  });

  app.post("/users", async (request, reply) => {
    const db = request.db;
    if (!db) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "Missing tenant context",
      });
    }

    // F1: inviting/creating a user (and assigning it a role) is master-data
    // administration — require the caller's role to carry master.create.
    // Fail-closed: any caller whose perms cannot be resolved is denied, so a
    // low-privilege member can no longer create a backdoor admin.
    const caller = await loadCaller(request);
    if (!permAllowed(caller?.perms, MANAGEMENT_MODULE, "create")) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: `requires ${MANAGEMENT_MODULE}.create permission`,
      });
    }

    const body = (request.body ?? {}) as Record<string, unknown>;

    // name: accept `name`, else combine first/last (master.jsx UserAddForm).
    const first = typeof body.first === "string" ? body.first.trim() : "";
    const last = typeof body.last === "string" ? body.last.trim() : "";
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : [first, last].filter(Boolean).join(" ");
    // Canonical account form (auth-provisioning.ts canonicalEmail). NOT
    // cosmetic: the same address must resolve to ONE identity across the
    // dictionary `user` row, the globally-unique auth_user.email, login and
    // forgot — every one of which now uses this same helper. It also makes the
    // duplicate pre-check below correct: before this, "A@x.co" and "a@x.co"
    // both inserted.
    const email = canonicalEmail(body.email);
    const roleId =
      typeof body.role_id === "string"
        ? body.role_id
        : typeof body.roleId === "string"
          ? body.roleId
          : "";

    // Validation mirrors UserAddForm.canSave (master.jsx:1011): name + email(@)
    // + role are required.
    if (!name) {
      return reply.code(400).send({ code: "VALIDATION", message: "name is required" });
    }
    if (!email.includes("@")) {
      return reply.code(400).send({ code: "VALIDATION", message: "a valid email is required" });
    }
    if (!roleId) {
      return reply.code(400).send({ code: "VALIDATION", message: "role_id is required" });
    }

    const department = parseDepartment(body.department ?? body.dept);
    if (department === "invalid") {
      return reply.code(400).send({
        code: "VALIDATION",
        message: `department must be one of ${DEPARTMENTS.join("|")}`,
      });
    }

    // role_id must be a real role of THIS tenant (scoped select — a foreign
    // tenant's role id never matches).
    const roleRows = await db.select(roles, eq(roles.id, roleId));
    if (roleRows.length === 0) {
      return reply.code(400).send({ code: "VALIDATION", message: "role_id is not a role of this tenant" });
    }

    // Email is unique within the company (user_company_email_uq) — pre-check for
    // a friendly 409 rather than a raw constraint error.
    const dup = await db.select(users, eq(users.email, email));
    if (dup.length > 0) {
      return reply.code(409).send({
        code: "DUPLICATE_EMAIL",
        message: `a user with email ${email} already exists`,
      });
    }

    // -----------------------------------------------------------------------
    // B-369 — THE SEAT METER. `users` is a SOLD dimension that never turned.
    // -----------------------------------------------------------------------
    // `quota.check(` resolved to exactly three call sites before this round —
    // ai-qto.ts (ai_per_month), projects.ts (projects) and files.ts (storage_gb).
    // There was NO `users` site at all: the package tables price a seat cap
    // (starter 5 / pro 25 / business 60 / enterprise unlimited, PACKAGE-RULES §1),
    // the resolver has always been able to count seats
    // (subscription-quota.ts #used), and nothing ever asked it.
    //
    // WHERE THIS SITS, and each neighbour is deliberate:
    //   · AFTER the master.create authz gate — a caller who may not administer
    //     users gets 403, not a 402 inviting them to buy seats they cannot use.
    //   · AFTER validation and the duplicate check — a malformed body is still
    //     400 and re-inviting an existing member is still the more specific 409.
    //   · BEFORE the `user` INSERT and before credential provisioning — this
    //     handler writes a dictionary row AND provisions an auth_user +
    //     auth_account + reset token across two handles that cannot share a
    //     transaction (B-282), so a 402 must land before any of it exists.
    //
    // CONTRACT GAP, REPORTED NOT PAPERED OVER: openapi.yaml declares only 201 and
    // 401 for POST /users, so this 402 is an UNDECLARED status — as are the 400,
    // 403 and 409 the handler already returns. Declaring them is a SACRED
    // openapi.yaml edit and is filed for Wei (B-370) rather than taken here. The
    // body is the contract's canonical QuotaExceededError shape either way
    // (plugins/quota.ts sendQuotaExceeded), so a client that handles 402 anywhere
    // handles it here.
    //
    // DEPLOYMENT — CORRECTED (B-363). The note that stood here said this check
    // "CANNOT fail in dev or in CI" because SubscriptionQuotaResolver is
    // production-only. THE PREMISE IS FALSE FOR THE STACK THE GATES RUN ON:
    // infra/docker-compose.yml sets `NODE_ENV=production` on the api service, so
    // index.ts:52 selects the REAL resolver on every compose run, and the gate
    // fired a real 402 in that stack. Harmless TODAY only because the seeded
    // tenant sits at 12 users of 25 — a seeded tenant near its cap would break
    // G4/G5 with a 402 nobody expected. It fails first wherever the resolver is
    // real, and that includes here. `packages/db/src/quota-preflight.ts` reports
    // which tenants would be refused. Also note `#used` counts EVERY user row
    // including `blocked` and `invited`; whether a blocked ex-employee should
    // consume a paid seat is a billing definition, not an implementer's call, and
    // is on B-370.
    //
    // -----------------------------------------------------------------------
    // B-363 — THE SEAT DECISION MOVES INSIDE A TRANSACTION, ONTO A LOCKED ROW
    // -----------------------------------------------------------------------
    // B-369 shipped `quota.check` -> INSERT with nothing between them, which is a
    // TOCTOU on a PRICED dimension: two invites arriving at limit−1 both read
    // `used = limit − 1`, both pass, and both insert. Measured live — 4 concurrent
    // invites against exactly one free seat, separate OS processes on a shared
    // barrier: `cap=16 before=15 after=17`, two 201s for one seat, and the tenant
    // keeps the extra seat forever.
    //
    // ai-qto.ts consumeAiCredit solved exactly this in the SAME commit and carries
    // 20 lines on why an upsert is not enough (the DECISION, not just the write,
    // has to be inside), and it holds at 3/3 exactly-one-winner. Only one of the
    // two sold dimensions got the treatment; this is the other one.
    //
    // WHY THE SUBSCRIPTION ROW IS THE LOCK. ai_usage has a per-(company, month) row
    // to lock; seats have no meter row at all — `used` is `count(*)` over `user`,
    // and `SELECT … FOR UPDATE` locks rows that EXIST, so it cannot serialise two
    // INSERTs of DIFFERENT users (there is no predicate locking under READ
    // COMMITTED). The lock therefore has to be taken on a row that already exists
    // and that both writers must pass through: the tenant's `subscription` — the
    // row that CARRIES the seat allowance (`seats`, the override this same round
    // wired up). Coarser than per-seat: two invites into one tenant serialise
    // against each other. Accepted deliberately at human operating pace, and named
    // rather than hidden.
    //
    // THE SPLIT — WHICH HALF COMES FROM WHERE, and it is not a style choice.
    // `quota.check` runs BEFORE the transaction and supplies the LIMIT: the
    // resolver owns that precedence (`subscription.seats ?? package.limits.users`,
    // -1 = unlimited, fail-closed when unresolvable) and re-deciding it here would
    // be a second source of truth for a billing rule. The USED count — the only
    // racy half — is re-read INSIDE the transaction, on the TRANSACTION's own
    // handle, and it is `count(*)` over this tenant's `user` rows: the same
    // one-liner subscription-quota.ts #used runs for this key.
    //
    // THE RESOLVER MUST NOT BE CALLED INSIDE THE TRANSACTION, and this is measured,
    // not theoretical. SubscriptionQuotaResolver builds its own TenantDb over the
    // ROOT POOLED handle, so calling it here would make a transaction that already
    // holds one pooled connection wait for a SECOND one. At 12 concurrent invites
    // that deadlocks the pool outright: the first cut of this fix did exactly that
    // and hung — `pg_stat_activity` showed 11 active + 1 "idle in transaction",
    // every connection held by a request waiting for a connection. Nothing about
    // the seat rule requires a second connection, so it does not take one.
    //
    // A LIMIT READ A MOMENT EARLIER IS SAFE. It is configuration, not a counter,
    // and its only writer (PUT /admin/subscribers/{id}/package) UPDATEs the same
    // subscription row this transaction holds FOR UPDATE — so an admin raising the
    // cap is serialised against us either way, and the worst case is an invite
    // judged by a cap that was true a millisecond ago.
    //
    // NO SUBSCRIPTION ROW = NO LOCK TAKEN, and that is safe rather than a hole: a
    // tenant with no subscription has no resolvable package, so the real resolver
    // returns `limit 0, used 1` and every invite is 402 before the insert; and
    // where the resolver is the unlimited/dev stub there is no cap to overrun.
    //
    // THE HAZARD, written down because it is invisible at the call site: this is
    // correct BECAUSE READ COMMITTED takes a fresh snapshot per statement, so the
    // count issued after the lock wait sees the winner's commit. Under REPEATABLE
    // READ or SERIALIZABLE the snapshot is fixed and THIS GUARD SILENTLY STOPS
    // WORKING — the same warning tenant-db.ts and ai-qto.ts carry, for the same
    // reason.
    //
    // WHAT IS STILL OUTSIDE, and why: credential provisioning (auth_user +
    // auth_account + reset token) sits behind a different handle that cannot share
    // this transaction (B-282), so it stays after the commit with its own
    // hand-rollback below. The seat and the `user` row are what must be atomic.
    //
    // NO platform-wide duplicate pre-check here, deliberately — see B-283.
    // auth_user.email is unique across the WHOLE platform (migration 0008), so a
    // first cut of B-282 asked `credentials.findByEmail(email)` before inserting
    // and answered 409. That would have been a NEW behaviour this slice is not
    // entitled to ship: an address tenant A holds could no longer be invited by
    // tenant B at all — and a construction ERP genuinely has one subcontractor PM
    // working for two companies — while the 409 echoing the address turned an
    // authenticated tenant admin into a cross-tenant existence oracle that did not
    // exist before. Narrowing the index to UNIQUE(company_id, email) needs a SACRED
    // migration, so the decision is Wei's. Until then this endpoint keeps its
    // PER-COMPANY behaviour: the scoped duplicate check above is the only rule, and
    // a cross-tenant address is invited exactly as it was before B-282 — see the
    // CredentialEmailTakenError branch below.
    // The LIMIT (resolver precedence) + the fast-fail 402 for the ordinary case.
    const seats = await options.quota.check(db.companyId, "users");
    if (!seats.ok) {
      return sendQuotaExceeded(reply, "users", options.quota.upgradeUrl);
    }

    let created: UserRow | undefined;
    try {
      created = await db.transaction(async (tx) => {
        // The lock. Every row it returns is held for the rest of this transaction;
        // a tenant has one subscription in practice, and locking all of them is
        // strictly safer than picking one.
        await tx.selectForUpdate(subscriptions);
        // The DECISION, taken UNDER the lock on the TRANSACTION's own handle: the
        // count re-read here is the winner's committed one, so a loser at the cap
        // refuses instead of taking a seat that is already sold.
        const used = (await tx.select(users)).length;
        if (!isWithinQuota(seats.limit, used)) throw new SeatQuotaExceededError();
        const [row] = await tx
          .insert(users, {
            name,
            email,
            roleId,
            department,
            // invite flow: the user is `invited` until they set their own password.
            status: "invited",
          })
          .returning();
        return row!;
      });
    } catch (err) {
      if (err instanceof SeatQuotaExceededError) {
        return sendQuotaExceeded(reply, "users", options.quota.upgradeUrl);
      }
      throw err;
    }

    // Provision the credential the invite promises. A failure here must not
    // leave a dictionary user with no way in, so the row is rolled back by hand
    // (the dictionary row and the auth_* rows sit behind two different handles —
    // TenantDb cannot reach auth_account, which has no company_id column — so a
    // single transaction is not available without a schema change).
    let account;
    try {
      account = await options.credentials.provision({
        companyId: db.companyId,
        email,
        name,
      });
    } catch (err) {
      if (err instanceof CredentialEmailTakenError) {
        // The platform-wide index rejected the address, so it is credentialed in
        // ANOTHER tenant — a same-company duplicate cannot reach here, having
        // been answered 409 by the scoped pre-check above.
        //
        // KEEP the dictionary row. That is precisely what POST /users did BEFORE
        // B-282: the invite succeeds and the user sits `invited` with no
        // credential yet. Answering 409 would ship the cross-tenant block (and
        // its existence oracle) without Wei's ruling; rolling back would ship the
        // same refusal behind a 500. The only genuinely new fact is that this
        // particular invite cannot be COMPLETED until B-283 is decided, and that
        // is what this line records. No PII in the log — the row id identifies it.
        request.log.warn(
          { kind: "invite", userId: created!.id },
          "invited user provisioned NO credential: the address is already credentialed in another tenant (auth_user_email_unique is platform-wide — BLOCKERS.md B-283)",
        );
        return reply.code(201).send(toWire(created!));
      }
      await db.delete(users, eq(users.id, created!.id));
      throw err;
    }

    // The set-your-password token. Issued inside the same guarded block: an
    // invite whose token could not be stored is an invite nobody can complete.
    const { token, hash } = newResetToken();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    try {
      await options.credentials.issueResetToken(account.authUserId, hash, expiresAt);
    } catch (err) {
      // Compensate BOTH halves, credential FIRST. Deleting only the dictionary
      // row left auth_user + auth_account behind, and auth_user_email_unique is
      // platform-wide (B-283): that address could then never be invited again in
      // ANY tenant, and no endpoint exists that could clear the orphan. The
      // unrecoverable half therefore goes first, and if it fails the orphan is
      // real — say so loudly rather than let it disappear into the rethrow.
      try {
        await options.credentials.deprovision(account.authUserId);
      } catch (cleanupErr) {
        request.log.error(
          {
            kind: "invite",
            authUserId: account.authUserId,
            error: (cleanupErr as { name?: string })?.name,
          },
          "ORPHANED CREDENTIAL: an auth_user was created but neither completed nor removed — this address cannot be invited again anywhere until the row is deleted by hand",
        );
      }
      await db.delete(users, eq(users.id, created!.id));
      throw err;
    }

    // Delivery is deliberately OUTSIDE the rollback: the account and its token
    // are already valid, and a bounced invite mail is recoverable through
    // POST /auth/forgot or POST /admin/users/{id}/reset-password. Failing the
    // 201 here would instead destroy a perfectly good account. The token is
    // handed to the seam and never touches the response or the log.
    try {
      await options.deliverReset({ to: email, token, kind: "invite", expiresAt });
    } catch (err) {
      request.log.error(
        { kind: "invite", error: (err as { name?: string })?.name },
        "invite delivery failed",
      );
    }

    return reply.code(201).send(toWire(created!));
  });
}

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
import { users, roles } from "@juneflow/db/schema";
import {
  CredentialEmailTakenError,
  newResetToken,
  RESET_TOKEN_TTL_MS,
  type CredentialStore,
  type ResetDelivery,
} from "../auth-provisioning.js";
import { listEnvelope } from "./list-envelope.js";
import { loadCaller, MANAGEMENT_MODULE, permAllowed } from "./authz.js";

export interface UsersRouteOptions {
  /** Credential/reset seam (prod: DbCredentialStore over the base handle). */
  credentials: CredentialStore;
  /** Invite-token delivery seam (default: no-op — see auth-provisioning.ts). */
  deliverReset: ResetDelivery;
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
    // Canonical account form = trimmed + lowercased. This is NOT cosmetic: the
    // same address must resolve to ONE identity across the dictionary `user`
    // row, the globally-unique auth_user.email, and whatever better-auth
    // normalizes to at sign-in — otherwise a mixed-case invite provisions a
    // credential nobody can ever sign in with, which is the very failure B-282
    // exists to fix. login already canonicalizes this way for its throttle key
    // (routes/auth.ts, `accountKey`). It also makes the duplicate pre-check
    // below correct: before this, "A@x.co" and "a@x.co" both inserted.
    const email =
      typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
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

    // B-282 pre-check: auth_user.email is unique across the WHOLE platform
    // (migration 0008), not per company, so an address another tenant already
    // holds cannot be credentialed. Checking BEFORE the dictionary insert keeps
    // the common case free of a compensating delete. (That global uniqueness
    // also means this 409 answers "exists somewhere on the platform" rather than
    // "exists in your company" — a cross-tenant existence signal that cannot be
    // removed without a SACRED migration. Filed as B-283.)
    if (await options.credentials.findByEmail(email)) {
      return reply.code(409).send({
        code: "DUPLICATE_EMAIL",
        message: `a user with email ${email} already exists`,
      });
    }

    const [created] = await db
      .insert(users, {
        name,
        email,
        roleId,
        department,
        // invite flow: the user is `invited` until they set their own password.
        status: "invited",
      })
      .returning();

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
      await db.delete(users, eq(users.id, created!.id));
      if (err instanceof CredentialEmailTakenError) {
        // Lost the race against a concurrent invite of the same address.
        return reply.code(409).send({
          code: "DUPLICATE_EMAIL",
          message: `a user with email ${email} already exists`,
        });
      }
      throw err;
    }

    // The set-your-password token. Issued inside the same guarded block: an
    // invite whose token could not be stored is an invite nobody can complete.
    const { token, hash } = newResetToken();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    try {
      await options.credentials.issueResetToken(account.authUserId, hash, expiresAt);
    } catch (err) {
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

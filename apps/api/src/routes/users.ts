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
// filter/page query params are accepted per the contract but not interpreted.
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { users, roles } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";

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
export function registerUsersRoute(app: FastifyInstance): void {
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

    const body = (request.body ?? {}) as Record<string, unknown>;

    // name: accept `name`, else combine first/last (master.jsx UserAddForm).
    const first = typeof body.first === "string" ? body.first.trim() : "";
    const last = typeof body.last === "string" ? body.last.trim() : "";
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : [first, last].filter(Boolean).join(" ");
    const email = typeof body.email === "string" ? body.email.trim() : "";
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

    return reply.code(201).send(toWire(created!));
  });
}

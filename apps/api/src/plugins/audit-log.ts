// Audit log plugin (P0-BE-13).
//
// Hard architectural rule (PLAN.md §5, apps/api/CLAUDE.md):
//   EVERY mutation writes an AuditLog row via middleware — never hand-written
//   per endpoint. AuditLog shape per docs/handoff/data-dictionary.html +
//   packages/db (misc.ts `audit_log`): { company_id, user_id, action, entity,
//   before, after, ip, at } for every create / update / approve / void.
//
// How it enforces (single choke point, like tenant-scope):
//   - An onResponse hook fires for EVERY mutating method (POST/PUT/PATCH/DELETE).
//   - Only SUCCESSFUL mutations (2xx/3xx) are logged — a request that returned
//     4xx/5xx did not mutate state, so logging it would be a false trail.
//   - The record is handed to an injectable `sink` so persistence is decoupled
//     from the hook (createDbAuditSink writes to @juneflow/db in production; the
//     G3 unit tests pass a spy sink and assert every mutation produces a record
//     and that reads produce none).
//
// Scope note (skeleton): full before/after entity snapshots are a per-endpoint
// concern that lands with the resource routes. Here `after` captures the request
// body for create/update (the mutation intent) and `before` is left undefined;
// the DMS/resource layer will enrich these when it wraps individual mutations.
//
// Registered directly on the root instance (like registerTenantScope) so the
// onResponse hook applies to every route, including routes added under later
// encapsulation contexts (P0-BE-13 files route and beyond) — hooks added to an
// instance fire for that instance and all of its children.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "@juneflow/db/client";
import { auditLogs } from "@juneflow/db";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// B-183 (Phase-6): the /admin/* surface is the platform-owner cross-tenant door.
// A successful GET there is an owner reading across tenants (a non-owner is 403 →
// not logged), which Wei ruled must be audited. Matches `admin` as a path segment
// (with or without the /api/v1 prefix), never a substring like /badmin/.
const ADMIN_PATH = /(?:^|\/)admin(?:\/|$)/;

// B-282 — SECRETS MUST NEVER REACH audit_log.
//
// The hook records `after: request.body` for every successful mutation, and
// audit_log is durable, append-only and readable through GET /audit-log. Until
// B-282 no mutating route carried a secret in its body, so the rule held by
// accident: POST /auth/login has a password but is public and unattributed, so
// no row was ever written for it. POST /auth/reset breaks that accident — its
// body is {token, password} and it now names its tenant so the mutation IS
// audited. Recording that body verbatim would persist the plaintext password
// AND a live single-use reset token.
//
// The fix belongs HERE, at the single choke point, not in the reset handler:
// every current and future mutating route is covered, and a new route that
// happens to accept a credential cannot reintroduce the leak by forgetting.
// Matching is on the KEY NAME (exact, case-insensitive) — never on the value —
// so nothing is redacted by accident: `photo_after`, `token_count`-style names
// and every business field keep their real value.
const SECRET_KEYS = new Set([
  "password",
  "newpassword",
  "new_password",
  "currentpassword",
  "current_password",
  "confirmpassword",
  "confirm_password",
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "idtoken",
  "id_token",
  "secret",
  "clientsecret",
  "client_secret",
  "apikey",
  "api_key",
  "authorization",
]);

/** What replaces a secret. A fixed marker, so the row still proves the field was sent. */
const REDACTED = "[redacted]";

/**
 * Deep-copy `value` with every secret-named property replaced by [redacted].
 * Depth-bounded (a request body is JSON, but a hostile one can be deeply
 * nested) and non-mutating — `request.body` must stay intact for anything that
 * runs after this hook.
 */
function redactSecrets(value: unknown, depth = 0): unknown {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEYS.has(key.toLowerCase()) ? REDACTED : redactSecrets(v, depth + 1);
  }
  return out;
}

/** Logical action derived from the HTTP method of a mutating request. */
const METHOD_ACTION: Record<string, string> = {
  POST: "create",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};

/** One immutable audit record, mirroring packages/db `audit_log`. */
export interface AuditRecord {
  companyId: string;
  userId: string | null;
  action: string;
  /** The mutated surface: route template when available, else the request path. */
  entity: string;
  before?: unknown;
  after?: unknown;
  ip: string | null;
  at: Date;
}

/** Persists an audit record. Kept async so DB-backed sinks can await the write. */
export type AuditSink = (record: AuditRecord) => Promise<void> | void;

export interface AuditLogOptions {
  /** Where records are persisted (default in prod: createDbAuditSink). */
  sink: AuditSink;
  /**
   * Resolve the acting user id from the request (null when unknown). May be
   * async: the production wiring (app.ts) resolves the DICTIONARY user id from
   * the session — audit_log.user_id is FK-bound to the dictionary `user` table
   * (packages/db misc.ts), so the better-auth auth_user id must NOT be stored
   * here (it would violate the FK). null falls through to a null actor.
   */
  resolveUserId?: (request: FastifyRequest) => string | null | Promise<string | null>;
}

/**
 * Derive the logical action. Action endpoints (POST /x/:id/approve) carry the
 * verb in the trailing path segment (api-contract.md: status changes ONLY via
 * action endpoints), so prefer that over the generic method mapping.
 */
function resolveAction(method: string, routePath: string): string {
  const segments = routePath.split("?", 1)[0]!.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (method === "POST" && last && !last.startsWith(":") && !last.includes("{")) {
    // Collection create posts to a plural noun (e.g. /projects) → "create";
    // action posts end in a verb (e.g. /:id/approve) → that verb.
    const prev = segments[segments.length - 2];
    if (prev && (prev.startsWith(":") || prev.includes("{"))) return last;
  }
  return METHOD_ACTION[method] ?? method.toLowerCase();
}

export async function registerAuditLog(
  app: FastifyInstance,
  options: AuditLogOptions,
): Promise<void> {
  const resolveUserId = options.resolveUserId ?? (() => null);

  app.addHook(
    "onResponse",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const routePath = request.routeOptions?.url ?? request.url;
      const path = routePath.split("?", 1)[0]!;
      const isMutation = MUTATING_METHODS.has(request.method);
      // B-183: also audit a platform owner's cross-tenant /admin/* READ — the ONLY
      // read logged. Only an owner reaches a 2xx there (a non-owner 403 is filtered
      // by the statusCode gate below), so a successful /admin/* GET is exactly an
      // owner cross-tenant access — who (resolveUserId) · what (entity) · when (at).
      const isOwnerRead = request.method === "GET" && ADMIN_PATH.test(path);
      if (!isMutation && !isOwnerRead) return;
      // Only successful requests changed/accessed state; a 4xx/5xx did not.
      if (reply.statusCode >= 400) return;
      // Attribute to the TARGET tenant when a platform-owner /admin/* write set
      // one (B-193 W1a cross-tenant write) — the mutation changed THAT tenant, not
      // the owner's own — else the caller's own tenant. Without either there is
      // nothing to attribute (tenant-scope would already have rejected it); fail
      // safe by not writing an orphan row.
      const companyId = request.auditTargetCompanyId ?? request.tenant?.companyId;
      if (!companyId) return;

      const record: AuditRecord = {
        companyId,
        userId: await resolveUserId(request),
        action: isOwnerRead ? "read" : resolveAction(request.method, routePath),
        entity: path,
        // A read has no mutation body; a mutation records its intent as `after`
        // — with every secret-named field replaced (see SECRET_KEYS above), so
        // a password or a live reset token can never be persisted here.
        after: isMutation ? (redactSecrets(request.body) ?? undefined) : undefined,
        ip: request.ip ?? null,
        at: new Date(),
      };
      await options.sink(record);
    },
  );
}

/** Persist audit records into @juneflow/db `audit_log` (append-only). */
export function createDbAuditSink(db: Db): AuditSink {
  return async (record: AuditRecord) => {
    await db.insert(auditLogs).values({
      companyId: record.companyId,
      userId: record.userId,
      action: record.action,
      entity: record.entity,
      before: record.before,
      after: record.after,
      ip: record.ip,
      at: record.at,
    });
  };
}

// GET /audit-log (group-C Wave-1, C-BE-AUDITLOG) — the activity-feed read route
// over the append-only audit_log table (written by plugins/audit-log.ts, the
// mutation middleware). Implements the ALREADY-declared contract op
// (openapi.yaml `listAuditLog`, tag dms, ?entity=&user=&action=&page= →
// EntityList) — NO contract edit.
//
// Mirrors dashboard.ts: request.db TenantDb (401 fail-closed via a local
// unauthenticated()), company-scoped select over audit_log (audit_log carries
// company_id — a plain scoped read, no join hops), listEnvelope (B-014 single
// full page, matching every other list handler — see list-envelope.ts header).
//
// Row shape (all honest from columns + a users-name join): { id, user_id,
// user_name, action, entity, at }. Wei ruling 2026-07-19: `entity` is returned
// RAW as stored (seed rows carry friendly doc labels, live mutation rows carry
// "table:uuid") — no display-mapping layer. user_name resolves via users.name;
// a null user_id (purged user / system writer) reads 'ระบบ'; a non-null id that
// no longer resolves stays an honest null.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, eq, type SQL } from "drizzle-orm";
import { auditLogs, users } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";

function unauthenticated(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
}

/** Trimmed non-empty query-string value, else null (filter absent). */
function qs(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s.length > 0 ? s : null;
}

interface AuditRow {
  id: string;
  userId: string | null;
  action: string;
  entity: string;
  at: Date;
}

/** Register GET /audit-log on the (already /api/v1-prefixed) scope. */
export function registerAuditLogRoute(app: FastifyInstance): void {
  app.get("/audit-log", async (request: FastifyRequest, reply: FastifyReply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);

    const q = (request.query ?? {}) as {
      entity?: unknown;
      user?: unknown;
      action?: unknown;
    };
    // Exact-match filters on the stored values (entity raw-as-stored per the
    // Wei ruling; `user` is the acting user_id uuid). Absent params filter nothing.
    const conds: SQL[] = [];
    const entity = qs(q.entity);
    if (entity) conds.push(eq(auditLogs.entity, entity));
    const user = qs(q.user);
    if (user) conds.push(eq(auditLogs.userId, user));
    const action = qs(q.action);
    if (action) conds.push(eq(auditLogs.action, action));
    const where = conds.length > 0 ? and(...conds) : undefined;

    const [rows, userRows] = await Promise.all([
      db.select(auditLogs, where) as Promise<AuditRow[]>,
      db.select(users) as Promise<Array<{ id: string; name: string | null }>>,
    ]);
    const names = new Map(userRows.map((u) => [u.id, u.name]));

    const data = rows
      .slice()
      .sort((a, b) => b.at.getTime() - a.at.getTime()) // newest first (feed order)
      .map((r) => ({
        id: r.id,
        user_id: r.userId,
        // null user_id = the system writer ('ระบบ'); an id that no longer
        // resolves to a tenant user stays an honest null (C10 — no fabrication).
        user_name: r.userId == null ? "ระบบ" : (names.get(r.userId) ?? null),
        action: r.action,
        entity: r.entity,
        at: r.at,
      }));

    return reply.code(200).send(listEnvelope(data));
  });
}

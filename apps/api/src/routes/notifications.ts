// Notifications — list the current user's notifications + mark-read (FLOW-A
// data-completeness; the app-shell bell. The `notification` table exists since
// migration 0002 and the contract already declares both ops — this route file +
// its app.ts registration were the only missing pieces, so the bell no longer
// 404s).
//
// Contract (openapi.yaml): listNotifications (GET /notifications → EntityList),
// readNotification (POST /notifications/{id}/read → ActionOk, 404 NotFound). The
// row is the opaque Entity — wire fields below are REAL notification columns.
//
// Tenant + USER scope: `notification` carries its own company_id AND user_id, so
// every read/write goes through the scoped TenantDb.select()/update() door
// (company_id auto-injected) AND is narrowed to the SESSION user's rows
// (user_id = the tenant dictionary user resolved from authUser.email, exactly as
// GET /me resolves it). A user therefore sees / mutates only their OWN
// notifications within their OWN tenant — fail-closed on both axes. Without a
// resolved tenant/session, request.db / authUser is absent → 401.
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { notifications } from "@juneflow/db/schema";
import { listEnvelope } from "./list-envelope.js";
import { newestFirst } from "./list-order.js";
import { loadUserByEmail } from "./profile-data.js";

type NotificationRow = typeof notifications.$inferSelect;

/** The opaque Entity wire shape for one notification (real notification columns). */
function notificationWire(n: NotificationRow): Record<string, unknown> {
  return {
    id: n.id,
    type: n.type,
    ref: n.ref,
    read: n.read,
    created_at: n.createdAt,
  };
}

/** Register the notification routes on the given (already /api/v1-prefixed) scope. */
export function registerNotificationsRoute(app: FastifyInstance): void {
  // GET /notifications — the session user's notifications (the shell bell).
  app.get("/notifications", async (request, reply) => {
    const db = request.db;
    const authUser = request.authUser;
    if (!db || !authUser) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    // The session's tenant dictionary user (company-scoped, same as GET /me).
    const user = await loadUserByEmail(db, authUser.email);
    if (!user) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "No user record for this session in the tenant",
      });
    }

    // company_id auto-injected by select(); narrowed to THIS user's rows.
    const rows = await db.select(notifications, eq(notifications.userId, user.id));
    // B-367 — ORDERING, and this is a PRECONDITION of the emitter, not a tidy-up.
    //
    // This read had NO ordering of any kind. It was stable only by accident: the
    // sole writer was the seed, which inserts all 22 rows in one statement, so the
    // heap order it happened to return WAS the seed array order. Both shipped
    // readers depend on that order and neither sorts: apps/web's groupByDay
    // ("Sections appear in the order their first row appears") and the shell bell,
    // which renders the list exactly as returned. The moment apps/api gained a
    // second writer (notify.ts), a real event could land anywhere in the heap — so
    // "ยกเลิก" could render above "วันนี้" and the notifications G5 baseline would
    // drift for reasons no diff explains.
    //
    // newestFirst is created_at DESC then id ASC — TOTAL, so two runs can never
    // disagree (list-order.ts). It reproduces the seeded order exactly rather than
    // changing it: the seed's stamp ladder (packages/db/src/seed/stamp.ts) gives
    // row i `SEED_NOW - i * 1s`, i.e. array index 0 is the NEWEST, which is what
    // this comparator puts first.
    return reply
      .code(200)
      .send(listEnvelope(newestFirst(rows).map(notificationWire)));
  });

  // POST /notifications/:id/read — mark one of the session user's notifications
  // read. Scoped by company_id (the update door) AND user_id, so a user can never
  // mark another user's — or another tenant's — notification read. A miss → 404.
  app.post("/notifications/:id/read", async (request, reply) => {
    const db = request.db;
    const authUser = request.authUser;
    if (!db || !authUser) {
      return reply
        .code(401)
        .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
    }

    const user = await loadUserByEmail(db, authUser.email);
    if (!user) {
      return reply.code(401).send({
        code: "UNAUTHENTICATED",
        message: "No user record for this session in the tenant",
      });
    }

    const { id } = request.params as { id: string };
    const updated = await db
      .update(
        notifications,
        { read: true },
        and(eq(notifications.id, id), eq(notifications.userId, user.id)),
      )
      .returning();
    if (updated.length === 0) {
      return reply.code(404).send({
        code: "NOT_FOUND",
        message: `notification ${id} not found`,
      });
    }
    return reply.code(200).send(notificationWire(updated[0]!));
  });
}

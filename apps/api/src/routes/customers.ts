// Customers handler — Phase-3 Finance round-A (C-179). The AR screens
// (ar.invoice / ar.rv / ar.cn) need the customer dropdown source, but GET
// /customers + GET /customers/{id} were declared in the frozen contract
// (openapi.yaml) with NO handler — a live 404. This wires the read-side over the
// EXISTING customer table (project.ts, company-scoped).
//
// Contract (openapi.yaml — declared opaque):
//   GET /customers        → EntityList  — list customers        (listCustomers)
//   GET /customers/{id}   → EntityOk     — one customer          (getCustomer)
// Each row is the opaque Entity (snake_case wire of the REAL columns). A read on
// an opaque endpoint needs no contract change.
//
// Tenant scope (fail closed): customer carries company_id → the scoped
// TenantDb.select() door is company-scoped by construction; a foreign id resolves
// to nothing (→ 404, no cross-tenant leak). Without a resolved tenant, request.db
// is absent and every handler answers a flat 401. Reads need only a resolved
// tenant (no perm gate), mirroring the sibling master-data GETs.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { customers } from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";

type CustomerRow = typeof customers.$inferSelect;

/** Flat 401 (fail closed) when no tenant was resolved onto the request. */
function unauthenticated(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
}

/** Snake_case wire of the REAL customer columns (C10 — no fabricated fields). */
function customerWire(c: CustomerRow): Record<string, unknown> {
  return {
    id: c.id,
    name: c.name,
    tax_id: c.taxId,
    created_at: c.createdAt,
  };
}

/** Register the customers read routes on the given (/api/v1-prefixed) scope. */
export function registerCustomersRoute(app: FastifyInstance): void {
  app.get("/customers", async (request: FastifyRequest, reply: FastifyReply) => {
    const db = request.db as TenantDb | undefined;
    if (!db) return unauthenticated(reply);
    const rows = (await db.select(customers)) as CustomerRow[];
    const wire = [...rows]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map(customerWire);
    return reply.code(200).send(listEnvelope(wire));
  });

  app.get(
    "/customers/:id",
    async (request: FastifyRequest, reply: FastifyReply) => {
      const db = request.db as TenantDb | undefined;
      if (!db) return unauthenticated(reply);
      const { id } = request.params as { id: string };
      const [customer] = (await db.select(
        customers,
        eq(customers.id, id),
      )) as CustomerRow[];
      if (!customer) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: `customer ${id} not found` });
      }
      return reply.code(200).send(customerWire(customer));
    },
  );
}

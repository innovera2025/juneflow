// Tenant subscription reads (Phase-6 Wave-0, B-181) — the tenant-facing (NOT
// owner-gated) side of the platform surface. Two reads, both tenant-scoped by the
// normal request.db (no PlatformDb, no ownerOnly): a tenant sees the plan CATALOG
// (global) and ONLY its OWN platform invoices. Money on read (plan price, invoice
// amount) but NO GL/JV — platform billing is standalone (B-179).
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { packages, platformInvoices, subscriptions } from "@juneflow/db/schema";
import type { TenantDb } from "../db/tenant-db.js";
import { listEnvelope } from "./list-envelope.js";

type PackageRow = typeof packages.$inferSelect;
type PlatformInvoiceRow = typeof platformInvoices.$inferSelect;

/** Flat 401 (fail closed) when no tenant was resolved onto the request. */
function unauthenticated(reply: FastifyReply): FastifyReply {
  return reply
    .code(401)
    .send({ code: "UNAUTHENTICATED", message: "Missing tenant context" });
}

/** Coerce a drizzle numeric (string) / number / null to a finite number, else null. */
function num(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function byCreatedDesc(a: { createdAt: Date | null }, b: { createdAt: Date | null }): number {
  const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  return bt - at;
}

// The plan catalog is global (no per-tenant fields) — the same S/M/L/Full rows
// every tenant sees to compare/upgrade. price_m/price_y are money → currency_code.
function planWire(p: PackageRow): Record<string, unknown> {
  return {
    id: p.id,
    size: p.size,
    name: p.name,
    price_m: num(p.priceM),
    price_y: num(p.priceY),
    currency_code: p.currencyCode,
    limits: p.limits,
    menus: p.menus,
    sub_rules: p.subRules,
    created_at: p.createdAt,
  };
}

function invoiceWire(i: PlatformInvoiceRow): Record<string, unknown> {
  return {
    id: i.id,
    subscription_id: i.subscriptionId,
    amount: num(i.amount),
    currency_code: i.currencyCode,
    status: i.status,
    created_at: i.createdAt,
  };
}

/** Register the tenant subscription reads on the /api/v1 scope. */
export function registerSubscriptionRoutes(app: FastifyInstance): void {
  // GET /subscription/plans — the plan CATALOG (S/M/L/Full). Global reference
  // data (package has no company_id), read through the allowlisted reference door
  // exactly like loadPackageUsage resolves the tenant's own package. Un-gated:
  // any authenticated tenant may browse plans.
  app.get("/subscription/plans", async (request: FastifyRequest, reply: FastifyReply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    const rows = (await db.selectReference(packages)) as PackageRow[];
    return reply.code(200).send(listEnvelope([...rows].sort(byCreatedDesc).map(planWire)));
  });

  // GET /subscription/invoices — the tenant's OWN platform (subscription-billing)
  // invoices. platform_invoice has NO company_id, so it is scoped THROUGH its
  // subscription (platform_invoice.subscription_id → subscription.company_id =
  // this tenant) via selectThrough — provably the caller's own rows only, never
  // another tenant's. NO PlatformDb here (that is the owner door). Standalone
  // billing — no GL/JV (B-179).
  app.get("/subscription/invoices", async (request: FastifyRequest, reply: FastifyReply) => {
    const db = request.db;
    if (!db) return unauthenticated(reply);
    const rows = (await db.selectThrough(platformInvoices, [
      { fk: platformInvoices.subscriptionId, parent: subscriptions },
    ])) as PlatformInvoiceRow[];
    return reply.code(200).send(listEnvelope([...rows].sort(byCreatedDesc).map(invoiceWire)));
  });
}

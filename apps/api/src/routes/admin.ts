// Platform-admin routes (Phase-6 Wave-0, B-178) — the owner-gated /admin/* GET
// reads that span ALL tenants. Every handler:
//   1. `const caller = await ownerOnly(request, reply); if (!caller) return;`
//      FIRST — a non-owner (incl. any plain tenant bearer) is denied 403 here,
//      BEFORE any cross-tenant read (a missing gate on any handler = a leak).
//   2. reads cross-tenant ONLY through the guarded PlatformDb door (never
//      request.db, which is company-scoped to the owner's own company).
//   3. posts NO GL/JV — platform billing is standalone (B-179); these are pure
//      SELECTs of the five platform-admin tables.
// All five paths are PRE-DECLARED in openapi.yaml (tags:[admin], opaque Entity /
// EntityList envelopes, 234-421) — no contract change. Wave-1 admin WRITES
// (create/edit package, set-package, suspend, notify, block, reset) are NOT here.
import type { FastifyInstance, FastifyReply } from "fastify";
import { eq } from "drizzle-orm";
import {
  companies,
  packages,
  platformInvoices,
  subscriptions,
  users,
} from "@juneflow/db/schema";
import type { PlatformDb } from "../db/platform-db.js";
import type { PlatformWriteDb } from "../db/platform-write-db.js";
import { ownerOnly } from "./authz.js";
import { listEnvelope } from "./list-envelope.js";

type PackageRow = typeof packages.$inferSelect;
type SubscriptionRow = typeof subscriptions.$inferSelect;
type CompanyRow = typeof companies.$inferSelect;
type UserRow = typeof users.$inferSelect;
type PlatformInvoiceRow = typeof platformInvoices.$inferSelect;

/** Flat 404 NOT_FOUND (opaque, no cross-tenant existence leak). */
function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ code: "NOT_FOUND", message });
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

// --- Entity-opaque wire mappers (snake_case of the REAL columns) ------------

function packageWire(p: PackageRow): Record<string, unknown> {
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

// A subscriber row = one tenant company's subscription, enriched with its company
// name/status so the admin table renders the tenant without a second call.
function subscriberWire(s: SubscriptionRow, company: CompanyRow | undefined): Record<string, unknown> {
  return {
    id: s.id,
    company_id: s.companyId,
    company_name: company?.name ?? null,
    company_status: company?.status ?? null,
    package_id: s.packageId,
    cycle: s.cycle,
    renew_at: s.renewAt,
    status: s.status,
    created_at: s.createdAt,
  };
}

// The owner-flag is intentionally NOT surfaced on the wire — it is a security
// control, not tenant data the admin list needs.
function userWire(u: UserRow): Record<string, unknown> {
  return {
    id: u.id,
    company_id: u.companyId,
    email: u.email,
    name: u.name,
    role_id: u.roleId,
    status: u.status,
    department: u.department,
    created_at: u.createdAt,
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

/** Register the owner-gated platform-admin read + write routes on the /api/v1 scope. */
export function registerAdminRoutes(
  app: FastifyInstance,
  deps: { platformDb: PlatformDb; platformWriteDb: PlatformWriteDb },
): void {
  const { platformDb, platformWriteDb } = deps;

  // GET /admin/packages — the S/M/L/Full plan catalog (global; owner-gated read).
  app.get("/admin/packages", async (request, reply) => {
    const caller = await ownerOnly(request, reply);
    if (!caller) return;
    const rows = (await platformDb.selectAllTenants(packages)) as PackageRow[];
    return reply.code(200).send(listEnvelope([...rows].sort(byCreatedDesc).map(packageWire)));
  });

  // GET /admin/packages/{id} — one plan.
  app.get("/admin/packages/:id", async (request, reply) => {
    const caller = await ownerOnly(request, reply);
    if (!caller) return;
    const id = (request.params as { id?: string }).id ?? "";
    const [pkg] = (await platformDb.selectAllTenants(packages, eq(packages.id, id))) as PackageRow[];
    if (!pkg) return notFound(reply, `package ${id} not found`);
    return reply.code(200).send(packageWire(pkg));
  });

  // GET /admin/subscribers — every tenant's subscription (cross-tenant), enriched
  // with the company name/status. subscription carries company_id → MUST go
  // through the PlatformDb door (request.db would scope to the owner's own company).
  app.get("/admin/subscribers", async (request, reply) => {
    const caller = await ownerOnly(request, reply);
    if (!caller) return;
    const subs = (await platformDb.selectAllTenants(subscriptions)) as SubscriptionRow[];
    const comps = (await platformDb.selectAllTenants(companies)) as CompanyRow[];
    const byId = new Map(comps.map((c) => [c.id, c]));
    return reply
      .code(200)
      .send(listEnvelope([...subs].sort(byCreatedDesc).map((s) => subscriberWire(s, byId.get(s.companyId)))));
  });

  // GET /admin/users?company= — the cross-tenant user list (optional company
  // filter). request.db would return only the owner's own company's users.
  app.get("/admin/users", async (request, reply) => {
    const caller = await ownerOnly(request, reply);
    if (!caller) return;
    const company = (request.query as { company?: string }).company;
    const rows = (await platformDb.selectAllTenants(
      users,
      company ? eq(users.companyId, company) : undefined,
    )) as UserRow[];
    return reply.code(200).send(listEnvelope([...rows].sort(byCreatedDesc).map(userWire)));
  });

  // GET /admin/invoices — ALL tenants' platform (subscription-billing) invoices.
  // Standalone billing — NO GL/JV (B-179): a pure SELECT of platform_invoice.
  app.get("/admin/invoices", async (request, reply) => {
    const caller = await ownerOnly(request, reply);
    if (!caller) return;
    const rows = (await platformDb.selectAllTenants(platformInvoices)) as PlatformInvoiceRow[];
    return reply.code(200).send(listEnvelope([...rows].sort(byCreatedDesc).map(invoiceWire)));
  });

  // --- writes (Phase-6 W1a, B-193) — cross-tenant, owner-gated, non-money -----
  // Every handler: ownerOnly FIRST (a non-owner is 403 before ANY write) → mutate
  // via the guarded PlatformWriteDb door (strips is_platform_admin / company_id /
  // id) → stamp the TARGET tenant on the request so the audit hook logs the
  // affected tenant (not the owner's own). All status flips are zero-money.

  // POST /admin/users/{id}/block — a USER id (block → user.status='blocked').
  app.post("/admin/users/:id/block", async (request, reply) => {
    const caller = await ownerOnly(request, reply);
    if (!caller) return;
    const id = (request.params as { id?: string }).id ?? "";
    const [user] = await platformWriteDb.updateAllTenants(users, id, { status: "blocked" });
    if (!user) return notFound(reply, `user ${id} not found`);
    request.auditTargetCompanyId = user.companyId; // audit the affected tenant
    return reply.code(200).send(userWire(user));
  });

  // POST /admin/users/{id}/unblock — user.status='active'.
  app.post("/admin/users/:id/unblock", async (request, reply) => {
    const caller = await ownerOnly(request, reply);
    if (!caller) return;
    const id = (request.params as { id?: string }).id ?? "";
    const [user] = await platformWriteDb.updateAllTenants(users, id, { status: "active" });
    if (!user) return notFound(reply, `user ${id} not found`);
    request.auditTargetCompanyId = user.companyId;
    return reply.code(200).send(userWire(user));
  });

  // POST /admin/subscribers/{id}/suspend — {id} is a SUBSCRIPTION id. Resolve it
  // to its company and flip companies.status (NOT subscription.status — the
  // subscriptionStatus enum has no 'suspended'). company_id is a NOT-NULL FK.
  app.post("/admin/subscribers/:id/suspend", async (request, reply) => {
    const caller = await ownerOnly(request, reply);
    if (!caller) return;
    const id = (request.params as { id?: string }).id ?? "";
    const [sub] = (await platformDb.selectAllTenants(
      subscriptions,
      eq(subscriptions.id, id),
    )) as SubscriptionRow[];
    if (!sub) return notFound(reply, `subscriber ${id} not found`);
    const [company] = await platformWriteDb.updateAllTenants(companies, sub.companyId, {
      status: "suspended",
    });
    if (!company) return notFound(reply, `company ${sub.companyId} not found`);
    request.auditTargetCompanyId = company.id; // the affected tenant
    return reply.code(200).send(subscriberWire(sub, company));
  });

  // POST /admin/subscribers/{id}/resume — companies.status='active'.
  app.post("/admin/subscribers/:id/resume", async (request, reply) => {
    const caller = await ownerOnly(request, reply);
    if (!caller) return;
    const id = (request.params as { id?: string }).id ?? "";
    const [sub] = (await platformDb.selectAllTenants(
      subscriptions,
      eq(subscriptions.id, id),
    )) as SubscriptionRow[];
    if (!sub) return notFound(reply, `subscriber ${id} not found`);
    const [company] = await platformWriteDb.updateAllTenants(companies, sub.companyId, {
      status: "active",
    });
    if (!company) return notFound(reply, `company ${sub.companyId} not found`);
    request.auditTargetCompanyId = company.id;
    return reply.code(200).send(subscriberWire(sub, company));
  });
}

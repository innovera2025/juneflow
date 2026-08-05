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
  packageSize,
  packages,
  platformInvoices,
  subscriptions,
  users,
} from "@juneflow/db/schema";
import type { PlatformDb } from "../db/platform-db.js";
import type { PlatformWriteDb } from "../db/platform-write-db.js";
import {
  canonicalEmail,
  newResetToken,
  RESET_TOKEN_TTL_MS,
  type CredentialStore,
  type ResetDelivery,
} from "../auth-provisioning.js";
import { ownerOnly } from "./authz.js";
import { listEnvelope } from "./list-envelope.js";
import { round2 } from "./money.js";
import { pick, str, toNum } from "./procurement.js";

type PackageRow = typeof packages.$inferSelect;
type SubscriptionRow = typeof subscriptions.$inferSelect;
type CompanyRow = typeof companies.$inferSelect;
type UserRow = typeof users.$inferSelect;
type PlatformInvoiceRow = typeof platformInvoices.$inferSelect;

/**
 * W1d dunning notice (the side-effect a platform-owner remind emits). Every field
 * is SERVER-derived from the resolved overdue invoice/subscription — never client
 * text/recipient/amount. The notifier is an injectable seam (mirrors AuditSink):
 * the default is a no-op, tests record it, and the real LINE integration
 * (P0-INT-03, whose send() currently throws a TODO) is a later default-swap — so
 * the remind NEVER depends on the unbuilt adapter.
 */
export interface DunningNotice {
  /** The dunned tenant (the invoice's subscription's company). */
  companyId: string;
  invoiceId: string;
  amount: string | null;
}
export type DunningNotifier = (notice: DunningNotice) => Promise<void> | void;

/** Flat 404 NOT_FOUND (opaque, no cross-tenant existence leak). */
function notFound(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(404).send({ code: "NOT_FOUND", message });
}

/** Flat 400 BAD_REQUEST (client-input error). */
function badRequest(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ code: "BAD_REQUEST", message });
}

/** A numeric(12,2) money string, or null (the Full=contact no-price case). */
function moneyStr(n: number | null): string | null {
  return n == null ? null : round2(n).toFixed(2);
}

/** The plan-card accent per tier — the pkg-builder default when the client omits color. */
const SIZE_COLOR: Record<string, string> = {
  S: "#5A7CA8",
  M: "#0B2A4A",
  L: "#0F766E",
  Full: "#B45309",
};

/**
 * Parse + validate a package create/edit body into the persistable columns.
 * money=SERVER: the YEARLY price is DERIVED (10× monthly = "ประหยัด 2 เดือน") — a
 * client-sent price_y/yearly is IGNORED. A contact/enterprise tier (contact:true)
 * carries no price → both null. limits/menus/tagline/etc. are client-supplied
 * (non-money) and persisted as-received. Returns a 400-message string on invalid
 * input, else the column values.
 */
function packageValues(b: Record<string, unknown>): string | Record<string, unknown> {
  const name = str(pick(b, "name")).trim();
  if (!name) return "name is required";
  const size = str(pick(b, "size")).trim();
  if (!(packageSize.enumValues as readonly string[]).includes(size)) {
    return `size must be one of ${packageSize.enumValues.join("/")}`;
  }
  const menus = Array.isArray(b.menus) ? (b.menus as unknown[]) : null;
  if (!menus || menus.length === 0) return "menus is required (at least one nav id)";
  // B-200: require a non-empty limits object. An omitted/empty limits on an EDIT
  // would persist {} and WIPE the plan's quota LIVE for every subscriber on it
  // (the resolver reads package.limits fresh) — never silently zero the fleet.
  const limits = b.limits;
  if (!limits || typeof limits !== "object" || Array.isArray(limits) || Object.keys(limits).length === 0) {
    return "limits is required (a non-empty quota object)";
  }
  const contact = b.contact === true;
  const priceRaw = toNum(pick(b, "price", "price_m"));
  if (!contact && (priceRaw == null || priceRaw <= 0)) {
    return "monthly price is required and must be greater than zero (unless a contact tier)";
  }
  // money=SERVER: derive the yearly from the monthly; never trust a client yearly.
  const priceM = contact ? null : round2(priceRaw as number);
  const priceY = contact ? null : round2((priceRaw as number) * 10);
  const color = str(pick(b, "color")).trim();
  return {
    size,
    name,
    priceM: moneyStr(priceM),
    priceY: moneyStr(priceY),
    currencyCode: "THB", // server-set — the client never overrides the currency
    limits,
    menus,
    subRules: pick(b, "sub_rules", "subRules") ?? {},
    tagline: str(pick(b, "tagline")).trim() || null,
    modLabel: str(pick(b, "mod_label", "modLabel")).trim() || null,
    color: color || SIZE_COLOR[size] || null,
    popular: b.popular === true,
  };
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
    tagline: p.tagline,
    mod_label: p.modLabel,
    color: p.color,
    popular: p.popular,
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
    seats: s.seats, // B-195: the per-subscriber seat override (null = package default)
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

/**
 * Server-derived MRR/ARR (B-192/B-209 · money=SERVER). MRR = Σ each subscription's
 * normalized MONTHLY revenue: a yearly plan contributes price_y/12, a monthly plan
 * price_m. A trial (not yet paying) and a cancelled (churned) sub contribute 0; every
 * committed status (active/expiring/overdue) counts. Priced off the PLAN (package
 * price), never the per-subscriber seat override. ARR = MRR × 12. The client no
 * longer derives this (it was admin-rows.ts deriveMrr) — this is the authoritative value.
 */
export function computeMrrArr(
  subs: SubscriptionRow[],
  pkgById: Map<string, PackageRow>,
): { mrr: number; arr: number } {
  let mrr = 0;
  for (const s of subs) {
    if (s.status === "trial" || s.status === "cancelled") continue; // not committed revenue
    const pkg = pkgById.get(s.packageId);
    if (!pkg) continue;
    mrr += s.cycle === "yearly" ? (num(pkg.priceY) ?? 0) / 12 : (num(pkg.priceM) ?? 0);
  }
  const rounded = round2(mrr);
  return { mrr: rounded, arr: round2(rounded * 12) };
}

/** Register the owner-gated platform-admin read + write routes on the /api/v1 scope. */
export function registerAdminRoutes(
  app: FastifyInstance,
  deps: {
    platformDb: PlatformDb;
    platformWriteDb: PlatformWriteDb;
    notify: DunningNotifier;
    /** Credential/reset seam — B-282 (POST /admin/users/{id}/reset-password). */
    credentials: CredentialStore;
    /** Reset-token delivery seam (default: no-op — see auth-provisioning.ts). */
    deliverReset: ResetDelivery;
  },
): void {
  const { platformDb, platformWriteDb, notify, credentials, deliverReset } = deps;

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
    const pkgs = (await platformDb.selectAllTenants(packages)) as PackageRow[];
    const byId = new Map(comps.map((c) => [c.id, c]));
    const pkgById = new Map(pkgs.map((p) => [p.id, p]));
    // B-192/B-209: MRR/ARR are SERVER-derived (money=SERVER) and ride on the list
    // envelope (Paginated allows extra fields) so admin.overview drops its client
    // deriveMrr and shows the authoritative value.
    const { mrr, arr } = computeMrrArr(subs, pkgById);
    return reply.code(200).send({
      ...listEnvelope([...subs].sort(byCreatedDesc).map((s) => subscriberWire(s, byId.get(s.companyId)))),
      mrr,
      arr,
    });
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

  // POST /admin/users/{id}/reset-password — B-282. This op was DECLARED in the
  // contract (openapi.yaml L398-411) and never mounted, sitting between its two
  // mounted siblings above: the same "declared but no handler" gap as
  // /auth/forgot and /auth/reset, and the same fix. It issues a reset token for
  // a subscriber's user and hands it to the delivery seam.
  //
  // The owner never sees, sets, or receives the password: no plaintext is
  // generated here, the token is delivered ONLY to the target user's own stored
  // address, and the 200 body is the user row — never the token.
  app.post("/admin/users/:id/reset-password", async (request, reply) => {
    const caller = await ownerOnly(request, reply);
    if (!caller) return;
    const id = (request.params as { id?: string }).id ?? "";
    const [user] = (await platformDb.selectAllTenants(
      users,
      eq(users.id, id),
    )) as UserRow[];
    if (!user) return notFound(reply, `user ${id} not found`);
    request.auditTargetCompanyId = user.companyId; // audit the affected tenant

    // Canonicalized like every other email-keyed lookup (canonicalEmail): the
    // stored dictionary address is the key into a case-SENSITIVE auth_user
    // lookup, so a legacy row saved with different case must not silently
    // become "has no credential to reset".
    const account = await credentials.findByEmail(canonicalEmail(user.email));
    // No credential row = nothing to reset (a pre-B-282 user invited before this
    // slice). Say so plainly — this surface is owner-only, so there is no
    // enumeration concern, and silently answering 200 would hide real breakage.
    if (!account) {
      return notFound(reply, `user ${id} has no credential to reset`);
    }

    const { token, hash } = newResetToken();
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await credentials.issueResetToken(account.authUserId, hash, expiresAt);
    try {
      await deliverReset({ to: account.email, token, kind: "admin", expiresAt });
    } catch (err) {
      request.log.error(
        { kind: "admin", error: (err as { name?: string })?.name },
        "password-reset delivery failed",
      );
    }

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

  // --- package CRUD (Phase-6 W1b, B-197) — create/edit ONLY, NO delete (B-196) -
  // packages is a GLOBAL catalog: no per-tenant scope, so NO auditTargetCompanyId
  // (the audit hook attributes the change to the owner's own tenant). ⚠ An EDIT is
  // GLOBAL-blast-radius — it retro-mutates the live quota/menus of EVERY tenant on
  // the plan (the quota resolver + GET /me read package.limits/menus fresh) — the
  // intended prototype behavior (B-187), gated by ownerOnly() alone. money=SERVER:
  // price_y is DERIVED (never trusted from the client).

  // POST /admin/packages — create a plan.
  app.post("/admin/packages", async (request, reply) => {
    const caller = await ownerOnly(request, reply);
    if (!caller) return;
    const values = packageValues((request.body ?? {}) as Record<string, unknown>);
    if (typeof values === "string") return badRequest(reply, values);
    const created = await platformWriteDb.insertOne(packages, values); // door strips id/owner-flag
    return reply.code(201).send(packageWire(created));
  });

  // PUT /admin/packages/{id} — edit a plan (GLOBAL blast-radius; never a status flip).
  app.put("/admin/packages/:id", async (request, reply) => {
    const caller = await ownerOnly(request, reply);
    if (!caller) return;
    const id = (request.params as { id?: string }).id ?? "";
    const values = packageValues((request.body ?? {}) as Record<string, unknown>);
    if (typeof values === "string") return badRequest(reply, values);
    const [updated] = await platformWriteDb.updateAllTenants(packages, id, values);
    if (!updated) return notFound(reply, `package ${id} not found`);
    return reply.code(200).send(packageWire(updated));
  });

  // NO DELETE /admin/packages/{id} — B-196=ก: the prototype exposes no delete
  // affordance, and deleting a referenced plan would orphan every subscription.

  // PUT /admin/subscribers/{id}/package — owner changes a tenant's plan (+seats).
  // W1c (B-201). {id} is a SUBSCRIPTION id, written DIRECTLY. subscription CARRIES
  // company_id (a tenant-owned table, unlike the global package) → the company_id
  // STRIP in updateAllTenants is LOAD-BEARING here: an owner must NEVER re-home a
  // sub to another tenant. Audit → the TARGET tenant. Zero-money (no price/proration).
  app.put("/admin/subscribers/:id/package", async (request, reply) => {
    const caller = await ownerOnly(request, reply); // 403 before ANY read/write
    if (!caller) return;
    const id = (request.params as { id?: string }).id ?? "";
    const body = (request.body ?? {}) as Record<string, unknown>;

    // FK pre-check: package_id is a NOT-NULL FK (onDelete:restrict) — a bad id
    // would surface as a raw 23503 → 500. Resolve it to a clean 400/404 first.
    const packageId = str(pick(body, "package_id", "packageId")).trim();
    if (!packageId) return badRequest(reply, "package_id is required");
    const [pkg] = (await platformDb.selectAllTenants(
      packages,
      eq(packages.id, packageId),
    )) as PackageRow[];
    if (!pkg) return notFound(reply, `package ${packageId} not found`);

    const set: Record<string, unknown> = { packageId };
    // seats override: integer; -1 = unlimited, else >= 1. Omitted → untouched.
    const seatsRaw = pick(body, "seats");
    if (seatsRaw != null) {
      const seats = toNum(seatsRaw);
      if (seats == null || !Number.isInteger(seats) || (seats !== -1 && seats < 1)) {
        return badRequest(reply, "seats must be a positive integer or -1 (unlimited)");
      }
      set.seats = seats;
    }

    // The door strips company_id/companyId/id/is_platform_admin; packageId/seats pass.
    const [updated] = await platformWriteDb.updateAllTenants(subscriptions, id, set);
    if (!updated) return notFound(reply, `subscriber ${id} not found`);

    const [company] = (await platformDb.selectAllTenants(
      companies,
      eq(companies.id, updated.companyId),
    )) as CompanyRow[];
    request.auditTargetCompanyId = updated.companyId; // the AFFECTED tenant
    return reply.code(200).send(subscriberWire(updated, company));
  });

  // POST /admin/invoices/{id}/remind — dunning remind on an overdue platform
  // invoice (Phase-6 W1d, the LAST Wave-1 billing write). PURE side-effect: writes
  // NO row and NO GL/JV (B-188 — platform billing is standalone). The prototype's
  // ทวงถาม button is per-invoice-row, shown ONLY on an overdue invoice. The audit
  // is REAL (the prototype toast claimed "· บันทึกใน Audit Log"): the onResponse
  // hook logs action="remind" attributed to the DUNNED tenant (auditTargetCompanyId).
  // NO invoice-generation / NO mark-paid (B-189=ก DEFER). money=SERVER: no amount
  // is client-supplied — the notice echoes the stored invoice.
  app.post("/admin/invoices/:id/remind", async (request, reply) => {
    const caller = await ownerOnly(request, reply); // 403 BEFORE any read
    if (!caller) return;
    const id = (request.params as { id?: string }).id ?? "";
    const [inv] = (await platformDb.selectAllTenants(
      platformInvoices,
      eq(platformInvoices.id, id),
    )) as PlatformInvoiceRow[];
    if (!inv) return notFound(reply, `invoice ${id} not found`);
    if (inv.status !== "overdue") return badRequest(reply, "invoice is not overdue");
    const [sub] = (await platformDb.selectAllTenants(
      subscriptions,
      eq(subscriptions.id, inv.subscriptionId),
    )) as SubscriptionRow[];
    if (!sub) return notFound(reply, `subscription ${inv.subscriptionId} not found`);
    // Dunning notification side-effect — SERVER-derived recipient/amount. Wrapped so
    // a future real-adapter throw (LINE send() TODO) degrades to a log, never a 500,
    // and never blocks the audit (mirrors the auditSink actor-lookup degrade).
    try {
      await notify({ companyId: sub.companyId, invoiceId: inv.id, amount: inv.amount });
    } catch (err) {
      request.log.error(err);
    }
    request.auditTargetCompanyId = sub.companyId; // the DUNNED tenant → the audit hook
    return reply.code(200).send({ ok: true });
  });
}

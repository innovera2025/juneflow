/*
 * Pure, i18n-free, ASCII-only display logic for the tenant Subscription screens,
 * narrowed from pototype/subscription.jsx SubPlans (L132-184) + SubBilling (L187-216).
 *
 * The prototype held plans/invoices in local arrays (SUB_PACKAGES / SUB_INVOICES) that
 * carried denormalised display fields. §0 rule 3 drops that mock: the plan cards + the
 * billing table render from the real server catalogue —
 *   GET /subscription/plans    planWire  { id, size, name, price_m, price_y,
 *                                          currency_code, limits, menus, sub_rules }
 *   GET /subscription/invoices invoiceWire { id, subscription_id, amount, currency_code,
 *                                            status, created_at }
 * (apps/api/src/routes/subscription.ts). All narrowing + derivations live here so they
 * are unit-tested (gate G3); the screens stay declarative.
 *
 * WIRE GAPS (reported honestly, never fabricated — Phase-6 B-179 "standalone status-only
 * billing"):
 *   - planWire carries NO `color`, `popular`, `tagline`, or `modLabel`. Colour is a
 *     deterministic reconstruction from `size` (the prototype's own size->hex map, verbatim
 *     under B-037(a)); the popular badge / tagline / modLabel have no source and are
 *     dropped/em-dashed in the screen (a data-completeness follow-up).
 *   - invoiceWire carries NO invoice-no or line description, and the API `num()` coerces a
 *     SQL-null price to 0, so an absent price (Enterprise/Full) arrives as 0 — treated as
 *     the "contact sales" branch (price === null || price <= 0), matching the prototype's
 *     `price == null` behaviour.
 *
 * Package `limits` jsonb keys are `storage_gb` / `ai_per_month` (data-dictionary C5),
 * NOT `storage` / `ai`; the narrowing accepts those (plus camelCase fallbacks). `-1`
 * means unlimited.
 */

/** Read a string field off an opaque row ({ [k]: unknown }); "" when absent. */
export function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** Read a finite number off an opaque row; 0 when absent/invalid. */
export function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Group a FULL-unit amount with thousands separators ("79000" -> "79,000"), matching the
 * prototype's Intl fmt (ds.jsx th-TH, maximumFractionDigits 0). ASCII digits + comma only.
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format an ISO timestamp as YYYY-MM-DD (UTC, deterministic, ASCII) — the codebase
 * convention (ap/pv-rows.formatDate). The prototype showed a mock Thai buddhist-era date;
 * the invoice wire exposes only created_at, so the date cell shows that. "" when missing.
 */
export function formatDate(createdAt: string): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/* --------------------------------------------------------------------------- */
/* Plans (subscription.jsx SubPlans, L132-184)                                  */
/* --------------------------------------------------------------------------- */

/** A plan/package size (packageSize enum). */
export type PlanSize = "S" | "M" | "L" | "Full";

/** A plan card as SubPlans consumes it (GET /subscription/plans row, narrowed). */
export interface PlanRow {
  id: string;
  /** Package size badge / colour driver ("" when absent). */
  size: string;
  name: string;
  /** Monthly price in FULL units, or null when there is no positive price (contact sales). */
  priceM: number | null;
  /** Yearly price in FULL units, or null when there is no positive price (contact sales). */
  priceY: number | null;
  currencyCode: string;
  /** Quota: projects allowed (-1 = unlimited). */
  projects: number;
  /** Quota: user seats allowed (-1 = unlimited). */
  users: number;
  /** Quota: storage in GB (-1 = unlimited). */
  storageGb: number;
  /** Quota: AI takeoff credits/month (-1 = unlimited). */
  aiPerMonth: number;
  /** Released nav-menu ids (top-level ids, or ["*"] for all). */
  menus: string[];
}

/** A positive finite number, or null (an absent/null/<=0 price -> "contact sales"). */
function priceOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = num(v);
  return n > 0 ? n : null;
}

/** Narrow the opaque `limits` jsonb (storage_gb / ai_per_month, C5) to a quota number. */
function limitOf(limits: unknown, snake: string, camel: string): number {
  if (limits && typeof limits === "object") {
    const rec = limits as Record<string, unknown>;
    const raw = rec[snake] ?? rec[camel];
    if (raw != null) return num(raw);
  }
  return 0;
}

/** Read the opaque `menus` jsonb as a string[] (top-level nav ids, or ["*"]). */
function menusOf(menus: unknown): string[] {
  if (Array.isArray(menus)) return menus.map((m) => str(m)).filter((m) => m !== "");
  return [];
}

/** Narrow an opaque /subscription/plans (or /admin/packages) Entity row to a PlanRow. */
export function toPlanRow(e: Record<string, unknown>): PlanRow {
  return {
    id: str(e.id),
    size: str(e.size),
    name: str(e.name),
    priceM: priceOrNull(e.price_m ?? e.priceM),
    priceY: priceOrNull(e.price_y ?? e.priceY),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    projects: limitOf(e.limits, "projects", "projects"),
    users: limitOf(e.limits, "users", "users"),
    storageGb: limitOf(e.limits, "storage_gb", "storageGb"),
    aiPerMonth: limitOf(e.limits, "ai_per_month", "aiPerMonth"),
    menus: menusOf(e.menus),
  };
}

/**
 * The plan card accent colour reconstructed from `size` — the prototype's own verbatim
 * size->hex map (subscription.jsx SUB_PACKAGES + pkg-builder PkgBuilderForm colour map).
 * planWire carries no `color`, so this is a deterministic styling reconstruction (B-037(a),
 * like land-bank reconstructing rai-ngan-wa from area_sqm), never a fabricated data claim.
 */
export function sizeColor(size: string): string {
  switch (size) {
    case "S":
      return "#5A7CA8";
    case "M":
      return "#0B2A4A";
    case "L":
      return "#0F766E";
    case "Full":
      return "#B45309";
    default:
      return "#5A7CA8";
  }
}

/** The price for the active cycle, or null (-> "contact sales") when there is none. */
export function priceForCycle(row: PlanRow, cycle: "monthly" | "yearly"): number | null {
  return cycle === "yearly" ? row.priceY : row.priceM;
}

/** True when a quota value is unlimited (-1), matching subscription.jsx limitText. */
export function isUnlimited(v: number): boolean {
  return v < 0;
}

/**
 * Which CTA a plan card shows (subscription.jsx L170). The "current plan" flag is NOT
 * determinable in Phase-6 (there is no active-subscription read), so no card is marked
 * current — every card shows a change CTA: a null-price plan is "contact"; the smallest
 * tier (S) is "downgrade"; everything else is "upgrade" (keyed off size, mirroring the
 * prototype's `p.id === "starter"`).
 */
export function planCtaKind(row: PlanRow, cycle: "monthly" | "yearly"): "contact" | "downgrade" | "upgrade" {
  if (priceForCycle(row, cycle) == null) return "contact";
  return row.size === "S" ? "downgrade" : "upgrade";
}

/* --------------------------------------------------------------------------- */
/* Billing invoices (subscription.jsx SubBilling, L187-216)                     */
/* --------------------------------------------------------------------------- */

/** An invoice row as SubBilling consumes it (GET /subscription/invoices, narrowed). */
export interface InvoiceRow {
  id: string;
  /** Invoice amount in FULL units (money -> currency_code). */
  amount: number;
  currencyCode: string;
  /** platform_invoice_status: paid | pending | overdue. */
  status: string;
  /** ISO created timestamp (the only date the wire exposes). */
  createdAt: string;
}

/** Narrow an opaque /subscription/invoices (or /admin/invoices) Entity row to InvoiceRow. */
export function toInvoiceRow(e: Record<string, unknown>): InvoiceRow {
  return {
    id: str(e.id),
    amount: num(e.amount),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    status: str(e.status),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/** Status-badge tone kind (ds.jsx STATUS) fed to the screen's tokened <StatusBadge>. */
export type BadgeTone = "approved" | "pending" | "rejected" | "draft";

/**
 * Map an invoice status to a badge tone + a label discriminant. paid -> approved (the ONE
 * sub.billing.statusPaid key); pending/overdue/other have NO sub.billing label key, so the
 * screen renders the raw status code (wire-reality "render the raw backend value" rule).
 */
export function invoiceBadge(status: string): { tone: BadgeTone; labelKind: "paid" | "raw" } {
  switch (status) {
    case "paid":
      return { tone: "approved", labelKind: "paid" };
    case "pending":
      return { tone: "pending", labelKind: "raw" };
    case "overdue":
      return { tone: "rejected", labelKind: "raw" };
    default:
      return { tone: "draft", labelKind: "raw" };
  }
}

/* --------------------------------------------------------------------------- */
/* My Subscription (subscription.jsx SubMine, L41-129)                          */
/* --------------------------------------------------------------------------- */

/**
 * Live usage counters from GET /subscription/me (server truth). The prototype hardcoded a
 * mock { projects:7, users:12, storage:24, ai:18 }; here projects/users are LIVE row counts
 * and storage is an honest 0 (no byte-accounting yet) — the screen renders these faithfully,
 * never the mock numbers (Phase-6 seed reality).
 */
export interface SubscriptionUsage {
  /** Projects in use (live count). */
  projects: number;
  /** User seats in use (live count). */
  users: number;
  /** Storage GB in use — a known byte-accounting gap on the server (honest 0). */
  storage: number;
  /** AI takeoff credits used this month. */
  ai: number;
}

/**
 * The tenant's own current subscription, narrowed from GET /subscription/me. `package` is
 * the SAME planWire row the /subscription/plans catalogue returns (limit keys storage_gb /
 * ai_per_month, C5), so it reuses toPlanRow; it is null when the tenant has no plan.
 */
export interface SubscriptionMe {
  id: string;
  packageId: string;
  /** Billing-cycle code (yearly | monthly). */
  cycle: string;
  /** Subscription status code (active | trial | overdue | cancelled | ...). */
  status: string;
  /** ISO next-renewal timestamp ("" when absent). */
  renewAt: string;
  /** ISO contract-start timestamp ("" when absent). */
  startedAt: string;
  /** The subscribed package (planWire, narrowed) — null when the tenant has none. */
  package: PlanRow | null;
  /** Live usage vs the package quota. */
  usage: SubscriptionUsage;
}

/** Narrow the opaque `usage` object (never fabricates — an absent field reads 0). */
function toUsage(raw: unknown): SubscriptionUsage {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    projects: num(r.projects),
    users: num(r.users),
    storage: num(r.storage),
    ai: num(r.ai),
  };
}

/** Narrow the opaque GET /subscription/me object to a typed SubscriptionMe. */
export function toSubscriptionMe(raw: Record<string, unknown>): SubscriptionMe {
  const pkg = raw.package;
  return {
    id: str(raw.id),
    packageId: str(raw.package_id ?? raw.packageId),
    cycle: str(raw.cycle),
    status: str(raw.status),
    renewAt: str(raw.renew_at ?? raw.renewAt),
    startedAt: str(raw.started_at ?? raw.startedAt),
    package: pkg && typeof pkg === "object" ? toPlanRow(pkg as Record<string, unknown>) : null,
    usage: toUsage(raw.usage),
  };
}

/**
 * Whole days from `today` until `renewAt` (ISO). null when renewAt is absent/unparseable
 * (-> the screen em-dashes the count). NOT clamped: a past renewal reads negative, faithfully.
 * Rounded up so any remaining partial day still counts as a day left. Replaces the prototype's
 * hardcoded MY_SUB.daysLeft (192).
 */
export function daysLeft(renewAt: string, today: Date): number | null {
  if (!renewAt) return null;
  const renew = new Date(renewAt);
  if (Number.isNaN(renew.getTime())) return null;
  const MS_PER_DAY = 86_400_000;
  return Math.ceil((renew.getTime() - today.getTime()) / MS_PER_DAY);
}

/**
 * Quota-bar fill percent (subscription.jsx L100): unlimited (-1) shows the prototype's fixed
 * 12% teaser fill; otherwise round(used/cap*100). A non-positive finite cap yields 0
 * (divide-by-zero guard; the prototype's seed always had a positive cap).
 */
export function usagePct(used: number, cap: number): number {
  if (isUnlimited(cap)) return 12;
  if (cap <= 0) return 0;
  return Math.round((used / cap) * 100);
}

/** Usage-bar tone by percent (subscription.jsx pctTone L37): >=90 danger, >=75 warn, else ok. */
export function usagePctTone(pct: number): "danger" | "warn" | "ok" {
  return pct >= 90 ? "danger" : pct >= 75 ? "warn" : "ok";
}

/**
 * Map a subscription status to the sub.mine hero badge. The prototype (subscription.jsx L67)
 * always showed an "approved" badge for its active mock. active|trial -> the "approved" tone
 * + the ONE sub.mine.statusActive key; any other status has no keyed label, so the screen
 * renders the raw backend status code with a defensive (draft) tone (wire-reality "render the
 * raw value" rule, mirroring invoiceBadge).
 */
export function subStatusBadge(status: string): { tone: BadgeTone; labelKind: "active" | "raw" } {
  switch (status) {
    case "active":
    case "trial":
      return { tone: "approved", labelKind: "active" };
    default:
      return { tone: "draft", labelKind: "raw" };
  }
}

/*
 * Pure, i18n-free, ASCII-only display logic for the Platform-Admin screens (admin.subs,
 * admin.plans, admin.invoices), narrowed from pototype/subscription-admin.jsx +
 * pkg-builder.jsx. §0 rule 3 drops the prototype's local arrays (SUBSCRIBERS, inv,
 * PKG_STORE, COMPANY_USERS); everything renders from the real server reads:
 *   GET /admin/packages    packageWire   { id, size, name, price_m, price_y, currency_code,
 *                                          limits, menus, sub_rules }
 *   GET /admin/subscribers subscriberWire { id, company_id, company_name, company_status,
 *                                          package_id, cycle, renew_at, status }
 *   GET /admin/users       userWire      { id, company_id, email, name, role_id, status,
 *                                          department }
 *   GET /admin/invoices    invoiceWire   { id, subscription_id, amount, currency_code,
 *                                          status, created_at }
 * (apps/api/src/routes/admin.ts). All narrowing + derivations live here so they are
 * unit-tested (gate G3); the screens stay declarative.
 *
 * WIRE GAPS (reported honestly, never fabricated — Phase-6 B-179 minimal wire):
 *   - packageWire carries NO `color`/`popular` (colour reconstructed from size, B-037(a);
 *     the popular badge is dropped). MRR is NOT on subscriberWire -> DERIVED from the joined
 *     package price + cycle. subscriberWire carries NO `projects`/`users` counts (projects ->
 *     em-dash in the screen; users -> DERIVED from the /admin/users count per company).
 *   - invoiceWire carries NO invoice-no and NO org (the subscription->company join is not on
 *     the wire) -> em-dash in the screen.
 *   - userWire's `role_id` is an opaque uuid with no role-name join in the Phase-6 admin set
 *     (role -> em-dash); there is no last-login field (-> em-dash).
 *
 * Package `limits` jsonb keys are `storage_gb` / `ai_per_month` (C5), `-1` = unlimited.
 * Enterprise `menus` is the `["*"]` wildcard (= all top-level nav menus).
 */
import type { NavKey } from "@juneflow/i18n";
import type { SectionId } from "../../routes/registry";
import type { NavNode } from "../../shell/nav-tree";

/** Read a string field off an opaque row; "" when absent. */
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

/** Group a FULL-unit amount with thousands separators (ds.jsx fmt th-TH, 0 dp). ASCII. */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n);
  const sign = rounded < 0 ? "-" : "";
  return sign + Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Format an ISO timestamp as YYYY-MM-DD (UTC, deterministic, ASCII). "" when missing. */
export function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/**
 * Plan/package accent colour reconstructed from `size` — the prototype's verbatim size->hex
 * map (packageWire carries no `color`; deterministic styling reconstruction, B-037(a)).
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

/** True when a quota value is unlimited (-1). */
export function isUnlimited(v: number): boolean {
  return v < 0;
}

/** Status-badge tone (ds.jsx STATUS) fed to the screen's tokened <StatusBadge>. */
export type BadgeTone = "approved" | "pending" | "rejected" | "draft";

/* --------------------------------------------------------------------------- */
/* Packages (pkg-builder PkgAdminGrid + subscription-admin CompanyControl quota) */
/* --------------------------------------------------------------------------- */

/** A package/plan as the admin screens consume it (packageWire, narrowed). */
export interface PackageRow {
  id: string;
  size: string;
  name: string;
  /** Monthly price in FULL units, or null (no positive price -> "contact sales"). */
  priceM: number | null;
  /** Yearly price in FULL units, or null (no positive price -> "contact sales"). */
  priceY: number | null;
  projects: number;
  users: number;
  storageGb: number;
  aiPerMonth: number;
  /** Released nav-menu ids (top-level ids, or ["*"] for all). */
  menus: string[];
  /** Plan accent hex (0045 col); "" when absent — the EDIT form preserves it (W1b). */
  color: string;
  /** Marketing tagline (0045 col); "" when absent — the EDIT form preserves it (W1b). */
  tagline: string;
  /** "Popular" flag (0045 col) — the card badge + the EDIT-form round-trip preserve it (W1b). */
  popular: boolean;
}

/** A positive finite number, or null (absent/null/<=0 price -> "contact sales"). */
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

/** Narrow an opaque /admin/packages Entity row to a PackageRow. */
export function toPackageRow(e: Record<string, unknown>): PackageRow {
  return {
    id: str(e.id),
    size: str(e.size),
    name: str(e.name),
    priceM: priceOrNull(e.price_m ?? e.priceM),
    priceY: priceOrNull(e.price_y ?? e.priceY),
    projects: limitOf(e.limits, "projects", "projects"),
    users: limitOf(e.limits, "users", "users"),
    storageGb: limitOf(e.limits, "storage_gb", "storageGb"),
    aiPerMonth: limitOf(e.limits, "ai_per_month", "aiPerMonth"),
    menus: menusOf(e.menus),
    color: str(e.color),
    tagline: str(e.tagline),
    popular: e.popular === true,
  };
}

/** Build an id -> PackageRow map (for the subscriber/package name+colour+quota join). */
export function packageById(packages: readonly PackageRow[]): Map<string, PackageRow> {
  const map = new Map<string, PackageRow>();
  for (const p of packages) if (p.id) map.set(p.id, p);
  return map;
}

/**
 * Expand a package's released-menu ids for the admin.plans card (pkg-builder labelOf +
 * progress). The seed encodes "all menus" as the `["*"]` wildcard (packages seed comment
 * `Full = "*"`); expand it to the client NAV top-level id list so the count + first-5 chips
 * match the prototype's Full-shows-all behaviour. Otherwise the menus are returned as-is.
 */
export function expandMenus(menus: readonly string[], allNavIds: readonly string[]): string[] {
  return menus.includes("*") ? [...allNavIds] : [...menus];
}

/* --------------------------------------------------------------------------- */
/* Package builder (pkg-builder.jsx PkgBuilderForm, L71-113) — W1b (B-197)       */
/* --------------------------------------------------------------------------- */

/** One selectable menu row in the builder's group tree (pkg-builder pkgNavGroups items). */
export interface PkgNavItem {
  id: string;
  /** NAV-registry key (tn) for the item label — never a minted screen key. */
  label: NavKey;
  /** Child-row count (sub[].length), shown as "(n)" after the label. */
  subs: number;
}

/** One group in the builder's menu tree (a section + its items, or the leading pre-section set). */
export interface PkgNavGroup {
  /** Section-header NAV key (tn), or null for the leading "general" group (pre-section items). */
  labelKey: NavKey | null;
  items: PkgNavItem[];
}

/**
 * Group the NAV registry into the builder's 2-level menu tree (pkg-builder.jsx pkgNavGroups,
 * L7-19): items that precede the first section header collect into a leading group whose label
 * the screen resolves to admin.plans.menuGroupGeneral (marked here by labelKey === null); every
 * later item joins the group of the most recent section header (label = navSections[sectionId]).
 * Section labels stay NAV keys so the screen renders them with tn() (never a minted key).
 */
export function pkgNavGroups(
  navTree: readonly NavNode[],
  navSections: Readonly<Record<SectionId, NavKey>>,
): PkgNavGroup[] {
  const groups: PkgNavGroup[] = [];
  let cur: PkgNavGroup = { labelKey: null, items: [] };
  for (const n of navTree) {
    if (n.kind === "section") {
      if (cur.items.length) groups.push(cur);
      cur = { labelKey: navSections[n.sectionId], items: [] };
      continue;
    }
    cur.items.push({ id: n.id, label: n.label, subs: n.sub ? n.sub.length : 0 });
  }
  if (cur.items.length) groups.push(cur);
  return groups;
}

/**
 * The per-size preset menu id set (pkg-builder.jsx pkgPresetIds, L24-34): the prototype's S/M/L
 * id lists intersected with the ids that actually exist in the running NAV registry (allNavIds);
 * Full releases every menu. Cumulative (S ⊂ M ⊂ L), matching the seed.
 */
export function presetMenuIds(size: string, allNavIds: readonly string[]): string[] {
  const has = (x: string): boolean => allNavIds.includes(x);
  const S = ["dashboard", "boq", "proc", "petty", "timeline", "reports"].filter(has);
  const M = [
    ...S,
    "land",
    "subcon",
    "accept",
    "inv",
    "pm",
    "gl",
    "ap",
    "ar",
    "bank",
    "tax",
    "fa",
    "alloc",
    "dms",
    "master",
  ].filter(has);
  const L = [
    ...new Set([...M, "sales", "labor", "opex", "exec", "mobile", "line", "users", "audit", "settings"]),
  ].filter(has);
  if (size === "S") return S;
  if (size === "M") return M;
  if (size === "L") return L;
  return [...allNavIds]; // Full
}

/** The fully-controlled builder form values the screen holds (all strings + a menu id set). */
export interface PackageFormValues {
  size: string;
  name: string;
  /** Digits-only monthly price string ("" when contact / blank). */
  price: string;
  contact: boolean;
  projects: string;
  users: string;
  storage: string;
  ai: string;
  menus: readonly string[];
}

/** Builder validation flags (pkg-builder.jsx save, L96-101): name / price / no-menu. */
export interface PackageFormErrors {
  n?: boolean;
  p?: boolean;
  m?: boolean;
}

/**
 * Validate the builder form (pkg-builder.jsx L97-100): a blank name (n), a missing price on a
 * non-contact tier (p), and an empty menu selection (m). name/price surface as a red border; the
 * empty-menu case additionally drives the needMenu warn-toast + an early return in the screen.
 */
export function validatePackageForm(form: PackageFormValues): PackageFormErrors {
  const e: PackageFormErrors = {};
  if (!form.name.trim()) e.n = true;
  if (!form.contact && !form.price) e.p = true;
  if (form.menus.length === 0) e.m = true;
  return e;
}

/**
 * Compose the opaque POST/PUT /admin/packages body (pkg-builder.jsx save, L102-110) — money =
 * SERVER: send price_m only, NEVER a client price_y/yearly (the door derives price_y = price_m×10
 * and ignores any client yearly). A contact tier sends price_m: null. NO `id` (the create door
 * strips it; edit carries the id in the PATH). `limits` uses the snake keys storage_gb /
 * ai_per_month (C5); the coercions match the prototype (Number(x)||-1, ai ""→50). `color` is
 * omitted on create (the door defaults SIZE_COLOR[size]); an edit preserves the stored
 * color/tagline/popular the form has no inputs for, so a PUT full-replace never wipes them.
 */
export function buildPackageBody(
  form: PackageFormValues,
  isEdit: boolean,
  preset: PackageRow | null,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    size: form.size,
    name: form.name.trim(),
    contact: form.contact,
    price_m: form.contact ? null : Number(form.price),
    limits: {
      projects: Number(form.projects) || -1,
      users: Number(form.users) || -1,
      storage_gb: Number(form.storage) || -1,
      ai_per_month: form.ai === "" ? 50 : Number(form.ai),
    },
    menus: [...form.menus],
    tagline: isEdit && preset ? preset.tagline : "",
    popular: isEdit && preset ? preset.popular : false,
  };
  if (isEdit && preset && preset.color) body.color = preset.color;
  return body;
}

/* --------------------------------------------------------------------------- */
/* Subscribers (subscription-admin.jsx AdminSubscribers, L113-176)              */
/* --------------------------------------------------------------------------- */

/** A subscriber row as AdminSubscribers consumes it (subscriberWire, narrowed). */
export interface SubscriberRow {
  id: string;
  companyId: string;
  /** Joined company display name ("" when unresolved). */
  companyName: string;
  companyStatus: string;
  packageId: string;
  /** subscription_cycle: monthly | yearly. */
  cycle: string;
  /** ISO renewal timestamp ("" when absent). */
  renewAt: string;
  /** subscription_status: trial | active | expiring | overdue | cancelled. */
  status: string;
}

/** Narrow an opaque /admin/subscribers Entity row to a SubscriberRow. */
export function toSubscriberRow(e: Record<string, unknown>): SubscriberRow {
  return {
    id: str(e.id),
    companyId: str(e.company_id ?? e.companyId),
    companyName: str(e.company_name ?? e.companyName),
    companyStatus: str(e.company_status ?? e.companyStatus),
    packageId: str(e.package_id ?? e.packageId),
    cycle: str(e.cycle),
    renewAt: str(e.renew_at ?? e.renewAt),
    status: str(e.status),
  };
}

/** The four subscription statuses the prototype's filter + badge cover (SUB_ST order). */
export const SUB_STATUS_CODES = ["active", "trial", "overdue", "cancelled"] as const;
export type SubStatusCode = (typeof SUB_STATUS_CODES)[number];

/**
 * Map a subscription status to a badge tone + a label discriminant (subscription-admin.jsx
 * SUB_ST). The four known statuses key a label; `expiring`/unknown have NO label key -> the
 * screen renders the raw backend code (wire-reality "render the raw value" rule).
 */
export function subStatusInfo(status: string): {
  tone: BadgeTone;
  labelKind: SubStatusCode | "raw";
} {
  switch (status) {
    case "active":
      return { tone: "approved", labelKind: "active" };
    case "trial":
      return { tone: "pending", labelKind: "trial" };
    case "overdue":
      return { tone: "rejected", labelKind: "overdue" };
    case "cancelled":
      return { tone: "draft", labelKind: "cancelled" };
    default:
      return { tone: "draft", labelKind: "raw" };
  }
}

/**
 * Derive a subscriber's MRR from the joined package price + cycle (subscriberWire carries no
 * MRR). Trial/cancelled or a no-price (Enterprise/Full) package -> 0 (rendered as em-dash,
 * matching the prototype's `—` for mrr==0). yearly -> price_y/12; monthly -> price_m.
 */
export function deriveMrr(pkg: PackageRow | undefined, cycle: string, status: string): number {
  if (!pkg) return 0;
  if (status === "trial" || status === "cancelled") return 0;
  if (cycle === "yearly") return pkg.priceY == null ? 0 : Math.round(pkg.priceY / 12);
  return pkg.priceM == null ? 0 : pkg.priceM;
}

/** Filter inputs for the subscriber toolbar (subscription-admin.jsx L117-122). */
export interface SubscriberFilter {
  q: string;
  pkg: string;
  status: string;
}

/**
 * Filter subscribers like AdminSubscribers (L117-122): a free-text query over org name + id,
 * a package equality filter, and a status equality filter. Empty fields mean "no filter".
 */
export function filterSubscribers(rows: readonly SubscriberRow[], f: SubscriberFilter): SubscriberRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((s) => {
    if (q && !(s.companyName + s.id).toLowerCase().includes(q)) return false;
    if (f.pkg && s.packageId !== f.pkg) return false;
    if (f.status && s.status !== f.status) return false;
    return true;
  });
}

/* --------------------------------------------------------------------------- */
/* Users / roster (subscription-admin.jsx CompanyControl, L241-371)             */
/* --------------------------------------------------------------------------- */

/** A user row as the CompanyControl roster consumes it (userWire, narrowed). */
export interface UserRow {
  id: string;
  companyId: string;
  email: string;
  name: string;
  /** Opaque role uuid (no role-name join in the Phase-6 admin wire). */
  roleId: string;
  /** user_status: active | blocked | invited. */
  status: string;
}

/** Narrow an opaque /admin/users Entity row to a UserRow. */
export function toUserRow(e: Record<string, unknown>): UserRow {
  return {
    id: str(e.id),
    companyId: str(e.company_id ?? e.companyId),
    email: str(e.email),
    name: str(e.name),
    roleId: str(e.role_id ?? e.roleId),
    status: str(e.status),
  };
}

/** Count users per company_id (the admin.subs users column -- no wire count field). */
export function userCountByCompany(users: readonly UserRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const u of users) {
    if (!u.companyId) continue;
    map.set(u.companyId, (map.get(u.companyId) ?? 0) + 1);
  }
  return map;
}

/** The roster for one company (CompanyControl users tab). */
export function usersForCompany(users: readonly UserRow[], companyId: string): UserRow[] {
  return users.filter((u) => u.companyId === companyId);
}

/** Active-user count in a roster (the seat/over-seat comparison). */
export function activeUserCount(roster: readonly UserRow[]): number {
  return roster.filter((u) => u.status === "active").length;
}

/**
 * Whether the active users exceed the seat limit (subscription-admin.jsx overSeat). A seat
 * limit < 0 (unlimited) never over-seats.
 */
export function overSeat(activeCount: number, seatLimit: number): boolean {
  if (seatLimit < 0) return false;
  return activeCount > seatLimit;
}

/**
 * A roster row's status discriminant (subscription-admin.jsx L347-351): active -> a green
 * dot; blocked -> the blocked label; everything else (invited/unknown) -> the inactive
 * label, matching the prototype's else-branch.
 */
export function userStatusKind(status: string): "active" | "blocked" | "inactive" {
  if (status === "blocked") return "blocked";
  if (status === "active") return "active";
  return "inactive";
}

/* --------------------------------------------------------------------------- */
/* Platform invoices (subscription-admin.jsx AdminInvoices, L193-238)           */
/* --------------------------------------------------------------------------- */

/** An invoice row as AdminInvoices consumes it (invoiceWire, narrowed). */
export interface AdminInvoiceRow {
  id: string;
  /** The owning subscription id (invoiceWire subscription_id) -> the org join key. */
  subscriptionId: string;
  amount: number;
  currencyCode: string;
  status: string;
  createdAt: string;
}

/** Narrow an opaque /admin/invoices Entity row to an AdminInvoiceRow. */
export function toAdminInvoiceRow(e: Record<string, unknown>): AdminInvoiceRow {
  return {
    id: str(e.id),
    subscriptionId: str(e.subscription_id ?? e.subscriptionId),
    amount: num(e.amount),
    currencyCode: str(e.currency_code ?? e.currencyCode),
    status: str(e.status),
    createdAt: str(e.created_at ?? e.createdAt),
  };
}

/**
 * Build a subscription-id -> company display name map (the admin.invoices org join):
 * invoice.subscription_id -> subscriber.id (= the subscription id) -> company_name. Empty
 * names are skipped so an unresolved (or name-less) subscription falls through to an em-dash
 * in the screen, never a raw uuid. Mirrors packageById / land-bank projectNameById.
 */
export function subscriberNameById(subscribers: readonly SubscriberRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of subscribers) if (s.id && s.companyName) map.set(s.id, s.companyName);
  return map;
}

/**
 * Map a platform-invoice status to a badge tone + label discriminant (subscription-admin.jsx
 * ST, L201). paid/pending/overdue each key a label; unknown -> the raw backend code.
 */
export function invoiceStatusInfo(status: string): {
  tone: BadgeTone;
  labelKind: "paid" | "pending" | "overdue" | "raw";
} {
  switch (status) {
    case "paid":
      return { tone: "approved", labelKind: "paid" };
    case "pending":
      return { tone: "pending", labelKind: "pending" };
    case "overdue":
      return { tone: "rejected", labelKind: "overdue" };
    default:
      return { tone: "draft", labelKind: "raw" };
  }
}

/** The 3 admin.invoices KPI figures, derived over the fetched list (L202-214). */
export interface InvoiceTotals {
  billedSum: number;
  billedCount: number;
  paidSum: number;
  outstandingSum: number;
  outstandingCount: number;
}

/**
 * Derive the invoice KPIs (subscription-admin.jsx L202-214): billed = SUM(amount) + COUNT;
 * paid = SUM where status==='paid'; outstanding = SUM + COUNT where status!=='paid'.
 */
export function invoiceTotals(rows: readonly AdminInvoiceRow[]): InvoiceTotals {
  let billedSum = 0;
  let paidSum = 0;
  let outstandingSum = 0;
  let outstandingCount = 0;
  for (const r of rows) {
    billedSum += r.amount;
    if (r.status === "paid") {
      paidSum += r.amount;
    } else {
      outstandingSum += r.amount;
      outstandingCount += 1;
    }
  }
  return {
    billedSum,
    billedCount: rows.length,
    paidSum,
    outstandingSum,
    outstandingCount,
  };
}

/**
 * Count active subscribers per package (pkg-builder PkgAdminGrid subsCount, L194): the
 * admin.plans subscriber-count footer = count where package_id matches && status!=='cancelled'.
 */
export function subscriberCountByPackage(subscribers: readonly SubscriberRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of subscribers) {
    if (s.status === "cancelled" || !s.packageId) continue;
    map.set(s.packageId, (map.get(s.packageId) ?? 0) + 1);
  }
  return map;
}

/* --------------------------------------------------------------------------- */
/* Mutation wiring (B-200b) — the CompanyControl action decisions, extracted     */
/* from admin-subs.tsx into pure, node-testable helpers so the control-flow       */
/* contract (which action fires, with which tone, and that a settled toast runs   */
/* exactly once) is guarded by G3. These cover the control-flow contract, NOT     */
/* TanStack's live cross-unmount toast survival (already live-proven 5/5).        */
/* --------------------------------------------------------------------------- */

/**
 * Which subscriber action a company_status implies (subscription-admin.jsx B-194): an active
 * company suspends; anything else (suspended / blank / unknown) resumes. The button swaps only
 * after a REAL flip because it branches on the company_status field, not subscription.status.
 */
export function suspendAction(companyStatus: string): "suspend" | "resume" {
  return companyStatus === "active" ? "suspend" : "resume";
}

/**
 * Which user action a roster status implies + the toast tone it carries (subscription-admin.jsx
 * L596-627): a blocked user unblocks (an "ok" toast); everyone else blocks (a "warn" toast).
 * Derived off userStatusKind so it stays consistent with the roster's status rendering.
 */
export function blockAction(userStatus: string): { action: "block" | "unblock"; tone: "ok" | "warn" } {
  return userStatusKind(userStatus) === "blocked"
    ? { action: "unblock", tone: "ok" }
    : { action: "block", tone: "warn" };
}

/**
 * Whether a roster user can be block/unblock-managed: a blank id would POST /admin/users//block
 * (a malformed path), so the action is gated off a present id (the `!u.id` guard, inverted).
 */
export function canManageUser(id: string): boolean {
  return !!id;
}

/**
 * Fire an id-keyed mutation and route the SETTLED promise to a success/failure callback
 * (subscription-admin.jsx suspend/resume/block/unblock): mutateAsync(id).then(onOk).catch(onErr).
 * The toast fires off the settled promise (not a mutate-scoped onSuccess) because ctx.confirm
 * unmounts the modal before the POST settles; this helper holds ZERO component state, so onOk /
 * onErr each run exactly once regardless of the caller's mount lifecycle. Returns the chain so a
 * test can await it (the screen fires-and-forgets the result).
 */
export function fireWithToast(
  mutateAsync: (id: string) => Promise<unknown>,
  id: string,
  onOk: () => void,
  onErr: () => void,
): Promise<void> {
  return mutateAsync(id).then(onOk).catch(onErr);
}

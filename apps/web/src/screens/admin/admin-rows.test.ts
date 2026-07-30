/*
 * admin-rows unit tests (Platform-Admin screens, gate G3) — the pure display logic narrowed
 * from subscription-admin.jsx + pkg-builder.jsx. Guards the opaque-row narrowing (packages /
 * subscribers / users / invoices, incl. the storage_gb / ai_per_month limit keys and the
 * null-price coercion), the size->colour reconstruction, the menu-wildcard expansion, the
 * subscriber/invoice status maps, the DERIVED MRR / KPI figures, the subscriber filter, and
 * the per-company user + per-package subscriber counts.
 */
import { describe, it, expect, vi } from "vitest";
import type { NavNode } from "../../shell/nav-tree";
import type { NavKey } from "@juneflow/i18n";
import type { SectionId } from "../../routes/registry";
import {
  str,
  num,
  formatMoney,
  formatDate,
  sizeColor,
  isUnlimited,
  toPackageRow,
  packageById,
  expandMenus,
  pkgNavGroups,
  presetMenuIds,
  validatePackageForm,
  buildPackageBody,
  toSubscriberRow,
  subStatusInfo,
  deriveMrr,
  filterSubscribers,
  toUserRow,
  userCountByCompany,
  usersForCompany,
  activeUserCount,
  overSeat,
  userStatusKind,
  suspendAction,
  blockAction,
  canManageUser,
  fireWithToast,
  toAdminInvoiceRow,
  subscriberNameById,
  invoiceStatusInfo,
  invoiceTotals,
  subscriberCountByPackage,
  type PackageRow,
  type PackageFormValues,
  type SubscriberRow,
  type UserRow,
} from "./admin-rows";

describe("primitives (str / num / formatMoney / formatDate / sizeColor / isUnlimited)", () => {
  it("formats money + dates (ASCII)", () => {
    expect(formatMoney(850800)).toBe("850,800");
    expect(formatMoney(0)).toBe("0");
    expect(formatDate("2026-06-01T03:00:00Z")).toBe("2026-06-01");
    expect(formatDate("")).toBe("");
    expect(str(null)).toBe("");
    expect(num("2900.00")).toBe(2900);
  });
  it("reconstructs the size->colour map + reads unlimited", () => {
    expect(sizeColor("S")).toBe("#5A7CA8");
    expect(sizeColor("Full")).toBe("#B45309");
    expect(sizeColor("?")).toBe("#5A7CA8");
    expect(isUnlimited(-1)).toBe(true);
    expect(isUnlimited(100)).toBe(false);
  });
});

describe("toPackageRow / packageById / expandMenus", () => {
  const pkg = toPackageRow({
    id: "M",
    size: "M",
    name: "Professional",
    price_m: "7900.00",
    price_y: "79000.00",
    currency_code: "THB",
    limits: { projects: 10, users: 25, storage_gb: 100, ai_per_month: 50 },
    menus: ["dashboard", "boq", "proc"],
  });

  it("narrows a packageWire row (storage_gb / ai_per_month)", () => {
    expect(pkg).toEqual({
      id: "M",
      size: "M",
      name: "Professional",
      priceM: 7900,
      priceY: 79000,
      projects: 10,
      users: 25,
      storageGb: 100,
      aiPerMonth: 50,
      menus: ["dashboard", "boq", "proc"],
      color: "",
      tagline: "",
      popular: false,
    });
  });

  it("narrows the 0045 color/tagline/popular cols when present (W1b edit round-trip)", () => {
    const rich = toPackageRow({
      id: "M",
      size: "M",
      name: "Pro",
      price_m: 7900,
      limits: {},
      menus: [],
      color: "#0B2A4A",
      tagline: "mid team",
      popular: true,
    });
    expect(rich.color).toBe("#0B2A4A");
    expect(rich.tagline).toBe("mid team");
    expect(rich.popular).toBe(true);
  });

  it("coerces a null/0 price to null (contact sales)", () => {
    const full = toPackageRow({ id: "Full", size: "Full", price_m: 0, price_y: null, limits: { projects: -1, users: -1, storage_gb: 1000, ai_per_month: -1 } });
    expect(full.priceM).toBeNull();
    expect(full.priceY).toBeNull();
    expect(full.projects).toBe(-1);
    expect(full.storageGb).toBe(1000);
  });

  it("packageById maps id -> row", () => {
    const map = packageById([pkg]);
    expect(map.get("M")?.name).toBe("Professional");
    expect(map.has("Z")).toBe(false);
  });

  it("expandMenus expands the ['*'] wildcard to the full nav id list", () => {
    const all = ["dashboard", "boq", "proc", "pm"];
    expect(expandMenus(["*"], all)).toEqual(all);
    expect(expandMenus(["dashboard", "boq"], all)).toEqual(["dashboard", "boq"]);
    expect(expandMenus([], all)).toEqual([]);
  });
});

describe("toSubscriberRow / subStatusInfo / deriveMrr / filterSubscribers", () => {
  const sub = (over: Partial<SubscriberRow> = {}): SubscriberRow => ({
    id: "T-1001",
    companyId: "c1",
    companyName: "Rungrueang Co.",
    companyStatus: "active",
    packageId: "M",
    cycle: "yearly",
    renewAt: "2026-12-31T00:00:00Z",
    status: "active",
    ...over,
  });

  const proPkg: PackageRow = {
    id: "M",
    size: "M",
    name: "Professional",
    priceM: 7900,
    priceY: 79000,
    projects: 10,
    users: 25,
    storageGb: 100,
    aiPerMonth: 50,
    menus: [],
    color: "",
    tagline: "",
    popular: false,
  };
  const fullPkg: PackageRow = { ...proPkg, id: "Full", size: "Full", priceM: null, priceY: null };

  it("narrows a subscriberWire row (company_name / renew_at)", () => {
    expect(
      toSubscriberRow({
        id: "T-1005",
        company_id: "c5",
        company_name: "Metro Co.",
        company_status: "active",
        package_id: "M",
        cycle: "yearly",
        renew_at: "2026-06-24T00:00:00Z",
        status: "trial",
      }),
    ).toEqual({
      id: "T-1005",
      companyId: "c5",
      companyName: "Metro Co.",
      companyStatus: "active",
      packageId: "M",
      cycle: "yearly",
      renewAt: "2026-06-24T00:00:00Z",
      status: "trial",
    });
  });

  it("maps subscription status to tone + label discriminant (expiring -> raw)", () => {
    expect(subStatusInfo("active")).toEqual({ tone: "approved", labelKind: "active" });
    expect(subStatusInfo("trial")).toEqual({ tone: "pending", labelKind: "trial" });
    expect(subStatusInfo("overdue")).toEqual({ tone: "rejected", labelKind: "overdue" });
    expect(subStatusInfo("cancelled")).toEqual({ tone: "draft", labelKind: "cancelled" });
    expect(subStatusInfo("expiring")).toEqual({ tone: "draft", labelKind: "raw" });
  });

  it("derives MRR from package price + cycle (matches the prototype mock values)", () => {
    expect(deriveMrr(proPkg, "yearly", "active")).toBe(6583); // 79000/12 rounded
    expect(deriveMrr(proPkg, "monthly", "active")).toBe(7900);
    expect(deriveMrr(proPkg, "yearly", "trial")).toBe(0);
    expect(deriveMrr(proPkg, "monthly", "cancelled")).toBe(0);
    expect(deriveMrr(fullPkg, "yearly", "active")).toBe(0); // no price -> em-dash
    expect(deriveMrr(undefined, "yearly", "active")).toBe(0);
  });

  it("filters over org name + id, package, and status (AND)", () => {
    const rows = [
      sub({ id: "T-1001", companyName: "Alpha", packageId: "M", status: "active" }),
      sub({ id: "T-1002", companyName: "Beta", packageId: "Full", status: "active" }),
      sub({ id: "T-1006", companyName: "Gamma", packageId: "S", status: "overdue" }),
    ];
    expect(filterSubscribers(rows, { q: "beta", pkg: "", status: "" }).map((s) => s.id)).toEqual(["T-1002"]);
    expect(filterSubscribers(rows, { q: "t-1006", pkg: "", status: "" }).map((s) => s.id)).toEqual(["T-1006"]);
    expect(filterSubscribers(rows, { q: "", pkg: "M", status: "" }).map((s) => s.id)).toEqual(["T-1001"]);
    expect(filterSubscribers(rows, { q: "", pkg: "", status: "overdue" }).map((s) => s.id)).toEqual(["T-1006"]);
    expect(filterSubscribers(rows, { q: "", pkg: "Full", status: "active" }).map((s) => s.id)).toEqual(["T-1002"]);
    expect(filterSubscribers(rows, { q: "", pkg: "", status: "" })).toHaveLength(3);
  });
});

describe("users / roster (toUserRow / counts / seat logic / status kind)", () => {
  const user = (over: Partial<UserRow> = {}): UserRow => ({
    id: "u1",
    companyId: "c1",
    email: "a@x.co.th",
    name: "Somchai",
    roleId: "r1",
    status: "active",
    ...over,
  });

  it("narrows a userWire row (role_id opaque)", () => {
    expect(
      toUserRow({ id: "u9", company_id: "c1", email: "b@x.co.th", name: "Wipha", role_id: "r2", status: "blocked", department: "acct" }),
    ).toEqual({ id: "u9", companyId: "c1", email: "b@x.co.th", name: "Wipha", roleId: "r2", status: "blocked" });
  });

  it("counts users per company + slices a company roster", () => {
    const users = [user({ companyId: "c1" }), user({ id: "u2", companyId: "c1" }), user({ id: "u3", companyId: "c2" })];
    const counts = userCountByCompany(users);
    expect(counts.get("c1")).toBe(2);
    expect(counts.get("c2")).toBe(1);
    expect(usersForCompany(users, "c1").map((u) => u.id)).toEqual(["u1", "u2"]);
  });

  it("derives active count + over-seat + status kind", () => {
    const roster = [user({ status: "active" }), user({ id: "u2", status: "active" }), user({ id: "u3", status: "invited" })];
    expect(activeUserCount(roster)).toBe(2);
    expect(overSeat(2, 1)).toBe(true);
    expect(overSeat(2, 5)).toBe(false);
    expect(overSeat(9, -1)).toBe(false); // unlimited seats never over-seat
    expect(userStatusKind("active")).toBe("active");
    expect(userStatusKind("blocked")).toBe("blocked");
    expect(userStatusKind("invited")).toBe("inactive");
  });
});

describe("invoices (toAdminInvoiceRow / status / KPIs / org join)", () => {
  const rows = [
    toAdminInvoiceRow({ id: "i1", subscription_id: "sub-a", amount: 456000, status: "paid", created_at: "2026-06-01T00:00:00Z" }),
    toAdminInvoiceRow({ id: "i2", subscription_id: "sub-b", amount: 384000, status: "paid", created_at: "2026-06-01T00:00:00Z" }),
    toAdminInvoiceRow({ id: "i3", subscription_id: "sub-c", amount: 7900, status: "pending", created_at: "2026-06-12T00:00:00Z" }),
    toAdminInvoiceRow({ id: "i4", subscription_id: "sub-d", amount: 2900, status: "overdue", created_at: "2026-06-01T00:00:00Z" }),
  ];

  it("narrows subscription_id off the invoice wire (the org join key)", () => {
    const r = toAdminInvoiceRow({ id: "i9", subscription_id: "sub-x", amount: 100, status: "paid", created_at: "2026-06-01T00:00:00Z" });
    expect(r.subscriptionId).toBe("sub-x");
    expect(toAdminInvoiceRow({ id: "i0" }).subscriptionId).toBe(""); // absent -> "" (never fabricated)
  });

  it("maps invoice status to tone + label discriminant", () => {
    expect(invoiceStatusInfo("paid")).toEqual({ tone: "approved", labelKind: "paid" });
    expect(invoiceStatusInfo("pending")).toEqual({ tone: "pending", labelKind: "pending" });
    expect(invoiceStatusInfo("overdue")).toEqual({ tone: "rejected", labelKind: "overdue" });
    expect(invoiceStatusInfo("void")).toEqual({ tone: "draft", labelKind: "raw" });
  });

  it("derives the 3 KPI figures over the fetched list", () => {
    expect(invoiceTotals(rows)).toEqual({
      billedSum: 850800,
      billedCount: 4,
      paidSum: 840000,
      outstandingSum: 10800,
      outstandingCount: 2,
    });
    expect(invoiceTotals([])).toEqual({ billedSum: 0, billedCount: 0, paidSum: 0, outstandingSum: 0, outstandingCount: 0 });
  });
});

describe("subscriberNameById (admin.invoices org join)", () => {
  const subs = [
    { id: "sub-a", companyName: "Alpha Co." },
    { id: "sub-b", companyName: "Beta Co." },
    { id: "sub-e", companyName: "" }, // name-less subscription -> skipped (falls through to em-dash)
    { id: "", companyName: "No Id" }, // idless -> skipped
  ] as SubscriberRow[];
  const map = subscriberNameById(subs);

  it("maps subscription id -> company_name (resolved case)", () => {
    expect(map.get("sub-a")).toBe("Alpha Co.");
    expect(map.get("sub-b")).toBe("Beta Co.");
  });

  it("returns undefined for an unresolved / name-less / idless subscription (screen -> em-dash)", () => {
    expect(map.get("sub-c")).toBeUndefined(); // invoice.subscription_id with no subscriber row
    expect(map.get("sub-e")).toBeUndefined(); // subscription exists but has no company name
    expect(map.get("")).toBeUndefined();
    // The screen renders `map.get(invoice.subscriptionId) ?? DASH` -> a real name or an em-dash.
    expect(map.get("sub-a") ?? "—").toBe("Alpha Co.");
    expect(map.get("sub-c") ?? "—").toBe("—");
  });
});

describe("subscriberCountByPackage", () => {
  it("counts non-cancelled subscribers per package", () => {
    const subs = [
      { packageId: "M", status: "active" },
      { packageId: "M", status: "trial" },
      { packageId: "S", status: "cancelled" },
      { packageId: "Full", status: "active" },
    ] as SubscriberRow[];
    const map = subscriberCountByPackage(subs);
    expect(map.get("M")).toBe(2);
    expect(map.get("S")).toBeUndefined(); // cancelled excluded
    expect(map.get("Full")).toBe(1);
  });
});

/* --------------------------------------------------------------------------- */
/* Package builder pure helpers (W1b, B-197)                                    */
/* --------------------------------------------------------------------------- */

describe("pkgNavGroups", () => {
  const tree = [
    { kind: "item", id: "dashboard", icon: "grid", label: "nav.dashboard" },
    { kind: "item", id: "exec", icon: "chart", label: "nav.exec" },
    { kind: "section", sectionId: "main", label: "nav.section.main.node" },
    {
      kind: "item",
      id: "boq",
      icon: "list",
      label: "nav.boq",
      sub: [
        { id: "boq.a", label: "nav.boq.a" },
        { id: "boq.b", label: "nav.boq.b" },
      ],
    },
    { kind: "item", id: "proc", icon: "cart", label: "nav.proc" },
  ] as unknown as NavNode[];
  const sections = { main: "nav.section.main.key" } as unknown as Readonly<Record<SectionId, NavKey>>;

  it("leads with a general group (labelKey null) for pre-section items, then groups by section", () => {
    expect(pkgNavGroups(tree, sections)).toEqual([
      {
        labelKey: null,
        items: [
          { id: "dashboard", label: "nav.dashboard", subs: 0 },
          { id: "exec", label: "nav.exec", subs: 0 },
        ],
      },
      {
        labelKey: "nav.section.main.key", // resolved from navSections[sectionId], not the node label
        items: [
          { id: "boq", label: "nav.boq", subs: 2 }, // subs = sub[].length
          { id: "proc", label: "nav.proc", subs: 0 },
        ],
      },
    ]);
  });

  it("drops an empty leading group when a section comes first", () => {
    const t2 = [
      { kind: "section", sectionId: "main", label: "x" },
      { kind: "item", id: "a", icon: "i", label: "nav.a" },
    ] as unknown as NavNode[];
    const groups = pkgNavGroups(t2, sections);
    expect(groups).toHaveLength(1);
    expect(groups[0].labelKey).toBe("nav.section.main.key");
  });
});

describe("presetMenuIds", () => {
  const all = [
    "dashboard", "boq", "proc", "petty", "timeline", "reports", "land", "subcon", "accept", "inv",
    "pm", "gl", "ap", "ar", "bank", "tax", "fa", "alloc", "dms", "master", "sales", "labor", "opex",
    "exec", "mobile", "line", "users", "audit", "settings", "extra",
  ];

  it("S = the 6-menu starter set (intersected with the live nav)", () => {
    expect(presetMenuIds("S", all)).toEqual(["dashboard", "boq", "proc", "petty", "timeline", "reports"]);
  });

  it("is cumulative (S ⊂ M ⊂ L)", () => {
    const S = presetMenuIds("S", all);
    const M = presetMenuIds("M", all);
    const L = presetMenuIds("L", all);
    expect(S.every((id) => M.includes(id))).toBe(true);
    expect(M.every((id) => L.includes(id))).toBe(true);
  });

  it("Full = every live nav id (a fresh copy, not the same reference)", () => {
    const full = presetMenuIds("Full", all);
    expect(full).toEqual(all);
    expect(full).not.toBe(all);
  });

  it("intersects with the live nav (drops ids that are not present)", () => {
    expect(presetMenuIds("S", ["dashboard", "boq"])).toEqual(["dashboard", "boq"]);
  });
});

describe("validatePackageForm", () => {
  const base: PackageFormValues = {
    size: "S",
    name: "Starter",
    price: "2900",
    contact: false,
    projects: "2",
    users: "5",
    storage: "20",
    ai: "10",
    menus: ["dashboard"],
  };

  it("passes a complete form (no flags)", () => {
    expect(validatePackageForm(base)).toEqual({});
  });

  it("flags a blank name (n)", () => {
    expect(validatePackageForm({ ...base, name: "   " }).n).toBe(true);
  });

  it("flags a missing price on a non-contact tier (p) but NOT on a contact tier", () => {
    expect(validatePackageForm({ ...base, price: "" }).p).toBe(true);
    expect(validatePackageForm({ ...base, price: "", contact: true }).p).toBeUndefined();
  });

  it("flags an empty menu selection (m)", () => {
    expect(validatePackageForm({ ...base, menus: [] }).m).toBe(true);
  });
});

describe("buildPackageBody (money=SERVER)", () => {
  const form: PackageFormValues = {
    size: "L",
    name: " Business ",
    price: "14900",
    contact: false,
    projects: "30",
    users: "60",
    storage: "300",
    ai: "200",
    menus: ["dashboard", "boq"],
  };

  it("create: NO id, NO price_y/yearly, snake limit keys, tagline ''/popular false, NO color", () => {
    const body = buildPackageBody(form, false, null);
    expect(body).toEqual({
      size: "L",
      name: "Business", // trimmed
      contact: false,
      price_m: 14900, // price_m ONLY — the server derives price_y
      limits: { projects: 30, users: 60, storage_gb: 300, ai_per_month: 200 },
      menus: ["dashboard", "boq"],
      tagline: "",
      popular: false,
    });
    expect("id" in body).toBe(false);
    expect("price_y" in body).toBe(false);
    expect("yearly" in body).toBe(false);
    expect("color" in body).toBe(false);
    expect("currency_code" in body).toBe(false);
    expect("sub_rules" in body).toBe(false);
  });

  it("contact tier: price_m is null", () => {
    expect(buildPackageBody({ ...form, contact: true, price: "" }, false, null).price_m).toBeNull();
  });

  it("limit coercions: 0/'' -> -1 (projects/users/storage), ai '' -> 50 (asymmetric)", () => {
    const body = buildPackageBody({ ...form, projects: "0", users: "", storage: "0", ai: "" }, false, null);
    expect(body.limits).toEqual({ projects: -1, users: -1, storage_gb: -1, ai_per_month: 50 });
  });

  it("edit: preserves color/tagline/popular from the preset; id stays out of the body", () => {
    const preset: PackageRow = {
      id: "biz",
      size: "L",
      name: "Business",
      priceM: 14900,
      priceY: 149000,
      projects: 30,
      users: 60,
      storageGb: 300,
      aiPerMonth: 200,
      menus: ["dashboard"],
      color: "#0F766E",
      tagline: "multi-project",
      popular: true,
    };
    const body = buildPackageBody(form, true, preset);
    expect(body.tagline).toBe("multi-project");
    expect(body.popular).toBe(true);
    expect(body.color).toBe("#0F766E");
    expect("id" in body).toBe(false);
    expect("price_y" in body).toBe(false);
  });

  it("edit with a blank preset color omits color (server default)", () => {
    const preset: PackageRow = {
      id: "s",
      size: "S",
      name: "Starter",
      priceM: 2900,
      priceY: 29000,
      projects: 2,
      users: 5,
      storageGb: 20,
      aiPerMonth: 10,
      menus: [],
      color: "",
      tagline: "",
      popular: false,
    };
    expect("color" in buildPackageBody(form, true, preset)).toBe(false);
  });
});

/* --------------------------------------------------------------------------- */
/* admin.subs + pkg mutation wiring (B-200b)                                    */
/*                                                                              */
/* These guard the CONTROL-FLOW contract (which action fires, with which tone,  */
/* and that a settled toast runs exactly once) — NOT TanStack's live            */
/* cross-unmount toast survival, which is node-untestable here (no jsdom) and    */
/* already live-proven 5/5 + adversarial-verified.                              */
/* --------------------------------------------------------------------------- */

describe("admin.subs + pkg mutation wiring (B-200b)", () => {
  it("suspendAction: active -> suspend, everything else -> resume", () => {
    expect(suspendAction("active")).toBe("suspend");
    expect(suspendAction("suspended")).toBe("resume");
    expect(suspendAction("")).toBe("resume");
    expect(suspendAction("frozen")).toBe("resume");
  });

  it("blockAction: blocked -> unblock/ok, everyone else -> block/warn", () => {
    expect(blockAction("blocked")).toEqual({ action: "unblock", tone: "ok" });
    expect(blockAction("active")).toEqual({ action: "block", tone: "warn" });
    expect(blockAction("invited")).toEqual({ action: "block", tone: "warn" });
    expect(blockAction("")).toEqual({ action: "block", tone: "warn" });
  });

  it("canManageUser: gates the action off a present id", () => {
    expect(canManageUser("")).toBe(false);
    expect(canManageUser("u1")).toBe(true);
  });

  it("fireWithToast: on resolve runs onOk once, never onErr", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    const onOk = vi.fn();
    const onErr = vi.fn();
    await fireWithToast(mutateAsync, "u1", onOk, onErr);
    expect(mutateAsync).toHaveBeenCalledWith("u1");
    expect(onOk).toHaveBeenCalledTimes(1);
    expect(onErr).not.toHaveBeenCalled();
  });

  it("fireWithToast: on reject runs onErr once, never onOk, and does not throw", async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error("boom"));
    const onOk = vi.fn();
    const onErr = vi.fn();
    await expect(fireWithToast(mutateAsync, "u1", onOk, onErr)).resolves.toBeUndefined();
    expect(onOk).not.toHaveBeenCalled();
    expect(onErr).toHaveBeenCalledTimes(1);
  });
});

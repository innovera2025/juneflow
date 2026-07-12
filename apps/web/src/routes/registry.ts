/**
 * Route registry for @juneflow/web (P0-WEB-02).
 *
 * Single source of the route table for the SPA. Transcribed verbatim from the
 * extracted source of truth `docs/extract/NAV-ROUTES.md` (itself extracted from
 * pototype/chrome.jsx `NAV`/`ROUTE_LABELS`/`PARENT_ID_OF_ROUTE` + shell.jsx
 * `RouteView`). PLAN.md section 0 rule 2: NAV-ROUTES.md is the decision for every
 * route id / component / file — do NOT reinterpret it here.
 *
 * STRUCTURAL DATA ONLY: this registry holds route ids, the prototype component
 * name, the owning `.jsx` file, and the module gate — NOT display text. Menu
 * labels are i18n keys resolved with `t()`/`tn()` from @juneflow/i18n and are
 * rendered by the app-shell port (P0-WEB-05, which ports chrome.jsx NAV verbatim).
 * Keeping Thai out of source is enforced by the i18n-guard hook and PLAN.md section 0.
 *
 * PURE DATA: this module imports nothing at runtime (no React, no CSS, no app
 * code) so it can be (a) tree-shaken into the router and (b) loaded by the
 * dependency-free parity checker `scripts/check-nav-parity.mjs` under Node's
 * `--experimental-strip-types`. The checker asserts this registry matches
 * NAV-ROUTES.md 100% by id + component + file + parent (the gate for this task).
 *
 * Rulings applied (PLAN.md Appendix C):
 *  - C7: `boq.bom` is a first-class route even though ROUTE_LABELS omits it (the
 *        menu AND RouteView both have it). The label text itself is chosen at
 *        render time from the NAV-side i18n key (dict key `nav.boq.bom`;
 *        `boq.approval` uses `nav.boq.approval`, the NAV label, not the
 *        ROUTE_LABELS variant) — applied in P0-WEB-05.
 *  - C8: every `subcon.*` route (and the `subcon` alias) is gated by module `subcon`.
 *  - C10: NAV badge numbers are a mock mechanism (hardcoded counts) and are NOT
 *        stored here — production badges come from real queries (P0-WEB-05+).
 */

/** A route that has a Sidebar menu entry (NAV-ROUTES.md sidebar route table). */
export interface NavRoute {
  /** Route id (e.g. "boq.overview"). Unique across the whole registry. */
  id: string;
  /** Prototype component name — for the P0-WEB-05 screen port mapping. */
  component: string;
  /** Source .jsx under pototype/ that owns this screen. */
  file: string;
  /** Module gate id (C8: subcon.* => "subcon"). null = always shown for the view. */
  mod: string | null;
  /** Sidebar section this row sits under (grouping key, not display text). */
  section: SectionId | null;
}

/** A RouteView/ROUTE_LABELS route reachable only by internal navigation (no sidebar entry). */
export interface ExtraRoute {
  id: string;
  component: string;
  file: string;
  mod: string | null;
}

/** Legacy `fin.*` id that RouteView redirects to a real route ("Legacy fin.* routes redirect"). */
export interface LegacyRedirect {
  id: string;
  /** Target route id this legacy id resolves to. */
  target: string;
}

/**
 * Sidebar section grouping ids (the section header rows in NAV-ROUTES.md).
 * These are stable keys; the visible header text uses `nav.sec.*` dict keys in
 * the shell port (I18N-KEYS.md), never hardcoded here.
 *   energy   -> section module solar_sec | sales -> section module sales_sec
 *   platform -> shown only when viewMode = platform
 */
export type SectionId =
  | "main"
  | "energy"
  | "acct"
  | "sales"
  | "system"
  | "usage"
  | "platform";

/**
 * All Sidebar routes, in NAV-ROUTES.md order. 100 entries.
 * Parent is derived from the id prefix via {@link parentOf} (matches the
 * PARENT_ID_OF_ROUTE column exactly), so it is not duplicated here.
 */
export const SIDEBAR_ROUTES: readonly NavRoute[] = [
  { id: "dashboard", component: "Dashboard", file: "dashboard.jsx", mod: null, section: null },
  { id: "exec", component: "ExecDashboard", file: "exec-audit.jsx", mod: null, section: null },

  // Section: main
  { id: "land.pipeline", component: "LandPipeline", file: "land.jsx", mod: "land", section: "main" },
  { id: "land.bank", component: "LandBank", file: "land.jsx", mod: "land", section: "main" },
  { id: "land.survey", component: "LandSurvey", file: "land2.jsx", mod: "land", section: "main" },
  { id: "land.dd", component: "LandDueDiligence", file: "land2.jsx", mod: "land", section: "main" },
  { id: "boq.overview", component: "BOQOverview", file: "boq.jsx", mod: "boq", section: "main" },
  { id: "boq.list", component: "BOQList", file: "boq-list.jsx", mod: "boq", section: "main" },
  { id: "boq.aiqto", component: "AIQuantityTakeoff", file: "ai-qto.jsx", mod: "boq", section: "main" },
  // C7: boq.bom is a real route though ROUTE_LABELS omits it.
  { id: "boq.bom", component: "BOMTemplates", file: "bom.jsx", mod: "boq", section: "main" },
  { id: "boq.editor", component: "BOQEditor", file: "boq.jsx", mod: "boq", section: "main" },
  { id: "boq.approval", component: "BOQApproval", file: "boq.jsx", mod: "boq", section: "main" },
  { id: "boq.archive", component: "BOQArchive", file: "boq.jsx", mod: "boq", section: "main" },
  { id: "boq.reports", component: "BOQReports", file: "boq.jsx", mod: "boq", section: "main" },
  { id: "pr.list", component: "PRList", file: "pr-list.jsx", mod: "proc", section: "main" },
  { id: "po.list", component: "POList", file: "po-wo.jsx", mod: "proc", section: "main" },
  { id: "wo.list", component: "WOList", file: "po-wo.jsx", mod: "proc", section: "main" },
  { id: "gr.list", component: "GRList", file: "gr.jsx", mod: "proc", section: "main" },
  { id: "subcon.progress", component: "SubconProgress", file: "subcon.jsx", mod: "subcon", section: "main" },
  { id: "subcon.contracts", component: "SubconContracts", file: "subcon-accept.jsx", mod: "subcon", section: "main" },
  { id: "timeline", component: "ProjectTimeline", file: "timeline.jsx", mod: "timeline", section: "main" },
  { id: "inv.items", component: "InventoryItems", file: "inventory.jsx", mod: "inv", section: "main" },
  { id: "inv.stock", component: "InventoryStock", file: "inventory.jsx", mod: "inv", section: "main" },
  { id: "inv.transfer", component: "InventoryTransfer", file: "inventory.jsx", mod: "inv", section: "main" },
  { id: "inv.issue", component: "InventoryIssue", file: "inventory.jsx", mod: "inv", section: "main" },
  { id: "petty", component: "PettyCash", file: "petty-alloc.jsx", mod: "petty", section: "main" },
  { id: "accept", component: "AcceptanceCenter", file: "company-accept.jsx", mod: null, section: "main" },
  { id: "labor.attendance", component: "LaborAttendance", file: "labor.jsx", mod: "labor", section: "main" },
  { id: "labor.payroll", component: "LaborPayroll", file: "labor.jsx", mod: "labor", section: "main" },
  { id: "labor.workers", component: "LaborWorkers", file: "labor.jsx", mod: "labor", section: "main" },
  { id: "pm.dashboard", component: "PMDashboard", file: "pm.jsx", mod: "pm", section: "main" },
  { id: "pm.contracts", component: "PMContracts", file: "pm2.jsx", mod: "pm", section: "main" },
  { id: "pm.schedule", component: "PMSchedule", file: "pm2.jsx", mod: "pm", section: "main" },
  { id: "pm.wo", component: "PMWorkOrders", file: "pm3.jsx", mod: "pm", section: "main" },
  { id: "pm.assets", component: "PMAssets", file: "pm.jsx", mod: "pm", section: "main" },

  // Section: energy (section module solar_sec) — each route also carries its own module.
  { id: "solar.monitor", component: "SolarMonitoring", file: "solar.jsx", mod: "om", section: "energy" },
  { id: "solar.ppa", component: "SolarPPA", file: "solar.jsx", mod: "ppa", section: "energy" },
  { id: "solar.roi", component: "SolarROI", file: "solar.jsx", mod: "roi", section: "energy" },
  { id: "solar.permit", component: "SolarPermit", file: "solar.jsx", mod: "permit", section: "energy" },
  { id: "solar.warranty", component: "SolarWarranty", file: "solar.jsx", mod: "warranty", section: "energy" },

  // Section: acct
  { id: "alloc", component: "AllocateCost", file: "petty-alloc.jsx", mod: null, section: "acct" },
  { id: "opex", component: "OpexBudget", file: "opex-budget.jsx", mod: null, section: "acct" },
  { id: "gl.coa", component: "GLChartOfAccounts", file: "accounting-extra.jsx", mod: null, section: "acct" },
  { id: "gl.jv", component: "GLJournalVoucher", file: "gl.jsx", mod: null, section: "acct" },
  { id: "gl.inbox", component: "GLPostingInbox", file: "gl.jsx", mod: null, section: "acct" },
  { id: "gl.trial", component: "GLTrialBalance", file: "gl.jsx", mod: null, section: "acct" },
  { id: "gl.statements", component: "GLStatements", file: "gl.jsx", mod: null, section: "acct" },
  { id: "gl.revrec", component: "GLRevenueWIP", file: "accounting-extra.jsx", mod: null, section: "acct" },
  { id: "gl.cashflow", component: "GLCashFlow", file: "accounting-extra2.jsx", mod: null, section: "acct" },
  { id: "gl.projectpl", component: "GLProjectPL", file: "accounting-extra2.jsx", mod: null, section: "acct" },
  { id: "gl.close", component: "GLPeriodClose", file: "gl.jsx", mod: null, section: "acct" },
  { id: "ap.billing", component: "APBilling", file: "ap.jsx", mod: null, section: "acct" },
  { id: "ap.pv", component: "APPaymentVoucher", file: "ap.jsx", mod: null, section: "acct" },
  { id: "ap.cn-dn", component: "APCreditDebit", file: "ap.jsx", mod: null, section: "acct" },
  { id: "ap.deposit", component: "APDeposit", file: "ap.jsx", mod: null, section: "acct" },
  { id: "ap.retention", component: "APRetention", file: "accounting-extra2.jsx", mod: null, section: "acct" },
  { id: "ap.aging", component: "FinAging", file: "accounting-extra.jsx", mod: null, section: "acct" },
  { id: "ar.invoice", component: "ARInvoice", file: "ar.jsx", mod: null, section: "acct" },
  { id: "ar.tax", component: "ARTaxInvoice", file: "ar.jsx", mod: null, section: "acct" },
  { id: "ar.rv", component: "ARReceiveVoucher", file: "ar.jsx", mod: null, section: "acct" },
  { id: "ar.cn", component: "ARCreditNote", file: "accounting-extra2.jsx", mod: null, section: "acct" },
  { id: "ar.aging", component: "FinAging", file: "accounting-extra.jsx", mod: null, section: "acct" },
  { id: "bank.cheque", component: "BankCheque", file: "bank.jsx", mod: null, section: "acct" },
  { id: "bank.recon", component: "BankReconciliation", file: "bank.jsx", mod: null, section: "acct" },
  { id: "bank.export", component: "BankExport", file: "bank.jsx", mod: null, section: "acct" },
  { id: "tax.vat", component: "TaxVAT", file: "tax.jsx", mod: null, section: "acct" },
  { id: "tax.wht", component: "TaxWHT", file: "tax.jsx", mod: null, section: "acct" },
  { id: "tax.etax", component: "TaxETax", file: "etax.jsx", mod: null, section: "acct" },
  { id: "fa.register", component: "FARegister", file: "fa.jsx", mod: null, section: "acct" },
  { id: "fa.depr", component: "FADepreciation", file: "fa.jsx", mod: null, section: "acct" },
  { id: "fa.adjust", component: "FAAdjust", file: "fa.jsx", mod: null, section: "acct" },

  // Section: sales (section module sales_sec) — sales_re is the real-estate sales module.
  { id: "sales.dashboard", component: "SalesDashboard", file: "sales-crm.jsx", mod: "sales_re", section: "sales" },
  { id: "sales.crm", component: "SalesCRM", file: "sales-crm.jsx", mod: "sales_re", section: "sales" },
  { id: "sales.process", component: "SalesProcess", file: "sales-process.jsx", mod: "sales_re", section: "sales" },
  { id: "sales.down", component: "SalesDown", file: "sales-process.jsx", mod: "sales_re", section: "sales" },
  { id: "sales.loan", component: "SalesLoan", file: "sales-process.jsx", mod: "sales_re", section: "sales" },
  { id: "sales.service", component: "AfterSalesService", file: "sales-service.jsx", mod: "sales_re", section: "sales" },

  // Section: system
  { id: "master.company", component: "MasterCompany", file: "master.jsx", mod: null, section: "system" },
  { id: "master.ptype", component: "MasterProjectType", file: "project-type-screen.jsx", mod: null, section: "system" },
  { id: "master.vendor", component: "MasterVendor", file: "master-party.jsx", mod: null, section: "system" },
  { id: "master.customer", component: "MasterCustomer", file: "master-party.jsx", mod: null, section: "system" },
  { id: "master.project", component: "MasterProject", file: "master.jsx", mod: null, section: "system" },
  { id: "master.model", component: "MasterModel", file: "master.jsx", mod: null, section: "system" },
  { id: "master.cc", component: "MasterCC", file: "master.jsx", mod: null, section: "system" },
  { id: "master.docnum", component: "MasterDocNum", file: "master.jsx", mod: null, section: "system" },
  { id: "users", component: "UsersPermissions", file: "master.jsx", mod: null, section: "system" },
  { id: "reports", component: "ReportsHub", file: "extra-screens.jsx", mod: null, section: "system" },
  { id: "dms", component: "DMSCenter", file: "dms.jsx", mod: null, section: "system" },
  { id: "settings", component: "SettingsCompany", file: "extra-screens.jsx", mod: null, section: "system" },
  { id: "audit", component: "AuditLog", file: "exec-audit.jsx", mod: null, section: "system" },

  // Section: usage
  { id: "sub.mine", component: "SubMine", file: "subscription.jsx", mod: null, section: "usage" },
  { id: "sub.plans", component: "SubPlans", file: "subscription.jsx", mod: null, section: "usage" },
  { id: "sub.billing", component: "SubBilling", file: "subscription.jsx", mod: null, section: "usage" },

  // Section: platform (viewMode=platform)
  { id: "admin.overview", component: "AdminOverview", file: "subscription-admin.jsx", mod: null, section: "platform" },
  { id: "admin.subs", component: "AdminSubscribers", file: "subscription-admin.jsx", mod: null, section: "platform" },
  { id: "admin.plans", component: "AdminPlans", file: "subscription-admin.jsx", mod: null, section: "platform" },
  { id: "admin.invoices", component: "AdminInvoices", file: "subscription-admin.jsx", mod: null, section: "platform" },
  { id: "mobile", component: "MobilePreview", file: "mobile-preview.jsx", mod: null, section: "platform" },
  { id: "line", component: "LineOAPreview", file: "line-oa.jsx", mod: "lineoa", section: "platform" },
  { id: "sync", component: "SyncStatus", file: "master.jsx", mod: null, section: "platform" },
];

/**
 * Routes present in RouteView / ROUTE_LABELS but NOT in the Sidebar (reached by
 * internal navigation). NAV-ROUTES.md "RouteView-only" table.
 * `subcon` is the RouteView alias of `subcon.progress` (same component) — C8: mod subcon.
 * `fin.*` legacy redirects live in {@link LEGACY_REDIRECTS}, not here.
 */
export const EXTRA_ROUTES: readonly ExtraRoute[] = [
  { id: "pr.form", component: "PRForm", file: "pr-form.jsx", mod: "proc" },
  { id: "po.form", component: "POForm", file: "po-wo.jsx", mod: "proc" },
  { id: "wo.form", component: "WOForm", file: "po-wo.jsx", mod: "proc" },
  { id: "subcon", component: "SubconProgress", file: "subcon.jsx", mod: "subcon" },
  { id: "subcon.accept", component: "SubconAccept", file: "subcon-accept2.jsx", mod: "subcon" },
  { id: "subcon.handover", component: "SubconHandover", file: "subcon-accept2.jsx", mod: "subcon" },
  { id: "notifications", component: "NotificationsCenter", file: "extra-screens.jsx", mod: null },
  { id: "login", component: "ScreenLogin", file: "extra-screens.jsx", mod: null },
];

/** Legacy `fin.*` ids -> the real route they redirect to (shell.jsx "Legacy fin.* routes redirect"). */
export const LEGACY_REDIRECTS: readonly LegacyRedirect[] = [
  { id: "fin.ap", target: "ap.billing" }, // APBilling
  { id: "fin.ar", target: "ar.invoice" }, // ARInvoice
  { id: "fin.gl", target: "gl.jv" }, //     GLJournalVoucher
];

/** The route shown on first load (shell.jsx `useState(persisted.route || "dashboard")`). */
export const DEFAULT_ROUTE = "dashboard";

/**
 * id prefix -> parent id (PARENT_ID_OF_ROUTE, NAV-ROUTES.md "parent rules").
 * pr/po/wo/gr all fold into `proc`. Any id whose prefix is absent here (or has
 * no ".") is a top-level route (parent = null), matching the "—" parent column.
 */
const PREFIX_PARENT: Readonly<Record<string, string>> = {
  sub: "sub",
  admin: "admin",
  land: "land",
  labor: "labor",
  pm: "pm",
  subcon: "subcon",
  boq: "boq",
  pr: "proc",
  po: "proc",
  wo: "proc",
  gr: "proc",
  inv: "inv",
  gl: "gl",
  ap: "ap",
  ar: "ar",
  bank: "bank",
  tax: "tax",
  fa: "fa",
  sales: "sales",
  master: "master",
};

/** Parent menu id for a route, or null for a top-level route. */
export function parentOf(id: string): string | null {
  const prefix = id.split(".")[0];
  return PREFIX_PARENT[prefix] ?? null;
}

/**
 * TanStack Router route tree for @juneflow/web.
 *
 * Root layout = the app shell (P0-WEB-05): <ShellProvider> wraps <AppShell/>, which
 * renders the sidebar + per-page topbar chrome around the routed screen (<Outlet/>),
 * ported 1:1 from pototype/shell.jsx + chrome.jsx. Route "login" is full-bleed (no
 * shell) per shell.jsx:106-119. Every route is built from the structural registry
 * (routes/registry.ts, proven 100% == NAV-ROUTES.md by scripts/check-nav-parity.mjs).
 *
 * Screen bodies: login (P1-WEB-01) is ported; every other route renders the shell
 * Placeholder (Page→TopBar + "under development" card) until its screen lands — so the
 * full chrome is demoable now. Labels come from i18n keys, badges from real queries
 * (C10), data from GET /me + GET /projects via the generated client. `fin.*` legacy
 * ids redirect; "/" redirects to the default route ("dashboard").
 */
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import {
  DEFAULT_ROUTE,
  EXTRA_ROUTES,
  LEGACY_REDIRECTS,
  SIDEBAR_ROUTES,
} from "./routes/registry";
import { LoginScreen } from "./screens/login/login-screen";
import { Dashboard } from "./screens/dashboard/dashboard";
import { ExecDashboard } from "./screens/exec/exec";
import { BOQOverview } from "./screens/boq/boq-overview";
import { BOQList } from "./screens/boq/boq-list";
import { BOQEditor } from "./screens/boq/boq-editor";
import { BOMTemplates } from "./screens/boq/boq-bom";
import { BOQApproval } from "./screens/boq/boq-approval";
import { BOQArchive } from "./screens/boq/boq-archive";
import { BOQReports } from "./screens/boq/boq-reports";
import { AIQuantityTakeoff } from "./screens/boq/aiqto";
import { GRList } from "./screens/gr/gr-list";
import { PRList } from "./screens/pr/pr-list";
import { POList } from "./screens/po-wo/po-list";
import { WOList } from "./screens/po-wo/wo-list";
import { SubconContracts } from "./screens/subcon/subcon-contracts";
import { SubconAccept } from "./screens/subcon/subcon-accept";
import { AcceptanceCenter } from "./screens/accept/accept";
import { MasterCC } from "./screens/master/master-cc";
import { MasterDocNum } from "./screens/master/master-docnum";
import { MasterCompany } from "./screens/master/master-company";
import { MasterModel } from "./screens/master/master-model";
import { MasterProject } from "./screens/master/master-project";
import { MasterProjectType } from "./screens/master/master-project-type";
import { MasterVendor } from "./screens/master/master-vendor";
import { MasterCustomer } from "./screens/master/master-customer";
import { UsersPermissions } from "./screens/master/users-permissions";
import { PMDashboard } from "./screens/pm/pm-dashboard";
import { PMContracts } from "./screens/pm/pm-contracts";
import { PMSchedule } from "./screens/pm/pm-schedule";
import { PMAssets } from "./screens/pm/pm-assets";
import { PMWorkOrders } from "./screens/pm/wo-list";
import { GLChartOfAccounts } from "./screens/gl/gl-coa";
import { GLJournalVoucher } from "./screens/gl/gl-jv";
import { GLPostingInbox } from "./screens/gl/gl-inbox";
import { GLTrialBalance } from "./screens/gl/gl-trial";
import { GLStatements } from "./screens/gl/gl-statements";
import { GLCashFlow } from "./screens/gl/gl-cashflow";
import { ARReceiveVoucher } from "./screens/ar/ar-rv";
import { ARTaxInvoice } from "./screens/ar/ar-tax";
import { GLPeriodClose } from "./screens/gl/gl-close";
import { FARegister } from "./screens/fa/fa-register";
import { APBilling } from "./screens/ap/ap-billing";
import { APPaymentVoucher } from "./screens/ap/ap-pv";
import { APRetention } from "./screens/ap/ap-retention";
import { ARAging, APAging } from "./screens/ar/fin-aging";
import { ARCreditNote } from "./screens/ar/ar-cn";
import { BankCheque } from "./screens/bank/bank-cheque";
import { BankReconciliation } from "./screens/bank/bank-recon";
import { BankExport } from "./screens/bank/bank-export";
import { TaxETax } from "./screens/tax/tax-etax";
import { TaxVAT } from "./screens/tax/tax-vat";
import { TaxWHT } from "./screens/tax/tax-wht";
import { FADepreciation } from "./screens/fa/fa-depr";
import { FAAdjust } from "./screens/fa/fa-adjust";
import { ARInvoice } from "./screens/ar/ar-invoice";
import { SalesCRM } from "./screens/sales/sales-crm";
import { SalesProcess } from "./screens/sales/sales-process";
import { SalesDown } from "./screens/sales/sales-down";
import { SalesLoan } from "./screens/sales/sales-loan";
import { AfterSalesService } from "./screens/sales/sales-service";
import { InventoryItems } from "./screens/inventory/inventory-items";
import { InventoryStock } from "./screens/inventory/inventory-stock";
import { InventoryTransfer } from "./screens/inventory/inventory-transfer";
import { InventoryIssue } from "./screens/inventory/inventory-issue";
import { LandPipeline } from "./screens/land/land-pipeline";
import { LandBank } from "./screens/land/land-bank";
import { LandSurvey } from "./screens/land/land-survey";
import { LandDueDiligence } from "./screens/land/land-dd";
import { LaborWorkers } from "./screens/labor/labor-workers";
import { LaborAttendance } from "./screens/labor/labor-attendance";
import { SolarMonitoring } from "./screens/solar/solar-monitor";
import { SolarPPA } from "./screens/solar/solar-ppa";
import { SolarROI } from "./screens/solar/solar-roi";
import { SolarPermit } from "./screens/solar/solar-permit";
import { SolarWarranty } from "./screens/solar/solar-warranty";
import { SubPlans } from "./screens/subscription/sub-plans";
import { SubBilling } from "./screens/subscription/sub-billing";
import { AdminSubscribers } from "./screens/admin/admin-subs";
import { AdminPlans } from "./screens/admin/admin-plans";
import { AdminInvoices } from "./screens/admin/admin-invoices";
import { SubMine } from "./screens/subscription/sub-mine";
import { LineOAPreview } from "./screens/line/line-oa";
import { ShellProvider } from "./shell/shell-context";
import { AppShell } from "./shell/app-shell";
import { Placeholder } from "./shell/page";

/**
 * Ported screens keyed by route id. A route with an entry here renders its real
 * screen; everything else renders the shell Placeholder until its screen lands.
 */
const PORTED_SCREENS: Readonly<Record<string, () => JSX.Element>> = {
  login: LoginScreen,
  dashboard: Dashboard,
  exec: ExecDashboard,
  "land.pipeline": LandPipeline,
  "land.bank": LandBank,
  "land.survey": LandSurvey,
  "land.dd": LandDueDiligence,
  "labor.workers": LaborWorkers,
  "labor.attendance": LaborAttendance,
  "boq.overview": BOQOverview,
  "boq.list": BOQList,
  "boq.editor": BOQEditor,
  "boq.bom": BOMTemplates,
  "boq.approval": BOQApproval,
  "boq.archive": BOQArchive,
  "boq.reports": BOQReports,
  "boq.aiqto": AIQuantityTakeoff,
  "gr.list": GRList,
  "pr.list": PRList,
  "po.list": POList,
  "wo.list": WOList,
  "subcon.contracts": SubconContracts,
  "subcon.accept": SubconAccept,
  accept: AcceptanceCenter,
  "inv.items": InventoryItems,
  "inv.stock": InventoryStock,
  "inv.transfer": InventoryTransfer,
  "inv.issue": InventoryIssue,
  "master.cc": MasterCC,
  "master.docnum": MasterDocNum,
  "master.company": MasterCompany,
  "master.model": MasterModel,
  "master.project": MasterProject,
  "master.ptype": MasterProjectType,
  "master.vendor": MasterVendor,
  "master.customer": MasterCustomer,
  "pm.dashboard": PMDashboard,
  "pm.contracts": PMContracts,
  "pm.schedule": PMSchedule,
  "pm.assets": PMAssets,
  "pm.wo": PMWorkOrders,
  users: UsersPermissions,
  "gl.coa": GLChartOfAccounts,
  "gl.jv": GLJournalVoucher,
  "gl.inbox": GLPostingInbox,
  "gl.trial": GLTrialBalance,
  "gl.statements": GLStatements,
  "gl.cashflow": GLCashFlow,
  "ar.rv": ARReceiveVoucher,
  "ar.tax": ARTaxInvoice,
  "gl.close": GLPeriodClose,
  "fa.register": FARegister,
  "ap.billing": APBilling,
  "ap.pv": APPaymentVoucher,
  "ap.retention": APRetention,
  // FinAging is one shared component (side param); ar.aging + ap.aging both map to it.
  "ar.aging": ARAging,
  "ap.aging": APAging,
  "ar.cn": ARCreditNote,
  "bank.cheque": BankCheque,
  "bank.recon": BankReconciliation,
  "bank.export": BankExport,
  "tax.etax": TaxETax,
  "tax.vat": TaxVAT,
  "tax.wht": TaxWHT,
  "fa.depr": FADepreciation,
  "fa.adjust": FAAdjust,
  "ar.invoice": ARInvoice,
  "sales.crm": SalesCRM,
  "sales.process": SalesProcess,
  "sales.down": SalesDown,
  "sales.loan": SalesLoan,
  "sales.service": AfterSalesService,
  "solar.monitor": SolarMonitoring,
  "solar.ppa": SolarPPA,
  "solar.roi": SolarROI,
  "solar.permit": SolarPermit,
  "solar.warranty": SolarWarranty,
  "sub.plans": SubPlans,
  "sub.billing": SubBilling,
  "admin.subs": AdminSubscribers,
  "admin.plans": AdminPlans,
  "admin.invoices": AdminInvoices,
  "sub.mine": SubMine,
  line: LineOAPreview,
};

const rootRoute = createRootRoute({
  component: () => (
    <ShellProvider>
      <AppShell />
    </ShellProvider>
  ),
});

// Build the "/" index route -> redirect to the default route (shell.jsx default).
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: `/${DEFAULT_ROUTE}` as never });
  },
});

// One route per registered screen (sidebar + RouteView-only). Paths use the raw
// route id as a single literal segment (e.g. "/boq.overview").
const screenRoutes = [...SIDEBAR_ROUTES, ...EXTRA_ROUTES].map((r) => {
  const Ported = PORTED_SCREENS[r.id];
  return createRoute({
    getParentRoute: () => rootRoute,
    path: `/${r.id}`,
    component: Ported ? () => <Ported /> : () => <Placeholder routeId={r.id} />,
  });
});

// Legacy fin.* ids redirect to their real route.
const legacyRoutes = LEGACY_REDIRECTS.map((r) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: `/${r.id}`,
    beforeLoad: () => {
      throw redirect({ to: `/${r.target}` as never });
    },
  }),
);

const routeTree = rootRoute.addChildren([
  indexRoute,
  ...screenRoutes,
  ...legacyRoutes,
]);

export const router = createRouter({ routeTree });

// Register the router instance for full type-safety across the app.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

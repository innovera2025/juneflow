/*
 * REPORT_CATS — the static report-catalogue config for ReportsHub, ported from
 * pototype/extra-screens.jsx REPORT_CATS (L51-64).
 *
 * This is NOT fetched data: the prototype's 7-category x ~32-item grid IS the UI
 * config (a launcher menu), so it lives as a local const (port-screen rule 4 —
 * this is presentational structure, not a mock FK/seed). The prototype held the
 * Thai labels inline; here every label is an i18n dict key (rule 2) resolved via
 * t() at render — no string is minted. The GET /reports/hub contract op has no
 * backend handler, so fetching it would 404; the catalogue is intentionally local.
 *
 * i18n keys: 4 categories use dedicated reports.cat* keys; 3 borrow existing dict
 * keys byte-for-byte (no reports.cat exists for them) — Finance=nav.sec.fin,
 * Sales=nav.sales, Executive=dashboard.roleExec. ~32 items use dedicated
 * reports.item* keys + 2 borrows — Trial-Balance=gl.trial.crumbScreen,
 * Cash-Flow=gl.stmt.tabCf.
 *
 * Colors: var(--brand) where the prototype used it; the 5 remaining accents are
 * prototype-verbatim hexes with no matching token (B-037(a)).
 */
import type { DictKey } from "@juneflow/i18n";
import type { IconName } from "../../ui/icon";

export interface ReportItem {
  /** i18n dict key for the report label (resolved via t() at render). */
  readonly key: DictKey;
  /** Route id to open when this item is a live screen; absent = launcher-only row. */
  readonly route?: string;
}

export interface ReportCat {
  /** i18n dict key for the category name (resolved via t() at render). */
  readonly labelKey: DictKey;
  readonly icon: IconName;
  /** Prototype-verbatim accent: a token var or a B-037(a) verbatim hex. */
  readonly color: string;
  readonly items: readonly ReportItem[];
}

export const REPORT_CATS: readonly ReportCat[] = [
  {
    labelKey: "nav.sec.fin", // borrow: Finance
    icon: "ledger",
    color: "var(--brand)",
    items: [
      { key: "reports.itemPnl" },
      { key: "reports.itemBalance" },
      { key: "gl.trial.crumbScreen" }, // borrow: Trial Balance
      { key: "gl.stmt.tabCf" }, // borrow: Cash Flow
      { key: "reports.itemVat" },
      { key: "reports.itemWht" },
      { key: "reports.itemOpex", route: "opex" },
      { key: "reports.itemOpexMultiYear", route: "opex" },
    ],
  },
  {
    labelKey: "reports.catBoq",
    icon: "budget",
    color: "#1D4ED8",
    items: [
      { key: "reports.itemBoqByProject" },
      { key: "reports.itemBudgetVsActual" },
      { key: "reports.itemCostCenterMonthly" },
      { key: "reports.itemCostVariance" },
    ],
  },
  {
    labelKey: "reports.catProcure",
    icon: "cart",
    color: "#0F766E",
    items: [
      { key: "reports.itemPrPoWo" },
      { key: "reports.itemPoByVendor" },
      { key: "reports.itemStockMovement" },
      { key: "reports.itemStockBelowReorder" },
    ],
  },
  {
    labelKey: "nav.sales", // borrow: Sales
    icon: "trend",
    color: "#B45309",
    items: [
      { key: "reports.itemSalesTransfer" },
      { key: "reports.itemPipeline" },
      { key: "reports.itemDownOutstanding" },
      { key: "reports.itemNewCustomers" },
    ],
  },
  {
    labelKey: "reports.catPm",
    icon: "wrench",
    color: "#6D28D9",
    items: [
      { key: "reports.itemCompliance" },
      { key: "reports.itemWoOverdue" },
      { key: "reports.itemPmCost" },
      { key: "reports.itemContractExpiring" },
    ],
  },
  {
    labelKey: "dashboard.roleExec", // borrow: Executive
    icon: "pie",
    color: "#B91C1C",
    items: [
      { key: "reports.itemPortfolio" },
      { key: "reports.itemProjectHealth" },
      { key: "reports.itemSubscriptionRevenue" },
      { key: "reports.itemKpiOverview" },
    ],
  },
  {
    labelKey: "reports.catQc",
    icon: "check",
    color: "var(--brand)",
    items: [
      { key: "reports.itemAcceptPending", route: "accept" },
      { key: "reports.itemRejectDefect", route: "accept" },
      { key: "reports.itemSlaWaitStats" },
      { key: "reports.itemAcceptHistory" },
    ],
  },
];

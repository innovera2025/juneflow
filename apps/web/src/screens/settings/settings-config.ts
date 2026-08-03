/*
 * Static config for SettingsCompany (route "settings"), extracted from the inline
 * structure of settings.tsx / pototype/extra-screens.jsx SettingsCompany (L99-156).
 *
 * Settings is honest-empty (B-220, Wei-approved): it has NO tenant-settings backend, so
 * this config IS the screen — the tab order, every field label/borrow, the dropdown option
 * codes, and the notification default states. It is presentational structure, not fetched
 * data (port-screen rule 4). The prototype held the Thai labels inline; here every label is
 * an i18n dict key resolved via t() at render (rule 2) — no string is minted. A sibling
 * settings-config.test.ts locks this shape so accidental drift fails fast (mirrors
 * reports-cats.ts + reports-cats.test.ts).
 *
 * i18n borrows (byte-verified, no dedicated settings.* key exists): the "System" breadcrumb
 * crumb = nav.sec.sys · the notif tab = common.notif · the logo upload button =
 * subcon.uploadBtn · Tax ID = org.fieldTaxId · Branch = tax.form.branchUnit · Phone =
 * tax.form30.addrTel · Email = login.email · Address = vendor.fieldAddr · the currency
 * options = boq.listCurBaht / boq.listCurUsd. "English" is a Latin literal (no prototype
 * key); dropdown values are ASCII codes (the prototype used the Thai display string inline).
 */
import type { DictKey } from "@juneflow/i18n";
import type { IconName } from "../../ui/icon";

export interface SettingsTab {
  readonly id: string;
  readonly labelKey: DictKey;
  readonly icon: IconName;
}

export interface CompanyField {
  readonly labelKey: DictKey;
  /** Spans both columns of the 2-col grid (prototype `span={2}`). */
  readonly span?: boolean;
  /** Renders the input with className="num" (numeric glyphs). */
  readonly num?: boolean;
}

export interface SelectOption {
  /** ASCII value code (the prototype used the Thai display string as the value inline). */
  readonly v: string;
  /** i18n dict key for the option label (resolved via t() at render). */
  readonly labelKey?: DictKey;
  /** Latin literal for options with no prototype key ("English"). */
  readonly label?: string;
}

export interface SystemField {
  readonly labelKey: DictKey;
  /** Renders the input with className="num" (numeric-input fields). */
  readonly num?: boolean;
  /** Selected option code — present iff this field is a (disabled) dropdown. */
  readonly defaultValue?: string;
  /** Dropdown options — absent = plain text input. */
  readonly options?: readonly SelectOption[];
}

export interface NotifRow {
  readonly labelKey: DictKey;
  /** Prototype default toggle state (inert — no persistence). */
  readonly on: boolean;
}

export interface SettingsPage {
  /** [System-section crumb, Settings crumb] — first is the nav.sec.sys borrow. */
  readonly breadcrumb: readonly [DictKey, DictKey];
  readonly titleKey: DictKey;
  readonly subtitleKey: DictKey;
  /** Save action — honest-disabled (no backend), so it never fires. */
  readonly saveKey: DictKey;
  readonly logoLabelKey: DictKey;
  /** Logo upload button — borrow subcon.uploadBtn, honest-disabled (no backend). */
  readonly uploadKey: DictKey;
}

export const SETTINGS_PAGE: SettingsPage = {
  breadcrumb: ["nav.sec.sys", "settings.tabSystem"], // borrow: nav.sec.sys
  titleKey: "settings.title",
  subtitleKey: "settings.subtitle",
  saveKey: "common.save",
  logoLabelKey: "settings.logoLabel",
  uploadKey: "subcon.uploadBtn", // borrow
};

export const SETTINGS_TABS: readonly SettingsTab[] = [
  { id: "company", labelKey: "settings.tabCompany", icon: "building" },
  { id: "system", labelKey: "settings.tabSystem", icon: "settings" },
  { id: "notif", labelKey: "common.notif", icon: "bell" }, // borrow: no settings.tabNotif key
];

export const COMPANY_FIELDS: readonly CompanyField[] = [
  { labelKey: "settings.fieldCompanyName", span: true },
  { labelKey: "org.fieldTaxId", num: true }, // borrow
  { labelKey: "tax.form.branchUnit" }, // borrow
  { labelKey: "tax.form30.addrTel", num: true }, // borrow
  { labelKey: "login.email" }, // borrow
  { labelKey: "vendor.fieldAddr", span: true }, // borrow
];

export const SYSTEM_FIELDS: readonly SystemField[] = [
  {
    labelKey: "settings.fieldPrimaryCurrency",
    defaultValue: "THB",
    options: [
      { v: "THB", labelKey: "boq.listCurBaht" }, // borrow
      { v: "USD", labelKey: "boq.listCurUsd" }, // borrow
    ],
  },
  {
    labelKey: "settings.fieldFiscalStart",
    defaultValue: "jan",
    options: [
      { v: "jan", labelKey: "settings.monthJan" },
      { v: "apr", labelKey: "settings.monthApr" },
      { v: "oct", labelKey: "settings.monthOct" },
    ],
  },
  {
    labelKey: "settings.fieldDateFormat",
    defaultValue: "buddhist",
    options: [
      { v: "buddhist", labelKey: "settings.dateBuddhist" },
      { v: "gregorian", labelKey: "settings.dateGregorian" },
    ],
  },
  {
    labelKey: "settings.fieldDefaultLang",
    defaultValue: "th",
    options: [
      { v: "th", labelKey: "settings.langThai" },
      { v: "en", label: "English" }, // Latin literal — no prototype key
      { v: "zh", labelKey: "settings.langZh" },
      { v: "ar", labelKey: "settings.langAr" },
    ],
  },
  { labelKey: "settings.fieldVatRate", num: true },
  { labelKey: "settings.fieldWhtRate", num: true },
];

export const NOTIF_ROWS: readonly NotifRow[] = [
  { labelKey: "settings.notifPendingApproval", on: true },
  { labelKey: "settings.notifBoqContractDue", on: true },
  { labelKey: "settings.notifBudgetOverLimit", on: true },
  { labelKey: "settings.notifPmOverdue", on: true },
  { labelKey: "settings.notifDailyEmail", on: false },
  { labelKey: "settings.notifLineOa", on: true },
];

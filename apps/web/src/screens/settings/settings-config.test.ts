/*
 * Structure lock for the SettingsCompany static config (gate G3). Settings is a
 * fidelity-critical, honest-empty screen (B-220): it has no backend, so this config IS
 * the screen — the tab order, every field label/borrow, the dropdown option codes, and
 * the notification default states. This test pins that shape so accidental drift (a
 * dropped field, a swapped borrow, a flipped toggle default, a raw Thai literal) fails
 * fast. No render — pure config assertions (mirrors reports-cats.test.ts).
 */
import { describe, expect, it } from "vitest";
import {
  COMPANY_FIELDS,
  NOTIF_ROWS,
  SETTINGS_PAGE,
  SETTINGS_TABS,
  SYSTEM_FIELDS,
} from "./settings-config";

describe("SettingsCompany config", () => {
  it("has the prototype's 3 tabs in order (company / system / notif)", () => {
    expect(SETTINGS_TABS.map((tb) => tb.id)).toEqual(["company", "system", "notif"]);
    expect(SETTINGS_TABS.map((tb) => tb.labelKey)).toEqual([
      "settings.tabCompany",
      "settings.tabSystem",
      "common.notif", // borrow: no settings.tabNotif key
    ]);
    expect(SETTINGS_TABS.map((tb) => tb.icon)).toEqual(["building", "settings", "bell"]);
  });

  it("locks the page chrome keys incl the nav.sec.sys + subcon.uploadBtn borrows", () => {
    expect(SETTINGS_PAGE.breadcrumb).toEqual(["nav.sec.sys", "settings.tabSystem"]);
    expect(SETTINGS_PAGE.titleKey).toBe("settings.title");
    expect(SETTINGS_PAGE.subtitleKey).toBe("settings.subtitle");
    expect(SETTINGS_PAGE.saveKey).toBe("common.save");
    expect(SETTINGS_PAGE.logoLabelKey).toBe("settings.logoLabel");
    expect(SETTINGS_PAGE.uploadKey).toBe("subcon.uploadBtn"); // borrow
  });

  it("locks the 6 company-tab field labels (incl 5 borrows) in order", () => {
    expect(COMPANY_FIELDS.map((f) => f.labelKey)).toEqual([
      "settings.fieldCompanyName",
      "org.fieldTaxId", // borrow
      "tax.form.branchUnit", // borrow
      "tax.form30.addrTel", // borrow
      "login.email", // borrow
      "vendor.fieldAddr", // borrow
    ]);
    // taxId + phone are numeric; companyName + address span both columns.
    expect(COMPANY_FIELDS.filter((f) => f.num).map((f) => f.labelKey)).toEqual([
      "org.fieldTaxId",
      "tax.form30.addrTel",
    ]);
    expect(COMPANY_FIELDS.filter((f) => f.span).map((f) => f.labelKey)).toEqual([
      "settings.fieldCompanyName",
      "vendor.fieldAddr",
    ]);
  });

  it("locks the 6 system-tab fields incl the currency-option borrows", () => {
    expect(SYSTEM_FIELDS.map((f) => f.labelKey)).toEqual([
      "settings.fieldPrimaryCurrency",
      "settings.fieldFiscalStart",
      "settings.fieldDateFormat",
      "settings.fieldDefaultLang",
      "settings.fieldVatRate",
      "settings.fieldWhtRate",
    ]);

    const currency = SYSTEM_FIELDS[0];
    expect(currency?.defaultValue).toBe("THB");
    expect(currency?.options?.map((o) => o.labelKey)).toEqual([
      "boq.listCurBaht", // borrow
      "boq.listCurUsd", // borrow
    ]);

    // The language dropdown carries "English" as an ASCII literal (no prototype key).
    const lang = SYSTEM_FIELDS.find((f) => f.labelKey === "settings.fieldDefaultLang");
    expect(lang?.defaultValue).toBe("th");
    expect(lang?.options?.map((o) => o.v)).toEqual(["th", "en", "zh", "ar"]);
    expect(lang?.options?.find((o) => o.v === "en")?.label).toBe("English");

    // The two rate fields are plain numeric inputs (no dropdown options).
    expect(SYSTEM_FIELDS.filter((f) => !f.options).map((f) => f.labelKey)).toEqual([
      "settings.fieldVatRate",
      "settings.fieldWhtRate",
    ]);
    expect(SYSTEM_FIELDS.filter((f) => f.num).map((f) => f.labelKey)).toEqual([
      "settings.fieldVatRate",
      "settings.fieldWhtRate",
    ]);
  });

  it("locks the 6 notification rows at their default on/off states", () => {
    expect(NOTIF_ROWS.map((r) => r.labelKey)).toEqual([
      "settings.notifPendingApproval",
      "settings.notifBoqContractDue",
      "settings.notifBudgetOverLimit",
      "settings.notifPmOverdue",
      "settings.notifDailyEmail",
      "settings.notifLineOa",
    ]);
    expect(NOTIF_ROWS.map((r) => r.on)).toEqual([true, true, true, true, false, true]);
  });

  it("holds no raw Thai — every config value is a dict key or ASCII literal", () => {
    // Thai Unicode block U+0E00..U+0E7F. Built from an ASCII-escaped string via new
    // RegExp so this source file itself carries no Thai byte.
    const THAI = new RegExp("[\\u0E00-\\u0E7F]");
    const values: string[] = [
      ...SETTINGS_PAGE.breadcrumb,
      SETTINGS_PAGE.titleKey,
      SETTINGS_PAGE.subtitleKey,
      SETTINGS_PAGE.saveKey,
      SETTINGS_PAGE.logoLabelKey,
      SETTINGS_PAGE.uploadKey,
      ...SETTINGS_TABS.flatMap((tb) => [tb.id, tb.labelKey, tb.icon]),
      ...COMPANY_FIELDS.map((f) => f.labelKey),
      ...SYSTEM_FIELDS.flatMap((f) => [
        f.labelKey,
        f.defaultValue ?? "",
        ...(f.options ?? []).flatMap((o) => [o.v, o.labelKey ?? "", o.label ?? ""]),
      ]),
      ...NOTIF_ROWS.map((r) => r.labelKey),
    ];
    for (const v of values) expect(v).not.toMatch(THAI);
  });
});

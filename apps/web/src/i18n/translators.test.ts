/**
 * G3 unit tests (PLAN.md §9) — bound translators (P0-WEB-03).
 *
 * Verifies buildTranslators(lang) resolves each layer (t/tn/tp) in the requested
 * language and reports the correct direction (RTL only for "ar"). Expected values
 * are verbatim entries from i18n-full.json (sacred) — the same assertions the
 * @juneflow/i18n package test uses — so nothing is re-translated here (PLAN.md §0).
 */
import { describe, expect, it } from "vitest";
import { buildTranslators } from "./translators";

describe("buildTranslators", () => {
  it("resolves the DICT layer (t) in the bound language", () => {
    expect(buildTranslators("en").t("app.name")).toBe("Construction ERP");
    expect(buildTranslators("zh").t("app.name")).toBe("建筑工程系统");
    expect(buildTranslators("th").t("app.name")).toBe("ระบบงานก่อสร้าง");
  });

  it("resolves the NAV layer (tn) — Thai label is the key", () => {
    expect(buildTranslators("en").tn("งานหลัก")).toBe("Main");
    expect(buildTranslators("zh").tn("งานหลัก")).toBe("主要");
    expect(buildTranslators("ar").tn("งานหลัก")).toBe("الرئيسية");
    // For "th" the Thai key itself is the translation.
    expect(buildTranslators("th").tn("งานหลัก")).toBe("งานหลัก");
  });

  it("resolves the PHRASES layer (tp) — Thai phrase is the key", () => {
    const phrase = "Project Timeline · แผนงานโครงการ";
    expect(buildTranslators("en").tp(phrase)).toBe("Project Timeline");
    expect(buildTranslators("th").tp(phrase)).toBe(phrase);
  });

  it("reports RTL only for Arabic and exposes the four languages", () => {
    expect(buildTranslators("ar").dir).toBe("rtl");
    expect(buildTranslators("en").dir).toBe("ltr");
    expect(buildTranslators("th").dir).toBe("ltr");
    expect(buildTranslators("th").langs.map((l) => l.code)).toEqual([
      "th",
      "zh",
      "en",
      "ar",
    ]);
  });
});

/*
 * Unit tests for dashboard-agg.ts (P1-WEB-07, gate G3) — the pure logic behind the
 * Dashboard screen: opaque-Entity parsers (incl. honest-null wire gaps), the millions/
 * int/percent formatters, project-type + role config, donut geometry, avg-sold, and the
 * budget-vs-actual Chart.js config builder (empty + non-empty series).
 */
import { describe, it, expect } from "vitest";
import type { ChartTheme } from "../../ui/chart";
import {
  entNum,
  entNumOrNull,
  entStr,
  entBoolOrNull,
  entArr,
  parseSummary,
  parseBudgetActual,
  parseApprovals,
  parsePhaseRows,
  parseAlerts,
  parseCashflow,
  parseContractors,
  parseActivity,
  classifyVerb,
  auditDotColor,
  timeAgo,
  millions1,
  formatInt,
  pctOf,
  roleVisibility,
  statusKind,
  kpiBranch,
  avgSold,
  donutGeometry,
  buildBudgetActualConfig,
  type BudgetActual,
  type PhaseRow,
} from "./dashboard-agg";

describe("opaque-Entity field readers", () => {
  it("entNum coerces / defaults to 0", () => {
    expect(entNum({ a: 5 }, "a")).toBe(5);
    expect(entNum({ a: "12.5" }, "a")).toBe(12.5);
    expect(entNum({ a: null }, "a")).toBe(0);
    expect(entNum(undefined, "a")).toBe(0);
    expect(entNum({ a: "x" }, "a")).toBe(0);
  });

  it("entNumOrNull keeps null distinct from 0", () => {
    expect(entNumOrNull({ a: 0 }, "a")).toBe(0);
    expect(entNumOrNull({ a: null }, "a")).toBeNull();
    expect(entNumOrNull({}, "a")).toBeNull();
    expect(entNumOrNull({ a: "3" }, "a")).toBe(3);
  });

  it("entStr returns non-empty string or null", () => {
    expect(entStr({ a: "hi" }, "a")).toBe("hi");
    expect(entStr({ a: "" }, "a")).toBeNull();
    expect(entStr({ a: 3 }, "a")).toBeNull();
  });

  it("entBoolOrNull only accepts booleans", () => {
    expect(entBoolOrNull({ a: true }, "a")).toBe(true);
    expect(entBoolOrNull({ a: false }, "a")).toBe(false);
    expect(entBoolOrNull({ a: "true" }, "a")).toBeNull();
  });

  it("entArr returns the array or []", () => {
    expect(entArr({ a: [{ x: 1 }] }, "a")).toEqual([{ x: 1 }]);
    expect(entArr({ a: "nope" }, "a")).toEqual([]);
    expect(entArr(undefined, "a")).toEqual([]);
  });
});

describe("parseSummary", () => {
  it("maps the budget branch", () => {
    const s = parseSummary({
      project_id: "p1",
      project_name: "RJP",
      project_type: "realestate",
      active_phase_label: "Phase 2 - Block B+C",
      as_of: "2026-05-25T09:42:00.000Z",
      status_label: "active",
      kpi_kind: "budget",
      budget_total: 284_500_000,
      actual_total: 198_200_000,
      committed_total: 42_800_000,
      remaining_total: 43_500_000,
      currency_code: "THB",
      health_score: 71,
      range: "year",
    });
    expect(s).not.toBeNull();
    expect(s!.projectName).toBe("RJP");
    expect(s!.kpiKind).toBe("budget");
    expect(s!.budgetTotal).toBe(284_500_000);
    expect(s!.remainingTotal).toBe(43_500_000);
    expect(s!.installedCapacity).toBeNull();
    expect(s!.healthScore).toBe(71);
  });

  it("maps the solar branch + honest nulls, and returns null for no body", () => {
    const s = parseSummary({
      kpi_kind: "solar",
      installed_capacity: 8,
      energy_ytd: 5983,
      performance_ratio: 83.6,
    });
    expect(s!.kpiKind).toBe("solar");
    expect(s!.installedCapacity).toBe(8);
    expect(s!.projectName).toBeNull();
    expect(parseSummary(undefined)).toBeNull();
  });
});

describe("parseBudgetActual", () => {
  it("honest-empty seed series + real cost categories", () => {
    const ba = parseBudgetActual({
      range: "year",
      range_label: "year",
      period_label: [],
      budget_amount: [],
      actual_amount: [],
      plan_amount: [],
      cost_categories: [
        { category_label: "cat-materials", actual_value: 88_400_000, plan_value: 92_000_000 },
        { category_label: null, actual_value: 0, plan_value: 0 },
      ],
      currency_code: "THB",
    });
    expect(ba!.periodLabel).toEqual([]);
    expect(ba!.costCategories).toHaveLength(2);
    expect(ba!.costCategories[0].label).toBe("cat-materials");
    expect(ba!.costCategories[0].actual).toBe(88_400_000);
    expect(ba!.costCategories[1].label).toBeNull();
  });

  it("coerces string numeric arrays", () => {
    const ba = parseBudgetActual({
      period_label: ["W1", "W2"],
      budget_amount: ["6", "6.5"],
      actual_amount: [6.2, 6.8],
      plan_amount: [],
    });
    expect(ba!.periodLabel).toEqual(["W1", "W2"]);
    expect(ba!.budget).toEqual([6, 6.5]);
    expect(ba!.actual).toEqual([6.2, 6.8]);
  });
});

describe("list parsers", () => {
  it("parseApprovals surfaces wire-gap nulls", () => {
    const rows = parseApprovals([
      {
        kind: "PR",
        doc_no: "PR-2026-0418",
        title: null,
        requester: null,
        amount: 842500,
        currency_code: "THB",
        urgent: null,
      },
    ]);
    expect(rows[0].kind).toBe("PR");
    expect(rows[0].docNo).toBe("PR-2026-0418");
    expect(rows[0].title).toBeNull();
    expect(rows[0].amount).toBe(842500);
    expect(rows[0].urgent).toBeNull();
  });

  it("parsePhaseRows keeps null budget_used/status", () => {
    const rows = parsePhaseRows([
      { name: "phase-1", units: 48, sold: 92, built: 100, budget_used: null, status: null },
    ]);
    expect(rows[0].units).toBe(48);
    expect(rows[0].built).toBe(100);
    expect(rows[0].budgetUsed).toBeNull();
    expect(rows[0].status).toBeNull();
  });

  it("parseAlerts + parseContractors", () => {
    expect(parseAlerts([])).toEqual([]);
    const c = parseContractors([
      { vendor_name: "Vendor A", work_scope: null, progress_pct: 78, retention_amount: 215000, currency_code: "THB" },
    ]);
    expect(c[0].vendorName).toBe("Vendor A");
    expect(c[0].workScope).toBeNull();
    expect(c[0].progressPct).toBe(78);
  });

  it("parseCashflow net + rows (empty on seed)", () => {
    expect(parseCashflow(undefined)).toBeNull();
    const cf = parseCashflow({ net_total: 0, currency_code: "THB", rows: [] });
    expect(cf!.netTotal).toBe(0);
    expect(cf!.rows).toEqual([]);
  });
});

describe("activity feed (GET /audit-log)", () => {
  // A mocked B-014 row page (newest-first), one per known verb + one unknown action.
  // ASCII placeholders stand in for the (Thai) server user_name — parseActivity passes
  // user_name through raw, so the value is opaque to the logic under test (no raw Thai
  // in source, B-073). "system-actor" mirrors the API's system-row label passthrough.
  const feed = [
    { id: "a1", user_id: "u1", user_name: "Wipha", action: "create", entity: "PR-2026-0418", at: "2026-07-19T09:55:00.000Z" },
    { id: "a2", user_id: "u2", user_name: "Somporn", action: "approve", entity: "PO-2026-0290", at: "2026-07-19T09:37:00.000Z" },
    { id: "a3", user_id: null, user_name: "system-actor", action: "sync", entity: "SAP REM", at: "2026-07-19T09:00:00.000Z" },
    { id: "a4", user_id: "u4", user_name: null, action: "delete", entity: "AC-2569-09", at: "2026-07-19T08:00:00.000Z" },
    { id: "a5", user_id: "u5", user_name: "Teerapong", action: "recompute", entity: "GL-04", at: "2026-07-19T07:00:00.000Z" },
    { id: "a6", user_id: "u6", user_name: "extra", action: "edit", entity: "MT-018", at: "2026-07-19T06:00:00.000Z" },
  ];

  it("classifyVerb maps known verbs, else null", () => {
    expect(classifyVerb("create")).toBe("create");
    expect(classifyVerb("edit")).toBe("edit");
    expect(classifyVerb("approve")).toBe("approve");
    expect(classifyVerb("delete")).toBe("delete");
    expect(classifyVerb("post")).toBe("post");
    expect(classifyVerb("sync")).toBe("sync");
    expect(classifyVerb("recompute")).toBeNull();
    expect(classifyVerb("")).toBeNull();
  });

  it("auditDotColor per verb (prototype tones), neutral for unknown", () => {
    expect(auditDotColor("create")).toBe("var(--brand)");
    expect(auditDotColor("approve")).toBe("#15803D");
    expect(auditDotColor("sync")).toBe("#1D4ED8");
    expect(auditDotColor("delete")).toBe("#B91C1C");
    expect(auditDotColor("edit")).toBe("#475569");
    expect(auditDotColor("post")).toBe("#475569");
    expect(auditDotColor(null)).toBe("#475569");
  });

  it("parseActivity keeps the 5 newest rows and maps who/verb/doc", () => {
    const rows = parseActivity(feed);
    expect(rows).toHaveLength(5); // sliced to 5 though the page carries 6
    expect(rows[0]).toEqual({
      id: "a1",
      who: "Wipha",
      verb: "create",
      actionRaw: "create",
      doc: "PR-2026-0418", // entity RAW (no mapping — Wei ruling C-127)
      atIso: "2026-07-19T09:55:00.000Z",
    });
    // system + unresolved user_name flow through honestly (view supplies the fallback).
    expect(rows[2].who).toBe("system-actor");
    expect(rows[3].who).toBeNull();
    // an unknown action keeps verb null + the raw action string.
    expect(rows[4].verb).toBeNull();
    expect(rows[4].actionRaw).toBe("recompute");
  });

  it("parseActivity on an empty page returns [] (→ EmptyState)", () => {
    expect(parseActivity([])).toEqual([]);
  });

  it("timeAgo: minutes under an hour (floor, min 1) then hours (floor)", () => {
    const now = Date.parse("2026-07-19T10:00:00.000Z");
    expect(timeAgo("2026-07-19T09:55:00.000Z", now)).toEqual({ n: 5, unit: "min" }); // 5 min
    expect(timeAgo("2026-07-19T09:59:30.000Z", now)).toEqual({ n: 1, unit: "min" }); // <1 min → 1
    expect(timeAgo("2026-07-19T10:00:00.000Z", now)).toEqual({ n: 1, unit: "min" }); // 0 → 1
    expect(timeAgo("2026-07-19T09:00:00.000Z", now)).toEqual({ n: 1, unit: "hr" });  // 60 min → 1 hr
    expect(timeAgo("2026-07-19T07:30:00.000Z", now)).toEqual({ n: 2, unit: "hr" });  // 150 min → 2 hr
    expect(timeAgo("not-a-date", now)).toEqual({ n: 1, unit: "min" });               // bad ISO → safe
  });
});

describe("formatters", () => {
  it("millions1", () => {
    expect(millions1(284_500_000)).toBe("284.5");
    expect(millions1(0)).toBe("0.0");
    expect(millions1(Number.NaN)).toBe("0.0");
    expect(millions1(-21_400_000)).toBe("-21.4");
  });

  it("formatInt groups with commas, ASCII only", () => {
    expect(formatInt(842500)).toBe("842,500");
    expect(formatInt(-2150000)).toBe("-2,150,000");
    expect(formatInt(96800.4)).toBe("96,800");
    expect(formatInt(Number.NaN)).toBe("0");
  });

  it("pctOf with zero guard", () => {
    expect(pctOf(198.2, 284.5)).toBe(70);
    expect(pctOf(5, 0)).toBe(0);
    expect(pctOf(1, 2)).toBe(50);
  });
});

describe("config maps", () => {
  it("roleVisibility per role (RF map)", () => {
    expect(roleVisibility("exec")).toEqual({ progress: true, cashflow: true });
    expect(roleVisibility("manager")).toEqual({ progress: true, cashflow: true });
    expect(roleVisibility("accountant")).toEqual({ progress: false, cashflow: true });
    expect(roleVisibility("engineer")).toEqual({ progress: true, cashflow: false });
  });

  it("statusKind by project type", () => {
    expect(statusKind("realestate")).toBe("construction");
    expect(statusKind("civil")).toBe("construction");
    expect(statusKind("solar")).toBe("solarCOD");
    expect(statusKind("service")).toBe("operating");
    expect(statusKind(null)).toBe("operating");
  });

  it("kpiBranch by project type", () => {
    expect(kpiBranch("solar")).toBe("solar");
    expect(kpiBranch("civil")).toBe("workProgress");
    expect(kpiBranch("service")).toBe("workProgress");
    expect(kpiBranch("realestate")).toBe("budget");
    expect(kpiBranch(undefined)).toBe("budget");
  });

  it("avgSold over phase rows", () => {
    const rows: PhaseRow[] = [
      { name: "a", units: 1, sold: 92, built: 100, budgetUsed: null, status: null },
      { name: "b", units: 1, sold: 68, built: 62, budgetUsed: null, status: null },
    ];
    expect(avgSold(rows)).toBe(80);
    expect(avgSold([])).toBe(0);
  });
});

describe("donutGeometry", () => {
  it("computes radius/circumference/offset and clamps", () => {
    const g = donutGeometry(0, 90, 10);
    expect(g.radius).toBe(40);
    expect(g.offset).toBeCloseTo(g.circumference, 5); // 0% => full offset
    const full = donutGeometry(100, 90, 10);
    expect(full.offset).toBeCloseTo(0, 5); // 100% => no offset
    const over = donutGeometry(150, 90, 10);
    expect(over.offset).toBeCloseTo(0, 5); // clamped to 100
  });
});

describe("buildBudgetActualConfig", () => {
  const theme: ChartTheme = {
    text: "#475569",
    grid: "#EEF2F5",
    brand: "#0B2A4A",
    brandSoft: "#E8EEF6",
    accent: "#0F766E",
    ok: "#15803D",
    info: "#3B6FB0",
    warn: "#B45309",
    danger: "#B91C1C",
    surface: "#FFFFFF",
    border: "#E4E8EC",
    font: "Inter",
    fsTable: 12,
    fsTh: 10.5,
    radius: 8,
  };
  const labels = { budget: "B", actual: "A", plan: "P" };

  it("empty series → valid empty chart config", () => {
    const empty: BudgetActual = {
      range: "year",
      rangeLabel: "",
      periodLabel: [],
      budget: [],
      actual: [],
      plan: [],
      costCategories: [],
      currencyCode: null,
    };
    const cfg = buildBudgetActualConfig(theme, empty, labels);
    expect(cfg.type).toBe("bar");
    expect(cfg.data.datasets).toHaveLength(3);
    expect(cfg.data.labels).toEqual([]);
    expect(cfg.data.datasets[2].label).toBe("P");
  });

  it("non-empty series → per-period over-budget colouring", () => {
    const ba: BudgetActual = {
      range: "year",
      rangeLabel: "",
      periodLabel: ["W1", "W2"],
      budget: [6, 6.5],
      actual: [6.2, 6.0],
      plan: [6, 6.5],
      costCategories: [],
      currencyCode: null,
    };
    const cfg = buildBudgetActualConfig(theme, ba, labels);
    const actualDs = cfg.data.datasets[1];
    // W1 actual(6.2) > budget(6) => danger; W2 actual(6.0) < budget(6.5) => brand.
    expect(actualDs.backgroundColor).toEqual([theme.danger, theme.brand]);
  });
});

/*
 * AllocateCost SCREEN-SEAM tests (B-433, gate G3) — what the SCREEN puts in the markup, not the
 * pure derivations (that is alloc-rows.test.ts).
 *
 * The properties worth a screen-level test are the ones the ruling turns on: the elements with
 * no data source must show the honest marker rather than a plausible number, the recalculate
 * button must fire nothing, and the totals row must not print the prototype's mock unit count.
 *
 * Harness: the repo's vitest env is `node` (no jsdom), so the screen renders DOM-free with
 * renderToStaticMarkup and its context/chart dependencies are vi.mock'd — the subcon-accept
 * style. tp() reverse-maps a phrase to its sidecar key so the assertions stay ASCII (B-073).
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import strings from "./alloc-strings.json" with { type: "json" };

const DASH = "—";

const h = vi.hoisted(() => ({
  categories: [] as Array<{ label: string | null; plan: number; actual: number }>,
  chartLabels: [] as string[],
  chartOptions: {} as Record<string, unknown>,
}));

const KEY_BY_PHRASE: Record<string, string> = Object.fromEntries(
  Object.entries(strings)
    .filter(([k]) => k !== "_source")
    .map(([k, v]) => [v as string, k]),
);

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    tn: (k: string) => k,
    tp: (k: string) => KEY_BY_PHRASE[k] ?? k,
  }),
}));

vi.mock("../../shell/page", () => ({
  Page: ({ title, subtitle, actions, children }: {
    title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode;
  }) => (
    <div>
      {title}
      {subtitle}
      {actions}
      {children}
    </div>
  ),
}));

// Chart.js needs a canvas; capture the config instead of drawing it.
vi.mock("../../ui/chart", () => ({
  // baseChartOpts echoes the caller's overrides back rather than being stubbed to {},
  // so a test can read exactly what this screen asked the shared helper to CHANGE —
  // and, by what is absent, prove it delegates the rest instead of hand-rolling it.
  // What this cannot observe is anything the real baseChartOpts adds (the animation
  // flag included); that runs in chart.test.tsx against the real function.
  //
  // __viaHelper is a sentinel only this mock can produce, so its presence proves the
  // helper was CALLED. Without it the key-count assertion catches a revert to the old
  // hand-rolled block but not a hand-rolled `{scales}` — one key, right values, no
  // call — which silently drops animation:false and brings back the 684 px capture
  // nondeterminism this whole branch exists to remove.
  baseChartOpts: (_t: unknown, opts: Record<string, unknown>) => ({ ...opts, __viaHelper: true }),
  ChartCanvas: ({ build }: {
    build: (t: Record<string, string>) => {
      data: { labels: string[] };
      options: Record<string, unknown>;
    };
  }) => {
    const cfg = build({ brand: "#b", accent: "#a", danger: "#d", text: "#t", grid: "#g" });
    h.chartLabels = cfg.data.labels;
    h.chartOptions = cfg.options;
    return <div data-chart="1" />;
  },
}));

vi.mock("../../shell/use-shell-data", () => ({
  useProjects: () => ({ data: [{ id: "prj-1", name: "Ratchaphruek Phase 1" }] }),
}));

vi.mock("../dashboard/use-dashboard", () => ({
  useDashboardBudgetActual: () => ({ data: { costCategories: h.categories }, isLoading: false }),
}));

import { AllocateCost } from "./alloc";

const render = (): string => renderToStaticMarkup(<AllocateCost />);

beforeEach(() => {
  h.categories = [
    { label: "01 Site Preparation", plan: 1000000, actual: 1200000 },
    { label: "02 Structural Works", plan: 4000000, actual: 3800000 },
  ];
  h.chartLabels = [];
  h.chartOptions = {};
});

describe("the backed content", () => {
  it("renders each served category with its code split off the label", () => {
    const html = render();
    expect(html).toContain("Site Preparation");
    expect(html).toContain(">01<");
    expect(html).toContain("1,000,000");
    expect(html).toContain("1,200,000");
  });

  it("signs an overspend with a plus and leaves an underspend bare", () => {
    const html = render();
    expect(html).toContain("+200,000");
    expect(html).toContain("-200,000");
  });

  it("feeds the chart the same served categories", () => {
    render();
    expect(h.chartLabels).toEqual(["Site Preparation", "Structural Works"]);
  });

  it("delegates every chart default to baseChartOpts and overrides only its own scales", () => {
    render();
    // Two independent facts about alloc.tsx, neither of them a property of the mock.
    // __viaHelper can only come from baseChartOpts, so it proves the call HAPPENED;
    // "scales" being the only other key proves everything else — responsive,
    // maintainAspectRatio, legend, tooltip, and the animation flag B-431 added — is
    // delegated rather than spelled out on the screen. Revert to the hand-rolled block
    // and the extra keys reappear; hand-roll just `{scales}` and the sentinel vanishes.
    expect(Object.keys(h.chartOptions).sort()).toEqual(["__viaHelper", "scales"]);

    const scales = h.chartOptions.scales as {
      x: { ticks: { color: string } };
      y: { beginAtZero: boolean; grid: { color: string } };
    };
    // Bound to the theme the screen was handed, not to literals of its own.
    expect(scales.x.ticks.color).toBe("#t");
    expect(scales.y.grid.color).toBe("#g");
    expect(scales.y.beginAtZero).toBe(true);
  });

  it("totals the columns and shows the overall percentage", () => {
    const html = render();
    // 5,000,000 standard vs 5,000,000 actual -> 0 variance, 0.0%
    expect(html).toContain("5,000,000");
    expect(html).toContain("0.0%");
  });
});

describe("the elements with no data source", () => {
  it("em-dashes the per-unit KPI instead of showing a plausible figure", () => {
    // No table in the schema carries a per-unit cost (B-433). A number here would be invented.
    const html = render();
    expect(html).toContain("alloc.kpiPerUnit");
    expect(html).toContain(DASH);
  });

  it("does not print the prototype's mock unit count in the totals row", () => {
    // "รวม Block B (84 ยูนิต)" embeds a mock 84 and a block scope with no data path.
    const html = render();
    expect(html).toContain("common.total");
    expect(html).not.toContain("84");
  });

  it("renders exactly one toolbar button — the scope filter is dropped, not faked", () => {
    // The prototype has two toolbar buttons; the block-scope filter has no data path at all,
    // so only the recalculate button survives. Counting them is what static markup can prove;
    // that the survivor is inert is enforced by the absence of a handler in the source, which
    // renderToStaticMarkup cannot see and this file therefore does not claim to test.
    const html = render();
    expect(html).toContain("alloc.btnRecalc");
    expect(html.match(/<button/g) ?? []).toHaveLength(1);
  });
});

describe("an empty or unresolved payload", () => {
  it("renders the table structure with zero totals rather than crashing", () => {
    h.categories = [];
    const html = render();
    expect(html).toContain("alloc.tableTitle");
    expect(html).toContain("0.00");
    expect(h.chartLabels).toEqual([]);
  });

  it("em-dashes a category whose label the server did not resolve", () => {
    h.categories = [{ label: null, plan: 10, actual: 10 }];
    const html = render();
    expect(html).toContain(DASH);
  });
});

/*
 * Chart primitive unit tests (P1-WEB-15, gate G3). Covers the pure helpers
 * (chartTheme token reads + fallbacks, baseChartOpts themed defaults + merge) and
 * the wrapper lifecycle (createThemedChart: create on mount, destroy on unmount,
 * rebuild on deps change) with chart.js mocked. The repo's vitest env is `node`
 * (no jsdom) — so document/getComputedStyle are stubbed and chart.js is mocked
 * rather than exercising a real canvas 2d context, mirroring the DOM-free test
 * style in src/screens/master/*.test.ts. No G5 (this is infra, not a screen).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChartConfiguration } from "chart.js";

// Hoisted mock handles: one shared destroy spy + the constructor spy, reachable
// from both the vi.mock factory and the assertions.
const hoisted = vi.hoisted(() => {
  const destroy = vi.fn();
  const ctor = vi.fn(() => ({ destroy }));
  return { destroy, ctor };
});

vi.mock("chart.js", () => ({
  Chart: Object.assign(hoisted.ctor, { register: vi.fn() }),
  BarController: {},
  LineController: {},
  BarElement: {},
  LineElement: {},
  PointElement: {},
  LinearScale: {},
  CategoryScale: {},
  Tooltip: {},
  Legend: {},
  Filler: {},
}));

import {
  chartTheme,
  baseChartOpts,
  createThemedChart,
  ChartCanvas,
  type ChartTheme,
} from "./chart";

// Token values chosen distinct from the prototype/Fiori fallbacks so every read is
// provable (colors from the navy theme; font/size/radius carry deliberately non-default
// values). Two values carry surrounding whitespace / a px suffix to prove .trim()/parse.
const TOKENS: Record<string, string> = {
  "--text-2": "  #5A6B82  ",
  "--surface-3": "#EEF2F6",
  "--brand": "#0B2A4A",
  "--brand-soft": "#E8EEF6",
  "--accent": "#0F766E",
  "--ok": "#1A7F5A",
  "--warn": "#B7791F",
  "--danger": "#B4453C",
  "--surface": "#FFFFFF",
  "--border": "#E4E9F0",
  "--font": '  "Noto Sans Thai", "Inter", system-ui, sans-serif  ',
  "--fs-table": "12.5px",
  "--fs-th": "9.5px",
  "--r-md": "6px",
};

function stubTokens(values: Record<string, string>): void {
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (k: string) => values[k] ?? "",
  }));
}

const SAMPLE_THEME: ChartTheme = {
  text: "#5A6B82",
  grid: "#EEF2F6",
  brand: "#0B2A4A",
  brandSoft: "#E8EEF6",
  accent: "#0F766E",
  ok: "#1A7F5A",
  warn: "#B7791F",
  danger: "#B4453C",
  surface: "#FFFFFF",
  border: "#E4E9F0",
  font: '"Noto Sans Thai", "Inter", system-ui, sans-serif',
  fsTable: 12.5,
  fsTh: 9.5,
  radius: 6,
};

describe("chartTheme", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps the token CSS vars to the theme (trimmed)", () => {
    stubTokens(TOKENS);
    expect(chartTheme()).toEqual(SAMPLE_THEME);
  });

  it("falls back to the prototype/Fiori literals when a var is empty", () => {
    stubTokens({});
    expect(chartTheme()).toEqual({
      text: "#475569",
      grid: "#EEF2F5",
      brand: "#0B2A4A",
      brandSoft: "#E8EEF6",
      accent: "#0F766E",
      ok: "#15803D",
      warn: "#B45309",
      danger: "#B91C1C",
      surface: "#FFFFFF",
      border: "#E4E8EC",
      font: '"Inter", "Noto Sans Thai", "Noto Sans Arabic", "Noto Sans SC", system-ui, sans-serif',
      fsTable: 12,
      fsTh: 10.5,
      radius: 8,
    });
  });
});

describe("baseChartOpts", () => {
  it("produces the themed defaults", () => {
    const o = baseChartOpts(SAMPLE_THEME);
    expect(o.responsive).toBe(true);
    expect(o.maintainAspectRatio).toBe(false);
    expect(o.plugins?.legend?.display).toBe(false);
    expect(o.plugins?.tooltip?.backgroundColor).toBe(SAMPLE_THEME.surface);
    expect(o.plugins?.tooltip?.borderColor).toBe(SAMPLE_THEME.border);
    expect(o.plugins?.tooltip?.titleColor).toBe(SAMPLE_THEME.text);
    // Font family / sizes / corner radius are token-driven (not hardcoded literals).
    expect(o.plugins?.tooltip?.cornerRadius).toBe(SAMPLE_THEME.radius);
    expect(o.plugins?.tooltip?.titleFont).toMatchObject({
      family: SAMPLE_THEME.font,
      size: SAMPLE_THEME.fsTable,
      weight: 700,
    });
    expect(o.plugins?.tooltip?.bodyFont).toMatchObject({
      family: SAMPLE_THEME.font,
      size: SAMPLE_THEME.fsTable,
    });
    expect(o.interaction?.mode).toBe("index");
    expect(o.interaction?.intersect).toBe(false);
  });

  it("themes the default scales (x/y grid, border, ticks)", () => {
    const o = baseChartOpts(SAMPLE_THEME);
    // toMatchObject avoids indexing the scale-options union (border lives on
    // cartesian scales only), while still asserting the exact themed shape.
    expect(o.scales).toMatchObject({
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: SAMPLE_THEME.text, font: { family: SAMPLE_THEME.font, size: SAMPLE_THEME.fsTh } },
      },
      y: {
        grid: { color: SAMPLE_THEME.grid },
        border: { display: false },
        ticks: { color: SAMPLE_THEME.text, font: { family: SAMPLE_THEME.font, size: SAMPLE_THEME.fsTh } },
      },
    });
  });

  it("merges tooltip overrides while keeping the themed defaults", () => {
    const o = baseChartOpts(SAMPLE_THEME, { tooltip: { backgroundColor: "#000000" } });
    expect(o.plugins?.tooltip?.backgroundColor).toBe("#000000");
    expect(o.plugins?.tooltip?.bodyColor).toBe(SAMPLE_THEME.text);
  });

  it("replaces the scales block when a scales override is given", () => {
    const custom = { x: { display: false } };
    const o = baseChartOpts(SAMPLE_THEME, { scales: custom });
    expect(o.scales).toBe(custom);
  });

  it("spreads root overrides onto the options", () => {
    const o = baseChartOpts(SAMPLE_THEME, { root: { animation: false } });
    expect(o.animation).toBe(false);
  });
});

describe("createThemedChart (wrapper lifecycle)", () => {
  const cfg: ChartConfiguration = { type: "bar", data: { labels: [], datasets: [] } };

  beforeEach(() => {
    hoisted.ctor.mockClear();
    hoisted.destroy.mockClear();
    stubTokens(TOKENS);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns null and builds nothing when the canvas is not attached", () => {
    const build = vi.fn((_t: ChartTheme): ChartConfiguration => cfg);
    expect(createThemedChart(null, build)).toBeNull();
    expect(hoisted.ctor).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
  });

  it("creates a Chart on mount and passes build the resolved theme", () => {
    const canvas = {} as HTMLCanvasElement;
    const build = vi.fn((_t: ChartTheme): ChartConfiguration => cfg);
    const inst = createThemedChart(canvas, build);
    expect(inst).not.toBeNull();
    expect(hoisted.ctor).toHaveBeenCalledTimes(1);
    expect(hoisted.ctor).toHaveBeenCalledWith(canvas, cfg);
    expect(build).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledWith(SAMPLE_THEME);
  });

  it("destroys the instance on unmount cleanup", () => {
    const inst = createThemedChart({} as HTMLCanvasElement, () => cfg);
    inst?.destroy();
    expect(hoisted.destroy).toHaveBeenCalledTimes(1);
  });

  it("rebuilds (destroy prior + create new) when deps change", () => {
    const canvas = {} as HTMLCanvasElement;
    // Effect cycle: mount -> deps change (cleanup destroys, effect re-creates).
    const first = createThemedChart(canvas, () => cfg);
    first?.destroy();
    createThemedChart(canvas, () => cfg);
    expect(hoisted.ctor).toHaveBeenCalledTimes(2);
    expect(hoisted.destroy).toHaveBeenCalledTimes(1);
  });
});

describe("ChartCanvas (render)", () => {
  beforeEach(() => hoisted.ctor.mockClear());

  it("renders a canvas inside a height-sized box and defers chart creation to the effect", () => {
    const build: (t: ChartTheme) => ChartConfiguration = () => ({
      type: "bar",
      data: { labels: [], datasets: [] },
    });
    const html = renderToStaticMarkup(<ChartCanvas build={build} height={200} />);
    expect(html).toContain("<canvas");
    expect(html).toContain("height:200px");
    // Effects do not run during static render — no chart constructed yet.
    expect(hoisted.ctor).not.toHaveBeenCalled();
  });
});

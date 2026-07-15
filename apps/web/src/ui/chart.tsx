/*
 * Chart primitive — Chart.js wrapper + theme-aware helpers, ported 1:1 from
 * pototype/charts.jsx (L1-79). The prototype attaches ChartCanvas/chartTheme/
 * baseChartOpts to `window` (charts.jsx:79) and reads a CDN `window.Chart`; here
 * that global pattern is replaced with real ES imports + exports and the pinned
 * chart.js v4 package (P1-WEB-15). This is UI infrastructure, not a screen — the
 * sole consumer is the dashboard's BudgetActualChart (dashboard.jsx L43+), which
 * is a later task (B-049). No visual gate (G5) applies to a non-screen primitive.
 *
 * §0 fidelity: colors come from the @juneflow/tokens CSS vars via chartTheme()
 * (never hardcoded). The only literals are the hex fallbacks that charts.jsx
 * itself hardcodes verbatim (B-037(a): copied verbatim from the prototype AND with
 * no matching @juneflow/tokens value at that call site — they are pure fallbacks).
 *
 * chart.js v4 migration of two v3-era API details from charts.jsx (identical
 * rendered result, required for the v4 types the plan mandates):
 *   - grid `drawBorder: false`  -> scale `border: { display: false }` (v4 removed drawBorder)
 *   - font `weight: "700"`      -> `weight: 700` (v4 FontSpec.weight is number | keyword)
 */
import { useEffect, useRef, useState } from "react";
import {
  Chart,
  BarController,
  LineController,
  BarElement,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
  type ChartConfiguration,
  type ChartOptions,
} from "chart.js";

// Scoped registration (module load) — only the controllers/elements/scales/plugins
// the composed bar+line dashboard chart needs. chart.js dedups repeat registration.
Chart.register(
  BarController,
  LineController,
  BarElement,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
);

/** Themed color set resolved from the active @juneflow/tokens CSS vars (charts.jsx:3-17). */
export interface ChartTheme {
  text: string;
  grid: string;
  brand: string;
  brandSoft: string;
  accent: string;
  ok: string;
  warn: string;
  danger: string;
  surface: string;
  border: string;
}

/**
 * Read the current token colors off :root (charts.jsx:3-17, verbatim behavior).
 * The hardcoded hex fallbacks are the prototype's own literals (B-037(a)).
 */
export function chartTheme(): ChartTheme {
  const cs = getComputedStyle(document.documentElement);
  return {
    text: cs.getPropertyValue("--text-2").trim() || "#475569",
    grid: cs.getPropertyValue("--surface-3").trim() || "#EEF2F5",
    brand: cs.getPropertyValue("--brand").trim() || "#0B2A4A",
    brandSoft: cs.getPropertyValue("--brand-soft").trim() || "#E8EEF6",
    accent: cs.getPropertyValue("--accent").trim() || "#0F766E",
    ok: cs.getPropertyValue("--ok").trim() || "#15803D",
    warn: cs.getPropertyValue("--warn").trim() || "#B45309",
    danger: cs.getPropertyValue("--danger").trim() || "#B91C1C",
    surface: cs.getPropertyValue("--surface").trim() || "#FFFFFF",
    border: cs.getPropertyValue("--border").trim() || "#E4E8EC",
  };
}

/** Per-call overrides merged by baseChartOpts (charts.jsx:46 `opts`). */
export interface BaseChartOverrides {
  scales?: ChartOptions["scales"];
  tooltip?: NonNullable<NonNullable<ChartOptions["plugins"]>["tooltip"]>;
  root?: Partial<ChartOptions>;
}

/**
 * Common themed tooltip/legend/scale defaults (charts.jsx:46-77). Pure function —
 * returns a fresh options object, merging the caller's tooltip/scales/root overrides.
 */
export function baseChartOpts(t: ChartTheme, opts: BaseChartOverrides = {}): ChartOptions {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: t.surface,
        titleColor: t.text,
        bodyColor: t.text,
        borderColor: t.border,
        borderWidth: 1,
        padding: 10,
        cornerRadius: 8,
        boxPadding: 4,
        usePointStyle: true,
        titleFont: { family: "IBM Plex Sans Thai", size: 12, weight: 700 },
        bodyFont: { family: "IBM Plex Sans Thai", size: 12 },
        ...opts.tooltip,
      },
    },
    scales: opts.scales ?? {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: t.text, font: { family: "IBM Plex Sans Thai", size: 10.5 } },
      },
      y: {
        grid: { color: t.grid },
        border: { display: false },
        ticks: { color: t.text, font: { family: "IBM Plex Sans Thai", size: 10.5 } },
      },
    },
    interaction: { intersect: false, mode: "index" },
    ...opts.root,
  };
}

/**
 * Create a themed Chart on `canvas` from `build(chartTheme())`. Extracted from the
 * ChartCanvas effect so the mount/rebuild lifecycle is unit-testable without a real
 * canvas 2d context (jsdom-free, mirroring the repo's node test env). Returns null
 * when the canvas ref is not yet attached (charts.jsx:31 `if (!ref.current) return`).
 */
export function createThemedChart(
  canvas: HTMLCanvasElement | null,
  build: (t: ChartTheme) => ChartConfiguration,
): Chart | null {
  if (!canvas) return null;
  return new Chart(canvas, build(chartTheme()));
}

export interface ChartCanvasProps {
  /** Receives the resolved theme, returns a Chart.js config (charts.jsx:19 `build`). */
  build: (t: ChartTheme) => ChartConfiguration;
  /** Canvas box height in px (charts.jsx:19 default 240). */
  height?: number;
  /** Extra rebuild dependencies (charts.jsx:19 `deps`), e.g. the dashboard range. */
  deps?: readonly unknown[];
}

/**
 * React wrapper around a Chart.js instance (charts.jsx:19-43). Rebuilds the chart on
 * `deps` change and on a theme/density switch: the prototype watched only `data-theme`
 * (charts.jsx:24-28); the shell drives the live signal via `data-density` (B-042), so
 * both attributes are observed and the chart repaints on either. The prior instance is
 * destroyed on each rebuild/unmount (charts.jsx:35).
 */
export function ChartCanvas({ build, height = 240, deps = [] }: ChartCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const instRef = useRef<Chart | null>(null);
  const [themeNonce, setThemeNonce] = useState(0);

  // Repaint on theme/density change (charts.jsx:22-28 watched data-theme only).
  useEffect(() => {
    const ob = new MutationObserver(() => setThemeNonce((n) => n + 1));
    ob.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-density"],
    });
    return () => ob.disconnect();
  }, []);

  useEffect(() => {
    instRef.current = createThemedChart(canvasRef.current, build);
    return () => {
      instRef.current?.destroy();
      instRef.current = null;
    };
    // Rebuild keys off themeNonce + caller deps, matching charts.jsx:36 exactly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeNonce, ...deps]);

  return (
    <div style={{ position: "relative", height }}>
      <canvas ref={canvasRef} />
    </div>
  );
}

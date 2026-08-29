/*
 * Chart primitive — Chart.js wrapper + theme-aware helpers, ported 1:1 from
 * pototype/charts.jsx (L1-79). The prototype attaches ChartCanvas/chartTheme/
 * baseChartOpts to `window` (charts.jsx:79) and reads a CDN `window.Chart`; here
 * that global pattern is replaced with real ES imports + exports and the pinned
 * chart.js v4 package (P1-WEB-15). This is UI infrastructure, not a screen — the
 * sole consumer is the dashboard's BudgetActualChart (dashboard.jsx L43+), which
 * is a later task (B-049). No visual gate (G5) applies to a non-screen primitive.
 *
 * §0 fidelity: every rendered value — colors, font family, font sizes, and corner
 * radius — is resolved from the @juneflow/tokens CSS vars via chartTheme() (never
 * hardcoded). The only literals here are the resolve-time fallbacks used when a CSS
 * var reads empty (e.g. the stylesheet-free node test env): the hex color fallbacks
 * are copied verbatim from the prototype (B-037(a): no matching @juneflow/tokens
 * value at that call site), and the font/size/radius fallbacks mirror the mandated
 * Fiori theme (--font / --fs-table / --fs-th / --r-md, tokens.css). The prototype's
 * stale "IBM Plex Sans Thai" literal (pototype/charts.jsx) is intentionally dropped —
 * §0 rule 5 mandates the Fiori theme, whose --font is "Inter", "Noto Sans Thai", … .
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
  DoughnutController,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
  type ChartConfiguration,
  type ChartOptions,
} from "chart.js";

// Scoped registration (module load) — only the controllers/elements/scales/plugins
// the app's charts actually need. chart.js dedups repeat registration.
//
// SCOPED REGISTRATION HAS A COST, AND B-445 IS WHAT IT LOOKS LIKE. Registering a
// subset keeps the bundle small, but a screen that asks for an UNREGISTERED type
// does not degrade — Chart.js throws `"doughnut" is not a registered controller`
// during render and React unmounts the whole screen. sales.dashboard shipped that
// way and rendered a 32-character body in the real browser while every gate stayed
// green: the unit tests mock ChartCanvas, E2E is API-level, and G5 had no row for
// it. So a new chart TYPE is a change to this list, not only to the screen —
// chart-registry.enforce.test.ts is what makes that mechanical instead of
// remembered.
Chart.register(
  BarController,
  LineController,
  DoughnutController,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  Legend,
  Filler,
);

/**
 * Themed values resolved from the active @juneflow/tokens CSS vars (charts.jsx:3-17):
 * the color set plus the font family (--font), font sizes (--fs-table / --fs-th),
 * and tooltip corner radius (--r-md). Sizes/radius are parsed to numbers for Chart.js.
 */
export interface ChartTheme {
  text: string;
  grid: string;
  brand: string;
  brandSoft: string;
  accent: string;
  ok: string;
  warn: string;
  /** --info. Added for B-446 — the doughnut's "sold" segment needs it RESOLVED. */
  info: string;
  danger: string;
  surface: string;
  border: string;
  /** --font family stack (replaces the prototype's stale "IBM Plex Sans Thai"). */
  font: string;
  /** --fs-table (px, as a number) — tooltip title/body font size. */
  fsTable: number;
  /** --fs-th (px, as a number) — axis tick font size. */
  fsTh: number;
  /** --r-md (px, as a number) — tooltip corner radius. */
  radius: number;
}

/**
 * Read the current token values off :root once per build (charts.jsx:3-17, verbatim
 * behavior). Colors are strings; sizes/radius are parsed from their px token values to
 * the numbers Chart.js requires. All fallbacks fire only when a var reads empty
 * (B-037(a): hex fallbacks are the prototype's literals; the font/size/radius
 * fallbacks mirror the mandated Fiori theme).
 */
export function chartTheme(): ChartTheme {
  const cs = getComputedStyle(document.documentElement);
  const px = (name: string, fallback: number): number => {
    const n = parseFloat(cs.getPropertyValue(name));
    return Number.isNaN(n) ? fallback : n;
  };
  return {
    text: cs.getPropertyValue("--text-2").trim() || "#475569",
    grid: cs.getPropertyValue("--surface-3").trim() || "#EEF2F5",
    brand: cs.getPropertyValue("--brand").trim() || "#0B2A4A",
    brandSoft: cs.getPropertyValue("--brand-soft").trim() || "#E8EEF6",
    accent: cs.getPropertyValue("--accent").trim() || "#0F766E",
    ok: cs.getPropertyValue("--ok").trim() || "#15803D",
    warn: cs.getPropertyValue("--warn").trim() || "#B45309",
    info: cs.getPropertyValue("--info").trim() || "#3B6FB0",
    danger: cs.getPropertyValue("--danger").trim() || "#B91C1C",
    surface: cs.getPropertyValue("--surface").trim() || "#FFFFFF",
    border: cs.getPropertyValue("--border").trim() || "#E4E8EC",
    font:
      cs.getPropertyValue("--font").trim() ||
      '"Inter", "Noto Sans Thai", "Noto Sans Arabic", "Noto Sans SC", system-ui, sans-serif',
    fsTable: px("--fs-table", 12),
    fsTh: px("--fs-th", 10.5),
    radius: px("--r-md", 8),
  };
}

/**
 * The COLOUR fields of ChartTheme — the ones safe to hand to a canvas.
 *
 * Exists so a screen can key a lookup table by theme field (see sales-dashboard's
 * STATUS_TOKEN) and have the compiler reject `font`, `fsTable`, `fsTh` or `radius`,
 * which are a font stack and three numbers and would be nonsense as a fill colour.
 */
export type ChartColorKey = Exclude<
  { [K in keyof ChartTheme]: ChartTheme[K] extends string ? K : never }[keyof ChartTheme],
  "font"
>;

/** Per-call overrides merged by baseChartOpts (charts.jsx:46 `opts`). */
export interface BaseChartOverrides {
  scales?: ChartOptions["scales"];
  tooltip?: NonNullable<NonNullable<ChartOptions["plugins"]>["tooltip"]>;
  root?: Partial<ChartOptions>;
}

/**
 * Does this browser ask for reduced motion?
 *
 * WHY A CHART READS THIS. Chart.js animates on mount, so a screenshot taken while
 * the animation is still running captures an intermediate frame. Measured at the G5
 * gate: two captures of the same screen on the SAME stack differed by 684 px on
 * alloc (the top edge of six bars) and 7,221 px on timeline (the whole S-curve and
 * its point markers) — one pixel of bar height, one frame of easing. A screen that
 * cannot be captured twice the same way cannot be a regression anchor.
 *
 * The fix is the setting that already means "do not animate at me", not a test-only
 * branch: the gate captures with reducedMotion 'reduce' (the visual playwright
 * config) and a real user who sets it gets the same still chart. Everyone else keeps
 * the animation the prototype has.
 *
 * The try/catch is the whole guard, and it is load-bearing rather than decorative:
 * matchMedia is ABSENT in the node test environment, so calling it throws, and a
 * chart that threw there would take the whole suite with it. A separate typeof check
 * was written here first and removed — a mutation run showed it changed no outcome,
 * because the catch already covers the same case, and two mechanisms for one guard
 * is one more than can be kept true.
 */
export function prefersReducedMotion(): boolean {
  try {
    return globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * Common themed tooltip/legend/scale defaults (charts.jsx:46-77). Pure function —
 * returns a fresh options object, merging the caller's tooltip/scales/root overrides.
 */
export function baseChartOpts(t: ChartTheme, opts: BaseChartOverrides = {}): ChartOptions {
  return {
    responsive: true,
    maintainAspectRatio: false,
    // See prefersReducedMotion above: false stills the chart, `undefined` leaves
    // Chart.js's own default alone rather than re-specifying it here.
    animation: prefersReducedMotion() ? false : undefined,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: t.surface,
        titleColor: t.text,
        bodyColor: t.text,
        borderColor: t.border,
        borderWidth: 1,
        padding: 10,
        cornerRadius: t.radius,
        boxPadding: 4,
        usePointStyle: true,
        titleFont: { family: t.font, size: t.fsTable, weight: 700 },
        bodyFont: { family: t.font, size: t.fsTable },
        ...opts.tooltip,
      },
    },
    scales: opts.scales ?? {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { color: t.text, font: { family: t.font, size: t.fsTh } },
      },
      y: {
        grid: { color: t.grid },
        border: { display: false },
        ticks: { color: t.text, font: { family: t.font, size: t.fsTh } },
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

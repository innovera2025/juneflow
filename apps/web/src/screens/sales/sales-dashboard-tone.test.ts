import { describe, it, expect } from "vitest";
import type { ChartTheme } from "../../ui/chart";
import { statusChartTone } from "./sales-dashboard";
import { UNIT_STATUS_ORDER, type UnitStatus } from "./sales-dashboard-rows";

/**
 * The doughnut's five segment colours must reach the canvas RESOLVED (B-446).
 *
 * WHAT WENT WRONG. The screen handed Chart.js the same strings the DOM legend uses —
 * `"var(--ok)"`, `"var(--info)"`, … . A DOM node resolves those; a canvas does not.
 * `ctx.fillStyle = "var(--ok)"` is an invalid assignment, which canvas SILENTLY
 * ignores, so all five arcs kept their initial black. Nothing threw, so there was no
 * console error, and the legend beside the chart rendered the five correct colours —
 * which is what made it look right in every check short of looking at the pixels. It
 * was found by sampling the first G5 capture: 18 points around the ring, all (0,0,0).
 *
 * WHY THESE ASSERTIONS AND NOT "it equals #1A7F5A". Pinning hexes would re-state the
 * theme and pass just as happily if the screen went back to emitting `var()` strings
 * for a DIFFERENT token. The two properties that actually matter are: the value is
 * something a canvas can parse (no `var(`), and it is the value the shared token read
 * produced for that status. Both die when the fix is reverted.
 */

const THEME: ChartTheme = {
  // Deliberately distinct per field, so a lookup pointing at the WRONG theme colour
  // (say `sold` -> ok instead of info) fails instead of matching by coincidence.
  text: "#111111",
  grid: "#222222",
  brand: "#333333",
  brandSoft: "#444444",
  accent: "#555555",
  ok: "#666666",
  info: "#777777",
  warn: "#888888",
  danger: "#999999",
  surface: "#AAAAAA",
  border: "#BBBBBB",
  font: "TestFont, sans-serif",
  fsTable: 12,
  fsTh: 10,
  radius: 8,
};

/** The token each status takes, read from the prototype (sales-crm.jsx L74-78). */
const EXPECTED: Record<UnitStatus, keyof ChartTheme> = {
  soldBuilt: "ok",
  sold: "info",
  booked: "warn",
  built: "accent",
  empty: "grid",
};

describe("statusChartTone — canvas colours are resolved, never CSS vars (B-446)", () => {
  it("covers every status the doughnut actually draws", () => {
    // Guards the loops below against silently iterating nothing.
    expect(UNIT_STATUS_ORDER.length).toBe(5);
    expect(new Set(UNIT_STATUS_ORDER).size).toBe(5);
  });

  it("returns a value a canvas can parse — no var() reaches fillStyle", () => {
    for (const s of UNIT_STATUS_ORDER) {
      const tone = statusChartTone(THEME, s);
      expect(tone, `${s} must not be a CSS custom property`).not.toContain("var(");
      expect(tone, `${s} must be a resolved colour`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("maps each status to the token the prototype gives it", () => {
    for (const s of UNIT_STATUS_ORDER) {
      expect(statusChartTone(THEME, s), `${s}`).toBe(THEME[EXPECTED[s]]);
    }
  });

  it("gives the five segments five DISTINCT colours", () => {
    // The rendered defect was five identical black wedges; a mapping collapse that
    // sent every status to one field would reproduce that shape with real colours.
    const tones = UNIT_STATUS_ORDER.map((s) => statusChartTone(THEME, s));
    expect(new Set(tones).size).toBe(UNIT_STATUS_ORDER.length);
  });
});

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { Chart } from "chart.js";
import "./chart";

/**
 * Every chart TYPE a screen asks for must be registered in ui/chart.tsx (B-445).
 *
 * WHY THIS EXISTS, and why it is a source scan rather than a unit test. `ui/chart.tsx`
 * registers a SUBSET of Chart.js on purpose, to keep the bundle small. The failure mode
 * of that choice is not a degraded chart: Chart.js THROWS `"<type>" is not a registered
 * controller` during render, React unwinds, and the whole screen renders blank.
 *
 * sales.dashboard (B-442) shipped exactly that. It is the only doughnut in the app, the
 * controller was never registered, and in a real browser the page produced a
 * 32-character body with 8 successful API calls behind it — the data was fine, the
 * screen was not. Nothing in the repo could see it:
 *   - unit tests mock ChartCanvas, so the real Chart.js never runs;
 *   - `type: "doughnut"` is a valid string literal, so typecheck is happy;
 *   - E2E is API-level;
 *   - and G5 had no manifest row for the screen (B-443), so the one gate with eyes
 *     was not looking. It was found the first time the gate DID look.
 *
 * A unit test asserting "doughnut is registered" would only re-state today's fix. This
 * asserts the PROPERTY — every type any screen asks for is registered — so the next
 * screen that adds a pie or a radar fails here instead of in front of a user.
 *
 * SCOPE, stated honestly rather than implied: it matches literal `type: "<name>"` where
 * the name is one of Chart.js's built-in controller ids. A type assembled at runtime
 * (`type: someVar`) is invisible to it, and so is a chart rendered by a library this
 * scan does not know about. It covers every chart in the app today (measured below:
 * the scan finds a non-empty set, which is itself asserted, because a scan that
 * silently matches nothing is the classic vacuous pass).
 */

// Chart.js's built-in controller ids. A `type:` literal that is NOT one of these is
// domain data — the screens carry `type: "buy"`, `"land"`, `"lease"`, `"material"`,
// `"json"` (import attributes) and more — so restricting to this set is what keeps
// the scan from flagging ordinary strings.
const CHART_TYPES = new Set([
  "bar",
  "line",
  "doughnut",
  "pie",
  "radar",
  "polarArea",
  "bubble",
  "scatter",
]);

const SCREENS = join(__dirname, "..", "screens");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.isFile() && (p.endsWith(".tsx") || p.endsWith(".ts")) && !p.includes(".test.")
      ? [p]
      : [];
  });
}

/** Every (file, chartType) pair a screen asks for. */
function requestedChartTypes(): Array<{ file: string; type: string }> {
  const out: Array<{ file: string; type: string }> = [];
  for (const file of walk(SCREENS)) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/\btype:\s*"([A-Za-z]+)"/g)) {
      if (CHART_TYPES.has(m[1])) out.push({ file, type: m[1] });
    }
  }
  return out;
}

describe("every chart type a screen asks for is registered (B-445)", () => {
  const requested = requestedChartTypes();

  it("the scan actually finds charts — a scan matching nothing proves nothing", () => {
    // Pinned to a literal rather than derived from `requested`, so shrinking the
    // scan to zero fails here instead of turning the whole file into a no-op.
    expect(requested.length).toBeGreaterThanOrEqual(2);
    expect(new Set(requested.map((r) => r.type)).size).toBeGreaterThanOrEqual(2);
  });

  it("resolves each requested type against the real Chart.js registry", () => {
    const missing: string[] = [];
    for (const { file, type } of requested) {
      try {
        // Throws for an unregistered id — this is the exact call Chart.js makes
        // internally at render, so it fails here for the same reason the screen
        // would have failed in the browser.
        Chart.registry.getController(type);
      } catch {
        missing.push(`${type} (asked for by ${file.slice(file.indexOf("screens"))})`);
      }
    }
    expect(missing, `unregistered chart controllers: ${missing.join(" · ")}`).toEqual([]);
  });

  it("doughnut specifically resolves — the one B-445 shipped broken", () => {
    expect(() => Chart.registry.getController("doughnut")).not.toThrow();
  });
});

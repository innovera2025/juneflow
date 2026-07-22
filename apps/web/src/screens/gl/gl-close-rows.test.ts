/*
 * gl-close-rows unit tests (gl.close, gate G3) — the pure period-close logic ported from
 * gl.jsx GLPeriodClose (toPeriodRow narrowing / isValidCePeriod / deriveOpenPeriod earliest-open
 * CE target / lockedHistory newest-first / formatPeriodDate / computeProgress / splitBold bold
 * parsing / STEP_KEYS 9-of-10 blocker). Guards the opaque-row narrowing, the honest close-target
 * derivation (BE rows never selected), and the history ordering against regression. ASCII-only
 * (B-073) — the runtime Thai strings all resolve through t() in the .tsx, never here.
 */
import { describe, it, expect } from "vitest";
import {
  toPeriodRow,
  isValidCePeriod,
  deriveOpenPeriod,
  lockedHistory,
  formatPeriodDate,
  computeProgress,
  splitBold,
  STEP_KEYS,
  type PeriodRow,
} from "./gl-close-rows";

const row = (p: Partial<PeriodRow> = {}): PeriodRow => ({
  id: "id1",
  period: "2026-01",
  locked: false,
  createdAt: "",
  ...p,
});

describe("toPeriodRow", () => {
  it("narrows the opaque wire row (snake_case, coerces types)", () => {
    expect(
      toPeriodRow({ id: "p1", period: "2026-05", locked: true, created_at: "2026-06-01T03:00:00Z" }),
    ).toEqual({ id: "p1", period: "2026-05", locked: true, createdAt: "2026-06-01T03:00:00Z" });
  });

  it("treats a missing/null locked as false and missing fields as empty strings", () => {
    expect(toPeriodRow({ period: "2026-05" })).toEqual({
      id: "",
      period: "2026-05",
      locked: false,
      createdAt: "",
    });
  });

  it("reads locked from the string 'true' and the camelCase createdAt fallback", () => {
    const r = toPeriodRow({ id: "p2", period: "2026-04", locked: "true", createdAt: "2026-05-01T00:00:00Z" });
    expect(r.locked).toBe(true);
    expect(r.createdAt).toBe("2026-05-01T00:00:00Z");
  });
});

describe("isValidCePeriod", () => {
  it("accepts a strict CE 'YYYY-MM' in range", () => {
    expect(isValidCePeriod("2026-05")).toBe(true);
    expect(isValidCePeriod("2000-01")).toBe(true);
    expect(isValidCePeriod("2100-12")).toBe(true);
  });

  it("rejects a Buddhist-Era year (mirrors the server guard)", () => {
    expect(isValidCePeriod("2569-05")).toBe(false);
    expect(isValidCePeriod("2600-01")).toBe(false);
  });

  it("rejects malformed / out-of-range keys", () => {
    expect(isValidCePeriod("2026-13")).toBe(false);
    expect(isValidCePeriod("2026-00")).toBe(false);
    expect(isValidCePeriod("2026-5")).toBe(false);
    expect(isValidCePeriod("26-05")).toBe(false);
    expect(isValidCePeriod("")).toBe(false);
  });
});

describe("deriveOpenPeriod", () => {
  it("returns the earliest still-open CE period (books close oldest-first)", () => {
    const rows = [
      row({ period: "2026-03", locked: false }),
      row({ period: "2026-01", locked: true }),
      row({ period: "2026-02", locked: false }),
    ];
    expect(deriveOpenPeriod(rows)).toBe("2026-02");
  });

  it("skips a Buddhist-Era open row (it can never be the close target)", () => {
    const rows = [
      row({ period: "2569-05", locked: false }), // BE seed row — not CE, never selected
      row({ period: "2026-06", locked: false }),
    ];
    expect(deriveOpenPeriod(rows)).toBe("2026-06");
  });

  it("returns null when nothing is closeable (all locked or none CE-valid)", () => {
    expect(deriveOpenPeriod([row({ period: "2026-01", locked: true })])).toBeNull();
    expect(deriveOpenPeriod([row({ period: "2569-05", locked: false })])).toBeNull();
    expect(deriveOpenPeriod([])).toBeNull();
  });
});

describe("lockedHistory", () => {
  it("lists only locked periods, newest first", () => {
    const rows = [
      row({ id: "a", period: "2026-01", locked: true }),
      row({ id: "b", period: "2026-03", locked: false }),
      row({ id: "c", period: "2026-02", locked: true }),
    ];
    expect(lockedHistory(rows).map((r) => r.period)).toEqual(["2026-02", "2026-01"]);
  });

  it("is empty when nothing is locked", () => {
    expect(lockedHistory([row({ locked: false })])).toEqual([]);
  });
});

describe("formatPeriodDate", () => {
  it("formats a timestamp to an ISO date (UTC)", () => {
    expect(formatPeriodDate("2026-05-03T09:30:00Z")).toBe("2026-05-03");
  });

  it("returns empty for a missing/invalid timestamp (the cell then em-dashes)", () => {
    expect(formatPeriodDate("")).toBe("");
    expect(formatPeriodDate("not-a-date")).toBe("");
  });
});

describe("computeProgress", () => {
  it("computes a rounded percent from a done-count", () => {
    expect(computeProgress(0, 9)).toEqual({ completed: 0, total: 9, pct: 0 });
    expect(computeProgress(5, 10)).toEqual({ completed: 5, total: 10, pct: 50 });
    expect(computeProgress(9, 9)).toEqual({ completed: 9, total: 9, pct: 100 });
  });

  it("guards a zero total (no divide-by-zero)", () => {
    expect(computeProgress(0, 0)).toEqual({ completed: 0, total: 0, pct: 0 });
  });
});

describe("splitBold", () => {
  it("splits a single bold run into ordered segments", () => {
    expect(splitBold("a <b>b</b> c")).toEqual([
      { text: "a ", bold: false },
      { text: "b", bold: true },
      { text: " c", bold: false },
    ]);
  });

  it("returns one non-bold segment when there is no markup", () => {
    expect(splitBold("plain")).toEqual([{ text: "plain", bold: false }]);
  });

  it("handles a bold run at the start", () => {
    expect(splitBold("<b>x</b> y")).toEqual([
      { text: "x", bold: true },
      { text: " y", bold: false },
    ]);
  });
});

describe("STEP_KEYS (gl.close.step3 missing-key blocker)", () => {
  it("renders 9 of the prototype's 10 steps until gl.close.step3 lands (Wave-A gap)", () => {
    expect(STEP_KEYS).toHaveLength(9);
    // step3 is intentionally absent (blocker); its neighbours step2/step4 are adjacent.
    expect(STEP_KEYS).not.toContain("gl.close.step3");
    const idx2 = STEP_KEYS.indexOf("gl.close.step2");
    expect(STEP_KEYS[idx2 + 1]).toBe("gl.close.step4");
  });
});

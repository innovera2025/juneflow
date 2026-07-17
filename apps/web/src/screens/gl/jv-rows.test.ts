/*
 * jv-rows unit tests (P2-WEB-13, gate G3) — the pure journal-voucher logic ported from
 * gl.jsx GLJournalVoucher + JVCreateForm (toJvRow / sourceTone / formatMoney / formatDate /
 * parseAmount / jvTotals / isLineFilled / buildJvBody). Guards the opaque-row narrowing, the
 * double-entry balance guard, and the POST-body shaping against regression. ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toJvRow,
  sourceTone,
  formatMoney,
  formatDate,
  parseAmount,
  jvTotals,
  isLineFilled,
  buildJvBody,
  type JvLineDraft,
} from "./jv-rows";

const line = (p: Partial<JvLineDraft> = {}): JvLineDraft => ({
  accountId: "",
  ccId: "",
  dr: "",
  cr: "",
  ...p,
});

describe("toJvRow", () => {
  it("narrows a full opaque /gl/jv row (snake_case)", () => {
    expect(
      toJvRow({
        id: "jv1",
        no: "JV-2026-0001",
        source_doc: "Manual",
        memo: "note",
        amount: 184500,
        currency_code: "THB",
        line_count: 2,
        period_id: "p1",
        status: null,
        created_at: "2026-05-25T00:00:00.000Z",
      }),
    ).toEqual({
      id: "jv1",
      no: "JV-2026-0001",
      sourceDoc: "Manual",
      memo: "note",
      amount: 184500,
      currencyCode: "THB",
      lineCount: 2,
      periodId: "p1",
      status: "",
      createdAt: "2026-05-25T00:00:00.000Z",
    });
  });

  it("accepts camelCase and defaults missing numerics to 0 / null status to ''", () => {
    const r = toJvRow({ no: "JV-9", sourceDoc: "REM", lineCount: 3 });
    expect(r.sourceDoc).toBe("REM");
    expect(r.lineCount).toBe(3);
    expect(r.amount).toBe(0);
    expect(r.status).toBe("");
  });
});

describe("sourceTone", () => {
  it("maps the three known sources and falls back to accent", () => {
    expect(sourceTone("Manual").fg).toBe("var(--text-2)");
    expect(sourceTone("REM").fg).toBe("var(--info)");
    expect(sourceTone("FA auto")).toEqual({ bg: "#FEF3C7", fg: "var(--warn)" });
    expect(sourceTone("Petty").fg).toBe("var(--accent)");
  });
});

describe("formatMoney", () => {
  it("groups thousands with no decimals or baht symbol", () => {
    expect(formatMoney(1_000_000)).toBe("1,000,000");
    expect(formatMoney(184500)).toBe("184,500");
    expect(formatMoney(-2148)).toBe("-2,148");
  });

  it("returns '0' for non-finite input", () => {
    expect(formatMoney(Number.NaN)).toBe("0");
  });
});

describe("formatDate", () => {
  it("formats a valid timestamp to an ISO date", () => {
    expect(formatDate("2026-05-25T13:45:00.000Z")).toBe("2026-05-25");
    expect(formatDate("2026-05-25")).toBe("2026-05-25");
  });

  it("returns '' for empty / invalid input", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate("not-a-date")).toBe("");
  });
});

describe("parseAmount", () => {
  it("parses a non-negative number, else 0", () => {
    expect(parseAmount("184500")).toBe(184500);
    expect(parseAmount("")).toBe(0);
    expect(parseAmount("-5")).toBe(0);
    expect(parseAmount("abc")).toBe(0);
  });
});

describe("jvTotals", () => {
  it("is balanced only when Sigma dr === Sigma cr AND > 0", () => {
    const balanced = jvTotals([line({ dr: "100" }), line({ cr: "100" })]);
    expect(balanced).toEqual({ dr: 100, cr: 100, diff: 0, balanced: true });

    const unbalanced = jvTotals([line({ dr: "100" }), line({ cr: "60" })]);
    expect(unbalanced.balanced).toBe(false);
    expect(unbalanced.diff).toBe(40);

    const zero = jvTotals([line({ dr: "0" }), line({ cr: "0" })]);
    expect(zero.balanced).toBe(false);
  });

  it("rounds to 2dp so float dust does not break the balance compare", () => {
    const r = jvTotals([line({ dr: "0.1" }), line({ dr: "0.2" }), line({ cr: "0.3" })]);
    expect(r.balanced).toBe(true);
  });
});

describe("isLineFilled", () => {
  it("is true once a line has an account or any amount", () => {
    expect(isLineFilled(line())).toBe(false);
    expect(isLineFilled(line({ accountId: "a1" }))).toBe(true);
    expect(isLineFilled(line({ dr: "5" }))).toBe(true);
  });
});

describe("buildJvBody", () => {
  it("shapes the opaque body, drops empty lines, includes cc_id only when set", () => {
    const body = buildJvBody("  JV-1  ", "  memo  ", [
      line({ accountId: "a1", dr: "100", ccId: "cc1" }),
      line({ accountId: "a2", cr: "100" }),
      line(), // empty -> dropped
    ]);
    expect(body).toEqual({
      no: "JV-1",
      memo: "memo",
      lines: [
        { account_id: "a1", dr: 100, cr: 0, cc_id: "cc1" },
        { account_id: "a2", dr: 0, cr: 100 },
      ],
    });
  });
});

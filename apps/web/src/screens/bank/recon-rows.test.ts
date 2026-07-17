/*
 * recon-rows unit tests (P2-WEB-15, gate G3) — the pure bank-reconciliation logic
 * ported from bank.jsx BankReconciliation (toReconStatement / toReconLine / toDocRef /
 * formatMoney / formatSignedMoney / formatMillions / amountColor / formatDate /
 * activePeriodStatements / reconKpis / sortLinesByDateDesc / matchBodyFor). Guards the
 * opaque narrowing (incl. honest-null book_balance/difference + matched_doc), the
 * signed-amount formatting, the period aggregation, and the match-body shaping.
 * ASCII-only (B-073).
 */
import { describe, it, expect } from "vitest";
import {
  toReconStatement,
  toReconLine,
  toDocRef,
  formatMoney,
  formatSignedMoney,
  formatMillions,
  amountColor,
  formatDate,
  activePeriodStatements,
  reconKpis,
  sortLinesByDateDesc,
  matchBodyFor,
  type ReconStatement,
  type ReconLine,
} from "./recon-rows";

const stmt = (p: Partial<ReconStatement> = {}): ReconStatement => ({
  id: "s1",
  period: "2569-05",
  locked: false,
  lineCount: 1,
  matchedCount: 1,
  matchedPct: 100,
  bankBalance: 0,
  bookBalance: null,
  difference: null,
  currencyCode: "THB",
  createdAt: "2026-05-25T00:00:00.000Z",
  ...p,
});

const line = (p: Partial<ReconLine> = {}): ReconLine => ({
  id: "l1",
  statementId: "s1",
  lineDate: "2026-05-25",
  description: "FT TXN",
  amount: -100,
  currencyCode: "THB",
  matched: false,
  matchedDoc: null,
  suggestions: [],
  ...p,
});

describe("toReconStatement", () => {
  it("narrows a full opaque row, honest-null book_balance/difference preserved", () => {
    const s = toReconStatement({
      id: "s1",
      period: "2569-05",
      locked: false,
      line_count: 2,
      matched_count: 1,
      matched_pct: 50,
      bank_balance: 200,
      book_balance: null,
      difference: null,
      currency_code: "THB",
      created_at: "2026-05-25T00:00:00.000Z",
    });
    expect(s.lineCount).toBe(2);
    expect(s.matchedCount).toBe(1);
    expect(s.matchedPct).toBe(50);
    expect(s.bankBalance).toBe(200);
    expect(s.bookBalance).toBeNull();
    expect(s.difference).toBeNull();
  });
});

describe("toReconLine + toDocRef", () => {
  it("narrows a matched line with a resolved matched_doc", () => {
    const l = toReconLine({
      id: "l1",
      statement_id: "s1",
      line_date: "2026-05-21",
      description: "cheque cleared",
      amount: -184500,
      matched: true,
      matched_doc: { type: "cheque", id: "chq0", ref: "CH-040126", amount: 184500 },
      suggestions: [],
    });
    expect(l.matched).toBe(true);
    expect(l.matchedDoc).toEqual({ type: "cheque", id: "chq0", ref: "CH-040126", amount: 184500 });
    expect(l.suggestions).toEqual([]);
  });

  it("narrows an unmatched line with suggestions; honest-null ref becomes ''", () => {
    const l = toReconLine({
      id: "l2",
      amount: -15240,
      matched: false,
      matched_doc: null,
      suggestions: [
        { type: "pv", id: "pv1", ref: null, amount: 15240 },
        { type: "cheque", id: "chq1", ref: "CH-1", amount: 15240 },
      ],
    });
    expect(l.matched).toBe(false);
    expect(l.matchedDoc).toBeNull();
    expect(l.suggestions).toHaveLength(2);
    expect(l.suggestions[0]).toEqual({ type: "pv", id: "pv1", ref: "", amount: 15240 });
  });

  it("toDocRef rejects a doc missing type/id", () => {
    expect(toDocRef(null)).toBeNull();
    expect(toDocRef({ type: "pv" })).toBeNull();
    expect(toDocRef({ id: "x" })).toBeNull();
    expect(toDocRef({ type: "pv", id: "x", amount: 5 })).toEqual({ type: "pv", id: "x", ref: "", amount: 5 });
  });
});

describe("money formatters", () => {
  it("formatMoney groups thousands, preserves minus", () => {
    expect(formatMoney(894206)).toBe("894,206");
    expect(formatMoney(-184500)).toBe("-184,500");
  });
  it("formatSignedMoney adds + on positive, keeps - on negative", () => {
    expect(formatSignedMoney(2148000)).toBe("+2,148,000");
    expect(formatSignedMoney(-894206)).toBe("-894,206");
    expect(formatSignedMoney(0)).toBe("0");
  });
  it("formatMillions is 2dp", () => {
    expect(formatMillions(1772308)).toBe("1.77");
  });
  it("amountColor: negative danger, else ok", () => {
    expect(amountColor(-1)).toBe("var(--danger)");
    expect(amountColor(5)).toBe("var(--ok)");
  });
  it("formatDate is ISO or '' for invalid", () => {
    expect(formatDate("2026-05-25")).toBe("2026-05-25");
    expect(formatDate("")).toBe("");
    expect(formatDate("nope")).toBe("");
  });
});

describe("activePeriodStatements", () => {
  it("picks the newest statement's period and filters to it", () => {
    const statements = [
      stmt({ id: "a", period: "2569-05", createdAt: "2026-05-20T00:00:00.000Z" }),
      stmt({ id: "b", period: "2569-05", createdAt: "2026-05-25T00:00:00.000Z" }),
      stmt({ id: "c", period: "2569-04", createdAt: "2026-04-30T00:00:00.000Z" }),
    ];
    const active = activePeriodStatements(statements);
    expect(active.period).toBe("2569-05");
    expect(active.statements.map((s) => s.id).sort()).toEqual(["a", "b"]);
  });
  it("returns empty for no statements", () => {
    expect(activePeriodStatements([])).toEqual({ period: "", statements: [] });
  });
});

describe("reconKpis", () => {
  it("aggregates bank balance (Σ signed) + matched counts; book/difference stay null", () => {
    const statements = [
      stmt({ lineCount: 1, matchedCount: 1, bankBalance: -894206 }),
      stmt({ lineCount: 1, matchedCount: 0, bankBalance: -15240 }),
      stmt({ lineCount: 1, matchedCount: 1, bankBalance: 2148000 }),
      stmt({ lineCount: 1, matchedCount: 0, bankBalance: -350 }),
    ];
    const k = reconKpis(statements);
    expect(k.lineCount).toBe(4);
    expect(k.matchedCount).toBe(2);
    expect(k.unmatchedCount).toBe(2);
    expect(k.matchedPct).toBe(50);
    expect(k.bankBalance).toBe(1238204);
    expect(k.bookBalance).toBeNull();
    expect(k.difference).toBeNull();
  });
  it("matchedPct is null with no lines", () => {
    expect(reconKpis([]).matchedPct).toBeNull();
  });
});

describe("sortLinesByDateDesc", () => {
  it("orders lines newest-first", () => {
    const lines = [
      line({ id: "old", lineDate: "2026-05-20" }),
      line({ id: "new", lineDate: "2026-05-25" }),
      line({ id: "mid", lineDate: "2026-05-22" }),
    ];
    expect(sortLinesByDateDesc(lines).map((l) => l.id)).toEqual(["new", "mid", "old"]);
  });
});

describe("matchBodyFor", () => {
  it("keys the body by the doc type", () => {
    expect(matchBodyFor({ type: "pv", id: "p1", ref: "", amount: 1 })).toEqual({ pv_id: "p1" });
    expect(matchBodyFor({ type: "cheque", id: "c1", ref: "", amount: 1 })).toEqual({ cheque_id: "c1" });
    expect(matchBodyFor({ type: "rv", id: "r1", ref: "", amount: 1 })).toEqual({ rv_id: "r1" });
    expect(matchBodyFor({ type: "weird", id: "x", ref: "", amount: 1 })).toEqual({});
  });
});

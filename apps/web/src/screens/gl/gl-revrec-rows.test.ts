/*
 * G3 unit tests for the gl.revrec view-model (B-432).
 *
 * The properties worth protecting here are the ones where a plausible refactor would silently move
 * money on screen: the two SERVER-DERIVED figures must be read off the wire rather than
 * recomputed, the contract-liability rows must not be netted into the contract-asset KPI, and the
 * method cell must not acquire a guessed label.
 *
 * Expected values come from pototype/accounting-extra.jsx GLRevenueWIP (L277-443) — the spec —
 * not from the implementation (tests/CLAUDE.md).
 */
import { describe, expect, it } from "vitest";
import {
  dueCount,
  dueRev,
  isValidTransfer,
  methodMeta,
  sumRecognized,
  sumUnbilledAsset,
  sumTransferred,
  sumWipBalance,
  toRevRec,
  toWip,
  wipTotals,
  type RevRecVM,
  type WipVM,
} from "./gl-revrec-rows";

/** The prototype's REVREC_SEED row 0 (L278), on the wire shape the server sends. */
const WIRE_REV = {
  id: "r0",
  project_id: "p0",
  project_name: "Project Zero",
  method: "percent-of-completion",
  contract_amount: 468000000,
  pct: 65,
  recognized: 68400000,
  billed: 74200000,
  unbilled: -5800000,
  currency_code: "THB",
  posted: true,
};

/** The prototype's WIP_SEED row 0 (L285), on the wire shape the server sends. */
const WIRE_WIP = {
  id: "w0",
  project_id: "p0",
  project_name: "Project Zero",
  material: 18400000,
  subcon: 12600000,
  overhead: 3200000,
  transferred: 9800000,
  balance: 24400000,
  currency_code: "THB",
};

const rev = (o: Partial<RevRecVM> = {}): RevRecVM => ({ ...toRevRec(WIRE_REV), ...o });
const wip = (o: Partial<WipVM> = {}): WipVM => ({ ...toWip(WIRE_WIP), ...o });

describe("narrowing the wire rows", () => {
  it("reads every recognition field, snake_case as the server sends it", () => {
    expect(toRevRec(WIRE_REV)).toEqual({
      id: "r0",
      projectId: "p0",
      projectName: "Project Zero",
      method: "percent-of-completion",
      contractAmount: 468000000,
      pct: 65,
      recognized: 68400000,
      billed: 74200000,
      unbilled: -5800000,
      currencyCode: "THB",
      posted: true,
    });
  });

  it("reads every WIP field, snake_case as the server sends it", () => {
    expect(toWip(WIRE_WIP)).toEqual({
      id: "w0",
      projectId: "p0",
      projectName: "Project Zero",
      material: 18400000,
      subcon: 12600000,
      overhead: 3200000,
      transferred: 9800000,
      balance: 24400000,
      currencyCode: "THB",
    });
  });

  it("turns an absent row into honest zeros and empty strings, never NaN or undefined", () => {
    const r = toRevRec({});
    expect(r.projectName).toBe("");
    expect(r.contractAmount).toBe(0);
    expect(r.posted).toBe(false);
    const w = toWip({});
    expect(w.balance).toBe(0);
    expect(Number.isNaN(w.material)).toBe(false);
  });

  it("accepts the numeric(16,2) columns as the strings pg returns them", () => {
    // node-postgres hands back numeric as a string; a narrowing that only accepted
    // `typeof v === "number"` would zero every money column on a real response.
    const r = toRevRec({ ...WIRE_REV, contract_amount: "468000000.00", pct: "65.00" });
    expect(r.contractAmount).toBe(468000000);
    expect(r.pct).toBe(65);
  });

  it("takes `unbilled` FROM THE WIRE and does not recompute recognized - billed", () => {
    // The server owns this figure. If it ever disagrees with the local subtraction — a rounding
    // rule, a credit note, a correction the client cannot see — the server is right. A refactor
    // that "simplifies" this into a subtraction dies here.
    const r = toRevRec({ ...WIRE_REV, unbilled: 999 });
    expect(r.unbilled).toBe(999);
    expect(r.recognized - r.billed).toBe(-5800000);
  });

  it("takes `balance` FROM THE WIRE and does not recompute mat + sub + oh - transferred", () => {
    const w = toWip({ ...WIRE_WIP, balance: 7 });
    expect(w.balance).toBe(7);
    expect(w.material + w.subcon + w.overhead - w.transferred).toBe(24400000);
  });
});

describe("dueRev — the prototype's dueRev(), display only", () => {
  it("is contract x pct, rounded, minus what is already recognised", () => {
    // 468,000,000 x 65% = 304,200,000; less 68,400,000 recognised = 235,800,000.
    expect(dueRev(rev())).toBe(235800000);
  });

  it("rounds the target before subtracting, as the prototype does", () => {
    // 1,000,000 x 33.333% = 333,330 exactly per Math.round of 333330.0000...
    expect(dueRev({ contractAmount: 1000000, pct: 33.333, recognized: 0 })).toBe(333330);
  });

  it("clamps at 0 when a row is recognised beyond its pct target", () => {
    // pct can legitimately be revised DOWN after a recognition; a negative here would put a
    // "create JV (-1.2M)" button on the row.
    expect(dueRev({ contractAmount: 1000000, pct: 10, recognized: 500000 })).toBe(0);
  });

  it("counts only the rows with something left to recognise", () => {
    expect(
      dueCount([
        rev(),
        rev({ recognized: 304200000 }),
        rev({ contractAmount: 0, pct: 0, recognized: 0 }),
      ]),
    ).toBe(1);
  });
});

describe("the KPI sums", () => {
  it("adds recognised revenue across the rows", () => {
    expect(sumRecognized([rev({ recognized: 10 }), rev({ recognized: 32 })])).toBe(42);
  });

  it("counts only POSITIVE unbilled into the contract-asset KPI", () => {
    // A negative unbilled is a contract LIABILITY (billed ahead of recognition). Netting it
    // against the asset understates both sides of the balance sheet, so the prototype clamps
    // each row at 0 before summing and so does this.
    expect(sumUnbilledAsset([rev({ unbilled: 500 }), rev({ unbilled: -900 })])).toBe(500);
  });

  it("adds the server-derived WIP balances and the transferred amounts", () => {
    const rows = [wip({ balance: 100, transferred: 5 }), wip({ balance: 250, transferred: 15 })];
    expect(sumWipBalance(rows)).toBe(350);
    expect(sumTransferred(rows)).toBe(20);
  });

  it("totals every WIP cost column for the table foot", () => {
    expect(
      wipTotals([
        wip({ material: 1, subcon: 2, overhead: 3, transferred: 4, balance: 2 }),
        wip({ material: 10, subcon: 20, overhead: 30, transferred: 40, balance: 20 }),
      ]),
    ).toEqual({ material: 11, subcon: 22, overhead: 33, transferred: 44, balance: 22 });
  });

  it("returns zero — not NaN — for an empty table", () => {
    expect(sumRecognized([])).toBe(0);
    expect(sumUnbilledAsset([])).toBe(0);
    expect(wipTotals([])).toEqual({
      material: 0,
      subcon: 0,
      overhead: 0,
      transferred: 0,
      balance: 0,
    });
  });
});

describe("methodMeta — no label is invented (B-432)", () => {
  it("reports the seed's own code as UNKNOWN, so the cell em-dashes", () => {
    // rev_rec.method is bare `text`: no enum in the schema, the data dictionary or docs/extract.
    // The prototype states four distinct methods; the seed writes this one code into all four
    // rows. Mapping it onto one of them would be a guess, and this test exists to make a future
    // guess fail loudly rather than ship as a label.
    expect(methodMeta("percent-of-completion")).toEqual({
      known: false,
      code: "percent-of-completion",
    });
  });

  it("passes an empty code through without inventing anything", () => {
    expect(methodMeta("")).toEqual({ known: false, code: "" });
  });
});

describe("isValidTransfer — the form's explanation of the limit, not its enforcement", () => {
  it("accepts a positive amount up to and including the balance", () => {
    expect(isValidTransfer(1, 100)).toBe(true);
    expect(isValidTransfer(100, 100)).toBe(true);
  });

  it("refuses zero, negatives, over-balance and non-numbers", () => {
    expect(isValidTransfer(0, 100)).toBe(false);
    expect(isValidTransfer(-1, 100)).toBe(false);
    expect(isValidTransfer(100.01, 100)).toBe(false);
    expect(isValidTransfer(Number.NaN, 100)).toBe(false);
  });

  it("refuses everything when the balance is zero", () => {
    expect(isValidTransfer(1, 0)).toBe(false);
  });
});

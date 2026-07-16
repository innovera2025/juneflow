/*
 * docnum-rows unit tests (P1-WEB-12, gate G3) — the pure doc-numbering display logic
 * ported from master.jsx MasterDocNum. Guards the opaque-row narrowing defaults, the
 * B-060 next-number rule (pad-4 + 1 for all-digit counters only; non-numeric passes
 * through), and the B-067 lock-mode code -> i18n key mapping (with none -> null / "—").
 */
import { describe, it, expect } from "vitest";
import { toDocNumRow, nextRunning, lockedLabelKey } from "./docnum-rows";

describe("toDocNumRow", () => {
  it("narrows a full opaque /doc-numbering row to the row shape", () => {
    expect(
      toDocNumRow({
        id: "docnum-PR",
        type: "Purchase Requisition",
        prefix: "PR",
        running: "0418",
        reset_rule: "yearly-marker",
        locked: "dept",
        extra: "ignored",
      }),
    ).toEqual({
      id: "docnum-PR",
      type: "Purchase Requisition",
      prefix: "PR",
      running: "0418",
      reset_rule: "yearly-marker",
      locked: "dept",
    });
  });

  it("defaults every field to an empty string when absent", () => {
    expect(toDocNumRow({})).toEqual({
      id: "",
      type: "",
      prefix: "",
      running: "",
      reset_rule: "",
      locked: "",
    });
  });
});

describe("nextRunning (B-060)", () => {
  it("pads to 4 digits and adds 1 for all-digit counters", () => {
    expect(nextRunning("0418")).toBe("0419");
    expect(nextRunning("0291")).toBe("0292");
    expect(nextRunning("0014")).toBe("0015");
    expect(nextRunning("0001")).toBe("0002");
  });

  it("keeps leading-zero width and carries across it", () => {
    expect(nextRunning("9")).toBe("0010");
    expect(nextRunning("0099")).toBe("0100");
    expect(nextRunning("9999")).toBe("10000"); // wider than 4 stays wider
  });

  it("returns non-numeric counters verbatim (the BOQ 'B-02 v3' row)", () => {
    expect(nextRunning("B-02 v3")).toBe("B-02 v3");
  });

  it("returns mixed / empty strings verbatim (never coerces)", () => {
    expect(nextRunning("12a")).toBe("12a");
    expect(nextRunning("")).toBe("");
  });
});

describe("lockedLabelKey (B-067)", () => {
  it("maps each lock-mode code to its docnum.lock* dict key", () => {
    expect(lockedLabelKey("all")).toBe("docnum.lockAll");
    expect(lockedLabelKey("dept")).toBe("docnum.lockDept");
    expect(lockedLabelKey("warehouse")).toBe("docnum.lockWarehouse");
  });

  it("returns null for 'none' (screen renders the literal em-dash)", () => {
    expect(lockedLabelKey("none")).toBeNull();
  });

  it("returns null for any unknown code (fails safe to '—')", () => {
    expect(lockedLabelKey("")).toBeNull();
    expect(lockedLabelKey("bogus")).toBeNull();
  });
});

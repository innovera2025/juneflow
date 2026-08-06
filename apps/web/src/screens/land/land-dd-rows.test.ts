/*
 * land-dd-rows unit tests (P3-WEB, gate G3) — the pure LandDueDiligence deal logic
 * narrowed from land2.jsx LandDueDiligence. Guards the buy terms (SERVER total +
 * 10% deposit read off the wire; 2% transfer fee / 3.3% SBT still client-derived), the
 * real deal-plot selection (replacing the prototype's fixed 'L-071'), and the cost-center
 * option narrowing + active-project scoping. The mock contract-type / appointment /
 * lease figures carry no logic here (they are literal em-dash in the screen).
 *
 * B-316/A2: the deposit assertions below are deliberately built on plots whose wire money
 * DISAGREES with area x price. A test that fed self-consistent numbers would pass against
 * a browser-side formula too, and would not die when the bug is reintroduced.
 */
import { describe, it, expect } from "vitest";
import { formatMoney, type PlotRow } from "./land-bank-rows";
import { dealTerms, pickDealPlot, toCcOption, ccOptionsForProject } from "./land-dd-rows";

/** A fully-specified plot row for the deal-term / selection tests. */
function plot(over: Partial<PlotRow> = {}): PlotRow {
  return {
    id: "L-071",
    projectId: "p1",
    deedNo: "11902",
    areaSqm: 38400, // 24 rai
    gps: "13.8, 100.4",
    pricePerRai: 6800000,
    currencyCode: "THB",
    stage: "dd",
    tenure: "buy",
    // SERVER money (plotWire.total_value / deal_deposit): 24 rai x 6.8M = 163,200,000.
    totalValue: 163200000,
    dealDeposit: 16320000,
    ...over,
  };
}

describe("dealTerms", () => {
  it("surfaces the four buy terms for a seeded plot (24 rai x 6.8M)", () => {
    expect(dealTerms(plot())).toEqual({
      total: 163200000, // SERVER (plotWire.total_value)
      deposit: 16320000, // SERVER (plotWire.deal_deposit) — the figure the JV books
      transferFee: 3264000, // client: round(total x 0.02)
      sbt: 5385600, // client: round(total x 0.033)
    });
  });

  /*
   * THE REGRESSION GUARD (B-316/A2).
   *
   * The wire money below is NOT what area x price gives, so any browser-side
   * recomputation produces a different answer and this test goes red. Concretely:
   * 115-0-73 rai @ 5,250,000/rai -> total 604,708,125; the server's 2-dp deposit is
   * 60,470,812.5 while the deleted client formula, Math.round(total * 0.1), gave
   * 60,470,813 — the exact 0.50 baht seam this fix closed.
   */
  it("READS the server deposit and never recomputes it", () => {
    const terms = dealTerms(
      plot({ areaSqm: 184292, pricePerRai: 5250000, totalValue: 604708125, dealDeposit: 60470812.5 }),
    );
    expect(terms?.total).toBe(604708125);
    expect(terms?.deposit).toBe(60470812.5);
    // the value the browser used to invent — must NOT be what we render
    expect(terms?.deposit).not.toBe(Math.round(604708125 * 0.1));
  });

  it("keeps the server deposit even when it contradicts the plot's own area x price", () => {
    // area x price = 100,000 -> a client formula would say 10,000. The wire says 33.3.
    const terms = dealTerms(
      plot({ areaSqm: 1600, pricePerRai: 100000, totalValue: 333, dealDeposit: 33.3 }),
    );
    expect(terms?.deposit).toBe(33.3);
    expect(terms?.total).toBe(333);
    // fee/SBT still derive from the SERVER total (not from area x price)
    expect(terms?.transferFee).toBe(7); // round(333 x 0.02)
    expect(terms?.sbt).toBe(11); // round(333 x 0.033)
  });

  it("returns null for an absent plot (honest-empty deal)", () => {
    expect(dealTerms(undefined)).toBeNull();
    expect(dealTerms(null)).toBeNull();
  });

  /*
   * An unpriced plot has no server figure. Every term must be null so the screen renders
   * an em-dash — never 0 (a fabricated "free"), never NaN, never a locally-derived
   * stand-in. This is the assertion that fails if anyone adds `?? computeLocally()`.
   */
  it("yields null terms for an unpriced plot — never 0, never NaN", () => {
    const terms = dealTerms(plot({ areaSqm: 0, pricePerRai: 0, totalValue: null, dealDeposit: null }));
    expect(terms).toEqual({ total: null, deposit: null, transferFee: null, sbt: null });
    for (const v of Object.values(terms ?? {})) {
      expect(v).toBeNull();
      expect(Number.isNaN(v as number)).toBe(false);
    }
  });

  /*
   * G5 PIXEL GUARD. tests/visual/reference/app-baseline/land-dd.png was captured against
   * the seeded dd-stage plot (โฉนด 11902, 24 rai @ 6,800,000/rai) while the browser still
   * computed these figures. Moving the total + deposit to the server must not move a
   * pixel: formatMoney rounds to whole baht, and the seeded price divides evenly, so the
   * server's 2-dp values format to the exact same strings. If a future change to either
   * side alters what this screen displays for the baseline plot, this fails HERE rather
   * than as an unexplained G5 diff (re-baselining is blocked under B-305/B-306).
   */
  it("renders the G5 baseline plot byte-identically (no pixel movement)", () => {
    const terms = dealTerms(plot()); // seeded โฉนด 11902: total_value/deal_deposit from the wire
    expect(terms?.total).not.toBeNull();
    expect([
      formatMoney(terms!.total!),
      formatMoney(terms!.deposit!),
      formatMoney(terms!.transferFee!),
      formatMoney(terms!.sbt!),
    ]).toEqual(["163,200,000", "16,320,000", "3,264,000", "5,385,600"]);
  });

  /*
   * THE FALLBACK GUARD (B-316/A2). A server total with NO server deposit is the one
   * shape that tempts `plot.dealDeposit ?? Math.round(total * 0.1)` — and that fallback
   * is the original defect wearing a nicer name: it silently reinstates the browser's
   * rounding whenever the server declines to answer. The deposit must stay null (em-dash).
   *
   * Found by the revert probe: without this case, the `??` fallback passed every other
   * test in this file.
   */
  it("never derives the deposit when the server omits it, even with a total present", () => {
    const terms = dealTerms(plot({ totalValue: 604708125, dealDeposit: null }));
    expect(terms?.deposit).toBeNull();
    expect(terms?.deposit).not.toBe(Math.round(604708125 * 0.1));
    expect(terms?.total).toBe(604708125); // the total it DID send is still shown
  });

  it("nulls the derived fees when the server total is absent but a deposit is present", () => {
    const terms = dealTerms(plot({ totalValue: null, dealDeposit: 16320000 }));
    expect(terms).toEqual({
      total: null,
      deposit: 16320000, // still shown — it is a real server figure
      transferFee: null, // no base to derive from -> em-dash, not 0
      sbt: null,
    });
  });
});

describe("pickDealPlot", () => {
  it("returns undefined for an empty register", () => {
    expect(pickDealPlot([], "p1")).toBeUndefined();
  });

  it("prefers the active project's dd-stage plot", () => {
    const rows = [
      plot({ id: "A", projectId: "p1", stage: "nego" }),
      plot({ id: "B", projectId: "p1", stage: "dd" }),
      plot({ id: "C", projectId: "p2", stage: "dd" }),
    ];
    expect(pickDealPlot(rows, "p1")?.id).toBe("B");
  });

  it("falls back to the active project's first plot when none are at dd", () => {
    const rows = [
      plot({ id: "A", projectId: "p1", stage: "nego" }),
      plot({ id: "B", projectId: "p1", stage: "feas" }),
    ];
    expect(pickDealPlot(rows, "p1")?.id).toBe("A");
  });

  it("falls back to the register's dd plot when the project has no plots", () => {
    const rows = [
      plot({ id: "A", projectId: "p2", stage: "nego" }),
      plot({ id: "B", projectId: "p3", stage: "dd" }),
    ];
    expect(pickDealPlot(rows, "p1")?.id).toBe("B");
  });

  it("uses the register's dd plot (else first) when no active project is set", () => {
    const rows = [
      plot({ id: "A", projectId: "p2", stage: "nego" }),
      plot({ id: "B", projectId: "p3", stage: "dd" }),
    ];
    expect(pickDealPlot(rows, "")?.id).toBe("B");
    expect(pickDealPlot([plot({ id: "A", stage: "nego" })], "")?.id).toBe("A");
  });
});

describe("toCcOption / ccOptionsForProject", () => {
  it("narrows a snake_case cost-center row", () => {
    expect(toCcOption({ code: "CC-01", name: "Site A", project_id: "p1" })).toEqual({
      code: "CC-01",
      name: "Site A",
      projectId: "p1",
    });
  });

  it("accepts a camelCase project id and defaults absent fields", () => {
    expect(toCcOption({ code: "CC-02", projectId: "p2" })).toEqual({
      code: "CC-02",
      name: "",
      projectId: "p2",
    });
    expect(toCcOption({})).toEqual({ code: "", name: "", projectId: "" });
  });

  const rows = [
    { code: "CC-01", name: "Site A", project_id: "p1" },
    { code: "CC-02", name: "Site B", project_id: "p2" },
    { code: "", name: "no code", project_id: "p1" }, // dropped (code-less)
    { code: "CC-03", name: "Site C", project_id: "p1" },
  ];

  it("scopes options to the active project and drops code-less rows", () => {
    expect(ccOptionsForProject(rows, "p1").map((o) => o.code)).toEqual(["CC-01", "CC-03"]);
  });

  it("returns every coded option when no active project is set", () => {
    expect(ccOptionsForProject(rows, "").map((o) => o.code)).toEqual(["CC-01", "CC-02", "CC-03"]);
  });

  it("is empty when the project has no cost centers (never fabricates)", () => {
    expect(ccOptionsForProject(rows, "p9")).toEqual([]);
  });
});

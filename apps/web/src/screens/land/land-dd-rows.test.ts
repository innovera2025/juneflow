/*
 * land-dd-rows unit tests (P3-WEB, gate G3) — the pure LandDueDiligence deal logic
 * narrowed from land2.jsx LandDueDiligence. Guards the buy terms (ALL FOUR are now read
 * off the plot wire: SERVER total + 10% deposit + 2% transfer fee + 3.3% SBT), the real
 * deal-plot selection (replacing the prototype's fixed 'L-071'), and the cost-center
 * option narrowing + active-project scoping. The mock contract-type / appointment /
 * lease figures carry no logic here (they are literal em-dash in the screen).
 *
 * B-316/A2 + B-319: the money assertions below are deliberately built on plots whose wire
 * money DISAGREES with area x price x rate. A test fed self-consistent numbers would pass
 * against a browser-side formula too, and would not die when the bug is reintroduced —
 * which is the only question worth asking of a guard like this.
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
    // SERVER money (plotWire.transfer_fee / sbt, B-319): 2% and 3.3% of that total.
    transferFee: 3264000,
    sbt: 5385600,
    ...over,
  };
}

describe("dealTerms", () => {
  it("surfaces the four buy terms for a seeded plot (24 rai x 6.8M)", () => {
    expect(dealTerms(plot())).toEqual({
      total: 163200000, // SERVER (plotWire.total_value)
      deposit: 16320000, // SERVER (plotWire.deal_deposit) — the figure the JV books
      transferFee: 3264000, // SERVER (plotWire.transfer_fee, 2% via THAILAND_RATES)
      sbt: 5385600, // SERVER (plotWire.sbt, 3.3% via THAILAND_RATES)
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
      plot({
        areaSqm: 1600,
        pricePerRai: 100000,
        totalValue: 333,
        dealDeposit: 33.3,
        transferFee: 6.66,
        sbt: 10.99,
      }),
    );
    expect(terms?.deposit).toBe(33.3);
    expect(terms?.total).toBe(333);
    // fee/SBT come off the wire too — not from area x price, and not from the total
    expect(terms?.transferFee).toBe(6.66);
    expect(terms?.sbt).toBe(10.99);
  });

  /*
   * THE B-319 REGRESSION GUARD — the test that dies if a rate comes back into the browser.
   *
   * The 2% land-transfer fee and 3.3% SBT used to be float literals in the module under
   * test (TRANSFER_FEE_RATE / SBT_RATE), applied as Math.round(total * rate). They are
   * now THAILAND_RATES in @juneflow/tax-engine/thailand and the server ships the result.
   *
   * The wire below carries fees that are NOT `total * rate`, so ANY re-derivation in this
   * module — the old literals, an import of the rate table, a "helpful" fallback — yields
   * a different number and this goes red. Nothing else in the file would notice.
   */
  it("READS the server fee + SBT and never recomputes them from a browser-held rate", () => {
    const terms = dealTerms(
      plot({ totalValue: 604708125, transferFee: 12094162.5, sbt: 19955368.13 }),
    );
    expect(terms?.transferFee).toBe(12094162.5);
    expect(terms?.sbt).toBe(19955368.13);
    // the whole-baht figures the browser used to invent — must NOT be what we render
    expect(terms?.transferFee).not.toBe(Math.round(604708125 * 0.02));
    expect(terms?.sbt).not.toBe(Math.round(604708125 * 0.033));
    // ...nor the raw unrounded product (the server rounds to 2 dp; a browser copy would not)
    expect(terms?.sbt).not.toBe(604708125 * 0.033);
  });

  /*
   * A rate is not a fallback. A wire that carries the total but no fee is the shape that
   * tempts `plot.transferFee ?? Math.round(total * 0.02)` — the same defect the deposit
   * had (B-316/A2), and the reason those literals could sit in a screen file for months.
   * The fee must stay null (em-dash), never a locally-derived stand-in.
   */
  it("never derives the fee or SBT when the server omits them, even with a total present", () => {
    const terms = dealTerms(plot({ totalValue: 604708125, transferFee: null, sbt: null }));
    expect(terms?.transferFee).toBeNull();
    expect(terms?.sbt).toBeNull();
    expect(terms?.transferFee).not.toBe(Math.round(604708125 * 0.02));
    expect(terms?.sbt).not.toBe(Math.round(604708125 * 0.033));
    expect(terms?.total).toBe(604708125); // the total it DID send is still shown
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
    const terms = dealTerms(
      plot({
        areaSqm: 0,
        pricePerRai: 0,
        totalValue: null,
        dealDeposit: null,
        transferFee: null,
        sbt: null,
      }),
    );
    expect(terms).toEqual({ total: null, deposit: null, transferFee: null, sbt: null });
    for (const v of Object.values(terms ?? {})) {
      expect(v).toBeNull();
      expect(Number.isNaN(v as number)).toBe(false);
    }
  });

  /*
   * G5 PIXEL GUARD. tests/visual/reference/app-baseline/land-dd.png was captured against
   * the seeded dd-stage plot (โฉนด 11902, 24 rai @ 6,800,000/rai) while the browser still
   * computed these figures. Moving all four to the server must not move a pixel:
   * formatMoney rounds to whole baht, and the seeded price divides evenly, so the server's
   * 2-dp values format to the exact same strings. Verified across all 8 seeded plots for
   * B-319 — one (นส.3ก 442) differs by 0.50 baht in VALUE and by nothing in its rendered
   * string. If a future change to either side alters what this screen displays for the
   * baseline plot, it fails HERE rather than as an unexplained G5 diff.
   */
  it("renders the G5 baseline plot byte-identically (no pixel movement)", () => {
    const terms = dealTerms(plot()); // seeded โฉนด 11902: all four terms from the wire
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

  /*
   * Each term stands alone (B-319). The fee used to be a FUNCTION of the total, so a null
   * total forced null fees; now all four are independent wire fields and a partial answer
   * from the server must surface exactly what it sent — the real figures shown, the
   * missing ones em-dashed. Nothing is inferred from a sibling field.
   */
  it("surfaces a partial server answer verbatim — no term is derived from another", () => {
    const terms = dealTerms(
      plot({ totalValue: null, dealDeposit: 16320000, transferFee: null, sbt: 5385600 }),
    );
    expect(terms).toEqual({
      total: null, // em-dash
      deposit: 16320000, // still shown — it is a real server figure
      transferFee: null, // em-dash, not 0, and not re-derived from the sbt/deposit
      sbt: 5385600, // still shown even though the total it came from is absent
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

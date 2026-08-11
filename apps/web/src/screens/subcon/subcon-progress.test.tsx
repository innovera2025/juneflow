/*
 * SubconProgress SCREEN-SEAM tests (B-290, gate G3) — the period-ordinal guard as the
 * SCREEN renders it, not the pure derivation (that is subcon-progress-rows.test.ts).
 *
 * WHY THIS FILE EXISTS: the payment-timeline's first column reads work_period.seq as an
 * ordinal AND reads seq 0 as "the down-payment row". `seq` is `integer NOT NULL DEFAULT 0`
 * with no unique(contract_id, seq) and POST /subcon/contracts writes it unvalidated, so a
 * plan of all-zeroes is contract-legal — and the naive form stamps DP on EVERY row of it.
 * That is a per-element claim about one period, and only the SCREEN can be shown to
 * withhold it; a helper test cannot. Also pins that the guard is additive on the seeded
 * plan, so it moves no G5 pixels.
 *
 * Harness: vitest env is `node` (no jsdom) — renderToStaticMarkup + vi.mock'd
 * context/router-bound deps, the same style as po-wo/wo-list.test.tsx. Translators echo the
 * key (a key IS its Thai text here), so this .tsx stays ASCII-only.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Em-dash — the screen's honest-unknown marker (subcon-progress.tsx DASH). */
const DASH = "—";

const h = vi.hoisted(() => ({
  vendors: [] as unknown[],
  contracts: [] as unknown[],
  periods: [] as unknown[],
}));

/** ASCII stand-ins for the subcon.* templates carrying placeholders. */
const TPL: Record<string, string> = {
  "subcon.kpiPctOfTotal": "pct={pct}",
  "subcon.pctDone": "done={pct}",
  "subcon.itemsCount": "items={n}",
  "subcon.kpiRetentionSub": "ret={pct}",
  "subcon.retentionDeduct": "deduct={pct}",
  "subcon.closingRemainingInfo": "remain",
};

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (k: string) => TPL[k] ?? k,
    tn: (k: string) => k,
    tp: (k: string) => k,
  }),
}));

vi.mock("../../shell/page", () => ({
  Page: ({ title, subtitle, actions, children }: {
    title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode;
  }) => (
    <div>
      {title}
      {subtitle}
      {actions}
      {children}
    </div>
  ),
}));

vi.mock("./use-subcon-progress", () => ({
  useSubconVendors: () => ({ data: h.vendors, isLoading: false }),
  useSubconContracts: () => ({ data: h.contracts, isLoading: false }),
  useProgressPeriods: () => ({ data: h.periods, isLoading: false }),
}));

import { SubconProgress } from "./subcon-progress";

const VENDOR = { id: "v-1", name: "Rungrueang Construction", kind: "subcon", status: "active" };

const CONTRACT = {
  id: "c-0",
  no: "WO-2026-0042",
  vendor_id: "v-1",
  project_id: "prj-1",
  value: 2150000,
  currency_code: "THB",
  retention_pct: 10,
  start: "2026-01-15",
  end: "2026-12-31",
};

/** One served work period (subcon.ts periodWire + the enriched `title`). */
const period = (over: Record<string, unknown> = {}) => ({
  id: "wp-0",
  contract_id: "c-0",
  seq: 1,
  basis: "percent",
  target: 20,
  pct: 20,
  amount: 430000,
  currency_code: "THB",
  status: "pending",
  title: "",
  ...over,
});

const render = () => renderToStaticMarkup(<SubconProgress />);

/**
 * The timeline's FIRST-column cells (the period ordinal), in render order — anchored on
 * "the numeric <td> that opens a <tr>" so the tfoot total and the card-header contract
 * value (both .num, neither a row-opening cell) stay out of the sample.
 */
const ordinalCells = (html: string): string[] =>
  [...html.matchAll(/<tr[^>]*><td[^>]*class="num">([^<]*)</g)].map((m) => m[1]);

beforeEach(() => {
  h.vendors = [VENDOR];
  h.contracts = [CONTRACT];
  h.periods = [];
});

describe("SubconProgress — the SEED plan's ordinals still render (guard is additive)", () => {
  /** packages/db/src/seed/index.ts writes seq = index + 1, so 1..4 distinct. */
  const SEED_PLAN = [
    period({ id: "s-1", seq: 1, pct: 20, amount: 430000, status: "passed" }),
    period({ id: "s-2", seq: 2, pct: 30, amount: 645000, status: "passed" }),
    period({ id: "s-3", seq: 3, pct: 25, amount: 537500, status: "delivered" }),
    period({ id: "s-4", seq: 4, pct: 25, amount: 537500, status: "pending" }),
  ];

  it("prints 1 / 2 / 3 / 4 in the period column", () => {
    h.periods = SEED_PLAN;
    expect(ordinalCells(render())).toEqual(["1", "2", "3", "4"]);
  });

  it("labels a REAL seq-0 row DP when the plan's seq is a usable ordinal", () => {
    // a genuine down-payment plan: 0 then 1, 2 — distinct, so the DP reading is licensed
    h.periods = [
      period({ id: "d-0", seq: 0, pct: 10, amount: 215000, status: "passed" }),
      period({ id: "d-1", seq: 1, pct: 45, amount: 967500, status: "pending" }),
      period({ id: "d-2", seq: 2, pct: 45, amount: 967500, status: "pending" }),
    ];
    expect(ordinalCells(render())).toEqual(["subcon.rowDp", "1", "2"]);
  });
});

describe("SubconProgress — a defaulted all-zero seq plan withholds the ordinal", () => {
  /**
   * The naive form stamped subcon.rowDp on every one of these rows: "this is the
   * down-payment period" asserted three times about three different periods, off a column
   * whose zeroes mean "nobody recorded an ordinal", not "period zero".
   */
  const ZERO_SEQ = [
    period({ id: "z-1", seq: 0, pct: 30, amount: 300000, status: "passed" }),
    period({ id: "z-2", seq: 0, pct: 30, amount: 300000, status: "delivered" }),
    period({ id: "z-3", seq: 0, pct: 40, amount: 400000, status: "pending" }),
  ];

  it("em-dashes all three cells instead of stamping DP on all three", () => {
    h.periods = ZERO_SEQ;
    const cells = ordinalCells(render());
    expect(cells).toEqual([DASH, DASH, DASH]);
    expect(cells).not.toContain("subcon.rowDp");
  });

  it("still renders each row's REAL amount and status (withholding is not blanking)", () => {
    h.periods = ZERO_SEQ;
    const html = render();
    expect(html).toContain("300,000");
    expect(html).toContain("400,000");
    expect(html).toContain("subcon.statusRequested");
    // and the tfoot Sigma of the REAL period amounts is untouched by the ordinal guard
    expect(html).toContain("1,000,000");
  });
});

describe("SubconProgress — duplicate seqs withhold the ordinal", () => {
  it("em-dashes a plan whose seq column repeats (no unique(contract_id, seq) exists)", () => {
    h.periods = [
      period({ id: "p-1", seq: 1, pct: 30, amount: 300000, status: "passed" }),
      period({ id: "p-2", seq: 1, pct: 30, amount: 300000, status: "pending" }),
      period({ id: "p-3", seq: 2, pct: 40, amount: 400000, status: "pending" }),
    ];
    const cells = ordinalCells(render());
    expect(cells).toEqual([DASH, DASH, DASH]);
    expect(cells).not.toContain("1");
  });

  it("em-dashes a negative seq rather than printing it as an ordinal", () => {
    h.periods = [
      period({ id: "n-1", seq: -1, pct: 50, amount: 500000, status: "pending" }),
      period({ id: "n-2", seq: 1, pct: 50, amount: 500000, status: "pending" }),
    ];
    expect(ordinalCells(render())).toEqual([DASH, DASH]);
  });
});

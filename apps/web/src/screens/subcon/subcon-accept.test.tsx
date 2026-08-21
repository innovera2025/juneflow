/*
 * SubconAccept SCREEN-SEAM tests (B-290, gate G3) — the guards as the SCREEN renders them,
 * not the pure derivation (that is subcon-accept-rows.test.ts).
 *
 * WHY THIS FILE EXISTS: the defect these guards close was invisible to helper tests. cumMap
 * was correct for the input it was given; what was wrong was that the SCREEN handed it any
 * plan at all — its render gate asked deriveMethod, which answered off the FIRST period.
 * A pure-helper suite can pass with the screen still printing a fabricated threshold, so
 * these tests assert what reaches the markup: the tracker card, the marker lines, the
 * legend, the measure-column header and the period ordinal.
 *
 * Harness: the repo's vitest env is `node` (no jsdom), so the screen renders DOM-free with
 * renderToStaticMarkup and its context/router-bound dependencies are vi.mock'd — the same
 * style as po-wo/wo-list.test.tsx. Page is stubbed because it mounts TopBar, which needs a
 * live TanStack Router. Translators echo the key (a key IS its Thai text in this repo), so
 * this .tsx stays ASCII-only and the assertions read structure + interpolated VALUES.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Em-dash — the screen's honest-unknown marker (subcon-accept.tsx DASH). */
const DASH = "—";

/** Mutable mock state, hoisted so the vi.mock factories can close over it. */
const h = vi.hoisted(() => ({
  contracts: [] as unknown[],
  periods: [] as unknown[],
  /** What openModal was last called with (the acceptance-modal title carries {no}). */
  modal: null as Record<string, unknown> | null,
  /** POST /periods/{id}/deliver stand-in — the re-inspect control's only server op. */
  deliver: vi.fn(),
}));

/**
 * ASCII stand-ins for the subcon.* templates that carry placeholders, keeping the real
 * {placeholder} names so .replace() still interpolates. Unlisted keys echo the key.
 */
const TPL: Record<string, string> = {
  "subcon.acceptModalTitle": "accept-modal no={no}",
  "subcon.kpiPeriodsCount": "n={n} count={count}",
  "subcon.kpiRetentionSub": "ret={pct}",
  "subcon.actualProgress": "actual={pct}",
  "subcon.fileCount": "files={n}",
  "subcon.uploadToast": "upload={no}",
  "subcon.dmsInfoLine": "dms={no}",
  "subcon.defectLabel": "defect={value}",
};

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (k: string) => TPL[k] ?? k,
    tn: (k: string) => k,
    tp: (k: string) => k,
  }),
}));

// Page mounts TopBar (TanStack Router hooks) — stub it down to its slots.
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

vi.mock("../../shell/shell-context", () => ({
  useShellCtx: () => ({
    params: {},
    notify: () => {},
    navigate: () => {},
    openModal: (m: Record<string, unknown>) => {
      h.modal = m;
    },
  }),
}));

vi.mock("../master/use-vendors", () => ({
  useVendorList: () => ({ data: [{ id: "v-1", name: "Rungrueang Construction", kind: "subcon" }] }),
}));

vi.mock("../../shell/use-shell-data", () => ({
  useProjects: () => ({ data: [{ id: "prj-1", name: "Ratchaphruek Phase 1" }] }),
}));

vi.mock("./use-subcon", () => ({
  useSubconContractList: () => ({ data: h.contracts, isLoading: false }),
  useContractPeriods: () => ({ data: h.periods, isLoading: false }),
  useAcceptPeriod: () => ({ accept: async () => ({}), reject: async () => ({}) }),
  useDeliverPeriod: () => ({ mutate: h.deliver, isPending: false }),
}));

// The acceptance modal body is opened through ctx.openModal; the list never mounts it.
vi.mock("./accept-form", () => ({
  AcceptForm: () => <div />,
}));

import { SubconAccept } from "./subcon-accept";

/** The served contract (subcon.ts contractWire) — seed WO-2026-0042. */
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

/** One served work period (subcon.ts periodWire). */
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
  ...over,
});

/**
 * The SEED percent plan (packages/db/src/seed/index.ts SUBC_CONTRACTS[0], the contract the
 * subcon.accept G5 baseline renders): pct 20/30/25/25, seq 1-4, every row percent-basis.
 */
const SEED_PLAN = [
  period({ id: "wp-1", seq: 1, pct: 20, target: 20, amount: 430000, status: "passed" }),
  period({ id: "wp-2", seq: 2, pct: 30, target: 30, amount: 645000, status: "passed" }),
  period({ id: "wp-3", seq: 3, pct: 25, target: 25, amount: 537500, status: "delivered" }),
  period({ id: "wp-4", seq: 4, pct: 25, target: 25, amount: 537500, status: "pending" }),
];

const render = () => renderToStaticMarkup(<SubconAccept />);

/** How many cumulative-% marker lines the tracker drew (left:N% absolute divider divs). */
const markerCount = (html: string) => (html.match(/left:\d/g) ?? []).length;

beforeEach(() => {
  h.contracts = [CONTRACT];
  h.periods = [];
  h.modal = null;
});

/* --------------------------------------------------------------------------- */
/* the healthy plan — the guards are additive, the real screen is unchanged      */
/* --------------------------------------------------------------------------- */

describe("SubconAccept — the SEED percent plan still renders in full", () => {
  it("draws one marker per period at its real cumulative %, with the legend", () => {
    h.periods = SEED_PLAN;
    const html = render();
    expect(markerCount(html)).toBe(4);
    // 20 / 50 / 75 / 100 — the real prefix sums, positioned on the bar
    expect(html).toContain("left:20%");
    expect(html).toContain("left:50%");
    expect(html).toContain("left:75%");
    expect(html).toContain("left:100%");
    // the legend describes those lines, so it is present when they are
    expect(html).toContain("subcon.progressLegend");
    // and the percent tracker card itself rendered (uniform percent basis)
    expect(html).toContain("subcon.progressRefTitle");
  });

  it("prints every period's real ordinal and heads the measure column '%'", () => {
    h.periods = SEED_PLAN;
    const html = render();
    const cells = html.match(/class="num">(\d+)</g) ?? [];
    expect(cells.length).toBeGreaterThanOrEqual(4);
    // the ordinals 1..4 reach the period column
    for (const n of ["1", "2", "3", "4"]) expect(html).toContain(`class="num">${n}<`);
    // the measure column header is the percent sign, not an em-dash
    expect(html).toContain(">%</th>");
  });

});

/*
 * NOT COVERED HERE, stated plainly rather than faked: the acceptance-modal TITLE and the
 * AcceptForm accept/reject TOASTS also print the ordinal, and are routed through the same
 * periodOrdinal() helper the period column above is asserted on — but they only fire from
 * an onClick, which this node/no-DOM harness (renderToStaticMarkup) cannot dispatch. A test
 * asserting the template string instead of the screen would pass with the guard reverted,
 * so it is left out; the shared helper is what pins them.
 */

/* --------------------------------------------------------------------------- */
/* the mixed-basis plan — the defect the first-element render gate let through   */
/* --------------------------------------------------------------------------- */

describe("SubconAccept — a mixed-basis plan cannot light the percent tracker", () => {
  /**
   * work_period.basis is a per-ROW column with no contract-level counterpart, so this plan
   * is contract-legal. The old gate read the FIRST period ("percent"), rendered the tracker
   * and drew markers whose running total silently mixed percent shares with rows that carry
   * no share at all.
   */
  const MIXED = [
    period({ id: "m-1", seq: 1, basis: "percent", pct: 40, amount: 400000 }),
    period({ id: "m-2", seq: 2, basis: "distance", pct: 0, target: 100, amount: 300000 }),
    period({ id: "m-3", seq: 3, basis: "percent", pct: 40, amount: 400000 }),
  ];

  it("renders NO percent tracker and NO markers", () => {
    h.periods = MIXED;
    const html = render();
    expect(html).not.toContain("subcon.progressRefTitle");
    expect(markerCount(html)).toBe(0);
  });

  it("withholds the method chip from the title", () => {
    h.periods = MIXED;
    const html = render();
    expect(html).not.toContain("subcon.methodPercent");
    expect(html).not.toContain("subcon.methodDistance");
  });

  it("em-dashes the measure-column header instead of naming one row's basis", () => {
    h.periods = MIXED;
    const html = render();
    expect(html).toContain(`>${DASH}</th>`);
    expect(html).not.toContain(">%</th>");
    expect(html).not.toContain("subcon.colMilestone");
  });

  it("still renders every period row with its REAL amount and status", () => {
    // the guard withholds the unestablished claim, it does not gut the screen
    h.periods = MIXED;
    const html = render();
    expect(html).toContain("400,000");
    expect(html).toContain("300,000");
    expect(html).toContain("subcon.statusNotReached");
  });
});

/* --------------------------------------------------------------------------- */
/* the per-element pct / seq escapes                                            */
/* --------------------------------------------------------------------------- */

describe("SubconAccept — a percent plan with one unrecorded share withholds every marker", () => {
  /**
   * pct is numeric(6,3) NOT NULL DEFAULT '0', written unvalidated: 30 / 0 / 40 is legal. A
   * Sigma-shaped gate passes it and period 2's line lands byte-identically on period 1's.
   */
  const GAP = [
    period({ id: "g-1", seq: 1, pct: 30, amount: 300000 }),
    period({ id: "g-2", seq: 2, pct: 0, amount: 300000 }),
    period({ id: "g-3", seq: 3, pct: 40, amount: 400000 }),
  ];

  it("draws no markers and em-dashes the legend that describes them", () => {
    h.periods = GAP;
    const html = render();
    // the tracker card is still there (the plan IS uniformly percent-basis)
    expect(html).toContain("subcon.progressRefTitle");
    expect(markerCount(html)).toBe(0);
    expect(html).not.toContain("subcon.progressLegend");
    expect(html).toContain(DASH);
  });

  it("never reprints period 1's threshold as period 2's", () => {
    h.periods = GAP;
    const html = render();
    expect(html).not.toContain("left:30%");
    expect(html).not.toContain("left:70%");
  });
});

describe("SubconAccept — a defaulted all-zero seq plan withholds the ordinal", () => {
  /**
   * work_period.seq is `integer NOT NULL DEFAULT 0` with no unique(contract_id, seq); a
   * client that omits seq persists exactly this. Printing it stamps "0" on every row and
   * would emit three markers all claiming to be period 0.
   */
  const ZERO_SEQ = [
    period({ id: "z-1", seq: 0, pct: 30, amount: 300000 }),
    period({ id: "z-2", seq: 0, pct: 30, amount: 300000 }),
    period({ id: "z-3", seq: 0, pct: 40, amount: 400000 }),
  ];

  it("em-dashes the period column rather than printing 0 three times", () => {
    h.periods = ZERO_SEQ;
    const html = render();
    expect(html).not.toContain('class="num">0<');
    // three period cells, each an em-dash
    expect((html.match(new RegExp(`class="num">${DASH}<`, "g")) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("draws no cumulative markers off an unusable ordinal", () => {
    h.periods = ZERO_SEQ;
    const html = render();
    expect(markerCount(html)).toBe(0);
  });

  it("still shows each row's REAL amount (a withheld ordinal is not an empty screen)", () => {
    h.periods = ZERO_SEQ;
    const html = render();
    expect(html).toContain("300,000");
    expect(html).toContain("400,000");
  });
});

describe("SubconAccept — an over-100 plan withholds the whole series", () => {
  it("draws no marker off the bar's clipped right edge", () => {
    h.periods = [
      period({ id: "o-1", seq: 1, pct: 70, amount: 700000 }),
      period({ id: "o-2", seq: 2, pct: 70, amount: 700000 }),
    ];
    const html = render();
    expect(markerCount(html)).toBe(0);
    expect(html).not.toContain("left:140%");
    expect(html).not.toContain("left:70%");
  });
});

/* --------------------------------------------------------------------------- */
/* B-371 — a rejected period has a door home, and this screen opens it           */
/* --------------------------------------------------------------------------- */

describe("SubconAccept — the re-inspect control on a rejected period", () => {
  /**
   * Before B-371 `rejected` was written by inspect and left by nothing, so this
   * control was rendered DISABLED and wired to no server op: a turned-back period
   * was stranded and its money never reached AP. DELIVERABLE_FROM now carries
   * `rejected` (apps/api/src/routes/subcon.ts:353), so the control is live.
   *
   * renderToStaticMarkup fires no events, so these assert the two things markup
   * can carry: the control is offered, and it is NOT disabled. Reverting the
   * wiring puts `disabled` back and kills the second assertion.
   */
  const REJECTED = [
    period({ id: "r-1", seq: 1, pct: 50, amount: 500000, status: "rejected" }),
    period({ id: "r-2", seq: 2, pct: 50, amount: 500000, status: "pending" }),
  ];

  it("offers the re-inspect control, enabled", () => {
    h.periods = REJECTED;
    const html = render();
    expect(html).toContain("subcon.reinspectBtn");
    const btn = html.slice(html.indexOf("subcon.reinspectBtn") - 400, html.indexOf("subcon.reinspectBtn"));
    expect(btn).not.toContain("disabled");
  });

  it("offers it ONLY on the rejected row, never on a pending one", () => {
    h.periods = [period({ id: "p-1", seq: 1, pct: 50, amount: 500000, status: "pending" })];
    const html = render();
    expect(html).not.toContain("subcon.reinspectBtn");
  });
});

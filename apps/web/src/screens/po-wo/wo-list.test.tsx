/*
 * WOList SCREEN-SEAM tests (B-277, gate G3) — the component<->wire wiring, not the pure
 * aggregation (that is po-wo-rows.test.ts).
 *
 * WHY THIS FILE EXISTS: GET /wo has carried `scope`, `progress`, `contract_id` and
 * `installments[]` since B-080 / F3 (migration 0020), but WOList declared all four absent
 * and rendered em-dashes. Pure-helper tests could not catch that — the helpers were fine and
 * the SCREEN was empty. These tests assert the seam instead: that the payload the hook
 * returns actually reaches the rendered scope cell, progress bar, installment rows, KPI and tabs.
 * Revert the wire and they go red.
 *
 * Harness: the repo's vitest env is `node` (no jsdom), so the screen is rendered DOM-free with
 * renderToStaticMarkup and its context/router-bound dependencies are vi.mock'd — the same style
 * as boq/boq-bom.test.tsx. Page is stubbed because it mounts TopBar, which needs a live
 * TanStack Router. Translators return ASCII stand-in templates carrying the real
 * {placeholders}, so this .tsx stays ASCII-only and the assertions read the interpolated
 * VALUES rather than any Thai copy.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Em-dash — the screen's honest-unknown marker (wo-list.tsx DASH). */
const DASH = "—";

/**
 * po-wo-strings.json tabClosedContract ("close contract"), sourced from unicode escapes so
 * this file stays ASCII-only — the tp() stand-in below echoes the phrase KEY, and a phrase
 * key in this repo IS its Thai text.
 */
const TAB_CLOSED = "\u0E1B\u0E34\u0E14\u0E2A\u0E31\u0E0D\u0E0D\u0E32";

/** Mutable mock state, hoisted so the vi.mock factories can close over it. */
const h = vi.hoisted(() => ({
  /** What useWoList returns (the served GET /wo rows + query flags). */
  wo: { data: [] as unknown[], isLoading: false },
  /** The served GET /vendors rows (subcon-name resolution). */
  vendors: [{ id: "v-1", name: "Rungrueang Construction" }] as unknown[],
}));

/**
 * ASCII stand-ins for the wo.list* templates that carry placeholders, keeping the real
 * {placeholder} names so .replace() still interpolates. Unlisted keys echo the key itself.
 */
const TPL: Record<string, string> = {
  "wo.list.installmentSummary": "plan n={n} pct={pct}",
  "wo.list.atContractPct": "at={pct}",
  "wo.list.retentionTerms": "hold={pct} months={months}",
  "wo.list.filesCount": "files={n}",
  "subcon.colPeriod": "period",
  "subcon.rowDp": "DP",
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
  Page: ({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children?: ReactNode }) => (
    <div>
      {title}
      {actions}
      {children}
    </div>
  ),
}));

vi.mock("../../shell/shell-context", () => ({
  useShellCtx: () => ({ notify: () => {}, confirm: () => {}, openModal: () => {} }),
}));

vi.mock("../master/use-vendors", () => ({
  useVendorList: () => ({ data: h.vendors }),
}));

vi.mock("./use-po-wo", () => ({
  useWoList: () => h.wo,
  useApproveWo: () => ({ mutate: () => {} }),
}));

// The create form pulls the PR picker + mutations; the list under test never mounts it.
vi.mock("./wo-create-form", () => ({
  WOCreateForm: () => <div />,
}));

import { WOList } from "./wo-list";

/**
 * One served installment (wo.ts installmentWire). Money columns arrive as numbers on the wire; the
 * numeric(6,3) pct arrives as a number too (woWire coerces with Number()).
 */
const period = (over: Record<string, unknown> = {}) => ({
  id: "wp0",
  seq: 1,
  basis: "percent",
  target: 0,
  pct: 30,
  amount: 645000,
  status: "pending",
  currency_code: "THB",
  ...over,
});

/**
 * The api's own list fixture (apps/api/src/routes/wo.test.ts "returns the envelope with
 * retention_amount + scope/progress/installments (F3)"): plan 645k passed + 645k pending +
 * 860k pending = 2,150k, so the SERVER sends progress 30.
 */
const SERVED_WO = {
  id: "w0",
  no: "WO-2026-0117",
  pr_id: "pr-1",
  vendor_id: "v-1",
  contract_id: "c0",
  status: "pending",
  approval_step: 0,
  currency_code: "THB",
  value: 2_150_000,
  retention_pct: 10,
  retention_amount: 215000,
  amount: 2_150_000,
  scope: "exterior paint Block A",
  progress: 30,
  installments: [
    period({ id: "wp0", seq: 1, pct: 30, amount: 645000, status: "passed" }),
    period({ id: "wp1", seq: 2, pct: 30, amount: 645000, status: "delivered" }),
    period({ id: "wp2", seq: 3, pct: 40, amount: 860000, status: "pending" }),
  ],
};

/** A WO with contract_id null — wo.ts honestly reports an empty plan / null progress. */
const SERVED_PLANLESS = {
  id: "w1",
  no: "WO-2026-0116",
  pr_id: "pr-2",
  vendor_id: "v-1",
  contract_id: null,
  status: "approved",
  currency_code: "THB",
  value: 845000,
  retention_pct: 5,
  retention_amount: 42250,
  amount: 845000,
  scope: null,
  progress: null,
  installments: [],
};

const render = () => renderToStaticMarkup(<WOList />);

/** Visible text of a static render — tags (and therefore style attributes) stripped. */
const text = (html: string) => html.replace(/<[^>]*>/g, "");

beforeEach(() => {
  h.wo = { data: [], isLoading: false };
  h.vendors = [{ id: "v-1", name: "Rungrueang Construction" }];
});

describe("WOList <-> GET /wo scope + progress (B-277)", () => {
  it("renders the served scope in the list cell and the detail header", () => {
    h.wo = { data: [SERVED_WO], isLoading: false };
    const shown = text(render());
    // Once in the row, once in the detail panel.
    expect(shown.split("exterior paint Block A").length - 1).toBe(2);
  });

  it("renders the SERVER's progress as the bar width and the % label", () => {
    h.wo = { data: [SERVED_WO], isLoading: false };
    const html = render();
    expect(html).toContain("width:30%"); //           the bar, drawn from progress
    expect(text(html)).toContain("30%"); //            the label next to it
    expect(html).toContain("background:var(--accent)"); // < 100 keeps the accent fill
  });

  it("turns the bar --ok at 100 (the prototype's own rule on that number)", () => {
    h.wo = { data: [{ ...SERVED_WO, progress: 100 }], isLoading: false };
    const html = render();
    expect(html).toContain("width:100%;height:100%;background:var(--ok)");
  });

  it("never treats progress 100 as a closed contract", () => {
    // The wire still has no closed status: the closed KPI and the closed tab stay honest.
    h.wo = { data: [{ ...SERVED_WO, progress: 100 }], isLoading: false };
    const shown = text(render());
    expect(shown).toContain(`wo.list.kpiClosedMonth${DASH}`);
    // ...and the closed tab badge is still 0, not 1.
    expect(shown).toContain(`${TAB_CLOSED}0`);
  });

  it("em-dashes scope and progress for a WO the server reports plan-less (no bar drawn)", () => {
    h.wo = { data: [SERVED_PLANLESS], isLoading: false };
    const html = render();
    expect(html).not.toContain("border-radius:999px;overflow:hidden"); // no progress bar
    expect(text(html)).not.toContain("0%"); //                            no fabricated 0%
    expect(text(html)).toContain(DASH);
  });
});

describe("WOList <-> GET /wo installments[] (B-277)", () => {
  it("renders one installment row per served installment, with the wire's own amounts", () => {
    h.wo = { data: [SERVED_WO], isLoading: false };
    const shown = text(render());
    expect(shown).toContain("period 1");
    expect(shown).toContain("period 2");
    expect(shown).toContain("period 3");
    expect(shown).toContain("645,000");
    expect(shown).toContain("860,000");
  });

  it("captions each installment with the CUMULATIVE contract share, not its own pct", () => {
    h.wo = { data: [SERVED_WO], isLoading: false };
    const shown = text(render());
    expect(shown).toContain("at=30"); //  installment 1: 30
    expect(shown).toContain("at=60"); //  installment 2: 30 + 30 (its own pct is 30, not 60)
    expect(shown).toContain("at=100"); // installment 3: 30 + 30 + 40
  });

  it("labels a seq-0 installment with the DP key rather than 'period 0'", () => {
    h.wo = {
      data: [{ ...SERVED_WO, installments: [period({ id: "dp", seq: 0, pct: 10, amount: 215000 })] }],
      isLoading: false,
    };
    const shown = text(render());
    expect(shown).toContain("DP");
    expect(shown).not.toContain("period 0");
  });

  it("draws the three prototype states from the real work_period statuses", () => {
    h.wo = { data: [SERVED_WO], isLoading: false };
    const html = render();
    expect(html).toContain("var(--ok-soft)"); //   wp0 passed    -> done
    expect(html).toContain("var(--warn-soft)"); // wp1 delivered -> current
    expect(html).toContain("2px solid var(--border-strong)"); // wp2 pending -> not-done ring
  });

  it("fills the summary {n} from the plan length and {pct} from the server's progress", () => {
    h.wo = { data: [SERVED_WO], isLoading: false };
    expect(text(render())).toContain("plan n=3 pct=30");
  });

  it("em-dashes the summary {n} when no contract is linked (not an honest-looking 0 installments)", () => {
    h.wo = { data: [SERVED_PLANLESS], isLoading: false };
    expect(text(render())).toContain(`plan n=${DASH} pct=${DASH}`);
  });

  /*
   * The Sigma-then-assert the review caught, at the seam. The caption is a claim about ONE
   * installment; the pct-availability guard used to be a SUM. work_period.pct is
   * numeric(6,3) NOT NULL DEFAULT '0' and POST /subcon/contracts writes it unvalidated (no
   * per-period > 0, no Sigma = 100), so this served plan is contract-legal — and under the Sigma
   * guard the screen printed installment 2's caption byte-identically to installment 1's
   * ("at=30") while nothing about installment 2's own share was known.
   */
  it("withholds EVERY caption when one percent installment's own share is unrecorded", () => {
    h.wo = {
      data: [
        {
          ...SERVED_WO,
          installments: [
            period({ id: "a", seq: 1, pct: 30 }),
            period({ id: "b", seq: 2, pct: 0, amount: 500000 }), // share NOT recorded
            period({ id: "c", seq: 3, pct: 40, amount: 860000 }),
          ],
        },
      ],
      isLoading: false,
    };
    const shown = text(render());
    expect(shown).not.toContain("at="); // not 30 / 30 / 70, and not a lone survivor either
    // Only the unknowable is withheld — the rows, their labels and their real amounts stay.
    expect(shown).toContain("period 1");
    expect(shown).toContain("period 3");
    expect(shown).toContain("500,000");
  });

  /*
   * seq is `integer NOT NULL DEFAULT 0` with no unique(contract_id, seq) and subcon.ts writes
   * `seq: toNum(pick(p,"seq")) ?? 0`, so a client that omits seq persists this plan. Both
   * naive renders read it as an ordinal: every row selected the whole plan ("at=100") and
   * every row took the down-payment label ("DP").
   */
  it("withholds the row label and the caption when the served plan's seq is the unvalidated default", () => {
    h.wo = {
      data: [
        {
          ...SERVED_WO,
          installments: [
            period({ id: "a", seq: 0, pct: 30 }),
            period({ id: "b", seq: 0, pct: 30, amount: 500000 }),
            period({ id: "c", seq: 0, pct: 40, amount: 860000 }),
          ],
        },
      ],
      isLoading: false,
    };
    const shown = text(render());
    expect(shown).not.toContain("DP"); //     not three down-payment rows
    expect(shown).not.toContain("period"); // and no ordinal fabricated from array position
    expect(shown).not.toContain("at="); //    no row claims the whole contract
    expect(shown).toContain("500,000"); //    the real amounts still render
    expect(shown).toContain("860,000");
  });

  it("never prints a contract share larger than the whole contract", () => {
    h.wo = {
      data: [
        {
          ...SERVED_WO,
          installments: [
            period({ id: "a", seq: 1, pct: 150 }),
            period({ id: "b", seq: 2, pct: 100 }),
          ],
        },
      ],
      isLoading: false,
    };
    expect(text(render())).not.toContain("at="); // not "at=150" / "at=250"
  });

  it("em-dashes the installment caption when the plan is not entirely percent-basis", () => {
    // pct carries no contract share for a milestone installment, so accumulating would mix populations.
    h.wo = {
      data: [
        {
          ...SERVED_WO,
          installments: [
            period({ id: "a", seq: 1, pct: 40, status: "passed" }),
            period({ id: "b", seq: 2, basis: "milestone", pct: 0, amount: 500000 }),
          ],
        },
      ],
      isLoading: false,
    };
    const shown = text(render());
    expect(shown).not.toContain("at=40");
    expect(shown).not.toContain("at=0");
    expect(shown).toContain("period 1");
  });
});

describe("WOList installment KPI vs tab — two different populations (B-277)", () => {
  it("counts the installments awaiting acceptance in the KPI", () => {
    h.wo = { data: [SERVED_WO], isLoading: false }; // one delivered installment
    expect(text(render())).toContain("wo.list.kpiDueInstallments1");
  });

  it("de-duplicates installments shared by two WOs on one subcon contract, while the tab counts WOs", () => {
    // wo.contract_id has no unique constraint: GET /wo hands BOTH WOs the same
    // work_period rows, so a naive per-WO sum would report 2 due installments where there is 1.
    h.wo = {
      data: [SERVED_WO, { ...SERVED_WO, id: "w9", no: "WO-2026-0118" }],
      isLoading: false,
    };
    const shown = text(render());
    expect(shown).toContain("wo.list.kpiDueInstallments1"); // installment population: 1
    expect(shown).toContain("wo.list.tabApproveInstallment2"); // WO population: 2
  });

  /*
   * PIN, not a fix — this behaviour is unchanged by the rework, so this test SURVIVES a
   * revert of the screen (stated plainly rather than counted as a probe kill). It locks a
   * deliberate choice the review asked to be made explicit: unlike their status-partitioned
   * neighbours (kpiPending / kpiActive / the pending + active tabs), the installment KPI and
   * the approve-installment tab run over EVERY served WO. An installment belongs to the
   * subcon CONTRACT, not to the WO doc, so a delivered period is awaiting our acceptance
   * whether or not the WO referencing it is still draft — and because contract_id is not
   * unique, filtering by WO status would drop or keep the same real installment depending
   * on which WO happened to point at it.
   */
  it("counts a draft WO's delivered installment — the installment belongs to the contract, not the doc", () => {
    h.wo = {
      data: [
        {
          ...SERVED_WO,
          status: "draft",
          installments: [period({ id: "a", seq: 1, pct: 100, status: "delivered" })],
        },
      ],
      isLoading: false,
    };
    const shown = text(render());
    expect(shown).toContain("wo.list.kpiDueInstallments1");
    expect(shown).toContain("wo.list.tabApproveInstallment1");
    // ...while the status-partitioned neighbours correctly exclude it.
    expect(shown).toContain("wo.list.kpiActive0");
  });

  it("keeps the KPI at 0 when every served plan is already accepted", () => {
    h.wo = {
      data: [{ ...SERVED_WO, installments: [period({ id: "a", status: "paid" })] }],
      isLoading: false,
    };
    expect(text(render())).toContain("wo.list.kpiDueInstallments0");
  });
});

/*
 * SubconHandover SCREEN-SEAM tests (B-317, gate G3) — the period-ordinal guard as the
 * printed certificate renders it.
 *
 * WHY THIS FILE EXISTS: B-290 added `seqOk = hasOrdinalSeq(periods)` to the certificate's
 * period column, but shipped no test for it — a revert probe deleted that guard with the
 * whole 1753-test web suite still green. The certificate is the one surface here that is
 * PRINTED and signed, so a fabricated ordinal on it is the most durable version of the
 * defect: an all-zero plan (work_period.seq is `integer NOT NULL DEFAULT 0`, no
 * unique(contract_id, seq), unvalidated by POST /subcon/contracts) printed "0" on every
 * accepted row of a document three people sign.
 *
 * Harness mirrors subcon-accept.test.tsx: vitest env is `node` (no jsdom), so the screen
 * renders DOM-free with renderToStaticMarkup and its context/router-bound dependencies are
 * vi.mock'd. Translators echo the key, so this file stays ASCII-only and the assertions
 * read structure + interpolated VALUES.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Em-dash — the screen's honest-unknown marker (subcon-handover.tsx DASH). */
const DASH = "—";

const h = vi.hoisted(() => ({
  contracts: [] as unknown[],
  periods: [] as unknown[],
}));

const TPL: Record<string, string> = {
  "subcon.retentionLabel": "ret={pct}",
  "subcon.partialWarn": "partial n={n} count={count}",
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

vi.mock("../../shell/shell-context", () => ({
  useShellCtx: () => ({
    params: {},
    notify: () => {},
    navigate: () => {},
    openModal: () => {},
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
}));

import { SubconHandover } from "./subcon-handover";

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
  status: "passed",
  ...over,
});

const render = () => renderToStaticMarkup(<SubconHandover />);

/**
 * The certificate body's ordinal cells. The period column is the only `class="num"` cell
 * carrying font-weight:700 other than the value column, so read the row cells positionally:
 * each accepted <tr> renders [seq, delivered(—), acceptDate(—), value].
 */
const ordinalCells = (html: string): string[] =>
  [...html.matchAll(/<tr[^>]*>(.*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((c) => c[1]))
    .filter((cells) => cells.length === 4)
    .map((cells) => cells[0].replace(/<[^>]*>/g, ""));

beforeEach(() => {
  h.contracts = [CONTRACT];
  h.periods = [];
});

describe("SubconHandover — the printed certificate's period ordinal", () => {
  it("prints the real seq for the seeded plan (guards must not change correct output)", () => {
    // packages/db/src/seed/index.ts writes seq = si + 1, so the seeded plan is a usable
    // ordinal and every guard here PASSES — this is the G5-baseline rendering.
    h.periods = [
      period({ id: "wp-1", seq: 1, pct: 20, amount: 430000, status: "passed" }),
      period({ id: "wp-2", seq: 2, pct: 30, amount: 645000, status: "paid" }),
      period({ id: "wp-3", seq: 3, pct: 25, amount: 537500, status: "passed" }),
    ];
    expect(ordinalCells(render())).toEqual(["1", "2", "3"]);
  });

  it("em-dashes every ordinal on a defaulted all-zero-seq plan", () => {
    // The unvalidated-column defect: without the guard this printed "0" three times on a
    // signed document.
    h.periods = [
      period({ id: "wp-1", seq: 0, status: "passed" }),
      period({ id: "wp-2", seq: 0, status: "passed" }),
      period({ id: "wp-3", seq: 0, status: "paid" }),
    ];
    expect(ordinalCells(render())).toEqual([DASH, DASH, DASH]);
  });

  it("em-dashes when the plan's seq column repeats (no unique(contract_id, seq) exists)", () => {
    h.periods = [
      period({ id: "wp-1", seq: 1, status: "passed" }),
      period({ id: "wp-2", seq: 1, status: "passed" }),
      period({ id: "wp-3", seq: 2, status: "paid" }),
    ];
    expect(ordinalCells(render())).toEqual([DASH, DASH, DASH]);
  });

  it("withholds even when the duplicate falls OUTSIDE the accepted subset", () => {
    // The behaviour subcon-handover.tsx's own comment claims: hasOrdinalSeq runs over the
    // WHOLE plan, not over `accepted`, because the printed number claims a position in the
    // CONTRACT's plan. Checking only the accepted subset would license "1, 2" here while
    // the contract actually holds two rows numbered 2. This assertion is what stops a
    // future "optimisation" from narrowing the check to the rows being printed.
    h.periods = [
      period({ id: "wp-1", seq: 1, status: "passed" }),
      period({ id: "wp-2", seq: 2, status: "paid" }),
      period({ id: "wp-3", seq: 2, status: "pending" }), // NOT accepted -> not printed
    ];
    const cells = ordinalCells(render());
    expect(cells).toHaveLength(2); // only the accepted rows are printed
    expect(cells).toEqual([DASH, DASH]);
  });

  it("em-dashes a negative seq rather than printing it as an ordinal", () => {
    h.periods = [
      period({ id: "wp-1", seq: -1, status: "passed" }),
      period({ id: "wp-2", seq: 1, status: "passed" }),
    ];
    expect(ordinalCells(render())).toEqual([DASH, DASH]);
  });
});

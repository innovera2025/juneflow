/*
 * POList SCREEN-SEAM tests (B-278, gate G3) — the component<->payload wiring, not the pure
 * narrowing (that is po-list-rows.test.ts).
 *
 * WHY THIS FILE EXISTS: po-list-rows.test.ts can only prove that toPoListWire / formatDate /
 * paidPct behave; it stays green if the SCREEN never calls them and keeps printing the
 * em-dashes it printed before. These tests assert the seam instead — that a served GET /po
 * row's `paid` and `doc_date` reach the rendered paid column (+ its proportion bar) and the
 * detail panel's document-date stat. Revert the wire (put the literal em-dash <td> / DASH
 * SmallStat back) and they go red.
 *
 * Harness: the repo's vitest env is `node` (no jsdom), so the screen renders DOM-free with
 * renderToStaticMarkup and its context/router-bound dependencies are vi.mock'd — the same
 * style as screens/boq/boq-bom.test.tsx. Page is stubbed because it mounts TopBar, which
 * needs a live TanStack Router. Translators echo their key, so this .tsx stays ASCII-only.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Em-dash — the screen's honest-unknown marker (po-list.tsx DASH). */
const DASH = "—";

/** Mutable mock state, hoisted so the vi.mock factories can close over it. */
const h = vi.hoisted(() => ({
  /** What usePoList returns (the served GET /po rows + query flags). */
  po: { data: [] as unknown[], isLoading: false },
  /** GET /pr rows — the refPR + detail-project resolvers. */
  pr: [{ id: "pr-1", no: "PR-2026-0414", project_id: "p1", status: "approved", amount: 1268000 }],
  /** GET /vendors rows — the vendor-name resolver. */
  vendors: [{ id: "v-1", name: "sosuco ceramic" }],
  /** GET /projects rows — the detail-panel project name. */
  projects: [{ id: "p1", name: "juneflow ratchaphruek" }],
}));

vi.mock("../../i18n", () => ({
  useI18n: () => ({ t: (k: string) => k, tp: (k: string) => k, tn: (k: string) => k }),
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
  useShellCtx: () => ({ navigate: () => {}, notify: () => {}, confirm: () => {}, openModal: () => {} }),
}));

vi.mock("../../shell/use-shell-data", () => ({
  useProjects: () => ({ data: h.projects }),
}));

vi.mock("../master/use-vendors", () => ({
  useVendorList: () => ({ data: h.vendors }),
}));

vi.mock("./use-po-wo", () => ({
  usePoList: () => h.po,
  usePrList: () => ({ data: h.pr }),
  useCreatePo: () => ({ mutateAsync: async () => ({}), isPending: false }),
  useSubmitPo: () => ({ mutateAsync: async () => ({}), isPending: false }),
}));

import { POList } from "./po-list";

/**
 * A served GET /po page (po.ts poWire — the exact key set po.test.ts pins). PO-0291 is
 * part-paid: 317,000 of a 1,268,000 total = a 25% bar. PO-0290 has no ap_billing at all, so
 * the server reports a real 0 (never a fabricated figure).
 */
const SERVED = [
  {
    id: "po-1",
    no: "PO-2026-0291",
    pr_id: "pr-1",
    vendor_id: "v-1",
    status: "approved",
    approval_step: 3,
    currency_code: "THB",
    credit_term: 30,
    total: 1268000,
    vat: 0,
    amount: 1268000,
    doc_date: "2026-05-24T03:15:00.000Z",
    paid: 317000,
    deposit: 300000,
  },
  {
    id: "po-2",
    no: "PO-2026-0290",
    pr_id: "pr-1",
    vendor_id: "v-1",
    status: "pending",
    approval_step: 0,
    currency_code: "THB",
    credit_term: 0,
    total: 902475,
    vat: 0,
    amount: 902475,
    doc_date: "2026-05-25T09:00:00.000Z",
    paid: 0,
    deposit: 0,
  },
];

const render = () => renderToStaticMarkup(<POList />);

/** Visible text of a static render — tags stripped. */
const text = (html: string) => html.replace(/<[^>]*>/g, "");

/** The markup of the single <tr> that carries the given PO no (doc no -> end of row). */
const rowOf = (html: string, no: string): string => {
  const at = html.indexOf(no);
  expect(at).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<tr", at);
  const end = html.indexOf("</tr>", at);
  return html.slice(start, end);
};

/** How many em-dashes a chunk of markup renders. */
const dashes = (chunk: string): number => chunk.split(DASH).length - 1;

beforeEach(() => {
  h.po = { data: SERVED, isLoading: false };
});

describe("POList <-> GET /po paid column (B-278)", () => {
  it("renders the served `paid` figure in the row's paid cell", () => {
    expect(rowOf(render(), "PO-2026-0291")).toContain("317,000");
  });

  it("sizes the paid bar as paid/total, never as a printed money figure", () => {
    const row = rowOf(render(), "PO-2026-0291");
    expect(row).toContain("width:25%"); // 317,000 / 1,268,000
    expect(text(row)).not.toContain("25%"); // the ratio is geometry, not copy
  });

  it("prints the server's real 0 for a PO with no billings (never an em-dash guess)", () => {
    const row = rowOf(render(), "PO-2026-0290");
    expect(text(row)).toContain("0");
    expect(row).toContain("width:0%");
    // deposit + receive-goods only — the paid cell no longer contributes one.
    expect(dashes(row)).toBe(2);
  });

  it("leaves only the two genuinely-sourceless cells em-dashed on a paid row", () => {
    // deposit (needs a contracted rate `pos` has no column for) + receive-goods % (GET /gr).
    // Before the re-wire this row carried THREE.
    expect(dashes(rowOf(render(), "PO-2026-0291"))).toBe(2);
  });

  it("clamps the bar rather than overflowing when billings exceed the stored total", () => {
    h.po = { data: [{ ...SERVED[0], paid: 2000000 }], isLoading: false };
    const row = rowOf(render(), "PO-2026-0291");
    expect(row).toContain("width:100%");
    expect(row).toContain("2,000,000"); // the real over-billed figure is still shown
  });
});

describe("POList <-> GET /po document date (B-278)", () => {
  it("renders the selected PO's doc_date as an ISO/UTC calendar date", () => {
    // The detail panel opens on the first row of the active tab.
    expect(text(render())).toContain("2026-05-24");
  });

  it("follows the selection rather than pinning the first doc's date", () => {
    h.po = { data: [SERVED[1], SERVED[0]], isLoading: false };
    const shown = text(render());
    expect(shown).toContain("2026-05-25");
    expect(shown).not.toContain("2026-05-24");
  });

  it("em-dashes an unparseable doc_date instead of printing the raw wire string", () => {
    h.po = { data: [{ ...SERVED[0], doc_date: "not-a-date" }], isLoading: false };
    const html = render();
    expect(html).not.toContain("not-a-date");
  });

  it("mounts the loading skeleton instead of a table while the read is in flight", () => {
    h.po = { data: [], isLoading: true };
    const html = render();
    expect(html).not.toContain("<table");
    expect(html).not.toContain("317,000");
  });
});

/*
 * Money-honesty guards. These hold BOTH before and after the B-278 re-wire — they are stated
 * as negative invariants, not as evidence the wire works (see the revert probe in the slice
 * report). They fail only if a later change starts originating these figures in the browser.
 */
describe("POList originates no monetary total in the browser", () => {
  it("never prints total - paid as the PO remaining", () => {
    expect(text(render())).not.toContain("951,000");
  });

  it("never derives a down-payment percent from the paid deposit amount", () => {
    // 300,000 / 1,268,000 = 23.66% — an imputed contract term (B-279), never rendered.
    const shown = text(render());
    expect(shown).not.toContain("23.66");
    expect(shown).not.toContain("300,000");
  });

  it("never prints a payment-schedule milestone amount (amount x pct)", () => {
    const shown = text(render());
    expect(shown).not.toContain("634,000"); // 50% of the total
    expect(shown).not.toContain("380,400"); // the prototype mock's 30% deposit
  });
});

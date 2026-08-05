/*
 * BOMTemplates SCREEN-SEAM tests (P2-WEB-05, gate G3) — the component<->hook wiring, not the
 * pure aggregation (that is boq-bom-agg.test.ts).
 *
 * WHY THIS FILE EXISTS: the agg tests exercise functions that were already correct before the
 * GET /models/{id}/bom re-wire, so reverting the screen to `const lines: BomLine[] = []` left
 * all of them green while the screen silently re-emptied. These tests assert the seam instead:
 * that the screen CALLS useModelBom with the selected model's id, and that the payload the hook
 * returns actually reaches the rendered rows / KPIs / totals. Revert the wire and they go red.
 *
 * Harness: the repo's vitest env is `node` (no jsdom), so the screen is rendered DOM-free with
 * renderToStaticMarkup and its context/router-bound dependencies are vi.mock'd — the same style
 * as src/ui/chart.test.tsx and src/ui/icon.test.tsx (the only other component tests here). Page
 * is stubbed because it mounts TopBar, which needs a live TanStack Router. Translators return
 * ASCII stand-in templates carrying the real {placeholders}, so this .tsx stays ASCII-only and
 * the assertions read the interpolated VALUES rather than any Thai copy.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Em-dash — the screen's honest-unknown marker (boq-bom.tsx DASH). */
const DASH = "—";

/**
 * Mutable mock state, hoisted so the vi.mock factories below can close over it and each test
 * can re-point the served payload / loading flag before rendering.
 */
const h = vi.hoisted(() => ({
  /** What useModelBom returns (the served GET /models/{id}/bom rows + query flags). */
  bom: { data: [] as unknown[], isLoading: false },
  /** Every model id useModelBom was called with — the wiring probe. */
  calls: [] as (string | undefined)[],
  /** The GET /models row backing the rail (real toModelCard narrowing runs on it). */
  model: {
    id: "mdl-1",
    code: "B-1",
    type: "TypeB1",
    area: 120,
    bed: 3,
    bath: 2,
    parking: 1,
    price: 8_240_000,
    currency_code: "THB",
    status: "active",
    color: "#0F766E",
    unit_count: 40,
    bom_item_count: 3,
  } as Record<string, unknown>,
}));

/**
 * ASCII stand-ins for the boq.bom* templates, keeping the real {placeholder} names so fill()
 * still interpolates and the assertions can read the resulting values. Unlisted keys echo the
 * key itself (enough for labels/headings, which are not under test here).
 */
const TPL: Record<string, string> = {
  "boq.bomKpiItemsVer": "items={n} ver={ver}",
  "boq.bomCatGroupSummary": "n={n} value={value}",
  "boq.bomFootTotal": "foot {type}",
  "boq.bomInfoFormula": "total={total} units={units} grand={grand}",
  "boq.bomListHeader": "list {type} {code}",
  "boq.bomUpdatedAt": "updated={date}",
  "boq.bomModelMeta": "area={area} units={units}",
  "boq.bomEmptyTitle": "empty {type} {code}",
};

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (k: string) => TPL[k] ?? k,
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
  useShellCtx: () => ({ notify: () => {}, confirm: () => {} }),
}));

vi.mock("../master/use-models", () => ({
  useModelList: () => ({ data: [h.model] }),
}));

vi.mock("./use-model-bom", () => ({
  useModelBom: (modelId: string | undefined) => {
    h.calls.push(modelId);
    return h.bom;
  },
}));

import { BOMTemplates } from "./boq-bom";

/**
 * A served GET /models/{id}/bom payload (the boms.items element shape, ASCII text). Amounts:
 * M 30 x 2200 = 66,000 · S 1 x 480000 = 480,000 · L 120 x 700 = 84,000 -> total 630,000,
 * block value 630,000 x 40 units = 25,200,000, shares M 10% / S 76% / L 13%.
 */
const SERVED = [
  { cat: "M", code: "M-01", name: "ready mix concrete", detail: "grade 240", unit: "m3", qty: 30, price: 2200 },
  { cat: "S", code: "S-01", name: "roof subcontract", detail: "lump sum", unit: "lot", qty: 1, price: 480000 },
  { cat: "L", code: "L-01", name: "masonry labour", detail: "whole house", unit: "sqm", qty: 120, price: 700 },
];

/** The same payload plus one row the parser cannot categorise (cat "E") worth 10 x 5000. */
const SERVED_WITH_UNPARSEABLE = [
  ...SERVED,
  { cat: "E", code: "E-01", name: "site electrics", detail: "provisional", unit: "lot", qty: 10, price: 5000 },
];

const render = () => renderToStaticMarkup(<BOMTemplates />);

/**
 * Visible text of a static render — tags stripped. The info-formula bolds each number in its
 * own <b>, so "total={total} units={units} grand={grand}" is only contiguous once the markup
 * is removed.
 */
const text = (html: string) => html.replace(/<[^>]*>/g, "");

beforeEach(() => {
  h.calls.length = 0;
  h.bom = { data: [], isLoading: false };
  h.model.bom_item_count = 3;
});

describe("BOMTemplates <-> GET /models/{id}/bom wiring", () => {
  it("asks useModelBom for the selected model's id", () => {
    h.bom = { data: SERVED, isLoading: false };
    render();
    expect(h.calls).toContain("mdl-1");
  });

  it("does not fire the read for a model the server says has no BOM", () => {
    h.model.bom_item_count = 0;
    render();
    expect(h.calls.every((id) => id === undefined)).toBe(true);
  });

  it("renders the served lines as real table rows", () => {
    h.bom = { data: SERVED, isLoading: false };
    const html = render();
    // Codes + names off the wire.
    expect(html).toContain("M-01");
    expect(html).toContain("roof subcontract");
    expect(html).toContain("masonry labour");
    // Per-row qty / price / amount (formatMoney).
    expect(html).toContain("480,000"); // S price and its amount
    expect(html).toContain("66,000"); //  M amount = 30 x 2200
    expect(html).toContain("84,000"); //  L amount = 120 x 700
  });

  it("derives the KPIs, band subtotals, footer total and info-formula from that payload", () => {
    h.bom = { data: SERVED, isLoading: false };
    const html = render();
    expect(html).toContain("0.63"); //   cost-per-house KPI, millions2(630000)
    expect(html).toContain("76%"); //    subcon share
    expect(html).toContain("630,000"); // footer total + info-formula {total}
    expect(html).toContain("n=1 value=480,000"); // S band subtotal
    expect(text(html)).toContain("total=630,000 units=40 grand=25,200,000");
  });

  it("renders the loading skeleton instead of a flash of em-dashes while the read is in flight", () => {
    h.bom = { data: [], isLoading: true };
    const html = render();
    // The BOM card is not mounted yet — no table, no footer row.
    expect(html).not.toContain("<table");
    expect(html).not.toContain("foot TypeB1");
  });

  it("em-dashes every total for an empty served payload (never a fabricated 0)", () => {
    h.bom = { data: [], isLoading: false };
    const html = render();
    expect(text(html)).toContain(`total=${DASH} units=40 grand=${DASH}`);
    // Text only — "0.00" also occurs inside style attributes (letter-spacing:-0.005em).
    expect(text(html)).not.toContain("0.00");
  });
});

/*
 * B-272 — `boms.items` is unconstrained jsonb, so a served row can carry a `cat` outside
 * M/S/L. parseBomPayload reports the drop and the screen must NOT publish a sum that quietly
 * excludes that row's qty x price while the item-count KPI (bom_item_count, unfiltered) still
 * counts it. Every cross-line figure em-dashes; per-row figures are unaffected; no category is
 * invented for the row that has none.
 */
describe("BOMTemplates money honesty when a served row cannot be categorised (B-272)", () => {
  beforeEach(() => {
    h.bom = { data: SERVED_WITH_UNPARSEABLE, isLoading: false };
    h.model.bom_item_count = 4; // the server counts all 4 served rows
  });

  it("never prints the understated total (nor an invented complete one)", () => {
    // Text only — numeric substrings also occur inside style/path attributes.
    const shown = text(render());
    expect(shown).not.toContain("630,000"); // the short sum (excludes the dropped 50,000)
    expect(shown).not.toContain("0.63"); //    its millions form
    expect(shown).not.toContain("680,000"); // and nothing fabricates the whole
    expect(shown).not.toContain("27,200,000");
  });

  it("em-dashes the cost-per-house KPI, the footer total and the info-formula", () => {
    const html = render();
    expect(text(html)).toContain(`total=${DASH} units=40 grand=${DASH}`);
    // Item-count KPI keeps the server's honest, unfiltered count next to the em-dashed cost.
    expect(html).toContain(`items=4 ver=${DASH}`);
  });

  it("em-dashes the per-category shares and the band subtotals", () => {
    const html = render();
    expect(text(html)).not.toContain("76%");
    expect(html).toContain(`n=1 value=${DASH}`);
  });

  it("still renders the readable rows and their own per-line amounts", () => {
    const html = render();
    expect(html).toContain("M-01");
    expect(html).toContain("66,000"); // per-line amount is unaffected by the drop
    expect(html).toContain("480,000");
  });

  it("invents no category for the unreadable row", () => {
    const html = render();
    expect(html).not.toContain("E-01");
    expect(html).not.toContain("site electrics");
  });
});

/*
 * Unit tests for gr-rows.ts (P2-WEB-11, gate G3) — the pure GR-list helpers that
 * back GRList. Covers the opaque-row narrowing (gr + po/wo), the tab partition +
 * C10 counts, the status tone/label mapping (received/returned/cancelled), the
 * ref-number resolution, the free-text filter, the open-anchor gate, money
 * formatting, and the POST /gr line composition.
 */
import { describe, it, expect } from "vitest";
import {
  toGrRow,
  toAnchorDoc,
  filterByTab,
  tabCount,
  countByStatus,
  refKind,
  refNoMap,
  resolveRefNo,
  statusTone,
  statusLabelKind,
  filterByQuery,
  openAnchors,
  formatMoney,
  buildLines,
  hasLineDetail,
  receivedPct,
  lineTotals,
  isItemMeasured,
  allLinesMeasured,
  receivedOrdered,
  cappedReceived,
  rowReceivedPct,
  isFullyMeasured,
  isComplete,
  isItemShort,
  itemShortfall,
  itemMeasure,
  grItemDisplay,
  grRowDisplay,
  itemsLabel,
  formatDate,
  type GrRow,
  type GrItem,
} from "./gr-rows";

const row = (over: Partial<GrRow> = {}): GrRow => ({
  id: "g1",
  no: "GR-2026-0001",
  poId: "",
  woId: "",
  status: "received",
  received: 0,
  rejected: 0,
  photos: [],
  vendor: "",
  date: "",
  orderedQty: 0,
  money: 0,
  currencyCode: "THB",
  items: [],
  ...over,
});

const item = (over: Partial<GrItem> = {}): GrItem => ({
  id: "gi1",
  name: "line one",
  orderedQty: 0,
  receivedQty: 0,
  unit: "",
  price: 0,
  currencyCode: "THB",
  ...over,
});

describe("toGrRow", () => {
  it("narrows the grWire shape (snake_case po_id/wo_id, numeric received/rejected)", () => {
    expect(
      toGrRow({
        id: "g9",
        no: "GR-2026-0148",
        po_id: "po-1",
        wo_id: null,
        status: "received",
        received: 320,
        rejected: 4,
        photos: ["a.jpg", 5, "b.jpg"],
      }),
    ).toEqual({
      id: "g9",
      no: "GR-2026-0148",
      poId: "po-1",
      woId: "",
      status: "received",
      received: 320,
      rejected: 4,
      photos: ["a.jpg", "b.jpg"],
      vendor: "",
      date: "",
      orderedQty: 0,
      money: 0,
      currencyCode: "",
      items: [],
    });
  });

  it("coerces string numbers and defaults missing fields", () => {
    const r = toGrRow({ id: "g2", received: "120" });
    expect(r.received).toBe(120);
    expect(r.rejected).toBe(0);
    expect(r.status).toBe("");
    expect(r.photos).toEqual([]);
  });

  // B-078 / F1 re-wire: the fields the screen used to em-dash are real now.
  it("narrows the data-completeness fields (vendor/date/ordered_qty/money/items)", () => {
    const r = toGrRow({
      id: "g0",
      no: "GR-2026-0148",
      po_id: "po-1",
      wo_id: null,
      status: "received",
      received: 90,
      rejected: 0,
      photos: [],
      vendor: "TOA Paint",
      date: "2026-05-24T14:20:00.000Z",
      ordered_qty: 100,
      money: 27000,
      currency_code: "THB",
      items: [
        {
          id: "gi0",
          name: "cement",
          boq_item_id: null,
          ordered_qty: 100,
          received_qty: 90,
          unit: "bag",
          price: 300,
          currency_code: "THB",
        },
      ],
    });
    expect(r.vendor).toBe("TOA Paint");
    expect(r.date).toBe("2026-05-24T14:20:00.000Z");
    expect(r.orderedQty).toBe(100);
    expect(r.money).toBe(27000);
    expect(r.currencyCode).toBe("THB");
    expect(r.items).toEqual([
      {
        id: "gi0",
        name: "cement",
        orderedQty: 100,
        receivedQty: 90,
        unit: "bag",
        price: 300,
        currencyCode: "THB",
      },
    ]);
  });

  it("keeps a null vendor as '' and a non-array items as [] (never fabricated)", () => {
    const r = toGrRow({ id: "g3", vendor: null, items: null });
    expect(r.vendor).toBe("");
    expect(r.items).toEqual([]);
  });
});

describe("hasLineDetail", () => {
  it("is false with no gr_item lines — the server's 0 money/ordered means unknown", () => {
    expect(hasLineDetail(row({ money: 0, orderedQty: 0 }))).toBe(false);
  });
  it("is true once the receipt carries lines", () => {
    expect(hasLineDetail(row({ items: [item()] }))).toBe(true);
  });
});

describe("receivedPct", () => {
  it("computes the completion percent against the ordered quantity", () => {
    expect(receivedPct(120, 240)).toBe(50);
    expect(receivedPct(320, 320)).toBe(100);
  });
  it("returns null when there is no ordered qty to measure (lump-sum WO)", () => {
    expect(receivedPct(92, 0)).toBeNull();
    expect(receivedPct(92, -5)).toBeNull();
  });
  it("clamps an over-receipt to 100 rather than overflowing the bar", () => {
    expect(receivedPct(400, 320)).toBe(100);
  });
});

/*
 * MIXED-POPULATION REGRESSION (every number the screen prints: the received/ordered
 * cell, the bar, the value column, the complete badge and the per-line labels).
 * The wire carries TWO populations:
 *   HEADER — `received` / `rejected`: Σ over ALL posted lines, named AND bare
 *            (apps/api/src/routes/gr.ts:174)
 *   LINE   — `items[]`, and the header-shaped figures derived from it: `ordered_qty`
 *            (gr.ts:168) and `money` (gr.ts:164-167). A bare qty-only line never
 *            becomes a gr_item (the create's `if (name)`), so LINE ⊂ HEADER.
 * A superset compared with, divided by, or printed beside a subset overstates the
 * receipt. Everything below pins ONE population per number — including INSIDE
 * items[], where a line carrying an explicit ordered_qty 0 makes Σ line received a
 * superset of the lines Σ line ordered covers.
 */

/**
 * (a) The DEFAULT SEED shape (packages/db/src/seed/index.ts:539 GR_RECEIVED[0]=320,
 * :548-552 GR_ITEM_LINES attached to EVERY seeded GR at :1304-1313):
 * header total 320, three named lines ordered 480+240+240 = 960 and received
 * 480+240+120 = 840. The old pairing rendered 320 / 960 with a 33% bar while the
 * detail panel two panes over listed 840 of 960 — the list contradicted itself.
 * (Line names are the seed's; ASCII placeholders here, the assertions are numeric.)
 */
const seedGr = (): GrRow =>
  row({
    id: "gr:0",
    no: "GR-2026-0148",
    poId: "po:0",
    status: "received",
    received: 320,
    orderedQty: 960,
    // The server's Σ(received_qty × price) over the same 3 lines, at the seeded BOQ
    // unit prices (packages/db/src/seed/index.ts BOQ_ITEMS 3/4/5 = 168.5 / 142 / 425):
    // 480×168.5 + 240×142 + 120×425 = 165,960.
    money: 165960,
    items: [
      item({ id: "gritem:0:0", name: "cement", orderedQty: 480, receivedQty: 480, unit: "bag", price: 168.5 }),
      item({ id: "gritem:0:1", name: "mortar", orderedQty: 240, receivedQty: 240, unit: "bag", price: 142 }),
      item({ id: "gritem:0:2", name: "rebar", orderedQty: 240, receivedQty: 120, unit: "length", price: 425 }),
    ],
  });

/**
 * (b) The API's OWN create fixture (apps/api/src/routes/gr.test.ts:446-449): one
 * NAMED line { qty_ok: 90, ordered_qty: 100 } + one BARE line { qty_ok: 10 }. The
 * header total is 90 + 10 = 100 and only the named line becomes a gr_item, so the
 * old pairing read 100 / 100 — a full green bar and a complete badge on a receipt
 * whose only measured line short-received 10.
 */
const mixedGr = (): GrRow =>
  row({
    id: "gr:mixed",
    no: "GR-2026-0151",
    poId: "po:0",
    received: 100,
    orderedQty: 100,
    money: 27000, // 90 × 300 — the NAMED line only; the bare 10 has no price anywhere
    items: [
      item({ id: "gi-named", name: "cement", orderedQty: 100, receivedQty: 90, unit: "bag", price: 300 }),
    ],
  });

/**
 * (d) The same superset-vs-subset trap INSIDE items[], one level down. Both lines
 * are NAMED, so both are gr_items; the second states an explicit ordered_qty of 0.
 * Contract-legal: openapi.yaml (~L1607-1626) requires neither `name` nor
 * `ordered_qty`, and gr.ts:451 `toNum(...) ?? qtyOk` defaults only when the field is
 * ABSENT — an explicit 0 persists. Σ line received (100) then covers both lines while
 * Σ line ordered (100) covers only the first, so the cell read "100 / 100" with a
 * 100% green bar on a receipt whose only measured line short-received 10, and the
 * second line was labelled gr.list.fullyReceived above its own "10 / —" cell.
 */
const partlyMeasuredGr = (): GrRow =>
  row({
    id: "gr:partly",
    no: "GR-2026-0152",
    poId: "po:0",
    received: 100,
    orderedQty: 100,
    money: 30000, // (90 + 10) × 300 — both lines are priced gr_items
    items: [
      item({ id: "gi-cement", name: "cement", orderedQty: 100, receivedQty: 90, unit: "bag", price: 300 }),
      item({ id: "gi-sand", name: "sand", orderedQty: 0, receivedQty: 10, unit: "bag", price: 300 }),
    ],
  });

/**
 * (e) B-276 — the MASKING shape: every measurement gate passes and the receipt is
 * still not complete. Line A over-received 100 beyond its own order of 100; line B
 * received NOTHING of its own 100. Header 200 == Σ line received 200 (isFullyMeasured
 * check 3) and BOTH lines state an ordered quantity (check 2), so the shape clears
 * both gates the earlier rounds added — only a PER-LINE test can see it. Contract-legal
 * for the same reason as (d): openapi.yaml requires no line field and gr.ts rejects
 * only negatives, so an explicit `qty_ok: 0` persists. Before the fix the row read
 * "200 / 200", a 100% green bar and the complete badge, while the detail panel two
 * panes over printed line B as "0 / 100 · short — missing 100".
 */
const maskingGr = (): GrRow =>
  row({
    id: "gr:masking",
    no: "GR-2026-0153",
    poId: "po:0",
    received: 200,
    orderedQty: 200,
    money: 60000, // Σ(received × price) over both lines = 200 × 300
    items: [
      item({ id: "gi-steel", name: "steel", orderedQty: 100, receivedQty: 200, unit: "ton", price: 300 }),
      item({ id: "gi-cement", name: "cement", orderedQty: 100, receivedQty: 0, unit: "bag", price: 300 }),
    ],
  });

/**
 * (e') The ratio-only variant of the same class: no line sits at 0, so the shortfall
 * is subtler, but A's 50 surplus still pads Σ over B's 50 gap (Σ 200/200 = 100%). The
 * Math.min(100, …) inside receivedPct cannot help — it clamps AFTER summing, hiding
 * the padding rather than catching it.
 */
const paddedGr = (): GrRow =>
  row({
    id: "gr:padded",
    no: "GR-2026-0154",
    poId: "po:0",
    received: 200,
    orderedQty: 200,
    money: 60000,
    items: [
      item({ id: "gi-steel", name: "steel", orderedQty: 100, receivedQty: 150, unit: "ton", price: 300 }),
      item({ id: "gi-cement", name: "cement", orderedQty: 100, receivedQty: 50, unit: "bag", price: 300 }),
    ],
  });

describe("lineTotals", () => {
  it("sums the NAMED lines only — the one population that may be compared", () => {
    expect(lineTotals(seedGr().items)).toEqual({ received: 840, ordered: 960 });
    expect(lineTotals([])).toEqual({ received: 0, ordered: 0 });
  });
});

describe("receivedOrdered + rowReceivedPct", () => {
  // (a) seed shape
  it("(a) seed row: both halves come from items[], never the header total", () => {
    const r = seedGr();
    expect(receivedOrdered(r)).toEqual({ received: 840, ordered: 960 });
    expect(rowReceivedPct(r)).toBe(88); // 840/960 = 87.5%, NOT the old 320/960 = 33%
  });

  it("(a) seed row: the list cell agrees with the detail panel beside it", () => {
    const r = seedGr();
    // What the detail panel renders, line by line (gr-list.tsx received-items list).
    const panel = r.items.reduce(
      (acc, it) => ({ received: acc.received + it.receivedQty, ordered: acc.ordered + it.orderedQty }),
      { received: 0, ordered: 0 },
    );
    expect(receivedOrdered(r)).toEqual({ received: panel.received, ordered: panel.ordered });
  });

  // (b) api fixture shape
  it("(b) mixed named+bare receipt: the bare quantity never enters the ratio", () => {
    const r = mixedGr();
    expect(receivedOrdered(r)).toEqual({ received: 90, ordered: 100 });
    expect(rowReceivedPct(r)).toBe(90); // the old pairing said 100/100 = 100%
  });

  // (c) no line detail at all — the fallback path
  it("(c) no line detail: the header total stands alone and NO header-shaped field enters the cell", () => {
    // ordered_qty 240 with items [] is not a shape grWire can emit (gr.ts:168 derives
    // it FROM items), and it is planted for exactly that reason: the assertion fails
    // the moment `row.orderedQty` is read for the cell again. The reachable line-less
    // shape (the server's honest 0/0) is pinned in the next case.
    const r = row({ received: 92, orderedQty: 240, money: 5000, items: [] });
    expect(hasLineDetail(r)).toBe(false);
    expect(receivedOrdered(r)).toEqual({ received: 92, ordered: null });
    expect(rowReceivedPct(r)).toBeNull(); // no bar rather than a fabricated 0/100%
  });

  it("(c) the reachable line-less shape: the server's 0s are 'not recorded', never printed", () => {
    const r = row({ received: 92, orderedQty: 0, money: 0, items: [] });
    expect(receivedOrdered(r)).toEqual({ received: 92, ordered: null });
    expect(grRowDisplay(r).money).toBeNull(); // NOT "0" — that would read as zero baht
  });

  it("(d) a named line that states no ordered quantity leaves nothing to measure against", () => {
    // Reachable: POST /gr lines [{name:"sand", qty_ok:50, ordered_qty:0}, {qty_ok:10}]
    // -> header 60, one gr_item of 50 against an unstated order. The received half is
    // the LINE total (50), never the header's 60.
    const r = row({ received: 60, items: [item({ orderedQty: 0, receivedQty: 50 })] });
    expect(allLinesMeasured(r.items)).toBe(false);
    expect(receivedOrdered(r)).toEqual({ received: 50, ordered: null });
    expect(rowReceivedPct(r)).toBeNull();
  });

  // (d) the missing combination: measured AND unmeasured lines on one receipt.
  it("(d) mixed ordered>0 + ordered==0 lines: Σ received is a superset of what Σ ordered covers -> no ratio", () => {
    const r = partlyMeasuredGr();
    // The two sums LOOK comparable and are not: 100 received spans both lines,
    // 100 ordered spans only the first.
    expect(lineTotals(r.items)).toEqual({ received: 100, ordered: 100 });
    expect(allLinesMeasured(r.items)).toBe(false);
    expect(receivedOrdered(r)).toEqual({ received: 100, ordered: null });
    expect(rowReceivedPct(r)).toBeNull(); // was 100 — a full green bar
  });
});

describe("isItemMeasured + allLinesMeasured", () => {
  it("a line is measured only when it states its own ordered quantity", () => {
    expect(isItemMeasured(item({ orderedQty: 100, receivedQty: 90 }))).toBe(true);
    expect(isItemMeasured(item({ orderedQty: 0, receivedQty: 10 }))).toBe(false);
  });
  it("all-measured requires EVERY line — and at least one", () => {
    expect(allLinesMeasured(seedGr().items)).toBe(true);
    expect(allLinesMeasured(partlyMeasuredGr().items)).toBe(false);
    expect(allLinesMeasured([])).toBe(false);
  });
});

describe("isFullyMeasured", () => {
  it("is false without line detail (a bare receipt states no ordered quantity)", () => {
    expect(isFullyMeasured(row({ received: 92 }))).toBe(false);
  });
  it("is false when any line carries no independent ordered quantity", () => {
    expect(
      isFullyMeasured(
        row({
          received: 150,
          items: [
            item({ id: "a", orderedQty: 100, receivedQty: 100 }),
            item({ id: "b", orderedQty: 0, receivedQty: 50 }),
          ],
        }),
      ),
    ).toBe(false);
  });
  it("is false when the header total hides unmeasured (bare-line) quantity", () => {
    expect(isFullyMeasured(mixedGr())).toBe(false);
    expect(isFullyMeasured(seedGr())).toBe(false); // header 320 vs line total 840
  });
  it("(d) is false when a NAMED line states no ordered quantity, even though the totals tie", () => {
    // header 100 == line total 100, so check (3) passes; check (2) is what saves it.
    expect(isFullyMeasured(partlyMeasuredGr())).toBe(false);
  });
  it("is true when every quantity on the receipt is measured", () => {
    expect(
      isFullyMeasured(
        row({
          received: 480,
          items: [
            item({ id: "a", orderedQty: 240, receivedQty: 240 }),
            item({ id: "b", orderedQty: 240, receivedQty: 240 }),
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe("isComplete", () => {
  it("is true only when every measured line met its own ordered quantity", () => {
    expect(
      isComplete(
        row({
          received: 320,
          items: [item({ orderedQty: 320, receivedQty: 320 })],
        }),
      ),
    ).toBe(true);
    expect(
      isComplete(
        row({
          received: 120,
          items: [item({ orderedQty: 240, receivedQty: 120 })],
        }),
      ),
    ).toBe(false);
  });

  it("is never complete without an ordered qty (an unmeasured order never closes)", () => {
    expect(isComplete(row({ received: 92, orderedQty: 0 }))).toBe(false);
    expect(isComplete(row({ received: 50, items: [item({ orderedQty: 0, receivedQty: 50 })] }))).toBe(
      false,
    );
  });

  // (b) the finding: a short-received receipt badged complete off the header total.
  it("(b) mixed named+bare receipt is NOT complete — its measured line short-received", () => {
    const r = mixedGr();
    expect(isComplete(r)).toBe(false); // the old rule said 100 >= 100 -> complete
    expect(isItemShort(r.items[0])).toBe(true);
    expect(itemShortfall(r.items[0])).toBe(10);
  });

  it("a fully-received named line + a bare line is still NOT complete (unmeasured qty)", () => {
    // Header 110 = the named line's 100 + a bare 10 that no ordered qty measures:
    // part of the receipt is undescribed, so completeness cannot be claimed.
    expect(
      isComplete(row({ received: 110, orderedQty: 100, items: [item({ orderedQty: 100, receivedQty: 100 })] })),
    ).toBe(false);
  });

  // (d) the finding: a receipt badged complete because the unmeasured line's received
  // quantity padded Σ received up to Σ ordered.
  it("(d) partly-measured receipt is NOT complete — one line short, one unmeasurable", () => {
    const r = partlyMeasuredGr();
    expect(isComplete(r)).toBe(false); // the old rule said 100 >= 100 -> complete
    expect(isItemShort(r.items[0])).toBe(true);
    expect(itemShortfall(r.items[0])).toBe(10);
  });

  // (a) the seed rows: short on one line, and header/line totals disagree.
  it("(a) seed row is NOT complete and matches its own short detail line", () => {
    const r = seedGr();
    expect(isComplete(r)).toBe(false);
    expect(isItemShort(r.items[2])).toBe(true);
    expect(itemShortfall(r.items[2])).toBe(120);
  });

  // KEPT DELIBERATELY (B-276 review): EVERY line here met its own order and then some
  // (250 of 240, twice), so "complete" is the honest reading — an over-receipt is not
  // an incomplete one. This case must stay green, otherwise the per-line rule would
  // have been over-tightened into "no line may exceed its order". The next test is its
  // twin: the same Σ arithmetic, but the surplus sits on a DIFFERENT line from the
  // shortfall. The pair is what separates "over-received" from "masked".
  it("an over-receipt still counts as complete (clamped bar, badge shown)", () => {
    const r = row({ received: 500, items: [item({ orderedQty: 240, receivedQty: 250 }), item({ id: "b", orderedQty: 240, receivedQty: 250 })] });
    expect(isComplete(r)).toBe(true);
    expect(rowReceivedPct(r)).toBe(100);
  });

  // (e) the finding: the surplus and the shortfall are on DIFFERENT lines, so Σ ties
  // while one line got nothing. Twin of the test above — same Σ, opposite verdict.
  it("(e) an over-receipt that only PADS Σ over another line's shortfall is NOT complete", () => {
    const r = maskingGr();
    expect(isComplete(r)).toBe(false); // the Σ rule said 200 >= 200 -> complete
    expect(isItemShort(r.items[1])).toBe(true);
    expect(itemShortfall(r.items[1])).toBe(100);
  });

  it("tolerates float noise on fractional quantities (numeric(_,3) read as floats)", () => {
    const r = row({
      received: 0.3,
      items: [item({ id: "a", orderedQty: 0.1, receivedQty: 0.1 }), item({ id: "b", orderedQty: 0.2, receivedQty: 0.2 })],
    });
    expect(isFullyMeasured(r)).toBe(true);
    expect(isComplete(r)).toBe(true);
  });
});

/*
 * (e) B-276 — one line's over-receipt masking another line's shortfall. The class the
 * earlier rounds did not reach: BOTH measurement gates pass, so the payload is fully
 * described; what fails is the ASSERTION formed from it. Σ received >= Σ ordered does
 * not imply every line met its own, and the badge/bar claimed exactly that.
 */
describe("(e) cross-line masking: a surplus on one line may not fill another line's gap", () => {
  it("clears BOTH measurement gates and its Σ ties — which is why a Σ-only rule could not see it", () => {
    const r = maskingGr();
    expect(allLinesMeasured(r.items)).toBe(true); // gate 2: every line states its order
    expect(isFullyMeasured(r)).toBe(true); // gate 3: header 200 == Σ line received 200
    expect(lineTotals(r.items)).toEqual({ received: 200, ordered: 200 }); // the tie
  });

  it("the badge is withheld — line B received nothing of the 100 it ordered", () => {
    const r = maskingGr();
    expect(isComplete(r)).toBe(false);
    expect(grRowDisplay(r).complete).toBe(false);
    // The contradiction the badge used to produce: the detail panel two panes over
    // prints this same line as short, with a 100 shortfall.
    const line = grItemDisplay(r.items[1]);
    expect(line.measure).toBe("short");
    expect(line.shortfall).toBe("100");
    expect(line.short).toBe(true);
  });

  it("the bar reads 50%, not 100% — each line is capped at its OWN order before summing", () => {
    const r = maskingGr();
    expect(cappedReceived(r.items)).toBe(100); // min(200,100) + min(0,100)
    expect(rowReceivedPct(r)).toBe(50); // Σ-then-clamp said 200/200 -> 100
    expect(grRowDisplay(r).pct).toBe(50);
  });

  it("the CELL text stays the honest Σ — only the bar is capped", () => {
    const r = maskingGr();
    // 200 really was received and 200 really was ordered; capping the numerator is a
    // statement about progress, not about what happened. The cell must not be rewritten
    // to "100 / 200" — that number appears nowhere on the receipt.
    expect(receivedOrdered(r)).toEqual({ received: 200, ordered: 200 });
    const d = grRowDisplay(r);
    expect(d.received).toBe("200");
    expect(d.ordered).toBe("200");
  });

  it("(e') ratio-only variant (150 of 100 + 50 of 100): the badge is withheld — B is half short", () => {
    const r = paddedGr();
    expect(isFullyMeasured(r)).toBe(true);
    expect(isComplete(r)).toBe(false); // the Σ rule said 200 >= 200 -> complete
    expect(isItemShort(r.items[1])).toBe(true);
    expect(itemShortfall(r.items[1])).toBe(50);
  });

  it("(e') ratio-only variant: 75% — A's surplus 50 no longer fills B's gap of 50", () => {
    const r = paddedGr();
    expect(cappedReceived(r.items)).toBe(150); // min(150,100)=100 + min(50,100)=50
    expect(rowReceivedPct(r)).toBe(75); // Σ-then-clamp said 200/200 -> 100
    expect(grRowDisplay(r).pct).toBe(75);
  });

  it("an UNMEASURED line in the same shape still withholds everything (no ratio, no bar, no badge)", () => {
    // Distinguishes the two silences: "0 received of 100 ordered" is a SHORT line (a
    // 50% bar above), whereas "0 ordered" states nothing and must em-dash instead of
    // rendering a confident 0%.
    const r = row({
      received: 200,
      items: [
        item({ id: "a", orderedQty: 100, receivedQty: 200 }),
        item({ id: "b", orderedQty: 0, receivedQty: 0 }),
      ],
    });
    expect(allLinesMeasured(r.items)).toBe(false);
    expect(receivedOrdered(r).ordered).toBeNull();
    expect(rowReceivedPct(r)).toBeNull();
    expect(isComplete(r)).toBe(false);
    const d = grRowDisplay(r);
    expect(d.ordered).toBeNull(); // the view em-dashes this half
    expect(d.pct).toBeNull(); // and draws NO bar
    expect(d.complete).toBe(false);
  });
});

describe("isItemShort + itemShortfall", () => {
  it("flags a short line and reports the missing quantity", () => {
    const it = item({ orderedQty: 240, receivedQty: 120 });
    expect(isItemShort(it)).toBe(true);
    expect(itemShortfall(it)).toBe(120);
  });
  it("a fully received line is not short (shortfall 0)", () => {
    const it = item({ orderedQty: 480, receivedQty: 480 });
    expect(isItemShort(it)).toBe(false);
    expect(itemShortfall(it)).toBe(0);
  });
  it("an un-quantified line is not short (no ordered qty to fall short of)", () => {
    expect(isItemShort(item({ orderedQty: 0, receivedQty: 50 }))).toBe(false);
  });
});

describe("itemMeasure + grItemDisplay", () => {
  it("measured + met -> the fully-received label; measured + missed -> the shortfall label", () => {
    expect(itemMeasure(item({ orderedQty: 480, receivedQty: 480 }))).toBe("full");
    const short = item({ orderedQty: 240, receivedQty: 120 });
    expect(itemMeasure(short)).toBe("short");
    expect(grItemDisplay(short)).toEqual({
      received: "120",
      ordered: "240",
      measure: "short",
      shortfall: "120",
      short: true,
    });
  });

  it("(d) an unmeasured line asserts NOTHING — no label, no ordered half, not 'short'", () => {
    const unmeasured = item({ orderedQty: 0, receivedQty: 10 });
    expect(isItemShort(unmeasured)).toBe(false); // nothing to fall short of...
    expect(itemMeasure(unmeasured)).toBe("unmeasured"); // ...which is NOT "fully received"
    expect(grItemDisplay(unmeasured)).toEqual({
      received: "10",
      ordered: null, // the view em-dashes: "10 / —"
      measure: "unmeasured",
      shortfall: "0",
      short: false,
    });
  });

  it("(d) the partly-measured receipt's two lines are labelled differently", () => {
    const [measured, unmeasured] = partlyMeasuredGr().items;
    expect(itemMeasure(measured)).toBe("short");
    expect(itemMeasure(unmeasured)).toBe("unmeasured");
  });

  it("float noise never invents a shortfall (numeric(_,3) quantities read as floats)", () => {
    const noisy = item({ orderedQty: 0.1 + 0.2, receivedQty: 0.3 }); // 0.30000000000000004 vs 0.3
    expect(isItemShort(noisy)).toBe(false);
    expect(itemMeasure(noisy)).toBe("full");
  });

  it("a shortfall too small to print withholds the label rather than claim a shortfall of 0", () => {
    const tiny = item({ orderedQty: 100.1, receivedQty: 99.7 });
    expect(isItemShort(tiny)).toBe(true); // it IS short — the warn tint stays
    expect(grItemDisplay(tiny).shortfall).toBe("0"); // ...but "missing 0" is a false number
    expect(itemMeasure(tiny)).toBe("unmeasured"); // so the wording is withheld
  });
});

/*
 * grRowDisplay is what the SCREEN prints — every quantity, the value, the bar and the
 * badge, in the receipts tab, the returns tab and the detail panel. Its invariant:
 * with line detail every figure is a LINE figure; without it the header total stands
 * alone and the value column is withheld. apps/web has no DOM/component test
 * environment (vitest runs in node, no jsdom), so these pin the model the view reads,
 * not the JSX; the view is held to it structurally instead — it imports no
 * raw-number helper and reads no wire field directly.
 */
describe("grRowDisplay — one population per number", () => {
  it("(a) seed row: every figure comes from items[]", () => {
    expect(grRowDisplay(seedGr())).toEqual({
      received: "840", // NOT the header's 320
      ordered: "960",
      pct: 88,
      money: "165,960",
      complete: false,
      rejected: null,
      hasLines: true,
    });
  });

  it("(a) seed row: the qty column and the value column describe the same units", () => {
    const r = seedGr();
    const qty = Number(grRowDisplay(r).received.replace(/,/g, ""));
    const prices = r.items.map((it) => it.price);
    const implied = r.money / qty; // 165,960 / 840 = 197.57
    expect(implied).toBeGreaterThanOrEqual(Math.min(...prices));
    expect(implied).toBeLessThanOrEqual(Math.max(...prices));
    // The header total would imply 518.6/unit — above EVERY price on the receipt.
    expect(r.money / r.received).toBeGreaterThan(Math.max(...prices));
  });

  it("(a) seed row: the returns tab reports what the receipts tab reported", () => {
    // POST /gr/{id}/return only flips the status (gr.ts:652-658) — the quantities and
    // the lines are untouched, so one click must not change any number on the screen.
    const receipts = grRowDisplay(seedGr());
    const returned = grRowDisplay({ ...seedGr(), status: "returned" });
    expect(returned.received).toBe(receipts.received);
    expect(returned.money).toBe(receipts.money);
    expect(returned.received).not.toBe(formatMoney(seedGr().received)); // never "320"
  });

  it("(b) mixed named+bare receipt: the bare quantity enters nothing, the badge is withheld", () => {
    expect(grRowDisplay(mixedGr())).toEqual({
      received: "90",
      ordered: "100",
      pct: 90,
      money: "27,000",
      complete: false,
      rejected: null,
      hasLines: true,
    });
  });

  it("(c) no line detail: the header total stands alone and the value column em-dashes", () => {
    expect(grRowDisplay(row({ received: 92, orderedQty: 240, money: 5000, items: [] }))).toEqual({
      received: "92",
      ordered: null,
      pct: null,
      money: null, // never printed beside a quantity it does not describe
      complete: false,
      rejected: null,
      hasLines: false,
    });
  });

  it("(d) partly-measured receipt: no ratio, no bar, no badge — the value still stands", () => {
    expect(grRowDisplay(partlyMeasuredGr())).toEqual({
      received: "100",
      ordered: null, // was "100" -> a 100% green bar on a short receipt
      pct: null,
      money: "30,000", // Σ over the same lines the 100 came from — one population
      complete: false,
      rejected: null,
      hasLines: true,
    });
  });

  it("a client-summed quantity never reaches the screen as a raw float", () => {
    const r = row({
      received: 2000.3,
      items: [
        item({ id: "a", orderedQty: 1000.1, receivedQty: 1000.1 }),
        item({ id: "b", orderedQty: 1000.2, receivedQty: 1000.2 }),
      ],
    });
    expect(lineTotals(r.items).received).not.toBe(2000.3); // 2000.3000000000002
    const d = grRowDisplay(r);
    expect(d.received).toBe("2,000"); // grouped + rounded, the repo's quantity precedent
    expect(d.ordered).toBe("2,000");
  });

  it("rejected is the receipt total and is omitted (null) when nothing was rejected", () => {
    expect(grRowDisplay(row({ received: 92, rejected: 4 })).rejected).toBe("4");
    expect(grRowDisplay(row({ received: 92, rejected: 0 })).rejected).toBeNull();
  });
});

describe("itemsLabel", () => {
  it("joins the line names with the standard ' · ' separator", () => {
    expect(itemsLabel([item({ name: "cement" }), item({ id: "gi2", name: "mortar" })])).toBe(
      "cement · mortar",
    );
  });
  it("drops blank names and returns '' for no lines (caller em-dashes)", () => {
    expect(itemsLabel([item({ name: "  " })])).toBe("");
    expect(itemsLabel([])).toBe("");
  });
});

describe("formatDate", () => {
  it("renders an ISO timestamp as a deterministic UTC YYYY-MM-DD", () => {
    expect(formatDate("2026-05-24T14:20:00.000Z")).toBe("2026-05-24");
  });
  it("returns '' for a missing/invalid timestamp", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate("not-a-date")).toBe("");
  });
});

describe("toAnchorDoc", () => {
  it("narrows a /po row (amount falls back to total)", () => {
    expect(toAnchorDoc({ id: "po-1", no: "PO-2026-0290", status: "approved", total: 902475 })).toEqual({
      id: "po-1",
      no: "PO-2026-0290",
      status: "approved",
      amount: 902475,
    });
  });

  it("narrows a /wo row (amount falls back to value)", () => {
    expect(toAnchorDoc({ id: "wo-1", no: "WO-2026-0117", status: "approved", value: 537500 }).amount).toBe(537500);
  });
});

describe("filterByTab + tabCount", () => {
  const rows: GrRow[] = [
    row({ id: "a", poId: "po1", status: "received" }),
    row({ id: "b", woId: "wo1", status: "received" }),
    row({ id: "c", poId: "po2", status: "returned" }),
    row({ id: "d", woId: "wo2", status: "cancelled" }),
    row({ id: "e", poId: "po3", status: "received" }),
  ];

  it("po tab = open PO receipts only", () => {
    expect(filterByTab(rows, "po").map((r) => r.id)).toEqual(["a", "e"]);
  });
  it("wo tab = open WO receipts only", () => {
    expect(filterByTab(rows, "wo").map((r) => r.id)).toEqual(["b"]);
  });
  it("other tab = no-anchor rows (empty on this wire)", () => {
    expect(filterByTab(rows, "other")).toEqual([]);
  });
  it("return tab = returned status", () => {
    expect(filterByTab(rows, "return").map((r) => r.id)).toEqual(["c"]);
  });
  it("cancel tab = cancelled status", () => {
    expect(filterByTab(rows, "cancel").map((r) => r.id)).toEqual(["d"]);
  });
  it("tabCount returns the filtered length (C10)", () => {
    expect(tabCount(rows, "po")).toBe(2);
    expect(tabCount(rows, "cancel")).toBe(1);
  });
});

describe("countByStatus", () => {
  it("counts rows of a given status", () => {
    const rows = [row({ status: "received" }), row({ status: "received" }), row({ status: "returned" })];
    expect(countByStatus(rows, "received")).toBe(2);
    expect(countByStatus(rows, "returned")).toBe(1);
    expect(countByStatus(rows, "cancelled")).toBe(0);
  });
});

describe("refKind", () => {
  it("prefers PO, then WO, then none", () => {
    expect(refKind(row({ poId: "p" }))).toBe("PO");
    expect(refKind(row({ woId: "w" }))).toBe("WO");
    expect(refKind(row())).toBe("");
  });
});

describe("refNoMap + resolveRefNo", () => {
  const poNos = refNoMap([
    { id: "po1", no: "PO-2026-0288", status: "approved", amount: 0 },
    { id: "po2", no: "PO-2026-0287", status: "approved", amount: 0 },
  ]);
  const woNos = refNoMap([{ id: "wo1", no: "WO-2026-0115", status: "approved", amount: 0 }]);

  it("resolves a PO anchor to its doc no", () => {
    expect(resolveRefNo(row({ poId: "po1" }), poNos, woNos)).toBe("PO-2026-0288");
  });
  it("resolves a WO anchor to its doc no", () => {
    expect(resolveRefNo(row({ woId: "wo1" }), poNos, woNos)).toBe("WO-2026-0115");
  });
  it("returns empty (never a UUID) for an anchor not in the fetched page", () => {
    expect(resolveRefNo(row({ poId: "po-missing" }), poNos, woNos)).toBe("");
    expect(resolveRefNo(row(), poNos, woNos)).toBe("");
  });
});

describe("statusTone + statusLabelKind", () => {
  it("received maps to the approved (green) tone", () => {
    expect(statusTone("received")).toEqual({ bg: "var(--ok-soft)", fg: "var(--ok)", dot: "#16A34A" });
    expect(statusLabelKind("received")).toBe("received");
  });
  it("cancelled uses the ds.jsx STATUS.cancelled verbatim literals", () => {
    expect(statusTone("cancelled")).toEqual({ bg: "#F1F5F9", fg: "#64748B", dot: "#94A3B8" });
    expect(statusLabelKind("cancelled")).toBe("cancelled");
  });
  it("returned uses the info tone (approximate) and its own label kind", () => {
    expect(statusTone("returned")).toEqual({ bg: "var(--info-soft)", fg: "var(--info)", dot: "#1D4ED8" });
    expect(statusLabelKind("returned")).toBe("returned");
  });
  it("unknown status falls back to received", () => {
    expect(statusLabelKind("weird")).toBe("received");
  });
});

describe("filterByQuery", () => {
  const poNos = refNoMap([{ id: "po1", no: "PO-2026-0288", status: "approved", amount: 0 }]);
  const woNos = refNoMap([]);
  const rows = [
    row({ id: "a", no: "GR-2026-0148", poId: "po1", vendor: "TOA Paint" }),
    row({ id: "b", no: "GR-2026-0147", vendor: "Thai Steel" }),
  ];

  it("returns all rows for an empty query", () => {
    expect(filterByQuery(rows, "   ", poNos, woNos)).toHaveLength(2);
  });
  it("matches on GR no (case-insensitive)", () => {
    expect(filterByQuery(rows, "0148", poNos, woNos).map((r) => r.id)).toEqual(["a"]);
  });
  it("matches on the resolved ref no", () => {
    expect(filterByQuery(rows, "0288", poNos, woNos).map((r) => r.id)).toEqual(["a"]);
  });
  // The placeholder advertises a vendor search; vendor is on the list wire now.
  it("matches on the vendor name (case-insensitive)", () => {
    expect(filterByQuery(rows, "thai steel", poNos, woNos).map((r) => r.id)).toEqual(["b"]);
  });
});

describe("openAnchors", () => {
  it("keeps only approved (open) docs", () => {
    const docs = [
      { id: "1", no: "PO-1", status: "approved", amount: 0 },
      { id: "2", no: "PO-2", status: "draft", amount: 0 },
      { id: "3", no: "PO-3", status: "closed", amount: 0 },
    ];
    expect(openAnchors(docs).map((d) => d.id)).toEqual(["1"]);
    expect(openAnchors(undefined)).toEqual([]);
  });
});

describe("formatMoney", () => {
  it("groups thousands, rounds, and guards non-finite", () => {
    expect(formatMoney(902475)).toBe("902,475");
    expect(formatMoney(2612800)).toBe("2,612,800");
    expect(formatMoney(96800.4)).toBe("96,800");
    expect(formatMoney(Number.NaN)).toBe("0");
  });
});

describe("buildLines", () => {
  it("composes a single aggregate line and clamps negatives to 0", () => {
    expect(buildLines(320, 4)).toEqual([{ qty_ok: 320, qty_rejected: 4 }]);
    expect(buildLines(-5, Number.NaN)).toEqual([{ qty_ok: 0, qty_rejected: 0 }]);
  });
});

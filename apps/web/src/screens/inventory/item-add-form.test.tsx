/*
 * ItemAddForm tests (gate G3) — the fields it offers, and the gate that stops it.
 *
 * WHY THIS FILE EXISTS: the same shape as wh-add-form.test.tsx. The add-material
 * control was DISABLED with a comment saying the create form was out of scope, while
 * POST /inventory/items had been merged the whole time (inventory.ts:1469). What must
 * not regress is the set of fields — three prototype elements are deliberately absent
 * and each would be a lie if it came back: a BOQ field the server discards, an info
 * strip promising automatic BOQ/PR/PO linking that nothing performs, and two unit
 * options with no key.
 *
 * Harness: node env, renderToStaticMarkup, i18n mocked to echo keys — so this file
 * stays ASCII-only and the assertions read structure.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    t: (k: string) => k,
    tn: (k: string) => k,
    tp: (k: string) => k,
  }),
}));

const { ItemAddForm, itemDraftReady, numberOf } = await import("./item-add-form");

const WAREHOUSES = [
  { id: "wh-1", name: "Central" },
  { id: "wh-2", name: "Block A" },
];

const render = (saving = false, warehouses = WAREHOUSES) =>
  renderToStaticMarkup(
    <ItemAddForm
      warehouses={warehouses}
      saving={saving}
      onSubmit={() => {}}
      onClose={() => {}}
    />,
  );

/** The <button ...>...</button> segment whose text contains `label`, tag included. */
function buttonWith(html: string, label: string): string {
  const seg = html.split("<button").find((part) => part.includes(label));
  expect(seg, `no button rendered for ${label}`).toBeDefined();
  return seg!;
}

describe("ItemAddForm — the fields it offers", () => {
  it("labels every field with a key, borrowing where inv.itemAdd has none", () => {
    const html = render();
    for (const key of [
      "inv.itemAdd.fieldCode",
      "boq.listExcItemName", // borrowed: inv.itemAdd has no fieldName
      "sales.service.thCategory", // borrowed: inv.itemAdd has no fieldCat
      "inv.itemAdd.fieldUnit",
      "inv.itemAdd.fieldStdPrice",
      "inv.itemAdd.fieldReorder",
      "inv.itemAdd.fieldMainWh",
      "inv.itemAdd.btnSave",
    ]) {
      expect(html).toContain(key);
    }
  });

  it("does NOT render the BOQ field or its info strip", () => {
    // inventory_item has no BOQ column and the handler reads no such key, so the
    // field would be discarded silently; the strip claims automatic BOQ/PR/PO
    // linking that nothing in the codebase performs.
    const html = render();
    expect(html).not.toContain("inv.itemAdd.fieldBoq");
    expect(html).not.toContain("inv.itemAdd.infoBoq");
  });

  it("offers the EIGHT unit options that have keys, not the prototype's ten", () => {
    const html = render();
    for (const k of ["piece", "bag", "rod", "roll", "meter", "set", "box", "other"]) {
      expect(html).toContain(`inv.unit.${k}`);
    }
    // 8 units + 4 categories + 1 blank warehouse + 2 warehouses = 15 options.
    expect((html.match(/<option/g) ?? []).length).toBe(15);
  });

  it("builds the warehouse picker from REAL rows and sends ids, not names", () => {
    // The prototype hardcoded five warehouse NAMES; warehouse_id is what the handler
    // reads, and it 400s an id belonging to another tenant.
    const html = render();
    expect(html).toContain('value="wh-1"');
    expect(html).toContain('value="wh-2"');
  });

  it("leaves the warehouse unset by default — the column is nullable", () => {
    const html = render();
    expect(html).toContain('<option value=""');
  });

  it("starts the code field EMPTY — the prototype's random default is a mock mechanic", () => {
    expect(render()).not.toContain("MAT-NEW-");
  });
});

describe("ItemAddForm — the save gate", () => {
  it("disables save on a fresh form", () => {
    expect(buttonWith(render(), "inv.itemAdd.btnSave")).toContain("disabled");
  });

  it("leaves CANCEL usable on a fresh form", () => {
    expect(buttonWith(render(), "common.cancel")).not.toContain("disabled");
  });

  it("locks BOTH footer controls while a create is in flight", () => {
    const html = render(true);
    expect(buttonWith(html, "common.cancel")).toContain("disabled");
    expect(buttonWith(html, "inv.itemAdd.btnSave")).toContain("disabled");
  });

  it("renders with no warehouses at all rather than crashing", () => {
    // A fresh tenant has none. The picker then holds only its blank option.
    const html = render(false, []);
    expect(html).toContain("inv.itemAdd.fieldMainWh");
    expect((html.match(/<option/g) ?? []).length).toBe(13);
  });
});

describe("itemDraftReady — the gate the rendered button cannot exercise", () => {
  const ok = { code: "MAT-1", name: "Cement", price: "168.5" };

  it("passes a complete draft", () => {
    expect(itemDraftReady(ok)).toBe(true);
  });

  it("REFUSES a price of zero — the server rejects it outright", () => {
    // inventory.ts:691-693: "price is required and must be greater than zero". The
    // prototype's own gate allowed price >= 0, which would put a guaranteed 400
    // behind an enabled save control.
    expect(itemDraftReady({ ...ok, price: "0" })).toBe(false);
    expect(itemDraftReady({ ...ok, price: "0.00" })).toBe(false);
  });

  it("REFUSES a negative price", () => {
    expect(itemDraftReady({ ...ok, price: "-5" })).toBe(false);
  });

  it("REFUSES a blank or non-numeric price", () => {
    expect(itemDraftReady({ ...ok, price: "" })).toBe(false);
    expect(itemDraftReady({ ...ok, price: "abc" })).toBe(false);
  });

  it("REFUSES a code or name that is only whitespace", () => {
    // The handler trims before its own required check, so " " is a 400 there too.
    expect(itemDraftReady({ ...ok, code: "   " })).toBe(false);
    expect(itemDraftReady({ ...ok, name: "   " })).toBe(false);
  });

  it("accepts a thousands-separated price, because the field is typed by hand", () => {
    expect(itemDraftReady({ ...ok, price: "1,250" })).toBe(true);
    expect(numberOf("1,250")).toBe(1250);
  });
});

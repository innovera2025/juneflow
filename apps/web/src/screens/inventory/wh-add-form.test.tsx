/*
 * WarehouseAddForm tests (gate G3) — the draft it emits, and the gate that stops it.
 *
 * WHY THIS FILE EXISTS: the add-warehouse control was rendered DISABLED with a comment
 * saying the create form was "out of this read scope", while POST /inventory/warehouses
 * had been merged the whole time. Nothing caught that, because a disabled button is not
 * a failure any typecheck or row test can see. What must not regress now is the shape
 * of what the form sends — the handler 400s a blank code or name (inventory.ts:741-744)
 * and drops any key it does not read.
 *
 * Harness: the repo's vitest env is `node` (no jsdom), so the form renders DOM-free with
 * renderToStaticMarkup and its i18n dependency is vi.mock'd — the subcon-accept.test.tsx
 * style. Translators echo the key, so this file stays ASCII-only.
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

const { WarehouseAddForm } = await import("./wh-add-form");

const render = (saving = false) =>
  renderToStaticMarkup(
    <WarehouseAddForm saving={saving} onSubmit={() => {}} onClose={() => {}} />,
  );

describe("WarehouseAddForm — the fields it offers", () => {
  it("labels every field with its inv.whAdd key, so no Thai is invented in source", () => {
    const html = render();
    for (const key of [
      "inv.whAdd.fieldCode",
      "inv.whAdd.fieldName",
      "inv.whAdd.fieldType",
      "inv.whAdd.fieldOwner",
      "inv.whAdd.fieldCapacity",
      "inv.whAdd.btnSave",
    ]) {
      expect(html).toContain(key);
    }
  });

  it("offers ALL FOUR type options the prototype has", () => {
    // The fourth (tools) was missing while I searched only the inv.whType group;
    // its label exists under fa.catTool with byte-identical Thai, so the option is
    // a borrow, not a mint (B-422).
    const html = render();
    for (const key of ["inv.whType.site", "inv.whType.central", "fa.catTool", "inv.whType.temp"]) {
      expect(html, `missing type option: ${key}`).toContain(key);
    }
    expect((html.match(/<option/g) ?? []).length).toBe(4);
  });

  it("does NOT render a project field — no key for it, and no column behind it", () => {
    const html = render();
    expect(html).not.toContain("fieldProject");
    // Five inputs: code, name, owner, capacity (inputs) + type (select). A sixth
    // would mean the project picker came back without a key.
    expect((html.match(/<input/g) ?? []).length).toBe(4);
    expect((html.match(/<select/g) ?? []).length).toBe(1);
  });

  it("starts the code field EMPTY — the prototype's random default is a mock mechanic", () => {
    // pototype/inventory.jsx:493 seeds "WH-" + Math.random(). A value nobody agreed
    // to, different on every open, is worse than an empty required field.
    const html = render();
    expect(html).not.toContain("WH-");
  });
});

/** The <button ...>...</button> segment whose text contains `label`, tag included. */
function buttonWith(html: string, label: string): string {
  const seg = html.split("<button").find((part) => part.includes(label));
  expect(seg, `no button rendered for ${label}`).toBeDefined();
  return seg!;
}

describe("WarehouseAddForm — the save gate", () => {
  it("disables save until the required fields are filled", () => {
    // The prototype's own gate (inventory.jsx:497). Rendered fresh, nothing is typed,
    // so save must be disabled — and there is no inv.whAdd.err* key to explain a
    // failure with, which is exactly why the gate is a disabled control, not a message.
    expect(buttonWith(render(), "inv.whAdd.btnSave")).toContain("disabled");
  });

  it("leaves CANCEL usable while the form is untouched", () => {
    // Only save is gated. A cancel that disables itself would trap the person in a
    // modal they cannot complete and cannot leave.
    expect(buttonWith(render(), "common.cancel")).not.toContain("disabled");
  });

  it("locks BOTH footer controls while a create is in flight", () => {
    const html = render(true);
    expect(buttonWith(html, "common.cancel")).toContain("disabled");
    expect(buttonWith(html, "inv.whAdd.btnSave")).toContain("disabled");
  });
});

/*
 * ItemAddForm — the add-material modal body, ported from pototype/inventory.jsx
 * ItemAddForm (L327-380). Opened by InventoryItems via ctx.openModal, mirroring the
 * prototype's own header action on that screen.
 *
 * Design fidelity (PLAN.md §0 rule 1): the 1fr/2fr top row (code · name), the two
 * 1fr/1fr/1fr rows below it, the required-field gating, and the cancel/save footer are
 * the prototype's. Field primitives follow cc-add-form.tsx / wh-add-form.tsx.
 *
 * WHAT THE PROTOTYPE HAS THAT THIS DOES NOT, and why each is absent:
 *
 *   1. THE BOQ LINK FIELD. `inv.itemAdd.fieldBoq` exists as a key, but
 *      `inventory_item` has no BOQ column and POST /inventory/items reads no such
 *      field (inventory.ts:687-700). A field whose value the server discards is worse
 *      than no field: it invites someone to type a BOQ code and believe it was saved.
 *
 *   2. THE INFO STRIP under the fields. Its copy (inv.itemAdd.infoBoq) promises the
 *      item will be linked to BOQ + PR + PO automatically on save. Nothing does that.
 *      Rendering it would be the screen making a claim about the system that is false.
 *
 *
 * BORROWED KEYS (rule 2 allows an existing key whose Thai is identical; the same
 * practice inventory-stock.tsx documents for its own borrows): the name label uses
 * boq.listExcItemName and the category label uses sales.service.thCategory —
 * inv.itemAdd has no fieldName or fieldCat of its own, and these are the two borrows
 * inventory-items.tsx already documents in its own header for the same two columns.
 *
 * MOCK MECHANICS DROPPED (rule 3): the prototype seeds the code with
 * "MAT-NEW-" + Math.random() and defaults the warehouse to a hardcoded name string.
 * The code starts empty; the warehouse picker is built from the tenant's REAL
 * warehouses and sends an id, not a name.
 *
 * Category values are the prototype's own English literals, which is what it renders
 * as labels too — no Thai, so no key is involved. Unit values are the inv.unit key
 * suffixes ("piece", "bag", …), the same value/label split cc-add-form uses.
 */
import { useState } from "react";
import type { CSSProperties } from "react";
import type { DictKey } from "@juneflow/i18n";
import { useI18n } from "../../i18n";
import { Btn } from "../../ui/button";
import { Field } from "../../ui/field";
import type { ItemDraft } from "./use-inventory";

/** Category options (inventory.jsx:350). Value and label are the same literal. */
const CAT_OPTIONS: readonly string[] = ["Material", "Tool", "Consumable", "Equipment"];

/**
 * Unit options: value = the unit code stored on the row, label = its dict key.
 *
 * ALL TEN the prototype offers (inventory.jsx:510). Square- and cubic-metre were
 * left out at first because `inv.unit` has only eight — but both labels already
 * exist under another group, as `subcon.unitSqm` and `subcon.unitCbm`, with
 * byte-identical Thai. Nothing had to be minted; the gap was in how I searched
 * (one namespace instead of the whole dictionary by VALUE), not in the
 * dictionary itself (B-422).
 */
const UNIT_OPTIONS: readonly (readonly [string, DictKey])[] = [
  ["piece", "inv.unit.piece" as DictKey],
  ["bag", "inv.unit.bag" as DictKey],
  ["rod", "inv.unit.rod" as DictKey],
  ["roll", "inv.unit.roll" as DictKey],
  ["meter", "inv.unit.meter" as DictKey],
  ["set", "inv.unit.set" as DictKey],
  ["box", "inv.unit.box" as DictKey],
  ["sqm", "subcon.unitSqm" as DictKey],
  ["cbm", "subcon.unitCbm" as DictKey],
  ["other", "inv.unit.other" as DictKey],
];

/**
 * A numeric input as a Number, or undefined when blank / not a number. Exported so the
 * save gate below can be tested without a DOM (this harness dispatches no events).
 */
export function numberOf(raw: string): number | undefined {
  const cleaned = raw.replace(/,/g, "").trim();
  if (cleaned === "") return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * May the save control fire? The prototype's gate (inventory.jsx:336) is
 * code && name && unit && price >= 0. THE SERVER IS STRICTER: it rejects a price of 0
 * outright — "price is required and must be greater than zero" (inventory.ts:691-693)
 * — so this matches the server instead. A form that lets someone press save on a value
 * the server will refuse is a worse copy of the prototype than one that does not.
 *
 * Pure and exported because renderToStaticMarkup cannot type into a field: asserting
 * this through the rendered button would only ever exercise the empty-form case, and a
 * gate that silently stopped checking the price would keep passing.
 */
export function itemDraftReady(input: { code: string; name: string; price: string }): boolean {
  const price = numberOf(input.price);
  return input.code.trim() !== "" && input.name.trim() !== "" && price != null && price > 0;
}

/** Input style, shared with wh-add-form / cc-add-form. */
const fieldStyle: CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  fontSize: 13,
  border: "1px solid var(--border)",
  borderRadius: 7,
  background: "var(--surface)",
  outline: "none",
  fontFamily: "inherit",
};

/** One selectable warehouse (id + display name), from the tenant's real rows. */
export interface WarehouseOption {
  id: string;
  name: string;
}

export interface ItemAddFormProps {
  /** The tenant's warehouses — the main-warehouse picker, never a hardcoded list. */
  warehouses: readonly WarehouseOption[];
  /** True while the create is in flight — both footer controls lock. */
  saving: boolean;
  onSubmit: (draft: ItemDraft) => void;
  onClose: () => void;
}

export function ItemAddForm({ warehouses, saving, onSubmit, onClose }: ItemAddFormProps) {
  const { t } = useI18n();

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [cat, setCat] = useState("Material");
  const [unit, setUnit] = useState("piece");
  const [price, setPrice] = useState("");
  const [reorder, setReorder] = useState("");
  const [warehouseId, setWarehouseId] = useState("");

  const priceNumber = numberOf(price);
  const canSave = itemDraftReady({ code, name, price });

  const submit = () => {
    if (!canSave || saving || priceNumber == null) return;
    onSubmit({
      code: code.trim(),
      name: name.trim(),
      price: priceNumber,
      cat,
      unit,
      lowPoint: numberOf(reorder),
      warehouseId: warehouseId || undefined,
    });
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 14, marginBottom: 14 }}>
        <Field label={t("inv.itemAdd.fieldCode")} required>
          <input value={code} onChange={(e) => setCode(e.target.value)} className="num" style={fieldStyle} />
        </Field>

        <Field label={t("boq.listExcItemName")} required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("inv.itemAdd.namePlaceholder")}
            style={fieldStyle}
          />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 14 }}>
        <Field label={t("sales.service.thCategory")} required>
          <select value={cat} onChange={(e) => setCat(e.target.value)} style={fieldStyle}>
            {CAT_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("inv.itemAdd.fieldUnit")} required>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} style={fieldStyle}>
            {UNIT_OPTIONS.map(([value, labelKey]) => (
              <option key={value} value={value}>
                {t(labelKey)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t("inv.itemAdd.fieldStdPrice")} required>
          <input value={price} onChange={(e) => setPrice(e.target.value)} className="num" style={fieldStyle} />
        </Field>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label={t("inv.itemAdd.fieldReorder")}>
          <input value={reorder} onChange={(e) => setReorder(e.target.value)} className="num" style={fieldStyle} />
        </Field>

        <Field label={t("inv.itemAdd.fieldMainWh")}>
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            style={fieldStyle}
          >
            {/* Blank first: the column is nullable and the prototype's hardcoded
                default would otherwise pick a warehouse nobody chose. */}
            <option value="" />
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
        <Btn kind="outline" size="md" disabled={saving} onClick={onClose}>
          {t("common.cancel")}
        </Btn>
        <Btn kind="primary" size="md" icon="check" disabled={!canSave || saving} onClick={submit}>
          {t("inv.itemAdd.btnSave")}
        </Btn>
      </div>
    </div>
  );
}
